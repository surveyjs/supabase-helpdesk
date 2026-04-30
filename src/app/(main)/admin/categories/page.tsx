import { createServerClient } from '@/lib/supabase/server';
import { CategoriesSurveyForm } from './CategoriesSurveyForm';

export default async function AdminCategoriesPage() {
  const supabase = await createServerClient();

  const { data: categories } = await supabase
    .from('categories')
    .select('id, name')
    .order('name');

  const initial = (categories ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
  }));

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Manage Categories</h1>
      <p className="text-sm text-gray-600 mb-4">
        Add, rename, or remove categories. Click <strong>Complete</strong> to save all changes.
      </p>
      <CategoriesSurveyForm initial={initial} />
    </div>
  );
}
