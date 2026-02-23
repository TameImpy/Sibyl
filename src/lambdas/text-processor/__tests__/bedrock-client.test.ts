/**
 * Unit tests for bedrock-client.ts
 */

import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { invokeClaudeForTagging } from '../bedrock-client';

jest.mock('@aws-sdk/client-bedrock-runtime');

const MODEL_ID = 'anthropic.claude-3-5-sonnet-20241022-v2:0';
const SYSTEM = 'You are a tagging system.';
const USER_MSG = 'Tag this content about baking.';

describe('invokeClaudeForTagging — mock mode', () => {
  it('returns synthetic tags without calling the API', async () => {
    const mockClient = new BedrockRuntimeClient({}) as jest.Mocked<BedrockRuntimeClient>;
    (mockClient.send as jest.Mock) = jest.fn();

    const result = await invokeClaudeForTagging(mockClient, MODEL_ID, SYSTEM, USER_MSG, true);

    expect(mockClient.send).not.toHaveBeenCalled();
    expect(Array.isArray(result.tags)).toBe(true);
    expect(result.tags.length).toBeGreaterThan(0);
    expect(typeof result.inputTokens).toBe('number');
    expect(typeof result.outputTokens).toBe('number');
  });

  it('mock response includes an intentionally invalid tag for hallucination testing', async () => {
    const mockClient = new BedrockRuntimeClient({}) as jest.Mocked<BedrockRuntimeClient>;
    (mockClient.send as jest.Mock) = jest.fn();

    const result = await invokeClaudeForTagging(mockClient, MODEL_ID, SYSTEM, USER_MSG, true);

    const tagNames = result.tags.map((t) => t.tag);
    expect(tagNames).toContain('mock-hallucinated-tag');
  });

  it('mock response includes valid taxonomy tags', async () => {
    const mockClient = new BedrockRuntimeClient({}) as jest.Mocked<BedrockRuntimeClient>;
    (mockClient.send as jest.Mock) = jest.fn();

    const result = await invokeClaudeForTagging(mockClient, MODEL_ID, SYSTEM, USER_MSG, true);

    const tagNames = result.tags.map((t) => t.tag);
    expect(tagNames).toContain('bread-baking');
  });
});

describe('invokeClaudeForTagging — live mode (API call)', () => {
  function buildClaudeResponse(tags: Array<{ tag: string; confidence: number }>) {
    return {
      body: new TextEncoder().encode(
        JSON.stringify({
          content: [
            {
              type: 'text',
              text: JSON.stringify({ tags }),
            },
          ],
          stop_reason: 'end_turn',
          usage: { input_tokens: 300, output_tokens: 40 },
        })
      ),
    };
  }

  it('calls the API and returns parsed tags with token counts', async () => {
    const mockClient = new BedrockRuntimeClient({}) as jest.Mocked<BedrockRuntimeClient>;
    (mockClient.send as jest.Mock) = jest.fn().mockResolvedValue(
      buildClaudeResponse([
        { tag: 'bread-baking', confidence: 0.95 },
        { tag: 'sourdough-bread', confidence: 0.88 },
      ])
    );

    const result = await invokeClaudeForTagging(mockClient, MODEL_ID, SYSTEM, USER_MSG, false);

    expect(mockClient.send).toHaveBeenCalledTimes(1);
    expect(result.tags).toHaveLength(2);
    expect(result.tags[0].tag).toBe('bread-baking');
    expect(result.tags[0].confidence).toBe(0.95);
    expect(result.inputTokens).toBe(300);
    expect(result.outputTokens).toBe(40);
  });

  it('parses JSON wrapped in markdown code fences', async () => {
    const mockClient = new BedrockRuntimeClient({}) as jest.Mocked<BedrockRuntimeClient>;
    (mockClient.send as jest.Mock) = jest.fn().mockResolvedValue({
      body: new TextEncoder().encode(
        JSON.stringify({
          content: [
            {
              type: 'text',
              text: '```json\n{"tags":[{"tag":"grilling-recipes","confidence":0.9}]}\n```',
            },
          ],
          stop_reason: 'end_turn',
          usage: { input_tokens: 100, output_tokens: 20 },
        })
      ),
    });

    const result = await invokeClaudeForTagging(mockClient, MODEL_ID, SYSTEM, USER_MSG, false);

    expect(result.tags[0].tag).toBe('grilling-recipes');
  });

  it('throws when response has no text content block', async () => {
    const mockClient = new BedrockRuntimeClient({}) as jest.Mocked<BedrockRuntimeClient>;
    (mockClient.send as jest.Mock) = jest.fn().mockResolvedValue({
      body: new TextEncoder().encode(
        JSON.stringify({
          content: [],
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 0 },
        })
      ),
    });

    await expect(
      invokeClaudeForTagging(mockClient, MODEL_ID, SYSTEM, USER_MSG, false)
    ).rejects.toThrow('missing text content block');
  });

  it('throws when response JSON has no tags array', async () => {
    const mockClient = new BedrockRuntimeClient({}) as jest.Mocked<BedrockRuntimeClient>;
    (mockClient.send as jest.Mock) = jest.fn().mockResolvedValue({
      body: new TextEncoder().encode(
        JSON.stringify({
          content: [{ type: 'text', text: '{"result":"ok"}' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
        })
      ),
    });

    await expect(
      invokeClaudeForTagging(mockClient, MODEL_ID, SYSTEM, USER_MSG, false)
    ).rejects.toThrow('expected tags array');
  });
});
