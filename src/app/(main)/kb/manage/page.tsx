import Link from 'next/link';
import { createServerClient } from '@/lib/supabase/server';
import { requireAgent } from '@/lib/supabase/auth';
import { getProfile } from '@/lib/supabase/auth';
import { changeArticleStatus, deleteArticle, toggleKbVisibility } from '@/lib/actions/kb';

export default async function KbManagePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; category?: string; q?: string; page?: string }>;
}) {
  await requireAgent();
  const profile = await getProfile();
  const isAdmin = profile?.role === 'admin';
  const supabase = await createServerClient();
  const { status, category, q, page } = await searchParams;

  // Fetch KB visibility setting
  const { data: kbSetting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'kb_visible')
    .single();

  const kbVisible = kbSetting?.value === 'true';

  // Fetch categories for filter dropdown
  const { data: categories } = await supabase
    .from('kb_categories')
    .select('id, name')
    .order('display_order');

  // Fetch page size
  const { data: pageSetting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'other_lists_page_size')
    .single();
  const pageSize = pageSetting ? parseInt(pageSetting.value, 10) || 10 : 10;
  const pageNum = parseInt(page ?? '1', 10) || 1;
  const from = (pageNum - 1) * pageSize;
  const to = from + pageSize - 1;

  // Build query
  let query = supabase
    .from('kb_articles')
    .select(`
      id, title, status, helpful_count, not_helpful_count, edited_at, created_at,
      category:kb_categories(id, name),
      author:profiles!kb_articles_author_id_fkey(id, display_name),
      last_editor:profiles!kb_articles_last_editor_id_fkey(id, display_name)
    `, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (status && ['draft', 'published', 'archived'].includes(status)) {
    query = query.eq('status', status);
  }
  if (category) {
    query = query.eq('category_id', category);
  }
  if (q && q.trim()) {
    query = query.ilike('title', `%${q.trim()}%`);
  }

  const { data: articles, count } = await query;
  const totalPages = Math.ceil((count ?? 0) / pageSize);

  function buildFilterUrl(overrides: Record<string, string | undefined>) {
    const params = new URLSearchParams();
    const merged = { status, category, q, page: '1', ...overrides };
    for (const [k, v] of Object.entries(merged)) {
      if (v) params.set(k, v);
    }
    return `/kb/manage?${params.toString()}`;
  }

  const statusBadgeClass: Record<string, string> = {
    draft: 'bg-yellow-100 text-yellow-700',
    published: 'bg-green-100 text-green-700',
    archived: 'bg-gray-100 text-gray-600',
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Manage Articles</h1>
        <Link
          href="/kb/manage/new"
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
        >
          New Article
        </Link>
      </div>

      {/* KB Visibility toggle */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
        <form action={toggleKbVisibility} className="flex items-center gap-3">
          <input type="hidden" name="visible" value={kbVisible ? 'false' : 'true'} />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              defaultChecked={kbVisible}
              disabled={!isAdmin}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 pointer-events-none"
            />
            Knowledge base visible to public
          </label>
          {isAdmin && (
            <button
              type="submit"
              className="px-3 py-1 text-xs bg-gray-100 rounded hover:bg-gray-200 text-gray-700"
            >
              {kbVisible ? 'Disable' : 'Enable'}
            </button>
          )}
          {!isAdmin && (
            <span className="text-xs text-gray-400">(Admin only)</span>
          )}
        </form>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <form action="/kb/manage" method="GET" className="flex flex-wrap gap-2 items-end">
          <div>
            <label htmlFor="filter-status" className="block text-xs text-gray-500 mb-1">Status</label>
            <select
              id="filter-status"
              name="status"
              defaultValue={status ?? ''}
              className="rounded border border-gray-300 px-2 py-1 text-sm"
            >
              <option value="">All</option>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          <div>
            <label htmlFor="filter-category" className="block text-xs text-gray-500 mb-1">Category</label>
            <select
              id="filter-category"
              name="category"
              defaultValue={category ?? ''}
              className="rounded border border-gray-300 px-2 py-1 text-sm"
            >
              <option value="">All</option>
              {(categories ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="filter-search" className="block text-xs text-gray-500 mb-1">Search</label>
            <input
              id="filter-search"
              name="q"
              type="text"
              defaultValue={q ?? ''}
              placeholder="Title…"
              className="rounded border border-gray-300 px-2 py-1 text-sm"
            />
          </div>
          <button
            type="submit"
            className="px-3 py-1 text-sm bg-gray-100 rounded hover:bg-gray-200 text-gray-700"
          >
            Filter
          </button>
        </form>
      </div>

      {/* Articles list */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {(!articles || articles.length === 0) ? (
          <p className="text-gray-500 text-sm p-4">No articles found.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-gray-700">Title</th>
                <th className="text-left px-4 py-2 font-medium text-gray-700">Category</th>
                <th className="text-left px-4 py-2 font-medium text-gray-700">Status</th>
                <th className="text-left px-4 py-2 font-medium text-gray-700">Author</th>
                <th className="text-left px-4 py-2 font-medium text-gray-700">Feedback</th>
                <th className="text-left px-4 py-2 font-medium text-gray-700">Date</th>
                <th className="text-right px-4 py-2 font-medium text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {articles.map((article) => {
                const cat = Array.isArray(article.category) ? article.category[0] : article.category;
                const auth = Array.isArray(article.author) ? article.author[0] : article.author;
                const editor = Array.isArray(article.last_editor) ? article.last_editor[0] : article.last_editor;
                return (
                  <tr key={article.id}>
                    <td className="px-4 py-2">
                      <Link
                        href={`/kb/manage/${article.id}`}
                        className="text-blue-600 hover:text-blue-800"
                      >
                        {article.title}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-gray-600">
                      {cat?.name ?? '—'}
                    </td>
                    <td className="px-4 py-2">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${statusBadgeClass[article.status]}`}>
                        {article.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-gray-600">
                      {auth?.display_name ?? '—'}
                      {editor && editor.id !== auth?.id && (
                        <span className="text-xs text-gray-400 block">
                          edited by {editor.display_name}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-gray-600">
                      👍 {article.helpful_count} · 👎 {article.not_helpful_count}
                    </td>
                    <td className="px-4 py-2 text-gray-500 text-xs">
                      {new Date(article.edited_at ?? article.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex items-center gap-1 justify-end">
                        {article.status === 'draft' && (
                          <form action={changeArticleStatus}>
                            <input type="hidden" name="article_id" value={article.id} />
                            <input type="hidden" name="status" value="published" />
                            <button type="submit" className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200">
                              Publish
                            </button>
                          </form>
                        )}
                        {article.status === 'published' && (
                          <form action={changeArticleStatus}>
                            <input type="hidden" name="article_id" value={article.id} />
                            <input type="hidden" name="status" value="archived" />
                            <button type="submit" className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded hover:bg-gray-200">
                              Archive
                            </button>
                          </form>
                        )}
                        {article.status === 'archived' && (
                          <form action={changeArticleStatus}>
                            <input type="hidden" name="article_id" value={article.id} />
                            <input type="hidden" name="status" value="draft" />
                            <button type="submit" className="px-2 py-1 text-xs bg-yellow-100 text-yellow-700 rounded hover:bg-yellow-200">
                              Unpublish
                            </button>
                          </form>
                        )}
                        <form action={deleteArticle}>
                          <input type="hidden" name="article_id" value={article.id} />
                          <button
                            type="submit"
                            className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
                          >
                            Delete
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center gap-2 justify-center">
          {pageNum > 1 && (
            <Link
              href={buildFilterUrl({ page: String(pageNum - 1) })}
              className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50"
            >
              Previous
            </Link>
          )}
          <span className="text-sm text-gray-600">
            Page {pageNum} of {totalPages}
          </span>
          {pageNum < totalPages && (
            <Link
              href={buildFilterUrl({ page: String(pageNum + 1) })}
              className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50"
            >
              Next
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
