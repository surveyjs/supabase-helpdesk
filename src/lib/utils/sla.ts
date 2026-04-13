import { createServiceRoleClient } from '@/lib/supabase/server';
import {
  getBusinessHoursConfig,
  calculateBusinessMinutesElapsed,
  addBusinessMinutes,
  calculateSlaPercentage,
  type BusinessHoursConfig,
} from '@/lib/utils/business-hours';

export type SlaTimer = {
  id: string;
  ticket_id: number;
  sla_policy_id: string | null;
  first_response_deadline: string | null;
  resolution_deadline: string | null;
  first_response_elapsed_minutes: number;
  resolution_elapsed_minutes: number;
  first_response_paused_at: string | null;
  resolution_paused_at: string | null;
  first_response_met: boolean | null;
  resolution_met: boolean | null;
  first_response_at: string | null;
  resolved_at: string | null;
  is_paused: boolean;
  created_at: string;
  updated_at: string;
};

export type SlaIndicatorStatus = 'on_track' | 'approaching' | 'breached' | 'met' | 'no_sla';

export type SlaIndicator = {
  status: SlaIndicatorStatus;
  elapsedMinutes: number;
  targetMinutes: number;
  percentage: number;
  deadline: string | null;
  completedAt: string | null;
};

export type SlaStatus = {
  firstResponse: SlaIndicator;
  resolution: SlaIndicator;
};

export async function initializeSlaTimer(ticketId: number, severity: string): Promise<void> {
  const supabase = createServiceRoleClient();

  // Look up the SLA policy for the given severity
  const { data: mapping } = await supabase
    .from('sla_severity_mapping')
    .select('sla_policy_id')
    .eq('severity', severity)
    .single();

  if (!mapping?.sla_policy_id) return; // No SLA tracking

  const { data: policy } = await supabase
    .from('sla_policies')
    .select('id, first_response_minutes, resolution_minutes')
    .eq('id', mapping.sla_policy_id)
    .single();

  if (!policy) return;

  const config = await getBusinessHoursConfig();
  const now = new Date();

  const firstResponseDeadline = addBusinessMinutes(now, policy.first_response_minutes, config);
  const resolutionDeadline = addBusinessMinutes(now, policy.resolution_minutes, config);

  await supabase.from('sla_timers').upsert(
    {
      ticket_id: ticketId,
      sla_policy_id: policy.id,
      first_response_deadline: firstResponseDeadline.toISOString(),
      resolution_deadline: resolutionDeadline.toISOString(),
      first_response_elapsed_minutes: 0,
      resolution_elapsed_minutes: 0,
      is_paused: false,
    },
    { onConflict: 'ticket_id' },
  );
}

export async function pauseSlaTimer(ticketId: number): Promise<void> {
  const supabase = createServiceRoleClient();

  const { data: timer } = await supabase
    .from('sla_timers')
    .select('*')
    .eq('ticket_id', ticketId)
    .single();

  if (!timer || timer.is_paused) return;

  const config = await getBusinessHoursConfig();
  const now = new Date();

  // Calculate elapsed business minutes so far
  let firstResponseElapsed = timer.first_response_elapsed_minutes;
  let resolutionElapsed = timer.resolution_elapsed_minutes;

  if (timer.first_response_met === null) {
    // Timer is running — calculate from the last resume point or creation
    const startRef = timer.first_response_paused_at
      ? new Date(timer.first_response_paused_at)
      : new Date(timer.created_at);
    firstResponseElapsed += calculateBusinessMinutesElapsed(startRef, now, config);
  }

  if (timer.resolution_met === null) {
    const startRef = timer.resolution_paused_at
      ? new Date(timer.resolution_paused_at)
      : new Date(timer.created_at);
    resolutionElapsed += calculateBusinessMinutesElapsed(startRef, now, config);
  }

  await supabase
    .from('sla_timers')
    .update({
      is_paused: true,
      first_response_elapsed_minutes: firstResponseElapsed,
      resolution_elapsed_minutes: resolutionElapsed,
      first_response_paused_at: now.toISOString(),
      resolution_paused_at: now.toISOString(),
      first_response_deadline: null,
      resolution_deadline: null,
      updated_at: now.toISOString(),
    })
    .eq('ticket_id', ticketId);
}

export async function resumeSlaTimer(ticketId: number): Promise<void> {
  const supabase = createServiceRoleClient();

  const { data: timer } = await supabase
    .from('sla_timers')
    .select('*')
    .eq('ticket_id', ticketId)
    .single();

  if (!timer) return;

  const { data: policy } = await supabase
    .from('sla_policies')
    .select('first_response_minutes, resolution_minutes')
    .eq('id', timer.sla_policy_id)
    .single();

  if (!policy) return;

  const config = await getBusinessHoursConfig();
  const now = new Date();

  // Recalculate deadlines from remaining minutes
  const updates: Record<string, unknown> = {
    is_paused: false,
    first_response_paused_at: null,
    resolution_paused_at: null,
    updated_at: now.toISOString(),
  };

  if (timer.first_response_met === null) {
    const remainingFr = Math.max(0, policy.first_response_minutes - timer.first_response_elapsed_minutes);
    updates.first_response_deadline = addBusinessMinutes(now, remainingFr, config).toISOString();
  }

  if (timer.resolution_met === null) {
    const remainingRes = Math.max(0, policy.resolution_minutes - timer.resolution_elapsed_minutes);
    updates.resolution_deadline = addBusinessMinutes(now, remainingRes, config).toISOString();
  }

  await supabase
    .from('sla_timers')
    .update(updates)
    .eq('ticket_id', ticketId);
}

export async function stopFirstResponseTimer(ticketId: number): Promise<void> {
  const supabase = createServiceRoleClient();

  const { data: timer } = await supabase
    .from('sla_timers')
    .select('*')
    .eq('ticket_id', ticketId)
    .single();

  if (!timer || timer.first_response_met !== null) return;

  const { data: policy } = await supabase
    .from('sla_policies')
    .select('first_response_minutes')
    .eq('id', timer.sla_policy_id)
    .single();

  const config = await getBusinessHoursConfig();
  const now = new Date();

  let elapsed = timer.first_response_elapsed_minutes;
  if (!timer.is_paused) {
    const startRef = new Date(timer.created_at);
    elapsed = calculateBusinessMinutesElapsed(startRef, now, config);
  }

  const targetMinutes = policy?.first_response_minutes ?? 0;
  const met = elapsed <= targetMinutes;

  await supabase
    .from('sla_timers')
    .update({
      first_response_at: now.toISOString(),
      first_response_elapsed_minutes: elapsed,
      first_response_met: met,
      updated_at: now.toISOString(),
    })
    .eq('ticket_id', ticketId);
}

export async function stopResolutionTimer(ticketId: number): Promise<void> {
  const supabase = createServiceRoleClient();

  const { data: timer } = await supabase
    .from('sla_timers')
    .select('*')
    .eq('ticket_id', ticketId)
    .single();

  if (!timer || timer.resolution_met !== null) return;

  const { data: policy } = await supabase
    .from('sla_policies')
    .select('resolution_minutes')
    .eq('id', timer.sla_policy_id)
    .single();

  const config = await getBusinessHoursConfig();
  const now = new Date();

  let elapsed = timer.resolution_elapsed_minutes;
  if (!timer.is_paused) {
    const startRef = new Date(timer.created_at);
    elapsed = calculateBusinessMinutesElapsed(startRef, now, config);
  }

  const targetMinutes = policy?.resolution_minutes ?? 0;
  const met = elapsed <= targetMinutes;

  await supabase
    .from('sla_timers')
    .update({
      resolved_at: now.toISOString(),
      resolution_elapsed_minutes: elapsed,
      resolution_met: met,
      updated_at: now.toISOString(),
    })
    .eq('ticket_id', ticketId);
}

export async function recalculateSlaTargets(ticketId: number, newSeverity: string): Promise<void> {
  const supabase = createServiceRoleClient();

  // Look up the SLA policy for the new severity
  const { data: mapping } = await supabase
    .from('sla_severity_mapping')
    .select('sla_policy_id')
    .eq('severity', newSeverity)
    .single();

  if (!mapping?.sla_policy_id) {
    // No SLA applies — delete the timer
    await supabase.from('sla_timers').delete().eq('ticket_id', ticketId);
    return;
  }

  const { data: policy } = await supabase
    .from('sla_policies')
    .select('id, first_response_minutes, resolution_minutes')
    .eq('id', mapping.sla_policy_id)
    .single();

  if (!policy) {
    await supabase.from('sla_timers').delete().eq('ticket_id', ticketId);
    return;
  }

  const { data: timer } = await supabase
    .from('sla_timers')
    .select('*')
    .eq('ticket_id', ticketId)
    .single();

  const config = await getBusinessHoursConfig();
  const now = new Date();

  if (!timer) {
    // No existing timer — initialize one (preserve behavior from creation)
    const firstResponseDeadline = addBusinessMinutes(now, policy.first_response_minutes, config);
    const resolutionDeadline = addBusinessMinutes(now, policy.resolution_minutes, config);

    await supabase.from('sla_timers').insert({
      ticket_id: ticketId,
      sla_policy_id: policy.id,
      first_response_deadline: firstResponseDeadline.toISOString(),
      resolution_deadline: resolutionDeadline.toISOString(),
    });
    return;
  }

  // Preserve existing elapsed time and recalculate remaining deadlines
  const updates: Record<string, unknown> = {
    sla_policy_id: policy.id,
    updated_at: now.toISOString(),
  };

  // Calculate current elapsed if timer is running (not paused)
  let currentFrElapsed = timer.first_response_elapsed_minutes;
  let currentResElapsed = timer.resolution_elapsed_minutes;

  if (!timer.is_paused) {
    if (timer.first_response_met === null) {
      currentFrElapsed = calculateBusinessMinutesElapsed(
        new Date(timer.created_at),
        now,
        config,
      );
      updates.first_response_elapsed_minutes = currentFrElapsed;
    }
    if (timer.resolution_met === null) {
      currentResElapsed = calculateBusinessMinutesElapsed(
        new Date(timer.created_at),
        now,
        config,
      );
      updates.resolution_elapsed_minutes = currentResElapsed;
    }
  }

  // Recalculate deadlines for incomplete timers
  if (timer.first_response_met === null && !timer.is_paused) {
    const remainingFr = Math.max(0, policy.first_response_minutes - currentFrElapsed);
    updates.first_response_deadline = addBusinessMinutes(now, remainingFr, config).toISOString();

    // Check if already breached
    if (currentFrElapsed > policy.first_response_minutes) {
      updates.first_response_met = false;
    }
  }

  if (timer.resolution_met === null && !timer.is_paused) {
    const remainingRes = Math.max(0, policy.resolution_minutes - currentResElapsed);
    updates.resolution_deadline = addBusinessMinutes(now, remainingRes, config).toISOString();

    if (currentResElapsed > policy.resolution_minutes) {
      updates.resolution_met = false;
    }
  }

  await supabase
    .from('sla_timers')
    .update(updates)
    .eq('ticket_id', ticketId);
}

export async function getSlaStatus(
  timer: SlaTimer,
  config?: BusinessHoursConfig,
  threshold?: number,
): Promise<SlaStatus> {
  const bhConfig = config ?? await getBusinessHoursConfig();
  const approachingThreshold = threshold ?? 75;
  const now = new Date();

  function getIndicator(
    elapsed: number,
    targetMinutes: number,
    deadline: string | null,
    met: boolean | null,
    completedAt: string | null,
    pausedAt: string | null,
    isPaused: boolean,
    timerCreatedAt: string,
  ): SlaIndicator {
    // Completed
    if (met !== null) {
      return {
        status: met ? 'met' : 'breached',
        elapsedMinutes: elapsed,
        targetMinutes,
        percentage: calculateSlaPercentage(elapsed, targetMinutes),
        deadline,
        completedAt,
      };
    }

    // Calculate live elapsed for running timers
    let liveElapsed = elapsed;
    if (!isPaused) {
      liveElapsed = calculateBusinessMinutesElapsed(
        new Date(timerCreatedAt),
        now,
        bhConfig,
      );
    }

    const pct = calculateSlaPercentage(liveElapsed, targetMinutes);

    let status: SlaIndicatorStatus = 'on_track';
    if (pct >= 100) {
      status = 'breached';
    } else if (pct >= approachingThreshold) {
      status = 'approaching';
    }

    return {
      status,
      elapsedMinutes: liveElapsed,
      targetMinutes,
      percentage: pct,
      deadline,
      completedAt,
    };
  }

  // Get policy for target minutes
  let frTarget = 0;
  let resTarget = 0;
  if (timer.sla_policy_id) {
    const supabase = createServiceRoleClient();
    const { data: policy } = await supabase
      .from('sla_policies')
      .select('first_response_minutes, resolution_minutes')
      .eq('id', timer.sla_policy_id)
      .single();
    if (policy) {
      frTarget = policy.first_response_minutes;
      resTarget = policy.resolution_minutes;
    }
  }

  return {
    firstResponse: getIndicator(
      timer.first_response_elapsed_minutes,
      frTarget,
      timer.first_response_deadline,
      timer.first_response_met,
      timer.first_response_at,
      timer.first_response_paused_at,
      timer.is_paused,
      timer.created_at,
    ),
    resolution: getIndicator(
      timer.resolution_elapsed_minutes,
      resTarget,
      timer.resolution_deadline,
      timer.resolution_met,
      timer.resolved_at,
      timer.resolution_paused_at,
      timer.is_paused,
      timer.created_at,
    ),
  };
}
