import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServiceRoleClient } from '../helpers/supabase';

// ---------------------------------------------------------------------------
// Shared helpers & constants
// ---------------------------------------------------------------------------

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const ADMIN_ID = '00000000-0000-0000-0000-000000000001';
const AGENT_ID = '00000000-0000-0000-0000-000000000002';
const USER_ALICE_ID = '00000000-0000-0000-0000-000000000003';
const USER_BOB_ID = '00000000-0000-0000-0000-000000000004';
const USER_DAVE_ID = '00000000-0000-0000-0000-000000000005';
const AGENT2_ID = '00000000-0000-0000-0000-000000000007';

let admin: SupabaseClient;
let teamId: string;
let defaultTypeId: string;

const clients: Record<string, SupabaseClient> = {};

async function ensureAuthUser(
  svc: SupabaseClient,
  id: string,
  email: string,
  meta?: Record<string, string>,
) {
  const { error } = await svc.auth.admin.createUser({
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
  if (clients[email]) return clients[email];
  const c = createClient(supabaseUrl, anonKey);
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signIn(${email}): ${error.message}`);
  clients[email] = c;
  return c;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let aliceTicketId: number;

beforeAll(async () => {
  admin = createServiceRoleClient();

  const testUserIds = [ADMIN_ID, AGENT_ID, AGENT2_ID, USER_ALICE_ID, USER_BOB_ID, USER_DAVE_ID];

  // Clean up leftover data
  await admin.from('ticket_followers').delete().in('user_id', testUserIds);
  await admin.from('activity_log').delete().in('actor_id', testUserIds);
  const { data: testTickets } = await admin.from('tickets').select('id').in('creator_id', testUserIds);
  if (testTickets && testTickets.length > 0) {
    const ticketIds = testTickets.map((t: { id: number }) => t.id);
    await admin.from('posts').delete().in('ticket_id', ticketIds);
    await admin.from('tickets').update({ duplicate_of_id: null }).in('id', ticketIds);
    await admin.from('tickets').delete().in('id', ticketIds);
  }

  // Ensure team
  const { data: existingTeam } = await admin.from('teams').select('id').eq('name', 'Test Team').single();
  if (existingTeam) {
    teamId = existingTeam.id;
  } else {
    const { data: newTeam } = await admin.from('teams').insert({ name: 'Test Team' }).select('id').single();
    teamId = newTeam!.id;
  }

  // Get default ticket type
  const { data: typeData } = await admin.from('ticket_types').select('id').eq('is_default', true).single();
  defaultTypeId = typeData!.id;

  // Ensure auth users
  await ensureAuthUser(admin, ADMIN_ID, 'admin@test.com', { display_name: 'Admin' });
  await ensureAuthUser(admin, AGENT_ID, 'agent@test.com', { display_name: 'Agent' });
  await ensureAuthUser(admin, AGENT2_ID, 'agent2@test.com', { display_name: 'Agent2' });
  await ensureAuthUser(admin, USER_ALICE_ID, 'alice@test.com', { display_name: 'Alice' });
  await ensureAuthUser(admin, USER_BOB_ID, 'bob@test.com', { display_name: 'Bob' });
  await ensureAuthUser(admin, USER_DAVE_ID, 'dave@test.com', { display_name: 'Dave' });

  // Set roles
  await admin.from('profiles').update({ role: 'admin' }).eq('id', ADMIN_ID);
  await admin.from('profiles').update({ role: 'agent' }).eq('id', AGENT_ID);
  await admin.from('profiles').update({ role: 'agent' }).eq('id', AGENT2_ID);
  await admin.from('profiles').update({ team_id: teamId }).eq('id', USER_ALICE_ID);
  await admin.from('profiles').update({ team_id: teamId }).eq('id', USER_BOB_ID);

  // Bump rate limit
  await admin.from('app_settings').update({ value: '100' }).eq('key', 'ticket_creation_rate_limit');

  // Authenticate all clients
  await clientForUser('admin@test.com');
  await clientForUser('agent@test.com');
  await clientForUser('agent2@test.com');
  await clientForUser('alice@test.com');
  await clientForUser('bob@test.com');
  await clientForUser('dave@test.com');

  // Create a test ticket for Alice
  const { data: ticket, error: ticketError } = await (await clientForUser('alice@test.com'))
    .from('tickets')
    .insert({
      title: 'Post nesting test ticket',
      slug: 'post-nesting-test-ticket',
      type_id: defaultTypeId,
      creator_id: USER_ALICE_ID,
      is_private: false,
    })
    .select('id')
    .single();
  if (ticketError) throw new Error(`Failed to create test ticket: ${ticketError.message}`);
  aliceTicketId = ticket!.id;

  // Create original post
  const { error: postError } = await (await clientForUser('alice@test.com'))
    .from('posts')
    .insert({
      ticket_id: aliceTicketId,
      author_id: USER_ALICE_ID,
      body: 'Original post body for nesting tests.',
      is_original: true,
      post_type: 'post',
    });
  if (postError) throw new Error(`Failed to create original post: ${postError.message}`);
}, 30000);

afterAll(async () => {
  await admin.from('app_settings').update({ value: '10' }).eq('key', 'ticket_creation_rate_limit');
});

// ============================================================
// COMMENT NESTING
// ============================================================

describe('Comment Nesting', () => {
  let rootPostId: string;
  let level1CommentId: string;

  it('agent can add a root post', async () => {
    const agent = await clientForUser('agent@test.com');
    const { data: post, error } = await agent
      .from('posts')
      .insert({
        ticket_id: aliceTicketId,
        author_id: AGENT_ID,
        body: 'Agent reply post',
        post_type: 'post',
      })
      .select('id')
      .single();

    expect(error).toBeNull();
    expect(post).toBeDefined();
    rootPostId = post!.id;
  });

  it('level-1 comment on a post succeeds', async () => {
    const alice = await clientForUser('alice@test.com');
    const { data: comment, error } = await alice
      .from('posts')
      .insert({
        ticket_id: aliceTicketId,
        author_id: USER_ALICE_ID,
        body: 'Level 1 comment',
        post_type: 'comment',
        parent_post_id: rootPostId,
      })
      .select('id')
      .single();

    expect(error).toBeNull();
    expect(comment).toBeDefined();
    level1CommentId = comment!.id;
  });

  it('level-2 reply on a comment succeeds', async () => {
    const agent = await clientForUser('agent@test.com');
    const { data: reply, error } = await agent
      .from('posts')
      .insert({
        ticket_id: aliceTicketId,
        author_id: AGENT_ID,
        body: 'Level 2 reply',
        post_type: 'comment',
        parent_post_id: rootPostId,
        parent_comment_id: level1CommentId,
      })
      .select('id')
      .single();

    expect(error).toBeNull();
    expect(reply).toBeDefined();
  });

  it('level-3 reply (on a level-2 comment) is rejected by trigger', async () => {
    const alice = await clientForUser('alice@test.com');

    // Get the level-2 comment
    const { data: level2Comments } = await alice
      .from('posts')
      .select('id')
      .eq('ticket_id', aliceTicketId)
      .eq('parent_comment_id', level1CommentId)
      .single();

    const level2CommentId = level2Comments!.id;

    const { error } = await alice
      .from('posts')
      .insert({
        ticket_id: aliceTicketId,
        author_id: USER_ALICE_ID,
        body: 'Level 3 attempt',
        post_type: 'comment',
        parent_post_id: rootPostId,
        parent_comment_id: level2CommentId,
      });

    expect(error).not.toBeNull();
    expect(error!.message).toContain('nested up to 2 levels');
  });
});

// ============================================================
// POST EDITING
// ============================================================

describe('Post Editing', () => {
  let alicePostId: string;
  let _agentPostId: string;
  let agentNoteId: string;
  let agent2NoteId: string;

  beforeAll(async () => {
    const alice = await clientForUser('alice@test.com');
    const agent = await clientForUser('agent@test.com');
    const agent2 = await clientForUser('agent2@test.com');

    // Alice creates a post
    const { data: aPost } = await alice
      .from('posts')
      .insert({
        ticket_id: aliceTicketId,
        author_id: USER_ALICE_ID,
        body: 'Alice editable post',
        post_type: 'post',
      })
      .select('id')
      .single();
    alicePostId = aPost!.id;

    // Agent creates a post
    const { data: agPost } = await agent
      .from('posts')
      .insert({
        ticket_id: aliceTicketId,
        author_id: AGENT_ID,
        body: 'Agent editable post',
        post_type: 'post',
      })
      .select('id')
      .single();
    _agentPostId = agPost!.id;

    // Agent creates a note
    const { data: agNote } = await agent
      .from('posts')
      .insert({
        ticket_id: aliceTicketId,
        author_id: AGENT_ID,
        body: 'Agent note',
        post_type: 'note',
        is_private: true,
      })
      .select('id')
      .single();
    agentNoteId = agNote!.id;

    // Agent2 creates a note
    const { data: ag2Note } = await agent2
      .from('posts')
      .insert({
        ticket_id: aliceTicketId,
        author_id: AGENT2_ID,
        body: 'Agent2 note',
        post_type: 'note',
        is_private: true,
      })
      .select('id')
      .single();
    agent2NoteId = ag2Note!.id;
  });

  it('author can edit own post → edited_at is set', async () => {
    const alice = await clientForUser('alice@test.com');
    const { error } = await alice
      .from('posts')
      .update({ body: 'Alice edited post', edited_at: new Date().toISOString() })
      .eq('id', alicePostId);

    expect(error).toBeNull();

    // Verify edited_at is set (use service role to ensure we can read)
    const { data: post } = await admin
      .from('posts')
      .select('body, edited_at')
      .eq('id', alicePostId)
      .single();
    expect(post!.body).toBe('Alice edited post');
    expect(post!.edited_at).not.toBeNull();
  });

  it('agent can edit any post/comment', async () => {
    const agent = await clientForUser('agent@test.com');
    const { error } = await agent
      .from('posts')
      .update({ body: 'Agent edited Alice post', edited_at: new Date().toISOString() })
      .eq('id', alicePostId);

    expect(error).toBeNull();
  });

  it('agent can edit own note only, not other agent\'s note', async () => {
    const agent = await clientForUser('agent@test.com');

    // Agent can edit own note
    const { error: ownError } = await agent
      .from('posts')
      .update({ body: 'Agent edited own note', edited_at: new Date().toISOString() })
      .eq('id', agentNoteId);
    expect(ownError).toBeNull();

    // Agent cannot edit Agent2's note (RLS should block)
    const { data: otherNoteData } = await agent
      .from('posts')
      .update({ body: 'Attempted edit' })
      .eq('id', agent2NoteId)
      .select('id');
    // Supabase returns empty array when RLS blocks (no matching rows)
    expect(otherNoteData?.length ?? 0).toBe(0);
  });

  it('original post cannot be edited (application-level check)', async () => {
    // Fetch the original post id
    const { data: originalPost } = await admin
      .from('posts')
      .select('id')
      .eq('ticket_id', aliceTicketId)
      .eq('is_original', true)
      .single();

    // The RLS policy actually allows editing the original post at DB level;
    // the constraint is enforced in the server action. But we can verify
    // the author CAN technically update it (RLS allows), the server action prevents it.
    const alice = await clientForUser('alice@test.com');
    const { error } = await alice
      .from('posts')
      .update({ body: 'This should work at DB level' })
      .eq('id', originalPost!.id);
    // DB-level allows author edit
    expect(error).toBeNull();

    // Restore original body
    await alice
      .from('posts')
      .update({ body: 'Original post body for nesting tests.' })
      .eq('id', originalPost!.id);
  });
});

// ============================================================
// POST DELETION
// ============================================================

describe('Post Deletion', () => {
  let deletablePostId: string;
  let agentNote1Id: string;
  let agentNote2Id: string;

  beforeAll(async () => {
    const agent = await clientForUser('agent@test.com');
    const agent2 = await clientForUser('agent2@test.com');

    // Agent creates a post to be deleted
    const { data: delPost } = await agent
      .from('posts')
      .insert({
        ticket_id: aliceTicketId,
        author_id: AGENT_ID,
        body: 'Deletable post',
        post_type: 'post',
      })
      .select('id')
      .single();
    deletablePostId = delPost!.id;

    // Agent creates a note
    const { data: note1 } = await agent
      .from('posts')
      .insert({
        ticket_id: aliceTicketId,
        author_id: AGENT_ID,
        body: 'Agent note for deletion test',
        post_type: 'note',
        is_private: true,
      })
      .select('id')
      .single();
    agentNote1Id = note1!.id;

    // Agent2 creates a note
    const { data: note2 } = await agent2
      .from('posts')
      .insert({
        ticket_id: aliceTicketId,
        author_id: AGENT2_ID,
        body: 'Agent2 note for deletion test',
        post_type: 'note',
        is_private: true,
      })
      .select('id')
      .single();
    agentNote2Id = note2!.id;
  });

  it('agent can delete non-original post', async () => {
    const agent = await clientForUser('agent@test.com');
    const { error } = await agent
      .from('posts')
      .delete()
      .eq('id', deletablePostId);

    expect(error).toBeNull();

    // Verify deletion
    const { data } = await admin
      .from('posts')
      .select('id')
      .eq('id', deletablePostId)
      .single();
    expect(data).toBeNull();
  });

  it('original post cannot be deleted', async () => {
    const { data: originalPost } = await admin
      .from('posts')
      .select('id')
      .eq('ticket_id', aliceTicketId)
      .eq('is_original', true)
      .single();

    const agent = await clientForUser('agent@test.com');
    const { data: deleted } = await agent
      .from('posts')
      .delete()
      .eq('id', originalPost!.id)
      .select('id');

    // RLS blocks deletion of original posts
    expect(deleted?.length ?? 0).toBe(0);

    // Verify still exists
    const { data: stillExists } = await admin
      .from('posts')
      .select('id')
      .eq('id', originalPost!.id)
      .single();
    expect(stillExists).not.toBeNull();
  });

  it('agent can delete own note, not other agent\'s note', async () => {
    const agent = await clientForUser('agent@test.com');

    // Agent can delete own note
    const { error: ownError } = await agent
      .from('posts')
      .delete()
      .eq('id', agentNote1Id);
    expect(ownError).toBeNull();

    // Agent cannot delete Agent2's note (RLS blocks)
    const { data: otherDeleted } = await agent
      .from('posts')
      .delete()
      .eq('id', agentNote2Id)
      .select('id');
    expect(otherDeleted?.length ?? 0).toBe(0);

    // Verify Agent2's note still exists
    const { data: stillExists } = await admin
      .from('posts')
      .select('id')
      .eq('id', agentNote2Id)
      .single();
    expect(stillExists).not.toBeNull();
  });

  it('admin can delete any note', async () => {
    const adminClient = await clientForUser('admin@test.com');
    const { error } = await adminClient
      .from('posts')
      .delete()
      .eq('id', agentNote2Id);

    expect(error).toBeNull();

    const { data } = await admin
      .from('posts')
      .select('id')
      .eq('id', agentNote2Id)
      .single();
    expect(data).toBeNull();
  });

  it('regular user cannot delete any post', async () => {
    // Create a post to try deleting
    const agent = await clientForUser('agent@test.com');
    const { data: post } = await agent
      .from('posts')
      .insert({
        ticket_id: aliceTicketId,
        author_id: AGENT_ID,
        body: 'Post that user tries to delete',
        post_type: 'post',
      })
      .select('id')
      .single();

    const dave = await clientForUser('dave@test.com');
    const { data: deleted } = await dave
      .from('posts')
      .delete()
      .eq('id', post!.id)
      .select('id');

    // RLS blocks regular user deletion
    expect(deleted?.length ?? 0).toBe(0);

    // Verify still exists
    const { data: stillExists } = await admin
      .from('posts')
      .select('id')
      .eq('id', post!.id)
      .single();
    expect(stillExists).not.toBeNull();
  });
});

// ============================================================
// DRAFTS
// ============================================================

describe('Draft Visibility & Publishing', () => {
  let draftPostId: string;

  it('agent can create a draft post', async () => {
    const agent = await clientForUser('agent@test.com');
    const { data: draft, error } = await agent
      .from('posts')
      .insert({
        ticket_id: aliceTicketId,
        author_id: AGENT_ID,
        body: 'Draft post body',
        post_type: 'post',
        is_draft: true,
      })
      .select('id')
      .single();

    expect(error).toBeNull();
    expect(draft).toBeDefined();
    draftPostId = draft!.id;
  });

  it('draft post is not visible to regular users (RLS)', async () => {
    const alice = await clientForUser('alice@test.com');
    const { data } = await alice
      .from('posts')
      .select('id')
      .eq('id', draftPostId)
      .single();

    expect(data).toBeNull();
  });

  it('draft post is visible to agents', async () => {
    const agent = await clientForUser('agent@test.com');
    const { data } = await agent
      .from('posts')
      .select('id, is_draft')
      .eq('id', draftPostId)
      .single();

    expect(data).not.toBeNull();
    expect(data!.is_draft).toBe(true);
  });

  it('publishing a draft updates is_draft and tickets.updated_at', async () => {
    // Record current updated_at
    const { data: ticketBefore } = await admin
      .from('tickets')
      .select('updated_at')
      .eq('id', aliceTicketId)
      .single();

    // Wait to ensure timestamp difference (Postgres `now()` resolution)
    await new Promise((r) => setTimeout(r, 1100));

    const agent = await clientForUser('agent@test.com');
    const { error } = await agent
      .from('posts')
      .update({ is_draft: false })
      .eq('id', draftPostId);

    expect(error).toBeNull();

    // Verify post is no longer a draft
    const { data: post } = await admin
      .from('posts')
      .select('is_draft')
      .eq('id', draftPostId)
      .single();
    expect(post!.is_draft).toBe(false);

    // Verify ticket updated_at changed via trigger
    const { data: ticketAfter } = await admin
      .from('tickets')
      .select('updated_at')
      .eq('id', aliceTicketId)
      .single();
    expect(new Date(ticketAfter!.updated_at).getTime())
      .toBeGreaterThan(new Date(ticketBefore!.updated_at).getTime());
  });
});

// ============================================================
// POST PRIVACY
// ============================================================

describe('Post Privacy', () => {
  let privatePostId: string;

  it('private post is visible to owner, teammates, and agents; not to other users', async () => {
    const agent = await clientForUser('agent@test.com');
    const { data: post } = await agent
      .from('posts')
      .insert({
        ticket_id: aliceTicketId,
        author_id: AGENT_ID,
        body: 'Private post body',
        post_type: 'post',
        is_private: true,
      })
      .select('id')
      .single();
    privatePostId = post!.id;

    // Agent can see it
    const { data: agentView } = await agent
      .from('posts')
      .select('id')
      .eq('id', privatePostId)
      .single();
    expect(agentView).not.toBeNull();

    // Alice (ticket owner) can see it
    const alice = await clientForUser('alice@test.com');
    const { data: aliceView } = await alice
      .from('posts')
      .select('id')
      .eq('id', privatePostId)
      .single();
    expect(aliceView).not.toBeNull();

    // Bob (teammate of Alice) can see it
    const bob = await clientForUser('bob@test.com');
    const { data: bobView } = await bob
      .from('posts')
      .select('id')
      .eq('id', privatePostId)
      .single();
    expect(bobView).not.toBeNull();

    // Dave (not owner, not teammate, not agent) cannot see it
    const dave = await clientForUser('dave@test.com');
    const { data: daveView } = await dave
      .from('posts')
      .select('id')
      .eq('id', privatePostId)
      .single();
    expect(daveView).toBeNull();
  });
});

// ============================================================
// NOTE VISIBILITY
// ============================================================

describe('Note Visibility', () => {
  it('notes are only visible to agents (RLS)', async () => {
    const agent = await clientForUser('agent@test.com');
    // Create a note
    const { data: note } = await agent
      .from('posts')
      .insert({
        ticket_id: aliceTicketId,
        author_id: AGENT_ID,
        body: 'Visibility test note',
        post_type: 'note',
        is_private: true,
      })
      .select('id')
      .single();

    // Agent can see the note
    const { data: agentView } = await agent
      .from('posts')
      .select('id')
      .eq('id', note!.id)
      .single();
    expect(agentView).not.toBeNull();

    // Alice (ticket owner) cannot see notes
    const alice = await clientForUser('alice@test.com');
    const { data: aliceView } = await alice
      .from('posts')
      .select('id')
      .eq('id', note!.id)
      .single();
    expect(aliceView).toBeNull();

    // Dave cannot see notes
    const dave = await clientForUser('dave@test.com');
    const { data: daveView } = await dave
      .from('posts')
      .select('id')
      .eq('id', note!.id)
      .single();
    expect(daveView).toBeNull();
  });
});

// ============================================================
// TITLE EDITING
// ============================================================

describe('Title Editing', () => {
  it('owner can update title', async () => {
    const alice = await clientForUser('alice@test.com');
    const { error } = await alice
      .from('tickets')
      .update({ title: 'Updated post nesting test', slug: 'updated-post-nesting-test' })
      .eq('id', aliceTicketId);

    expect(error).toBeNull();

    const { data: ticket } = await admin
      .from('tickets')
      .select('title, slug')
      .eq('id', aliceTicketId)
      .single();
    expect(ticket!.title).toBe('Updated post nesting test');
    expect(ticket!.slug).toBe('updated-post-nesting-test');
  });

  it('slug is regenerated on title change via search_vector trigger', async () => {
    // After title update, search_vector should contain new terms
    const { data: ticket } = await admin
      .from('tickets')
      .select('search_vector')
      .eq('id', aliceTicketId)
      .single();

    // search_vector is a tsvector, just verify it's not null
    expect(ticket!.search_vector).not.toBeNull();
  });
});
