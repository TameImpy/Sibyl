'use client';

import { useEffect, useState } from 'react';

interface TaxonomyData {
  metadata: {
    version: string;
    total_tags: number;
    description: string;
  };
  verticals: Record<string, {
    tag_count: number;
    categories: Record<string, string[]>;
  }>;
}

const VERTICAL_LABELS: Record<string, string> = {
  'food-cooking': 'Food & Cooking',
  'home-garden': 'Home & Garden',
  'parenting-family': 'Parenting & Family',
  'entertainment': 'Entertainment',
  'automotive': 'Automotive',
};

export default function TaxonomyPage() {
  const [taxonomy, setTaxonomy] = useState<TaxonomyData | null>(null);
  const [search, setSearch] = useState('');
  const [activeVertical, setActiveVertical] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/taxonomy')
      .then((r) => r.json())
      .then((d: TaxonomyData) => {
        setTaxonomy(d);
        setActiveVertical(Object.keys(d.verticals)[0]);
      });
  }, []);

  if (!taxonomy) {
    return <div className="p-10 text-gray-500">Loading taxonomy…</div>;
  }

  const verticals = Object.entries(taxonomy.verticals);
  const query = search.toLowerCase().trim();

  // Filter tags across all categories in the active vertical
  const currentVertical = activeVertical ? taxonomy.verticals[activeVertical] : null;
  const categories = currentVertical ? Object.entries(currentVertical.categories) : [];

  const filteredCategories = categories
    .map(([cat, tags]) => ({
      cat,
      tags: query ? tags.filter((t) => t.includes(query)) : tags,
    }))
    .filter(({ tags }) => tags.length > 0);

  const visibleTagCount = filteredCategories.reduce((n, { tags }) => n + tags.length, 0);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Vertical tabs */}
      <div className="w-52 shrink-0 border-r border-gray-200 bg-white py-8 px-4 flex flex-col gap-1">
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3 px-2">Verticals</p>
        {verticals.map(([key, v]) => (
          <button
            key={key}
            onClick={() => { setActiveVertical(key); setSearch(''); }}
            className={`text-left px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              activeVertical === key
                ? 'bg-[#1652a0] text-white'
                : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            {VERTICAL_LABELS[key] ?? key}
            <span className={`ml-1.5 text-xs ${activeVertical === key ? 'text-blue-200' : 'text-gray-400'}`}>
              {v.tag_count}
            </span>
          </button>
        ))}

        <div className="mt-auto pt-6 border-t border-gray-100">
          <p className="text-xs text-gray-400 px-2">v{taxonomy.metadata.version}</p>
          <p className="text-xs text-gray-400 px-2">{taxonomy.metadata.total_tags} total tags</p>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-auto px-8 py-8">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Taxonomy Explorer</h1>
          <p className="text-sm text-gray-500 mb-6">
            {VERTICAL_LABELS[activeVertical ?? ''] ?? activeVertical} · {currentVertical?.tag_count} tags
          </p>

          {/* Search */}
          <div className="relative mb-6">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              type="text"
              placeholder="Search tags…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1652a0]/30 focus:border-[#1652a0]"
            />
            {search && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                {visibleTagCount} result{visibleTagCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {/* Categories + tags */}
          <div className="space-y-6">
            {filteredCategories.map(({ cat, tags }) => (
              <div key={cat}>
                <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-2">
                  {cat.replace(/-/g, ' ')}
                </h2>
                <div className="flex flex-wrap gap-2">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-gray-100 text-gray-700 font-mono hover:bg-[#1652a0]/10 hover:text-[#1652a0] transition-colors cursor-default"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            ))}

            {filteredCategories.length === 0 && (
              <p className="text-sm text-gray-400">No tags match &quot;{search}&quot;</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
