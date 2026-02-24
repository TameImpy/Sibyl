'use client';

const CONFIDENCE_THRESHOLD = 0.85;

interface TagCardProps {
  tag: string;
  confidence: number;
  reasoning?: string;
}

export default function TagCard({ tag, confidence, reasoning }: TagCardProps) {
  const pct = Math.round(confidence * 100);
  const belowThreshold = confidence < CONFIDENCE_THRESHOLD;

  return (
    <div className={`rounded-xl border p-4 ${belowThreshold ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-white'}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-sm font-semibold text-gray-800">{tag}</span>
        <div className="flex items-center gap-1.5">
          <span className={`text-sm font-bold ${belowThreshold ? 'text-amber-600' : 'text-[#1652a0]'}`}>
            {pct}%
          </span>
          {belowThreshold && (
            <span title="Below 85% confidence threshold" className="text-amber-500">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path fillRule="evenodd" d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003zM12 8.25a.75.75 0 01.75.75v3.75a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm0 8.25a.75.75 0 100-1.5.75.75 0 000 1.5z" clipRule="evenodd" />
              </svg>
            </span>
          )}
        </div>
      </div>

      {/* Confidence bar */}
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-2">
        <div
          className={`h-full rounded-full transition-all duration-500 ${belowThreshold ? 'bg-amber-400' : 'bg-[#1652a0]'}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {belowThreshold && (
        <p className="text-xs text-amber-600 mb-1">Below 85% threshold — flagged for review</p>
      )}

      {reasoning && (
        <p className="text-xs text-gray-500 mt-1 leading-relaxed">{reasoning}</p>
      )}
    </div>
  );
}
