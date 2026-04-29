import type { SupabaseClient } from '@supabase/supabase-js';

type AdminAuditClient = {
  from: (table: string) => { insert: (row: Record<string, unknown>) => unknown };
};

async function defaultLogAudit(
  supabase: AdminAuditClient,
  adminId: string,
  action: string,
  targetType: string,
  targetId: string | null,
  details: Record<string, unknown>,
) {
  await supabase.from('admin_audit_log').insert({
    admin_id: adminId,
    action,
    target_type: targetType,
    target_id: targetId,
    details,
  });
}

export type DiffAndSaveOptions<TRow extends { id?: string }> = {
  table: string;
  rows: TRow[];
  columns: (keyof TRow)[];
  auditAction: string;
  /**
   * Optional explicit Supabase client + actor id. When provided, skips the
   * admin-role check and uses these for DB calls + audit. Used by tests.
   */
  client?: SupabaseClient;
  actorId?: string;
};

export type DiffAndSaveResult = {
  added: number;
  updated: number;
  removed: number;
};

/**
 * Bulk-save a CRUD list by diffing the supplied rows against existing DB rows.
 *
 * - Rows without an `id` are inserted.
 * - Rows whose `id` matches an existing row and where any of `columns` differs are updated.
 * - Existing rows whose `id` is not present in the supplied set are deleted.
 *
 * Validation is the caller's responsibility. Calls `logAudit` once with the
 * supplied `auditAction` and `{ added, updated, removed }` payload.
 */
export async function diffAndSave<TRow extends { id?: string }>(
  opts: DiffAndSaveOptions<TRow>,
): Promise<DiffAndSaveResult> {
  const { table, rows, columns, auditAction } = opts;

  let supabase: SupabaseClient;
  let actorId: string;
  if (opts.client && opts.actorId) {
    supabase = opts.client;
    actorId = opts.actorId;
  } else {
    const { requireAdminRole } = await import('./_admin-helpers');
    const ctx = await requireAdminRole();
    supabase = ctx.supabase as unknown as SupabaseClient;
    actorId = ctx.profile.id;
  }

  const selectCols = ['id', ...columns.map(String)].join(', ');
  const { data: existingData, error: loadErr } = await supabase
    .from(table)
    .select(selectCols);
  if (loadErr) throw new Error(`diffAndSave: failed to load ${table}: ${loadErr.message}`);

  const existing = (existingData ?? []) as unknown as TRow[];
  const existingById = new Map<string, TRow>();
  for (const row of existing) {
    if (row.id) existingById.set(row.id, row);
  }

  const incomingIds = new Set<string>();
  const toInsert: Record<string, unknown>[] = [];
  const toUpdate: { id: string; patch: Record<string, unknown> }[] = [];

  for (const row of rows) {
    if (!row.id) {
      const payload: Record<string, unknown> = {};
      for (const col of columns) payload[String(col)] = row[col];
      toInsert.push(payload);
      continue;
    }

    incomingIds.add(row.id);
    const prev = existingById.get(row.id);
    if (!prev) {
      // Row claims an id we don't have. Treat as insert with explicit id.
      const payload: Record<string, unknown> = { id: row.id };
      for (const col of columns) payload[String(col)] = row[col];
      toInsert.push(payload);
      continue;
    }

    const patch: Record<string, unknown> = {};
    let changed = false;
    for (const col of columns) {
      if (prev[col] !== row[col]) {
        patch[String(col)] = row[col];
        changed = true;
      }
    }
    if (changed) toUpdate.push({ id: row.id, patch });
  }

  const toDelete: string[] = [];
  for (const id of existingById.keys()) {
    if (!incomingIds.has(id)) toDelete.push(id);
  }

  if (toInsert.length > 0) {
    const { error } = await supabase.from(table).insert(toInsert);
    if (error) throw new Error(`diffAndSave: insert into ${table} failed: ${error.message}`);
  }

  for (const { id, patch } of toUpdate) {
    const { error } = await supabase.from(table).update(patch).eq('id', id);
    if (error) throw new Error(`diffAndSave: update ${table} ${id} failed: ${error.message}`);
  }

  if (toDelete.length > 0) {
    const { error } = await supabase.from(table).delete().in('id', toDelete);
    if (error) throw new Error(`diffAndSave: delete from ${table} failed: ${error.message}`);
  }

  const result: DiffAndSaveResult = {
    added: toInsert.length,
    updated: toUpdate.length,
    removed: toDelete.length,
  };

  await defaultLogAudit(supabase as unknown as AdminAuditClient, actorId, auditAction, table, null, result);

  return result;
}
