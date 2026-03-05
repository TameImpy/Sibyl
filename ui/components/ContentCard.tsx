'use client';

const TYPE_COLORS: Record<string, string> = {
  article: 'bg-blue-100 text-blue-700',
  podcast: 'bg-purple-100 text-purple-700',
  video: 'bg-rose-100 text-rose-700',
  json: 'bg-amber-100 text-amber-700',
};

const TYPE_ICONS: Record<string, string> = {
  article: 'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z',
  podcast: 'M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z',
  video: 'M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z',
  json: 'M14.25 9.75L16.5 12l-2.25 2.25m-4.5 0L7.5 12l2.25-2.25M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z',
};

function relativeTime(iso?: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export interface ContentCardItem {
  content_id: string;
  content_type: string;
  title: string;
  tags: string[];
  tag_count: number;
  created_at?: string;
}

interface Props {
  item: ContentCardItem;
  onClick: (item: ContentCardItem) => void;
  selected?: boolean;
}

export default function ContentCard({ item, onClick, selected }: Props) {
  const visibleTags = item.tags.slice(0, 3);
  const overflow = item.tag_count - visibleTags.length;

  return (
    <button
      onClick={() => onClick(item)}
      className={`w-full text-left rounded-xl border p-4 transition-all ${
        selected
          ? 'border-[#1652a0] bg-[#1652a0]/5 shadow-md'
          : 'border-gray-200 bg-white hover:border-[#1652a0]/50 hover:shadow-sm'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <span
          className={`shrink-0 inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${
            TYPE_COLORS[item.content_type] ?? 'bg-gray-100 text-gray-600'
          }`}
        >
          {TYPE_ICONS[item.content_type] && (
            <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d={TYPE_ICONS[item.content_type]} />
            </svg>
          )}
          {item.content_type}
        </span>
        <span className="text-xs text-gray-400 shrink-0">{relativeTime(item.created_at)}</span>
      </div>

      <p className="text-sm font-semibold text-gray-900 line-clamp-2 mb-3">{item.title}</p>

      <div className="flex flex-wrap gap-1.5">
        {visibleTags.map((tag) => (
          <span key={tag} className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full">
            {tag}
          </span>
        ))}
        {overflow > 0 && (
          <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full">
            +{overflow} more
          </span>
        )}
        {item.tag_count === 0 && (
          <span className="text-xs text-gray-400 italic">No tags</span>
        )}
      </div>
    </button>
  );
}
