/**
 * Video frame sampling and tag aggregation for Gemini video processing.
 *
 * Responsibilities:
 *  - Validate video file format and duration
 *  - Compute the list of frame timestamps to sample
 *  - Aggregate per-frame tag results to video-level tags (≥20% threshold)
 */

import { TagResult } from '../../shared/types';

export interface FrameSample {
  frameIndex: number;
  timestampSeconds: number;
}

export const SUPPORTED_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv'];
export const MAX_VIDEO_DURATION_SECONDS = 60 * 60; // 60 minutes

/**
 * Validate that a video URL points to a supported format.
 * Throws if the format is not supported.
 */
export function validateVideoFormat(url: string): void {
  const pathname = url.split('?')[0]; // strip query params
  const lastDot = pathname.lastIndexOf('.');
  const ext = lastDot >= 0 ? pathname.slice(lastDot).toLowerCase() : '';

  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    throw new Error(
      `Unsupported video format: "${ext || '(none)'}". Supported formats: ${SUPPORTED_EXTENSIONS.join(', ')}`
    );
  }
}

/**
 * Build the list of frame timestamps to sample from a video.
 *
 * Samples one frame at t=0, t=interval, t=2*interval, … up to durationSeconds.
 * Throws if duration exceeds the 60-minute cap.
 */
export function sampleFrames(durationSeconds: number, intervalSeconds: number): FrameSample[] {
  if (durationSeconds > MAX_VIDEO_DURATION_SECONDS) {
    throw new Error(
      `Video duration ${durationSeconds}s exceeds maximum supported duration of ${MAX_VIDEO_DURATION_SECONDS}s (60 minutes)`
    );
  }

  const frames: FrameSample[] = [];
  let frameIndex = 0;
  let timestamp = 0;

  while (timestamp <= durationSeconds) {
    frames.push({ frameIndex, timestampSeconds: timestamp });
    frameIndex++;
    timestamp += intervalSeconds;
  }

  return frames;
}

/**
 * Aggregate per-frame tag results into a single video-level tag list.
 *
 * A tag is included if it appears in at least `minFrameFraction` of frames
 * (default: 0.20 — i.e. ≥20% of frames). The aggregated confidence is the
 * average confidence across the frames where the tag appeared.
 *
 * Results are sorted by descending confidence.
 */
export function aggregateFrameTags(
  frameResults: TagResult[][],
  minFrameFraction: number = 0.2
): TagResult[] {
  const totalFrames = frameResults.length;
  if (totalFrames === 0) return [];

  const tagStats = new Map<string, { count: number; totalConfidence: number }>();

  for (const frameTags of frameResults) {
    for (const { tag, confidence } of frameTags) {
      const existing = tagStats.get(tag);
      if (existing) {
        existing.count++;
        existing.totalConfidence += confidence;
      } else {
        tagStats.set(tag, { count: 1, totalConfidence: confidence });
      }
    }
  }

  const aggregated: TagResult[] = [];
  for (const [tag, { count, totalConfidence }] of tagStats.entries()) {
    if (count / totalFrames >= minFrameFraction) {
      aggregated.push({
        tag,
        confidence: totalConfidence / count, // average confidence across frames
      });
    }
  }

  return aggregated.sort((a, b) => b.confidence - a.confidence);
}
