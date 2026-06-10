import crypto from 'crypto';
import { createServiceRoleClient } from '@/lib/supabase/server';

/**
 * Generate a cryptographically random CSAT token (64-char hex = 32 bytes entropy).
 */
export function generateCsatToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Create a new CSAT rating row with a fresh token.
 * Token expires in 30 days. Returns the token string.
 */
export async function createCsatToken(ticketId: number): Promise<string> {
  const supabase = createServiceRoleClient();
  const token = generateCsatToken();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await supabase.from('csat_ratings').insert({
    ticket_id: ticketId,
    token,
    token_expires_at: expiresAt,
    is_used: false,
  });

  if (error) {
    throw new Error(`Failed to create CSAT token: ${error.message}`);
  }

  return token;
}

/**
 * Invalidate existing unused tokens for a ticket, then create a new one.
 * Returns the new token.
 */
export async function reissueCsatToken(ticketId: number): Promise<string> {
  const supabase = createServiceRoleClient();

  // Invalidate existing unused tokens for this ticket
  await supabase
    .from('csat_ratings')
    .update({ is_used: true })
    .eq('ticket_id', ticketId)
    .eq('is_used', false)
    .is('rating', null);

  return createCsatToken(ticketId);
}

/**
 * Validate a CSAT token. Returns validity info + ticket context.
 */
export async function validateCsatToken(
  token: string,
): Promise<{
  valid: boolean;
  ticketId?: number;
  existingRating?: number;
  existingComment?: string | null;
}> {
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from('csat_ratings')
    .select('id, ticket_id, rating, comment, token_expires_at, is_used, submitted_at')
    .eq('token', token)
    .single();

  if (error || !data) {
    return { valid: false };
  }

  // Expired?
  if (new Date(data.token_expires_at) < new Date()) {
    return { valid: false };
  }

  // Any used token is invalid, whether it was submitted or invalidated by reissue.
  if (data.is_used) {
    return { valid: false };
  }

  // If token has a rating, return existing info so user can update
  if (data.rating !== null) {
    return {
      valid: true,
      ticketId: data.ticket_id,
      existingRating: data.rating,
      existingComment: data.comment,
    };
  }

  return { valid: true, ticketId: data.ticket_id };
}

// ============================================================
// Schedule CSAT Survey
//
// NOTE: The functions below are plain server-only helpers (this module has no
// 'use server' directive). They use the service-role client and must NOT be
// exposed as callable server-action endpoints — they have no per-caller
// authorization and are only invoked from trusted server code (ticket/agent
// actions, inbound email, reports). Keep them out of 'use server' modules.
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
    .maybeSingle();

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
    .maybeSingle();

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
    .maybeSingle();

  if (!data || data.rating === null) return null;

  return {
    rating: data.rating,
    comment: data.comment,
    submitted_at: data.submitted_at,
  };
}
