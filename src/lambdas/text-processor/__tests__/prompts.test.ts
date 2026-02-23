/**
 * Unit tests for the three-layer prompt architecture (prompts.ts)
 */

import { buildTaggingPrompt, truncateBodyText, MAX_BODY_CHARS, PromptLayers } from '../prompts';
import { ContentType } from '../../../shared/types';

describe('truncateBodyText', () => {
  it('returns text unchanged when under the limit', () => {
    const text = 'short text';
    expect(truncateBodyText(text)).toBe(text);
  });

  it('truncates and appends marker when over MAX_BODY_CHARS', () => {
    const longText = 'a'.repeat(MAX_BODY_CHARS + 100);
    const result = truncateBodyText(longText);
    expect(result.length).toBeLessThan(longText.length);
    expect(result).toContain('[truncated');
    expect(result.startsWith('a'.repeat(MAX_BODY_CHARS))).toBe(true);
  });

  it('does not truncate text at exactly MAX_BODY_CHARS', () => {
    const text = 'b'.repeat(MAX_BODY_CHARS);
    expect(truncateBodyText(text)).toBe(text);
  });
});

describe('buildTaggingPrompt', () => {
  const taxonomyText = 'FOOD & COOKING:\n  Baking: bread-baking, sourdough-bread';

  it('returns both system and userMessage fields', () => {
    const result: PromptLayers = buildTaggingPrompt(
      ContentType.ARTICLE,
      'Test Article',
      'Some body text',
      taxonomyText,
      10
    );

    expect(result).toHaveProperty('system');
    expect(result).toHaveProperty('userMessage');
    expect(typeof result.system).toBe('string');
    expect(typeof result.userMessage).toBe('string');
  });

  it('Layer 1 (system) contains role, output format, and constraints', () => {
    const { system } = buildTaggingPrompt(
      ContentType.ARTICLE,
      'Title',
      'Body',
      taxonomyText,
      10
    );

    expect(system).toContain('content tagging system');
    expect(system).toContain('CONSTRAINTS');
    expect(system).toContain('OUTPUT FORMAT');
    expect(system).toContain('"tags"');
  });

  it('Layer 2 (content-type) contains article-specific guidance for ARTICLE', () => {
    const { userMessage } = buildTaggingPrompt(
      ContentType.ARTICLE,
      'Title',
      'Body',
      taxonomyText,
      10
    );

    expect(userMessage).toContain('Web Article');
  });

  it('Layer 2 (content-type) contains JSON-specific guidance for JSON', () => {
    const { userMessage } = buildTaggingPrompt(
      ContentType.JSON,
      'Title',
      'Body',
      taxonomyText,
      10
    );

    expect(userMessage).toContain('JSON Record');
  });

  it('Layer 2 (content-type) contains podcast-specific guidance for PODCAST', () => {
    const { userMessage } = buildTaggingPrompt(
      ContentType.PODCAST,
      'Title',
      'Body',
      taxonomyText,
      10
    );

    expect(userMessage).toContain('Podcast');
  });

  it('Layer 3 (runtime) injects taxonomy text into userMessage', () => {
    const { userMessage } = buildTaggingPrompt(
      ContentType.ARTICLE,
      'Bread Recipe',
      'Body content',
      taxonomyText,
      10
    );

    expect(userMessage).toContain(taxonomyText);
  });

  it('Layer 3 (runtime) injects title and body into userMessage', () => {
    const { userMessage } = buildTaggingPrompt(
      ContentType.ARTICLE,
      'Bread Recipe',
      'How to bake sourdough',
      taxonomyText,
      10
    );

    expect(userMessage).toContain('Bread Recipe');
    expect(userMessage).toContain('How to bake sourdough');
  });

  it('Layer 3 (runtime) injects maxTags into userMessage', () => {
    const { userMessage } = buildTaggingPrompt(
      ContentType.ARTICLE,
      'Title',
      'Body',
      taxonomyText,
      7
    );

    expect(userMessage).toContain('7');
  });

  it('truncates long body text before injecting into Layer 3', () => {
    const longBody = 'x'.repeat(MAX_BODY_CHARS + 500);
    const { userMessage } = buildTaggingPrompt(
      ContentType.ARTICLE,
      'Title',
      longBody,
      taxonomyText,
      10
    );

    expect(userMessage).toContain('[truncated');
    // Full long text should NOT be present
    expect(userMessage.includes(longBody)).toBe(false);
  });
});
