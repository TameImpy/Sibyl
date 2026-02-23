// Environment configuration with validation
export interface AppConfig {
  // AWS Region
  region: string;

  // DynamoDB
  tagsTableName: string;

  // SQS
  textProcessingQueueUrl: string;
  videoProcessingQueueUrl: string;
  dlqUrl: string;

  // Bedrock
  bedrockModelId: string;
  bedrockRegion: string;

  // RDS PostgreSQL
  rdsHost: string;
  rdsPort: number;
  rdsDatabase: string;
  rdsUsername: string;
  rdsPasswordSsmPath: string;

  // External APIs
  geminiApiKeySsmPath: string;
  geminiApiUrl: string;

  // Processing limits
  maxTagsPerContent: number;
  maxRetries: number;
  processingTimeoutMs: number;

  // Circuit breaker settings
  circuitBreakerThreshold: number;
  circuitBreakerTimeout: number;

  // Cost tracking
  costTrackingEnabled: boolean;
  costTableName: string;

  // Logging
  logLevel: string;
  enableStructuredLogging: boolean;

  // Feature flags
  enableVideoProcessing: boolean;
  enableTaxonomyCache: boolean;
  bedrockMockEnabled: boolean;
}

// Load config from environment with defaults for PoC
export function loadConfig(): AppConfig {
  return {
    region: process.env.AWS_REGION || 'us-east-1',

    // DynamoDB
    tagsTableName: process.env.TAGS_TABLE_NAME || 'content-tags',

    // SQS
    textProcessingQueueUrl: process.env.TEXT_QUEUE_URL || '',
    videoProcessingQueueUrl: process.env.VIDEO_QUEUE_URL || '',
    dlqUrl: process.env.DLQ_URL || '',

    // Bedrock - default to Claude Haiku for cost efficiency
    bedrockModelId:
      process.env.BEDROCK_MODEL_ID || 'amazon.titan-text-express-v1',
    bedrockRegion: process.env.BEDROCK_REGION || 'us-east-1',

    // RDS
    rdsHost: process.env.RDS_HOST || '',
    rdsPort: parseInt(process.env.RDS_PORT || '5432', 10),
    rdsDatabase: process.env.RDS_DATABASE || 'taxonomy',
    rdsUsername: process.env.RDS_USERNAME || 'taxonomy_user',
    rdsPasswordSsmPath: process.env.RDS_PASSWORD_SSM_PATH || '/tagging/rds/password',

    // External APIs
    geminiApiKeySsmPath: process.env.GEMINI_API_KEY_SSM_PATH || '/tagging/gemini/api-key',
    geminiApiUrl: process.env.GEMINI_API_URL || 'https://generativelanguage.googleapis.com',

    // Processing limits
    maxTagsPerContent: parseInt(process.env.MAX_TAGS_PER_CONTENT || '10', 10),
    maxRetries: parseInt(process.env.MAX_RETRIES || '3', 10),
    processingTimeoutMs: parseInt(process.env.PROCESSING_TIMEOUT_MS || '25000', 10),

    // Circuit breaker - open after 5 failures, reset after 60s
    circuitBreakerThreshold: parseInt(process.env.CIRCUIT_BREAKER_THRESHOLD || '5', 10),
    circuitBreakerTimeout: parseInt(process.env.CIRCUIT_BREAKER_TIMEOUT || '60000', 10),

    // Cost tracking
    costTrackingEnabled: process.env.COST_TRACKING_ENABLED === 'true',
    costTableName: process.env.COST_TABLE_NAME || 'processing-costs',

    // Logging
    logLevel: process.env.LOG_LEVEL || 'info',
    enableStructuredLogging: process.env.ENABLE_STRUCTURED_LOGGING !== 'false',

    // Feature flags
    enableVideoProcessing: process.env.ENABLE_VIDEO_PROCESSING === 'true',
    enableTaxonomyCache: process.env.ENABLE_TAXONOMY_CACHE !== 'false',
    bedrockMockEnabled: process.env.BEDROCK_MOCK_ENABLED === 'true',
  };
}

// Validate required config on startup
export function validateConfig(config: AppConfig): void {
  const required = [
    'tagsTableName',
    'textProcessingQueueUrl',
    'videoProcessingQueueUrl',
    'dlqUrl',
  ];

  const missing = required.filter((key) => !config[key as keyof AppConfig]);

  if (missing.length > 0) {
    throw new Error(`Missing required configuration: ${missing.join(', ')}`);
  }
}
