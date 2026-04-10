'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';

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

export async function createSavedView(formData: FormData): Promise<void> {
  const { supabase, user } = await requireAgentRole();

  const name = (formData.get('name') as string)?.trim() ?? '';
  const filtersJson = formData.get('filters') as string;

  if (!name || name.length > 100) return;

  let filters: Record<string, string> = {};
  try {
    filters = JSON.parse(filtersJson || '{}');
  } catch {
    return;
  }

  await supabase
    .from('saved_views')
    .insert({
      agent_id: user.id,
      name,
      filters,
    });

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
