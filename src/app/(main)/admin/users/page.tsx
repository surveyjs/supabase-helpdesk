import Link from 'next/link';
import { createServerClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/supabase/auth';
import { blockUser, unblockUser, adminDeleteUser } from '@/lib/actions/admin';
import { assignTier } from '@/lib/actions/tiers';
import { RoleBadge } from '@/components/ui/RoleBadge';
import { Pagination, clampPage } from '@/components/ui/Pagination';

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    role?: string;
    status?: string;
    q?: string;
  }>;
}) {
  await requireAdmin();
  const supabase = await createServerClient();
  const params = await searchParams;

  const requestedPage = Math.max(1, parseInt(params.page ?? '1', 10) || 1);
  const pageSize = 20;
  const roleFilter = params.role ?? 'all';
  const statusFilter = params.status ?? 'all';
  const searchQuery = params.q?.trim() ?? '';

  // Build query for a given page
  const buildQuery = (forPage: number) => {
    const offset = (forPage - 1) * pageSize;
    let query = supabase
      .from('profiles')
      .select('id, display_name, email, role, team_id, is_blocked, created_at, tier_id, tier_expires_at, team:teams(name), tier:subscription_tiers(key, display_name)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (roleFilter !== 'all') {
      query = query.eq('role', roleFilter);
    }

    if (statusFilter === 'blocked') {
      query = query.eq('is_blocked', true);
    } else if (statusFilter === 'deleted') {
      query = query.like('display_name', 'Deleted User #%');
    } else if (statusFilter === 'active') {
      query = query.eq('is_blocked', false).not('display_name', 'like', 'Deleted User #%');
    }

    if (searchQuery) {
      const sanitized = searchQuery.replace(/[,()]/g, '');
      if (sanitized) {
        query = query.or(`display_name.ilike.%${sanitized}%,email.ilike.%${sanitized}%`);
      }
    }

    return query;
  };

  let { data: users, count } = await buildQuery(requestedPage);
  if (requestedPage > 1 && (users ?? []).length === 0) {
    // Past the last page (e.g. ?page=999): PostgREST answers 416 and reports no count, so
    // probe page 1 for the total, then show the last page.
    const probe = await buildQuery(1);
    const lastPage = clampPage(requestedPage, Math.ceil((probe.count ?? 0) / pageSize));
    ({ data: users, count } = lastPage === 1 ? probe : await buildQuery(lastPage));
  }
  const totalPages = Math.ceil((count ?? 0) / pageSize);
  const page = clampPage(requestedPage, totalPages);

  // Fetch available tiers for assignment
  const { data: allTiers } = await supabase
    .from('subscription_tiers')
    .select('id, key, display_name')
    .order('sort_order');

  function getUserStatus(user: { is_blocked: boolean; display_name: string | null }) {
    if (user.display_name?.startsWith('Deleted User #')) return 'deleted';
    if (user.is_blocked) return 'blocked';
    return 'active';
  }

  const statusBadgeClass: Record<string, string> = {
    active: 'bg-green-100 text-green-700',
    blocked: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200',
    deleted: 'bg-gray-100 text-gray-600',
  };
  const statusLabel: Record<string, string> = { active: 'Active', blocked: 'Blocked', deleted: 'Deleted' };

  const rows = (users ?? []).map((user) => {
    const team = Array.isArray(user.team) ? user.team[0] : user.team;
    const tierObj = Array.isArray(user.tier) ? user.tier[0] : user.tier;
    return { user, team, tierObj };
  });
  type UserRow = (typeof rows)[number]['user'];
  type TierObj = (typeof rows)[number]['tierObj'];

  // Team/Tier are empty for most imported users; only show the columns when this page has a value.
  const showTeam = rows.some((r) => !!r.team?.name);
  const showTier = rows.some((r) => !!r.tierObj);
  const colCount = 6 + (showTeam ? 1 : 0) + (showTier ? 1 : 0);

  const linkParams: Record<string, string> = {};
  if (roleFilter !== 'all') linkParams.role = roleFilter;
  if (statusFilter !== 'all') linkParams.status = statusFilter;
  if (searchQuery) linkParams.q = searchQuery;

  const roleCell = (role: string | null) =>
    role === 'admin' || role === 'agent' ? (
      <RoleBadge role={role} />
    ) : (
      <span className="text-gray-600">User</span>
    );

  const statusPill = (status: string) => (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusBadgeClass[status]}`}>
      {statusLabel[status]}
    </span>
  );

  const tierLabel = (tierObj: TierObj, expiresAt: string | null) => {
    const expired = expiresAt && new Date(expiresAt) < new Date();
    return tierObj ? (
      <span className={expired ? 'text-gray-500 line-through' : ''}>{tierObj.display_name}</span>
    ) : (
      '—'
    );
  };

  const tierChange = (user: UserRow, idSuffix: string) =>
    allTiers && allTiers.length > 0 ? (
      <details className="mt-1">
        <summary className="text-xs text-blue-600 cursor-pointer">Change tier</summary>
        <form action={assignTier} className="mt-1 flex flex-col gap-1">
          <input type="hidden" name="user_id" value={user.id} />
          <select
            name="tier_id"
            defaultValue={user.tier_id ?? 'none'}
            className="text-xs form-select"
            aria-label={`Tier for ${user.display_name ?? user.email}${idSuffix}`}
          >
            <option value="none">None</option>
            {allTiers.map((t) => (
              <option key={t.id} value={t.id}>{t.display_name}</option>
            ))}
          </select>
          <input
            name="expires_at"
            type="datetime-local"
            defaultValue={user.tier_expires_at ? new Date(user.tier_expires_at).toISOString().slice(0, 16) : ''}
            className="text-xs form-input"
            aria-label={`Tier expiration${idSuffix}`}
          />
          <button type="submit" className="px-2 h-[36px] text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200">Save</button>
        </form>
      </details>
    ) : null;

  const userActions = (user: UserRow, status: string) => {
    const isAgentOrAdmin = user.role === 'agent' || user.role === 'admin';
    return (
      <div className="flex gap-3">
        <form action={user.is_blocked ? unblockUser : blockUser}>
          <input type="hidden" name="user_id" value={user.id} />
          <button
            type="submit"
            className={`text-xs ${user.is_blocked ? 'text-green-600 hover:text-green-800' : 'text-yellow-600 hover:text-yellow-800'}`}
          >
            {user.is_blocked ? 'Unblock' : 'Block'}
          </button>
        </form>
        {!isAgentOrAdmin && status !== 'deleted' && (
          <form action={adminDeleteUser}>
            <input type="hidden" name="user_id" value={user.id} />
            <button type="submit" className="text-xs text-red-600 hover:text-red-800">
              Delete
            </button>
          </form>
        )}
      </div>
    );
  };

  const th = 'text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider';

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">User Management</h1>

      {/* Filters */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
        <form className="flex flex-wrap gap-4 items-end">
          <div>
            <label htmlFor="filter-role" className="block text-xs font-medium text-gray-500 mb-1">Role</label>
            <select
              id="filter-role"
              name="role"
              defaultValue={roleFilter}
              className="form-select"
            >
              <option value="all">All</option>
              <option value="user">User</option>
              <option value="agent">Agent</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div>
            <label htmlFor="filter-status" className="block text-xs font-medium text-gray-500 mb-1">Status</label>
            <select
              id="filter-status"
              name="status"
              defaultValue={statusFilter}
              className="form-select"
            >
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="blocked">Blocked</option>
              <option value="deleted">Deleted</option>
            </select>
          </div>
          <div>
            <label htmlFor="filter-search" className="block text-xs font-medium text-gray-500 mb-1">Search</label>
            <input
              id="filter-search"
              name="q"
              type="text"
              defaultValue={searchQuery}
              placeholder="Email or display name…"
              className="form-input"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              className="px-4 h-[36px] bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
            >
              Filter
            </button>
            <Link
              href="/admin/users"
              prefetch={false}
              className="px-4 h-[36px] inline-flex items-center bg-gray-100 text-gray-700 text-sm rounded hover:bg-gray-200"
            >
              Reset
            </Link>
          </div>
        </form>
      </div>

      {/* Users: cards below md, table from md up */}
      <div className="md:hidden space-y-3" data-testid="users-cards">
        {rows.length === 0 ? (
          <p className="bg-white rounded-lg border border-gray-200 px-4 py-8 text-center text-gray-500">No users found.</p>
        ) : (
          rows.map(({ user, team, tierObj }) => {
            const status = getUserStatus(user);
            return (
              <div key={user.id} className="bg-white rounded-lg border border-gray-200 p-4 space-y-2" data-testid={`user-card-${user.id}`}>
                <div className="flex items-start justify-between gap-2">
                  <Link
                    href={`/agent/users/${user.id}`}
                    prefetch={false}
                    className="text-blue-600 hover:text-blue-800 hover:underline font-medium break-words min-w-0"
                  >
                    {user.display_name ?? '—'}
                  </Link>
                  {statusPill(status)}
                </div>
                <p className="text-sm text-gray-600 break-all">{user.email}</p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600">
                  {roleCell(user.role)}
                  {team?.name && <span>Team: {team.name}</span>}
                  {tierObj && <span>Tier: {tierLabel(tierObj, user.tier_expires_at)}</span>}
                  <span>{new Date(user.created_at).toLocaleDateString()}</span>
                </div>
                {tierChange(user, ' (card)')}
                {userActions(user, status)}
              </div>
            );
          })
        )}
      </div>

      <div className="hidden md:block bg-white rounded-lg border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className={th}>Display Name</th>
              <th className={th}>Email</th>
              <th className={th}>Role</th>
              {showTeam && <th className={th}>Team</th>}
              {showTier && <th className={th}>Tier</th>}
              <th className={th}>Status</th>
              <th className={th}>Created</th>
              <th className={th}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="px-4 py-8 text-center text-gray-500">
                  No users found.
                </td>
              </tr>
            ) : rows.map(({ user, team, tierObj }) => {
              const status = getUserStatus(user);
              return (
                <tr key={user.id} className="hover:bg-gray-50" data-testid={`user-row-${user.id}`}>
                  <td className="px-4 py-3">
                    <Link
                      href={`/agent/users/${user.id}`}
                      prefetch={false}
                      className="text-blue-600 hover:text-blue-800 hover:underline font-medium"
                    >
                      {user.display_name ?? '—'}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{user.email}</td>
                  <td className="px-4 py-3">{roleCell(user.role)}</td>
                  {showTeam && <td className="px-4 py-3 text-gray-600">{team?.name ?? '—'}</td>}
                  {showTier && (
                    <td className="px-4 py-3 text-gray-600" data-testid={`user-tier-${user.id}`}>
                      {tierLabel(tierObj, user.tier_expires_at)}
                      {tierChange(user, '')}
                    </td>
                  )}
                  <td className="px-4 py-3">{statusPill(status)}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {new Date(user.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    {userActions(user, status)}
                    {/* With the Tier column hidden, keep tier assignment reachable from here. */}
                    {!showTier && tierChange(user, '')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination
        currentPage={page}
        totalPages={totalPages}
        basePath="/admin/users"
        searchParams={linkParams}
        pageSize={pageSize}
        totalItems={count ?? 0}
      />
    </div>
  );
}
