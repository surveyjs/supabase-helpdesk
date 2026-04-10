import Link from 'next/link';
import { createServerClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/auth';
import { TicketList } from '@/components/features/tickets/TicketList';
import { StatusFilter } from '@/components/features/tickets/StatusFilter';
import { Pagination } from '@/components/ui/Pagination';

const PAGE_SIZE = 20;

export default async function MyTicketsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireAuth();
  const supabase = await createServerClient();

  const params = await searchParams;
  const statusFilter = (params.status as string) ?? 'all';
  const search = (params.q as string) ?? '';
  const currentPage = Math.max(1, parseInt((params.page as string) ?? '1', 10) || 1);

  // Build query
  let query = supabase
    .from('tickets')
    .select('id, title, slug, status, updated_at', { count: 'exact' })
    .eq('creator_id', user.id)
    .order('updated_at', { ascending: false });

  // Status filter
  if (statusFilter === 'active') {
    query = query.in('status', ['open', 'pending']);
  } else if (statusFilter === 'closed') {
    query = query.eq('status', 'closed');
  }

  // Full-text search
  if (search.trim()) {
    const searchTerms = search.trim().split(/\s+/).join(' & ');
    query = query.textSearch('search_vector', searchTerms, { type: 'plain', config: 'english' });
  }

  // Pagination
  const from = (currentPage - 1) * PAGE_SIZE;
  query = query.range(from, from + PAGE_SIZE - 1);

  const { data: tickets, count } = await query;
  const totalPages = Math.ceil((count ?? 0) / PAGE_SIZE);

  // Build params for links
  const linkParams: Record<string, string> = {};
  if (statusFilter !== 'all') linkParams.status = statusFilter;
  if (search) linkParams.q = search;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">My Tickets</h1>
        <Link
          href="/tickets/new"
          className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          Create Ticket
        </Link>
      </div>

      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mb-4">
        <StatusFilter
          current={statusFilter}
          basePath="/tickets"
          searchParams={linkParams}
        />

        <form method="get" action="/tickets" className="flex gap-2 flex-1 max-w-md">
          {statusFilter !== 'all' && (
            <input type="hidden" name="status" value={statusFilter} />
          )}
          <input
            type="search"
            name="q"
            defaultValue={search}
            placeholder="Search tickets…"
            className="flex-1 rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            aria-label="Search tickets"
          />
          <button
            type="submit"
            className="px-3 py-1.5 text-sm bg-gray-100 rounded hover:bg-gray-200 text-gray-700"
          >
            Search
          </button>
          {search && (
            <Link
              href={statusFilter !== 'all' ? `/tickets?status=${statusFilter}` : '/tickets'}
              className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700"
            >
              Clear
            </Link>
          )}
        </form>
      </div>

      <div className="mb-4">
        <Link
          href="/tickets/public"
          className="text-sm text-blue-600 hover:text-blue-800"
        >
          Browse Public Tickets →
        </Link>
      </div>

      <TicketList tickets={tickets ?? []} />

      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        basePath="/tickets"
        searchParams={linkParams}
        pageSize={PAGE_SIZE}
      />
    </div>
  );
}
