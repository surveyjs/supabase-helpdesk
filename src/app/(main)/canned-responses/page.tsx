import { createServerClient } from '@/lib/supabase/server';
import { requireAgent } from '@/lib/supabase/auth';
import { CannedResponseList } from '@/components/features/canned-responses/CannedResponseList';
import { Pagination } from '@/components/ui/Pagination';

const PAGE_SIZE = 20;

export default async function CannedResponsesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; visibility?: string }>;
}) {
  const user = await requireAgent();
  const { page, q, visibility } = await searchParams;
  const supabase = await createServerClient();

  const currentPage = Math.max(1, parseInt(page ?? '1', 10) || 1);
  const offset = (currentPage - 1) * PAGE_SIZE;

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
    .order('updated_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  // Search filter
  if (q && q.trim()) {
    const term = `%${q.trim()}%`;
    query = query.or(`title.ilike.${term},body.ilike.${term}`);
  }

  // Visibility filter
  if (visibility === 'public') {
    query = query.eq('visibility', 'public');
  } else if (visibility === 'private') {
    query = query.eq('visibility', 'private');
  }

  const { data: responses, count } = await query;

  const totalPages = Math.ceil((count ?? 0) / PAGE_SIZE);

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
          defaultValue={q ?? ''}
          placeholder="Search by title or body…"
          className="flex-1 min-w-[200px] rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
        />
        <select
          name="visibility"
          defaultValue={visibility ?? ''}
          className="rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
        >
          <option value="">All</option>
          <option value="public">Public</option>
          <option value="private">Private</option>
        </select>
        <button
          type="submit"
          className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200 border border-gray-300"
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
