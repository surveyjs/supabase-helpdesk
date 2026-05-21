'use client';

import { useActionState, useMemo, useRef, useState } from 'react';
import { SurveyJsonForm } from '@/components/features/survey/SurveyJsonForm';
import {
  saveSurveyTemplate,
  resetSurveyUiConfig,
  type SurveyUiSaveResult,
} from '@/lib/actions/admin';

type SurveyTemplateEditorProps = {
  settingKey:
    | 'survey_agent_dashboard_template'
    | 'survey_ticket_detail_agent_template'
    | 'survey_ticket_detail_user_template';
  title: string;
  initialJson: string;
};

const TICKET_DETAIL_KEYS = new Set([
  'survey_ticket_detail_agent_template',
  'survey_ticket_detail_user_template',
]);

const AUTO_GEN_HINTS: Record<string, string> = {
  survey_ticket_detail_agent_template:
    'When enabled, custom-field definitions are automatically rendered as SurveyJS questions (named `custom_fields.<name>`) at the bottom of the sidebar. Disable to author them manually in the JSON.',
  survey_ticket_detail_user_template:
    'When enabled, custom-field definitions are automatically rendered as SurveyJS questions (named `custom_fields.<name>`) at the bottom of the sidebar. Disable to author them manually in the JSON.',
};

function buildEditorSchema(includeAutoGen: boolean): Record<string, unknown> {
  const elements: Array<Record<string, unknown>> = [];
  if (includeAutoGen) {
    elements.push({
      type: 'boolean',
      name: 'auto_generate_custom_fields',
      title: 'Auto-generate custom fields',
      renderAs: 'checkbox',
    });
  }
  elements.push({
    type: 'comment',
    name: 'template_json',
    title: 'SurveyJS template JSON',
    rows: 24,
    isRequired: true,
  });
  return {
    showQuestionNumbers: 'off',
    pages: [{ elements }],
  };
}

function readAutoGenerateFromWrapper(json: string): boolean {
  try {
    const parsed = JSON.parse(json) as { autoGenerateCustomFields?: unknown };
    if (parsed && typeof parsed === 'object') {
      const v = parsed.autoGenerateCustomFields;
      if (typeof v === 'boolean') return v;
    }
  } catch {
    /* ignore */
  }
  return true;
}

function setAutoGenerateInWrapper(json: string, value: boolean): string {
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      (parsed as Record<string, unknown>).autoGenerateCustomFields = value;
      return JSON.stringify(parsed, null, 2);
    }
  } catch {
    /* fall through */
  }
  return json;
}

export function SurveyTemplateEditor({
  settingKey,
  title,
  initialJson,
}: SurveyTemplateEditorProps) {
  const isTicketDetail = TICKET_DETAIL_KEYS.has(settingKey);
  const [state, saveAction, isSaving] = useActionState<SurveyUiSaveResult | null, FormData>(
    saveSurveyTemplate,
    null,
  );
  const [clientError, setClientError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const hiddenJsonRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef<string>(initialJson);

  const initialAutoGen = useMemo(
    () => (isTicketDetail ? readAutoGenerateFromWrapper(initialJson) : true),
    [initialJson, isTicketDetail],
  );

  const schema = useMemo(() => buildEditorSchema(isTicketDetail), [isTicketDetail]);

  const initialData = useMemo(
    () => ({
      template_json: initialJson,
      ...(isTicketDetail ? { auto_generate_custom_fields: initialAutoGen } : {}),
    }),
    [initialJson, isTicketDetail, initialAutoGen],
  );

  const onValueChanged = (data: Record<string, unknown>) => {
    if (typeof data.template_json === 'string') {
      valueRef.current = data.template_json;
      if (hiddenJsonRef.current) hiddenJsonRef.current.value = data.template_json;
    }
    if (isTicketDetail && typeof data.auto_generate_custom_fields === 'boolean') {
      const merged = setAutoGenerateInWrapper(
        valueRef.current,
        data.auto_generate_custom_fields,
      );
      if (merged !== valueRef.current) {
        valueRef.current = merged;
        if (hiddenJsonRef.current) hiddenJsonRef.current.value = merged;
      }
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

      {isTicketDetail && (
        <p className="text-xs text-gray-500" data-testid="survey-template-autogen-hint">
          {AUTO_GEN_HINTS[settingKey]}
        </p>
      )}

      <form ref={formRef} action={saveAction} className="hidden">
        <input type="hidden" name="setting_key" value={settingKey} />
        <input ref={hiddenJsonRef} type="hidden" name="config_json" defaultValue={initialJson} />
      </form>

      <SurveyJsonForm
        schema={schema}
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
