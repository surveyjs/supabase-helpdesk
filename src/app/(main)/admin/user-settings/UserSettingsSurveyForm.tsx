'use client';

import { useMemo } from 'react';
import { updateUserSettings } from '@/lib/actions/admin';
import { AdminSurveyForm } from '@/components/features/survey/AdminSurveyForm';
import userSettingsSchema from '@/components/features/survey/form-json/admin/user-settings.json';

export function UserSettingsSurveyForm({ enforceUniqueness }: { enforceUniqueness: boolean }) {
  const data = useMemo(
    () => ({ enforce_display_name_uniqueness: enforceUniqueness }),
    [enforceUniqueness],
  );

  const toFormData = useMemo(
    () => (surveyData: Record<string, unknown>) => {
      const fd = new FormData();
      if (surveyData.enforce_display_name_uniqueness === true) {
        fd.set('enforce_display_name_uniqueness', 'on');
      }
      return fd;
    },
    [],
  );

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-3 mb-6" data-testid="user-settings-survey-form">
      <AdminSurveyForm
        schema={userSettingsSchema as Record<string, unknown>}
        data={data}
        mode="autosave"
        debounceMs={700}
        saveAction={updateUserSettings}
        toFormData={toFormData}
        successMessage="Settings saved."
      />
    </div>
  );
}
