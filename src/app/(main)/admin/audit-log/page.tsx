import { createServerClient } from '@/lib/supabase/server';

function formatAuditAction(action: string, details: Record<string, unknown>): string {
  switch (action) {
    case 'create_ticket_type':
      return `Created ticket type "${details.name ?? ''}"`;
    case 'rename_ticket_type':
      return `Renamed ticket type to "${details.name ?? ''}"`;
    case 'delete_ticket_type':
      return `Deleted ticket type "${details.name ?? ''}"`;
    case 'set_default_ticket_type':
      return `Set default ticket type to "${details.name ?? ''}"`;
    case 'create_category':
      return `Created category "${details.name ?? ''}"`;
    case 'rename_category':
      return `Renamed category to "${details.name ?? ''}"`;
    case 'delete_category':
      return `Deleted category "${details.name ?? ''}"`;
    case 'create_tag':
      return `Created tag "${details.name ?? ''}"${details.color ? ` with color ${details.color}` : ''}`;
    case 'rename_tag':
      return `Renamed tag to "${details.name ?? ''}"`;
    case 'update_tag_color':
      return `Changed tag color to ${details.color ?? ''}`;
    case 'delete_tag':
      return `Deleted tag "${details.name ?? ''}"`;
    case 'create_team':
      return `Created team "${details.name ?? ''}"`;
    case 'rename_team':
      return `Renamed team to "${details.name ?? ''}"`;
    case 'delete_team':
      return `Deleted team "${details.name ?? ''}"`;
    case 'add_team_member':
      return `Added ${details.email ?? 'user'} to team`;
    case 'remove_team_member':
      return `Removed ${details.email ?? 'user'} from team`;
    case 'promote_to_agent':
      return `Promoted ${details.email ?? 'user'} to agent`;
    case 'promote_to_admin':
      return `Promoted ${details.email ?? 'user'} to admin`;
    case 'demote_to_agent':
      return `Demoted ${details.email ?? 'user'} to agent`;
    case 'demote_to_user':
      return `Demoted ${details.email ?? 'user'} to user`;
    case 'create_custom_field':
      return `Created custom field "${details.name ?? ''}" (${details.field_type ?? ''})`;
    case 'update_custom_field':
      return `Updated custom field "${details.name ?? ''}"`;
    case 'delete_custom_field':
      return `Deleted custom field "${details.name ?? ''}"`;
    case 'update_privacy_settings':
      return 'Updated privacy settings';
    case 'update_pagination_settings':
      return 'Updated pagination settings';
    case 'update_rate_limit':
      return `Updated rate limit to ${details.ticket_creation_rate_limit ?? '?'}`;
    case 'update_template':
      return `Updated notification template "${details.subject ?? ''}"`;
    case 'reset_template':
      return 'Reset notification template to default';
    case 'update_user_settings':
      return 'Updated user settings';
    default:
      return `${action}: ${JSON.stringify(details)}`;
  }
}

export default async function AdminAuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; admin?: string; from?: string; to?: string; page?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createServerClient();

  const currentPage = Math.max(1, parseInt(params.page ?? '1', 10) || 1);
  const pageSize = 20;
  const offset = (currentPage - 1) * pageSize;

  // Build query
  let query = supabase
    .from('admin_audit_log')
    .select('*, admin:profiles!admin_audit_log_admin_id_fkey(id, display_name, email)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (params.action) {
    query = query.eq('action', params.action);
  }
  if (params.admin) {
    query = query.eq('admin_id', params.admin);
  }
  if (params.from) {
    query = query.gte('created_at', params.from);
  }
  if (params.to) {
    query = query.lte('created_at', params.to + 'T23:59:59Z');
  }

  const { data: entries, count } = await query;
  const totalPages = Math.ceil((count ?? 0) / pageSize);

  // Get distinct action types for filter
  const { data: allEntries } = await supabase
    .from('admin_audit_log')
    .select('action')
    .order('action');
  const actionTypes = [...new Set((allEntries ?? []).map((e) => e.action))];

  // Get admins for filter
  const { data: admins } = await supabase
    .from('profiles')
    .select('id, display_name, email')
    .in('role', ['admin']);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Audit Log</h1>

      {/* Filters */}
      <form className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label htmlFor="filter-action" className="block text-xs font-medium text-gray-500 mb-1">Action</label>
            <select
              id="filter-action"
              name="action"
              defaultValue={params.action ?? ''}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm"
            >
              <option value="">All</option>
              {actionTypes.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="filter-admin" className="block text-xs font-medium text-gray-500 mb-1">Admin</label>
            <select
              id="filter-admin"
              name="admin"
              defaultValue={params.admin ?? ''}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm"
            >
              <option value="">All</option>
              {(admins ?? []).map((a) => (
                <option key={a.id} value={a.id}>{a.display_name ?? a.email}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="filter-from" className="block text-xs font-medium text-gray-500 mb-1">From</label>
            <input
              id="filter-from"
              type="date"
              name="from"
              defaultValue={params.from ?? ''}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label htmlFor="filter-to" className="block text-xs font-medium text-gray-500 mb-1">To</label>
            <input
              id="filter-to"
              type="date"
              name="to"
              defaultValue={params.to ?? ''}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
          >
            Filter
          </button>
        </div>
      </form>

      {/* Entries */}
      <div className="bg-white rounded-lg border border-gray-200">
        {(!entries || entries.length === 0) ? (
          <p className="text-gray-500 text-sm p-6">No audit log entries found.</p>
        ) : (
          <ul className="divide-y divide-gray-200">
            {entries.map((entry) => {
              const admin = Array.isArray(entry.admin) ? entry.admin[0] : entry.admin;
              const details = (entry.details ?? {}) as Record<string, unknown>;
              return (
                <li key={entry.id} className="px-6 py-3">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-gray-900">
                      {admin?.display_name ?? admin?.email ?? 'Unknown'}
                    </span>
                    <span className="text-xs text-gray-500">
                      {new Date(entry.created_at).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-sm text-gray-700 mt-0.5">
                    {formatAuditAction(entry.action, details)}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-4">
          {currentPage > 1 && (
            <a
              href={`/admin/audit-log?page=${currentPage - 1}${params.action ? `&action=${params.action}` : ''}${params.admin ? `&admin=${params.admin}` : ''}${params.from ? `&from=${params.from}` : ''}${params.to ? `&to=${params.to}` : ''}`}
              className="px-3 py-1 text-sm bg-gray-100 rounded hover:bg-gray-200"
            >
              Previous
            </a>
          )}
          <span className="px-3 py-1 text-sm text-gray-600">
            Page {currentPage} of {totalPages}
          </span>
          {currentPage < totalPages && (
            <a
              href={`/admin/audit-log?page=${currentPage + 1}${params.action ? `&action=${params.action}` : ''}${params.admin ? `&admin=${params.admin}` : ''}${params.from ? `&from=${params.from}` : ''}${params.to ? `&to=${params.to}` : ''}`}
              className="px-3 py-1 text-sm bg-gray-100 rounded hover:bg-gray-200"
            >
              Next
            </a>
          )}
        </div>
      )}
    </div>
  );
}
