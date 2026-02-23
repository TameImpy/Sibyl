/**
 * Unit tests for Taxonomy Loader
 */

import * as fs from 'fs';
import {
  getTaxonomy,
  getTaxonomyTags,
  getTagsByVertical,
  getTagsByCategory,
  isValidTag,
  validateTags,
  getCanonicalTag,
  formatTaxonomyForPrompt,
  getTaxonomyStats,
  clearCache,
} from '../taxonomy-loader';

// Mock fs so we can override existsSync per-test without hitting
// the "Cannot redefine property" error on non-configurable native properties.
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn().mockImplementation(jest.requireActual('fs').existsSync),
}));

describe('Taxonomy Loader', () => {
  beforeEach(() => {
    // Clear cache before each test to ensure fresh load
    clearCache();
    // Reset existsSync to real behaviour between tests
    (fs.existsSync as jest.Mock).mockImplementation(jest.requireActual('fs').existsSync);
  });

  describe('getTaxonomy', () => {
    it('should load taxonomy successfully', () => {
      const taxonomy = getTaxonomy();

      expect(taxonomy).toBeDefined();
      expect(taxonomy.metadata.version).toBe('1.0.0');
      expect(taxonomy.metadata.total_tags).toBe(500);
      expect(Object.keys(taxonomy.verticals)).toHaveLength(5);
    });

    it('should cache taxonomy after first load', () => {
      const first = getTaxonomy();
      const second = getTaxonomy();

      expect(first).toBe(second); // Same object reference
    });

    it('should have all required verticals', () => {
      const taxonomy = getTaxonomy();
      const verticalKeys = Object.keys(taxonomy.verticals);

      expect(verticalKeys).toContain('food-cooking');
      expect(verticalKeys).toContain('home-garden');
      expect(verticalKeys).toContain('parenting-family');
      expect(verticalKeys).toContain('entertainment');
      expect(verticalKeys).toContain('automotive');
    });
  });

  describe('getTaxonomyTags', () => {
    it('should return all tags as flat list', () => {
      const tags = getTaxonomyTags();

      expect(tags.length).toBeGreaterThan(400); // Should have ~478-500 tags
      expect(tags).toContain('bread-baking');
      expect(tags).toContain('grilling-recipes');
      expect(tags).toContain('vegetable-gardening');
    });

    it('should return only unique tags', () => {
      const tags = getTaxonomyTags();
      const uniqueTags = new Set(tags);

      expect(tags.length).toBe(uniqueTags.size);
    });
  });

  describe('getTagsByVertical', () => {
    it('should return tags for Food & Cooking vertical', () => {
      const tags = getTagsByVertical('Food & Cooking');

      expect(tags.length).toBeGreaterThan(0);
      expect(tags).toContain('bread-baking');
      expect(tags).toContain('grilling-recipes');
    });

    it('should be case-insensitive', () => {
      const lower = getTagsByVertical('food & cooking');
      const upper = getTagsByVertical('FOOD & COOKING');

      expect(lower).toEqual(upper);
    });

    it('should throw error for invalid vertical', () => {
      expect(() => {
        getTagsByVertical('Invalid Vertical');
      }).toThrow('not found');
    });
  });

  describe('getTagsByCategory', () => {
    it('should return tags for specific category', () => {
      const tags = getTagsByCategory('Food & Cooking', 'Cooking Methods');

      expect(tags.length).toBeGreaterThan(0);
      expect(Array.isArray(tags)).toBe(true);
    });

    it('should throw error for invalid category', () => {
      expect(() => {
        getTagsByCategory('Food & Cooking', 'Invalid Category');
      }).toThrow('not found');
    });
  });

  describe('isValidTag', () => {
    it('should return true for valid tags', () => {
      expect(isValidTag('bread-baking')).toBe(true);
      expect(isValidTag('grilling-recipes')).toBe(true);
      expect(isValidTag('vegetable-gardening')).toBe(true);
    });

    it('should return false for invalid tags', () => {
      expect(isValidTag('invalid-tag')).toBe(false);
      expect(isValidTag('hallucinated-tag')).toBe(false);
      expect(isValidTag('')).toBe(false);
    });
  });

  describe('validateTags', () => {
    it('should separate valid and invalid tags', () => {
      const input = ['bread-baking', 'invalid-tag', 'grilling-recipes', 'hallucinated'];
      const result = validateTags(input);

      expect(result.valid).toContain('bread-baking');
      expect(result.valid).toContain('grilling-recipes');
      expect(result.invalid).toContain('invalid-tag');
      expect(result.invalid).toContain('hallucinated');
    });

    it('should handle empty array', () => {
      const result = validateTags([]);

      expect(result.valid).toEqual([]);
      expect(result.invalid).toEqual([]);
    });

    it('should handle all valid tags', () => {
      const result = validateTags(['bread-baking', 'grilling-recipes']);

      expect(result.valid).toHaveLength(2);
      expect(result.invalid).toHaveLength(0);
    });

    it('should handle all invalid tags', () => {
      const result = validateTags(['invalid1', 'invalid2']);

      expect(result.valid).toHaveLength(0);
      expect(result.invalid).toHaveLength(2);
    });
  });

  describe('getCanonicalTag', () => {
    it('should return canonical tag for synonym', () => {
      const taxonomy = getTaxonomy();
      const firstSynonym = Object.keys(taxonomy.synonym_mappings)[0];

      if (firstSynonym) {
        const canonical = getCanonicalTag(firstSynonym);
        expect(canonical).toBe(taxonomy.synonym_mappings[firstSynonym]);
      }
    });

    it('should return same tag if already canonical', () => {
      const canonical = getCanonicalTag('bread-baking');
      expect(canonical).toBe('bread-baking');
    });

    it('should throw error for unknown tag', () => {
      expect(() => {
        getCanonicalTag('totally-invalid-tag');
      }).toThrow('not found in taxonomy');
    });
  });

  describe('formatTaxonomyForPrompt', () => {
    it('should format as flat list', () => {
      const formatted = formatTaxonomyForPrompt('flat');

      expect(formatted).toContain('bread-baking');
      expect(formatted).toContain(',');
      expect(typeof formatted).toBe('string');
    });

    it('should format as grouped by vertical', () => {
      const formatted = formatTaxonomyForPrompt('grouped');

      expect(formatted).toContain('FOOD & COOKING');
      expect(formatted).toContain('HOME & GARDEN');
      expect(formatted).toContain(':');
      expect(typeof formatted).toBe('string');
    });

    it('should default to grouped format', () => {
      const withDefault = formatTaxonomyForPrompt();
      const withExplicit = formatTaxonomyForPrompt('grouped');

      expect(withDefault).toBe(withExplicit);
    });
  });

  describe('getTaxonomyStats', () => {
    it('should return taxonomy statistics', () => {
      const stats = getTaxonomyStats();

      expect(stats.version).toBe('1.0.0');
      expect(stats.totalTags).toBe(500);
      expect(stats.verticals).toHaveLength(5);
    });

    it('should include tag counts per vertical', () => {
      const stats = getTaxonomyStats();

      stats.verticals.forEach(vertical => {
        expect(vertical.name).toBeDefined();
        expect(vertical.tagCount).toBeGreaterThan(0);
      });

      // Verify total adds up
      const totalFromVerticals = stats.verticals.reduce(
        (sum, v) => sum + v.tagCount,
        0
      );
      expect(totalFromVerticals).toBe(stats.totalTags);
    });
  });

  describe('Error handling', () => {
    it('should log an error and throw a descriptive message when taxonomy file is not found', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      try {
        expect(() => getTaxonomy()).toThrow('Taxonomy file not found');
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining('Taxonomy file not found'),
          expect.any(Array)
        );
      } finally {
        consoleErrorSpy.mockRestore();
      }
    });
  });

  describe('Performance', () => {
    it('should load taxonomy quickly (< 100ms)', () => {
      clearCache();
      const start = Date.now();
      getTaxonomy();
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(100);
    });

    it('should serve from cache instantly (< 1ms)', () => {
      getTaxonomy(); // First load to populate cache

      const start = Date.now();
      getTaxonomy(); // Second load from cache
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1);
    });
  });
});
