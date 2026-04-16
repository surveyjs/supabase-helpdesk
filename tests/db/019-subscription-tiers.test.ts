import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServiceRoleClient } from '../helpers/supabase';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const ADMIN_ID = '00000000-0000-0000-0000-000000000901';
const USER_ID = '00000000-0000-0000-0000-000000000902';
const USER2_ID = '00000000-0000-0000-0000-000000000903';

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

let tierId1: string; // Tier with capabilities
let tierId2: string; // Tier without capabilities
let defaultTypeId: string;

beforeAll(async () => {
  svc = createServiceRoleClient();

  await ensureAuthUser(svc, ADMIN_ID, 'tier-admin@test.local', { display_name: 'TierAdmin' });
  await ensureAuthUser(svc, USER_ID, 'tier-user@test.local', { display_name: 'TierUser' });
  await ensureAuthUser(svc, USER2_ID, 'tier-user2@test.local', { display_name: 'TierUser2' });

  await svc.from('profiles').update({ role: 'admin' }).eq('id', ADMIN_ID);
  await svc.from('profiles').update({ role: 'user' }).eq('id', USER_ID);
  await svc.from('profiles').update({ role: 'user' }).eq('id', USER2_ID);

  // Ensure ticket type
  const { data: existingType } = await svc.from('ticket_types').select('id').limit(1).single();
  if (existingType) {
    defaultTypeId = existingType.id;
  } else {
    const { data: newType } = await svc.from('ticket_types').insert({ name: 'TierTestType' }).select('id').single();
    defaultTypeId = newType!.id;
  }
}, 30000);

afterAll(async () => {
  // Clean up tiers and assignments
  await svc.from('profiles').update({ tier_id: null, tier_expires_at: null }).in('id', [USER_ID, USER2_ID]);

  if (tierId1) await svc.from('subscription_tiers').delete().eq('id', tierId1);
  if (tierId2) await svc.from('subscription_tiers').delete().eq('id', tierId2);

  // Clean up tickets
  const testUserIds = [ADMIN_ID, USER_ID, USER2_ID];
  const { data: testTickets } = await svc.from('tickets').select('id').in('creator_id', testUserIds);
  const ticketIds = testTickets?.map((t: { id: number }) => t.id) ?? [];
  if (ticketIds.length > 0) {
    await svc.from('ticket_tags').delete().in('ticket_id', ticketIds);
    await svc.from('activity_log').delete().in('ticket_id', ticketIds);
    await svc.from('posts').delete().in('ticket_id', ticketIds);
    await svc.from('tickets').delete().in('id', ticketIds);
  }

  for (const id of testUserIds) {
    await svc.auth.admin.deleteUser(id);
  }
}, 30000);


describe('019 – Subscription Tiers', () => {

  // ── Tier CRUD ──────────────────────────────────────

  describe('Tier definitions CRUD', () => {
    it('should create a tier with capabilities', async () => {
      const { data, error } = await svc
        .from('subscription_tiers')
        .insert({
          key: 'test-premium',
          display_name: 'Test Premium',
          color: 'purple',
          icon: '🌟',
          sort_order: 100,
          cap_change_visibility: true,
          cap_set_severity: true,
          cap_change_status: true,
          cap_change_type: true,
          cap_add_remove_tags: true,
          limit_ticket_rate: 50,
          limit_max_file_size: 26214400,
          limit_max_files_per_post: 15,
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(data).toBeTruthy();
      expect(data!.key).toBe('test-premium');
      expect(data!.cap_change_visibility).toBe(true);
      expect(data!.limit_ticket_rate).toBe(50);
      tierId1 = data!.id;
    });

    it('should create a basic tier without capabilities', async () => {
      const { data, error } = await svc
        .from('subscription_tiers')
        .insert({
          key: 'test-basic',
          display_name: 'Test Basic',
          color: 'gray',
          sort_order: 101,
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(data).toBeTruthy();
      expect(data!.cap_change_visibility).toBe(false);
      expect(data!.limit_ticket_rate).toBeNull();
      tierId2 = data!.id;
    });

    it('should enforce unique key constraint', async () => {
      const { error } = await svc
        .from('subscription_tiers')
        .insert({
          key: 'test-premium',
          display_name: 'Duplicate Key',
          color: 'red',
          sort_order: 102,
        });

      expect(error).toBeTruthy();
      expect(error!.code).toBe('23505'); // unique violation
    });

    it('should update a tier', async () => {
      const { data, error } = await svc
        .from('subscription_tiers')
        .update({ display_name: 'Test Premium Updated', color: 'blue' })
        .eq('id', tierId1)
        .select()
        .single();

      expect(error).toBeNull();
      expect(data!.display_name).toBe('Test Premium Updated');
      expect(data!.color).toBe('blue');
      // Revert for later tests
      await svc.from('subscription_tiers').update({ display_name: 'Test Premium', color: 'purple' }).eq('id', tierId1);
    });
  });

  // ── Tier assignment ─────────────────────────────────

  describe('Tier assignment', () => {
    it('should assign a tier to a user', async () => {
      const { error } = await svc
        .from('profiles')
        .update({ tier_id: tierId1, tier_expires_at: '2099-12-31T23:59:59Z' })
        .eq('id', USER_ID);

      expect(error).toBeNull();

      const { data } = await svc
        .from('profiles')
        .select('tier_id, tier_expires_at')
        .eq('id', USER_ID)
        .single();

      expect(data!.tier_id).toBe(tierId1);
    });

    it('should assign a no-capability tier to user2', async () => {
      const { error } = await svc
        .from('profiles')
        .update({ tier_id: tierId2, tier_expires_at: '2099-12-31T23:59:59Z' })
        .eq('id', USER2_ID);

      expect(error).toBeNull();
    });

    it('should remove a tier (set null)', async () => {
      await svc.from('profiles').update({ tier_id: null, tier_expires_at: null }).eq('id', USER2_ID);

      const { data } = await svc
        .from('profiles')
        .select('tier_id')
        .eq('id', USER2_ID)
        .single();

      expect(data!.tier_id).toBeNull();

      // Re-assign for further tests
      await svc.from('profiles').update({ tier_id: tierId2, tier_expires_at: '2099-12-31T23:59:59Z' }).eq('id', USER2_ID);
    });
  });

  // ── Capability function ──────────────────────────────

  describe('user_has_tier_capability function', () => {
    it('should return true for user with matching capability', async () => {
      const userClient = await clientForUser('tier-user@test.local');
      const { data } = await userClient.rpc('user_has_tier_capability', { capability: 'change_status' });
      expect(data).toBe(true);
    });

    it('should return true for all 5 capabilities on premium tier', async () => {
      const userClient = await clientForUser('tier-user@test.local');
      for (const cap of ['change_visibility', 'set_severity', 'change_status', 'change_type', 'add_remove_tags']) {
        const { data } = await userClient.rpc('user_has_tier_capability', { capability: cap });
        expect(data).toBe(true);
      }
    });

    it('should return false for user with tier lacking capability', async () => {
      const user2Client = await clientForUser('tier-user2@test.local');
      const { data } = await user2Client.rpc('user_has_tier_capability', { capability: 'change_status' });
      expect(data).toBe(false);
    });

    it('should return false for invalid capability name', async () => {
      const userClient = await clientForUser('tier-user@test.local');
      const { data } = await userClient.rpc('user_has_tier_capability', { capability: 'invalid' });
      expect(data).toBe(false);
    });

    it('should return false for expired tier', async () => {
      // Temporarily expire the tier
      await svc.from('profiles').update({ tier_expires_at: '2020-01-01T00:00:00Z' }).eq('id', USER_ID);

      const userClient = await clientForUser('tier-user@test.local');
      const { data } = await userClient.rpc('user_has_tier_capability', { capability: 'change_status' });
      expect(data).toBe(false);

      // Restore
      await svc.from('profiles').update({ tier_expires_at: '2099-12-31T23:59:59Z' }).eq('id', USER_ID);
    });

    it('should return false for user with no tier', async () => {
      // Temporarily remove tier
      await svc.from('profiles').update({ tier_id: null }).eq('id', USER_ID);

      const userClient = await clientForUser('tier-user@test.local');
      const { data } = await userClient.rpc('user_has_tier_capability', { capability: 'change_status' });
      expect(data).toBe(false);

      // Restore
      await svc.from('profiles').update({ tier_id: tierId1 }).eq('id', USER_ID);
    });

    it('should return false for blocked user', async () => {
      await svc.from('profiles').update({ is_blocked: true }).eq('id', USER_ID);

      const userClient = await clientForUser('tier-user@test.local');
      const { data } = await userClient.rpc('user_has_tier_capability', { capability: 'change_status' });
      expect(data).toBe(false);

      await svc.from('profiles').update({ is_blocked: false }).eq('id', USER_ID);
    });
  });

  // ── RLS ───────────────────────────────────────────

  describe('RLS policies on subscription_tiers', () => {
    it('should allow any authenticated user to read tiers', async () => {
      const userClient = await clientForUser('tier-user@test.local');
      const { data, error } = await userClient
        .from('subscription_tiers')
        .select('id, key, display_name')
        .eq('id', tierId1);

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data![0].key).toBe('test-premium');
    });

    it('should prevent non-admin from inserting tiers', async () => {
      const userClient = await clientForUser('tier-user@test.local');
      const { error } = await userClient
        .from('subscription_tiers')
        .insert({
          key: 'test-hacker',
          display_name: 'Hacker Tier',
          color: 'red',
          sort_order: 200,
        });

      expect(error).toBeTruthy();
    });

    it('should prevent non-admin from updating tiers', async () => {
      const userClient = await clientForUser('tier-user@test.local');
      const { error } = await userClient
        .from('subscription_tiers')
        .update({ display_name: 'Hacked' })
        .eq('id', tierId1);

      // Either error or no rows affected
      if (!error) {
        const { data } = await svc.from('subscription_tiers').select('display_name').eq('id', tierId1).single();
        expect(data!.display_name).toBe('Test Premium');
      }
    });

    it('should prevent non-admin from deleting tiers', async () => {
      const userClient = await clientForUser('tier-user@test.local');
      const { error: _error } = await userClient
        .from('subscription_tiers')
        .delete()
        .eq('id', tierId1);

      // Tier should still exist
      const { data } = await svc.from('subscription_tiers').select('id').eq('id', tierId1).single();
      expect(data).toBeTruthy();
    });

    it('should allow admin to manage tiers', async () => {
      const adminClient = await clientForUser('tier-admin@test.local');
      const { data, error } = await adminClient
        .from('subscription_tiers')
        .update({ icon: '💎' })
        .eq('id', tierId1)
        .select()
        .single();

      expect(error).toBeNull();
      expect(data!.icon).toBe('💎');

      // Revert
      await svc.from('subscription_tiers').update({ icon: '🌟' }).eq('id', tierId1);
    });
  });

  // ── agent_tickets VIEW ─────────────────────────────

  describe('agent_tickets VIEW tier columns', () => {
    let testTicketId: number;

    beforeAll(async () => {
      // Create a ticket from USER_ID who has a tier
      const { data } = await svc
        .from('tickets')
        .insert({
          title: 'Tier View Test',
          slug: 'tier-view-test',
          creator_id: USER_ID,
          type_id: defaultTypeId,
        })
        .select('id')
        .single();
      testTicketId = data!.id;

      await svc.from('posts').insert({
        ticket_id: testTicketId,
        author_id: USER_ID,
        body: 'Original post',
        post_type: 'post',
        is_original: true,
      });
    });

    it('should include tier columns in agent_tickets view', async () => {
      const adminClient = await clientForUser('tier-admin@test.local');
      const { data, error } = await adminClient
        .from('agent_tickets')
        .select('id, creator_tier_key, creator_tier_display_name, creator_tier_color, creator_tier_icon, creator_tier_active')
        .eq('id', testTicketId)
        .single();

      expect(error).toBeNull();
      expect(data!.creator_tier_key).toBe('test-premium');
      expect(data!.creator_tier_display_name).toBe('Test Premium');
      expect(data!.creator_tier_color).toBe('purple');
      expect(data!.creator_tier_icon).toBe('🌟');
      expect(data!.creator_tier_active).toBe(true);
    });

    it('should show tier_active=false for expired tier', async () => {
      await svc.from('profiles').update({ tier_expires_at: '2020-01-01T00:00:00Z' }).eq('id', USER_ID);

      const adminClient = await clientForUser('tier-admin@test.local');
      const { data } = await adminClient
        .from('agent_tickets')
        .select('creator_tier_active')
        .eq('id', testTicketId)
        .single();

      expect(data!.creator_tier_active).toBe(false);

      await svc.from('profiles').update({ tier_expires_at: '2099-12-31T23:59:59Z' }).eq('id', USER_ID);
    });

    it('should show null tier columns for user without tier', async () => {
      // Create ticket from user2 (has basic tier)
      await svc.from('profiles').update({ tier_id: null }).eq('id', USER2_ID);

      const { data: t } = await svc
        .from('tickets')
        .insert({
          title: 'No Tier Test',
          slug: 'no-tier-test',
          creator_id: USER2_ID,
          type_id: defaultTypeId,
        })
        .select('id')
        .single();

      await svc.from('posts').insert({
        ticket_id: t!.id,
        author_id: USER2_ID,
        body: 'No tier post',
        post_type: 'post',
        is_original: true,
      });

      const adminClient = await clientForUser('tier-admin@test.local');
      const { data } = await adminClient
        .from('agent_tickets')
        .select('creator_tier_key, creator_tier_active')
        .eq('id', t!.id)
        .single();

      expect(data!.creator_tier_key).toBeNull();
      expect(data!.creator_tier_active).toBe(false);

      // Re-assign tier
      await svc.from('profiles').update({ tier_id: tierId2, tier_expires_at: '2099-12-31T23:59:59Z' }).eq('id', USER2_ID);
    });
  });

  // ── Tier deletion cascading ─────────────────────────

  describe('Tier deletion', () => {
    it('should set tier_id to null on profiles when tier is deleted (ON DELETE SET NULL)', async () => {
      // Create a temporary tier
      const { data: tempTier } = await svc
        .from('subscription_tiers')
        .insert({ key: 'test-temp', display_name: 'Temp', color: 'red', sort_order: 200 })
        .select()
        .single();

      // Assign to user2
      await svc.from('profiles').update({ tier_id: tempTier!.id }).eq('id', USER2_ID);

      // Delete tier
      await svc.from('subscription_tiers').delete().eq('id', tempTier!.id);

      // User2 should have null tier_id
      const { data } = await svc.from('profiles').select('tier_id').eq('id', USER2_ID).single();
      expect(data!.tier_id).toBeNull();

      // Re-assign for other tests
      await svc.from('profiles').update({ tier_id: tierId2, tier_expires_at: '2099-12-31T23:59:59Z' }).eq('id', USER2_ID);
    });
  });

  // ── ticket_tags RLS with tier capability ──────────

  describe('ticket_tags RLS for tier users', () => {
    let testTicketId: number;
    let testTagId: string;

    beforeAll(async () => {
      // Create a ticket from USER_ID
      const { data } = await svc
        .from('tickets')
        .insert({
          title: 'Tag Tier Test',
          slug: 'tag-tier-test',
          creator_id: USER_ID,
          type_id: defaultTypeId,
        })
        .select('id')
        .single();
      testTicketId = data!.id;

      await svc.from('posts').insert({
        ticket_id: testTicketId,
        author_id: USER_ID,
        body: 'Tag test post',
        post_type: 'post',
        is_original: true,
      });

      // Ensure a tag exists
      const { data: existingTag } = await svc.from('tags').select('id').limit(1).single();
      if (existingTag) {
        testTagId = existingTag.id;
      } else {
        const { data: newTag } = await svc.from('tags').insert({ name: 'tier-test-tag', color: '#ff0000' }).select('id').single();
        testTagId = newTag!.id;
      }
    });

    it('should allow tier user with cap_add_remove_tags to add tag to own ticket', async () => {
      const userClient = await clientForUser('tier-user@test.local');
      const { error } = await userClient
        .from('ticket_tags')
        .insert({ ticket_id: testTicketId, tag_id: testTagId });

      expect(error).toBeNull();
    });

    it('should allow tier user with cap_add_remove_tags to remove tag from own ticket', async () => {
      const userClient = await clientForUser('tier-user@test.local');
      const { error } = await userClient
        .from('ticket_tags')
        .delete()
        .eq('ticket_id', testTicketId)
        .eq('tag_id', testTagId);

      expect(error).toBeNull();
    });

    it('should NOT allow tier user without capability to add tag', async () => {
      // user2 has basic tier (no capabilities)
      // Create a ticket for user2
      const { data: t } = await svc
        .from('tickets')
        .insert({
          title: 'NoCapTag Test',
          slug: 'nocaptag-test',
          creator_id: USER2_ID,
          type_id: defaultTypeId,
        })
        .select('id')
        .single();

      await svc.from('posts').insert({
        ticket_id: t!.id,
        author_id: USER2_ID,
        body: 'No cap post',
        post_type: 'post',
        is_original: true,
      });

      const user2Client = await clientForUser('tier-user2@test.local');
      const { error } = await user2Client
        .from('ticket_tags')
        .insert({ ticket_id: t!.id, tag_id: testTagId });

      expect(error).toBeTruthy();
    });
  });
});
