import type { SupabaseClient } from '@supabase/supabase-js';

/** A custom field that applies to users (#103). */
export type UserFieldDef = {
  id: string;
  name: string;
  field_type: 'text' | 'number' | 'dropdown' | 'checkbox' | 'date';
  options: string[] | null;
  agent_only: boolean;
};

export type UserFieldWithValue = UserFieldDef & { value: unknown };

/**
 * The user fields and one person's values, as the reader may see them: RLS
 * hides staff-only values from non-staff, and `staff: false` also drops the
 * staff-only definitions so their names don't show either.
 */
export async function loadUserFields(
  supabase: SupabaseClient,
  userId: string,
  { staff }: { staff: boolean },
): Promise<UserFieldWithValue[]> {
  let defsQuery = supabase
    .from('custom_fields')
    .select('id, name, field_type, options, agent_only')
    .eq('applies_to', 'user')
    .order('display_order');
  if (!staff) defsQuery = defsQuery.eq('agent_only', false);
  const [{ data: defs }, { data: values }] = await Promise.all([
    defsQuery,
    supabase.from('user_field_values').select('field_id, value').eq('user_id', userId),
  ]);
  const byField = new Map((values ?? []).map((v) => [v.field_id as string, v.value as unknown]));
  return (defs ?? []).map((d) => ({
    id: String(d.id),
    name: String(d.name),
    field_type: d.field_type as UserFieldDef['field_type'],
    options: Array.isArray(d.options) ? (d.options as string[]) : null,
    agent_only: !!d.agent_only,
    value: byField.get(String(d.id)) ?? null,
  }));
}

/**
 * Turn a submitted form value into the stored JSON value for a field.
 * `null` means "no value" (the row is removed).
 */
export function parseUserFieldInput(
  def: Pick<UserFieldDef, 'name' | 'field_type' | 'options'>,
  raw: string | null,
): { value: unknown } | { error: string } {
  const text = (raw ?? '').trim();
  switch (def.field_type) {
    case 'checkbox':
      return { value: text === 'on' || text === 'true' ? true : null };
    case 'number': {
      if (!text) return { value: null };
      const n = Number(text);
      return Number.isFinite(n) ? { value: n } : { error: `${def.name}: not a number.` };
    }
    case 'dropdown':
      if (!text) return { value: null };
      return def.options?.includes(text) ? { value: text } : { error: `${def.name}: not one of the options.` };
    case 'date':
      if (!text) return { value: null };
      return /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(text))
        ? { value: text }
        : { error: `${def.name}: not a date.` };
    case 'text':
    default:
      if (!text) return { value: null };
      return text.length > 1000 ? { error: `${def.name}: at most 1,000 characters.` } : { value: text };
  }
}

/** Display text for a stored value. */
export function formatUserFieldValue(def: Pick<UserFieldDef, 'field_type'>, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (def.field_type === 'checkbox') return value === true ? 'Yes' : '—';
  return String(value);
}
