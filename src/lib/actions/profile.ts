'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServerClient, createServiceRoleClient } from '@/lib/supabase/server';

// ============================================================
// Helpers
// ============================================================

async function requireAuthUser() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, display_name, email, is_blocked')
    .eq('id', user.id)
    .single();
  if (!profile) redirect('/login');
  return { supabase, user, profile };
}

async function requireAgentRole() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .single();
  if (!profile || !['agent', 'admin'].includes(profile.role)) {
    throw new Error('Forbidden');
  }
  return { supabase, user, profile };
}

async function logAudit(
  adminId: string,
  action: string,
  targetType: string,
  targetId?: string | null,
  details?: Record<string, unknown>,
) {
  const svc = createServiceRoleClient();
  await svc.from('admin_audit_log').insert({
    admin_id: adminId,
    action,
    target_type: targetType,
    target_id: targetId ?? null,
    details: details ?? {},
  });
}

// ============================================================
// Display Name
// ============================================================

export type ProfileActionState = {
  error?: string;
  success?: string;
};

export async function updateDisplayName(
  _prev: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const { supabase, user } = await requireAuthUser();

  const displayName = (formData.get('display_name') as string)?.trim();
  if (!displayName || displayName.length > 100) {
    return { error: 'Display name must be 1–100 characters.' };
  }

  if (displayName.startsWith('Deleted User #')) {
    return { error: 'This display name prefix is reserved.' };
  }

  // Check uniqueness if enabled
  const { data: setting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'enforce_display_name_uniqueness')
    .single();

  if (setting?.value === 'true') {
    const svc = createServiceRoleClient();
    const { data: existing } = await svc
      .from('profiles')
      .select('id')
      .ilike('display_name', displayName)
      .neq('id', user.id)
      .limit(1)
      .single();
    if (existing) {
      return { error: 'This display name is already taken.' };
    }
  }

  const { error } = await supabase
    .from('profiles')
    .update({ display_name: displayName })
    .eq('id', user.id);

  if (error) {
    return { error: 'Failed to update display name.' };
  }

  revalidatePath('/profile');
  return { success: 'Display name updated.' };
}

// ============================================================
// Change Password
// ============================================================

const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

export async function changePassword(
  _prev: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const currentPassword = formData.get('current_password') as string;
  const newPassword = formData.get('new_password') as string;
  const confirmPassword = formData.get('confirm_password') as string;

  if (!currentPassword || !newPassword || !confirmPassword) {
    return { error: 'All fields are required.' };
  }

  if (newPassword !== confirmPassword) {
    return { error: 'New passwords do not match.' };
  }

  if (!PASSWORD_REGEX.test(newPassword)) {
    return { error: 'Password must be at least 8 characters with uppercase, lowercase, and a digit.' };
  }

  // Verify current password by attempting sign-in
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: user.email!,
    password: currentPassword,
  });

  if (signInError) {
    return { error: 'Current password is incorrect.' };
  }

  const { error: updateError } = await supabase.auth.updateUser({
    password: newPassword,
  });

  if (updateError) {
    return { error: 'Failed to update password.' };
  }

  return { success: 'Password changed successfully.' };
}

// ============================================================
// Delete Own Account
// ============================================================

export async function deleteOwnAccount(): Promise<ProfileActionState> {
  const { user, profile } = await requireAuthUser();

  if (profile.role !== 'user') {
    return { error: 'Agents and admins must be demoted before deleting their account.' };
  }

  const svc = createServiceRoleClient();
  const idSuffix = user.id.slice(0, 8);

  // Anonymize profile
  await svc
    .from('profiles')
    .update({
      display_name: `Deleted User #${idSuffix}`,
      email: `deleted-${user.id}@deleted.local`,
    })
    .eq('id', user.id);

  // Remove notification preferences
  await svc
    .from('notification_preferences')
    .delete()
    .eq('user_id', user.id);

  // Remove team membership
  await svc
    .from('profiles')
    .update({ team_id: null })
    .eq('id', user.id);

  // Remove ticket follows
  await svc
    .from('ticket_follows')
    .delete()
    .eq('user_id', user.id);

  // Log to audit log
  await svc.from('admin_audit_log').insert({
    admin_id: user.id,
    action: 'self_delete_account',
    target_type: 'user',
    target_id: user.id,
    details: { email: profile.email },
  });

  // Delete auth user (invalidates session)
  await svc.auth.admin.deleteUser(user.id);

  redirect('/login');
}

// ============================================================
// User Notes (Agent actions)
// ============================================================

export async function updateEditorViewMode(
  _prev: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const { supabase, user } = await requireAuthUser();
  const mode = formData.get('editor_view_mode') as string;

  if (!['both', 'preview', 'editor'].includes(mode)) {
    return { error: 'Invalid editor view mode.' };
  }

  const { error } = await supabase
    .from('profiles')
    .update({ editor_view_mode: mode })
    .eq('id', user.id);

  if (error) {
    return { error: 'Failed to update editor preference.' };
  }

  revalidatePath('/');
  revalidatePath('/profile');
  return { success: 'Editor preference saved.' };
}

// ============================================================
// User Notes (Agent CRUD actions)
// ============================================================

export async function createUserNote(
  _prev: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const { supabase, user, profile } = await requireAgentRole();

  const targetUserId = formData.get('target_user_id') as string;
  const body = (formData.get('body') as string)?.trim();

  if (!targetUserId) {
    return { error: 'Target user is required.' };
  }
  if (!body || body.length > 10000) {
    return { error: 'Note body must be 1–10,000 characters.' };
  }

  const { error } = await supabase.from('user_notes').insert({
    target_user_id: targetUserId,
    author_id: user.id,
    body,
  });

  if (error) {
    return { error: 'Failed to create note.' };
  }

  await logAudit(profile.id, 'create_user_note', 'user_note', targetUserId, {
    body_length: body.length,
  });

  revalidatePath(`/agent/users/${targetUserId}`);
  revalidatePath('/admin/users');
  return { success: 'Note added.' };
}

export async function updateUserNote(
  _prev: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const { supabase, profile } = await requireAgentRole();

  const noteId = formData.get('note_id') as string;
  const targetUserId = formData.get('target_user_id') as string;
  const body = (formData.get('body') as string)?.trim();

  if (!noteId) {
    return { error: 'Note ID is required.' };
  }
  if (!body || body.length > 10000) {
    return { error: 'Note body must be 1–10,000 characters.' };
  }

  const { data, error } = await supabase
    .from('user_notes')
    .update({ body, edited_at: new Date().toISOString() })
    .eq('id', noteId)
    .select('id')
    .maybeSingle();

  if (error) {
    return { error: 'Failed to update note.' };
  }

  if (!data) {
    return { error: 'Note not found or you do not have permission to edit it.' };
  }

  await logAudit(profile.id, 'update_user_note', 'user_note', noteId, {
    body_length: body.length,
  });

  if (targetUserId) {
    revalidatePath(`/agent/users/${targetUserId}`);
  }
  revalidatePath('/admin/users');
  return { success: 'Note updated.' };
}

export async function deleteUserNote(formData: FormData): Promise<void> {
  const { supabase, profile } = await requireAgentRole();

  const noteId = formData.get('note_id') as string;
  const targetUserId = formData.get('target_user_id') as string;
  if (!noteId) return;

  const { error } = await supabase
    .from('user_notes')
    .delete()
    .eq('id', noteId);

  if (error) return;

  await logAudit(profile.id, 'delete_user_note', 'user_note', noteId, {});

  if (targetUserId) {
    revalidatePath(`/agent/users/${targetUserId}`);
  }
  revalidatePath('/admin/users');
}
