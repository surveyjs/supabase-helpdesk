'use client';

import { saveCategories } from '@/lib/actions/admin';
import { AdminSurveyForm } from '@/components/features/survey/AdminSurveyForm';
import categoriesSchema from '@/components/features/survey/form-json/admin/categories.json';

type CategoryRow = { id?: string; name: string };

export function CategoriesSurveyForm({ initial }: { initial: CategoryRow[] }) {
  return (
    <div
      className="bg-white rounded-lg border border-gray-200 p-6 space-y-3"
      data-testid="categories-survey-form"
    >
      <AdminSurveyForm
        schema={categoriesSchema as Record<string, unknown>}
        data={{ rows: initial }}
        mode="complete"
        saveAction={saveCategories}
        toFormData={(d) => {
          const fd = new FormData();
          fd.set('rows', JSON.stringify(d.rows ?? []));
          return fd;
        }}
        successMessage="Categories saved."
      />
    </div>
  );
}
