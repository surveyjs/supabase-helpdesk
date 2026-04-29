'use client';

import { updateFileSettings, resetFileTypesToDefault } from '@/lib/actions/admin';
import { AdminSurveyForm } from '@/components/features/survey/AdminSurveyForm';
import fileSettingsSchema from '@/components/features/survey/form-json/admin/file-settings.json';

type FileSettingsValues = {
  allowed_file_types: string;
  max_file_size_mb: string;
  max_files_per_post: string;
};

export function FileSettingsSurveyForm({ values }: { values: FileSettingsValues }) {
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-3" data-testid="file-settings-survey-form">
        <AdminSurveyForm
          schema={fileSettingsSchema as Record<string, unknown>}
          data={values}
          mode="autosave"
          debounceMs={700}
          saveAction={updateFileSettings}
          successMessage="File settings saved."
        />
      </div>

      <form action={resetFileTypesToDefault}>
        <button
          type="submit"
          className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200 font-medium"
        >
          Reset file types to defaults
        </button>
      </form>
    </div>
  );
}
