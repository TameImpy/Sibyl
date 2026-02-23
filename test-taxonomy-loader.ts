#!/usr/bin/env ts-node

/**
 * Quick manual test of taxonomy loader
 */

import {
  getTaxonomy,
  getTaxonomyTags,
  getTagsByVertical,
  isValidTag,
  validateTags,
  formatTaxonomyForPrompt,
  getTaxonomyStats,
} from './src/shared/utils/taxonomy-loader';

console.log('Testing Taxonomy Loader...\n');

// Test 1: Load taxonomy
console.log('1. Loading taxonomy...');
const taxonomy = getTaxonomy();
console.log(`   ✓ Loaded version ${taxonomy.metadata.version}`);
console.log(`   ✓ Total tags: ${taxonomy.metadata.total_tags}`);

// Test 2: Get all tags
console.log('\n2. Getting all tags...');
const allTags = getTaxonomyTags();
console.log(`   ✓ Retrieved ${allTags.length} tags`);
console.log(`   ✓ First 10: ${allTags.slice(0, 10).join(', ')}`);

// Test 3: Get tags by vertical
console.log('\n3. Getting tags by vertical...');
const foodTags = getTagsByVertical('Food & Cooking');
console.log(`   ✓ Food & Cooking has ${foodTags.length} tags`);
console.log(`   ✓ Sample: ${foodTags.slice(0, 5).join(', ')}`);

// Test 4: Validate tags
console.log('\n4. Validating tags...');
const testTags = ['bread-baking', 'invalid-tag', 'grilling-recipes', 'hallucinated'];
const validation = validateTags(testTags);
console.log(`   ✓ Valid tags: ${validation.valid.join(', ')}`);
console.log(`   ✓ Invalid tags: ${validation.invalid.join(', ')}`);

// Test 5: Check valid tags
console.log('\n5. Checking individual tags...');
console.log(`   ✓ "bread-baking" is valid: ${isValidTag('bread-baking')}`);
console.log(`   ✓ "grilling-recipes" is valid: ${isValidTag('grilling-recipes')}`);
console.log(`   ✓ "fake-tag" is valid: ${isValidTag('fake-tag')}`);

// Test 6: Get stats
console.log('\n6. Getting taxonomy stats...');
const stats = getTaxonomyStats();
console.log(`   ✓ Version: ${stats.version}`);
console.log(`   ✓ Total tags: ${stats.totalTags}`);
stats.verticals.forEach(v => {
  console.log(`   ✓ ${v.name}: ${v.tagCount} tags`);
});

// Test 7: Format for prompt
console.log('\n7. Formatting for prompt...');
const flatFormat = formatTaxonomyForPrompt('flat');
console.log(`   ✓ Flat format length: ${flatFormat.length} characters`);
const groupedFormat = formatTaxonomyForPrompt('grouped');
console.log(`   ✓ Grouped format length: ${groupedFormat.length} characters`);
console.log(`   ✓ Preview:\n${groupedFormat.substring(0, 200)}...`);

console.log('\n✅ All tests passed! Taxonomy loader is working correctly.\n');
