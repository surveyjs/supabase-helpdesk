import { createServerClient } from '@/lib/supabase/server';
import { SlaSettingsSurveyForm } from './SlaSettingsSurveyForm';

export default async function AdminSlaPage() {
  const supabase = await createServerClient();

  const { data: policies } = await supabase
    .from('sla_policies')
    .select('id, name, first_response_minutes, resolution_minutes, created_at')
    .order('created_at', { ascending: true });

  const { data: mappings } = await supabase
    .from('sla_severity_mapping')
    .select('severity, sla_policy_id')
    .order('severity');

  const { data: settings } = await supabase
    .from('app_settings')
    .select('key, value')
    .in('key', ['sla_business_hours', 'sla_approaching_threshold']);

  const settingsMap = new Map(settings?.map((s) => [s.key, s.value]) ?? []);

  let businessHours = {
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
  try {
    const raw = settingsMap.get('sla_business_hours');
    if (raw) businessHours = JSON.parse(raw);
  } catch { /* use defaults */ }

  const threshold = parseInt(settingsMap.get('sla_approaching_threshold') ?? '75', 10);

  const severityMappings: Record<string, string | null> = {};
  for (const m of mappings ?? []) {
    severityMappings[m.severity] = m.sla_policy_id;
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">SLA Policies</h1>
      <SlaSettingsSurveyForm
        policies={policies ?? []}
        severityMappings={severityMappings}
        businessHours={businessHours}
        threshold={threshold}
      />
    </div>
  );
}
