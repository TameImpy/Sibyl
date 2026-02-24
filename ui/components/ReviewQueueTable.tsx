'use client';

import Link from 'next/link';

interface QueueItem {
  content_id: string;
  content_type: string;
  tags?: Array<{ tag: string; confidence: number }>;
  created_at: string;
  processing_metadata?: {
    model_used: string;
    processing_time_ms: number;
  };
  metadata?: {
    title?: string;
  };
}

interface ReviewQueueTableProps {
  items: QueueItem[];
}

function contentTypeBadge(type: string) {
  const colours: Record<string, string> = {
    article: 'bg-blue-100 text-blue-800',
    podcast: 'bg-purple-100 text-purple-800',
    video: 'bg-pink-100 text-pink-800',
    json: 'bg-gray-100 text-gray-800',
  };
  return colours[type] ?? 'bg-gray-100 text-gray-800';
}

export default function ReviewQueueTable({ items }: ReviewQueueTableProps) {
  if (items.length === 0) {
    return (
      <div className="text-center py-16 text-gray-400">
        <svg className="w-12 h-12 mx-auto mb-3 opacity-40" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="font-medium">Review queue is empty</p>
        <p className="text-sm mt-1">All processed content met the 85% confidence threshold.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-gray-500 text-xs uppercase tracking-wide">
            <th className="pb-3 pr-4 font-semibold">Title</th>
            <th className="pb-3 pr-4 font-semibold">Type</th>
            <th className="pb-3 pr-4 font-semibold">Min Confidence</th>
            <th className="pb-3 pr-4 font-semibold">Submitted</th>
            <th className="pb-3 font-semibold"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {items.map((item) => {
            const minConf = item.tags && item.tags.length > 0
              ? Math.min(...item.tags.map((t) => t.confidence))
              : null;
            const title = item.metadata?.title ?? item.content_id.slice(0, 8) + '…';
            const submittedAt = new Date(item.created_at).toLocaleString();

            return (
              <tr key={item.content_id} className="hover:bg-gray-50 transition-colors">
                <td className="py-3 pr-4 font-medium text-gray-900 max-w-xs truncate">{title}</td>
                <td className="py-3 pr-4">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${contentTypeBadge(item.content_type)}`}>
                    {item.content_type}
                  </span>
                </td>
                <td className="py-3 pr-4">
                  {minConf !== null ? (
                    <span className="font-mono text-amber-700 font-semibold">
                      {Math.round(minConf * 100)}%
                    </span>
                  ) : '—'}
                </td>
                <td className="py-3 pr-4 text-gray-500 whitespace-nowrap">{submittedAt}</td>
                <td className="py-3">
                  <Link
                    href={`/results/${item.content_id}?contentType=${item.content_type}`}
                    className="text-[#1652a0] hover:underline font-medium text-xs"
                  >
                    View →
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
