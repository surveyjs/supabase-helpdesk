'use client';

import { updateNotificationTemplate, resetNotificationTemplate } from '@/lib/actions/admin';
import { AdminSurveyForm } from '@/components/features/survey/AdminSurveyForm';
import duplicateTemplateSchema from '@/components/features/survey/form-json/admin/duplicate-template.json';

type Props = {
  template: {
    event_type: string;
    subject: string;
    body: string;
    is_customized: boolean;
  };
};

export function DuplicateTemplateSurveyForm({ template }: Props) {
  const data = {
    event_type: template.event_type,
    subject: template.subject,
    body: template.body,
  };

  return (
    <div className="space-y-3" data-testid="duplicate-template-survey-form">
      <AdminSurveyForm
        schema={duplicateTemplateSchema as Record<string, unknown>}
        data={data}
        mode="autosave"
        debounceMs={700}
        saveAction={updateNotificationTemplate}
        successMessage="Template saved."
      />

      {template.is_customized && (
        <p className="text-xs text-blue-600">This template has been customized.</p>
      )}

      <form action={resetNotificationTemplate}>
        <input type="hidden" name="event_type" value={template.event_type} />
        <button
          type="submit"
          className="px-4 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200 font-medium"
        >
          Reset to Default
        </button>
      </form>
    </div>
  );
}
