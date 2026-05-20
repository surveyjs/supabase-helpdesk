// Help Center — public KB category grid and article view.
// Mirrors src/app/(main)/help/page.tsx.

const KB_CATEGORIES = [
  { id: 'getting-started', name: 'Getting Started', count: 6 },
  { id: 'account-billing', name: 'Account & Billing', count: 9 },
  { id: 'integrations',    name: 'Integrations', count: 12 },
  { id: 'troubleshooting', name: 'Troubleshooting', count: 8 },
  { id: 'api',             name: 'API & Webhooks', count: 5 },
  { id: 'security',        name: 'Security & Privacy', count: 4 },
];

const KB_ARTICLES = {
  'getting-started': [
    { id: 1, title: 'How to submit your first ticket', snippet: 'Create a ticket from the help center or via email. Add a short title, detailed description, and any screenshots that show the problem.' },
    { id: 2, title: 'Setting up your profile and notification preferences', snippet: 'Open Profile from the user menu. Configure display name, default privacy, and per-event email preferences.' },
    { id: 3, title: 'Understanding ticket status (open, pending, closed)', snippet: 'Open tickets are awaiting work. Pending means we are waiting on you. Closed tickets are resolved; reopen by replying.' },
  ],
  'troubleshooting': [
    { id: 11, title: 'Email notifications not arriving', snippet: 'Check spam, verify the SMTP config in Admin → Email, and ensure your notification preferences are enabled for the event.' },
    { id: 12, title: 'Why can\u2019t I upload an attachment?', snippet: 'Attachments are limited to the size set under Admin → File Settings. SVGs are sanitized server-side; corrupted files are rejected.' },
  ],
};

function HelpCenter({ onNavigate }) {
  const [search, setSearch] = React.useState('');
  const [activeCat, setActiveCat] = React.useState(null);
  const [activeArticle, setActiveArticle] = React.useState(null);

  if (activeArticle) {
    return (
      <article className="bg-white rounded-lg border border-gray-200 p-6">
        <button onClick={() => setActiveArticle(null)} className="text-sm text-blue-600 hover:text-blue-800 mb-4 inline-flex items-center gap-1">
          <Icon name="arrow-left" className="h-4 w-4"/> Back to {activeCat ? KB_CATEGORIES.find(c=>c.id===activeCat)?.name : 'categories'}
        </button>
        <h1 className="text-2xl font-semibold text-gray-900 mb-2">{activeArticle.title}</h1>
        <p className="text-xs text-gray-500 mb-6">Updated May 14 · 2 min read</p>
        <div className="prose-helpdesk space-y-4 text-[15px] leading-relaxed text-gray-700">
          <p>{activeArticle.snippet}</p>
          <p>To get started, open the navigation menu and choose <strong>Help Center</strong>. From there you can browse by category or use the search bar at the top of every page.</p>
          <p>If you can&rsquo;t find what you need, you can <a href="#" onClick={(e)=>{e.preventDefault(); onNavigate('new-ticket');}} className="text-blue-600 hover:text-blue-800 underline">create a ticket</a> directly from this article — the title will be pre-filled with the article reference.</p>
        </div>
        <div className="mt-8 pt-4 border-t border-gray-200 text-sm text-gray-600 flex items-center gap-3">
          <span>Was this article helpful?</span>
          <button className="px-3 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50">👍 Yes</button>
          <button className="px-3 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50">👎 No</button>
        </div>
      </article>
    );
  }

  if (activeCat) {
    const cat = KB_CATEGORIES.find(c => c.id === activeCat);
    const articles = KB_ARTICLES[activeCat] ?? [];
    return (
      <div>
        <form onSubmit={(e) => e.preventDefault()} className="mb-6 flex gap-2">
          <Input className="flex-1" placeholder="Search articles…" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search articles"/>
          <Button>Search</Button>
        </form>
        <div className="flex items-center gap-2 mb-4 text-sm">
          <a href="#" onClick={(e) => { e.preventDefault(); setActiveCat(null); }} className="text-blue-600 hover:text-blue-800">← All categories</a>
          <span className="text-gray-400">/</span>
          <span className="text-gray-700 font-medium">{cat.name}</span>
        </div>
        {articles.length === 0 ? (
          <p className="text-gray-500 text-sm">No articles in this category yet.</p>
        ) : (
          <ul className="space-y-3">
            {articles.map(a => (
              <li key={a.id} className="bg-white rounded-lg border border-gray-200 p-4">
                <a href="#" onClick={(e) => { e.preventDefault(); setActiveArticle(a); }} className="text-blue-600 hover:text-blue-800 font-medium">{a.title}</a>
                <p className="mt-1 text-sm text-gray-600">{a.snippet}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div>
      <form onSubmit={(e) => e.preventDefault()} className="mb-6 flex gap-2">
        <Input className="flex-1" placeholder="Search articles…" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search articles"/>
        <Button>Search</Button>
      </form>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {KB_CATEGORIES.map(cat => (
          <a key={cat.id} href="#" onClick={(e) => { e.preventDefault(); setActiveCat(cat.id); }}
             className="block bg-white rounded-lg border border-gray-200 p-4 hover:shadow-sm transition-shadow">
            <h2 className="text-lg font-medium text-gray-900">{cat.name}</h2>
            <p className="text-sm text-gray-500 mt-1">{cat.count} article{cat.count !== 1 ? 's' : ''}</p>
          </a>
        ))}
      </div>
    </div>
  );
}

window.HelpCenter = HelpCenter;
