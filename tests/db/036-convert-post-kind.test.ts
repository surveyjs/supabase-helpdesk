import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServiceRoleClient } from '../helpers/supabase';

// #106: convert_post_kind turns a comment into an answer and back.

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const AGENT_ID = '00000000-0000-0000-0000-000000000361';
const USER_ID = '00000000-0000-0000-0000-000000000362';

let svc: SupabaseClient;
let agent: SupabaseClient;
let user: SupabaseClient;
let typeId: string;
const ticketIds: number[] = [];

async function ensureUser(id: string, email: string, role: 'agent' | 'user') {
  const { error } = await svc.auth.admin.createUser({
    id, email, password: 'Password123', email_confirm: true, user_metadata: { display_name: email },
  });
  if (error && !error.message.includes('already been registered')) throw new Error(error.message);
  await svc.from('profiles').update({ role }).eq('id', id);
}

async function signIn(email: string) {
  const c = createClient(supabaseUrl, anonKey);
  const { error } = await c.auth.signInWithPassword({ email, password: 'Password123' });
  if (error) throw new Error(error.message);
  return c;
}

type Row = { id: string; post_type: string; parent_post_id: string | null; parent_comment_id: string | null; is_private: boolean };

async function newTicket() {
  const { data: t, error } = await svc
    .from('tickets')
    .insert({ title: 'Convert post kind', slug: 'convert-post-kind', creator_id: USER_ID, type_id: typeId })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  ticketIds.push(t!.id);
  return t!.id as number;
}

async function insertPost(ticketId: number, fields: Record<string, unknown>) {
  const { data, error } = await svc
    .from('posts')
    .insert({ ticket_id: ticketId, author_id: AGENT_ID, body: 'x', post_type: 'post', is_private: false, ...fields })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return data!.id as string;
}

async function row(id: string): Promise<Row> {
  const { data } = await svc.from('posts').select('id, post_type, parent_post_id, parent_comment_id, is_private').eq('id', id).single();
  return data as Row;
}

beforeAll(async () => {
  svc = createServiceRoleClient();
  await ensureUser(AGENT_ID, 'agent36@test.com', 'agent');
  await ensureUser(USER_ID, 'user36@test.com', 'user');
  const { data: type } = await svc.from('ticket_types').select('id').limit(1).single();
  typeId = type!.id;
  agent = await signIn('agent36@test.com');
  user = await signIn('user36@test.com');
});

afterAll(async () => {
  if (ticketIds.length) {
    await svc.from('activity_log').delete().in('ticket_id', ticketIds);
    await svc.from('posts').delete().in('ticket_id', ticketIds);
    await svc.from('sla_timers').delete().in('ticket_id', ticketIds);
    await svc.from('tickets').delete().in('id', ticketIds);
  }
});

describe('convert_post_kind', () => {
  it('comment -> answer: becomes top-level, takes its replies, keeps a private root private', async () => {
    const t = await newTicket();
    const original = await insertPost(t, { is_original: true, author_id: USER_ID, created_at: '2026-01-01T00:00:00Z' });
    const privateAnswer = await insertPost(t, { is_private: true, created_at: '2026-01-02T00:00:00Z' });
    const comment = await insertPost(t, { post_type: 'comment', parent_post_id: privateAnswer, created_at: '2026-01-03T00:00:00Z' });
    const reply = await insertPost(t, { post_type: 'comment', parent_comment_id: comment, created_at: '2026-01-04T00:00:00Z' });

    const { data, error } = await agent.rpc('convert_post_kind', { p_post_id: comment, p_to: 'post' });
    expect(error).toBeNull();
    expect(data).toBe(comment);

    expect(await row(comment)).toMatchObject({ post_type: 'post', parent_post_id: null, parent_comment_id: null, is_private: true });
    expect(await row(reply)).toMatchObject({ post_type: 'comment', parent_post_id: comment, parent_comment_id: null });

    // Converting again is a no-op.
    const { data: again } = await agent.rpc('convert_post_kind', { p_post_id: comment, p_to: 'post' });
    expect(again).toBeNull();
    expect(original).toBeTruthy();
  });

  it('answer -> comment: attaches to the newest earlier answer and carries its comments, privacy kept', async () => {
    const t = await newTicket();
    const original = await insertPost(t, { is_original: true, author_id: USER_ID, created_at: '2026-01-01T00:00:00Z' });
    const earlier = await insertPost(t, { created_at: '2026-01-02T00:00:00Z' });
    const privateAnswer = await insertPost(t, { is_private: true, created_at: '2026-01-03T00:00:00Z' });
    const child = await insertPost(t, { post_type: 'comment', parent_post_id: privateAnswer, created_at: '2026-01-04T00:00:00Z' });

    const { data, error } = await agent.rpc('convert_post_kind', { p_post_id: privateAnswer, p_to: 'comment' });
    expect(error).toBeNull();
    expect(data).toBe(earlier);
    expect(await row(privateAnswer)).toMatchObject({ post_type: 'comment', parent_post_id: earlier, is_private: true });
    expect(await row(child)).toMatchObject({ parent_post_id: earlier, is_private: true });

    // The first answer has only the original post before it.
    const { data: first } = await agent.rpc('convert_post_kind', { p_post_id: earlier, p_to: 'comment' });
    expect(first).toBe(original);
  });

  it('refuses the original post, notes, drafts and non-agents', async () => {
    const t = await newTicket();
    const original = await insertPost(t, { is_original: true, author_id: USER_ID, created_at: '2026-01-01T00:00:00Z' });
    const note = await insertPost(t, { post_type: 'note' });
    const draft = await insertPost(t, { is_draft: true });
    const answer = await insertPost(t, { created_at: '2026-01-05T00:00:00Z' });

    for (const id of [original, note, draft]) {
      const { error } = await agent.rpc('convert_post_kind', { p_post_id: id, p_to: 'comment' });
      expect(error?.code).toBe('22023');
    }
    const { error: userErr } = await user.rpc('convert_post_kind', { p_post_id: answer, p_to: 'comment' });
    expect(userErr?.code).toBe('42501');
    const { error: anonErr } = await createClient(supabaseUrl, anonKey).rpc('convert_post_kind', { p_post_id: answer, p_to: 'comment' });
    expect(anonErr?.code).toBe('42501');
    expect((await row(answer)).post_type).toBe('post');
  });
});
