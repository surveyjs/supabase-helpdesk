import { createServerClient } from '@/lib/supabase/server';
import {
  createSlaPolicy,
  updateSlaPolicy,
  deleteSlaPolicy,
  updateSlaSeverityMapping,
  updateBusinessHours,
  updateSlaThreshold,
} from '@/lib/actions/admin';
import { BusinessHoursForm } from './BusinessHoursForm';

export default async function AdminSlaPage() {
  const supabase = await createServerClient();

  // Fetch SLA policies
  const { data: policies } = await supabase
    .from('sla_policies')
    .select('*')
    .order('name');

  // Fetch severity mappings
  const { data: mappings } = await supabase
    .from('sla_severity_mapping')
    .select('severity, sla_policy_id');

  const mappingMap = new Map(
    (mappings ?? []).map((m) => [m.severity, m.sla_policy_id]),
  );

  // Fetch business hours config
  const { data: bhSetting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'sla_business_hours')
    .single();

  let businessHoursConfig = {
    timezone: 'UTC',
    schedule: {
      monday: { start: '09:00', end: '17:00' },
      tuesday: { start: '09:00', end: '17:00' },
      wednesday: { start: '09:00', end: '17:00' },
      thursday: { start: '09:00', end: '17:00' },
      friday: { start: '09:00', end: '17:00' },
      saturday: null as { start: string; end: string } | null,
      sunday: null as { start: string; end: string } | null,
    },
  };
  if (bhSetting?.value) {
    try { businessHoursConfig = JSON.parse(bhSetting.value); } catch { /* use defaults */ }
  }

  // Fetch approaching threshold
  const { data: thresholdSetting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'sla_approaching_threshold')
    .single();

  const threshold = thresholdSetting?.value ? parseInt(thresholdSetting.value, 10) : 75;

  const severities = ['low', 'medium', 'high', 'critical'] as const;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold text-gray-900">SLA Policies</h1>

      {/* SLA Policies List */}
      <section className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Policies</h2>

        {policies && policies.length > 0 ? (
          <div className="space-y-3 mb-6">
            {policies.map((policy) => (
              <div
                key={policy.id}
                className="flex items-center justify-between border border-gray-100 rounded p-3"
                data-testid={`sla-policy-${policy.id}`}
              >
                <div>
                  <span className="font-medium text-gray-900">{policy.name}</span>
                  <span className="ml-4 text-sm text-gray-500">
                    First Response: {formatMinutes(policy.first_response_minutes)} · Resolution: {formatMinutes(policy.resolution_minutes)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <details className="relative">
                    <summary className="text-sm text-blue-600 hover:text-blue-800 cursor-pointer">Edit</summary>
                    <div className="absolute right-0 top-6 z-10 bg-white border border-gray-200 rounded-lg shadow-lg p-4 w-80">
                      <form action={updateSlaPolicy} className="space-y-3">
                        <input type="hidden" name="policy_id" value={policy.id} />
                        <div>
                          <label className="block text-xs text-gray-600 mb-1">Name</label>
                          <input
                            type="text"
                            name="name"
                            defaultValue={policy.name}
                            maxLength={100}
                            className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-600 mb-1">First Response (minutes)</label>
                          <input
                            type="number"
                            name="first_response_minutes"
                            defaultValue={policy.first_response_minutes}
                            min={1}
                            className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-600 mb-1">Resolution (minutes)</label>
                          <input
                            type="number"
                            name="resolution_minutes"
                            defaultValue={policy.resolution_minutes}
                            min={1}
                            className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                            required
                          />
                        </div>
                        <button type="submit" className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
                          Save
                        </button>
                      </form>
                    </div>
                  </details>
                  <form action={deleteSlaPolicy}>
                    <input type="hidden" name="policy_id" value={policy.id} />
                    <button
                      type="submit"
                      className="text-sm text-red-600 hover:text-red-800"
                      data-testid="delete-sla-policy"
                    >
                      Delete
                    </button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-400 mb-6">No SLA policies yet.</p>
        )}

        {/* Create new policy */}
        <form action={createSlaPolicy} className="border-t border-gray-200 pt-4" data-testid="create-sla-policy-form">
          <h3 className="text-sm font-medium text-gray-700 mb-3">Create New Policy</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Name</label>
              <input
                type="text"
                name="name"
                maxLength={100}
                placeholder="e.g., Standard SLA"
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">First Response (minutes)</label>
              <input
                type="number"
                name="first_response_minutes"
                min={1}
                placeholder="240"
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Resolution (minutes)</label>
              <input
                type="number"
                name="resolution_minutes"
                min={1}
                placeholder="1440"
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                required
              />
            </div>
          </div>
          <button
            type="submit"
            className="mt-3 px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
          >
            Create Policy
          </button>
        </form>
      </section>

      {/* Severity Mapping */}
      <section className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Severity → SLA Mapping</h2>
        <form action={updateSlaSeverityMapping} data-testid="severity-mapping-form">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 px-2 text-gray-600">Severity</th>
                <th className="text-left py-2 px-2 text-gray-600">SLA Policy</th>
              </tr>
            </thead>
            <tbody>
              {severities.map((severity) => (
                <tr key={severity} className="border-b border-gray-100">
                  <td className="py-2 px-2 font-medium capitalize">{severity}</td>
                  <td className="py-2 px-2">
                    <select
                      name={`mapping_${severity}`}
                      defaultValue={mappingMap.get(severity) ?? ''}
                      className="rounded border border-gray-300 px-2 py-1 text-sm"
                    >
                      <option value="">None</option>
                      {(policies ?? []).map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="submit"
            className="mt-3 px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
          >
            Save Mappings
          </button>
        </form>
      </section>

      {/* Business Hours */}
      <section className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Business Hours</h2>
        <BusinessHoursForm
          config={businessHoursConfig}
          updateAction={updateBusinessHours}
        />
      </section>

      {/* Approaching Threshold */}
      <section className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Approaching Threshold</h2>
        <form action={updateSlaThreshold} data-testid="sla-threshold-form">
          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-700">
              Send &quot;approaching&quot; notification when this percentage of SLA time has elapsed:
            </label>
            <input
              type="number"
              name="threshold"
              min={50}
              max={95}
              defaultValue={threshold}
              className="w-20 rounded border border-gray-300 px-2 py-1 text-sm"
            />
            <span className="text-sm text-gray-500">%</span>
          </div>
          <p className="text-xs text-gray-400 mt-1">Must be between 50% and 95%. Default: 75%</p>
          <button
            type="submit"
            className="mt-3 px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
          >
            Save Threshold
          </button>
        </form>
      </section>
    </div>
  );
}

function formatMinutes(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
