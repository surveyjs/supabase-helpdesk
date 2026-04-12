import { createServiceRoleClient } from '@/lib/supabase/server';
import { createCsatToken } from '@/lib/utils/csat';
import { renderTemplate } from '@/lib/email/templates';
import { sendEmail } from '@/lib/email/send';

/**
 * Process all pending CSAT survey emails that are due.
 * Called from the cron job processing path.
 */
export async function processPendingCsatSurveys(): Promise<void> {
  const supabase = createServiceRoleClient();

  // Check if CSAT is still enabled
  const { data: enabledSetting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'csat_enabled')
    .single();

  if (!enabledSetting || enabledSetting.value !== 'true') return;

  // Get pending surveys
  const { data: pending } = await supabase
    .from('csat_survey_schedule')
    .select('id, ticket_id')
    .eq('is_sent', false)
    .eq('is_cancelled', false)
    .lte('scheduled_at', new Date().toISOString())
    .limit(50);

  if (!pending || pending.length === 0) return;

  for (const schedule of pending) {
    try {
      // Check no rating already submitted
      const { data: existingRating } = await supabase
        .from('csat_ratings')
        .select('id')
        .eq('ticket_id', schedule.ticket_id)
        .not('rating', 'is', null)
        .limit(1)
        .single();

      if (existingRating) {
        // Already rated, mark as sent
        await supabase
          .from('csat_survey_schedule')
          .update({ is_sent: true })
          .eq('id', schedule.id);
        continue;
      }

      // Fetch ticket info
      const { data: ticket } = await supabase
        .from('tickets')
        .select('id, title, creator_id')
        .eq('id', schedule.ticket_id)
        .single();

      if (!ticket) {
        await supabase
          .from('csat_survey_schedule')
          .update({ is_sent: true })
          .eq('id', schedule.id);
        continue;
      }

      // Fetch owner
      const { data: owner } = await supabase
        .from('profiles')
        .select('display_name, email')
        .eq('id', ticket.creator_id)
        .single();

      if (!owner || !owner.email) {
        await supabase
          .from('csat_survey_schedule')
          .update({ is_sent: true })
          .eq('id', schedule.id);
        continue;
      }

      // Generate CSAT token
      const token = await createCsatToken(ticket.id);

      const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/:\d+$/, ':3000') || 'http://localhost:3000';
      const csatLink = `${baseUrl}/csat/${token}`;

      // Render and send email
      const { subject, html } = await renderTemplate('csat_survey', {
        userName: owner.display_name ?? owner.email,
        ticketTitle: ticket.title,
        ticketId: String(ticket.id),
        csatLink,
      });

      await sendEmail(owner.email, subject, html);

      // Mark as sent
      await supabase
        .from('csat_survey_schedule')
        .update({ is_sent: true })
        .eq('id', schedule.id);
    } catch (err) {
      console.error(`[csat] Failed to process survey for ticket ${schedule.ticket_id}:`, err);
    }
  }
}
