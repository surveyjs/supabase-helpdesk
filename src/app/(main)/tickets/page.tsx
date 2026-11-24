import Link from 'next/link';
import { createServerClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/auth';
import { TicketList } from '@/components/features/tickets/TicketList';
import { StatusFilter } from '@/components/features/tickets/StatusFilter';
import { Pagination, clampPage } from '@/components/ui/Pagination';
import { CategorySelect } from '@/components/features/tickets/CategorySelect';
import { parseCategoryParam } from '@/lib/filters/category-param';
import { toQuery } from '@/lib/utils/query-string';

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
  const requestedPage = Math.max(1, parseInt((params.page as string) ?? '1', 10) || 1);
  const view = (params.view as string) ?? 'my';
  const category = parseCategoryParam(params.category);

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

  // Shared filter values
  const searchTerms = search.trim() ? search.trim().split(/\s+/).join(' & ') : '';
  type ListedTicket = {
    id: number; title: string; slug: string; status: string; updated_at: string;
    creator_name?: string; category_name?: string | null;
  };
  const categoryName = (c: { name: string } | { name: string }[] | null | undefined) =>
    (Array.isArray(c) ? c[0]?.name : c?.name) ?? null;

  async function fetchPage(forPage: number): Promise<{ ticketsForList: ListedTicket[]; count: number | null }> {
    const from = (forPage - 1) * PAGE_SIZE;
    let ticketsForList: ListedTicket[];
    let count: number | null;

    if (isTeamView) {
      let query = supabase
        .from('tickets')
        .select('id, title, slug, status, updated_at, category:categories(name), creator:profiles!tickets_creator_id_fkey(display_name)', { count: 'exact' })
        .order('updated_at', { ascending: false })
        .in('creator_id', teamMemberIds);
      if (category) query = query.eq('category_id', category);
      if (statusFilter === 'active') query = query.in('status', ['open', 'pending']);
      else if (statusFilter === 'closed') query = query.eq('status', 'closed');
      if (searchTerms) query = query.textSearch('search_vector', searchTerms, { type: 'plain', config: 'english' });
      query = query.range(from, from + PAGE_SIZE - 1);

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
          category_name: categoryName(t.category),
        };
      });
    } else {
      let query = supabase
        .from('tickets')
        .select('id, title, slug, status, updated_at, category:categories(name)', { count: 'exact' })
        .order('updated_at', { ascending: false })
        .eq('creator_id', user.id);
      if (category) query = query.eq('category_id', category);
      if (statusFilter === 'active') query = query.in('status', ['open', 'pending']);
      else if (statusFilter === 'closed') query = query.eq('status', 'closed');
      if (searchTerms) query = query.textSearch('search_vector', searchTerms, { type: 'plain', config: 'english' });
      query = query.range(from, from + PAGE_SIZE - 1);

      const { data: tickets, count: c } = await query;
      count = c;
      ticketsForList = (tickets ?? []).map((t) => ({
        id: t.id,
        title: t.title,
        slug: t.slug,
        status: t.status,
        updated_at: t.updated_at,
        category_name: categoryName(t.category),
      }));
    }

    return { ticketsForList, count };
  }

  let { ticketsForList, count } = await fetchPage(requestedPage);
  if (requestedPage > 1 && ticketsForList.length === 0) {
    // Past the last page (e.g. ?page=999): probe page 1 for the total, then show the last page.
    const probe = await fetchPage(1);
    const lastPage = clampPage(requestedPage, Math.ceil((probe.count ?? 0) / PAGE_SIZE));
    ({ ticketsForList, count } = lastPage === 1 ? probe : await fetchPage(lastPage));
  }
  const totalPages = Math.ceil((count ?? 0) / PAGE_SIZE);
  const currentPage = clampPage(requestedPage, totalPages);

  // Build params for links
  const linkParams: Record<string, string> = {};
  if (statusFilter !== 'all') linkParams.status = statusFilter;
  if (search) linkParams.q = search;
  if (isTeamView) linkParams.view = 'team';
  if (category) linkParams.category = category;

  const { data: categories } = await supabase.from('categories').select('id, name').order('name');
  const statusParam = statusFilter !== 'all' ? statusFilter : '';

  return (
    <div>
      <h1 className="sr-only">My Tickets</h1>

      {/* Team toggle */}
      {hasTeam && (
        <div className="flex gap-2 mb-4" data-testid="team-toggle">
          <Link
            href={`/tickets${toQuery({ status: statusParam, q: search, category })}`}
            className={`px-3 py-1.5 text-sm rounded font-medium ${
              !isTeamView
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            My Tickets
          </Link>
          <Link
            href={`/tickets${toQuery({ view: 'team', status: statusParam, q: search, category })}`}
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

        <form method="get" action="/tickets" className="flex flex-wrap gap-2 flex-1 max-w-2xl">
          {statusFilter !== 'all' && (
            <input type="hidden" name="status" value={statusFilter} />
          )}
          {isTeamView && (
            <input type="hidden" name="view" value="team" />
          )}
          <CategorySelect categories={categories ?? []} current={category} />
          <input
            type="search"
            name="q"
            defaultValue={search}
            placeholder="Search tickets…"
            className="flex-1 form-input"
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
              href={`/tickets${toQuery({ view: isTeamView ? 'team' : '', status: statusParam, category })}`}
              className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700"
            >
              Clear
            </Link>
          )}
        </form>

        <Link
          href="/tickets/new"
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
        >
          New Ticket
        </Link>
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
