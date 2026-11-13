'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Model } from 'survey-core';
import { getDispatcher } from '@/lib/tickets/ticket-detail-dispatch';
import {
  dispatchTicketDetailFieldChange,
  dispatchTicketDetailSaveStatus,
  type TicketDetailSaveStatusTone,
} from '@/lib/tickets/ticket-detail-events';
import type { SurveyJsonDefinition } from '@/lib/constants/survey-ui-config';
import { colorTagChips, mergeServerValues, uncheckEmptyBooleans } from '@/lib/tickets/sidebar-survey-model';

const Survey = dynamic(() => import('survey-react-ui').then((m) => m.Survey), { ssr: false });

export type TicketSidebarSurveyProps = {
  ticketId: string;
  templateJson: SurveyJsonDefinition;
  initial: Record<string, unknown>;
  /** Tag id → hex colour, used to colour the chips of the `tag_ids` tagbox. */
  tagColors?: Record<string, string>;
};

type FieldStatus = 'idle' | 'saving' | 'saved' | 'error';

export function TicketSidebarSurvey({ ticketId, templateJson, initial, tagColors }: TicketSidebarSurveyProps) {
  const previousRef = useRef<Record<string, unknown>>({ ...initial });
  // The server re-renders this component with fresh `initial`/`templateJson`
  // objects on every realtime refresh. The model is keyed on the template's
  // content, so a refresh never rebuilds it (which would drop drafts and
  // focus); fresh `initial` values are merged into it by the effect below.
  const templateKey = JSON.stringify(templateJson);
  // Names of the question that has focus (it may hold an uncommitted draft) and
  // names with a save in flight (count per name). A server value is not merged
  // into either.
  const focusedRef = useRef<string | null>(null);
  const pendingRef = useRef<Map<string, number>>(new Map());
  // Names whose next onValueChanged is a programmatic revert and must not
  // re-trigger the dispatcher.
  const revertingRef = useRef<Set<string>>(new Set());
  const [fieldStatus, setFieldStatus] = useState<Record<string, FieldStatus>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);

  const model = useMemo(() => {
    const m = new Model(JSON.parse(templateKey) as SurveyJsonDefinition);
    m.showCompletedPage = false;
    m.showCompleteButton = false;
    // Goal #6: assign data after model construction.
    m.data = initial;
    // Before the change handler below is attached, and without raising
    // onValueChanged: nothing is saved for these.
    uncheckEmptyBooleans(m);
    // Registered on the model before it first renders, so the first
    // after-render pass of the Tags question is never missed. Like `initial`,
    // the colours are read when the model is (re)built from the template.
    if (tagColors) colorTagChips(m, 'tag_ids', tagColors);
    return m;
    // Rebuilt only when the template's content changes; `initial` and
    // `tagColors` are those of that render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateKey]);
  const builtModelRef = useRef<Model | null>(null);

  // The focused question may hold a draft the model has not committed yet.
  useEffect(() => {
    const onFocusIn = (_sender: Model, options: { question: { getValueName(): string } }) => {
      focusedRef.current = options.question.getValueName();
    };
    model.onFocusInQuestion.add(onFocusIn);
    return () => model.onFocusInQuestion.remove(onFocusIn);
  }, [model]);

  // Fold each server refresh into the live model, skipping the field being
  // edited or saved. Skipped fields keep their old baseline and are applied by
  // a later refresh once they are no longer dirty.
  useEffect(() => {
    if (builtModelRef.current !== model) {
      // A new model was built from this render's `initial`: restart tracking.
      builtModelRef.current = model;
      previousRef.current = { ...initial };
      focusedRef.current = null;
      pendingRef.current.clear();
      return;
    }
    const dirty = new Set(pendingRef.current.keys());
    if (focusedRef.current) dirty.add(focusedRef.current);
    previousRef.current = mergeServerValues(model, initial, previousRef.current, dirty);
  }, [model, initial]);

  useEffect(() => {
    const handler = (
      _sender: Model,
      options: { name: string; value: unknown },
    ) => {
      // Suppress dispatch for programmatic reverts triggered after a failed save.
      if (revertingRef.current.has(options.name)) {
        revertingRef.current.delete(options.name);
        return;
      }

      const dispatcher = getDispatcher(options.name);
      if (!dispatcher) return;
      const prev = previousRef.current[options.name];
      const tasks = dispatcher(ticketId, options.value, prev);
      if (tasks.length === 0) return;

      const pending = pendingRef.current;
      const settle = () => {
        const n = (pending.get(options.name) ?? 1) - 1;
        if (n <= 0) pending.delete(options.name);
        else pending.set(options.name, n);
      };
      pending.set(options.name, (pending.get(options.name) ?? 0) + 1);
      setFieldStatus((s) => ({ ...s, [options.name]: 'saving' }));
      Promise.all(tasks)
        .then(() => {
          settle();
          // Only advance the baseline after the DB confirms the change so a
          // later failure cannot leave previousRef out of sync with the DB.
          previousRef.current = {
            ...previousRef.current,
            [options.name]: options.value,
          };
          setFieldStatus((s) => ({ ...s, [options.name]: 'saved' }));
          setGeneralError(null);
          // Notify sibling UI (e.g. tag chip list) of the persisted change.
          dispatchTicketDetailFieldChange({
            ticketId,
            name: options.name,
            value: options.value,
          });
        })
        .catch(() => {
          settle();
          setFieldStatus((s) => ({ ...s, [options.name]: 'error' }));
          setGeneralError('Failed to save changes.');
          // Revert the survey value back to the last-known-good baseline so
          // the UI matches the DB and a subsequent edit recomputes the diff
          // from the right starting point.
          revertingRef.current.add(options.name);
          model.setValue(options.name, prev);
        });
    };

    model.onValueChanged.add(handler);
    return () => {
      model.onValueChanged.remove(handler);
    };
  }, [model, ticketId]);

  const { tone, message } = useMemo<{
    tone: TicketDetailSaveStatusTone;
    message: string;
  }>(() => {
    if (generalError) return { tone: 'error', message: generalError };
    if (Object.values(fieldStatus).some((v) => v === 'saving')) {
      return { tone: 'saving', message: 'Saving…' };
    }
    if (Object.values(fieldStatus).some((v) => v === 'saved')) {
      return { tone: 'saved', message: 'Saved' };
    }
    return { tone: 'idle', message: '' };
  }, [fieldStatus, generalError]);

  // Publish the autosave status so the header indicator (rendered on the
  // ticket-number line) can display it away from the survey itself.
  useEffect(() => {
    dispatchTicketDetailSaveStatus({ ticketId, tone, message });
  }, [ticketId, tone, message]);

  return (
    <div data-testid="ticket-sidebar-survey">
      <div
        onBlur={(e) => {
          // Focus moving between fields inside the survey is handled by the
          // next focus-in; only clear when it leaves the survey.
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) focusedRef.current = null;
        }}
      >
        <Survey model={model} />
      </div>
    </div>
  );
}

