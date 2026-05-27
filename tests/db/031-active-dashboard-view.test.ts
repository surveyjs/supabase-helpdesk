import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SupabaseClient } from '@supabase/supabase-js';
import { createServiceRoleClient } from '../helpers/supabase';

const PROFILE_ID = '00000000-0000-0000-0000-000000000920';

let svc: SupabaseClient;

beforeAll(async () => {
  svc = createServiceRoleClient();

  await svc.from('profiles').delete().eq('id', PROFILE_ID).then(() => undefined, () => undefined);
  await svc.auth.admin.deleteUser(PROFILE_ID).catch(() => undefined);

  const { error } = await svc.auth.admin.createUser({
    id: PROFILE_ID,
    email: 'active-view@test.local',
    password: 'Password123',
    email_confirm: true,
    user_metadata: { display_name: 'Active View Tester' },
  });
  if (error) throw new Error(`createUser: ${error.message}`);

  // Promote to agent so the profile can own saved views.
  await svc.from('profiles').update({ role: 'agent' }).eq('id', PROFILE_ID);
});

afterAll(async () => {
  await svc.auth.admin.deleteUser(PROFILE_ID);
});

describe('031 — active dashboard view persistence', () => {
  it('active_view_id defaults to NULL for new profiles', async () => {
    const { data, error } = await svc
      .from('profiles')
      .select('active_view_id')
      .eq('id', PROFILE_ID)
      .single();
    expect(error).toBeNull();
    expect(data?.active_view_id).toBeNull();
  });

  it('can set active_view_id to a valid saved_view id', async () => {
    const { data: view, error: insertErr } = await svc
      .from('saved_views')
      .insert({
        agent_id: PROFILE_ID,
        name: 'Test View',
        filters: { type: 'json', data: {}, sql: '' },
      })
      .select('id')
      .single();
    expect(insertErr).toBeNull();

    const { error: updateErr } = await svc
      .from('profiles')
      .update({ active_view_id: view!.id })
      .eq('id', PROFILE_ID);
    expect(updateErr).toBeNull();

    const { data, error } = await svc
      .from('profiles')
      .select('active_view_id')
      .eq('id', PROFILE_ID)
      .single();
    expect(error).toBeNull();
    expect(data?.active_view_id).toBe(view!.id);

    // Cleanup — also exercises ON DELETE SET NULL.
    await svc.from('saved_views').delete().eq('id', view!.id);
  });

  it('deleting the referenced saved view sets active_view_id to NULL (ON DELETE SET NULL)', async () => {
    const { data: view } = await svc
      .from('saved_views')
      .insert({
        agent_id: PROFILE_ID,
        name: 'Transient View',
        filters: { type: 'json', data: {}, sql: '' },
      })
      .select('id')
      .single();

    await svc
      .from('profiles')
      .update({ active_view_id: view!.id })
      .eq('id', PROFILE_ID);

    // Delete the view — FK should automatically null out active_view_id.
    await svc.from('saved_views').delete().eq('id', view!.id);

    const { data, error } = await svc
      .from('profiles')
      .select('active_view_id')
      .eq('id', PROFILE_ID)
      .single();
    expect(error).toBeNull();
    expect(data?.active_view_id).toBeNull();
  });

  it('can be reset to NULL explicitly', async () => {
    const { data: view } = await svc
      .from('saved_views')
      .insert({
        agent_id: PROFILE_ID,
        name: 'Another View',
        filters: { type: 'json', data: {}, sql: '' },
      })
      .select('id')
      .single();

    await svc
      .from('profiles')
      .update({ active_view_id: view!.id })
      .eq('id', PROFILE_ID);

    // Explicitly reset to NULL (selecting Default view).
    const { error: resetErr } = await svc
      .from('profiles')
      .update({ active_view_id: null })
      .eq('id', PROFILE_ID);
    expect(resetErr).toBeNull();

    const { data } = await svc
      .from('profiles')
      .select('active_view_id')
      .eq('id', PROFILE_ID)
      .single();
    expect(data?.active_view_id).toBeNull();

    await svc.from('saved_views').delete().eq('id', view!.id);
  });
});
