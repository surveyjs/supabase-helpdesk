'use client';

import { saveCustomFields } from '@/lib/actions/admin';
import { AdminSurveyForm } from '@/components/features/survey/AdminSurveyForm';
import customFieldsSchema from '@/components/features/survey/form-json/admin/custom-fields.json';

type CustomFieldRow = {
  id?: string;
  name: string;
  field_type: string;
  is_required: boolean;
  default_value: string;
  options: string;
};

export function CustomFieldsSurveyForm({ initial }: { initial: CustomFieldRow[] }) {
  return (
    <div
      className="bg-white rounded-lg border border-gray-200 p-6 space-y-3"
      data-testid="custom-fields-survey-form"
    >
      <AdminSurveyForm
        schema={customFieldsSchema as Record<string, unknown>}
        // When there are no existing rows, pass {} instead of { fields: [] }
        // so SurveyJS honours the matrix `rowCount: 1` default and renders an
        // empty starter row + the Add button. Explicitly setting `fields: []`
        // tells the matrix "the user has zero rows" and suppresses both.
        data={initial.length > 0 ? { fields: initial } : {}}
        mode="complete"
        saveAction={saveCustomFields}
        toFormData={(d) => {
          const fd = new FormData();
          fd.set('fields', JSON.stringify(d.fields ?? []));
          return fd;
        }}
        successMessage="Custom fields saved."
      />
    </div>
  );
}
