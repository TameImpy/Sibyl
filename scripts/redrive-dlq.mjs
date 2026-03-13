/**
 * Serial DLQ redriver — moves one message at a time with a configurable
 * pause between each, giving Lambda time to fully process (and Bedrock time
 * to recover) before the next message is sent.
 *
 * Usage:
 *   AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... AWS_REGION=us-east-1 \
 *   node poc/scripts/redrive-dlq.mjs
 */

import {
  SQSClient,
  ReceiveMessageCommand,
  SendMessageCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
} from '@aws-sdk/client-sqs';

const DLQ_URL = 'https://sqs.us-east-1.amazonaws.com/383234048496/sibyl-tagging-dlq-dev';
const TARGET_URL = 'https://sqs.us-east-1.amazonaws.com/383234048496/sibyl-text-processing-dev';
const DELAY_BETWEEN_MS = 25_000; // 25s — Lambda text processing takes ~7s + Bedrock recovery time

const client = new SQSClient({ region: process.env.AWS_REGION || 'us-east-1' });

async function getDlqDepth() {
  const res = await client.send(new GetQueueAttributesCommand({
    QueueUrl: DLQ_URL,
    AttributeNames: ['ApproximateNumberOfMessages'],
  }));
  return parseInt(res.Attributes?.ApproximateNumberOfMessages ?? '0', 10);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const total = await getDlqDepth();
  console.log(`DLQ depth: ${total} messages — redriving one at a time with ${DELAY_BETWEEN_MS / 1000}s gap\n`);

  let moved = 0;
  let empty = 0;

  while (true) {
    // Receive one message from DLQ
    const recv = await client.send(new ReceiveMessageCommand({
      QueueUrl: DLQ_URL,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: 5,
    }));

    const msg = recv.Messages?.[0];
    if (!msg) {
      empty++;
      if (empty >= 3) {
        console.log('\nDLQ appears empty — done.');
        break;
      }
      console.log('DLQ empty poll, retrying...');
      await sleep(5_000);
      continue;
    }
    empty = 0;

    // Forward to main queue
    await client.send(new SendMessageCommand({
      QueueUrl: TARGET_URL,
      MessageBody: msg.Body,
    }));

    // Delete from DLQ
    await client.send(new DeleteMessageCommand({
      QueueUrl: DLQ_URL,
      ReceiptHandle: msg.ReceiptHandle,
    }));

    moved++;
    const remaining = await getDlqDepth();
    console.log(`[${moved}] moved — DLQ remaining: ${remaining} — waiting ${DELAY_BETWEEN_MS / 1000}s...`);

    await sleep(DELAY_BETWEEN_MS);
  }

  console.log(`\nDone. ${moved} messages redriven.`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
