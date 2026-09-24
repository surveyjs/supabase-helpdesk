import type {
  AuthError,
  CreateCustomProviderParams,
  CustomOAuthProvider,
  GoTrueAdminCustomProvidersApi,
} from '@supabase/supabase-js';
import { EXTERNAL_PROVIDER_ID } from './external-provider';

export type CustomProvidersApi = Pick<
  GoTrueAdminCustomProvidersApi,
  'getProvider' | 'createProvider' | 'updateProvider' | 'deleteProvider'
>;

/**
 * `registered: null` means Supabase Auth's state could not be determined (e.g.
 * the admin API is down) — the stored flag must be left as it is, because
 * clearing it would lock users out after Supabase recovers.
 */
export type ExternalProviderStatus = { registered: boolean | null; lastError: string };

export type SyncExternalProviderDeps = {
  api: CustomProvidersApi;
  /** Persists `auth_external_registered` (unless null) / `auth_external_last_error`. */
  saveStatus: (status: ExternalProviderStatus) => Promise<void>;
  /** Deletes the `auth_external_client_*_prev` Vault snapshots; throws on failure. */
  clearPreviousCredentials: () => Promise<void>;
};

export type Credentials = { clientId: string; clientSecret: string };

export const EXTERNAL_CLIENT_ID = 'auth_external_client_id';
export const EXTERNAL_CLIENT_SECRET = 'auth_external_client_secret';
export const EXTERNAL_CLIENT_ID_PREV = 'auth_external_client_id_prev';
export const EXTERNAL_CLIENT_SECRET_PREV = 'auth_external_client_secret_prev';

/** Vault access for the external-provider credentials. Every method throws on failure. */
export type CredentialVault = {
  /** Returns '' when the secret does not exist. */
  read: (name: string) => Promise<string>;
  write: (name: string, value: string, description: string) => Promise<void>;
  remove: (name: string) => Promise<void>;
};

/**
 * Backs up the credentials of the currently-registered provider before they
 * are overwritten, so a failed registration can restore that provider.
 *
 * A complete existing snapshot is kept: after an earlier failed attempt it
 * still belongs to the provider that is active. A partial snapshot is useless
 * for a restore and is replaced. The new snapshot is read back and verified;
 * on any failure it is removed and an error is returned, and the caller must
 * not overwrite the current credentials.
 */
export async function snapshotPreviousCredentials(vault: CredentialVault): Promise<{ error?: string }> {
  try {
    const prevId = await vault.read(EXTERNAL_CLIENT_ID_PREV);
    const prevSecret = await vault.read(EXTERNAL_CLIENT_SECRET_PREV);
    if (prevId && prevSecret) return {};

    const clientId = await vault.read(EXTERNAL_CLIENT_ID);
    const clientSecret = await vault.read(EXTERNAL_CLIENT_SECRET);
    if (prevId || prevSecret) {
      await vault.remove(EXTERNAL_CLIENT_ID_PREV);
      await vault.remove(EXTERNAL_CLIENT_SECRET_PREV);
    }
    // Incomplete current credentials cannot back a working provider: nothing to preserve.
    if (!clientId || !clientSecret) return {};

    await vault.write(EXTERNAL_CLIENT_ID_PREV, clientId, 'External provider client ID (previous, for restore)');
    await vault.write(EXTERNAL_CLIENT_SECRET_PREV, clientSecret, 'External provider client secret (previous, for restore)');
    const storedId = await vault.read(EXTERNAL_CLIENT_ID_PREV);
    const storedSecret = await vault.read(EXTERNAL_CLIENT_SECRET_PREV);
    if (storedId !== clientId || storedSecret !== clientSecret) {
      throw new Error('the stored backup does not match the current credentials');
    }
    return {};
  } catch (err) {
    try {
      await vault.remove(EXTERNAL_CLIENT_ID_PREV);
      await vault.remove(EXTERNAL_CLIENT_SECRET_PREV);
    } catch {
      // Best effort — the error below already stops the save.
    }
    const reason = err instanceof Error ? err.message : String(err);
    return { error: `Could not back up the current credentials, so nothing was changed: ${reason}` };
  }
}

function isNotFound(error: AuthError | null): boolean {
  return !!error && (error.status === 404 || error.code === 'custom_provider_not_found');
}

/** Rebuilds create params from a provider returned by the admin API (the secret is never returned). */
export function providerToCreateParams(
  provider: CustomOAuthProvider,
  creds: Credentials,
): CreateCustomProviderParams {
  const params: CreateCustomProviderParams = {
    provider_type: provider.provider_type,
    identifier: provider.identifier,
    name: provider.name,
    client_id: creds.clientId || provider.client_id,
    client_secret: creds.clientSecret,
  };
  const optional = [
    'acceptable_client_ids', 'scopes', 'pkce_enabled', 'attribute_mapping', 'authorization_params',
    'enabled', 'email_optional', 'issuer', 'discovery_url', 'skip_nonce_check',
    'authorization_url', 'token_url', 'userinfo_url', 'jwks_uri',
  ] as const;
  for (const key of optional) {
    const value = provider[key];
    if (value !== undefined && value !== null) {
      (params as Record<string, unknown>)[key] = value;
    }
  }
  return params;
}

/**
 * Registers `params` as the `custom:external` provider in Supabase Auth without
 * ever leaving the app with a broken provider:
 *
 * - same provider type → in-place update (a failed update leaves the old one untouched);
 * - different type / no provider → delete + create, restoring the previous
 *   provider (with `previousCreds`) when the create fails.
 *
 * `registered` reflects what Supabase Auth reports after the attempt; when
 * its state cannot be read, the stored flag is left unchanged.
 */
export async function syncExternalProvider(
  deps: SyncExternalProviderDeps,
  params: CreateCustomProviderParams,
  previousCreds: Credentials | null,
): Promise<{ error?: string }> {
  const { api } = deps;

  const fail = async (message: string): Promise<{ error: string }> => {
    const { data: current, error } = await api.getProvider(EXTERNAL_PROVIDER_ID);
    // Only a confirmed absence or disablement clears the flag; an unknown state keeps it.
    const registered = current ? !!current.enabled : isNotFound(error) ? false : null;
    await deps.saveStatus({ registered, lastError: message });
    return { error: message };
  };

  const succeed = async (): Promise<{ error?: string }> => {
    try {
      await deps.clearPreviousCredentials();
    } catch (err) {
      // A stale backup would later "restore" the wrong credentials — surface it.
      const reason = err instanceof Error ? err.message : String(err);
      const message = `Registered, but the credential backup could not be removed: ${reason}`;
      await deps.saveStatus({ registered: true, lastError: message });
      return { error: message };
    }
    await deps.saveStatus({ registered: true, lastError: '' });
    return {};
  };

  const { data: previous, error: getError } = await api.getProvider(EXTERNAL_PROVIDER_ID);
  if (getError && !isNotFound(getError)) {
    return fail(`Could not read the current provider from Supabase Auth: ${getError.message}`);
  }

  if (previous && previous.provider_type === params.provider_type) {
    // provider_type and identifier are immutable on update.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { provider_type, identifier, ...update } = params;
    const { error } = await api.updateProvider(EXTERNAL_PROVIDER_ID, update);
    if (error) {
      return fail(`Supabase Auth rejected the provider: ${error.message}`);
    }
    return succeed();
  }

  if (previous) {
    const { error } = await api.deleteProvider(EXTERNAL_PROVIDER_ID);
    if (error) {
      return fail(`Could not replace the existing provider: ${error.message}`);
    }
  }

  const { error: createError } = await api.createProvider(params);
  if (!createError) {
    return succeed();
  }

  const message = `Supabase Auth rejected the provider: ${createError.message}`;
  if (!previous) {
    return fail(message);
  }

  if (previousCreds?.clientSecret) {
    const { error: restoreError } = await api.createProvider(
      providerToCreateParams(previous, previousCreds),
    );
    if (!restoreError) {
      return fail(`${message} The previous configuration is still active.`);
    }
    return fail(`${message} Restoring the previous configuration also failed: ${restoreError.message}`);
  }

  return fail(`${message} The previous configuration could not be restored (its credentials are unavailable).`);
}
