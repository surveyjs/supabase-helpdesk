'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServerClient, createServiceRoleClient } from '@/lib/supabase/server';
import {
  EXTERNAL_PROVIDER_ID,
  buildCustomProviderParams,
  resolveExternalProvider,
  validateExternalProvider,
  type ExternalProviderSettings,
  type ResolvedExternalProvider,
} from '@/lib/auth/external-provider';
import {
  EXTERNAL_CLIENT_ID,
  EXTERNAL_CLIENT_ID_PREV,
  EXTERNAL_CLIENT_SECRET,
  EXTERNAL_CLIENT_SECRET_PREV,
  snapshotPreviousCredentials,
  syncExternalProvider,
  type CredentialVault,
  type Credentials,
} from '@/lib/auth/external-provider-sync';

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
  auth_external_preset: string;
  auth_external_provider_name: string;
  auth_external_issuer_url: string;
  auth_external_authorization_url: string;
  auth_external_token_url: string;
  auth_external_userinfo_url: string;
  auth_external_scopes: string;
  auth_external_auto_redirect: string;
  auth_external_registered: string;
  auth_external_last_error: string;
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
    auth_external_preset: map.auth_external_preset || 'surveyjs',
    auth_external_provider_name: map.auth_external_provider_name || '',
    auth_external_issuer_url: map.auth_external_issuer_url || '',
    auth_external_authorization_url: map.auth_external_authorization_url || '',
    auth_external_token_url: map.auth_external_token_url || '',
    auth_external_userinfo_url: map.auth_external_userinfo_url || '',
    auth_external_scopes: map.auth_external_scopes || 'openid email profile',
    auth_external_auto_redirect: map.auth_external_auto_redirect || 'false',
    auth_external_registered: map.auth_external_registered || 'false',
    auth_external_last_error: map.auth_external_last_error || '',
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
  /** True while an enabled `custom:external` provider exists in Supabase Auth. */
  externalRegistered: boolean;
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
    'auth_external_registered',
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
    externalRegistered: map.auth_external_registered === 'true',
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

  // An unregistered provider would lock every user out of the login page.
  if (mode === 'external') {
    const { data: registered } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'auth_external_registered')
      .single();
    if (registered?.value !== 'true') {
      return { error: 'Configure and register the external provider before switching to External mode.' };
    }
  }

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

  const enabled = formData.get('enabled') === 'on';
  const clientId = (formData.get('client_id') as string ?? '').trim();
  const clientSecret = (formData.get('client_secret') as string ?? '').trim();

  // Provider-specific fields
  const tenantId = (formData.get('tenant_id') as string ?? '').trim();
  const instanceUrl = (formData.get('instance_url') as string ?? '').trim();

  const svc = createServiceRoleClient();

  // Validate: if enabling, both client_id and client_secret must exist
  // either in the submitted form or already stored in Vault.
  if (enabled) {
    const hasClientId = !!clientId || !!(await svc.rpc('has_oauth_secret', { secret_name: `auth_${provider}_client_id` })).data;
    const hasClientSecret = !!clientSecret || !!(await svc.rpc('has_oauth_secret', { secret_name: `auth_${provider}_client_secret` })).data;

    if (!hasClientId || !hasClientSecret) {
      return { error: 'Client ID and Client Secret are required when enabling a provider.' };
    }
  }

  // Store credentials in Vault if provided
  if (clientId) {
    const { error: idErr } = await svc.rpc('store_oauth_secret', {
      secret_name: `auth_${provider}_client_id`,
      secret_value: clientId,
      secret_description: `${provider} OAuth client ID`,
    });
    if (idErr) return { error: `Failed to store Client ID: ${idErr.message}` };
  }
  if (clientSecret) {
    const { error: secretErr } = await svc.rpc('store_oauth_secret', {
      secret_name: `auth_${provider}_client_secret`,
      secret_value: clientSecret,
      secret_description: `${provider} OAuth client secret`,
    });
    if (secretErr) return { error: `Failed to store Client Secret: ${secretErr.message}` };
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
// 5. External Provider (Supabase Auth custom provider)
// ============================================================

const EXTERNAL_SETTING_KEYS = [
  'auth_external_preset',
  'auth_external_provider_name',
  'auth_external_issuer_url',
  'auth_external_authorization_url',
  'auth_external_token_url',
  'auth_external_userinfo_url',
  'auth_external_scopes',
] as const;

type ServiceRoleClient = ReturnType<typeof createServiceRoleClient>;

async function readExternalSettings(svc: ServiceRoleClient): Promise<ExternalProviderSettings> {
  const { data } = await svc
    .from('app_settings')
    .select('key, value')
    .in('key', EXTERNAL_SETTING_KEYS as unknown as string[]);
  const map: Record<string, string> = {};
  for (const row of data ?? []) map[row.key] = row.value ?? '';
  return {
    preset: map.auth_external_preset || 'surveyjs',
    provider_name: map.auth_external_provider_name ?? '',
    issuer_url: map.auth_external_issuer_url ?? '',
    authorization_url: map.auth_external_authorization_url ?? '',
    token_url: map.auth_external_token_url ?? '',
    userinfo_url: map.auth_external_userinfo_url ?? '',
    scopes: map.auth_external_scopes ?? '',
  };
}

/** Vault access that throws on RPC errors, so a failed read is never mistaken for "absent". */
function credentialVault(svc: ServiceRoleClient): CredentialVault {
  return {
    read: async (name) => {
      const { data, error } = await svc.rpc('get_oauth_secret', { secret_name: name });
      if (error) throw new Error(`Vault read of ${name} failed: ${error.message}`);
      return typeof data === 'string' ? data : '';
    },
    write: async (name, value, description) => {
      const { error } = await svc.rpc('store_oauth_secret', {
        secret_name: name,
        secret_value: value,
        secret_description: description,
      });
      if (error) throw new Error(`Vault write of ${name} failed: ${error.message}`);
    },
    remove: async (name) => {
      const { error } = await svc.rpc('delete_oauth_secret', { secret_name: name });
      if (error) throw new Error(`Vault delete of ${name} failed: ${error.message}`);
    },
  };
}

async function readCredentials(vault: CredentialVault, idName: string, secretName: string): Promise<Credentials | null> {
  const clientId = await vault.read(idName);
  const clientSecret = await vault.read(secretName);
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

async function setSetting(svc: ServiceRoleClient, key: string, value: string) {
  await svc.from('app_settings').update({ value }).eq('key', key);
}

/**
 * Syncs the saved settings + Vault credentials to Supabase Auth.
 * Shared by `updateExternalProvider` and the explicit `registerExternalProvider` action.
 */
async function syncSavedExternalProvider(): Promise<{ error?: string; resolved: ResolvedExternalProvider }> {
  const svc = createServiceRoleClient();
  const vault = credentialVault(svc);
  const resolved = resolveExternalProvider(await readExternalSettings(svc));

  let creds: Credentials | null;
  let previousCreds: Credentials | null;
  try {
    creds = await readCredentials(vault, EXTERNAL_CLIENT_ID, EXTERNAL_CLIENT_SECRET);
    // Credentials the registered provider was created with, for the restore path.
    // Without a backup, the current credentials have not changed since the last
    // successful registration (every overwrite is preceded by a verified backup).
    previousCreds = (await readCredentials(vault, EXTERNAL_CLIENT_ID_PREV, EXTERNAL_CLIENT_SECRET_PREV)) ?? creds;
  } catch (err) {
    // Touching Supabase Auth without a trustworthy restore point could break a working provider.
    const message = err instanceof Error ? err.message : String(err);
    await setSetting(svc, 'auth_external_last_error', message);
    return { error: message, resolved };
  }

  const validationError = validateExternalProvider(resolved, !!creds);
  if (validationError || !creds) {
    const message = validationError ?? 'Client ID and Client Secret are required to register the provider.';
    await setSetting(svc, 'auth_external_last_error', message);
    return { error: message, resolved };
  }

  const result = await syncExternalProvider(
    {
      api: svc.auth.admin.customProviders,
      saveStatus: async ({ registered, lastError }) => {
        if (registered !== null) {
          await setSetting(svc, 'auth_external_registered', registered ? 'true' : 'false');
        }
        await setSetting(svc, 'auth_external_last_error', lastError);
      },
      clearPreviousCredentials: async () => {
        await vault.remove(EXTERNAL_CLIENT_ID_PREV);
        await vault.remove(EXTERNAL_CLIENT_SECRET_PREV);
      },
    },
    buildCustomProviderParams(resolved, creds),
    previousCreds,
  );
  return { ...result, resolved };
}

function revalidateAuthPages() {
  revalidatePath('/admin/auth');
  revalidatePath('/login');
  revalidatePath('/signup');
}

export async function updateExternalProvider(formData: FormData): Promise<{ error?: string }> {
  const { supabase, profile } = await requireAdminProfile();

  const field = (name: string) => ((formData.get(name) as string | null) ?? '').trim();
  const clientId = field('client_id');
  const clientSecret = field('client_secret');
  const autoRedirect = formData.get('auto_redirect') === 'on';

  // For the SurveyJS preset the submitted endpoint fields are ignored.
  const resolved = resolveExternalProvider({
    preset: field('preset'),
    provider_name: field('provider_name'),
    issuer_url: field('issuer_url'),
    authorization_url: field('authorization_url'),
    token_url: field('token_url'),
    userinfo_url: field('userinfo_url'),
    scopes: field('scopes'),
  });

  const svc = createServiceRoleClient();

  const hasStored = async (name: string) =>
    !!(await svc.rpc('has_oauth_secret', { secret_name: name })).data;
  const hasCreds =
    (!!clientId || (await hasStored(EXTERNAL_CLIENT_ID))) &&
    (!!clientSecret || (await hasStored(EXTERNAL_CLIENT_SECRET)));

  const validationError = validateExternalProvider(
    { ...resolved, preset: field('preset') || 'surveyjs' },
    hasCreds,
  );
  if (validationError) return { error: validationError };

  // Back up the registered provider's credentials before overwriting them, so
  // a failed registration can restore it. Nothing is changed if that fails.
  if (clientId || clientSecret) {
    const { error: backupError } = await snapshotPreviousCredentials(credentialVault(svc));
    if (backupError) return { error: backupError };
  }

  if (clientId) {
    const { error: idErr } = await svc.rpc('store_oauth_secret', {
      secret_name: EXTERNAL_CLIENT_ID,
      secret_value: clientId,
      secret_description: 'External provider client ID',
    });
    if (idErr) return { error: `Failed to store Client ID: ${idErr.message}` };
  }
  if (clientSecret) {
    const { error: secretErr } = await svc.rpc('store_oauth_secret', {
      secret_name: EXTERNAL_CLIENT_SECRET,
      secret_value: clientSecret,
      secret_description: 'External provider client secret',
    });
    if (secretErr) return { error: `Failed to store Client Secret: ${secretErr.message}` };
  }

  const settingsToUpdate: Record<string, string> = {
    auth_external_preset: resolved.preset,
    auth_external_provider_name: resolved.provider_name,
    auth_external_issuer_url: resolved.issuer_url,
    auth_external_authorization_url: resolved.authorization_url,
    auth_external_token_url: resolved.token_url,
    auth_external_userinfo_url: resolved.userinfo_url,
    auth_external_scopes: resolved.scopes,
    auth_external_auto_redirect: autoRedirect ? 'true' : 'false',
  };
  for (const [key, value] of Object.entries(settingsToUpdate)) {
    await supabase.from('app_settings').update({ value }).eq('key', key);
  }

  const result = await syncSavedExternalProvider();

  await supabase.from('admin_audit_log').insert({
    admin_id: profile.id,
    action: 'external_provider_updated',
    target_type: 'app_settings',
    target_id: EXTERNAL_PROVIDER_ID,
    details: {
      preset: resolved.preset,
      provider_type: resolved.provider_type,
      provider_name: resolved.provider_name,
      registered: !result.error,
    },
  });

  revalidateAuthPages();
  return result.error ? { error: result.error } : {};
}

/**
 * Re-registers the saved external provider with Supabase Auth without changing
 * any setting — the retry path after a transient failure.
 */
export async function registerExternalProvider(): Promise<{ error?: string }> {
  const { supabase, profile } = await requireAdminProfile();

  const result = await syncSavedExternalProvider();

  await supabase.from('admin_audit_log').insert({
    admin_id: profile.id,
    action: 'external_provider_registered',
    target_type: 'app_settings',
    target_id: EXTERNAL_PROVIDER_ID,
    details: {
      preset: result.resolved.preset,
      provider_type: result.resolved.provider_type,
      registered: !result.error,
      ...(result.error ? { error: result.error } : {}),
    },
  });

  revalidateAuthPages();
  return result.error ? { error: result.error } : {};
}

// ============================================================
// 6. Test Auth Connection
// ============================================================

export async function testAuthConnection(formData: FormData): Promise<{ success: boolean; error?: string; details?: string }> {
  try {
    await requireAdminProfile();

    const provider = formData.get('provider') as string;

    if (provider === 'external') {
      const svc = createServiceRoleClient();
      const resolved = resolveExternalProvider(await readExternalSettings(svc));
      const details: string[] = [];

      if (resolved.provider_type === 'oauth2') {
        if (!resolved.authorization_url || !resolved.userinfo_url) {
          return { success: false, error: 'OAuth 2.0 endpoints are not configured.' };
        }
        // Any HTTP response means reachable — the endpoint needs params, so 4xx is expected.
        try {
          await fetch(resolved.authorization_url, { signal: AbortSignal.timeout(10000), redirect: 'manual' });
        } catch (err) {
          return { success: false, error: `Authorization endpoint unreachable: ${err instanceof Error ? err.message : String(err)}` };
        }
        let userinfoStatus: number;
        try {
          const res = await fetch(resolved.userinfo_url, { signal: AbortSignal.timeout(10000), redirect: 'manual' });
          userinfoStatus = res.status;
        } catch (err) {
          return { success: false, error: `UserInfo endpoint unreachable: ${err instanceof Error ? err.message : String(err)}` };
        }
        if (userinfoStatus !== 401 && userinfoStatus !== 403) {
          return {
            success: false,
            error: `UserInfo endpoint should reject anonymous requests (401/403) but returned HTTP ${userinfoStatus}.`,
          };
        }
        details.push(`Endpoints reachable (${new URL(resolved.authorization_url).host})`);
      } else {
        if (!resolved.issuer_url) {
          return { success: false, error: 'Issuer URL is not configured.' };
        }
        const wellKnownUrl = resolved.issuer_url.replace(/\/+$/, '') + '/.well-known/openid-configuration';
        const response = await fetch(wellKnownUrl, { signal: AbortSignal.timeout(10000) });
        if (!response.ok) {
          return { success: false, error: `OIDC discovery failed: HTTP ${response.status}` };
        }
        const config = await response.json();
        if (!config.authorization_endpoint || !config.token_endpoint) {
          return { success: false, error: 'Invalid OIDC configuration: missing required endpoints.' };
        }
        details.push(`Issuer: ${config.issuer ?? resolved.issuer_url}`);
      }

      const { data: registered, error: regError } = await svc.auth.admin.customProviders.getProvider(EXTERNAL_PROVIDER_ID);
      if (regError || !registered) {
        return {
          success: false,
          error: `Provider is not registered with Supabase Auth${regError ? `: ${regError.message}` : '.'}`,
        };
      }
      if (!registered.enabled) {
        return { success: false, error: `Provider ${registered.identifier} is registered but disabled in Supabase Auth.` };
      }
      details.push(`Supabase Auth: ${registered.identifier} (${registered.provider_type}, enabled)`);

      return { success: true, details: details.join(' · ') };
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

/**
 * The URI to register at the identity provider. Supabase Auth receives the
 * provider's redirect there and then forwards to the app's `/auth/callback`.
 */
export async function getRedirectUri(): Promise<string> {
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321').replace(/\/+$/, '');
  return `${supabaseUrl}/auth/v1/callback`;
}
