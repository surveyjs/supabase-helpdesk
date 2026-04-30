'use client';

import { saveKbCategories } from '@/lib/actions/admin';
import { AdminSurveyForm } from '@/components/features/survey/AdminSurveyForm';
import kbCategoriesSchema from '@/components/features/survey/form-json/admin/kb-categories.json';

type KbCategoryRow = { id?: string; name: string };

export function KbCategoriesSurveyForm({ initial }: { initial: KbCategoryRow[] }) {
  return (
    <div
      className="bg-white rounded-lg border border-gray-200 p-6 space-y-3"
      data-testid="kb-categories-survey-form"
    >
      <AdminSurveyForm
        schema={kbCategoriesSchema as Record<string, unknown>}
        data={{ rows: initial }}
        mode="complete"
        saveAction={saveKbCategories}
        toFormData={(d) => {
          const fd = new FormData();
          fd.set('rows', JSON.stringify(d.rows ?? []));
          return fd;
        }}
        successMessage="KB categories saved."
      />
    </div>
  );
}
