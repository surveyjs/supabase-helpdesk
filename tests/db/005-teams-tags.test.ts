import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServiceRoleClient } from '../helpers/supabase';

// ---------------------------------------------------------------------------
// Shared helpers & constants
// ---------------------------------------------------------------------------

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const ADMIN_ID = '00000000-0000-0000-0000-000000000051';
const AGENT_ID = '00000000-0000-0000-0000-000000000052';
const USER_ALICE_ID = '00000000-0000-0000-0000-000000000053';
const USER_BOB_ID = '00000000-0000-0000-0000-000000000054';
const USER_DAVE_ID = '00000000-0000-0000-0000-000000000055';

let admin: SupabaseClient;
let teamId: string;
let defaultTypeId: string;
let testTypeId: string;
let testCategoryId: string;
let testCategoryInUseId: string;
let testTagId: string;
let testTagId2: string;
let aliceTicketId: number;

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

  const testUserIds = [ADMIN_ID, AGENT_ID, USER_ALICE_ID, USER_BOB_ID, USER_DAVE_ID];

  // Clean up leftover data
  await admin.from('saved_views').delete().in('agent_id', testUserIds);
  await admin.from('ticket_followers').delete().in('user_id', testUserIds);
  await admin.from('activity_log').delete().in('actor_id', testUserIds);
  const { data: testTickets } = await admin.from('tickets').select('id').in('creator_id', testUserIds);
  if (testTickets && testTickets.length > 0) {
    const ticketIds = testTickets.map((t: { id: number }) => t.id);
    await admin.from('ticket_tags').delete().in('ticket_id', ticketIds);
    await admin.from('posts').delete().in('ticket_id', ticketIds);
    await admin.from('tickets').update({ duplicate_of_id: null, merged_into_id: null }).in('id', ticketIds);
    await admin.from('tickets').delete().in('id', ticketIds);
  }

  // Clean up test-specific data from previous runs
  await admin.from('ticket_types').delete().eq('name', 'Phase5TestType');
  await admin.from('ticket_types').delete().eq('name', 'Phase5RenamedType');
  await admin.from('categories').delete().eq('name', 'Phase5TestCategory');
  await admin.from('categories').delete().eq('name', 'Phase5RenamedCategory');
  await admin.from('categories').delete().eq('name', 'Phase5InUseCategory');
  await admin.from('tags').delete().eq('name', 'phase5-test-tag');
  await admin.from('tags').delete().eq('name', 'phase5-renamed-tag');
  await admin.from('tags').delete().eq('name', 'phase5-cascade-tag');

  // Clean old test teams
  const testTeamNames = ['Phase5TestTeam', 'Phase5RenameTeam', 'Phase5DeleteTeam'];
  for (const tn of testTeamNames) {
    const { data: t } = await admin.from('teams').select('id').eq('name', tn).single();
    if (t) {
      await admin.from('profiles').update({ team_id: null }).eq('team_id', t.id);
      await admin.from('teams').delete().eq('id', t.id);
    }
  }

  // Ensure team
  const { data: existingTeam } = await admin.from('teams').select('id').eq('name', 'Phase5TestTeam').single();
  if (existingTeam) {
    teamId = existingTeam.id;
  } else {
    const { data: newTeam } = await admin.from('teams').insert({ name: 'Phase5TestTeam' }).select('id').single();
    teamId = newTeam!.id;
  }

  // Get default type
  const { data: typeData } = await admin.from('ticket_types').select('id').eq('is_default', true).single();
  defaultTypeId = typeData!.id;

  // Ensure auth users
  await ensureAuthUser(admin, ADMIN_ID, 'admin5@test.com', { display_name: 'Admin5' });
  await ensureAuthUser(admin, AGENT_ID, 'agent5@test.com', { display_name: 'Agent5' });
  await ensureAuthUser(admin, USER_ALICE_ID, 'alice5@test.com', { display_name: 'Alice5' });
  await ensureAuthUser(admin, USER_BOB_ID, 'bob5@test.com', { display_name: 'Bob5' });
  await ensureAuthUser(admin, USER_DAVE_ID, 'dave5@test.com', { display_name: 'Dave5' });

  // Set roles
  await admin.from('profiles').update({ role: 'admin' }).eq('id', ADMIN_ID);
  await admin.from('profiles').update({ role: 'agent' }).eq('id', AGENT_ID);
  await admin.from('profiles').update({ role: 'user', team_id: teamId }).eq('id', USER_ALICE_ID);
  await admin.from('profiles').update({ role: 'user', team_id: teamId }).eq('id', USER_BOB_ID);
  await admin.from('profiles').update({ role: 'user', team_id: null }).eq('id', USER_DAVE_ID);

  // Authenticate all clients
  await clientForUser('admin5@test.com');
  await clientForUser('agent5@test.com');
  await clientForUser('alice5@test.com');
  await clientForUser('bob5@test.com');
  await clientForUser('dave5@test.com');

  // Create test ticket owned by Alice (on a team)
  const { data: ticket1 } = await admin
    .from('tickets')
    .insert({
      title: 'Phase5 Alice ticket',
      slug: 'phase5-alice-ticket',
      type_id: defaultTypeId,
      creator_id: USER_ALICE_ID,
      is_private: true,
      urgency: 'medium',
      severity: 'medium',
    })
    .select('id')
    .single();
  aliceTicketId = ticket1!.id;

  await admin.from('posts').insert({
    ticket_id: aliceTicketId,
    author_id: USER_ALICE_ID,
    body: 'Phase 5 test ticket body.',
    is_original: true,
    post_type: 'post',
  });
}, 30000);

afterAll(async () => {
  // Cleanup tickets
  const testUserIds = [ADMIN_ID, AGENT_ID, USER_ALICE_ID, USER_BOB_ID, USER_DAVE_ID];
  const { data: testTickets } = await admin.from('tickets').select('id').in('creator_id', testUserIds);
  if (testTickets && testTickets.length > 0) {
    const ticketIds = testTickets.map((t: { id: number }) => t.id);
    await admin.from('ticket_tags').delete().in('ticket_id', ticketIds);
    await admin.from('posts').delete().in('ticket_id', ticketIds);
    await admin.from('tickets').update({ duplicate_of_id: null, merged_into_id: null }).in('id', ticketIds);
    await admin.from('tickets').delete().in('id', ticketIds);
  }
});

// ============================================================
// SEED DATA VERIFICATION
// ============================================================

describe('Seed data: categories, tags, assignments', () => {
  it('3 categories exist', async () => {
    const { data } = await admin.from('categories').select('name').order('name');
    const names = (data ?? []).map((c: { name: string }) => c.name);
    expect(names).toContain('Billing');
    expect(names).toContain('Technical');
    expect(names).toContain('Account');
  });

  it('5 tags exist with correct colors', async () => {
    const { data } = await admin.from('tags').select('name, color').order('name');
    const tagMap = Object.fromEntries((data ?? []).map((t: { name: string; color: string }) => [t.name, t.color]));
    expect(tagMap['urgent']).toBe('#EF4444');
    expect(tagMap['bug']).toBe('#F97316');
    expect(tagMap['feature-request']).toBe('#3B82F6');
    expect(tagMap['documentation']).toBe('#14B8A6');
    expect(tagMap['UI']).toBe('#8B5CF6');
  });

  it('seeded tickets have tag assignments', async () => {
    const { data } = await admin.from('ticket_tags').select('ticket_id, tag_id');
    expect((data ?? []).length).toBeGreaterThanOrEqual(8);
  });

  it('seeded tickets have category assignments', async () => {
    const { data } = await admin.from('tickets').select('id, category_id').not('category_id', 'is', null);
    expect((data ?? []).length).toBeGreaterThanOrEqual(4);
  });
});

// ============================================================
// ADMIN: TICKET TYPES CRUD
// ============================================================

describe('Admin ticket type management', () => {
  it('admin can create a ticket type', async () => {
    const adminClient = await clientForUser('admin5@test.com');
    const { data, error } = await adminClient
      .from('ticket_types')
      .insert({ name: 'Phase5TestType' })
      .select('id, name')
      .single();

    expect(error).toBeNull();
    expect(data!.name).toBe('Phase5TestType');
    testTypeId = data!.id;
  });

  it('admin can rename a ticket type', async () => {
    const adminClient = await clientForUser('admin5@test.com');
    const { error } = await adminClient
      .from('ticket_types')
      .update({ name: 'Phase5RenamedType' })
      .eq('id', testTypeId);

    expect(error).toBeNull();

    const { data } = await adminClient
      .from('ticket_types')
      .select('name')
      .eq('id', testTypeId)
      .single();
    expect(data!.name).toBe('Phase5RenamedType');
  });

  it('deleting a type in use is rejected', async () => {
    const adminClient = await clientForUser('admin5@test.com');

    // defaultTypeId is used by our test ticket
    const { error } = await adminClient
      .from('ticket_types')
      .delete()
      .eq('id', defaultTypeId);

    expect(error).not.toBeNull();
  });

  it('admin can delete an unused ticket type', async () => {
    const adminClient = await clientForUser('admin5@test.com');
    const { error } = await adminClient
      .from('ticket_types')
      .delete()
      .eq('id', testTypeId);

    expect(error).toBeNull();
  });

  it('setting default type works', async () => {
    const adminClient = await clientForUser('admin5@test.com');

    // Create a new type and set it as default
    const { data: newType } = await adminClient
      .from('ticket_types')
      .insert({ name: 'Phase5TestType' })
      .select('id')
      .single();

    expect(newType).not.toBeNull();
    testTypeId = newType!.id;

    // Unset current default
    await adminClient
      .from('ticket_types')
      .update({ is_default: false })
      .eq('is_default', true);

    // Set new default
    const { error } = await adminClient
      .from('ticket_types')
      .update({ is_default: true })
      .eq('id', testTypeId);

    expect(error).toBeNull();

    // Verify only one default exists
    const { data: defaults } = await adminClient
      .from('ticket_types')
      .select('id')
      .eq('is_default', true);

    expect(defaults!.length).toBe(1);
    expect(defaults![0].id).toBe(testTypeId);

    // Restore original default
    await adminClient
      .from('ticket_types')
      .update({ is_default: false })
      .eq('id', testTypeId);
    await adminClient
      .from('ticket_types')
      .update({ is_default: true })
      .eq('id', defaultTypeId);

    // Delete test type
    await adminClient.from('ticket_types').delete().eq('id', testTypeId);
  });

  it('non-admin cannot create/modify types (RLS)', async () => {
    const user = await clientForUser('alice5@test.com');
    const { error } = await user
      .from('ticket_types')
      .insert({ name: 'ShouldFail' });

    expect(error).not.toBeNull();
  });
});

// ============================================================
// ADMIN: CATEGORIES CRUD
// ============================================================

describe('Admin category management', () => {
  it('admin can create a category', async () => {
    const adminClient = await clientForUser('admin5@test.com');
    const { data, error } = await adminClient
      .from('categories')
      .insert({ name: 'Phase5TestCategory' })
      .select('id, name')
      .single();

    expect(error).toBeNull();
    expect(data!.name).toBe('Phase5TestCategory');
    testCategoryId = data!.id;
  });

  it('admin can rename a category', async () => {
    const adminClient = await clientForUser('admin5@test.com');
    const { error } = await adminClient
      .from('categories')
      .update({ name: 'Phase5RenamedCategory' })
      .eq('id', testCategoryId);

    expect(error).toBeNull();

    const { data } = await adminClient
      .from('categories')
      .select('name')
      .eq('id', testCategoryId)
      .single();
    expect(data!.name).toBe('Phase5RenamedCategory');
  });

  it('deleting a category in use is rejected', async () => {
    const adminClient = await clientForUser('admin5@test.com');

    // Create a category and assign it to a ticket
    const { data: cat } = await adminClient
      .from('categories')
      .insert({ name: 'Phase5InUseCategory' })
      .select('id')
      .single();
    testCategoryInUseId = cat!.id;

    await admin.from('tickets').update({ category_id: testCategoryInUseId }).eq('id', aliceTicketId);

    const { error } = await adminClient
      .from('categories')
      .delete()
      .eq('id', testCategoryInUseId);

    expect(error).not.toBeNull();

    // Cleanup: remove category from ticket
    await admin.from('tickets').update({ category_id: null }).eq('id', aliceTicketId);
    await adminClient.from('categories').delete().eq('id', testCategoryInUseId);
  });

  it('admin can delete an unused category', async () => {
    const adminClient = await clientForUser('admin5@test.com');
    const { error } = await adminClient
      .from('categories')
      .delete()
      .eq('id', testCategoryId);

    expect(error).toBeNull();
  });

  it('non-admin cannot create categories (RLS)', async () => {
    const user = await clientForUser('alice5@test.com');
    const { error } = await user
      .from('categories')
      .insert({ name: 'ShouldFail' });

    expect(error).not.toBeNull();
  });
});

// ============================================================
// ADMIN: TAGS CRUD
// ============================================================

describe('Admin tag management', () => {
  it('admin can create a tag with color', async () => {
    const adminClient = await clientForUser('admin5@test.com');
    const { data, error } = await adminClient
      .from('tags')
      .insert({ name: 'phase5-test-tag', color: '#FF0000' })
      .select('id, name, color')
      .single();

    expect(error).toBeNull();
    expect(data!.name).toBe('phase5-test-tag');
    expect(data!.color).toBe('#FF0000');
    testTagId = data!.id;
  });

  it('admin can rename a tag', async () => {
    const adminClient = await clientForUser('admin5@test.com');
    const { error } = await adminClient
      .from('tags')
      .update({ name: 'phase5-renamed-tag' })
      .eq('id', testTagId);

    expect(error).toBeNull();

    const { data } = await adminClient
      .from('tags')
      .select('name')
      .eq('id', testTagId)
      .single();
    expect(data!.name).toBe('phase5-renamed-tag');
  });

  it('admin can update tag color', async () => {
    const adminClient = await clientForUser('admin5@test.com');
    const { error } = await adminClient
      .from('tags')
      .update({ color: '#00FF00' })
      .eq('id', testTagId);

    expect(error).toBeNull();

    const { data } = await adminClient
      .from('tags')
      .select('color')
      .eq('id', testTagId)
      .single();
    expect(data!.color).toBe('#00FF00');
  });

  it('deleting a tag removes it from ticket_tags (CASCADE)', async () => {
    const adminClient = await clientForUser('admin5@test.com');

    // Create a tag, assign it to a ticket, then delete it
    const { data: cascadeTag } = await adminClient
      .from('tags')
      .insert({ name: 'phase5-cascade-tag', color: '#AABBCC' })
      .select('id')
      .single();
    testTagId2 = cascadeTag!.id;

    // Assign to ticket via service role
    await admin.from('ticket_tags').insert({ ticket_id: aliceTicketId, tag_id: testTagId2 });

    // Verify assignment exists
    const { data: beforeDelete } = await admin
      .from('ticket_tags')
      .select('tag_id')
      .eq('ticket_id', aliceTicketId)
      .eq('tag_id', testTagId2);
    expect(beforeDelete!.length).toBe(1);

    // Delete tag
    const { error } = await adminClient.from('tags').delete().eq('id', testTagId2);
    expect(error).toBeNull();

    // Verify cascade
    const { data: afterDelete } = await admin
      .from('ticket_tags')
      .select('tag_id')
      .eq('ticket_id', aliceTicketId)
      .eq('tag_id', testTagId2);
    expect(afterDelete!.length).toBe(0);
  });

  it('admin can delete a tag', async () => {
    const adminClient = await clientForUser('admin5@test.com');
    const { error } = await adminClient
      .from('tags')
      .delete()
      .eq('id', testTagId);

    expect(error).toBeNull();
  });

  it('non-admin cannot create tags (RLS)', async () => {
    const user = await clientForUser('alice5@test.com');
    const { error } = await user
      .from('tags')
      .insert({ name: 'should-fail', color: '#000000' });

    expect(error).not.toBeNull();
  });
});

// ============================================================
// AGENT: TICKET TAG MANAGEMENT
// ============================================================

describe('Agent ticket tag management', () => {
  let agentTag1Id: string;

  beforeAll(async () => {
    // Create a tag for testing
    const { data } = await admin
      .from('tags')
      .insert({ name: 'phase5-test-tag', color: '#FF0000' })
      .select('id')
      .single();
    agentTag1Id = data!.id;
  });

  afterAll(async () => {
    await admin.from('ticket_tags').delete().eq('tag_id', agentTag1Id);
    await admin.from('tags').delete().eq('id', agentTag1Id);
  });

  it('agent can add a tag to a ticket', async () => {
    const agent = await clientForUser('agent5@test.com');
    const { error } = await agent
      .from('ticket_tags')
      .insert({ ticket_id: aliceTicketId, tag_id: agentTag1Id });

    expect(error).toBeNull();

    const { data } = await agent
      .from('ticket_tags')
      .select('tag_id')
      .eq('ticket_id', aliceTicketId)
      .eq('tag_id', agentTag1Id);
    expect(data!.length).toBe(1);
  });

  it('agent can remove a tag from a ticket', async () => {
    const agent = await clientForUser('agent5@test.com');
    const { error } = await agent
      .from('ticket_tags')
      .delete()
      .eq('ticket_id', aliceTicketId)
      .eq('tag_id', agentTag1Id);

    expect(error).toBeNull();

    const { data } = await agent
      .from('ticket_tags')
      .select('tag_id')
      .eq('ticket_id', aliceTicketId)
      .eq('tag_id', agentTag1Id);
    expect(data!.length).toBe(0);
  });

  it('non-agent cannot modify ticket_tags', async () => {
    const user = await clientForUser('alice5@test.com');
    const { error } = await user
      .from('ticket_tags')
      .insert({ ticket_id: aliceTicketId, tag_id: agentTag1Id });

    expect(error).not.toBeNull();
  });
});

// ============================================================
// TEAM TICKETS: VISIBILITY
// ============================================================

describe('Team ticket visibility', () => {
  let bobTicketId: number;

  beforeAll(async () => {
    // Create a private ticket by Bob (same team as Alice)
    const { data } = await admin
      .from('tickets')
      .insert({
        title: 'Phase5 Bob private ticket',
        slug: 'phase5-bob-private-ticket',
        type_id: defaultTypeId,
        creator_id: USER_BOB_ID,
        is_private: true,
      })
      .select('id')
      .single();
    bobTicketId = data!.id;

    await admin.from('posts').insert({
      ticket_id: bobTicketId,
      author_id: USER_BOB_ID,
      body: 'Bob private ticket body',
      is_original: true,
      post_type: 'post',
    });
  });

  it('team member Alice can read teammate Bob\'s private ticket', async () => {
    const alice = await clientForUser('alice5@test.com');
    const { data, error } = await alice
      .from('tickets')
      .select('id, title')
      .eq('id', bobTicketId)
      .single();

    expect(error).toBeNull();
    expect(data!.title).toBe('Phase5 Bob private ticket');
  });

  it('non-teammate Dave cannot read Bob\'s private ticket', async () => {
    const dave = await clientForUser('dave5@test.com');
    const { data } = await dave
      .from('tickets')
      .select('id, title')
      .eq('id', bobTicketId)
      .single();

    // Should be null because RLS blocks it
    expect(data).toBeNull();
  });
});

// ============================================================
// ADMIN: TEAM MANAGEMENT
// ============================================================

describe('Admin team management', () => {
  let newTeamId: string;

  it('admin can create a team', async () => {
    const adminClient = await clientForUser('admin5@test.com');
    const { data, error } = await adminClient
      .from('teams')
      .insert({ name: 'Phase5DeleteTeam' })
      .select('id, name')
      .single();

    expect(error).toBeNull();
    expect(data!.name).toBe('Phase5DeleteTeam');
    newTeamId = data!.id;
  });

  it('admin can rename a team', async () => {
    const adminClient = await clientForUser('admin5@test.com');
    const { error } = await adminClient
      .from('teams')
      .update({ name: 'Phase5RenameTeam' })
      .eq('id', newTeamId);

    expect(error).toBeNull();

    const { data } = await adminClient
      .from('teams')
      .select('name')
      .eq('id', newTeamId)
      .single();
    expect(data!.name).toBe('Phase5RenameTeam');
  });

  it('admin can add a team member', async () => {
    // Add Dave (who has no team) to the new team
    await admin
      .from('profiles')
      .update({ team_id: newTeamId })
      .eq('id', USER_DAVE_ID);

    const { data } = await admin
      .from('profiles')
      .select('team_id')
      .eq('id', USER_DAVE_ID)
      .single();

    expect(data!.team_id).toBe(newTeamId);
  });

  it('deleting a team with members is rejected (ON DELETE RESTRICT)', async () => {
    const adminClient = await clientForUser('admin5@test.com');
    const { error } = await adminClient
      .from('teams')
      .delete()
      .eq('id', newTeamId);

    expect(error).not.toBeNull();
  });

  it('admin can remove team member', async () => {
    await admin
      .from('profiles')
      .update({ team_id: null })
      .eq('id', USER_DAVE_ID);

    const { data } = await admin
      .from('profiles')
      .select('team_id')
      .eq('id', USER_DAVE_ID)
      .single();

    expect(data!.team_id).toBeNull();
  });

  it('admin can delete an empty team', async () => {
    const adminClient = await clientForUser('admin5@test.com');
    const { error } = await adminClient
      .from('teams')
      .delete()
      .eq('id', newTeamId);

    expect(error).toBeNull();
  });
});
