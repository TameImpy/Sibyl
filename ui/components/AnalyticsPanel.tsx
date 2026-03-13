'use client';

import { useEffect, useState } from 'react';

interface TagAnalytic {
  tag: string;
  item_count: number;
  matched_revenue_count: number;
  avg_daily_revenue: number;
  avg_page_views: number;
  avg_users: number;
  revenue_per_user: number;
}

interface AnalyticsResponse {
  tags: TagAnalytic[];
  total_items: number;
  coverage_pct: number;
  azure_sql_connected: boolean;
}

interface Props {
  selectedTags: string[];
  selectedType: string;
  onTagClick: (tag: string) => void;
}

function fmt(n: number, decimals = 0): string {
  return n.toLocaleString('en-GB', { maximumFractionDigits: decimals });
}

function fmtGbp(n: number): string {
  return `£${fmt(n, 2)}`;
}

export default function AnalyticsPanel({ selectedTags, selectedType, onTagClick }: Props) {
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');

    const params = new URLSearchParams();
    if (selectedTags.length > 0) params.set('tags', selectedTags.join(','));
    if (selectedType && selectedType !== 'all') params.set('type', selectedType);

    fetch(`/api/explorer/analytics?${params}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((d: AnalyticsResponse) => setData(d))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [selectedTags, selectedType]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-gray-400">
        <svg className="w-5 h-5 animate-spin mr-2" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
        Loading analytics…
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
        Failed to load analytics: {error}
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-4">
      {/* Status bar */}
      <div className="flex items-center justify-between text-xs text-gray-500">
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium ${
              data.azure_sql_connected
                ? 'bg-green-100 text-green-700'
                : 'bg-amber-100 text-amber-700'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                data.azure_sql_connected ? 'bg-green-500' : 'bg-amber-500'
              }`}
            />
            Azure SQL: {data.azure_sql_connected ? 'connected' : 'unavailable'}
          </span>
          <span>
            Coverage: {data.coverage_pct}% ({data.total_items} items)
          </span>
        </div>
        <span className="text-gray-400">{data.tags.length} tags</span>
      </div>

      {/* No data state */}
      {data.tags.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
          <p className="font-medium mb-1">No analytics data</p>
          <p className="text-sm">Submit some URLs and wait for processing to complete.</p>
        </div>
      )}

      {/* Revenue table */}
      {data.tags.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Tag</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-700">Items</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-700">Avg Daily Revenue</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-700">Avg Page Views</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-700">Revenue / User</th>
              </tr>
            </thead>
            <tbody>
              {data.tags.map((row, idx) => (
                <tr
                  key={row.tag}
                  className={`border-b border-gray-100 hover:bg-[#1652a0]/5 cursor-pointer transition-colors ${
                    idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'
                  }`}
                  onClick={() => onTagClick(row.tag)}
                >
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-700 rounded-full font-medium">
                        {row.tag}
                      </span>
                      {row.matched_revenue_count === 0 && (
                        <span className="text-xs text-gray-400 italic">no revenue data</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-700 tabular-nums">
                    {fmt(row.item_count)}
                    {row.matched_revenue_count < row.item_count && (
                      <span className="text-gray-400 text-xs ml-1">
                        ({row.matched_revenue_count} matched)
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    <span
                      className={
                        row.avg_daily_revenue > 0 ? 'text-gray-900 font-medium' : 'text-gray-400'
                      }
                    >
                      {row.avg_daily_revenue > 0 ? fmtGbp(row.avg_daily_revenue) : '—'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-700 tabular-nums">
                    {row.avg_page_views > 0 ? fmt(row.avg_page_views) : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    <span
                      className={
                        row.revenue_per_user > 0 ? 'text-gray-900' : 'text-gray-400'
                      }
                    >
                      {row.revenue_per_user > 0 ? `£${row.revenue_per_user.toFixed(3)}` : '—'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
