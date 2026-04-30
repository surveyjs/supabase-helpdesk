'use client';

import { saveTicketTypes } from '@/lib/actions/admin';
import { AdminSurveyForm } from '@/components/features/survey/AdminSurveyForm';
import typesSchema from '@/components/features/survey/form-json/admin/types.json';

type TypeRow = { id?: string; name: string };

export function TypesSurveyForm({ initial }: { initial: TypeRow[] }) {
  return (
    <div
      className="bg-white rounded-lg border border-gray-200 p-6 space-y-3"
      data-testid="types-survey-form"
    >
      <AdminSurveyForm
        schema={typesSchema as Record<string, unknown>}
        data={{ rows: initial }}
        mode="complete"
        saveAction={saveTicketTypes}
        toFormData={(d) => {
          const fd = new FormData();
          fd.set('rows', JSON.stringify(d.rows ?? []));
          return fd;
        }}
        successMessage="Ticket types saved."
      />
    </div>
  );
}
