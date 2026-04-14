'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServerClient, createServiceRoleClient } from '@/lib/supabase/server';
import { scheduleCsatSurvey, cancelCsatSurvey } from '@/lib/actions/csat';
import { pauseSlaTimer, resumeSlaTimer, stopResolutionTimer, recalculateSlaTargets } from '@/lib/utils/sla';

async function requireAgentRole() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, display_name')
    .eq('id', user.id)
    .single();
  if (!profile || !['agent', 'admin'].includes(profile.role)) {
    throw new Error('Forbidden');
  }
  return { supabase, user, profile };
}

async function requireAdminRole() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, display_name')
    .eq('id', user.id)
    .single();
  if (!profile || profile.role !== 'admin') {
    throw new Error('Forbidden');
  }
  return { supabase, user, profile };
}

function parseTicketIds(formData: FormData): number[] {
  const raw = formData.get('ticket_ids') as string;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(Number).filter((n) => Number.isFinite(n) && n > 0);
  } catch {
    return [];
  }
}

async function sendBulkNotification(
  ticketIds: number[],
  actionType: string,
  actorName: string,
  actorId: string,
): Promise<void> {
  const svc = createServiceRoleClient();

  // Collect unique recipients across all affected tickets
  const recipientSet = new Set<string>();

  for (const ticketId of ticketIds) {
    // Ticket owner
    const { data: ticket } = await svc
      .from('tickets')
      .select('creator_id')
      .eq('id', ticketId)
      .single();
    if (ticket && ticket.creator_id !== actorId) {
      recipientSet.add(ticket.creator_id);
    }

    // Followers
    const { data: followers } = await svc
      .from('ticket_followers')
      .select('user_id')
      .eq('ticket_id', ticketId);
    if (followers) {
      for (const f of followers) {
        if (f.user_id !== actorId) recipientSet.add(f.user_id);
      }
    }
  }

  const ticketList = ticketIds.map((id) => `#${id}`).join(', ');
  const message = `${actorName} performed bulk action: ${actionType} on ${ticketIds.length} ticket(s). Affected: ${ticketList}`;

  // One in-app notification per recipient
  for (const recipientId of recipientSet) {
    await svc.from('notifications').insert({
      recipient_id: recipientId,
      event_type: 'bulk_action_summary',
      ticket_id: ticketIds[0],
      message,
    });
  }
}

export async function bulkChangeStatus(formData: FormData): Promise<void> {
  const { supabase, user, profile } = await requireAgentRole();

  const ticketIds = parseTicketIds(formData);
  const newStatus = formData.get('new_status') as string;

  if (ticketIds.length === 0) return;
  if (!['open', 'pending', 'closed'].includes(newStatus)) return;

  const processed: number[] = [];

  for (const ticketId of ticketIds) {
    const { data: ticket } = await supabase
      .from('tickets')
      .select('id, status, slug, merged_into_id, duplicate_of_id')
      .eq('id', ticketId)
      .single();

    if (!ticket) continue;
    if (ticket.status === newStatus) continue;
    if (ticket.merged_into_id) continue;

    const { error } = await supabase
      .from('tickets')
      .update({ status: newStatus })
      .eq('id', ticketId);

    if (error) continue;

    await supabase.from('activity_log').insert({
      ticket_id: ticketId,
      actor_id: user.id,
      action: 'status_changed',
      details: { from: ticket.status, to: newStatus },
    });

    // Side effects
    if (newStatus === 'closed') {
      if (!ticket.duplicate_of_id) {
        scheduleCsatSurvey(ticketId).catch((err) => console.error('[csat]', err));
      }
      stopResolutionTimer(ticketId).catch((err) => console.error('[sla]', err));
    } else if (ticket.status === 'closed' && newStatus === 'open') {
      cancelCsatSurvey(ticketId).catch((err) => console.error('[csat]', err));
      resumeSlaTimer(ticketId).catch((err) => console.error('[sla]', err));
    }

    if (newStatus === 'pending') {
      pauseSlaTimer(ticketId).catch((err) => console.error('[sla]', err));
    } else if (ticket.status === 'pending' && newStatus === 'open') {
      resumeSlaTimer(ticketId).catch((err) => console.error('[sla]', err));
    }

    processed.push(ticketId);
  }

  if (processed.length > 0) {
    sendBulkNotification(
      processed,
      `Status changed to ${newStatus}`,
      profile.display_name ?? 'Agent',
      user.id,
    ).catch((err) => console.error('[bulk-notify]', err));
  }

  revalidatePath('/agent');
}

export async function bulkAssign(formData: FormData): Promise<void> {
  const { supabase, user, profile } = await requireAgentRole();

  const ticketIds = parseTicketIds(formData);
  const agentId = formData.get('agent_id') as string;

  if (ticketIds.length === 0 || !agentId) return;

  // Validate target agent
  const { data: targetProfile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', agentId)
    .single();
  if (!targetProfile || !['agent', 'admin'].includes(targetProfile.role)) return;

  const processed: number[] = [];

  for (const ticketId of ticketIds) {
    const { error } = await supabase
      .from('tickets')
      .update({ assigned_agent_id: agentId })
      .eq('id', ticketId);

    if (error) continue;

    await supabase.from('activity_log').insert({
      ticket_id: ticketId,
      actor_id: user.id,
      action: 'agent_assigned',
      details: { agent_id: agentId },
    });

    processed.push(ticketId);
  }

  if (processed.length > 0) {
    sendBulkNotification(
      processed,
      'Agent assigned',
      profile.display_name ?? 'Agent',
      user.id,
    ).catch((err) => console.error('[bulk-notify]', err));
  }

  revalidatePath('/agent');
}

export async function bulkUnassign(formData: FormData): Promise<void> {
  const { supabase, user, profile } = await requireAgentRole();

  const ticketIds = parseTicketIds(formData);
  if (ticketIds.length === 0) return;

  const processed: number[] = [];

  for (const ticketId of ticketIds) {
    const { error } = await supabase
      .from('tickets')
      .update({ assigned_agent_id: null })
      .eq('id', ticketId);

    if (error) continue;

    await supabase.from('activity_log').insert({
      ticket_id: ticketId,
      actor_id: user.id,
      action: 'agent_unassigned',
      details: {},
    });

    processed.push(ticketId);
  }

  if (processed.length > 0) {
    sendBulkNotification(
      processed,
      'Agent unassigned',
      profile.display_name ?? 'Agent',
      user.id,
    ).catch((err) => console.error('[bulk-notify]', err));
  }

  revalidatePath('/agent');
}

export async function bulkAddTags(formData: FormData): Promise<void> {
  const { supabase, user } = await requireAgentRole();

  const ticketIds = parseTicketIds(formData);
  const tagIdsRaw = formData.get('tag_ids') as string;
  if (ticketIds.length === 0 || !tagIdsRaw) return;

  let tagIds: string[];
  try {
    tagIds = JSON.parse(tagIdsRaw);
    if (!Array.isArray(tagIds)) return;
  } catch {
    return;
  }

  for (const ticketId of ticketIds) {
    for (const tagId of tagIds) {
      await supabase
        .from('ticket_tags')
        .upsert(
          { ticket_id: ticketId, tag_id: tagId },
          { onConflict: 'ticket_id,tag_id' },
        );

      await supabase.from('activity_log').insert({
        ticket_id: ticketId,
        actor_id: user.id,
        action: 'tag_added',
        details: { tag_id: tagId },
      });
    }
  }

  revalidatePath('/agent');
}

export async function bulkRemoveTags(formData: FormData): Promise<void> {
  const { supabase, user } = await requireAgentRole();

  const ticketIds = parseTicketIds(formData);
  const tagIdsRaw = formData.get('tag_ids') as string;
  if (ticketIds.length === 0 || !tagIdsRaw) return;

  let tagIds: string[];
  try {
    tagIds = JSON.parse(tagIdsRaw);
    if (!Array.isArray(tagIds)) return;
  } catch {
    return;
  }

  for (const ticketId of ticketIds) {
    for (const tagId of tagIds) {
      await supabase
        .from('ticket_tags')
        .delete()
        .eq('ticket_id', ticketId)
        .eq('tag_id', tagId);

      await supabase.from('activity_log').insert({
        ticket_id: ticketId,
        actor_id: user.id,
        action: 'tag_removed',
        details: { tag_id: tagId },
      });
    }
  }

  revalidatePath('/agent');
}

export async function bulkSetSeverity(formData: FormData): Promise<void> {
  const { supabase, user, profile } = await requireAgentRole();

  const ticketIds = parseTicketIds(formData);
  const newSeverity = formData.get('new_severity') as string;

  if (ticketIds.length === 0) return;
  if (!['low', 'medium', 'high', 'critical'].includes(newSeverity)) return;

  const processed: number[] = [];

  for (const ticketId of ticketIds) {
    const { data: ticket } = await supabase
      .from('tickets')
      .select('id, severity')
      .eq('id', ticketId)
      .single();

    if (!ticket || ticket.severity === newSeverity) continue;

    const { error } = await supabase
      .from('tickets')
      .update({ severity: newSeverity })
      .eq('id', ticketId);

    if (error) continue;

    await supabase.from('activity_log').insert({
      ticket_id: ticketId,
      actor_id: user.id,
      action: 'severity_changed',
      details: { from: ticket.severity, to: newSeverity },
    });

    recalculateSlaTargets(ticketId, newSeverity).catch((err) =>
      console.error('[sla]', err),
    );

    processed.push(ticketId);
  }

  if (processed.length > 0) {
    sendBulkNotification(
      processed,
      `Severity changed to ${newSeverity}`,
      profile.display_name ?? 'Agent',
      user.id,
    ).catch((err) => console.error('[bulk-notify]', err));
  }

  revalidatePath('/agent');
}

export async function bulkDelete(formData: FormData): Promise<void> {
  const { supabase, user } = await requireAdminRole();

  const ticketIds = parseTicketIds(formData);
  if (ticketIds.length === 0) return;

  const deleted: number[] = [];
  const skipped: { id: number; reason: string }[] = [];

  for (const ticketId of ticketIds) {
    const { data: ticket } = await supabase
      .from('tickets')
      .select('id, title, status')
      .eq('id', ticketId)
      .single();

    if (!ticket) {
      skipped.push({ id: ticketId, reason: 'not found' });
      continue;
    }

    if (ticket.status === 'closed') {
      skipped.push({ id: ticketId, reason: 'closed ticket' });
      continue;
    }

    // Check duplicate dependents
    const { data: duplicates } = await supabase
      .from('tickets')
      .select('id')
      .eq('duplicate_of_id', ticketId);

    if (duplicates && duplicates.length > 0) {
      skipped.push({ id: ticketId, reason: 'has duplicates pointing to it' });
      continue;
    }

    // Check merge dependents
    const { data: mergeStubs } = await supabase
      .from('tickets')
      .select('id')
      .eq('merged_into_id', ticketId);

    if (mergeStubs && mergeStubs.length > 0) {
      skipped.push({ id: ticketId, reason: 'is merge target' });
      continue;
    }

    const { error } = await supabase
      .from('tickets')
      .delete()
      .eq('id', ticketId);

    if (error) {
      skipped.push({ id: ticketId, reason: 'delete failed' });
      continue;
    }

    await supabase.from('admin_audit_log').insert({
      admin_id: user.id,
      action: 'ticket_deleted',
      target_type: 'ticket',
      target_id: String(ticketId),
      details: { ticket_title: ticket.title },
    });

    deleted.push(ticketId);
  }

  revalidatePath('/agent');
}
