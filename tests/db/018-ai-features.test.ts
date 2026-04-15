import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServiceRoleClient } from '../helpers/supabase';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const ADMIN_ID = '00000000-0000-0000-0000-000000000801';
const AGENT_ID = '00000000-0000-0000-0000-000000000802';
const USER_ID = '00000000-0000-0000-0000-000000000803';

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

  await ensureAuthUser(svc, ADMIN_ID, 'ai-admin@test.local', { display_name: 'AIAdmin' });
  await ensureAuthUser(svc, AGENT_ID, 'ai-agent@test.local', { display_name: 'AIAgent' });
  await ensureAuthUser(svc, USER_ID, 'ai-user@test.local', { display_name: 'AIUser' });

  await svc.from('profiles').update({ role: 'admin' }).eq('id', ADMIN_ID);
  await svc.from('profiles').update({ role: 'agent' }).eq('id', AGENT_ID);
  await svc.from('profiles').update({ role: 'user' }).eq('id', USER_ID);
});

afterAll(async () => {
  // Cleanup AI test data
  await svc.from('ai_usage_log').delete().eq('agent_id', AGENT_ID);
  await svc.from('ai_usage_log').delete().is('agent_id', null);
  await svc.from('ai_rate_limit_log').delete().eq('agent_id', AGENT_ID);
  await svc.from('ticket_summaries').delete().neq('ticket_id', 0);
});

// ============================================================
// AI Settings in app_settings
// ============================================================

describe('AI app_settings', () => {
  const AI_KEYS = [
    'ai_provider',
    'ai_custom_endpoint_url',
    'ai_model',
    'ai_request_timeout',
    'ai_auto_categorize_enabled',
    'ai_auto_categorize_min_body_length',
    'ai_duplicate_detection_enabled',
    'ai_duplicate_detection_threshold',
    'ai_suggested_reply_enabled',
    'ai_suggested_reply_context_window',
    'ai_suggested_reply_rate_limit',
    'ai_ticket_summary_enabled',
    'ai_ticket_summary_min_posts',
    'ai_generate_kb_article_enabled',
  ];

  it('all AI settings keys exist with correct defaults', async () => {
    const { data, error } = await svc
      .from('app_settings')
      .select('key, value')
      .in('key', AI_KEYS);

    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect(data!.length).toBe(AI_KEYS.length);

    const map = new Map(data!.map((r) => [r.key, r.value]));
    expect(map.get('ai_provider')).toBe('');
    expect(map.get('ai_request_timeout')).toBe('60');
    expect(map.get('ai_auto_categorize_enabled')).toBe('false');
    expect(map.get('ai_auto_categorize_min_body_length')).toBe('20');
    expect(map.get('ai_duplicate_detection_enabled')).toBe('false');
    expect(map.get('ai_duplicate_detection_threshold')).toBe('medium');
    expect(map.get('ai_suggested_reply_enabled')).toBe('false');
    expect(map.get('ai_suggested_reply_context_window')).toBe('20');
    expect(map.get('ai_suggested_reply_rate_limit')).toBe('20');
    expect(map.get('ai_ticket_summary_enabled')).toBe('false');
    expect(map.get('ai_ticket_summary_min_posts')).toBe('10');
    expect(map.get('ai_generate_kb_article_enabled')).toBe('false');
  });

  it('admin can update AI settings', async () => {
    const adminClient = await clientForUser('ai-admin@test.local');

    const { error } = await adminClient
      .from('app_settings')
      .update({ value: 'openai' })
      .eq('key', 'ai_provider');

    expect(error).toBeNull();

    // Verify
    const { data } = await adminClient
      .from('app_settings')
      .select('value')
      .eq('key', 'ai_provider')
      .single();

    expect(data?.value).toBe('openai');

    // Reset
    await svc.from('app_settings').update({ value: '' }).eq('key', 'ai_provider');
  });

  it('non-admin cannot update AI settings', async () => {
    const userClient = await clientForUser('ai-user@test.local');

    const { error: _error } = await userClient
      .from('app_settings')
      .update({ value: 'openai' })
      .eq('key', 'ai_provider');

    // RLS should block the update (either error or no rows affected)
    // Read to verify unchanged
    const { data } = await svc
      .from('app_settings')
      .select('value')
      .eq('key', 'ai_provider')
      .single();

    expect(data?.value).toBe('');
  });
});

// ============================================================
// ai_usage_log table
// ============================================================

describe('ai_usage_log table', () => {
  it('service role can insert usage rows', async () => {
    const { data, error } = await svc
      .from('ai_usage_log')
      .insert({
        agent_id: AGENT_ID,
        feature: 'suggested_reply',
        tokens_used: 500,
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect(data!.feature).toBe('suggested_reply');
    expect(data!.tokens_used).toBe(500);
  });

  it('admin can read usage data', async () => {
    const adminClient = await clientForUser('ai-admin@test.local');

    const { data, error } = await adminClient
      .from('ai_usage_log')
      .select('*')
      .eq('agent_id', AGENT_ID);

    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(1);
  });

  it('agent cannot read usage data (RLS)', async () => {
    const agentClient = await clientForUser('ai-agent@test.local');

    const { data } = await agentClient
      .from('ai_usage_log')
      .select('*');

    // Agent is not admin, so RLS denies
    expect(data).toEqual([]);
  });

  it('regular user cannot read usage data (RLS)', async () => {
    const userClient = await clientForUser('ai-user@test.local');

    const { data } = await userClient
      .from('ai_usage_log')
      .select('*');

    expect(data).toEqual([]);
  });

  it('rejects invalid feature values', async () => {
    const { error } = await svc
      .from('ai_usage_log')
      .insert({
        agent_id: AGENT_ID,
        feature: 'invalid_feature',
        tokens_used: 100,
      });

    expect(error).toBeTruthy();
  });
});

// ============================================================
// ai_rate_limit_log table
// ============================================================

describe('ai_rate_limit_log table', () => {
  it('service role can insert rate limit entries', async () => {
    const { data, error } = await svc
      .from('ai_rate_limit_log')
      .insert({
        agent_id: AGENT_ID,
        feature: 'suggested_reply',
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect(data!.agent_id).toBe(AGENT_ID);
  });

  it('agent can read their own rate limit entries', async () => {
    const agentClient = await clientForUser('ai-agent@test.local');

    const { data, error } = await agentClient
      .from('ai_rate_limit_log')
      .select('*')
      .eq('agent_id', AGENT_ID);

    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(1);
  });

  it('agent cannot read other agents\' entries (RLS)', async () => {
    const adminClient = await clientForUser('ai-admin@test.local');

    // Admin reading agent's entries — admin is not the agent, so filtered
    const { data } = await adminClient
      .from('ai_rate_limit_log')
      .select('*')
      .eq('agent_id', AGENT_ID);

    // RLS: auth.uid() = agent_id, so admin can't see agent's entries
    expect(data).toEqual([]);
  });

  it('regular user cannot read rate limit entries (RLS)', async () => {
    const userClient = await clientForUser('ai-user@test.local');

    const { data } = await userClient
      .from('ai_rate_limit_log')
      .select('*');

    expect(data).toEqual([]);
  });
});

// ============================================================
// ticket_summaries table
// ============================================================

describe('ticket_summaries table', () => {
  let testTicketId: number;

  beforeAll(async () => {
    // Create a ticket type for the test ticket
    const { data: ticketType } = await svc
      .from('ticket_types')
      .select('id')
      .limit(1)
      .single();

    const { data: ticket } = await svc
      .from('tickets')
      .insert({
        title: 'AI Summary Test Ticket',
        slug: 'ai-summary-test',
        creator_id: USER_ID,
        type_id: ticketType!.id,
      })
      .select('id')
      .single();

    testTicketId = ticket!.id;
  });

  afterAll(async () => {
    await svc.from('ticket_summaries').delete().eq('ticket_id', testTicketId);
    await svc.from('posts').delete().eq('ticket_id', testTicketId);
    await svc.from('tickets').delete().eq('id', testTicketId);
  });

  it('service role can insert and upsert summaries', async () => {
    const { data, error } = await svc
      .from('ticket_summaries')
      .insert({
        ticket_id: testTicketId,
        summary: 'Test summary content',
        post_count_at_generation: 10,
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect(data!.summary).toBe('Test summary content');
    expect(data!.post_count_at_generation).toBe(10);

    // Upsert with updated summary
    const { data: upserted, error: upsertErr } = await svc
      .from('ticket_summaries')
      .upsert(
        {
          ticket_id: testTicketId,
          summary: 'Updated summary',
          post_count_at_generation: 15,
          generated_at: new Date().toISOString(),
        },
        { onConflict: 'ticket_id' },
      )
      .select()
      .single();

    expect(upsertErr).toBeNull();
    expect(upserted!.summary).toBe('Updated summary');
    expect(upserted!.post_count_at_generation).toBe(15);
  });

  it('agent can read summaries', async () => {
    const agentClient = await clientForUser('ai-agent@test.local');

    const { data, error } = await agentClient
      .from('ticket_summaries')
      .select('*')
      .eq('ticket_id', testTicketId);

    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(1);
  });

  it('regular user cannot read summaries (RLS)', async () => {
    const userClient = await clientForUser('ai-user@test.local');

    const { data } = await userClient
      .from('ticket_summaries')
      .select('*')
      .eq('ticket_id', testTicketId);

    expect(data).toEqual([]);
  });
});
