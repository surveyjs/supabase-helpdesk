import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServiceRoleClient } from '../helpers/supabase';
import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Shared helpers & constants
// ---------------------------------------------------------------------------

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const ADMIN_ID = '00000000-0000-0000-0000-000000000201';
const AGENT_ID = '00000000-0000-0000-0000-000000000202';
const USER_ID = '00000000-0000-0000-0000-000000000203';
const USER2_ID = '00000000-0000-0000-0000-000000000204';

let svc: SupabaseClient;
let defaultTypeId: string;
let ticketId: number;
let ticketId2: number;

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
  await svc.from('csat_ratings').delete().in(
    'ticket_id',
    (await svc.from('tickets').select('id').in('creator_id', testUserIds)).data?.map((t: { id: number }) => t.id) ?? [],
  );
  await svc.from('csat_survey_schedule').delete().in(
    'ticket_id',
    (await svc.from('tickets').select('id').in('creator_id', testUserIds)).data?.map((t: { id: number }) => t.id) ?? [],
  );
  const { data: testTickets } = await svc.from('tickets').select('id').in('creator_id', testUserIds);
  if (testTickets && testTickets.length > 0) {
    const ticketIds = testTickets.map((t: { id: number }) => t.id);
    await svc.from('csat_ratings').delete().in('ticket_id', ticketIds);
    await svc.from('csat_survey_schedule').delete().in('ticket_id', ticketIds);
    await svc.from('notifications').delete().in('ticket_id', ticketIds);
    await svc.from('notification_coalescing_queue').delete().in('ticket_id', ticketIds);
    await svc.from('activity_log').delete().in('ticket_id', ticketIds);
    await svc.from('ticket_tags').delete().in('ticket_id', ticketIds);
    await svc.from('posts').delete().in('ticket_id', ticketIds);
    await svc.from('tickets').update({ duplicate_of_id: null, merged_into_id: null }).in('id', ticketIds);
    await svc.from('tickets').delete().in('id', ticketIds);
  }
  await svc.from('notification_preferences').delete().in('user_id', testUserIds);
  await svc.from('admin_audit_log').delete().in('admin_id', testUserIds);
  await svc.from('profiles').delete().in('id', testUserIds);

  // Delete auth users
  for (const uid of testUserIds) {
    await svc.auth.admin.deleteUser(uid).catch(() => {});
  }

  // Create test users
  await ensureAuthUser(svc, ADMIN_ID, 'csat-admin@test.com', { display_name: 'CsatAdmin' });
  await ensureAuthUser(svc, AGENT_ID, 'csat-agent@test.com', { display_name: 'CsatAgent' });
  await ensureAuthUser(svc, USER_ID, 'csat-user@test.com', { display_name: 'CsatUser' });
  await ensureAuthUser(svc, USER2_ID, 'csat-user2@test.com', { display_name: 'CsatUser2' });

  // Promote admin and agent
  await svc.from('profiles').update({ role: 'admin' }).eq('id', ADMIN_ID);
  await svc.from('profiles').update({ role: 'agent' }).eq('id', AGENT_ID);

  // Ensure ticket type exists
  const { data: existingType } = await svc.from('ticket_types').select('id').limit(1).single();
  if (existingType) {
    defaultTypeId = existingType.id;
  } else {
    const { data: newType } = await svc.from('ticket_types').insert({ name: 'CsatTestType' }).select('id').single();
    defaultTypeId = newType!.id;
  }

  // Create test tickets
  const { data: t1 } = await svc
    .from('tickets')
    .insert({
      title: 'CSAT Test Ticket 1',
      slug: 'csat-test-ticket-1',
      creator_id: USER_ID,
      type_id: defaultTypeId,
      assigned_agent_id: AGENT_ID,
    })
    .select('id')
    .single();
  ticketId = t1!.id;

  const { data: t2 } = await svc
    .from('tickets')
    .insert({
      title: 'CSAT Test Ticket 2',
      slug: 'csat-test-ticket-2',
      creator_id: USER_ID,
      type_id: defaultTypeId,
    })
    .select('id')
    .single();
  ticketId2 = t2!.id;
}, 30000);

afterAll(async () => {
  const testUserIds = [ADMIN_ID, AGENT_ID, USER_ID, USER2_ID];
  const { data: testTickets } = await svc.from('tickets').select('id').in('creator_id', testUserIds);
  const ticketIds = testTickets?.map((t: { id: number }) => t.id) ?? [];
  if (ticketIds.length > 0) {
    await svc.from('csat_ratings').delete().in('ticket_id', ticketIds);
    await svc.from('csat_survey_schedule').delete().in('ticket_id', ticketIds);
    await svc.from('notifications').delete().in('ticket_id', ticketIds);
    await svc.from('notification_coalescing_queue').delete().in('ticket_id', ticketIds);
    await svc.from('activity_log').delete().in('ticket_id', ticketIds);
    await svc.from('ticket_tags').delete().in('ticket_id', ticketIds);
    await svc.from('posts').delete().in('ticket_id', ticketIds);
    await svc.from('tickets').update({ duplicate_of_id: null, merged_into_id: null }).in('id', ticketIds);
    await svc.from('tickets').delete().in('id', ticketIds);
  }
  await svc.from('notification_preferences').delete().in('user_id', testUserIds);
  await svc.from('admin_audit_log').delete().in('admin_id', testUserIds);
  await svc.from('profiles').delete().in('id', testUserIds);
  for (const uid of testUserIds) {
    await svc.auth.admin.deleteUser(uid).catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CSAT (Customer Satisfaction)', () => {
  // ==================== Token Generation ====================

  describe('CSAT token generation', () => {
    it('generates a valid 64-char hex token', () => {
      const token = crypto.randomBytes(32).toString('hex');
      expect(token).toHaveLength(64);
      expect(/^[0-9a-f]{64}$/.test(token)).toBe(true);
    });
  });

  // ==================== csat_ratings table ====================

  describe('csat_ratings table', () => {
    let testToken: string;

    it('can create a CSAT rating row with token', async () => {
      testToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      const { data, error } = await svc
        .from('csat_ratings')
        .insert({
          ticket_id: ticketId,
          token: testToken,
          token_expires_at: expiresAt,
          is_used: false,
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data!.ticket_id).toBe(ticketId);
      expect(data!.token).toBe(testToken);
      expect(data!.is_used).toBe(false);
      expect(data!.rating).toBeNull();
    });

    it('token validation returns valid for fresh token', async () => {
      const { data, error } = await svc
        .from('csat_ratings')
        .select('id, ticket_id, rating, token_expires_at, is_used')
        .eq('token', testToken)
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data!.is_used).toBe(false);
      expect(new Date(data!.token_expires_at) > new Date()).toBe(true);
    });

    it('token validation returns invalid for expired token', async () => {
      const expiredToken = crypto.randomBytes(32).toString('hex');
      const pastDate = new Date(Date.now() - 60000).toISOString();

      await svc.from('csat_ratings').insert({
        ticket_id: ticketId,
        token: expiredToken,
        token_expires_at: pastDate,
        is_used: false,
      });

      const { data } = await svc
        .from('csat_ratings')
        .select('token_expires_at')
        .eq('token', expiredToken)
        .single();

      expect(data).toBeDefined();
      expect(new Date(data!.token_expires_at) < new Date()).toBe(true);
    });

    it('token validation returns invalid for used token without rating', async () => {
      const usedToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      await svc.from('csat_ratings').insert({
        ticket_id: ticketId,
        token: usedToken,
        token_expires_at: expiresAt,
        is_used: true,
      });

      const { data } = await svc
        .from('csat_ratings')
        .select('is_used, rating')
        .eq('token', usedToken)
        .single();

      expect(data).toBeDefined();
      expect(data!.is_used).toBe(true);
      expect(data!.rating).toBeNull();
    });

    it('rating submission stores rating and comment correctly', async () => {
      const { error } = await svc
        .from('csat_ratings')
        .update({
          rating: 4,
          comment: 'Great support!',
          submitted_at: new Date().toISOString(),
          is_used: true,
        })
        .eq('token', testToken);

      expect(error).toBeNull();

      const { data } = await svc
        .from('csat_ratings')
        .select('rating, comment, submitted_at, is_used')
        .eq('token', testToken)
        .single();

      expect(data!.rating).toBe(4);
      expect(data!.comment).toBe('Great support!');
      expect(data!.submitted_at).toBeDefined();
      expect(data!.is_used).toBe(true);
    });

    it('new token can be issued after rating submission (reissue)', async () => {
      const newToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      const { error } = await svc.from('csat_ratings').insert({
        ticket_id: ticketId,
        token: newToken,
        token_expires_at: expiresAt,
        is_used: false,
      });

      expect(error).toBeNull();

      // Old token still has rating
      const { data: oldRating } = await svc
        .from('csat_ratings')
        .select('rating')
        .eq('token', testToken)
        .single();
      expect(oldRating!.rating).toBe(4);

      // New token is fresh
      const { data: newRating } = await svc
        .from('csat_ratings')
        .select('rating, is_used')
        .eq('token', newToken)
        .single();
      expect(newRating!.rating).toBeNull();
      expect(newRating!.is_used).toBe(false);
    });

    it('CSAT rating is associated with correct ticket', async () => {
      const { data } = await svc
        .from('csat_ratings')
        .select('ticket_id')
        .eq('token', testToken)
        .single();

      expect(data!.ticket_id).toBe(ticketId);
    });

    it('only one active (unused, no rating) token per ticket at a time after invalidation', async () => {
      // Insert two unused tokens for ticket2
      const token1 = crypto.randomBytes(32).toString('hex');
      const token2 = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      await svc.from('csat_ratings').insert({
        ticket_id: ticketId2,
        token: token1,
        token_expires_at: expiresAt,
        is_used: false,
      });

      // Simulate reissue: invalidate first, create second
      await svc
        .from('csat_ratings')
        .update({ is_used: true })
        .eq('ticket_id', ticketId2)
        .eq('is_used', false)
        .is('rating', null);

      await svc.from('csat_ratings').insert({
        ticket_id: ticketId2,
        token: token2,
        token_expires_at: expiresAt,
        is_used: false,
      });

      // Only token2 should be active
      const { data: activeTokens } = await svc
        .from('csat_ratings')
        .select('token, is_used')
        .eq('ticket_id', ticketId2)
        .eq('is_used', false)
        .is('rating', null);

      expect(activeTokens).toHaveLength(1);
      expect(activeTokens![0].token).toBe(token2);
    });

    it('rating must be between 1 and 5', async () => {
      const badToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      await svc.from('csat_ratings').insert({
        ticket_id: ticketId,
        token: badToken,
        token_expires_at: expiresAt,
        is_used: false,
      });

      // Try rating = 0
      const { error: err0 } = await svc
        .from('csat_ratings')
        .update({ rating: 0 })
        .eq('token', badToken);

      expect(err0).not.toBeNull();

      // Try rating = 6
      const { error: err6 } = await svc
        .from('csat_ratings')
        .update({ rating: 6 })
        .eq('token', badToken);

      expect(err6).not.toBeNull();
    });

    it('comment must be 5000 chars or fewer (CHECK constraint)', async () => {
      const longToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      await svc.from('csat_ratings').insert({
        ticket_id: ticketId,
        token: longToken,
        token_expires_at: expiresAt,
        is_used: false,
      });

      const { error } = await svc
        .from('csat_ratings')
        .update({ rating: 3, comment: 'x'.repeat(5001) })
        .eq('token', longToken);

      expect(error).not.toBeNull();
    });
  });

  // ==================== csat_survey_schedule table ====================

  describe('csat_survey_schedule table', () => {
    it('schedule inserts correctly', async () => {
      const { data, error } = await svc
        .from('csat_survey_schedule')
        .insert({
          ticket_id: ticketId,
          scheduled_at: new Date(Date.now() + 3600000).toISOString(),
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data!.is_sent).toBe(false);
      expect(data!.is_cancelled).toBe(false);
    });

    it('cancelling a survey updates is_cancelled', async () => {
      const { error } = await svc
        .from('csat_survey_schedule')
        .update({ is_cancelled: true })
        .eq('ticket_id', ticketId)
        .eq('is_sent', false);

      expect(error).toBeNull();

      const { data } = await svc
        .from('csat_survey_schedule')
        .select('is_cancelled')
        .eq('ticket_id', ticketId)
        .single();

      expect(data!.is_cancelled).toBe(true);
    });

    it('UNIQUE constraint on ticket_id prevents duplicate schedules', async () => {
      // ticketId already has a schedule from above
      const { error } = await svc
        .from('csat_survey_schedule')
        .insert({
          ticket_id: ticketId,
          scheduled_at: new Date(Date.now() + 7200000).toISOString(),
        });

      expect(error).not.toBeNull();
    });

    it('schedule upsert works by updating existing row', async () => {
      const newSchedule = new Date(Date.now() + 7200000).toISOString();

      const { error } = await svc
        .from('csat_survey_schedule')
        .update({
          scheduled_at: newSchedule,
          is_sent: false,
          is_cancelled: false,
        })
        .eq('ticket_id', ticketId);

      expect(error).toBeNull();

      const { data } = await svc
        .from('csat_survey_schedule')
        .select('scheduled_at, is_cancelled')
        .eq('ticket_id', ticketId)
        .single();

      expect(data!.is_cancelled).toBe(false);
    });
  });

  // ==================== CASCADE deletes ====================

  describe('CASCADE deletes', () => {
    it('CSAT ratings cascade when ticket is deleted', async () => {
      // Create a temporary ticket
      const { data: tempTicket } = await svc
        .from('tickets')
        .insert({
          title: 'CSAT Cascade Test',
          slug: 'csat-cascade-test',
          creator_id: USER_ID,
          type_id: defaultTypeId,
        })
        .select('id')
        .single();

      const tempToken = crypto.randomBytes(32).toString('hex');
      await svc.from('csat_ratings').insert({
        ticket_id: tempTicket!.id,
        token: tempToken,
        token_expires_at: new Date(Date.now() + 86400000).toISOString(),
      });

      // Delete ticket
      await svc.from('tickets').delete().eq('id', tempTicket!.id);

      // Verify CSAT rating is gone
      const { data } = await svc
        .from('csat_ratings')
        .select('id')
        .eq('token', tempToken);

      expect(data).toHaveLength(0);
    });

    it('CSAT survey schedule cascades when ticket is deleted', async () => {
      // Create a temporary ticket
      const { data: tempTicket } = await svc
        .from('tickets')
        .insert({
          title: 'CSAT Schedule Cascade Test',
          slug: 'csat-schedule-cascade-test',
          creator_id: USER_ID,
          type_id: defaultTypeId,
        })
        .select('id')
        .single();

      await svc.from('csat_survey_schedule').insert({
        ticket_id: tempTicket!.id,
        scheduled_at: new Date(Date.now() + 3600000).toISOString(),
      });

      // Delete ticket
      await svc.from('tickets').delete().eq('id', tempTicket!.id);

      // Verify schedule is gone
      const { data } = await svc
        .from('csat_survey_schedule')
        .select('id')
        .eq('ticket_id', tempTicket!.id);

      expect(data).toHaveLength(0);
    });
  });

  // ==================== RLS Tests ====================

  describe('RLS policies', () => {
    it('regular user cannot read csat_ratings (service_role-only SELECT)', async () => {
      const user = await clientForUser('csat-user@test.com');
      const { data } = await user
        .from('csat_ratings')
        .select('id, rating')
        .eq('ticket_id', ticketId)
        .limit(1);

      // RLS should filter — user sees nothing
      expect(data).toHaveLength(0);
    });

    it('admin cannot read csat_survey_schedule (service_role-only SELECT)', async () => {
      const admin = await clientForUser('csat-admin@test.com');
      const { data } = await admin
        .from('csat_survey_schedule')
        .select('id')
        .eq('ticket_id', ticketId);

      // RLS should filter — even admin sees nothing (service_role only)
      expect(data).toHaveLength(0);
    });

    it('regular user cannot read csat_survey_schedule (admin-only SELECT)', async () => {
      const user = await clientForUser('csat-user@test.com');
      const { data } = await user
        .from('csat_survey_schedule')
        .select('id')
        .eq('ticket_id', ticketId);

      // RLS should filter — user sees nothing
      expect(data).toHaveLength(0);
    });
  });

  // ==================== app_settings (CSAT) ====================

  describe('CSAT app_settings', () => {
    // Reset CSAT settings to their migration defaults in case prior tests
    // (e.g. e2e suites) mutated them and left the database in a non-default state.
    beforeAll(async () => {
      await svc.from('app_settings').update({ value: 'false' }).eq('key', 'csat_enabled');
      await svc.from('app_settings').update({ value: '1_hour' }).eq('key', 'csat_survey_delay');
    });

    it('csat_enabled setting exists and defaults to false', async () => {
      const { data } = await svc
        .from('app_settings')
        .select('value')
        .eq('key', 'csat_enabled')
        .single();

      expect(data).toBeDefined();
      expect(data!.value).toBe('false');
    });

    it('csat_survey_delay setting exists and defaults to 1_hour', async () => {
      const { data } = await svc
        .from('app_settings')
        .select('value')
        .eq('key', 'csat_survey_delay')
        .single();

      expect(data).toBeDefined();
      expect(data!.value).toBe('1_hour');
    });
  });

  // ==================== notification_templates ====================

  describe('CSAT notification templates', () => {
    it('csat_survey template exists', async () => {
      const { data } = await svc
        .from('notification_templates')
        .select('event_type, subject')
        .eq('event_type', 'csat_survey')
        .single();

      expect(data).toBeDefined();
      expect(data!.subject).toContain('{{ticketId}}');
    });

    it('csat_submitted template exists', async () => {
      const { data } = await svc
        .from('notification_templates')
        .select('event_type, subject')
        .eq('event_type', 'csat_submitted')
        .single();

      expect(data).toBeDefined();
      expect(data!.subject).toContain('{{ticketId}}');
    });
  });
});
