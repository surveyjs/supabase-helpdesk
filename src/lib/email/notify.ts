import { createServiceRoleClient } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/email/send';
import { renderTemplate } from '@/lib/email/templates';

type NotificationPrefs = Record<string, { email?: boolean; in_app?: boolean }>;

/**
 * Format a short human-readable notification message for in-app display.
 */
export function formatNotificationMessage(
  eventType: string,
  placeholders: Record<string, string>,
): string {
  const tid = placeholders.ticketId ?? '?';
  const author = placeholders.authorName ?? placeholders.agentName ?? 'Someone';
  const agent = placeholders.agentName ?? 'An agent';
  const status = placeholders.newStatus ?? placeholders.to ?? '';

  switch (eventType) {
    case 'new_post':
      return `${author} replied to ticket #${tid}`;
    case 'status_changed':
      return `Ticket #${tid} status changed to ${status}`;
    case 'agent_assigned':
      return `${agent} was assigned to ticket #${tid}`;
    case 'agent_assigned_to_agent':
      return `You were assigned to ticket #${tid}`;
    case 'user_reply_to_agent':
      return `${author} replied to ticket #${tid}`;
    case 'auto_reopen':
      return `Ticket #${tid} was automatically reopened`;
    case 'urgency_changed':
      return `Ticket #${tid} urgency changed to ${placeholders.to ?? ''}`;
    case 'severity_changed':
      return `Ticket #${tid} severity changed to ${placeholders.to ?? ''}`;
    case 'privacy_changed':
      return `Ticket #${tid} privacy was changed`;
    case 'csat_submitted':
      return `${author} submitted a ${placeholders.rating ?? '?'}-star CSAT rating on ticket #${tid}`;
    default:
      return `Update on ticket #${tid}`;
  }
}

/**
 * Create an in-app notification record for a user.
 */
async function createInAppNotification(
  recipientId: string,
  eventType: string,
  ticketId: number,
  placeholders: Record<string, string>,
): Promise<void> {
  const supabase = createServiceRoleClient();
  const message = formatNotificationMessage(eventType, placeholders);

  const { error } = await supabase.from('notifications').insert({
    recipient_id: recipientId,
    event_type: eventType,
    ticket_id: ticketId,
    message,
  });

  if (error) {
    console.error('Failed to create in-app notification', {
      recipientId,
      eventType,
      ticketId,
      error,
    });
  }
}

/**
 * Get effective notification preferences for a user.
 * Falls back to system defaults for any missing event type.
 */
async function getEffectivePreferences(
  userId: string,
): Promise<NotificationPrefs> {
  const supabase = createServiceRoleClient();

  // Get system defaults
  const { data: defaultSetting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'default_notification_preferences')
    .single();

  let defaults: NotificationPrefs = {};
  try {
    defaults = defaultSetting ? JSON.parse(defaultSetting.value) : {};
  } catch {
    defaults = {};
  }

  // Get user overrides
  const { data: userPrefs } = await supabase
    .from('notification_preferences')
    .select('preferences')
    .eq('user_id', userId)
    .single();

  const userOverrides: NotificationPrefs = userPrefs?.preferences
    ? (userPrefs.preferences as NotificationPrefs)
    : {};

  // Merge: user overrides take precedence
  return { ...defaults, ...userOverrides };
}

/**
 * Get coalescing delay from app_settings (in minutes).
 */
async function getCoalescingDelay(): Promise<number> {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'notification_coalescing_delay_minutes')
    .single();

  if (!data) return 2;
  const parsed = parseInt(data.value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 2;
}

/**
 * Enqueue or update a coalescing queue entry.
 */
async function enqueueCoalesced(
  ticketId: number,
  recipientId: string,
  eventType: string,
  placeholders: Record<string, string>,
  agentId: string | null,
  delayMinutes: number,
): Promise<void> {
  const supabase = createServiceRoleClient();

  const sendAfter = new Date(Date.now() + delayMinutes * 60 * 1000).toISOString();
  const newEvent = {
    event_type: eventType,
    placeholders,
    timestamp: new Date().toISOString(),
  };

  // Try to find an existing queue entry for this ticket+recipient
  const { data: existing } = await supabase
    .from('notification_coalescing_queue')
    .select('id, events')
    .eq('ticket_id', ticketId)
    .eq('recipient_id', recipientId)
    .single();

  if (existing) {
    // Append event and reset timer
    const events = Array.isArray(existing.events) ? [...existing.events] : [];

    // Post/comment edit coalescing: if the new event is an edit and the last
    // event is a create for the same post, merge them
    const lastEvent = events[events.length - 1] as { event_type?: string; placeholders?: Record<string, string> } | undefined;
    if (
      eventType === 'post_edited' &&
      lastEvent?.event_type === 'new_post' &&
      lastEvent.placeholders?.postId === placeholders.postId
    ) {
      // Replace the created event's body with the latest
      lastEvent.placeholders = { ...lastEvent.placeholders, ...placeholders };
    } else {
      events.push(newEvent);
    }

    await supabase
      .from('notification_coalescing_queue')
      .update({
        events,
        send_after: sendAfter,
        triggering_agent_id: agentId,
      })
      .eq('id', existing.id);
  } else {
    // Insert new entry
    await supabase
      .from('notification_coalescing_queue')
      .insert({
        ticket_id: ticketId,
        recipient_id: recipientId,
        events: [newEvent],
        triggering_agent_id: agentId,
        send_after: sendAfter,
      });
  }
}

/**
 * Primary notification dispatch for users (ticket owner + followers).
 * Subject to coalescing when triggered by agent actions.
 */
export async function notifyUser(
  recipientId: string,
  eventType: string,
  ticketId: number,
  placeholders: Record<string, string>,
  triggeringAgentId: string | null = null,
): Promise<void> {
  const supabase = createServiceRoleClient();

  // Check recipient is not blocked
  const { data: recipient } = await supabase
    .from('profiles')
    .select('id, email, is_blocked')
    .eq('id', recipientId)
    .single();

  if (!recipient || recipient.is_blocked || !recipient.email) return;

  // Get preferences
  const prefs = await getEffectivePreferences(recipientId);
  const eventPrefs = prefs[eventType];

  // In-app notification (never coalesced — always immediate for real-time delivery)
  if (!eventPrefs || eventPrefs.in_app !== false) {
    await createInAppNotification(recipientId, eventType, ticketId, placeholders);
  }

  // Email notification
  if (eventPrefs && eventPrefs.email === false) return;

  // Check coalescing
  const coalescingDelay = await getCoalescingDelay();

  if (coalescingDelay > 0 && triggeringAgentId) {
    // Agent-triggered notification to user → coalesce
    await enqueueCoalesced(
      ticketId,
      recipientId,
      eventType,
      placeholders,
      triggeringAgentId,
      coalescingDelay,
    );
    return;
  }

  // Send immediately
  const { subject, html } = await renderTemplate(eventType, placeholders);
  await sendEmail(recipient.email, subject, html);
}

/**
 * Agent notification (never coalesced).
 */
export async function notifyAgent(
  agentId: string,
  eventType: string,
  ticketId: number,
  placeholders: Record<string, string>,
): Promise<void> {
  const supabase = createServiceRoleClient();

  // Check agent exists and is not blocked
  const { data: agent } = await supabase
    .from('profiles')
    .select('id, email, is_blocked')
    .eq('id', agentId)
    .single();

  if (!agent || agent.is_blocked || !agent.email) return;

  // Check preferences
  const prefs = await getEffectivePreferences(agentId);
  const eventPrefs = prefs[eventType];

  // In-app notification (always immediate)
  if (!eventPrefs || eventPrefs.in_app !== false) {
    await createInAppNotification(agentId, eventType, ticketId, placeholders);
  }

  // Email notification
  if (eventPrefs && eventPrefs.email === false) return;

  // Send immediately
  const { subject, html } = await renderTemplate(eventType, placeholders);
  await sendEmail(agent.email, subject, html);
}

/**
 * Convenience: notify all relevant recipients for a ticket event.
 * Recipients = ticket owner + followers, excluding the actor.
 */
export async function notifyTicketRecipients(
  ticketId: number,
  eventType: string,
  placeholders: Record<string, string>,
  excludeUserId?: string,
  triggeringAgentId?: string | null,
): Promise<void> {
  const supabase = createServiceRoleClient();

  // Get ticket info
  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, creator_id, title, slug')
    .eq('id', ticketId)
    .single();

  if (!ticket) return;

  // Get followers
  const { data: followers } = await supabase
    .from('ticket_followers')
    .select('user_id')
    .eq('ticket_id', ticketId);

  // Build recipient list (unique)
  const recipientIds = new Set<string>();
  recipientIds.add(ticket.creator_id);
  if (followers) {
    for (const f of followers) {
      recipientIds.add(f.user_id);
    }
  }

  // Exclude the actor
  if (excludeUserId) {
    recipientIds.delete(excludeUserId);
  }

  // Add ticket context to placeholders
  const fullPlaceholders = {
    ticketTitle: ticket.title,
    ticketId: String(ticket.id),
    ticketUrl: `/tickets/${ticket.id}/${ticket.slug}`,
    ...placeholders,
  };

  // Notify each recipient
  for (const recipientId of recipientIds) {
    await notifyUser(
      recipientId,
      eventType,
      ticketId,
      fullPlaceholders,
      triggeringAgentId ?? null,
    );
  }
}
