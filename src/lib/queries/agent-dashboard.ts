import { createServerClient } from '@/lib/supabase/server';
import { getSlaStatusForTimer, getBusinessHoursConfig, getApproachingThreshold, type SlaStatus } from '@/lib/utils/sla';

export type AgentTicketFilters = {
  status?: string;
  q?: string;
  email?: string;
  urgency?: string;
  severity?: string;
  category?: string;
  type?: string;
  agent?: string;
  team?: string;
  tags?: string;
  sort?: string;
  page?: string;
};

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
  creator_display_name: string | null;
  creator_email: string;
  creator_team_name: string | null;
  agent_display_name: string | null;
  assigned_agent_id: string | null;
  type_name: string;
  category_name: string | null;
  post_count: number;
  sla_status?: SlaStatus | null;
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
      'id, title, slug, status, urgency, severity, is_private, created_at, updated_at, creator_display_name, creator_email, creator_team_name, agent_display_name, assigned_agent_id, type_name, category_name, post_count',
      { count: 'exact' },
    );

  // Search filter: restrict to matching ticket IDs
  if (matchingTicketIds !== null) {
    query = query.in('id', matchingTicketIds);
  }

  // Status filter
  if (filters.status === 'active') {
    query = query.in('status', ['open', 'pending']);
  } else if (filters.status === 'closed') {
    query = query.eq('status', 'closed');
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

  // Tag filter (OR logic: any of the selected tags)
  if (filters.tags?.trim()) {
    const tagIds = filters.tags.split(',').filter(Boolean);
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
    // SLA sort — we'll sort client-side after fetching SLA data
    query = query.order('updated_at', { ascending: false });
  }

  // Pagination
  const from = (currentPage - 1) * pageSize;
  query = query.range(from, from + pageSize - 1);

  const { data, count } = await query;

  let tickets = (data ?? []) as AgentTicketRow[];

  // Fetch SLA timers for all tickets
  if (tickets.length > 0) {
    const ticketIds = tickets.map((t) => t.id);
    const { data: slaTimers } = await supabase
      .from('sla_timers')
      .select('*')
      .in('ticket_id', ticketIds);

    if (slaTimers && slaTimers.length > 0) {
      // Pre-fetch config, threshold, and policies once to avoid N+1 queries
      const [config, threshold] = await Promise.all([
        getBusinessHoursConfig(),
        getApproachingThreshold(),
      ]);
      const policyIds = [...new Set(slaTimers.map((t) => t.sla_policy_id).filter(Boolean))];
      const { data: policies } = await supabase
        .from('sla_policies')
        .select('id, first_response_minutes, resolution_minutes')
        .in('id', policyIds);
      const policyMap = new Map(
        (policies ?? []).map((p) => [p.id, p]),
      );

      const timerMap = new Map(slaTimers.map((t) => [t.ticket_id, t]));
      const statusPromises = tickets.map(async (ticket) => {
        const timer = timerMap.get(ticket.id);
        if (timer) {
          ticket.sla_status = await getSlaStatusForTimer(timer, { config, threshold, policyMap });
        } else {
          ticket.sla_status = null;
        }
        return ticket;
      });
      tickets = await Promise.all(statusPromises);
    }

    // Sort by SLA risk if requested
    if (filters.sort === 'sla') {
      const riskOrder: Record<string, number> = {
        breached: 0,
        approaching: 1,
        on_track: 2,
        met: 3,
        no_sla: 4,
      };

      tickets.sort((a, b) => {
        const aStatus = getWorstSlaStatus(a.sla_status);
        const bStatus = getWorstSlaStatus(b.sla_status);
        const aRisk = riskOrder[aStatus] ?? 4;
        const bRisk = riskOrder[bStatus] ?? 4;
        if (aRisk !== bRisk) return aRisk - bRisk;
        // Within same group, sort by remaining time (least first)
        const aRemaining = getMinRemainingMinutes(a.sla_status);
        const bRemaining = getMinRemainingMinutes(b.sla_status);
        return aRemaining - bRemaining;
      });
    }
  }

  return {
    tickets,
    total: count ?? 0,
    pageSize,
  };
}

function getWorstSlaStatus(sla: SlaStatus | null | undefined): string {
  if (!sla) return 'no_sla';
  const statuses = [sla.firstResponse.status, sla.resolution.status];
  if (statuses.includes('breached')) return 'breached';
  if (statuses.includes('approaching')) return 'approaching';
  if (statuses.includes('on_track')) return 'on_track';
  if (statuses.includes('met')) return 'met';
  return 'no_sla';
}

function getMinRemainingMinutes(sla: SlaStatus | null | undefined): number {
  if (!sla) return Infinity;
  const items = [sla.firstResponse, sla.resolution];
  let min = Infinity;
  for (const item of items) {
    if (item.status === 'on_track' || item.status === 'approaching' || item.status === 'breached') {
      const remaining = item.targetMinutes - item.elapsedMinutes;
      if (remaining < min) min = remaining;
    }
  }
  return min;
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

  // SLA compliance: tickets assigned to this agent with completed SLA timers
  let slaComplianceRate = 'N/A';
  const { data: agentTickets } = await supabase
    .from('tickets')
    .select('id')
    .eq('assigned_agent_id', agentId);

  if (agentTickets && agentTickets.length > 0) {
    const ticketIds = agentTickets.map((t) => t.id);
    const { data: slaTimers } = await supabase
      .from('sla_timers')
      .select('first_response_met, resolution_met')
      .in('ticket_id', ticketIds);

    if (slaTimers && slaTimers.length > 0) {
      // Count timers that have at least one completed metric
      let metCount = 0;
      let totalMetrics = 0;
      for (const timer of slaTimers) {
        if (timer.first_response_met !== null) {
          totalMetrics++;
          if (timer.first_response_met) metCount++;
        }
        if (timer.resolution_met !== null) {
          totalMetrics++;
          if (timer.resolution_met) metCount++;
        }
      }
      if (totalMetrics > 0) {
        slaComplianceRate = `${Math.round((metCount / totalMetrics) * 100)}%`;
      }
    }
  }

  return {
    ticketsAssigned: assignedCount ?? 0,
    ticketsResolved: resolvedCount ?? 0,
    avgResponseTime: 'N/A',
    avgResolutionTime: 'N/A',
    avgCsatRating: 'N/A',
    slaComplianceRate,
  };
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

  return {
    categories: categories ?? [],
    types: types ?? [],
    agents: agents ?? [],
    teams: teams ?? [],
    tags: tags ?? [],
  };
}

export async function getSavedViews(agentId: string) {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from('saved_views')
    .select('id, name, filters, created_at')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: true });
  return data ?? [];
}
