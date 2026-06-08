import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SupabaseClient } from '@supabase/supabase-js';
import { createServiceRoleClient } from '../helpers/supabase';

const USER_ID = '00000000-0000-0000-0000-000000000933';

let svc: SupabaseClient;
let typeId: string;
let tagId: string;
const createdTicketIds: number[] = [];

async function newTicket(extra: Record<string, unknown> = {}): Promise<number> {
  const { data, error } = await svc
    .from('tickets')
    .insert({ title: 'Clone DB Source', slug: 'clone-db-source', creator_id: USER_ID, type_id: typeId, ...extra })
    .select('id')
    .single();
  if (error) throw new Error(`newTicket: ${error.message}`);
  createdTicketIds.push(data!.id);
  return data!.id;
}

beforeAll(async () => {
  svc = createServiceRoleClient();

  await svc.from('profiles').delete().eq('id', USER_ID).then(() => undefined, () => undefined);
  await svc.auth.admin.deleteUser(USER_ID).catch(() => undefined);

  const { error } = await svc.auth.admin.createUser({
    id: USER_ID,
    email: 'clone-db@test.local',
    password: 'Password123',
    email_confirm: true,
    user_metadata: { display_name: 'Clone DB Tester' },
  });
  if (error) throw new Error(`createUser: ${error.message}`);

  const { data: tt } = await svc.from('ticket_types').select('id').limit(1).single();
  typeId = tt!.id;

  const { data: tag } = await svc
    .from('tags')
    .insert({ name: `clone-db-tag-${Date.now()}`, color: '#3b82f6' })
    .select('id')
    .single();
  tagId = tag!.id;
});

afterAll(async () => {
  if (createdTicketIds.length) {
    await svc.from('tickets').delete().in('id', createdTicketIds);
  }
  if (tagId) await svc.from('tags').delete().eq('id', tagId);
  await svc.auth.admin.deleteUser(USER_ID);
});

describe('033 — clone ticket / clone comment to ticket', () => {
  it('tickets.cloned_from_id / cloned_from_post_id default to NULL', async () => {
    const id = await newTicket();
    const { data, error } = await svc
      .from('tickets')
      .select('cloned_from_id, cloned_from_post_id')
      .eq('id', id)
      .single();
    expect(error).toBeNull();
    expect(data?.cloned_from_id).toBeNull();
    expect(data?.cloned_from_post_id).toBeNull();
  });

  it('can clone ticket metadata + tags and record lineage', async () => {
    const sourceId = await newTicket({ urgency: 'high', severity: 'high' });
    await svc.from('posts').insert({
      ticket_id: sourceId,
      author_id: USER_ID,
      body: 'Original post body',
      post_type: 'post',
      is_original: true,
    });
    await svc.from('ticket_tags').insert({ ticket_id: sourceId, tag_id: tagId });

    const cloneId = await newTicket({ title: 'Copy of Clone DB Source', urgency: 'high', severity: 'high', cloned_from_id: sourceId });
    await svc.from('posts').insert({
      ticket_id: cloneId,
      author_id: USER_ID,
      body: 'This ticket is a copy of a post from [#1](/tickets/1/redirect).\n\nOriginal post body',
      post_type: 'post',
      is_original: true,
    });
    await svc.from('ticket_tags').insert({ ticket_id: cloneId, tag_id: tagId });

    const { data: clone } = await svc
      .from('tickets')
      .select('cloned_from_id, urgency, severity, creator_id')
      .eq('id', cloneId)
      .single();
    expect(clone?.cloned_from_id).toBe(sourceId);
    expect(clone?.urgency).toBe('high');
    expect(clone?.creator_id).toBe(USER_ID);

    const { data: cloneTags } = await svc.from('ticket_tags').select('tag_id').eq('ticket_id', cloneId);
    expect(cloneTags?.map((t) => t.tag_id)).toContain(tagId);
  });

  it('cloned_from_id is set to NULL when the source ticket is deleted (ON DELETE SET NULL)', async () => {
    const sourceId = await newTicket();
    const cloneId = await newTicket({ cloned_from_id: sourceId });

    await svc.from('tickets').delete().eq('id', sourceId);

    const { data } = await svc.from('tickets').select('cloned_from_id').eq('id', cloneId).single();
    expect(data?.cloned_from_id).toBeNull();
  });

  it('cloned_from_post_id is set to NULL when the source post is deleted (ON DELETE SET NULL)', async () => {
    const sourceId = await newTicket();
    const { data: post } = await svc
      .from('posts')
      .insert({ ticket_id: sourceId, author_id: USER_ID, body: 'A user comment', post_type: 'comment' })
      .select('id')
      .single();

    const cloneId = await newTicket({ cloned_from_id: sourceId, cloned_from_post_id: post!.id });

    await svc.from('posts').delete().eq('id', post!.id);

    const { data } = await svc.from('tickets').select('cloned_from_post_id').eq('id', cloneId).single();
    expect(data?.cloned_from_post_id).toBeNull();
  });

  it('clone templates are seeded with the expected defaults', async () => {
    const { data } = await svc
      .from('notification_templates')
      .select('event_type, body')
      .in('event_type', ['clone_origin_note', 'clone_comment_reply']);

    const byType = Object.fromEntries((data ?? []).map((t) => [t.event_type, t.body]));
    expect(byType['clone_origin_note']).toContain('copy of a post from [#{{ticketId}}]');
    expect(byType['clone_comment_reply']).toContain('I created a separate ticket on your behalf');
    expect(byType['clone_comment_reply']).toContain('{{userName}}');
  });
});
