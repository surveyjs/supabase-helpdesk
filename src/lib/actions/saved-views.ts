'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import {
  generateSqlFromJson,
  generateSqlFromAi,
  normalizeFilterData,
  type TicketFilterData,
  type TicketFilterType,
} from '@/lib/filters/ticket-filter';

async function requireAgentRole() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .single();
  if (!profile || !['agent', 'admin'].includes(profile.role)) {
    throw new Error('Forbidden');
  }
  return { supabase, user };
}

function parseDefinitionForm(formData: FormData): {
  type: TicketFilterType;
  data: TicketFilterData;
  sql: string;
} {
  const rawType = formData.get('type');
  const type: TicketFilterType = rawType === 'ai' ? 'ai' : 'json';

  let parsed: unknown = {};
  try {
    parsed = JSON.parse((formData.get('data') as string | null) ?? '{}');
  } catch {
    parsed = {};
  }
  const data = normalizeFilterData(parsed);
  const sql = type === 'json' ? generateSqlFromJson(data) : generateSqlFromAi(data);
  return { type, data, sql };
}

/**
 * Create a new saved view.
 *
 * Form fields:
 *   - `name` (required, <= 100 chars)
 *   - `type` ("json" | "ai", default "json")
 *   - `data` (JSON-encoded SurveyJS response)
 */
export async function createSavedView(formData: FormData): Promise<void> {
  const { supabase, user } = await requireAgentRole();

  const name = (formData.get('name') as string)?.trim() ?? '';
  if (!name || name.length > 100) return;

  const { type, data, sql } = parseDefinitionForm(formData);

  await supabase
    .from('saved_views')
    .insert({
      agent_id: user.id,
      name,
      filters: { type, data, sql },
    });

  revalidatePath('/agent');
}

/**
 * Update the JSON / SQL definition of an existing saved view (Apply Filters
 * on a non-Default view persists into the active view).
 */
export async function updateSavedViewDefinition(args: {
  viewId: string;
  type?: TicketFilterType;
  data: unknown;
  prompt?: string;
}): Promise<void> {
  const { supabase, user } = await requireAgentRole();
  if (!args.viewId) return;

  const type: TicketFilterType = args.type === 'ai' ? 'ai' : 'json';
  const data = normalizeFilterData(args.data);
  const sql = type === 'json' ? generateSqlFromJson(data) : generateSqlFromAi(data);
  const filters: Record<string, unknown> = { type, data, sql };
  if (type === 'ai' && args.prompt) filters.prompt = args.prompt;

  await supabase
    .from('saved_views')
    .update({ filters, updated_at: new Date().toISOString() })
    .eq('id', args.viewId)
    .eq('agent_id', user.id);

  revalidatePath('/agent');
}

export async function renameSavedView(formData: FormData): Promise<void> {
  const { supabase, user } = await requireAgentRole();

  const viewId = formData.get('view_id') as string;
  const newName = (formData.get('name') as string)?.trim() ?? '';

  if (!newName || newName.length > 100) return;

  await supabase
    .from('saved_views')
    .update({ name: newName })
    .eq('id', viewId)
    .eq('agent_id', user.id);

  revalidatePath('/agent');
}

export async function deleteSavedView(formData: FormData): Promise<void> {
  const { supabase, user } = await requireAgentRole();

  const viewId = formData.get('view_id') as string;

  await supabase
    .from('saved_views')
    .delete()
    .eq('id', viewId)
    .eq('agent_id', user.id);

  revalidatePath('/agent');
}

/**
 * Persist the agent's currently active dashboard view so navigation away from
 * /agent and back restores the same view instead of reverting to Default.
 * Pass null to reset to the Default view.
 */
export async function setAgentActiveView(viewId: string | null): Promise<void> {
  const { supabase, user } = await requireAgentRole();
  await supabase
    .from('profiles')
    .update({ active_view_id: viewId })
    .eq('id', user.id);
}

/**
 * Server action variant that creates a saved view and returns its id, used by
 * the inline "Add new view" client UI which then redirects to ?view=<id>.
 */
export async function createSavedViewReturnId(args: {
  name: string;
  type?: TicketFilterType;
  data: unknown;
  prompt?: string;
}): Promise<{ id: string | null }> {
  const { supabase, user } = await requireAgentRole();

  const name = (args.name ?? '').trim();
  if (!name || name.length > 100) return { id: null };

  const type: TicketFilterType = args.type === 'ai' ? 'ai' : 'json';
  const data = normalizeFilterData(args.data);
  const sql = type === 'json' ? generateSqlFromJson(data) : generateSqlFromAi(data);
  const filters: Record<string, unknown> = { type, data, sql };
  if (type === 'ai' && args.prompt) filters.prompt = args.prompt;

  const { data: inserted } = await supabase
    .from('saved_views')
    .insert({
      agent_id: user.id,
      name,
      filters,
    })
    .select('id')
    .single();

  revalidatePath('/agent');
  return { id: (inserted?.id as string | undefined) ?? null };
}
