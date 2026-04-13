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
