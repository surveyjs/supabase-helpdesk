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

// Per-row tier CRUD actions removed in favour of bulk `saveTiers` in admin.ts.

export async function assignTier(formData: FormData): Promise<void> {
  const { supabase, profile } = await requireAdminRole();

  const userId = formData.get('user_id') as string;
  const tierId = formData.get('tier_id') as string;
  const expiresAt = (formData.get('expires_at') as string)?.trim() || null;

  if (!userId) return;

  // Use service-role client for profile updates (RLS prevents admins from
  // updating other users' tier_id/tier_expires_at via user-scoped client)
  const svc = createServiceRoleClient();

  if (!tierId || tierId === 'none') {
    // Remove tier
    const { error } = await svc
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

    const { error } = await svc
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
