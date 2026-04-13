import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createServerClient } from '@/lib/supabase/server';
import { requireAgent } from '@/lib/supabase/auth';
import { changeArticleStatus, deleteArticle } from '@/lib/actions/kb';
import { ArticleEditorForm } from '../new/ArticleEditorForm';

export default async function EditArticlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAgent();
  const { id } = await params;
  const supabase = await createServerClient();

  const { data: article } = await supabase
    .from('kb_articles')
    .select(`
      id, title, body, status, category_id, source_ticket_id,
      author:profiles!kb_articles_author_id_fkey(id, display_name),
      last_editor:profiles!kb_articles_last_editor_id_fkey(id, display_name)
    `)
    .eq('id', id)
    .single();

  if (!article) notFound();

  const author = Array.isArray(article.author) ? article.author[0] : article.author;
  const lastEditor = Array.isArray(article.last_editor) ? article.last_editor[0] : article.last_editor;

  const { data: categories } = await supabase
    .from('kb_categories')
    .select('id, name')
    .order('display_order');

  const statusActions: { label: string; value: string; className: string }[] = [];
  if (article.status === 'draft') {
    statusActions.push({ label: 'Publish', value: 'published', className: 'bg-green-100 text-green-700 hover:bg-green-200' });
  }
  if (article.status === 'published') {
    statusActions.push({ label: 'Archive', value: 'archived', className: 'bg-gray-100 text-gray-600 hover:bg-gray-200' });
    statusActions.push({ label: 'Unpublish', value: 'draft', className: 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200' });
  }
  if (article.status === 'archived') {
    statusActions.push({ label: 'Restore to Draft', value: 'draft', className: 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200' });
    statusActions.push({ label: 'Re-publish', value: 'published', className: 'bg-green-100 text-green-700 hover:bg-green-200' });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Edit Article</h1>
        <Link href="/kb/manage" className="text-sm text-gray-600 hover:text-gray-900">
          ← Back to list
        </Link>
      </div>

      {/* Status actions */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6 flex flex-wrap items-center gap-2">
        <span className="text-sm text-gray-500 mr-2">Status:</span>
        {statusActions.map((action) => (
          <form key={action.value} action={changeArticleStatus}>
            <input type="hidden" name="article_id" value={article.id} />
            <input type="hidden" name="status" value={action.value} />
            <button
              type="submit"
              className={`px-3 py-1 text-xs rounded ${action.className}`}
            >
              {action.label}
            </button>
          </form>
        ))}
        <form action={deleteArticle} className="ml-auto">
          <input type="hidden" name="article_id" value={article.id} />
          <button
            type="submit"
            className="px-3 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
          >
            Delete Article
          </button>
        </form>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <ArticleEditorForm
          categories={categories ?? []}
          article={{
            id: article.id,
            title: article.title,
            body: article.body,
            status: article.status,
            category_id: article.category_id,
            source_ticket_id: article.source_ticket_id,
            author_display_name: author?.display_name ?? 'Unknown',
            last_editor_display_name: lastEditor?.display_name ?? null,
          }}
        />
      </div>
    </div>
  );
}
