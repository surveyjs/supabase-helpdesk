'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Model } from 'survey-core';
import surveyTheme from '@/components/features/survey/theme.json';
import 'survey-core/survey-core.min.css';
import '@/components/features/survey/survey-overrides.css';
import { ticketDetailDispatch } from '@/lib/tickets/ticket-detail-dispatch';
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
  const [fieldStatus, setFieldStatus] = useState<Record<string, FieldStatus>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);

  const model = useMemo(() => {
    const m = new Model(templateJson);
    m.applyTheme(surveyTheme as Parameters<Model['applyTheme']>[0]);
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
      const dispatcher = ticketDetailDispatch[options.name];
      if (!dispatcher) return;
      const prev = previousRef.current[options.name];
      const tasks = dispatcher(ticketId, options.value, prev);
      if (tasks.length === 0) return;

      previousRef.current = { ...previousRef.current, [options.name]: options.value };

      setFieldStatus((s) => ({ ...s, [options.name]: 'saving' }));
      Promise.all(tasks)
        .then(() => {
          setFieldStatus((s) => ({ ...s, [options.name]: 'saved' }));
          setGeneralError(null);
        })
        .catch(() => {
          setFieldStatus((s) => ({ ...s, [options.name]: 'error' }));
          setGeneralError('Failed to save changes.');
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

