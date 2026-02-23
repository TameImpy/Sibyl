import { SQSEvent, SQSHandler, Context } from 'aws-lambda';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
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
import { buildTaggingPrompt } from './prompts';
import { invokeClaudeForTagging } from './bedrock-client';

const logger = getLogger();
const config = loadConfig();
validateConfig(config);

const bedrockClient = new BedrockRuntimeClient({ region: config.bedrockRegion });
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const metricsCollector = getMetricsCollector();
const bedrockCircuitBreaker = getCircuitBreaker('bedrock', {
  failureThreshold: config.circuitBreakerThreshold,
  timeout: config.circuitBreakerTimeout,
});

/**
 * Text Processor Lambda — SQS entry point
 *
 * Processes text content (articles, JSON records, podcasts) using Claude on
 * Amazon Bedrock. Implements:
 *  - Three-layer prompt architecture (prompts.ts)
 *  - Taxonomy validation with hallucination logging
 *  - Cost tracking (tokens → USD via MetricsCollector.calculateCost)
 *  - Circuit breaker + retry with exponential backoff
 *  - Structured logging for CloudWatch Insights
 */
export const handler: SQSHandler = async (event: SQSEvent, context: Context): Promise<void> => {
  setLambdaContext(context.awsRequestId, context.functionName, context.functionVersion);

  logger.info('Text processor started', {
    record_count: event.Records.length,
  });

  const results = await Promise.allSettled(
    event.Records.map((record) => processRecord(record.body))
  );

  const successful = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.filter((r) => r.status === 'rejected').length;

  logger.info('Text processor completed', {
    total: results.length,
    successful,
    failed,
  });
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

    logger.info('Processing text content', {
      title: content.metadata?.title,
    });

    const contentText = await getContentText(content);
    const { tags, inputTokens, outputTokens, costUsd } = await tagContentWithClaude(contentText, content);

    await storeResults(content, tags, startTime, inputTokens + outputTokens, costUsd);
    await trackMetrics(content, tags, startTime, 'completed', inputTokens, outputTokens, costUsd);

    logger.info('Text content processed successfully', {
      tag_count: tags.length,
      processing_time_ms: Date.now() - startTime,
      cost_usd: costUsd,
    });
  } catch (error) {
    const processingTimeMs = Date.now() - startTime;
    logger.error('Failed to process text content', { processing_time_ms: processingTimeMs }, error as Error);

    if (content!) {
      await trackMetrics(content, [], startTime, 'failed', 0, 0, 0, (error as Error).message);
    }

    throw error;
  } finally {
    logger.clearContext();
  }
}

async function getContentText(content: ContentInput): Promise<string> {
  if (content.content_text) {
    return content.content_text;
  }

  if (content.content_url) {
    // TODO: Implement S3 fetch for Phase 1
    throw new Error('S3 content fetching not yet implemented');
  }

  throw new Error('No content text or URL provided');
}

interface TaggingResult {
  tags: TagResult[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

async function tagContentWithClaude(
  contentText: string,
  content: ContentInput
): Promise<TaggingResult> {
  const maxTags = content.processing_config?.max_tags ?? config.maxTagsPerContent;
  const title = content.metadata?.title ?? '';

  // Build three-layer prompt (runs even in mock mode)
  const taxonomyText = formatTaxonomyForPrompt('grouped');
  const { system, userMessage } = buildTaggingPrompt(
    content.content_type,
    title,
    contentText,
    taxonomyText,
    maxTags
  );

  logger.debug('Prompt layers constructed', {
    system_length: system.length,
    user_message_length: userMessage.length,
    body_truncated: contentText.length > 32_000,
  });

  // Call Claude via circuit breaker + retry (mock short-circuits the API call only)
  const { tags: rawTags, inputTokens, outputTokens } = await bedrockCircuitBreaker.execute(async () => {
    return await retryWithBackoff(
      async () =>
        invokeClaudeForTagging(
          bedrockClient,
          config.bedrockModelId,
          system,
          userMessage,
          config.bedrockMockEnabled
        ),
      {
        maxAttempts: 3,
        initialDelayMs: 1000,
        retryableErrors: ['ThrottlingException', 'ServiceUnavailable'],
      },
      { content_id: content.content_id, model: config.bedrockModelId }
    );
  });

  // Taxonomy validation — detect hallucinated tags
  const tagNames = rawTags.map((t) => t.tag);
  const { valid: validTagNames, invalid: invalidTagNames } = validateTags(tagNames);

  if (invalidTagNames.length > 0) {
    logger.warn('HALLUCINATION DETECTED: Claude returned tags not in taxonomy', {
      invalid_tags: invalidTagNames,
      content_id: content.content_id,
      model: config.bedrockModelId,
    });
  }

  // Keep only valid taxonomy tags in the final result
  const tags = rawTags.filter((t) => validTagNames.includes(t.tag));

  logger.debug('Taxonomy validation complete', {
    raw_tag_count: rawTags.length,
    valid_tag_count: tags.length,
    invalid_tag_count: invalidTagNames.length,
  });

  // Cost tracking (tokens → USD)
  const costUsd = MetricsCollector.calculateCost(config.bedrockModelId, inputTokens, outputTokens);

  return { tags, inputTokens, outputTokens, costUsd };
}

async function storeResults(
  content: ContentInput,
  tags: TagResult[],
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
        processing_metadata: {
          model_used: config.bedrockModelId,
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
  _tags: TagResult[],
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
    model_used: config.bedrockModelId,
    processing_time_ms: Date.now() - startTime,
    token_count: inputTokens + outputTokens,
    cost_usd: costUsd,
    status,
    timestamp: new Date().toISOString(),
    error_type: errorMessage,
  });
}
