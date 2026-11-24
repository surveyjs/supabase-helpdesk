import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServiceRoleClient } from '../helpers/supabase';

// #103: user custom fields; staff-only values stay with staff.

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const AGENT_ID = '00000000-0000-0000-0000-000000000371';
const USER_ID = '00000000-0000-0000-0000-000000000372';
const OTHER_ID = '00000000-0000-0000-0000-000000000373';
const SHARED = 'DbUserFieldShared37';
const STAFF = 'DbUserFieldStaff37';

let svc: SupabaseClient;
const c: Record<string, SupabaseClient> = {};
let sharedId: string;
let staffId: string;

async function ensureUser(id: string, email: string, role: 'agent' | 'user') {
  const { error } = await svc.auth.admin.createUser({ id, email, password: 'Password123', email_confirm: true });
  if (error && !error.message.includes('already been registered')) throw new Error(error.message);
  await svc.from('profiles').update({ role }).eq('id', id);
  const client = createClient(supabaseUrl, anonKey);
  const { error: e } = await client.auth.signInWithPassword({ email, password: 'Password123' });
  if (e) throw new Error(e.message);
  c[role === 'agent' ? 'agent' : id === USER_ID ? 'user' : 'other'] = client;
}

beforeAll(async () => {
  svc = createServiceRoleClient();
  await ensureUser(AGENT_ID, 'agent37@test.com', 'agent');
  await ensureUser(USER_ID, 'user37@test.com', 'user');
  await ensureUser(OTHER_ID, 'other37@test.com', 'user');
  await svc.from('custom_fields').delete().in('name', [SHARED, STAFF]);
  const { data, error } = await svc.from('custom_fields').insert([
    { name: SHARED, field_type: 'text', applies_to: 'user', agent_only: false, display_order: 9370 },
    { name: STAFF, field_type: 'text', applies_to: 'user', agent_only: true, display_order: 9371 },
  ]).select('id, name');
  if (error) throw new Error(error.message);
  sharedId = data!.find((r) => r.name === SHARED)!.id;
  staffId = data!.find((r) => r.name === STAFF)!.id;
});

afterAll(async () => {
  await svc.from('custom_fields').delete().in('name', [SHARED, STAFF]); // cascades to values
});

describe('user_field_values', () => {
  it('staff write values; the user reads only the shared one; others read nothing', async () => {
    const { error } = await c.agent.from('user_field_values').upsert([
      { user_id: USER_ID, field_id: sharedId, value: 'visible' },
      { user_id: USER_ID, field_id: staffId, value: 'secret' },
    ]);
    expect(error).toBeNull();

    const { data: own } = await c.user.from('user_field_values').select('field_id, value').eq('user_id', USER_ID);
    expect(own).toEqual([{ field_id: sharedId, value: 'visible' }]);

    const { data: others } = await c.other.from('user_field_values').select('field_id').eq('user_id', USER_ID);
    expect(others ?? []).toHaveLength(0);

    const { data: staffView } = await c.agent.from('user_field_values').select('field_id').eq('user_id', USER_ID);
    expect(staffView ?? []).toHaveLength(2);
  });

  it('a user cannot write their own values', async () => {
    const { error } = await c.user.from('user_field_values').upsert({ user_id: USER_ID, field_id: sharedId, value: 'hacked' });
    expect(error).not.toBeNull();
    const { data } = await svc.from('user_field_values').select('value').eq('user_id', USER_ID).eq('field_id', sharedId).single();
    expect(data!.value).toBe('visible');
  });

  it('applies_to only allows ticket or user', async () => {
    const { error } = await svc.from('custom_fields').insert({ name: 'BadAppliesTo37', field_type: 'text', applies_to: 'team' });
    expect(error?.code).toBe('23514');
  });
});
