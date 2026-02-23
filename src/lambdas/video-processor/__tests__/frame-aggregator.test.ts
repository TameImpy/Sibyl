/**
 * Unit tests for frame-aggregator.ts
 *
 * Tests validateVideoFormat, sampleFrames, and aggregateFrameTags
 * against the real implementation.
 */

import {
  validateVideoFormat,
  sampleFrames,
  aggregateFrameTags,
  SUPPORTED_EXTENSIONS,
  MAX_VIDEO_DURATION_SECONDS,
} from '../frame-aggregator';
import { TagResult } from '../../../shared/types';

// ---------------------------------------------------------------------------
// validateVideoFormat
// ---------------------------------------------------------------------------

describe('validateVideoFormat', () => {
  it.each(SUPPORTED_EXTENSIONS)('accepts %s extension', (ext) => {
    expect(() => validateVideoFormat(`https://example.com/video${ext}`)).not.toThrow();
  });

  it('accepts URL with query parameters', () => {
    expect(() =>
      validateVideoFormat('https://s3.amazonaws.com/bucket/video.mp4?X-Amz-Signature=abc')
    ).not.toThrow();
  });

  it('throws on an unsupported extension', () => {
    expect(() => validateVideoFormat('https://example.com/video.wmv')).toThrow(
      'Unsupported video format'
    );
  });

  it('throws when URL has no extension', () => {
    expect(() => validateVideoFormat('https://example.com/video')).toThrow(
      'Unsupported video format'
    );
  });

  it('is case-insensitive for extensions', () => {
    expect(() => validateVideoFormat('https://example.com/video.MP4')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// sampleFrames
// ---------------------------------------------------------------------------

describe('sampleFrames', () => {
  it('returns a single frame at t=0 for a zero-duration video', () => {
    const frames = sampleFrames(0, 15);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual({ frameIndex: 0, timestampSeconds: 0 });
  });

  it('samples at t=0, t=15, t=30 for a 30-second video with 15s interval', () => {
    const frames = sampleFrames(30, 15);
    expect(frames).toHaveLength(3);
    expect(frames.map((f) => f.timestampSeconds)).toEqual([0, 15, 30]);
  });

  it('assigns sequential frameIndex values', () => {
    const frames = sampleFrames(30, 15);
    expect(frames.map((f) => f.frameIndex)).toEqual([0, 1, 2]);
  });

  it('includes the last frame at exactly durationSeconds', () => {
    const frames = sampleFrames(60, 30);
    const timestamps = frames.map((f) => f.timestampSeconds);
    expect(timestamps).toContain(60);
  });

  it('does not produce a frame beyond durationSeconds', () => {
    const frames = sampleFrames(60, 30);
    const max = Math.max(...frames.map((f) => f.timestampSeconds));
    expect(max).toBeLessThanOrEqual(60);
  });

  it('produces the correct number of frames for a 5-minute video at 15s interval', () => {
    // 0, 15, 30, …, 300 → 21 frames
    const frames = sampleFrames(300, 15);
    expect(frames).toHaveLength(21);
  });

  it('throws when duration exceeds 60 minutes', () => {
    expect(() => sampleFrames(MAX_VIDEO_DURATION_SECONDS + 1, 15)).toThrow(
      'exceeds maximum supported duration'
    );
  });

  it('accepts exactly 60 minutes without throwing', () => {
    expect(() => sampleFrames(MAX_VIDEO_DURATION_SECONDS, 15)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// aggregateFrameTags
// ---------------------------------------------------------------------------

function tag(name: string, confidence: number): TagResult {
  return { tag: name, confidence };
}

describe('aggregateFrameTags', () => {
  it('returns empty array for zero frames', () => {
    expect(aggregateFrameTags([])).toEqual([]);
  });

  it('includes a tag that appears in 100% of frames', () => {
    const frames = [[tag('grilling-recipes', 0.9)], [tag('grilling-recipes', 0.8)]];
    const result = aggregateFrameTags(frames);
    expect(result.map((t) => t.tag)).toContain('grilling-recipes');
  });

  it('excludes a tag below the 20% default threshold', () => {
    // 1 out of 6 frames = ~16.7% < 20%
    const frames = [
      [tag('rare-tag', 0.9)],
      [tag('other', 0.8)],
      [tag('other', 0.8)],
      [tag('other', 0.8)],
      [tag('other', 0.8)],
      [tag('other', 0.8)],
    ];
    const result = aggregateFrameTags(frames);
    expect(result.map((t) => t.tag)).not.toContain('rare-tag');
  });

  it('includes a tag exactly at the 20% threshold', () => {
    // 1 out of 5 frames = 20% — meets the threshold
    const frames = [
      [tag('threshold-tag', 0.9)],
      [tag('other', 0.5)],
      [tag('other', 0.5)],
      [tag('other', 0.5)],
      [tag('other', 0.5)],
    ];
    const result = aggregateFrameTags(frames);
    expect(result.map((t) => t.tag)).toContain('threshold-tag');
  });

  it('averages confidence across frames where tag appears', () => {
    const frames = [
      [tag('grilling-recipes', 0.80)],
      [tag('grilling-recipes', 1.00)],
    ];
    const result = aggregateFrameTags(frames);
    const t = result.find((r) => r.tag === 'grilling-recipes')!;
    expect(t.confidence).toBeCloseTo(0.90);
  });

  it('sorts results by descending confidence', () => {
    const frames = [
      [tag('low-confidence', 0.5), tag('high-confidence', 0.9)],
      [tag('low-confidence', 0.5), tag('high-confidence', 0.9)],
    ];
    const result = aggregateFrameTags(frames);
    expect(result[0].tag).toBe('high-confidence');
  });

  it('respects a custom minFrameFraction threshold', () => {
    // Tag in 2/4 frames = 50%; passes 0.4 threshold, fails 0.6 threshold
    const frames = [
      [tag('borderline', 0.8)],
      [tag('borderline', 0.8)],
      [tag('other', 0.5)],
      [tag('other', 0.5)],
    ];
    expect(aggregateFrameTags(frames, 0.4).map((t) => t.tag)).toContain('borderline');
    expect(aggregateFrameTags(frames, 0.6).map((t) => t.tag)).not.toContain('borderline');
  });
});
