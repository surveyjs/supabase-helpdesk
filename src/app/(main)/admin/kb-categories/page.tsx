import { createServerClient } from '@/lib/supabase/server';
import { KbCategoriesSurveyForm } from './KbCategoriesSurveyForm';

export default async function AdminKbCategoriesPage() {
  const supabase = await createServerClient();

  const { data: categories } = await supabase
    .from('kb_categories')
    .select('id, name, display_order')
    .order('display_order', { ascending: true });

  const initial = (categories ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
  }));

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">KB Categories</h1>
      <p className="text-sm text-gray-600 mb-4">
        Add, rename, reorder (drag rows), or remove KB categories. Click <strong>Complete</strong> to save all changes.
      </p>
      <KbCategoriesSurveyForm initial={initial} />
    </div>
  );
}
