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
        data={{ fields: initial }}
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
