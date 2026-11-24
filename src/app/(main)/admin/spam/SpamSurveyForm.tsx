'use client';

import { saveSpamSettings } from '@/lib/actions/admin';
import { AdminSurveyForm } from '@/components/features/survey/AdminSurveyForm';
import spamSchema from '@/components/features/survey/form-json/admin/spam.json';

export function SpamSurveyForm({ values }: { values: Record<string, unknown> }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-3" data-testid="spam-survey-form">
      <AdminSurveyForm
        schema={spamSchema as Record<string, unknown>}
        data={values}
        mode="complete"
        keepOpen
        saveAction={saveSpamSettings}
        successMessage="Spam rules saved."
      />
    </div>
  );
}
