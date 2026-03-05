'use client';

import { useCallback, useEffect, useState } from 'react';
import ContentCard, { ContentCardItem } from '@/components/ContentCard';
import TagFilter from '@/components/TagFilter';
import TypeFilter, { ContentType } from '@/components/TypeFilter';
import RelatedPanel from '@/components/RelatedPanel';

interface ExplorerResponse {
  items: ContentCardItem[];
  total: number;
}

export default function ExplorerPage() {
  const [items, setItems] = useState<ContentCardItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedType, setSelectedType] = useState<ContentType>('all');
  const [selectedItem, setSelectedItem] = useState<ContentCardItem | null>(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (selectedTags.length > 0) params.set('tags', selectedTags.join(','));
      if (selectedType !== 'all') params.set('type', selectedType);

      const res = await fetch(`/api/explorer?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ExplorerResponse = await res.json();
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [selectedTags, selectedType]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  // Compute per-type counts from current unfiltered items (approximate — same fetch)
  const typeCounts = items.reduce<Partial<Record<ContentType, number>>>(
    (acc, item) => {
      const t = item.content_type as ContentType;
      acc[t] = (acc[t] ?? 0) + 1;
      return acc;
    },
    {},
  );

  return (
    <div className="flex h-full min-h-screen">
      {/* Filter sidebar */}
      <aside className="w-64 shrink-0 border-r border-gray-200 bg-white px-5 py-8 overflow-y-auto">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-4">
          Filter by Tag
        </h2>
        <TagFilter selected={selectedTags} onChange={setSelectedTags} />
      </aside>

      {/* Main area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="border-b border-gray-200 bg-white px-8 py-4 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Content Explorer</h1>
            <p className="text-sm text-gray-400">
              {loading ? 'Loading…' : `${total} item${total !== 1 ? 's' : ''}`}
              {selectedTags.length > 0 && ` matching ${selectedTags.length} tag${selectedTags.length > 1 ? 's' : ''}`}
            </p>
          </div>
          <TypeFilter selected={selectedType} counts={typeCounts} onChange={setSelectedType} />
        </div>

        {/* Content + Related panel */}
        <div className="flex flex-1 overflow-hidden">
          {/* Results grid */}
          <div className="flex-1 overflow-y-auto px-8 py-6">
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700 mb-4">
                {error}
              </div>
            )}

            {!loading && items.length === 0 && !error && (
              <div className="flex flex-col items-center justify-center py-24 text-gray-400">
                <svg className="w-12 h-12 mb-4 text-gray-200" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803M10.5 7.5v6m3-3h-6" />
                </svg>
                <p className="font-medium mb-1">No content found</p>
                <p className="text-sm">Try removing some filters or selecting a different content type.</p>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {items.map((item) => (
                <ContentCard
                  key={`${item.content_id}-${item.content_type}`}
                  item={item}
                  selected={selectedItem?.content_id === item.content_id}
                  onClick={(i) => setSelectedItem((prev) => (prev?.content_id === i.content_id ? null : i))}
                />
              ))}
            </div>
          </div>

          {/* Related panel */}
          {selectedItem && (
            <aside className="w-80 shrink-0 border-l border-gray-200 bg-gray-50 px-5 py-6 overflow-y-auto">
              <RelatedPanel item={selectedItem} onClose={() => setSelectedItem(null)} />
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
