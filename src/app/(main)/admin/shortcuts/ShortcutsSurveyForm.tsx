'use client';

import { saveAgentShortcuts } from '@/lib/actions/admin';
import { AdminSurveyForm } from '@/components/features/survey/AdminSurveyForm';
import shortcutsSchema from '@/components/features/survey/form-json/admin/shortcuts.json';
import type { ShortcutMap } from '@/lib/shortcuts';

export function ShortcutsSurveyForm({ values }: { values: ShortcutMap }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-3" data-testid="shortcuts-survey-form">
      <AdminSurveyForm
        schema={shortcutsSchema as Record<string, unknown>}
        data={values}
        mode="complete"
        keepOpen
        saveAction={saveAgentShortcuts}
        successMessage="Shortcuts saved."
      />
    </div>
  );
}
