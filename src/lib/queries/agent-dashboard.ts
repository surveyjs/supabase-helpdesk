import { createServerClient } from '@/lib/supabase/server';

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

  // Sort
  if (filters.sort === 'created') {
    query = query.order('created_at', { ascending: false });
  } else {
    query = query.order('updated_at', { ascending: false });
  }

  // Pagination
  const from = (currentPage - 1) * pageSize;
  query = query.range(from, from + pageSize - 1);

  const { data, count } = await query;

  return {
    tickets: (data ?? []) as AgentTicketRow[],
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
    slaComplianceRate: 'N/A',
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

  return {
    categories: categories ?? [],
    types: types ?? [],
    agents: agents ?? [],
    teams: teams ?? [],
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
