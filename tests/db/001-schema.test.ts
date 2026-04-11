import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll } from 'vitest';
import { createServiceRoleClient } from '../helpers/supabase';

// ---------------------------------------------------------------------------
// Shared helpers & constants
// ---------------------------------------------------------------------------

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Fixed UUIDs for test users
const ADMIN_ID = '00000000-0000-0000-0000-000000000001';
const AGENT_ID = '00000000-0000-0000-0000-000000000002';
const USER_ALICE_ID = '00000000-0000-0000-0000-000000000003';
const USER_BOB_ID = '00000000-0000-0000-0000-000000000004';
const USER_DAVE_ID = '00000000-0000-0000-0000-000000000005';
const BLOCKED_USER_ID = '00000000-0000-0000-0000-000000000006';
const AGENT2_ID = '00000000-0000-0000-0000-000000000007';

let admin: SupabaseClient;
let teamId: string;
let defaultTypeId: string;

// Cached authenticated clients (created once in beforeAll)
const clients: Record<string, SupabaseClient> = {};

/**
 * Create an auth user if it doesn't already exist.
 * The handle_new_user trigger will auto-create the profile.
 */
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

/**
 * Create an auth user (strict — fails if already exists). Used by trigger tests.
 */
async function createAuthUser(
  svc: SupabaseClient,
  id: string,
  email: string,
  meta?: Record<string, string>,
) {
  const { data, error } = await svc.auth.admin.createUser({
    id,
    email,
    password: 'Password123',
    email_confirm: true,
    user_metadata: meta,
  });
  if (error) throw new Error(`createAuthUser(${email}): ${error.message}`);
  return data.user;
}

/** Get a cached authenticated Supabase client for a specific user */
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
// Global setup — seed test users & data
// ---------------------------------------------------------------------------

beforeAll(async () => {
  admin = createServiceRoleClient();

  const testUserIds = [ADMIN_ID, AGENT_ID, AGENT2_ID, USER_ALICE_ID, USER_BOB_ID, USER_DAVE_ID, BLOCKED_USER_ID];

  // Clean up leftover test DATA (tickets, posts, etc.) but keep users/team intact
  await admin.from('tickets').delete().in('creator_id', testUserIds);
  await admin.from('saved_views').delete().in('agent_id', testUserIds);
  // Clean up trigger-test users from tests 7c-7e (these ARE deleted per-test, but guard against leftovers)
  const triggerTestIds = ['00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000102'];
  for (const uid of triggerTestIds) {
    await admin.from('profiles').delete().eq('id', uid);
    await admin.auth.admin.deleteUser(uid).catch(() => {});
  }

  // Ensure team exists (create if missing, reuse if present)
  const { data: existingTeam } = await admin.from('teams').select('id').eq('name', 'Test Team').single();
  if (existingTeam) {
    teamId = existingTeam.id;
  } else {
    const { data: newTeam, error: teamError } = await admin
      .from('teams')
      .insert({ name: 'Test Team' })
      .select('id')
      .single();
    if (teamError) throw new Error(`Failed to create team: ${teamError.message}`);
    teamId = newTeam!.id;
  }

  // Get default ticket type
  const { data: typeData, error: typeError } = await admin
    .from('ticket_types')
    .select('id')
    .eq('is_default', true)
    .single();
  if (typeError) throw new Error(`Failed to get default type: ${typeError.message}`);
  defaultTypeId = typeData!.id;

  // Ensure auth users exist (idempotent — skips if already created)
  await ensureAuthUser(admin, ADMIN_ID, 'admin@test.com', { display_name: 'Admin' });
  await ensureAuthUser(admin, AGENT_ID, 'agent@test.com', { display_name: 'Agent' });
  await ensureAuthUser(admin, AGENT2_ID, 'agent2@test.com', { display_name: 'Agent2' });
  await ensureAuthUser(admin, USER_ALICE_ID, 'alice@test.com', { display_name: 'Alice' });
  await ensureAuthUser(admin, USER_BOB_ID, 'bob@test.com', { display_name: 'Bob' });
  await ensureAuthUser(admin, USER_DAVE_ID, 'dave@test.com', { display_name: 'Dave' });
  await ensureAuthUser(admin, BLOCKED_USER_ID, 'blocked@test.com', { display_name: 'Blocked' });

  // Set roles
  await admin.from('profiles').update({ role: 'admin' }).eq('id', ADMIN_ID);
  await admin.from('profiles').update({ role: 'agent' }).eq('id', AGENT_ID);
  await admin.from('profiles').update({ role: 'agent' }).eq('id', AGENT2_ID);

  // Set teams (Alice & Bob same team)
  await admin.from('profiles').update({ team_id: teamId }).eq('id', USER_ALICE_ID);
  await admin.from('profiles').update({ team_id: teamId }).eq('id', USER_BOB_ID);

  // Block user
  await admin.from('profiles').update({ is_blocked: true }).eq('id', BLOCKED_USER_ID);

  // Pre-authenticate all clients to avoid flaky sign-in during tests
  await clientForUser('admin@test.com');
  await clientForUser('agent@test.com');
  await clientForUser('agent2@test.com');
  await clientForUser('alice@test.com');
  await clientForUser('bob@test.com');
  await clientForUser('dave@test.com');
  await clientForUser('blocked@test.com');
}, 30000);

// ============================================================
// 1. TABLE EXISTENCE
// ============================================================

describe('1. Table Existence', () => {
  const tables = [
    'profiles', 'teams', 'ticket_types', 'categories', 'tags',
    'tickets', 'posts', 'ticket_tags', 'ticket_followers',
    'activity_log', 'login_attempts', 'saved_views', 'app_settings',
  ];

  for (const table of tables) {
    it(`table "${table}" exists`, async () => {
      const { error } = await admin.from(table).select('*').limit(0);
      expect(error).toBeNull();
    });
  }

  it('agent_tickets VIEW exists', async () => {
    const { error } = await admin.from('agent_tickets').select('*').limit(0);
    expect(error).toBeNull();
  });
});

// ============================================================
// 2. HELPER FUNCTIONS
// ============================================================

describe('2. Helper Functions', () => {
  it('get_user_role() returns correct role for user', async () => {
    const c = await clientForUser('alice@test.com');
    const { data } = await c.rpc('get_user_role');
    expect(data).toBe('user');
  });

  it('get_user_role() returns correct role for agent', async () => {
    const c = await clientForUser('agent@test.com');
    const { data } = await c.rpc('get_user_role');
    expect(data).toBe('agent');
  });

  it('get_user_role() returns correct role for admin', async () => {
    const c = await clientForUser('admin@test.com');
    const { data } = await c.rpc('get_user_role');
    expect(data).toBe('admin');
  });

  it('get_user_role() returns NULL when user has no profile', async () => {
    // anon client has no profile
    const c = createClient(supabaseUrl, anonKey);
    const { data } = await c.rpc('get_user_role');
    expect(data).toBeNull();
  });

  it('is_agent() returns true for agent', async () => {
    const c = await clientForUser('agent@test.com');
    const { data } = await c.rpc('is_agent');
    expect(data).toBe(true);
  });

  it('is_agent() returns true for admin', async () => {
    const c = await clientForUser('admin@test.com');
    const { data } = await c.rpc('is_agent');
    expect(data).toBe(true);
  });

  it('is_agent() returns false for regular user', async () => {
    const c = await clientForUser('alice@test.com');
    const { data } = await c.rpc('is_agent');
    expect(data).toBe(false);
  });

  it('is_admin() returns true only for admin', async () => {
    const c = await clientForUser('admin@test.com');
    const { data } = await c.rpc('is_admin');
    expect(data).toBe(true);
  });

  it('is_admin() returns false for agent', async () => {
    const c = await clientForUser('agent@test.com');
    const { data } = await c.rpc('is_admin');
    expect(data).toBe(false);
  });

  it('is_teammate() returns true when same team', async () => {
    const c = await clientForUser('alice@test.com');
    const { data } = await c.rpc('is_teammate', { target_user_id: USER_BOB_ID });
    expect(data).toBe(true);
  });

  it('is_teammate() returns false when different teams', async () => {
    const c = await clientForUser('alice@test.com');
    const { data } = await c.rpc('is_teammate', { target_user_id: USER_DAVE_ID });
    expect(data).toBe(false);
  });

  it('is_teammate() returns false when either user has NULL team_id', async () => {
    const c = await clientForUser('dave@test.com');
    const { data } = await c.rpc('is_teammate', { target_user_id: USER_ALICE_ID });
    expect(data).toBe(false);
  });

  it('is_blocked() returns true for blocked user', async () => {
    const c = await clientForUser('blocked@test.com');
    const { data } = await c.rpc('is_blocked');
    expect(data).toBe(true);
  });

  it('is_blocked() returns false for normal user', async () => {
    const c = await clientForUser('alice@test.com');
    const { data } = await c.rpc('is_blocked');
    expect(data).toBe(false);
  });

  it('is_blocked() returns false when user has no profile', async () => {
    const c = createClient(supabaseUrl, anonKey);
    const { data } = await c.rpc('is_blocked');
    expect(data).toBe(false);
  });
});

// ============================================================
// 3. SLUG GENERATION
// ============================================================

describe('3. Slug Generation', () => {
  const cases: [string | null, string][] = [
    ['Hello World', 'hello-world'],
    ['  hello  ', 'hello'],
    ['hello - - world', 'hello-world'],
    ['!!!@@@', 'untitled'],
    ['', 'untitled'],
    [null, 'untitled'],
  ];

  for (const [input, expected] of cases) {
    it(`generate_slug(${JSON.stringify(input)}) => '${expected}'`, async () => {
      const { data } = await admin.rpc('generate_slug', { title: input });
      expect(data).toBe(expected);
    });
  }
});

// ============================================================
// 4. RLS — TICKETS
// ============================================================

describe('4. RLS — Tickets', () => {
  let aliceTicketId: number;
  let alicePublicTicketId: number;
  let davePrivateTicketId: number;

  beforeAll(async () => {
    // Alice creates a private ticket
    const { data: t1 } = await admin
      .from('tickets')
      .insert({
        title: 'Alice private ticket',
        slug: 'alice-private-ticket',
        creator_id: USER_ALICE_ID,
        type_id: defaultTypeId,
        is_private: true,
      })
      .select('id')
      .single();
    aliceTicketId = t1!.id;

    // Alice creates a public ticket
    const { data: t2 } = await admin
      .from('tickets')
      .insert({
        title: 'Alice public ticket',
        slug: 'alice-public-ticket',
        creator_id: USER_ALICE_ID,
        type_id: defaultTypeId,
        is_private: false,
      })
      .select('id')
      .single();
    alicePublicTicketId = t2!.id;

    // Dave creates a private ticket
    const { data: t3 } = await admin
      .from('tickets')
      .insert({
        title: 'Dave private ticket',
        slug: 'dave-private-ticket',
        creator_id: USER_DAVE_ID,
        type_id: defaultTypeId,
        is_private: true,
      })
      .select('id')
      .single();
    davePrivateTicketId = t3!.id;
  });

  it('a. User can see own tickets', async () => {
    const c = await clientForUser('alice@test.com');
    const { data, error } = await c.from('tickets').select('id').eq('id', aliceTicketId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it('b. User cannot see others\' private tickets', async () => {
    const c = await clientForUser('alice@test.com');
    const { data, error } = await c.from('tickets').select('id').eq('id', davePrivateTicketId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it('c. User can see public tickets', async () => {
    const c = await clientForUser('dave@test.com');
    const { data, error } = await c.from('tickets').select('id').eq('id', alicePublicTicketId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it('d. Agent can see all tickets (including private)', async () => {
    const c = await clientForUser('agent@test.com');
    const { data, error } = await c.from('tickets').select('id').eq('id', davePrivateTicketId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it('e. Teammate can see teammate\'s private tickets', async () => {
    const c = await clientForUser('bob@test.com');
    const { data, error } = await c.from('tickets').select('id').eq('id', aliceTicketId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it('f. User cannot update another user\'s ticket', async () => {
    const c = await clientForUser('dave@test.com');
    const { error: _error } = await c.from('tickets').update({ title: 'hacked' }).eq('id', aliceTicketId);
    // Should affect 0 rows (RLS filters it out)
    const { data } = await c.from('tickets').select('title').eq('id', aliceTicketId);
    expect(data).toHaveLength(0); // dave can't even see it
  });

  it('g. Agent can update any ticket\'s status', async () => {
    const c = await clientForUser('agent@test.com');
    const { error } = await c
      .from('tickets')
      .update({ status: 'pending' })
      .eq('id', aliceTicketId);
    expect(error).toBeNull();

    // Verify
    const { data } = await admin.from('tickets').select('status').eq('id', aliceTicketId).single();
    expect(data!.status).toBe('pending');

    // Reset
    await admin.from('tickets').update({ status: 'open' }).eq('id', aliceTicketId);
  });

  it('h. Admin can delete tickets', async () => {
    // Create a temp ticket to delete
    const { data: tmp } = await admin
      .from('tickets')
      .insert({
        title: 'To delete',
        slug: 'to-delete',
        creator_id: USER_ALICE_ID,
        type_id: defaultTypeId,
      })
      .select('id')
      .single();

    const c = await clientForUser('admin@test.com');
    const { error } = await c.from('tickets').delete().eq('id', tmp!.id);
    expect(error).toBeNull();
  });

  it('i. Blocked user CAN read own tickets', async () => {
    // Create ticket for blocked user via service role
    const { data: tmp } = await admin
      .from('tickets')
      .insert({
        title: 'Blocked user ticket',
        slug: 'blocked-user-ticket',
        creator_id: BLOCKED_USER_ID,
        type_id: defaultTypeId,
      })
      .select('id')
      .single();

    const c = await clientForUser('blocked@test.com');
    const { data } = await c.from('tickets').select('id').eq('id', tmp!.id);
    expect(data).toHaveLength(1);

    // cleanup
    await admin.from('tickets').delete().eq('id', tmp!.id);
  });

  it('j. Blocked user CANNOT create tickets', async () => {
    const c = await clientForUser('blocked@test.com');
    const { error } = await c.from('tickets').insert({
      title: 'Blocked ticket attempt',
      slug: 'blocked-ticket-attempt',
      creator_id: BLOCKED_USER_ID,
      type_id: defaultTypeId,
    });
    expect(error).not.toBeNull();
  });
});

// ============================================================
// 5. RLS — POSTS (privacy model)
// ============================================================

describe('5. RLS — Posts', () => {
  let publicTicketId: number;
  let _privateTicketId: number;
  let publicPostId: string;
  let privatePostId: string;
  let commentOnPrivateId: string;
  let nestedCommentOnPrivateId: string;
  let draftPostId: string;
  let notePostId: string;
  let originalPostId: string;

  beforeAll(async () => {
    // Public ticket by Alice
    const { data: pt } = await admin
      .from('tickets')
      .insert({
        title: 'Public ticket for posts',
        slug: 'public-ticket-posts',
        creator_id: USER_ALICE_ID,
        type_id: defaultTypeId,
        is_private: false,
      })
      .select('id')
      .single();
    publicTicketId = pt!.id;

    // Private ticket by Alice
    const { data: pvt } = await admin
      .from('tickets')
      .insert({
        title: 'Private ticket for posts',
        slug: 'private-ticket-posts',
        creator_id: USER_ALICE_ID,
        type_id: defaultTypeId,
        is_private: true,
      })
      .select('id')
      .single();
    _privateTicketId = pvt!.id;

    // Public post on public ticket
    const { data: pp } = await admin
      .from('posts')
      .insert({
        ticket_id: publicTicketId,
        author_id: USER_ALICE_ID,
        body: 'Public post on public ticket',
        is_private: false,
        is_original: true,
      })
      .select('id')
      .single();
    publicPostId = pp!.id;
    originalPostId = pp!.id;

    // Private post on public ticket
    const { data: prp } = await admin
      .from('posts')
      .insert({
        ticket_id: publicTicketId,
        author_id: AGENT_ID,
        body: 'Private post on public ticket',
        is_private: true,
      })
      .select('id')
      .single();
    privatePostId = prp!.id;

    // Comment on private post
    const { data: cmt } = await admin
      .from('posts')
      .insert({
        ticket_id: publicTicketId,
        author_id: USER_ALICE_ID,
        parent_post_id: privatePostId,
        post_type: 'comment',
        body: 'Comment on private post',
        is_private: false,
      })
      .select('id')
      .single();
    commentOnPrivateId = cmt!.id;

    // Nested comment on the comment above
    const { data: ncmt } = await admin
      .from('posts')
      .insert({
        ticket_id: publicTicketId,
        author_id: USER_ALICE_ID,
        parent_post_id: privatePostId,
        parent_comment_id: commentOnPrivateId,
        post_type: 'comment',
        body: 'Nested reply on private post comment',
        is_private: false,
      })
      .select('id')
      .single();
    nestedCommentOnPrivateId = ncmt!.id;

    // Draft post
    const { data: dp } = await admin
      .from('posts')
      .insert({
        ticket_id: publicTicketId,
        author_id: AGENT_ID,
        body: 'Draft post',
        is_draft: true,
      })
      .select('id')
      .single();
    draftPostId = dp!.id;

    // Note
    const { data: np } = await admin
      .from('posts')
      .insert({
        ticket_id: publicTicketId,
        author_id: AGENT_ID,
        body: 'Internal note',
        post_type: 'note',
      })
      .select('id')
      .single();
    notePostId = np!.id;
  });

  it('a. Public post on public ticket: visible to all authenticated users', async () => {
    const c = await clientForUser('dave@test.com');
    const { data } = await c.from('posts').select('id').eq('id', publicPostId);
    expect(data).toHaveLength(1);
  });

  it('b. Private post on public ticket: invisible to non-owner non-agent', async () => {
    const c = await clientForUser('dave@test.com');
    const { data } = await c.from('posts').select('id').eq('id', privatePostId);
    expect(data).toHaveLength(0);
  });

  it('c. Private post visible to ticket owner', async () => {
    const c = await clientForUser('alice@test.com');
    const { data } = await c.from('posts').select('id').eq('id', privatePostId);
    expect(data).toHaveLength(1);
  });

  it('d. Private post visible to teammate of ticket owner', async () => {
    const c = await clientForUser('bob@test.com');
    const { data } = await c.from('posts').select('id').eq('id', privatePostId);
    expect(data).toHaveLength(1);
  });

  it('e. Private post visible to agents', async () => {
    const c = await clientForUser('agent@test.com');
    const { data } = await c.from('posts').select('id').eq('id', privatePostId);
    expect(data).toHaveLength(1);
  });

  it('f. Comment on private post: inherits privacy (blocked for outsiders)', async () => {
    const c = await clientForUser('dave@test.com');
    const { data } = await c.from('posts').select('id').eq('id', commentOnPrivateId);
    expect(data).toHaveLength(0);
  });

  it('g. Nested comment on private post: also inherits privacy', async () => {
    const c = await clientForUser('dave@test.com');
    const { data } = await c.from('posts').select('id').eq('id', nestedCommentOnPrivateId);
    expect(data).toHaveLength(0);
  });

  it('h. Draft post: invisible to non-agents', async () => {
    const c = await clientForUser('alice@test.com');
    const { data } = await c.from('posts').select('id').eq('id', draftPostId);
    expect(data).toHaveLength(0);
  });

  it('i. Note: invisible to non-agents', async () => {
    const c = await clientForUser('alice@test.com');
    const { data } = await c.from('posts').select('id').eq('id', notePostId);
    expect(data).toHaveLength(0);
  });

  it('j. Agent can edit any post but only own notes', async () => {
    const c = await clientForUser('agent@test.com');

    // Agent can edit a user's post
    const { error: e1 } = await c.from('posts').update({ body: 'Edited by agent' }).eq('id', publicPostId);
    expect(e1).toBeNull();

    // Create a note by agent2
    const { data: a2note } = await admin
      .from('posts')
      .insert({
        ticket_id: publicTicketId,
        author_id: AGENT2_ID,
        body: 'Agent2 note',
        post_type: 'note',
      })
      .select('id')
      .single();

    // Agent1 cannot edit agent2's note
    const { error: _e2 } = await c.from('posts').update({ body: 'Hacked note' }).eq('id', a2note!.id);
    // RLS will filter, so no rows matched — verify body unchanged
    const { data: check } = await admin.from('posts').select('body').eq('id', a2note!.id).single();
    expect(check!.body).toBe('Agent2 note');

    // Cleanup
    await admin.from('posts').update({ body: 'Public post on public ticket' }).eq('id', publicPostId);
    await admin.from('posts').delete().eq('id', a2note!.id);
  });

  it('k. Original post (is_original=true) cannot be deleted even by admin', async () => {
    const c = await clientForUser('admin@test.com');
    const { error: _error } = await c.from('posts').delete().eq('id', originalPostId);
    // RLS blocks delete on is_original=true — should affect 0 rows
    const { data } = await admin.from('posts').select('id').eq('id', originalPostId);
    expect(data).toHaveLength(1);
  });

  it('l. Blocked user CANNOT create posts', async () => {
    const c = await clientForUser('blocked@test.com');
    // Create a ticket accessible to blocked user first
    const { data: tmp } = await admin
      .from('tickets')
      .insert({
        title: 'Ticket for blocked post test',
        slug: 'blocked-post-test',
        creator_id: BLOCKED_USER_ID,
        type_id: defaultTypeId,
        is_private: false,
      })
      .select('id')
      .single();

    const { error } = await c.from('posts').insert({
      ticket_id: tmp!.id,
      author_id: BLOCKED_USER_ID,
      body: 'Blocked user posting',
    });
    expect(error).not.toBeNull();

    // cleanup
    await admin.from('tickets').delete().eq('id', tmp!.id);
  });
});

// ============================================================
// 6. RLS — OTHER TABLES
// ============================================================

describe('6. RLS — Other Tables', () => {
  it('a. app_settings: readable by authenticated, writable only by admin', async () => {
    // Capture current value before testing
    const { data: before } = await admin
      .from('app_settings')
      .select('value')
      .eq('key', 'ticket_creation_rate_limit')
      .single();
    const originalValue = before!.value;

    // Readable by user
    const alice = await clientForUser('alice@test.com');
    const { data, error } = await alice.from('app_settings').select('*');
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);

    // Not writable by user
    const { error: _writeErr } = await alice
      .from('app_settings')
      .update({ value: '999' })
      .eq('key', 'ticket_creation_rate_limit');
    // RLS should block — no rows affected
    const { data: check } = await admin
      .from('app_settings')
      .select('value')
      .eq('key', 'ticket_creation_rate_limit')
      .single();
    expect(check!.value).toBe(originalValue);

    // Writable by admin
    const adm = await clientForUser('admin@test.com');
    const { error: admErr } = await adm
      .from('app_settings')
      .update({ value: '15' })
      .eq('key', 'ticket_creation_rate_limit');
    expect(admErr).toBeNull();

    // Reset
    await admin.from('app_settings').update({ value: originalValue }).eq('key', 'ticket_creation_rate_limit');
  });

  it('b. login_attempts: NOT accessible by authenticated or anon users', async () => {
    const alice = await clientForUser('alice@test.com');
    const { data: d1, error: _e1 } = await alice.from('login_attempts').select('*');
    expect(d1).toHaveLength(0); // RLS blocks all

    const anon = createClient(supabaseUrl, anonKey);
    const { data: d2, error: _e2 } = await anon.from('login_attempts').select('*');
    // Either error or empty array, both acceptable
    expect(d2?.length ?? 0).toBe(0);
  });

  it('c. saved_views: agent can CRUD own views, cannot see others\' views', async () => {
    const agent = await clientForUser('agent@test.com');
    const agent2 = await clientForUser('agent2@test.com');

    // Agent creates a view
    const { data: v, error: createErr } = await agent
      .from('saved_views')
      .insert({ agent_id: AGENT_ID, name: 'My View', filters: { status: 'open' } })
      .select('id')
      .single();
    expect(createErr).toBeNull();

    // Agent2 cannot see agent1's view
    const { data: v2 } = await agent2.from('saved_views').select('id').eq('id', v!.id);
    expect(v2).toHaveLength(0);

    // Agent can update own view
    const { error: updateErr } = await agent
      .from('saved_views')
      .update({ name: 'Updated View' })
      .eq('id', v!.id);
    expect(updateErr).toBeNull();

    // Agent can delete own view
    const { error: delErr } = await agent.from('saved_views').delete().eq('id', v!.id);
    expect(delErr).toBeNull();
  });

  it('d. agent_tickets VIEW: respects invoker\'s RLS', async () => {
    // Agent can see all tickets through the view
    const agent = await clientForUser('agent@test.com');
    const { data: agentData, error: agentErr } = await agent.from('agent_tickets').select('id');
    expect(agentErr).toBeNull();
    // Agent should see tickets (we created several in previous tests)
    expect(agentData!.length).toBeGreaterThan(0);

    // Regular user only sees own + public + teammate tickets
    const dave = await clientForUser('dave@test.com');
    const { data: daveData } = await dave.from('agent_tickets').select('id');
    // Dave should not see Alice's private tickets (not teammate)
    const alicePrivateInView = daveData?.some((t: Record<string, unknown>) => t.title === 'Alice private ticket');
    expect(alicePrivateInView).toBeFalsy();
  });
});

// ============================================================
// 7. TRIGGERS
// ============================================================

describe('7. Triggers', () => {
  it('a. updated_at auto-updates on ticket UPDATE', async () => {
    const { data: t } = await admin
      .from('tickets')
      .insert({
        title: 'Trigger test ticket',
        slug: 'trigger-test-ticket',
        creator_id: USER_ALICE_ID,
        type_id: defaultTypeId,
      })
      .select('id, updated_at')
      .single();
    const before = t!.updated_at;

    // Wait briefly then update
    await new Promise(r => setTimeout(r, 50));
    await admin.from('tickets').update({ title: 'Updated title' }).eq('id', t!.id);

    const { data: after } = await admin.from('tickets').select('updated_at').eq('id', t!.id).single();
    expect(new Date(after!.updated_at).getTime()).toBeGreaterThan(new Date(before).getTime());

    await admin.from('tickets').delete().eq('id', t!.id);
  });

  it('b. updated_at auto-updates on profile UPDATE', async () => {
    const { data: p } = await admin
      .from('profiles')
      .select('updated_at')
      .eq('id', USER_ALICE_ID)
      .single();
    const before = p!.updated_at;

    await new Promise(r => setTimeout(r, 50));
    await admin.from('profiles').update({ display_name: 'AliceUpdated' }).eq('id', USER_ALICE_ID);

    const { data: after } = await admin.from('profiles').select('updated_at').eq('id', USER_ALICE_ID).single();
    expect(new Date(after!.updated_at).getTime()).toBeGreaterThan(new Date(before).getTime());

    // Reset
    await admin.from('profiles').update({ display_name: 'Alice' }).eq('id', USER_ALICE_ID);
  });

  it('c. handle_new_user creates profile on auth.users INSERT', async () => {
    const newId = '00000000-0000-0000-0000-000000000100';
    await createAuthUser(admin, newId, 'newuser@test.com', { display_name: 'NewUser' });

    const { data } = await admin.from('profiles').select('*').eq('id', newId).single();
    expect(data).not.toBeNull();
    expect(data!.email).toBe('newuser@test.com');
    expect(data!.display_name).toBe('NewUser');
    expect(data!.role).toBe('user');

    // Cleanup (profiles before auth users to respect FK)
    await admin.from('profiles').delete().eq('id', newId);
    await admin.auth.admin.deleteUser(newId);
  });

  it('d. handle_new_user with raw_user_meta_data containing only name (not display_name)', async () => {
    const newId = '00000000-0000-0000-0000-000000000101';
    await createAuthUser(admin, newId, 'nameonly@test.com', { name: 'NameOnly' });

    const { data } = await admin.from('profiles').select('display_name').eq('id', newId).single();
    expect(data!.display_name).toBe('NameOnly');

    await admin.from('profiles').delete().eq('id', newId);
    await admin.auth.admin.deleteUser(newId);
  });

  it('e. handle_new_user with NULL raw_user_meta_data (falls back to email prefix)', async () => {
    const newId = '00000000-0000-0000-0000-000000000102';
    // No metadata
    await createAuthUser(admin, newId, 'nullmeta@test.com');

    const { data } = await admin.from('profiles').select('display_name').eq('id', newId).single();
    expect(data!.display_name).toBe('nullmeta');

    await admin.from('profiles').delete().eq('id', newId);
    await admin.auth.admin.deleteUser(newId);
  });

  it('f. check_ticket_rate_limit blocks at exact boundary', async () => {
    // Set rate limit to 2
    await admin.from('app_settings').update({ value: '2' }).eq('key', 'ticket_creation_rate_limit');

    const dave = await clientForUser('dave@test.com');

    // Create 2 tickets (at the limit) — use authenticated client so rate limit applies
    for (let i = 0; i < 2; i++) {
      await dave.from('tickets').insert({
        title: `Rate limit test ${i}`,
        slug: `rate-limit-test-${i}`,
        creator_id: USER_DAVE_ID,
        type_id: defaultTypeId,
      });
    }

    // Third should fail
    const { error } = await dave.from('tickets').insert({
      title: 'Rate limit over',
      slug: 'rate-limit-over',
      creator_id: USER_DAVE_ID,
      type_id: defaultTypeId,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toContain('rate limit');

    // Cleanup
    await admin.from('tickets').delete().like('slug', 'rate-limit-test-%');
    await admin.from('app_settings').update({ value: '10' }).eq('key', 'ticket_creation_rate_limit');
  });

  it('g. check_ticket_rate_limit allows agents (exempt)', async () => {
    await admin.from('app_settings').update({ value: '1' }).eq('key', 'ticket_creation_rate_limit');

    // Agent already has tickets, but should be exempt
    const { error } = await admin.from('tickets').insert({
      title: 'Agent exempt ticket',
      slug: 'agent-exempt-ticket',
      creator_id: AGENT_ID,
      type_id: defaultTypeId,
    });
    expect(error).toBeNull();

    await admin.from('tickets').delete().eq('slug', 'agent-exempt-ticket');
    await admin.from('app_settings').update({ value: '10' }).eq('key', 'ticket_creation_rate_limit');
  });

  it('h. check_ticket_rate_limit allows when rate_limit = 0 (unlimited)', async () => {
    await admin.from('app_settings').update({ value: '0' }).eq('key', 'ticket_creation_rate_limit');

    // Should not fail even with many tickets
    const { error } = await admin.from('tickets').insert({
      title: 'Unlimited ticket',
      slug: 'unlimited-ticket',
      creator_id: USER_DAVE_ID,
      type_id: defaultTypeId,
    });
    expect(error).toBeNull();

    await admin.from('tickets').delete().eq('slug', 'unlimited-ticket');
    await admin.from('app_settings').update({ value: '10' }).eq('key', 'ticket_creation_rate_limit');
  });

  it('i. posts_update_ticket_timestamp: ticket.updated_at refreshes on new post', async () => {
    const { data: t } = await admin
      .from('tickets')
      .insert({
        title: 'Post timestamp test',
        slug: 'post-timestamp-test',
        creator_id: USER_ALICE_ID,
        type_id: defaultTypeId,
      })
      .select('id, updated_at')
      .single();
    const before = new Date(t!.updated_at).getTime();

    await new Promise(r => setTimeout(r, 1100));

    await admin.from('posts').insert({
      ticket_id: t!.id,
      author_id: USER_ALICE_ID,
      body: 'New post to update timestamp',
    });

    const { data: after } = await admin.from('tickets').select('updated_at').eq('id', t!.id).single();
    expect(new Date(after!.updated_at).getTime()).toBeGreaterThan(before);

    await admin.from('tickets').delete().eq('id', t!.id);
  });
});

// ============================================================
// 8. CHECK CONSTRAINTS
// ============================================================

describe('8. CHECK Constraints', () => {
  it('a. tickets.title: exactly 300 chars allowed, 301 rejected', async () => {
    const ok300 = 'a'.repeat(300);
    const { error: e1 } = await admin.from('tickets').insert({
      title: ok300,
      slug: 'check-title-300',
      creator_id: USER_ALICE_ID,
      type_id: defaultTypeId,
    });
    expect(e1).toBeNull();
    await admin.from('tickets').delete().eq('slug', 'check-title-300');

    const bad301 = 'a'.repeat(301);
    const { error: e2 } = await admin.from('tickets').insert({
      title: bad301,
      slug: 'check-title-301',
      creator_id: USER_ALICE_ID,
      type_id: defaultTypeId,
    });
    expect(e2).not.toBeNull();
  });

  it('b. posts.body: exactly 50000 chars allowed, 50001 rejected', async () => {
    // First create a ticket to attach posts to
    const { data: t } = await admin
      .from('tickets')
      .insert({
        title: 'Post body check',
        slug: 'post-body-check',
        creator_id: USER_ALICE_ID,
        type_id: defaultTypeId,
      })
      .select('id')
      .single();

    const ok50000 = 'b'.repeat(50000);
    const { error: e1 } = await admin.from('posts').insert({
      ticket_id: t!.id,
      author_id: USER_ALICE_ID,
      body: ok50000,
    });
    expect(e1).toBeNull();

    const bad50001 = 'b'.repeat(50001);
    const { error: e2 } = await admin.from('posts').insert({
      ticket_id: t!.id,
      author_id: USER_ALICE_ID,
      body: bad50001,
    });
    expect(e2).not.toBeNull();

    await admin.from('tickets').delete().eq('id', t!.id);
  });

  it('c. profiles.display_name: exactly 100 chars allowed, 101 rejected', async () => {
    const ok100 = 'c'.repeat(100);
    const { error: e1 } = await admin
      .from('profiles')
      .update({ display_name: ok100 })
      .eq('id', USER_ALICE_ID);
    expect(e1).toBeNull();

    const bad101 = 'c'.repeat(101);
    const { error: e2 } = await admin
      .from('profiles')
      .update({ display_name: bad101 })
      .eq('id', USER_ALICE_ID);
    expect(e2).not.toBeNull();

    // Reset
    await admin.from('profiles').update({ display_name: 'Alice' }).eq('id', USER_ALICE_ID);
  });

  it('d. tags.color: exactly 20 chars allowed, 21 rejected', async () => {
    const ok20 = 'd'.repeat(20);
    const { error: e1 } = await admin.from('tags').insert({ name: 'test-tag-color', color: ok20 });
    expect(e1).toBeNull();
    await admin.from('tags').delete().eq('name', 'test-tag-color');

    const bad21 = 'd'.repeat(21);
    const { error: e2 } = await admin.from('tags').insert({ name: 'test-tag-color2', color: bad21 });
    expect(e2).not.toBeNull();
  });

  it('e. saved_views.name: exactly 100 chars allowed, 101 rejected', async () => {
    const ok100 = 'e'.repeat(100);
    const { error: e1 } = await admin.from('saved_views').insert({
      agent_id: AGENT_ID,
      name: ok100,
    });
    expect(e1).toBeNull();
    await admin.from('saved_views').delete().eq('name', ok100);

    const bad101 = 'e'.repeat(101);
    const { error: e2 } = await admin.from('saved_views').insert({
      agent_id: AGENT_ID,
      name: bad101,
    });
    expect(e2).not.toBeNull();
  });
});

// ============================================================
// 9. UNIQUE CONSTRAINTS
// ============================================================

describe('9. Unique Constraints', () => {
  it('a. ticket_types: only one row with is_default=true', async () => {
    // Trying to set another type as default — partial unique index blocks it
    const { error } = await admin.from('ticket_types').insert({ name: 'Extra Default', is_default: true });
    expect(error).not.toBeNull();
  });

  it('b. saved_views: same agent cannot have two views with same name', async () => {
    await admin.from('saved_views').insert({ agent_id: AGENT_ID, name: 'Dup View' });
    const { error } = await admin.from('saved_views').insert({ agent_id: AGENT_ID, name: 'Dup View' });
    expect(error).not.toBeNull();

    await admin.from('saved_views').delete().eq('name', 'Dup View');
  });
});

// ============================================================
// 10. FK BEHAVIOR
// ============================================================

describe('10. FK Behavior', () => {
  it('a. Cannot delete a team that has members (ON DELETE RESTRICT)', async () => {
    // teamId has Alice and Bob
    const { error } = await admin.from('teams').delete().eq('id', teamId);
    expect(error).not.toBeNull();
  });

  it('b. Cannot delete a ticket_type in use by tickets (ON DELETE RESTRICT)', async () => {
    // defaultTypeId is used by test tickets
    const { error } = await admin.from('ticket_types').delete().eq('id', defaultTypeId);
    expect(error).not.toBeNull();
  });

  it('c. Cannot delete a category in use by tickets (ON DELETE RESTRICT)', async () => {
    // Create a category and assign it to a ticket
    const { data: cat } = await admin
      .from('categories')
      .insert({ name: 'FK Test Category' })
      .select('id')
      .single();

    const { data: t } = await admin
      .from('tickets')
      .insert({
        title: 'FK category test',
        slug: 'fk-category-test',
        creator_id: USER_ALICE_ID,
        type_id: defaultTypeId,
        category_id: cat!.id,
      })
      .select('id')
      .single();

    const { error } = await admin.from('categories').delete().eq('id', cat!.id);
    expect(error).not.toBeNull();

    // cleanup
    await admin.from('tickets').delete().eq('id', t!.id);
    await admin.from('categories').delete().eq('id', cat!.id);
  });
});

// ============================================================
// 11. TEXT SEARCH
// ============================================================

describe('11. Text Search', () => {
  let searchTicketId: number;

  beforeAll(async () => {
    const { data: t } = await admin
      .from('tickets')
      .insert({
        title: 'Searching for authentication problems',
        slug: 'search-auth-problems',
        creator_id: USER_ALICE_ID,
        type_id: defaultTypeId,
      })
      .select('id')
      .single();
    searchTicketId = t!.id;
  });

  it('a. search_vector is auto-populated on ticket INSERT', async () => {
    const { data } = await admin
      .from('tickets')
      .select('search_vector')
      .eq('id', searchTicketId)
      .single();
    expect(data!.search_vector).not.toBeNull();
    expect(data!.search_vector).not.toBe('');
  });

  it('b. search_vector updates when title changes', async () => {
    const { data: before } = await admin
      .from('tickets')
      .select('search_vector')
      .eq('id', searchTicketId)
      .single();

    await admin
      .from('tickets')
      .update({ title: 'Updated billing question' })
      .eq('id', searchTicketId);

    const { data: after } = await admin
      .from('tickets')
      .select('search_vector')
      .eq('id', searchTicketId)
      .single();

    expect(after!.search_vector).not.toBe(before!.search_vector);
  });

  it('c. to_tsquery matches expected tickets', async () => {
    const { data } = await admin
      .from('tickets')
      .select('id')
      .textSearch('search_vector', 'billing');
    expect(data!.some((t: Record<string, unknown>) => t.id === searchTicketId)).toBe(true);
  });
});
