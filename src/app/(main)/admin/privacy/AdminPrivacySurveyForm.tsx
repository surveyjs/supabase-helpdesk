'use client';

import { useMemo } from 'react';
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
  const data = useMemo(
    () => ({
      ticket_default_privacy: defaultPrivacy,
      allow_user_privacy_control: allowPrivacyControl,
      allow_public_ticket_browsing: allowPublicBrowsing,
    }),
    [allowPrivacyControl, allowPublicBrowsing, defaultPrivacy],
  );

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-3" data-testid="privacy-survey-form">
      <AdminSurveyForm
        schema={privacySchema as Record<string, unknown>}
        data={data}
        mode="autosave"
        debounceMs={700}
        saveAction={updatePrivacySettings}
        successMessage="Settings saved."
        toFormData={(surveyData) => {
          const fd = new FormData();
          fd.set(
            'ticket_default_privacy',
            surveyData.ticket_default_privacy === 'false' ? 'false' : 'true',
          );
          if (surveyData.allow_user_privacy_control === true) {
            fd.set('allow_user_privacy_control', 'on');
          }
          if (surveyData.allow_public_ticket_browsing === true) {
            fd.set('allow_public_ticket_browsing', 'on');
          }
          return fd;
        }}
      />
    </div>
  );
}
