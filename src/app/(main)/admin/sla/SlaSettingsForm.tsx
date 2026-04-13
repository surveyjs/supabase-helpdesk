'use client';

import { useState } from 'react';
import {
  createSlaPolicy,
  updateSlaPolicy,
  deleteSlaPolicy,
  updateSlaSeverityMapping,
  updateBusinessHours,
  updateSlaThreshold,
} from '@/lib/actions/admin';

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

const SEVERITIES = ['low', 'medium', 'high', 'critical'];
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

function minutesToDisplay(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function SlaSettingsForm({
  policies: initialPolicies,
  severityMappings: initialMappings,
  businessHours: initialBH,
  threshold: initialThreshold,
}: SlaSettingsFormProps) {
  const [feedback, setFeedback] = useState<string | null>(null);

  // ==================== Policies ====================

  function PolicySection() {
    return (
      <section className="mb-8">
        <h2 className="text-lg font-medium text-gray-900 mb-4">SLA Policies</h2>

        {initialPolicies.length > 0 && (
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
                {initialPolicies.map((policy) => (
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

  // ==================== Severity Mapping ====================

  function SeverityMappingSection() {
    return (
      <section className="mb-8">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Severity Mapping</h2>
        <form action={updateSlaSeverityMapping} data-testid="severity-mapping-form">
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden mb-3">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Severity</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">SLA Policy</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {SEVERITIES.map((sev) => (
                  <tr key={sev}>
                    <td className="px-4 py-2 text-sm text-gray-900 capitalize">{sev}</td>
                    <td className="px-4 py-2">
                      <select
                        name={`mapping_${sev}`}
                        defaultValue={initialMappings[sev] ?? ''}
                        className="rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                        data-testid={`mapping-${sev}`}
                      >
                        <option value="">None</option>
                        {initialPolicies.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="submit" className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
            data-testid="save-mapping-btn">
            Save Mapping
          </button>
        </form>
      </section>
    );
  }

  // ==================== Business Hours ====================

  function BusinessHoursSection() {
    return (
      <section className="mb-8">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Business Hours</h2>
        <form action={updateBusinessHours} data-testid="business-hours-form">
          <div className="mb-4">
            <label className="block text-xs font-medium text-gray-500 mb-1">Timezone</label>
            <select name="timezone" defaultValue={initialBH.timezone}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              data-testid="bh-timezone">
              {['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
                'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Asia/Tokyo', 'Asia/Shanghai',
                'Asia/Kolkata', 'Australia/Sydney', 'Pacific/Auckland'].map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden mb-3">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Day</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Enabled</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Start</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">End</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {DAYS.map((day) => {
                  const schedule = initialBH.schedule[day];
                  return (
                    <tr key={day}>
                      <td className="px-4 py-2 text-sm text-gray-900 capitalize">{day}</td>
                      <td className="px-4 py-2">
                        <input type="hidden" name={`${day}_enabled`} value="false" />
                        <input
                          type="checkbox"
                          name={`${day}_enabled`}
                          value="true"
                          defaultChecked={schedule !== null}
                          className="h-4 w-4 rounded border-gray-300 text-blue-600"
                          data-testid={`bh-${day}-enabled`}
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          type="time"
                          name={`${day}_start`}
                          defaultValue={schedule?.start ?? '09:00'}
                          className="rounded border border-gray-300 px-2 py-1 text-sm"
                          data-testid={`bh-${day}-start`}
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          type="time"
                          name={`${day}_end`}
                          defaultValue={schedule?.end ?? '17:00'}
                          className="rounded border border-gray-300 px-2 py-1 text-sm"
                          data-testid={`bh-${day}-end`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button type="submit" className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
            data-testid="save-bh-btn">
            Save Business Hours
          </button>
        </form>
      </section>
    );
  }

  // ==================== Threshold ====================

  function ThresholdSection() {
    return (
      <section className="mb-8">
        <h2 className="text-lg font-medium text-gray-900 mb-4">SLA Approaching Threshold</h2>
        <form action={updateSlaThreshold} className="flex gap-3 items-end" data-testid="threshold-form">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Threshold (%)</label>
            <input
              type="number"
              name="threshold"
              min={50}
              max={95}
              defaultValue={initialThreshold}
              className="w-24 rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              data-testid="threshold-input"
            />
          </div>
          <button type="submit" className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
            data-testid="save-threshold-btn">
            Save Threshold
          </button>
        </form>
        <p className="mt-2 text-xs text-gray-500">
          Notifications are sent when this percentage of the SLA target time has elapsed (50–95%).
        </p>
      </section>
    );
  }

  return (
    <div className="max-w-3xl">
      {feedback && (
        <div className="mb-4 p-3 rounded bg-green-50 border border-green-200 text-green-800 text-sm" data-testid="sla-feedback">
          {feedback}
        </div>
      )}
      <PolicySection />
      <SeverityMappingSection />
      <BusinessHoursSection />
      <ThresholdSection />
    </div>
  );
}
