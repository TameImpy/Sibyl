import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sibyl — Content Tagging PoC',
  description: 'Stakeholder demo for the Sibyl intelligent content tagging system',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        <div className="flex min-h-screen">
          {/* Blue sidebar */}
          <aside className="flex flex-col w-80 shrink-0 bg-[#1652a0] text-white px-6 py-8">
            {/* Logo / wordmark */}
            <div className="mb-10">
              <div className="flex items-center gap-2 mb-1">
                <svg className="w-7 h-7 text-[#29b6d8]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                </svg>
                <span className="text-2xl font-bold tracking-tight">Sibyl</span>
              </div>
              <p className="text-[#4a9ed6] text-sm font-medium">Intelligent Content Tagging</p>
            </div>

            {/* Nav */}
            <nav className="flex flex-col gap-2 flex-1">
              <p className="text-xs font-semibold uppercase tracking-widest text-[#4a9ed6] mb-2">Demo</p>

              <Link
                href="/"
                className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-white/10 transition-colors font-medium"
              >
                <svg className="w-5 h-5 text-[#4a9ed6]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Submit Content
              </Link>

              <Link
                href="/review"
                className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-white/10 transition-colors font-medium"
              >
                <svg className="w-5 h-5 text-[#4a9ed6]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
                </svg>
                Review Queue
              </Link>

              {/* Content type cards */}
              <div className="mt-8">
                <p className="text-xs font-semibold uppercase tracking-widest text-[#4a9ed6] mb-3">Supported Types</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: 'Article', icon: 'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z' },
                    { label: 'Podcast', icon: 'M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z' },
                    { label: 'Video', icon: 'M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z' },
                    { label: 'JSON', icon: 'M14.25 9.75L16.5 12l-2.25 2.25m-4.5 0L7.5 12l2.25-2.25M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z' },
                  ].map(({ label, icon }) => (
                    <div key={label} className="flex flex-col items-center gap-1.5 bg-[#1e6bc0] rounded-xl p-3">
                      <svg className="w-6 h-6 text-[#4a9ed6]" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
                      </svg>
                      <span className="text-xs font-medium">{label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Pipeline info */}
              <div className="mt-6 bg-[#1e6bc0] rounded-xl p-4 text-sm">
                <p className="font-semibold mb-2 text-white">Pipeline</p>
                {['Submit content', 'SQS queue', 'Lambda + AI', 'DynamoDB', 'Tag results'].map((step, i, arr) => (
                  <div key={step} className="flex items-center gap-2">
                    <span className="text-[#4a9ed6]">→</span>
                    <span className={i === arr.length - 1 ? 'text-[#29b6d8] font-medium' : 'text-white/80'}>{step}</span>
                  </div>
                ))}
              </div>
            </nav>

            {/* Footer */}
            <div className="mt-6 text-xs text-white/40 space-y-1">
              <p>Sibyl PoC · Phase 0</p>
              <p>Mock mode enabled</p>
            </div>
          </aside>

          {/* Main content */}
          <main className="flex-1 overflow-auto">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
