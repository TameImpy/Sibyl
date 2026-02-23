#!/usr/bin/env ts-node

/**
 * Manual test of text processor Lambda
 *
 * Note: This will make actual calls to AWS Bedrock if credentials are configured.
 * To run in dry-run mode without Bedrock calls, set DRY_RUN=true
 */

import { handler, TextContent } from './src/lambdas/text-processor/handler';

const DRY_RUN = process.env.DRY_RUN === 'true';

// Sample test content
const sampleArticle: TextContent = {
  contentId: 'test-001',
  contentType: 'article',
  title: 'Easy Sourdough Bread Recipe for Beginners',
  body: `
    Learning to bake sourdough bread at home is easier than you think! This beginner-friendly
    recipe will guide you through creating a beautiful, crusty loaf with a tangy flavor and
    chewy texture. We'll cover everything from maintaining your sourdough starter to shaping
    and baking the perfect loaf.

    Ingredients:
    - Active sourdough starter
    - Bread flour
    - Water
    - Salt

    The key to great sourdough is patience and practice. You'll need to feed your starter
    regularly and give the dough plenty of time to rise and develop flavor. The fermentation
    process is what gives sourdough its distinctive taste and makes it easier to digest than
    regular bread.

    This recipe is perfect for weekend baking when you have time to tend to the dough. The
    result is a homemade loaf that's far superior to anything you can buy at the store. Plus,
    the smell of fresh-baked bread filling your kitchen is absolutely amazing!
  `,
  metadata: {
    author: 'Test Author',
    publishDate: '2026-02-20',
  },
};

console.log('Testing Text Processor Lambda...\n');

if (DRY_RUN) {
  console.log('⚠️  DRY RUN MODE - Not calling Bedrock\n');
  console.log('Input:');
  console.log(`  Content ID: ${sampleArticle.contentId}`);
  console.log(`  Type: ${sampleArticle.contentType}`);
  console.log(`  Title: ${sampleArticle.title}`);
  console.log(`  Body length: ${sampleArticle.body.length} characters\n`);

  console.log('Expected tags for this content:');
  console.log('  - bread-baking (high confidence)');
  console.log('  - sourdough-bread (high confidence)');
  console.log('  - yeast-baking (medium confidence)');
  console.log('  - homemade-staples (medium confidence)');
  console.log('  - weekend-cooking (low-medium confidence)\n');

  console.log('To run with actual Bedrock calls:');
  console.log('  1. Configure AWS credentials');
  console.log('  2. Run: npx ts-node test-text-processor.ts\n');

  process.exit(0);
}

async function test() {
  try {
    console.log('Input:');
    console.log(`  Content ID: ${sampleArticle.contentId}`);
    console.log(`  Type: ${sampleArticle.contentType}`);
    console.log(`  Title: ${sampleArticle.title}`);
    console.log(`  Body length: ${sampleArticle.body.length} characters\n`);

    console.log('Calling text processor Lambda handler...\n');

    const result = await handler(sampleArticle);

    console.log('✅ Tagging complete!\n');
    console.log('Results:');
    console.log(`  Processing time: ${result.processingTime}ms`);
    console.log(`  Model: ${result.model}`);
    console.log(`  Total tags returned: ${result.tags.length}`);
    console.log(`  Valid tags: ${result.validTags.length}`);
    console.log(`  Invalid tags: ${result.invalidTags.length}\n`);

    if (result.validTags.length > 0) {
      console.log('Valid tags:');
      result.validTags
        .sort((a, b) => b.confidence - a.confidence)
        .forEach(tag => {
          console.log(`  - ${tag.tag} (${(tag.confidence * 100).toFixed(0)}% confidence)`);
        });
      console.log('');
    }

    if (result.invalidTags.length > 0) {
      console.log('⚠️  Invalid tags (not in taxonomy):');
      result.invalidTags.forEach(tag => {
        console.log(`  - ${tag}`);
      });
      console.log('');
    }

    console.log('Full response:');
    console.log(JSON.stringify(result, null, 2));

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

test();
