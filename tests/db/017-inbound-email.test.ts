import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServiceRoleClient } from '../helpers/supabase';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const ADMIN_ID = '00000000-0000-0000-0000-000000000701';
const AGENT_ID = '00000000-0000-0000-0000-000000000702';
const USER_ID = '00000000-0000-0000-0000-000000000703';

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

beforeAll(async () => {
  svc = createServiceRoleClient();

  await ensureAuthUser(svc, ADMIN_ID, 'ie-admin@test.local', { display_name: 'IEAdmin' });
  await ensureAuthUser(svc, AGENT_ID, 'ie-agent@test.local', { display_name: 'IEAgent' });
  await ensureAuthUser(svc, USER_ID, 'ie-user@test.local', { display_name: 'IEUser' });

  await svc.from('profiles').update({ role: 'admin' }).eq('id', ADMIN_ID);
  await svc.from('profiles').update({ role: 'agent' }).eq('id', AGENT_ID);
  await svc.from('profiles').update({ role: 'user' }).eq('id', USER_ID);
});

afterAll(async () => {
  // Cleanup auto_reply_log entries
  await svc.from('auto_reply_log').delete().ilike('recipient_email', '%test.local%');
  await svc.from('auto_reply_log').delete().ilike('recipient_email', 'msgid:%');
});

// ============================================================
// auto_reply_log table
// ============================================================

describe('auto_reply_log table', () => {
  it('service role can insert and query rows', async () => {
    const { data, error } = await svc
      .from('auto_reply_log')
      .insert({
        recipient_email: 'test-insert@test.local',
        reply_type: 'unknown_sender',
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect(data!.recipient_email).toBe('test-insert@test.local');
    expect(data!.reply_type).toBe('unknown_sender');

    // Clean up
    await svc.from('auto_reply_log').delete().eq('id', data!.id);
  });

  it('regular users cannot access auto_reply_log (RLS)', async () => {
    const userClient = await clientForUser('ie-user@test.local');

    // Insert via service role first
    const { data: row } = await svc
      .from('auto_reply_log')
      .insert({
        recipient_email: 'rls-test@test.local',
        reply_type: 'blocked_user',
      })
      .select()
      .single();

    // User cannot read
    const { data: readData } = await userClient
      .from('auto_reply_log')
      .select('*')
      .eq('id', row!.id);

    expect(readData).toEqual([]);

    // User cannot insert
    const { error: insertError } = await userClient
      .from('auto_reply_log')
      .insert({
        recipient_email: 'rls-insert@test.local',
        reply_type: 'unknown_sender',
      });

    expect(insertError).toBeTruthy();

    // Clean up
    await svc.from('auto_reply_log').delete().eq('id', row!.id);
  });

  it('enforces valid reply_type values', async () => {
    const { error } = await svc
      .from('auto_reply_log')
      .insert({
        recipient_email: 'check-test@test.local',
        reply_type: 'invalid_type',
      });

    expect(error).toBeTruthy();
    expect(error!.message).toContain('check');
  });

  it('rate limiting counts rows within 1-hour window', async () => {
    const email = 'rate-limit-test@test.local';

    // Insert 3 rows within the hour
    for (let i = 0; i < 3; i++) {
      await svc.from('auto_reply_log').insert({
        recipient_email: email,
        reply_type: 'unknown_sender',
      });
    }

    // Count within 1 hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await svc
      .from('auto_reply_log')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_email', email)
      .gte('sent_at', oneHourAgo);

    expect(count).toBe(3);

    // Clean up
    await svc.from('auto_reply_log').delete().eq('recipient_email', email);
  });

  it('rows older than 24 hours can be deleted', async () => {
    const email = 'old-row-test@test.local';

    // Insert a row
    const { data: row } = await svc
      .from('auto_reply_log')
      .insert({
        recipient_email: email,
        reply_type: 'blocked_user',
      })
      .select()
      .single();

    // Verify it exists
    const { count: before } = await svc
      .from('auto_reply_log')
      .select('id', { count: 'exact', head: true })
      .eq('id', row!.id);

    expect(before).toBe(1);

    // Delete it (simulating cleanup)
    await svc.from('auto_reply_log').delete().eq('id', row!.id);

    const { count: after } = await svc
      .from('auto_reply_log')
      .select('id', { count: 'exact', head: true })
      .eq('id', row!.id);

    expect(after).toBe(0);
  });
});

// ============================================================
// Inbound Email Settings in app_settings
// ============================================================

describe('inbound email settings', () => {
  it('inbound_email_enabled exists in app_settings', async () => {
    const { data, error } = await svc
      .from('app_settings')
      .select('key, value')
      .eq('key', 'inbound_email_enabled')
      .single();

    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect(data!.key).toBe('inbound_email_enabled');
  });

  it('inbound_email_reply_to_address exists in app_settings', async () => {
    const { data, error } = await svc
      .from('app_settings')
      .select('key, value')
      .eq('key', 'inbound_email_reply_to_address')
      .single();

    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect(data!.key).toBe('inbound_email_reply_to_address');
  });

  it('admin can update inbound email settings', async () => {
    const adminClient = await clientForUser('ie-admin@test.local');

    // Update enabled
    const { error: e1 } = await adminClient
      .from('app_settings')
      .update({ value: 'true' })
      .eq('key', 'inbound_email_enabled');

    expect(e1).toBeNull();

    // Update reply-to address
    const { error: e2 } = await adminClient
      .from('app_settings')
      .update({ value: 'support@test.local' })
      .eq('key', 'inbound_email_reply_to_address');

    expect(e2).toBeNull();

    // Verify
    const { data: enabled } = await adminClient
      .from('app_settings')
      .select('value')
      .eq('key', 'inbound_email_enabled')
      .single();

    expect(enabled!.value).toBe('true');

    // Restore defaults
    await svc.from('app_settings').update({ value: 'false' }).eq('key', 'inbound_email_enabled');
    await svc.from('app_settings').update({ value: '' }).eq('key', 'inbound_email_reply_to_address');
  });
});

// ============================================================
// Auto-reply notification templates
// ============================================================

describe('auto-reply notification templates', () => {
  const templateEventTypes = [
    'auto_reply_unknown_sender',
    'auto_reply_blocked_user',
    'auto_reply_duplicate_ticket',
    'auto_reply_rate_limit',
  ];

  for (const eventType of templateEventTypes) {
    it(`template "${eventType}" exists`, async () => {
      const { data, error } = await svc
        .from('notification_templates')
        .select('event_type, subject, body')
        .eq('event_type', eventType)
        .single();

      expect(error).toBeNull();
      expect(data).toBeTruthy();
      expect(data!.event_type).toBe(eventType);
      expect(data!.subject).toBeTruthy();
      expect(data!.body).toBeTruthy();
    });
  }

  it('admin can customize auto-reply templates', async () => {
    const adminClient = await clientForUser('ie-admin@test.local');

    const { error } = await adminClient
      .from('notification_templates')
      .update({
        subject: 'Custom Unknown Sender',
        is_customized: true,
      })
      .eq('event_type', 'auto_reply_unknown_sender');

    expect(error).toBeNull();

    // Verify
    const { data } = await adminClient
      .from('notification_templates')
      .select('subject, is_customized')
      .eq('event_type', 'auto_reply_unknown_sender')
      .single();

    expect(data!.subject).toBe('Custom Unknown Sender');
    expect(data!.is_customized).toBe(true);

    // Restore
    await svc
      .from('notification_templates')
      .update({
        subject: 'Unable to process your email',
        is_customized: false,
      })
      .eq('event_type', 'auto_reply_unknown_sender');
  });
});
