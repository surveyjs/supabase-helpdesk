// Posts-thread redesign for the HelpDesk ticket detail.
// Two variations, both fix the "which post does this comment belong to?" problem
// by attaching the reply affordance to each post instead of floating it.

const { useState, useMemo } = React;

/* ---------- shared atoms ---------- */

function Avatar({ name, size = 32, tone = 'gray' }) {
  const initials = name.split(' ').slice(0, 2).map(s => s[0]).join('').toUpperCase();
  const tones = {
    gray:   'bg-gray-200 text-gray-700',
    blue:   'bg-blue-100 text-blue-700',
    purple: 'bg-purple-100 text-purple-700',
    teal:   'bg-teal-100 text-teal-700',
    orange: 'bg-orange-100 text-orange-700',
  };
  return (
    <div
      className={`shrink-0 rounded-full flex items-center justify-center font-semibold ${tones[tone]}`}
      style={{ width: size, height: size, fontSize: size <= 24 ? 10 : 12 }}
      aria-hidden="true"
    >
      {initials}
    </div>
  );
}

function StatusDot({ tone }) {
  const map = {
    green:  'bg-green-500',
    yellow: 'bg-yellow-500',
    red:    'bg-red-500',
  };
  return <span className={`inline-block w-2 h-2 rounded-full ${map[tone] || 'bg-gray-400'}`} />;
}

function Pill({ tone = 'gray', children }) {
  const tones = {
    gray:   'bg-gray-100 text-gray-700',
    blue:   'bg-blue-100 text-blue-700',
    green:  'bg-green-100 text-green-700',
    yellow: 'bg-yellow-100 text-yellow-700',
    red:    'bg-red-100 text-red-700',
    amber:  'bg-amber-50 text-amber-800 border border-amber-200',
  };
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

const I = {
  reply:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5"><path d="M9 17l-5-5 5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>,
  edit:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4z"/></svg>,
  more:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>,
  lock:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>,
  chevron:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5"><path d="M6 9l6 6 6-6"/></svg>,
  send:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></svg>,
  pencil:   <svg viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 inline-block ml-1 -translate-y-0.5"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4z"/></svg>,
  attach:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M21 12l-9 9a5 5 0 0 1-7-7l9-9a3 3 0 0 1 4 4l-9 9a1 1 0 0 1-1-1l8-8"/></svg>,
  markdown: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 14V10l2 2 2-2v4"/><path d="M15 10v4M13 12l2 2 2-2"/></svg>,
};

/* ---------- header (shared between variations) ---------- */

function TicketHeader({ title, opened, author }) {
  return (
    <header className="mb-5">
      <div className="flex items-start gap-2">
        <h1 className="text-[22px] font-semibold text-gray-900 leading-tight">{title}{I.pencil}</h1>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-gray-500">
        <span>Opened {opened} by <a className="text-blue-600 hover:text-blue-800 font-medium" href="#">{author}</a></span>
        <span className="text-gray-300">·</span>
        <span className="inline-flex items-center gap-1"><StatusDot tone="yellow"/> SLA · 1h 12m to first response</span>
      </div>
    </header>
  );
}

function ThreadTabs({ active, onChange, threadCount, notesCount }) {
  const tab = (key, label, count) => {
    const isActive = active === key;
    return (
      <button
        key={key}
        type="button"
        onClick={() => onChange(key)}
        className={`relative inline-flex items-center gap-1.5 px-1 pb-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
          isActive
            ? 'border-blue-600 text-blue-700'
            : 'border-transparent text-gray-500 hover:text-gray-800'
        }`}
        aria-pressed={isActive}
      >
        {key === 'notes' && <span className="text-amber-700">{I.lock}</span>}
        {label}
        <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[11px] font-semibold ${isActive ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{count}</span>
      </button>
    );
  };
  return (
    <div className="flex items-center gap-5 border-b border-gray-200 mb-5">
      {tab('thread', 'Conversation', threadCount)}
      {tab('notes', 'Internal notes', notesCount)}
    </div>
  );
}

/* ---------- the composer (used at post-reply and ticket-reply level) ---------- */

function InlineComposer({ placeholder = 'Write a comment…', autoFocus, onCancel, onSubmit, compact, asPrivate }) {
  const [value, setValue] = useState('');
  const [private_, setPrivate] = useState(!!asPrivate);
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (value.trim()) { onSubmit && onSubmit(value, private_); setValue(''); } }}
      className={`rounded-lg border ${private_ ? 'border-amber-300 bg-amber-50/40' : 'border-gray-300 bg-white'} ${compact ? 'p-2' : 'p-3'} focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500`}
    >
      <textarea
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        rows={compact ? 2 : 3}
        className="block w-full text-sm text-gray-900 placeholder:text-gray-400 bg-transparent border-0 outline-none resize-y"
      />
      <div className="flex items-center justify-between gap-2 mt-1">
        <div className="flex items-center gap-1 text-gray-500">
          <button type="button" className="inline-flex items-center gap-1 px-1.5 py-1 rounded hover:bg-gray-100 text-xs">{I.attach}</button>
          <button type="button" className="inline-flex items-center gap-1 px-1.5 py-1 rounded hover:bg-gray-100 text-xs">{I.markdown}</button>
          <label className="inline-flex items-center gap-1.5 px-1.5 py-1 rounded hover:bg-gray-100 text-xs cursor-pointer select-none">
            <input type="checkbox" checked={private_} onChange={(e) => setPrivate(e.target.checked)} className="h-3 w-3 accent-amber-600"/>
            <span className={private_ ? 'text-amber-800 font-medium' : 'text-gray-600'}>Internal note</span>
          </label>
        </div>
        <div className="flex items-center gap-2">
          {onCancel && <button type="button" onClick={onCancel} className="text-xs text-gray-500 hover:text-gray-800 px-2 py-1">Cancel</button>}
          <button
            type="submit"
            disabled={!value.trim()}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium ${
              value.trim() ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            }`}
          >
            {I.send} Send
          </button>
        </div>
      </div>
    </form>
  );
}

/* =============================================================
   Sidebar — Properties panel
   Editable form pattern (label-above-control) matching the existing
   screen. Status moved to the header; Priority added here.
   ============================================================= */

function FieldSelect({ id, label, value, tone, options = [], chevron = true }) {
  const toneRing = {
    green:  'border-green-200',
    yellow: 'border-yellow-200',
    orange: 'border-orange-200',
    red:    'border-red-200',
    blue:   'border-blue-200',
    teal:   'border-teal-200',
    gray:   'border-gray-200',
  };
  return (
    <div>
      <label htmlFor={id} className="block text-[12px] font-semibold text-gray-900 mb-1">{label}</label>
      <div className={`relative flex items-center justify-between w-full bg-white border ${toneRing[tone] || 'border-gray-300'} rounded-md px-3 py-2 text-sm text-gray-800 hover:border-gray-400 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500`}>
        <span className="inline-flex items-center gap-2">
          {tone && <span className={`inline-block w-2 h-2 rounded-full ${
            tone === 'green'  ? 'bg-green-500'  :
            tone === 'yellow' ? 'bg-yellow-500' :
            tone === 'orange' ? 'bg-orange-500' :
            tone === 'red'    ? 'bg-red-500'    :
            tone === 'teal'   ? 'bg-teal-500'   :
            tone === 'blue'   ? 'bg-blue-500'   : 'bg-gray-400'
          }`}/>}
          <span>{value}</span>
        </span>
        {chevron && <span className="text-gray-400">{I.chevron}</span>}
      </div>
    </div>
  );
}

function FieldRow({ label, children, action }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[12px] font-semibold text-gray-900">{label}</span>
        {action}
      </div>
      <div className="text-sm text-gray-800">{children}</div>
    </div>
  );
}

function SectionLabel({ children }) {
  return <div className="text-[10.5px] font-semibold text-gray-500 uppercase tracking-wider mt-1 mb-2">{children}</div>;
}

function TicketSidebar({ ticket }) {
  return (
    <aside className="w-[260px] shrink-0">
      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
        {/* Identity row — ticket number, read-only */}
        <div className="-mb-1">
          <span className="font-mono text-sm text-gray-500">#{ticket.id}</span>
        </div>

        <FieldSelect
          id="status"
          label="Status"
          value={ticket.status[0].toUpperCase() + ticket.status.slice(1)}
          tone={ticket.status === 'open' ? 'green' : ticket.status === 'pending' ? 'yellow' : 'gray'}
        />
        <FieldSelect
          id="priority"
          label="Priority"
          value={ticket.priority[0].toUpperCase() + ticket.priority.slice(1)}
          tone={ticket.priority === 'high' ? 'red' : ticket.priority === 'medium' ? 'orange' : 'blue'}
        />
        <FieldSelect
          id="urgency"
          label="Urgency"
          value={ticket.urgency || 'High'}
          tone="orange"
        />
        <FieldSelect
          id="severity"
          label="Severity"
          value={ticket.severity || 'Medium'}
          tone="teal"
        />

        <div className="border-t border-gray-100 -mx-4"/>
        <FieldRow label="Submitter">
          <span className="inline-flex items-center gap-2">
            <Avatar name={ticket.author} size={20} tone="gray"/>
            <span>{ticket.author}</span>
          </span>
        </FieldRow>
        <FieldRow label="Assignee" action={<button className="text-[11px] text-blue-600 hover:text-blue-800 font-medium">Change</button>}>
          <span className="inline-flex items-center gap-2">
            <Avatar name={ticket.assignee || 'Alex Park'} size={20} tone="blue"/>
            <span>{ticket.assignee || 'Alex Park'}</span>
          </span>
        </FieldRow>
        <FieldRow label="Tier">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
            <span>★</span>{ticket.tier || 'Premium'}
          </span>
        </FieldRow>
        <FieldSelect
          id="category"
          label="Category"
          value={ticket.category || 'Authentication'}
          tone="gray"
        />
        <FieldRow label="Tags" action={<button className="text-[11px] text-blue-600 hover:text-blue-800 font-medium">+ Add</button>}>
          <div className="flex flex-wrap gap-1">
            {(ticket.tags || ['mobile','safari','login']).map(t => (
              <span key={t} className="px-2 py-0.5 rounded bg-gray-100 text-gray-700 text-xs">{t}</span>
            ))}
          </div>
        </FieldRow>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-4 mt-4">
        <div className="text-[10.5px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Suggested articles</div>
        <ul className="space-y-1.5 text-sm">
          <li><a href="#" className="text-blue-600 hover:text-blue-800">Logging in on iOS Safari</a></li>
          <li><a href="#" className="text-blue-600 hover:text-blue-800">Clearing cookies & site data</a></li>
        </ul>
      </div>
    </aside>
  );
}

/* =============================================================
   TicketDetail — thread + sidebar composed together
   ============================================================= */

function TicketDetail({ ticket, thread }) {
  return (
    <div className="flex gap-6 items-start">
      <div className="flex-1 min-w-0">
        <Thread ticket={ticket} thread={thread}/>
      </div>
      <TicketSidebar ticket={ticket}/>
    </div>
  );
}

/* =============================================================
   Unified Post — A-style timeline with adaptive comment collapse.

   Rules (so a thread auto-grades from A → B as it grows):
   - Per-post:   comments ≤ COMMENT_INLINE_MAX  → show inline (A behavior)
                 comments  > COMMENT_INLINE_MAX  → show latest COMMENT_TAIL,
                                                   collapse the rest behind
                                                   "Show N earlier comments"
   - Thread:     posts ≤ POST_INLINE_MAX        → show all
                 posts  > POST_INLINE_MAX        → keep first + last 2,
                                                   fold the middle behind
                                                   "Show N earlier replies"
   ============================================================= */

const COMMENT_INLINE_MAX = 2;   // ≤ this many comments show inline
const COMMENT_TAIL       = 2;   // when collapsed, show this many most-recent
const POST_INLINE_MAX    = 4;   // ≤ this many posts show all
const POST_TAIL          = 2;   // when collapsed, keep first + this many last

function CommentRow({ c }) {
  return (
    <div className="flex gap-2.5">
      <Avatar name={c.author} size={24} tone={c.role === 'agent' ? 'blue' : 'gray'} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <a href="#" className="text-[13px] font-semibold text-gray-900 hover:underline">{c.author}</a>
          {c.role === 'agent' && <span className="text-[10px] text-blue-700 bg-blue-100 px-1 rounded">Agent</span>}
          <span className="text-[11px] text-gray-500">{c.when}</span>
        </div>
        <p className="text-[13px] text-gray-800 leading-relaxed">{c.body}</p>
      </div>
    </div>
  );
}

function Post({ post, isLast }) {
  const [replying, setReplying] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showAllComments, setShowAllComments] = useState(false);

  const isPrivate = post.private;
  const isOriginal = post.original;
  const comments = post.comments || [];
  const overflowing = comments.length > COMMENT_INLINE_MAX;
  const hiddenCount = overflowing ? comments.length - COMMENT_TAIL : 0;
  const visibleComments = overflowing && !showAllComments
    ? comments.slice(comments.length - COMMENT_TAIL)
    : comments;

  return (
    <li className="relative">
      {/* connector line down the avatar gutter */}
      {!isLast && <span className="absolute left-[19px] top-10 bottom-0 w-px bg-gray-200" aria-hidden="true"/>}
      <div className="flex gap-3">
        <Avatar name={post.author} tone={post.role === 'agent' ? 'blue' : 'gray'} />
        <div className="flex-1 min-w-0">
          <div className={`rounded-lg border ${isPrivate ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-white'} ${isOriginal ? 'ring-1 ring-blue-100' : ''}`}>
            <div className="flex items-center gap-2 px-4 pt-3">
              <a href="#" className="text-sm font-semibold text-gray-900 hover:underline">{post.author}</a>
              {post.role === 'agent' && <Pill tone="blue">Agent</Pill>}
              {isOriginal && <Pill tone="gray">Original post</Pill>}
              {isPrivate && <Pill tone="amber"><span className="text-amber-700">{I.lock}</span>Private</Pill>}
              <span className="ml-auto flex items-center gap-2 text-xs text-gray-500">
                <span title={post.date}>{post.when}</span>
                {post.canManage && (
                  <span className="relative">
                    <button onClick={() => setMenuOpen(o => !o)} className="text-gray-400 hover:text-gray-700 rounded p-0.5 hover:bg-gray-100" aria-label="More actions">{I.more}</button>
                    {menuOpen && (
                      <div onMouseLeave={() => setMenuOpen(false)} className="absolute right-0 top-6 z-10 w-40 bg-white border border-gray-200 rounded-lg shadow-lg py-1 text-sm">
                        <button className="w-full text-left px-3 py-1.5 hover:bg-gray-50 text-gray-700 inline-flex items-center gap-2">{I.edit} Edit</button>
                        <button className="w-full text-left px-3 py-1.5 hover:bg-gray-50 text-gray-700 inline-flex items-center gap-2">{I.lock} Make private</button>
                        <div className="border-t border-gray-100 my-1"/>
                        <button className="w-full text-left px-3 py-1.5 hover:bg-red-50 text-red-700 inline-flex items-center gap-2">Delete</button>
                      </div>
                    )}
                  </span>
                )}
              </span>
            </div>
            <div className="px-4 pt-2 pb-3 text-sm text-gray-800 leading-relaxed whitespace-pre-wrap" dangerouslySetInnerHTML={{__html: post.body}}/>
            <div className="px-3 pb-2 flex items-center gap-1 text-xs">
              <button
                onClick={() => setReplying(r => !r)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded text-gray-600 hover:bg-gray-50 hover:text-blue-700 font-medium"
              >
                {I.reply} Reply
              </button>
              {comments.length > 0 && (
                <>
                  <span className="text-gray-300">·</span>
                  <span className="px-1 text-gray-500">{comments.length} {comments.length === 1 ? 'comment' : 'comments'}</span>
                </>
              )}
            </div>
          </div>

          {/* Nested comments — anchored to THIS post */}
          {(comments.length > 0 || replying) && (
            <div className="mt-2 ml-5 pl-4 border-l-2 border-gray-100 space-y-2.5">
              {overflowing && !showAllComments && (
                <button
                  onClick={() => setShowAllComments(true)}
                  className="inline-flex items-center gap-1 text-[12px] text-blue-600 hover:text-blue-800 font-medium"
                >
                  <span className="rotate-180 inline-block">{I.chevron}</span>
                  Show {hiddenCount} earlier {hiddenCount === 1 ? 'comment' : 'comments'}
                </button>
              )}
              {visibleComments.map(c => <CommentRow key={c.id} c={c}/>)}
              {overflowing && showAllComments && (
                <button
                  onClick={() => setShowAllComments(false)}
                  className="inline-flex items-center gap-1 text-[12px] text-gray-500 hover:text-gray-800 font-medium"
                >
                  {I.chevron} Collapse earlier comments
                </button>
              )}
              {replying && (
                <div className="pt-1">
                  <InlineComposer
                    compact
                    autoFocus
                    placeholder={`Reply to ${post.author}…`}
                    onCancel={() => setReplying(false)}
                    onSubmit={() => setReplying(false)}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {!isLast && <div className="h-3"/>}
    </li>
  );
}

function CollapsedPostsRow({ count, onExpand }) {
  return (
    <li className="relative">
      <span className="absolute left-[19px] top-0 bottom-0 w-px bg-gray-200" aria-hidden="true"/>
      <div className="flex gap-3 items-center py-1">
        <div className="shrink-0 w-10 flex justify-center">
          <span className="block w-2 h-2 rounded-full bg-gray-300"/>
        </div>
        <button
          onClick={onExpand}
          className="text-[13px] text-blue-600 hover:text-blue-800 font-medium inline-flex items-center gap-1"
        >
          <span className="rotate-180 inline-block">{I.chevron}</span>
          Show {count} earlier {count === 1 ? 'reply' : 'replies'}
        </button>
      </div>
      <div className="h-3"/>
    </li>
  );
}

function Thread({ ticket, thread }) {
  const [tab, setTab] = useState('thread');
  const [composerOpen, setComposerOpen] = useState(false);
  const [expandMiddle, setExpandMiddle] = useState(false);

  const visible = thread.filter(p => tab === 'notes' ? p.private : !p.private);
  const threadCount = thread.filter(p => !p.private).length;
  const notesCount = thread.filter(p => p.private).length;

  // Post-level fold: keep first post + last POST_TAIL, hide the middle
  const overflowingPosts = visible.length > POST_INLINE_MAX;
  let renderList;
  if (!overflowingPosts || expandMiddle) {
    renderList = visible.map(p => ({ kind: 'post', post: p }));
  } else {
    const head = visible.slice(0, 1);
    const tail = visible.slice(visible.length - POST_TAIL);
    const hidden = visible.length - head.length - tail.length;
    renderList = [
      ...head.map(p => ({ kind: 'post', post: p })),
      { kind: 'fold', count: hidden },
      ...tail.map(p => ({ kind: 'post', post: p })),
    ];
  }

  return (
    <div className="bg-white w-full">
      <TicketHeader title={ticket.title} opened={ticket.opened} author={ticket.author}/>
      <ThreadTabs active={tab} onChange={setTab} threadCount={threadCount} notesCount={notesCount}/>

      <ul className="list-none p-0 m-0">
        {renderList.map((item, i) => {
          const isLast = i === renderList.length - 1;
          if (item.kind === 'fold') {
            return <CollapsedPostsRow key={`fold-${i}`} count={item.count} onExpand={() => setExpandMiddle(true)}/>;
          }
          return <Post key={item.post.id} post={item.post} isLast={isLast}/>;
        })}
      </ul>

      <div className="mt-5 pt-4 border-t border-gray-200">
        {!composerOpen ? (
          <button
            onClick={() => setComposerOpen(true)}
            className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg border border-gray-300 bg-white text-sm text-gray-500 hover:border-blue-500 hover:text-gray-700"
          >
            <Avatar name="You" size={28} tone="teal"/>
            <span>Reply to this ticket…</span>
            <span className="ml-auto text-xs text-gray-400">Markdown supported</span>
          </button>
        ) : (
          <div className="flex gap-3">
            <Avatar name="You" size={28} tone="teal"/>
            <div className="flex-1">
              <InlineComposer
                autoFocus
                placeholder="Reply to this ticket…"
                onCancel={() => setComposerOpen(false)}
                onSubmit={() => setComposerOpen(false)}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* =============================================================
   VARIATION C — Original (annotated) — shows the current design with
   the bug the user pointed out highlighted.
   ============================================================= */

function ThreadOriginalAnnotated() {
  const Btn = ({ children }) => <button className="bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold px-3 py-1.5 rounded">{children}</button>;
  return (
    <div className="bg-white relative" style={{ width: 760 }}>
      <h1 className="text-[22px] font-bold text-gray-900">Problema 1 {I.pencil}</h1>
      <div className="text-xs text-gray-500 mt-1 mb-5">9 d ago <span className="mx-1">·</span> <a className="text-blue-600">Erik Rivera</a></div>

      <div className="border border-gray-200 rounded p-4 mb-3">
        <div className="flex justify-between text-xs">
          <span><a className="text-blue-600 font-medium text-sm">Erik Rivera</a> <span className="text-gray-500 ml-1">(Original post)</span></span>
          <span className="text-gray-500">5/10/2026</span>
        </div>
        <p className="text-sm text-gray-800 mt-1.5">ES un <strong>problema</strong> grave</p>
        <a className="text-blue-600 text-xs block mt-2">Edit</a>
      </div>

      <div className="ml-8 border border-gray-200 rounded p-4 mb-3">
        <div className="flex justify-between text-xs">
          <a className="text-blue-600 font-medium text-sm">Erik Rivera</a>
          <span className="text-gray-500">5/10/2026</span>
        </div>
        <p className="text-sm text-gray-800 mt-1.5">no estoy de acuerdo con eso</p>
        <a className="text-blue-600 text-xs block mt-2">Edit</a>
        <div className="text-xs mt-1.5"><a className="text-red-600 font-medium">Delete</a> <a className="text-gray-600 ml-2">Make Private</a></div>
      </div>

      {/* annotation */}
      <div className="relative ml-8 mb-1">
        <Btn>Add a comment</Btn>
        <div className="absolute left-[145px] top-0 flex items-center gap-2">
          <span className="block w-12 h-px bg-red-400"/>
          <span className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-1.5 py-0.5">Belongs to "no estoy de acuerdo"</span>
        </div>
      </div>
      <div className="relative mb-5">
        <Btn>Add a comment</Btn>
        <div className="absolute left-[145px] top-0 flex items-center gap-2">
          <span className="block w-12 h-px bg-red-400"/>
          <span className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-1.5 py-0.5">Belongs to "Original post"</span>
        </div>
      </div>

      <div className="border-b border-gray-200 mb-5">
        <span className="inline-block pb-2 -mb-px text-sm font-medium text-blue-700 border-b-2 border-blue-600 mr-5">Thread</span>
        <span className="inline-block pb-2 text-sm text-gray-500">Notes</span>
      </div>

      <Btn>Add a reply</Btn>

      <div className="absolute -right-4 top-32 w-56 text-[11px] text-gray-600 bg-yellow-50 border border-yellow-200 rounded px-2.5 py-2">
        <div className="font-semibold text-yellow-800 mb-0.5">Issues</div>
        <ul className="list-disc list-inside space-y-0.5">
          <li>Two identical buttons, can't tell which post each belongs to</li>
          <li>Tabs sit mid-conversation, look like a divider</li>
          <li>Edit / Delete / Make Private repeated as red text</li>
          <li>"Add a reply" and "Add a comment" are visually identical</li>
        </ul>
      </div>
    </div>
  );
}

/* =============================================================
   Data
   ============================================================= */

// Short thread — 2 posts, ≤ 2 comments each → everything inline (A behaviour)
const shortThread = [
  {
    id: 'p1', author: 'Erik Rivera', role: 'user', when: '9 days ago', date: '5/10/2026',
    original: true,
    body: 'ES un <strong>problema</strong> grave. La pantalla de configuración no carga cuando el usuario tiene más de 50 tickets asignados.',
    canManage: true,
    comments: [
      { id: 'c1', author: 'Agent Jones', role: 'agent', when: '8 days ago', body: 'Reproduced on staging — the query in /api/tickets is missing pagination. Filing as P1.' },
      { id: 'c2', author: 'Erik Rivera', role: 'user', when: '6 days ago', body: 'Thanks — let me know when there is a fix to test.' },
    ],
  },
  {
    id: 'p2', author: 'Erik Rivera', role: 'user', when: '7 days ago', date: '5/12/2026',
    body: 'no estoy de acuerdo con eso — la severidad debería ser crítica, no alta. Está bloqueando a todo el equipo de soporte.',
    canManage: true,
    comments: [],
  },
];

const shortTicket = { id: 19, title: 'Problema 1', opened: '9 days ago', author: 'Erik Rivera', status: 'open', priority: 'high' };

// Long thread — 6 posts, one with 5 comments → triggers BOTH collapsers (B behaviour)
const longThread = [
  {
    id: 'p1', author: 'Dave', role: 'user', when: '12 days ago',
    original: true,
    body: 'I cannot log in from my phone (iPhone 15, Safari). The login button does not respond to taps. Works fine on desktop.',
    canManage: true,
    comments: [
      { id: 'c1', author: 'Agent Jones', role: 'agent', when: '11 days ago', body: 'Thanks — could you share your Safari version? We had similar reports on 17.4.' },
      { id: 'c2', author: 'Dave', role: 'user', when: '11 days ago', body: 'Safari 17.4.1 on iOS 17.4.1.' },
      { id: 'c3', author: 'Agent Jones', role: 'agent', when: '11 days ago', body: 'Reproduced. Routing to platform team.' },
      { id: 'c4', author: 'Priya Shah', role: 'agent', when: '10 days ago', body: 'Confirmed — webkit touch handler regression in 17.4. Drafting a patch now.' },
      { id: 'c5', author: 'Priya Shah', role: 'agent', when: '9 days ago', body: 'Patch merged on main, queued for the 17.4.2 release.' },
    ],
  },
  {
    id: 'p2', author: 'Agent Jones', role: 'agent', when: '10 days ago',
    body: 'Confirmed regression — we are working on a server-side workaround so unpatched Safari users can still log in.',
    canManage: false,
    comments: [
      { id: 'c6', author: 'Dave', role: 'user', when: '10 days ago', body: 'Thanks for the update.' },
    ],
  },
  {
    id: 'p3', author: 'Dave', role: 'user', when: '9 days ago',
    body: 'Tried again this morning, still cannot log in. Same behaviour.',
    canManage: true,
    comments: [],
  },
  {
    id: 'p4', author: 'Priya Shah', role: 'agent', when: '8 days ago',
    body: 'Shipped the workaround to staging — Dave, could you try the staging URL we DM\u2019d you?',
    canManage: false,
    comments: [
      { id: 'c7', author: 'Dave', role: 'user', when: '8 days ago', body: 'Works on staging. 🎉' },
    ],
  },
  {
    id: 'p5', author: 'Agent Jones', role: 'agent', when: '5/7/2026',
    body: 'We have identified and fixed the touch event handling issue on iOS Safari. The fix is deployed to production. Could you try again?',
    canManage: false,
    comments: [
      { id: 'c8', author: 'Dave', role: 'user', when: '5/7/2026', body: 'On it.' },
    ],
  },
  {
    id: 'p6', author: 'Dave', role: 'user', when: '5/7/2026',
    body: 'It works now. Thank you for the quick fix!',
    canManage: true,
    comments: [],
  },
  {
    id: 'p7', author: 'Agent Jones', role: 'agent', when: '5/7/2026', private: true,
    body: 'Internal: rollout completed across all regions. Closing the ticket once Dave confirms resolution holds for 24h.',
    canManage: true,
    comments: [],
  },
];

const longTicket = { id: 1284, title: 'Login issue on mobile', opened: '12 days ago', author: 'Dave', status: 'pending', priority: 'high' };

/* =============================================================
   Canvas
   ============================================================= */

function App() {
  const longTicketFull = {
    ...longTicket,
    urgency: 'High', severity: 'Medium', assignee: 'Alex Park',
    tier: 'Premium', category: 'Authentication',
    tags: ['mobile', 'safari', 'login'],
  };
  return (
    <DesignCanvas>
      <DCSection id="full" title="Full ticket detail" subtitle="Thread + rebalanced sidebar (Status in header, Priority moved to sidebar)">
        <DCArtboard id="full-long" label="Long thread + sidebar" width={1180} height={1240}>
          <div className="p-6 bg-white h-full overflow-hidden">
            <TicketDetail ticket={longTicketFull} thread={longThread}/>
          </div>
        </DCArtboard>
      </DCSection>
      <DCSection id="adaptive" title="Thread alone" subtitle="One component — inline by default, auto-collapses as the thread grows">
        <DCArtboard id="short" label="Short thread — inline (A behaviour)" width={820} height={920}>
          <div className="p-6 bg-white h-full overflow-hidden">
            <Thread ticket={shortTicket} thread={shortThread}/>
          </div>
        </DCArtboard>
        <DCArtboard id="long" label="Long thread — auto-collapsed (B behaviour)" width={820} height={1180}>
          <div className="p-6 bg-white h-full overflow-hidden">
            <Thread ticket={longTicket} thread={longThread}/>
          </div>
        </DCArtboard>
      </DCSection>
      <DCSection id="before" title="Before (annotated)">
        <DCArtboard id="original" label="Current design — the issues" width={820} height={720}>
          <div className="p-6 bg-white h-full overflow-hidden">
            <ThreadOriginalAnnotated/>
          </div>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
