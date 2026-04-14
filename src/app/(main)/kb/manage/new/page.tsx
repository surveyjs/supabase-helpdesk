import { createServerClient } from '@/lib/supabase/server';
import { requireAgent } from '@/lib/supabase/auth';
import { ArticleEditorForm } from './ArticleEditorForm';

export default async function NewArticlePage() {
  await requireAgent();
  const supabase = await createServerClient();

  const { data: categories } = await supabase
    .from('kb_categories')
    .select('id, name')
    .order('display_order');

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">New Article</h1>
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <ArticleEditorForm
          categories={categories ?? []}
          article={null}
        />
      </div>
    </div>
  );
}
