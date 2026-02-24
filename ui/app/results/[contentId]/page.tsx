'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import TagCard from '@/components/TagCard';
import RoutingBadge from '@/components/RoutingBadge';
import CostSummary from '@/components/CostSummary';

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 30000;

interface TagResult {
  tag: string;
  confidence: number;
  reasoning?: string;
}

interface ProcessingResult {
  content_id: string;
  content_type: string;
  status: string;
  tags: TagResult[];
  needs_review?: string; // stored as 'true'/'false' string
  routing_reason?: string;
  processing_metadata: {
    model_used: string;
    processing_time_ms: number;
    token_count?: number;
    cost_usd?: number;
    retry_count?: number;
  };
  created_at: string;
  metadata?: {
    title?: string;
  };
}

function ElapsedTimer({ startMs }: { startMs: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setElapsed(Date.now() - startMs), 500);
    return () => clearInterval(t);
  }, [startMs]);
  return <span>{(elapsed / 1000).toFixed(1)}s ago</span>;
}

export default function ResultsPage({ params }: { params: { contentId: string } }) {
  const { contentId } = params;
  const searchParams = useSearchParams();
  const contentType = searchParams.get('contentType') ?? '';

  const [result, setResult] = useState<ProcessingResult | null>(null);
  const [status, setStatus] = useState<'polling' | 'timeout' | 'error'>('polling');
  const [submitTime] = useState(Date.now());
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchResult = useCallback(async () => {
    try {
      const res = await fetch(`/api/results/${contentId}?contentType=${encodeURIComponent(contentType)}`);
      if (!res.ok) {
        setStatus('error');
        setErrorMsg(`HTTP ${res.status}`);
        return true; // stop polling
      }
      const data = await res.json();
      if (data.status === 'pending' || data.status === 'processing') {
        return false; // keep polling
      }
      setResult(data);
      return true; // done
    } catch {
      setStatus('error');
      setErrorMsg('Network error');
      return true;
    }
  }, [contentId, contentType]);

  useEffect(() => {
    let stopped = false;
    const timeoutId = setTimeout(() => {
      if (!stopped) setStatus('timeout');
    }, POLL_TIMEOUT_MS);

    async function poll() {
      const done = await fetchResult();
      if (done || stopped) {
        clearTimeout(timeoutId);
        return;
      }
      if (Date.now() - submitTime >= POLL_TIMEOUT_MS) {
        setStatus('timeout');
        clearTimeout(timeoutId);
        return;
      }
      setTimeout(poll, POLL_INTERVAL_MS);
    }

    poll();

    return () => {
      stopped = true;
      clearTimeout(timeoutId);
    };
  }, [fetchResult, submitTime]);

  const needsReview = result?.needs_review === 'true';

  return (
    <div className="max-w-2xl mx-auto px-8 py-10">
      {/* Back nav */}
      <Link href="/" className="text-sm text-[#1652a0] hover:underline flex items-center gap-1 mb-6">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
        </svg>
        Back to Submit
      </Link>

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-2xl font-bold text-gray-900">
            {result?.metadata?.title ?? 'Processing…'}
          </h1>
          {result?.content_type && (
            <span className="text-xs font-medium bg-[#1652a0]/10 text-[#1652a0] px-2 py-0.5 rounded-full">
              {result.content_type}
            </span>
          )}
        </div>
        <p className="text-sm text-gray-400">
          Submitted <ElapsedTimer startMs={submitTime} />
        </p>
      </div>

      {/* Pending / polling state */}
      {!result && status === 'polling' && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 flex flex-col items-center gap-4">
          <div className="relative">
            <div className="w-14 h-14 rounded-full border-4 border-[#1652a0]/20 border-t-[#1652a0] animate-spin" />
          </div>
          <div className="text-center">
            <p className="font-semibold text-gray-800">Processing your content</p>
            <p className="text-sm text-gray-500 mt-1">SQS → Lambda → AI model → DynamoDB</p>
            <p className="text-xs text-gray-400 mt-1">Polling every 2s (mock mode ~2–5s)</p>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
            <div className="bg-[#4a9ed6] h-full rounded-full animate-pulse" style={{ width: '60%' }} />
          </div>
        </div>
      )}

      {/* Timeout state */}
      {status === 'timeout' && !result && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
          <p className="font-semibold text-amber-800">Processing is taking longer than expected</p>
          <p className="text-sm text-amber-700 mt-1">The item may still be in queue. Check the review queue or try again.</p>
          <button
            onClick={() => { setStatus('polling'); fetchResult(); }}
            className="mt-4 text-sm text-[#1652a0] hover:underline"
          >
            Check again
          </button>
        </div>
      )}

      {/* Error state */}
      {status === 'error' && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6">
          <p className="font-semibold text-red-800">Error fetching results</p>
          {errorMsg && <p className="text-sm text-red-700 mt-1">{errorMsg}</p>}
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-6">
          {/* Routing badge */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
            <RoutingBadge needsReview={needsReview} routingReason={result.routing_reason} />
          </div>

          {/* Tags */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
            <h2 className="font-semibold text-gray-800 mb-4">
              Tags
              <span className="ml-2 text-sm font-normal text-gray-400">
                ({result.tags.length} tag{result.tags.length !== 1 ? 's' : ''})
              </span>
            </h2>
            {result.tags.length === 0 ? (
              <p className="text-sm text-gray-400">No tags were produced.</p>
            ) : (
              <div className="space-y-3">
                {result.tags
                  .slice()
                  .sort((a, b) => b.confidence - a.confidence)
                  .map((tag) => (
                    <TagCard key={tag.tag} tag={tag.tag} confidence={tag.confidence} reasoning={tag.reasoning} />
                  ))}
              </div>
            )}
          </div>

          {/* Cost + metadata */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
            <h2 className="font-semibold text-gray-800 mb-3">Processing Details</h2>
            <CostSummary
              modelUsed={result.processing_metadata.model_used}
              processingTimeMs={result.processing_metadata.processing_time_ms}
              tokenCount={result.processing_metadata.token_count}
              costUsd={result.processing_metadata.cost_usd}
              retryCount={result.processing_metadata.retry_count}
            />
            <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-400 font-mono">
              content_id: {result.content_id}
            </div>
          </div>

          {/* Link to review queue if needs review */}
          {needsReview && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800 flex items-center justify-between">
              <span>This item has been added to the editorial review queue.</span>
              <Link href="/review" className="font-semibold hover:underline whitespace-nowrap ml-4">
                View queue →
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
