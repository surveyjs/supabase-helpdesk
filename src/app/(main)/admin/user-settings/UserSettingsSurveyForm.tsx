'use client';

import { updateUserSettings } from '@/lib/actions/admin';
import { AdminSurveyForm } from '@/components/features/survey/AdminSurveyForm';
import userSettingsSchema from '@/components/features/survey/form-json/admin/user-settings.json';

export function UserSettingsSurveyForm({ enforceUniqueness }: { enforceUniqueness: boolean }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-3 mb-6" data-testid="user-settings-survey-form">
      <AdminSurveyForm
        schema={userSettingsSchema as Record<string, unknown>}
        data={{ enforce_display_name_uniqueness: enforceUniqueness }}
        mode="autosave"
        debounceMs={700}
        saveAction={updateUserSettings}
        successMessage="Settings saved."
      />
    </div>
  );
}
