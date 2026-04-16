import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServiceRoleClient } from '../helpers/supabase';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const ADMIN_ID = '00000000-0000-0000-0000-000000001001';
const USER_ID = '00000000-0000-0000-0000-000000001002';

let svc: SupabaseClient;
const clients: Record<string, SupabaseClient> = {};

async function ensureAuthUser(
  admin: SupabaseClient,
  id: string,
  email: string,
  meta?: Record<string, string>,
) {
  const { error } = await admin.auth.admin.createUser({
    id,
    email,
    password: 'Password123',
    email_confirm: true,
    user_metadata: meta,
  });
  if (error && !error.message.includes('already been registered')) {
    throw new Error(`ensureAuthUser(${email}): ${error.message}`);
  }
}

async function clientForUser(email: string, password = 'Password123') {
  if (clients[email]) {
    const { error } = await clients[email].from('profiles').select('id').limit(1);
    if (error?.message?.includes('JWT')) {
      delete clients[email];
    } else {
      return clients[email];
    }
  }
  const c = createClient(supabaseUrl, anonKey);
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signIn(${email}): ${error.message}`);
  clients[email] = c;
  return c;
}

beforeAll(async () => {
  svc = createServiceRoleClient();

  await ensureAuthUser(svc, ADMIN_ID, 'authext-admin@test.local', { display_name: 'AuthExtAdmin' });
  await ensureAuthUser(svc, USER_ID, 'authext-user@test.local', { display_name: 'AuthExtUser' });

  await svc.from('profiles').update({ role: 'admin' }).eq('id', ADMIN_ID);
  await svc.from('profiles').update({ role: 'user' }).eq('id', USER_ID);
});

afterAll(async () => {
  // Reset auth_mode to built-in
  await svc.from('app_settings').update({ value: 'built-in' }).eq('key', 'auth_mode');

  // Clean up vault secrets we may have created
  try { await svc.rpc('delete_oauth_secret', { secret_name: 'auth_test_client_id' }); } catch { /* ok */ }
  try { await svc.rpc('delete_oauth_secret', { secret_name: 'auth_test_client_secret' }); } catch { /* ok */ }

  for (const c of Object.values(clients)) {
    await c.auth.signOut();
  }
});

describe('Phase 21: Auth External — Settings', () => {
  it('all auth-related app_settings keys exist with correct defaults', async () => {
    const admin = await clientForUser('authext-admin@test.local');
    const keys = [
      'auth_mode',
      'auth_google_enabled',
      'auth_github_enabled',
      'auth_microsoft_enabled',
      'auth_microsoft_tenant_id',
      'auth_gitlab_enabled',
      'auth_gitlab_instance_url',
      'auth_external_provider_name',
      'auth_external_issuer_url',
      'auth_external_scopes',
      'auth_external_auto_redirect',
    ];

    const { data, error } = await admin
      .from('app_settings')
      .select('key, value')
      .in('key', keys);

    expect(error).toBeNull();
    expect(data).toBeTruthy();

    const map = new Map(data!.map((row) => [row.key, row.value]));

    expect(map.get('auth_mode')).toBe('built-in');
    expect(map.get('auth_google_enabled')).toBe('false');
    expect(map.get('auth_github_enabled')).toBe('false');
    expect(map.get('auth_microsoft_enabled')).toBe('false');
    expect(map.get('auth_microsoft_tenant_id')).toBe('');
    expect(map.get('auth_gitlab_enabled')).toBe('false');
    expect(map.get('auth_gitlab_instance_url')).toBe('');
    expect(map.get('auth_external_provider_name')).toBe('');
    expect(map.get('auth_external_issuer_url')).toBe('');
    expect(map.get('auth_external_scopes')).toBe('openid email profile');
    expect(map.get('auth_external_auto_redirect')).toBe('false');
  });

  it('admin can update auth_mode setting', async () => {
    const admin = await clientForUser('authext-admin@test.local');

    // Switch to external
    const { error: err1 } = await admin
      .from('app_settings')
      .update({ value: 'external' })
      .eq('key', 'auth_mode');
    expect(err1).toBeNull();

    // Verify
    const { data: s1 } = await admin
      .from('app_settings')
      .select('value')
      .eq('key', 'auth_mode')
      .single();
    expect(s1?.value).toBe('external');

    // Switch back
    const { error: err2 } = await admin
      .from('app_settings')
      .update({ value: 'built-in' })
      .eq('key', 'auth_mode');
    expect(err2).toBeNull();

    const { data: s2 } = await admin
      .from('app_settings')
      .select('value')
      .eq('key', 'auth_mode')
      .single();
    expect(s2?.value).toBe('built-in');
  });

  it('admin can update social provider settings', async () => {
    const admin = await clientForUser('authext-admin@test.local');

    // Enable Google
    const { error } = await admin
      .from('app_settings')
      .update({ value: 'true' })
      .eq('key', 'auth_google_enabled');
    expect(error).toBeNull();

    const { data } = await admin
      .from('app_settings')
      .select('value')
      .eq('key', 'auth_google_enabled')
      .single();
    expect(data?.value).toBe('true');

    // Disable it back
    await admin.from('app_settings').update({ value: 'false' }).eq('key', 'auth_google_enabled');
  });

  it('admin can update external provider settings', async () => {
    const admin = await clientForUser('authext-admin@test.local');

    const updates = {
      auth_external_provider_name: 'Test SSO',
      auth_external_issuer_url: 'https://auth.example.com',
      auth_external_scopes: 'openid email',
      auth_external_auto_redirect: 'true',
    };

    for (const [key, value] of Object.entries(updates)) {
      const { error } = await admin
        .from('app_settings')
        .update({ value })
        .eq('key', key);
      expect(error).toBeNull();
    }

    const { data } = await admin
      .from('app_settings')
      .select('key, value')
      .in('key', Object.keys(updates));

    const map = new Map(data!.map((row) => [row.key, row.value]));
    expect(map.get('auth_external_provider_name')).toBe('Test SSO');
    expect(map.get('auth_external_issuer_url')).toBe('https://auth.example.com');
    expect(map.get('auth_external_scopes')).toBe('openid email');
    expect(map.get('auth_external_auto_redirect')).toBe('true');

    // Reset
    for (const key of Object.keys(updates)) {
      const defaultVal = key === 'auth_external_scopes' ? 'openid email profile' : key === 'auth_external_auto_redirect' ? 'false' : '';
      await admin.from('app_settings').update({ value: defaultVal }).eq('key', key);
    }
  });
});

describe('Phase 21: Auth External — Vault Functions', () => {
  it('can store and retrieve OAuth secrets via vault RPC', async () => {
    // Store a test secret
    const { error: storeErr } = await svc.rpc('store_oauth_secret', {
      secret_name: 'auth_test_client_id',
      secret_value: 'test-client-id-123',
      secret_description: 'Test OAuth client ID',
    });
    expect(storeErr).toBeNull();

    // Retrieve it
    const { data: secret, error: getErr } = await svc.rpc('get_oauth_secret', {
      secret_name: 'auth_test_client_id',
    });
    expect(getErr).toBeNull();
    expect(secret).toBe('test-client-id-123');
  });

  it('has_oauth_secret returns true for existing secret', async () => {
    const { data, error } = await svc.rpc('has_oauth_secret', {
      secret_name: 'auth_test_client_id',
    });
    expect(error).toBeNull();
    expect(data).toBe(true);
  });

  it('has_oauth_secret returns false for non-existing secret', async () => {
    const { data, error } = await svc.rpc('has_oauth_secret', {
      secret_name: 'auth_nonexistent_key',
    });
    expect(error).toBeNull();
    expect(data).toBe(false);
  });

  it('store_oauth_secret replaces existing secret', async () => {
    await svc.rpc('store_oauth_secret', {
      secret_name: 'auth_test_client_id',
      secret_value: 'updated-value-456',
      secret_description: 'Updated test secret',
    });

    const { data } = await svc.rpc('get_oauth_secret', {
      secret_name: 'auth_test_client_id',
    });
    expect(data).toBe('updated-value-456');
  });

  it('delete_oauth_secret removes the secret', async () => {
    await svc.rpc('delete_oauth_secret', {
      secret_name: 'auth_test_client_id',
    });

    const { data } = await svc.rpc('has_oauth_secret', {
      secret_name: 'auth_test_client_id',
    });
    expect(data).toBe(false);
  });
});

describe('Phase 21: Auth External — Audit Log', () => {
  it('admin audit log table accepts auth-related actions', async () => {
    const admin = await clientForUser('authext-admin@test.local');

    const { error } = await admin.from('admin_audit_log').insert({
      admin_id: ADMIN_ID,
      action: 'auth_mode_changed',
      target_type: 'app_settings',
      target_id: 'auth_mode',
      details: { from: 'built-in', to: 'external' },
    });
    expect(error).toBeNull();

    // Verify it was written
    const { data } = await admin
      .from('admin_audit_log')
      .select('action, details')
      .eq('admin_id', ADMIN_ID)
      .eq('action', 'auth_mode_changed')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    expect(data?.action).toBe('auth_mode_changed');
    expect(data?.details).toEqual({ from: 'built-in', to: 'external' });
  });
});
