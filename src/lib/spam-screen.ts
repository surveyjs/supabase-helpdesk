import { after } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { callAi } from '@/lib/ai/client';
import { stopResolutionTimer } from '@/lib/utils/sla';
import {
  matchSpamRule,
  parseAiSpamScore,
  parseSpamSettings,
  SPAM_SETTINGS_KEY,
  SPAM_TAG,
  type SpamAction,
  type SpamInput,
} from '@/lib/spam';

/**
 * Screen a customer's new ticket for spam (#28). Rules run now; when they
 * catch the ticket with the "close" action the caller should skip the new
 * ticket's notifications and SLA timer. The AI check (if enabled and no rule
 * matched) runs after the response so creating a ticket never waits for it.
 */
export async function screenNewTicket(
  ticketId: number,
  creatorId: string,
  input: SpamInput,
): Promise<{ closedAsSpam: boolean }> {
  const svc = createServiceRoleClient();
  const { data } = await svc.from('app_settings').select('value').eq('key', SPAM_SETTINGS_KEY).maybeSingle();
  const settings = parseSpamSettings(data?.value);
  if (!settings.enabled) return { closedAsSpam: false };

  const reason = matchSpamRule(settings, input);
  if (reason) {
    await applySpamAction(ticketId, creatorId, settings.action, `rule: ${reason}`);
    return { closedAsSpam: settings.action === 'close' };
  }

  if (settings.aiEnabled) {
    after(async () => {
      try {
        const { content } = await callAi(
          'You screen new help-desk tickets for spam (advertising, SEO offers, phishing, scams, gibberish). '
            + 'Genuine product questions, bug reports and sales or licensing questions are NOT spam. '
            + 'Reply with JSON only: {"spam_probability": <0..1>, "reason": "<short>"}.',
          `From: ${input.email}\nSubject: ${input.title}\n\n${input.body.slice(0, 6000)}`,
        );
        const score = parseAiSpamScore(content);
        if (score !== null && score >= settings.aiThreshold) {
          await applySpamAction(ticketId, creatorId, settings.action, `AI score ${score.toFixed(2)}`);
        }
      } catch (err) {
        console.error('[spam] AI check failed', err);
      }
    });
  }
  return { closedAsSpam: false };
}

async function applySpamAction(ticketId: number, creatorId: string, action: SpamAction, reason: string): Promise<void> {
  const svc = createServiceRoleClient();
  if (action === 'close') {
    await svc.from('tickets').update({ status: 'closed' }).eq('id', ticketId);
    // A late (AI) verdict finds a running SLA timer; a rule verdict finds none.
    await stopResolutionTimer(ticketId).catch(() => {});
  } else {
    let { data: tag } = await svc.from('tags').select('id').eq('name', SPAM_TAG).maybeSingle();
    if (!tag) {
      ({ data: tag } = await svc.from('tags').insert({ name: SPAM_TAG, color: '#dc2626' }).select('id').single());
    }
    if (tag) await svc.from('ticket_tags').upsert({ ticket_id: ticketId, tag_id: tag.id });
  }
  // actor_id is required; the creator stands in, and the Logs tab shows the
  // entry as "Spam filter" (buildActivityDescriptor).
  await svc.from('activity_log').insert({
    ticket_id: ticketId,
    actor_id: creatorId,
    action: 'spam_detected',
    details: { action, reason },
  });
}
