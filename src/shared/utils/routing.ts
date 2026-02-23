/**
 * Confidence-based content routing (POC-004)
 *
 * Routes tagged content based on confidence scores:
 *  - All tags ≥ threshold → auto-publish (needs_review: false, source: 'ai')
 *  - Any tag  < threshold → human review  (needs_review: true,  source: 'ai')
 *
 * The threshold is configurable via the CONFIDENCE_THRESHOLD environment variable
 * (default: 0.85). See AppConfig.confidenceThreshold.
 */

import { TagResult } from '../types';

export interface RoutingDecision {
  /** 'true' or 'false' stored as string so it can serve as a DynamoDB GSI partition key */
  needs_review: 'true' | 'false';
  /** Always 'ai' for programmatic tagging — set to 'human' after editor review */
  source: 'ai';
  /** Always false on first write; set to true after editor review */
  reviewed: false;
  /** Human-readable explanation of why this decision was made */
  routing_reason: string;
  /** The threshold value used for this decision */
  confidence_threshold: number;
  /** Lowest confidence score among all tags (key diagnostic signal) */
  min_confidence: number;
}

/**
 * Determine whether a tagged content item should be auto-published or sent for
 * human review based on tag confidence scores.
 *
 * @param tags      Validated taxonomy tags with confidence scores.
 * @param threshold Confidence threshold (0–1). Tags below this trigger review.
 */
export function routeContent(tags: TagResult[], threshold: number): RoutingDecision {
  if (tags.length === 0) {
    return {
      needs_review: 'true',
      source: 'ai',
      reviewed: false,
      routing_reason: 'no valid taxonomy tags returned',
      confidence_threshold: threshold,
      min_confidence: 0,
    };
  }

  const minConfidence = Math.min(...tags.map((t) => t.confidence));
  const belowThreshold = tags.filter((t) => t.confidence < threshold);
  const needsReview = belowThreshold.length > 0;

  const routing_reason = needsReview
    ? `${belowThreshold.length} of ${tags.length} tag(s) below confidence threshold ${threshold}: [${belowThreshold.map((t) => `${t.tag}(${t.confidence})`).join(', ')}]`
    : `all ${tags.length} tag(s) meet confidence threshold ${threshold} (min: ${minConfidence.toFixed(3)})`;

  return {
    needs_review: needsReview ? 'true' : 'false',
    source: 'ai',
    reviewed: false,
    routing_reason,
    confidence_threshold: threshold,
    min_confidence: minConfidence,
  };
}
