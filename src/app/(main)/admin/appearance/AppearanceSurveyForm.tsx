'use client';

import { saveBranding } from '@/lib/actions/admin';
import { AdminSurveyForm } from '@/components/features/survey/AdminSurveyForm';
import appearanceSchema from '@/components/features/survey/form-json/admin/appearance.json';

export function AppearanceSurveyForm({
  values,
}: {
  values: { product_name: string; logo_url: string; primary_color: string };
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-3" data-testid="appearance-survey-form">
      <AdminSurveyForm
        schema={appearanceSchema as Record<string, unknown>}
        data={values}
        mode="complete"
        keepOpen
        saveAction={saveBranding}
        successMessage="Appearance saved."
      />
    </div>
  );
}
