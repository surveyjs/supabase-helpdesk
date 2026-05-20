import Link from 'next/link';
import { getErrorTemplate } from '@/lib/utils/error-template';
import { renderMarkdown } from '@/lib/utils/markdown';

export default async function TicketNotFound() {
  let html = '';
  try {
    const template = await getErrorTemplate('error_template_404', {
      statusCode: '404',
      message: 'Ticket not found',
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
            <h1 className="text-2xl font-semibold text-gray-900 mb-2">Ticket Not Found</h1>
            <p className="text-gray-600 mb-6">
              The ticket you&apos;re looking for doesn&apos;t exist or you don&apos;t have access to it.
            </p>
          </>
        )}
        <div className="flex items-center justify-center gap-3 mt-4">
          <Link
            href="/tickets"
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
          >
            My Tickets
          </Link>
          <Link
            href="/"
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
          >
            Home
          </Link>
        </div>
      </div>
    </div>
  );
}
