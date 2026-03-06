/**
 * Gemini client for video tagging via the Gemini File API.
 *
 * Responsibilities:
 *  - Upload video bytes to Gemini File API (real mode)
 *  - Poll until the file is ACTIVE
 *  - Issue a single multimodal generateContent call covering all sampled frames
 *  - Parse Gemini's per-frame response into TagResult[][]
 *  - Delete the uploaded file after processing (best-effort)
 *  - Short-circuit only the API calls when mock mode is enabled
 *    (frame sampling, taxonomy validation, cost tracking all still run)
 */

import axios from 'axios';
import { PassThrough } from 'stream';
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
 * Invoke Gemini to tag video content.
 *
 * In real mode: uploads video to Gemini File API, waits for ACTIVE state,
 *   issues one multimodal generateContent call, then deletes the file.
 * In mock mode: returns MOCK_FRAME_TAGS for every frame (API call skipped).
 *
 * @param apiKey        Gemini API key (ignored in mock mode).
 * @param apiUrl        Gemini API base URL.
 * @param frames        List of frame timestamps produced by sampleFrames().
 * @param videoTitle    Title of the video (injected into the prompt).
 * @param taxonomyText  Formatted taxonomy from formatTaxonomyForPrompt().
 * @param maxTags       Maximum tags to request per frame.
 * @param mockEnabled   When true, returns mock data without calling the API.
 * @param videoBytes    Raw video bytes (required in real mode).
 * @param videoMimeType MIME type of the video e.g. 'video/mp4' (required in real mode).
 */
export async function invokeGeminiForTagging(
  apiKey: string,
  apiUrl: string,
  frames: FrameSample[],
  videoTitle: string,
  taxonomyText: string,
  maxTags: number,
  mockEnabled: boolean,
  videoBytes?: Buffer,
  videoMimeType?: string
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

  if (!videoBytes || !videoMimeType) {
    throw new Error('videoBytes and videoMimeType are required in real mode');
  }

  // 1. Upload video to Gemini File API
  logger.info('Uploading video to Gemini File API', {
    size_bytes: videoBytes.length,
    mime_type: videoMimeType,
  });
  const fileUri = await uploadVideoToGemini(apiKey, apiUrl, videoBytes, videoMimeType, videoTitle);
  logger.info('Video uploaded to Gemini', { file_uri: fileUri });

  // 2. Wait for file to become ACTIVE
  await waitForGeminiFile(apiKey, fileUri);
  logger.info('Gemini file is ACTIVE', { file_uri: fileUri });

  // 3. Single multimodal generateContent call
  const { frameTags, inputTokens, outputTokens } = await analyzeVideoWithGemini(
    apiKey,
    apiUrl,
    fileUri,
    videoMimeType,
    frames,
    videoTitle,
    taxonomyText,
    maxTags
  );

  // 4. Delete file (best-effort, fire-and-forget style)
  deleteGeminiFile(apiKey, fileUri).catch((err) => {
    logger.warn('Failed to delete Gemini file (non-fatal)', { file_uri: fileUri, error: String(err) });
  });

  return { frameTags, inputTokens, outputTokens };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Upload video bytes to the Gemini File API using a streamed multipart body.
 *
 * Previously this function used Buffer.concat() to build the complete multipart
 * body before sending. For a 660 MB video that caused a second 660 MB heap
 * allocation simultaneously with the original download buffer, exhausting the
 * 3008 MB Lambda memory limit and producing Runtime.OutOfMemory.
 *
 * The fix pipes a Node.js PassThrough stream to axios so the HTTP client writes
 * chunks directly to the socket without ever holding a second full copy of the
 * video data in the heap. Peak memory is now ~1x video size + runtime overhead
 * instead of ~2x.
 *
 * Returns the file URI (e.g. "files/abc123").
 */
async function uploadVideoToGemini(
  apiKey: string,
  apiUrl: string,
  videoBytes: Buffer,
  mimeType: string,
  displayName: string
): Promise<string> {
  const metadataPart = JSON.stringify({ file: { display_name: displayName } });
  const boundary = `sibyl-boundary-${Date.now()}`;

  const preamble = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n${metadataPart}\r\n` +
    `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
  );
  const epilogue = Buffer.from(`\r\n--${boundary}--`);

  // Total byte count must be declared up-front so the Gemini API accepts the
  // request; the server rejects uploads without an accurate Content-Length.
  const contentLength = preamble.length + videoBytes.length + epilogue.length;

  // Write each part separately — never concatenate the full video into a new
  // buffer. Buffer.concat([preamble, videoBytes, epilogue]) would create a
  // second ~file-size allocation on top of the existing videoBytes buffer,
  // pushing peak memory to 2× file size and causing Runtime.OutOfMemory for
  // large files. Writing parts individually keeps only the original buffer live.
  const bodyStream = new PassThrough();
  bodyStream.write(preamble);
  bodyStream.write(videoBytes);
  bodyStream.end(epilogue);

  const response = await axios.post(
    `${apiUrl}/upload/v1beta/files?uploadType=multipart`,
    bodyStream,
    {
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'X-Goog-Upload-Protocol': 'multipart',
        'x-goog-api-key': apiKey,
        'Content-Length': String(contentLength),
      },
      // Allow axios to send bodies larger than its 10 MB default.
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      // Generous timeout: Gemini File API ingestion of a 660 MB file can take
      // 60–90 seconds on the upload leg alone; 240 s leaves headroom within
      // the 300 s Lambda timeout while still catching genuine hangs.
      timeout: 240_000,
    }
  );

  const fileUri: string | undefined = (response.data as { file?: { uri?: string } }).file?.uri;
  if (!fileUri) {
    throw new Error('Gemini File API did not return a file URI');
  }
  return fileUri;
}

/**
 * Poll the Gemini File API until the file reaches ACTIVE state.
 */
async function waitForGeminiFile(
  apiKey: string,
  fileUri: string,
  maxWaitMs = 120_000
): Promise<void> {
  const deadline = Date.now() + maxWaitMs;
  const pollIntervalMs = 2_000;

  while (Date.now() < deadline) {
    const response = await axios.get(fileUri, {
      params: { key: apiKey },
      timeout: 10_000,
    });

    const state: string | undefined = (response.data as { state?: string }).state;
    if (state === 'ACTIVE') {
      return;
    }
    if (state === 'FAILED') {
      throw new Error(`Gemini file processing failed: ${fileUri}`);
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(`Timed out waiting for Gemini file to become ACTIVE: ${fileUri}`);
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

/**
 * Issue a single multimodal generateContent call that asks Gemini to analyze
 * the full video and return per-timestamp tag analysis.
 */
async function analyzeVideoWithGemini(
  apiKey: string,
  apiUrl: string,
  fileUri: string,
  mimeType: string,
  frames: FrameSample[],
  videoTitle: string,
  taxonomyText: string,
  maxTags: number
): Promise<{ frameTags: TagResult[][]; inputTokens: number; outputTokens: number }> {
  const prompt = buildMultimodalPrompt(frames, videoTitle, taxonomyText, maxTags);

  const response = await axios.post(
    `${apiUrl}/v1beta/models/gemini-2.5-flash:generateContent`,
    {
      contents: [
        {
          parts: [
            { file_data: { mime_type: mimeType, file_uri: fileUri } },
            { text: prompt },
          ],
        },
      ],
      generationConfig: { temperature: 0.3, maxOutputTokens: 16384 },
    },
    {
      params: { key: apiKey },
      headers: { 'Content-Type': 'application/json' },
      timeout: 120_000,
    }
  );

  const body = response.data as GeminiResponseBody;
  const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Invalid Gemini response: missing text content');
  }

  const frameTags = parseMultimodalResponse(text, frames.length);
  const usage = body.usageMetadata;

  return {
    frameTags,
    inputTokens: usage?.promptTokenCount ?? 0,
    outputTokens: usage?.candidatesTokenCount ?? 0,
  };
}

/**
 * Delete a file from the Gemini File API. Best-effort — caller should not rethrow.
 */
async function deleteGeminiFile(
  apiKey: string,
  fileUri: string
): Promise<void> {
  await axios.delete(fileUri, {
    params: { key: apiKey },
    timeout: 10_000,
  });
  logger.info('Gemini file deleted', { file_uri: fileUri });
}

function buildMultimodalPrompt(
  frames: FrameSample[],
  videoTitle: string,
  taxonomyText: string,
  maxTags: number
): string {
  const frameList = frames
    .map((f) => {
      const m = Math.floor(f.timestampSeconds / 60);
      const s = f.timestampSeconds % 60;
      return `  - ${m}m${s}s`;
    })
    .join('\n');

  return `You are an expert video content tagging system. Analyze the provided video titled "${videoTitle}".

Examine the following timestamps and return tag analysis for each:
${frameList}

TAXONOMY CONSTRAINTS:
- Return ONLY tags from the approved taxonomy below — never invent new tags.
- The taxonomy is structured as verticals → categories → tags. Use ONLY the leaf tag names (e.g. "comfort-food", "food-storage"). Do NOT use vertical names or category names as tags — they are organisational headings, not valid tags.

CONFIDENCE SCORING GUIDE:
- 0.9–1.0: Tag is central to what is shown or discussed at this timestamp
- 0.7–0.89: Tag is clearly relevant but not the main focus
- 0.5–0.69: Tag is present or somewhat relevant
- Below 0.5: Do not include

BREADTH-FIRST SCAN:
- Scan ALL taxonomy verticals (Food & Cooking, Home & Garden, Parenting & Family, Entertainment, Automotive, History & Biography) for every timestamp — do not limit tagging to the most obvious primary vertical.
- Do not anchor on the dominant theme of the video as a whole. Each timestamp should be evaluated independently; surface cross-vertical tags whenever the visual content, activity, or spoken topic warrants them.

APPROVED TAXONOMY (use ONLY these tags):
${taxonomyText}

Return up to ${maxTags} tags per timestamp.

Return a JSON object in this exact format:
{
  "frames": [
    {
      "timestamp_seconds": <number>,
      "tags": [
        { "tag": "<taxonomy-tag>", "confidence": <0.0-1.0>, "reasoning": "<brief reason>" }
      ]
    }
  ]
}

Return ONLY the JSON object. No markdown fences.`;
}

interface MultimodalFrameEntry {
  timestamp_seconds: number;
  tags: Array<{ tag: string; confidence: number; reasoning?: string }>;
}

function parseMultimodalResponse(text: string, expectedFrameCount: number): TagResult[][] {
  // Strip optional markdown code fences
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

  let parsed: { frames?: MultimodalFrameEntry[] };
  try {
    parsed = JSON.parse(stripped) as { frames?: MultimodalFrameEntry[] };
  } catch {
    throw new Error(`Could not parse Gemini multimodal response as JSON: ${stripped.slice(0, 200)}`);
  }

  if (!Array.isArray(parsed.frames)) {
    throw new Error('Gemini multimodal response missing "frames" array');
  }

  // Map back to TagResult[][]; pad with empty arrays if Gemini returned fewer frames
  const result: TagResult[][] = parsed.frames.map((frame) =>
    (frame.tags ?? []).map((t) => ({
      tag: t.tag,
      confidence: t.confidence,
      reasoning: t.reasoning,
    }))
  );

  // Ensure length matches expected frame count
  while (result.length < expectedFrameCount) {
    result.push([]);
  }

  return result.slice(0, expectedFrameCount);
}
