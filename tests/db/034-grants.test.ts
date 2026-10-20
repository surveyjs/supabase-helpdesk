import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll } from 'vitest';
import { createAnonClient, createServiceRoleClient } from '../helpers/supabase';

// Data API privileges (migration 002_explicit_grants.sql).
//
// Supabase no longer grants new `public` tables to anon/authenticated/
// service_role automatically (CLI >= 2.106 / `auto_expose_new_tables = false`),
// so the schema must grant them explicitly. Conversely, instances created under
// the OLD defaults gave anon/authenticated an explicit EXECUTE on every
// function, which `REVOKE ... FROM PUBLIC` in 001 did not remove — the Vault
// RPCs must stay service_role-only in both worlds.

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const PERMISSION_DENIED = '42501';

let svc: SupabaseClient;
let anon: SupabaseClient;
let alice: SupabaseClient;

beforeAll(async () => {
  svc = createServiceRoleClient();
  anon = createAnonClient();
  alice = createClient(supabaseUrl, anonKey);
  const { error } = await alice.auth.signInWithPassword({
    email: 'alice@example.com',
    password: 'Password123',
  });
  if (error) throw new Error(`signIn(alice): ${error.message}`);
});

describe('table grants', () => {
  it.each(['teams', 'profiles', 'tickets', 'app_settings', 'agent_tickets'])(
    'service_role can read %s',
    async (table) => {
      const { error } = await svc.from(table).select('*').limit(1);
      expect(error).toBeNull();
    },
  );

  it('authenticated can read through RLS (no 42501)', async () => {
    const { error } = await alice.from('tickets').select('id').limit(1);
    expect(error).toBeNull();
  });

  it('anon gets RLS-filtered results, not a privilege error', async () => {
    const { error } = await anon.from('ticket_types').select('id').limit(1);
    expect(error).toBeNull();
  });
});

describe('vault RPCs are service_role-only', () => {
  const vaultCalls: Array<[string, Record<string, string>]> = [
    ['get_ai_api_key', {}],
    ['get_tier_api_secret', {}],
    ['get_oauth_secret', { secret_name: 'grants-test' }],
    ['has_oauth_secret', { secret_name: 'grants-test' }],
  ];

  it.each(vaultCalls)('anon cannot call %s', async (fn, args) => {
    const { error } = await anon.rpc(fn, args);
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it.each(vaultCalls)('authenticated cannot call %s', async (fn, args) => {
    const { error } = await alice.rpc(fn, args);
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it('service_role can call get_ai_api_key', async () => {
    const { error } = await svc.rpc('get_ai_api_key');
    expect(error).toBeNull();
  });
});
