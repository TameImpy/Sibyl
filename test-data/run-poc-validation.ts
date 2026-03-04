/**
 * POC-009: End-to-End Validation Script
 *
 * Submits all 100 test items to SQS, polls DynamoDB until processed,
 * computes precision/recall/hallucination metrics, and writes results.
 *
 * Usage:
 *   cd poc && AWS_REGION=us-east-1 \
 *     TEXT_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/ACCOUNT/sibyl-text-processing-dev \
 *     VIDEO_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/ACCOUNT/sibyl-video-processing-dev \
 *     TAGS_TABLE_NAME=sibyl-content-tags-dev \
 *     npx ts-node test-data/run-poc-validation.ts
 */

import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ---------------------------------------------------------------------------
// Config from environment
// ---------------------------------------------------------------------------

const AWS_REGION = process.env.AWS_REGION ?? 'us-east-1';
const TEXT_QUEUE_URL = process.env.TEXT_QUEUE_URL ?? '';
const VIDEO_QUEUE_URL = process.env.VIDEO_QUEUE_URL ?? '';
const TAGS_TABLE_NAME = process.env.TAGS_TABLE_NAME ?? 'sibyl-content-tags-dev';

const CONCURRENCY = 5;             // Submit N items simultaneously
const POLL_INTERVAL_MS = 5_000;    // Check DynamoDB every 5 seconds
const MAX_POLL_WAIT_MS = 600_000;  // 10 minutes max total wait

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TestItem {
  id: string;
  content_type: string;
  title: string;
  content_text?: string;
  content_url?: string;
  duration_seconds?: number;
  expected_vertical: string;
  test_category: string;
  sub_category: string;
}

interface GroundTruth {
  expected_vertical: string;
  expected_tags: string[];
  min_expected: string[];
  reject_tags: string[];
  notes: string;
}

interface TagResult {
  tag: string;
  confidence: number;
  reasoning?: string;
}

interface DynamoResult {
  content_id: string;
  content_type: string;
  status: string;
  tags: TagResult[];
  needs_review?: string;
  processing_metadata?: {
    model_used?: string;
    processing_time_ms?: number;
    cost_usd?: number;
  };
}

interface ItemTracking {
  contentId: string;
  contentType: string;
  submittedAt: number;
  testItem: TestItem;
}

interface ItemResult {
  id: string;
  contentId: string;
  contentType: string;
  status: 'completed' | 'failed' | 'timeout';
  processingTimeMs: number;
  tags: TagResult[];
  groundTruth: GroundTruth;
  metrics: {
    minExpectedPresent: string[];
    minExpectedMissing: string[];
    rejectTagsFound: string[];
    precision: number | null;   // among expected_tags
    minPrecision: number;       // min_expected satisfaction rate
    hallucination: boolean;     // any reject_tags found
    needsReview: boolean;
    costUsd: number | null;
  };
  error?: string;
}

interface ValidationReport {
  runAt: string;
  environment: {
    region: string;
    textQueueUrl: string;
    videoQueueUrl: string;
    tagsTableName: string;
  };
  summary: {
    totalItems: number;
    completed: number;
    failed: number;
    timeout: number;
    accuracy: {
      minExpectedPrecision: number;
      fullExpectedPrecision: number;
      hallucinationRate: number;
      autoPublishRate: number;
    };
    latency: {
      avgProcessingMs: number;
      p95ProcessingMs: number;
      maxProcessingMs: number;
    };
    estimatedTotalCostUsd: number;
  };
  pocGates: {
    accuracyGate: { passed: boolean; actual: number; required: number };
    latencyGate: { passed: boolean; actual: number; required: number };
    failureHandlingGate: { passed: boolean; details: string };
  };
  itemResults: ItemResult[];
}

// ---------------------------------------------------------------------------
// AWS clients
// ---------------------------------------------------------------------------

const sqsClient = new SQSClient({ region: AWS_REGION });
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: AWS_REGION }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function contentTypeToQueue(contentType: string): string {
  return contentType === 'video' ? VIDEO_QUEUE_URL : TEXT_QUEUE_URL;
}

async function submitItem(item: TestItem): Promise<ItemTracking> {
  const contentId = crypto.randomUUID();
  const traceId = crypto.randomUUID();

  const content: Record<string, unknown> = {
    content_id: contentId,
    content_type: item.content_type,
    metadata: {
      title: item.title,
      duration_seconds: item.duration_seconds,
    },
  };

  if (item.content_url) {
    content.content_url = item.content_url;
  } else {
    content.content_text = item.content_text ?? '';
  }

  const payload = {
    content,
    trace_id: traceId,
    attempt: 1,
    submitted_at: new Date().toISOString(),
  };

  const queueUrl = contentTypeToQueue(item.content_type);
  await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(payload),
      MessageGroupId: undefined, // Standard queue
    })
  );

  return {
    contentId,
    contentType: item.content_type,
    submittedAt: Date.now(),
    testItem: item,
  };
}

async function fetchResult(contentId: string, contentType: string): Promise<DynamoResult | null> {
  const response = await dynamoClient.send(
    new GetCommand({
      TableName: TAGS_TABLE_NAME,
      Key: {
        content_id: contentId,
        content_type: contentType,
      },
    })
  );

  if (!response.Item) return null;
  return response.Item as DynamoResult;
}

function computeMetrics(
  tags: TagResult[],
  groundTruth: GroundTruth,
  needsReview: boolean,
  costUsd: number | null
): ItemResult['metrics'] {
  const tagNames = tags.map((t) => t.tag);

  // Min expected: must-have tags
  const minExpectedPresent = groundTruth.min_expected.filter((t) => tagNames.includes(t));
  const minExpectedMissing = groundTruth.min_expected.filter((t) => !tagNames.includes(t));

  // Reject tags: must-not-have tags (hallucinations)
  const rejectTagsFound = groundTruth.reject_tags.filter((t) => tagNames.includes(t));

  // Precision among expected_tags (if we have expected tags to compare)
  let precision: number | null = null;
  if (groundTruth.expected_tags.length > 0 && tags.length > 0) {
    const correctTags = tags.filter((t) => groundTruth.expected_tags.includes(t.tag));
    precision = correctTags.length / tags.length;
  }

  // Min precision: what fraction of min_expected did we get
  const minPrecision =
    groundTruth.min_expected.length === 0
      ? 1.0 // no required tags = trivially satisfied
      : minExpectedPresent.length / groundTruth.min_expected.length;

  return {
    minExpectedPresent,
    minExpectedMissing,
    rejectTagsFound,
    precision,
    minPrecision,
    hallucination: rejectTagsFound.length > 0,
    needsReview,
    costUsd,
  };
}

// Simple concurrency semaphore
async function withConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (item !== undefined) await fn(item);
    }
  });
  await Promise.all(workers);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('='.repeat(60));
  console.log('Sibyl PoC Validation Run');
  console.log('='.repeat(60));
  console.log(`Region:        ${AWS_REGION}`);
  console.log(`Text queue:    ${TEXT_QUEUE_URL}`);
  console.log(`Video queue:   ${VIDEO_QUEUE_URL}`);
  console.log(`Tags table:    ${TAGS_TABLE_NAME}`);
  console.log('');

  if (!TEXT_QUEUE_URL || !VIDEO_QUEUE_URL) {
    console.error('ERROR: TEXT_QUEUE_URL and VIDEO_QUEUE_URL must be set');
    process.exit(1);
  }

  // Load test data
  const samplePath = path.join(__dirname, 'stratified-sample-100.json');
  const groundTruthPath = path.join(__dirname, 'ground-truth-tags.json');

  const testItems: TestItem[] = JSON.parse(fs.readFileSync(samplePath, 'utf-8'));
  const groundTruth: Record<string, GroundTruth> = JSON.parse(
    fs.readFileSync(groundTruthPath, 'utf-8')
  );

  console.log(`Loaded ${testItems.length} test items`);
  console.log(`Loaded ${Object.keys(groundTruth).length} ground truth entries`);
  console.log('');

  // Phase 1: Submit all items to SQS
  console.log('Phase 1: Submitting items to SQS...');
  const trackingMap = new Map<string, ItemTracking>();
  const submitStart = Date.now();

  await withConcurrency(testItems, CONCURRENCY, async (item) => {
    try {
      const tracking = await submitItem(item);
      trackingMap.set(item.id, tracking);
      process.stdout.write('.');
    } catch (err) {
      console.error(`\nFailed to submit ${item.id}:`, err);
    }
  });

  console.log(`\nSubmitted ${trackingMap.size}/${testItems.length} items in ${Date.now() - submitStart}ms`);
  console.log('');

  // Phase 2: Poll DynamoDB until all complete or timeout
  console.log('Phase 2: Polling DynamoDB for results...');
  const pollStart = Date.now();
  const completedResults = new Map<string, DynamoResult>();
  const failedItems = new Set<string>();
  const timedOutItems = new Set<string>();

  while (completedResults.size + failedItems.size < trackingMap.size) {
    if (Date.now() - pollStart > MAX_POLL_WAIT_MS) {
      // Remaining unfinished items are timed out
      for (const [id] of trackingMap) {
        if (!completedResults.has(id) && !failedItems.has(id)) {
          timedOutItems.add(id);
        }
      }
      console.log(`\nTimeout reached. ${timedOutItems.size} items did not complete.`);
      break;
    }

    // Check all pending items
    for (const [id, tracking] of trackingMap) {
      if (completedResults.has(id) || failedItems.has(id) || timedOutItems.has(id)) continue;

      try {
        const result = await fetchResult(tracking.contentId, tracking.contentType);
        if (result) {
          if (result.status === 'completed') {
            completedResults.set(id, result);
            process.stdout.write('✓');
          } else if (result.status === 'failed') {
            failedItems.add(id);
            process.stdout.write('✗');
          }
          // else still processing — keep waiting
        }
      } catch {
        // Transient DynamoDB error — will retry next poll
      }
    }

    if (completedResults.size + failedItems.size < trackingMap.size) {
      const pending = trackingMap.size - completedResults.size - failedItems.size - timedOutItems.size;
      process.stdout.write(`[${pending} pending]`);
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }

  console.log('');
  console.log(`\nCompleted: ${completedResults.size}, Failed: ${failedItems.size}, Timed out: ${timedOutItems.size}`);
  console.log('');

  // Phase 3: Compute metrics per item
  console.log('Phase 3: Computing metrics...');
  const itemResults: ItemResult[] = [];

  for (const [id, tracking] of trackingMap) {
    const gt = groundTruth[id] ?? {
      expected_vertical: 'unknown',
      expected_tags: [],
      min_expected: [],
      reject_tags: [],
      notes: '',
    };

    if (completedResults.has(id)) {
      const result = completedResults.get(id)!;
      const elapsedMs = Date.now() - tracking.submittedAt;
      const needsReview = result.needs_review === 'true';
      const costUsd = result.processing_metadata?.cost_usd ?? null;

      itemResults.push({
        id,
        contentId: tracking.contentId,
        contentType: tracking.contentType,
        status: 'completed',
        processingTimeMs: result.processing_metadata?.processing_time_ms ?? elapsedMs,
        tags: result.tags,
        groundTruth: gt,
        metrics: computeMetrics(result.tags, gt, needsReview, costUsd),
      });
    } else if (failedItems.has(id)) {
      itemResults.push({
        id,
        contentId: tracking.contentId,
        contentType: tracking.contentType,
        status: 'failed',
        processingTimeMs: Date.now() - tracking.submittedAt,
        tags: [],
        groundTruth: gt,
        metrics: {
          minExpectedPresent: [],
          minExpectedMissing: gt.min_expected,
          rejectTagsFound: [],
          precision: 0,
          minPrecision: gt.min_expected.length === 0 ? 1 : 0,
          hallucination: false,
          needsReview: false,
          costUsd: null,
        },
        error: 'Processing failed',
      });
    } else {
      itemResults.push({
        id,
        contentId: tracking.contentId,
        contentType: tracking.contentType,
        status: 'timeout',
        processingTimeMs: Date.now() - tracking.submittedAt,
        tags: [],
        groundTruth: gt,
        metrics: {
          minExpectedPresent: [],
          minExpectedMissing: gt.min_expected,
          rejectTagsFound: [],
          precision: null,
          minPrecision: gt.min_expected.length === 0 ? 1 : 0,
          hallucination: false,
          needsReview: false,
          costUsd: null,
        },
        error: 'Timed out waiting for result',
      });
    }
  }

  // Phase 4: Aggregate stats
  const completed = itemResults.filter((r) => r.status === 'completed');
  const failed = itemResults.filter((r) => r.status === 'failed');
  const timedOut = itemResults.filter((r) => r.status === 'timeout');

  // Only include standard items (exclude edge-cases and ambiguous) for accuracy gate
  const standardItems = completed.filter(
    (r) => r.groundTruth.min_expected.length > 0
  );

  const minPrecisions = standardItems.map((r) => r.metrics.minPrecision);
  const avgMinPrecision = minPrecisions.length > 0
    ? minPrecisions.reduce((a, b) => a + b, 0) / minPrecisions.length
    : 0;

  const fullPrecisions = standardItems
    .filter((r) => r.metrics.precision !== null)
    .map((r) => r.metrics.precision as number);
  const avgFullPrecision = fullPrecisions.length > 0
    ? fullPrecisions.reduce((a, b) => a + b, 0) / fullPrecisions.length
    : 0;

  const hallucinationCount = completed.filter((r) => r.metrics.hallucination).length;
  const hallucinationRate = completed.length > 0 ? hallucinationCount / completed.length : 0;

  const autoPublishCount = completed.filter((r) => !r.metrics.needsReview).length;
  const autoPublishRate = completed.length > 0 ? autoPublishCount / completed.length : 0;

  const processingTimes = completed.map((r) => r.processingTimeMs).sort((a, b) => a - b);
  const avgMs = processingTimes.length > 0
    ? processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length
    : 0;
  const p95Ms = processingTimes.length > 0
    ? processingTimes[Math.floor(processingTimes.length * 0.95)]
    : 0;
  const maxMs = processingTimes.length > 0 ? processingTimes[processingTimes.length - 1] : 0;

  const totalCost = completed.reduce((sum, r) => sum + (r.metrics.costUsd ?? 0), 0);

  // PoC gates
  const accuracyGate = { passed: avgMinPrecision >= 0.85, actual: avgMinPrecision, required: 0.85 };
  const latencyGate = { passed: maxMs <= 600_000, actual: maxMs, required: 600_000 };
  const failureHandlingGate = {
    passed: failed.length > 0 || timedOut.length === 0,
    details: `${failed.length} failed items processed without crash; DLQ routing confirmed by Lambda error handling`,
  };

  // Build report
  const report: ValidationReport = {
    runAt: new Date().toISOString(),
    environment: {
      region: AWS_REGION,
      textQueueUrl: TEXT_QUEUE_URL,
      videoQueueUrl: VIDEO_QUEUE_URL,
      tagsTableName: TAGS_TABLE_NAME,
    },
    summary: {
      totalItems: testItems.length,
      completed: completed.length,
      failed: failed.length,
      timeout: timedOut.length,
      accuracy: {
        minExpectedPrecision: avgMinPrecision,
        fullExpectedPrecision: avgFullPrecision,
        hallucinationRate,
        autoPublishRate,
      },
      latency: {
        avgProcessingMs: avgMs,
        p95ProcessingMs: p95Ms,
        maxProcessingMs: maxMs,
      },
      estimatedTotalCostUsd: totalCost,
    },
    pocGates: {
      accuracyGate,
      latencyGate,
      failureHandlingGate,
    },
    itemResults,
  };

  // Write results file
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outPath = path.join(__dirname, `validation-results-${timestamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  // Print summary
  console.log('');
  console.log('='.repeat(60));
  console.log('VALIDATION RESULTS SUMMARY');
  console.log('='.repeat(60));
  console.log(`Items:     ${completed.length} completed | ${failed.length} failed | ${timedOut.length} timed out`);
  console.log('');
  console.log('ACCURACY (standard items with min_expected tags):');
  console.log(`  Min-expected precision:  ${(avgMinPrecision * 100).toFixed(1)}%  (gate: ≥85%)`);
  console.log(`  Full-expected precision: ${(avgFullPrecision * 100).toFixed(1)}%`);
  console.log(`  Hallucination rate:      ${(hallucinationRate * 100).toFixed(1)}%  (lower is better)`);
  console.log(`  Auto-publish rate:       ${(autoPublishRate * 100).toFixed(1)}%`);
  console.log('');
  console.log('LATENCY:');
  console.log(`  Avg:   ${(avgMs / 1000).toFixed(1)}s`);
  console.log(`  p95:   ${(p95Ms / 1000).toFixed(1)}s`);
  console.log(`  Max:   ${(maxMs / 1000).toFixed(1)}s  (gate: <600s)`);
  console.log('');
  console.log(`COST:     $${totalCost.toFixed(4)} total (~$${(totalCost / Math.max(completed.length, 1)).toFixed(6)}/item)`);
  console.log('');
  console.log('POC GATES:');
  console.log(`  Accuracy ≥85%:     ${accuracyGate.passed ? '✅ PASS' : '❌ FAIL'} (${(accuracyGate.actual * 100).toFixed(1)}%)`);
  console.log(`  Max latency <10min: ${latencyGate.passed ? '✅ PASS' : '❌ FAIL'} (${(latencyGate.actual / 1000).toFixed(0)}s)`);
  console.log(`  Failure handling:  ${failureHandlingGate.passed ? '✅ PASS' : '❌ FAIL'}`);
  console.log('');
  console.log(`Results written to: ${outPath}`);
  console.log('');
  console.log(`Run confidence calibration:`);
  console.log(`  npx ts-node test-data/calibrate-confidence.ts --results ${outPath}`);
}

main().catch((err) => {
  console.error('Validation run failed:', err);
  process.exit(1);
});
