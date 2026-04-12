'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServerClient, createServiceRoleClient } from '@/lib/supabase/server';
import { validateCsatToken, reissueCsatToken, createCsatToken } from '@/lib/utils/csat';
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

  // Update the csat_ratings row
  const { error: updateError } = await supabase
    .from('csat_ratings')
    .update({
      rating,
      comment: comment?.trim() || null,
      submitted_at: new Date().toISOString(),
      is_used: true,
    })
    .eq('token', token);

  if (updateError) {
    return { success: false, error: 'Failed to submit rating. Please try again.' };
  }

  // Issue a new token so user can update their rating later
  const newToken = await createCsatToken(ticketId);

  // Log to activity_log
  await supabase.from('activity_log').insert({
    ticket_id: ticketId,
    actor_id: ticket.creator_id,
    action: 'csat_submitted',
    details: { rating, comment: comment?.trim() || null },
  });

  // Notify assigned agent
  if (ticket.assigned_agent_id) {
    const userName = creatorProfile?.display_name ?? creatorProfile?.email ?? 'Customer';
    notifyAgent(ticket.assigned_agent_id, 'csat_submitted', ticketId, {
      ticketId: String(ticketId),
      ticketTitle: ticket.title,
      rating: String(rating),
      userName,
      comment: comment?.trim() || '(no comment)',
    }).catch((err) => console.error('[notify]', err));
  }

  return { success: true, newToken };
}

// ============================================================
// Schedule CSAT Survey
// ============================================================

const DELAY_MAP: Record<string, number> = {
  immediately: 0,
  '1_hour': 60 * 60 * 1000,
  '4_hours': 4 * 60 * 60 * 1000,
  '24_hours': 24 * 60 * 60 * 1000,
};

export async function scheduleCsatSurvey(ticketId: number): Promise<void> {
  const supabase = createServiceRoleClient();

  // Check if CSAT is enabled
  const { data: enabledSetting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'csat_enabled')
    .single();

  if (!enabledSetting || enabledSetting.value !== 'true') return;

  // Check if rating already exists
  const { data: existingRating } = await supabase
    .from('csat_ratings')
    .select('id')
    .eq('ticket_id', ticketId)
    .not('rating', 'is', null)
    .limit(1)
    .single();

  if (existingRating) return; // Already rated, don't schedule

  // Get delay setting
  const { data: delaySetting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'csat_survey_delay')
    .single();

  const delayKey = delaySetting?.value ?? '1_hour';
  const delayMs = DELAY_MAP[delayKey] ?? DELAY_MAP['1_hour'];
  const scheduledAt = new Date(Date.now() + delayMs).toISOString();

  // Upsert: if a cancelled row exists, update it
  const { data: existing } = await supabase
    .from('csat_survey_schedule')
    .select('id, is_cancelled')
    .eq('ticket_id', ticketId)
    .single();

  if (existing) {
    await supabase
      .from('csat_survey_schedule')
      .update({
        scheduled_at: scheduledAt,
        is_sent: false,
        is_cancelled: false,
      })
      .eq('id', existing.id);
  } else {
    await supabase.from('csat_survey_schedule').insert({
      ticket_id: ticketId,
      scheduled_at: scheduledAt,
    });
  }
}

// ============================================================
// Cancel CSAT Survey
// ============================================================

export async function cancelCsatSurvey(ticketId: number): Promise<void> {
  const supabase = createServiceRoleClient();

  await supabase
    .from('csat_survey_schedule')
    .update({ is_cancelled: true })
    .eq('ticket_id', ticketId)
    .eq('is_sent', false)
    .eq('is_cancelled', false);
}

// ============================================================
// Get CSAT Rating for a ticket
// ============================================================

export async function getCsatRating(
  ticketId: number,
): Promise<{ rating: number; comment: string | null; submitted_at: string } | null> {
  const supabase = createServiceRoleClient();

  const { data } = await supabase
    .from('csat_ratings')
    .select('rating, comment, submitted_at')
    .eq('ticket_id', ticketId)
    .not('rating', 'is', null)
    .order('submitted_at', { ascending: false })
    .limit(1)
    .single();

  if (!data || data.rating === null) return null;

  return {
    rating: data.rating,
    comment: data.comment,
    submitted_at: data.submitted_at,
  };
}

// ============================================================
// Request CSAT Token (from ticket detail)
// ============================================================

export async function requestCsatToken(ticketId: number): Promise<void> {
  const supabase = await createServerClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Verify user is the ticket owner
  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, creator_id')
    .eq('id', ticketId)
    .single();

  if (!ticket || ticket.creator_id !== user.id) {
    throw new Error('Forbidden');
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
