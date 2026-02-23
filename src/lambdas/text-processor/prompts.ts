/**
 * Three-layer prompt architecture for content tagging.
 *
 * Layer 1 (system)     — role, output format, constraints (stable across all requests)
 * Layer 2 (contentType)— content-type-specific instructions (changes per content type)
 * Layer 3 (runtime)    — taxonomy injection + actual content (changes per request)
 *
 * Layers 1 goes into the Claude `system` field.
 * Layers 2 + 3 are combined into the user message body.
 */

import { ContentType } from '../../shared/types';

export interface PromptLayers {
  /** Layer 1: passed as the `system` field in the Claude API request */
  system: string;
  /** Layers 2 + 3 combined: passed as the user message content */
  userMessage: string;
}

// Max body characters to send to the model.
// ~32,000 chars ≈ 8,000 tokens at 4 chars/token — genuine 8k-token window.
// Lower this for tighter cost control; document any change here.
export const MAX_BODY_CHARS = 32_000;

export function truncateBodyText(text: string): string {
  if (text.length <= MAX_BODY_CHARS) return text;
  return text.substring(0, MAX_BODY_CHARS) + '... [truncated for cost control]';
}

// ---------------------------------------------------------------------------
// Layer 1 — System prompt
// ---------------------------------------------------------------------------

function buildSystemPrompt(): string {
  return `You are an expert content tagging system for a media company.
Your task is to analyze content and assign relevant tags from a controlled taxonomy.

CONSTRAINTS:
- Assign ONLY tags that exist exactly as listed in the provided taxonomy. Never invent new tags.
- Return 3-10 tags maximum, prioritising quality over quantity.
- Confidence scoring guide:
  - 0.9–1.0: Tag is central to the content
  - 0.7–0.89: Tag is clearly relevant but not the main focus
  - 0.5–0.69: Tag is mentioned or somewhat relevant
  - Below 0.5: Do not include

OUTPUT FORMAT (JSON only, no markdown, no explanation):
{
  "tags": [
    {"tag": "example-tag-name", "confidence": 0.95},
    {"tag": "another-tag", "confidence": 0.82}
  ]
}`;
}

// ---------------------------------------------------------------------------
// Layer 2 — Content-type instructions
// ---------------------------------------------------------------------------

function buildContentTypePrompt(contentType: ContentType): string {
  switch (contentType) {
    case ContentType.ARTICLE:
      return `CONTENT TYPE: Web Article
Focus on:
- Main topics and themes of the article
- Specific techniques, recipes, or step-by-step guidance mentioned
- Products, ingredients, or tools specifically featured
- Reader intent (e.g. beginner vs expert, shopping vs learning)`;

    case ContentType.JSON:
      return `CONTENT TYPE: Archived JSON Record
Focus on:
- Primary subject matter indicated by the structured data
- Category or classification fields present in the record
- Key descriptors and attributes`;

    case ContentType.PODCAST:
      return `CONTENT TYPE: Podcast Transcript
Focus on:
- Major discussion topics and episode segments
- Guest expertise areas if a guest appears
- Products, services, or techniques specifically mentioned
- Recurring themes across the episode`;

    case ContentType.VIDEO:
      return `CONTENT TYPE: Video
Focus on:
- Visual subjects and activities depicted
- Topics and demonstrations described in the transcript/description
- Products or locations prominently featured`;

    default:
      return `CONTENT TYPE: Text Content
Focus on the main topics, themes, and subjects discussed.`;
  }
}

// ---------------------------------------------------------------------------
// Layer 3 — Runtime context (taxonomy + content)
// ---------------------------------------------------------------------------

function buildRuntimePrompt(
  title: string,
  bodyText: string,
  taxonomyText: string,
  maxTags: number
): string {
  return `CONTROLLED TAXONOMY (use ONLY these tags):
${taxonomyText}

CONTENT TO TAG (return up to ${maxTags} tags):
Title: ${title}

Body:
${bodyText}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the three-layer tagging prompt for the Claude Messages API.
 *
 * @param contentType  Content type driving Layer 2 instructions.
 * @param title        Content title injected into Layer 3.
 * @param bodyText     Content body (will be truncated if over MAX_BODY_CHARS).
 * @param taxonomyText Formatted taxonomy string from formatTaxonomyForPrompt().
 * @param maxTags      Max number of tags the model should return.
 */
export function buildTaggingPrompt(
  contentType: ContentType,
  title: string,
  bodyText: string,
  taxonomyText: string,
  maxTags: number
): PromptLayers {
  const system = buildSystemPrompt();
  const contentTypeSection = buildContentTypePrompt(contentType);
  const runtimeSection = buildRuntimePrompt(
    title,
    truncateBodyText(bodyText),
    taxonomyText,
    maxTags
  );

  const userMessage = `${contentTypeSection}\n\n${runtimeSection}`;

  return { system, userMessage };
}
