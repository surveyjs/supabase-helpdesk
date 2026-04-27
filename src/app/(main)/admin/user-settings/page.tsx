import { createServerClient } from '@/lib/supabase/server';
import 'survey-core/survey-core.min.css';
import { DefaultNotificationPreferencesForm } from './DefaultNotificationPreferencesForm';
import { UserSettingsSurveyForm } from './UserSettingsSurveyForm';

type Prefs = Record<string, { email?: boolean; in_app?: boolean }>;

export default async function AdminUserSettingsPage() {
  const supabase = await createServerClient();

  const { data: setting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'enforce_display_name_uniqueness')
    .single();

  const enforceUniqueness = setting?.value === 'true';

  const { data: prefsSetting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'default_notification_preferences')
    .single();

  let defaultPrefs: Prefs = {};
  try {
    defaultPrefs = prefsSetting ? JSON.parse(prefsSetting.value) : {};
  } catch {
    defaultPrefs = {};
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">User Settings</h1>

      <UserSettingsSurveyForm enforceUniqueness={enforceUniqueness} />

      <DefaultNotificationPreferencesForm preferences={defaultPrefs} />
    </div>
  );
}
