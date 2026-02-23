/**
 * Bedrock client for Claude-based content tagging.
 *
 * Responsibilities:
 *  - Construct the InvokeModelCommand for Claude via the Bedrock Messages API
 *  - Parse Claude's response into TagResult[]
 *  - Short-circuit only the API call when mock mode is enabled
 *    (prompt construction, taxonomy validation, cost tracking all still run)
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { TagResult } from '../../shared/types';
import { getLogger } from '../../shared/utils';

const logger = getLogger();

export interface BedrockTaggingResult {
  tags: TagResult[];
  inputTokens: number;
  outputTokens: number;
}

/**
 * Synthetic mock response.
 *
 * Intentionally includes one invalid tag ('mock-hallucinated-tag') so that
 * hallucination detection logging is exercised when mock mode is enabled.
 * Valid tags are real taxonomy entries so the happy path also runs.
 */
const MOCK_RESPONSE: BedrockTaggingResult = {
  tags: [
    { tag: 'bread-baking', confidence: 0.95, reasoning: 'Mock response' },
    { tag: 'sourdough-bread', confidence: 0.87, reasoning: 'Mock response' },
    { tag: 'mock-hallucinated-tag', confidence: 0.75, reasoning: 'Mock response — intentionally invalid tag for hallucination-logging test' },
  ],
  inputTokens: 120,
  outputTokens: 45,
};

/**
 * Invoke Claude via Bedrock to generate taxonomy tags for content.
 *
 * @param client       BedrockRuntimeClient instance.
 * @param modelId      Claude model ID (e.g. 'anthropic.claude-3-5-sonnet-20241022-v2:0').
 * @param system       Layer 1 system prompt from prompts.ts.
 * @param userMessage  Layers 2+3 user message from prompts.ts.
 * @param mockEnabled  When true, returns MOCK_RESPONSE without calling the API.
 */
export async function invokeClaudeForTagging(
  client: BedrockRuntimeClient,
  modelId: string,
  system: string,
  userMessage: string,
  mockEnabled: boolean
): Promise<BedrockTaggingResult> {
  if (mockEnabled) {
    logger.warn('Bedrock mock mode enabled — returning synthetic Claude response (API call skipped)');
    return MOCK_RESPONSE;
  }

  const payload = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 1024,
    temperature: 0.3,
    system,
    messages: [
      {
        role: 'user',
        content: userMessage,
      },
    ],
  };

  const command = new InvokeModelCommand({
    modelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(payload),
  });

  const response = await client.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body)) as ClaudeResponseBody;

  logger.debug('Bedrock Claude response received', {
    stop_reason: responseBody.stop_reason,
    input_tokens: responseBody.usage?.input_tokens,
    output_tokens: responseBody.usage?.output_tokens,
  });

  const tags = parseClaudeResponse(responseBody);

  return {
    tags,
    inputTokens: responseBody.usage?.input_tokens ?? 0,
    outputTokens: responseBody.usage?.output_tokens ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

interface ClaudeResponseBody {
  content?: Array<{ type: string; text?: string }>;
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

function parseClaudeResponse(responseBody: ClaudeResponseBody): TagResult[] {
  const contentBlock = responseBody.content?.[0];

  if (!contentBlock || contentBlock.type !== 'text' || !contentBlock.text) {
    throw new Error('Unexpected Claude response: missing text content block');
  }

  const text = contentBlock.text.trim();

  // Claude may wrap JSON in markdown code blocks — handle both cases
  const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/) ?? text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Could not extract JSON from Claude response');
  }

  const jsonText = jsonMatch[1] ?? jsonMatch[0];
  const parsed = JSON.parse(jsonText) as {
    tags?: Array<{ tag: string; confidence: number; reasoning?: string }>;
  };

  if (!Array.isArray(parsed.tags)) {
    throw new Error('Invalid Claude response structure: expected tags array');
  }

  return parsed.tags.map((t) => ({
    tag: t.tag,
    confidence: t.confidence,
    reasoning: t.reasoning,
  }));
}
