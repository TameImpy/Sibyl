import { SQSEvent, SQSHandler, Context } from 'aws-lambda';
import axios from 'axios';
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
} from '../../shared/utils';
import { loadConfig, validateConfig } from '../../shared/config';

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
 * Video Processor Lambda
 *
 * Processes video content using Gemini API (external)
 * Note: This is a placeholder for video processing. In production:
 * - Consider using ECS for long-running video processing tasks
 * - Implement proper video transcription/analysis pipeline
 * - Add multimodal analysis capabilities
 *
 * Implements same operational patterns as text processor:
 * - Circuit breaker for external API
 * - Retry with exponential backoff
 * - Cost tracking
 * - Structured logging
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
  // In production with ECS, you can parallelize
  for (const record of event.Records) {
    try {
      await processRecord(record.body);
    } catch (error) {
      logger.error('Failed to process video record', {}, error as Error);
      // Continue processing other records
    }
  }

  logger.info('Video processor completed');
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

    logger.info('Processing video content', {
      title: content.metadata?.title,
      duration_seconds: content.metadata?.duration_seconds,
    });

    // Call Gemini API with circuit breaker and retry
    const tags = await tagVideoWithGemini(content);

    // Store results in DynamoDB
    await storeResults(content, tags, startTime);

    // Track metrics
    await trackMetrics(content, tags, startTime, 'completed');

    logger.info('Video content processed successfully', {
      tag_count: tags.length,
      processing_time_ms: Date.now() - startTime,
    });
  } catch (error) {
    const processingTimeMs = Date.now() - startTime;
    logger.error('Failed to process video content', { processing_time_ms: processingTimeMs }, error as Error);

    if (content!) {
      await trackMetrics(content, [], startTime, 'failed', (error as Error).message);
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

async function tagVideoWithGemini(content: ContentInput): Promise<TagResult[]> {
  const apiKey = await getGeminiApiKey();
  const maxTags = content.processing_config?.max_tags || config.maxTagsPerContent;

  // Build prompt for Gemini
  const prompt = buildVideoTaggingPrompt(content, maxTags);

  // Execute with circuit breaker and retry
  const response = await geminiCircuitBreaker.execute(async () => {
    return await retryWithBackoff(
      async () => {
        // Gemini API call (placeholder - adjust based on actual API)
        const apiResponse = await axios.post(
          `${config.geminiApiUrl}/v1/models/gemini-1.5-flash:generateContent`,
          {
            contents: [
              {
                parts: [
                  {
                    text: prompt,
                  },
                  // In production, include video data here
                  // { video: { data: base64Video } }
                ],
              },
            ],
            generationConfig: {
              temperature: 0.3,
              maxOutputTokens: 2048,
            },
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': apiKey,
            },
            timeout: 30000,
          }
        );

        return apiResponse.data;
      },
      {
        maxAttempts: 3,
        initialDelayMs: 2000,
        retryableErrors: ['ECONNRESET', 'ETIMEDOUT', 'NetworkError'],
      },
      { content_id: content.content_id }
    );
  });

  const tags = parseGeminiResponse(response);

  logger.debug('Gemini video tagging completed', {
    tag_count: tags.length,
  });

  return tags;
}

function buildVideoTaggingPrompt(content: ContentInput, maxTags: number): string {
  return `You are an expert video content tagging system. Analyze this video and return the ${maxTags} most relevant tags.

Video metadata:
- Title: ${content.metadata?.title || 'Unknown'}
- Duration: ${content.metadata?.duration_seconds || 0} seconds
- Source: ${content.metadata?.source || 'Unknown'}

Requirements:
1. Return ONLY tags that exist in the standard taxonomy
2. Provide a confidence score (0-1) for each tag
3. Return exactly ${maxTags} tags, ranked by relevance
4. Format: JSON array of objects with "tag", "confidence", and brief "reasoning"

Return ONLY the JSON array, no additional text.`;
}

function parseGeminiResponse(responseBody: unknown): TagResult[] {
  // Parse Gemini's response format
  const candidates = (responseBody as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }).candidates;
  if (!candidates?.[0]?.content?.parts?.[0]?.text) {
    throw new Error('Invalid Gemini response format');
  }

  const text = candidates[0].content.parts[0].text;

  // Extract JSON from response
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error('No JSON array found in Gemini response');
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
          model_used: 'gemini-1.5-flash',
          processing_time_ms: processingTimeMs,
          retry_count: 0,
        },
        created_at: now,
        updated_at: now,
        ttl: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
      },
    })
  );
}

async function trackMetrics(
  content: ContentInput,
  _tags: TagResult[],
  startTime: number,
  status: string,
  errorMessage?: string
): Promise<void> {
  await metricsCollector.trackProcessing({
    content_id: content.content_id,
    content_type: content.content_type,
    model_used: 'gemini-1.5-flash',
    processing_time_ms: Date.now() - startTime,
    status,
    timestamp: new Date().toISOString(),
    error_type: errorMessage,
  });
}
