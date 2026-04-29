import { createServerClient } from '@/lib/supabase/server';
import { TagsSurveyForm } from './TagsSurveyForm';

export default async function AdminTagsPage() {
  const supabase = await createServerClient();

  const { data: tags } = await supabase
    .from('tags')
    .select('id, name, color')
    .order('name');

  const initial = (tags ?? []).map((t) => ({
    id: t.id as string,
    name: t.name as string,
    color: t.color as string,
  }));

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Manage Tags</h1>
      <p className="text-sm text-gray-600 mb-4">
        Add, rename, recolor, or remove tags. Click <strong>Complete</strong> to save all changes.
      </p>
      <TagsSurveyForm initial={initial} />
    </div>
  );
}
