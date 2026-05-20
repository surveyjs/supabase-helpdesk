// TicketDetail — two-column ticket view with timeline + reply composer.
// Mirrors src/app/(main)/tickets/[id]/[slug]/page.tsx (the densest screen).

function TicketDetail({ ticket, onBack }) {
  const [reply, setReply] = React.useState('');
  const [thread, setThread] = React.useState([
    { id: 'p1', author: 'You',          role: 'user',  when: 'May 18, 9:12 AM',  body: 'Since yesterday afternoon I\u2019m not getting any email notifications when a ticket I follow is updated. Notification settings still show all events enabled. I checked spam — nothing there.' },
    { id: 'p2', author: 'Alex Park',    role: 'agent', when: 'May 18, 10:03 AM', body: 'Thanks for the report. Could you confirm the email address on your profile is still the same one you\u2019re monitoring? We had a brief SMTP outage on May 17 between 16:00–17:30 UTC — anything queued during that window may have been dropped.', isPrivate: false },
    { id: 'p3', author: 'Alex Park',    role: 'agent', when: 'May 19, 9:00 AM',  body: 'Internal: requeued the affected notifications, escalating if no response by EOD.', isPrivate: true },
  ]);

  function sendReply(e) {
    e.preventDefault();
    if (!reply.trim()) return;
    setThread([...thread, { id: 'p' + Date.now(), author: 'You', role: 'user', when: 'Just now', body: reply }]);
    setReply('');
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
      {/* Main column */}
      <div>
        <button onClick={onBack} className="text-sm text-blue-600 hover:text-blue-800 inline-flex items-center gap-1 mb-3">
          <Icon name="arrow-left" className="h-4 w-4"/> Back to My Tickets
        </button>
        <div className="flex items-start justify-between gap-4 mb-2">
          <h1 className="text-2xl font-semibold text-gray-900 leading-tight flex-1">{ticket.title}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 mb-6">
          <span className="text-xs text-gray-500 font-mono">TICKET-{ticket.id}</span>
          <span className="text-xs text-gray-400">·</span>
          <Badge variant="status" value={ticket.status}/>
          <Badge variant="priority" value={ticket.urgency}/>
          <span className="text-xs text-gray-500 inline-flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-yellow-500"/> SLA approaching · 1h 12m to first response</span>
        </div>

        {/* AI Summary panel (collapsible) */}
        <details className="bg-white rounded-lg border border-gray-200 mb-4">
          <summary className="px-4 py-3 cursor-pointer text-sm font-medium text-gray-700 hover:text-gray-900 list-none flex items-center justify-between">
            <span className="inline-flex items-center gap-2"><Icon name="sparkles" className="h-4 w-4 text-blue-600"/>AI Summary</span>
            <Icon name="chevron-down" className="h-4 w-4"/>
          </summary>
          <div className="px-4 pb-4 text-sm text-gray-700 leading-relaxed border-t border-gray-200 pt-3">
            User reports missing email notifications since May 17. Likely linked to the SMTP outage during that window. Agent has requeued affected notifications and is monitoring.
          </div>
        </details>

        {/* Timeline */}
        <div className="space-y-4">
          {thread.map(p => (
            <div key={p.id} className={`bg-white rounded-lg border ${p.isPrivate ? 'border-amber-300 bg-amber-50' : 'border-gray-200'} p-4`}>
              <div className="flex items-center gap-2 mb-2">
                <div className="h-7 w-7 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center text-xs font-semibold">{p.author[0]}</div>
                <span className="text-sm font-medium text-gray-900">{p.author}</span>
                {p.role === 'agent' && <RoleBadge role="agent"/>}
                {p.isPrivate && (
                  <span className="inline-flex items-center gap-1 text-xs text-amber-800 font-medium"><Icon name="lock" className="h-3.5 w-3.5"/>Internal note</span>
                )}
                <span className="text-xs text-gray-500 ml-auto">{p.when}</span>
              </div>
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{p.body}</p>
            </div>
          ))}
        </div>

        {/* Reply composer */}
        <form onSubmit={sendReply} className="bg-white rounded-lg border border-gray-200 p-4 mt-4">
          <label htmlFor="reply" className="block text-sm font-medium text-gray-700 mb-1">Reply</label>
          <textarea
            id="reply"
            rows={4}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Type your reply… Markdown supported."
            className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none resize-y"
          />
          <div className="flex items-center justify-between mt-3">
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <button type="button" className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 text-gray-600">
                <Icon name="paperclip" className="h-4 w-4"/> Attach
              </button>
              <button type="button" className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 text-gray-600">
                <Icon name="sparkles" className="h-4 w-4"/> Suggest reply
              </button>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" type="button">Save draft</Button>
              <Button type="submit">Send reply</Button>
            </div>
          </div>
        </form>
      </div>

      {/* Sidebar */}
      <aside className="space-y-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-xs uppercase text-gray-500 font-medium tracking-wide mb-3">Properties</div>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between gap-2"><dt className="text-gray-500">Status</dt><dd><Badge variant="status" value={ticket.status}/></dd></div>
            <div className="flex justify-between gap-2"><dt className="text-gray-500">Urgency</dt><dd><Badge variant="priority" value={ticket.urgency}/></dd></div>
            <div className="flex justify-between gap-2"><dt className="text-gray-500">Severity</dt><dd><Badge variant="priority" value="medium"/></dd></div>
            <div className="flex justify-between gap-2"><dt className="text-gray-500">Submitter</dt><dd className="text-gray-900">Maya Lin</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-gray-500">Tier</dt><dd><TierBadge displayName="Premium" color="purple" icon="★"/></dd></div>
            <div className="flex justify-between gap-2"><dt className="text-gray-500">Assignee</dt><dd className="text-gray-900">Alex Park</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-gray-500">Category</dt><dd className="text-gray-900">Notifications</dd></div>
            <div className="flex justify-between gap-2 items-start"><dt className="text-gray-500">Tags</dt><dd className="flex flex-wrap gap-1 justify-end"><span className="px-2 py-0.5 rounded bg-gray-100 text-gray-700 text-xs">email</span><span className="px-2 py-0.5 rounded bg-gray-100 text-gray-700 text-xs">smtp</span></dd></div>
          </dl>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-xs uppercase text-gray-500 font-medium tracking-wide mb-2">Suggested articles</div>
          <ul className="space-y-2 text-sm">
            <li><a href="#" className="text-blue-600 hover:text-blue-800">Email notifications not arriving</a></li>
            <li><a href="#" className="text-blue-600 hover:text-blue-800">Configuring SMTP in HelpDesk</a></li>
          </ul>
        </div>
      </aside>
    </div>
  );
}

window.TicketDetail = TicketDetail;
