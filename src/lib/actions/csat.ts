'use server';

import { redirect } from 'next/navigation';
import { createServerClient, createServiceRoleClient } from '@/lib/supabase/server';
import { validateCsatToken, reissueCsatToken } from '@/lib/utils/csat';
import { notifyAgent } from '@/lib/email/notify';

// ============================================================
// Submit CSAT Rating (token-based, no auth required)
// ============================================================

export async function submitCsatRating(
  token: string,
  rating: number,
  comment?: string,
): Promise<{ success: boolean; error?: string; newToken?: string }> {
  // Validate rating
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { success: false, error: 'Rating must be an integer between 1 and 5.' };
  }

  // Validate comment length
  if (comment && comment.length > 5000) {
    return { success: false, error: 'Comment must be 5000 characters or fewer.' };
  }

  // Validate token
  const validation = await validateCsatToken(token);
  if (!validation.valid || !validation.ticketId) {
    return { success: false, error: 'This survey link is invalid or has expired.' };
  }

  const supabase = createServiceRoleClient();
  const ticketId = validation.ticketId;

  // Fetch ticket to check creator role
  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, title, slug, creator_id, assigned_agent_id')
    .eq('id', ticketId)
    .single();

  if (!ticket) {
    return { success: false, error: 'Ticket not found.' };
  }

  // Check that creator is not agent/admin
  const { data: creatorProfile } = await supabase
    .from('profiles')
    .select('role, display_name, email')
    .eq('id', ticket.creator_id)
    .single();

  if (creatorProfile && ['agent', 'admin'].includes(creatorProfile.role)) {
    return { success: false, error: 'Agents and admins cannot submit CSAT ratings.' };
  }

  // Update the csat_ratings row (keep is_used=false so same token stays valid for updates)
  const { error: updateError } = await supabase
    .from('csat_ratings')
    .update({
      rating,
      comment: comment?.trim() || null,
      submitted_at: new Date().toISOString(),
    })
    .eq('token', token);

  if (updateError) {
    return { success: false, error: 'Failed to submit rating. Please try again.' };
  }

  // Reuse the current token so later updates keep the same rating context
  const newToken = token;

  // Log to activity_log
  await supabase.from('activity_log').insert({
    ticket_id: ticketId,
    actor_id: ticket.creator_id,
    action: 'csat_submitted',
    details: { rating, comment: comment?.trim() || null },
  });

  // Notify assigned agent
  if (ticket.assigned_agent_id) {
    const authorName = creatorProfile?.display_name ?? creatorProfile?.email ?? 'Customer';
    notifyAgent(ticket.assigned_agent_id, 'csat_submitted', ticketId, {
      ticketId: String(ticketId),
      ticketTitle: ticket.title,
      rating: String(rating),
      authorName,
      comment: comment?.trim() || '(no comment)',
    }).catch((err) => console.error('[notify]', err));
  }

  return { success: true, newToken };
}

// ============================================================
// Request CSAT Token (from ticket detail)
// ============================================================

export async function requestCsatToken(ticketId: number): Promise<void> {
  const supabase = await createServerClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Verify user is the ticket owner and ticket is closed
  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, creator_id, status')
    .eq('id', ticketId)
    .single();

  if (!ticket || ticket.creator_id !== user.id) {
    throw new Error('Forbidden');
  }

  if (ticket.status !== 'closed') {
    throw new Error('CSAT ratings can only be submitted for closed tickets.');
  }

  // Verify user is not agent/admin
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (!profile || ['agent', 'admin'].includes(profile.role)) {
    throw new Error('Agents and admins cannot rate tickets.');
  }

  // Issue new token
  const token = await reissueCsatToken(ticketId);

  redirect(`/csat/${token}`);
}
