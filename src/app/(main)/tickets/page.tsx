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
  const view = (params.view as string) ?? 'my';

  // Check if user belongs to a team
  const { data: profile } = await supabase
    .from('profiles')
    .select('team_id')
    .eq('id', user.id)
    .single();

  const hasTeam = !!profile?.team_id;
  const isTeamView = hasTeam && view === 'team';

  // For team view, get all team members
  let teamMemberIds: string[] = [];
  if (isTeamView && profile?.team_id) {
    const { data: members } = await supabase
      .from('profiles')
      .select('id')
      .eq('team_id', profile.team_id);
    teamMemberIds = (members ?? []).map((m) => m.id);
  }

  // Build base query helper
  function applyFilters<T extends { eq: (...args: never[]) => T; in: (...args: never[]) => T; textSearch: (...args: never[]) => T; range: (...args: never[]) => T }>(q: T): T {
    if (isTeamView) {
      q = q.in('creator_id', teamMemberIds) as T;
    } else {
      q = q.eq('creator_id', user.id) as T;
    }
    if (statusFilter === 'active') {
      q = q.in('status', ['open', 'pending']) as T;
    } else if (statusFilter === 'closed') {
      q = q.eq('status', 'closed') as T;
    }
    if (search.trim()) {
      const searchTerms = search.trim().split(/\s+/).join(' & ');
      q = q.textSearch('search_vector', searchTerms, { type: 'plain', config: 'english' }) as T;
    }
    const from = (currentPage - 1) * PAGE_SIZE;
    q = q.range(from, from + PAGE_SIZE - 1) as T;
    return q;
  }

  let ticketsForList: { id: number; title: string; slug: string; status: string; updated_at: string; creator_name?: string }[];
  let count: number | null;

  if (isTeamView) {
    const query = applyFilters(
      supabase
        .from('tickets')
        .select('id, title, slug, status, updated_at, creator:profiles!tickets_creator_id_fkey(display_name)', { count: 'exact' })
        .order('updated_at', { ascending: false }),
    );
    const { data: tickets, count: c } = await query;
    count = c;
    ticketsForList = (tickets ?? []).map((t) => {
      const creator = Array.isArray(t.creator) ? t.creator[0] : t.creator;
      return {
        id: t.id,
        title: t.title,
        slug: t.slug,
        status: t.status,
        updated_at: t.updated_at,
        creator_name: creator?.display_name ?? 'Unknown',
      };
    });
  } else {
    const query = applyFilters(
      supabase
        .from('tickets')
        .select('id, title, slug, status, updated_at', { count: 'exact' })
        .order('updated_at', { ascending: false }),
    );
    const { data: tickets, count: c } = await query;
    count = c;
    ticketsForList = (tickets ?? []).map((t) => ({
      id: t.id,
      title: t.title,
      slug: t.slug,
      status: t.status,
      updated_at: t.updated_at,
    }));
  }

  const totalPages = Math.ceil((count ?? 0) / PAGE_SIZE);

  // Build params for links
  const linkParams: Record<string, string> = {};
  if (statusFilter !== 'all') linkParams.status = statusFilter;
  if (search) linkParams.q = search;
  if (isTeamView) linkParams.view = 'team';

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">
          {isTeamView ? 'Team Tickets' : 'My Tickets'}
        </h1>
        <Link
          href="/tickets/new"
          className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          Create Ticket
        </Link>
      </div>

      {/* Team toggle */}
      {hasTeam && (
        <div className="flex gap-2 mb-4" data-testid="team-toggle">
          <Link
            href={`/tickets${statusFilter !== 'all' ? `?status=${statusFilter}` : ''}${search ? `${statusFilter !== 'all' ? '&' : '?'}q=${encodeURIComponent(search)}` : ''}`}
            className={`px-3 py-1.5 text-sm rounded font-medium ${
              !isTeamView
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            My Tickets
          </Link>
          <Link
            href={`/tickets?view=team${statusFilter !== 'all' ? `&status=${statusFilter}` : ''}${search ? `&q=${encodeURIComponent(search)}` : ''}`}
            className={`px-3 py-1.5 text-sm rounded font-medium ${
              isTeamView
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Team Tickets
          </Link>
        </div>
      )}

      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mb-4">
        <StatusFilter
          current={statusFilter}
          basePath="/tickets"
          searchParams={isTeamView ? { ...linkParams } : linkParams}
        />

        <form method="get" action="/tickets" className="flex gap-2 flex-1 max-w-md">
          {statusFilter !== 'all' && (
            <input type="hidden" name="status" value={statusFilter} />
          )}
          {isTeamView && (
            <input type="hidden" name="view" value="team" />
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
              href={`/tickets${isTeamView ? '?view=team' : ''}${statusFilter !== 'all' ? `${isTeamView ? '&' : '?'}status=${statusFilter}` : ''}`}
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

      <TicketList tickets={ticketsForList} showCreator={isTeamView} />

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
