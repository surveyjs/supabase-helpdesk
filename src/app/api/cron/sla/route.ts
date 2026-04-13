import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import {
  getBusinessHoursConfig,
  calculateBusinessMinutesElapsed,
  calculateSlaPercentage,
} from '@/lib/utils/business-hours';
import { notifyAgent } from '@/lib/email/notify';

export async function POST(request: Request) {
  const authHeader = request.headers.get('Authorization');
  const expectedKey = process.env.CRON_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!expectedKey || authHeader !== `Bearer ${expectedKey}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const config = await getBusinessHoursConfig();

  // Get approaching threshold
  const { data: thresholdSetting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'sla_approaching_threshold')
    .single();
  const threshold = thresholdSetting ? parseInt(thresholdSetting.value, 10) : 75;

  // Query active (non-paused) timers with incomplete SLA
  const { data: timers, error } = await supabase
    .from('sla_timers')
    .select('*, tickets(id, title, slug, assigned_agent_id)')
    .eq('is_paused', false)
    .or('first_response_met.is.null,resolution_met.is.null');

  if (error || !timers || timers.length === 0) {
    return NextResponse.json({ processed: 0 });
  }

  // Get all admin IDs for breach notifications
  const { data: admins } = await supabase
    .from('profiles')
    .select('id')
    .eq('role', 'admin');
  const adminIds = (admins ?? []).map((a) => a.id);

  const now = new Date();
  let processed = 0;

  for (const timer of timers) {
    const ticket = Array.isArray(timer.tickets) ? timer.tickets[0] : timer.tickets;
    if (!ticket) continue;

    // Get the policy
    if (!timer.sla_policy_id) continue;
    const { data: policy } = await supabase
      .from('sla_policies')
      .select('first_response_minutes, resolution_minutes')
      .eq('id', timer.sla_policy_id)
      .single();
    if (!policy) continue;

    const elapsed = calculateBusinessMinutesElapsed(
      new Date(timer.created_at),
      now,
      config,
    );

    // Check first response
    if (timer.first_response_met === null) {
      const frPct = calculateSlaPercentage(elapsed, policy.first_response_minutes);
      const frElapsedHours = (elapsed / 60).toFixed(1);
      const frTargetHours = (policy.first_response_minutes / 60).toFixed(1);

      if (frPct >= 100) {
        await sendSlaNotification(
          supabase, timer.id, 'breached_first_response',
          'sla_breached_first_response',
          ticket, frElapsedHours, frTargetHours, frPct,
          adminIds,
        );
        processed++;
      } else if (frPct >= threshold) {
        await sendSlaNotification(
          supabase, timer.id, 'approaching_first_response',
          'sla_approaching_first_response',
          ticket, frElapsedHours, frTargetHours, frPct,
          adminIds,
        );
        processed++;
      }
    }

    // Check resolution
    if (timer.resolution_met === null) {
      const resPct = calculateSlaPercentage(elapsed, policy.resolution_minutes);
      const resElapsedHours = (elapsed / 60).toFixed(1);
      const resTargetHours = (policy.resolution_minutes / 60).toFixed(1);

      if (resPct >= 100) {
        await sendSlaNotification(
          supabase, timer.id, 'breached_resolution',
          'sla_breached_resolution',
          ticket, resElapsedHours, resTargetHours, resPct,
          adminIds,
        );
        processed++;
      } else if (resPct >= threshold) {
        await sendSlaNotification(
          supabase, timer.id, 'approaching_resolution',
          'sla_approaching_resolution',
          ticket, resElapsedHours, resTargetHours, resPct,
          adminIds,
        );
        processed++;
      }
    }
  }

  return NextResponse.json({ processed });
}

async function sendSlaNotification(
  supabase: ReturnType<typeof createServiceRoleClient>,
  timerId: string,
  notificationType: string,
  eventType: string,
  ticket: { id: number; title: string; slug: string; assigned_agent_id: string | null },
  elapsedTime: string,
  targetTime: string,
  percentage: number,
  adminIds: string[],
) {
  // Check if already sent (dedup)
  const { data: existing } = await supabase
    .from('sla_notifications_sent')
    .select('id')
    .eq('sla_timer_id', timerId)
    .eq('notification_type', notificationType)
    .single();

  if (existing) return;

  // Record that we sent this notification
  await supabase.from('sla_notifications_sent').insert({
    sla_timer_id: timerId,
    notification_type: notificationType,
  });

  const placeholders = {
    ticketId: String(ticket.id),
    ticketTitle: ticket.title,
    elapsedTime: `${elapsedTime}h`,
    targetTime: `${targetTime}h`,
    percentage: String(percentage),
  };

  // Notify assigned agent (if any)
  if (ticket.assigned_agent_id) {
    notifyAgent(ticket.assigned_agent_id, eventType, ticket.id, placeholders).catch(
      (err) => console.error('[sla-notify]', err),
    );
  }

  // Notify all admins
  for (const adminId of adminIds) {
    if (adminId !== ticket.assigned_agent_id) {
      notifyAgent(adminId, eventType, ticket.id, placeholders).catch(
        (err) => console.error('[sla-notify]', err),
      );
    }
  }
}
