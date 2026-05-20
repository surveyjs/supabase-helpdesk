'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Model } from 'survey-core';
import { ticketDetailDispatch } from '@/lib/tickets/ticket-detail-dispatch';
import { dispatchTicketDetailFieldChange } from '@/lib/tickets/ticket-detail-events';
import type { SurveyJsonDefinition } from '@/lib/constants/survey-ui-config';

const Survey = dynamic(() => import('survey-react-ui').then((m) => m.Survey), { ssr: false });

export type TicketSidebarSurveyProps = {
  ticketId: string;
  templateJson: SurveyJsonDefinition;
  initial: Record<string, unknown>;
};

type FieldStatus = 'idle' | 'saving' | 'saved' | 'error';

export function TicketSidebarSurvey({ ticketId, templateJson, initial }: TicketSidebarSurveyProps) {
  const previousRef = useRef<Record<string, unknown>>({ ...initial });
  // Names whose next onValueChanged is a programmatic revert and must not
  // re-trigger the dispatcher.
  const revertingRef = useRef<Set<string>>(new Set());
  const [fieldStatus, setFieldStatus] = useState<Record<string, FieldStatus>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);

  const model = useMemo(() => {
    const m = new Model(templateJson);
    m.showCompletedPage = false;
    m.showCompleteButton = false;
    // Goal #6: assign data after model construction.
    m.data = initial;
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateJson]);

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

      const dispatcher = ticketDetailDispatch[options.name];
      if (!dispatcher) return;
      const prev = previousRef.current[options.name];
      const tasks = dispatcher(ticketId, options.value, prev);
      if (tasks.length === 0) return;

      setFieldStatus((s) => ({ ...s, [options.name]: 'saving' }));
      Promise.all(tasks)
        .then(() => {
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

  const summary = generalError
    ? generalError
    : Object.values(fieldStatus).some((v) => v === 'saving')
      ? 'Saving…'
      : Object.values(fieldStatus).some((v) => v === 'saved')
        ? 'Saved'
        : '';

  return (
    <div data-testid="ticket-sidebar-survey">
      <Survey model={model} />
      <p
        aria-live="polite"
        className="mt-2 min-h-[1rem] text-xs text-gray-500"
        data-testid="ticket-sidebar-survey-status"
      >
        {summary}
      </p>
    </div>
  );
}

