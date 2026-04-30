'use client';

import { saveTiers } from '@/lib/actions/admin';
import { AdminSurveyForm } from '@/components/features/survey/AdminSurveyForm';
import tiersSchema from '@/components/features/survey/form-json/admin/tiers.json';

type TierRow = {
  id?: string;
  key: string;
  display_name: string;
  cap_change_visibility: boolean;
  cap_set_severity: boolean;
  cap_change_status: boolean;
  cap_change_type: boolean;
  cap_add_remove_tags: boolean;
};

export function TiersSurveyForm({ initial }: { initial: TierRow[] }) {
  return (
    <div
      className="bg-white rounded-lg border border-gray-200 p-6 space-y-3"
      data-testid="tiers-survey-form"
    >
      <AdminSurveyForm
        schema={tiersSchema as Record<string, unknown>}
        data={{ rows: initial }}
        mode="complete"
        saveAction={saveTiers}
        toFormData={(d) => {
          const fd = new FormData();
          fd.set('rows', JSON.stringify(d.rows ?? []));
          return fd;
        }}
        successMessage="Tiers saved."
      />
    </div>
  );
}
