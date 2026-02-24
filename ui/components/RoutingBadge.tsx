'use client';

interface RoutingBadgeProps {
  needsReview: boolean;
  routingReason?: string;
}

export default function RoutingBadge({ needsReview, routingReason }: RoutingBadgeProps) {
  if (needsReview) {
    return (
      <div className="flex flex-col gap-1">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-100 border border-amber-300 text-amber-800 font-semibold text-sm w-fit">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path fillRule="evenodd" d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003zM12 8.25a.75.75 0 01.75.75v3.75a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm0 8.25a.75.75 0 100-1.5.75.75 0 000 1.5z" clipRule="evenodd" />
          </svg>
          Needs Review!
        </div>
        {routingReason && (
          <p className="text-xs text-gray-500 ml-1">{routingReason}</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-teal-100 border border-teal-300 text-teal-800 font-semibold text-sm w-fit">
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" />
        </svg>
        Auto-published!
      </div>
      {routingReason && (
        <p className="text-xs text-gray-500 ml-1">{routingReason}</p>
      )}
    </div>
  );
}
