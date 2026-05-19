import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServiceRoleClient } from '../helpers/supabase';

// ---------------------------------------------------------------------------
// Shared helpers & constants
// ---------------------------------------------------------------------------

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const ADMIN_ID = '00000000-0000-0000-0000-000000000081';
const AGENT_ID = '00000000-0000-0000-0000-000000000082';
const USER_ID = '00000000-0000-0000-0000-000000000083';
const USER2_ID = '00000000-0000-0000-0000-000000000084';

let svc: SupabaseClient;
let defaultTypeId: string;
let ticketId: number;
let postId: string;
let privatePostId: string;
let notePostId: string;
let draftPostId: string;

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

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeAll(async () => {
  svc = createServiceRoleClient();

  const testUserIds = [ADMIN_ID, AGENT_ID, USER_ID, USER2_ID];

  // Clean up leftover data
  const { data: testTickets } = await svc.from('tickets').select('id').in('creator_id', testUserIds);
  if (testTickets && testTickets.length > 0) {
    const ticketIds = testTickets.map((t: { id: number }) => t.id);
    await svc.from('attachments').delete().in('post_id',
      (await svc.from('posts').select('id').in('ticket_id', ticketIds)).data?.map((p: { id: string }) => p.id) ?? [],
    );
    await svc.from('activity_log').delete().in('ticket_id', ticketIds);
    await svc.from('ticket_tags').delete().in('ticket_id', ticketIds);
    await svc.from('posts').delete().in('ticket_id', ticketIds);
    await svc.from('tickets').update({ duplicate_of_id: null, merged_into_id: null }).in('id', ticketIds);
    await svc.from('tickets').delete().in('id', ticketIds);
  }

  // Get default type
  const { data: typeData } = await svc.from('ticket_types').select('id').eq('is_default', true).single();
  defaultTypeId = typeData!.id;

  // Ensure auth users
  await ensureAuthUser(svc, ADMIN_ID, 'admin8@test.com', { display_name: 'Admin8' });
  await ensureAuthUser(svc, AGENT_ID, 'agent8@test.com', { display_name: 'Agent8' });
  await ensureAuthUser(svc, USER_ID, 'user8@test.com', { display_name: 'User8' });
  await ensureAuthUser(svc, USER2_ID, 'user8b@test.com', { display_name: 'User8b' });

  // Set roles
  await svc.from('profiles').update({ role: 'admin' }).eq('id', ADMIN_ID);
  await svc.from('profiles').update({ role: 'agent' }).eq('id', AGENT_ID);
  await svc.from('profiles').update({ role: 'user' }).eq('id', USER_ID);
  await svc.from('profiles').update({ role: 'user' }).eq('id', USER2_ID);

  // Authenticate all clients
  await clientForUser('admin8@test.com');
  await clientForUser('agent8@test.com');
  await clientForUser('user8@test.com');
  await clientForUser('user8b@test.com');

  // Create a test ticket
  const { data: ticket } = await svc
    .from('tickets')
    .insert({
      title: 'Attachment Test Ticket',
      slug: 'attachment-test-ticket',
      creator_id: USER_ID,
      type_id: defaultTypeId,
    })
    .select('id')
    .single();

  ticketId = ticket!.id;

  // Create a normal post
  const { data: post } = await svc
    .from('posts')
    .insert({
      ticket_id: ticketId,
      author_id: USER_ID,
      body: 'Test post for attachments',
      post_type: 'post',
      is_original: true,
    })
    .select('id')
    .single();

  postId = post!.id;

  // Create a private post (by agent)
  const { data: privPost } = await svc
    .from('posts')
    .insert({
      ticket_id: ticketId,
      author_id: AGENT_ID,
      body: 'Private post for attachment test',
      post_type: 'post',
      is_private: true,
    })
    .select('id')
    .single();

  privatePostId = privPost!.id;

  // Create a note (agent-only)
  const { data: notePost } = await svc
    .from('posts')
    .insert({
      ticket_id: ticketId,
      author_id: AGENT_ID,
      body: 'Internal note for attachment test',
      post_type: 'note',
      is_private: true,
    })
    .select('id')
    .single();

  notePostId = notePost!.id;

  // Create a draft (agent-only)
  const { data: draftPost } = await svc
    .from('posts')
    .insert({
      ticket_id: ticketId,
      author_id: AGENT_ID,
      body: 'Draft post for attachment test',
      post_type: 'post',
      is_draft: true,
    })
    .select('id')
    .single();

  draftPostId = draftPost!.id;
}, 30000);

afterAll(async () => {
  // Clean up
  const testUserIds = [ADMIN_ID, AGENT_ID, USER_ID, USER2_ID];
  const { data: testTickets } = await svc.from('tickets').select('id').in('creator_id', testUserIds);
  if (testTickets && testTickets.length > 0) {
    const ticketIds = testTickets.map((t: { id: number }) => t.id);
    await svc.from('attachments').delete().in('post_id',
      (await svc.from('posts').select('id').in('ticket_id', ticketIds)).data?.map((p: { id: string }) => p.id) ?? [],
    );
    await svc.from('activity_log').delete().in('ticket_id', ticketIds);
    await svc.from('ticket_tags').delete().in('ticket_id', ticketIds);
    await svc.from('posts').delete().in('ticket_id', ticketIds);
    await svc.from('tickets').update({ duplicate_of_id: null, merged_into_id: null }).in('id', ticketIds);
    await svc.from('tickets').delete().in('id', ticketIds);
  }
});

// ============================================================
// ATTACHMENT VISIBILITY (RLS)
// ============================================================

describe('Attachment visibility (RLS)', () => {
  let attachmentId: string;

  it('user can insert attachment on own post', async () => {
    const userClient = clients['user8@test.com'];

    const { data, error } = await userClient
      .from('attachments')
      .insert({
        post_id: postId,
        storage_path: 'tickets/1/posts/test/test-file.png',
        original_filename: 'test-file.png',
        file_size: 1024,
        mime_type: 'image/png',
      })
      .select('id')
      .single();

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    attachmentId = data!.id;
  });

  it('attachment is visible when parent post is visible', async () => {
    const userClient = clients['user8@test.com'];

    const { data, error } = await userClient
      .from('attachments')
      .select('*')
      .eq('id', attachmentId);

    expect(error).toBeNull();
    expect(data!.length).toBe(1);
    expect(data![0].original_filename).toBe('test-file.png');
  });

  it('attachment on private post is hidden from regular user (non-author)', async () => {
    // Agent inserts attachment on private post via service role
    const { data: att } = await svc
      .from('attachments')
      .insert({
        post_id: privatePostId,
        storage_path: 'tickets/1/posts/priv/priv-file.pdf',
        original_filename: 'priv-file.pdf',
        file_size: 2048,
        mime_type: 'application/pdf',
      })
      .select('id')
      .single();

    // User2 cannot see private post's attachment
    const user2Client = clients['user8b@test.com'];
    const { data } = await user2Client
      .from('attachments')
      .select('*')
      .eq('id', att!.id);

    expect(data?.length ?? 0).toBe(0);
  });

  it('attachment on note post is hidden from non-agents', async () => {
    const { data: att } = await svc
      .from('attachments')
      .insert({
        post_id: notePostId,
        storage_path: 'tickets/1/posts/note/note-file.txt',
        original_filename: 'note-file.txt',
        file_size: 512,
        mime_type: 'text/plain',
      })
      .select('id')
      .single();

    const userClient = clients['user8@test.com'];
    const { data } = await userClient
      .from('attachments')
      .select('*')
      .eq('id', att!.id);

    expect(data?.length ?? 0).toBe(0);
  });

  it('attachment on draft post is hidden from non-agents', async () => {
    const { data: att } = await svc
      .from('attachments')
      .insert({
        post_id: draftPostId,
        storage_path: 'tickets/1/posts/draft/draft-file.doc',
        original_filename: 'draft-file.doc',
        file_size: 4096,
        mime_type: 'application/msword',
      })
      .select('id')
      .single();

    const userClient = clients['user8@test.com'];
    const { data } = await userClient
      .from('attachments')
      .select('*')
      .eq('id', att!.id);

    expect(data?.length ?? 0).toBe(0);
  });

  it('agent can see attachments on private/note/draft posts', async () => {
    const agentClient = clients['agent8@test.com'];

    const { data } = await agentClient
      .from('attachments')
      .select('*')
      .in('post_id', [privatePostId, notePostId, draftPostId]);

    expect(data!.length).toBeGreaterThanOrEqual(3);
  });
});

// ============================================================
// ATTACHMENT DELETION (RLS)
// ============================================================

describe('Attachment deletion', () => {
  it('author can delete own attachment', async () => {
    const userClient = clients['user8@test.com'];

    const { data: att } = await userClient
      .from('attachments')
      .insert({
        post_id: postId,
        storage_path: 'tickets/1/posts/test/deleteme.png',
        original_filename: 'deleteme.png',
        file_size: 100,
        mime_type: 'image/png',
      })
      .select('id')
      .single();

    const { error } = await userClient
      .from('attachments')
      .delete()
      .eq('id', att!.id);

    expect(error).toBeNull();

    const { data: check } = await svc.from('attachments').select('id').eq('id', att!.id);
    expect(check?.length ?? 0).toBe(0);
  });

  it('agent can delete any attachment', async () => {
    const userClient = clients['user8@test.com'];

    const { data: att } = await userClient
      .from('attachments')
      .insert({
        post_id: postId,
        storage_path: 'tickets/1/posts/test/agent-delete.png',
        original_filename: 'agent-delete.png',
        file_size: 100,
        mime_type: 'image/png',
      })
      .select('id')
      .single();

    const agentClient = clients['agent8@test.com'];
    const { error } = await agentClient
      .from('attachments')
      .delete()
      .eq('id', att!.id);

    expect(error).toBeNull();
  });

  it('regular user cannot delete another user\'s attachment', async () => {
    const userClient = clients['user8@test.com'];

    const { data: att } = await userClient
      .from('attachments')
      .insert({
        post_id: postId,
        storage_path: 'tickets/1/posts/test/no-delete.png',
        original_filename: 'no-delete.png',
        file_size: 100,
        mime_type: 'image/png',
      })
      .select('id')
      .single();

    const user2Client = clients['user8b@test.com'];
    const { error } = await user2Client
      .from('attachments')
      .delete()
      .eq('id', att!.id);

    // Should fail or delete 0 rows
    if (!error) {
      const { data: check } = await svc.from('attachments').select('id').eq('id', att!.id);
      // The attachment should still exist
      expect(check!.length).toBe(1);
    }

    // Clean up
    await svc.from('attachments').delete().eq('id', att!.id);
  });
});

// ============================================================
// CASCADE DELETE
// ============================================================

describe('Cascade deletion', () => {
  it('attachment is deleted when parent post is deleted', async () => {
    // Create a temporary post + attachment
    const { data: tmpPost } = await svc
      .from('posts')
      .insert({
        ticket_id: ticketId,
        author_id: USER_ID,
        body: 'Temporary post',
        post_type: 'post',
      })
      .select('id')
      .single();

    const { data: att } = await svc
      .from('attachments')
      .insert({
        post_id: tmpPost!.id,
        storage_path: 'tickets/1/posts/tmp/cascade.png',
        original_filename: 'cascade.png',
        file_size: 100,
        mime_type: 'image/png',
      })
      .select('id')
      .single();

    // Delete the post
    await svc.from('posts').delete().eq('id', tmpPost!.id);

    // Attachment should be gone
    const { data: check } = await svc.from('attachments').select('id').eq('id', att!.id);
    expect(check?.length ?? 0).toBe(0);
  });
});

// ============================================================
// FILE METADATA
// ============================================================

describe('File metadata validation', () => {
  it('stores file metadata correctly', async () => {
    const { data, error } = await svc
      .from('attachments')
      .insert({
        post_id: postId,
        storage_path: 'tickets/1/posts/test/metadata.xlsx',
        original_filename: 'quarterly-report.xlsx',
        file_size: 1048576,
        mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .select('*')
      .single();

    expect(error).toBeNull();
    expect(data!.original_filename).toBe('quarterly-report.xlsx');
    expect(data!.file_size).toBe(1048576);
    expect(data!.mime_type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    // Clean up
    await svc.from('attachments').delete().eq('id', data!.id);
  });

  it('rejects filename exceeding 255 characters', async () => {
    const longName = 'a'.repeat(256) + '.txt';

    const { error } = await svc
      .from('attachments')
      .insert({
        post_id: postId,
        storage_path: 'tickets/1/posts/test/long.txt',
        original_filename: longName,
        file_size: 100,
        mime_type: 'text/plain',
      });

    expect(error).not.toBeNull();
  });
});

// ============================================================
// MIGRATED ATTACHMENTS (legacy_blob_id)
// ============================================================

describe('Migrated attachments (legacy_blob_id)', () => {
  it('stores migrated attachment with legacy_blob_id and no storage_path', async () => {
    const blobId = '00000000-0000-0000-0000-000000000099';

    const { data, error } = await svc
      .from('attachments')
      .insert({
        post_id: postId,
        legacy_blob_id: blobId,
        original_filename: 'migrated-report.pdf',
        file_size: 52428800, // 50 MB — above the 10 MB user limit
        mime_type: 'application/pdf',
      })
      .select('*')
      .single();

    expect(error).toBeNull();
    expect(data!.legacy_blob_id).toBe(blobId);
    expect(data!.storage_path).toBeNull();
    expect(data!.file_size).toBe(52428800);

    // Clean up
    await svc.from('attachments').delete().eq('id', data!.id);
  });

  it('rejects attachment with neither storage_path nor legacy_blob_id', async () => {
    const { error } = await svc
      .from('attachments')
      .insert({
        post_id: postId,
        original_filename: 'orphan.txt',
        file_size: 100,
        mime_type: 'text/plain',
      });

    expect(error).not.toBeNull();
  });

  it('migrated attachment inherits same post-visibility RLS as regular attachments', async () => {
    const blobId = '00000000-0000-0000-0000-0000000000aa';

    // Insert on private post (via service role)
    const { data: att } = await svc
      .from('attachments')
      .insert({
        post_id: privatePostId,
        legacy_blob_id: blobId,
        original_filename: 'private-migrated.pdf',
        file_size: 1024,
        mime_type: 'application/pdf',
      })
      .select('id')
      .single();

    // user8b has no relationship to this ticket — cannot see private post's attachment
    const user2Client = clients['user8b@test.com'];
    const { data } = await user2Client
      .from('attachments')
      .select('*')
      .eq('id', att!.id);

    expect(data?.length ?? 0).toBe(0);

    // Agent can see it
    const agentClient = clients['agent8@test.com'];
    const { data: agentData } = await agentClient
      .from('attachments')
      .select('*')
      .eq('id', att!.id);

    expect(agentData!.length).toBe(1);

    // Clean up
    await svc.from('attachments').delete().eq('id', att!.id);
  });
});
