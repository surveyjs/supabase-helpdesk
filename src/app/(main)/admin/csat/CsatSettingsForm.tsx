'use client';

import { useActionState } from 'react';
import { updateCsatSettings } from '@/lib/actions/admin';

interface CsatSettingsFormProps {
  enabled: boolean;
  delay: string;
  emailVerified: boolean;
}

export function CsatSettingsForm({ enabled, delay, emailVerified }: CsatSettingsFormProps) {
  const [, formAction, isPending] = useActionState(
    async (_prev: unknown, formData: FormData) => {
      await updateCsatSettings(formData);
      return { saved: true };
    },
    null,
  );

  return (
    <form action={formAction} className="space-y-6 max-w-lg">
      {/* Enable CSAT toggle */}
      <div>
        <label className="flex items-center gap-3">
          <input
            type="hidden"
            name="csat_enabled"
            value="false"
          />
          <input
            type="checkbox"
            name="csat_enabled"
            value="true"
            defaultChecked={enabled}
            disabled={!emailVerified}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
            data-testid="csat-enabled-toggle"
          />
          <span className="text-sm font-medium text-gray-900">
            Enable CSAT surveys
          </span>
        </label>
        {!emailVerified && (
          <p className="mt-1 text-sm text-amber-600" data-testid="csat-email-warning">
            ⚠ Email must be configured and verified before enabling CSAT surveys.
          </p>
        )}
        <p className="mt-1 text-xs text-gray-500">
          When enabled, a satisfaction survey email will be sent to ticket creators after their ticket is closed.
        </p>
      </div>

      {/* Survey delay */}
      <fieldset>
        <legend className="text-sm font-medium text-gray-900 mb-2">
          Survey delay after ticket closure
        </legend>
        <div className="space-y-2">
          {[
            { value: 'immediately', label: 'Immediately' },
            { value: '1_hour', label: '1 hour (default)' },
            { value: '4_hours', label: '4 hours' },
            { value: '24_hours', label: '24 hours' },
          ].map((option) => (
            <label key={option.value} className="flex items-center gap-2">
              <input
                type="radio"
                name="csat_survey_delay"
                value={option.value}
                defaultChecked={delay === option.value}
                className="h-4 w-4 border-gray-300 text-blue-600 focus:ring-blue-500"
                data-testid={`csat-delay-${option.value}`}
              />
              <span className="text-sm text-gray-700">{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <button
        type="submit"
        disabled={isPending}
        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
        data-testid="csat-save-btn"
      >
        {isPending ? 'Saving...' : 'Save Settings'}
      </button>
    </form>
  );
}
