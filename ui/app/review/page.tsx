import ReviewQueueTable from '@/components/ReviewQueueTable';

async function getQueueItems() {
  try {
    // Server component — call the API route (or directly call DynamoDB in a real app)
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000';
    const res = await fetch(`${baseUrl}/api/queue?limit=50`, {
      cache: 'no-store',
    });
    if (!res.ok) return { items: [], error: `HTTP ${res.status}` };
    return res.json();
  } catch (e) {
    return { items: [], error: String(e) };
  }
}

export const dynamic = 'force-dynamic';

export default async function ReviewQueuePage() {
  const { items, error } = await getQueueItems();

  return (
    <div className="max-w-4xl mx-auto px-8 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Review Queue</h1>
          <p className="text-gray-500 text-sm">
            Items where one or more tags fell below the 85% confidence threshold. Approve or reject in Phase 2.
          </p>
        </div>
        {items.length > 0 && (
          <span className="bg-amber-100 text-amber-800 text-sm font-semibold px-3 py-1 rounded-full">
            {items.length} pending
          </span>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
        {error ? (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
            Failed to load review queue: {error}
          </div>
        ) : (
          <ReviewQueueTable items={items} />
        )}
      </div>

      {/* Phase 2 callout */}
      <div className="mt-6 bg-[#1652a0]/5 border border-[#1652a0]/20 rounded-xl p-4 text-sm text-[#1652a0]">
        <span className="font-semibold">Phase 2 (INT-013):</span> Approve / Reject workflow, bulk actions, and editorial
        notes will be added here without structural changes to this table.
      </div>
    </div>
  );
}
