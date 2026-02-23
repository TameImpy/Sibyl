/**
 * Taxonomy Loader Utility
 *
 * Loads and caches the controlled taxonomy from taxonomy-v1.json.
 * Used by Lambda functions to validate tags and inject taxonomy into prompts.
 */

import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';

// Taxonomy schemas matching actual taxonomy-v1.json structure
const MetadataSchema = z.object({
  version: z.string(),
  generated_date: z.string(),
  total_tags: z.number(),
  description: z.string(),
  structure: z.string(),
  naming_convention: z.string(),
});

// Categories are objects where keys are category names (e.g., "cooking-methods")
// and values are arrays of tag strings
const CategoriesSchema = z.record(z.array(z.string()));

// Verticals are objects where keys are vertical slugs (e.g., "food-cooking")
// and values contain tag_count and categories object
const VerticalSchema = z.object({
  tag_count: z.number(),
  categories: CategoriesSchema,
});

const TaxonomySchema = z.object({
  metadata: MetadataSchema,
  verticals: z.record(VerticalSchema), // Object with keys like "food-cooking"
  flat_tag_list: z.array(z.string()),
  synonym_mappings: z.record(z.string()),
  validation: z.object({
    naming_convention_compliance: z.string(),
    duplicates_found: z.number(),
    brand_names_found: z.number(),
    special_characters_found: z.number(),
    vertical_distribution: z.record(z.number()),
  }),
});

export type Taxonomy = z.infer<typeof TaxonomySchema>;
export type Metadata = z.infer<typeof MetadataSchema>;
export type Vertical = z.infer<typeof VerticalSchema>;
export type Categories = z.infer<typeof CategoriesSchema>;

/**
 * In-memory cache for taxonomy
 * Populated on Lambda cold start, persists across warm invocations
 */
let cachedTaxonomy: Taxonomy | null = null;

/**
 * Load taxonomy from file system
 * Searches in multiple potential locations
 */
function loadTaxonomyFromFile(): Taxonomy {
  const possiblePaths = [
    // When running in Lambda (deployed)
    '/opt/data/taxonomy/taxonomy-v1.json',
    // When running locally from project root
    path.join(process.cwd(), 'data/taxonomy/taxonomy-v1.json'),
    // When running from poc directory
    path.join(process.cwd(), '../data/taxonomy/taxonomy-v1.json'),
    // Absolute path
    '/Users/matthewrance/Documents/Sibyl/data/taxonomy/taxonomy-v1.json',
  ];

  for (const filePath of possiblePaths) {
    if (fs.existsSync(filePath)) {
      try {
        const rawData = fs.readFileSync(filePath, 'utf-8');
        const parsedData = JSON.parse(rawData);

        // Validate schema
        const taxonomy = TaxonomySchema.parse(parsedData);

        console.log(`✓ Loaded taxonomy v${taxonomy.metadata.version} from ${filePath}`);
        console.log(`  Total tags: ${taxonomy.metadata.total_tags}`);

        return taxonomy;
      } catch (error) {
        console.error(`Failed to load taxonomy from ${filePath}:`, error);
        throw new Error(`Invalid taxonomy file at ${filePath}: ${error}`);
      }
    }
  }

  console.error('Taxonomy file not found. Searched paths:', possiblePaths);
  throw new Error('Taxonomy file not found. Searched paths: ' + possiblePaths.join(', '));
}

/**
 * Get taxonomy (loads and caches on first call)
 */
export function getTaxonomy(): Taxonomy {
  if (cachedTaxonomy === null) {
    cachedTaxonomy = loadTaxonomyFromFile();
  }
  return cachedTaxonomy;
}

/**
 * Get all taxonomy tags as flat list
 */
export function getTaxonomyTags(): string[] {
  const taxonomy = getTaxonomy();
  return taxonomy.flat_tag_list;
}

/**
 * Get tags for a specific vertical
 * @param verticalName - Can be the slug (e.g., "food-cooking") or display name (e.g., "Food & Cooking")
 */
export function getTagsByVertical(verticalName: string): string[] {
  const taxonomy = getTaxonomy();

  // Normalize input to match slug format (lowercase, replace spaces/& with hyphens)
  const normalizedInput = verticalName.toLowerCase().replace(/\s+&\s+/g, '-').replace(/\s+/g, '-');

  // Find vertical by slug
  const verticalKey = Object.keys(taxonomy.verticals).find(key =>
    key === normalizedInput
  );

  if (!verticalKey) {
    const availableVerticals = Object.keys(taxonomy.verticals).join(', ');
    throw new Error(
      `Vertical "${verticalName}" not found. Available verticals: ${availableVerticals}`
    );
  }

  const vertical = taxonomy.verticals[verticalKey];

  // Extract all tags from all categories in this vertical
  const tags: string[] = [];
  for (const categoryTags of Object.values(vertical.categories)) {
    tags.push(...categoryTags);
  }

  return tags;
}

/**
 * Get tags for a specific category within a vertical
 * @param verticalName - Vertical slug (e.g., "food-cooking") or display name (e.g., "Food & Cooking")
 * @param categoryName - Category slug (e.g., "cooking-methods") or display name
 */
export function getTagsByCategory(verticalName: string, categoryName: string): string[] {
  const taxonomy = getTaxonomy();

  // Normalize vertical name
  const normalizedVertical = verticalName.toLowerCase().replace(/\s+&\s+/g, '-').replace(/\s+/g, '-');

  // Find vertical by slug
  const verticalKey = Object.keys(taxonomy.verticals).find(key =>
    key === normalizedVertical
  );

  if (!verticalKey) {
    throw new Error(`Vertical "${verticalName}" not found`);
  }

  const vertical = taxonomy.verticals[verticalKey];

  // Normalize category name
  const normalizedCategory = categoryName.toLowerCase().replace(/\s+/g, '-');

  // Find category by slug
  const categoryKey = Object.keys(vertical.categories).find(key =>
    key === normalizedCategory
  );

  if (!categoryKey) {
    const availableCategories = Object.keys(vertical.categories).join(', ');
    throw new Error(
      `Category "${categoryName}" not found in ${verticalName}. Available: ${availableCategories}`
    );
  }

  return vertical.categories[categoryKey];
}

/**
 * Validate that a tag exists in the taxonomy
 */
export function isValidTag(tag: string): boolean {
  const taxonomy = getTaxonomy();
  return taxonomy.flat_tag_list.includes(tag);
}

/**
 * Validate a list of tags
 * Returns { valid: string[], invalid: string[] }
 */
export function validateTags(tags: string[]): { valid: string[]; invalid: string[] } {
  const taxonomyTags = getTaxonomyTags();
  const valid: string[] = [];
  const invalid: string[] = [];

  for (const tag of tags) {
    if (taxonomyTags.includes(tag)) {
      valid.push(tag);
    } else {
      invalid.push(tag);
    }
  }

  return { valid, invalid };
}

/**
 * Get canonical tag from synonym
 * Returns the canonical tag if input is a synonym, otherwise returns the input
 */
export function getCanonicalTag(tagOrSynonym: string): string {
  const taxonomy = getTaxonomy();

  // Check if it's a synonym
  if (taxonomy.synonym_mappings[tagOrSynonym]) {
    return taxonomy.synonym_mappings[tagOrSynonym];
  }

  // Check if it's already a canonical tag
  if (taxonomy.flat_tag_list.includes(tagOrSynonym)) {
    return tagOrSynonym;
  }

  // Not found
  throw new Error(`Tag or synonym "${tagOrSynonym}" not found in taxonomy`);
}

/**
 * Get taxonomy formatted for prompt injection
 * Returns a string suitable for including in LLM prompts
 */
export function formatTaxonomyForPrompt(format: 'flat' | 'grouped' = 'grouped'): string {
  const taxonomy = getTaxonomy();

  if (format === 'flat') {
    return taxonomy.flat_tag_list.join(', ');
  }

  // Grouped by vertical
  const lines: string[] = [];

  for (const verticalKey of Object.keys(taxonomy.verticals)) {
    const vertical = taxonomy.verticals[verticalKey];
    // Convert slug to display name (e.g., "food-cooking" -> "FOOD & COOKING")
    const displayName = verticalKey.toUpperCase().replace(/-/g, ' & ');
    lines.push(`\n${displayName}:`);

    for (const [categoryKey, categoryTags] of Object.entries(vertical.categories)) {
      // Convert slug to display name (e.g., "cooking-methods" -> "Cooking Methods")
      const categoryDisplay = categoryKey.split('-').map(word =>
        word.charAt(0).toUpperCase() + word.slice(1)
      ).join(' ');
      lines.push(`  ${categoryDisplay}: ${categoryTags.join(', ')}`);
    }
  }

  return lines.join('\n');
}

/**
 * Get taxonomy statistics
 */
export function getTaxonomyStats(): {
  version: string;
  totalTags: number;
  verticals: Array<{ name: string; tagCount: number }>;
} {
  const taxonomy = getTaxonomy();

  const verticals = Object.entries(taxonomy.verticals).map(([key, vertical]) => ({
    name: key.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' & '),
    tagCount: vertical.tag_count,
  }));

  return {
    version: taxonomy.metadata.version,
    totalTags: taxonomy.metadata.total_tags,
    verticals,
  };
}

/**
 * Clear the taxonomy cache (useful for testing or reloading)
 */
export function clearCache(): void {
  cachedTaxonomy = null;
}
