import { createServerClient } from '@/lib/supabase/server';
import { CustomFieldsSurveyForm } from './CustomFieldsSurveyForm';

export default async function AdminCustomFieldsPage() {
  const supabase = await createServerClient();

  const { data: fields } = await supabase
    .from('custom_fields')
    .select('id, name, field_type, is_required, default_value, options, display_order')
    .order('display_order');

  const initial = (fields ?? []).map((f) => ({
    id: f.id as string,
    name: f.name as string,
    field_type: f.field_type as string,
    is_required: !!f.is_required,
    default_value: (f.default_value as string | null) ?? '',
    options:
      f.field_type === 'dropdown' && Array.isArray(f.options)
        ? (f.options as string[]).join(', ')
        : '',
  }));

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Custom Fields</h1>
      <p className="text-sm text-gray-600 mb-4">
        Add, edit, reorder (drag rows), or remove custom fields. The <strong>Options</strong> column
        only appears for <code>dropdown</code> fields and accepts a comma-separated list. Click{' '}
        <strong>Complete</strong> to save all changes.
      </p>
      <CustomFieldsSurveyForm initial={initial} />
    </div>
  );
}
