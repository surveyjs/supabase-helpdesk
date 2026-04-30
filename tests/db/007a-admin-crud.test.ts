import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServiceRoleClient } from '../helpers/supabase';
import { diffAndSave } from '../../src/lib/actions/admin-crud';

const ADMIN_ID = '00000000-0000-0000-0000-000000000071';

const TEST_PREFIX = 'diffsave_';

describe('diffAndSave (admin-crud helper)', () => {
  const svc = createServiceRoleClient();

  beforeAll(async () => {
    // Clean any leftover rows from prior runs.
    await svc.from('tags').delete().like('name', `${TEST_PREFIX}%`);
    // Clear audit entries from prior runs of this test.
    await svc.from('admin_audit_log').delete().eq('admin_id', ADMIN_ID).eq('action', 'update_tags_bulk_test');
  });

  afterAll(async () => {
    await svc.from('tags').delete().like('name', `${TEST_PREFIX}%`);
    await svc.from('admin_audit_log').delete().eq('admin_id', ADMIN_ID).eq('action', 'update_tags_bulk_test');
  });

  it('handles add, update, and remove in a single call', async () => {
    // Seed: insert two rows we will later update + remove.
    const { data: seeded, error: seedErr } = await svc
      .from('tags')
      .insert([
        { name: `${TEST_PREFIX}keep`, color: '#aaaaaa' },
        { name: `${TEST_PREFIX}drop`, color: '#bbbbbb' },
      ])
      .select('id, name, color');
    expect(seedErr).toBeNull();
    expect(seeded).toHaveLength(2);

    const keep = seeded!.find((r) => r.name === `${TEST_PREFIX}keep`)!;
    // const drop = seeded!.find((r) => r.name === `${TEST_PREFIX}drop`)!;

    // Build an incoming payload that reflects one row scoped to "this test
    // only". To avoid clobbering rows from other tests, we restrict the diff
    // to rows whose name starts with TEST_PREFIX by passing the full set.
    // Strategy: select all current TEST_PREFIX rows, modify them, and pass
    // back. We supply only the survivor (`keep`, recoloured) plus a brand
    // new row (`new`). The `drop` row should be deleted.
    //
    // diffAndSave operates on the entire `tags` table though — so we use a
    // disposable in-memory table-like wrapper by working through a temp
    // RPC. Simplest: ensure only TEST_PREFIX rows exist for the duration
    // by snapshotting and re-inserting non-test rows after. But that's
    // invasive. Instead, accept that the "removed" assertion below is
    // scoped to the rows we actually inserted, by checking presence/
    // absence of those exact names.

    const incoming = [
      { id: keep.id as string, name: `${TEST_PREFIX}keep`, color: '#cccccc' }, // updated color
      { name: `${TEST_PREFIX}new`, color: '#dddddd' }, // added
      // `drop` is intentionally omitted
    ];

    // To safely call diffAndSave without deleting rows owned by other tests,
    // we filter the incoming set against a snapshot of existing TEST_PREFIX
    // rows + every non-prefixed row currently in the table.
    const { data: allExisting } = await svc.from('tags').select('id, name, color');
    const nonTestRows = (allExisting ?? [])
      .filter((r) => !String(r.name).startsWith(TEST_PREFIX))
      .map((r) => ({ id: r.id as string, name: r.name as string, color: r.color as string }));

    const result = await diffAndSave({
      table: 'tags',
      rows: [...nonTestRows, ...incoming],
      columns: ['name', 'color'],
      auditAction: 'update_tags_bulk_test',
      client: svc,
      actorId: ADMIN_ID,
    });

    expect(result.added).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.removed).toBe(1);

    // Verify DB state.
    const { data: finalRows } = await svc
      .from('tags')
      .select('name, color')
      .like('name', `${TEST_PREFIX}%`)
      .order('name');

    expect(finalRows).toEqual([
      { name: `${TEST_PREFIX}keep`, color: '#cccccc' },
      { name: `${TEST_PREFIX}new`, color: '#dddddd' },
    ]);

    // Verify audit log entry.
    const { data: audit } = await svc
      .from('admin_audit_log')
      .select('action, target_type, details, admin_id')
      .eq('admin_id', ADMIN_ID)
      .eq('action', 'update_tags_bulk_test')
      .order('created_at', { ascending: false })
      .limit(1);

    expect(audit).toHaveLength(1);
    expect(audit![0].target_type).toBe('tags');
    expect(audit![0].details).toMatchObject({ added: 1, updated: 1, removed: 1 });
  });
});
