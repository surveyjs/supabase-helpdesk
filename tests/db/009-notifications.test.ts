import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServiceRoleClient } from '../helpers/supabase';

// ---------------------------------------------------------------------------
// Shared helpers & constants
// ---------------------------------------------------------------------------

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const ADMIN_ID = '00000000-0000-0000-0000-000000000091';
const AGENT_ID = '00000000-0000-0000-0000-000000000092';
const USER_ID = '00000000-0000-0000-0000-000000000093';
const USER2_ID = '00000000-0000-0000-0000-000000000094';

let svc: SupabaseClient;
let defaultTypeId: string;
let ticketId: number;

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
  await ensureAuthUser(svc, ADMIN_ID, 'notif-admin@test.com', { display_name: 'NotifAdmin' });
  await ensureAuthUser(svc, AGENT_ID, 'notif-agent@test.com', { display_name: 'NotifAgent' });
  await ensureAuthUser(svc, USER_ID, 'notif-user@test.com', { display_name: 'NotifUser' });
  await ensureAuthUser(svc, USER2_ID, 'notif-user2@test.com', { display_name: 'NotifUser2' });

  // Promote admin and agent
  await svc.from('profiles').update({ role: 'admin' }).eq('id', ADMIN_ID);
  await svc.from('profiles').update({ role: 'agent' }).eq('id', AGENT_ID);

  // Ensure ticket type exists
  const { data: existingType } = await svc.from('ticket_types').select('id').limit(1).single();
  if (existingType) {
    defaultTypeId = existingType.id;
  } else {
    const { data: newType } = await svc.from('ticket_types').insert({ name: 'NotifTestType' }).select('id').single();
    defaultTypeId = newType!.id;
  }

  // Create test ticket
  const { data: ticket } = await svc
    .from('tickets')
    .insert({
      title: 'Notification Test Ticket',
      slug: 'notification-test-ticket',
      creator_id: USER_ID,
      type_id: defaultTypeId,
    })
    .select('id')
    .single();
  ticketId = ticket!.id;
}, 30000);

afterAll(async () => {
  const testUserIds = [ADMIN_ID, AGENT_ID, USER_ID, USER2_ID];
  if (ticketId) {
    await svc.from('notification_coalescing_queue').delete().eq('ticket_id', ticketId);
    await svc.from('activity_log').delete().eq('ticket_id', ticketId);
    await svc.from('ticket_tags').delete().eq('ticket_id', ticketId);
    await svc.from('posts').delete().eq('ticket_id', ticketId);
    await svc.from('tickets').delete().eq('id', ticketId);
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

describe('Email Notifications', () => {
  // ==================== Email Config ====================

  describe('email_config table', () => {
    it('admin can read email config', async () => {
      const admin = await clientForUser('notif-admin@test.com');
      const { data, error } = await admin.from('email_config').select('*').limit(1).single();
      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data!.smtp_host).toBeDefined();
    });

    it('non-admin cannot read email config (RLS)', async () => {
      const user = await clientForUser('notif-user@test.com');
      const { data } = await user.from('email_config').select('*');
      // RLS should return empty or error
      expect(data?.length ?? 0).toBe(0);
    });

    it('admin can update email config', async () => {
      const admin = await clientForUser('notif-admin@test.com');
      const { data: config } = await admin.from('email_config').select('id').limit(1).single();
      expect(config).toBeDefined();

      const { error } = await admin
        .from('email_config')
        .update({ smtp_host: 'smtp.test.com', smtp_port: 587 })
        .eq('id', config!.id);

      expect(error).toBeNull();

      // Verify update
      const { data: updated } = await admin.from('email_config').select('smtp_host').eq('id', config!.id).single();
      expect(updated!.smtp_host).toBe('smtp.test.com');

      // Reset
      await admin
        .from('email_config')
        .update({ smtp_host: '', smtp_port: 587 })
        .eq('id', config!.id);
    });
  });

  // ==================== Notification Preferences ====================

  describe('notification_preferences table', () => {
    it('user can read own notification preferences', async () => {
      const user = await clientForUser('notif-user@test.com');

      // Insert preferences first
      await user.from('notification_preferences').insert({
        user_id: USER_ID,
        preferences: { new_post: { email: true, in_app: true } },
      });

      const { data, error } = await user
        .from('notification_preferences')
        .select('*')
        .eq('user_id', USER_ID)
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data!.preferences).toBeDefined();
    });

    it('user can update own notification preferences', async () => {
      const user = await clientForUser('notif-user@test.com');

      const { error } = await user
        .from('notification_preferences')
        .update({
          preferences: { new_post: { email: false, in_app: true } },
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', USER_ID);

      expect(error).toBeNull();

      const { data: updated } = await user
        .from('notification_preferences')
        .select('preferences')
        .eq('user_id', USER_ID)
        .single();

      const prefs = updated!.preferences as Record<string, { email: boolean }>;
      expect(prefs.new_post.email).toBe(false);
    });

    it('user cannot read others notification preferences (RLS)', async () => {
      const user2 = await clientForUser('notif-user2@test.com');
      const { data } = await user2
        .from('notification_preferences')
        .select('*')
        .eq('user_id', USER_ID);

      expect(data?.length ?? 0).toBe(0);
    });
  });

  // ==================== Coalescing Queue ====================

  describe('notification_coalescing_queue table', () => {
    it('entries can be created with correct structure', async () => {
      const sendAfter = new Date(Date.now() + 2 * 60 * 1000).toISOString();
      const { data, error } = await svc
        .from('notification_coalescing_queue')
        .insert({
          ticket_id: ticketId,
          recipient_id: USER_ID,
          events: [{ event_type: 'status_changed', placeholders: { newStatus: 'closed' }, timestamp: new Date().toISOString() }],
          triggering_agent_id: AGENT_ID,
          send_after: sendAfter,
        })
        .select('*')
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data!.ticket_id).toBe(ticketId);
      expect(data!.recipient_id).toBe(USER_ID);
      expect(Array.isArray(data!.events)).toBe(true);
    });

    it('updating existing entry extends send_after and appends events', async () => {
      const newSendAfter = new Date(Date.now() + 5 * 60 * 1000).toISOString();

      // Get existing entry
      const { data: existing } = await svc
        .from('notification_coalescing_queue')
        .select('id, events')
        .eq('ticket_id', ticketId)
        .eq('recipient_id', USER_ID)
        .single();

      expect(existing).toBeDefined();

      const events = existing!.events as unknown[];
      events.push({
        event_type: 'urgency_changed',
        placeholders: { newUrgency: 'high' },
        timestamp: new Date().toISOString(),
      });

      const { error } = await svc
        .from('notification_coalescing_queue')
        .update({
          events,
          send_after: newSendAfter,
        })
        .eq('id', existing!.id);

      expect(error).toBeNull();

      // Verify
      const { data: updated } = await svc
        .from('notification_coalescing_queue')
        .select('events')
        .eq('id', existing!.id)
        .single();

      expect((updated!.events as unknown[]).length).toBe(2);
    });

    it('entries are deleted when ticket is deleted (CASCADE)', async () => {
      // Create a temporary ticket
      const { data: tempTicket } = await svc
        .from('tickets')
        .insert({
          title: 'Temp Cascade Test Ticket',
          slug: 'temp-cascade-test',
          creator_id: USER_ID,
          type_id: defaultTypeId,
        })
        .select('id')
        .single();

      const tempTicketId = tempTicket!.id;

      // Create queue entry for temp ticket
      await svc.from('notification_coalescing_queue').insert({
        ticket_id: tempTicketId,
        recipient_id: USER_ID,
        events: [{ event_type: 'test', placeholders: {}, timestamp: new Date().toISOString() }],
        send_after: new Date().toISOString(),
      });

      // Delete all related entities first
      await svc.from('posts').delete().eq('ticket_id', tempTicketId);
      await svc.from('activity_log').delete().eq('ticket_id', tempTicketId);

      // Delete the ticket
      await svc.from('tickets').delete().eq('id', tempTicketId);

      // Queue entry should be gone
      const { data: remaining } = await svc
        .from('notification_coalescing_queue')
        .select('id')
        .eq('ticket_id', tempTicketId);

      expect(remaining?.length ?? 0).toBe(0);
    });

    // Cleanup queue entries after all coalescing tests
    afterAll(async () => {
      await svc.from('notification_coalescing_queue').delete().eq('ticket_id', ticketId);
    });
  });

  // ==================== App Settings ====================

  describe('app_settings for notifications', () => {
    it('default_notification_preferences is parseable JSON', async () => {
      const { data } = await svc
        .from('app_settings')
        .select('value')
        .eq('key', 'default_notification_preferences')
        .single();

      expect(data).toBeDefined();
      const prefs = JSON.parse(data!.value);
      expect(prefs).toBeDefined();
      expect(prefs.new_post).toBeDefined();
      expect(prefs.new_post.email).toBe(true);
      expect(prefs.new_post.in_app).toBe(true);
    });

    it('notification_coalescing_delay_minutes is set', async () => {
      const { data } = await svc
        .from('app_settings')
        .select('value')
        .eq('key', 'notification_coalescing_delay_minutes')
        .single();

      expect(data).toBeDefined();
      const val = parseInt(data!.value, 10);
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(15);
    });
  });

  // ==================== Notification Templates ====================

  describe('notification_templates for new events', () => {
    it('urgency_changed template exists', async () => {
      const { data } = await svc
        .from('notification_templates')
        .select('*')
        .eq('event_type', 'urgency_changed')
        .single();

      expect(data).toBeDefined();
      expect(data!.subject).toContain('urgency');
    });

    it('severity_changed template exists', async () => {
      const { data } = await svc
        .from('notification_templates')
        .select('*')
        .eq('event_type', 'severity_changed')
        .single();

      expect(data).toBeDefined();
      expect(data!.subject).toContain('severity');
    });

    it('privacy_changed template exists', async () => {
      const { data } = await svc
        .from('notification_templates')
        .select('*')
        .eq('event_type', 'privacy_changed')
        .single();

      expect(data).toBeDefined();
      expect(data!.subject).toContain('privacy');
    });

    it('consolidated_update template exists', async () => {
      const { data } = await svc
        .from('notification_templates')
        .select('*')
        .eq('event_type', 'consolidated_update')
        .single();

      expect(data).toBeDefined();
      expect(data!.body).toContain('{{changeList}}');
    });
  });
});
