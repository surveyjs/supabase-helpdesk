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

export async function markNotificationRead(
  notificationId: string,
): Promise<{ error?: string }> {
  const supabase = await createServerClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('id', notificationId)
    .eq('recipient_id', user.id);

  if (error) return { error: 'Failed to mark notification as read.' };

  revalidatePath('/notifications');
  return {};
}

export async function markAllNotificationsRead(): Promise<{ error?: string }> {
  const supabase = await createServerClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('recipient_id', user.id)
    .eq('is_read', false);

  if (error) return { error: 'Failed to mark all notifications as read.' };

  revalidatePath('/notifications');
  return {};
}

export async function getUnreadCount(): Promise<number> {
  const supabase = await createServerClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 0;

  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_id', user.id)
    .eq('is_read', false);

  return count || 0;
}
