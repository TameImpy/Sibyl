'use client';

import { useEffect, useState } from 'react';
import { ContentCardItem } from './ContentCard';

interface RelatedItem {
  content_id: string;
  content_type: string;
  title: string;
  score: number;
  shared_tags: string[];
  strength: 'strong' | 'moderate' | 'weak';
}

const STRENGTH_COLOR = {
  strong: 'bg-emerald-500',
  moderate: 'bg-amber-400',
  weak: 'bg-gray-300',
};

const TYPE_COLORS: Record<string, string> = {
  article: 'bg-blue-100 text-blue-700',
  podcast: 'bg-purple-100 text-purple-700',
  video: 'bg-rose-100 text-rose-700',
  json: 'bg-amber-100 text-amber-700',
};

interface Props {
  item: ContentCardItem;
  onClose: () => void;
}

export default function RelatedPanel({ item, onClose }: Props) {
  const [related, setRelated] = useState<RelatedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    const url = `/api/explorer/${encodeURIComponent(item.content_id)}/related?contentType=${encodeURIComponent(item.content_type)}&limit=6`;
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setRelated(data.related ?? []);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [item.content_id, item.content_type]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Related to</p>
          <h3 className="text-sm font-bold text-gray-900 line-clamp-2">{item.title}</h3>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 text-gray-400 hover:text-gray-600 transition-colors p-1"
          aria-label="Close related panel"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex flex-col gap-3 overflow-y-auto flex-1">
        {loading && (
          <p className="text-sm text-gray-400 text-center py-8">Finding related content…</p>
        )}
        {error && (
          <p className="text-sm text-red-500 text-center py-8">{error}</p>
        )}
        {!loading && !error && related.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-8">No related content found.</p>
        )}
        {!loading && related.map((rel) => (
          <div key={rel.content_id} className="border border-gray-200 rounded-xl p-3 bg-white">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span
                className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${
                  TYPE_COLORS[rel.content_type] ?? 'bg-gray-100 text-gray-600'
                }`}
              >
                {rel.content_type}
              </span>
              <div className="flex items-center gap-1.5 shrink-0">
                <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${STRENGTH_COLOR[rel.strength]}`}
                    style={{ width: `${Math.round(rel.score * 100)}%` }}
                  />
                </div>
                <span className="text-xs text-gray-500 tabular-nums">
                  {Math.round(rel.score * 100)}%
                </span>
              </div>
            </div>
            <p className="text-sm font-medium text-gray-900 line-clamp-2 mb-2">{rel.title}</p>
            <div className="flex flex-wrap gap-1">
              {rel.shared_tags.map((tag) => (
                <span
                  key={tag}
                  className="text-xs px-2 py-0.5 bg-[#1652a0]/10 text-[#1652a0] rounded-full"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
