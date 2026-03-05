'use client';

const TYPES = ['all', 'article', 'podcast', 'video', 'json'] as const;
export type ContentType = (typeof TYPES)[number];

interface Props {
  selected: ContentType;
  counts?: Partial<Record<ContentType, number>>;
  onChange: (type: ContentType) => void;
}

export default function TypeFilter({ selected, counts, onChange }: Props) {
  return (
    <div className="flex flex-wrap gap-2">
      {TYPES.map((type) => {
        const active = selected === type;
        const count = counts?.[type];
        return (
          <button
            key={type}
            onClick={() => onChange(type)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors capitalize ${
              active
                ? 'bg-[#1652a0] text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:border-[#1652a0] hover:text-[#1652a0]'
            }`}
          >
            {type === 'all' ? 'All' : type.charAt(0).toUpperCase() + type.slice(1)}
            {count !== undefined && (
              <span className={`ml-1.5 text-xs ${active ? 'text-blue-200' : 'text-gray-400'}`}>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
