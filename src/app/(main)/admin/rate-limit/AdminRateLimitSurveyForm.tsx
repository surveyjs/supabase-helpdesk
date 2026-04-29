'use client';

import { updateRateLimit } from '@/lib/actions/admin';
import { AdminSurveyForm } from '@/components/features/survey/AdminSurveyForm';
import rateLimitSchema from '@/components/features/survey/form-json/admin/rate-limit.json';

export function AdminRateLimitSurveyForm({ currentLimit }: { currentLimit: number }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-3" data-testid="rate-limit-survey-form">
      <AdminSurveyForm
        schema={rateLimitSchema as Record<string, unknown>}
        data={{ ticket_creation_rate_limit: currentLimit }}
        mode="autosave"
        debounceMs={700}
        saveAction={updateRateLimit}
        successMessage="Rate limit saved."
      />
      <p className="text-xs text-gray-500">
        Agents and admins are exempt from rate limiting.
      </p>
    </div>
  );
}
