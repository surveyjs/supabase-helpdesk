'use client';

import { useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { Model } from 'survey-core';

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
    // SurveyJS `new Model(schema)` mutates the schema object. The JSON
    // schemas are imported as modules and shared across renders/mounts,
    // so we must deep-clone before construction to avoid corrupting the
    // shared reference on subsequent visits (which breaks features like
    // the matrixdynamic Add button on a second navigation).
    const clonedSchema = JSON.parse(JSON.stringify(schema));
    const next = new Model(clonedSchema);
    next.showCompletedPage = false;

    if (typeof next.completeText !== 'string' || next.completeText.trim().length === 0) {
      next.completeText = 'Apply';
    }

    if (mode === 'autosave') {
      next.showCompleteButton = false;
    }

    // Only seed `data` when the caller actually has values. Assigning an
    // empty `{}` causes SurveyJS V3 matrixdynamic to materialise an empty
    // value array (`fields: []`) which suppresses the schema-level
    // `rowCount` default AND the matrix toolbar's Add button on hydration.
    if (data && Object.keys(data).length > 0) {
      next.data = data;
    }
    return next;
    // Only rebuild the model when the schema or mode changes. Rebuilding on
    // every `data` reference change (the parent passes a fresh object literal
    // each render) caused SurveyJS V3 matrixdynamic toolbars to lose their
    // Add button on subsequent navigations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, schema]);

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
