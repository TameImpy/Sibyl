import { NextRequest, NextResponse } from 'next/server';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { z } from 'zod';
import { sqsClient, TEXT_QUEUE_URL, VIDEO_QUEUE_URL } from '@/lib/aws';

const SubmitRequestSchema = z.object({
  content_type: z.enum(['article', 'podcast', 'json', 'video']),
  title: z.string().min(1).max(500),
  content_text: z.string().optional(),
  content_url: z.string().url().optional(),
  duration_seconds: z.number().positive().optional(),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = SubmitRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const { content_type, title, content_text, content_url, duration_seconds } = parsed.data;

  if (content_type === 'video' && !content_url) {
    return NextResponse.json({ error: 'content_url required for video' }, { status: 422 });
  }
  if (content_type !== 'video' && !content_text) {
    return NextResponse.json({ error: 'content_text required for non-video content' }, { status: 422 });
  }

  const contentId = crypto.randomUUID();
  const traceId = crypto.randomUUID();

  const sqsPayload = {
    content: {
      content_id: contentId,
      content_type,
      ...(content_text ? { content_text } : {}),
      ...(content_url ? { content_url } : {}),
      metadata: {
        title,
        ...(duration_seconds ? { duration_seconds } : {}),
      },
      processing_config: {
        priority: 'normal' as const,
        max_tags: 10,
      },
    },
    attempt: 1,
    max_attempts: 3,
    trace_id: traceId,
  };

  const queueUrl = content_type === 'video' ? VIDEO_QUEUE_URL : TEXT_QUEUE_URL;

  if (!queueUrl) {
    return NextResponse.json(
      { error: `Queue URL not configured (${content_type === 'video' ? 'VIDEO_QUEUE_URL' : 'TEXT_QUEUE_URL'})` },
      { status: 500 },
    );
  }

  try {
    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(sqsPayload),
        MessageAttributes: {
          contentType: { DataType: 'String', StringValue: content_type },
          traceId: { DataType: 'String', StringValue: traceId },
        },
      }),
    );
  } catch (err) {
    console.error('SQS send error', err);
    return NextResponse.json({ error: 'Failed to enqueue content' }, { status: 502 });
  }

  return NextResponse.json({ contentId, traceId, contentType: content_type }, { status: 202 });
}
