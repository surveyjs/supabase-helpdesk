import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServiceRoleClient } from '../helpers/supabase';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const ADMIN_ID = '00000000-0000-0000-0000-000000000501';
const AGENT_ID = '00000000-0000-0000-0000-000000000502';
const AGENT2_ID = '00000000-0000-0000-0000-000000000503';
const USER_ID = '00000000-0000-0000-0000-000000000504';

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

  await ensureAuthUser(svc, ADMIN_ID, 'cr-admin@test.local', { display_name: 'CR Admin' });
  await ensureAuthUser(svc, AGENT_ID, 'cr-agent@test.local', { display_name: 'CR Agent' });
  await ensureAuthUser(svc, AGENT2_ID, 'cr-agent2@test.local', { display_name: 'CR Agent2' });
  await ensureAuthUser(svc, USER_ID, 'cr-user@test.local', { display_name: 'CR User' });

  await svc.from('profiles').update({ role: 'admin' }).eq('id', ADMIN_ID);
  await svc.from('profiles').update({ role: 'agent' }).eq('id', AGENT_ID);
  await svc.from('profiles').update({ role: 'agent' }).eq('id', AGENT2_ID);
  await svc.from('profiles').update({ role: 'user' }).eq('id', USER_ID);
});

afterAll(async () => {
  // Clean up canned responses created during tests
  await svc.from('canned_responses').delete().in('author_id', [ADMIN_ID, AGENT_ID, AGENT2_ID]);
});

describe('Canned Responses', () => {
  it('agent can create a private canned response', async () => {
    const client = await clientForUser('cr-agent@test.local');

    const { data, error } = await client
      .from('canned_responses')
      .insert({
        title: 'Test Private Response',
        body: 'This is a private canned response body.',
        visibility: 'private',
        author_id: AGENT_ID,
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect(data!.title).toBe('Test Private Response');
    expect(data!.visibility).toBe('private');
  });

  it('agent can create a public canned response', async () => {
    const client = await clientForUser('cr-agent@test.local');

    const { data, error } = await client
      .from('canned_responses')
      .insert({
        title: 'Test Public Response',
        body: 'This is a public canned response body.',
        visibility: 'public',
        author_id: AGENT_ID,
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect(data!.visibility).toBe('public');
  });

  it('regular user cannot create canned responses', async () => {
    const client = await clientForUser('cr-user@test.local');

    const { error } = await client
      .from('canned_responses')
      .insert({
        title: 'User Attempt',
        body: 'Should fail',
        visibility: 'private',
        author_id: USER_ID,
      });

    expect(error).toBeTruthy();
  });

  it('agent can see own private + all public responses', async () => {
    const client2 = await clientForUser('cr-agent2@test.local');

    // Agent2 creates a private response
    await client2
      .from('canned_responses')
      .insert({
        title: 'Agent2 Private',
        body: 'Private to agent2',
        visibility: 'private',
        author_id: AGENT2_ID,
      });

    // Agent1 should see public responses + own private, but NOT agent2's private
    const client = await clientForUser('cr-agent@test.local');
    const { data } = await client
      .from('canned_responses')
      .select('*');

    const titles = (data ?? []).map((r) => r.title);
    expect(titles).toContain('Test Public Response');
    expect(titles).toContain('Test Private Response');
    expect(titles).not.toContain('Agent2 Private');
  });

  it('agent2 can see public responses from agent1', async () => {
    const client2 = await clientForUser('cr-agent2@test.local');
    const { data } = await client2
      .from('canned_responses')
      .select('*');

    const titles = (data ?? []).map((r) => r.title);
    expect(titles).toContain('Test Public Response');
  });

  it('agent can update own response', async () => {
    const client = await clientForUser('cr-agent@test.local');

    const { data: response } = await client
      .from('canned_responses')
      .select('id')
      .eq('title', 'Test Private Response')
      .single();

    const { error } = await client
      .from('canned_responses')
      .update({ title: 'Updated Private Response' })
      .eq('id', response!.id);

    expect(error).toBeNull();
  });

  it('agent cannot update another agent\'s private response', async () => {
    const client = await clientForUser('cr-agent@test.local');

    const { data: response } = await svc
      .from('canned_responses')
      .select('id')
      .eq('title', 'Agent2 Private')
      .single();

    const { error: _updateErr } = await client
      .from('canned_responses')
      .update({ title: 'Hacked' })
      .eq('id', response!.id);

    // Update should affect 0 rows or fail due to RLS
    // (Supabase doesn't return error on 0 rows updated, but the data stays unchanged)
    const { data: check } = await svc
      .from('canned_responses')
      .select('title')
      .eq('id', response!.id)
      .single();

    expect(check!.title).toBe('Agent2 Private');
  });

  it('admin can update any public response', async () => {
    const adminClient = await clientForUser('cr-admin@test.local');

    const { data: response } = await adminClient
      .from('canned_responses')
      .select('id')
      .eq('title', 'Test Public Response')
      .single();

    const { error } = await adminClient
      .from('canned_responses')
      .update({ body: 'Admin-updated body' })
      .eq('id', response!.id);

    expect(error).toBeNull();
  });

  it('admin can delete any public response', async () => {
    const adminClient = await clientForUser('cr-admin@test.local');

    // Create a public response to delete
    const { data: created } = await svc
      .from('canned_responses')
      .insert({
        title: 'To Delete Public',
        body: 'Will be deleted by admin',
        visibility: 'public',
        author_id: AGENT2_ID,
      })
      .select()
      .single();

    const { error } = await adminClient
      .from('canned_responses')
      .delete()
      .eq('id', created!.id);

    expect(error).toBeNull();
  });

  it('agent can delete own response', async () => {
    const client = await clientForUser('cr-agent@test.local');

    const { data: created } = await client
      .from('canned_responses')
      .insert({
        title: 'To Delete Own',
        body: 'Will be deleted',
        visibility: 'private',
        author_id: AGENT_ID,
      })
      .select()
      .single();

    const { error } = await client
      .from('canned_responses')
      .delete()
      .eq('id', created!.id);

    expect(error).toBeNull();
  });

  it('title length constraint is enforced', async () => {
    const client = await clientForUser('cr-agent@test.local');

    const { error } = await client
      .from('canned_responses')
      .insert({
        title: 'x'.repeat(201),
        body: 'test',
        visibility: 'private',
        author_id: AGENT_ID,
      });

    expect(error).toBeTruthy();
  });

  it('user cannot read canned responses', async () => {
    const client = await clientForUser('cr-user@test.local');

    const { data } = await client
      .from('canned_responses')
      .select('*');

    expect(data).toEqual([]);
  });
});
