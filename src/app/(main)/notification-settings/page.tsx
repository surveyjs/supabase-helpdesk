import { createServerClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/auth';
import { NotificationPreferencesForm } from './NotificationPreferencesForm';

const EVENT_TYPES = [
  { key: 'new_post', label: 'New Reply' },
  { key: 'status_changed', label: 'Status Changed' },
  { key: 'agent_assigned', label: 'Agent Assigned' },
  { key: 'agent_assigned_to_agent', label: 'Assigned to You (agent)' },
  { key: 'user_reply_to_agent', label: 'User Reply (agent)' },
  { key: 'auto_reopen', label: 'Auto Re-open' },
  { key: 'urgency_changed', label: 'Urgency Changed' },
  { key: 'severity_changed', label: 'Severity Changed' },
  { key: 'privacy_changed', label: 'Privacy Changed' },
];

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
    <div className="max-w-3xl mx-auto py-8">
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Notification Settings</h1>
      <NotificationPreferencesForm
        eventTypes={EVENT_TYPES}
        preferences={merged}
      />
    </div>
  );
}
