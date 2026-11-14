'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import type { Model } from 'survey-core';
import { planClearAfterSave } from '@/components/features/survey/clear-after-save';
import { SurveyJsonForm } from '@/components/features/survey/SurveyJsonForm';

type SaveResponse = { message?: string; error?: string } | void;

type AdminSurveyFormProps = {
  schema: Record<string, unknown>;
  data: Record<string, unknown>;
  mode?: 'complete' | 'autosave';
  /** Complete mode only: keep the form visible after submit (see SurveyJsonForm). */
  keepOpen?: boolean;
  debounceMs?: number;
  saveAction: (formData: FormData) => Promise<SaveResponse>;
  toFormData?: (data: Record<string, unknown>) => FormData;
  successMessage?: string;
  className?: string;
  /** Fields (e.g. write-only secrets) to reset to '' after a save that sent a non-blank value. */
  clearOnSave?: string[];
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
  keepOpen = false,
  debounceMs = 600,
  saveAction,
  toFormData,
  successMessage = 'Settings saved.',
  className,
  clearOnSave,
}: AdminSurveyFormProps) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDataRef = useRef<Record<string, unknown> | null>(null);
  const lastSavedSnapshotRef = useRef(JSON.stringify(data));
  const modelRef = useRef<Model | null>(null);
  const suppressChangeRef = useRef(false);
  // Saves started but not yet resolved.
  const inFlightRef = useRef(0);

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
    // While a save is in flight the saved snapshot is not final: data equal to
    // it (e.g. a field changed and changed back) must still be sent.
    if (snapshot === lastSavedSnapshotRef.current && inFlightRef.current === 0) {
      // An explicit Save with nothing changed should not look like a dead button.
      if (mode === 'complete') {
        setIsError(false);
        setMessage('No changes to save.');
      }
      return;
    }

    setMessage('');
    setIsError(false);
    startTransition(async () => {
      const formData = (toFormData ?? defaultToFormData)(nextData);
      inFlightRef.current += 1;
      let result: SaveResponse;
      try {
        result = await saveAction(formData);
      } finally {
        inFlightRef.current -= 1;
      }
      if (result?.error) {
        // Don't advance the saved snapshot so the next change re-attempts the save.
        setIsError(true);
        setMessage(`Error: ${result.error}`);
        return;
      }
      lastSavedSnapshotRef.current = snapshot;
      if (clearOnSave?.length && modelRef.current) {
        const plan = planClearAfterSave(
          nextData,
          (modelRef.current.data ?? {}) as Record<string, unknown>,
          pendingDataRef.current,
          clearOnSave,
        );
        if (plan.clear.length > 0) {
          // Clearing must neither autosave nor look like an unsaved change.
          suppressChangeRef.current = true;
          try {
            for (const k of plan.clear) modelRef.current.setValue(k, '');
          } finally {
            suppressChangeRef.current = false;
          }
          lastSavedSnapshotRef.current = JSON.stringify(plan.savedData);
          if (pendingDataRef.current) {
            if (plan.pending) {
              pendingDataRef.current = plan.pending;
            } else {
              pendingDataRef.current = null;
              if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
            }
          }
        }
      }
      setIsError(false);
      setMessage(result?.message ?? successMessage);
    });
  }, [mode, saveAction, successMessage, toFormData, clearOnSave]);

  const queueSave = useCallback((nextData: Record<string, unknown>) => {
    if (suppressChangeRef.current) return;
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
          modelRef={modelRef}
          className={className}
        />
      );
    }

    return (
      <SurveyJsonForm
        schema={schema}
        data={data}
        mode="complete"
        keepOpen={keepOpen}
        completeText="Save changes"
        onComplete={saveNow}
        className={className}
      />
    );
  }, [className, data, keepOpen, mode, queueSave, saveNow, schema]);

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
