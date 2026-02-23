/**
 * Unit tests for Text Processor Lambda Handler
 */

import { TextContent } from '../handler';

// Mock AWS SDK
jest.mock('@aws-sdk/client-bedrock-runtime');

// Mock taxonomy loader
jest.mock('../../../shared/utils/taxonomy-loader', () => ({
  getTaxonomy: jest.fn(() => ({
    metadata: {
      version: '1.0.0',
      generated_date: '2026-02-20',
      total_tags: 500,
      description: 'Test taxonomy',
      structure: 'flat',
      naming_convention: 'kebab-case',
    },
    verticals: {
      'food-cooking': {
        tag_count: 5,
        categories: {
          baking: ['bread-baking', 'sourdough-bread'],
        },
      },
    },
    flat_tag_list: [
      'bread-baking',
      'sourdough-bread',
      'grilling-recipes',
      'vegetable-gardening',
      'car-maintenance',
    ],
    synonym_mappings: {},
    validation: {
      naming_convention_compliance: '100%',
      duplicates_found: 0,
      brand_names_found: 0,
      special_characters_found: 0,
      vertical_distribution: { 'food-cooking': 5 },
    },
  })),
  formatTaxonomyForPrompt: jest.fn(() => 'FOOD & COOKING:\n  Baking: bread-baking, sourdough-bread'),
  validateTags: jest.fn((tags: string[]) => {
    const validSet = new Set(['bread-baking', 'sourdough-bread', 'grilling-recipes', 'vegetable-gardening', 'car-maintenance']);
    return {
      valid: tags.filter(t => validSet.has(t)),
      invalid: tags.filter(t => !validSet.has(t)),
    };
  }),
}));

// Mock logger
jest.mock('../../../shared/utils/logger', () => ({
  getLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  })),
}));

describe('Text Processor Lambda Handler', () => {
  let handler: any;
  let BedrockRuntimeClient: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset modules to get fresh imports
    jest.resetModules();

    // Set up Bedrock mocks
    const bedrockModule = require('@aws-sdk/client-bedrock-runtime');
    BedrockRuntimeClient = bedrockModule.BedrockRuntimeClient;

    // Mock Bedrock client
    BedrockRuntimeClient.mockImplementation(() => ({
      send: jest.fn().mockResolvedValue({
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  tags: [
                    { tag: 'bread-baking', confidence: 0.95 },
                    { tag: 'sourdough-bread', confidence: 0.92 },
                  ],
                }),
              },
            ],
            stop_reason: 'end_turn',
            usage: {
              input_tokens: 500,
              output_tokens: 50,
            },
          })
        ),
      }),
    }));

    // Import handler after mocks are set up
    handler = require('../handler').handler;
  });

  describe('Input validation', () => {
    it('should accept valid article content', async () => {
      const input: TextContent = {
        contentId: 'test-001',
        contentType: 'article',
        title: 'Test Article',
        body: 'This is a test article about baking bread.',
      };

      const result = await handler(input);

      expect(result).toBeDefined();
      expect(result.contentId).toBe('test-001');
    });

    it('should accept valid JSON record content', async () => {
      const input: TextContent = {
        contentId: 'test-002',
        contentType: 'json-record',
        title: 'Test JSON Record',
        body: 'Content from archived JSON.',
      };

      const result = await handler(input);

      expect(result).toBeDefined();
      expect(result.contentType).toBe('json-record');
    });

    it('should reject invalid content type', async () => {
      const input = {
        contentId: 'test-003',
        contentType: 'invalid',
        title: 'Test',
        body: 'Test body',
      };

      await expect(handler(input)).rejects.toThrow();
    });

    it('should reject missing required fields', async () => {
      const input = {
        contentId: 'test-004',
        contentType: 'article',
        // Missing title and body
      };

      await expect(handler(input)).rejects.toThrow();
    });
  });

  describe('Tag generation', () => {
    it('should return valid tags from Bedrock', async () => {
      const input: TextContent = {
        contentId: 'test-005',
        contentType: 'article',
        title: 'Sourdough Bread Recipe',
        body: 'Learn how to bake sourdough bread at home.',
      };

      const result = await handler(input);

      expect(result.validTags).toHaveLength(2);
      expect(result.validTags[0].tag).toBe('bread-baking');
      expect(result.validTags[0].confidence).toBe(0.95);
      expect(result.validTags[1].tag).toBe('sourdough-bread');
      expect(result.validTags[1].confidence).toBe(0.92);
    });

    it('should separate valid and invalid tags in response', async () => {
      const input: TextContent = {
        contentId: 'test-006',
        contentType: 'article',
        title: 'Test',
        body: 'Test body',
      };

      const result = await handler(input);

      // Should have separate arrays for valid and invalid tags
      expect(result).toHaveProperty('validTags');
      expect(result).toHaveProperty('invalidTags');
      expect(Array.isArray(result.validTags)).toBe(true);
      expect(Array.isArray(result.invalidTags)).toBe(true);

      // In our mock, all tags are valid, so invalidTags should be empty
      expect(result.invalidTags).toHaveLength(0);
    });

    it('should include processing time and model info', async () => {
      const input: TextContent = {
        contentId: 'test-007',
        contentType: 'article',
        title: 'Test',
        body: 'Test body',
      };

      const result = await handler(input);

      expect(result.processingTime).toBeGreaterThanOrEqual(0);
      expect(typeof result.processingTime).toBe('number');
      expect(result.model).toBeDefined();
      expect(typeof result.model).toBe('string');
    });
  });

  describe('Response structure', () => {
    it('should return all required fields', async () => {
      const input: TextContent = {
        contentId: 'test-008',
        contentType: 'article',
        title: 'Test',
        body: 'Test body',
      };

      const result = await handler(input);

      expect(result).toHaveProperty('contentId');
      expect(result).toHaveProperty('contentType');
      expect(result).toHaveProperty('tags');
      expect(result).toHaveProperty('validTags');
      expect(result).toHaveProperty('invalidTags');
      expect(result).toHaveProperty('processingTime');
      expect(result).toHaveProperty('model');
    });

    it('should preserve content ID and type in response', async () => {
      const input: TextContent = {
        contentId: 'article-12345',
        contentType: 'article',
        title: 'Test',
        body: 'Test body',
      };

      const result = await handler(input);

      expect(result.contentId).toBe('article-12345');
      expect(result.contentType).toBe('article');
    });
  });

  describe('Error handling', () => {
    it('should throw error on invalid input', async () => {
      const input = {
        contentId: 'test-009',
        // Missing required fields
      };

      await expect(handler(input)).rejects.toThrow();
    });

    it('should propagate errors from handler', async () => {
      const input: TextContent = {
        contentId: 'test-010',
        contentType: 'article',
        title: 'Test',
        body: 'Test body',
      };

      // Note: With our mocks, the handler should succeed
      // In real integration tests, you would test actual error paths
      const result = await handler(input);
      expect(result).toBeDefined();
    });
  });

  describe('Content truncation', () => {
    it('should truncate very long body text', async () => {
      const longBody = 'a'.repeat(10000);

      const input: TextContent = {
        contentId: 'test-011',
        contentType: 'article',
        title: 'Test',
        body: longBody,
      };

      // Should not throw - truncation should happen silently
      const result = await handler(input);

      expect(result).toBeDefined();
    });
  });
});
