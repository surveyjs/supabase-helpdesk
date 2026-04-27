import { createServerClient } from '@/lib/supabase/server';
import 'survey-core/survey-core.min.css';
import { AdminPrivacySurveyForm } from './AdminPrivacySurveyForm';

export default async function AdminPrivacyPage() {
  const supabase = await createServerClient();

  const { data: settings } = await supabase
    .from('app_settings')
    .select('key, value')
    .in('key', ['ticket_default_privacy', 'allow_user_privacy_control', 'allow_public_ticket_browsing']);

  const settingsMap: Record<string, string> = {};
  for (const s of settings ?? []) {
    settingsMap[s.key] = s.value;
  }

  const defaultPrivacy = settingsMap.ticket_default_privacy ?? 'true';
  const allowPrivacyControl = settingsMap.allow_user_privacy_control !== 'false';
  const allowPublicBrowsing = settingsMap.allow_public_ticket_browsing === 'true';

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Ticket Privacy</h1>
      <AdminPrivacySurveyForm
        defaultPrivacy={defaultPrivacy === 'false' ? 'false' : 'true'}
        allowPrivacyControl={allowPrivacyControl}
        allowPublicBrowsing={allowPublicBrowsing}
      />
    </div>
  );
}
