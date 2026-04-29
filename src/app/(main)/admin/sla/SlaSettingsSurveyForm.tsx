'use client';

import { useMemo } from 'react';
import {
  createSlaPolicy,
  updateSlaPolicy,
  deleteSlaPolicy,
  updateSlaSeverityMapping,
  updateBusinessHours,
  updateSlaThreshold,
} from '@/lib/actions/admin';
import { AdminSurveyForm } from '@/components/features/survey/AdminSurveyForm';
import businessHoursSchema from '@/components/features/survey/form-json/admin/sla-business-hours.json';
import thresholdSchema from '@/components/features/survey/form-json/admin/sla-threshold.json';

type DaySchedule = { start: string; end: string } | null;

interface SlaPolicy {
  id: string;
  name: string;
  first_response_minutes: number;
  resolution_minutes: number;
}

interface SlaSettingsFormProps {
  policies: SlaPolicy[];
  severityMappings: Record<string, string | null>;
  businessHours: {
    timezone: string;
    schedule: Record<string, DaySchedule>;
  };
  threshold: number;
}

const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;

function minutesToDisplay(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function PolicySection({ policies }: { policies: SlaPolicy[] }) {
  return (
    <section className="mb-8">
      <h2 className="text-lg font-medium text-gray-900 mb-4">SLA Policies</h2>

      {policies.length > 0 && (
        <div className="mb-4 bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">First Response</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Resolution</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {policies.map((policy) => (
                <tr key={policy.id} data-testid={`sla-policy-${policy.id}`}>
                  <td className="px-4 py-2 text-sm text-gray-900">{policy.name}</td>
                  <td className="px-4 py-2 text-sm text-gray-700">{minutesToDisplay(policy.first_response_minutes)}</td>
                  <td className="px-4 py-2 text-sm text-gray-700">{minutesToDisplay(policy.resolution_minutes)}</td>
                  <td className="px-4 py-2 text-sm space-x-2">
                    <form action={updateSlaPolicy} className="inline">
                      <input type="hidden" name="policy_id" value={policy.id} />
                      <input type="text" name="name" defaultValue={policy.name} maxLength={100}
                        className="w-24 rounded border border-gray-300 px-1 py-0.5 text-xs" placeholder="Name" />
                      <input type="number" name="first_response_minutes" defaultValue={policy.first_response_minutes} min={1}
                        className="w-16 rounded border border-gray-300 px-1 py-0.5 text-xs ml-1" placeholder="FR min" />
                      <input type="number" name="resolution_minutes" defaultValue={policy.resolution_minutes} min={1}
                        className="w-16 rounded border border-gray-300 px-1 py-0.5 text-xs ml-1" placeholder="Res min" />
                      <button type="submit" className="ml-1 px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200">
                        Update
                      </button>
                    </form>
                    <form action={deleteSlaPolicy} className="inline">
                      <input type="hidden" name="policy_id" value={policy.id} />
                      <button type="submit" className="px-2 py-0.5 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
                        data-testid="delete-policy-btn">
                        Delete
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form action={createSlaPolicy} className="flex gap-2 items-end" data-testid="create-policy-form">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Policy Name</label>
          <input type="text" name="name" maxLength={100} required
            className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            placeholder="e.g. Standard SLA" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">First Response (min)</label>
          <input type="number" name="first_response_minutes" min={1} required
            className="w-24 rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            placeholder="240" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Resolution (min)</label>
          <input type="number" name="resolution_minutes" min={1} required
            className="w-24 rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            placeholder="1440" />
        </div>
        <button type="submit" className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
          data-testid="create-policy-btn">
          Create Policy
        </button>
      </form>
    </section>
  );
}

function SeverityMappingSection({
  policies,
  mappings,
}: {
  policies: SlaPolicy[];
  mappings: Record<string, string | null>;
}) {
  const schema = useMemo(() => {
    const choices = [
      { value: '', text: 'None' },
      ...policies.map((p) => ({ value: p.id, text: p.name })),
    ];
    return {
      showQuestionNumbers: 'off',
      pages: [
        {
          elements: SEVERITIES.map((sev) => ({
            type: 'dropdown',
            name: `mapping_${sev}`,
            title: sev.charAt(0).toUpperCase() + sev.slice(1),
            choices,
          })),
        },
      ],
    };
  }, [policies]);

  const data: Record<string, string> = {};
  for (const sev of SEVERITIES) {
    data[`mapping_${sev}`] = mappings[sev] ?? '';
  }

  return (
    <section className="mb-8">
      <h2 className="text-lg font-medium text-gray-900 mb-4">Severity Mapping</h2>
      <div className="bg-white rounded-lg border border-gray-200 p-6" data-testid="sla-severity-survey-form">
        <AdminSurveyForm
          schema={schema as Record<string, unknown>}
          data={data}
          mode="autosave"
          debounceMs={700}
          saveAction={updateSlaSeverityMapping}
          successMessage="Severity mapping saved."
        />
      </div>
    </section>
  );
}

function BusinessHoursSection({
  businessHours,
}: {
  businessHours: { timezone: string; schedule: Record<string, DaySchedule> };
}) {
  const data: Record<string, unknown> = { timezone: businessHours.timezone };
  for (const day of DAYS) {
    const schedule = businessHours.schedule[day];
    data[`${day}_enabled`] = schedule !== null && schedule !== undefined;
    data[`${day}_start`] = schedule?.start ?? '09:00';
    data[`${day}_end`] = schedule?.end ?? '17:00';
  }

  return (
    <section className="mb-8">
      <h2 className="text-lg font-medium text-gray-900 mb-4">Business Hours</h2>
      <div className="bg-white rounded-lg border border-gray-200 p-6" data-testid="sla-business-hours-survey-form">
        <AdminSurveyForm
          schema={businessHoursSchema as Record<string, unknown>}
          data={data}
          mode="autosave"
          debounceMs={700}
          saveAction={updateBusinessHours}
          successMessage="Business hours saved."
        />
      </div>
    </section>
  );
}

function ThresholdSection({ threshold }: { threshold: number }) {
  return (
    <section className="mb-8">
      <h2 className="text-lg font-medium text-gray-900 mb-4">SLA Approaching Threshold</h2>
      <div className="bg-white rounded-lg border border-gray-200 p-6" data-testid="sla-threshold-survey-form">
        <AdminSurveyForm
          schema={thresholdSchema as Record<string, unknown>}
          data={{ threshold }}
          mode="autosave"
          debounceMs={700}
          saveAction={updateSlaThreshold}
          successMessage="Threshold saved."
        />
      </div>
    </section>
  );
}

export function SlaSettingsSurveyForm({
  policies,
  severityMappings,
  businessHours,
  threshold,
}: SlaSettingsFormProps) {
  return (
    <div className="max-w-3xl">
      <PolicySection policies={policies} />
      <SeverityMappingSection policies={policies} mappings={severityMappings} />
      <BusinessHoursSection businessHours={businessHours} />
      <ThresholdSection threshold={threshold} />
    </div>
  );
}
