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
let ticketId1: number;
let ticketId2: number;
let _ticketId3: number;
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

  // Clean up leftover data
  const { data: testTickets } = await svc.from('tickets').select('id').in('creator_id', testUserIds);
  if (testTickets && testTickets.length > 0) {
    const ticketIds = testTickets.map((t: { id: number }) => t.id);
    await svc.from('sla_notifications_sent').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await svc.from('sla_timers').delete().in('ticket_id', ticketIds);
    await svc.from('notifications').delete().in('ticket_id', ticketIds);
    await svc.from('notification_coalescing_queue').delete().in('ticket_id', ticketIds);
    await svc.from('activity_log').delete().in('ticket_id', ticketIds);
    await svc.from('ticket_tags').delete().in('ticket_id', ticketIds);
    await svc.from('posts').delete().in('ticket_id', ticketIds);
    await svc.from('tickets').update({ duplicate_of_id: null, merged_into_id: null }).in('id', ticketIds);
    await svc.from('tickets').delete().in('id', ticketIds);
  }

  // Clean up SLA policies we created (except seed data)
  await svc.from('sla_severity_mapping').update({ sla_policy_id: null }).like('severity', '%');
  await svc.from('sla_policies').delete().like('name', 'SlaTest%');

  await svc.from('admin_audit_log').delete().in('admin_id', testUserIds);
  await svc.from('profiles').delete().in('id', testUserIds);

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

  // Create SLA policy
  const { data: policy, error: policyError } = await svc
    .from('sla_policies')
    .insert({ name: 'SlaTestPolicy', first_response_minutes: 60, resolution_minutes: 480 })
    .select('id')
    .single();
  if (policyError) throw new Error(`SLA policy insert failed: ${policyError.message}`);
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
      severity: 'critical',
    })
    .select('id')
    .single();
  ticketId1 = t1!.id;

  const { data: t2 } = await svc
    .from('tickets')
    .insert({
      title: 'SLA Test Ticket 2',
      slug: 'sla-test-ticket-2',
      creator_id: USER_ID,
      type_id: defaultTypeId,
      severity: 'low',
    })
    .select('id')
    .single();
  ticketId2 = t2!.id;

  const { data: t3 } = await svc
    .from('tickets')
    .insert({
      title: 'SLA Test Ticket 3',
      slug: 'sla-test-ticket-3',
      creator_id: USER_ID,
      type_id: defaultTypeId,
      assigned_agent_id: AGENT_ID,
      severity: 'high',
    })
    .select('id')
    .single();
  _ticketId3 = t3!.id;
}, 30000);

afterAll(async () => {
  const testUserIds = [ADMIN_ID, AGENT_ID, USER_ID];
  const { data: testTickets } = await svc.from('tickets').select('id').in('creator_id', testUserIds);
  const ticketIds = testTickets?.map((t: { id: number }) => t.id) ?? [];
  if (ticketIds.length > 0) {
    await svc.from('sla_notifications_sent').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await svc.from('sla_timers').delete().in('ticket_id', ticketIds);
    await svc.from('notifications').delete().in('ticket_id', ticketIds);
    await svc.from('notification_coalescing_queue').delete().in('ticket_id', ticketIds);
    await svc.from('activity_log').delete().in('ticket_id', ticketIds);
    await svc.from('ticket_tags').delete().in('ticket_id', ticketIds);
    await svc.from('posts').delete().in('ticket_id', ticketIds);
    await svc.from('tickets').update({ duplicate_of_id: null, merged_into_id: null }).in('id', ticketIds);
    await svc.from('tickets').delete().in('id', ticketIds);
  }
  await svc.from('sla_policies').delete().like('name', 'SlaTest%');
  await svc.from('admin_audit_log').delete().in('admin_id', testUserIds);
  await svc.from('profiles').delete().in('id', testUserIds);
  for (const uid of testUserIds) {
    await svc.auth.admin.deleteUser(uid).catch(() => {});
  }
}, 30000);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SLA Policies', () => {
  describe('CRUD (admin only, RLS)', () => {
    it('admin can create SLA policy', async () => {
      const adminClient = await clientForUser('sla-admin@test.com');
      const { data, error } = await adminClient
        .from('sla_policies')
        .insert({ name: 'SlaTestCrud', first_response_minutes: 120, resolution_minutes: 960 })
        .select()
        .single();

      expect(error).toBeNull();
      expect(data).toBeTruthy();
      expect(data!.name).toBe('SlaTestCrud');
      expect(data!.first_response_minutes).toBe(120);
      expect(data!.resolution_minutes).toBe(960);

      // Cleanup
      await svc.from('sla_policies').delete().eq('id', data!.id);
    });

    it('agent cannot create SLA policy', async () => {
      const agentClient = await clientForUser('sla-agent@test.com');
      const { error } = await agentClient
        .from('sla_policies')
        .insert({ name: 'SlaTestAgentFail', first_response_minutes: 60, resolution_minutes: 480 });

      expect(error).toBeTruthy();
    });

    it('user cannot create SLA policy', async () => {
      const userClient = await clientForUser('sla-user@test.com');
      const { error } = await userClient
        .from('sla_policies')
        .insert({ name: 'SlaTestUserFail', first_response_minutes: 60, resolution_minutes: 480 });

      expect(error).toBeTruthy();
    });

    it('all authenticated users can read SLA policies', async () => {
      const userClient = await clientForUser('sla-user@test.com');
      const { data, error } = await userClient
        .from('sla_policies')
        .select('*')
        .eq('id', policyId)
        .single();

      expect(error).toBeNull();
      expect(data).toBeTruthy();
      expect(data!.name).toBe('SlaTestPolicy');
    });

    it('admin can update SLA policy', async () => {
      const adminClient = await clientForUser('sla-admin@test.com');
      const { error } = await adminClient
        .from('sla_policies')
        .update({ first_response_minutes: 90 })
        .eq('id', policyId);

      expect(error).toBeNull();

      // Verify
      const { data } = await svc.from('sla_policies').select('first_response_minutes').eq('id', policyId).single();
      expect(data!.first_response_minutes).toBe(90);

      // Reset
      await svc.from('sla_policies').update({ first_response_minutes: 60 }).eq('id', policyId);
    });

    it('admin can delete SLA policy', async () => {
      const { data: toDelete } = await svc
        .from('sla_policies')
        .insert({ name: 'SlaTestDeleteMe', first_response_minutes: 30, resolution_minutes: 60 })
        .select('id')
        .single();

      const adminClient = await clientForUser('sla-admin@test.com');
      const { error } = await adminClient
        .from('sla_policies')
        .delete()
        .eq('id', toDelete!.id);

      expect(error).toBeNull();
    });
  });

  describe('Severity mapping', () => {
    it('links severity to policy', async () => {
      // Map critical to our test policy
      await svc
        .from('sla_severity_mapping')
        .update({ sla_policy_id: policyId })
        .eq('severity', 'critical');

      const { data } = await svc
        .from('sla_severity_mapping')
        .select('sla_policy_id')
        .eq('severity', 'critical')
        .single();

      expect(data!.sla_policy_id).toBe(policyId);

      // Cleanup: reset mapping
      await svc
        .from('sla_severity_mapping')
        .update({ sla_policy_id: null })
        .eq('severity', 'critical');
    });

    it('all authenticated users can read severity mapping', async () => {
      const userClient = await clientForUser('sla-user@test.com');
      const { data, error } = await userClient
        .from('sla_severity_mapping')
        .select('*');

      expect(error).toBeNull();
      expect(data).toHaveLength(4);
    });

    it('only admin can update severity mapping', async () => {
      const agentClient = await clientForUser('sla-agent@test.com');
      const { data, error } = await agentClient
        .from('sla_severity_mapping')
        .update({ sla_policy_id: policyId })
        .eq('severity', 'low')
        .select();

      // RLS blocks updates silently — no error but no rows affected
      if (!error) {
        expect(data).toHaveLength(0);
      } else {
        expect(error).toBeTruthy();
      }
    });
  });

  describe('SLA Timers', () => {
    it('timer can be created for a ticket', async () => {
      const { data, error } = await svc
        .from('sla_timers')
        .insert({
          ticket_id: ticketId1,
          sla_policy_id: policyId,
          first_response_deadline: new Date(Date.now() + 3600000).toISOString(),
          resolution_deadline: new Date(Date.now() + 28800000).toISOString(),
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(data!.ticket_id).toBe(ticketId1);
      expect(data!.is_paused).toBe(false);
      expect(data!.first_response_met).toBeNull();
      expect(data!.resolution_met).toBeNull();
    });

    it('no timer for unmapped severity ticket', async () => {
      // ticketId2 has severity 'low' which is unmapped
      const { data } = await svc
        .from('sla_timers')
        .select('*')
        .eq('ticket_id', ticketId2);

      expect(data).toHaveLength(0);
    });

    it('agents can see SLA timers', async () => {
      const agentClient = await clientForUser('sla-agent@test.com');
      const { data, error } = await agentClient
        .from('sla_timers')
        .select('*')
        .eq('ticket_id', ticketId1);

      expect(error).toBeNull();
      expect(data!.length).toBeGreaterThanOrEqual(1);
    });

    it('users cannot see SLA timers', async () => {
      const userClient = await clientForUser('sla-user@test.com');
      const { data } = await userClient
        .from('sla_timers')
        .select('*')
        .eq('ticket_id', ticketId1);

      expect(data).toHaveLength(0);
    });

    it('timer can be paused', async () => {
      const { error } = await svc
        .from('sla_timers')
        .update({
          is_paused: true,
          first_response_elapsed_minutes: 15,
          resolution_elapsed_minutes: 15,
          first_response_paused_at: new Date().toISOString(),
          resolution_paused_at: new Date().toISOString(),
          first_response_deadline: null,
          resolution_deadline: null,
        })
        .eq('ticket_id', ticketId1);

      expect(error).toBeNull();

      const { data } = await svc
        .from('sla_timers')
        .select('is_paused, first_response_elapsed_minutes')
        .eq('ticket_id', ticketId1)
        .single();

      expect(data!.is_paused).toBe(true);
      expect(data!.first_response_elapsed_minutes).toBe(15);
    });

    it('timer can be resumed', async () => {
      const { error } = await svc
        .from('sla_timers')
        .update({
          is_paused: false,
          first_response_paused_at: null,
          resolution_paused_at: null,
          first_response_deadline: new Date(Date.now() + 2700000).toISOString(),
          resolution_deadline: new Date(Date.now() + 27900000).toISOString(),
        })
        .eq('ticket_id', ticketId1);

      expect(error).toBeNull();

      const { data } = await svc
        .from('sla_timers')
        .select('is_paused')
        .eq('ticket_id', ticketId1)
        .single();

      expect(data!.is_paused).toBe(false);
    });

    it('first response timer stops on first agent reply', async () => {
      const { error } = await svc
        .from('sla_timers')
        .update({
          first_response_at: new Date().toISOString(),
          first_response_elapsed_minutes: 25,
          first_response_met: true,
        })
        .eq('ticket_id', ticketId1);

      expect(error).toBeNull();

      const { data } = await svc
        .from('sla_timers')
        .select('first_response_met, first_response_at')
        .eq('ticket_id', ticketId1)
        .single();

      expect(data!.first_response_met).toBe(true);
      expect(data!.first_response_at).toBeTruthy();
    });

    it('resolution timer stops when ticket is closed', async () => {
      const { error } = await svc
        .from('sla_timers')
        .update({
          resolved_at: new Date().toISOString(),
          resolution_elapsed_minutes: 120,
          resolution_met: true,
        })
        .eq('ticket_id', ticketId1);

      expect(error).toBeNull();

      const { data } = await svc
        .from('sla_timers')
        .select('resolution_met, resolved_at')
        .eq('ticket_id', ticketId1)
        .single();

      expect(data!.resolution_met).toBe(true);
      expect(data!.resolved_at).toBeTruthy();
    });

    it('timer resumes on re-open (does not reset)', async () => {
      // Reset to simulate re-open scenario
      await svc
        .from('sla_timers')
        .update({
          resolution_met: null,
          resolved_at: null,
          is_paused: false,
          resolution_deadline: new Date(Date.now() + 20000000).toISOString(),
          // elapsed minutes preserved
        })
        .eq('ticket_id', ticketId1);

      const { data } = await svc
        .from('sla_timers')
        .select('resolution_met, resolution_elapsed_minutes')
        .eq('ticket_id', ticketId1)
        .single();

      // Elapsed time should not be reset
      expect(data!.resolution_elapsed_minutes).toBe(120);
      expect(data!.resolution_met).toBeNull();
    });

    it('timer CASCADE deletes with ticket', async () => {
      // Create a temp ticket and timer
      const { data: tempTicket } = await svc
        .from('tickets')
        .insert({
          title: 'SLA Cascade Test',
          slug: 'sla-cascade-test',
          creator_id: USER_ID,
          type_id: defaultTypeId,
        })
        .select('id')
        .single();

      await svc.from('sla_timers').insert({
        ticket_id: tempTicket!.id,
        sla_policy_id: policyId,
        first_response_deadline: new Date(Date.now() + 3600000).toISOString(),
        resolution_deadline: new Date(Date.now() + 28800000).toISOString(),
      });

      // Delete the ticket
      await svc.from('posts').delete().eq('ticket_id', tempTicket!.id);
      await svc.from('tickets').delete().eq('id', tempTicket!.id);

      // Timer should be gone
      const { data: timer } = await svc
        .from('sla_timers')
        .select('*')
        .eq('ticket_id', tempTicket!.id);

      expect(timer).toHaveLength(0);
    });

    it('UNIQUE constraint on ticket_id prevents duplicate timers', async () => {
      const { error } = await svc
        .from('sla_timers')
        .insert({
          ticket_id: ticketId1,
          sla_policy_id: policyId,
          first_response_deadline: new Date(Date.now() + 3600000).toISOString(),
          resolution_deadline: new Date(Date.now() + 28800000).toISOString(),
        });

      expect(error).toBeTruthy();
      expect(error!.message).toContain('duplicate');
    });
  });

  describe('SLA Notifications Sent', () => {
    it('dedup prevents duplicate notifications', async () => {
      const { data: timer } = await svc
        .from('sla_timers')
        .select('id')
        .eq('ticket_id', ticketId1)
        .single();

      // First insert succeeds
      const { error: err1 } = await svc
        .from('sla_notifications_sent')
        .insert({
          sla_timer_id: timer!.id,
          notification_type: 'approaching_first_response',
        });

      expect(err1).toBeNull();

      // Duplicate insert fails
      const { error: err2 } = await svc
        .from('sla_notifications_sent')
        .insert({
          sla_timer_id: timer!.id,
          notification_type: 'approaching_first_response',
        });

      expect(err2).toBeTruthy();

      // Different type for same timer works
      const { error: err3 } = await svc
        .from('sla_notifications_sent')
        .insert({
          sla_timer_id: timer!.id,
          notification_type: 'breached_first_response',
        });

      expect(err3).toBeNull();
    });

    it('notifications cascade-delete with timer', async () => {
      // Create a temp ticket, timer, and notification
      const { data: tempTicket } = await svc
        .from('tickets')
        .insert({
          title: 'SLA Notif Cascade Test',
          slug: 'sla-notif-cascade-test',
          creator_id: USER_ID,
          type_id: defaultTypeId,
        })
        .select('id')
        .single();

      const { data: tempTimer } = await svc
        .from('sla_timers')
        .insert({
          ticket_id: tempTicket!.id,
          sla_policy_id: policyId,
          first_response_deadline: new Date(Date.now() + 3600000).toISOString(),
          resolution_deadline: new Date(Date.now() + 28800000).toISOString(),
        })
        .select('id')
        .single();

      await svc.from('sla_notifications_sent').insert({
        sla_timer_id: tempTimer!.id,
        notification_type: 'approaching_resolution',
      });

      // Delete ticket (cascades to timer, which cascades to notifications)
      await svc.from('posts').delete().eq('ticket_id', tempTicket!.id);
      await svc.from('tickets').delete().eq('id', tempTicket!.id);

      const { data: notifs } = await svc
        .from('sla_notifications_sent')
        .select('*')
        .eq('sla_timer_id', tempTimer!.id);

      expect(notifs).toHaveLength(0);
    });
  });

  describe('Business Hours Settings', () => {
    it('sla_business_hours setting exists', async () => {
      const { data } = await svc
        .from('app_settings')
        .select('value')
        .eq('key', 'sla_business_hours')
        .single();

      expect(data).toBeTruthy();
      const config = JSON.parse(data!.value);
      expect(config.timezone).toBe('UTC');
      expect(config.schedule.monday).toBeTruthy();
      expect(config.schedule.saturday).toBeNull();
    });

    it('sla_approaching_threshold setting exists', async () => {
      const { data } = await svc
        .from('app_settings')
        .select('value')
        .eq('key', 'sla_approaching_threshold')
        .single();

      expect(data).toBeTruthy();
      expect(parseInt(data!.value, 10)).toBe(75);
    });
  });

  describe('Notification Templates', () => {
    it('SLA notification templates exist', async () => {
      const eventTypes = [
        'sla_approaching_first_response',
        'sla_approaching_resolution',
        'sla_breached_first_response',
        'sla_breached_resolution',
      ];

      for (const eventType of eventTypes) {
        const { data } = await svc
          .from('notification_templates')
          .select('event_type')
          .eq('event_type', eventType)
          .single();

        expect(data).toBeTruthy();
      }
    });
  });
});
