'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServerClient, createServiceRoleClient } from '@/lib/supabase/server';

// ============================================================
// Helpers
// ============================================================

const SOCIAL_PROVIDERS = ['google', 'github', 'microsoft', 'gitlab'] as const;
type SocialProvider = typeof SOCIAL_PROVIDERS[number];

async function requireAdminProfile() {
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

// ============================================================
// 1. Get Auth Settings (for admin page)
// ============================================================

export type AuthConfigSettings = {
  auth_mode: string;
  // Social providers
  auth_google_enabled: string;
  auth_github_enabled: string;
  auth_microsoft_enabled: string;
  auth_microsoft_tenant_id: string;
  auth_gitlab_enabled: string;
  auth_gitlab_instance_url: string;
  // Social secrets present flags
  auth_google_client_id_present: boolean;
  auth_github_client_id_present: boolean;
  auth_microsoft_client_id_present: boolean;
  auth_gitlab_client_id_present: boolean;
  // External provider
  auth_external_provider_name: string;
  auth_external_issuer_url: string;
  auth_external_scopes: string;
  auth_external_auto_redirect: string;
  auth_external_client_id_present: boolean;
};

export async function getAuthConfigSettings(): Promise<AuthConfigSettings> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from('app_settings')
    .select('key, value')
    .like('key', 'auth_%');

  const map: Record<string, string> = {};
  for (const row of data ?? []) {
    map[row.key] = row.value;
  }

  // Check which providers have client IDs stored in Vault
  const svc = createServiceRoleClient();
  const providers = ['google', 'github', 'microsoft', 'gitlab', 'external'];
  const secretFlags: Record<string, boolean> = {};
  for (const p of providers) {
    const { data: hasSecret } = await svc.rpc('has_oauth_secret', { secret_name: `auth_${p}_client_id` });
    secretFlags[p] = !!hasSecret;
  }

  return {
    auth_mode: map.auth_mode || 'built-in',
    auth_google_enabled: map.auth_google_enabled || 'false',
    auth_github_enabled: map.auth_github_enabled || 'false',
    auth_microsoft_enabled: map.auth_microsoft_enabled || 'false',
    auth_microsoft_tenant_id: map.auth_microsoft_tenant_id || '',
    auth_gitlab_enabled: map.auth_gitlab_enabled || 'false',
    auth_gitlab_instance_url: map.auth_gitlab_instance_url || '',
    auth_google_client_id_present: secretFlags.google,
    auth_github_client_id_present: secretFlags.github,
    auth_microsoft_client_id_present: secretFlags.microsoft,
    auth_gitlab_client_id_present: secretFlags.gitlab,
    auth_external_provider_name: map.auth_external_provider_name || '',
    auth_external_issuer_url: map.auth_external_issuer_url || '',
    auth_external_scopes: map.auth_external_scopes || 'openid email profile',
    auth_external_auto_redirect: map.auth_external_auto_redirect || 'false',
    auth_external_client_id_present: secretFlags.external,
  };
}

// ============================================================
// 2. Get Auth Settings for Login/Signup (public, minimal)
// ============================================================

export type PublicAuthConfig = {
  authMode: 'built-in' | 'external';
  enabledSocialProviders: SocialProvider[];
  externalProviderName: string;
  autoRedirect: boolean;
};

export async function getPublicAuthConfig(): Promise<PublicAuthConfig> {
  // Use service role client because this is called from the login/signup pages
  // where the user is not yet authenticated (app_settings requires authenticated role)
  const svc = createServiceRoleClient();
  const keys = [
    'auth_mode',
    'auth_google_enabled', 'auth_github_enabled',
    'auth_microsoft_enabled', 'auth_gitlab_enabled',
    'auth_external_provider_name', 'auth_external_auto_redirect',
  ];
  const { data } = await svc
    .from('app_settings')
    .select('key, value')
    .in('key', keys);

  const map: Record<string, string> = {};
  for (const row of data ?? []) {
    map[row.key] = row.value;
  }

  const authMode = (map.auth_mode === 'external' ? 'external' : 'built-in') as 'built-in' | 'external';

  const enabledSocialProviders: SocialProvider[] = [];
  for (const p of SOCIAL_PROVIDERS) {
    if (map[`auth_${p}_enabled`] === 'true') {
      enabledSocialProviders.push(p);
    }
  }

  return {
    authMode,
    enabledSocialProviders,
    externalProviderName: map.auth_external_provider_name || '',
    autoRedirect: map.auth_external_auto_redirect === 'true',
  };
}

// ============================================================
// 3. Update Auth Mode
// ============================================================

export async function updateAuthMode(formData: FormData): Promise<{ error?: string }> {
  const { supabase, profile } = await requireAdminProfile();

  const mode = formData.get('mode') as string;
  if (mode !== 'built-in' && mode !== 'external') {
    return { error: 'Invalid auth mode.' };
  }

  // Get current mode for audit log
  const { data: current } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'auth_mode')
    .single();

  const from = current?.value || 'built-in';
  if (from === mode) return {}; // No change

  await supabase.from('app_settings').update({ value: mode }).eq('key', 'auth_mode');

  await supabase.from('admin_audit_log').insert({
    admin_id: profile.id,
    action: 'auth_mode_changed',
    target_type: 'app_settings',
    target_id: 'auth_mode',
    details: { from, to: mode },
  });

  revalidatePath('/admin/auth');
  revalidatePath('/login');
  revalidatePath('/signup');
  return {};
}

// ============================================================
// 4. Update Social Provider
// ============================================================

export async function updateSocialProvider(formData: FormData): Promise<{ error?: string }> {
  const { supabase, profile } = await requireAdminProfile();

  const provider = formData.get('provider') as string;
  if (!SOCIAL_PROVIDERS.includes(provider as SocialProvider)) {
    return { error: 'Invalid provider.' };
  }

  const enabled = formData.get('enabled') === 'true';
  const clientId = (formData.get('client_id') as string ?? '').trim();
  const clientSecret = (formData.get('client_secret') as string ?? '').trim();

  // Provider-specific fields
  const tenantId = (formData.get('tenant_id') as string ?? '').trim();
  const instanceUrl = (formData.get('instance_url') as string ?? '').trim();

  // Validate: if enabling, client_id and client_secret are required
  if (enabled && !clientId && !clientSecret) {
    // Check if credentials already exist in vault
    const svc = createServiceRoleClient();
    const { data: hasId } = await svc.rpc('has_oauth_secret', { secret_name: `auth_${provider}_client_id` });
    if (!hasId) {
      return { error: 'Client ID and Client Secret are required when enabling a provider.' };
    }
  }

  // Store credentials in Vault if provided
  const svc = createServiceRoleClient();
  if (clientId) {
    await svc.rpc('store_oauth_secret', {
      secret_name: `auth_${provider}_client_id`,
      secret_value: clientId,
      secret_description: `${provider} OAuth client ID`,
    });
  }
  if (clientSecret) {
    await svc.rpc('store_oauth_secret', {
      secret_name: `auth_${provider}_client_secret`,
      secret_value: clientSecret,
      secret_description: `${provider} OAuth client secret`,
    });
  }

  // Update settings
  await supabase.from('app_settings').update({ value: enabled ? 'true' : 'false' }).eq('key', `auth_${provider}_enabled`);

  if (provider === 'microsoft' && tenantId !== undefined) {
    await supabase.from('app_settings').update({ value: tenantId }).eq('key', 'auth_microsoft_tenant_id');
  }
  if (provider === 'gitlab' && instanceUrl !== undefined) {
    await supabase.from('app_settings').update({ value: instanceUrl }).eq('key', 'auth_gitlab_instance_url');
  }

  // Audit log
  await supabase.from('admin_audit_log').insert({
    admin_id: profile.id,
    action: 'social_provider_updated',
    target_type: 'app_settings',
    target_id: provider,
    details: { provider, enabled },
  });

  revalidatePath('/admin/auth');
  revalidatePath('/login');
  revalidatePath('/signup');
  return {};
}

// ============================================================
// 5. Update External Provider
// ============================================================

export async function updateExternalProvider(formData: FormData): Promise<{ error?: string }> {
  const { supabase, profile } = await requireAdminProfile();

  const providerName = (formData.get('provider_name') as string ?? '').trim();
  const clientId = (formData.get('client_id') as string ?? '').trim();
  const clientSecret = (formData.get('client_secret') as string ?? '').trim();
  const issuerUrl = (formData.get('issuer_url') as string ?? '').trim();
  const scopes = (formData.get('scopes') as string ?? '').trim() || 'openid email profile';
  const autoRedirect = formData.get('auto_redirect') === 'true';

  // Validate issuer URL if provided
  if (issuerUrl) {
    try {
      new URL(issuerUrl);
    } catch {
      return { error: 'Issuer URL is not a valid URL.' };
    }
  }

  // Store credentials in Vault if provided
  const svc = createServiceRoleClient();
  if (clientId) {
    await svc.rpc('store_oauth_secret', {
      secret_name: 'auth_external_client_id',
      secret_value: clientId,
      secret_description: 'External OIDC client ID',
    });
  }
  if (clientSecret) {
    await svc.rpc('store_oauth_secret', {
      secret_name: 'auth_external_client_secret',
      secret_value: clientSecret,
      secret_description: 'External OIDC client secret',
    });
  }

  // Update settings
  const settingsToUpdate: Record<string, string> = {
    auth_external_provider_name: providerName,
    auth_external_issuer_url: issuerUrl,
    auth_external_scopes: scopes,
    auth_external_auto_redirect: autoRedirect ? 'true' : 'false',
  };

  for (const [key, value] of Object.entries(settingsToUpdate)) {
    await supabase.from('app_settings').update({ value }).eq('key', key);
  }

  // Audit log
  await supabase.from('admin_audit_log').insert({
    admin_id: profile.id,
    action: 'external_provider_updated',
    target_type: 'app_settings',
    details: { provider_name: providerName, issuer_url: issuerUrl },
  });

  revalidatePath('/admin/auth');
  revalidatePath('/login');
  revalidatePath('/signup');
  return {};
}

// ============================================================
// 6. Test Auth Connection
// ============================================================

export async function testAuthConnection(formData: FormData): Promise<{ success: boolean; error?: string; details?: string }> {
  try {
    await requireAdminProfile();

    const provider = formData.get('provider') as string;

    if (provider === 'external') {
      // For external OIDC: fetch the well-known configuration
      const supabase = await createServerClient();
      const { data: issuerSetting } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'auth_external_issuer_url')
        .single();

      const issuerUrl = issuerSetting?.value;
      if (!issuerUrl) {
        return { success: false, error: 'Issuer URL is not configured.' };
      }

      const wellKnownUrl = issuerUrl.replace(/\/$/, '') + '/.well-known/openid-configuration';
      const response = await fetch(wellKnownUrl, { signal: AbortSignal.timeout(10000) });

      if (!response.ok) {
        return { success: false, error: `OIDC discovery failed: HTTP ${response.status}` };
      }

      const config = await response.json();
      if (!config.authorization_endpoint || !config.token_endpoint) {
        return { success: false, error: 'Invalid OIDC configuration: missing required endpoints.' };
      }

      return { success: true, details: `Issuer: ${config.issuer ?? issuerUrl}` };
    }

    // For social providers: check that credentials exist
    if (SOCIAL_PROVIDERS.includes(provider as SocialProvider)) {
      const svc = createServiceRoleClient();
      const { data: hasId } = await svc.rpc('has_oauth_secret', { secret_name: `auth_${provider}_client_id` });
      const { data: hasSecret } = await svc.rpc('has_oauth_secret', { secret_name: `auth_${provider}_client_secret` });

      if (!hasId || !hasSecret) {
        return { success: false, error: 'Client ID and/or Client Secret are not configured.' };
      }

      return { success: true, details: `Credentials configured for ${provider}.` };
    }

    return { success: false, error: 'Unknown provider.' };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Connection test failed.' };
  }
}

// ============================================================
// 7. Get Redirect URI
// ============================================================

export async function getRedirectUri(): Promise<string> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://127.0.0.1:3000';
  return `${appUrl}/auth/callback`;
}
