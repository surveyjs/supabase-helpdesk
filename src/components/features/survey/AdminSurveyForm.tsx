'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { SurveyJsonForm } from '@/components/features/survey/SurveyJsonForm';

type SaveResponse = { message?: string; error?: string } | void;

type AdminSurveyFormProps = {
  schema: Record<string, unknown>;
  data: Record<string, unknown>;
  mode?: 'complete' | 'autosave';
  debounceMs?: number;
  saveAction: (formData: FormData) => Promise<SaveResponse>;
  toFormData?: (data: Record<string, unknown>) => FormData;
  successMessage?: string;
  className?: string;
};

function defaultToFormData(data: Record<string, unknown>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'boolean') {
      if (value) fd.set(key, 'on');
      continue;
    }
    if (typeof value === 'string') {
      fd.set(key, value.trim());
      continue;
    }
    if (typeof value === 'number') {
      fd.set(key, String(value));
      continue;
    }
    if (Array.isArray(value)) {
      fd.set(key, value.join(','));
      continue;
    }
    fd.set(key, String(value));
  }
  return fd;
}

export function AdminSurveyForm({
  schema,
  data,
  mode = 'complete',
  debounceMs = 600,
  saveAction,
  toFormData,
  successMessage = 'Settings saved.',
  className,
}: AdminSurveyFormProps) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDataRef = useRef<Record<string, unknown> | null>(null);
  const lastSavedSnapshotRef = useRef(JSON.stringify(data));

  useEffect(() => {
    lastSavedSnapshotRef.current = JSON.stringify(data);
  }, [data]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  const saveNow = useCallback((nextData: Record<string, unknown>) => {
    const snapshot = JSON.stringify(nextData ?? {});
    if (snapshot === lastSavedSnapshotRef.current) {
      return;
    }

    setMessage('');
    setIsError(false);
    startTransition(async () => {
      const formData = (toFormData ?? defaultToFormData)(nextData);
      const result = await saveAction(formData);
      if (result?.error) {
        // Don't advance the saved snapshot so the next change re-attempts the save.
        setIsError(true);
        setMessage(`Error: ${result.error}`);
        return;
      }
      lastSavedSnapshotRef.current = snapshot;
      setIsError(false);
      setMessage(result?.message ?? successMessage);
    });
  }, [saveAction, successMessage, toFormData]);

  const queueSave = useCallback((nextData: Record<string, unknown>) => {
    pendingDataRef.current = nextData;

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = setTimeout(() => {
      if (!pendingDataRef.current) return;
      saveNow(pendingDataRef.current);
      pendingDataRef.current = null;
    }, debounceMs);
  }, [debounceMs, saveNow]);

  const content = useMemo(() => {
    if (mode === 'autosave') {
      return (
        <SurveyJsonForm
          schema={schema}
          data={data}
          mode="autosave"
          onValueChanged={queueSave}
          className={className}
        />
      );
    }

    return (
      <SurveyJsonForm
        schema={schema}
        data={data}
        mode="complete"
        onComplete={saveNow}
        className={className}
      />
    );
  }, [className, data, mode, queueSave, saveNow, schema]);

  return (
    <>
      {content}
      <p
        className={`text-xs ${isError && !isPending ? 'text-red-600' : 'text-gray-500'}`}
        aria-live="polite"
        role={isError && !isPending ? 'alert' : undefined}
      >
        {isPending ? 'Saving...' : message}
      </p>
    </>
  );
}
