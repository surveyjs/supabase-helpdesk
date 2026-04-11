import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/email/send';
import { renderTemplate } from '@/lib/email/templates';

type NotificationPrefs = Record<string, { email?: boolean; in_app?: boolean }>;

/**
 * Re-check whether user still wants email for the given event types.
 * Returns `true` if at least one event should still be sent.
 */
async function shouldSendEmail(
  recipientId: string,
  eventTypes: string[],
): Promise<boolean> {
  const supabase = createServiceRoleClient();

  const { data: defaultSetting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'default_notification_preferences')
    .single();

  let defaults: NotificationPrefs = {};
  try { defaults = defaultSetting ? JSON.parse(defaultSetting.value) : {}; } catch { defaults = {}; }

  const { data: userPrefs } = await supabase
    .from('notification_preferences')
    .select('preferences')
    .eq('user_id', recipientId)
    .single();

  const overrides: NotificationPrefs = userPrefs?.preferences
    ? (userPrefs.preferences as NotificationPrefs)
    : {};

  const merged = { ...defaults, ...overrides };

  return eventTypes.some((et) => {
    const p = merged[et];
    return !p || p.email !== false;
  });
}

/**
 * Cron endpoint: process the notification coalescing queue.
 * Called every minute by pg_cron or equivalent scheduler.
 * Secured by service role key check.
 */
export async function POST(request: Request) {
  // Verify authorization via service role key
  const authHeader = request.headers.get('Authorization');
  const expectedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!expectedKey || authHeader !== `Bearer ${expectedKey}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceRoleClient();

  // Fetch entries ready to send
  const { data: entries, error } = await supabase
    .from('notification_coalescing_queue')
    .select('*')
    .lte('send_after', new Date().toISOString())
    .order('send_after');

  if (error || !entries || entries.length === 0) {
    return NextResponse.json({ processed: 0 });
  }

  let processed = 0;

  for (const entry of entries) {
    try {
      // Get recipient email
      const { data: recipient } = await supabase
        .from('profiles')
        .select('id, email, is_blocked')
        .eq('id', entry.recipient_id)
        .single();

      if (!recipient || recipient.is_blocked || !recipient.email) {
        // Delete the entry even if we can't send
        await supabase
          .from('notification_coalescing_queue')
          .delete()
          .eq('id', entry.id);
        continue;
      }

      const events = entry.events as Array<{
        event_type: string;
        placeholders: Record<string, string>;
        timestamp: string;
      }>;

      if (events.length === 0) {
        await supabase
          .from('notification_coalescing_queue')
          .delete()
          .eq('id', entry.id);
        continue;
      }

      // Re-check current user preferences before sending
      const eventTypes = events.map((e) => e.event_type);
      if (!(await shouldSendEmail(entry.recipient_id, eventTypes))) {
        await supabase
          .from('notification_coalescing_queue')
          .delete()
          .eq('id', entry.id);
        continue;
      }

      let sent = false;

      if (events.length === 1) {
        // Single event: use standard template
        const evt = events[0];
        const { subject, html } = await renderTemplate(evt.event_type, evt.placeholders);
        sent = await sendEmail(recipient.email, subject, html);
      } else {
        // Multiple events: use consolidated update template
        // Build changeList from events
        const changeList = events
          .map((evt) => {
            const label = formatEventLabel(evt.event_type, evt.placeholders);
            return `- ${label}`;
          })
          .join('\n');

        // Get ticket info from first event's placeholders
        const firstPlaceholders = events[0].placeholders;
        const placeholders = {
          ticketTitle: firstPlaceholders.ticketTitle ?? '',
          ticketId: firstPlaceholders.ticketId ?? String(entry.ticket_id),
          ticketUrl: firstPlaceholders.ticketUrl ?? `/tickets/${entry.ticket_id}`,
          changeList,
          agentName: firstPlaceholders.agentName ?? 'Agent',
          ownerName: firstPlaceholders.ownerName ?? '',
        };

        const { subject, html } = await renderTemplate('consolidated_update', placeholders);
        sent = await sendEmail(recipient.email, subject, html);
      }

      if (sent) {
        // Delete only on successful send
        await supabase
          .from('notification_coalescing_queue')
          .delete()
          .eq('id', entry.id);
        processed++;
      } else {
        console.warn('[cron/notifications] Email send failed for entry:', entry.id, '— will retry next cycle');
      }
    } catch (err) {
      console.error('[cron/notifications] Error processing entry:', entry.id, err);
      // Continue processing other entries
    }
  }

  return NextResponse.json({ processed });
}

/**
 * Format an event into a human-readable label for the consolidated email.
 */
function formatEventLabel(
  eventType: string,
  placeholders: Record<string, string>,
): string {
  switch (eventType) {
    case 'new_post':
      return `${placeholders.authorName ?? 'Someone'} replied`;
    case 'status_changed':
      return `Status changed to ${placeholders.newStatus ?? 'unknown'}`;
    case 'agent_assigned':
      return `Agent ${placeholders.agentName ?? ''} assigned`;
    case 'urgency_changed':
      return `Urgency changed to ${placeholders.newUrgency ?? 'unknown'}`;
    case 'severity_changed':
      return `Severity changed to ${placeholders.newSeverity ?? 'unknown'}`;
    case 'privacy_changed':
      return 'Privacy setting updated';
    case 'auto_reopen':
      return `Ticket re-opened by ${placeholders.authorName ?? 'a user'}`;
    default:
      return eventType.replace(/_/g, ' ');
  }
}
