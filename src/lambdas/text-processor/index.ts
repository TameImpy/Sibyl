import { SQSEvent, SQSHandler, Context } from 'aws-lambda';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import {
  ContentInput,
  ProcessingStatus,
  SQSMessagePayload,
  SQSMessagePayloadSchema,
  TagResult,
  ContentType,
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
 * Text Processor Lambda
 *
 * Processes text content (articles, JSON, podcasts) using Claude on Amazon Bedrock
 * Implements:
 * - Circuit breaker pattern for Bedrock API
 * - Retry with exponential backoff
 * - Cost tracking
 * - Structured logging
 */
export const handler: SQSHandler = async (event: SQSEvent, context: Context): Promise<void> => {
  setLambdaContext(context.awsRequestId, context.functionName, context.functionVersion);

  logger.info('Text processor started', {
    record_count: event.Records.length,
  });

  // Process messages in parallel (but respect Lambda concurrency limits)
  const results = await Promise.allSettled(
    event.Records.map((record) => processRecord(record.body))
  );

  // Log summary
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
    // Parse and validate message
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

    // Get content text (from payload or fetch from S3 if URL provided)
    const contentText = await getContentText(content);

    // Call Bedrock with circuit breaker and retry
    const tags = await tagContentWithBedrock(contentText, content);

    // Store results in DynamoDB
    await storeResults(content, tags, startTime);

    // Track metrics
    await trackMetrics(content, tags, startTime, 'completed');

    logger.info('Text content processed successfully', {
      tag_count: tags.length,
      processing_time_ms: Date.now() - startTime,
    });
  } catch (error) {
    const processingTimeMs = Date.now() - startTime;
    logger.error('Failed to process text content', { processing_time_ms: processingTimeMs }, error as Error);

    // Track failure metrics
    if (content!) {
      await trackMetrics(content, [], startTime, 'failed', (error as Error).message);
    }

    // Re-throw to trigger SQS retry/DLQ
    throw error;
  } finally {
    logger.clearContext();
  }
}

async function getContentText(content: ContentInput): Promise<string> {
  // For PoC, assume text is in content_text field
  // In production, fetch from S3 if content_url is provided
  if (content.content_text) {
    return content.content_text;
  }

  if (content.content_url) {
    // TODO: Implement S3 fetch
    throw new Error('S3 content fetching not yet implemented');
  }

  throw new Error('No content text or URL provided');
}

async function tagContentWithBedrock(
  contentText: string,
  content: ContentInput
): Promise<TagResult[]> {
  const maxTags = content.processing_config?.max_tags || config.maxTagsPerContent;

  // Mock mode: bypass Bedrock entirely while account access is pending
  if (config.bedrockMockEnabled) {
    logger.warn('Bedrock mock mode enabled — returning synthetic tags');
    return [
      { tag: 'mock-tag-1', confidence: 0.95, reasoning: 'Mock response' },
      { tag: 'mock-tag-2', confidence: 0.85, reasoning: 'Mock response' },
      { tag: 'mock-tag-3', confidence: 0.75, reasoning: 'Mock response' },
    ];
  }

  // Build prompt for Claude
  const prompt = buildTaggingPrompt(contentText, maxTags, content.content_type);

  // Execute with circuit breaker and retry
  const response = await bedrockCircuitBreaker.execute(async () => {
    return await retryWithBackoff(
      async () => {
        const command = new InvokeModelCommand({
          modelId: config.bedrockModelId,
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({
            inputText: prompt,
            textGenerationConfig: {
              maxTokenCount: 2048,
              temperature: 0.3,
              topP: 0.9,
            },
          }),
        });

        return await bedrockClient.send(command);
      },
      {
        maxAttempts: 3,
        initialDelayMs: 1000,
        retryableErrors: ['ThrottlingException', 'ServiceUnavailable'],
      },
      { content_id: content.content_id, model: config.bedrockModelId }
    );
  });

  // Parse response
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  const tags = parseBedrockResponse(responseBody);

  logger.debug('Bedrock tagging completed', {
    input_tokens: responseBody.inputTextTokenCount,
    output_tokens: responseBody.results?.[0]?.tokenCount,
    tag_count: tags.length,
  });

  return tags;
}

function buildTaggingPrompt(contentText: string, maxTags: number, contentType: ContentType): string {
  return `You are an expert content tagging system. Analyze the following ${contentType} content and return the ${maxTags} most relevant tags from the provided taxonomy.

Content to analyze:
${contentText.substring(0, 10000)} ${contentText.length > 10000 ? '...(truncated)' : ''}

Requirements:
1. Return ONLY tags that exist in the taxonomy (no custom tags)
2. Provide a confidence score (0-1) for each tag
3. Return exactly ${maxTags} tags, ranked by relevance
4. Format: JSON array of objects with "tag", "confidence", and brief "reasoning"

Example response format:
[
  {
    "tag": "slow-cooker-meals",
    "confidence": 0.95,
    "reasoning": "Article focuses on slow cooker recipes and techniques"
  }
]

Return ONLY the JSON array, no additional text.`;
}

function parseBedrockResponse(responseBody: unknown): TagResult[] {
  // Parse Titan's response and extract tags
  // Titan returns { results: [{ outputText: "..." }], inputTextTokenCount: N }
  const results = (responseBody as { results?: Array<{ outputText?: string }> }).results;
  if (!results?.[0]?.outputText) {
    throw new Error('Invalid Bedrock response format');
  }

  const text = results[0].outputText;

  // Extract JSON from response (Claude might add explanation text)
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error('No JSON array found in Bedrock response');
  }

  const tags = JSON.parse(jsonMatch[0]) as TagResult[];
  return tags;
}

async function storeResults(
  content: ContentInput,
  tags: TagResult[],
  startTime: number
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
  tags: TagResult[],
  startTime: number,
  status: string,
  errorMessage?: string
): Promise<void> {
  await metricsCollector.trackProcessing({
    content_id: content.content_id,
    content_type: content.content_type,
    model_used: config.bedrockModelId,
    processing_time_ms: Date.now() - startTime,
    status,
    timestamp: new Date().toISOString(),
    error_type: errorMessage,
  });
}
