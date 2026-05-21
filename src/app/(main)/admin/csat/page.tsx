import { createServerClient } from '@/lib/supabase/server';
import { CsatSettingsSurveyForm } from './CsatSettingsSurveyForm';

export default async function AdminCsatPage() {
  const supabase = await createServerClient();

  const { data: settings } = await supabase
    .from('app_settings')
    .select('key, value')
    .in('key', ['csat_enabled', 'csat_survey_delay']);

  const settingsMap = new Map(settings?.map((s) => [s.key, s.value]) ?? []);

  const csatEnabled = settingsMap.get('csat_enabled') === 'true';
  const csatDelay = settingsMap.get('csat_survey_delay') ?? '1_hour';

  // Check if email is configured and verified
  const { data: emailConfig } = await supabase
    .from('email_config')
    .select('is_verified')
    .limit(1)
    .single();

  const emailVerified = emailConfig?.is_verified === true;

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">CSAT Settings</h1>
      <CsatSettingsSurveyForm
        enabled={csatEnabled}
        delay={csatDelay}
        emailVerified={emailVerified}
      />
    </div>
  );
}
