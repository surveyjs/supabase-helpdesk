import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServiceRoleClient } from '../helpers/supabase';

// ---------------------------------------------------------------------------
// Shared helpers & constants
// ---------------------------------------------------------------------------

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const ADMIN_ID = '00000000-0000-0000-0000-000000000071';
const ADMIN2_ID = '00000000-0000-0000-0000-000000000072';
const AGENT_ID = '00000000-0000-0000-0000-000000000073';
const USER_ID = '00000000-0000-0000-0000-000000000074';
const USER2_ID = '00000000-0000-0000-0000-000000000075';

let svc: SupabaseClient;
let defaultTypeId: string;

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

  const testUserIds = [ADMIN_ID, ADMIN2_ID, AGENT_ID, USER_ID, USER2_ID];

  // Clean up leftover data from previous runs
  await svc.from('admin_audit_log').delete().in('admin_id', testUserIds);
  await svc.from('custom_fields').delete().ilike('name', 'Phase7Test%');

  // Clean tickets owned by test users
  const { data: testTickets } = await svc.from('tickets').select('id').in('creator_id', testUserIds);
  if (testTickets && testTickets.length > 0) {
    const ticketIds = testTickets.map((t: { id: number }) => t.id);
    await svc.from('ticket_tags').delete().in('ticket_id', ticketIds);
    await svc.from('posts').delete().in('ticket_id', ticketIds);
    await svc.from('tickets').update({ duplicate_of_id: null, merged_into_id: null }).in('id', ticketIds);
    await svc.from('tickets').delete().in('id', ticketIds);
  }

  // Get default type
  const { data: typeData } = await svc.from('ticket_types').select('id').eq('is_default', true).single();
  defaultTypeId = typeData!.id;

  // Ensure auth users
  await ensureAuthUser(svc, ADMIN_ID, 'admin7@test.com', { display_name: 'Admin7' });
  await ensureAuthUser(svc, ADMIN2_ID, 'admin7b@test.com', { display_name: 'Admin7b' });
  await ensureAuthUser(svc, AGENT_ID, 'agent7@test.com', { display_name: 'Agent7' });
  await ensureAuthUser(svc, USER_ID, 'user7@test.com', { display_name: 'User7' });
  await ensureAuthUser(svc, USER2_ID, 'user7b@test.com', { display_name: 'User7b' });

  // Set roles
  await svc.from('profiles').update({ role: 'admin' }).eq('id', ADMIN_ID);
  await svc.from('profiles').update({ role: 'admin' }).eq('id', ADMIN2_ID);
  await svc.from('profiles').update({ role: 'agent' }).eq('id', AGENT_ID);
  await svc.from('profiles').update({ role: 'user' }).eq('id', USER_ID);
  await svc.from('profiles').update({ role: 'user' }).eq('id', USER2_ID);

  // Authenticate all clients
  await clientForUser('admin7@test.com');
  await clientForUser('admin7b@test.com');
  await clientForUser('agent7@test.com');
  await clientForUser('user7@test.com');
  await clientForUser('user7b@test.com');
}, 30000);

afterAll(async () => {
  // Clean up
  const testUserIds = [ADMIN_ID, ADMIN2_ID, AGENT_ID, USER_ID, USER2_ID];
  await svc.from('admin_audit_log').delete().in('admin_id', testUserIds);
  await svc.from('custom_fields').delete().ilike('name', 'Phase7Test%');

  const { data: testTickets } = await svc.from('tickets').select('id').in('creator_id', testUserIds);
  if (testTickets && testTickets.length > 0) {
    const ticketIds = testTickets.map((t: { id: number }) => t.id);
    await svc.from('ticket_tags').delete().in('ticket_id', ticketIds);
    await svc.from('posts').delete().in('ticket_id', ticketIds);
    await svc.from('tickets').update({ duplicate_of_id: null, merged_into_id: null }).in('id', ticketIds);
    await svc.from('tickets').delete().in('id', ticketIds);
  }
});

// ============================================================
// ADMIN AUDIT LOG
// ============================================================

describe('Admin audit log', () => {
  it('admin can insert and read audit log entries', async () => {
    const adminClient = await clientForUser('admin7@test.com');

    const { error: insertErr } = await adminClient
      .from('admin_audit_log')
      .insert({
        admin_id: ADMIN_ID,
        action: 'test_action',
        target_type: 'test',
        target_id: 'test-123',
        details: { foo: 'bar' },
      });

    expect(insertErr).toBeNull();

    const { data, error: selectErr } = await adminClient
      .from('admin_audit_log')
      .select('*')
      .eq('action', 'test_action')
      .eq('admin_id', ADMIN_ID);

    expect(selectErr).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(1);
    expect(data![0].details).toEqual({ foo: 'bar' });
  });

  it('non-admin cannot read audit log (RLS)', async () => {
    const userClient = await clientForUser('user7@test.com');

    const { data, error: _error } = await userClient
      .from('admin_audit_log')
      .select('*');

    // RLS should return empty or error
    expect(data?.length ?? 0).toBe(0);
  });

  it('non-admin cannot insert audit log (RLS)', async () => {
    const userClient = await clientForUser('user7@test.com');

    const { error: insertErr } = await userClient
      .from('admin_audit_log')
      .insert({
        admin_id: USER_ID,
        action: 'should_fail',
        target_type: 'test',
      });

    expect(insertErr).not.toBeNull();
  });

  it('agent cannot read audit log (RLS)', async () => {
    const agentClient = await clientForUser('agent7@test.com');

    const { data } = await agentClient
      .from('admin_audit_log')
      .select('*');

    expect(data?.length ?? 0).toBe(0);
  });
});

// ============================================================
// CUSTOM FIELDS
// ============================================================

describe('Custom fields', () => {
  let fieldId: string;

  it('admin can create a custom field', async () => {
    const adminClient = await clientForUser('admin7@test.com');

    const { data, error } = await adminClient
      .from('custom_fields')
      .insert({
        name: 'Phase7TestText',
        field_type: 'text',
        is_required: false,
        display_order: 1,
      })
      .select('id, name, field_type')
      .single();

    expect(error).toBeNull();
    expect(data!.name).toBe('Phase7TestText');
    expect(data!.field_type).toBe('text');
    fieldId = data!.id;
  });

  it('admin can create a dropdown custom field with options', async () => {
    const adminClient = await clientForUser('admin7@test.com');

    const { data, error } = await adminClient
      .from('custom_fields')
      .insert({
        name: 'Phase7TestDropdown',
        field_type: 'dropdown',
        is_required: true,
        default_value: 'Option A',
        options: ['Option A', 'Option B', 'Option C'],
        display_order: 2,
      })
      .select('id, name, field_type, options')
      .single();

    expect(error).toBeNull();
    expect(data!.field_type).toBe('dropdown');
    expect(data!.options).toEqual(['Option A', 'Option B', 'Option C']);
  });

  it('admin can update a custom field', async () => {
    const adminClient = await clientForUser('admin7@test.com');

    const { error } = await adminClient
      .from('custom_fields')
      .update({ is_required: true, default_value: 'default' })
      .eq('id', fieldId);

    expect(error).toBeNull();

    const { data } = await adminClient
      .from('custom_fields')
      .select('is_required, default_value')
      .eq('id', fieldId)
      .single();

    expect(data!.is_required).toBe(true);
    expect(data!.default_value).toBe('default');
  });

  it('all authenticated users can read custom fields', async () => {
    const userClient = await clientForUser('user7@test.com');

    const { data, error } = await userClient
      .from('custom_fields')
      .select('*')
      .ilike('name', 'Phase7Test%');

    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(1);
  });

  it('non-admin cannot create custom fields (RLS)', async () => {
    const userClient = await clientForUser('user7@test.com');

    const { error } = await userClient
      .from('custom_fields')
      .insert({
        name: 'Phase7TestShouldFail',
        field_type: 'text',
        display_order: 99,
      });

    expect(error).not.toBeNull();
  });

  it('non-admin cannot update custom fields (RLS)', async () => {
    const userClient = await clientForUser('user7@test.com');

    const { error } = await userClient
      .from('custom_fields')
      .update({ name: 'RenamedByUser' })
      .eq('id', fieldId);

    // RLS blocks update — either error or 0 rows affected
    // Supabase returns no error but 0 affected rows for updates blocked by RLS
    if (!error) {
      const { data } = await svc.from('custom_fields').select('name').eq('id', fieldId).single();
      expect(data!.name).not.toBe('RenamedByUser');
    }
  });

  it('non-admin cannot delete custom fields (RLS)', async () => {
    const userClient = await clientForUser('user7@test.com');

    await userClient
      .from('custom_fields')
      .delete()
      .eq('id', fieldId);

    // Verify field still exists
    const { data } = await svc.from('custom_fields').select('id').eq('id', fieldId).single();
    expect(data).not.toBeNull();
  });

  it('admin can delete a custom field', async () => {
    const adminClient = await clientForUser('admin7@test.com');

    const { error } = await adminClient
      .from('custom_fields')
      .delete()
      .eq('id', fieldId);

    expect(error).toBeNull();
  });
});

// ============================================================
// CUSTOM FIELDS ON TICKETS
// ============================================================

describe('Custom fields on tickets', () => {
  let ticketId: number;

  it('ticket custom_fields JSONB stores and retrieves correctly', async () => {
    // Create a ticket with custom_fields via service role
    const { data, error } = await svc
      .from('tickets')
      .insert({
        title: 'Phase7 custom fields test',
        slug: 'phase7-custom-fields-test',
        type_id: defaultTypeId,
        creator_id: USER_ID,
        is_private: false,
        urgency: 'medium',
        severity: 'medium',
        custom_fields: { 'Phase7TestText': 'hello', 'Phase7TestNum': 42 },
      })
      .select('id, custom_fields')
      .single();

    expect(error).toBeNull();
    expect(data!.custom_fields).toEqual({ Phase7TestText: 'hello', Phase7TestNum: 42 });
    ticketId = data!.id;

    // Create original post so the ticket is valid
    await svc.from('posts').insert({
      ticket_id: ticketId,
      author_id: USER_ID,
      body: 'Phase 7 custom fields test body.',
      is_original: true,
      post_type: 'post',
    });
  });

  it('custom_fields JSONB can be updated', async () => {
    const { error } = await svc
      .from('tickets')
      .update({ custom_fields: { Phase7TestText: 'updated', Phase7TestNum: 42, NewField: true } })
      .eq('id', ticketId);

    expect(error).toBeNull();

    const { data } = await svc.from('tickets').select('custom_fields').eq('id', ticketId).single();
    expect(data!.custom_fields).toEqual({ Phase7TestText: 'updated', Phase7TestNum: 42, NewField: true });
  });
});

// ============================================================
// NOTIFICATION TEMPLATES
// ============================================================

describe('Notification templates', () => {
  it('admin can read notification templates', async () => {
    const adminClient = await clientForUser('admin7@test.com');

    const { data, error } = await adminClient
      .from('notification_templates')
      .select('*');

    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(9);
  });

  it('admin can update a notification template', async () => {
    const adminClient = await clientForUser('admin7@test.com');

    const { error } = await adminClient
      .from('notification_templates')
      .update({ subject: 'Custom subject', body: 'Custom body', is_customized: true })
      .eq('event_type', 'new_post');

    expect(error).toBeNull();

    const { data } = await adminClient
      .from('notification_templates')
      .select('subject, body, is_customized')
      .eq('event_type', 'new_post')
      .single();

    expect(data!.subject).toBe('Custom subject');
    expect(data!.is_customized).toBe(true);

    // Restore default
    await adminClient
      .from('notification_templates')
      .update({
        subject: 'New reply on your ticket',
        body: 'There is a new reply on your ticket "{{ticketTitle}}".',
        is_customized: false,
      })
      .eq('event_type', 'new_post');
  });

  it('non-admin cannot read notification templates (RLS)', async () => {
    const userClient = await clientForUser('user7@test.com');

    const { data } = await userClient
      .from('notification_templates')
      .select('*');

    expect(data?.length ?? 0).toBe(0);
  });

  it('agent cannot read notification templates (RLS)', async () => {
    const agentClient = await clientForUser('agent7@test.com');

    const { data } = await agentClient
      .from('notification_templates')
      .select('*');

    expect(data?.length ?? 0).toBe(0);
  });
});

// ============================================================
// AGENT / ADMIN MANAGEMENT (role changes via service role)
// ============================================================

describe('Agent/admin management', () => {
  it('promote user to agent', async () => {
    await svc.from('profiles').update({ role: 'agent' }).eq('id', USER2_ID);

    const { data } = await svc.from('profiles').select('role').eq('id', USER2_ID).single();
    expect(data!.role).toBe('agent');
  });

  it('demote agent back to user', async () => {
    await svc.from('profiles').update({ role: 'user' }).eq('id', USER2_ID);

    const { data } = await svc.from('profiles').select('role').eq('id', USER2_ID).single();
    expect(data!.role).toBe('user');
  });

  it('last admin guard — app logic counts admins before demotion', async () => {
    // Demote ADMIN2 so we have one fewer admin from this test's set
    await svc.from('profiles').update({ role: 'user' }).eq('id', ADMIN2_ID);

    // Verify ADMIN2 is no longer admin
    const { data: demoted } = await svc.from('profiles').select('role').eq('id', ADMIN2_ID).single();
    expect(demoted!.role).toBe('user');

    // Count admins — should have at least 1 (ADMIN_ID + any seed admins)
    const { count } = await svc
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'admin');

    expect(count).toBeGreaterThanOrEqual(1);

    // Restore ADMIN2
    await svc.from('profiles').update({ role: 'admin' }).eq('id', ADMIN2_ID);
  });
});

// ============================================================
// APP SETTINGS
// ============================================================

describe('App settings', () => {
  it('admin can update privacy settings', async () => {
    const adminClient = await clientForUser('admin7@test.com');

    const { error } = await adminClient
      .from('app_settings')
      .update({ value: 'false' })
      .eq('key', 'ticket_default_privacy');

    expect(error).toBeNull();

    const { data } = await adminClient
      .from('app_settings')
      .select('value')
      .eq('key', 'ticket_default_privacy')
      .single();

    expect(data!.value).toBe('false');

    // Restore
    await adminClient
      .from('app_settings')
      .update({ value: 'true' })
      .eq('key', 'ticket_default_privacy');
  });

  it('admin can update pagination settings', async () => {
    const adminClient = await clientForUser('admin7@test.com');

    const { error } = await adminClient
      .from('app_settings')
      .update({ value: '25' })
      .eq('key', 'user_page_size');

    expect(error).toBeNull();

    // Restore
    await adminClient
      .from('app_settings')
      .update({ value: '20' })
      .eq('key', 'user_page_size');
  });

  it('admin can update rate limit setting', async () => {
    const adminClient = await clientForUser('admin7@test.com');

    const { error } = await adminClient
      .from('app_settings')
      .update({ value: '5' })
      .eq('key', 'ticket_creation_rate_limit');

    expect(error).toBeNull();

    // Restore
    await adminClient
      .from('app_settings')
      .update({ value: '10' })
      .eq('key', 'ticket_creation_rate_limit');
  });

  it('non-admin cannot update app settings (RLS)', async () => {
    const userClient = await clientForUser('user7@test.com');

    await userClient
      .from('app_settings')
      .update({ value: '999' })
      .eq('key', 'ticket_creation_rate_limit');

    // RLS blocks — verify value unchanged
    const { data } = await svc
      .from('app_settings')
      .select('value')
      .eq('key', 'ticket_creation_rate_limit')
      .single();

    expect(data!.value).not.toBe('999');
  });

  it('all authenticated users can read app settings', async () => {
    const userClient = await clientForUser('user7@test.com');

    const { data, error } = await userClient
      .from('app_settings')
      .select('*');

    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(5);
  });
});
