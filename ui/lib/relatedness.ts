export interface TaggedItem {
  content_id: string;
  content_type: string;
  title?: string;
  tags?: Array<{ tag: string; confidence: number }>;
  created_at?: string;
}

export interface RelatedItem {
  content_id: string;
  content_type: string;
  title: string;
  score: number;
  shared_tags: string[];
  strength: 'strong' | 'moderate' | 'weak';
}

function getTagNames(item: TaggedItem): Set<string> {
  return new Set((item.tags ?? []).map((t) => t.tag));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  const aArr = Array.from(a);
  const intersection = aArr.filter((t) => b.has(t));
  const union = new Set([...aArr, ...Array.from(b)]);
  return intersection.length / union.size;
}

function scoreStrength(score: number): 'strong' | 'moderate' | 'weak' {
  if (score >= 0.4) return 'strong';
  if (score >= 0.2) return 'moderate';
  return 'weak';
}

export function findRelated(target: TaggedItem, candidates: TaggedItem[], limit = 6): RelatedItem[] {
  const targetTags = getTagNames(target);

  const scored = candidates
    .filter((c) => c.content_id !== target.content_id)
    .map((c) => {
      const cTags = getTagNames(c);
      const score = jaccard(targetTags, cTags);
      const shared_tags = Array.from(targetTags).filter((t) => cTags.has(t));
      return { item: c, score, shared_tags };
    })
    .filter(({ score }) => score >= 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map(({ item, score, shared_tags }) => ({
    content_id: item.content_id,
    content_type: item.content_type,
    title: item.title ?? item.content_id,
    score: Math.round(score * 100) / 100,
    shared_tags,
    strength: scoreStrength(score),
  }));
}
