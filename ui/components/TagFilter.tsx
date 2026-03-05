'use client';

import { useEffect, useState } from 'react';

// taxonomy-v1.json shape: { verticals: { "food-cooking": { categories: { "cooking-methods": ["tag1", ...] } } } }
interface TaxonomyData {
  verticals?: Record<string, { categories?: Record<string, string[]> }>;
}

interface VerticalEntry {
  key: string;
  tags: string[];
}

interface Props {
  selected: string[];
  onChange: (tags: string[]) => void;
}

export default function TagFilter({ selected, onChange }: Props) {
  const [verticals, setVerticals] = useState<VerticalEntry[]>([]);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch('/api/taxonomy')
      .then((r) => r.json())
      .then((data: TaxonomyData) => {
        if (!data?.verticals) return;
        const entries: VerticalEntry[] = Object.entries(data.verticals).map(([key, v]) => ({
          key,
          tags: Object.values(v.categories ?? {}).flat(),
        }));
        setVerticals(entries);
      })
      .catch(() => {});
  }, []);

  function toggleTag(tag: string) {
    if (selected.includes(tag)) {
      onChange(selected.filter((t) => t !== tag));
    } else {
      onChange([...selected, tag]);
    }
  }

  function toggleVertical(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const allTags = verticals.flatMap((v) => v.tags);
  const filtered = search.trim()
    ? allTags.filter((t) => t.includes(search.trim().toLowerCase()))
    : null;

  const displayLabel = (key: string) =>
    key.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div className="flex flex-col gap-3">
      <input
        type="search"
        placeholder="Search tags…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#1652a0]/30"
      />

      {selected.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
            Active filters
          </p>
          <div className="flex flex-wrap gap-1.5">
            {selected.map((tag) => (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className="text-xs px-2.5 py-1 rounded-full bg-[#1652a0] text-white flex items-center gap-1 hover:bg-[#1246a0]"
              >
                {tag}
                <span className="text-blue-200">×</span>
              </button>
            ))}
            <button
              onClick={() => onChange([])}
              className="text-xs px-2.5 py-1 rounded-full border border-gray-200 text-gray-500 hover:bg-gray-50"
            >
              Clear all
            </button>
          </div>
        </div>
      )}

      {filtered ? (
        <div className="flex flex-col gap-1">
          {filtered.slice(0, 30).map((tag) => (
            <button
              key={tag}
              onClick={() => toggleTag(tag)}
              className={`text-left text-sm px-3 py-1.5 rounded-lg transition-colors ${
                selected.includes(tag)
                  ? 'bg-[#1652a0]/10 text-[#1652a0] font-medium'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              {tag}
            </button>
          ))}
          {filtered.length > 30 && (
            <p className="text-xs text-gray-400 px-3">+{filtered.length - 30} more — refine your search</p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {verticals.map((v) => {
            const isOpen = expanded.has(v.key);
            return (
              <div key={v.key}>
                <button
                  onClick={() => toggleVertical(v.key)}
                  className="w-full flex items-center justify-between text-sm font-semibold text-gray-700 py-1.5 hover:text-[#1652a0] transition-colors"
                >
                  <span>{displayLabel(v.key)}</span>
                  <svg
                    className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
                {isOpen && (
                  <div className="flex flex-col gap-0.5 pl-2 max-h-60 overflow-y-auto">
                    {v.tags.map((tag) => (
                      <button
                        key={tag}
                        onClick={() => toggleTag(tag)}
                        className={`text-left text-xs px-3 py-1.5 rounded-lg transition-colors ${
                          selected.includes(tag)
                            ? 'bg-[#1652a0]/10 text-[#1652a0] font-medium'
                            : 'text-gray-600 hover:bg-gray-100'
                        }`}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
