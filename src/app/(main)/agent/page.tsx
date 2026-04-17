import Link from 'next/link';
import { redirect } from 'next/navigation';
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

function getContrastColor(hex: string): string {
  const c = hex.replace('#', '');
  const srgb = [0, 2, 4].map((i) => {
    const v = parseInt(c.substring(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  const L = 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
  const ratioWhite = 1.05 / (L + 0.05);
  const ratioDark = (L + 0.05) / 0.05;
  return ratioWhite >= ratioDark ? '#FFFFFF' : '#000000';
}

function buildTagFilterUrl(filters: Record<string, string | undefined>, newTags: string): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value && value !== 'all' && value !== '1' && key !== 'page' && key !== 'tags') {
      params.set(key, value);
    }
  }
  if (newTags) params.set('tags', newTags);
  return params.toString();
}

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

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-4">Agent Dashboard</h1>

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

      {/* Saved Views */}
      <div className="mb-4 bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="text-sm font-medium text-gray-700">Saved Views:</span>
          {savedViews.length === 0 && (
            <span className="text-sm text-gray-500">None yet</span>
          )}
          {savedViews.map((view) => {
            const viewFilters = (view.filters ?? {}) as Record<string, string>;
            const viewParams = new URLSearchParams(viewFilters);
            return (
              <span key={view.id} className="inline-flex items-center gap-1">
                <a
                  href={`/agent?${viewParams.toString()}`}
                  className="text-sm text-blue-600 hover:text-blue-800 px-2 py-0.5 rounded bg-blue-50 hover:bg-blue-100"
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
            className="text-sm rounded border border-gray-300 px-2 py-1 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            aria-label="Saved view name"
          />
          <button
            type="submit"
            className="text-sm px-3 py-1 bg-gray-100 rounded hover:bg-gray-200 text-gray-700"
          >
            Save Current View
          </button>
        </form>
      </div>

      {/* Filter Bar */}
      <details className="bg-white rounded-lg border border-gray-200 mb-4 group" open>
        <summary className="px-4 py-3 cursor-pointer text-sm font-medium text-gray-700 hover:text-gray-900 list-none flex items-center justify-between md:hidden focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none rounded-lg">
          <span>Filters</span>
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </summary>
        <form method="get" action="/agent" className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
          {/* Search */}
          <div>
            <label htmlFor="filter-q" className="block text-xs font-medium text-gray-500 mb-1">Search</label>
            <input
              id="filter-q"
              type="search"
              name="q"
              defaultValue={filters.q}
              placeholder="Search title & all posts…"
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            />
          </div>

          {/* Submitter email */}
          <div>
            <label htmlFor="filter-email" className="block text-xs font-medium text-gray-500 mb-1">Submitter Email</label>
            <input
              id="filter-email"
              type="text"
              name="email"
              defaultValue={filters.email}
              placeholder="email@…"
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            />
          </div>

          {/* Status */}
          <div>
            <label htmlFor="filter-status" className="block text-xs font-medium text-gray-500 mb-1">Status</label>
            <select
              id="filter-status"
              name="status"
              defaultValue={filters.status}
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            >
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="closed">Closed</option>
            </select>
          </div>

          {/* Sort */}
          <div>
            <label htmlFor="filter-sort" className="block text-xs font-medium text-gray-500 mb-1">Sort By</label>
            <select
              id="filter-sort"
              name="sort"
              defaultValue={filters.sort}
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            >
              <option value="">Last Modified</option>
              <option value="created">Created Date</option>
              <option value="sla">SLA Risk</option>
            </select>
          </div>

          {/* Urgency */}
          <div>
            <label htmlFor="filter-urgency" className="block text-xs font-medium text-gray-500 mb-1">Urgency</label>
            <select
              id="filter-urgency"
              name="urgency"
              defaultValue={filters.urgency}
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            >
              <option value="">All</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>

          {/* Severity */}
          <div>
            <label htmlFor="filter-severity" className="block text-xs font-medium text-gray-500 mb-1">Severity</label>
            <select
              id="filter-severity"
              name="severity"
              defaultValue={filters.severity}
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            >
              <option value="">All</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>

          {/* Type */}
          <div>
            <label htmlFor="filter-type" className="block text-xs font-medium text-gray-500 mb-1">Type</label>
            <select
              id="filter-type"
              name="type"
              defaultValue={filters.type}
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            >
              <option value="">All</option>
              {filterOptions.types.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          {/* Category (only if categories exist) */}
          {filterOptions.categories.length > 0 && (
            <div>
              <label htmlFor="filter-category" className="block text-xs font-medium text-gray-500 mb-1">Category</label>
              <select
                id="filter-category"
                name="category"
                defaultValue={filters.category}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              >
                <option value="">All</option>
                {filterOptions.categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Assigned Agent */}
          <div>
            <label htmlFor="filter-agent" className="block text-xs font-medium text-gray-500 mb-1">Assigned Agent</label>
            <select
              id="filter-agent"
              name="agent"
              defaultValue={filters.agent}
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            >
              <option value="">All</option>
              <option value="unassigned">Unassigned</option>
              {filterOptions.agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.display_name ?? 'Agent'} ({a.email})
                </option>
              ))}
            </select>
          </div>

          {/* Team */}
          <div>
            <label htmlFor="filter-team" className="block text-xs font-medium text-gray-500 mb-1">Team</label>
            <select
              id="filter-team"
              name="team"
              defaultValue={filters.team}
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            >
              <option value="">All</option>
              <option value="none">No team</option>
              {filterOptions.teams.map((team) => (
                <option key={team.id} value={team.id}>{team.name}</option>
              ))}
            </select>
          </div>

          {/* Tier (only show when tiers are defined) */}
          {filterOptions.tiers.length > 0 && (
            <div>
              <label htmlFor="filter-tier" className="block text-xs font-medium text-gray-500 mb-1">Tier</label>
              <select
                id="filter-tier"
                name="tier"
                defaultValue={filters.tier}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              >
                <option value="">All</option>
                <option value="none">No tier</option>
                {filterOptions.tiers.map((t) => (
                  <option key={t.key} value={t.key}>{t.display_name}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Tag filter (multi-select pills) */}
        {filterOptions.tags.length > 0 && (
          <div className="mt-3" data-testid="tag-filter">
            <span className="block text-xs font-medium text-gray-500 mb-1">Tags</span>
            <div className="flex flex-wrap gap-1">
              {filterOptions.tags.map((tag) => {
                const selectedTagIds = filters.tags ? filters.tags.split(',').filter(Boolean) : [];
                const isSelected = selectedTagIds.includes(tag.id);
                const newTags = isSelected
                  ? selectedTagIds.filter((t) => t !== tag.id).join(',')
                  : [...selectedTagIds, tag.id].join(',');
                const textColor = getContrastColor(tag.color);
                return (
                  <a
                    key={tag.id}
                    href={`/agent?${buildTagFilterUrl(filters, newTags)}`}
                    className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${
                      isSelected ? 'ring-2 ring-offset-1 ring-blue-500' : 'hover:ring-1 hover:ring-gray-300'
                    }`}
                    style={{ backgroundColor: tag.color, color: textColor }}
                  >
                    {tag.name}
                  </a>
                );
              })}
            </div>
            {filters.tags && (
              <input type="hidden" name="tags" value={filters.tags} />
            )}
          </div>
        )}

        <div className="flex items-center gap-2 mt-3">
          <button
            type="submit"
            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 font-medium min-h-[44px] focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
          >
            Apply Filters
          </button>
          <Link
            href="/agent"
            className="px-4 py-1.5 text-sm text-gray-600 hover:text-gray-800 min-h-[44px] inline-flex items-center"
          >
            Clear All
          </Link>
        </div>
      </form>
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
