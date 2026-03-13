'use client';

import { useEffect, useState } from 'react';

type Mode = 'backfill' | 'monthly';

// Pricing constants
// Claude Sonnet 4 (Bedrock) — $0.003/$0.015 per 1k tokens
const CLAUDE_INPUT_PER_1K = 0.003;
const CLAUDE_OUTPUT_PER_1K = 0.015;
// Gemini 2.5 Flash — $0.00015/$0.00060 per 1k tokens
// Video frames are tokenised at ~263 tokens/sec; per-second cost = 263 × $0.00015/1k ≈ $0.00004/sec
const GEMINI_INPUT_PER_1K = 0.00015;
const GEMINI_OUTPUT_PER_1K = 0.0006;
const GEMINI_VIDEO_TOKENS_PER_SECOND = 263; // Gemini 2.5 Flash tokenisation rate for video frames

// Token counts per content type
// Articles: empirical — avg 9,512 total tokens across 201 processed items (DynamoDB, 2026-03-13)
//   Output is a short JSON tag list (~312 tokens); input is the remainder.
// Podcasts, JSON: 1 sample each — treat as indicative only.
// Video: token count depends on duration via frame tokenisation.
const TOKEN_USAGE = {
  article:  { input: 9200, output: 312 },
  podcast:  { input: 11750, output: 306 },  // 1 sample: 12,056 total
  json:     { input: 18200, output: 313 },  // 1 sample: 18,513 total
};

// AWS infrastructure cost per item (Lambda + SQS + DynamoDB bundled)
const INFRA_PER_ITEM = 0.002;
// S3 storage per GB/month
const S3_PER_GB_MONTH = 0.023;
// Average video file size in MB
const AVG_VIDEO_MB = 50;

function calcTextCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1000) * CLAUDE_INPUT_PER_1K + (outputTokens / 1000) * CLAUDE_OUTPUT_PER_1K;
}

function calcVideoCost(durationMinutes: number): number {
  const durationSecs = durationMinutes * 60;
  // Video frames + prompt text tokens (input); short JSON tag list (output)
  const videoFrameTokens = durationSecs * GEMINI_VIDEO_TOKENS_PER_SECOND;
  const promptTokens = 500;
  const outputTokens = 300;
  const totalInputTokens = videoFrameTokens + promptTokens;
  return (
    (totalInputTokens / 1000) * GEMINI_INPUT_PER_1K +
    (outputTokens / 1000) * GEMINI_OUTPUT_PER_1K
  );
}

function fmt(usd: number, rate: number): string {
  const gbp = usd * rate;
  if (gbp < 0.01) return '£' + gbp.toFixed(4);
  if (gbp < 1)    return '£' + gbp.toFixed(3);
  return '£' + gbp.toFixed(2);
}

function fmtRange(lowUsd: number, highUsd: number, rate: number): string {
  return `${fmt(lowUsd, rate)} – ${fmt(highUsd, rate)}`;
}

interface InputRowProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  suffix?: string;
}

function InputRow({ label, value, onChange, min = 0, max = 100000, suffix = 'files' }: InputRowProps) {
  return (
    <div className="flex items-center gap-3">
      <label className="w-28 text-sm text-gray-600 text-right shrink-0">{label}</label>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value)))}
        className="w-32 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-[#1652a0]/40"
      />
      <span className="text-sm text-gray-400">{suffix}</span>
    </div>
  );
}

interface BreakdownRowProps {
  label: string;
  count: number;
  unitCost: number;
  total: number;
  rate: number;
  unitLabel?: string;
}

function BreakdownRow({ label, count, unitCost, total, rate, unitLabel = 'items' }: BreakdownRowProps) {
  if (count === 0) return null;
  return (
    <div className="flex items-center justify-between text-sm py-1">
      <span className="text-gray-700">{label}</span>
      <span className="text-gray-400 tabular-nums mx-4">
        {count.toLocaleString()} {unitLabel} × {fmt(unitCost, rate)}
      </span>
      <span className="font-medium tabular-nums text-gray-900">{fmt(total, rate)}</span>
    </div>
  );
}

export default function CostCalculatorPanel() {
  const [mode, setMode] = useState<Mode>('backfill');
  const [articles, setArticles] = useState(500);
  const [podcasts, setPodcasts] = useState(100);
  const [jsonItems, setJsonItems] = useState(250);
  const [videos, setVideos] = useState(25);
  const [avgVideoDuration, setAvgVideoDuration] = useState(10);

  // Exchange rate: USD → GBP
  const [rate, setRate] = useState(0.79); // sensible fallback
  const [rateStatus, setRateStatus] = useState<'loading' | 'live' | 'fallback'>('loading');

  useEffect(() => {
    fetch('https://open.er-api.com/v6/latest/USD')
      .then((r) => r.json())
      .then((data) => {
        const gbp = data?.rates?.GBP;
        if (typeof gbp === 'number' && gbp > 0) {
          setRate(parseFloat(gbp.toFixed(4)));
          setRateStatus('live');
        } else {
          setRateStatus('fallback');
        }
      })
      .catch(() => setRateStatus('fallback'));
  }, []);

  // Monthly multiplier — in monthly mode show per-month label but no number change
  // (user sets volume as "per month")
  const modeLabel = mode === 'monthly' ? '/month' : '';

  // AI costs
  const articleAiUnit = calcTextCost(TOKEN_USAGE.article.input, TOKEN_USAGE.article.output);
  const podcastAiUnit = calcTextCost(TOKEN_USAGE.podcast.input, TOKEN_USAGE.podcast.output);
  const jsonAiUnit    = calcTextCost(TOKEN_USAGE.json.input,    TOKEN_USAGE.json.output);
  const videoAiUnit   = calcVideoCost(avgVideoDuration);

  const articleAiTotal = articles * articleAiUnit;
  const podcastAiTotal = podcasts * podcastAiUnit;
  const jsonAiTotal    = jsonItems * jsonAiUnit;
  const videoAiTotal   = videos   * videoAiUnit;
  const totalAi        = articleAiTotal + podcastAiTotal + jsonAiTotal + videoAiTotal;

  // Infrastructure costs
  const textItems     = articles + podcasts + jsonItems;
  const infraTextTotal = textItems * INFRA_PER_ITEM;
  const infraVideoTotal = videos  * INFRA_PER_ITEM;
  const totalInfra    = infraTextTotal + infraVideoTotal;

  // S3 storage (video only) — monthly
  const videoStorageGB = (videos * AVG_VIDEO_MB) / 1024;
  const s3Total        = videoStorageGB * S3_PER_GB_MONTH;

  const grandTotal   = totalAi + totalInfra + (mode === 'monthly' ? s3Total : s3Total);
  const lowEstimate  = grandTotal * 0.8;
  const highEstimate = grandTotal * 1.2;

  return (
    <div className="max-w-2xl mx-auto py-8 px-4 space-y-6">
      {/* Mode toggle */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-gray-600">Mode:</span>
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
          <button
            onClick={() => setMode('backfill')}
            className={`px-4 py-1.5 font-medium transition-colors ${
              mode === 'backfill' ? 'bg-[#1652a0] text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            One-off Backfill
          </button>
          <button
            onClick={() => setMode('monthly')}
            className={`px-4 py-1.5 font-medium transition-colors border-l border-gray-200 ${
              mode === 'monthly' ? 'bg-[#1652a0] text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            Monthly Ongoing
          </button>
        </div>
      </div>

      {/* Exchange rate */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-gray-600">USD → GBP rate:</span>
        <input
          type="number"
          min={0.01}
          max={2}
          step={0.0001}
          value={rate}
          onChange={(e) => { setRate(parseFloat(e.target.value) || 0.79); setRateStatus('fallback'); }}
          className="w-24 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-[#1652a0]/40"
        />
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
          rateStatus === 'loading' ? 'bg-gray-100 text-gray-400' :
          rateStatus === 'live'    ? 'bg-green-50 text-green-700' :
                                     'bg-amber-50 text-amber-700'
        }`}>
          {rateStatus === 'loading' ? 'fetching…' : rateStatus === 'live' ? 'live rate' : 'manual / fallback'}
        </span>
        <span className="text-xs text-gray-400">AWS bills in USD — converted for display only</span>
      </div>

      {/* Inputs */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-4">
          Content Volume{modeLabel}
        </h3>
        <InputRow label="Articles"  value={articles}  onChange={setArticles}  />
        <InputRow label="Podcasts"  value={podcasts}  onChange={setPodcasts}  />
        <InputRow label="JSON"      value={jsonItems} onChange={setJsonItems} />
        <InputRow label="Videos"    value={videos}    onChange={setVideos}    />
        <div className="pt-1 border-t border-gray-100">
          <InputRow
            label="Avg duration"
            value={avgVideoDuration}
            onChange={setAvgVideoDuration}
            min={1}
            max={180}
            suffix="mins (videos)"
          />
        </div>
      </div>

      {/* Cost breakdown */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-2">
          Cost Breakdown{modeLabel}
        </h3>

        {/* AI processing */}
        <div className="rounded-lg bg-gray-50 border border-gray-100 p-4 space-y-1">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">AI Processing</p>
          <BreakdownRow label="Articles (Claude Sonnet 4)"  count={articles}  unitCost={articleAiUnit} total={articleAiTotal} rate={rate} />
          <BreakdownRow label="Podcasts (Claude Sonnet 4)"  count={podcasts}  unitCost={podcastAiUnit} total={podcastAiTotal} rate={rate} />
          <BreakdownRow label="JSON (Claude Sonnet 4)"      count={jsonItems} unitCost={jsonAiUnit}    total={jsonAiTotal}    rate={rate} />
          <BreakdownRow label={`Videos (Gemini 2.5 Flash, avg ${avgVideoDuration} min)`} count={videos} unitCost={videoAiUnit} total={videoAiTotal} rate={rate} />
          {(articles + podcasts + jsonItems + videos) === 0 && (
            <p className="text-sm text-gray-400 italic">Enter volumes above to see a breakdown.</p>
          )}
          <div className="border-t border-gray-200 mt-2 pt-2 flex justify-between text-sm font-semibold">
            <span className="text-gray-700">AI subtotal</span>
            <span className="text-gray-900">{fmt(totalAi, rate)}</span>
          </div>
        </div>

        {/* AWS infrastructure */}
        <div className="rounded-lg bg-gray-50 border border-gray-100 p-4 space-y-1">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">AWS Infrastructure</p>
          {textItems > 0 && (
            <BreakdownRow
              label="Lambda + SQS + DynamoDB (text)"
              count={textItems}
              unitCost={INFRA_PER_ITEM}
              total={infraTextTotal}
              rate={rate}
            />
          )}
          {videos > 0 && (
            <BreakdownRow
              label="Lambda + SQS + DynamoDB (video)"
              count={videos}
              unitCost={INFRA_PER_ITEM}
              total={infraVideoTotal}
              rate={rate}
            />
          )}
          {videos > 0 && (
            <div className="flex items-center justify-between text-sm py-1">
              <span className="text-gray-700">S3 storage (video)</span>
              <span className="text-gray-400 tabular-nums mx-4">
                {videoStorageGB.toFixed(2)} GB × {fmt(S3_PER_GB_MONTH, rate)}/GB/mo
              </span>
              <span className="font-medium tabular-nums text-gray-900">{fmt(s3Total, rate)}</span>
            </div>
          )}
          {(textItems + videos) === 0 && (
            <p className="text-sm text-gray-400 italic">Enter volumes above to see a breakdown.</p>
          )}
          <div className="border-t border-gray-200 mt-2 pt-2 flex justify-between text-sm font-semibold">
            <span className="text-gray-700">Infrastructure subtotal</span>
            <span className="text-gray-900">{fmt(totalInfra + s3Total, rate)}</span>
          </div>
        </div>

        {/* Total */}
        <div className="rounded-xl border-2 border-[#1652a0]/30 bg-[#1652a0]/5 p-5 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#1652a0] mb-1">
            Estimated Total{modeLabel}
          </p>
          <p className="text-4xl font-bold text-gray-900 tabular-nums">{fmt(grandTotal, rate)}</p>
          <p className="text-sm text-gray-500 mt-1">
            Range: {fmtRange(lowEstimate, highEstimate, rate)} <span className="text-gray-400">(±20% AI cost estimate)</span>
          </p>
        </div>

        {/* Footnote */}
        <p className="text-xs text-gray-400 leading-relaxed">
          Article token counts are empirical (avg 9,512 tokens across 201 processed items).
          Podcast and JSON figures are indicative (1 sample each — treat as estimates).
          Video cost uses Gemini 2.5 Flash token-based pricing at ~263 tokens/sec of footage.
          Infrastructure (Lambda, SQS, DynamoDB, S3) is real but minor vs AI costs.
          CloudWatch and data transfer omitted.
        </p>
      </div>
    </div>
  );
}
