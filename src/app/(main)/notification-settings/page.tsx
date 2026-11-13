import { createServerClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/auth';
import { NOTIFICATION_EVENT_TYPES as EVENT_TYPES } from '@/lib/notifications/event-labels';
import { NotificationPreferencesForm } from './NotificationPreferencesForm';


type Prefs = Record<string, { email?: boolean; in_app?: boolean }>;

export default async function NotificationSettingsPage() {
  const user = await requireAuth();
  const supabase = await createServerClient();

  // Get system defaults
  const { data: defaultSetting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'default_notification_preferences')
    .single();

  let defaults: Prefs = {};
  try {
    defaults = defaultSetting ? JSON.parse(defaultSetting.value) : {};
  } catch {
    defaults = {};
  }

  // Get user preferences
  const { data: userPrefs } = await supabase
    .from('notification_preferences')
    .select('preferences')
    .eq('user_id', user.id)
    .single();

  const userOverrides: Prefs = userPrefs?.preferences
    ? (userPrefs.preferences as Prefs)
    : {};

  // Merge: user overrides take precedence
  const merged: Prefs = {};
  for (const et of EVENT_TYPES) {
    const def = defaults[et.key] ?? { email: true, in_app: true };
    const uo = userOverrides[et.key];
    merged[et.key] = uo ?? def;
  }

  return (
    <div className="py-8">
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Notification Settings</h1>
      <NotificationPreferencesForm
        eventTypes={EVENT_TYPES}
        preferences={merged}
      />
    </div>
  );
}
