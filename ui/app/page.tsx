import SubmitForm from '@/components/SubmitForm';

export default function HomePage() {
  return (
    <div className="max-w-2xl mx-auto px-8 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Submit Content</h1>
        <p className="text-gray-500 text-sm">
          Content goes to SQS → Lambda → Claude / Gemini (mock) → DynamoDB. Results appear within ~5 seconds.
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
        <SubmitForm />
      </div>

      {/* Pipeline explainer */}
      <div className="mt-8 grid grid-cols-5 gap-2 text-center text-xs text-gray-500">
        {[
          { label: 'Submit', sub: 'API route' },
          { label: 'SQS', sub: 'Queue' },
          { label: 'Lambda', sub: 'Processor' },
          { label: 'AI Model', sub: 'Claude / Gemini' },
          { label: 'DynamoDB', sub: 'Results' },
        ].map((step, i, arr) => (
          <div key={step.label} className="flex items-center gap-2">
            <div className="flex-1">
              <div className="bg-[#1652a0] text-white rounded-lg py-2 px-1 font-semibold text-xs mb-0.5">{step.label}</div>
              <div className="text-gray-400">{step.sub}</div>
            </div>
            {i < arr.length - 1 && (
              <svg className="w-4 h-4 text-gray-300 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
