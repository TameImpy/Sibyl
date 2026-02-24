'use client';

interface CostSummaryProps {
  modelUsed: string;
  processingTimeMs: number;
  tokenCount?: number;
  costUsd?: number;
  retryCount?: number;
}

export default function CostSummary({ modelUsed, processingTimeMs, tokenCount, costUsd, retryCount }: CostSummaryProps) {
  const latencyS = (processingTimeMs / 1000).toFixed(1);
  const costFormatted = costUsd !== undefined ? `$${costUsd.toFixed(4)}` : '—';
  const tokensFormatted = tokenCount !== undefined ? tokenCount.toLocaleString() : '—';

  return (
    <div className="flex flex-wrap gap-4 text-sm text-gray-600">
      <div className="flex items-center gap-1.5">
        <svg className="w-4 h-4 text-[#4a9ed6]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>{latencyS}s</span>
      </div>

      {tokenCount !== undefined && (
        <div className="flex items-center gap-1.5">
          <svg className="w-4 h-4 text-[#4a9ed6]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
          </svg>
          <span>{tokensFormatted} tokens</span>
        </div>
      )}

      <div className="flex items-center gap-1.5">
        <svg className="w-4 h-4 text-[#4a9ed6]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33" />
        </svg>
        <span>{costFormatted}</span>
      </div>

      <div className="flex items-center gap-1.5">
        <svg className="w-4 h-4 text-[#4a9ed6]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714a2.25 2.25 0 001.5 2.121m-1.5-2.121a24.25 24.25 0 004.5-2.082" />
        </svg>
        <span className="font-mono text-xs">{modelUsed}</span>
      </div>

      {retryCount !== undefined && retryCount > 0 && (
        <div className="flex items-center gap-1.5 text-amber-600">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
          </svg>
          <span>{retryCount} {retryCount === 1 ? 'retry' : 'retries'}</span>
        </div>
      )}
    </div>
  );
}
