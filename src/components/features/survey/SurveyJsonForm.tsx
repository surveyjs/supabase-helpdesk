'use client';

import { useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { Model } from 'survey-core';
import surveyTheme from './theme.json';
import 'survey-core/survey-core.min.css';
import './survey-overrides.css';

const Survey = dynamic(() => import('survey-react-ui').then((mod) => mod.Survey), { ssr: false });

type SurveyJsonFormProps = {
  schema: Record<string, unknown>;
  data: Record<string, unknown>;
  onComplete?: (data: Record<string, unknown>) => void;
  onValueChanged?: (data: Record<string, unknown>) => void;
  mode?: 'complete' | 'autosave';
  className?: string;
};

export function SurveyJsonForm({
  schema,
  data,
  onComplete,
  onValueChanged,
  mode = 'complete',
  className,
}: SurveyJsonFormProps) {
  const model = useMemo(() => {
    const next = new Model(schema);
    next.applyTheme(surveyTheme as Parameters<Model['applyTheme']>[0]);
    next.showCompletedPage = false;

    if (typeof next.completeText !== 'string' || next.completeText.trim().length === 0) {
      next.completeText = 'Apply';
    }

    if (mode === 'autosave') {
      next.showCompleteButton = false;
    }

    next.data = data;
    return next;
  }, [data, mode, schema]);

  useEffect(() => {
    if (!onComplete) return;

    const handler = () => {
      onComplete((model.data ?? {}) as Record<string, unknown>);
    };

    model.onComplete.add(handler);
    return () => {
      model.onComplete.remove(handler);
    };
  }, [model, onComplete]);

  useEffect(() => {
    if (!onValueChanged) return;

    const handler = () => {
      onValueChanged((model.data ?? {}) as Record<string, unknown>);
    };

    model.onValueChanged.add(handler);
    return () => {
      model.onValueChanged.remove(handler);
    };
  }, [model, onValueChanged]);

  return (
    <div className={className}>
      <Survey model={model} />
    </div>
  );
}
