import Link from 'next/link';
import { createServerClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/supabase/auth';
import { blockUser, unblockUser, adminDeleteUser } from '@/lib/actions/admin';

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

  const page = Math.max(1, parseInt(params.page ?? '1', 10) || 1);
  const pageSize = 20;
  const offset = (page - 1) * pageSize;
  const roleFilter = params.role ?? 'all';
  const statusFilter = params.status ?? 'all';
  const searchQuery = params.q?.trim() ?? '';

  // Build query
  let query = supabase
    .from('profiles')
    .select('id, display_name, email, role, team_id, is_blocked, created_at, team:teams(name)', { count: 'exact' })
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

  const { data: users, count } = await query;
  const totalPages = Math.ceil((count ?? 0) / pageSize);

  function buildUrl(overrides: Record<string, string>) {
    const p = new URLSearchParams();
    if (overrides.page ?? params.page) p.set('page', overrides.page ?? params.page ?? '1');
    if (overrides.role ?? roleFilter) {
      const r = overrides.role ?? roleFilter;
      if (r !== 'all') p.set('role', r);
    }
    if (overrides.status ?? statusFilter) {
      const s = overrides.status ?? statusFilter;
      if (s !== 'all') p.set('status', s);
    }
    if (overrides.q ?? searchQuery) {
      const q = overrides.q ?? searchQuery;
      if (q) p.set('q', q);
    }
    const qs = p.toString();
    return `/admin/users${qs ? `?${qs}` : ''}`;
  }

  function getUserStatus(user: { is_blocked: boolean; display_name: string | null }) {
    if (user.display_name?.startsWith('Deleted User #')) return 'deleted';
    if (user.is_blocked) return 'blocked';
    return 'active';
  }

  const statusBadgeClass: Record<string, string> = {
    active: 'bg-green-100 text-green-700',
    blocked: 'bg-red-100 text-red-700',
    deleted: 'bg-gray-100 text-gray-600',
  };

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
              className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
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
              className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
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
              className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
          >
            Filter
          </button>
          <Link
            href="/admin/users"
            className="px-4 py-1.5 bg-gray-100 text-gray-700 text-sm rounded hover:bg-gray-200"
          >
            Reset
          </Link>
        </form>
      </div>

      {/* Users table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Display Name</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Team</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {(!users || users.length === 0) ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                  No users found.
                </td>
              </tr>
            ) : users.map((user) => {
              const team = Array.isArray(user.team) ? user.team[0] : user.team;
              const status = getUserStatus(user);
              const isAgentOrAdmin = user.role === 'agent' || user.role === 'admin';
              return (
                <tr key={user.id} className="hover:bg-gray-50" data-testid={`user-row-${user.id}`}>
                  <td className="px-4 py-3">
                    <Link
                      href={`/agent/users/${user.id}`}
                      className="text-blue-600 hover:text-blue-800 hover:underline font-medium"
                    >
                      {user.display_name ?? '—'}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{user.email}</td>
                  <td className="px-4 py-3 capitalize text-gray-600">{user.role}</td>
                  <td className="px-4 py-3 text-gray-600">{team?.name ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusBadgeClass[status]}`}>
                      {status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {new Date(user.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
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
                          <button
                            type="submit"
                            className="text-xs text-red-600 hover:text-red-800"
                          >
                            Delete
                          </button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-gray-500">
            Page {page} of {totalPages} ({count} users)
          </p>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={buildUrl({ page: String(page - 1) })}
                className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
              >
                Previous
              </Link>
            )}
            {page < totalPages && (
              <Link
                href={buildUrl({ page: String(page + 1) })}
                className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
              >
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
