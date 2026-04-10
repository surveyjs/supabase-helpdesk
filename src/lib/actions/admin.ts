'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServerClient, createServiceRoleClient } from '@/lib/supabase/server';

async function requireAdminRole() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .single();
  if (!profile || profile.role !== 'admin') {
    throw new Error('Forbidden');
  }
  return { supabase, user, profile };
}

// ============================================================
// Ticket Types
// ============================================================

export async function createTicketType(formData: FormData): Promise<void> {
  const { supabase } = await requireAdminRole();

  const name = (formData.get('name') as string)?.trim();
  if (!name || name.length > 100) return;

  const { error } = await supabase
    .from('ticket_types')
    .insert({ name });

  if (error) return;

  revalidatePath('/admin/types');
}

export async function renameTicketType(formData: FormData): Promise<void> {
  const { supabase } = await requireAdminRole();

  const typeId = formData.get('type_id') as string;
  const newName = (formData.get('name') as string)?.trim();
  if (!typeId || !newName || newName.length > 100) return;

  const { error } = await supabase
    .from('ticket_types')
    .update({ name: newName })
    .eq('id', typeId);

  if (error) return;

  revalidatePath('/admin/types');
}

export async function deleteTicketType(formData: FormData): Promise<void> {
  const { supabase } = await requireAdminRole();

  const typeId = formData.get('type_id') as string;
  if (!typeId) return;

  const { error } = await supabase
    .from('ticket_types')
    .delete()
    .eq('id', typeId);

  if (error) return;

  revalidatePath('/admin/types');
}

export async function setDefaultTicketType(formData: FormData): Promise<void> {
  const { supabase } = await requireAdminRole();

  const typeId = formData.get('type_id') as string;
  if (!typeId) return;

  // Unset current default
  await supabase
    .from('ticket_types')
    .update({ is_default: false })
    .eq('is_default', true);

  // Set new default
  const { error } = await supabase
    .from('ticket_types')
    .update({ is_default: true })
    .eq('id', typeId);

  if (error) return;

  revalidatePath('/admin/types');
}

// ============================================================
// Categories
// ============================================================

export async function createCategory(formData: FormData): Promise<void> {
  const { supabase } = await requireAdminRole();

  const name = (formData.get('name') as string)?.trim();
  if (!name || name.length > 100) return;

  const { error } = await supabase
    .from('categories')
    .insert({ name });

  if (error) return;

  revalidatePath('/admin/categories');
}

export async function renameCategory(formData: FormData): Promise<void> {
  const { supabase } = await requireAdminRole();

  const categoryId = formData.get('category_id') as string;
  const newName = (formData.get('name') as string)?.trim();
  if (!categoryId || !newName || newName.length > 100) return;

  const { error } = await supabase
    .from('categories')
    .update({ name: newName })
    .eq('id', categoryId);

  if (error) return;

  revalidatePath('/admin/categories');
}

export async function deleteCategory(formData: FormData): Promise<void> {
  const { supabase } = await requireAdminRole();

  const categoryId = formData.get('category_id') as string;
  if (!categoryId) return;

  const { error } = await supabase
    .from('categories')
    .delete()
    .eq('id', categoryId);

  if (error) return;

  revalidatePath('/admin/categories');
}

// ============================================================
// Tags
// ============================================================

const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

export async function createTag(formData: FormData): Promise<void> {
  const { supabase } = await requireAdminRole();

  const name = (formData.get('name') as string)?.trim();
  const color = (formData.get('color') as string)?.trim();
  if (!name || name.length > 50) return;
  if (!color || color.length > 20 || !HEX_COLOR_RE.test(color)) return;

  const { error } = await supabase
    .from('tags')
    .insert({ name, color });

  if (error) return;

  revalidatePath('/admin/tags');
}

export async function renameTag(formData: FormData): Promise<void> {
  const { supabase } = await requireAdminRole();

  const tagId = formData.get('tag_id') as string;
  const newName = (formData.get('name') as string)?.trim();
  if (!tagId || !newName || newName.length > 50) return;

  const { error } = await supabase
    .from('tags')
    .update({ name: newName })
    .eq('id', tagId);

  if (error) return;

  revalidatePath('/admin/tags');
}

export async function updateTagColor(formData: FormData): Promise<void> {
  const { supabase } = await requireAdminRole();

  const tagId = formData.get('tag_id') as string;
  const newColor = (formData.get('color') as string)?.trim();
  if (!tagId || !newColor || newColor.length > 20 || !HEX_COLOR_RE.test(newColor)) return;

  const { error } = await supabase
    .from('tags')
    .update({ color: newColor })
    .eq('id', tagId);

  if (error) return;

  revalidatePath('/admin/tags');
}

export async function deleteTag(formData: FormData): Promise<void> {
  const { supabase } = await requireAdminRole();

  const tagId = formData.get('tag_id') as string;
  if (!tagId) return;

  const { error } = await supabase
    .from('tags')
    .delete()
    .eq('id', tagId);

  if (error) return;

  revalidatePath('/admin/tags');
}

// ============================================================
// Teams
// ============================================================

export async function createTeam(formData: FormData): Promise<void> {
  const { supabase } = await requireAdminRole();

  const name = (formData.get('name') as string)?.trim();
  if (!name || name.length > 100) return;

  const { error } = await supabase
    .from('teams')
    .insert({ name });

  if (error) return;

  revalidatePath('/admin/teams');
}

export async function renameTeam(formData: FormData): Promise<void> {
  const { supabase } = await requireAdminRole();

  const teamId = formData.get('team_id') as string;
  const newName = (formData.get('name') as string)?.trim();
  if (!teamId || !newName || newName.length > 100) return;

  const { error } = await supabase
    .from('teams')
    .update({ name: newName })
    .eq('id', teamId);

  if (error) return;

  revalidatePath('/admin/teams');
}

export async function deleteTeam(formData: FormData): Promise<void> {
  const { supabase } = await requireAdminRole();

  const teamId = formData.get('team_id') as string;
  if (!teamId) return;

  // Check for members
  const { count } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('team_id', teamId);

  if (count && count > 0) return;

  const { error } = await supabase
    .from('teams')
    .delete()
    .eq('id', teamId);

  if (error) return;

  revalidatePath('/admin/teams');
}

export async function addTeamMember(formData: FormData): Promise<void> {
  const { supabase } = await requireAdminRole();

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

  revalidatePath('/admin/teams');
}

export async function removeTeamMember(formData: FormData): Promise<void> {
  await requireAdminRole();

  const userId = formData.get('user_id') as string;
  if (!userId) return;

  // Use service role to update another user's profile (RLS only allows self-update)
  const serviceClient = createServiceRoleClient();
  const { error } = await serviceClient
    .from('profiles')
    .update({ team_id: null })
    .eq('id', userId);

  if (error) return;

  revalidatePath('/admin/teams');
}
