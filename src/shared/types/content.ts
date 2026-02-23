import { z } from 'zod';

// Content types supported by the system
export enum ContentType {
  ARTICLE = 'article',
  PODCAST = 'podcast',
  VIDEO = 'video',
  JSON = 'json',
}

// Processing status
export enum ProcessingStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  RETRY = 'retry',
}

// Content input schema - what we receive from external systems
export const ContentInputSchema = z.object({
  content_id: z.string().uuid(),
  content_type: z.nativeEnum(ContentType),
  content_url: z.string().url().optional(), // S3 URL or external URL
  content_text: z.string().optional(), // For pre-transcribed or short content
  metadata: z
    .object({
      title: z.string().optional(),
      author: z.string().optional(),
      published_date: z.string().datetime().optional(),
      duration_seconds: z.number().optional(),
      source: z.string().optional(),
    })
    .optional(),
  processing_config: z
    .object({
      priority: z.enum(['low', 'normal', 'high']).default('normal'),
      model_preference: z.enum(['haiku', 'sonnet', 'gemini']).optional(),
      max_tags: z.number().min(1).max(50).default(10),
    })
    .optional(),
});

export type ContentInput = z.infer<typeof ContentInputSchema>;

// Tag result from AI model
export const TagResultSchema = z.object({
  tag: z.string(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().optional(),
});

export type TagResult = z.infer<typeof TagResultSchema>;

// Processing result stored in DynamoDB
export const ProcessingResultSchema = z.object({
  content_id: z.string().uuid(),
  content_type: z.nativeEnum(ContentType),
  status: z.nativeEnum(ProcessingStatus),
  tags: z.array(TagResultSchema),
  processing_metadata: z.object({
    model_used: z.string(),
    processing_time_ms: z.number(),
    token_count: z.number().optional(),
    cost_usd: z.number().optional(),
    retry_count: z.number().default(0),
    error_message: z.string().optional(),
  }),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  ttl: z.number().optional(), // Unix timestamp for DynamoDB TTL
});

export type ProcessingResult = z.infer<typeof ProcessingResultSchema>;

// SQS message payload
export const SQSMessagePayloadSchema = z.object({
  content: ContentInputSchema,
  attempt: z.number().default(1),
  max_attempts: z.number().default(3),
  trace_id: z.string().uuid(),
});

export type SQSMessagePayload = z.infer<typeof SQSMessagePayloadSchema>;
