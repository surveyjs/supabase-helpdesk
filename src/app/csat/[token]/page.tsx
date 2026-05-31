import { createServiceRoleClient } from '@/lib/supabase/server';
import { validateCsatToken } from '@/lib/utils/csat';
import { CsatForm } from './CsatForm';
import Link from 'next/link';

export default async function CsatPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const validation = await validateCsatToken(token);

  if (!validation.valid || !validation.ticketId) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm max-w-md w-full p-8 text-center">
          <h1 className="text-xl font-semibold text-gray-900 mb-2">
            Invalid or Expired Link
          </h1>
          <p className="text-gray-600 mb-6">
            This survey link has expired or has already been used. If you need to rate
            your ticket, please log in and use the &quot;Rate this ticket&quot; link on the ticket page.
          </p>
          <Link
            href="/login"
            className="inline-block px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
          >
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  // Fetch ticket title
  const supabase = createServiceRoleClient();
  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, title')
    .eq('id', validation.ticketId)
    .single();

  const ticketTitle = ticket?.title ?? `Ticket #${validation.ticketId}`;

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="relative bg-white rounded-lg border border-gray-200 shadow-sm max-w-lg w-full p-8">
        <Link
          href="/"
          className="absolute top-3 right-3 text-2xl leading-none text-gray-400 hover:text-gray-600 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none rounded"
          aria-label="Close"
          data-testid="csat-close"
        >
          ×
        </Link>
        <h1 className="text-xl font-semibold text-gray-900 mb-1 text-center">
          Rate Your Experience
        </h1>
        <p className="text-sm text-gray-500 mb-6 text-center">
          {ticketTitle}
        </p>
        <CsatForm
          token={token}
          ticketId={validation.ticketId}
          existingRating={validation.existingRating}
          existingComment={validation.existingComment ?? undefined}
        />
      </div>
    </div>
  );
}
