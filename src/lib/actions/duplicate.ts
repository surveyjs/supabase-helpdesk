'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { stopResolutionTimer } from '@/lib/utils/sla';

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

export async function markAsDuplicate(formData: FormData): Promise<void> {
  const { supabase, user } = await requireAgentRole();

  const ticketId = Number(formData.get('ticket_id'));
  const originalTicketId = Number(formData.get('original_ticket_id'));

  if (!ticketId || !originalTicketId || ticketId === originalTicketId) return;

  // Fetch source ticket
  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, status, slug, merged_into_id, duplicate_of_id')
    .eq('id', ticketId)
    .single();

  if (!ticket) return;

  // Cannot mark a merged ticket as duplicate
  if (ticket.merged_into_id) return;

  // If already duplicate of same target, no-op
  if (ticket.duplicate_of_id === originalTicketId) return;

  // Cannot re-mark if already duplicate of a different ticket
  if (ticket.duplicate_of_id && ticket.duplicate_of_id !== originalTicketId) return;

  // Validate original ticket exists
  const { data: originalTicket } = await supabase
    .from('tickets')
    .select('id')
    .eq('id', originalTicketId)
    .single();

  if (!originalTicket) return;

  // Update source ticket: mark as duplicate and close
  const { error } = await supabase
    .from('tickets')
    .update({ duplicate_of_id: originalTicketId, status: 'closed' })
    .eq('id', ticketId);

  if (error) return;

  // Fetch duplicate post template
  const { data: tpl } = await supabase
    .from('notification_templates')
    .select('body')
    .eq('event_type', 'duplicate_post')
    .single();

  const templateBody = tpl?.body ?? `This ticket has been closed as a duplicate of [#${originalTicketId}](/tickets/${originalTicketId}/redirect).`;
  const renderedBody = templateBody.replace(/\{\{ticketId\}\}/g, String(originalTicketId));

  // Insert system post on the source ticket
  await supabase.from('posts').insert({
    ticket_id: ticketId,
    author_id: user.id,
    body: renderedBody,
    post_type: 'post',
  });

  // Activity log
  await supabase.from('activity_log').insert({
    ticket_id: ticketId,
    actor_id: user.id,
    action: 'marked_duplicate',
    details: { original_ticket_id: originalTicketId },
  });

  // Freeze SLA — do NOT schedule CSAT, do NOT send notifications
  stopResolutionTimer(ticketId).catch((err) => console.error('[sla]', err));

  revalidatePath(`/tickets/${ticketId}/${ticket.slug}`);
  revalidatePath('/agent');
}

export async function removeDuplicateLink(formData: FormData): Promise<void> {
  const { supabase, user } = await requireAgentRole();

  const ticketId = Number(formData.get('ticket_id'));
  if (!ticketId) return;

  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, slug, duplicate_of_id')
    .eq('id', ticketId)
    .single();

  if (!ticket || !ticket.duplicate_of_id) return;

  const previousOriginalId = ticket.duplicate_of_id;

  // Clear duplicate link, do NOT change status
  const { error } = await supabase
    .from('tickets')
    .update({ duplicate_of_id: null })
    .eq('id', ticketId);

  if (error) return;

  // Activity log
  await supabase.from('activity_log').insert({
    ticket_id: ticketId,
    actor_id: user.id,
    action: 'duplicate_removed',
    details: { previous_original_id: previousOriginalId },
  });

  revalidatePath(`/tickets/${ticketId}/${ticket.slug}`);
  revalidatePath('/agent');
}
