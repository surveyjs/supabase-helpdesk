'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { notifyTicketRecipients, notifyAgent } from '@/lib/email/notify';
import { scheduleCsatSurvey, cancelCsatSurvey } from '@/lib/actions/csat';
import { pauseSlaTimer, resumeSlaTimer, stopResolutionTimer, recalculateSlaTargets } from '@/lib/utils/sla';

const VALID_PRIORITIES = ['low', 'medium', 'high', 'critical'];

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

export async function changeTicketStatus(formData: FormData): Promise<void> {
  const { supabase, user } = await requireAgentRole();

  const ticketId = Number(formData.get('ticket_id'));
  const newStatus = formData.get('new_status') as string;

  if (!['open', 'pending', 'closed'].includes(newStatus)) return;

  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, status, merged_into_id, slug, duplicate_of_id')
    .eq('id', ticketId)
    .single();

  if (!ticket || ticket.merged_into_id) return;

  const { error } = await supabase
    .from('tickets')
    .update({ status: newStatus })
    .eq('id', ticketId);

  if (error) return;

  await supabase.from('activity_log').insert({
    ticket_id: ticketId,
    actor_id: user.id,
    action: 'status_changed',
    details: { from: ticket.status, to: newStatus },
  });

  // Notify owner + followers (skip if duplicate closure)
  if (!ticket.duplicate_of_id) {
    notifyTicketRecipients(
      ticketId,
      'status_changed',
      { oldStatus: ticket.status, newStatus },
      user.id,
      user.id,
    ).catch((err) => console.error('[notify]', err));
  }

  revalidatePath(`/tickets/${ticketId}/${ticket.slug}`);
  revalidatePath('/agent');

  // CSAT: schedule survey on close, cancel on re-open
  if (newStatus === 'closed') {
    scheduleCsatSurvey(ticketId).catch((err) => console.error('[csat]', err));
    stopResolutionTimer(ticketId).catch((err) => console.error('[sla]', err));
  } else if (ticket.status === 'closed' && newStatus === 'open') {
    cancelCsatSurvey(ticketId).catch((err) => console.error('[csat]', err));
    resumeSlaTimer(ticketId).catch((err) => console.error('[sla]', err));
  }

  // SLA: pause on pending, resume on open from pending
  if (newStatus === 'pending') {
    pauseSlaTimer(ticketId).catch((err) => console.error('[sla]', err));
  } else if (ticket.status === 'pending' && newStatus === 'open') {
    resumeSlaTimer(ticketId).catch((err) => console.error('[sla]', err));
  }
}

export async function assignAgent(formData: FormData): Promise<void> {
  const { supabase, user } = await requireAgentRole();

  const ticketId = Number(formData.get('ticket_id'));
  const agentId = formData.get('agent_id') as string;

  // Validate that the target user actually has an agent or admin role
  const { data: targetProfile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', agentId)
    .single();
  if (!targetProfile || !['agent', 'admin'].includes(targetProfile.role)) return;

  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, slug')
    .eq('id', ticketId)
    .single();

  if (!ticket) return;

  const { error } = await supabase
    .from('tickets')
    .update({ assigned_agent_id: agentId })
    .eq('id', ticketId);

  if (error) return;

  await supabase.from('activity_log').insert({
    ticket_id: ticketId,
    actor_id: user.id,
    action: 'agent_assigned',
    details: { agent_id: agentId },
  });

  // Get agent name for notifications
  const { data: assignedAgent } = await supabase
    .from('profiles')
    .select('display_name, email')
    .eq('id', agentId)
    .single();
  const agentName = assignedAgent?.display_name ?? assignedAgent?.email ?? '';

  // Notify owner + followers
  notifyTicketRecipients(
    ticketId,
    'agent_assigned',
    { agentName },
    user.id,
    user.id,
  ).catch((err) => console.error('[notify]', err));

  // Notify the assigned agent (if not the actor)
  if (agentId !== user.id) {
    notifyAgent(agentId, 'agent_assigned_to_agent', ticketId, { agentName }).catch((err) => console.error('[notify]', err));
  }

  revalidatePath(`/tickets/${ticketId}/${ticket.slug}`);
  revalidatePath('/agent');
}

export async function reassignAgent(formData: FormData): Promise<void> {
  const { supabase, user } = await requireAgentRole();

  const ticketId = Number(formData.get('ticket_id'));
  const newAgentId = formData.get('agent_id') as string;
  const reason = (formData.get('reason') as string)?.trim() || null;

  // Validate that the target user actually has an agent or admin role
  const { data: targetProfile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', newAgentId)
    .single();
  if (!targetProfile || !['agent', 'admin'].includes(targetProfile.role)) return;

  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, slug, assigned_agent_id')
    .eq('id', ticketId)
    .single();

  if (!ticket || !ticket.assigned_agent_id) return;

  const { error } = await supabase
    .from('tickets')
    .update({ assigned_agent_id: newAgentId })
    .eq('id', ticketId);

  if (error) return;

  if (reason) {
    await supabase.from('posts').insert({
      ticket_id: ticketId,
      author_id: user.id,
      body: reason,
      post_type: 'note',
    });
  }

  await supabase.from('activity_log').insert({
    ticket_id: ticketId,
    actor_id: user.id,
    action: 'agent_reassigned',
    details: {
      from_agent_id: ticket.assigned_agent_id,
      to_agent_id: newAgentId,
      ...(reason ? { reason } : {}),
    },
  });

  // Get new agent name
  const { data: newAgent } = await supabase
    .from('profiles')
    .select('display_name, email')
    .eq('id', newAgentId)
    .single();
  const agentName = newAgent?.display_name ?? newAgent?.email ?? '';

  // Notify owner + followers
  notifyTicketRecipients(
    ticketId,
    'agent_assigned',
    { agentName },
    user.id,
    user.id,
  ).catch((err) => console.error('[notify]', err));

  // Notify the new agent (if not the actor)
  if (newAgentId !== user.id) {
    notifyAgent(newAgentId, 'agent_assigned_to_agent', ticketId, {
      agentName,
      ...(reason ? { reason } : {}),
    }).catch((err) => console.error('[notify]', err));
  }

  revalidatePath(`/tickets/${ticketId}/${ticket.slug}`);
  revalidatePath('/agent');
}

export async function unassignAgent(formData: FormData): Promise<void> {
  const { supabase, user } = await requireAgentRole();

  const ticketId = Number(formData.get('ticket_id'));

  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, slug, assigned_agent_id')
    .eq('id', ticketId)
    .single();

  if (!ticket) return;

  const { error } = await supabase
    .from('tickets')
    .update({ assigned_agent_id: null })
    .eq('id', ticketId);

  if (error) return;

  await supabase.from('activity_log').insert({
    ticket_id: ticketId,
    actor_id: user.id,
    action: 'agent_unassigned',
    details: { previous_agent_id: ticket.assigned_agent_id },
  });

  // Notify owner + followers
  notifyTicketRecipients(
    ticketId,
    'agent_assigned',
    { agentName: 'Unassigned' },
    user.id,
    user.id,
  ).catch((err) => console.error('[notify]', err));

  revalidatePath(`/tickets/${ticketId}/${ticket.slug}`);
  revalidatePath('/agent');
}

export async function assignToMe(formData: FormData): Promise<void> {
  const { supabase, user } = await requireAgentRole();

  const ticketId = Number(formData.get('ticket_id'));

  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, slug')
    .eq('id', ticketId)
    .single();

  if (!ticket) return;

  const { error } = await supabase
    .from('tickets')
    .update({ assigned_agent_id: user.id })
    .eq('id', ticketId);

  if (error) return;

  await supabase.from('activity_log').insert({
    ticket_id: ticketId,
    actor_id: user.id,
    action: 'agent_assigned',
    details: { agent_id: user.id },
  });

  revalidatePath(`/tickets/${ticketId}/${ticket.slug}`);
  revalidatePath('/agent');
}

export async function changeUrgency(formData: FormData): Promise<void> {
  const { supabase, user } = await requireAgentRole();

  const ticketId = Number(formData.get('ticket_id'));
  const newUrgency = formData.get('new_urgency') as string;

  if (!VALID_PRIORITIES.includes(newUrgency)) return;

  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, slug, urgency')
    .eq('id', ticketId)
    .single();

  if (!ticket) return;

  const { error } = await supabase
    .from('tickets')
    .update({ urgency: newUrgency })
    .eq('id', ticketId);

  if (error) return;

  await supabase.from('activity_log').insert({
    ticket_id: ticketId,
    actor_id: user.id,
    action: 'urgency_changed',
    details: { from: ticket.urgency, to: newUrgency },
  });

  notifyTicketRecipients(
    ticketId,
    'urgency_changed',
    { oldUrgency: ticket.urgency, newUrgency },
    user.id,
    user.id,
  ).catch((err) => console.error('[notify]', err));

  revalidatePath(`/tickets/${ticketId}/${ticket.slug}`);
  revalidatePath('/agent');
}

export async function changeSeverity(formData: FormData): Promise<void> {
  const { supabase, user } = await requireAgentRole();

  const ticketId = Number(formData.get('ticket_id'));
  const newSeverity = formData.get('new_severity') as string;

  if (!VALID_PRIORITIES.includes(newSeverity)) return;

  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, slug, severity')
    .eq('id', ticketId)
    .single();

  if (!ticket) return;

  const { error } = await supabase
    .from('tickets')
    .update({ severity: newSeverity })
    .eq('id', ticketId);

  if (error) return;

  await supabase.from('activity_log').insert({
    ticket_id: ticketId,
    actor_id: user.id,
    action: 'severity_changed',
    details: { from: ticket.severity, to: newSeverity },
  });

  notifyTicketRecipients(
    ticketId,
    'severity_changed',
    { oldSeverity: ticket.severity, newSeverity },
    user.id,
    user.id,
  ).catch((err) => console.error('[notify]', err));

  // Recalculate SLA targets for new severity
  recalculateSlaTargets(ticketId, newSeverity).catch((err) => console.error('[sla]', err));

  revalidatePath(`/tickets/${ticketId}/${ticket.slug}`);
  revalidatePath('/agent');
}

export async function changeType(formData: FormData): Promise<void> {
  const { supabase, user } = await requireAgentRole();

  const ticketId = Number(formData.get('ticket_id'));
  const newTypeId = formData.get('new_type_id') as string;

  const { data: typeExists } = await supabase
    .from('ticket_types')
    .select('id')
    .eq('id', newTypeId)
    .single();

  if (!typeExists) return;

  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, slug, type_id')
    .eq('id', ticketId)
    .single();

  if (!ticket) return;

  const { error } = await supabase
    .from('tickets')
    .update({ type_id: newTypeId })
    .eq('id', ticketId);

  if (error) return;

  await supabase.from('activity_log').insert({
    ticket_id: ticketId,
    actor_id: user.id,
    action: 'type_changed',
    details: { from: ticket.type_id, to: newTypeId },
  });

  revalidatePath(`/tickets/${ticketId}/${ticket.slug}`);
  revalidatePath('/agent');
}

export async function changeCategory(formData: FormData): Promise<void> {
  const { supabase, user } = await requireAgentRole();

  const ticketId = Number(formData.get('ticket_id'));
  const newCategoryId = (formData.get('new_category_id') as string) || null;

  if (newCategoryId) {
    const { data: catExists } = await supabase
      .from('categories')
      .select('id')
      .eq('id', newCategoryId)
      .single();
    if (!catExists) return;
  }

  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, slug, category_id')
    .eq('id', ticketId)
    .single();

  if (!ticket) return;

  const { error } = await supabase
    .from('tickets')
    .update({ category_id: newCategoryId })
    .eq('id', ticketId);

  if (error) return;

  await supabase.from('activity_log').insert({
    ticket_id: ticketId,
    actor_id: user.id,
    action: 'category_changed',
    details: { from: ticket.category_id, to: newCategoryId },
  });

  revalidatePath(`/tickets/${ticketId}/${ticket.slug}`);
  revalidatePath('/agent');
}

export async function toggleTicketPrivacy(formData: FormData): Promise<void> {
  const { supabase, user } = await requireAgentRole();

  const ticketId = Number(formData.get('ticket_id'));

  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, slug, is_private')
    .eq('id', ticketId)
    .single();

  if (!ticket) return;

  const newPrivacy = !ticket.is_private;

  const { error } = await supabase
    .from('tickets')
    .update({ is_private: newPrivacy })
    .eq('id', ticketId);

  if (error) return;

  await supabase.from('activity_log').insert({
    ticket_id: ticketId,
    actor_id: user.id,
    action: 'privacy_changed',
    details: { from: ticket.is_private, to: newPrivacy },
  });

  notifyTicketRecipients(
    ticketId,
    'privacy_changed',
    {},
    user.id,
    user.id,
  ).catch((err) => console.error('[notify]', err));

  revalidatePath(`/tickets/${ticketId}/${ticket.slug}`);
  revalidatePath('/agent');
}

// ============================================================
// Tag management on tickets (agent)
// ============================================================

export async function addTagToTicket(formData: FormData): Promise<void> {
  const { supabase, user } = await requireAgentRole();

  const ticketId = Number(formData.get('ticket_id'));
  const tagId = formData.get('tag_id') as string;
  if (!ticketId || !tagId) return;

  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, slug')
    .eq('id', ticketId)
    .single();

  if (!ticket) return;

  const { error } = await supabase
    .from('ticket_tags')
    .insert({ ticket_id: ticketId, tag_id: tagId });

  if (error) return;

  await supabase.from('activity_log').insert({
    ticket_id: ticketId,
    actor_id: user.id,
    action: 'tag_added',
    details: { tag_id: tagId },
  });

  revalidatePath(`/tickets/${ticketId}/${ticket.slug}`);
  revalidatePath('/agent');
}

export async function removeTagFromTicket(formData: FormData): Promise<void> {
  const { supabase, user } = await requireAgentRole();

  const ticketId = Number(formData.get('ticket_id'));
  const tagId = formData.get('tag_id') as string;
  if (!ticketId || !tagId) return;

  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, slug')
    .eq('id', ticketId)
    .single();

  if (!ticket) return;

  const { error } = await supabase
    .from('ticket_tags')
    .delete()
    .eq('ticket_id', ticketId)
    .eq('tag_id', tagId);

  if (error) return;

  await supabase.from('activity_log').insert({
    ticket_id: ticketId,
    actor_id: user.id,
    action: 'tag_removed',
    details: { tag_id: tagId },
  });

  revalidatePath(`/tickets/${ticketId}/${ticket.slug}`);
  revalidatePath('/agent');
}
