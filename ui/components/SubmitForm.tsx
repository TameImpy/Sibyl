'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type ContentTypeTab = 'article' | 'podcast' | 'json' | 'video';

const SAMPLES: Record<ContentTypeTab, Record<string, string>> = {
  article: {
    title: 'Ultimate Slow Cooker Meals Guide',
    content_text:
      'The Ultimate Guide to Slow Cooker Meals: Transform your busy weeknights with these easy slow cooker recipes. Learn how to make tender pulled pork, hearty beef stew, and flavorful chicken dishes. Perfect for meal prep and batch cooking. These one-pot meals save time and deliver restaurant-quality results with minimal effort.',
  },
  podcast: {
    title: 'Keto Diet Essentials Podcast',
    content_text:
      "[TRANSCRIPT] In today's episode, we discuss the ketogenic diet and low-carb meal planning. Our guest nutritionist explains how to prepare keto-friendly recipes, including high-protein breakfast options, sugar-free desserts, and meal prep strategies for busy professionals. We cover common keto mistakes and how to maintain ketosis.",
  },
  json: {
    title: 'Board Games JSON Data',
    content_text:
      '{"title": "10 Best Board Games for Family Game Night", "summary": "Discover the top board games perfect for family bonding and indoor activities. Includes strategy games, card games, and party games suitable for all ages. Great for rainy day entertainment.", "tags_suggested": ["family-games", "board-games", "indoor-activities"]}',
  },
  video: {
    title: 'Air Fryer Cooking Basics',
    content_url: 's3://content-bucket/videos/air-fryer-cooking.mp4',
    duration_seconds: '600',
  },
};

const TAB_LABELS: Record<ContentTypeTab, string> = {
  article: 'Article',
  podcast: 'Podcast',
  json: 'JSON Record',
  video: 'Video',
};

export default function SubmitForm() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<ContentTypeTab>('article');
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function loadSample() {
    setFormData(SAMPLES[activeTab]);
    setError(null);
  }

  function handleChange(field: string, value: string) {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const body: Record<string, unknown> = {
      content_type: activeTab,
      title: formData.title ?? '',
      ...(activeTab === 'video'
        ? {
            content_url: formData.content_url ?? '',
            duration_seconds: formData.duration_seconds ? Number(formData.duration_seconds) : undefined,
          }
        : { content_text: formData.content_text ?? '' }),
    };

    try {
      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ? JSON.stringify(data.error) : 'Submission failed');
        return;
      }

      const { contentId, contentType } = await res.json();
      router.push(`/results/${contentId}?contentType=${contentType}`);
    } catch {
      setError('Network error — check your connection');
    } finally {
      setLoading(false);
    }
  }

  function switchTab(tab: ContentTypeTab) {
    setActiveTab(tab);
    setFormData({});
    setError(null);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {(Object.keys(TAB_LABELS) as ContentTypeTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => switchTab(tab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab
                ? 'bg-white text-[#1652a0] shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {/* Load sample */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={loadSample}
          className="text-xs text-[#1652a0] hover:underline font-medium flex items-center gap-1"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          Load sample {TAB_LABELS[activeTab].toLowerCase()}
        </button>
      </div>

      {/* Title field — all tabs */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
        <input
          type="text"
          required
          value={formData.title ?? ''}
          onChange={(e) => handleChange('title', e.target.value)}
          placeholder={`e.g. ${SAMPLES[activeTab].title}`}
          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#4a9ed6] focus:border-transparent"
        />
      </div>

      {/* Content-type specific fields */}
      {activeTab !== 'video' ? (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {activeTab === 'json' ? 'JSON Body' : 'Content Text'}
          </label>
          <textarea
            required
            rows={8}
            value={formData.content_text ?? ''}
            onChange={(e) => handleChange('content_text', e.target.value)}
            placeholder={activeTab === 'json' ? '{"title": "...", "summary": "..."}' : 'Paste article or transcript text here…'}
            className={`w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#4a9ed6] focus:border-transparent resize-y ${activeTab === 'json' ? 'font-mono' : ''}`}
          />
        </div>
      ) : (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Video URL</label>
            <input
              type="url"
              required
              value={formData.content_url ?? ''}
              onChange={(e) => handleChange('content_url', e.target.value)}
              placeholder="s3://bucket/path/video.mp4"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#4a9ed6] focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Duration (seconds)</label>
            <input
              type="number"
              min={1}
              value={formData.duration_seconds ?? ''}
              onChange={(e) => handleChange('duration_seconds', e.target.value)}
              placeholder="600"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#4a9ed6] focus:border-transparent"
            />
          </div>
        </>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={loading}
        className="w-full bg-[#29b6d8] hover:bg-[#1ca0c0] disabled:opacity-60 text-white font-semibold py-3 px-6 rounded-full transition-colors flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
            Submitting…
          </>
        ) : (
          <>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
            Submit for Tagging
          </>
        )}
      </button>
    </form>
  );
}
