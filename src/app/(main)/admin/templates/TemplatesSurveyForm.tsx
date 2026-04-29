'use client';

import { saveNotificationTemplates } from '@/lib/actions/admin';
import { AdminSurveyForm } from '@/components/features/survey/AdminSurveyForm';
import templatesSchema from '@/components/features/survey/form-json/admin/templates.json';

type TemplateRow = {
  event_type: string;
  subject: string;
  body: string;
};

export function TemplatesSurveyForm({ initial }: { initial: TemplateRow[] }) {
  const data = { templates: initial };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-3" data-testid="templates-survey-form">
      <AdminSurveyForm
        schema={templatesSchema as Record<string, unknown>}
        data={data}
        mode="complete"
        saveAction={saveNotificationTemplates}
        toFormData={(d) => {
          const fd = new FormData();
          fd.set('templates', JSON.stringify(d.templates ?? []));
          return fd;
        }}
        successMessage="Templates saved."
      />
    </div>
  );
}
