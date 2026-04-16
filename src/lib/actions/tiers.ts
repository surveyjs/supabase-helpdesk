'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServerClient, createServiceRoleClient } from '@/lib/supabase/server';

async function requireAdminRole() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .single();
  if (!profile || profile.role !== 'admin') {
    throw new Error('Forbidden');
  }
  return { supabase, user, profile };
}

async function logAudit(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  adminId: string,
  action: string,
  targetType: string,
  targetId?: string | null,
  details?: Record<string, unknown>,
) {
  await supabase.from('admin_audit_log').insert({
    admin_id: adminId,
    action,
    target_type: targetType,
    target_id: targetId ?? null,
    details: details ?? {},
  });
}

const KEY_REGEX = /^[a-z0-9](-?[a-z0-9])*$/;

export async function createTier(formData: FormData): Promise<void> {
  const { supabase, profile } = await requireAdminRole();

  const key = (formData.get('key') as string)?.trim() ?? '';
  const displayName = (formData.get('display_name') as string)?.trim() ?? '';
  const color = (formData.get('color') as string)?.trim() || 'gray';
  const icon = (formData.get('icon') as string)?.trim() || null;

  if (!key || key.length > 50 || !KEY_REGEX.test(key)) {
    return;
  }
  if (!displayName || displayName.length > 100) {
    return;
  }

  // Capability overrides
  const capChangeVisibility = formData.get('cap_change_visibility') === 'on';
  const capSetSeverity = formData.get('cap_set_severity') === 'on';
  const capChangeStatus = formData.get('cap_change_status') === 'on';
  const capChangeType = formData.get('cap_change_type') === 'on';
  const capAddRemoveTags = formData.get('cap_add_remove_tags') === 'on';

  // Limit overrides
  const limitTicketRate = parseOptionalInt(formData.get('limit_ticket_rate') as string);
  const limitMaxFileSize = parseOptionalInt(formData.get('limit_max_file_size') as string);
  const limitMaxFilesPerPost = parseOptionalInt(formData.get('limit_max_files_per_post') as string);

  if (limitMaxFileSize !== null && limitMaxFileSize > 52428800) {
    return;
  }
  if (limitMaxFilesPerPost !== null && limitMaxFilesPerPost > 20) {
    return;
  }

  // Get next sort_order
  const { data: maxRow } = await supabase
    .from('subscription_tiers')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .single();

  const nextOrder = (maxRow?.sort_order ?? 0) + 1;

  const { data: created, error } = await supabase
    .from('subscription_tiers')
    .insert({
      key,
      display_name: displayName,
      color,
      icon,
      sort_order: nextOrder,
      cap_change_visibility: capChangeVisibility,
      cap_set_severity: capSetSeverity,
      cap_change_status: capChangeStatus,
      cap_change_type: capChangeType,
      cap_add_remove_tags: capAddRemoveTags,
      limit_ticket_rate: limitTicketRate,
      limit_max_file_size: limitMaxFileSize,
      limit_max_files_per_post: limitMaxFilesPerPost,
    })
    .select('id')
    .single();

  if (error) return;

  await logAudit(supabase, profile.id, 'tier_created', 'subscription_tier', created?.id, { key });
  revalidatePath('/admin/tiers');
}

export async function updateTier(formData: FormData): Promise<void> {
  const { supabase, profile } = await requireAdminRole();

  const tierId = formData.get('tier_id') as string;
  if (!tierId) return;

  const displayName = (formData.get('display_name') as string)?.trim() ?? '';
  const color = (formData.get('color') as string)?.trim() || 'gray';
  const icon = (formData.get('icon') as string)?.trim() || null;

  if (!displayName || displayName.length > 100) {
    return;
  }

  const capChangeVisibility = formData.get('cap_change_visibility') === 'on';
  const capSetSeverity = formData.get('cap_set_severity') === 'on';
  const capChangeStatus = formData.get('cap_change_status') === 'on';
  const capChangeType = formData.get('cap_change_type') === 'on';
  const capAddRemoveTags = formData.get('cap_add_remove_tags') === 'on';

  const limitTicketRate = parseOptionalInt(formData.get('limit_ticket_rate') as string);
  const limitMaxFileSize = parseOptionalInt(formData.get('limit_max_file_size') as string);
  const limitMaxFilesPerPost = parseOptionalInt(formData.get('limit_max_files_per_post') as string);

  if (limitMaxFileSize !== null && limitMaxFileSize > 52428800) {
    return;
  }
  if (limitMaxFilesPerPost !== null && limitMaxFilesPerPost > 20) {
    return;
  }

  const { error } = await supabase
    .from('subscription_tiers')
    .update({
      display_name: displayName,
      color,
      icon,
      cap_change_visibility: capChangeVisibility,
      cap_set_severity: capSetSeverity,
      cap_change_status: capChangeStatus,
      cap_change_type: capChangeType,
      cap_add_remove_tags: capAddRemoveTags,
      limit_ticket_rate: limitTicketRate,
      limit_max_file_size: limitMaxFileSize,
      limit_max_files_per_post: limitMaxFilesPerPost,
      updated_at: new Date().toISOString(),
    })
    .eq('id', tierId);

  if (error) return;

  await logAudit(supabase, profile.id, 'tier_updated', 'subscription_tier', tierId, { display_name: displayName });
  revalidatePath('/admin/tiers');
}

export async function deleteTier(formData: FormData): Promise<void> {
  const { supabase, profile } = await requireAdminRole();

  const tierId = formData.get('tier_id') as string;
  if (!tierId) return;

  // Get tier info for audit log
  const { data: tier } = await supabase
    .from('subscription_tiers')
    .select('key')
    .eq('id', tierId)
    .single();

  if (!tier) return;

  // Count affected users
  const { count } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('tier_id', tierId);

  const { error } = await supabase
    .from('subscription_tiers')
    .delete()
    .eq('id', tierId);

  if (error) return;

  await logAudit(supabase, profile.id, 'tier_deleted', 'subscription_tier', tierId, {
    key: tier.key,
    affected_users: count ?? 0,
  });
  revalidatePath('/admin/tiers');
}

export async function reorderTiers(formData: FormData): Promise<void> {
  const { supabase } = await requireAdminRole();

  const tierIdsJson = formData.get('tier_ids') as string;
  if (!tierIdsJson) return;

  let tierIds: string[];
  try {
    tierIds = JSON.parse(tierIdsJson);
    if (!Array.isArray(tierIds)) throw new Error();
  } catch {
    return;
  }

  for (let i = 0; i < tierIds.length; i++) {
    await supabase
      .from('subscription_tiers')
      .update({ sort_order: i + 1 })
      .eq('id', tierIds[i]);
  }

  revalidatePath('/admin/tiers');
}

export async function assignTier(formData: FormData): Promise<void> {
  const { supabase, profile } = await requireAdminRole();

  const userId = formData.get('user_id') as string;
  const tierId = formData.get('tier_id') as string;
  const expiresAt = (formData.get('expires_at') as string)?.trim() || null;

  if (!userId) return;

  if (!tierId || tierId === 'none') {
    // Remove tier
    const { error } = await supabase
      .from('profiles')
      .update({ tier_id: null, tier_expires_at: null })
      .eq('id', userId);

    if (error) return;

    await logAudit(supabase, profile.id, 'tier_removed', 'profile', userId, {});
  } else {
    // Validate tier exists
    const { data: tier } = await supabase
      .from('subscription_tiers')
      .select('id, key')
      .eq('id', tierId)
      .single();

    if (!tier) return;

    const { error } = await supabase
      .from('profiles')
      .update({
        tier_id: tierId,
        tier_expires_at: expiresAt,
      })
      .eq('id', userId);

    if (error) return;

    await logAudit(supabase, profile.id, 'tier_assigned', 'profile', userId, {
      tier_key: tier.key,
      expires_at: expiresAt,
    });
  }

  revalidatePath('/admin/tiers');
  revalidatePath('/admin/users');
  revalidatePath(`/agent/users/${userId}`);
}

export async function saveTierApiSecret(formData: FormData): Promise<{ error?: string }> {
  const { supabase, profile } = await requireAdminRole();

  const secret = (formData.get('secret') as string)?.trim() ?? '';
  if (!secret) return { error: 'Secret is required.' };
  if (secret.length < 16) return { error: 'Secret must be at least 16 characters.' };

  const serviceClient = createServiceRoleClient();
  try { await serviceClient.rpc('delete_tier_api_secret'); } catch { /* ignore if not exists */ }
  const { error } = await serviceClient.rpc('store_tier_api_secret', { key_value: secret });
  if (error) return { error: 'Failed to store secret: ' + error.message };

  await logAudit(supabase, profile.id, 'tier_api_secret_updated', 'app_settings', null, {});
  revalidatePath('/admin/tiers');
  return {};
}

export async function deleteTierApiSecret(): Promise<{ error?: string }> {
  const { supabase, profile } = await requireAdminRole();

  const serviceClient = createServiceRoleClient();
  const { error } = await serviceClient.rpc('delete_tier_api_secret');
  if (error) return { error: error.message };

  await logAudit(supabase, profile.id, 'tier_api_secret_deleted', 'app_settings', null, {});
  revalidatePath('/admin/tiers');
  return {};
}

export async function getTierApiSecretStatus(): Promise<{ configured: boolean; masked: string }> {
  const serviceClient = createServiceRoleClient();
  const { data: secret } = await serviceClient.rpc('get_tier_api_secret');
  if (secret && typeof secret === 'string' && secret.length > 0) {
    const masked = secret.slice(0, 4) + '•'.repeat(Math.max(0, secret.length - 8)) + secret.slice(-4);
    return { configured: true, masked };
  }
  return { configured: false, masked: '' };
}

function parseOptionalInt(val: string | null | undefined): number | null {
  if (!val || val.trim() === '') return null;
  const parsed = parseInt(val.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
