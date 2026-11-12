import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { requireAgent } from '@/lib/supabase/auth';
import {
  getAgentTickets,
  getFilterOptions,
  getSavedViews,
  getAgentStats,
  hasSlaPolicies,
  filterDataToQueryFilters,
  type AgentTicketRow,
} from '@/lib/queries/agent-dashboard';
import { Badge } from '@/components/ui/Badge';
import { TierBadge } from '@/components/ui/TierBadge';
import { DisplayName } from '@/components/features/users/DisplayName';
import { Pagination } from '@/components/ui/Pagination';
import { PrivateIcon } from '@/components/ui/PrivateIcon';
import { RealtimeDashboard } from '@/components/features/agent/RealtimeDashboard';
import { BulkSelectProvider } from '@/components/features/bulk-actions/BulkSelectProvider';
import { TicketCheckbox, SelectAllCheckbox } from '@/components/features/bulk-actions/TicketCheckbox';
import { BulkActionToolbar } from '@/components/features/bulk-actions/BulkActionToolbar';
import { ViewsFiltersCollapsible } from './ViewsFiltersCollapsible';
import { parseAgentDashboardTemplate } from '@/lib/constants/survey-ui-config';
import { getTemplateDefaultSort } from '@/lib/filters/ticket-filter-survey';
import {
  DEFAULT_VIEW_NAME,
  EMPTY_FILTER_DATA,
  generateSqlFromJson,
  urlParamsToData,
  type TicketFilterData,
  type TicketFilterDefinition,
} from '@/lib/filters/ticket-filter';

const SLA_LABELS: Record<string, string> = {
  breached: 'Breached',
  approaching: 'Approaching',
  on_track: 'On track',
  met: 'On track',
};

const SLA_DOT_COLORS: Record<string, string> = {
  breached: 'bg-red-500',
  approaching: 'bg-yellow-500',
};

/** Label of a ticket's SLA state, or null when no SLA applies to it. */
function slaLabel(status: AgentTicketRow['sla_status']): string | null {
  if (!status || status === 'no_sla') return null;
  return SLA_LABELS[status] ?? status.replace('_', ' ');
}

/** "high" → "High" (urgency/severity level as shown on badges). */
function levelLabel(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export default async function AgentDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireAgent();
  const supabase = await createServerClient();

  // Get current user profile (including stored active view preference)
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, active_view_id')
    .eq('id', user.id)
    .single();

  if (!profile) redirect('/');

  const params = await searchParams;

  const [{ data: surveyUiSetting }, { data: aiFilterSetting }] = await Promise.all([
    supabase.from('app_settings').select('value').eq('key', 'survey_agent_dashboard_template').maybeSingle(),
    supabase.from('app_settings').select('value').eq('key', 'ai_filter_enabled').maybeSingle(),
  ]);
  const aiFilterEnabled = aiFilterSetting?.value === 'true';

  const surveyFilterTemplate = parseAgentDashboardTemplate(surveyUiSetting?.value as string | null);

  const requestedViewId = typeof params.view === 'string' ? params.view : null;
  const pageParam = typeof params.page === 'string' ? params.page : '1';
  const urlFilterData: TicketFilterData = urlParamsToData(params);
  const hasUrlFilters = Object.keys(urlFilterData).length > 0;

  const savedViews = await getSavedViews(user.id);

  const defaultActiveView = {
    id: null,
    name: DEFAULT_VIEW_NAME,
    definition: {
      name: DEFAULT_VIEW_NAME,
      type: 'json' as const,
      data: EMPTY_FILTER_DATA,
      sql: generateSqlFromJson(EMPTY_FILTER_DATA),
    },
  };

  // Resolve the active filter definition.
  let activeView: { id: string | null; name: string; definition: TicketFilterDefinition };
  if (requestedViewId) {
    const found = savedViews.find((v) => v.id === requestedViewId);
    activeView = found
      ? { id: found.id, name: found.name, definition: found.definition }
      : defaultActiveView; // Stale/unknown id — fall through to Default.
  } else {
    if (!hasUrlFilters && profile.active_view_id) {
      // No URL filter params — restore the last view the agent explicitly selected.
      const stored = savedViews.find((v) => v.id === profile.active_view_id);
      if (stored) {
        activeView = { id: stored.id, name: stored.name, definition: stored.definition };
      } else {
        await supabase.from('profiles').update({ active_view_id: null }).eq('id', user.id);
        activeView = defaultActiveView; // View was deleted — fall back to Default.
      }
    } else {
      activeView = hasUrlFilters
        ? {
            id: null,
            name: DEFAULT_VIEW_NAME,
            definition: {
              name: DEFAULT_VIEW_NAME,
              type: 'json',
              data: urlFilterData,
              sql: generateSqlFromJson(urlFilterData),
            },
          }
        : defaultActiveView;
    }
  }

  const effectiveData: TicketFilterData = { ...activeView.definition.data };
  const templateDefaultSort = getTemplateDefaultSort(surveyFilterTemplate);
  if (effectiveData.sort === undefined && templateDefaultSort !== undefined) {
    effectiveData.sort = templateDefaultSort;
  }

  const queryFilters = filterDataToQueryFilters(effectiveData, pageParam);

  const [{ tickets, total, pageSize }, filterOptions, stats, showSla] =
    await Promise.all([
      getAgentTickets(queryFilters),
      getFilterOptions(),
      getAgentStats(user.id),
      hasSlaPolicies(),
    ]);

  const currentPage = Math.max(1, parseInt(pageParam, 10) || 1);
  const totalPages = Math.ceil(total / pageSize);

  // Build URL search params for pagination links (preserve view OR active filters)
  const linkParams: Record<string, string> = {};
  if (activeView.id) {
    linkParams.view = activeView.id;
  } else {
    if (effectiveData.q) linkParams.q = effectiveData.q;
    if (effectiveData.email) linkParams.email = effectiveData.email;
    if (effectiveData.urgency) linkParams.urgency = effectiveData.urgency;
    if (effectiveData.severity) linkParams.severity = effectiveData.severity;
    if (effectiveData.category) linkParams.category = effectiveData.category;
    if (effectiveData.type) linkParams.type = effectiveData.type;
    if (effectiveData.agent) linkParams.agent = effectiveData.agent;
    if (effectiveData.team) linkParams.team = effectiveData.team;
    if (effectiveData.tier) linkParams.tier = effectiveData.tier;
    if (effectiveData.sort && effectiveData.sort !== templateDefaultSort) {
      linkParams.sort = effectiveData.sort;
    }
    if (effectiveData.tags && effectiveData.tags.length > 0) {
      linkParams.tags = effectiveData.tags.join(',');
    }
    if (effectiveData.status && effectiveData.status.length > 0 && effectiveData.status.length < 3) {
      linkParams.status = effectiveData.status.join(',');
    }
  }

  const thClass = 'px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap';

  return (
    // At xl the dashboard breaks out of the (main) max-w-5xl container the same
    // way the ticket detail page does, capped at max-w-7xl, so the filters can
    // sit in a left column next to the list.
    <div className="xl:relative xl:left-1/2 xl:right-1/2 xl:w-screen xl:max-w-7xl xl:-translate-x-1/2 xl:px-6">
      <h1 className="sr-only">Agent Dashboard</h1>

      {/* Stats Panel */}
      <details className="mb-6 bg-white rounded-lg border border-gray-200">
        <summary className="px-4 py-3 cursor-pointer text-sm font-medium text-gray-700 hover:text-gray-900 list-none flex items-center justify-between">
          <span>My Stats (Last 30 Days)</span>
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </summary>
        <dl className="px-4 pb-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4" data-testid="agent-stats">
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
        </dl>
      </details>

      <div className="xl:flex xl:items-start xl:gap-6">
        {/* Consolidated Views & Filters Panel: on top below xl, left column from xl */}
        <ViewsFiltersCollapsible
          className="xl:w-72 xl:shrink-0 xl:sticky xl:top-4"
          filterOptions={filterOptions}
          template={surveyFilterTemplate}
          savedViews={savedViews.map((v) => ({ id: v.id, name: v.name }))}
          activeViewId={activeView.id}
          activeViewName={activeView.name}
          initialData={effectiveData}
          activeDefinition={activeView.definition}
          aiFilterEnabled={aiFilterEnabled}
        />

        <div className="min-w-0 xl:flex-1">
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
              {/* Card layout below lg */}
              <ul className="lg:hidden space-y-2" data-testid="agent-ticket-cards">
                {tickets.map((ticket) => {
                  const sla = slaLabel(ticket.sla_status);
                  return (
                    <li key={ticket.id} className="bg-white rounded-lg border border-gray-200 py-3 pr-3 flex items-start">
                      <div className="w-8 shrink-0 flex justify-center pt-0.5">
                        <TicketCheckbox ticketId={ticket.id} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start gap-1">
                          <Link
                            href={`/tickets/${ticket.id}/${ticket.slug}`}
                            title={ticket.title}
                            className="text-sm font-medium text-blue-600 hover:text-blue-800 line-clamp-2 break-words focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none rounded"
                          >
                            {ticket.title}
                          </Link>
                          {ticket.is_private && <PrivateIcon className="mt-0.5" />}
                        </div>
                        <div className="flex items-center gap-1 mt-1 text-xs text-gray-500 min-w-0">
                          <span className="truncate min-w-0">
                            <DisplayName
                              userId={ticket.creator_id}
                              displayName={ticket.creator_display_name ?? 'User'}
                              isCurrentUserAgent={true}
                            />
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="whitespace-nowrap">
                            {ticket.post_count} post{ticket.post_count !== 1 ? 's' : ''}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="whitespace-nowrap">{new Date(ticket.updated_at).toLocaleDateString()}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 mt-2">
                          <Badge variant="status" value={ticket.status} />
                          {ticket.urgency !== 'medium' && (
                            <Badge variant="priority" value={ticket.urgency} label={`Urgency: ${levelLabel(ticket.urgency)}`} />
                          )}
                          {ticket.severity !== 'medium' && (
                            <Badge variant="priority" value={ticket.severity} label={`Severity: ${levelLabel(ticket.severity)}`} />
                          )}
                          {sla && <span className="text-xs text-gray-500">SLA: {sla}</span>}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
              {/* Table layout from lg */}
              <div
                className="hidden lg:block bg-white rounded-lg border border-gray-200 overflow-x-auto"
                data-testid="agent-ticket-table"
              >
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th scope="col" className="w-8 px-2 py-2 text-center">
                        <SelectAllCheckbox ticketIds={tickets.map((t) => t.id)} />
                      </th>
                      <th scope="col" className={thClass}>Title</th>
                      <th scope="col" className={thClass}>Submitter</th>
                      <th scope="col" className={thClass}>Status</th>
                      <th scope="col" className={thClass}>Urgency</th>
                      <th scope="col" className={thClass}>Severity</th>
                      {showSla && <th scope="col" className={thClass}>SLA</th>}
                      <th scope="col" className={thClass}>Posts</th>
                      <th scope="col" className={thClass}>Updated</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {tickets.map((ticket) => {
                      const sla = slaLabel(ticket.sla_status);
                      return (
                        <tr key={ticket.id} className="hover:bg-gray-50">
                          <td className="px-2 py-2 text-center">
                            <TicketCheckbox ticketId={ticket.id} />
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-start gap-1">
                              <Link
                                href={`/tickets/${ticket.id}/${ticket.slug}`}
                                title={ticket.title}
                                className="text-sm font-medium text-blue-600 hover:text-blue-800 line-clamp-2 break-words"
                              >
                                {ticket.title}
                              </Link>
                              {ticket.is_private && <PrivateIcon className="mt-0.5" />}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-sm text-gray-700">
                            <div className="flex items-center gap-1">
                              <span className="whitespace-nowrap max-w-[10rem] truncate">
                                <DisplayName
                                  userId={ticket.creator_id}
                                  displayName={ticket.creator_display_name ?? 'User'}
                                  isCurrentUserAgent={true}
                                />
                              </span>
                              {ticket.creator_tier_active && ticket.creator_tier_key && (
                                <TierBadge
                                  displayName={ticket.creator_tier_display_name ?? ''}
                                  color={ticket.creator_tier_color ?? 'gray'}
                                  icon={ticket.creator_tier_icon}
                                />
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <Badge variant="status" value={ticket.status} />
                          </td>
                          <td className="px-3 py-2">
                            <Badge variant="priority" value={ticket.urgency} />
                          </td>
                          <td className="px-3 py-2">
                            <Badge variant="priority" value={ticket.severity} />
                          </td>
                          {showSla && (
                            <td className="px-3 py-2" data-testid={`sla-cell-${ticket.id}`}>
                              {sla ? (
                                <span className="inline-flex items-center" title={`SLA: ${sla}`}>
                                  <span
                                    aria-hidden="true"
                                    className={`inline-block w-2.5 h-2.5 rounded-full ${
                                      SLA_DOT_COLORS[ticket.sla_status ?? ''] ?? 'bg-green-500'
                                    }`}
                                  />
                                  <span className="sr-only">SLA: {sla}</span>
                                </span>
                              ) : (
                                <span className="text-xs text-gray-500">—</span>
                              )}
                            </td>
                          )}
                          <td className="px-3 py-2 text-sm text-gray-600">
                            {ticket.post_count}
                          </td>
                          <td className="px-3 py-2 text-sm text-gray-500 whitespace-nowrap">
                            {new Date(ticket.updated_at).toLocaleDateString()}
                          </td>
                        </tr>
                      );
                    })}
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
            totalItems={total}
          />
        </div>
      </div>

      {/* Realtime subscription for live dashboard updates */}
      <RealtimeDashboard />
    </div>
  );
}
