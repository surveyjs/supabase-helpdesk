// MyTickets — end-user ticket list. Mirrors src/app/(main)/tickets/page.tsx.

const MY_TICKETS_SEED = [
  { id: 1284, slug: 'email-notifications-stopped-arriving', title: 'Email notifications stopped arriving',           status: 'open',    urgency: 'high',     updated_at: 'May 20', posts: 3 },
  { id: 1271, slug: 'cannot-upload-attachments-over-5mb',  title: 'Cannot upload attachments > 5MB',                  status: 'pending', urgency: 'medium',   updated_at: 'May 19', posts: 2 },
  { id: 1208, slug: 'sso-login-redirect-loops',            title: 'SSO login redirect loops on Safari',               status: 'open',    urgency: 'critical', updated_at: 'May 18', posts: 5 },
  { id: 1174, slug: 'csat-survey-shows-blank',             title: 'CSAT rating page shows a blank screen on iOS',     status: 'pending', urgency: 'low',      updated_at: 'May 16', posts: 1 },
  { id: 1102, slug: 'cant-merge-tickets',                  title: 'Can\u2019t merge two duplicate tickets',           status: 'closed',  urgency: 'low',      updated_at: 'May 12', posts: 4 },
];

function MyTickets({ onNavigate, onOpenTicket }) {
  const [statusFilter, setStatusFilter] = React.useState('all');
  const [search, setSearch] = React.useState('');
  const [page, setPage] = React.useState(1);

  let filtered = MY_TICKETS_SEED;
  if (statusFilter === 'active') filtered = filtered.filter(t => t.status !== 'closed');
  if (statusFilter === 'closed') filtered = filtered.filter(t => t.status === 'closed');
  if (search.trim()) filtered = filtered.filter(t => t.title.toLowerCase().includes(search.toLowerCase()));

  return (
    <div>
      <h1 className="sr-only">My Tickets</h1>

      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-4">
        {/* Status chips */}
        <div className="inline-flex gap-1" role="tablist" aria-label="Filter by status">
          {['all', 'active', 'closed'].map(s => (
            <button
              key={s}
              role="tab"
              aria-selected={statusFilter === s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 text-sm rounded font-medium ${statusFilter === s ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >
              {s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        <form onSubmit={(e) => e.preventDefault()} className="flex gap-2 flex-1 sm:max-w-md w-full">
          <Input className="flex-1" placeholder="Search tickets…" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search tickets"/>
          <Button variant="secondary">Search</Button>
        </form>

        <Button onClick={() => onNavigate('new-ticket')}>
          <Icon name="plus" className="h-4 w-4 mr-1"/> New Ticket
        </Button>
      </div>

      <div className="mb-4">
        <a href="#" className="text-sm text-blue-600 hover:text-blue-800">Browse Public Tickets →</a>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {filtered.map(t => (
          <button key={t.id} className="block w-full text-left bg-white rounded-lg border border-gray-200 p-4 hover:bg-gray-50" onClick={() => onOpenTicket(t)}>
            <div className="text-sm font-medium text-blue-600">{t.title}</div>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <Badge variant="status" value={t.status}/>
              <Badge variant="priority" value={t.urgency}/>
            </div>
            <div className="text-xs text-gray-500 mt-2">Updated {t.updated_at} · {t.posts} posts</div>
          </button>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Title</th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Urgency</th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Posts</th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {filtered.map(t => (
              <tr key={t.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => onOpenTicket(t)}>
                <td className="px-4 py-3">
                  <span className="text-sm font-medium text-blue-600 hover:text-blue-800">{t.title}</span>
                </td>
                <td className="px-4 py-3"><Badge variant="status" value={t.status}/></td>
                <td className="px-4 py-3"><Badge variant="priority" value={t.urgency}/></td>
                <td className="px-4 py-3 text-sm text-gray-600">{t.posts}</td>
                <td className="px-4 py-3 text-sm text-gray-500">{t.updated_at}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan="5" className="px-4 py-12 text-center text-gray-500 text-sm">No tickets match your filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination currentPage={page} totalPages={1} onPage={setPage}/>
    </div>
  );
}

window.MyTickets = MyTickets;
window.MY_TICKETS_SEED = MY_TICKETS_SEED;
