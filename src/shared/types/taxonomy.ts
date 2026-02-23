import { z } from 'zod';

// Taxonomy structure matching taxonomy-v1.json
export const TaxonomyMetadataSchema = z.object({
  version: z.string(),
  generated_date: z.string(),
  total_tags: z.number(),
  description: z.string(),
  structure: z.string(),
  naming_convention: z.string(),
});

export const VerticalSchema = z.object({
  tag_count: z.number(),
  categories: z.record(z.array(z.string())),
});

export const TaxonomySchema = z.object({
  metadata: TaxonomyMetadataSchema,
  verticals: z.record(VerticalSchema),
  flat_tag_list: z.array(z.string()),
  synonym_mappings: z.record(z.string()).optional(),
});

export type Taxonomy = z.infer<typeof TaxonomySchema>;
export type TaxonomyMetadata = z.infer<typeof TaxonomyMetadataSchema>;

// Taxonomy cache interface for RDS
export interface TaxonomyCache {
  id: string;
  version: string;
  data: Taxonomy;
  created_at: Date;
  updated_at: Date;
}
