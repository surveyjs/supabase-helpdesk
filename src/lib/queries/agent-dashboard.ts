import { createServerClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import {
  getBusinessHoursConfig,
  calculateBusinessMinutesElapsed,
  calculateSlaPercentage,
} from '@/lib/utils/business-hours';
import {
  isAllStatusSelected,
  normalizeStoredDefinition,
  type TicketFilterData,
  type TicketFilterDefinition,
} from '@/lib/filters/ticket-filter';

/**
 * Filters consumed by `getAgentTickets`. `status` is the SurveyJS-style
 * subset of `('open' | 'pending' | 'closed')`; an `undefined` or full
 * 3-value array means "no status predicate".
 */
export type AgentTicketFilters = {
  status?: string[];
  q?: string;
  email?: string;
  urgency?: string;
  severity?: string;
  category?: string;
  type?: string;
  agent?: string;
  team?: string;
  tags?: string[];
  tier?: string;
  sort?: string;
  page?: string;
};

/** Convert a TicketFilterData into the query's filter shape. */
export function filterDataToQueryFilters(
  data: TicketFilterData,
  page: string | undefined,
): AgentTicketFilters {
  return {
    status: data.status,
    q: data.q,
    email: data.email,
    urgency: data.urgency,
    severity: data.severity,
    category: data.category,
    type: data.type,
    agent: data.agent,
    team: data.team,
    tags: data.tags,
    tier: data.tier,
    sort: data.sort,
    page,
  };
}

export type AgentTicketRow = {
  id: number;
  title: string;
  slug: string;
  status: string;
  urgency: string;
  severity: string;
  is_private: boolean;
  created_at: string;
  updated_at: string;
  creator_id: string;
  creator_display_name: string | null;
  creator_email: string;
  creator_team_name: string | null;
  creator_tier_key: string | null;
  creator_tier_display_name: string | null;
  creator_tier_color: string | null;
  creator_tier_icon: string | null;
  creator_tier_active: boolean | null;
  agent_display_name: string | null;
  assigned_agent_id: string | null;
  type_name: string;
  category_name: string | null;
  post_count: number;
  sla_status?: 'on_track' | 'approaching' | 'breached' | 'met' | 'no_sla';
  sla_remaining_minutes?: number;
};

export async function getAgentDashboardPageSize(): Promise<number> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'agent_dashboard_page_size')
    .single();
  return data ? parseInt(data.value, 10) || 20 : 20;
}

export async function getAgentTickets(filters: AgentTicketFilters): Promise<{
  tickets: AgentTicketRow[];
  total: number;
  pageSize: number;
}> {
  const supabase = await createServerClient();
  const pageSize = await getAgentDashboardPageSize();
  const currentPage = Math.max(1, parseInt(filters.page ?? '1', 10) || 1);

  // If searching all post bodies, find matching ticket IDs first (§8.14)
  // Agent search is deeper than user search — searches ALL posts, not just original
  let matchingTicketIds: number[] | null = null;
  if (filters.q?.trim()) {
    const searchTerm = `%${filters.q.trim()}%`;
    // Search all post bodies via ILIKE (covers all posts, not just original)
    const { data: matchingPosts } = await supabase
      .from('posts')
      .select('ticket_id')
      .ilike('body', searchTerm);

    // Also search ticket titles
    const { data: titleMatches } = await supabase
      .from('tickets')
      .select('id')
      .ilike('title', searchTerm);

    const idSet = new Set<number>();
    if (matchingPosts) {
      for (const r of matchingPosts) idSet.add(r.ticket_id);
    }
    if (titleMatches) {
      for (const t of titleMatches) idSet.add(t.id);
    }

    matchingTicketIds = Array.from(idSet);

    // If no matches, return empty
    if (matchingTicketIds.length === 0) {
      return { tickets: [], total: 0, pageSize };
    }
  }

  // Build query on agent_tickets view
  let query = supabase
    .from('agent_tickets')
    .select(
      'id, title, slug, status, urgency, severity, is_private, created_at, updated_at, creator_id, creator_display_name, creator_email, creator_team_name, creator_tier_key, creator_tier_display_name, creator_tier_color, creator_tier_icon, creator_tier_active, agent_display_name, assigned_agent_id, type_name, category_name, post_count',
      { count: 'exact' },
    );

  // Search filter: restrict to matching ticket IDs
  if (matchingTicketIds !== null) {
    query = query.in('id', matchingTicketIds);
  }

  // Status filter — SurveyJS checkbox subset semantics. All three statuses
  // selected (or undefined/empty default) means "no predicate".
  if (filters.status && filters.status.length > 0 && !isAllStatusSelected(filters.status as Parameters<typeof isAllStatusSelected>[0])) {
    query = query.in('status', filters.status);
  }

  // Submitter email filter (partial match, server-side)
  if (filters.email?.trim()) {
    query = query.ilike('creator_email', `%${filters.email.trim()}%`);
  }

  // Priority filters
  if (filters.urgency && ['low', 'medium', 'high', 'critical'].includes(filters.urgency)) {
    query = query.eq('urgency', filters.urgency);
  }
  if (filters.severity && ['low', 'medium', 'high', 'critical'].includes(filters.severity)) {
    query = query.eq('severity', filters.severity);
  }

  // Category filter
  if (filters.category) {
    query = query.eq('category_id', filters.category);
  }

  // Type filter
  if (filters.type) {
    query = query.eq('type_id', filters.type);
  }

  // Assigned agent filter
  if (filters.agent === 'unassigned') {
    query = query.is('assigned_agent_id', null);
  } else if (filters.agent && filters.agent !== 'all' && filters.agent !== '') {
    query = query.eq('assigned_agent_id', filters.agent);
  }

  // Team filter
  if (filters.team === 'none') {
    query = query.is('creator_team_id', null);
  } else if (filters.team && filters.team !== 'all' && filters.team !== '') {
    query = query.eq('creator_team_id', filters.team);
  }

  // Tier filter
  if (filters.tier === 'none') {
    query = query.is('creator_tier_key', null);
  } else if (filters.tier && filters.tier !== 'all' && filters.tier !== '') {
    query = query.eq('creator_tier_key', filters.tier);
  }

  // Tag filter (OR logic: any of the selected tags)
  if (filters.tags && filters.tags.length > 0) {
    const tagIds = filters.tags.filter(Boolean);
    if (tagIds.length > 0) {
      const { data: taggedTickets } = await supabase
        .from('ticket_tags')
        .select('ticket_id')
        .in('tag_id', tagIds);
      const tagTicketIds = [...new Set((taggedTickets ?? []).map((r) => r.ticket_id))];
      if (tagTicketIds.length === 0) {
        return { tickets: [], total: 0, pageSize };
      }
      query = query.in('id', tagTicketIds);
    }
  }

  // Sort
  if (filters.sort === 'created') {
    query = query.order('created_at', { ascending: false });
  } else if (filters.sort !== 'sla') {
    query = query.order('updated_at', { ascending: false });
  } else {
    // For SLA sort, we apply server-side ordering then sort again after enrichment
    query = query.order('updated_at', { ascending: false });
  }

  // Pagination — for SLA sort, fetch all matching tickets so we can sort globally
  const from = (currentPage - 1) * pageSize;
  if (filters.sort !== 'sla') {
    query = query.range(from, from + pageSize - 1);
  }

  const { data, count } = await query;

  const tickets = (data ?? []) as AgentTicketRow[];

  // Enrich tickets with SLA status
  if (tickets.length > 0) {
    const ticketIds = tickets.map((t) => t.id);
    const svc = createServiceRoleClient();
    const { data: timers } = await svc
      .from('sla_timers')
      .select('ticket_id, sla_policy_id, first_response_met, resolution_met, first_response_elapsed_minutes, resolution_elapsed_minutes, first_response_last_resumed_at, resolution_last_resumed_at, is_paused, created_at')
      .in('ticket_id', ticketIds);

    if (timers && timers.length > 0) {
      const config = await getBusinessHoursConfig();
      const now = new Date();

      // Get threshold
      const { data: thresholdSetting } = await svc
        .from('app_settings')
        .select('value')
        .eq('key', 'sla_approaching_threshold')
        .single();
      const threshold = thresholdSetting ? parseInt(thresholdSetting.value, 10) : 75;

      // Get policy info for all timers
      const policyIds = [...new Set(timers.map((t) => t.sla_policy_id).filter(Boolean))];
      const policyMap = new Map<string, { first_response_minutes: number; resolution_minutes: number }>();
      if (policyIds.length > 0) {
        const { data: policies } = await svc
          .from('sla_policies')
          .select('id, first_response_minutes, resolution_minutes')
          .in('id', policyIds);
        for (const p of policies ?? []) {
          policyMap.set(p.id, p);
        }
      }

      const timerMap = new Map(timers.map((t) => [t.ticket_id, t]));

      for (const ticket of tickets) {
        const timer = timerMap.get(ticket.id);
        if (!timer || !timer.sla_policy_id) {
          ticket.sla_status = 'no_sla';
          ticket.sla_remaining_minutes = Infinity;
          continue;
        }

        const policy = policyMap.get(timer.sla_policy_id);
        if (!policy) {
          ticket.sla_status = 'no_sla';
          ticket.sla_remaining_minutes = Infinity;
          continue;
        }

        // Calculate current elapsed using stored + incremental since last resume
        let frElapsed = timer.first_response_elapsed_minutes;
        let resElapsed = timer.resolution_elapsed_minutes;
        if (!timer.is_paused) {
          if (timer.first_response_met === null) {
            const ref = new Date(timer.first_response_last_resumed_at ?? timer.created_at);
            frElapsed += calculateBusinessMinutesElapsed(ref, now, config);
          }
          if (timer.resolution_met === null) {
            const ref = new Date(timer.resolution_last_resumed_at ?? timer.created_at);
            resElapsed += calculateBusinessMinutesElapsed(ref, now, config);
          }
        }

        // Determine worst SLA status
        type SlaLevel = 'on_track' | 'approaching' | 'breached' | 'met';
        let worstStatus: SlaLevel = 'met';
        let minRemaining = Infinity;

        const updateWorst = (newStatus: SlaLevel) => {
          const rank: Record<SlaLevel, number> = { met: 0, on_track: 1, approaching: 2, breached: 3 };
          if (rank[newStatus] > rank[worstStatus]) worstStatus = newStatus;
        };

        // Check first response
        if (timer.first_response_met === null) {
          const pct = calculateSlaPercentage(frElapsed, policy.first_response_minutes);
          const remaining = policy.first_response_minutes - frElapsed;
          if (remaining < minRemaining) minRemaining = remaining;

          if (pct >= 100) updateWorst('breached');
          else if (pct >= threshold) updateWorst('approaching');
          else updateWorst('on_track');
        } else if (!timer.first_response_met) {
          updateWorst('breached');
        }

        // Check resolution
        if (timer.resolution_met === null) {
          const pct = calculateSlaPercentage(resElapsed, policy.resolution_minutes);
          const remaining = policy.resolution_minutes - resElapsed;
          if (remaining < minRemaining) minRemaining = remaining;

          if (pct >= 100) updateWorst('breached');
          else if (pct >= threshold) updateWorst('approaching');
          else updateWorst('on_track');
        } else if (!timer.resolution_met) {
          updateWorst('breached');
        }

        ticket.sla_status = worstStatus;
        ticket.sla_remaining_minutes = minRemaining;
      }
    } else {
      for (const ticket of tickets) {
        ticket.sla_status = 'no_sla';
        ticket.sla_remaining_minutes = Infinity;
      }
    }

    // Sort by SLA risk if requested, then paginate
    if (filters.sort === 'sla') {
      const statusOrder: Record<string, number> = { breached: 0, approaching: 1, on_track: 2, met: 3, no_sla: 4 };
      tickets.sort((a, b) => {
        const aPri = statusOrder[a.sla_status ?? 'no_sla'] ?? 4;
        const bPri = statusOrder[b.sla_status ?? 'no_sla'] ?? 4;
        if (aPri !== bPri) return aPri - bPri;
        return (a.sla_remaining_minutes ?? Infinity) - (b.sla_remaining_minutes ?? Infinity);
      });
    }
  }

  // For SLA sort, slice the globally-sorted array to the current page
  const finalTickets = filters.sort === 'sla'
    ? tickets.slice(from, from + pageSize)
    : tickets;

  return {
    tickets: finalTickets,
    total: count ?? 0,
    pageSize,
  };
}

export async function getAgentStats(agentId: string) {
  const supabase = await createServerClient();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Tickets assigned in last 30 days
  const { count: assignedCount } = await supabase
    .from('activity_log')
    .select('id', { count: 'exact', head: true })
    .eq('actor_id', agentId)
    .eq('action', 'agent_assigned')
    .gte('created_at', thirtyDaysAgo);

  // Tickets resolved (closed) in last 30 days
  const { count: resolvedCount } = await supabase
    .from('activity_log')
    .select('id', { count: 'exact', head: true })
    .eq('actor_id', agentId)
    .eq('action', 'status_changed')
    .gte('created_at', thirtyDaysAgo)
    .contains('details', { to: 'closed' });

  return {
    ticketsAssigned: assignedCount ?? 0,
    ticketsResolved: resolvedCount ?? 0,
    avgResponseTime: 'N/A',
    avgResolutionTime: 'N/A',
    avgCsatRating: 'N/A',
    slaComplianceRate: await getSlaComplianceRate(agentId),
  };
}

async function getSlaComplianceRate(agentId: string): Promise<string> {
  const supabase = await createServerClient();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Get tickets assigned to this agent in the last 30 days that have SLA timers
  const { data: agentTickets } = await supabase
    .from('tickets')
    .select('id')
    .eq('assigned_agent_id', agentId)
    .gte('created_at', thirtyDaysAgo);

  if (!agentTickets || agentTickets.length === 0) return 'N/A';

  const ticketIds = agentTickets.map((t) => t.id);
  const { data: timers } = await supabase
    .from('sla_timers')
    .select('first_response_met, resolution_met')
    .in('ticket_id', ticketIds);

  if (!timers || timers.length === 0) return 'N/A';

  let total = 0;
  let met = 0;
  for (const timer of timers) {
    if (timer.first_response_met !== null) {
      total++;
      if (timer.first_response_met) met++;
    }
    if (timer.resolution_met !== null) {
      total++;
      if (timer.resolution_met) met++;
    }
  }

  if (total === 0) return 'N/A';
  return `${Math.round((met / total) * 100)}%`;
}

export async function getFilterOptions() {
  const supabase = await createServerClient();

  const [
    { data: categories },
    { data: types },
    { data: agents },
    { data: teams },
  ] = await Promise.all([
    supabase.from('categories').select('id, name').order('name'),
    supabase.from('ticket_types').select('id, name').order('name'),
    supabase
      .from('profiles')
      .select('id, display_name, email')
      .in('role', ['agent', 'admin'])
      .order('display_name'),
    supabase.from('teams').select('id, name').order('name'),
  ]);

  const { data: tags } = await supabase.from('tags').select('id, name, color').order('name');
  const { data: tiers } = await supabase.from('subscription_tiers').select('key, display_name').order('sort_order');

  return {
    categories: categories ?? [],
    types: types ?? [],
    agents: agents ?? [],
    teams: teams ?? [],
    tags: tags ?? [],
    tiers: tiers ?? [],
  };
}

export type SavedViewRecord = {
  id: string;
  name: string;
  created_at: string;
  definition: TicketFilterDefinition;
};

export async function getSavedViews(agentId: string): Promise<SavedViewRecord[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from('saved_views')
    .select('id, name, filters, created_at')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: true });
  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    created_at: row.created_at as string,
    definition: normalizeStoredDefinition(row.name as string, row.filters),
  }));
}
