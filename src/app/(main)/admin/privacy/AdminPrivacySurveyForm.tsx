'use client';

import { updatePrivacySettings } from '@/lib/actions/admin';
import { AdminSurveyForm } from '@/components/features/survey/AdminSurveyForm';
import privacySchema from '@/components/features/survey/form-json/admin/privacy.json';

type AdminPrivacySurveyFormProps = {
  defaultPrivacy: 'true' | 'false';
  allowPrivacyControl: boolean;
  allowPublicBrowsing: boolean;
};

export function AdminPrivacySurveyForm({
  defaultPrivacy,
  allowPrivacyControl,
  allowPublicBrowsing,
}: AdminPrivacySurveyFormProps) {
  const data = {
    ticket_default_privacy: defaultPrivacy,
    allow_user_privacy_control: allowPrivacyControl,
    allow_public_ticket_browsing: allowPublicBrowsing,
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-3" data-testid="privacy-survey-form">
      <AdminSurveyForm
        schema={privacySchema as Record<string, unknown>}
        data={data}
        mode="autosave"
        debounceMs={700}
        saveAction={updatePrivacySettings}
        successMessage="Settings saved."
      />
    </div>
  );
}
