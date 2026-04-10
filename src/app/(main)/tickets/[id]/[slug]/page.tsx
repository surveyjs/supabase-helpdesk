import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { createServerClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/auth';
import { generateSlug } from '@/lib/utils/slug';
import { renderMarkdown } from '@/lib/utils/markdown';
import { Badge } from '@/components/ui/Badge';
import { ReplyForm } from './ReplyForm';
import {
  changeTicketStatus,
  assignAgent,
  reassignAgent,
  unassignAgent,
  assignToMe,
  changeUrgency,
  changeSeverity,
  changeType,
  changeCategory,
  toggleTicketPrivacy,
} from '@/lib/actions/agent';

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ id: string; slug: string }>;
}) {
  const { id, slug } = await params;
  const user = await requireAuth();
  const supabase = await createServerClient();

  // Fetch ticket
  const { data: ticket } = await supabase
    .from('tickets')
    .select(`
      id, title, slug, status, urgency, severity, is_private,
      created_at, updated_at, duplicate_of_id, merged_into_id,
      creator_id, assigned_agent_id, type_id, category_id,
      type:ticket_types(id, name),
      category:categories(id, name),
      assigned_agent:profiles!tickets_assigned_agent_id_fkey(id, display_name),
      creator:profiles!tickets_creator_id_fkey(id, display_name, team_id)
    `)
    .eq('id', id)
    .single();

  if (!ticket) notFound();

  // Extract FK relations (Supabase returns arrays for embedded selects)
  const creator = Array.isArray(ticket.creator) ? ticket.creator[0] : ticket.creator;
  const assignedAgent = Array.isArray(ticket.assigned_agent) ? ticket.assigned_agent[0] : ticket.assigned_agent;
  const ticketType = Array.isArray(ticket.type) ? ticket.type[0] : ticket.type;
  const ticketCategory = Array.isArray(ticket.category) ? ticket.category[0] : ticket.category;

  // Slug redirect
  const correctSlug = generateSlug(ticket.title);
  if (slug !== correctSlug) {
    redirect(`/tickets/${ticket.id}/${correctSlug}`);
  }

  // Get creator's team name if they have one
  let teamName: string | null = null;
  if (creator?.team_id) {
    const { data: team } = await supabase
      .from('teams')
      .select('name')
      .eq('id', creator.team_id)
      .single();
    teamName = team?.name ?? null;
  }

  // Fetch posts (include notes for agents)
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  const isAgent = profile?.role === 'agent' || profile?.role === 'admin';

  let postsQuery = supabase
    .from('posts')
    .select(`
      id, body, is_original, created_at, post_type,
      author:profiles!posts_author_id_fkey(id, display_name)
    `)
    .eq('ticket_id', ticket.id)
    .eq('is_draft', false)
    .order('created_at', { ascending: true });

  if (!isAgent) {
    postsQuery = postsQuery.eq('post_type', 'post');
  }

  const { data: posts } = await postsQuery;

  // Check if user can reply (non-agents cannot reply to duplicates)
  const canReply = isAgent || !ticket.duplicate_of_id;

  // Render markdown for all posts
  const renderedPosts = await Promise.all(
    (posts ?? []).map(async (post) => ({
      ...post,
      htmlBody: await renderMarkdown(post.body),
    })),
  );

  // Fetch agent-specific data only if agent
  let allTypes: { id: string; name: string }[] = [];
  let allCategories: { id: string; name: string }[] = [];
  let allAgents: { id: string; display_name: string | null; email: string }[] = [];
  if (isAgent) {
    const [typesRes, catsRes, agentsRes] = await Promise.all([
      supabase.from('ticket_types').select('id, name').order('name'),
      supabase.from('categories').select('id, name').order('name'),
      supabase
        .from('profiles')
        .select('id, display_name, email')
        .in('role', ['agent', 'admin'])
        .order('display_name'),
    ]);
    allTypes = typesRes.data ?? [];
    allCategories = catsRes.data ?? [];
    allAgents = agentsRes.data ?? [];
  }

  const creatorName = creator?.display_name ?? `User #${ticket.creator_id}`;
  const assignedAgentName = assignedAgent?.display_name ?? null;
  const typeName = ticketType?.name ?? 'Unknown';
  const categoryName = ticketCategory?.name ?? null;

  return (
    <div>
      <div className="flex items-center gap-4 mb-4">
        <Link
          href="/tickets"
          className="text-sm text-blue-600 hover:text-blue-800"
        >
          ← My Tickets
        </Link>
        {isAgent && (
          <Link
            href="/agent"
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            ← Agent Dashboard
          </Link>
        )}
      </div>

      {/* Duplicate banner */}
      {ticket.duplicate_of_id && (
        <div className="mb-4 p-3 rounded bg-yellow-50 border border-yellow-200 text-yellow-800 text-sm">
          This ticket has been marked as a duplicate of{' '}
          <Link
            href={`/tickets/${ticket.duplicate_of_id}/redirect`}
            className="text-blue-600 hover:text-blue-800 font-medium"
          >
            #{ticket.duplicate_of_id}
          </Link>
          .
        </div>
      )}

      {/* Ticket header */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <h1 className="text-xl font-semibold text-gray-900 mb-4">{ticket.title}</h1>

        <div className="flex flex-wrap gap-2 mb-4">
          <Badge variant="status" value={ticket.status} />
          <Badge variant="priority" value={ticket.urgency} label={`Urgency: ${ticket.urgency.charAt(0).toUpperCase() + ticket.urgency.slice(1)}`} />
          <Badge variant="priority" value={ticket.severity} label={`Severity: ${ticket.severity.charAt(0).toUpperCase() + ticket.severity.slice(1)}`} />
          {ticket.is_private && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
              Private
            </span>
          )}
        </div>

        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <div>
            <dt className="text-gray-500">Type</dt>
            <dd className="text-gray-900">{typeName}</dd>
          </div>
          {categoryName && (
            <div>
              <dt className="text-gray-500">Category</dt>
              <dd className="text-gray-900">{categoryName}</dd>
            </div>
          )}
          <div>
            <dt className="text-gray-500">Created by</dt>
            <dd className="text-gray-900">
              {creatorName}
              {teamName && (
                <span className="ml-2 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                  {teamName}
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Assigned to</dt>
            <dd className="text-gray-900">{assignedAgentName ?? 'Unassigned'}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Created</dt>
            <dd className="text-gray-900">
              {new Date(ticket.created_at).toLocaleDateString()}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Last updated</dt>
            <dd className="text-gray-900">
              {new Date(ticket.updated_at).toLocaleDateString()}
            </dd>
          </div>
        </dl>
      </div>

      {/* Agent controls */}
      {isAgent && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6" data-testid="agent-controls">
          <h2 className="text-sm font-semibold text-gray-700 mb-4 uppercase tracking-wider">Agent Controls</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Status buttons */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
              <div className="flex flex-wrap gap-1">
                {ticket.status !== 'open' && (
                  <form action={changeTicketStatus}>
                    <input type="hidden" name="ticket_id" value={ticket.id} />
                    <input type="hidden" name="new_status" value="open" />
                    <button type="submit" className="px-3 py-1 text-xs rounded bg-green-100 text-green-700 hover:bg-green-200">
                      {ticket.status === 'closed' ? 'Re-open' : 'Mark Open'}
                    </button>
                  </form>
                )}
                {ticket.status !== 'pending' && (
                  <form action={changeTicketStatus}>
                    <input type="hidden" name="ticket_id" value={ticket.id} />
                    <input type="hidden" name="new_status" value="pending" />
                    <button type="submit" className="px-3 py-1 text-xs rounded bg-yellow-100 text-yellow-700 hover:bg-yellow-200">
                      Mark Pending
                    </button>
                  </form>
                )}
                {ticket.status !== 'closed' && (
                  <form action={changeTicketStatus}>
                    <input type="hidden" name="ticket_id" value={ticket.id} />
                    <input type="hidden" name="new_status" value="closed" />
                    <button type="submit" className="px-3 py-1 text-xs rounded bg-gray-100 text-gray-700 hover:bg-gray-200">
                      Close Ticket
                    </button>
                  </form>
                )}
              </div>
            </div>

            {/* Assign agent */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Assignment</label>
              {!ticket.assigned_agent_id ? (
                <form action={assignToMe}>
                  <input type="hidden" name="ticket_id" value={ticket.id} />
                  <button type="submit" className="px-3 py-1 text-xs rounded bg-blue-100 text-blue-700 hover:bg-blue-200">
                    Assign to me
                  </button>
                </form>
              ) : (
                <div className="flex flex-wrap gap-1">
                  <form action={unassignAgent}>
                    <input type="hidden" name="ticket_id" value={ticket.id} />
                    <button type="submit" className="px-3 py-1 text-xs rounded bg-red-100 text-red-700 hover:bg-red-200">
                      Unassign
                    </button>
                  </form>
                </div>
              )}
              <form action={ticket.assigned_agent_id ? reassignAgent : assignAgent} className="mt-2 flex gap-1">
                <input type="hidden" name="ticket_id" value={ticket.id} />
                <select
                  name="agent_id"
                  className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                  aria-label="Select agent"
                >
                  {allAgents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.display_name ?? 'Agent'} ({a.email})
                    </option>
                  ))}
                </select>
                <button type="submit" className="px-3 py-1 text-xs rounded bg-blue-100 text-blue-700 hover:bg-blue-200">
                  {ticket.assigned_agent_id ? 'Reassign' : 'Assign'}
                </button>
              </form>
              {ticket.assigned_agent_id && (
                <form action={reassignAgent} className="mt-1">
                  <input type="hidden" name="ticket_id" value={ticket.id} />
                  <input type="hidden" name="agent_id" value={allAgents[0]?.id ?? ''} />
                  <input
                    type="text"
                    name="reason"
                    placeholder="Reassignment reason (optional)…"
                    className="w-full rounded border border-gray-300 px-2 py-1 text-xs focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                    aria-label="Reassignment reason"
                  />
                </form>
              )}
            </div>

            {/* Urgency */}
            <div>
              <label htmlFor="agent-urgency" className="block text-xs font-medium text-gray-500 mb-1">Urgency</label>
              <form action={changeUrgency} className="flex gap-1">
                <input type="hidden" name="ticket_id" value={ticket.id} />
                <select
                  id="agent-urgency"
                  name="new_urgency"
                  defaultValue={ticket.urgency}
                  className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
                <button type="submit" className="px-3 py-1 text-xs rounded bg-gray-100 text-gray-700 hover:bg-gray-200">
                  Set
                </button>
              </form>
            </div>

            {/* Severity */}
            <div>
              <label htmlFor="agent-severity" className="block text-xs font-medium text-gray-500 mb-1">Severity</label>
              <form action={changeSeverity} className="flex gap-1">
                <input type="hidden" name="ticket_id" value={ticket.id} />
                <select
                  id="agent-severity"
                  name="new_severity"
                  defaultValue={ticket.severity}
                  className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
                <button type="submit" className="px-3 py-1 text-xs rounded bg-gray-100 text-gray-700 hover:bg-gray-200">
                  Set
                </button>
              </form>
            </div>

            {/* Type */}
            <div>
              <label htmlFor="agent-type" className="block text-xs font-medium text-gray-500 mb-1">Type</label>
              <form action={changeType} className="flex gap-1">
                <input type="hidden" name="ticket_id" value={ticket.id} />
                <select
                  id="agent-type"
                  name="new_type_id"
                  defaultValue={ticket.type_id}
                  className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                >
                  {allTypes.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                <button type="submit" className="px-3 py-1 text-xs rounded bg-gray-100 text-gray-700 hover:bg-gray-200">
                  Set
                </button>
              </form>
            </div>

            {/* Category */}
            <div>
              <label htmlFor="agent-category" className="block text-xs font-medium text-gray-500 mb-1">Category</label>
              <form action={changeCategory} className="flex gap-1">
                <input type="hidden" name="ticket_id" value={ticket.id} />
                <select
                  id="agent-category"
                  name="new_category_id"
                  defaultValue={ticket.category_id ?? ''}
                  className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                >
                  <option value="">None</option>
                  {allCategories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <button type="submit" className="px-3 py-1 text-xs rounded bg-gray-100 text-gray-700 hover:bg-gray-200">
                  Set
                </button>
              </form>
            </div>

            {/* Privacy toggle */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Privacy</label>
              <form action={toggleTicketPrivacy}>
                <input type="hidden" name="ticket_id" value={ticket.id} />
                <button type="submit" className={`px-3 py-1 text-xs rounded ${ticket.is_private ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200' : 'bg-green-100 text-green-700 hover:bg-green-200'}`}>
                  {ticket.is_private ? 'Make Public' : 'Make Private'}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Posts timeline */}
      <div className="space-y-4 mb-6">
        {renderedPosts.map((post) => {
          const author = Array.isArray(post.author) ? post.author[0] : post.author;
          const authorName = author?.display_name ?? 'Unknown';
          const isCurrentUser = author?.id === user.id;
          const isNote = post.post_type === 'note';

          return (
            <div
              key={post.id}
              className={`rounded-lg border p-4 ${
                isNote
                  ? 'bg-amber-50 border-amber-200'
                  : isCurrentUser
                    ? 'bg-blue-50 border-blue-200'
                    : 'bg-white border-gray-200'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-900">
                  {authorName}
                  {post.is_original && (
                    <span className="ml-2 text-xs text-gray-500">(Original post)</span>
                  )}
                  {isNote && (
                    <span className="ml-2 text-xs text-amber-600 font-medium">(Internal note)</span>
                  )}
                </span>
                <time
                  dateTime={post.created_at}
                  className="text-xs text-gray-500"
                >
                  {new Date(post.created_at).toLocaleString()}
                </time>
              </div>
              <div
                className="prose prose-sm max-w-none"
                dangerouslySetInnerHTML={{ __html: post.htmlBody }}
              />
            </div>
          );
        })}
      </div>

      {/* Reply form */}
      {canReply && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Reply</h2>
          <ReplyForm ticketId={ticket.id} />
        </div>
      )}
    </div>
  );
}
