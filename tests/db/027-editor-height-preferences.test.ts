import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SupabaseClient } from '@supabase/supabase-js';
import { createServiceRoleClient } from '../helpers/supabase';

const PROFILE_ID = '00000000-0000-0000-0000-000000000910';

let svc: SupabaseClient;

beforeAll(async () => {
  svc = createServiceRoleClient();

  const { error } = await svc.auth.admin.createUser({
    id: PROFILE_ID,
    email: 'editor-heights@test.local',
    password: 'Password123',
    email_confirm: true,
    user_metadata: { display_name: 'Editor Heights' },
  });
  if (error && !error.message.includes('already been registered')) {
    throw new Error(`createUser: ${error.message}`);
  }
});

afterAll(async () => {
  await svc.auth.admin.deleteUser(PROFILE_ID);
});

describe('027 — editor height preferences', () => {
  it('defaults to 300 and 540 px on a freshly created profile', async () => {
    const { data, error } = await svc
      .from('profiles')
      .select('editor_min_height_px, editor_max_height_px')
      .eq('id', PROFILE_ID)
      .single();
    expect(error).toBeNull();
    expect(data?.editor_min_height_px).toBe(300);
    expect(data?.editor_max_height_px).toBe(540);
  });

  it('accepts an in-range update', async () => {
    const { error } = await svc
      .from('profiles')
      .update({ editor_min_height_px: 320, editor_max_height_px: 600 })
      .eq('id', PROFILE_ID);
    expect(error).toBeNull();
  });

  it('rejects min below the lower bound (120)', async () => {
    const { error } = await svc
      .from('profiles')
      .update({ editor_min_height_px: 100 })
      .eq('id', PROFILE_ID);
    expect(error).not.toBeNull();
    expect(error?.message ?? '').toMatch(/check|constraint/i);
  });

  it('rejects max above the upper bound (2000)', async () => {
    const { error } = await svc
      .from('profiles')
      .update({ editor_max_height_px: 2500 })
      .eq('id', PROFILE_ID);
    expect(error).not.toBeNull();
    expect(error?.message ?? '').toMatch(/check|constraint/i);
  });

  it('rejects min greater than max via composite check', async () => {
    // Reset to known-good state first.
    await svc
      .from('profiles')
      .update({ editor_min_height_px: 300, editor_max_height_px: 540 })
      .eq('id', PROFILE_ID);
    const { error } = await svc
      .from('profiles')
      .update({ editor_min_height_px: 600, editor_max_height_px: 400 })
      .eq('id', PROFILE_ID);
    expect(error).not.toBeNull();
    expect(error?.message ?? '').toMatch(/editor_height_min_le_max|check|constraint/i);
  });
});
