// New Ticket — create form. Mirrors src/app/(main)/tickets/new/page.tsx.

function NewTicket({ onCreated, onCancel }) {
  const [title, setTitle] = React.useState('');
  const [type, setType] = React.useState('question');
  const [category, setCategory] = React.useState('');
  const [urgency, setUrgency] = React.useState('medium');
  const [body, setBody] = React.useState('');
  const [privateTicket, setPrivate] = React.useState(false);

  function submit(e) {
    e.preventDefault();
    onCreated({ id: Math.floor(Math.random() * 1000 + 1300), slug: 'new-ticket', title: title || 'New ticket', status: 'open', urgency, posts: 1, updated_at: 'Just now' });
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Create Ticket</h1>
      <form onSubmit={submit} className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <Input id="t-title" label="Title" placeholder="A short summary of the problem" value={title} onChange={e => setTitle(e.target.value)} required maxLength={200}/>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Select id="t-type" label="Type" value={type} onChange={e => setType(e.target.value)}>
            <option value="question">Question</option>
            <option value="bug">Bug</option>
            <option value="feature">Feature request</option>
            <option value="billing">Billing</option>
          </Select>
          <Select id="t-cat" label="Category" value={category} onChange={e => setCategory(e.target.value)}>
            <option value="">Select…</option>
            <option>Account</option>
            <option>Notifications</option>
            <option>Integrations</option>
            <option>API</option>
          </Select>
          <Select id="t-urg" label="Urgency" value={urgency} onChange={e => setUrgency(e.target.value)}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </Select>
        </div>

        <Textarea id="t-body" label="Description" rows={8} placeholder="Describe what you expected vs. what happened. Steps to reproduce help us close this faster. Markdown supported." value={body} onChange={e => setBody(e.target.value)}/>

        {/* Attachment dropzone */}
        <div className="border border-dashed border-gray-300 rounded-md p-4 text-sm text-gray-500 flex items-center justify-center gap-2 hover:bg-gray-50 cursor-pointer">
          <Icon name="paperclip" className="h-4 w-4"/>
          Drop files here or click to attach
        </div>

        {/* AI suggestions box */}
        <div className="border border-blue-200 bg-blue-50 rounded-md p-3 text-sm">
          <div className="flex items-center gap-2 text-blue-800 font-medium mb-1"><Icon name="sparkles" className="h-4 w-4"/>Suggested articles</div>
          <ul className="space-y-1 text-blue-800">
            <li><a className="underline" href="#">Email notifications not arriving</a></li>
            <li><a className="underline" href="#">Configuring SMTP in HelpDesk</a></li>
          </ul>
        </div>

        <label className="inline-flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={privateTicket} onChange={e => setPrivate(e.target.checked)} className="accent-blue-600"/>
          Private (only agents can see this ticket)
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
          <Button type="submit">Create ticket</Button>
        </div>
      </form>
    </div>
  );
}

window.NewTicket = NewTicket;
