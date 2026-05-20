'use client';

import Link from 'next/link';

export default function GlobalError({
  error: _error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main id="main" className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm max-w-md w-full p-8 text-center">
        <h1 className="text-2xl font-semibold text-gray-900 mb-2">500 — Something Went Wrong</h1>
        <p className="text-gray-600 mb-6">
          An unexpected error occurred. Please try again later.
        </p>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={reset}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
          >
            Try again
          </button>
          <Link
            href="/"
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
          >
            Home
          </Link>
        </div>
      </div>
    </main>
  );
}
