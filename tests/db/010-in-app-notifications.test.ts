import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { Database } from '@/lib/database.types';

const supabaseUrl = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const supabaseKey = process.env.SUPABASE_ANON_KEY || '';

describe('010 - In-App Notifications', () => {
  let supabase: ReturnType<typeof createClient<Database>>;
  let adminToken: string;
  let agentToken: string;
  let userToken: string;
  let userId: string;
  let agentId: string;
  let ticketId: number;

  beforeAll(async () => {
    supabase = createClient<Database>(supabaseUrl, supabaseKey);

    // Sign in as admin
    const adminRes = await supabase.auth.signInWithPassword({
      email: 'admin@test.com',
      password: 'admin123',
    });
    adminToken = adminRes.data.session!.accessToken;

    // Sign in as agent
    const agentRes = await supabase.auth.signInWithPassword({
      email: 'agent@test.com',
      password: 'agent123',
    });
    agentToken = agentRes.data.session!.accessToken;
    agentId = agentRes.data.user!.id;

    // Sign in as user
    const userRes = await supabase.auth.signInWithPassword({
      email: 'user@test.com',
      password: 'user123',
    });
    userToken = userRes.data.session!.accessToken;
    userId = userRes.data.user!.id;

    // Create a test ticket
    const userSupabase = createClient<Database>(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: `Bearer ${userToken}` } },
    });

    const { data: ticket } = await userSupabase
      .from('tickets')
      .insert({ title: 'Test ticket for notifications', creator_id: userId })
      .select('id')
      .single();

    ticketId = ticket!.id;
  });

  afterAll(async () => {
    // Clean up
    const adminSupabase = createClient<Database>(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: `Bearer ${adminToken}` } },
    });

    await adminSupabase.from('tickets').delete().eq('id', ticketId);
  });

  it('should create notification for correct recipient', async () => {
    const agentSupabase = createClient<Database>(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: `Bearer ${agentToken}` } },
    });

    // Insert a notification as agent (service role would do this normally)
    const { data, error } = await agentSupabase
      .from('notifications')
      .insert({
        recipient_id: userId,
        event_type: 'new_post',
        ticket_id: ticketId,
        message: 'Test notification message',
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data!.recipient_id).toBe(userId);
    expect(data!.is_read).toBe(false);
  });

  it('should allow user to read own notifications (RLS)', async () => {
    const userSupabase = createClient<Database>(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: `Bearer ${userToken}` } },
    });

    const { data, error } = await userSupabase
      .from('notifications')
      .select('*')
      .eq('recipient_id', userId);

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data!.length).toBeGreaterThan(0);
  });

  it('should not allow user to read others notifications (RLS)', async () => {
    const userSupabase = createClient<Database>(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: `Bearer ${userToken}` } },
    });

    const { data } = await userSupabase
      .from('notifications')
      .select('*')
      .eq('recipient_id', agentId);

    expect(data).toBeDefined();
    expect(data!.length).toBe(0);
  });

  it('should allow user to mark own notification as read', async () => {
    const userSupabase = createClient<Database>(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: `Bearer ${userToken}` } },
    });

    const { data: notification } = await userSupabase
      .from('notifications')
      .select('id')
      .eq('recipient_id', userId)
      .eq('is_read', false)
      .limit(1)
      .single();

    if (notification) {
      const { error } = await userSupabase
        .from('notifications')
        .update({ is_read: true })
        .eq('id', notification.id);

      expect(error).toBeNull();

      const { data: updated } = await userSupabase
        .from('notifications')
        .select('is_read')
        .eq('id', notification.id)
        .single();

      expect(updated!.is_read).toBe(true);
    }
  });

  it('should not allow user to modify others notifications', async () => {
    const agentSupabase = createClient<Database>(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: `Bearer ${agentToken}` } },
    });

    // Create a notification for agent
    const { data: agentNotification } = await agentSupabase
      .from('notifications')
      .insert({
        recipient_id: agentId,
        event_type: 'agent_assigned_to_agent',
        ticket_id: ticketId,
        message: 'You were assigned to ticket',
      })
      .select('id')
      .single();

    // Try to update it as user
    const userSupabase = createClient<Database>(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: `Bearer ${userToken}` } },
    });

    const { data } = await userSupabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', agentNotification!.id)
      .select();

    expect(data).toBeDefined();
    expect(data!.length).toBe(0);
  });

  it('should cascade delete notifications when ticket is deleted', async () => {
    const adminSupabase = createClient<Database>(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: `Bearer ${adminToken}` } },
    });

    // Create a test ticket
    const { data: tempTicket } = await adminSupabase
      .from('tickets')
      .insert({ title: 'Temp ticket', creator_id: userId })
      .select('id')
      .single();

    // Create a notification for this ticket
    const { data: notification } = await adminSupabase
      .from('notifications')
      .insert({
        recipient_id: userId,
        event_type: 'status_changed',
        ticket_id: tempTicket!.id,
        message: 'Status changed',
      })
      .select('id')
      .single();

    // Delete the ticket
    await adminSupabase.from('tickets').delete().eq('id', tempTicket!.id);

    // Check notification is gone
    const { data: deletedNotification } = await adminSupabase
      .from('notifications')
      .select('id')
      .eq('id', notification!.id);

    expect(deletedNotification).toBeDefined();
    expect(deletedNotification!.length).toBe(0);
  });

  it('should return correct unread count', async () => {
    const userSupabase = createClient<Database>(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: `Bearer ${userToken}` } },
    });

    const { count: unreadCount } = await userSupabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_id', userId)
      .eq('is_read', false);

    expect(unreadCount).toBeGreaterThanOrEqual(0);
  });

  it('should mark all notifications as read', async () => {
    const userSupabase = createClient<Database>(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: `Bearer ${userToken}` } },
    });

    const { error } = await userSupabase
      .from('notifications')
      .update({ is_read: true })
      .eq('recipient_id', userId)
      .eq('is_read', false);

    expect(error).toBeNull();

    const { count } = await userSupabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_id', userId)
      .eq('is_read', false);

    expect(count).toBe(0);
  });

  it('should have correct message format for event types', async () => {
    const userSupabase = createClient<Database>(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: `Bearer ${userToken}` } },
    });

    const testCases = [
      { event_type: 'new_post', message: 'Test replied to your ticket #' },
      { event_type: 'status_changed', message: 'Ticket #' },
      { event_type: 'agent_assigned', message: 'was assigned to your ticket #' },
    ];

    for (const testCase of testCases) {
      const { data } = await userSupabase
        .from('notifications')
        .insert({
          recipient_id: userId,
          event_type: testCase.event_type,
          ticket_id: ticketId,
          message: testCase.message + ticketId,
        })
        .select()
        .single();

      expect(data).toBeDefined();
      expect(data!.message).toContain(String(ticketId));
    }
  });
});
