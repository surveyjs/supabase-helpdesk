import Link from 'next/link';
import { redirect } from 'next/navigation';
import 'survey-core/survey-core.min.css';
import { createServerClient } from '@/lib/supabase/server';
import { requireAgent } from '@/lib/supabase/auth';
import {
  getAgentTickets,
  getFilterOptions,
  getSavedViews,
  getAgentStats,
  type AgentTicketFilters,
} from '@/lib/queries/agent-dashboard';
import { Badge } from '@/components/ui/Badge';
import { TierBadge } from '@/components/ui/TierBadge';
import { DisplayName } from '@/components/features/users/DisplayName';
import { Pagination } from '@/components/ui/Pagination';
import { createSavedView, renameSavedView, deleteSavedView } from '@/lib/actions/saved-views';
import { RealtimeDashboard } from '@/components/features/agent/RealtimeDashboard';
import { BulkSelectProvider } from '@/components/features/bulk-actions/BulkSelectProvider';
import { TicketCheckbox, SelectAllCheckbox } from '@/components/features/bulk-actions/TicketCheckbox';
import { BulkActionToolbar } from '@/components/features/bulk-actions/BulkActionToolbar';
import { AgentFiltersSurvey } from './AgentFiltersSurvey';
import { parseAgentDashboardSurveyConfig } from '@/lib/constants/survey-ui-config';

export default async function AgentDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireAgent();
  const supabase = await createServerClient();

  // Get current user profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .single();

  if (!profile) redirect('/');

  const params = await searchParams;

  const filters: AgentTicketFilters = {
    status: (params.status as string) ?? 'all',
    q: (params.q as string) ?? '',
    email: (params.email as string) ?? '',
    urgency: (params.urgency as string) ?? '',
    severity: (params.severity as string) ?? '',
    category: (params.category as string) ?? '',
    type: (params.type as string) ?? '',
    agent: (params.agent as string) ?? '',
    team: (params.team as string) ?? '',
    tags: (params.tags as string) ?? '',
    tier: (params.tier as string) ?? '',
    sort: (params.sort as string) ?? '',
    page: (params.page as string) ?? '1',
  };

  const { data: surveyUiSetting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'survey_agent_dashboard_config')
    .maybeSingle();

  const surveyFilterConfig = parseAgentDashboardSurveyConfig(surveyUiSetting?.value);
  if (!filters.sort && surveyFilterConfig.defaultSort) {
    filters.sort = surveyFilterConfig.defaultSort;
  }

  const [{ tickets, total, pageSize }, filterOptions, savedViews, stats] =
    await Promise.all([
      getAgentTickets(filters),
      getFilterOptions(),
      getSavedViews(user.id),
      getAgentStats(user.id),
    ]);

  const currentPage = Math.max(1, parseInt(filters.page ?? '1', 10) || 1);
  const totalPages = Math.ceil(total / pageSize);

  // Build URL search params for pagination links (preserve all filters)
  const linkParams: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value && value !== 'all' && value !== '1' && key !== 'page') {
      linkParams[key] = value;
    }
  }

  // Serialize current filters for saved view
  const currentFiltersJson = JSON.stringify(linkParams);

  // Determine current view name for consolidated panel summary
  // Use exact match: the view's stored filters must have the same keys and values as the
  // current linkParams (no extra or missing keys on either side).
  const currentViewName = Object.keys(linkParams).length === 0
    ? 'Default'
    : (savedViews.find((view) => {
      const viewFilters = (view.filters ?? {}) as Record<string, string>;
      const viewKeys = Object.keys(viewFilters);
      const linkKeys = Object.keys(linkParams);
      if (viewKeys.length !== linkKeys.length) return false;
      return viewKeys.every((key) => viewFilters[key] === linkParams[key]);
    })?.name ?? 'Default');

  return (
    <div>
      <h1 className="sr-only">Agent Dashboard</h1>

      {/* Stats Panel */}
      <details className="mb-6 bg-white rounded-lg border border-gray-200">
        <summary className="px-4 py-3 cursor-pointer text-sm font-medium text-gray-700 hover:text-gray-900 list-none flex items-center justify-between">
          <span>My Stats (Last 30 Days)</span>
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </summary>
        <div className="px-4 pb-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4" data-testid="agent-stats">
          <div>
            <dt className="text-xs text-gray-500">Tickets Assigned</dt>
            <dd className="text-lg font-semibold text-gray-900">{stats.ticketsAssigned}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Tickets Resolved</dt>
            <dd className="text-lg font-semibold text-gray-900">{stats.ticketsResolved}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Avg Response Time</dt>
            <dd className="text-lg font-semibold text-gray-900">{stats.avgResponseTime}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Avg Resolution Time</dt>
            <dd className="text-lg font-semibold text-gray-900">{stats.avgResolutionTime}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Avg CSAT Rating</dt>
            <dd className="text-lg font-semibold text-gray-900">{stats.avgCsatRating}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">SLA Compliance</dt>
            <dd className="text-lg font-semibold text-gray-900">{stats.slaComplianceRate}</dd>
          </div>
        </div>
      </details>

      {/* Consolidated Views & Filters Panel */}
      <details className="bg-white rounded-lg border border-gray-200 mb-4 group">
        <summary className="px-4 py-3 cursor-pointer text-sm font-medium text-gray-700 hover:text-gray-900 list-none flex items-center justify-between focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none rounded-lg">
          <span>Views & Filters: {currentViewName}</span>
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </summary>

        <div className="px-4 pt-4 pb-4 border-t border-gray-200">
          {/* Saved Views Section */}
          <div className="mb-4">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="text-sm font-medium text-gray-700">Saved Views:</span>
              {/* Default View */}
              <a
                href="/agent"
                className={`text-sm px-2 py-0.5 rounded ${
                  currentViewName === 'Default'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Default
              </a>
              {/* Saved Views */}
              {savedViews.length === 0 && (
                <span className="text-sm text-gray-500">None yet</span>
              )}
              {savedViews.map((view) => {
                const viewFilters = (view.filters ?? {}) as Record<string, string>;
                const viewParams = new URLSearchParams(viewFilters);
                const isActive = currentViewName === view.name;
                return (
                  <span key={view.id} className="inline-flex items-center gap-1">
                    <a
                      href={`/agent?${viewParams.toString()}`}
                      className={`text-sm px-2 py-0.5 rounded ${
                        isActive
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {view.name}
                    </a>
                    <form action={renameSavedView} className="inline-flex items-center">
                      <input type="hidden" name="view_id" value={view.id} />
                      <input
                        type="text"
                        name="name"
                        defaultValue={view.name}
                        className="w-20 text-xs border border-gray-300 rounded px-1 py-0.5 hidden"
                        aria-label={`Rename ${view.name}`}
                      />
                    </form>
                    <form action={deleteSavedView}>
                      <input type="hidden" name="view_id" value={view.id} />
                      <button
                        type="submit"
                        className="text-xs text-red-500 hover:text-red-700"
                        title={`Delete ${view.name}`}
                        aria-label={`Delete saved view ${view.name}`}
                      >
                        ×
                      </button>
                    </form>
                  </span>
                );
              })}
            </div>
            <form action={createSavedView} className="flex items-center gap-2">
              <input type="hidden" name="filters" value={currentFiltersJson} />
              <input
                type="text"
                name="name"
                placeholder="View name…"
                maxLength={100}
                className="text-sm rounded border border-gray-300 px-2 py-1 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none flex-1"
                aria-label="Saved view name"
              />
              <button
                type="submit"
                className="text-sm px-3 py-1 bg-gray-100 rounded hover:bg-gray-200 text-gray-700 whitespace-nowrap"
              >
                Save View
              </button>
            </form>
          </div>

          {/* Filter Controls Section */}
          <div className="pt-4 border-t border-gray-200">
            <AgentFiltersSurvey
              filters={filters}
              filterOptions={filterOptions}
              config={surveyFilterConfig}
            />
          </div>
        </div>
        </details>

      {/* Result count */}
      <p className="text-sm text-gray-600 mb-4" data-testid="result-count">
        {total} ticket{total !== 1 ? 's' : ''} found
      </p>

      {/* Ticket List */}
      {tickets.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          No tickets match your filters.
        </div>
      ) : (
        <BulkSelectProvider>
          <BulkActionToolbar
            agents={filterOptions.agents}
            tags={filterOptions.tags}
            isAdmin={profile.role === 'admin'}
          />
          {/* Mobile card layout */}
          <div className="md:hidden space-y-3">
            {tickets.map((ticket) => (
              <div key={ticket.id} className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="flex items-start gap-3">
                  <div className="pt-1 min-w-[44px] min-h-[44px] flex items-center justify-center">
                    <TicketCheckbox ticketId={ticket.id} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/tickets/${ticket.id}/${ticket.slug}`}
                      className="text-sm font-medium text-blue-600 hover:text-blue-800 line-clamp-2 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none rounded"
                    >
                      {ticket.title}
                    </Link>
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      <Badge variant="status" value={ticket.status} />
                      <Badge variant="priority" value={ticket.urgency} />
                      {ticket.sla_status && ticket.sla_status !== 'no_sla' && (
                        <span className="text-xs text-gray-500">
                          SLA: {ticket.sla_status === 'breached' ? 'Breached' :
                                ticket.sla_status === 'approaching' ? 'Approaching' :
                                ticket.sla_status === 'met' ? 'On track' :
                                ticket.sla_status.replace('_', ' ')}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {new Date(ticket.updated_at).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {/* Desktop table layout */}
          <div className="hidden md:block bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-2 py-3 text-center">
                  <SelectAllCheckbox ticketIds={tickets.map((t) => t.id)} />
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Title</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Submitter</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Urgency</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Severity</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">SLA</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Posts</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {tickets.map((ticket) => (
                <tr key={ticket.id} className="hover:bg-gray-50">
                  <td className="px-2 py-3 text-center">
                    <TicketCheckbox ticketId={ticket.id} />
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/tickets/${ticket.id}/${ticket.slug}`}
                      className="text-sm font-medium text-blue-600 hover:text-blue-800"
                    >
                      {ticket.title}
                    </Link>
                    {ticket.is_private && (
                      <span className="ml-1 text-xs text-gray-500" title="Private">🔒</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">
                    <DisplayName
                      userId={ticket.creator_id}
                      displayName={ticket.creator_display_name ?? 'User'}
                      isCurrentUserAgent={true}
                    />
                    {ticket.creator_tier_active && ticket.creator_tier_key && (
                      <span className="ml-1">
                        <TierBadge
                          displayName={ticket.creator_tier_display_name ?? ''}
                          color={ticket.creator_tier_color ?? 'gray'}
                          icon={ticket.creator_tier_icon}
                        />
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="status" value={ticket.status} />
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="priority" value={ticket.urgency} />
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="priority" value={ticket.severity} />
                  </td>
                  <td className="px-4 py-3" data-testid={`sla-cell-${ticket.id}`}>
                    {ticket.sla_status && ticket.sla_status !== 'no_sla' ? (
                      <span
                        className="inline-flex items-center"
                        aria-label={`SLA: ${
                          ticket.sla_status === 'breached' ? 'Breached' :
                          ticket.sla_status === 'approaching' ? 'Approaching' :
                          ticket.sla_status === 'met' ? 'On track' :
                          ticket.sla_status.replace('_', ' ')
                        }`}
                        title={`SLA: ${
                          ticket.sla_status === 'breached' ? 'Breached' :
                          ticket.sla_status === 'approaching' ? 'Approaching' :
                          ticket.sla_status === 'met' ? 'On track' :
                          ticket.sla_status.replace('_', ' ')
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`inline-block w-2.5 h-2.5 rounded-full ${
                            ticket.sla_status === 'breached' ? 'bg-red-500' :
                            ticket.sla_status === 'approaching' ? 'bg-yellow-500' :
                            ticket.sla_status === 'met' ? 'bg-green-500' :
                            'bg-green-500'
                          }`}
                        />
                        <span className="sr-only">
                          SLA: {
                            ticket.sla_status === 'breached' ? 'Breached' :
                            ticket.sla_status === 'approaching' ? 'Approaching' :
                            ticket.sla_status === 'met' ? 'On track' :
                            ticket.sla_status.replace('_', ' ')
                          }
                        </span>
                      </span>
                    ) : (
                      <span className="text-xs text-gray-500">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {ticket.post_count}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {new Date(ticket.updated_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </BulkSelectProvider>
      )}

      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        basePath="/agent"
        searchParams={linkParams}
        pageSize={pageSize}
      />

      {/* Realtime subscription for live dashboard updates */}
      <RealtimeDashboard />
    </div>
  );
}
