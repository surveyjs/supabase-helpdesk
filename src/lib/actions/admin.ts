'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServerClient, createServiceRoleClient } from '@/lib/supabase/server';
import { requireAdminRole, logAudit } from './_admin-helpers';
import {
  DEFAULT_AGENT_DASHBOARD_SURVEY_CONFIG,
  DEFAULT_TICKET_DETAIL_AGENT_CONFIG,
  DEFAULT_TICKET_DETAIL_USER_CONFIG,
} from '@/lib/constants/survey-ui-config';


// ============================================================
// Ticket Types
// ============================================================

export async function setDefaultTicketType(formData: FormData): Promise<void> {
  const { supabase, profile } = await requireAdminRole();

  const typeId = formData.get('type_id') as string;
  if (!typeId) return;

  // Unset current default
  await supabase
    .from('ticket_types')
    .update({ is_default: false })
    .eq('is_default', true);

  // Set new default
  const { data: typeData, error } = await supabase
    .from('ticket_types')
    .update({ is_default: true })
    .eq('id', typeId)
    .select('name')
    .single();

  if (error) return;

  await logAudit(supabase, profile.id, 'set_default_ticket_type', 'ticket_type', typeId, { name: typeData?.name });
  revalidatePath('/admin/types');
}

// ============================================================
// Tags
// ============================================================

const HEX_COLOR_STRICT_RE = /^#[0-9a-fA-F]{6}$/;

type TagRowInput = { id?: string; name?: unknown; color?: unknown };

export async function saveTags(formData: FormData): Promise<{ message?: string; error?: string }> {
  await requireAdminRole();

  const raw = formData.get('rows');
  if (typeof raw !== 'string') {
    return { error: 'Invalid request: missing rows.' };
  }

  let parsed: TagRowInput[];
  try {
    const json = JSON.parse(raw);
    if (!Array.isArray(json)) throw new Error('rows must be an array');
    parsed = json as TagRowInput[];
  } catch (e) {
    return { error: `Invalid rows JSON: ${e instanceof Error ? e.message : 'unknown'}` };
  }

  const cleanRows: { id?: string; name: string; color: string }[] = [];
  for (const row of parsed) {
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    const color = typeof row.color === 'string' ? row.color.trim() : '';
    if (!name || name.length > 50) {
      return { error: `Invalid tag name: ${JSON.stringify(row.name)}` };
    }
    if (!HEX_COLOR_STRICT_RE.test(color)) {
      return { error: `Invalid tag color (must be #RRGGBB): ${JSON.stringify(row.color)}` };
    }
    cleanRows.push({ id: typeof row.id === 'string' ? row.id : undefined, name, color });
  }

  const { diffAndSave } = await import('./admin-crud');
  try {
    const result = await diffAndSave({
      table: 'tags',
      rows: cleanRows,
      columns: ['name', 'color'],
      auditAction: 'update_tags_bulk',
    });
    revalidatePath('/admin/tags');
    return {
      message: `Tags saved (${result.added} added, ${result.updated} updated, ${result.removed} removed).`,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to save tags.' };
  }
}

// ============================================================
// Bulk save actions for Categories / Types / Teams / KB Categories
// ============================================================

type GenericRow = { id?: string; name?: unknown };

function parseNamedRows(formData: FormData, opts: { maxLen: number; label: string }): {
  rows?: { id?: string; name: string }[];
  error?: string;
} {
  const raw = formData.get('rows');
  if (typeof raw !== 'string') {
    return { error: 'Invalid request: missing rows.' };
  }
  let parsed: GenericRow[];
  try {
    const json = JSON.parse(raw);
    if (!Array.isArray(json)) throw new Error('rows must be an array');
    parsed = json as GenericRow[];
  } catch (e) {
    return { error: `Invalid rows JSON: ${e instanceof Error ? e.message : 'unknown'}` };
  }
  const cleanRows: { id?: string; name: string }[] = [];
  const seen = new Set<string>();
  for (const row of parsed) {
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (!name || name.length > opts.maxLen) {
      return { error: `Invalid ${opts.label} name: ${JSON.stringify(row.name)}` };
    }
    const lower = name.toLowerCase();
    if (seen.has(lower)) {
      return { error: `Duplicate ${opts.label} name: ${name}` };
    }
    seen.add(lower);
    cleanRows.push({ id: typeof row.id === 'string' ? row.id : undefined, name });
  }
  return { rows: cleanRows };
}

export async function saveCategories(
  formData: FormData,
): Promise<{ message?: string; error?: string }> {
  await requireAdminRole();
  const parsed = parseNamedRows(formData, { maxLen: 100, label: 'category' });
  if (parsed.error || !parsed.rows) return { error: parsed.error };
  const { diffAndSave } = await import('./admin-crud');
  try {
    const result = await diffAndSave({
      table: 'categories',
      rows: parsed.rows,
      columns: ['name'],
      auditAction: 'update_categories_bulk',
    });
    revalidatePath('/admin/categories');
    return {
      message: `Categories saved (${result.added} added, ${result.updated} updated, ${result.removed} removed).`,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to save categories.' };
  }
}

export async function saveTicketTypes(
  formData: FormData,
): Promise<{ message?: string; error?: string }> {
  await requireAdminRole();
  const parsed = parseNamedRows(formData, { maxLen: 100, label: 'ticket type' });
  if (parsed.error || !parsed.rows) return { error: parsed.error };
  const { diffAndSave } = await import('./admin-crud');
  try {
    const result = await diffAndSave({
      table: 'ticket_types',
      rows: parsed.rows,
      columns: ['name'],
      auditAction: 'update_ticket_types_bulk',
    });
    revalidatePath('/admin/types');
    return {
      message: `Ticket types saved (${result.added} added, ${result.updated} updated, ${result.removed} removed).`,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to save ticket types.' };
  }
}

export async function saveTeams(
  formData: FormData,
): Promise<{ message?: string; error?: string }> {
  const { supabase } = await requireAdminRole();
  const parsed = parseNamedRows(formData, { maxLen: 100, label: 'team' });
  if (parsed.error || !parsed.rows) return { error: parsed.error };

  // Pre-check: refuse to delete teams that still have members.
  const incomingIds = new Set(parsed.rows.map((r) => r.id).filter((x): x is string => !!x));
  const { data: existing } = await supabase.from('teams').select('id, name');
  const candidatesForDeletion = (existing ?? []).filter((t) => !incomingIds.has(t.id as string));
  if (candidatesForDeletion.length > 0) {
    const ids = candidatesForDeletion.map((t) => t.id as string);
    const { data: members } = await supabase
      .from('profiles')
      .select('team_id')
      .in('team_id', ids);
    const blockedIds = new Set((members ?? []).map((m) => m.team_id as string));
    const blocked = candidatesForDeletion.filter((t) => blockedIds.has(t.id as string));
    if (blocked.length > 0) {
      return {
        error: `Cannot delete team(s) with members: ${blocked.map((t) => t.name).join(', ')}`,
      };
    }
  }

  const { diffAndSave } = await import('./admin-crud');
  try {
    const result = await diffAndSave({
      table: 'teams',
      rows: parsed.rows,
      columns: ['name'],
      auditAction: 'update_teams_bulk',
    });
    revalidatePath('/admin/teams');
    return {
      message: `Teams saved (${result.added} added, ${result.updated} updated, ${result.removed} removed).`,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to save teams.' };
  }
}

export async function saveKbCategories(
  formData: FormData,
): Promise<{ message?: string; error?: string }> {
  await requireAdminRole();
  const parsed = parseNamedRows(formData, { maxLen: 100, label: 'KB category' });
  if (parsed.error || !parsed.rows) return { error: parsed.error };

  // Derive display_order from row index (1-based to match existing data).
  const rowsWithOrder = parsed.rows.map((r, i) => ({
    id: r.id,
    name: r.name,
    display_order: i + 1,
  }));

  const { diffAndSave } = await import('./admin-crud');
  try {
    const result = await diffAndSave({
      table: 'kb_categories',
      rows: rowsWithOrder,
      columns: ['name', 'display_order'],
      auditAction: 'update_kb_categories_bulk',
    });
    revalidatePath('/admin/kb-categories');
    return {
      message: `KB categories saved (${result.added} added, ${result.updated} updated, ${result.removed} removed).`,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to save KB categories.' };
  }
}

// ============================================================
// Custom Fields (bulk save)
// ============================================================

const SUPPORTED_FIELD_TYPES = ['text', 'number', 'dropdown', 'checkbox', 'date'] as const;
type SupportedFieldType = (typeof SUPPORTED_FIELD_TYPES)[number];

type CustomFieldInputRow = {
  id?: string;
  name?: unknown;
  field_type?: unknown;
  is_required?: unknown;
  default_value?: unknown;
  options?: unknown;
};

type CustomFieldDbRow = {
  id?: string;
  name: string;
  field_type: SupportedFieldType;
  is_required: boolean;
  default_value: string | null;
  options: string[] | null;
  display_order: number;
};

export async function saveCustomFields(
  formData: FormData,
): Promise<{ message?: string; error?: string }> {
  const { supabase } = await requireAdminRole();

  const raw = formData.get('fields');
  if (typeof raw !== 'string') {
    return { error: 'Invalid request: missing fields.' };
  }
  let parsed: CustomFieldInputRow[];
  try {
    const json = JSON.parse(raw);
    if (!Array.isArray(json)) throw new Error('fields must be an array');
    parsed = json as CustomFieldInputRow[];
  } catch (e) {
    return { error: `Invalid fields JSON: ${e instanceof Error ? e.message : 'unknown'}` };
  }

  const cleanRows: CustomFieldDbRow[] = [];
  const seenNames = new Set<string>();

  for (let i = 0; i < parsed.length; i++) {
    const row = parsed[i];
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (!name || name.length > 100) {
      return { error: `Invalid field name: ${JSON.stringify(row.name)}` };
    }
    const lower = name.toLowerCase();
    if (seenNames.has(lower)) {
      return { error: `Duplicate field name: ${name}` };
    }
    seenNames.add(lower);

    const fieldType = typeof row.field_type === 'string' ? row.field_type : '';
    if (!SUPPORTED_FIELD_TYPES.includes(fieldType as SupportedFieldType)) {
      return { error: `Invalid field_type for "${name}": ${JSON.stringify(row.field_type)}` };
    }

    const isRequired = row.is_required === true;
    const defaultValueRaw =
      typeof row.default_value === 'string' ? row.default_value.trim() : '';
    const defaultValue = defaultValueRaw.length > 0 ? defaultValueRaw : null;

    if (isRequired && !defaultValue && fieldType !== 'checkbox') {
      return { error: `"${name}" is required but has no default value.` };
    }

    let options: string[] | null = null;
    if (fieldType === 'dropdown') {
      const optionsRaw = typeof row.options === 'string' ? row.options : '';
      const items = optionsRaw
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean);
      if (items.length === 0) {
        return { error: `"${name}" is a dropdown but has no options.` };
      }
      const seenOpts = new Set<string>();
      for (const item of items) {
        if (seenOpts.has(item)) {
          return { error: `"${name}" has duplicate option: ${item}` };
        }
        seenOpts.add(item);
      }
      if (defaultValue && !items.includes(defaultValue)) {
        return { error: `"${name}" default value "${defaultValue}" is not one of the options.` };
      }
      options = items;
    }

    cleanRows.push({
      id: typeof row.id === 'string' ? row.id : undefined,
      name,
      field_type: fieldType as SupportedFieldType,
      is_required: isRequired,
      default_value: defaultValue,
      options,
      display_order: i,
    });
  }

  // Capture pre-save state to maintain ticket JSONB integrity for renames/deletes.
  const { data: existingFields } = await supabase
    .from('custom_fields')
    .select('id, name');
  const existingNameById = new Map<string, string>();
  for (const f of existingFields ?? []) {
    existingNameById.set(f.id as string, f.name as string);
  }

  const { diffAndSave } = await import('./admin-crud');
  let result;
  try {
    result = await diffAndSave({
      table: 'custom_fields',
      rows: cleanRows,
      columns: ['name', 'field_type', 'is_required', 'default_value', 'options', 'display_order'],
      auditAction: 'update_custom_fields_bulk',
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to save custom fields.' };
  }

  // Apply ticket JSONB key migrations for renames / deletions.
  const incomingIds = new Set(cleanRows.map((r) => r.id).filter((x): x is string => !!x));
  const renames: { from: string; to: string }[] = [];
  const deletedNames: string[] = [];
  for (const [id, oldName] of existingNameById) {
    if (!incomingIds.has(id)) {
      deletedNames.push(oldName);
      continue;
    }
    const newRow = cleanRows.find((r) => r.id === id);
    if (newRow && newRow.name !== oldName) {
      renames.push({ from: oldName, to: newRow.name });
    }
  }

  if (renames.length > 0 || deletedNames.length > 0) {
    const serviceClient = createServiceRoleClient();
    const { data: tickets } = await serviceClient
      .from('tickets')
      .select('id, custom_fields')
      .not('custom_fields', 'is', null);

    if (tickets) {
      for (const ticket of tickets) {
        const cf = ticket.custom_fields as Record<string, unknown> | null;
        if (!cf) continue;
        let changed = false;
        const next: Record<string, unknown> = { ...cf };
        for (const { from, to } of renames) {
          if (from in next) {
            next[to] = next[from];
            delete next[from];
            changed = true;
          }
        }
        for (const dropped of deletedNames) {
          if (dropped in next) {
            delete next[dropped];
            changed = true;
          }
        }
        if (changed) {
          await serviceClient
            .from('tickets')
            .update({ custom_fields: next })
            .eq('id', ticket.id);
        }
      }
    }
  }

  revalidatePath('/admin/custom-fields');
  return {
    message: `Custom fields saved (${result.added} added, ${result.updated} updated, ${result.removed} removed).`,
  };
}

// ============================================================
// Subscription Tiers (bulk)
// ============================================================

const TIER_KEY_REGEX = /^[a-z0-9](-?[a-z0-9])*$/;

const TIER_BOOLEAN_COLUMNS = [
  'cap_change_visibility',
  'cap_set_severity',
  'cap_change_status',
  'cap_change_type',
  'cap_add_remove_tags',
] as const;

type TierBooleanCol = (typeof TIER_BOOLEAN_COLUMNS)[number];

type TierInputRow = {
  id?: string;
  key?: unknown;
  display_name?: unknown;
} & Partial<Record<TierBooleanCol, unknown>>;

type TierDbRow = {
  id?: string;
  key: string;
  display_name: string;
  sort_order: number;
} & Record<TierBooleanCol, boolean>;

export async function saveTiers(
  formData: FormData,
): Promise<{ message?: string; error?: string }> {
  const { supabase } = await requireAdminRole();

  const raw = formData.get('rows');
  if (typeof raw !== 'string') {
    return { message: 'Error: missing rows.', error: 'Invalid request: missing rows.' };
  }
  let parsed: TierInputRow[];
  try {
    const json = JSON.parse(raw);
    if (!Array.isArray(json)) throw new Error('rows must be an array');
    parsed = json as TierInputRow[];
  } catch (e) {
    const msg = `Invalid rows JSON: ${e instanceof Error ? e.message : 'unknown'}`;
    return { message: `Error: ${msg}`, error: msg };
  }

  const cleanRows: TierDbRow[] = [];
  const seenKeys = new Set<string>();

  for (let i = 0; i < parsed.length; i++) {
    const row = parsed[i];
    const key = typeof row.key === 'string' ? row.key.trim() : '';
    if (!key || !TIER_KEY_REGEX.test(key)) {
      const msg = `Invalid tier key: ${JSON.stringify(row.key)}`;
      return { message: `Error: ${msg}`, error: msg };
    }
    if (seenKeys.has(key)) {
      const msg = `Duplicate tier key: ${key}`;
      return { message: `Error: ${msg}`, error: msg };
    }
    seenKeys.add(key);

    const displayName = typeof row.display_name === 'string' ? row.display_name.trim() : '';
    if (!displayName || displayName.length > 100) {
      const msg = `Invalid display_name for tier "${key}".`;
      return { message: `Error: ${msg}`, error: msg };
    }

    const dbRow: TierDbRow = {
      id: typeof row.id === 'string' ? row.id : undefined,
      key,
      display_name: displayName,
      sort_order: i,
      cap_change_visibility: row.cap_change_visibility === true,
      cap_set_severity: row.cap_set_severity === true,
      cap_change_status: row.cap_change_status === true,
      cap_change_type: row.cap_change_type === true,
      cap_add_remove_tags: row.cap_add_remove_tags === true,
    };
    cleanRows.push(dbRow);
  }

  // Defense-in-depth: reject any update that changes `key` for an existing row.
  const existingIds = cleanRows
    .map((r) => r.id)
    .filter((x): x is string => !!x);
  if (existingIds.length > 0) {
    const { data: existing, error: loadErr } = await supabase
      .from('subscription_tiers')
      .select('id, key')
      .in('id', existingIds);
    if (loadErr) {
      const msg = `Failed to load existing tiers: ${loadErr.message}`;
      return { message: `Error: ${msg}`, error: msg };
    }
    const existingKeyById = new Map<string, string>();
    for (const t of existing ?? []) {
      existingKeyById.set(t.id as string, t.key as string);
    }
    for (const row of cleanRows) {
      if (!row.id) continue;
      const dbKey = existingKeyById.get(row.id);
      if (dbKey !== undefined && dbKey !== row.key) {
        const msg = `Tier key is immutable. "${dbKey}" cannot be renamed to "${row.key}".`;
        return { message: `Error: ${msg}`, error: msg };
      }
    }
  }

  const { diffAndSave } = await import('./admin-crud');
  let result;
  try {
    result = await diffAndSave({
      table: 'subscription_tiers',
      rows: cleanRows,
      columns: ['key', 'display_name', 'sort_order', ...TIER_BOOLEAN_COLUMNS],
      auditAction: 'update_tiers_bulk',
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to save tiers.';
    return { message: `Error: ${msg}`, error: msg };
  }

  revalidatePath('/admin/tiers');
  return {
    message: `Tiers saved (${result.added} added, ${result.updated} updated, ${result.removed} removed).`,
  };
}

// ============================================================
// Teams
// ============================================================

export async function addTeamMember(formData: FormData): Promise<void> {
  const { supabase, profile } = await requireAdminRole();

  const teamId = formData.get('team_id') as string;
  const userEmail = (formData.get('email') as string)?.trim();
  if (!teamId || !userEmail) return;

  // Find user by email
  const { data: targetUser } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', userEmail)
    .single();

  if (!targetUser) return;

  // Use service role to update another user's profile (RLS only allows self-update)
  const serviceClient = createServiceRoleClient();
  const { error } = await serviceClient
    .from('profiles')
    .update({ team_id: teamId })
    .eq('id', targetUser.id);

  if (error) return;

  await logAudit(supabase, profile.id, 'add_team_member', 'team', teamId, { email: userEmail });
  revalidatePath('/admin/teams');
}

export async function removeTeamMember(formData: FormData): Promise<void> {
  const { supabase, profile } = await requireAdminRole();

  const userId = formData.get('user_id') as string;
  if (!userId) return;

  const serviceClient = createServiceRoleClient();
  const { data: target } = await serviceClient.from('profiles').select('email, team_id').eq('id', userId).single();

  const { error } = await serviceClient
    .from('profiles')
    .update({ team_id: null })
    .eq('id', userId);

  if (error) return;

  await logAudit(supabase, profile.id, 'remove_team_member', 'team', target?.team_id, { email: target?.email });
  revalidatePath('/admin/teams');
}

// ============================================================
// Audit Log Helper
// ============================================================
// (Moved to ./_admin-helpers)

// ============================================================
// Agent & Admin Management (§16.6)
// ============================================================

export async function promoteToAgent(formData: FormData): Promise<void> {
  const { supabase, profile: adminProfile } = await requireAdminRole();
  const userId = formData.get('user_id') as string;
  if (!userId) return;

  const serviceClient = createServiceRoleClient();
  const { data: target } = await serviceClient
    .from('profiles')
    .select('id, role, display_name, email')
    .eq('id', userId)
    .single();
  if (!target) return;

  const { error } = await serviceClient
    .from('profiles')
    .update({ role: 'agent' })
    .eq('id', userId);
  if (error) return;

  await logAudit(supabase, adminProfile.id, 'promote_to_agent', 'user', userId, {
    email: target.email,
    from: target.role,
    to: 'agent',
  });

  revalidatePath('/admin/agents');
}

export async function promoteToAdmin(formData: FormData): Promise<void> {
  const { supabase, profile: adminProfile } = await requireAdminRole();
  const userId = formData.get('user_id') as string;
  if (!userId) return;

  const serviceClient = createServiceRoleClient();
  const { data: target } = await serviceClient
    .from('profiles')
    .select('id, role, display_name, email')
    .eq('id', userId)
    .single();
  if (!target) return;

  const { error } = await serviceClient
    .from('profiles')
    .update({ role: 'admin' })
    .eq('id', userId);
  if (error) return;

  await logAudit(supabase, adminProfile.id, 'promote_to_admin', 'user', userId, {
    email: target.email,
    from: target.role,
    to: 'admin',
  });

  revalidatePath('/admin/agents');
}

export async function demoteToAgent(formData: FormData): Promise<void> {
  const { supabase, profile: adminProfile } = await requireAdminRole();
  const userId = formData.get('user_id') as string;
  if (!userId) return;

  const serviceClient = createServiceRoleClient();

  // Last admin guard
  const { count } = await serviceClient
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'admin');
  if (count !== null && count <= 1) return;

  const { data: target } = await serviceClient
    .from('profiles')
    .select('id, role, display_name, email')
    .eq('id', userId)
    .single();
  if (!target || target.role !== 'admin') return;

  const { error } = await serviceClient
    .from('profiles')
    .update({ role: 'agent' })
    .eq('id', userId);
  if (error) return;

  await logAudit(supabase, adminProfile.id, 'demote_to_agent', 'user', userId, {
    email: target.email,
    from: 'admin',
    to: 'agent',
  });

  revalidatePath('/admin/agents');
}

export async function demoteToUser(formData: FormData): Promise<void> {
  const { supabase, profile: adminProfile } = await requireAdminRole();
  const userId = formData.get('user_id') as string;
  if (!userId) return;

  const serviceClient = createServiceRoleClient();

  const { data: target } = await serviceClient
    .from('profiles')
    .select('id, role, display_name, email')
    .eq('id', userId)
    .single();
  if (!target) return;

  // If demoting an admin, check last admin guard
  if (target.role === 'admin') {
    const { count } = await serviceClient
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'admin');
    if (count !== null && count <= 1) return;
  }

  const { error } = await serviceClient
    .from('profiles')
    .update({ role: 'user' })
    .eq('id', userId);
  if (error) return;

  await logAudit(supabase, adminProfile.id, 'demote_to_user', 'user', userId, {
    email: target.email,
    from: target.role,
    to: 'user',
  });

  revalidatePath('/admin/agents');
}

export async function searchUserByEmail(formData: FormData) {
  await requireAdminRole();
  const email = (formData.get('email') as string)?.trim();
  if (!email) return null;

  const serviceClient = createServiceRoleClient();
  const { data } = await serviceClient
    .from('profiles')
    .select('id, email, display_name, role')
    .eq('email', email)
    .single();

  return data;
}

// ============================================================
// Custom Fields Management (§16.14)
// ============================================================
// Per-row CRUD actions removed in favour of bulk `saveCustomFields`.

// ============================================================
// Privacy Settings (§16.10)
// ============================================================

export async function updatePrivacySettings(formData: FormData): Promise<void> {
  const { supabase, profile: adminProfile } = await requireAdminRole();

  const ticketDefaultPrivacy = formData.get('ticket_default_privacy') as string;
  const allowUserPrivacyControl = formData.get('allow_user_privacy_control') === 'on';
  const allowPublicTicketBrowsing = formData.get('allow_public_ticket_browsing') === 'on';

  const settings: Record<string, string> = {
    ticket_default_privacy: ticketDefaultPrivacy === 'true' ? 'true' : 'false',
    allow_user_privacy_control: allowUserPrivacyControl ? 'true' : 'false',
    allow_public_ticket_browsing: allowPublicTicketBrowsing ? 'true' : 'false',
  };

  for (const [key, value] of Object.entries(settings)) {
    await supabase
      .from('app_settings')
      .update({ value })
      .eq('key', key);
  }

  await logAudit(supabase, adminProfile.id, 'update_privacy_settings', 'app_settings', null, settings);

  revalidatePath('/admin/privacy');
}

// ============================================================
// Pagination Settings (§16.11)
// ============================================================

export async function updatePaginationSettings(formData: FormData): Promise<void> {
  const { supabase, profile: adminProfile } = await requireAdminRole();

  const fields: Record<string, { min: number; max: number }> = {
    user_page_size: { min: 5, max: 100 },
    agent_dashboard_page_size: { min: 5, max: 100 },
    other_lists_page_size: { min: 5, max: 100 },
    visible_posts_threshold: { min: 3, max: 50 },
    visible_comments_threshold: { min: 1, max: 20 },
  };

  const newValues: Record<string, string> = {};

  for (const [key, { min, max }] of Object.entries(fields)) {
    const raw = formData.get(key) as string;
    const val = parseInt(raw, 10);
    if (isNaN(val) || val < min || val > max) return;
    newValues[key] = String(val);
  }

  for (const [key, value] of Object.entries(newValues)) {
    await supabase
      .from('app_settings')
      .update({ value })
      .eq('key', key);
  }

  await logAudit(supabase, adminProfile.id, 'update_pagination_settings', 'app_settings', null, newValues);

  revalidatePath('/admin/pagination');
}

// ============================================================
// Rate Limit (§16.12)
// ============================================================

export async function updateRateLimit(formData: FormData): Promise<void> {
  const { supabase, profile: adminProfile } = await requireAdminRole();

  const raw = formData.get('ticket_creation_rate_limit') as string;
  const val = parseInt(raw, 10);
  if (isNaN(val) || val < 0) return;

  await supabase
    .from('app_settings')
    .update({ value: String(val) })
    .eq('key', 'ticket_creation_rate_limit');

  await logAudit(supabase, adminProfile.id, 'update_rate_limit', 'app_settings', null, {
    ticket_creation_rate_limit: val,
  });

  revalidatePath('/admin/rate-limit');
}

// ============================================================
// Notification Templates (§16.8)
// ============================================================

export async function updateNotificationTemplate(formData: FormData): Promise<void> {
  const { supabase, profile: adminProfile } = await requireAdminRole();

  const eventType = formData.get('event_type') as string;
  const subject = (formData.get('subject') as string)?.trim();
  const body = (formData.get('body') as string)?.trim();

  if (!eventType || !subject || !body) return;

  const { error } = await supabase
    .from('notification_templates')
    .update({ subject, body, is_customized: true, updated_at: new Date().toISOString() })
    .eq('event_type', eventType);

  if (error) return;

  await logAudit(supabase, adminProfile.id, 'update_template', 'notification_template', eventType, {
    subject,
  });

  revalidatePath('/admin/templates');
  revalidatePath('/admin/duplicate-template');
}

export async function resetNotificationTemplate(formData: FormData): Promise<void> {
  const { supabase, profile: adminProfile } = await requireAdminRole();
  const { DEFAULT_TEMPLATES } = await import('@/lib/constants/notification-templates');

  const eventType = formData.get('event_type') as string;
  if (!eventType || !DEFAULT_TEMPLATES[eventType]) return;

  const defaults = DEFAULT_TEMPLATES[eventType];

  const { error } = await supabase
    .from('notification_templates')
    .update({
      subject: defaults.subject,
      body: defaults.body,
      is_customized: false,
      updated_at: new Date().toISOString(),
    })
    .eq('event_type', eventType);

  if (error) return;

  await logAudit(supabase, adminProfile.id, 'reset_template', 'notification_template', eventType, {});

  revalidatePath('/admin/templates');
  revalidatePath('/admin/duplicate-template');
}

export async function saveNotificationTemplates(formData: FormData): Promise<{ message?: string }> {
  const { supabase, profile: adminProfile } = await requireAdminRole();
  const { DEFAULT_TEMPLATES } = await import('@/lib/constants/notification-templates');

  const raw = formData.get('templates');
  if (typeof raw !== 'string' || raw.length === 0) {
    return { message: 'No templates submitted.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { message: 'Invalid templates payload.' };
  }
  if (!Array.isArray(parsed)) {
    return { message: 'Invalid templates payload.' };
  }

  type Row = { event_type: string; subject: string; body: string };
  const rows: Row[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue;
    const r = entry as Record<string, unknown>;
    const eventType = typeof r.event_type === 'string' ? r.event_type : '';
    const subject = typeof r.subject === 'string' ? r.subject.trim() : '';
    const body = typeof r.body === 'string' ? r.body.trim() : '';
    if (!eventType || !DEFAULT_TEMPLATES[eventType]) continue;
    if (!subject || !body) continue;
    rows.push({ event_type: eventType, subject, body });
  }

  if (rows.length === 0) {
    return { message: 'No valid templates to save.' };
  }

  const updatedAt = new Date().toISOString();
  for (const row of rows) {
    await supabase
      .from('notification_templates')
      .update({ subject: row.subject, body: row.body, is_customized: true, updated_at: updatedAt })
      .eq('event_type', row.event_type);
  }

  await logAudit(
    supabase,
    adminProfile.id,
    'update_notification_templates_bulk',
    'notification_template',
    null,
    { count: rows.length },
  );

  revalidatePath('/admin/templates');
  revalidatePath('/admin/duplicate-template');

  return { message: 'Templates saved.' };
}

// ============================================================
// User Settings (§16.26)
// ============================================================

export async function updateUserSettings(formData: FormData): Promise<void> {
  const { supabase, profile: adminProfile } = await requireAdminRole();

  const enforceUniqueness = formData.get('enforce_display_name_uniqueness') === 'on';

  await supabase
    .from('app_settings')
    .update({ value: enforceUniqueness ? 'true' : 'false' })
    .eq('key', 'enforce_display_name_uniqueness');

  await logAudit(supabase, adminProfile.id, 'update_user_settings', 'app_settings', null, {
    enforce_display_name_uniqueness: enforceUniqueness,
  });

  revalidatePath('/admin/user-settings');
}

// ============================================================
// CSAT Settings (§16.19)
// ============================================================

const VALID_CSAT_DELAYS = ['immediately', '1_hour', '4_hours', '24_hours'];

export async function updateCsatSettings(formData: FormData): Promise<void> {
  const { supabase, profile: adminProfile } = await requireAdminRole();

  const enabled = formData.get('csat_enabled') === 'on';
  const delay = formData.get('csat_survey_delay') as string;

  if (!VALID_CSAT_DELAYS.includes(delay)) return;

  await supabase
    .from('app_settings')
    .update({ value: enabled ? 'true' : 'false' })
    .eq('key', 'csat_enabled');

  await supabase
    .from('app_settings')
    .update({ value: delay })
    .eq('key', 'csat_survey_delay');

  await logAudit(supabase, adminProfile.id, 'update_csat_settings', 'app_settings', null, {
    csat_enabled: enabled,
    csat_survey_delay: delay,
  });

  revalidatePath('/admin/csat');
}

// ============================================================
// Custom Field Value on Tickets
// ============================================================

export async function updateCustomFieldValue(formData: FormData): Promise<void> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .single();
  if (!profile) return;

  const ticketId = formData.get('ticket_id') as string;
  const fieldName = formData.get('field_name') as string;
  const value = formData.get('value') as string;
  if (!ticketId || !fieldName) return;

  // Check user is owner or agent
  const isAgent = profile.role === 'agent' || profile.role === 'admin';
  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, creator_id, custom_fields, slug')
    .eq('id', ticketId)
    .single();
  if (!ticket) return;
  if (!isAgent && ticket.creator_id !== user.id) return;

  // Validate against field definition
  const { data: fieldDef } = await supabase
    .from('custom_fields')
    .select('*')
    .eq('name', fieldName)
    .single();
  if (!fieldDef) return;

  // Type validation
  let parsedValue: unknown = value;
  if (fieldDef.field_type === 'number') {
    const num = parseFloat(value);
    if (isNaN(num)) return;
    parsedValue = num;
  } else if (fieldDef.field_type === 'checkbox') {
    parsedValue = value === 'true' || value === 'on';
  } else if (fieldDef.field_type === 'dropdown') {
    const opts = fieldDef.options as string[];
    if (opts && !opts.includes(value)) return;
  } else if (fieldDef.field_type === 'text') {
    if (typeof value === 'string' && value.length > 1000) return;
  }

  if (fieldDef.is_required && !value && fieldDef.field_type !== 'checkbox') return;

  const cf = (ticket.custom_fields ?? {}) as Record<string, unknown>;
  cf[fieldName] = parsedValue;

  const serviceClient = createServiceRoleClient();
  await serviceClient
    .from('tickets')
    .update({ custom_fields: cf })
    .eq('id', ticketId);

  // Log activity
  await supabase.from('activity_log').insert({
    ticket_id: parseInt(ticketId, 10),
    actor_id: user.id,
    action: 'custom_field_changed',
    details: { field: fieldName, value: parsedValue },
  });

  revalidatePath(`/tickets/${ticketId}`);
}

// ============================================================
// File Upload Settings (§16.25)
// ============================================================

const DEFAULT_ALLOWED_FILE_TYPES = [
  'png','jpg','jpeg','gif','webp','svg','pdf','doc','docx',
  'xls','xlsx','txt','csv','md','zip','rar','7z','tar.gz',
];

export async function updateFileSettings(formData: FormData): Promise<void> {
  const { supabase, profile: adminProfile } = await requireAdminRole();

  const allowedTypesRaw = formData.get('allowed_file_types') as string;
  const maxSizeRaw = formData.get('max_file_size_mb') as string;
  const maxFilesRaw = formData.get('max_files_per_post') as string;

  // Validate max_file_size_mb
  const maxSize = parseInt(maxSizeRaw, 10);
  if (isNaN(maxSize) || maxSize < 1 || maxSize > 50) return;

  // Validate max_files_per_post
  const maxFiles = parseInt(maxFilesRaw, 10);
  if (isNaN(maxFiles) || maxFiles < 1 || maxFiles > 20) return;

  // Parse and normalize allowed types (strip leading dots, reject non-extension chars)
  const allowedTypes = allowedTypesRaw
    .split(',')
    .map((t) => t.trim().toLowerCase().replace(/^\.+/, ''))
    .filter((t) => t.length > 0 && /^[a-z0-9]+(\.[a-z0-9]+)?$/.test(t));

  if (allowedTypes.length === 0) return;

  const settings: Record<string, string> = {
    allowed_file_types: JSON.stringify(allowedTypes),
    max_file_size_mb: String(maxSize),
    max_files_per_post: String(maxFiles),
  };

  for (const [key, value] of Object.entries(settings)) {
    await supabase
      .from('app_settings')
      .update({ value })
      .eq('key', key);
  }

  await logAudit(supabase, adminProfile.id, 'update_file_settings', 'app_settings', null, settings);

  revalidatePath('/admin/file-settings');
}

export async function resetFileTypesToDefault(): Promise<void> {
  const { supabase, profile: adminProfile } = await requireAdminRole();

  await supabase
    .from('app_settings')
    .update({ value: JSON.stringify(DEFAULT_ALLOWED_FILE_TYPES) })
    .eq('key', 'allowed_file_types');

  await logAudit(supabase, adminProfile.id, 'reset_file_types', 'app_settings', null, {
    allowed_file_types: DEFAULT_ALLOWED_FILE_TYPES,
  });

  revalidatePath('/admin/file-settings');
}

// ============================================================
// Email Configuration (§16.7)
// ============================================================

export async function updateEmailConfig(formData: FormData): Promise<{ message?: string }> {
  const { supabase, profile: adminProfile } = await requireAdminRole();

  const smtpHost = (formData.get('smtp_host') as string)?.trim() ?? '';
  const smtpPort = parseInt(formData.get('smtp_port') as string, 10) || 587;
  const smtpUsername = (formData.get('smtp_username') as string)?.trim() ?? '';
  const smtpPassword = (formData.get('smtp_password') as string) ?? '';
  const senderEmail = (formData.get('sender_email') as string)?.trim() ?? '';
  const senderName = (formData.get('sender_name') as string)?.trim() || 'HelpDesk';

  if (!smtpHost || !senderEmail) {
    return { message: 'SMTP host and sender email are required.' };
  }

  // Get existing config to handle password
  const serviceClient = createServiceRoleClient();
  const { data: existing } = await serviceClient
    .from('email_config')
    .select('id, smtp_password')
    .limit(1)
    .single();

  if (!existing) return { message: 'Email config not found.' };

  // Only overwrite password if a new one was provided
  const effectivePassword = smtpPassword || existing.smtp_password;

  const { error } = await serviceClient
    .from('email_config')
    .update({
      smtp_host: smtpHost,
      smtp_port: smtpPort,
      smtp_username: smtpUsername,
      smtp_password: effectivePassword,
      sender_email: senderEmail,
      sender_name: senderName,
      is_verified: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', existing.id);

  if (error) return { message: 'Failed to save email config.' };

  await logAudit(supabase, adminProfile.id, 'update_email_config', 'email_config', existing.id, {
    smtp_host: smtpHost,
    smtp_port: smtpPort,
    sender_email: senderEmail,
    sender_name: senderName,
    password_changed: !!smtpPassword,
  });

  revalidatePath('/admin/email');
  return { message: 'Email configuration saved.' };
}

export async function sendTestEmail(): Promise<{ message?: string; success?: boolean }> {
  const { supabase, user, profile: adminProfile } = await requireAdminRole();

  const serviceClient = createServiceRoleClient();
  const { data: config } = await serviceClient
    .from('email_config')
    .select('*')
    .limit(1)
    .single();

  if (!config || !config.smtp_host || !config.sender_email) {
    return { message: 'SMTP not configured. Save your settings first.', success: false };
  }

  const { sendTestEmailRaw } = await import('@/lib/email/send');
  const result = await sendTestEmailRaw({
    smtp_host: config.smtp_host,
    smtp_port: config.smtp_port,
    smtp_username: config.smtp_username,
    smtp_password: config.smtp_password,
    sender_email: config.sender_email,
    sender_name: config.sender_name,
  }, user.email ?? '');

  if (result.success) {
    // Mark as verified
    await serviceClient
      .from('email_config')
      .update({ is_verified: true, updated_at: new Date().toISOString() })
      .eq('id', config.id);

    await logAudit(supabase, adminProfile.id, 'verify_email_config', 'email_config', config.id, {
      test_recipient: user.email,
    });

    revalidatePath('/admin/email');
    return { message: 'Test email sent successfully! Configuration verified.', success: true };
  }

  return { message: `Test email failed: ${result.error}`, success: false };
}

// ============================================================
// Notification Coalescing Delay (§16.29)
// ============================================================

export async function updateCoalescingDelay(formData: FormData): Promise<{ message?: string }> {
  const { supabase, profile: adminProfile } = await requireAdminRole();

  const raw = formData.get('delay_minutes') as string;
  const val = parseInt(raw, 10);
  if (isNaN(val) || val < 0 || val > 15) {
    return { message: 'Delay must be between 0 and 15 minutes.' };
  }

  await supabase
    .from('app_settings')
    .update({ value: String(val) })
    .eq('key', 'notification_coalescing_delay_minutes');

  await logAudit(supabase, adminProfile.id, 'update_coalescing_delay', 'app_settings', null, {
    notification_coalescing_delay_minutes: val,
  });

  revalidatePath('/admin/email');
  return { message: 'Coalescing delay saved.' };
}

// ============================================================
// Default Notification Preferences (§16.26)
// ============================================================

export async function updateDefaultNotificationPreferences(formData: FormData): Promise<void> {
  const { supabase, profile: adminProfile } = await requireAdminRole();

  const prefsRaw = formData.get('preferences') as string;
  if (!prefsRaw) return;

  try {
    const prefs = JSON.parse(prefsRaw);
    await supabase
      .from('app_settings')
      .update({ value: JSON.stringify(prefs) })
      .eq('key', 'default_notification_preferences');

    await logAudit(supabase, adminProfile.id, 'update_default_notification_preferences', 'app_settings', null, {});

    revalidatePath('/admin/user-settings');
  } catch {
    return;
  }
}

// ============================================================
// Survey UI Config JSON Storage
// ============================================================

const SURVEY_UI_SETTING_KEYS = [
  'survey_agent_dashboard_config',
  'survey_ticket_detail_agent_config',
  'survey_ticket_detail_user_config',
] as const;

type SurveyUiSettingKey = (typeof SURVEY_UI_SETTING_KEYS)[number];

function isSurveyUiSettingKey(value: string): value is SurveyUiSettingKey {
  return SURVEY_UI_SETTING_KEYS.includes(value as SurveyUiSettingKey);
}

function setDeepValue(target: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split('.');
  let cursor: Record<string, unknown> = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    if (typeof cursor[key] !== 'object' || cursor[key] === null || Array.isArray(cursor[key])) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]] = value;
}

function normalizeSurveyUiPayload(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

  const payload = raw as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(payload)) {
    if (key.includes('.')) {
      setDeepValue(normalized, key, value);
    } else {
      normalized[key] = value;
    }
  }

  const tierControlRules = normalized.tierControlRules;
  if (tierControlRules && typeof tierControlRules === 'object' && !Array.isArray(tierControlRules)) {
    const rules = tierControlRules as Record<string, unknown>;
    for (const [key, value] of Object.entries(rules)) {
      if (typeof value === 'string') {
        rules[key] = value
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean);
      }
    }
  }

  return normalized;
}

function getSurveyUiDefaultValue(settingKey: SurveyUiSettingKey): Record<string, unknown> {
  if (settingKey === 'survey_agent_dashboard_config') return DEFAULT_AGENT_DASHBOARD_SURVEY_CONFIG;
  if (settingKey === 'survey_ticket_detail_agent_config') return DEFAULT_TICKET_DETAIL_AGENT_CONFIG;
  return DEFAULT_TICKET_DETAIL_USER_CONFIG;
}

export async function updateSurveyUiConfig(formData: FormData): Promise<void> {
  const { supabase, profile: adminProfile } = await requireAdminRole();

  const settingKey = (formData.get('setting_key') as string) ?? '';
  const configJson = (formData.get('config_json') as string) ?? '';
  if (!isSurveyUiSettingKey(settingKey) || !configJson) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(configJson);
  } catch {
    return;
  }

  const normalized = normalizeSurveyUiPayload(parsed);

  await supabase
    .from('app_settings')
    .update({ value: JSON.stringify(normalized) })
    .eq('key', settingKey);

  await logAudit(supabase, adminProfile.id, 'update_survey_ui_config', 'app_settings', settingKey, {
    setting_key: settingKey,
  });

  revalidatePath('/admin/survey-ui');
  revalidatePath('/agent');
}

export async function resetSurveyUiConfig(formData: FormData): Promise<void> {
  const { supabase, profile: adminProfile } = await requireAdminRole();
  const settingKey = (formData.get('setting_key') as string) ?? '';
  if (!isSurveyUiSettingKey(settingKey)) return;

  const defaultValue = getSurveyUiDefaultValue(settingKey);

  await supabase
    .from('app_settings')
    .update({ value: JSON.stringify(defaultValue) })
    .eq('key', settingKey);

  await logAudit(supabase, adminProfile.id, 'reset_survey_ui_config', 'app_settings', settingKey, {
    setting_key: settingKey,
  });

  revalidatePath('/admin/survey-ui');
  revalidatePath('/agent');
}

// ============================================================
// SLA Configuration (§16.15)
// ============================================================

export async function createSlaPolicy(formData: FormData): Promise<void> {
  const { supabase, profile: adminProfile } = await requireAdminRole();

  const name = (formData.get('name') as string)?.trim();
  const firstResponseMinutes = parseInt(formData.get('first_response_minutes') as string, 10);
  const resolutionMinutes = parseInt(formData.get('resolution_minutes') as string, 10);

  if (!name || name.length > 100) return;
  if (isNaN(firstResponseMinutes) || firstResponseMinutes < 1) return;
  if (isNaN(resolutionMinutes) || resolutionMinutes < 1) return;

  const { data: created, error } = await supabase
    .from('sla_policies')
    .insert({ name, first_response_minutes: firstResponseMinutes, resolution_minutes: resolutionMinutes })
    .select('id')
    .single();

  if (error) return;

  await logAudit(supabase, adminProfile.id, 'create_sla_policy', 'sla_policy', created?.id, {
    name, first_response_minutes: firstResponseMinutes, resolution_minutes: resolutionMinutes,
  });

  revalidatePath('/admin/sla');
}

export async function updateSlaPolicy(formData: FormData): Promise<void> {
  const { supabase, profile: adminProfile } = await requireAdminRole();

  const policyId = formData.get('policy_id') as string;
  const name = (formData.get('name') as string)?.trim();
  const firstResponseMinutes = parseInt(formData.get('first_response_minutes') as string, 10);
  const resolutionMinutes = parseInt(formData.get('resolution_minutes') as string, 10);

  if (!policyId || !name || name.length > 100) return;
  if (isNaN(firstResponseMinutes) || firstResponseMinutes < 1) return;
  if (isNaN(resolutionMinutes) || resolutionMinutes < 1) return;

  const { error } = await supabase
    .from('sla_policies')
    .update({ name, first_response_minutes: firstResponseMinutes, resolution_minutes: resolutionMinutes, updated_at: new Date().toISOString() })
    .eq('id', policyId);

  if (error) return;

  await logAudit(supabase, adminProfile.id, 'update_sla_policy', 'sla_policy', policyId, {
    name, first_response_minutes: firstResponseMinutes, resolution_minutes: resolutionMinutes,
  });

  revalidatePath('/admin/sla');
}

export async function deleteSlaPolicy(formData: FormData): Promise<void> {
  const { supabase, profile: adminProfile } = await requireAdminRole();

  const policyId = formData.get('policy_id') as string;
  if (!policyId) return;

  const { data: existing } = await supabase.from('sla_policies').select('name').eq('id', policyId).single();

  const { error } = await supabase
    .from('sla_policies')
    .delete()
    .eq('id', policyId);

  if (error) return;

  await logAudit(supabase, adminProfile.id, 'delete_sla_policy', 'sla_policy', policyId, { name: existing?.name });

  revalidatePath('/admin/sla');
}

export async function updateSlaSeverityMapping(formData: FormData): Promise<void> {
  const { supabase, profile: adminProfile } = await requireAdminRole();

  const severities = ['low', 'medium', 'high', 'critical'];
  const mappings: Record<string, string | null> = {};

  for (const sev of severities) {
    const val = formData.get(`mapping_${sev}`) as string;
    mappings[sev] = val || null;
  }

  for (const [severity, policyId] of Object.entries(mappings)) {
    await supabase
      .from('sla_severity_mapping')
      .update({ sla_policy_id: policyId })
      .eq('severity', severity);
  }

  await logAudit(supabase, adminProfile.id, 'update_sla_severity_mapping', 'sla_severity_mapping', null, mappings);

  revalidatePath('/admin/sla');
}

export async function updateBusinessHours(formData: FormData): Promise<void> {
  const { supabase, profile: adminProfile } = await requireAdminRole();

  const timezone = (formData.get('timezone') as string)?.trim() || 'UTC';
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

  const schedule: Record<string, { start: string; end: string } | null> = {};

  for (const day of days) {
    const enabled = formData.get(`${day}_enabled`) === 'on';
    if (enabled) {
      const start = (formData.get(`${day}_start`) as string) || '09:00';
      const end = (formData.get(`${day}_end`) as string) || '17:00';
      schedule[day] = { start, end };
    } else {
      schedule[day] = null;
    }
  }

  const config = { timezone, schedule };

  await supabase
    .from('app_settings')
    .update({ value: JSON.stringify(config) })
    .eq('key', 'sla_business_hours');

  await logAudit(supabase, adminProfile.id, 'update_business_hours', 'app_settings', null, config);

  revalidatePath('/admin/sla');
}

export async function updateSlaThreshold(formData: FormData): Promise<void> {
  const { supabase, profile: adminProfile } = await requireAdminRole();

  const threshold = parseInt(formData.get('threshold') as string, 10);
  if (isNaN(threshold) || threshold < 50 || threshold > 95) return;

  await supabase
    .from('app_settings')
    .update({ value: String(threshold) })
    .eq('key', 'sla_approaching_threshold');

  await logAudit(supabase, adminProfile.id, 'update_sla_threshold', 'app_settings', null, { threshold });

  revalidatePath('/admin/sla');
}

// ============================================================
// User Management (§22.1–22.4)
// ============================================================

export async function blockUser(formData: FormData): Promise<void> {
  const { supabase, profile: adminProfile } = await requireAdminRole();

  const userId = formData.get('user_id') as string;
  if (!userId) return;

  const serviceClient = createServiceRoleClient();

  const { data: target } = await serviceClient
    .from('profiles')
    .select('id, email, is_blocked')
    .eq('id', userId)
    .single();
  if (!target) return;

  const { error } = await serviceClient
    .from('profiles')
    .update({ is_blocked: true })
    .eq('id', userId);

  if (error) return;

  await logAudit(supabase, adminProfile.id, 'block_user', 'user', userId, { email: target.email });
  revalidatePath('/admin/users');
}

export async function unblockUser(formData: FormData): Promise<void> {
  const { supabase, profile: adminProfile } = await requireAdminRole();

  const userId = formData.get('user_id') as string;
  if (!userId) return;

  const serviceClient = createServiceRoleClient();

  const { data: target } = await serviceClient
    .from('profiles')
    .select('id, email')
    .eq('id', userId)
    .single();
  if (!target) return;

  const { error } = await serviceClient
    .from('profiles')
    .update({ is_blocked: false })
    .eq('id', userId);

  if (error) return;

  await logAudit(supabase, adminProfile.id, 'unblock_user', 'user', userId, { email: target.email });
  revalidatePath('/admin/users');
}

export async function adminDeleteUser(formData: FormData): Promise<void> {
  const { supabase, profile: adminProfile } = await requireAdminRole();

  const userId = formData.get('user_id') as string;
  if (!userId) return;

  const serviceClient = createServiceRoleClient();

  const { data: target } = await serviceClient
    .from('profiles')
    .select('id, email, role, display_name')
    .eq('id', userId)
    .single();
  if (!target) return;

  // Cannot delete agents/admins (must demote first)
  if (target.role === 'agent' || target.role === 'admin') return;

  const idSuffix = userId.slice(0, 8);

  // Anonymize profile
  await serviceClient
    .from('profiles')
    .update({
      display_name: `Deleted User #${idSuffix}`,
      email: `deleted-${userId}@deleted.local`,
    })
    .eq('id', userId);

  // Remove notification preferences
  await serviceClient
    .from('notification_preferences')
    .delete()
    .eq('user_id', userId);

  // Remove team membership
  await serviceClient
    .from('profiles')
    .update({ team_id: null })
    .eq('id', userId);

  // Remove ticket follows
  await serviceClient
    .from('ticket_follows')
    .delete()
    .eq('user_id', userId);

  // Log to audit log
  await logAudit(supabase, adminProfile.id, 'admin_delete_user', 'user', userId, {
    email: target.email,
    display_name: target.display_name,
  });

  // Delete auth user (invalidates their session)
  await serviceClient.auth.admin.deleteUser(userId);

  revalidatePath('/admin/users');
}

// ============================================================
// Inbound Email Settings (§15.1–15.6)
// ============================================================

export async function updateInboundEmailSettings(
  formData: FormData,
): Promise<{ message?: string }> {
  const { supabase, profile: adminProfile } = await requireAdminRole();

  const enabled = formData.get('inbound_email_enabled') === 'on';
  const replyToAddress = (formData.get('reply_to_address') as string)?.trim() ?? '';

  // Validate reply-to address when inbound is enabled
  if (enabled && replyToAddress) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(replyToAddress)) {
      return { message: 'Error: Reply-to address must be a valid email.' };
    }
  }

  if (enabled && !replyToAddress) {
    return { message: 'Error: Reply-to address is required when inbound email is enabled.' };
  }

  const settings: Record<string, string> = {
    inbound_email_enabled: enabled ? 'true' : 'false',
    inbound_email_reply_to_address: replyToAddress,
  };

  const failedKeys: string[] = [];
  for (const [key, value] of Object.entries(settings)) {
    const { error: updateError } = await supabase
      .from('app_settings')
      .update({ value })
      .eq('key', key);
    if (updateError) {
      failedKeys.push(key);
    }
  }

  if (failedKeys.length > 0) {
    return { message: `Error: Failed to save settings (${failedKeys.join(', ')}).` };
  }

  await logAudit(supabase, adminProfile.id, 'update_inbound_email_settings', 'app_settings', null, settings);

  revalidatePath('/admin/inbound-email');
  return { message: 'Inbound email settings saved.' };
}
