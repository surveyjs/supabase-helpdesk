import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CreateCustomProviderParams, CustomOAuthProvider } from '@supabase/supabase-js';
import {
  EXTERNAL_CLIENT_ID,
  EXTERNAL_CLIENT_ID_PREV,
  EXTERNAL_CLIENT_SECRET,
  EXTERNAL_CLIENT_SECRET_PREV,
  snapshotPreviousCredentials,
  syncExternalProvider,
  type CredentialVault,
  type CustomProvidersApi,
  type ExternalProviderStatus,
} from '@/lib/auth/external-provider-sync';
import {
  EXTERNAL_PROVIDER_ID,
  buildCustomProviderParams,
  resolveExternalProvider,
} from '@/lib/auth/external-provider';

// The swap-or-restore logic behind the registerExternalProvider() server action,
// exercised against a mocked `auth.admin.customProviders` API.

const surveyjsParams = buildCustomProviderParams(
  resolveExternalProvider({
    preset: 'surveyjs', provider_name: '', issuer_url: '',
    authorization_url: '', token_url: '', userinfo_url: '', scopes: '',
  }),
  { clientId: 'new-id', clientSecret: 'new-secret' },
);

function provider(overrides: Partial<CustomOAuthProvider> = {}): CustomOAuthProvider {
  return {
    id: 'p1',
    provider_type: 'oauth2',
    identifier: EXTERNAL_PROVIDER_ID,
    name: 'SurveyJS',
    client_id: 'old-id',
    scopes: ['openid'],
    pkce_enabled: true,
    enabled: true,
    email_optional: false,
    authorization_url: 'https://auth.surveyjs.io/OAuth/Authorize',
    token_url: 'https://auth.surveyjs.io/OAuth/Token',
    userinfo_url: 'https://auth.surveyjs.io/OAuth/UserInfo',
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

const oidcPrevious = provider({
  provider_type: 'oidc',
  name: 'Corp SSO',
  issuer: 'https://idp.example.com',
  authorization_url: undefined,
  token_url: undefined,
  userinfo_url: undefined,
});

const ok = <T>(data: T) => ({ data, error: null });
const fail = (message: string, status = 400) => ({
  data: null,
  error: { message, status, code: status === 404 ? 'custom_provider_not_found' : 'validation_failed' },
});
const notFound = () => fail('Custom OAuth provider not found', 404);

type Mocked = {
  getProvider: ReturnType<typeof vi.fn>;
  createProvider: ReturnType<typeof vi.fn>;
  updateProvider: ReturnType<typeof vi.fn>;
  deleteProvider: ReturnType<typeof vi.fn>;
};

let api: Mocked;
let statuses: ExternalProviderStatus[];
let clearPreviousCredentials: ReturnType<typeof vi.fn<() => Promise<void>>>;

function run(params: CreateCustomProviderParams = surveyjsParams) {
  return syncExternalProvider(
    {
      api: api as unknown as CustomProvidersApi,
      saveStatus: async (s) => { statuses.push(s); },
      clearPreviousCredentials,
    },
    params,
    { clientId: 'old-id', clientSecret: 'old-secret' },
  );
}

beforeEach(() => {
  api = {
    getProvider: vi.fn(),
    createProvider: vi.fn(),
    updateProvider: vi.fn(),
    deleteProvider: vi.fn(),
  };
  statuses = [];
  clearPreviousCredentials = vi.fn(async () => {});
});

describe('syncExternalProvider', () => {
  it('update path failure leaves the previous provider untouched and records the error', async () => {
    const previous = provider();
    api.getProvider.mockResolvedValue(ok(previous));
    api.updateProvider.mockResolvedValue(fail('token_url must use HTTPS'));

    const result = await run();

    expect(result.error).toMatch(/token_url must use HTTPS/);
    expect(api.updateProvider).toHaveBeenCalledWith(
      EXTERNAL_PROVIDER_ID,
      expect.not.objectContaining({ provider_type: expect.anything() }),
    );
    expect(api.deleteProvider).not.toHaveBeenCalled();
    expect(api.createProvider).not.toHaveBeenCalled();
    // Previous provider still exists and is enabled → registered unchanged ('true').
    expect(statuses).toEqual([{ registered: true, lastError: result.error }]);
    expect(clearPreviousCredentials).not.toHaveBeenCalled();
  });

  it('type change: create fails → previous provider restored, registered stays true', async () => {
    api.getProvider.mockResolvedValue(ok(oidcPrevious));
    api.deleteProvider.mockResolvedValue({ data: null, error: null });
    api.createProvider
      .mockResolvedValueOnce(fail('Invalid token_url'))
      .mockResolvedValueOnce(ok(oidcPrevious));

    const result = await run();

    expect(api.deleteProvider).toHaveBeenCalledWith(EXTERNAL_PROVIDER_ID);
    expect(api.createProvider).toHaveBeenCalledTimes(2);
    expect(api.createProvider.mock.calls[0][0]).toEqual(surveyjsParams);
    const restoreParams = api.createProvider.mock.calls[1][0] as CreateCustomProviderParams;
    expect(restoreParams).toMatchObject({
      provider_type: 'oidc',
      identifier: EXTERNAL_PROVIDER_ID,
      name: 'Corp SSO',
      issuer: 'https://idp.example.com',
      client_id: 'old-id',
      client_secret: 'old-secret',
    });
    expect(result.error).toMatch(/Invalid token_url/);
    expect(result.error).toMatch(/previous configuration is still active/);
    expect(statuses.at(-1)?.registered).toBe(true);
    expect(clearPreviousCredentials).not.toHaveBeenCalled();
  });

  it('type change: create fails and restore fails → registered false', async () => {
    api.getProvider
      .mockResolvedValueOnce(ok(oidcPrevious))
      .mockResolvedValue(notFound());
    api.deleteProvider.mockResolvedValue({ data: null, error: null });
    api.createProvider
      .mockResolvedValueOnce(fail('Invalid token_url'))
      .mockResolvedValueOnce(fail('Discovery document unreachable'));

    const result = await run();

    expect(api.createProvider).toHaveBeenCalledTimes(2);
    expect(result.error).toMatch(/Invalid token_url/);
    expect(result.error).toMatch(/Restoring the previous configuration also failed/);
    expect(statuses).toEqual([{ registered: false, lastError: result.error }]);
  });

  it('first registration creates the provider; success clears last_error and _prev snapshots', async () => {
    api.getProvider.mockResolvedValue(notFound());
    api.createProvider.mockResolvedValue(ok(provider()));

    const result = await run();

    expect(result).toEqual({});
    expect(api.deleteProvider).not.toHaveBeenCalled();
    expect(api.createProvider).toHaveBeenCalledWith(surveyjsParams);
    expect(statuses).toEqual([{ registered: true, lastError: '' }]);
    expect(clearPreviousCredentials).toHaveBeenCalledTimes(1);
  });

  it('same type → in-place update; success clears last_error and _prev snapshots', async () => {
    api.getProvider.mockResolvedValue(ok(provider()));
    api.updateProvider.mockResolvedValue(ok(provider()));

    const result = await run();

    expect(result).toEqual({});
    expect(api.updateProvider).toHaveBeenCalledTimes(1);
    const [, update] = api.updateProvider.mock.calls[0];
    expect(update).not.toHaveProperty('identifier');
    expect(update).toMatchObject({ client_id: 'new-id', client_secret: 'new-secret' });
    expect(statuses).toEqual([{ registered: true, lastError: '' }]);
    expect(clearPreviousCredentials).toHaveBeenCalledTimes(1);
  });

  it('admin API outage while verifying leaves the registered flag unchanged', async () => {
    const unavailable = () => fail('Service Unavailable', 503);
    api.getProvider.mockResolvedValue(unavailable());

    const result = await run();

    expect(result.error).toMatch(/Service Unavailable/);
    expect(api.createProvider).not.toHaveBeenCalled();
    expect(api.deleteProvider).not.toHaveBeenCalled();
    // Unknown state → null, which the caller must not persist as 'false'.
    expect(statuses).toEqual([{ registered: null, lastError: result.error }]);
  });

  it('update failure followed by an outage keeps the flag instead of clearing it', async () => {
    api.getProvider
      .mockResolvedValueOnce(ok(provider()))
      .mockResolvedValue(fail('Service Unavailable', 503));
    api.updateProvider.mockResolvedValue(fail('Bad Gateway', 502));

    const result = await run();

    expect(result.error).toMatch(/Bad Gateway/);
    expect(statuses).toEqual([{ registered: null, lastError: result.error }]);
  });

  it('a registered but disabled provider clears the flag', async () => {
    api.getProvider
      .mockResolvedValueOnce(ok(provider()))
      .mockResolvedValue(ok(provider({ enabled: false })));
    api.updateProvider.mockResolvedValue(fail('Invalid token_url'));

    await run();

    expect(statuses).toEqual([{ registered: false, lastError: expect.stringMatching(/Invalid token_url/) }]);
  });

  it('a backup that cannot be removed after success is reported', async () => {
    api.getProvider.mockResolvedValue(ok(provider()));
    api.updateProvider.mockResolvedValue(ok(provider()));
    clearPreviousCredentials.mockRejectedValue(new Error('Vault delete failed'));

    const result = await run();

    expect(result.error).toMatch(/credential backup could not be removed: Vault delete failed/);
    expect(statuses).toEqual([{ registered: true, lastError: result.error }]);
  });

  it('first registration failure → registered false', async () => {
    api.getProvider.mockResolvedValue(notFound());
    api.createProvider.mockResolvedValue(fail('URL must use HTTPS'));

    const result = await run();

    expect(result.error).toMatch(/URL must use HTTPS/);
    expect(api.createProvider).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual([{ registered: false, lastError: result.error }]);
  });
});

describe('snapshotPreviousCredentials', () => {
  type Failure = { op: 'read' | 'write' | 'remove'; name: string };

  function memoryVault(initial: Record<string, string>, failures: Failure[] = [], corruptWrites = false) {
    const store = new Map(Object.entries(initial));
    const check = (op: Failure['op'], name: string) => {
      if (failures.some((f) => f.op === op && f.name === name)) throw new Error(`${op} ${name} failed`);
    };
    const vault: CredentialVault = {
      read: async (name) => { check('read', name); return store.get(name) ?? ''; },
      write: async (name, value) => { check('write', name); store.set(name, corruptWrites ? `${value}-x` : value); },
      remove: async (name) => { check('remove', name); store.delete(name); },
    };
    return { vault, store };
  }

  const current = {
    [EXTERNAL_CLIENT_ID]: 'old-id',
    [EXTERNAL_CLIENT_SECRET]: 'old-secret',
  };

  it('backs up the current credentials', async () => {
    const { vault, store } = memoryVault(current);

    expect(await snapshotPreviousCredentials(vault)).toEqual({});
    expect(store.get(EXTERNAL_CLIENT_ID_PREV)).toBe('old-id');
    expect(store.get(EXTERNAL_CLIENT_SECRET_PREV)).toBe('old-secret');
  });

  it('keeps a complete existing backup (it belongs to the still-active provider)', async () => {
    const { vault, store } = memoryVault({
      ...current,
      [EXTERNAL_CLIENT_ID_PREV]: 'active-id',
      [EXTERNAL_CLIENT_SECRET_PREV]: 'active-secret',
    });

    expect(await snapshotPreviousCredentials(vault)).toEqual({});
    expect(store.get(EXTERNAL_CLIENT_ID_PREV)).toBe('active-id');
    expect(store.get(EXTERNAL_CLIENT_SECRET_PREV)).toBe('active-secret');
  });

  it('replaces a partial backup instead of trusting it', async () => {
    const { vault, store } = memoryVault({ ...current, [EXTERNAL_CLIENT_ID_PREV]: 'stale-id' });

    expect(await snapshotPreviousCredentials(vault)).toEqual({});
    expect(store.get(EXTERNAL_CLIENT_ID_PREV)).toBe('old-id');
    expect(store.get(EXTERNAL_CLIENT_SECRET_PREV)).toBe('old-secret');
  });

  it('a failed secret backup aborts and leaves no partial backup', async () => {
    const { vault, store } = memoryVault(current, [{ op: 'write', name: EXTERNAL_CLIENT_SECRET_PREV }]);

    const result = await snapshotPreviousCredentials(vault);

    expect(result.error).toMatch(/Could not back up the current credentials.*write auth_external_client_secret_prev failed/);
    expect(store.has(EXTERNAL_CLIENT_ID_PREV)).toBe(false);
    expect(store.has(EXTERNAL_CLIENT_SECRET_PREV)).toBe(false);
    // The current credentials are untouched.
    expect(store.get(EXTERNAL_CLIENT_ID)).toBe('old-id');
  });

  it('a backup that does not read back identically aborts', async () => {
    const { vault, store } = memoryVault(current, [], true);

    const result = await snapshotPreviousCredentials(vault);

    expect(result.error).toMatch(/does not match/);
    expect(store.has(EXTERNAL_CLIENT_ID_PREV)).toBe(false);
  });

  it('a failed read aborts rather than being treated as "no credentials"', async () => {
    const { vault } = memoryVault(current, [{ op: 'read', name: EXTERNAL_CLIENT_SECRET }]);

    expect((await snapshotPreviousCredentials(vault)).error).toMatch(/read auth_external_client_secret failed/);
  });

  it('nothing to back up when there are no current credentials', async () => {
    const { vault, store } = memoryVault({});

    expect(await snapshotPreviousCredentials(vault)).toEqual({});
    expect(store.size).toBe(0);
  });
});
