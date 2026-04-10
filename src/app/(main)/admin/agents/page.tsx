import { createServiceRoleClient } from '@/lib/supabase/server';
import {
  promoteToAgent,
  promoteToAdmin,
  demoteToAgent,
  demoteToUser,
} from '@/lib/actions/admin';

export default async function AdminAgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email: searchEmail } = await searchParams;
  // Fetch all agents and admins
  const serviceClient = createServiceRoleClient();
  const { data: staffUsers } = await serviceClient
    .from('profiles')
    .select('id, email, display_name, role')
    .in('role', ['agent', 'admin'])
    .order('role')
    .order('display_name');

  const adminCount = staffUsers?.filter((u) => u.role === 'admin').length ?? 0;

  // Handle user search
  let searchResult: { id: string; email: string; display_name: string | null; role: string } | null = null;
  if (searchEmail) {
    const { data } = await serviceClient
      .from('profiles')
      .select('id, email, display_name, role')
      .eq('email', searchEmail)
      .single();
    searchResult = data;
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Agents & Admins</h1>

      {/* Staff list */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wider">Current Staff</h2>
        {(!staffUsers || staffUsers.length === 0) ? (
          <p className="text-gray-500 text-sm">No agents or admins found.</p>
        ) : (
          <ul className="divide-y divide-gray-200">
            {staffUsers.map((u) => (
              <li key={u.id} className="py-3 flex flex-wrap items-center gap-3">
                <span className="text-sm font-medium text-gray-900">
                  {u.display_name ?? u.email}
                </span>
                <span className="text-xs text-gray-500">{u.email}</span>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                    u.role === 'admin'
                      ? 'bg-red-100 text-red-700'
                      : 'bg-blue-100 text-blue-700'
                  }`}
                >
                  {u.role}
                </span>

                {u.role === 'admin' && (
                  <form action={demoteToAgent}>
                    <input type="hidden" name="user_id" value={u.id} />
                    <button
                      type="submit"
                      disabled={adminCount <= 1}
                      className="px-2 py-1 text-xs bg-yellow-100 text-yellow-700 rounded hover:bg-yellow-200 disabled:opacity-50 disabled:cursor-not-allowed"
                      title={adminCount <= 1 ? 'Cannot remove the last admin' : 'Demote to Agent'}
                    >
                      Demote to Agent
                    </button>
                  </form>
                )}

                {u.role === 'agent' && (
                  <form action={demoteToUser}>
                    <input type="hidden" name="user_id" value={u.id} />
                    <button
                      type="submit"
                      className="px-2 py-1 text-xs bg-yellow-100 text-yellow-700 rounded hover:bg-yellow-200"
                    >
                      Demote to User
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Search user */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wider">Search User by Email</h2>
        <form className="flex gap-2 items-end mb-4">
          <div>
            <label htmlFor="search-email" className="block text-xs font-medium text-gray-500 mb-1">Email</label>
            <input
              id="search-email"
              type="email"
              name="email"
              defaultValue={searchEmail ?? ''}
              required
              className="rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              placeholder="user@example.com"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
          >
            Search
          </button>
        </form>

        {searchEmail && !searchResult && (
          <p className="text-sm text-gray-500">No user found with email &quot;{searchEmail}&quot;.</p>
        )}

        {searchResult && (
          <div className="border border-gray-200 rounded p-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium text-gray-900">
                {searchResult.display_name ?? searchResult.email}
              </span>
              <span className="text-xs text-gray-500">{searchResult.email}</span>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                  searchResult.role === 'admin'
                    ? 'bg-red-100 text-red-700'
                    : searchResult.role === 'agent'
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-gray-100 text-gray-700'
                }`}
              >
                {searchResult.role}
              </span>

              {searchResult.role === 'user' && (
                <>
                  <form action={promoteToAgent}>
                    <input type="hidden" name="user_id" value={searchResult.id} />
                    <button
                      type="submit"
                      className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                    >
                      Promote to Agent
                    </button>
                  </form>
                  <form action={promoteToAdmin}>
                    <input type="hidden" name="user_id" value={searchResult.id} />
                    <button
                      type="submit"
                      className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
                    >
                      Promote to Admin
                    </button>
                  </form>
                </>
              )}

              {searchResult.role === 'agent' && (
                <>
                  <form action={promoteToAdmin}>
                    <input type="hidden" name="user_id" value={searchResult.id} />
                    <button
                      type="submit"
                      className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
                    >
                      Promote to Admin
                    </button>
                  </form>
                  <form action={demoteToUser}>
                    <input type="hidden" name="user_id" value={searchResult.id} />
                    <button
                      type="submit"
                      className="px-2 py-1 text-xs bg-yellow-100 text-yellow-700 rounded hover:bg-yellow-200"
                    >
                      Demote to User
                    </button>
                  </form>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
