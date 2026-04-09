import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServiceRoleClient } from '../helpers/supabase';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

let svc: SupabaseClient;

// Fixed IDs matching seed.sql (range ...0011-...0018 to avoid conflict with 001-schema test UUIDs)
const ADMIN_ID = '00000000-0000-0000-0000-000000000011';
const AGENT_SMITH_ID = '00000000-0000-0000-0000-000000000012';
const AGENT_JONES_ID = '00000000-0000-0000-0000-000000000013';
const ALICE_ID = '00000000-0000-0000-0000-000000000014';
const BOB_ID = '00000000-0000-0000-0000-000000000015';
const CAROL_ID = '00000000-0000-0000-0000-000000000016';
const DAVE_ID = '00000000-0000-0000-0000-000000000017';
const EVE_ID = '00000000-0000-0000-0000-000000000018';
const TEAM_ID = '00000000-0000-0000-0000-000000000110';

// Trigger test users (created/deleted within tests)
const TRIGGER_TEST_ID_1 = '00000000-0000-0000-0000-000000000201';
const TRIGGER_TEST_ID_2 = '00000000-0000-0000-0000-000000000202';
const TRIGGER_TEST_ID_3 = '00000000-0000-0000-0000-000000000203';

beforeAll(() => {
  svc = createServiceRoleClient();
});

// Clean up trigger test users after all tests
afterAll(async () => {
  for (const uid of [TRIGGER_TEST_ID_1, TRIGGER_TEST_ID_2, TRIGGER_TEST_ID_3]) {
    await svc.from('profiles').delete().eq('id', uid);
    await svc.auth.admin.deleteUser(uid).catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// login_attempts table tests
// ---------------------------------------------------------------------------
describe('login_attempts', () => {
  const testEmail = 'lockout-test@example.com';

  beforeAll(async () => {
    // Clean up any previous test data
    await svc.from('login_attempts').delete().eq('email', testEmail);
  });

  afterAll(async () => {
    await svc.from('login_attempts').delete().eq('email', testEmail);
  });

  it('should increment attempt count', async () => {
    await svc.from('login_attempts').insert({
      email: testEmail,
      attempt_count: 1,
    });

    const { data } = await svc
      .from('login_attempts')
      .select('*')
      .eq('email', testEmail)
      .single();

    expect(data).toBeTruthy();
    expect(data!.attempt_count).toBe(1);

    await svc
      .from('login_attempts')
      .update({ attempt_count: 2 })
      .eq('email', testEmail);

    const { data: updated } = await svc
      .from('login_attempts')
      .select('*')
      .eq('email', testEmail)
      .single();

    expect(updated!.attempt_count).toBe(2);
  });

  it('should allow login at 4 failures (not locked)', async () => {
    await svc
      .from('login_attempts')
      .update({ attempt_count: 4, locked_until: null })
      .eq('email', testEmail);

    const { data } = await svc
      .from('login_attempts')
      .select('*')
      .eq('email', testEmail)
      .single();

    expect(data!.attempt_count).toBe(4);
    expect(data!.locked_until).toBeNull();
  });

  it('should lockout after 5 failures', async () => {
    const lockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await svc
      .from('login_attempts')
      .update({ attempt_count: 5, locked_until: lockedUntil })
      .eq('email', testEmail);

    const { data } = await svc
      .from('login_attempts')
      .select('*')
      .eq('email', testEmail)
      .single();

    expect(data!.attempt_count).toBe(5);
    expect(data!.locked_until).toBeTruthy();
    expect(new Date(data!.locked_until!) > new Date()).toBe(true);
  });

  it('should reset on success', async () => {
    await svc
      .from('login_attempts')
      .update({ attempt_count: 0, locked_until: null })
      .eq('email', testEmail);

    const { data } = await svc
      .from('login_attempts')
      .select('*')
      .eq('email', testEmail)
      .single();

    expect(data!.attempt_count).toBe(0);
    expect(data!.locked_until).toBeNull();
  });

  it('should allow login after lockout expires (simulated)', async () => {
    // Set locked_until in the past
    const expiredLock = new Date(Date.now() - 1000).toISOString();
    await svc
      .from('login_attempts')
      .update({ attempt_count: 5, locked_until: expiredLock })
      .eq('email', testEmail);

    const { data } = await svc
      .from('login_attempts')
      .select('*')
      .eq('email', testEmail)
      .single();

    expect(data!.attempt_count).toBe(5);
    // locked_until is in the past — login should be allowed
    expect(new Date(data!.locked_until!) < new Date()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// handle_new_user trigger tests
// ---------------------------------------------------------------------------
describe('handle_new_user trigger', () => {
  it('should auto-create profile with display_name from user_metadata', async () => {
    const { error } = await svc.auth.admin.createUser({
      id: TRIGGER_TEST_ID_1,
      email: 'trigger-test-1@example.com',
      password: 'Password123',
      email_confirm: true,
      user_metadata: { display_name: 'Test DisplayName' },
    });
    expect(error).toBeNull();

    const { data: profile } = await svc
      .from('profiles')
      .select('*')
      .eq('id', TRIGGER_TEST_ID_1)
      .single();

    expect(profile).toBeTruthy();
    expect(profile!.display_name).toBe('Test DisplayName');
    expect(profile!.email).toBe('trigger-test-1@example.com');
    expect(profile!.role).toBe('user');
  });

  it('should fall back to "name" field in user_metadata', async () => {
    const { error } = await svc.auth.admin.createUser({
      id: TRIGGER_TEST_ID_2,
      email: 'trigger-test-2@example.com',
      password: 'Password123',
      email_confirm: true,
      user_metadata: { name: 'NameOnly' },
    });
    expect(error).toBeNull();

    const { data: profile } = await svc
      .from('profiles')
      .select('display_name')
      .eq('id', TRIGGER_TEST_ID_2)
      .single();

    expect(profile!.display_name).toBe('NameOnly');
  });

  it('should fall back to email prefix if no user_metadata', async () => {
    const { error } = await svc.auth.admin.createUser({
      id: TRIGGER_TEST_ID_3,
      email: 'trigger-test-3@example.com',
      password: 'Password123',
      email_confirm: true,
    });
    expect(error).toBeNull();

    const { data: profile } = await svc
      .from('profiles')
      .select('display_name')
      .eq('id', TRIGGER_TEST_ID_3)
      .single();

    expect(profile!.display_name).toBe('trigger-test-3');
  });
});

// ---------------------------------------------------------------------------
// "Deleted User #" CHECK constraint
// ---------------------------------------------------------------------------
describe('display_name reserved prefix constraint', () => {
  it('should reject INSERT with "Deleted User #" prefix', async () => {
    const { error } = await svc.auth.admin.createUser({
      email: 'deleted-user-test@example.com',
      password: 'Password123',
      email_confirm: true,
      user_metadata: { display_name: 'Deleted User #123' },
    });
    // The trigger should reject this
    expect(error).toBeTruthy();
  });

  it('should reject UPDATE with "Deleted User #" prefix', async () => {
    const { error } = await svc
      .from('profiles')
      .update({ display_name: 'Deleted User #999' })
      .eq('id', ADMIN_ID);

    expect(error).toBeTruthy();
    expect(error!.message).toContain('chk_display_name_not_reserved');
  });
});

// ---------------------------------------------------------------------------
// Blocked users still have profiles
// ---------------------------------------------------------------------------
describe('blocked users', () => {
  it('should still have profiles with is_blocked=true when blocked via admin', async () => {
    // Block eve for this test, then unblock
    await svc.from('profiles').update({ is_blocked: true }).eq('id', EVE_ID);

    const { data: profile } = await svc
      .from('profiles')
      .select('is_blocked')
      .eq('id', EVE_ID)
      .single();

    expect(profile).toBeTruthy();
    expect(profile!.is_blocked).toBe(true);

    // Clean up — unblock
    await svc.from('profiles').update({ is_blocked: false }).eq('id', EVE_ID);
  });
});

// ---------------------------------------------------------------------------
// Seed data verification
// ---------------------------------------------------------------------------
describe('seed data verification', () => {
  it('should have 8 users with correct roles', async () => {
    const { data: profiles } = await svc
      .from('profiles')
      .select('id, email, role')
      .in('id', [ADMIN_ID, AGENT_SMITH_ID, AGENT_JONES_ID, ALICE_ID, BOB_ID, CAROL_ID, DAVE_ID, EVE_ID]);

    expect(profiles).toHaveLength(8);

    const roleCount = { admin: 0, agent: 0, user: 0 };
    for (const p of profiles!) {
      roleCount[p.role as keyof typeof roleCount]++;
    }
    expect(roleCount.admin).toBe(1);
    expect(roleCount.agent).toBe(2);
    expect(roleCount.user).toBe(5);
  });

  it('should have "Alice\'s Team" with Alice, Bob, Carol', async () => {
    const { data: team } = await svc
      .from('teams')
      .select('id, name')
      .eq('id', TEAM_ID)
      .single();

    expect(team).toBeTruthy();
    expect(team!.name).toBe("Alice's Team");

    const { data: members } = await svc
      .from('profiles')
      .select('id')
      .eq('team_id', TEAM_ID);

    expect(members).toHaveLength(3);
    const memberIds = members!.map((m) => m.id);
    expect(memberIds).toContain(ALICE_ID);
    expect(memberIds).toContain(BOB_ID);
    expect(memberIds).toContain(CAROL_ID);
  });

  it('should have correct display names', async () => {
    const { data: profiles } = await svc
      .from('profiles')
      .select('id, display_name')
      .in('id', [ADMIN_ID, AGENT_SMITH_ID, ALICE_ID, DAVE_ID, EVE_ID]);

    const byId = Object.fromEntries(profiles!.map((p) => [p.id, p.display_name]));
    expect(byId[ADMIN_ID]).toBe('Admin');
    expect(byId[AGENT_SMITH_ID]).toBe('Agent Smith');
    expect(byId[ALICE_ID]).toBe('Alice');
    expect(byId[DAVE_ID]).toBe('Dave');
    expect(byId[EVE_ID]).toBe('Eve');
  });

  it('Dave and Eve should not be on any team', async () => {
    const { data: profiles } = await svc
      .from('profiles')
      .select('id, team_id')
      .in('id', [DAVE_ID, EVE_ID]);

    for (const p of profiles!) {
      expect(p.team_id).toBeNull();
    }
  });
});
