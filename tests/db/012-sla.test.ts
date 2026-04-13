import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServiceRoleClient } from '../helpers/supabase';

// ---------------------------------------------------------------------------
// Shared helpers & constants
// ---------------------------------------------------------------------------

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const ADMIN_ID = '00000000-0000-0000-0000-000000000301';
const AGENT_ID = '00000000-0000-0000-0000-000000000302';
const USER_ID = '00000000-0000-0000-0000-000000000303';

let svc: SupabaseClient;
let defaultTypeId: string;
let ticketId: number;
let ticketId2: number;
let policyId: string;

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

  const testUserIds = [ADMIN_ID, AGENT_ID, USER_ID];

  // Clean up leftover data from previous runs
  const { data: testTickets } = await svc.from('tickets').select('id').in('creator_id', testUserIds);
  if (testTickets && testTickets.length > 0) {
    const ticketIds = testTickets.map((t: { id: number }) => t.id);
    await svc.from('sla_notifications_sent').delete().in(
      'sla_timer_id',
      (await svc.from('sla_timers').select('id').in('ticket_id', ticketIds)).data?.map((t: { id: string }) => t.id) ?? [],
    );
    await svc.from('sla_timers').delete().in('ticket_id', ticketIds);
    await svc.from('activity_log').delete().in('ticket_id', ticketIds);
    await svc.from('ticket_tags').delete().in('ticket_id', ticketIds);
    await svc.from('posts').delete().in('ticket_id', ticketIds);
    await svc.from('tickets').update({ duplicate_of_id: null, merged_into_id: null }).in('id', ticketIds);
    await svc.from('tickets').delete().in('id', ticketIds);
  }
  await svc.from('sla_policies').delete().ilike('name', 'SLA Test%');
  await svc.from('admin_audit_log').delete().in('admin_id', testUserIds);
  await svc.from('profiles').delete().in('id', testUserIds);

  // Delete auth users
  for (const uid of testUserIds) {
    await svc.auth.admin.deleteUser(uid).catch(() => {});
  }

  // Create test users
  await ensureAuthUser(svc, ADMIN_ID, 'sla-admin@test.com', { display_name: 'SlaAdmin' });
  await ensureAuthUser(svc, AGENT_ID, 'sla-agent@test.com', { display_name: 'SlaAgent' });
  await ensureAuthUser(svc, USER_ID, 'sla-user@test.com', { display_name: 'SlaUser' });

  // Promote admin and agent
  await svc.from('profiles').update({ role: 'admin' }).eq('id', ADMIN_ID);
  await svc.from('profiles').update({ role: 'agent' }).eq('id', AGENT_ID);

  // Ensure ticket type exists
  const { data: existingType } = await svc.from('ticket_types').select('id').limit(1).single();
  if (existingType) {
    defaultTypeId = existingType.id;
  } else {
    const { data: newType } = await svc.from('ticket_types').insert({ name: 'SlaTestType' }).select('id').single();
    defaultTypeId = newType!.id;
  }

  // Create an SLA policy for tests
  const { data: policy } = await svc
    .from('sla_policies')
    .insert({ name: 'SLA Test Policy', first_response_minutes: 60, resolution_minutes: 480 })
    .select('id')
    .single();
  policyId = policy!.id;

  // Create test tickets
  const { data: t1 } = await svc
    .from('tickets')
    .insert({
      title: 'SLA Test Ticket 1',
      slug: 'sla-test-ticket-1',
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
      title: 'SLA Test Ticket 2',
      slug: 'sla-test-ticket-2',
      creator_id: USER_ID,
      type_id: defaultTypeId,
    })
    .select('id')
    .single();
  ticketId2 = t2!.id;
}, 30000);

afterAll(async () => {
  const testUserIds = [ADMIN_ID, AGENT_ID, USER_ID];
  const { data: testTickets } = await svc.from('tickets').select('id').in('creator_id', testUserIds);
  const ticketIds = testTickets?.map((t: { id: number }) => t.id) ?? [];
  if (ticketIds.length > 0) {
    const timerIds = (await svc.from('sla_timers').select('id').in('ticket_id', ticketIds)).data?.map((t: { id: string }) => t.id) ?? [];
    if (timerIds.length > 0) {
      await svc.from('sla_notifications_sent').delete().in('sla_timer_id', timerIds);
    }
    await svc.from('sla_timers').delete().in('ticket_id', ticketIds);
    await svc.from('activity_log').delete().in('ticket_id', ticketIds);
    await svc.from('ticket_tags').delete().in('ticket_id', ticketIds);
    await svc.from('posts').delete().in('ticket_id', ticketIds);
    await svc.from('tickets').update({ duplicate_of_id: null, merged_into_id: null }).in('id', ticketIds);
    await svc.from('tickets').delete().in('id', ticketIds);
  }
  await svc.from('sla_policies').delete().ilike('name', 'SLA Test%');
  await svc.from('admin_audit_log').delete().in('admin_id', testUserIds);
  await svc.from('profiles').delete().in('id', testUserIds);
  for (const uid of testUserIds) {
    await svc.auth.admin.deleteUser(uid).catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SLA Policies', () => {
  // ==================== sla_policies table ====================

  describe('sla_policies CRUD', () => {
    it('admin can create an SLA policy', async () => {
      const admin = await clientForUser('sla-admin@test.com');
      const { data, error } = await admin
        .from('sla_policies')
        .insert({ name: 'SLA Test Admin Create', first_response_minutes: 30, resolution_minutes: 120 })
        .select()
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data!.name).toBe('SLA Test Admin Create');
      expect(data!.first_response_minutes).toBe(30);
      expect(data!.resolution_minutes).toBe(120);

      // Cleanup
      await svc.from('sla_policies').delete().eq('id', data!.id);
    });

    it('admin can update an SLA policy', async () => {
      const admin = await clientForUser('sla-admin@test.com');
      const { error } = await admin
        .from('sla_policies')
        .update({ first_response_minutes: 90 })
        .eq('id', policyId);

      expect(error).toBeNull();

      const { data } = await admin
        .from('sla_policies')
        .select('first_response_minutes')
        .eq('id', policyId)
        .single();
      expect(data!.first_response_minutes).toBe(90);

      // Restore
      await svc.from('sla_policies').update({ first_response_minutes: 60 }).eq('id', policyId);
    });

    it('admin can delete an SLA policy', async () => {
      const { data: temp } = await svc
        .from('sla_policies')
        .insert({ name: 'SLA Test To Delete', first_response_minutes: 10, resolution_minutes: 20 })
        .select('id')
        .single();

      const admin = await clientForUser('sla-admin@test.com');
      const { error } = await admin.from('sla_policies').delete().eq('id', temp!.id);
      expect(error).toBeNull();

      const { data: check } = await svc.from('sla_policies').select('id').eq('id', temp!.id);
      expect(check).toHaveLength(0);
    });

    it('agent cannot create an SLA policy', async () => {
      const agent = await clientForUser('sla-agent@test.com');
      const { error } = await agent
        .from('sla_policies')
        .insert({ name: 'SLA Test Agent Blocked', first_response_minutes: 10, resolution_minutes: 20 });

      expect(error).not.toBeNull();
    });

    it('regular user cannot create an SLA policy', async () => {
      const user = await clientForUser('sla-user@test.com');
      const { error } = await user
        .from('sla_policies')
        .insert({ name: 'SLA Test User Blocked', first_response_minutes: 10, resolution_minutes: 20 });

      expect(error).not.toBeNull();
    });

    it('agent can read SLA policies', async () => {
      const agent = await clientForUser('sla-agent@test.com');
      const { data, error } = await agent
        .from('sla_policies')
        .select('*')
        .eq('id', policyId);

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it('regular user can read SLA policies', async () => {
      const user = await clientForUser('sla-user@test.com');
      const { data, error } = await user
        .from('sla_policies')
        .select('*')
        .eq('id', policyId);

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it('rejects zero or negative first_response_minutes', async () => {
      const { error } = await svc
        .from('sla_policies')
        .insert({ name: 'SLA Test Bad FR', first_response_minutes: 0, resolution_minutes: 60 });

      expect(error).not.toBeNull();
    });

    it('rejects zero or negative resolution_minutes', async () => {
      const { error } = await svc
        .from('sla_policies')
        .insert({ name: 'SLA Test Bad Res', first_response_minutes: 60, resolution_minutes: -1 });

      expect(error).not.toBeNull();
    });

    it('rejects duplicate policy name', async () => {
      const { error } = await svc
        .from('sla_policies')
        .insert({ name: 'SLA Test Policy', first_response_minutes: 60, resolution_minutes: 480 });

      expect(error).not.toBeNull();
    });
  });

  // ==================== sla_severity_mapping table ====================

  describe('sla_severity_mapping', () => {
    it('has four severity levels seeded', async () => {
      const { data, error } = await svc
        .from('sla_severity_mapping')
        .select('severity');

      expect(error).toBeNull();
      expect(data).toHaveLength(4);
      const severities = data!.map((d: { severity: string }) => d.severity).sort();
      expect(severities).toEqual(['critical', 'high', 'low', 'medium']);
    });

    it('admin can update severity mapping', async () => {
      const admin = await clientForUser('sla-admin@test.com');
      const { error } = await admin
        .from('sla_severity_mapping')
        .update({ sla_policy_id: policyId })
        .eq('severity', 'critical');

      expect(error).toBeNull();

      const { data } = await svc
        .from('sla_severity_mapping')
        .select('sla_policy_id')
        .eq('severity', 'critical')
        .single();
      expect(data!.sla_policy_id).toBe(policyId);

      // Restore to whatever seed had (from 011_sla.sql seed data might exist)
      // Just reset to null for test isolation
      await svc.from('sla_severity_mapping').update({ sla_policy_id: null }).eq('severity', 'critical');
    });

    it('agent cannot update severity mapping', async () => {
      // First set low to null so we can detect unauthorized changes
      await svc.from('sla_severity_mapping').update({ sla_policy_id: null }).eq('severity', 'low');

      const agent = await clientForUser('sla-agent@test.com');
      // RLS blocks the update silently (0 rows affected)
      await agent
        .from('sla_severity_mapping')
        .update({ sla_policy_id: policyId })
        .eq('severity', 'low');

      // Verify with service role that the value is still null
      const { data } = await svc
        .from('sla_severity_mapping')
        .select('sla_policy_id')
        .eq('severity', 'low')
        .single();
      expect(data!.sla_policy_id).toBeNull();
    });

    it('cascade sets null when policy is deleted', async () => {
      // Create temporary policy + assign to low severity
      const { data: tmp } = await svc
        .from('sla_policies')
        .insert({ name: 'SLA Test Cascade', first_response_minutes: 10, resolution_minutes: 20 })
        .select('id')
        .single();

      await svc.from('sla_severity_mapping').update({ sla_policy_id: tmp!.id }).eq('severity', 'low');

      // Delete the policy
      await svc.from('sla_policies').delete().eq('id', tmp!.id);

      // Mapping should be null now
      const { data } = await svc
        .from('sla_severity_mapping')
        .select('sla_policy_id')
        .eq('severity', 'low')
        .single();
      expect(data!.sla_policy_id).toBeNull();
    });
  });

  // ==================== sla_timers table ====================

  describe('sla_timers', () => {
    let timerId: string;

    it('can create an SLA timer via service role', async () => {
      const now = new Date();
      const frDeadline = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
      const resDeadline = new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString();

      const { data, error } = await svc
        .from('sla_timers')
        .insert({
          ticket_id: ticketId,
          sla_policy_id: policyId,
          first_response_deadline: frDeadline,
          resolution_deadline: resDeadline,
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data!.ticket_id).toBe(ticketId);
      expect(data!.sla_policy_id).toBe(policyId);
      expect(data!.is_paused).toBe(false);
      expect(data!.first_response_met).toBeNull();
      expect(data!.resolution_met).toBeNull();
      timerId = data!.id;
    });

    it('enforces one timer per ticket (unique constraint)', async () => {
      const { error } = await svc
        .from('sla_timers')
        .insert({
          ticket_id: ticketId,
          sla_policy_id: policyId,
        });

      expect(error).not.toBeNull();
    });

    it('agent can read SLA timers', async () => {
      const agent = await clientForUser('sla-agent@test.com');
      const { data, error } = await agent
        .from('sla_timers')
        .select('*')
        .eq('ticket_id', ticketId);

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data![0].id).toBe(timerId);
    });

    it('regular user cannot read SLA timers', async () => {
      const user = await clientForUser('sla-user@test.com');
      const { data, error } = await user
        .from('sla_timers')
        .select('*')
        .eq('ticket_id', ticketId);

      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });

    it('can pause a timer', async () => {
      const now = new Date().toISOString();
      const { error } = await svc
        .from('sla_timers')
        .update({
          is_paused: true,
          first_response_paused_at: now,
          resolution_paused_at: now,
          first_response_elapsed_minutes: 10,
          resolution_elapsed_minutes: 10,
        })
        .eq('id', timerId);

      expect(error).toBeNull();

      const { data } = await svc
        .from('sla_timers')
        .select('is_paused, first_response_elapsed_minutes')
        .eq('id', timerId)
        .single();
      expect(data!.is_paused).toBe(true);
      expect(data!.first_response_elapsed_minutes).toBe(10);
    });

    it('can resume a paused timer', async () => {
      const newDeadline = new Date(Date.now() + 3600000).toISOString();
      const { error } = await svc
        .from('sla_timers')
        .update({
          is_paused: false,
          first_response_paused_at: null,
          resolution_paused_at: null,
          first_response_deadline: newDeadline,
          resolution_deadline: newDeadline,
        })
        .eq('id', timerId);

      expect(error).toBeNull();

      const { data } = await svc
        .from('sla_timers')
        .select('is_paused')
        .eq('id', timerId)
        .single();
      expect(data!.is_paused).toBe(false);
    });

    it('can record first response', async () => {
      const now = new Date().toISOString();
      const { error } = await svc
        .from('sla_timers')
        .update({
          first_response_at: now,
          first_response_met: true,
          first_response_elapsed_minutes: 25,
        })
        .eq('id', timerId);

      expect(error).toBeNull();

      const { data } = await svc
        .from('sla_timers')
        .select('first_response_at, first_response_met, first_response_elapsed_minutes')
        .eq('id', timerId)
        .single();
      expect(data!.first_response_met).toBe(true);
      expect(data!.first_response_elapsed_minutes).toBe(25);
    });

    it('can record resolution', async () => {
      const now = new Date().toISOString();
      const { error } = await svc
        .from('sla_timers')
        .update({
          resolved_at: now,
          resolution_met: true,
          resolution_elapsed_minutes: 200,
        })
        .eq('id', timerId);

      expect(error).toBeNull();

      const { data } = await svc
        .from('sla_timers')
        .select('resolved_at, resolution_met, resolution_elapsed_minutes')
        .eq('id', timerId)
        .single();
      expect(data!.resolution_met).toBe(true);
      expect(data!.resolution_elapsed_minutes).toBe(200);
    });

    it('cascade deletes timer when ticket is deleted', async () => {
      // Create a temporary ticket + timer
      const { data: tmpTicket } = await svc
        .from('tickets')
        .insert({
          title: 'SLA Test Cascade Ticket',
          slug: 'sla-test-cascade-ticket',
          creator_id: USER_ID,
          type_id: defaultTypeId,
        })
        .select('id')
        .single();

      await svc.from('sla_timers').insert({
        ticket_id: tmpTicket!.id,
        sla_policy_id: policyId,
      });

      // Delete the ticket
      await svc.from('activity_log').delete().eq('ticket_id', tmpTicket!.id);
      await svc.from('tickets').delete().eq('id', tmpTicket!.id);

      // Timer should be gone
      const { data } = await svc
        .from('sla_timers')
        .select('id')
        .eq('ticket_id', tmpTicket!.id);
      expect(data).toHaveLength(0);
    });
  });

  // ==================== sla_notifications_sent ====================

  describe('sla_notifications_sent', () => {
    let notifTimerId: string;

    beforeAll(async () => {
      // Create a timer for ticket2
      const frDeadline = new Date(Date.now() + 3600000).toISOString();
      const { data } = await svc
        .from('sla_timers')
        .insert({
          ticket_id: ticketId2,
          sla_policy_id: policyId,
          first_response_deadline: frDeadline,
          resolution_deadline: frDeadline,
        })
        .select('id')
        .single();
      notifTimerId = data!.id;
    });

    it('can insert notification sent record', async () => {
      const { data, error } = await svc
        .from('sla_notifications_sent')
        .insert({
          sla_timer_id: notifTimerId,
          notification_type: 'approaching_first_response',
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data!.notification_type).toBe('approaching_first_response');
    });

    it('enforces unique (timer, type) pair', async () => {
      const { error } = await svc
        .from('sla_notifications_sent')
        .insert({
          sla_timer_id: notifTimerId,
          notification_type: 'approaching_first_response',
        });

      expect(error).not.toBeNull();
    });

    it('allows different notification types for same timer', async () => {
      const { error } = await svc
        .from('sla_notifications_sent')
        .insert({
          sla_timer_id: notifTimerId,
          notification_type: 'breached_first_response',
        });

      expect(error).toBeNull();
    });

    it('rejects invalid notification types', async () => {
      const { error } = await svc
        .from('sla_notifications_sent')
        .insert({
          sla_timer_id: notifTimerId,
          notification_type: 'invalid_type',
        });

      expect(error).not.toBeNull();
    });

    it('cascade deletes when timer is deleted', async () => {
      // Create a temp ticket + timer + notification
      const { data: tmpTicket } = await svc
        .from('tickets')
        .insert({
          title: 'SLA Test Notif Cascade',
          slug: 'sla-test-notif-cascade',
          creator_id: USER_ID,
          type_id: defaultTypeId,
        })
        .select('id')
        .single();

      const { data: tmpTimer } = await svc
        .from('sla_timers')
        .insert({ ticket_id: tmpTicket!.id, sla_policy_id: policyId })
        .select('id')
        .single();

      await svc.from('sla_notifications_sent').insert({
        sla_timer_id: tmpTimer!.id,
        notification_type: 'approaching_resolution',
      });

      // Delete the ticket (cascades to timer to notifications)
      await svc.from('activity_log').delete().eq('ticket_id', tmpTicket!.id);
      await svc.from('tickets').delete().eq('id', tmpTicket!.id);

      const { data: check } = await svc
        .from('sla_notifications_sent')
        .select('id')
        .eq('sla_timer_id', tmpTimer!.id);
      expect(check).toHaveLength(0);
    });
  });

  // ==================== app_settings (SLA-related) ====================

  describe('SLA app_settings', () => {
    it('business hours setting exists', async () => {
      const { data, error } = await svc
        .from('app_settings')
        .select('value')
        .eq('key', 'sla_business_hours')
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      const parsed = JSON.parse(data!.value);
      expect(parsed.timezone).toBeDefined();
      expect(parsed.schedule).toBeDefined();
    });

    it('approaching threshold setting exists', async () => {
      const { data, error } = await svc
        .from('app_settings')
        .select('value')
        .eq('key', 'sla_approaching_threshold')
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      const val = parseInt(data!.value, 10);
      expect(val).toBeGreaterThanOrEqual(50);
      expect(val).toBeLessThanOrEqual(100);
    });
  });

  // ==================== notification_templates ====================

  describe('SLA notification templates', () => {
    it('has all 4 SLA notification templates', async () => {
      const { data, error } = await svc
        .from('notification_templates')
        .select('event_type')
        .ilike('event_type', 'sla_%');

      expect(error).toBeNull();
      expect(data!.length).toBeGreaterThanOrEqual(4);

      const types = data!.map((d: { event_type: string }) => d.event_type).sort();
      expect(types).toContain('sla_approaching_first_response');
      expect(types).toContain('sla_approaching_resolution');
      expect(types).toContain('sla_breached_first_response');
      expect(types).toContain('sla_breached_resolution');
    });
  });
});
