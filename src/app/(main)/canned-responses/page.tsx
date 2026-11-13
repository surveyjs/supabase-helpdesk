import { createServerClient } from '@/lib/supabase/server';
import { requireAgent } from '@/lib/supabase/auth';
import { CannedResponseList } from '@/components/features/canned-responses/CannedResponseList';
import { Pagination, clampPage } from '@/components/ui/Pagination';

const PAGE_SIZE = 20;

export default async function CannedResponsesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; visibility?: string }>;
}) {
  const user = await requireAgent();
  const { page, q, visibility } = await searchParams;
  const supabase = await createServerClient();

  const requestedPage = Math.max(1, parseInt(page ?? '1', 10) || 1);

  // Get current user profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .single();

  const isAdmin = profile?.role === 'admin';

  // Build query
  let query = supabase
    .from('canned_responses')
    .select(
      'id, title, body, visibility, author_id, created_at, updated_at, author:profiles!canned_responses_author_id_fkey(display_name)',
      { count: 'exact' },
    )
    .order('updated_at', { ascending: false });

  // Search filter
  if (q && q.trim()) {
    const sanitized = q.trim().replace(/[,()."\\]/g, '');
    if (sanitized) {
      const term = `%${sanitized}%`;
      query = query.or(`title.ilike.${term},body.ilike.${term}`);
    }
  }

  // Visibility filter
  if (visibility === 'public') {
    query = query.eq('visibility', 'public');
  } else if (visibility === 'private') {
    query = query.eq('visibility', 'private');
  }

  // A page past the end (e.g. ?page=999) re-queries the last page.
  const fetchPage = (forPage: number) => {
    const offset = (forPage - 1) * PAGE_SIZE;
    return query.range(offset, offset + PAGE_SIZE - 1);
  };

  let { data: responses, count } = await fetchPage(requestedPage);
  if (requestedPage > 1 && (responses ?? []).length === 0) {
    const probe = await fetchPage(1);
    const lastPage = clampPage(requestedPage, Math.ceil((probe.count ?? 0) / PAGE_SIZE));
    ({ data: responses, count } = lastPage === 1 ? probe : await fetchPage(lastPage));
  }

  const totalPages = Math.ceil((count ?? 0) / PAGE_SIZE);
  const currentPage = clampPage(requestedPage, totalPages);

  const mappedResponses = (responses ?? []).map((r) => ({
    ...r,
    author: Array.isArray(r.author) ? r.author[0] : r.author,
  }));

  const searchParamsObj: Record<string, string> = {};
  if (q) searchParamsObj.q = q;
  if (visibility) searchParamsObj.visibility = visibility;

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Canned Responses</h1>

      {/* Search and Filter */}
      <form className="flex flex-wrap gap-3 mb-6" method="GET">
        <input
          type="text"
          name="q"
          aria-label="Search canned responses"
          defaultValue={q ?? ''}
          placeholder="Search by title or body…"
          className="flex-1 min-w-[200px] form-input"
        />
        <select
          name="visibility"
          aria-label="Filter by visibility"
          defaultValue={visibility ?? ''}
          className="form-select"
        >
          <option value="">All</option>
          <option value="public">Public</option>
          <option value="private">Private</option>
        </select>
        <button
          type="submit"
          className="px-4 h-[36px] text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200 border border-gray-300"
        >
          Search
        </button>
      </form>

      <CannedResponseList
        responses={mappedResponses}
        currentUserId={user.id}
        isAdmin={isAdmin}
      />

      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        basePath="/canned-responses"
        searchParams={searchParamsObj}
        pageSize={PAGE_SIZE}
      />
    </div>
  );
}
