import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { createServerClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/auth';
import { generateSlug } from '@/lib/utils/slug';
import { renderMarkdown } from '@/lib/utils/markdown';
import { Badge } from '@/components/ui/Badge';
import { ReplyForm } from './ReplyForm';

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
      created_at, updated_at, duplicate_of_id,
      creator_id,
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

  // Fetch posts (Phase 3: only root posts, not drafts)
  const { data: posts } = await supabase
    .from('posts')
    .select(`
      id, body, is_original, created_at, post_type,
      author:profiles!posts_author_id_fkey(id, display_name)
    `)
    .eq('ticket_id', ticket.id)
    .eq('post_type', 'post')
    .eq('is_draft', false)
    .order('created_at', { ascending: true });

  // Get user profile for role check
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  const isAgent = profile?.role === 'agent' || profile?.role === 'admin';

  // Check if user can reply (non-agents cannot reply to duplicates)
  const canReply = isAgent || !ticket.duplicate_of_id;

  // Render markdown for all posts
  const renderedPosts = await Promise.all(
    (posts ?? []).map(async (post) => ({
      ...post,
      htmlBody: await renderMarkdown(post.body),
    })),
  );

  const creatorName = creator?.display_name ?? `User #${ticket.creator_id}`;
  const assignedAgentName = assignedAgent?.display_name ?? null;
  const typeName = ticketType?.name ?? 'Unknown';
  const categoryName = ticketCategory?.name ?? null;

  return (
    <div>
      <Link
        href="/tickets"
        className="text-sm text-blue-600 hover:text-blue-800 mb-4 inline-block"
      >
        ← Back to My Tickets
      </Link>

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
          {assignedAgentName && (
            <div>
              <dt className="text-gray-500">Assigned to</dt>
              <dd className="text-gray-900">{assignedAgentName}</dd>
            </div>
          )}
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

      {/* Posts timeline */}
      <div className="space-y-4 mb-6">
        {renderedPosts.map((post) => {
          const author = Array.isArray(post.author) ? post.author[0] : post.author;
          const authorName = author?.display_name ?? 'Unknown';
          const isCurrentUser = author?.id === user.id;

          return (
            <div
              key={post.id}
              className={`rounded-lg border p-4 ${
                isCurrentUser
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
