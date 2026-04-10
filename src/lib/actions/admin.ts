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
  const { supabase, profile } = await requireAdminRole();

  const name = (formData.get('name') as string)?.trim();
  if (!name || name.length > 100) return;

  const { data: created, error } = await supabase
    .from('ticket_types')
    .insert({ name })
    .select('id')
    .single();

  if (error) return;

  await logAudit(supabase, profile.id, 'create_ticket_type', 'ticket_type', created?.id, { name });
  revalidatePath('/admin/types');
}

export async function renameTicketType(formData: FormData): Promise<void> {
  const { supabase, profile } = await requireAdminRole();

  const typeId = formData.get('type_id') as string;
  const newName = (formData.get('name') as string)?.trim();
  if (!typeId || !newName || newName.length > 100) return;

  const { error } = await supabase
    .from('ticket_types')
    .update({ name: newName })
    .eq('id', typeId);

  if (error) return;

  await logAudit(supabase, profile.id, 'rename_ticket_type', 'ticket_type', typeId, { name: newName });
  revalidatePath('/admin/types');
}

export async function deleteTicketType(formData: FormData): Promise<void> {
  const { supabase, profile } = await requireAdminRole();

  const typeId = formData.get('type_id') as string;
  if (!typeId) return;

  const { data: existing } = await supabase.from('ticket_types').select('name').eq('id', typeId).single();

  const { error } = await supabase
    .from('ticket_types')
    .delete()
    .eq('id', typeId);

  if (error) return;

  await logAudit(supabase, profile.id, 'delete_ticket_type', 'ticket_type', typeId, { name: existing?.name });
  revalidatePath('/admin/types');
}

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
// Categories
// ============================================================

export async function createCategory(formData: FormData): Promise<void> {
  const { supabase, profile } = await requireAdminRole();

  const name = (formData.get('name') as string)?.trim();
  if (!name || name.length > 100) return;

  const { data: created, error } = await supabase
    .from('categories')
    .insert({ name })
    .select('id')
    .single();

  if (error) return;

  await logAudit(supabase, profile.id, 'create_category', 'category', created?.id, { name });
  revalidatePath('/admin/categories');
}

export async function renameCategory(formData: FormData): Promise<void> {
  const { supabase, profile } = await requireAdminRole();

  const categoryId = formData.get('category_id') as string;
  const newName = (formData.get('name') as string)?.trim();
  if (!categoryId || !newName || newName.length > 100) return;

  const { error } = await supabase
    .from('categories')
    .update({ name: newName })
    .eq('id', categoryId);

  if (error) return;

  await logAudit(supabase, profile.id, 'rename_category', 'category', categoryId, { name: newName });
  revalidatePath('/admin/categories');
}

export async function deleteCategory(formData: FormData): Promise<void> {
  const { supabase, profile } = await requireAdminRole();

  const categoryId = formData.get('category_id') as string;
  if (!categoryId) return;

  const { data: existing } = await supabase.from('categories').select('name').eq('id', categoryId).single();

  const { error } = await supabase
    .from('categories')
    .delete()
    .eq('id', categoryId);

  if (error) return;

  await logAudit(supabase, profile.id, 'delete_category', 'category', categoryId, { name: existing?.name });
  revalidatePath('/admin/categories');
}

// ============================================================
// Tags
// ============================================================

const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

export async function createTag(formData: FormData): Promise<void> {
  const { supabase, profile } = await requireAdminRole();

  const name = (formData.get('name') as string)?.trim();
  const color = (formData.get('color') as string)?.trim();
  if (!name || name.length > 50) return;
  if (!color || color.length > 20 || !HEX_COLOR_RE.test(color)) return;

  const { data: created, error } = await supabase
    .from('tags')
    .insert({ name, color })
    .select('id')
    .single();

  if (error) return;

  await logAudit(supabase, profile.id, 'create_tag', 'tag', created?.id, { name, color });
  revalidatePath('/admin/tags');
}

export async function renameTag(formData: FormData): Promise<void> {
  const { supabase, profile } = await requireAdminRole();

  const tagId = formData.get('tag_id') as string;
  const newName = (formData.get('name') as string)?.trim();
  if (!tagId || !newName || newName.length > 50) return;

  const { error } = await supabase
    .from('tags')
    .update({ name: newName })
    .eq('id', tagId);

  if (error) return;

  await logAudit(supabase, profile.id, 'rename_tag', 'tag', tagId, { name: newName });
  revalidatePath('/admin/tags');
}

export async function updateTagColor(formData: FormData): Promise<void> {
  const { supabase, profile } = await requireAdminRole();

  const tagId = formData.get('tag_id') as string;
  const newColor = (formData.get('color') as string)?.trim();
  if (!tagId || !newColor || newColor.length > 20 || !HEX_COLOR_RE.test(newColor)) return;

  const { error } = await supabase
    .from('tags')
    .update({ color: newColor })
    .eq('id', tagId);

  if (error) return;

  await logAudit(supabase, profile.id, 'update_tag_color', 'tag', tagId, { color: newColor });
  revalidatePath('/admin/tags');
}

export async function deleteTag(formData: FormData): Promise<void> {
  const { supabase, profile } = await requireAdminRole();

  const tagId = formData.get('tag_id') as string;
  if (!tagId) return;

  const { data: existing } = await supabase.from('tags').select('name').eq('id', tagId).single();

  const { error } = await supabase
    .from('tags')
    .delete()
    .eq('id', tagId);

  if (error) return;

  await logAudit(supabase, profile.id, 'delete_tag', 'tag', tagId, { name: existing?.name });
  revalidatePath('/admin/tags');
}

// ============================================================
// Teams
// ============================================================

export async function createTeam(formData: FormData): Promise<void> {
  const { supabase, profile } = await requireAdminRole();

  const name = (formData.get('name') as string)?.trim();
  if (!name || name.length > 100) return;

  const { data: created, error } = await supabase
    .from('teams')
    .insert({ name })
    .select('id')
    .single();

  if (error) return;

  await logAudit(supabase, profile.id, 'create_team', 'team', created?.id, { name });
  revalidatePath('/admin/teams');
}

export async function renameTeam(formData: FormData): Promise<void> {
  const { supabase, profile } = await requireAdminRole();

  const teamId = formData.get('team_id') as string;
  const newName = (formData.get('name') as string)?.trim();
  if (!teamId || !newName || newName.length > 100) return;

  const { error } = await supabase
    .from('teams')
    .update({ name: newName })
    .eq('id', teamId);

  if (error) return;

  await logAudit(supabase, profile.id, 'rename_team', 'team', teamId, { name: newName });
  revalidatePath('/admin/teams');
}

export async function deleteTeam(formData: FormData): Promise<void> {
  const { supabase, profile } = await requireAdminRole();

  const teamId = formData.get('team_id') as string;
  if (!teamId) return;

  const { data: existing } = await supabase.from('teams').select('name').eq('id', teamId).single();

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

  await logAudit(supabase, profile.id, 'delete_team', 'team', teamId, { name: existing?.name });
  revalidatePath('/admin/teams');
}

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

async function logAudit(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  adminId: string,
  action: string,
  targetType: string,
  targetId?: string | null,
  details?: Record<string, unknown>,
) {
  await supabase.from('admin_audit_log').insert({
    admin_id: adminId,
    action,
    target_type: targetType,
    target_id: targetId ?? null,
    details: details ?? {},
  });
}

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

export async function createCustomField(formData: FormData): Promise<void> {
  const { supabase, profile: adminProfile } = await requireAdminRole();

  const name = (formData.get('name') as string)?.trim();
  const fieldType = formData.get('field_type') as string;
  const isRequired = formData.get('is_required') === 'on';
  const defaultValue = (formData.get('default_value') as string)?.trim() || null;
  const optionsRaw = (formData.get('options') as string)?.trim();

  if (!name || name.length > 100) return;
  if (!['text', 'number', 'dropdown', 'checkbox', 'date'].includes(fieldType)) return;
  if (isRequired && !defaultValue && fieldType !== 'checkbox') return;
  if (fieldType === 'dropdown' && !optionsRaw) return;

  const options = fieldType === 'dropdown'
    ? optionsRaw!.split('\n').map((o) => o.trim()).filter(Boolean)
    : null;

  if (fieldType === 'dropdown' && options && defaultValue && !options.includes(defaultValue)) return;

  // Get max display_order
  const { data: maxField } = await supabase
    .from('custom_fields')
    .select('display_order')
    .order('display_order', { ascending: false })
    .limit(1)
    .single();

  const nextOrder = (maxField?.display_order ?? -1) + 1;

  const { data: field, error } = await supabase
    .from('custom_fields')
    .insert({
      name,
      field_type: fieldType,
      is_required: isRequired,
      default_value: defaultValue,
      options,
      display_order: nextOrder,
    })
    .select('id')
    .single();

  if (error) return;

  await logAudit(supabase, adminProfile.id, 'create_custom_field', 'custom_field', field?.id, {
    name,
    field_type: fieldType,
  });

  revalidatePath('/admin/custom-fields');
}

export async function updateCustomField(formData: FormData): Promise<void> {
  const { supabase, profile: adminProfile } = await requireAdminRole();

  const fieldId = formData.get('field_id') as string;
  const name = (formData.get('name') as string)?.trim();
  const fieldType = formData.get('field_type') as string;
  const isRequired = formData.get('is_required') === 'on';
  const defaultValue = (formData.get('default_value') as string)?.trim() || null;
  const optionsRaw = (formData.get('options') as string)?.trim();

  if (!fieldId || !name || name.length > 100) return;
  if (!['text', 'number', 'dropdown', 'checkbox', 'date'].includes(fieldType)) return;
  if (isRequired && !defaultValue && fieldType !== 'checkbox') return;
  if (fieldType === 'dropdown' && !optionsRaw) return;

  const options = fieldType === 'dropdown'
    ? optionsRaw!.split('\n').map((o) => o.trim()).filter(Boolean)
    : null;

  if (fieldType === 'dropdown' && options && defaultValue && !options.includes(defaultValue)) return;

  // Get old field for rename tracking
  const { data: oldField } = await supabase
    .from('custom_fields')
    .select('name')
    .eq('id', fieldId)
    .single();

  const { error } = await supabase
    .from('custom_fields')
    .update({
      name,
      field_type: fieldType,
      is_required: isRequired,
      default_value: defaultValue,
      options,
    })
    .eq('id', fieldId);

  if (error) return;

  // If name changed, update all tickets' custom_fields JSONB keys
  if (oldField && oldField.name !== name) {
    const serviceClient = createServiceRoleClient();
    const { data: tickets } = await serviceClient
      .from('tickets')
      .select('id, custom_fields')
      .not('custom_fields', 'is', null);

    if (tickets) {
      for (const ticket of tickets) {
        const cf = ticket.custom_fields as Record<string, unknown>;
        if (cf && oldField.name in cf) {
          const newCf = { ...cf };
          newCf[name] = newCf[oldField.name];
          delete newCf[oldField.name];
          await serviceClient
            .from('tickets')
            .update({ custom_fields: newCf })
            .eq('id', ticket.id);
        }
      }
    }
  }

  await logAudit(supabase, adminProfile.id, 'update_custom_field', 'custom_field', fieldId, {
    name,
    field_type: fieldType,
  });

  revalidatePath('/admin/custom-fields');
}

export async function deleteCustomField(formData: FormData): Promise<void> {
  const { supabase, profile: adminProfile } = await requireAdminRole();

  const fieldId = formData.get('field_id') as string;
  if (!fieldId) return;

  const { data: field } = await supabase
    .from('custom_fields')
    .select('name')
    .eq('id', fieldId)
    .single();
  if (!field) return;

  // Remove field key from all tickets' custom_fields JSONB
  const serviceClient = createServiceRoleClient();
  const { data: tickets } = await serviceClient
    .from('tickets')
    .select('id, custom_fields')
    .not('custom_fields', 'is', null);

  if (tickets) {
    for (const ticket of tickets) {
      const cf = ticket.custom_fields as Record<string, unknown>;
      if (cf && field.name in cf) {
        const newCf = { ...cf };
        delete newCf[field.name];
        await serviceClient
          .from('tickets')
          .update({ custom_fields: newCf })
          .eq('id', ticket.id);
      }
    }
  }

  const { error } = await supabase
    .from('custom_fields')
    .delete()
    .eq('id', fieldId);
  if (error) return;

  await logAudit(supabase, adminProfile.id, 'delete_custom_field', 'custom_field', fieldId, {
    name: field.name,
  });

  revalidatePath('/admin/custom-fields');
}

export async function reorderCustomField(formData: FormData): Promise<void> {
  const { supabase } = await requireAdminRole();

  const fieldId = formData.get('field_id') as string;
  const direction = formData.get('direction') as string;
  if (!fieldId || !['up', 'down'].includes(direction)) return;

  const { data: fields } = await supabase
    .from('custom_fields')
    .select('id, display_order')
    .order('display_order');

  if (!fields) return;

  const idx = fields.findIndex((f) => f.id === fieldId);
  if (idx === -1) return;

  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= fields.length) return;

  const currentOrder = fields[idx].display_order;
  const swapOrder = fields[swapIdx].display_order;

  await supabase
    .from('custom_fields')
    .update({ display_order: swapOrder })
    .eq('id', fields[idx].id);

  await supabase
    .from('custom_fields')
    .update({ display_order: currentOrder })
    .eq('id', fields[swapIdx].id);

  revalidatePath('/admin/custom-fields');
}

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

  // Parse allowed types
  const allowedTypes = allowedTypesRaw
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

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
