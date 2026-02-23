/**
 * Unit tests for confidence-based content routing (routing.ts)
 */

import { routeContent, RoutingDecision } from '../routing';
import { TagResult } from '../../types';

const THRESHOLD = 0.85;

function tag(name: string, confidence: number): TagResult {
  return { tag: name, confidence };
}

describe('routeContent', () => {
  describe('auto-publish path (all tags ≥ threshold)', () => {
    it('returns needs_review: false when all tags are above threshold', () => {
      const tags = [tag('bread-baking', 0.95), tag('sourdough-bread', 0.90)];
      const decision = routeContent(tags, THRESHOLD);
      expect(decision.needs_review).toBe('false');
    });

    it('returns needs_review: false when a tag is exactly at the threshold', () => {
      const tags = [tag('bread-baking', 0.85), tag('sourdough-bread', 0.92)];
      const decision = routeContent(tags, THRESHOLD);
      expect(decision.needs_review).toBe('false');
    });

    it('sets source to "ai" and reviewed to false', () => {
      const tags = [tag('grilling-recipes', 0.95)];
      const decision = routeContent(tags, THRESHOLD);
      expect(decision.source).toBe('ai');
      expect(decision.reviewed).toBe(false);
    });

    it('includes min_confidence in the decision', () => {
      const tags = [tag('bread-baking', 0.95), tag('sourdough-bread', 0.88)];
      const decision = routeContent(tags, THRESHOLD);
      expect(decision.min_confidence).toBeCloseTo(0.88);
    });

    it('routing_reason mentions all tags meeting threshold', () => {
      const tags = [tag('bread-baking', 0.95), tag('sourdough-bread', 0.88)];
      const decision = routeContent(tags, THRESHOLD);
      expect(decision.routing_reason).toContain('all 2 tag(s) meet');
      expect(decision.routing_reason).toContain('0.85');
    });
  });

  describe('review queue path (any tag < threshold)', () => {
    it('returns needs_review: true when any tag is below threshold', () => {
      const tags = [tag('bread-baking', 0.95), tag('sourdough-bread', 0.72)];
      const decision = routeContent(tags, THRESHOLD);
      expect(decision.needs_review).toBe('true');
    });

    it('returns needs_review: true when all tags are below threshold', () => {
      const tags = [tag('bread-baking', 0.60), tag('sourdough-bread', 0.55)];
      const decision = routeContent(tags, THRESHOLD);
      expect(decision.needs_review).toBe('true');
    });

    it('routing_reason names the below-threshold tags and their scores', () => {
      const tags = [tag('bread-baking', 0.95), tag('sourdough-bread', 0.72)];
      const decision = routeContent(tags, THRESHOLD);
      expect(decision.routing_reason).toContain('1 of 2 tag(s) below');
      expect(decision.routing_reason).toContain('sourdough-bread');
      expect(decision.routing_reason).toContain('0.72');
    });

    it('routing_reason lists all below-threshold tags when multiple', () => {
      const tags = [
        tag('bread-baking', 0.60),
        tag('sourdough-bread', 0.55),
        tag('grilling-recipes', 0.91),
      ];
      const decision = routeContent(tags, THRESHOLD);
      expect(decision.routing_reason).toContain('2 of 3 tag(s) below');
      expect(decision.routing_reason).toContain('bread-baking');
      expect(decision.routing_reason).toContain('sourdough-bread');
    });

    it('correctly calculates min_confidence from below-threshold tags', () => {
      const tags = [tag('bread-baking', 0.95), tag('sourdough-bread', 0.55)];
      const decision = routeContent(tags, THRESHOLD);
      expect(decision.min_confidence).toBeCloseTo(0.55);
    });
  });

  describe('empty tags edge case', () => {
    it('returns needs_review: true when tags array is empty', () => {
      const decision = routeContent([], THRESHOLD);
      expect(decision.needs_review).toBe('true');
    });

    it('sets min_confidence to 0 when tags array is empty', () => {
      const decision = routeContent([], THRESHOLD);
      expect(decision.min_confidence).toBe(0);
    });

    it('routing_reason explains no tags were returned', () => {
      const decision = routeContent([], THRESHOLD);
      expect(decision.routing_reason).toContain('no valid taxonomy tags');
    });
  });

  describe('threshold value propagation', () => {
    it('records the threshold used in the decision', () => {
      const decision = routeContent([tag('bread-baking', 0.95)], THRESHOLD);
      expect(decision.confidence_threshold).toBe(THRESHOLD);
    });

    it('respects a custom threshold of 0.70', () => {
      const tags = [tag('bread-baking', 0.75)]; // above 0.70 but below 0.85
      const decision = routeContent(tags, 0.70);
      expect(decision.needs_review).toBe('false');
    });

    it('respects a custom threshold of 0.95', () => {
      const tags = [tag('bread-baking', 0.90)]; // below 0.95
      const decision = routeContent(tags, 0.95);
      expect(decision.needs_review).toBe('true');
    });
  });

  describe('RoutingDecision shape', () => {
    it('always returns all required fields', () => {
      const decision: RoutingDecision = routeContent([tag('bread-baking', 0.95)], THRESHOLD);
      expect(decision).toHaveProperty('needs_review');
      expect(decision).toHaveProperty('source');
      expect(decision).toHaveProperty('reviewed');
      expect(decision).toHaveProperty('routing_reason');
      expect(decision).toHaveProperty('confidence_threshold');
      expect(decision).toHaveProperty('min_confidence');
    });
  });
});
