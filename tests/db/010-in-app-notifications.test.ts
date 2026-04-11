import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServiceRoleClient } from '../helpers/supabase';

// ---------------------------------------------------------------------------
// Shared helpers & constants
// ---------------------------------------------------------------------------

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const ADMIN_ID = '00000000-0000-0000-0000-000000000101';
const AGENT_ID = '00000000-0000-0000-0000-000000000102';
const USER_ID = '00000000-0000-0000-0000-000000000103';
const USER2_ID = '00000000-0000-0000-0000-000000000104';

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
  await svc.from('notifications').delete().in('recipient_id', testUserIds);
  const { data: testTickets } = await svc.from('tickets').select('id').in('creator_id', testUserIds);
  if (testTickets && testTickets.length > 0) {
    const ticketIds = testTickets.map((t: { id: number }) => t.id);
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
  await ensureAuthUser(svc, ADMIN_ID, 'inapp-admin@test.com', { display_name: 'InAppAdmin' });
  await ensureAuthUser(svc, AGENT_ID, 'inapp-agent@test.com', { display_name: 'InAppAgent' });
  await ensureAuthUser(svc, USER_ID, 'inapp-user@test.com', { display_name: 'InAppUser' });
  await ensureAuthUser(svc, USER2_ID, 'inapp-user2@test.com', { display_name: 'InAppUser2' });

  // Promote admin and agent
  await svc.from('profiles').update({ role: 'admin' }).eq('id', ADMIN_ID);
  await svc.from('profiles').update({ role: 'agent' }).eq('id', AGENT_ID);

  // Ensure ticket type exists
  const { data: existingType } = await svc.from('ticket_types').select('id').limit(1).single();
  if (existingType) {
    defaultTypeId = existingType.id;
  } else {
    const { data: newType } = await svc.from('ticket_types').insert({ name: 'InAppTestType' }).select('id').single();
    defaultTypeId = newType!.id;
  }

  // Create test ticket
  const { data: ticket } = await svc
    .from('tickets')
    .insert({
      title: 'In-App Notification Test Ticket',
      slug: 'in-app-notification-test-ticket',
      creator_id: USER_ID,
      type_id: defaultTypeId,
    })
    .select('id')
    .single();
  ticketId = ticket!.id;
}, 30000);

afterAll(async () => {
  const testUserIds = [ADMIN_ID, AGENT_ID, USER_ID, USER2_ID];
  await svc.from('notifications').delete().in('recipient_id', testUserIds);
  if (ticketId) {
    await svc.from('notifications').delete().eq('ticket_id', ticketId);
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

describe('In-App Notifications', () => {
  // ==================== Notification Creation ====================

  describe('notifications table', () => {
    it('notification can be created for a recipient', async () => {
      const { data, error } = await svc
        .from('notifications')
        .insert({
          recipient_id: USER_ID,
          event_type: 'new_post',
          ticket_id: ticketId,
          message: 'InAppAgent replied to ticket #' + ticketId,
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data!.recipient_id).toBe(USER_ID);
      expect(data!.event_type).toBe('new_post');
      expect(data!.is_read).toBe(false);
    });

    it('user can only read own notifications (RLS)', async () => {
      // Insert notification for USER_ID
      await svc.from('notifications').insert({
        recipient_id: USER_ID,
        event_type: 'status_changed',
        ticket_id: ticketId,
        message: 'Status changed on ticket #' + ticketId,
      });

      // Insert notification for USER2_ID
      await svc.from('notifications').insert({
        recipient_id: USER2_ID,
        event_type: 'agent_assigned',
        ticket_id: ticketId,
        message: 'Agent assigned to ticket #' + ticketId,
      });

      // USER_ID should only see their own notifications
      const user = await clientForUser('inapp-user@test.com');
      const { data } = await user.from('notifications').select('*');
      expect(data).toBeDefined();
      expect(data!.length).toBeGreaterThan(0);
      for (const n of data!) {
        expect(n.recipient_id).toBe(USER_ID);
      }

      // USER2_ID should only see their own
      const user2 = await clientForUser('inapp-user2@test.com');
      const { data: data2 } = await user2.from('notifications').select('*');
      expect(data2).toBeDefined();
      for (const n of data2!) {
        expect(n.recipient_id).toBe(USER2_ID);
      }
    });

    it('user can mark own notification as read', async () => {
      const user = await clientForUser('inapp-user@test.com');

      // Get an unread notification
      const { data: unread } = await user
        .from('notifications')
        .select('id')
        .eq('is_read', false)
        .limit(1)
        .single();

      expect(unread).toBeDefined();

      const { error } = await user
        .from('notifications')
        .update({ is_read: true })
        .eq('id', unread!.id);

      expect(error).toBeNull();

      // Verify
      const { data: updated } = await user
        .from('notifications')
        .select('is_read')
        .eq('id', unread!.id)
        .single();

      expect(updated!.is_read).toBe(true);
    });

    it('user cannot modify others notifications', async () => {
      // Get a notification belonging to USER2_ID
      const { data: user2Notif } = await svc
        .from('notifications')
        .select('id')
        .eq('recipient_id', USER2_ID)
        .limit(1)
        .single();

      expect(user2Notif).toBeDefined();

      // USER_ID tries to update it
      const user = await clientForUser('inapp-user@test.com');
      const { data } = await user
        .from('notifications')
        .update({ is_read: true })
        .eq('id', user2Notif!.id)
        .select();

      // Should return empty (RLS blocks the update)
      expect(data?.length ?? 0).toBe(0);
    });

    it('notification is cascade-deleted when ticket is deleted', async () => {
      // Create a separate ticket for this test
      const { data: tempTicket } = await svc
        .from('tickets')
        .insert({
          title: 'Temp Cascade Test',
          slug: 'temp-cascade-test',
          creator_id: USER_ID,
          type_id: defaultTypeId,
        })
        .select('id')
        .single();

      await svc.from('notifications').insert({
        recipient_id: USER_ID,
        event_type: 'new_post',
        ticket_id: tempTicket!.id,
        message: 'Test cascade delete',
      });

      // Delete the ticket
      await svc.from('posts').delete().eq('ticket_id', tempTicket!.id);
      await svc.from('tickets').delete().eq('id', tempTicket!.id);

      // Notification should be gone
      const { data } = await svc
        .from('notifications')
        .select('id')
        .eq('ticket_id', tempTicket!.id);

      expect(data?.length ?? 0).toBe(0);
    });

    it('notification is cascade-deleted when user is deleted', async () => {
      // Create a temporary user
      const TEMP_ID = '00000000-0000-0000-0000-000000000199';
      await ensureAuthUser(svc, TEMP_ID, 'inapp-temp@test.com', { display_name: 'TempUser' });

      await svc.from('notifications').insert({
        recipient_id: TEMP_ID,
        event_type: 'status_changed',
        ticket_id: ticketId,
        message: 'Test user cascade delete',
      });

      // Delete the user profile (cascade)
      await svc.from('profiles').delete().eq('id', TEMP_ID);
      await svc.auth.admin.deleteUser(TEMP_ID).catch(() => {});

      // Notifications should be gone
      const { data } = await svc
        .from('notifications')
        .select('id')
        .eq('recipient_id', TEMP_ID);

      expect(data?.length ?? 0).toBe(0);
    });

    it('unread count query returns correct number', async () => {
      // Clean existing notifications for USER_ID
      await svc.from('notifications').delete().eq('recipient_id', USER_ID);

      // Insert 3 unread, 1 read via service role
      const { error: insertErr } = await svc.from('notifications').insert([
        { recipient_id: USER_ID, event_type: 'new_post', ticket_id: ticketId, message: 'Count 1', is_read: false },
        { recipient_id: USER_ID, event_type: 'new_post', ticket_id: ticketId, message: 'Count 2', is_read: false },
        { recipient_id: USER_ID, event_type: 'new_post', ticket_id: ticketId, message: 'Count 3', is_read: false },
        { recipient_id: USER_ID, event_type: 'new_post', ticket_id: ticketId, message: 'Count 4', is_read: true },
      ]);
      expect(insertErr).toBeNull();

      // Verify via service role first
      const { data: svcData } = await svc
        .from('notifications')
        .select('id, is_read')
        .eq('recipient_id', USER_ID);
      const svcUnread = svcData?.filter(n => !n.is_read).length ?? 0;
      expect(svcUnread).toBe(3);

      // Now verify via user client (RLS)
      const user = await clientForUser('inapp-user@test.com');
      const { data: userData } = await user
        .from('notifications')
        .select('id, is_read')
        .eq('is_read', false);

      expect(userData?.length ?? 0).toBe(3);
    });

    it('mark all as read updates all unread for user', async () => {
      const user = await clientForUser('inapp-user@test.com');

      // Mark all as read (RLS ensures only own notifications)
      const { error } = await user
        .from('notifications')
        .update({ is_read: true })
        .eq('is_read', false);

      expect(error).toBeNull();

      // Verify no unread left
      const { count } = await user
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('is_read', false);

      expect(count).toBe(0);
    });
  });
});
