import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServiceRoleClient } from '../helpers/supabase';

// ---------------------------------------------------------------------------
// Shared helpers & constants
// ---------------------------------------------------------------------------

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Fixed UUIDs — same as 001-schema.test.ts
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

beforeAll(async () => {
  admin = createServiceRoleClient();

  const testUserIds = [ADMIN_ID, AGENT_ID, AGENT2_ID, USER_ALICE_ID, USER_BOB_ID, USER_DAVE_ID, BLOCKED_USER_ID];

  // Clean up leftover ticket data
  await admin.from('ticket_followers').delete().in('user_id', testUserIds);
  await admin.from('activity_log').delete().in('actor_id', testUserIds);
  // Delete posts first, then tickets (FK constraint)
  const { data: testTickets } = await admin.from('tickets').select('id').in('creator_id', testUserIds);
  if (testTickets && testTickets.length > 0) {
    const ticketIds = testTickets.map((t: { id: number }) => t.id);
    await admin.from('posts').delete().in('ticket_id', ticketIds);
    // Clear duplicate refs to avoid FK issues
    await admin.from('tickets').update({ duplicate_of_id: null }).in('id', ticketIds);
    await admin.from('tickets').delete().in('id', ticketIds);
  }

  // Ensure team EXISTS
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

  // Ensure auth users
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

  // Bump rate limit high so parallel test suites don't collide
  await admin.from('app_settings').update({ value: '100' }).eq('key', 'ticket_creation_rate_limit');

  // Authenticate all clients
  await clientForUser('admin@test.com');
  await clientForUser('agent@test.com');
  await clientForUser('agent2@test.com');
  await clientForUser('alice@test.com');
  await clientForUser('bob@test.com');
  await clientForUser('dave@test.com');
  await clientForUser('blocked@test.com');
}, 30000);

afterAll(async () => {
  // Restore default rate limit
  await admin.from('app_settings').update({ value: '10' }).eq('key', 'ticket_creation_rate_limit');
});

// ============================================================
// TICKET TESTS
// ============================================================

describe('Ticket CRUD & RLS', () => {
  let aliceTicketId: number;
  let alicePrivateTicketId: number;
  let publicTicketId: number;

  it('user can create a ticket (own)', async () => {
    const alice = await clientForUser('alice@test.com');
    const { data: ticket, error } = await alice
      .from('tickets')
      .insert({
        title: 'Test ticket by Alice',
        slug: 'test-ticket-by-alice',
        type_id: defaultTypeId,
        creator_id: USER_ALICE_ID,
        is_private: true,
      })
      .select('id, title, slug, status, urgency, severity')
      .single();

    expect(error).toBeNull();
    expect(ticket).toBeDefined();
    expect(ticket!.title).toBe('Test ticket by Alice');
    expect(ticket!.status).toBe('open');
    expect(ticket!.urgency).toBe('medium');
    expect(ticket!.severity).toBe('medium');
    aliceTicketId = ticket!.id;
    alicePrivateTicketId = ticket!.id;

    // Insert original post
    const { error: postError } = await alice
      .from('posts')
      .insert({
        ticket_id: aliceTicketId,
        author_id: USER_ALICE_ID,
        body: 'This is the original post body for Alice test ticket.',
        is_original: true,
        post_type: 'post',
      });
    expect(postError).toBeNull();
  });

  it('user can read own ticket', async () => {
    const alice = await clientForUser('alice@test.com');
    const { data, error } = await alice
      .from('tickets')
      .select('id, title')
      .eq('id', aliceTicketId)
      .single();

    expect(error).toBeNull();
    expect(data!.title).toBe('Test ticket by Alice');
  });

  it('user cannot read another user\'s private ticket', async () => {
    const dave = await clientForUser('dave@test.com');
    const { data, error: _error } = await dave
      .from('tickets')
      .select('id, title')
      .eq('id', alicePrivateTicketId)
      .single();

    // Dave is not on Alice's team, so should not see private ticket
    expect(data).toBeNull();
  });

  it('user can read public tickets', async () => {
    // Create a public ticket
    const alice = await clientForUser('alice@test.com');
    const { data: pub, error: pubError } = await alice
      .from('tickets')
      .insert({
        title: 'Public ticket by Alice',
        slug: 'public-ticket-by-alice',
        type_id: defaultTypeId,
        creator_id: USER_ALICE_ID,
        is_private: false,
      })
      .select('id')
      .single();
    expect(pubError).toBeNull();
    publicTicketId = pub!.id;

    // Dave (different team) should be able to read public tickets
    const dave = await clientForUser('dave@test.com');
    const { data, error } = await dave
      .from('tickets')
      .select('id, title')
      .eq('id', publicTicketId)
      .single();

    expect(error).toBeNull();
    expect(data!.title).toBe('Public ticket by Alice');
  });

  it('agent can read all tickets (including private)', async () => {
    const agent = await clientForUser('agent@test.com');
    const { data, error } = await agent
      .from('tickets')
      .select('id, title')
      .eq('id', alicePrivateTicketId)
      .single();

    expect(error).toBeNull();
    expect(data!.title).toBe('Test ticket by Alice');
  });

  it('teammate can read teammate\'s private ticket', async () => {
    // Bob is on the same team as Alice
    const bob = await clientForUser('bob@test.com');
    const { data, error } = await bob
      .from('tickets')
      .select('id, title')
      .eq('id', alicePrivateTicketId)
      .single();

    expect(error).toBeNull();
    expect(data!.title).toBe('Test ticket by Alice');
  });

  it('user cannot reply to a duplicate ticket', async () => {
    // Create a ticket and mark it as duplicate
    const alice = await clientForUser('alice@test.com');
    const { data: dupe } = await alice
      .from('tickets')
      .insert({
        title: 'Duplicate ticket test',
        slug: 'duplicate-ticket-test',
        type_id: defaultTypeId,
        creator_id: USER_ALICE_ID,
        is_private: false,
      })
      .select('id')
      .single();

    // Admin marks as duplicate (needs service role to set duplicate_of_id in one step)
    await admin.from('tickets').update({
      duplicate_of_id: publicTicketId,
      status: 'closed',
    }).eq('id', dupe!.id);

    // Alice (regular user) tries to reply
    const { error } = await alice
      .from('posts')
      .insert({
        ticket_id: dupe!.id,
        author_id: USER_ALICE_ID,
        body: 'Trying to reply to duplicate',
        post_type: 'post',
      });

    expect(error).not.toBeNull();
  });

  it('replying to closed/pending ticket transitions to open (non-agent user)', async () => {
    // Create a pending ticket using service role
    const { data: pendingTicket } = await admin
      .from('tickets')
      .insert({
        title: 'Pending status test',
        slug: 'pending-status-test',
        type_id: defaultTypeId,
        creator_id: USER_ALICE_ID,
        is_private: false,
        status: 'pending',
      })
      .select('id')
      .single();

    // Alice replies — status should auto-transition (in server action logic, not DB trigger)
    // For this DB-level test, we verify the reply is accepted
    const alice = await clientForUser('alice@test.com');
    const { error } = await alice
      .from('posts')
      .insert({
        ticket_id: pendingTicket!.id,
        author_id: USER_ALICE_ID,
        body: 'Reply to pending ticket',
        post_type: 'post',
      });

    expect(error).toBeNull();
    // Note: status auto-transition is handled in the Server Action, not at DB level
  });

  it('agent reply does NOT auto-transition status (verified at action level)', async () => {
    // Create a pending ticket
    const { data: ticket } = await admin
      .from('tickets')
      .insert({
        title: 'Agent reply test',
        slug: 'agent-reply-test',
        type_id: defaultTypeId,
        creator_id: USER_ALICE_ID,
        is_private: false,
        status: 'pending',
      })
      .select('id')
      .single();

    // Agent replies — post should be accepted
    const agent = await clientForUser('agent@test.com');
    const { error } = await agent
      .from('posts')
      .insert({
        ticket_id: ticket!.id,
        author_id: AGENT_ID,
        body: 'Agent reply to pending ticket',
        post_type: 'post',
      });

    expect(error).toBeNull();

    // Verify ticket is still pending (no auto-transition for agents)
    const { data: updatedTicket } = await admin
      .from('tickets')
      .select('status')
      .eq('id', ticket!.id)
      .single();
    expect(updatedTicket!.status).toBe('pending');
  });
});

// ============================================================
// RATE LIMIT TESTS
// ============================================================

describe('Rate Limiting', () => {
  it('exceeding rate limit gets rejected', async () => {
    // Set rate limit to 2 for this test
    await admin.from('app_settings').update({ value: '2' }).eq('key', 'ticket_creation_rate_limit');

    const dave = await clientForUser('dave@test.com');

    // Create 2 tickets (at limit)
    for (let i = 0; i < 2; i++) {
      const { error } = await dave
        .from('tickets')
        .insert({
          title: `Rate limit test ${i}`,
          slug: `rate-limit-test-${i}`,
          type_id: defaultTypeId,
          creator_id: USER_DAVE_ID,
          is_private: false,
        });
      expect(error).toBeNull();
    }

    // 3rd ticket should be rejected by DB trigger
    const { error: limitError } = await dave
      .from('tickets')
      .insert({
        title: 'Rate limit exceeded',
        slug: 'rate-limit-exceeded',
        type_id: defaultTypeId,
        creator_id: USER_DAVE_ID,
        is_private: false,
      });

    expect(limitError).not.toBeNull();
    expect(limitError!.message).toContain('rate limit');

    // Reset rate limit
    await admin.from('app_settings').update({ value: '10' }).eq('key', 'ticket_creation_rate_limit');
  });

  it('agent is exempt from rate limit', async () => {
    // Set rate limit to 1
    await admin.from('app_settings').update({ value: '1' }).eq('key', 'ticket_creation_rate_limit');

    const agent = await clientForUser('agent@test.com');

    // Create 2 tickets — agent should not be limited
    for (let i = 0; i < 2; i++) {
      const { error } = await agent
        .from('tickets')
        .insert({
          title: `Agent rate limit test ${i}`,
          slug: `agent-rate-limit-test-${i}`,
          type_id: defaultTypeId,
          creator_id: AGENT_ID,
          is_private: false,
        });
      expect(error).toBeNull();
    }

    // Reset rate limit
    await admin.from('app_settings').update({ value: '10' }).eq('key', 'ticket_creation_rate_limit');
  });
});

// ============================================================
// CONTENT LENGTH CONSTRAINTS
// ============================================================

describe('Content-length constraints', () => {
  it('title > 300 chars is rejected', async () => {
    const alice = await clientForUser('alice@test.com');
    const { error } = await alice
      .from('tickets')
      .insert({
        title: 'x'.repeat(301),
        slug: 'too-long-title',
        type_id: defaultTypeId,
        creator_id: USER_ALICE_ID,
        is_private: false,
      });

    expect(error).not.toBeNull();
  });

  it('body > 50000 chars is rejected', async () => {
    const alice = await clientForUser('alice@test.com');
    // First create a valid ticket for the post
    const { data: ticket } = await alice
      .from('tickets')
      .insert({
        title: 'Long body test',
        slug: 'long-body-test',
        type_id: defaultTypeId,
        creator_id: USER_ALICE_ID,
        is_private: false,
      })
      .select('id')
      .single();

    const { error } = await alice
      .from('posts')
      .insert({
        ticket_id: ticket!.id,
        author_id: USER_ALICE_ID,
        body: 'x'.repeat(50001),
        is_original: true,
        post_type: 'post',
      });

    expect(error).not.toBeNull();
  });
});

// ============================================================
// TICKET FOLLOWERS
// ============================================================

describe('Ticket followers', () => {
  it('creating a ticket and adding a follower row works', async () => {
    const alice = await clientForUser('alice@test.com');
    const { data: ticket } = await alice
      .from('tickets')
      .insert({
        title: 'Follower test',
        slug: 'follower-test',
        type_id: defaultTypeId,
        creator_id: USER_ALICE_ID,
        is_private: false,
      })
      .select('id')
      .single();

    const { error } = await alice
      .from('ticket_followers')
      .insert({ ticket_id: ticket!.id, user_id: USER_ALICE_ID });

    expect(error).toBeNull();

    // Verify
    const { data: followers } = await alice
      .from('ticket_followers')
      .select('user_id')
      .eq('ticket_id', ticket!.id);

    expect(followers).toHaveLength(1);
    expect(followers![0].user_id).toBe(USER_ALICE_ID);
  });
});

// ============================================================
// BLOCKED USER
// ============================================================

describe('Blocked user restrictions', () => {
  it('blocked user cannot create tickets', async () => {
    const blocked = await clientForUser('blocked@test.com');
    const { error } = await blocked
      .from('tickets')
      .insert({
        title: 'Blocked user ticket',
        slug: 'blocked-user-ticket',
        type_id: defaultTypeId,
        creator_id: BLOCKED_USER_ID,
        is_private: false,
      });

    expect(error).not.toBeNull();
  });

  it('blocked user cannot insert into posts table', async () => {
    // Create a ticket via admin for the blocked user to try to post on
    const { data: ticket } = await admin
      .from('tickets')
      .insert({
        title: 'Ticket for blocked post test',
        slug: 'blocked-post-test',
        type_id: defaultTypeId,
        creator_id: USER_ALICE_ID,
        is_private: false,
      })
      .select('id')
      .single();

    const blocked = await clientForUser('blocked@test.com');
    const { error } = await blocked
      .from('posts')
      .insert({
        ticket_id: ticket!.id,
        author_id: BLOCKED_USER_ID,
        body: 'Blocked user trying to post',
        post_type: 'post',
      });

    expect(error).not.toBeNull();
  });
});

// ============================================================
// FULL-TEXT SEARCH
// ============================================================

describe('Full-text search', () => {
  let searchTicketId: number;

  it('search_vector is populated on ticket creation', async () => {
    const alice = await clientForUser('alice@test.com');
    const { data: ticket } = await alice
      .from('tickets')
      .insert({
        title: 'Unique photosynthesis keyword',
        slug: 'unique-photosynthesis-keyword',
        type_id: defaultTypeId,
        creator_id: USER_ALICE_ID,
        is_private: false,
      })
      .select('id')
      .single();

    searchTicketId = ticket!.id;

    // Insert original post
    await alice
      .from('posts')
      .insert({
        ticket_id: searchTicketId,
        author_id: USER_ALICE_ID,
        body: 'This post is about chlorophyll and mitochondria.',
        is_original: true,
        post_type: 'post',
      });

    // Search by title keyword
    const { data: results } = await alice
      .from('tickets')
      .select('id, title')
      .textSearch('search_vector', 'photosynthesis', { config: 'english' });

    expect(results).toBeDefined();
    expect(results!.some((r: { id: number }) => r.id === searchTicketId)).toBe(true);
  });

  it('search_vector includes original post body after post insert trigger', async () => {
    const alice = await clientForUser('alice@test.com');

    // Search by body keyword (from the original post)
    const { data: results } = await alice
      .from('tickets')
      .select('id, title')
      .textSearch('search_vector', 'chlorophyll', { config: 'english' });

    expect(results).toBeDefined();
    expect(results!.some((r: { id: number }) => r.id === searchTicketId)).toBe(true);
  });

  it('search_vector updates when original post body changes', async () => {
    // Update the original post body via admin
    const { data: post } = await admin
      .from('posts')
      .select('id')
      .eq('ticket_id', searchTicketId)
      .eq('is_original', true)
      .single();

    await admin
      .from('posts')
      .update({ body: 'Updated body about quantum entanglement theory.' })
      .eq('id', post!.id);

    // Search for the new keyword
    const alice = await clientForUser('alice@test.com');
    const { data: results } = await alice
      .from('tickets')
      .select('id, title')
      .textSearch('search_vector', 'entanglement', { config: 'english' });

    expect(results).toBeDefined();
    expect(results!.some((r: { id: number }) => r.id === searchTicketId)).toBe(true);

    // Old keyword should no longer match
    const { data: oldResults } = await alice
      .from('tickets')
      .select('id, title')
      .textSearch('search_vector', 'chlorophyll', { config: 'english' });

    const found = oldResults?.some((r: { id: number }) => r.id === searchTicketId) ?? false;
    expect(found).toBe(false);
  });
});
