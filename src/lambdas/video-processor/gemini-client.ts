/**
 * Gemini client for video frame tagging.
 *
 * Responsibilities:
 *  - Build the Gemini API request for per-frame video analysis
 *  - Parse Gemini's response into TagResult[]
 *  - Short-circuit only the API call when mock mode is enabled
 *    (frame sampling, taxonomy validation, cost tracking all still run)
 */

import axios from 'axios';
import { TagResult } from '../../shared/types';
import { getLogger } from '../../shared/utils';
import { FrameSample } from './frame-aggregator';

const logger = getLogger();

export interface GeminiTaggingResult {
  frameTags: TagResult[][]; // One TagResult[] per sampled frame
  inputTokens: number;
  outputTokens: number;
}

/**
 * Synthetic mock response for a single frame.
 *
 * Intentionally includes one invalid tag ('mock-hallucinated-video-tag') to
 * exercise hallucination detection logging when mock mode is enabled.
 * Valid tags are real taxonomy entries so the happy path also runs.
 */
const MOCK_FRAME_TAGS: TagResult[] = [
  { tag: 'grilling-recipes', confidence: 0.92, reasoning: 'Mock frame response' },
  { tag: 'outdoor-cooking', confidence: 0.88, reasoning: 'Mock frame response' },
  { tag: 'barbecue-grilling', confidence: 0.85, reasoning: 'Mock frame response' },
  {
    tag: 'mock-hallucinated-video-tag',
    confidence: 0.70,
    reasoning: 'Mock — intentionally invalid tag for hallucination-logging test',
  },
];

// Estimated tokens per frame call, used for cost reporting in mock mode
const MOCK_TOKENS_PER_FRAME = { input: 200, output: 80 };

/**
 * Invoke Gemini to tag video frames.
 *
 * In real mode: calls Gemini API once per frame with a text prompt.
 * In mock mode: returns MOCK_FRAME_TAGS for every frame (API call skipped).
 *
 * @param apiKey       Gemini API key (ignored in mock mode).
 * @param apiUrl       Gemini API base URL.
 * @param frames       List of frame timestamps produced by sampleFrames().
 * @param videoTitle   Title of the video (injected into the prompt).
 * @param taxonomyText Formatted taxonomy from formatTaxonomyForPrompt().
 * @param maxTags      Maximum tags to request per frame.
 * @param mockEnabled  When true, returns mock data without calling the API.
 */
export async function invokeGeminiForTagging(
  apiKey: string,
  apiUrl: string,
  frames: FrameSample[],
  videoTitle: string,
  taxonomyText: string,
  maxTags: number,
  mockEnabled: boolean
): Promise<GeminiTaggingResult> {
  if (mockEnabled) {
    logger.warn(
      'Gemini mock mode enabled — returning synthetic frame responses (API call skipped)',
      { frame_count: frames.length }
    );
    return {
      frameTags: frames.map(() => [...MOCK_FRAME_TAGS]),
      inputTokens: frames.length * MOCK_TOKENS_PER_FRAME.input,
      outputTokens: frames.length * MOCK_TOKENS_PER_FRAME.output,
    };
  }

  // Real mode: call Gemini once per sampled frame
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const frameTags: TagResult[][] = [];

  for (const frame of frames) {
    const result = await callGeminiForFrame(
      apiKey,
      apiUrl,
      frame,
      videoTitle,
      taxonomyText,
      maxTags
    );
    frameTags.push(result.tags);
    totalInputTokens += result.inputTokens;
    totalOutputTokens += result.outputTokens;
  }

  return { frameTags, inputTokens: totalInputTokens, outputTokens: totalOutputTokens };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface SingleFrameResult {
  tags: TagResult[];
  inputTokens: number;
  outputTokens: number;
}

async function callGeminiForFrame(
  apiKey: string,
  apiUrl: string,
  frame: FrameSample,
  videoTitle: string,
  taxonomyText: string,
  maxTags: number
): Promise<SingleFrameResult> {
  const prompt = buildFramePrompt(videoTitle, frame.timestampSeconds, taxonomyText, maxTags);

  const response = await axios.post(
    `${apiUrl}/v1beta/models/gemini-1.5-flash:generateContent`,
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 512 },
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      timeout: 30_000,
    }
  );

  const tags = parseGeminiResponse(response.data as GeminiResponseBody);
  const usage = (response.data as GeminiResponseBody).usageMetadata;

  return {
    tags,
    inputTokens: usage?.promptTokenCount ?? 0,
    outputTokens: usage?.candidatesTokenCount ?? 0,
  };
}

function buildFramePrompt(
  videoTitle: string,
  timestampSeconds: number,
  taxonomyText: string,
  maxTags: number
): string {
  const minutes = Math.floor(timestampSeconds / 60);
  const seconds = timestampSeconds % 60;

  return `You are an expert video content tagging system. Analyze the video frame at timestamp ${minutes}m${seconds}s.

Video title: ${videoTitle}

Return up to ${maxTags} taxonomy tags relevant to what is shown in this frame.

IMPORTANT: Return ONLY tags from this approved taxonomy — never invent new tags:
${taxonomyText}

Return a JSON array: [{"tag": "...", "confidence": 0.0-1.0, "reasoning": "..."}]
Return ONLY the JSON array.`;
}

interface GeminiResponseBody {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
}

function parseGeminiResponse(responseBody: GeminiResponseBody): TagResult[] {
  const text = responseBody.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Invalid Gemini response: missing text content');
  }

  // Handle markdown code fence wrapping
  const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/) ?? text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error('Could not extract JSON array from Gemini response');
  }

  const jsonText = jsonMatch[1] ?? jsonMatch[0];
  const parsed = JSON.parse(jsonText) as Array<{
    tag: string;
    confidence: number;
    reasoning?: string;
  }>;

  if (!Array.isArray(parsed)) {
    throw new Error('Gemini response did not return a JSON array');
  }

  return parsed.map((t) => ({
    tag: t.tag,
    confidence: t.confidence,
    reasoning: t.reasoning,
  }));
}
