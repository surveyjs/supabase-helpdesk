import { createServiceRoleClient } from '@/lib/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';

export type TimeRange = { start: Date; end: Date };
export type ReportFilters = {
  status?: string;
  severity?: string;
  type?: string;
  category?: string;
  agentId?: string;
  tier?: string;
};

export type TicketVolumeRow = { period: string; count: number; status?: string };
export type ResolutionMetrics = {
  avgFirstResponse: number;
  avgResolution: number;
  medianResolution: number;
  bySeverity: Record<string, { avgFirstResponse: number; avgResolution: number; medianResolution: number }>;
};
export type AgentPerformanceRow = {
  agentId: string;
  displayName: string;
  assigned: number;
  resolved: number;
  avgResponseTime: number;
  avgResolutionTime: number;
  avgCsat: number;
};
export type CsatSummaryData = {
  average: number;
  distribution: Record<number, number>;
  trend: Array<{ period: string; average: number }>;
};
export type SlaComplianceData = {
  firstResponseCompliance: number;
  resolutionCompliance: number;
  bySeverity: Record<string, { firstResponseCompliance: number; resolutionCompliance: number }>;
  breachedTickets: Array<{ ticketId: number; title: string; slaType: string; target: number; actual: number }>;
};
export type BacklogData = {
  open: number;
  pending: number;
  bySeverity: Record<string, { open: number; pending: number }>;
  unassigned: number;
  trend: Array<{ date: string; open: number; pending: number }>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyFilters(q: any, timeRange: TimeRange, filters?: ReportFilters, agentScope?: string, tierCreatorIds?: string[]) {
  let result = q
    .gte('created_at', timeRange.start.toISOString())
    .lte('created_at', timeRange.end.toISOString());
  if (filters?.status) result = result.eq('status', filters.status);
  if (filters?.severity) result = result.eq('severity', filters.severity);
  if (filters?.type) result = result.eq('type_id', filters.type);
  if (filters?.category) result = result.eq('category_id', filters.category);
  if (agentScope) result = result.eq('assigned_agent_id', agentScope);
  if (tierCreatorIds) result = result.in('creator_id', tierCreatorIds);
  return result;
}

async function getTierCreatorIds(filters?: ReportFilters, client?: SupabaseClient): Promise<string[] | undefined> {
  if (!filters?.tier) return undefined;
  const supabase = client ?? createServiceRoleClient();
  if (filters.tier === 'none') {
    const { data } = await supabase.from('profiles').select('id').is('tier_id', null);
    return (data ?? []).map((p) => p.id);
  }
  // Find tier by key then find users with that tier
  const { data: tier } = await supabase.from('subscription_tiers').select('id').eq('key', filters.tier).single();
  if (!tier) return [];
  const { data } = await supabase.from('profiles').select('id').eq('tier_id', tier.id);
  return (data ?? []).map((p) => p.id);
}

// ---- Ticket Volume ----

export async function getTicketVolumeData(
  timeRange: TimeRange,
  groupBy: 'day' | 'week' | 'month',
  filters?: ReportFilters,
  agentScope?: string,
  client?: SupabaseClient,
): Promise<TicketVolumeRow[]> {
  const supabase = client ?? createServiceRoleClient();
  const tierCreatorIds = await getTierCreatorIds(filters, supabase);
  if (tierCreatorIds && tierCreatorIds.length === 0) return [];
  const q = applyFilters(supabase.from('tickets').select('created_at, status'), timeRange, filters, agentScope, tierCreatorIds);
  const { data: tickets } = await q;
  if (!tickets || tickets.length === 0) return [];

  const grouped: Record<string, Record<string, number>> = {};
  for (const t of tickets) {
    const d = new Date(t.created_at);
    let key: string;
    if (groupBy === 'day') {
      key = d.toISOString().slice(0, 10);
    } else if (groupBy === 'week') {
      const dayOfWeek = d.getUTCDay();
      const weekStart = new Date(d);
      weekStart.setUTCDate(d.getUTCDate() - dayOfWeek);
      key = weekStart.toISOString().slice(0, 10);
    } else {
      key = d.toISOString().slice(0, 7);
    }
    if (!grouped[key]) grouped[key] = {};
    const status = t.status || 'unknown';
    grouped[key][status] = (grouped[key][status] || 0) + 1;
  }

  const rows: TicketVolumeRow[] = [];
  for (const [period, statuses] of Object.entries(grouped)) {
    let total = 0;
    for (const [status, count] of Object.entries(statuses)) {
      rows.push({ period, count, status });
      total += count;
    }
    rows.push({ period, count: total });
  }
  rows.sort((a, b) => a.period.localeCompare(b.period));
  return rows;
}

// ---- Resolution Metrics ----

export async function getResolutionMetrics(
  timeRange: TimeRange,
  filters?: ReportFilters,
  agentScope?: string,
  client?: SupabaseClient,
): Promise<ResolutionMetrics> {
  const supabase = client ?? createServiceRoleClient();

  // Get tickets with SLA timers joined
  const tierCreatorIds = await getTierCreatorIds(filters, supabase);
  if (tierCreatorIds && tierCreatorIds.length === 0) return { avgFirstResponse: 0, avgResolution: 0, medianResolution: 0, bySeverity: {} };
  const q = applyFilters(
    supabase
      .from('tickets')
      .select('id, severity, created_at, sla_timers(first_response_at, resolved_at)')
      .not('sla_timers', 'is', null),
    timeRange, filters, agentScope, tierCreatorIds,
  );
  const { data: tickets } = await q;

  const empty: ResolutionMetrics = { avgFirstResponse: 0, avgResolution: 0, medianResolution: 0, bySeverity: {} };
  if (!tickets || tickets.length === 0) return empty;

  const firstResponseTimes: number[] = [];
  const resolutionTimes: number[] = [];
  const bySev: Record<string, { fr: number[]; res: number[] }> = {};

  for (const t of tickets) {
    const sla = Array.isArray(t.sla_timers) ? t.sla_timers[0] : t.sla_timers;
    if (!sla) continue;
    const created = new Date(t.created_at).getTime();
    const sev = t.severity || 'medium';
    if (!bySev[sev]) bySev[sev] = { fr: [], res: [] };

    if (sla.first_response_at) {
      const mins = (new Date(sla.first_response_at).getTime() - created) / 60000;
      firstResponseTimes.push(mins);
      bySev[sev].fr.push(mins);
    }
    if (sla.resolved_at) {
      const mins = (new Date(sla.resolved_at).getTime() - created) / 60000;
      resolutionTimes.push(mins);
      bySev[sev].res.push(mins);
    }
  }

  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const median = (arr: number[]) => {
    if (arr.length === 0) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };

  const bySeverity: ResolutionMetrics['bySeverity'] = {};
  for (const [sev, data] of Object.entries(bySev)) {
    bySeverity[sev] = {
      avgFirstResponse: avg(data.fr),
      avgResolution: avg(data.res),
      medianResolution: median(data.res),
    };
  }

  return {
    avgFirstResponse: avg(firstResponseTimes),
    avgResolution: avg(resolutionTimes),
    medianResolution: median(resolutionTimes),
    bySeverity,
  };
}

// ---- Agent Performance ----

export async function getAgentPerformanceData(
  timeRange: TimeRange,
  agentId?: string,
  client?: SupabaseClient,
): Promise<AgentPerformanceRow[]> {
  const supabase = client ?? createServiceRoleClient();

  // Get tickets in range with assigned agents
  let q = supabase
    .from('tickets')
    .select('id, assigned_agent_id, status, created_at, sla_timers(first_response_at, resolved_at)')
    .not('assigned_agent_id', 'is', null)
    .gte('created_at', timeRange.start.toISOString())
    .lte('created_at', timeRange.end.toISOString());
  if (agentId) q = q.eq('assigned_agent_id', agentId);
  const { data: tickets } = await q;

  if (!tickets || tickets.length === 0) return [];

  // Get CSAT ratings
  const ticketIds = tickets.map((t) => t.id);
  const { data: csatRatings } = await supabase
    .from('csat_ratings')
    .select('ticket_id, rating')
    .in('ticket_id', ticketIds)
    .not('rating', 'is', null);

  const csatByTicket: Record<number, number> = {};
  for (const r of csatRatings || []) {
    csatByTicket[r.ticket_id] = r.rating!;
  }

  // Get agent profiles
  const agentIds = [...new Set(tickets.map((t) => t.assigned_agent_id!))];
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, display_name, email')
    .in('id', agentIds);
  const profileMap: Record<string, string> = {};
  for (const p of profiles || []) {
    profileMap[p.id] = p.display_name || p.email;
  }

  // Aggregate per agent
  const agentData: Record<string, { assigned: number; resolved: number; frTimes: number[]; resTimes: number[]; csats: number[] }> = {};
  for (const t of tickets) {
    const aid = t.assigned_agent_id!;
    if (!agentData[aid]) agentData[aid] = { assigned: 0, resolved: 0, frTimes: [], resTimes: [], csats: [] };
    agentData[aid].assigned++;
    if (t.status === 'closed') agentData[aid].resolved++;

    const sla = Array.isArray(t.sla_timers) ? t.sla_timers[0] : t.sla_timers;
    if (sla) {
      const created = new Date(t.created_at).getTime();
      if (sla.first_response_at) agentData[aid].frTimes.push((new Date(sla.first_response_at).getTime() - created) / 60000);
      if (sla.resolved_at) agentData[aid].resTimes.push((new Date(sla.resolved_at).getTime() - created) / 60000);
    }
    if (csatByTicket[t.id] !== undefined) agentData[aid].csats.push(csatByTicket[t.id]);
  }

  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

  return Object.entries(agentData).map(([aid, d]) => ({
    agentId: aid,
    displayName: profileMap[aid] || 'Unknown',
    assigned: d.assigned,
    resolved: d.resolved,
    avgResponseTime: avg(d.frTimes),
    avgResolutionTime: avg(d.resTimes),
    avgCsat: avg(d.csats),
  }));
}

// ---- CSAT Summary ----

export async function getCsatSummaryData(
  timeRange: TimeRange,
  agentScope?: string,
  client?: SupabaseClient,
  filters?: ReportFilters,
): Promise<CsatSummaryData> {
  const supabase = client ?? createServiceRoleClient();

  // If tier filter, pre-filter by creator IDs
  const tierCreatorIds = await getTierCreatorIds(filters, supabase);
  let tierTicketIds: number[] | null = null;
  if (tierCreatorIds) {
    if (tierCreatorIds.length === 0) return { average: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, trend: [] };
    const { data: tierTickets } = await supabase
      .from('tickets')
      .select('id')
      .in('creator_id', tierCreatorIds);
    tierTicketIds = (tierTickets ?? []).map((t) => t.id);
    if (tierTicketIds.length === 0) return { average: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, trend: [] };
  }

  let q = supabase
    .from('csat_ratings')
    .select('rating, submitted_at, ticket_id')
    .not('rating', 'is', null)
    .gte('submitted_at', timeRange.start.toISOString())
    .lte('submitted_at', timeRange.end.toISOString());

  // If agent-scoped, filter by tickets assigned to agent
  if (agentScope) {
    const { data: agentTickets } = await supabase
      .from('tickets')
      .select('id')
      .eq('assigned_agent_id', agentScope);
    const ids = (agentTickets || []).map((t) => t.id);
    if (ids.length === 0) return { average: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, trend: [] };
    q = q.in('ticket_id', ids);
  }

  // Filter by tier
  if (tierTicketIds) {
    q = q.in('ticket_id', tierTicketIds);
  }

  const { data: ratings } = await q;
  if (!ratings || ratings.length === 0) return { average: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, trend: [] };

  const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0;
  for (const r of ratings) {
    distribution[r.rating!] = (distribution[r.rating!] || 0) + 1;
    sum += r.rating!;
  }
  const average = sum / ratings.length;

  // Trend: monthly
  const trendMap: Record<string, { sum: number; count: number }> = {};
  for (const r of ratings) {
    const month = new Date(r.submitted_at!).toISOString().slice(0, 7);
    if (!trendMap[month]) trendMap[month] = { sum: 0, count: 0 };
    trendMap[month].sum += r.rating!;
    trendMap[month].count++;
  }
  const trend = Object.entries(trendMap)
    .map(([period, d]) => ({ period, average: d.sum / d.count }))
    .sort((a, b) => a.period.localeCompare(b.period));

  return { average, distribution, trend };
}

// ---- SLA Compliance ----

export async function getSlaComplianceData(
  timeRange: TimeRange,
  agentScope?: string,
  client?: SupabaseClient,
): Promise<SlaComplianceData> {
  const supabase = client ?? createServiceRoleClient();

  let q = supabase
    .from('sla_timers')
    .select('ticket_id, first_response_met, resolution_met, first_response_elapsed_minutes, resolution_elapsed_minutes, sla_policies(first_response_minutes, resolution_minutes), tickets!inner(id, title, severity, created_at, assigned_agent_id)')
    .gte('created_at', timeRange.start.toISOString())
    .lte('created_at', timeRange.end.toISOString());

  if (agentScope) {
    q = q.eq('tickets.assigned_agent_id', agentScope);
  }

  const { data: timers } = await q;
  if (!timers || timers.length === 0) {
    return { firstResponseCompliance: 0, resolutionCompliance: 0, bySeverity: {}, breachedTickets: [] };
  }

  let frMet = 0;
  let frTotal = 0;
  let resMet = 0;
  let resTotal = 0;
  const bySev: Record<string, { frMet: number; frTotal: number; resMet: number; resTotal: number }> = {};
  const breached: SlaComplianceData['breachedTickets'] = [];

  for (const timer of timers) {
    const ticket = Array.isArray(timer.tickets) ? timer.tickets[0] : timer.tickets;
    if (!ticket) continue;
    const sev = ticket.severity || 'medium';
    if (!bySev[sev]) bySev[sev] = { frMet: 0, frTotal: 0, resMet: 0, resTotal: 0 };
    const policy = Array.isArray(timer.sla_policies) ? timer.sla_policies[0] : timer.sla_policies;

    if (timer.first_response_met !== null) {
      frTotal++;
      bySev[sev].frTotal++;
      if (timer.first_response_met) { frMet++; bySev[sev].frMet++; }
      else {
        breached.push({
          ticketId: ticket.id,
          title: ticket.title,
          slaType: 'first_response',
          target: policy?.first_response_minutes || 0,
          actual: timer.first_response_elapsed_minutes,
        });
      }
    }
    if (timer.resolution_met !== null) {
      resTotal++;
      bySev[sev].resTotal++;
      if (timer.resolution_met) { resMet++; bySev[sev].resMet++; }
      else {
        breached.push({
          ticketId: ticket.id,
          title: ticket.title,
          slaType: 'resolution',
          target: policy?.resolution_minutes || 0,
          actual: timer.resolution_elapsed_minutes,
        });
      }
    }
  }

  const pct = (met: number, total: number) => (total ? Math.round((met / total) * 100) : 0);
  const bySeverity: SlaComplianceData['bySeverity'] = {};
  for (const [sev, d] of Object.entries(bySev)) {
    bySeverity[sev] = {
      firstResponseCompliance: pct(d.frMet, d.frTotal),
      resolutionCompliance: pct(d.resMet, d.resTotal),
    };
  }

  return {
    firstResponseCompliance: pct(frMet, frTotal),
    resolutionCompliance: pct(resMet, resTotal),
    bySeverity,
    breachedTickets: breached,
  };
}

// ---- Backlog ----

export async function getBacklogData(
  agentScope?: string,
  client?: SupabaseClient,
): Promise<BacklogData> {
  const supabase = client ?? createServiceRoleClient();

  let q = supabase
    .from('tickets')
    .select('id, status, severity, assigned_agent_id, created_at, updated_at')
    .in('status', ['open', 'pending']);
  if (agentScope) q = q.eq('assigned_agent_id', agentScope);
  const { data: tickets } = await q;

  if (!tickets || tickets.length === 0) {
    return { open: 0, pending: 0, bySeverity: {}, unassigned: 0, trend: [] };
  }

  let open = 0;
  let pending = 0;
  let unassigned = 0;
  const bySev: Record<string, { open: number; pending: number }> = {};

  for (const t of tickets) {
    if (t.status === 'open') open++;
    else pending++;
    if (!t.assigned_agent_id) unassigned++;
    const sev = t.severity || 'medium';
    if (!bySev[sev]) bySev[sev] = { open: 0, pending: 0 };
    if (t.status === 'open') bySev[sev].open++;
    else bySev[sev].pending++;
  }

  // Build a simple trend from last 14 days based on created_at
  const trend: BacklogData['trend'] = [];
  const now = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const endOfDay = new Date(dateStr + 'T23:59:59.999Z').getTime();
    let dayOpen = 0;
    let dayPending = 0;
    for (const t of tickets) {
      const created = new Date(t.created_at).getTime();
      if (created <= endOfDay) {
        // still open/pending now, approximate as open during range
        if (t.status === 'open') dayOpen++;
        else dayPending++;
      }
    }
    trend.push({ date: dateStr, open: dayOpen, pending: dayPending });
  }

  return { open, pending, bySeverity: bySev, unassigned, trend };
}
