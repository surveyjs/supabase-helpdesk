// Agent Dashboard — ticket queue with stats panel, filters, table.
// Mirrors src/app/(main)/agent/page.tsx.

const AGENT_TICKETS = [
  { id: 1284, title: 'Email notifications stopped arriving',          submitter: 'Maya Lin',     tier: { name: 'Premium', color: 'purple', icon: '\u2605' }, status: 'open',    urgency: 'high',     severity: 'high',     sla: 'approaching', posts: 3, updated: 'May 20', isPrivate: false },
  { id: 1283, title: 'Saved view sort order is not respected',        submitter: 'Jordan O.',    tier: null,                                                  status: 'open',    urgency: 'medium',   severity: 'medium',   sla: 'met',         posts: 2, updated: 'May 20', isPrivate: false },
  { id: 1271, title: 'Cannot upload attachments > 5MB',               submitter: 'Sam W.',       tier: { name: 'Standard', color: 'blue', icon: null },        status: 'pending', urgency: 'medium',   severity: 'low',      sla: 'met',         posts: 5, updated: 'May 19', isPrivate: false },
  { id: 1262, title: 'SSO login redirect loops on Safari (internal)', submitter: 'Priya V.',     tier: { name: 'Enterprise', color: 'green', icon: '\u25CF' }, status: 'open',    urgency: 'critical', severity: 'critical', sla: 'breached',    posts: 8, updated: 'May 19', isPrivate: true },
  { id: 1255, title: 'CSAT rating page shows blank on iOS',           submitter: 'Mohammed K.',  tier: { name: 'Pro', color: 'teal', icon: '\u25C8' },         status: 'open',    urgency: 'low',      severity: 'low',      sla: 'met',         posts: 1, updated: 'May 18', isPrivate: false },
  { id: 1208, title: 'Tag-based filter clears on pagination',         submitter: 'Liu Y.',       tier: null,                                                  status: 'pending', urgency: 'medium',   severity: 'medium',   sla: 'approaching', posts: 4, updated: 'May 17', isPrivate: false },
  { id: 1199, title: 'Bulk delete fails when selecting > 100 tickets',submitter: 'Eric Tan',     tier: { name: 'Standard', color: 'blue', icon: null },        status: 'open',    urgency: 'high',     severity: 'high',     sla: 'breached',    posts: 6, updated: 'May 17', isPrivate: false },
  { id: 1174, title: 'AI auto-categorization labels everything Bug',  submitter: 'Internal',     tier: null,                                                  status: 'closed',  urgency: 'low',      severity: 'low',      sla: 'met',         posts: 7, updated: 'May 14', isPrivate: false },
];

const SLA_DOT = {
  met:         { color: 'bg-green-500',  label: 'On track' },
  approaching: { color: 'bg-yellow-500', label: 'Approaching' },
  breached:    { color: 'bg-red-500',    label: 'Breached' },
};

function AgentDashboard({ onOpenTicket }) {
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [statsOpen, setStatsOpen]     = React.useState(true);
  const [selected, setSelected]       = React.useState(new Set());
  const [view, setView]               = React.useState('Default');
  const [statusFilter, setStatusFilter] = React.useState('all');

  let rows = AGENT_TICKETS;
  if (statusFilter !== 'all') rows = rows.filter(t => t.status === statusFilter);

  function toggle(id) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  }
  function toggleAll() {
    if (selected.size === rows.length) setSelected(new Set());
    else setSelected(new Set(rows.map(r => r.id)));
  }

  const STATS = [
    { label: 'Tickets Assigned',   value: 24 },
    { label: 'Tickets Resolved',   value: 19 },
    { label: 'Avg Response Time',  value: '38m' },
    { label: 'Avg Resolution Time',value: '6h 12m' },
    { label: 'Avg CSAT Rating',    value: '4.6 / 5' },
    { label: 'SLA Compliance',     value: '94%' },
  ];

  return (
    <div>
      <h1 className="sr-only">Agent Dashboard</h1>

      {/* Stats panel */}
      <details open={statsOpen} onToggle={(e) => setStatsOpen(e.currentTarget.open)} className="mb-4 bg-white rounded-lg border border-gray-200">
        <summary className="px-4 py-3 cursor-pointer text-sm font-medium text-gray-700 hover:text-gray-900 list-none flex items-center justify-between">
          <span>My Stats (Last 30 Days)</span>
          <Icon name="chevron-down" className={`h-4 w-4 transition-transform ${statsOpen ? 'rotate-180' : ''}`}/>
        </summary>
        <div className="px-4 pb-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 border-t border-gray-100 pt-3">
          {STATS.map(s => (
            <div key={s.label}>
              <dt className="text-xs text-gray-500">{s.label}</dt>
              <dd className="text-lg font-semibold text-gray-900 mt-0.5">{s.value}</dd>
            </div>
          ))}
        </div>
      </details>

      {/* Views & Filters panel */}
      <details open={filtersOpen} onToggle={(e) => setFiltersOpen(e.currentTarget.open)} className="bg-white rounded-lg border border-gray-200 mb-4">
        <summary className="px-4 py-3 cursor-pointer text-sm font-medium text-gray-700 hover:text-gray-900 list-none flex items-center justify-between">
          <span>Views &amp; Filters: <span className="text-gray-900">{view}</span></span>
          <Icon name="chevron-down" className={`h-4 w-4 transition-transform ${filtersOpen ? 'rotate-180' : ''}`}/>
        </summary>
        <div className="px-4 pt-4 pb-4 border-t border-gray-200 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Select label="Status">
            <option>Any status</option>
            <option>Open</option><option>Pending</option><option>Closed</option>
          </Select>
          <Select label="Urgency">
            <option>Any urgency</option>
            <option>Critical</option><option>High</option><option>Medium</option><option>Low</option>
          </Select>
          <Select label="Assignee">
            <option>Anyone</option>
            <option>Me</option><option>Alex Park</option><option>Priya V.</option>
          </Select>
          <Input label="Search" placeholder="Title or post text…"/>
          <Input label="Submitter email" placeholder="user@example.com"/>
          <Input label="Tags" placeholder="email, smtp"/>
          <div className="sm:col-span-3 flex gap-2 justify-end pt-1">
            <Button variant="outline">Clear</Button>
            <Button variant="secondary">Save as view</Button>
            <Button>Apply</Button>
          </div>
        </div>
      </details>

      {/* Result count + quick filters */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <p className="text-sm text-gray-600">{rows.length} ticket{rows.length !== 1 ? 's' : ''} found</p>
        <div className="inline-flex gap-1">
          {['all', 'open', 'pending', 'closed'].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)} className={`px-2.5 py-1 text-xs rounded-full border ${statusFilter === s ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'}`}>
              {s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Bulk action toolbar when something selected */}
      {selected.size > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-md px-4 py-2 mb-3 flex items-center justify-between text-sm">
          <span className="text-blue-800 font-medium">{selected.size} selected</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm">Assign</Button>
            <Button variant="outline" size="sm">Tag</Button>
            <Button variant="outline" size="sm">Close</Button>
            <Button variant="outline" size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
        </div>
      )}

      {/* Desktop table */}
      <div className="hidden md:block bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-3 text-center"><input type="checkbox" checked={selected.size === rows.length && rows.length > 0} onChange={toggleAll}/></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Title</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Submitter</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Urgency</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Severity</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">SLA</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Posts</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {rows.map(t => (
              <tr key={t.id} className="hover:bg-gray-50">
                <td className="px-3 py-3 text-center"><input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)}/></td>
                <td className="px-4 py-3">
                  <button onClick={() => onOpenTicket(t)} className="text-sm font-medium text-blue-600 hover:text-blue-800 text-left">{t.title}</button>
                  {t.isPrivate && <span className="ml-1 text-xs text-gray-500" title="Private">🔒</span>}
                </td>
                <td className="px-4 py-3 text-sm text-gray-700">
                  {t.submitter}
                  {t.tier && <span className="ml-1.5"><TierBadge displayName={t.tier.name} color={t.tier.color} icon={t.tier.icon}/></span>}
                </td>
                <td className="px-4 py-3"><Badge variant="status" value={t.status}/></td>
                <td className="px-4 py-3"><Badge variant="priority" value={t.urgency}/></td>
                <td className="px-4 py-3"><Badge variant="priority" value={t.severity}/></td>
                <td className="px-4 py-3" title={`SLA: ${SLA_DOT[t.sla].label}`}>
                  <span className={`inline-block w-2.5 h-2.5 rounded-full ${SLA_DOT[t.sla].color}`}/>
                  <span className="sr-only">{SLA_DOT[t.sla].label}</span>
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">{t.posts}</td>
                <td className="px-4 py-3 text-sm text-gray-500">{t.updated}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {rows.map(t => (
          <div key={t.id} className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-start gap-3">
              <input type="checkbox" className="mt-1" checked={selected.has(t.id)} onChange={() => toggle(t.id)}/>
              <div className="flex-1 min-w-0">
                <button onClick={() => onOpenTicket(t)} className="text-sm font-medium text-blue-600 text-left line-clamp-2">{t.title}</button>
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <Badge variant="status" value={t.status}/>
                  <Badge variant="priority" value={t.urgency}/>
                  <span className="text-xs text-gray-500">SLA: {SLA_DOT[t.sla].label}</span>
                </div>
                <div className="text-xs text-gray-500 mt-1">{t.submitter} · Updated {t.updated}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

window.AgentDashboard = AgentDashboard;
window.AGENT_TICKETS = AGENT_TICKETS;
