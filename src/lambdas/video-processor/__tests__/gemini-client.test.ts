/**
 * Unit tests for gemini-client.ts
 *
 * Tests mock mode behaviour and real response parsing.
 * The Gemini API is fully mocked — no network calls are made.
 */

import { invokeGeminiForTagging } from '../gemini-client';
import { FrameSample } from '../frame-aggregator';

jest.mock('../../../shared/utils/logger', () => ({
  getLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

// A minimal set of frames used across tests
const TWO_FRAMES: FrameSample[] = [
  { frameIndex: 0, timestampSeconds: 0 },
  { frameIndex: 1, timestampSeconds: 15 },
];

const DUMMY_PARAMS = {
  apiKey: 'test-key',
  apiUrl: 'https://generativelanguage.googleapis.com',
  videoTitle: 'BBQ Summer Cook-off',
  taxonomyText: 'grilling-recipes, outdoor-cooking, barbecue-grilling',
  maxTags: 5,
};

// ---------------------------------------------------------------------------
// Mock mode
// ---------------------------------------------------------------------------

describe('mock mode (geminiMockEnabled: true)', () => {
  it('returns one TagResult[] per frame without calling the API', async () => {
    const result = await invokeGeminiForTagging(
      DUMMY_PARAMS.apiKey,
      DUMMY_PARAMS.apiUrl,
      TWO_FRAMES,
      DUMMY_PARAMS.videoTitle,
      DUMMY_PARAMS.taxonomyText,
      DUMMY_PARAMS.maxTags,
      true
    );
    expect(result.frameTags).toHaveLength(TWO_FRAMES.length);
  });

  it('includes the intentional hallucinated tag in mock output', async () => {
    const result = await invokeGeminiForTagging(
      DUMMY_PARAMS.apiKey,
      DUMMY_PARAMS.apiUrl,
      TWO_FRAMES,
      DUMMY_PARAMS.videoTitle,
      DUMMY_PARAMS.taxonomyText,
      DUMMY_PARAMS.maxTags,
      true
    );
    const allTags = result.frameTags.flat().map((t) => t.tag);
    expect(allTags).toContain('mock-hallucinated-video-tag');
  });

  it('returns non-zero token counts proportional to frame count', async () => {
    const result = await invokeGeminiForTagging(
      DUMMY_PARAMS.apiKey,
      DUMMY_PARAMS.apiUrl,
      TWO_FRAMES,
      DUMMY_PARAMS.videoTitle,
      DUMMY_PARAMS.taxonomyText,
      DUMMY_PARAMS.maxTags,
      true
    );
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(result.outputTokens).toBeGreaterThan(0);
  });

  it('scales token counts with frame count', async () => {
    const oneFrame: FrameSample[] = [{ frameIndex: 0, timestampSeconds: 0 }];
    const fourFrames: FrameSample[] = Array.from({ length: 4 }, (_, i) => ({
      frameIndex: i,
      timestampSeconds: i * 15,
    }));

    const one = await invokeGeminiForTagging(
      DUMMY_PARAMS.apiKey, DUMMY_PARAMS.apiUrl, oneFrame,
      DUMMY_PARAMS.videoTitle, DUMMY_PARAMS.taxonomyText, DUMMY_PARAMS.maxTags, true
    );
    const four = await invokeGeminiForTagging(
      DUMMY_PARAMS.apiKey, DUMMY_PARAMS.apiUrl, fourFrames,
      DUMMY_PARAMS.videoTitle, DUMMY_PARAMS.taxonomyText, DUMMY_PARAMS.maxTags, true
    );
    expect(four.inputTokens).toBe(one.inputTokens * 4);
    expect(four.outputTokens).toBe(one.outputTokens * 4);
  });

  it('returns empty frameTags array when given zero frames', async () => {
    const result = await invokeGeminiForTagging(
      DUMMY_PARAMS.apiKey,
      DUMMY_PARAMS.apiUrl,
      [],
      DUMMY_PARAMS.videoTitle,
      DUMMY_PARAMS.taxonomyText,
      DUMMY_PARAMS.maxTags,
      true
    );
    expect(result.frameTags).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Real mode — response parsing (axios mocked)
// ---------------------------------------------------------------------------

jest.mock('axios');
import axios from 'axios';
const mockedAxios = axios as jest.Mocked<typeof axios>;

function makeGeminiResponse(text: string) {
  return {
    data: {
      candidates: [{ content: { parts: [{ text }] } }],
      usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 60 },
    },
  };
}

describe('real mode — response parsing', () => {
  it('parses a plain JSON array response', async () => {
    mockedAxios.post.mockResolvedValueOnce(
      makeGeminiResponse(
        JSON.stringify([
          { tag: 'grilling-recipes', confidence: 0.92, reasoning: 'Visible grill' },
        ])
      )
    );

    const result = await invokeGeminiForTagging(
      DUMMY_PARAMS.apiKey,
      DUMMY_PARAMS.apiUrl,
      [TWO_FRAMES[0]],
      DUMMY_PARAMS.videoTitle,
      DUMMY_PARAMS.taxonomyText,
      DUMMY_PARAMS.maxTags,
      false
    );

    expect(result.frameTags[0][0].tag).toBe('grilling-recipes');
    expect(result.frameTags[0][0].confidence).toBe(0.92);
  });

  it('parses a response wrapped in a markdown code fence', async () => {
    const json = JSON.stringify([{ tag: 'outdoor-cooking', confidence: 0.88 }]);
    mockedAxios.post.mockResolvedValueOnce(
      makeGeminiResponse('```json\n' + json + '\n```')
    );

    const result = await invokeGeminiForTagging(
      DUMMY_PARAMS.apiKey,
      DUMMY_PARAMS.apiUrl,
      [TWO_FRAMES[0]],
      DUMMY_PARAMS.videoTitle,
      DUMMY_PARAMS.taxonomyText,
      DUMMY_PARAMS.maxTags,
      false
    );

    expect(result.frameTags[0][0].tag).toBe('outdoor-cooking');
  });

  it('reports token counts from Gemini usageMetadata', async () => {
    mockedAxios.post.mockResolvedValueOnce(
      makeGeminiResponse(JSON.stringify([{ tag: 'grilling-recipes', confidence: 0.9 }]))
    );

    const result = await invokeGeminiForTagging(
      DUMMY_PARAMS.apiKey,
      DUMMY_PARAMS.apiUrl,
      [TWO_FRAMES[0]],
      DUMMY_PARAMS.videoTitle,
      DUMMY_PARAMS.taxonomyText,
      DUMMY_PARAMS.maxTags,
      false
    );

    expect(result.inputTokens).toBe(150);
    expect(result.outputTokens).toBe(60);
  });
});
