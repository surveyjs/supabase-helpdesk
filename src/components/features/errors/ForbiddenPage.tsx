import Link from 'next/link';
import { getErrorTemplate } from '@/lib/utils/error-template';
import { renderMarkdown } from '@/lib/utils/markdown';

export async function ForbiddenPage({ message }: { message?: string }) {
  let html = '';
  try {
    const template = await getErrorTemplate('error_template_403', {
      statusCode: '403',
      message: message ?? 'Access denied',
      homeUrl: '/',
    });
    html = await renderMarkdown(template);
  } catch {
    // Fallback
  }

  return (
    <div className="text-center py-12">
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm max-w-md mx-auto p-8">
        {html ? (
          <div
            className="prose prose-sm mx-auto"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <>
            <h1 className="text-2xl font-semibold text-gray-900 mb-2">403 — Access Denied</h1>
            <p className="text-gray-600 mb-6">
              {message ?? 'You don\'t have permission to access this page.'}
            </p>
          </>
        )}
        <Link
          href="/"
          className="inline-block mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
        >
          Go home
        </Link>
      </div>
    </div>
  );
}
