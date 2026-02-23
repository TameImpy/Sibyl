/**
 * Text Content Tagging Lambda Handler
 *
 * Processes text content (articles, JSON records) and generates taxonomy tags
 * using AWS Bedrock Claude.
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  InvokeModelCommandInput,
} from '@aws-sdk/client-bedrock-runtime';
import { getTaxonomy, formatTaxonomyForPrompt, validateTags } from '../../shared/utils/taxonomy-loader';
import { getLogger } from '../../shared/utils/logger';
import { z } from 'zod';

const logger = getLogger();

// Input validation schema
const TextContentSchema = z.object({
  contentId: z.string(),
  contentType: z.enum(['article', 'json-record']),
  title: z.string(),
  body: z.string(),
  metadata: z.record(z.unknown()).optional(),
});

export type TextContent = z.infer<typeof TextContentSchema>;

// Output schema
const TagResultSchema = z.object({
  tag: z.string(),
  confidence: z.number().min(0).max(1),
});

export type TagResult = z.infer<typeof TagResultSchema>;

// Response schema
const TaggingResponseSchema = z.object({
  contentId: z.string(),
  contentType: z.string(),
  tags: z.array(TagResultSchema),
  validTags: z.array(TagResultSchema),
  invalidTags: z.array(z.string()),
  processingTime: z.number(),
  model: z.string(),
});

export type TaggingResponse = z.infer<typeof TaggingResponseSchema>;

// Initialize Bedrock client
const bedrock = new BedrockRuntimeClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

const CLAUDE_MODEL_ID = 'anthropic.claude-3-5-sonnet-20241022-v2:0';
const MAX_BODY_LENGTH = 8000; // Claude Sonnet can handle much more, but we'll limit for cost

/**
 * Build the tagging prompt with taxonomy injection
 */
function buildTaggingPrompt(content: TextContent, taxonomyText: string): string {
  // Truncate body if needed
  const truncatedBody = content.body.length > MAX_BODY_LENGTH
    ? content.body.substring(0, MAX_BODY_LENGTH) + '...'
    : content.body;

  return `You are a content tagging expert. Your task is to analyze the provided content and assign relevant tags from ONLY the controlled taxonomy provided below.

INSTRUCTIONS:
1. Read and understand the content carefully
2. Identify the main topics, themes, subjects, and activities discussed
3. Assign ONLY tags from the provided taxonomy that are relevant
4. For each tag, provide a confidence score between 0 and 1:
   - 0.9-1.0: Tag is central to the content
   - 0.7-0.89: Tag is clearly relevant but not central
   - 0.5-0.69: Tag is mentioned or somewhat relevant
   - Below 0.5: Do not include (too weak)
5. Return 3-10 tags maximum, prioritizing quality over quantity
6. DO NOT create new tags or use tags not in the taxonomy
7. Return ONLY valid JSON in the exact format specified

CONTROLLED TAXONOMY:
${taxonomyText}

CONTENT TO TAG:
Title: ${content.title}

Body: ${truncatedBody}

RESPONSE FORMAT (JSON only, no other text):
{
  "tags": [
    {"tag": "example-tag-name", "confidence": 0.95},
    {"tag": "another-tag", "confidence": 0.82}
  ]
}`;
}

/**
 * Call AWS Bedrock Claude to generate tags
 */
async function callBedrockClaude(prompt: string): Promise<TagResult[]> {
  const payload = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 1000,
    temperature: 0.3, // Lower temperature for more consistent tagging
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  };

  const input: InvokeModelCommandInput = {
    modelId: CLAUDE_MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(payload),
  };

  const command = new InvokeModelCommand(input);
  const response = await bedrock.send(command);

  // Parse response
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));

  logger.info('Bedrock response', {
    stopReason: responseBody.stop_reason,
    inputTokens: responseBody.usage?.input_tokens,
    outputTokens: responseBody.usage?.output_tokens,
  });

  // Extract the text content from Claude's response
  const contentBlock = responseBody.content[0];
  if (contentBlock.type !== 'text') {
    throw new Error('Expected text response from Claude');
  }

  const text = contentBlock.text.trim();

  // Parse JSON from response
  // Claude may wrap JSON in markdown code blocks, so handle that
  const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/) || text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Could not extract JSON from Claude response');
  }

  const jsonText = jsonMatch[1] || jsonMatch[0];
  const parsed = JSON.parse(jsonText);

  // Validate response structure
  if (!parsed.tags || !Array.isArray(parsed.tags)) {
    throw new Error('Invalid response structure from Claude');
  }

  return parsed.tags.map((t: any) => ({
    tag: t.tag,
    confidence: t.confidence,
  }));
}

/**
 * Main Lambda handler
 */
export async function handler(event: any): Promise<TaggingResponse> {
  const startTime = Date.now();

  try {
    // Parse and validate input
    const content = TextContentSchema.parse(event);

    logger.info('Processing text content', {
      contentId: content.contentId,
      contentType: content.contentType,
      titleLength: content.title.length,
      bodyLength: content.body.length,
    });

    // Load taxonomy
    const taxonomy = getTaxonomy();
    const taxonomyText = formatTaxonomyForPrompt('grouped');

    logger.info('Loaded taxonomy', {
      version: taxonomy.metadata.version,
      totalTags: taxonomy.metadata.total_tags,
    });

    // Build prompt
    const prompt = buildTaggingPrompt(content, taxonomyText);

    // Call Bedrock
    const rawTags = await callBedrockClaude(prompt);

    logger.info('Received tags from Claude', {
      count: rawTags.length,
      tags: rawTags.map(t => t.tag),
    });

    // Validate tags against taxonomy
    const tagNames = rawTags.map(t => t.tag);
    const validation = validateTags(tagNames);

    // Separate valid and invalid
    const validTags = rawTags.filter(t => validation.valid.includes(t.tag));
    const invalidTagNames = rawTags
      .filter(t => validation.invalid.includes(t.tag))
      .map(t => t.tag);

    if (invalidTagNames.length > 0) {
      logger.warn('Claude returned invalid tags', {
        invalidTags: invalidTagNames,
        contentId: content.contentId,
      });
    }

    const processingTime = Date.now() - startTime;

    const response: TaggingResponse = {
      contentId: content.contentId,
      contentType: content.contentType,
      tags: rawTags,
      validTags,
      invalidTags: invalidTagNames,
      processingTime,
      model: CLAUDE_MODEL_ID,
    };

    logger.info('Tagging complete', {
      contentId: content.contentId,
      validTagCount: validTags.length,
      invalidTagCount: invalidTagNames.length,
      processingTime,
    });

    return response;
  } catch (error) {
    logger.error('Error processing text content', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    throw error;
  }
}
