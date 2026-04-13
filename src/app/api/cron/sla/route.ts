import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import {
  calculateBusinessMinutesElapsed,
  calculateSlaPercentage,
  type BusinessHoursConfig,
} from '@/lib/utils/business-hours';
import { notifyAgent } from '@/lib/email/notify';

export async function POST(request: Request) {
  // Verify authorization
  const authHeader = request.headers.get('Authorization');
  const expectedKey = process.env.CRON_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!expectedKey || authHeader !== `Bearer ${expectedKey}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceRoleClient();

  // Load business hours config
  const { data: bhSetting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'sla_business_hours')
    .single();

  let config: BusinessHoursConfig | null = null;
  try {
    config = bhSetting?.value ? JSON.parse(bhSetting.value) : null;
  } catch {
    config = null;
  }

  if (!config) {
    config = {
      timezone: 'UTC',
      schedule: {
        monday: { start: '09:00', end: '17:00' },
        tuesday: { start: '09:00', end: '17:00' },
        wednesday: { start: '09:00', end: '17:00' },
        thursday: { start: '09:00', end: '17:00' },
        friday: { start: '09:00', end: '17:00' },
        saturday: null,
        sunday: null,
      },
    };
  }

  // Load approaching threshold
  const { data: thresholdSetting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'sla_approaching_threshold')
    .single();

  const threshold = thresholdSetting?.value ? parseInt(thresholdSetting.value, 10) : 75;

  // Query active timers (non-paused, with open SLA targets)
  const { data: timers } = await supabase
    .from('sla_timers')
    .select('*, tickets(id, title, assigned_agent_id)')
    .eq('is_paused', false)
    .not('sla_policy_id', 'is', null);

  if (!timers || timers.length === 0) {
    return NextResponse.json({ processed: 0 });
  }

  // Load all SLA policies
  const policyIds = [...new Set(timers.map((t) => t.sla_policy_id).filter(Boolean))];
  const { data: policies } = await supabase
    .from('sla_policies')
    .select('id, first_response_minutes, resolution_minutes')
    .in('id', policyIds);

  const policyMap = new Map(
    (policies ?? []).map((p) => [p.id, p]),
  );

  // Load already-sent notifications
  const timerIds = timers.map((t) => t.id);
  const { data: sentNotifications } = await supabase
    .from('sla_notifications_sent')
    .select('sla_timer_id, notification_type')
    .in('sla_timer_id', timerIds);

  const sentSet = new Set(
    (sentNotifications ?? []).map((n) => `${n.sla_timer_id}:${n.notification_type}`),
  );

  // Get all admin IDs for notification
  const { data: admins } = await supabase
    .from('profiles')
    .select('id')
    .eq('role', 'admin');

  const adminIds = (admins ?? []).map((a) => a.id);

  const now = new Date();
  let processed = 0;

  for (const timer of timers) {
    const policy = policyMap.get(timer.sla_policy_id);
    if (!policy) continue;

    const ticket = Array.isArray(timer.tickets) ? timer.tickets[0] : timer.tickets;
    if (!ticket) continue;

    const ticketId = ticket.id;
    const ticketTitle = ticket.title ?? `#${ticketId}`;
    const assignedAgentId = ticket.assigned_agent_id;

    // Calculate current elapsed for first response
    if (timer.first_response_met === null) {
      const since = timer.first_response_paused_at
        ? new Date(timer.first_response_paused_at)
        : new Date(timer.created_at);
      const elapsed = timer.first_response_elapsed_minutes +
        calculateBusinessMinutesElapsed(since, now, config);
      const pct = calculateSlaPercentage(elapsed, policy.first_response_minutes);

      // Check breached
      if (elapsed >= policy.first_response_minutes) {
        const key = `${timer.id}:breached_first_response`;
        if (!sentSet.has(key)) {
          await sendSlaNotification(
            supabase,
            timer.id,
            'breached_first_response',
            ticketId,
            ticketTitle,
            elapsed,
            policy.first_response_minutes,
            pct,
            assignedAgentId,
            adminIds,
          );
          sentSet.add(key);
          processed++;
        }
      } else if (pct >= threshold) {
        const key = `${timer.id}:approaching_first_response`;
        if (!sentSet.has(key)) {
          await sendSlaNotification(
            supabase,
            timer.id,
            'approaching_first_response',
            ticketId,
            ticketTitle,
            elapsed,
            policy.first_response_minutes,
            pct,
            assignedAgentId,
            adminIds,
          );
          sentSet.add(key);
          processed++;
        }
      }
    }

    // Calculate current elapsed for resolution
    if (timer.resolution_met === null) {
      const since = timer.resolution_paused_at
        ? new Date(timer.resolution_paused_at)
        : new Date(timer.created_at);
      const elapsed = timer.resolution_elapsed_minutes +
        calculateBusinessMinutesElapsed(since, now, config);
      const pct = calculateSlaPercentage(elapsed, policy.resolution_minutes);

      if (elapsed >= policy.resolution_minutes) {
        const key = `${timer.id}:breached_resolution`;
        if (!sentSet.has(key)) {
          await sendSlaNotification(
            supabase,
            timer.id,
            'breached_resolution',
            ticketId,
            ticketTitle,
            elapsed,
            policy.resolution_minutes,
            pct,
            assignedAgentId,
            adminIds,
          );
          sentSet.add(key);
          processed++;
        }
      } else if (pct >= threshold) {
        const key = `${timer.id}:approaching_resolution`;
        if (!sentSet.has(key)) {
          await sendSlaNotification(
            supabase,
            timer.id,
            'approaching_resolution',
            ticketId,
            ticketTitle,
            elapsed,
            policy.resolution_minutes,
            pct,
            assignedAgentId,
            adminIds,
          );
          sentSet.add(key);
          processed++;
        }
      }
    }
  }

  return NextResponse.json({ processed });
}

function formatMinutes(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

async function sendSlaNotification(
  supabase: ReturnType<typeof createServiceRoleClient>,
  timerId: string,
  notificationType: string,
  ticketId: number,
  ticketTitle: string,
  elapsedMinutes: number,
  targetMinutes: number,
  percentage: number,
  assignedAgentId: string | null,
  adminIds: string[],
): Promise<void> {
  // Record the notification to prevent duplicates
  await supabase.from('sla_notifications_sent').insert({
    sla_timer_id: timerId,
    notification_type: notificationType,
  });

  // Map notification type to event type for templates
  const eventType = `sla_${notificationType}`;
  const placeholders = {
    ticketId: String(ticketId),
    ticketTitle,
    elapsedTime: formatMinutes(elapsedMinutes),
    targetTime: formatMinutes(targetMinutes),
    percentage: String(percentage),
  };

  // Notify assigned agent
  if (assignedAgentId) {
    notifyAgent(assignedAgentId, eventType, ticketId, placeholders).catch((err) =>
      console.error('[sla-notify]', err),
    );
  }

  // Notify all admins
  for (const adminId of adminIds) {
    if (adminId !== assignedAgentId) {
      notifyAgent(adminId, eventType, ticketId, placeholders).catch((err) =>
        console.error('[sla-notify]', err),
      );
    }
  }
}
