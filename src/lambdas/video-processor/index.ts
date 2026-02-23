import { SQSEvent, SQSHandler, Context } from 'aws-lambda';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import {
  ContentInput,
  ProcessingStatus,
  SQSMessagePayload,
  SQSMessagePayloadSchema,
  TagResult,
} from '../../shared/types';
import {
  getLogger,
  setLambdaContext,
  getCircuitBreaker,
  retryWithBackoff,
  getMetricsCollector,
  MetricsCollector,
} from '../../shared/utils';
import { loadConfig, validateConfig } from '../../shared/config';
import { validateTags, formatTaxonomyForPrompt } from '../../shared/utils/taxonomy-loader';
import { routeContent, RoutingDecision } from '../../shared/utils/routing';
import { validateVideoFormat, sampleFrames, aggregateFrameTags } from './frame-aggregator';
import { invokeGeminiForTagging } from './gemini-client';

const logger = getLogger();
const config = loadConfig();
validateConfig(config);

const ssmClient = new SSMClient({});
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const metricsCollector = getMetricsCollector();
const geminiCircuitBreaker = getCircuitBreaker('gemini', {
  failureThreshold: config.circuitBreakerThreshold,
  timeout: config.circuitBreakerTimeout,
});

// Cache API key to avoid repeated SSM calls
let cachedGeminiApiKey: string | null = null;

/**
 * Video Processor Lambda — SQS entry point
 *
 * Processes video content using Google Gemini API. Implements:
 *  - Frame sampling at configurable interval (default: 1 frame/15 seconds)
 *  - Per-frame tagging via Gemini (or placeholder mock)
 *  - Frame aggregation to video-level tags (≥20% frame appearance threshold)
 *  - Taxonomy validation with hallucination logging
 *  - Confidence-based routing: ≥85% auto-publish, <85% → review queue
 *  - Cost tracking (tokens → USD via MetricsCollector.calculateCost)
 *  - Circuit breaker + retry with exponential backoff
 *  - Structured logging for CloudWatch Insights
 */
export const handler: SQSHandler = async (event: SQSEvent, context: Context): Promise<void> => {
  setLambdaContext(context.awsRequestId, context.functionName, context.functionVersion);

  if (!config.enableVideoProcessing) {
    logger.warn('Video processing is disabled, skipping');
    return;
  }

  logger.info('Video processor started', {
    record_count: event.Records.length,
  });

  // Process videos sequentially to avoid overwhelming Gemini API
  for (const record of event.Records) {
    try {
      await processRecord(record.body);
    } catch (error) {
      logger.error('Failed to process video record', {}, error as Error);
      // Continue processing other records; SQS handles individual retries
    }
  }

  logger.info('Video processor completed');
};

async function processRecord(messageBody: string): Promise<void> {
  const startTime = Date.now();
  let content: ContentInput;
  let traceId: string;

  try {
    const payload: SQSMessagePayload = SQSMessagePayloadSchema.parse(JSON.parse(messageBody));
    content = payload.content;
    traceId = payload.trace_id;

    logger.setContext({
      trace_id: traceId,
      content_id: content.content_id,
      content_type: content.content_type,
      attempt: payload.attempt,
    });

    logger.info('Processing video content', {
      title: content.metadata?.title,
      duration_seconds: content.metadata?.duration_seconds,
    });

    const { tags, inputTokens, outputTokens, costUsd } = await tagVideoWithGemini(content);

    // Confidence-based routing decision
    const routing = routeContent(tags, config.confidenceThreshold);

    logger.info('Content routing decision', {
      needs_review: routing.needs_review,
      routing_reason: routing.routing_reason,
      min_confidence: routing.min_confidence,
      confidence_threshold: routing.confidence_threshold,
    });

    await storeResults(content, tags, routing, startTime, inputTokens + outputTokens, costUsd);
    await trackMetrics(content, startTime, 'completed', inputTokens, outputTokens, costUsd);

    logger.info('Video content processed successfully', {
      tag_count: tags.length,
      needs_review: routing.needs_review,
      processing_time_ms: Date.now() - startTime,
      cost_usd: costUsd,
    });
  } catch (error) {
    const processingTimeMs = Date.now() - startTime;
    logger.error('Failed to process video content', { processing_time_ms: processingTimeMs }, error as Error);

    if (content!) {
      await trackMetrics(content, startTime, 'failed', 0, 0, 0, (error as Error).message);
    }

    throw error;
  } finally {
    logger.clearContext();
  }
}

async function getGeminiApiKey(): Promise<string> {
  if (cachedGeminiApiKey) {
    return cachedGeminiApiKey;
  }

  const response = await ssmClient.send(
    new GetParameterCommand({
      Name: config.geminiApiKeySsmPath,
      WithDecryption: true,
    })
  );

  if (!response.Parameter?.Value) {
    throw new Error('Gemini API key not found in SSM');
  }

  cachedGeminiApiKey = response.Parameter.Value;
  return cachedGeminiApiKey;
}

interface VideoTaggingResult {
  tags: TagResult[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

async function tagVideoWithGemini(content: ContentInput): Promise<VideoTaggingResult> {
  const maxTags = content.processing_config?.max_tags ?? config.maxTagsPerContent;
  const durationSeconds = content.metadata?.duration_seconds ?? 0;
  const title = content.metadata?.title ?? '';

  // Validate video format from URL
  if (content.content_url) {
    validateVideoFormat(content.content_url);
  }

  // Compute frame sample list
  const frames = sampleFrames(durationSeconds, config.frameSamplingInterval);

  logger.debug('Frame sampling complete', {
    frame_count: frames.length,
    duration_seconds: durationSeconds,
    interval_seconds: config.frameSamplingInterval,
  });

  // Skip SSM fetch in mock mode
  const apiKey = config.geminiMockEnabled ? '' : await getGeminiApiKey();
  const taxonomyText = formatTaxonomyForPrompt('grouped');

  // Call Gemini with circuit breaker + retry
  const { frameTags, inputTokens, outputTokens } = await geminiCircuitBreaker.execute(async () => {
    return await retryWithBackoff(
      async () =>
        invokeGeminiForTagging(
          apiKey,
          config.geminiApiUrl,
          frames,
          title,
          taxonomyText,
          maxTags,
          config.geminiMockEnabled
        ),
      {
        maxAttempts: 3,
        initialDelayMs: 2000,
        retryableErrors: ['ECONNRESET', 'ETIMEDOUT', 'NetworkError'],
      },
      { content_id: content.content_id }
    );
  });

  // Aggregate frame-level tags to video-level (≥20% frame appearance threshold)
  const rawTags = aggregateFrameTags(frameTags);

  // Taxonomy validation — detect hallucinated tags
  const tagNames = rawTags.map((t) => t.tag);
  const { valid: validTagNames, invalid: invalidTagNames } = validateTags(tagNames);

  if (invalidTagNames.length > 0) {
    logger.warn('HALLUCINATION DETECTED: Gemini returned tags not in taxonomy', {
      invalid_tags: invalidTagNames,
      content_id: content.content_id,
    });
  }

  const tags = rawTags.filter((t) => validTagNames.includes(t.tag));

  logger.debug('Taxonomy validation complete', {
    raw_tag_count: rawTags.length,
    valid_tag_count: tags.length,
    invalid_tag_count: invalidTagNames.length,
  });

  // Cost tracking (tokens → USD)
  const costUsd = MetricsCollector.calculateCost('gemini-1.5-flash', inputTokens, outputTokens);

  return { tags, inputTokens, outputTokens, costUsd };
}

async function storeResults(
  content: ContentInput,
  tags: TagResult[],
  routing: RoutingDecision,
  startTime: number,
  tokenCount: number,
  costUsd: number
): Promise<void> {
  const now = new Date().toISOString();
  const processingTimeMs = Date.now() - startTime;

  await dynamoClient.send(
    new PutCommand({
      TableName: config.tagsTableName,
      Item: {
        content_id: content.content_id,
        content_type: content.content_type,
        status: ProcessingStatus.COMPLETED,
        tags,
        needs_review: routing.needs_review,
        source: routing.source,
        reviewed: routing.reviewed,
        routing_metadata: {
          routing_reason: routing.routing_reason,
          confidence_threshold: routing.confidence_threshold,
          min_confidence: routing.min_confidence,
        },
        processing_metadata: {
          model_used: 'gemini-1.5-flash',
          processing_time_ms: processingTimeMs,
          token_count: tokenCount,
          cost_usd: costUsd,
          retry_count: 0,
        },
        created_at: now,
        updated_at: now,
        ttl: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60, // 1 year retention
      },
    })
  );
}

async function trackMetrics(
  content: ContentInput,
  startTime: number,
  status: string,
  inputTokens: number,
  outputTokens: number,
  costUsd: number,
  errorMessage?: string
): Promise<void> {
  await metricsCollector.trackProcessing({
    content_id: content.content_id,
    content_type: content.content_type,
    model_used: 'gemini-1.5-flash',
    processing_time_ms: Date.now() - startTime,
    token_count: inputTokens + outputTokens,
    cost_usd: costUsd,
    status,
    timestamp: new Date().toISOString(),
    error_type: errorMessage,
  });
}
