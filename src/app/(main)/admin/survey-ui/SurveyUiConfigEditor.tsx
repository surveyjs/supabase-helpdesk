'use client';

import { useMemo, useRef } from 'react';
import { SurveyJsonForm } from '@/components/features/survey/SurveyJsonForm';

type SurveyUiConfigEditorProps = {
  title: string;
  settingKey: string;
  initialData: Record<string, unknown>;
  schema: Record<string, unknown>;
  saveAction: (formData: FormData) => Promise<void>;
  resetAction: (formData: FormData) => Promise<void>;
};

export function SurveyUiConfigEditor({
  title,
  settingKey,
  initialData,
  schema,
  saveAction,
  resetAction,
}: SurveyUiConfigEditorProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);

  const initialJson = useMemo(() => JSON.stringify(initialData, null, 2), [initialData]);

  const handleComplete = (data: Record<string, unknown>) => {
    if (!jsonInputRef.current) return;
    jsonInputRef.current.value = JSON.stringify(data);
    formRef.current?.requestSubmit();
  };

  return (
    <section className="bg-white rounded-lg border border-gray-200 p-6 space-y-4" data-testid={`survey-ui-config-${settingKey}`}>
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        <form action={resetAction}>
          <input type="hidden" name="setting_key" value={settingKey} />
          <button
            type="submit"
            className="px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            Reset to default
          </button>
        </form>
      </div>

      <form ref={formRef} action={saveAction} className="hidden">
        <input type="hidden" name="setting_key" value={settingKey} />
        <input ref={jsonInputRef} type="hidden" name="config_json" defaultValue={JSON.stringify(initialData)} />
      </form>

      <SurveyJsonForm schema={schema} data={initialData} onComplete={handleComplete} />

      <details>
        <summary className="cursor-pointer text-sm text-gray-600 hover:text-gray-800">Stored JSON preview</summary>
        <pre className="mt-2 text-xs bg-gray-50 border border-gray-200 rounded p-3 overflow-auto">{initialJson}</pre>
      </details>
    </section>
  );
}
