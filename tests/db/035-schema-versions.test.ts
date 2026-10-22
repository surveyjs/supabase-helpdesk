import { readdirSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { describe, it, expect } from 'vitest';
import { createAnonClient, createServiceRoleClient } from '../helpers/supabase';

// The app's startup check (docker/check-schema.mjs) reads the applied
// migrations through this RPC with the service_role key.

const shipped = readdirSync(path.resolve(__dirname, '../../supabase/migrations'))
  .map((f) => /^(\d+)_.+\.sql$/.exec(f)?.[1])
  .filter((v): v is string => Boolean(v))
  .sort();

describe('schema_migration_versions()', () => {
  it('returns every applied migration to service_role', async () => {
    const { data, error } = await createServiceRoleClient().rpc('schema_migration_versions');
    expect(error).toBeNull();
    expect(data).toEqual(shipped);
  });

  it('is not callable with the anon key', async () => {
    const { error } = await createAnonClient().rpc('schema_migration_versions');
    expect(error?.code).toBe('42501');
  });

  it('is not callable by a signed-in user', async () => {
    const alice = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    await alice.auth.signInWithPassword({ email: 'alice@example.com', password: 'Password123' });
    const { error } = await alice.rpc('schema_migration_versions');
    expect(error?.code).toBe('42501');
  });
});
