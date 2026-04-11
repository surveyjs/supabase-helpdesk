'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';

type NotificationPrefs = Record<string, { email?: boolean; in_app?: boolean }>;

const VALID_EVENT_TYPES = [
  'new_post',
  'status_changed',
  'agent_assigned',
  'agent_assigned_to_agent',
  'user_reply_to_agent',
  'auto_reopen',
  'urgency_changed',
  'severity_changed',
  'privacy_changed',
];

export async function updateNotificationPreferences(
  preferences: NotificationPrefs,
): Promise<{ error?: string }> {
  const supabase = await createServerClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Validate structure
  const sanitized: NotificationPrefs = {};
  for (const [key, value] of Object.entries(preferences)) {
    if (!VALID_EVENT_TYPES.includes(key)) continue;
    sanitized[key] = {
      email: Boolean(value?.email),
      in_app: Boolean(value?.in_app),
    };
  }

  // Upsert
  const { data: existing } = await supabase
    .from('notification_preferences')
    .select('id')
    .eq('user_id', user.id)
    .single();

  if (existing) {
    const { error } = await supabase
      .from('notification_preferences')
      .update({
        preferences: sanitized,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id);

    if (error) return { error: 'Failed to save preferences.' };
  } else {
    const { error } = await supabase
      .from('notification_preferences')
      .insert({
        user_id: user.id,
        preferences: sanitized,
      });

    if (error) return { error: 'Failed to save preferences.' };
  }

  revalidatePath('/notification-settings');
  return {};
}
