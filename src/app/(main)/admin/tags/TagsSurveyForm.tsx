'use client';

import { saveTags } from '@/lib/actions/admin';
import { AdminSurveyForm } from '@/components/features/survey/AdminSurveyForm';
import tagsSchema from '@/components/features/survey/form-json/admin/tags.json';

type TagRow = { id?: string; name: string; color: string };

export function TagsSurveyForm({ initial }: { initial: TagRow[] }) {
  return (
    <div
      className="bg-white rounded-lg border border-gray-200 p-6 space-y-3"
      data-testid="tags-survey-form"
    >
      <AdminSurveyForm
        schema={tagsSchema as Record<string, unknown>}
        data={{ rows: initial }}
        mode="complete"
        saveAction={saveTags}
        toFormData={(d) => {
          const fd = new FormData();
          fd.set('rows', JSON.stringify(d.rows ?? []));
          return fd;
        }}
        successMessage="Tags saved."
      />
    </div>
  );
}
