'use client';

import { saveTeams } from '@/lib/actions/admin';
import { AdminSurveyForm } from '@/components/features/survey/AdminSurveyForm';
import teamsSchema from '@/components/features/survey/form-json/admin/teams.json';

type TeamRow = { id?: string; name: string };

export function TeamsSurveyForm({ initial }: { initial: TeamRow[] }) {
  return (
    <div
      className="bg-white rounded-lg border border-gray-200 p-6 space-y-3"
      data-testid="teams-survey-form"
    >
      <AdminSurveyForm
        schema={teamsSchema as Record<string, unknown>}
        data={{ rows: initial }}
        mode="complete"
        saveAction={saveTeams}
        toFormData={(d) => {
          const fd = new FormData();
          fd.set('rows', JSON.stringify(d.rows ?? []));
          return fd;
        }}
        successMessage="Teams saved."
      />
    </div>
  );
}
