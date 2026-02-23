/**
 * Unit tests for the SQS handler (index.ts)
 *
 * Tests:
 *  - Cost tracking: cost_usd is calculated and stored in DynamoDB
 *  - Hallucination logging: warn is called when Claude returns an invalid tag
 *  - Valid tags: only taxonomy-valid tags reach DynamoDB
 *  - End-to-end happy path with mock mode enabled
 */

import { SQSEvent, Context } from 'aws-lambda';
const uuidv4 = () => crypto.randomUUID();

// ---------------------------------------------------------------------------
// Mocks (must be declared before any imports of the module under test)
// ---------------------------------------------------------------------------

const mockDynamoPut = jest.fn().mockResolvedValue({});
const mockBedrockSend = jest.fn();
const mockLoggerWarn = jest.fn();
const mockLoggerInfo = jest.fn();
const mockLoggerError = jest.fn();
const mockLoggerDebug = jest.fn();

jest.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: jest.fn().mockImplementation(() => ({ send: mockBedrockSend })),
  InvokeModelCommand: jest.fn(),
}));

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockReturnValue({ send: mockDynamoPut }),
  },
  PutCommand: jest.fn().mockImplementation((input) => input),
}));

jest.mock('../../../shared/utils/taxonomy-loader', () => ({
  formatTaxonomyForPrompt: jest.fn(() => 'FOOD: bread-baking, sourdough-bread'),
  validateTags: jest.fn((tags: string[]) => {
    const valid = new Set(['bread-baking', 'sourdough-bread', 'grilling-recipes']);
    return {
      valid: tags.filter((t) => valid.has(t)),
      invalid: tags.filter((t) => !valid.has(t)),
    };
  }),
}));

jest.mock('../../../shared/utils', () => ({
  getLogger: jest.fn(() => ({
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: mockLoggerError,
    debug: mockLoggerDebug,
    setContext: jest.fn(),
    clearContext: jest.fn(),
  })),
  setLambdaContext: jest.fn(),
  getCircuitBreaker: jest.fn(() => ({
    execute: jest.fn((fn: () => unknown) => fn()),
  })),
  retryWithBackoff: jest.fn((fn: () => unknown) => fn()),
  getMetricsCollector: jest.fn(() => ({
    trackProcessing: jest.fn().mockResolvedValue(undefined),
  })),
  MetricsCollector: {
    calculateCost: jest.fn().mockReturnValue(0.0042),
  },
}));

jest.mock('../../../shared/config', () => ({
  loadConfig: jest.fn(() => ({
    region: 'us-east-1',
    tagsTableName: 'content-tags-test',
    textProcessingQueueUrl: 'https://sqs.test',
    videoProcessingQueueUrl: 'https://sqs.test',
    dlqUrl: 'https://sqs.test',
    bedrockModelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    bedrockRegion: 'us-east-1',
    maxTagsPerContent: 10,
    circuitBreakerThreshold: 5,
    circuitBreakerTimeout: 60000,
    costTrackingEnabled: true,
    costTableName: 'costs-test',
    logLevel: 'info',
    enableStructuredLogging: true,
    bedrockMockEnabled: true, // Use mock mode for all tests
    rdsHost: '',
    rdsPort: 5432,
    rdsDatabase: '',
    rdsUsername: '',
    rdsPasswordSsmPath: '',
    geminiApiKeySsmPath: '',
    geminiApiUrl: '',
    maxRetries: 3,
    processingTimeoutMs: 25000,
    enableVideoProcessing: false,
    enableTaxonomyCache: true,
  })),
  validateConfig: jest.fn(),
}));

// Mock bedrock-client to control tags returned (including an invalid one)
jest.mock('../bedrock-client', () => ({
  invokeClaudeForTagging: jest.fn().mockResolvedValue({
    tags: [
      { tag: 'bread-baking', confidence: 0.95 },
      { tag: 'sourdough-bread', confidence: 0.88 },
      { tag: 'hallucinated-invalid-tag', confidence: 0.75 },
    ],
    inputTokens: 120,
    outputTokens: 45,
  }),
}));

// Mock prompts to avoid taxonomy file dependency
jest.mock('../prompts', () => ({
  buildTaggingPrompt: jest.fn(() => ({
    system: 'You are a tagging system.',
    userMessage: 'Tag this content.',
  })),
  truncateBodyText: jest.fn((text: string) => text),
  MAX_BODY_CHARS: 32000,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSQSEvent(contentText: string, contentType = 'article'): SQSEvent {
  const payload = {
    content: {
      content_id: uuidv4(),
      content_type: contentType,
      content_text: contentText,
      metadata: { title: 'Test Article' },
    },
    attempt: 1,
    max_attempts: 3,
    trace_id: uuidv4(),
  };
  return {
    Records: [{ body: JSON.stringify(payload) } as any],
  };
}

const mockContext = {
  awsRequestId: 'test-request-id',
  functionName: 'test-function',
  functionVersion: '$LATEST',
} as unknown as Context;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SQS handler (index.ts)', () => {
  let handler: SQSHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    handler = require('../index').handler;
  });

  it('processes a valid SQS record without throwing', async () => {
    const event = makeSQSEvent('How to bake sourdough bread at home.');
    await expect(handler(event, mockContext, jest.fn())).resolves.not.toThrow();
  });

  it('writes item to DynamoDB with cost_usd and token_count', async () => {
    const event = makeSQSEvent('How to bake sourdough bread at home.');
    await handler(event, mockContext, jest.fn());

    expect(mockDynamoPut).toHaveBeenCalledTimes(1); // tags table write
    const tagsCall = mockDynamoPut.mock.calls[0];
    const item = tagsCall[0].Item;
    expect(item).toHaveProperty('processing_metadata');
    expect(item.processing_metadata).toHaveProperty('cost_usd');
    expect(typeof item.processing_metadata.cost_usd).toBe('number');
    expect(item.processing_metadata).toHaveProperty('token_count');
  });

  it('logs a hallucination warning when Claude returns an invalid tag', async () => {
    const event = makeSQSEvent('Sourdough bread baking guide.');
    await handler(event, mockContext, jest.fn());

    const warnCalls = mockLoggerWarn.mock.calls;
    const hallucinationLog = warnCalls.find((args) =>
      typeof args[0] === 'string' && args[0].includes('HALLUCINATION')
    );
    expect(hallucinationLog).toBeDefined();
    expect(hallucinationLog[1]).toHaveProperty('invalid_tags');
    expect(hallucinationLog[1].invalid_tags).toContain('hallucinated-invalid-tag');
  });

  it('only stores valid taxonomy tags in DynamoDB (invalid tags filtered)', async () => {
    const event = makeSQSEvent('Sourdough bread baking guide.');
    await handler(event, mockContext, jest.fn());

    const tagsCall = mockDynamoPut.mock.calls.find((call) =>
      call[0]?.TableName === 'content-tags-test'
    );
    const storedTags = tagsCall[0].Item.tags as Array<{ tag: string }>;
    const tagNames = storedTags.map((t) => t.tag);

    expect(tagNames).toContain('bread-baking');
    expect(tagNames).toContain('sourdough-bread');
    expect(tagNames).not.toContain('hallucinated-invalid-tag');
  });
});

// Needed for type import
import type { SQSHandler } from 'aws-lambda';
