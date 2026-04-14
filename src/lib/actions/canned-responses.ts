'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';

export type CannedResponseActionState = {
  error?: string;
  fieldErrors?: Record<string, string>;
};

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
  return { supabase, user, profile };
}

export async function createCannedResponse(
  _prev: CannedResponseActionState,
  formData: FormData,
): Promise<CannedResponseActionState> {
  const { supabase, user } = await requireAgentRole();

  const title = (formData.get('title') as string)?.trim() ?? '';
  const body = (formData.get('body') as string) ?? '';
  const visibility = (formData.get('visibility') as string) ?? 'private';

  const fieldErrors: Record<string, string> = {};
  if (!title) fieldErrors.title = 'Title is required.';
  else if (title.length > 200) fieldErrors.title = 'Title must be 200 characters or less.';
  if (!body) fieldErrors.body = 'Body is required.';
  else if (body.length > 50000) fieldErrors.body = 'Body must be 50,000 characters or less.';
  if (!['public', 'private'].includes(visibility)) fieldErrors.visibility = 'Invalid visibility.';

  if (Object.keys(fieldErrors).length > 0) return { fieldErrors };

  const { error } = await supabase
    .from('canned_responses')
    .insert({
      title,
      body,
      visibility,
      author_id: user.id,
    });

  if (error) return { error: 'Failed to create canned response.' };

  revalidatePath('/canned-responses');
  return {};
}

export async function updateCannedResponse(
  _prev: CannedResponseActionState,
  formData: FormData,
): Promise<CannedResponseActionState> {
  const { supabase, user, profile } = await requireAgentRole();

  const responseId = formData.get('response_id') as string;
  const title = (formData.get('title') as string)?.trim() ?? '';
  const body = (formData.get('body') as string) ?? '';
  const visibility = (formData.get('visibility') as string) ?? 'private';

  if (!responseId) return { error: 'Response ID is required.' };

  const fieldErrors: Record<string, string> = {};
  if (!title) fieldErrors.title = 'Title is required.';
  else if (title.length > 200) fieldErrors.title = 'Title must be 200 characters or less.';
  if (!body) fieldErrors.body = 'Body is required.';
  else if (body.length > 50000) fieldErrors.body = 'Body must be 50,000 characters or less.';
  if (!['public', 'private'].includes(visibility)) fieldErrors.visibility = 'Invalid visibility.';

  if (Object.keys(fieldErrors).length > 0) return { fieldErrors };

  // Verify permission: own response or admin for public
  const { data: existing } = await supabase
    .from('canned_responses')
    .select('id, author_id, visibility')
    .eq('id', responseId)
    .single();

  if (!existing) return { error: 'Canned response not found.' };

  const isAdmin = profile.role === 'admin';
  const isOwner = existing.author_id === user.id;
  if (!isOwner && !(isAdmin && existing.visibility === 'public')) {
    return { error: 'You do not have permission to edit this response.' };
  }

  const { error } = await supabase
    .from('canned_responses')
    .update({ title, body, visibility, updated_at: new Date().toISOString() })
    .eq('id', responseId);

  if (error) return { error: 'Failed to update canned response.' };

  revalidatePath('/canned-responses');
  return {};
}

export async function deleteCannedResponse(formData: FormData): Promise<void> {
  const { supabase, user, profile } = await requireAgentRole();

  const responseId = formData.get('response_id') as string;
  if (!responseId) return;

  // Verify permission
  const { data: existing } = await supabase
    .from('canned_responses')
    .select('id, author_id, visibility')
    .eq('id', responseId)
    .single();

  if (!existing) return;

  const isAdmin = profile.role === 'admin';
  const isOwner = existing.author_id === user.id;
  if (!isOwner && !(isAdmin && existing.visibility === 'public')) return;

  await supabase
    .from('canned_responses')
    .delete()
    .eq('id', responseId);

  revalidatePath('/canned-responses');
}

export async function searchCannedResponses(query?: string) {
  const { supabase } = await requireAgentRole();

  let q = supabase
    .from('canned_responses')
    .select('id, title, body, visibility, author_id, created_at, updated_at, author:profiles!canned_responses_author_id_fkey(display_name)')
    .order('updated_at', { ascending: false });

  if (query && query.trim()) {
    const term = `%${query.trim()}%`;
    q = q.or(`title.ilike.${term},body.ilike.${term}`);
  }

  const { data } = await q.limit(50);

  return (data ?? []).map((r) => ({
    ...r,
    author: Array.isArray(r.author) ? r.author[0] : r.author,
  }));
}
