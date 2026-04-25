'use client';

import { useMemo } from 'react';
import { updateRateLimit } from '@/lib/actions/admin';
import { AdminSurveyForm } from '@/components/features/survey/AdminSurveyForm';
import rateLimitSchema from '@/components/features/survey/form-json/admin/rate-limit.json';

export function AdminRateLimitSurveyForm({ currentLimit }: { currentLimit: number }) {
  const data = useMemo(
    () => ({
      ticket_creation_rate_limit: currentLimit,
    }),
    [currentLimit],
  );

  const toFormData = useMemo(
    () => (surveyData: Record<string, unknown>) => {
      const fd = new FormData();
      fd.set('ticket_creation_rate_limit', String(surveyData.ticket_creation_rate_limit ?? '').trim());
      return fd;
    },
    [],
  );

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-3" data-testid="rate-limit-survey-form">
      <AdminSurveyForm
        schema={rateLimitSchema as Record<string, unknown>}
        data={data}
        mode="autosave"
        debounceMs={700}
        saveAction={updateRateLimit}
        toFormData={toFormData}
        successMessage="Rate limit saved."
      />
      <p className="text-xs text-gray-500">
        Agents and admins are exempt from rate limiting.
      </p>
    </div>
  );
}
