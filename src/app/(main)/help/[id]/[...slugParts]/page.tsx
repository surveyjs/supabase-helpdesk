import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { createServerClient } from '@/lib/supabase/server';
import { getUser, getProfile } from '@/lib/supabase/auth';
import { generateSlug } from '@/lib/utils/slug';
import { renderMarkdown } from '@/lib/utils/markdown';
import { ArticleFeedback } from './ArticleFeedback';

export default async function ArticleDetailPage({
  params,
}: {
  params: Promise<{ id: string; slugParts: string[] }>;
}) {
  const { id, slugParts } = await params;
  const supabase = await createServerClient();

  // Check if KB is visible
  const { data: kbSetting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'kb_visible')
    .single();

  const user = await getUser();
  const profile = user ? await getProfile() : null;
  const isAgent = profile?.role === 'agent' || profile?.role === 'admin';

  // If KB is not visible and user is not an agent, 404
  if (kbSetting?.value !== 'true' && !isAgent) notFound();

  // Fetch article
  const { data: article } = await supabase
    .from('kb_articles')
    .select(`
      id, title, slug, body, status, category_id, author_id, last_editor_id,
      source_ticket_id, helpful_count, not_helpful_count, edited_at, created_at,
      category:kb_categories(id, name),
      author:profiles!kb_articles_author_id_fkey(id, display_name),
      last_editor:profiles!kb_articles_last_editor_id_fkey(id, display_name)
    `)
    .eq('id', id)
    .single();

  if (!article) notFound();

  // Draft articles: 404 for non-agents
  if (article.status === 'draft' && !isAgent) notFound();

  const category = Array.isArray(article.category) ? article.category[0] : article.category;
  const author = Array.isArray(article.author) ? article.author[0] : article.author;
  const lastEditor = Array.isArray(article.last_editor) ? article.last_editor[0] : article.last_editor;

  // Build correct URL slugs
  const catSlug = category ? generateSlug(category.name) : 'uncategorized';
  const articleSlug = article.slug;
  const expectedSlugs = [catSlug, articleSlug];

  // Check slug match, redirect if wrong
  if (
    slugParts.length !== 2 ||
    slugParts[0] !== expectedSlugs[0] ||
    slugParts[1] !== expectedSlugs[1]
  ) {
    redirect(`/help/${article.id}/${catSlug}/${articleSlug}`);
  }

  // Render body as Markdown
  const htmlBody = await renderMarkdown(article.body);

  // Get user's existing feedback (if authenticated)
  let userFeedback: boolean | null = null;
  if (user) {
    const { data: feedback } = await supabase
      .from('kb_article_feedback')
      .select('is_helpful')
      .eq('article_id', article.id)
      .eq('user_id', user.id)
      .single();
    if (feedback) userFeedback = feedback.is_helpful;
  }

  const lastUpdated = article.edited_at || article.created_at;

  return (
    <div>
      {/* Draft banner */}
      {article.status === 'draft' && isAgent && (
        <div className="mb-4 p-3 rounded bg-yellow-50 border border-yellow-200 text-yellow-800 text-sm">
          This article is a <strong>draft</strong> and is not visible to the public.
        </div>
      )}

      {/* Archived banner */}
      {article.status === 'archived' && (
        <div className="mb-4 p-3 rounded bg-gray-50 border border-gray-200 text-gray-600 text-sm">
          This article may be outdated.
        </div>
      )}

      {/* Breadcrumb */}
      <nav className="text-sm text-gray-500 mb-4" aria-label="Breadcrumb">
        <Link href="/help" className="hover:text-gray-700">Help Center</Link>
        {category && (
          <>
            <span className="mx-1">/</span>
            <span>{category.name}</span>
          </>
        )}
      </nav>

      <h1 className="text-2xl font-semibold text-gray-900 mb-2">{article.title}</h1>

      <div className="text-sm text-gray-500 mb-6">
        By {author?.display_name ?? 'Unknown'}
        {lastEditor && lastEditor.id !== author?.id && (
          <> · Last edited by {lastEditor.display_name}</>
        )}
      </div>

      {/* Article body */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <div
          className="prose prose-sm max-w-none"
          dangerouslySetInnerHTML={{ __html: htmlBody }}
        />
        <p className="mt-6 text-xs text-gray-400">
          Last updated on {new Date(lastUpdated).toLocaleDateString()}
        </p>
      </div>

      {/* Feedback section */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Was this helpful?</h2>
        <ArticleFeedback
          articleId={article.id}
          helpfulCount={article.helpful_count}
          notHelpfulCount={article.not_helpful_count}
          currentVote={userFeedback}
          isAuthenticated={!!user}
        />
      </div>

      {/* Still need help? */}
      {user && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-2">Still need help?</h2>
          <Link
            href={`/tickets/new?from_article=${article.id}`}
            className="text-blue-600 hover:text-blue-800 text-sm"
          >
            Create a ticket
          </Link>
        </div>
      )}
    </div>
  );
}
