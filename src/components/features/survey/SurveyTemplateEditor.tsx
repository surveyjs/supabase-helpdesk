'use client';

import { useActionState, useMemo, useRef, useState } from 'react';
import { SurveyJsonForm } from '@/components/features/survey/SurveyJsonForm';
import {
  saveTicketDetailTemplate,
  resetSurveyUiConfig,
  type SurveyUiSaveResult,
} from '@/lib/actions/admin';

type SurveyTemplateEditorProps = {
  settingKey: 'survey_ticket_detail_agent_template' | 'survey_ticket_detail_user_template';
  title: string;
  initialJson: string;
};

const EDITOR_SCHEMA = {
  showQuestionNumbers: 'off',
  pages: [
    {
      elements: [
        {
          type: 'comment',
          name: 'template_json',
          title: 'SurveyJS template JSON',
          rows: 24,
          isRequired: true,
        },
      ],
    },
  ],
} as const;

export function SurveyTemplateEditor({
  settingKey,
  title,
  initialJson,
}: SurveyTemplateEditorProps) {
  const [state, saveAction, isSaving] = useActionState<SurveyUiSaveResult | null, FormData>(
    saveTicketDetailTemplate,
    null,
  );
  const [clientError, setClientError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const hiddenJsonRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef<string>(initialJson);

  const initialData = useMemo(() => ({ template_json: initialJson }), [initialJson]);

  const onValueChanged = (data: Record<string, unknown>) => {
    if (typeof data.template_json === 'string') {
      valueRef.current = data.template_json;
      if (hiddenJsonRef.current) hiddenJsonRef.current.value = data.template_json;
    }
  };

  const onSaveClick = () => {
    setClientError(null);
    try {
      JSON.parse(valueRef.current);
    } catch (e) {
      setClientError(`Invalid JSON: ${e instanceof Error ? e.message : 'parse error'}`);
      return;
    }
    formRef.current?.requestSubmit();
  };

  const errorMessage =
    clientError ?? (state && !state.ok ? state.error : null);

  return (
    <section
      className="bg-white rounded-lg border border-gray-200 p-6 space-y-4"
      data-testid={`survey-template-editor-${settingKey}`}
    >
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        <form action={resetSurveyUiConfig}>
          <input type="hidden" name="setting_key" value={settingKey} />
          <button
            type="submit"
            className="px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
            data-testid="survey-template-reset"
          >
            Reset to default
          </button>
        </form>
      </div>

      <form ref={formRef} action={saveAction} className="hidden">
        <input type="hidden" name="setting_key" value={settingKey} />
        <input ref={hiddenJsonRef} type="hidden" name="config_json" defaultValue={initialJson} />
      </form>

      <SurveyJsonForm
        schema={EDITOR_SCHEMA as unknown as Record<string, unknown>}
        data={initialData}
        onValueChanged={onValueChanged}
        mode="autosave"
      />

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onSaveClick}
          disabled={isSaving}
          className="px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          data-testid="survey-template-save"
        >
          {isSaving ? 'Saving…' : 'Save'}
        </button>
        {state?.ok && !errorMessage && (
          <span className="text-xs text-green-700" data-testid="survey-template-saved">
            Saved.
          </span>
        )}
      </div>

      {errorMessage && (
        <p
          className="text-sm text-red-600"
          role="alert"
          data-testid="survey-template-error"
        >
          {errorMessage}
        </p>
      )}
    </section>
  );
}
