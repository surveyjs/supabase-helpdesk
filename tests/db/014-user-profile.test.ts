import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServiceRoleClient } from '../helpers/supabase';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const ADMIN_ID = '00000000-0000-0000-0000-000000000401';
const AGENT_ID = '00000000-0000-0000-0000-000000000402';
const AGENT2_ID = '00000000-0000-0000-0000-000000000403';
const USER_ID = '00000000-0000-0000-0000-000000000404';

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

  await ensureAuthUser(svc, ADMIN_ID, 'up-admin@test.local', { display_name: 'UP Admin' });
  await ensureAuthUser(svc, AGENT_ID, 'up-agent@test.local', { display_name: 'UP Agent' });
  await ensureAuthUser(svc, AGENT2_ID, 'up-agent2@test.local', { display_name: 'UP Agent2' });
  await ensureAuthUser(svc, USER_ID, 'up-user@test.local', { display_name: 'UP User' });

  // Set roles
  await svc.from('profiles').update({ role: 'admin' }).eq('id', ADMIN_ID);
  await svc.from('profiles').update({ role: 'agent' }).eq('id', AGENT_ID);
  await svc.from('profiles').update({ role: 'agent' }).eq('id', AGENT2_ID);
  // USER_ID stays as 'user'
});

afterAll(async () => {
  // Clean up notes
  await svc.from('user_notes').delete().in('target_user_id', [USER_ID, AGENT_ID]);
  // Clean up users
  for (const id of [ADMIN_ID, AGENT_ID, AGENT2_ID, USER_ID]) {
    await svc.auth.admin.deleteUser(id);
  }
});

describe('014 — User Notes', () => {
  let noteId: string;

  it('agent can create a user note', async () => {
    const agent = await clientForUser('up-agent@test.local');
    const { data, error } = await agent
      .from('user_notes')
      .insert({
        target_user_id: USER_ID,
        author_id: AGENT_ID,
        body: 'This user needs extra attention.',
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect(data!.body).toBe('This user needs extra attention.');
    noteId = data!.id;
  });

  it('another agent can also create a note on the same user', async () => {
    const agent2 = await clientForUser('up-agent2@test.local');
    const { data, error } = await agent2
      .from('user_notes')
      .insert({
        target_user_id: USER_ID,
        author_id: AGENT2_ID,
        body: 'Second agent note.',
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data).toBeTruthy();
  });

  it('regular user cannot create a user note', async () => {
    const user = await clientForUser('up-user@test.local');
    const { error } = await user
      .from('user_notes')
      .insert({
        target_user_id: USER_ID,
        author_id: USER_ID,
        body: 'User trying to create note.',
      });

    expect(error).toBeTruthy();
  });

  it('regular user cannot read user notes', async () => {
    const user = await clientForUser('up-user@test.local');
    const { data } = await user
      .from('user_notes')
      .select('*')
      .eq('target_user_id', USER_ID);

    expect(data).toEqual([]);
  });

  it('agent can read all user notes', async () => {
    const agent = await clientForUser('up-agent@test.local');
    const { data, error } = await agent
      .from('user_notes')
      .select('*')
      .eq('target_user_id', USER_ID);

    expect(error).toBeNull();
    expect(data!.length).toBe(2);
  });

  it('agent can update own note', async () => {
    const agent = await clientForUser('up-agent@test.local');
    const { error } = await agent
      .from('user_notes')
      .update({ body: 'Updated note.', edited_at: new Date().toISOString() })
      .eq('id', noteId);

    expect(error).toBeNull();

    const { data } = await agent
      .from('user_notes')
      .select('body, edited_at')
      .eq('id', noteId)
      .single();

    expect(data!.body).toBe('Updated note.');
    expect(data!.edited_at).toBeTruthy();
  });

  it('agent cannot update another agent\'s note', async () => {
    const agent = await clientForUser('up-agent@test.local');
    // Get agent2's note
    const { data: notes } = await agent
      .from('user_notes')
      .select('id')
      .eq('author_id', AGENT2_ID)
      .single();

    const { error: _error } = await agent
      .from('user_notes')
      .update({ body: 'Trying to edit.' })
      .eq('id', notes!.id);

    // RLS should prevent update (0 rows affected, not an error per se)
    // Re-read to confirm no change
    const { data: unchanged } = await agent
      .from('user_notes')
      .select('body')
      .eq('id', notes!.id)
      .single();

    expect(unchanged!.body).toBe('Second agent note.');
  });

  it('agent can delete own note', async () => {
    const agent = await clientForUser('up-agent@test.local');
    const { error } = await agent
      .from('user_notes')
      .delete()
      .eq('id', noteId);

    expect(error).toBeNull();

    const { data } = await agent
      .from('user_notes')
      .select('id')
      .eq('id', noteId);

    expect(data).toEqual([]);
  });

  it('agent cannot delete another agent\'s note', async () => {
    const agent = await clientForUser('up-agent@test.local');
    // Get agent2's note
    const { data: notes } = await agent
      .from('user_notes')
      .select('id')
      .eq('author_id', AGENT2_ID)
      .single();

    const { error: _error } = await agent
      .from('user_notes')
      .delete()
      .eq('id', notes!.id);

    // Should still exist
    const { data: stillExists } = await agent
      .from('user_notes')
      .select('id')
      .eq('id', notes!.id);

    expect(stillExists!.length).toBe(1);
  });

  it('admin can delete any agent\'s note', async () => {
    const admin = await clientForUser('up-admin@test.local');
    // Get agent2's note
    const { data: notes } = await admin
      .from('user_notes')
      .select('id')
      .eq('author_id', AGENT2_ID)
      .single();

    const { error } = await admin
      .from('user_notes')
      .delete()
      .eq('id', notes!.id);

    expect(error).toBeNull();

    const { data: gone } = await admin
      .from('user_notes')
      .select('id')
      .eq('id', notes!.id);

    expect(gone).toEqual([]);
  });

  it('body cannot exceed 10000 chars', async () => {
    const agent = await clientForUser('up-agent@test.local');
    const { error } = await agent
      .from('user_notes')
      .insert({
        target_user_id: USER_ID,
        author_id: AGENT_ID,
        body: 'x'.repeat(10001),
      });

    expect(error).toBeTruthy();
  });

  it('body at exactly 10000 chars is allowed', async () => {
    const agent = await clientForUser('up-agent@test.local');
    const { data, error } = await agent
      .from('user_notes')
      .insert({
        target_user_id: USER_ID,
        author_id: AGENT_ID,
        body: 'x'.repeat(10000),
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data).toBeTruthy();

    // Clean up
    await agent.from('user_notes').delete().eq('id', data!.id);
  });
});
