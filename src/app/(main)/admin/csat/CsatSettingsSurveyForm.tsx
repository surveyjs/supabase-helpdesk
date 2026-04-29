'use client';

import { updateCsatSettings } from '@/lib/actions/admin';
import { AdminSurveyForm } from '@/components/features/survey/AdminSurveyForm';
import csatSchema from '@/components/features/survey/form-json/admin/csat.json';

type CsatSettingsSurveyFormProps = {
  enabled: boolean;
  delay: string;
  emailVerified: boolean;
};

export function CsatSettingsSurveyForm({ enabled, delay, emailVerified }: CsatSettingsSurveyFormProps) {
  const data = {
    csat_enabled: enabled,
    csat_survey_delay: delay || '1_hour',
  };

  return (
    <div className="space-y-3 max-w-2xl" data-testid="csat-survey-form">
      {!emailVerified && (
        <p className="text-sm text-amber-600" data-testid="csat-email-warning">
          Email must be configured and verified before enabling CSAT surveys.
        </p>
      )}
      <p className="text-xs text-gray-500">
        When enabled, a satisfaction survey email will be sent to ticket creators after their ticket is closed.
      </p>
      <AdminSurveyForm
        schema={csatSchema as Record<string, unknown>}
        data={data}
        mode="autosave"
        debounceMs={700}
        saveAction={updateCsatSettings}
        successMessage="Settings saved."
      />
    </div>
  );
}
