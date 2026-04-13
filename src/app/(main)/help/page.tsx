import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createServerClient } from '@/lib/supabase/server';
import { generateSlug } from '@/lib/utils/slug';
import { searchArticles } from '@/lib/actions/kb';

export default async function HelpCenterPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { q, page } = await searchParams;
  const supabase = await createServerClient();

  // Check if KB is visible
  const { data: kbSetting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'kb_visible')
    .single();

  if (kbSetting?.value !== 'true') notFound();

  // If search query present, show search results
  if (q && q.trim()) {
    const pageNum = parseInt(page ?? '1', 10) || 1;
    const results = await searchArticles(q.trim(), pageNum);
    const totalPages = Math.ceil(results.total / results.pageSize);

    return (
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 mb-6">Help Center</h1>

        {/* Search bar */}
        <form action="/help" method="GET" className="mb-6">
          <div className="flex gap-2">
            <input
              type="text"
              name="q"
              defaultValue={q}
              placeholder="Search articles..."
              className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            />
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
            >
              Search
            </button>
          </div>
        </form>

        <p className="text-sm text-gray-600 mb-4">
          {results.total} result{results.total !== 1 ? 's' : ''} for &quot;{q}&quot;
        </p>

        {results.articles.length === 0 ? (
          <p className="text-gray-500 text-sm">No articles found.</p>
        ) : (
          <ul className="space-y-4">
            {results.articles.map((article) => {
              const catSlug = article.category ? generateSlug(article.category.name) : 'uncategorized';
              return (
                <li key={article.id} className="bg-white rounded-lg border border-gray-200 p-4">
                  <Link
                    href={`/help/${article.id}/${catSlug}/${article.slug}`}
                    className="text-blue-600 hover:text-blue-800 font-medium"
                  >
                    {article.title}
                  </Link>
                  {article.category && (
                    <span className="ml-2 text-xs text-gray-500">{article.category.name}</span>
                  )}
                  <p className="mt-1 text-sm text-gray-600">{article.snippet}</p>
                </li>
              );
            })}
          </ul>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-6 flex items-center gap-2 justify-center">
            {pageNum > 1 && (
              <Link
                href={`/help?q=${encodeURIComponent(q)}&page=${pageNum - 1}`}
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
                href={`/help?q=${encodeURIComponent(q)}&page=${pageNum + 1}`}
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

  // Default: show categories with published article counts
  const { data: categories } = await supabase
    .from('kb_categories')
    .select('id, name, display_order')
    .order('display_order');

  // Get published article counts per category
  const { data: articles } = await supabase
    .from('kb_articles')
    .select('id, category_id')
    .eq('status', 'published');

  const countMap = new Map<string, number>();
  let uncategorizedCount = 0;
  for (const a of articles ?? []) {
    if (a.category_id) {
      countMap.set(a.category_id, (countMap.get(a.category_id) ?? 0) + 1);
    } else {
      uncategorizedCount++;
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Help Center</h1>

      {/* Search bar */}
      <form action="/help" method="GET" className="mb-6">
        <div className="flex gap-2">
          <input
            type="text"
            name="q"
            placeholder="Search articles..."
            className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
          />
          <button
            type="submit"
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
          >
            Search
          </button>
        </div>
      </form>

      {(!categories || categories.length === 0) && uncategorizedCount === 0 ? (
        <p className="text-gray-500 text-sm">No articles available yet.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {(categories ?? []).map((cat) => {
            const count = countMap.get(cat.id) ?? 0;
            return (
              <Link
                key={cat.id}
                href={`/help?q=&category=${cat.id}`}
                className="block bg-white rounded-lg border border-gray-200 p-4 hover:shadow-sm transition-shadow"
              >
                <h2 className="text-lg font-medium text-gray-900">{cat.name}</h2>
                <p className="text-sm text-gray-500 mt-1">
                  {count} article{count !== 1 ? 's' : ''}
                </p>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
