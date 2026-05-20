import Link from 'next/link';
import { getErrorTemplate } from '@/lib/utils/error-template';
import { renderMarkdown } from '@/lib/utils/markdown';

export default async function NotFound() {
  let html = '';
  try {
    const template = await getErrorTemplate('error_template_404', {
      statusCode: '404',
      message: 'Page not found',
      homeUrl: '/',
    });
    html = await renderMarkdown(template);
  } catch {
    // Fallback if DB is unavailable
  }

  return (
    <main id="main" className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm max-w-md w-full p-8 text-center">
        {html ? (
          <div
            className="prose prose-sm mx-auto"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <>
            <h1 className="text-2xl font-semibold text-gray-900 mb-2">404 — Page Not Found</h1>
            <p className="text-gray-600 mb-6">The page you were looking for doesn&apos;t exist.</p>
          </>
        )}
        <Link
          href="/"
          className="inline-block mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
        >
          Home
        </Link>
      </div>
    </main>
  );
}
