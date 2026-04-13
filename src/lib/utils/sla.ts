/**
 * SLA timer management — initialize, pause, resume, stop, recalculate timers.
 */

import { createServiceRoleClient } from '@/lib/supabase/server';
import {
  type BusinessHoursConfig,
  calculateBusinessMinutesElapsed,
  addBusinessMinutes,
  calculateSlaPercentage,
} from '@/lib/utils/business-hours';

export type SlaIndicatorStatus = 'on_track' | 'approaching' | 'breached' | 'met' | 'no_sla';

export type SlaIndicator = {
  status: SlaIndicatorStatus;
  elapsedMinutes: number;
  targetMinutes: number;
  percentage: number;
  deadline: Date | null;
  completedAt: Date | null;
};

export type SlaStatus = {
  firstResponse: SlaIndicator;
  resolution: SlaIndicator;
};

async function getBusinessHoursConfig(): Promise<BusinessHoursConfig> {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'sla_business_hours')
    .single();

  if (data?.value) {
    try {
      return JSON.parse(data.value) as BusinessHoursConfig;
    } catch {
      // fall through to default
    }
  }

  return {
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

async function getApproachingThreshold(): Promise<number> {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'sla_approaching_threshold')
    .single();

  const val = data?.value ? parseInt(data.value, 10) : 75;
  return Number.isFinite(val) && val >= 50 && val <= 95 ? val : 75;
}

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

  // Calculate elapsed business minutes for first response (if not yet met)
  let firstResponseElapsed = timer.first_response_elapsed_minutes;
  if (timer.first_response_met === null) {
    const timerStart = timer.first_response_paused_at
      ? new Date(timer.first_response_paused_at)
      : new Date(timer.created_at);
    firstResponseElapsed += calculateBusinessMinutesElapsed(timerStart, now, config);
  }

  // Calculate elapsed business minutes for resolution (if not yet met)
  let resolutionElapsed = timer.resolution_elapsed_minutes;
  if (timer.resolution_met === null) {
    const timerStart = timer.resolution_paused_at
      ? new Date(timer.resolution_paused_at)
      : new Date(timer.created_at);
    resolutionElapsed += calculateBusinessMinutesElapsed(timerStart, now, config);
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

  // Calculate remaining minutes and new deadlines
  let firstResponseDeadline: Date | null = null;
  if (timer.first_response_met === null) {
    const remaining = Math.max(0, policy.first_response_minutes - timer.first_response_elapsed_minutes);
    firstResponseDeadline = addBusinessMinutes(now, remaining, config);
  }

  let resolutionDeadline: Date | null = null;
  if (timer.resolution_met === null) {
    const remaining = Math.max(0, policy.resolution_minutes - timer.resolution_elapsed_minutes);
    resolutionDeadline = addBusinessMinutes(now, remaining, config);
  }

  await supabase
    .from('sla_timers')
    .update({
      is_paused: false,
      first_response_paused_at: null,
      resolution_paused_at: null,
      first_response_deadline: firstResponseDeadline?.toISOString() ?? timer.first_response_deadline,
      resolution_deadline: resolutionDeadline?.toISOString() ?? timer.resolution_deadline,
      updated_at: now.toISOString(),
    })
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

  const config = await getBusinessHoursConfig();
  const now = new Date();

  let elapsed = timer.first_response_elapsed_minutes;
  if (!timer.is_paused) {
    const sinceLastResume = timer.first_response_paused_at
      ? new Date(timer.first_response_paused_at)
      : new Date(timer.created_at);
    elapsed += calculateBusinessMinutesElapsed(sinceLastResume, now, config);
  }

  const { data: policy } = await supabase
    .from('sla_policies')
    .select('first_response_minutes')
    .eq('id', timer.sla_policy_id)
    .single();

  const target = policy?.first_response_minutes ?? elapsed;
  const met = elapsed <= target;

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

  const config = await getBusinessHoursConfig();
  const now = new Date();

  let elapsed = timer.resolution_elapsed_minutes;
  if (!timer.is_paused) {
    const sinceLastResume = timer.resolution_paused_at
      ? new Date(timer.resolution_paused_at)
      : new Date(timer.created_at);
    elapsed += calculateBusinessMinutesElapsed(sinceLastResume, now, config);
  }

  const { data: policy } = await supabase
    .from('sla_policies')
    .select('resolution_minutes')
    .eq('id', timer.sla_policy_id)
    .single();

  const target = policy?.resolution_minutes ?? elapsed;
  const met = elapsed <= target;

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

export async function recalculateSlaTargets(
  ticketId: number,
  newSeverity: string,
): Promise<void> {
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

  if (!timer) {
    // No existing timer — create one
    await initializeSlaTimer(ticketId, newSeverity);
    return;
  }

  const config = await getBusinessHoursConfig();
  const now = new Date();

  // Calculate current elapsed for running timers
  let firstResponseElapsed = timer.first_response_elapsed_minutes;
  if (timer.first_response_met === null && !timer.is_paused) {
    const since = timer.first_response_paused_at
      ? new Date(timer.first_response_paused_at)
      : new Date(timer.created_at);
    firstResponseElapsed += calculateBusinessMinutesElapsed(since, now, config);
  }

  let resolutionElapsed = timer.resolution_elapsed_minutes;
  if (timer.resolution_met === null && !timer.is_paused) {
    const since = timer.resolution_paused_at
      ? new Date(timer.resolution_paused_at)
      : new Date(timer.created_at);
    resolutionElapsed += calculateBusinessMinutesElapsed(since, now, config);
  }

  // Recalculate deadlines with new policy targets preserving elapsed time
  let firstResponseDeadline: string | null = null;
  let firstResponseMet = timer.first_response_met;
  if (timer.first_response_met === null && !timer.is_paused) {
    const remaining = Math.max(0, policy.first_response_minutes - firstResponseElapsed);
    if (remaining === 0) {
      // Already breached with new target
      firstResponseMet = false;
    }
    firstResponseDeadline = addBusinessMinutes(now, remaining, config).toISOString();
  }

  let resolutionDeadline: string | null = null;
  let resolutionMet = timer.resolution_met;
  if (timer.resolution_met === null && !timer.is_paused) {
    const remaining = Math.max(0, policy.resolution_minutes - resolutionElapsed);
    if (remaining === 0) {
      resolutionMet = false;
    }
    resolutionDeadline = addBusinessMinutes(now, remaining, config).toISOString();
  }

  await supabase
    .from('sla_timers')
    .update({
      sla_policy_id: policy.id,
      first_response_elapsed_minutes: firstResponseElapsed,
      resolution_elapsed_minutes: resolutionElapsed,
      first_response_deadline: firstResponseDeadline ?? timer.first_response_deadline,
      resolution_deadline: resolutionDeadline ?? timer.resolution_deadline,
      first_response_met: firstResponseMet,
      resolution_met: resolutionMet,
      updated_at: now.toISOString(),
    })
    .eq('ticket_id', ticketId);
}

export async function getSlaStatusForTimer(timer: {
  sla_policy_id: string | null;
  first_response_elapsed_minutes: number;
  resolution_elapsed_minutes: number;
  first_response_met: boolean | null;
  resolution_met: boolean | null;
  first_response_at: string | null;
  resolved_at: string | null;
  first_response_deadline: string | null;
  resolution_deadline: string | null;
  is_paused: boolean;
  created_at: string;
  first_response_paused_at: string | null;
  resolution_paused_at: string | null;
}): Promise<SlaStatus> {
  const noSla: SlaIndicator = {
    status: 'no_sla',
    elapsedMinutes: 0,
    targetMinutes: 0,
    percentage: 0,
    deadline: null,
    completedAt: null,
  };

  if (!timer.sla_policy_id) {
    return { firstResponse: noSla, resolution: noSla };
  }

  const supabase = createServiceRoleClient();
  const { data: policy } = await supabase
    .from('sla_policies')
    .select('first_response_minutes, resolution_minutes')
    .eq('id', timer.sla_policy_id)
    .single();

  if (!policy) {
    return { firstResponse: noSla, resolution: noSla };
  }

  const config = await getBusinessHoursConfig();
  const threshold = await getApproachingThreshold();
  const now = new Date();

  function computeIndicator(
    elapsedStored: number,
    met: boolean | null,
    completedAt: string | null,
    deadline: string | null,
    targetMinutes: number,
    isPaused: boolean,
    pausedAt: string | null,
    createdAt: string,
  ): SlaIndicator {
    if (met === true) {
      return {
        status: 'met',
        elapsedMinutes: elapsedStored,
        targetMinutes,
        percentage: calculateSlaPercentage(elapsedStored, targetMinutes),
        deadline: deadline ? new Date(deadline) : null,
        completedAt: completedAt ? new Date(completedAt) : null,
      };
    }

    if (met === false) {
      return {
        status: 'breached',
        elapsedMinutes: elapsedStored,
        targetMinutes,
        percentage: calculateSlaPercentage(elapsedStored, targetMinutes),
        deadline: deadline ? new Date(deadline) : null,
        completedAt: completedAt ? new Date(completedAt) : null,
      };
    }

    // Timer is still running — calculate live elapsed
    let currentElapsed = elapsedStored;
    if (!isPaused) {
      const since = pausedAt ? new Date(pausedAt) : new Date(createdAt);
      currentElapsed += calculateBusinessMinutesElapsed(since, now, config);
    }

    const percentage = calculateSlaPercentage(currentElapsed, targetMinutes);

    let status: SlaIndicatorStatus = 'on_track';
    if (currentElapsed >= targetMinutes) {
      status = 'breached';
    } else if (percentage >= threshold) {
      status = 'approaching';
    }

    return {
      status,
      elapsedMinutes: currentElapsed,
      targetMinutes,
      percentage,
      deadline: deadline ? new Date(deadline) : null,
      completedAt: null,
    };
  }

  return {
    firstResponse: computeIndicator(
      timer.first_response_elapsed_minutes,
      timer.first_response_met,
      timer.first_response_at,
      timer.first_response_deadline,
      policy.first_response_minutes,
      timer.is_paused,
      timer.first_response_paused_at,
      timer.created_at,
    ),
    resolution: computeIndicator(
      timer.resolution_elapsed_minutes,
      timer.resolution_met,
      timer.resolved_at,
      timer.resolution_deadline,
      policy.resolution_minutes,
      timer.is_paused,
      timer.resolution_paused_at,
      timer.created_at,
    ),
  };
}
