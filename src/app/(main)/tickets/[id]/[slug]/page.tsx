import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { createServerClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/auth';
import { generateSlug } from '@/lib/utils/slug';
import { renderMarkdown } from '@/lib/utils/markdown';
import { Badge } from '@/components/ui/Badge';
import { ReplyForm } from './ReplyForm';
import { EditablePost } from './EditablePost';
import { EditableTitle } from './EditableTitle';
import { ReplyToggle } from './ReplyToggle';
import { NoteForm } from './NoteForm';
import { CollapsibleTimeline, CollapsibleComments } from './CollapsibleTimeline';
import { AttachmentList } from '@/components/features/attachments/AttachmentList';
import { FileUpload } from '@/components/features/attachments/FileUpload';
import { RealtimeTicketUpdates } from '@/components/features/tickets/RealtimeTicketUpdates';
import {
  deletePost,
  togglePostPrivacy,
  publishDraft,
} from '@/lib/actions/tickets';
import { getCsatRating, requestCsatToken } from '@/lib/actions/csat';
import { getSlaStatus, type SlaTimer, type SlaIndicatorStatus } from '@/lib/utils/sla';
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
  toggleTicketPrivacy as toggleTicketPrivacyAction,
  addTagToTicket,
  removeTagFromTicket,
} from '@/lib/actions/agent';
import { updateCustomFieldValue } from '@/lib/actions/admin';

function getContrastColor(hex: string): string {
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16) / 255;
  const g = parseInt(c.substring(2, 4), 16) / 255;
  const b = parseInt(c.substring(4, 6), 16) / 255;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance < 0.5 ? '#FFFFFF' : '#111827';
}

const SLA_DOT_COLORS: Record<SlaIndicatorStatus, string> = {
  on_track: 'bg-green-500',
  approaching: 'bg-yellow-500',
  breached: 'bg-red-500',
  met: 'bg-green-500',
  no_sla: 'bg-gray-300',
};

function SlaStatusDot({ status }: { status: SlaIndicatorStatus }) {
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full ${SLA_DOT_COLORS[status]}`}
      title={status.replace('_', ' ')}
      data-testid={`sla-dot-${status}`}
    />
  );
}

function formatMinutesAsHours(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

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
      creator_id, assigned_agent_id, type_id, category_id, custom_fields,
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

  // Fetch posts (include notes/drafts/comments for agents)
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  const isAgent = profile?.role === 'agent' || profile?.role === 'admin';

  const { data: posts } = await supabase
    .from('posts')
    .select(`
      id, body, is_original, created_at, post_type, is_private, is_draft, edited_at,
      parent_post_id, parent_comment_id,
      author:profiles!posts_author_id_fkey(id, display_name)
    `)
    .eq('ticket_id', ticket.id)
    .order('created_at', { ascending: true });

  // Fetch activity log
  const { data: activityLog } = await supabase
    .from('activity_log')
    .select('id, action, details, created_at, actor:profiles!activity_log_actor_id_fkey(id, display_name)')
    .eq('ticket_id', ticket.id)
    .order('created_at', { ascending: true });

  // Fetch timeline thresholds and file upload settings in a single batch
  const { data: allSettings } = await supabase
    .from('app_settings')
    .select('key, value')
    .in('key', [
      'visible_posts_threshold',
      'visible_comments_threshold',
      'allowed_file_types',
      'max_file_size_mb',
      'max_files_per_post',
    ]);

  const settingsMap = new Map(allSettings?.map((s) => [s.key, s.value]) ?? []);

  const visiblePostsThreshold = parseInt(settingsMap.get('visible_posts_threshold') ?? '10', 10) || 10;
  const visibleCommentsThreshold = parseInt(settingsMap.get('visible_comments_threshold') ?? '3', 10) || 3;

  let allowedFileTypes: string[] = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'pdf', 'txt'];
  const allowedTypesRaw = settingsMap.get('allowed_file_types');
  if (allowedTypesRaw) {
    try { allowedFileTypes = JSON.parse(allowedTypesRaw); } catch { /* use defaults */ }
  }
  const parsedMaxSize = parseInt(settingsMap.get('max_file_size_mb') ?? '10', 10);
  const maxFileSizeMb = Number.isFinite(parsedMaxSize) && parsedMaxSize > 0 ? parsedMaxSize : 10;
  const parsedMaxFiles = parseInt(settingsMap.get('max_files_per_post') ?? '5', 10);
  const maxFilesPerPost = Number.isFinite(parsedMaxFiles) && parsedMaxFiles > 0 ? parsedMaxFiles : 5;

  // Fetch attachment counts per post in a single query
  const attachmentCountMap = new Map<string, number>();
  if (posts && posts.length > 0) {
    const postIds = posts.map((p) => p.id);
    const { data: attachmentRows } = await supabase
      .from('attachments')
      .select('post_id')
      .in('post_id', postIds);
    if (attachmentRows) {
      for (const row of attachmentRows) {
        attachmentCountMap.set(row.post_id, (attachmentCountMap.get(row.post_id) ?? 0) + 1);
      }
    }
  }

  // Check if user can reply (non-agents cannot reply to duplicates)
  const canReply = isAgent || !ticket.duplicate_of_id;
  const canEditTitle = isAgent || ticket.creator_id === user.id;

  // Render markdown for all visible posts
  const allPosts = posts ?? [];
  const renderedPosts = await Promise.all(
    allPosts.map(async (post) => ({
      ...post,
      htmlBody: await renderMarkdown(post.body),
    })),
  );

  // Organize posts: original, root posts, comments by parent
  const originalPost = renderedPosts.find((p) => p.is_original);
  const rootPosts = renderedPosts.filter(
    (p) => !p.is_original && !p.parent_post_id && !p.parent_comment_id && p.post_type !== 'comment',
  );
  const commentsByParentPost = new Map<string, typeof renderedPosts>();
  const commentsByParentComment = new Map<string, typeof renderedPosts>();

  for (const p of renderedPosts) {
    if (p.post_type === 'comment' && p.parent_post_id) {
      if (p.parent_comment_id) {
        const arr = commentsByParentComment.get(p.parent_comment_id) ?? [];
        arr.push(p);
        commentsByParentComment.set(p.parent_comment_id, arr);
      } else {
        const arr = commentsByParentPost.get(p.parent_post_id) ?? [];
        arr.push(p);
        commentsByParentPost.set(p.parent_post_id, arr);
      }
    }
  }

  // Build interleaved timeline of root posts + activity entries
  type TimelineItem =
    | { kind: 'post'; data: (typeof renderedPosts)[number] }
    | { kind: 'activity'; data: NonNullable<typeof activityLog>[number] };

  const timelineItems: TimelineItem[] = [];
  for (const p of rootPosts) {
    timelineItems.push({ kind: 'post', data: p });
  }
  for (const a of activityLog ?? []) {
    // Filter agent-only activity from non-agents
    if (!isAgent && (a.action === 'draft_published' || a.action === 'post_privacy_changed')) continue;
    timelineItems.push({ kind: 'activity', data: a });
  }
  timelineItems.sort((a, b) => {
    const aDate = a.kind === 'post' ? a.data.created_at : a.data.created_at;
    const bDate = b.kind === 'post' ? b.data.created_at : b.data.created_at;
    return new Date(aDate).getTime() - new Date(bDate).getTime();
  });

  // Collapsible: determine hidden vs visible
  const postItemsCount = timelineItems.filter((i) => i.kind === 'post').length;
  const shouldCollapse = postItemsCount > visiblePostsThreshold;
  let hiddenItems: TimelineItem[] = [];
  let visibleItems: TimelineItem[] = timelineItems;
  if (shouldCollapse) {
    // Find the cutoff: keep the last N post-items and any activity entries between them
    const postIndices: number[] = [];
    timelineItems.forEach((item, i) => {
      if (item.kind === 'post') postIndices.push(i);
    });
    const cutoffIndex = postIndices[postIndices.length - visiblePostsThreshold];
    hiddenItems = timelineItems.slice(0, cutoffIndex);
    visibleItems = timelineItems.slice(cutoffIndex);
  }

  const hiddenPostCount = hiddenItems.filter((i) => i.kind === 'post').length;

  function formatTime(dateStr: string) {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString();
  }

  function formatActivityMessage(entry: NonNullable<typeof activityLog>[number]) {
    const actor = Array.isArray(entry.actor) ? entry.actor[0] : entry.actor;
    const actorName = actor?.display_name ?? 'Unknown';
    const d = entry.details as Record<string, unknown> | null;

    switch (entry.action) {
      case 'status_changed':
        return `${actorName} changed status from ${d?.from ?? '?'} to ${d?.to ?? '?'}`;
      case 'agent_assigned':
        return `${actorName} assigned an agent`;
      case 'agent_reassigned':
        return `${actorName} reassigned agent${d?.reason ? ` (${d.reason})` : ''}`;
      case 'agent_unassigned':
        return `${actorName} unassigned agent`;
      case 'urgency_changed':
        return `${actorName} changed urgency from ${d?.from ?? '?'} to ${d?.to ?? '?'}`;
      case 'severity_changed':
        return `${actorName} changed severity from ${d?.from ?? '?'} to ${d?.to ?? '?'}`;
      case 'type_changed':
        return `${actorName} changed type`;
      case 'category_changed':
        return `${actorName} changed category`;
      case 'title_changed':
        return `${actorName} changed title from "${d?.from ?? '?'}" to "${d?.to ?? '?'}"`;
      case 'tag_added':
        return `${actorName} added tag "${d?.tag_name ?? ''}"`;
      case 'tag_removed':
        return `${actorName} removed tag "${d?.tag_name ?? ''}"`;
      case 'ticket_privacy_changed':
        return `${actorName} changed ticket privacy`;
      case 'post_privacy_changed':
        return `${actorName} changed post privacy`;
      case 'draft_published':
        return `${actorName} published a draft`;
      case 'marked_duplicate':
        return `${actorName} marked as duplicate`;
      case 'merged':
        return `${actorName} merged ticket`;
      case 'file_uploaded':
        return `${actorName} uploaded file "${d?.filename ?? ''}"`;
      case 'file_deleted':
        return `${actorName} deleted file "${d?.filename ?? ''}"`;
      default:
        return `${actorName} performed ${entry.action}`;
    }
  }

  function renderPostCard(
    post: (typeof renderedPosts)[number],
    level: 0 | 1 | 2 = 0,
  ) {
    const author = Array.isArray(post.author) ? post.author[0] : post.author;
    const authorName = author?.display_name ?? 'Unknown';
    const isCurrentUser = author?.id === user.id;
    const isNote = post.post_type === 'note';
    const isDraft = post.is_draft;
    const isOriginal = post.is_original;

    // Permission checks
    const canEditPost = !isOriginal && (
      isCurrentUser
      || (isAgent && post.post_type !== 'note')
      || (isAgent && post.post_type === 'note' && isCurrentUser)
    );
    const canDeletePost = !isOriginal && (
      (isAgent && post.post_type !== 'note')
      || (isAgent && post.post_type === 'note' && isCurrentUser)
      || (profile?.role === 'admin' && post.post_type === 'note')
    );
    const canTogglePrivacy = isAgent && !isOriginal && !isNote;
    const canReplyToPost = canReply && !isDraft && !isNote && level < 2;

    const indentClass = level === 1 ? 'ml-6' : level === 2 ? 'ml-12' : '';
    const bgClass = isNote
      ? 'bg-amber-50 border-amber-200'
      : isDraft
        ? 'bg-white border-dashed border-gray-400'
        : isOriginal
          ? 'bg-white border-gray-200'
          : isCurrentUser
            ? 'bg-blue-50 border-blue-200'
            : 'bg-white border-gray-200';

    // Comments on this post
    const postComments = commentsByParentPost.get(post.id) ?? [];
    const visibleCommentCount = visibleCommentsThreshold;
    const shouldCollapseComments = postComments.length > visibleCommentCount;
    const hiddenComments = shouldCollapseComments ? postComments.slice(0, postComments.length - visibleCommentCount) : [];
    const shownComments = shouldCollapseComments ? postComments.slice(postComments.length - visibleCommentCount) : postComments;

    return (
      <div key={post.id} className={indentClass} data-testid={`post-${post.id}`}>
        <div className={`rounded-lg border p-4 ${bgClass}`}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-900">
              {authorName}
              {isOriginal && (
                <span className="ml-2 text-xs text-gray-500">(Original post)</span>
              )}
              {isNote && (
                <span className="ml-2 text-xs text-amber-600 font-medium">(Internal note)</span>
              )}
              {isDraft && (
                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                  Draft
                </span>
              )}
              {post.is_private && !isNote && (
                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                  Private
                </span>
              )}
              {post.edited_at && (
                <span className="ml-2 text-xs text-gray-400">(edited)</span>
              )}
            </span>
            <time dateTime={post.created_at} className="text-xs text-gray-500">
              {formatTime(post.created_at)}
            </time>
          </div>

          <EditablePost
            postId={post.id}
            htmlBody={post.htmlBody}
            rawBody={post.body}
            canEdit={canEditPost}
          />

          {/* Action buttons */}
          <div className="flex items-center gap-3 mt-2">
            {canDeletePost && (
              <form action={deletePost} className="inline">
                <input type="hidden" name="post_id" value={post.id} />
                <button
                  type="submit"
                  className="text-xs text-red-600 hover:text-red-800"
                  data-testid="delete-post-btn"
                >
                  Delete
                </button>
              </form>
            )}
            {canTogglePrivacy && (
              <form action={togglePostPrivacy} className="inline">
                <input type="hidden" name="post_id" value={post.id} />
                <button
                  type="submit"
                  className="text-xs text-gray-600 hover:text-gray-800"
                >
                  {post.is_private ? 'Make Public' : 'Make Private'}
                </button>
              </form>
            )}
            {isDraft && isCurrentUser && (
              <form action={publishDraft} className="inline">
                <input type="hidden" name="post_id" value={post.id} />
                <button
                  type="submit"
                  className="text-xs text-green-600 hover:text-green-800 font-medium"
                  data-testid="publish-draft-btn"
                >
                  Publish
                </button>
              </form>
            )}
          </div>

          {/* Attachments */}
          <AttachmentList
            postId={post.id}
            canDelete={isCurrentUser || isAgent}
          />

          {/* File upload (for post author or agent, not on drafts) */}
          {!isDraft && (isCurrentUser || isAgent) && (
            <FileUpload
              postId={post.id}
              allowedTypes={allowedFileTypes}
              maxFileSizeMb={maxFileSizeMb}
              maxFilesPerPost={maxFilesPerPost}
              existingCount={attachmentCountMap.get(post.id) ?? 0}
            />
          )}
        </div>

        {/* Comments on this post (only for root-level / level-1) */}
        {level === 0 && postComments.length > 0 && (
          <div className="mt-1 space-y-1">
            {shouldCollapseComments && (
              <CollapsibleComments hiddenCount={hiddenComments.length}>
                {hiddenComments.map((c) => renderPostCard(c, 1))}
              </CollapsibleComments>
            )}
            {shownComments.map((c) => renderPostCard(c, 1))}
          </div>
        )}

        {/* Level-1 comments: render their replies (level 2) */}
        {level === 1 && (commentsByParentComment.get(post.id) ?? []).length > 0 && (
          <div className="mt-1 space-y-1">
            {(commentsByParentComment.get(post.id) ?? []).map((c) =>
              renderPostCard(c, 2),
            )}
          </div>
        )}

        {/* Reply button */}
        {canReplyToPost && level === 0 && (
          <div className="mt-1 ml-6">
            <ReplyToggle parentPostId={post.id} />
          </div>
        )}
        {canReplyToPost && level === 1 && (
          <div className="mt-1 ml-12">
            <ReplyToggle parentPostId={post.parent_post_id!} parentCommentId={post.id} />
          </div>
        )}
      </div>
    );
  }

  function renderActivityEntry(entry: NonNullable<typeof activityLog>[number]) {
    return (
      <div key={entry.id} className="py-1 px-4 text-xs text-gray-500" data-testid={`activity-${entry.id}`}>
        <span>{formatActivityMessage(entry)}</span>
        <span className="ml-2 text-gray-400">{formatTime(entry.created_at)}</span>
      </div>
    );
  }

  function renderTimelineItems(items: TimelineItem[]) {
    return items.map((item) => {
      if (item.kind === 'post') return renderPostCard(item.data, 0);
      return renderActivityEntry(item.data);
    });
  }

  // Fetch agent-specific data only if agent
  let allTypes: { id: string; name: string }[] = [];
  let allCategories: { id: string; name: string }[] = [];
  let allAgents: { id: string; display_name: string | null; email: string }[] = [];
  let allTags: { id: string; name: string; color: string }[] = [];
  if (isAgent) {
    const [typesRes, catsRes, agentsRes, tagsRes] = await Promise.all([
      supabase.from('ticket_types').select('id, name').order('name'),
      supabase.from('categories').select('id, name').order('name'),
      supabase
        .from('profiles')
        .select('id, display_name, email')
        .in('role', ['agent', 'admin'])
        .order('display_name'),
      supabase.from('tags').select('id, name, color').order('name'),
    ]);
    allTypes = typesRes.data ?? [];
    allCategories = catsRes.data ?? [];
    allAgents = agentsRes.data ?? [];
    allTags = tagsRes.data ?? [];
  }

  // Fetch ticket tags
  const { data: ticketTagRows } = await supabase
    .from('ticket_tags')
    .select('tag_id, tags(id, name, color)')
    .eq('ticket_id', ticket.id);

  const ticketTags = (ticketTagRows ?? []).map((row) => {
    const tag = Array.isArray(row.tags) ? row.tags[0] : row.tags;
    return tag as { id: string; name: string; color: string };
  }).filter(Boolean);

  // Tags not yet on the ticket (for agent "Add Tag" dropdown)
  const ticketTagIds = new Set(ticketTags.map((t) => t.id));
  const availableTags = allTags.filter((t) => !ticketTagIds.has(t.id));

  // Fetch custom fields definitions and ticket custom field values
  const { data: customFieldDefs } = await supabase
    .from('custom_fields')
    .select('*')
    .order('display_order');

  const ticketCustomFields = (ticket.custom_fields ?? {}) as Record<string, unknown>;
  const isOwner = ticket.creator_id === user.id;

  // Fetch CSAT rating
  const csatRating = await getCsatRating(ticket.id);
  const isRegularUser = profile?.role === 'user';
  const canRate = isOwner && isRegularUser && ticket.status === 'closed';

  // Fetch SLA timer (agents only)
  let slaStatus: Awaited<ReturnType<typeof getSlaStatus>> | null = null;
  if (isAgent) {
    const { data: slaTimer } = await supabase
      .from('sla_timers')
      .select('*')
      .eq('ticket_id', ticket.id)
      .single();
    if (slaTimer) {
      slaStatus = await getSlaStatus(slaTimer as SlaTimer);
    }
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
        <EditableTitle ticketId={ticket.id} title={ticket.title} canEdit={canEditTitle} />

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

        {/* SLA Indicators (agents only) */}
        {isAgent && (
          <div className="mt-4 border-t border-gray-200 pt-4" data-testid="sla-indicators">
            <h3 className="text-sm font-medium text-gray-500 mb-2">SLA Status</h3>
            {slaStatus ? (
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <div>
                  <dt className="text-gray-500">First Response SLA</dt>
                  <dd className="text-gray-900 flex items-center gap-2">
                    <SlaStatusDot status={slaStatus.firstResponse.status} />
                    {slaStatus.firstResponse.status === 'met' ? (
                      <span className="text-green-700">
                        ✓ First response in {formatMinutesAsHours(slaStatus.firstResponse.elapsedMinutes)}
                      </span>
                    ) : slaStatus.firstResponse.status === 'breached' && slaStatus.firstResponse.completedAt ? (
                      <span className="text-red-700">
                        ✗ First response breached ({formatMinutesAsHours(slaStatus.firstResponse.elapsedMinutes)} of {formatMinutesAsHours(slaStatus.firstResponse.targetMinutes)})
                      </span>
                    ) : (
                      <span>
                        {formatMinutesAsHours(slaStatus.firstResponse.elapsedMinutes)} of {formatMinutesAsHours(slaStatus.firstResponse.targetMinutes)} elapsed ({slaStatus.firstResponse.percentage}%)
                      </span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">Resolution SLA</dt>
                  <dd className="text-gray-900 flex items-center gap-2">
                    <SlaStatusDot status={slaStatus.resolution.status} />
                    {slaStatus.resolution.status === 'met' ? (
                      <span className="text-green-700">
                        ✓ Resolved in {formatMinutesAsHours(slaStatus.resolution.elapsedMinutes)}
                      </span>
                    ) : slaStatus.resolution.status === 'breached' && slaStatus.resolution.completedAt ? (
                      <span className="text-red-700">
                        ✗ Resolution breached ({formatMinutesAsHours(slaStatus.resolution.elapsedMinutes)} of {formatMinutesAsHours(slaStatus.resolution.targetMinutes)})
                      </span>
                    ) : (
                      <span>
                        {formatMinutesAsHours(slaStatus.resolution.elapsedMinutes)} of {formatMinutesAsHours(slaStatus.resolution.targetMinutes)} elapsed ({slaStatus.resolution.percentage}%)
                      </span>
                    )}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-gray-400">No SLA</p>
            )}
          </div>
        )}

        {/* CSAT Rating display */}
        {(csatRating || canRate) && (
          <div className="mt-4 border-t border-gray-200 pt-4" data-testid="csat-section">
            <h3 className="text-sm font-medium text-gray-500 mb-2">Customer Satisfaction</h3>
            {csatRating ? (
              <div>
                <div className="flex items-center gap-2 mb-1" data-testid="csat-rating-display">
                  <span className="text-lg">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <span key={star} className={star <= csatRating.rating ? 'text-yellow-400' : 'text-gray-300'}>
                        ★
                      </span>
                    ))}
                  </span>
                  <span className="text-sm text-gray-700 font-medium">{csatRating.rating}/5</span>
                </div>
                {csatRating.comment && (
                  <details className="text-sm text-gray-600 mb-1">
                    <summary className="cursor-pointer text-blue-600 hover:text-blue-800">Show comment</summary>
                    <p className="mt-1 pl-2 border-l-2 border-gray-200">{csatRating.comment}</p>
                  </details>
                )}
                <p className="text-xs text-gray-400">
                  Submitted {new Date(csatRating.submitted_at).toLocaleDateString()}
                </p>
                {isOwner && isRegularUser && (
                  <form action={async () => { 'use server'; await requestCsatToken(ticket.id); }}>
                    <button
                      type="submit"
                      className="mt-2 text-sm text-blue-600 hover:text-blue-800 font-medium"
                      data-testid="update-rating-link"
                    >
                      Update rating
                    </button>
                  </form>
                )}
              </div>
            ) : canRate ? (
              <form action={async () => { 'use server'; await requestCsatToken(ticket.id); }}>
                <button
                  type="submit"
                  className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                  data-testid="rate-ticket-link"
                >
                  Rate this ticket
                </button>
              </form>
            ) : null}
          </div>
        )}

        {/* Tags display */}
        {ticketTags.length > 0 && (
          <div className="mt-4" data-testid="ticket-tags">
            <span className="text-sm text-gray-500 mr-2">Tags:</span>
            <span className="inline-flex flex-wrap gap-1">
              {ticketTags.map((tag) => {
                const textColor = getContrastColor(tag.color);
                return (
                  <span key={tag.id} className="inline-flex items-center gap-1">
                    <span
                      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                      style={{ backgroundColor: tag.color, color: textColor }}
                    >
                      {tag.name}
                    </span>
                    {isAgent && (
                      <form action={removeTagFromTicket} className="inline">
                        <input type="hidden" name="ticket_id" value={ticket.id} />
                        <input type="hidden" name="tag_id" value={tag.id} />
                        <button
                          type="submit"
                          className="text-xs text-gray-400 hover:text-red-500"
                          aria-label={`Remove tag ${tag.name}`}
                          title={`Remove ${tag.name}`}
                        >
                          ×
                        </button>
                      </form>
                    )}
                  </span>
                );
              })}
            </span>
          </div>
        )}

        {/* Agent: Add tag */}
        {isAgent && availableTags.length > 0 && (
          <form action={addTagToTicket} className="mt-2 flex gap-2 items-center" data-testid="add-tag-form">
            <input type="hidden" name="ticket_id" value={ticket.id} />
            <select
              name="tag_id"
              className="rounded border border-gray-300 px-2 py-1 text-xs focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              aria-label="Select tag to add"
            >
              {availableTags.map((tag) => (
                <option key={tag.id} value={tag.id}>{tag.name}</option>
              ))}
            </select>
            <button type="submit" className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200">
              Add Tag
            </button>
          </form>
        )}

        {/* Custom fields display */}
        {customFieldDefs && customFieldDefs.length > 0 && (
          <div className="mt-4 border-t border-gray-200 pt-4" data-testid="custom-fields">
            <h3 className="text-sm font-medium text-gray-500 mb-2">Custom Fields</h3>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
              {customFieldDefs.map((field) => {
                const val = ticketCustomFields[field.name];
                const displayVal = field.field_type === 'checkbox'
                  ? (val ? 'Yes' : 'No')
                  : val != null ? String(val) : '—';
                return (
                  <div key={field.id}>
                    <dt className="text-gray-500">{field.name}</dt>
                    <dd className="text-gray-900 flex items-center gap-2">
                      <span>{displayVal}</span>
                      {(isAgent || isOwner) && (
                        <details className="inline">
                          <summary className="text-xs text-blue-600 cursor-pointer">Edit</summary>
                          <form action={updateCustomFieldValue} className="mt-1 flex gap-1 items-center">
                            <input type="hidden" name="ticket_id" value={ticket.id} />
                            <input type="hidden" name="field_name" value={field.name} />
                            {field.field_type === 'text' && (
                              <input type="text" name="value" defaultValue={val != null ? String(val) : ''} maxLength={1000} className="rounded border border-gray-300 px-2 py-1 text-xs" />
                            )}
                            {field.field_type === 'number' && (
                              <input type="number" name="value" defaultValue={val != null ? String(val) : ''} className="rounded border border-gray-300 px-2 py-1 text-xs" />
                            )}
                            {field.field_type === 'dropdown' && (
                              <select name="value" defaultValue={val != null ? String(val) : ''} className="rounded border border-gray-300 px-2 py-1 text-xs">
                                <option value="">Select…</option>
                                {(field.options as string[] | null)?.map((opt: string) => (
                                  <option key={opt} value={opt}>{opt}</option>
                                ))}
                              </select>
                            )}
                            {field.field_type === 'checkbox' && (
                              <select name="value" defaultValue={val ? 'true' : 'false'} className="rounded border border-gray-300 px-2 py-1 text-xs">
                                <option value="true">Yes</option>
                                <option value="false">No</option>
                              </select>
                            )}
                            {field.field_type === 'date' && (
                              <input type="date" name="value" defaultValue={val != null ? String(val) : ''} className="rounded border border-gray-300 px-2 py-1 text-xs" />
                            )}
                            <button type="submit" className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200">Save</button>
                          </form>
                        </details>
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        )}
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
              <form action={toggleTicketPrivacyAction}>
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
        {/* Original post always first */}
        {originalPost && renderPostCard(originalPost, 0)}

        {/* Collapsible older items */}
        {shouldCollapse && hiddenPostCount > 0 && (
          <CollapsibleTimeline hiddenCount={hiddenPostCount}>
            {renderTimelineItems(hiddenItems)}
          </CollapsibleTimeline>
        )}

        {/* Visible timeline items */}
        {renderTimelineItems(visibleItems)}
      </div>

      {/* Reply form */}
      {canReply && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-4">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Reply</h2>
          <ReplyForm ticketId={ticket.id} />
        </div>
      )}

      {/* Note form (agents only) */}
      {isAgent && (
        <div className="mb-6">
          <NoteForm ticketId={ticket.id} />
        </div>
      )}

      {/* Realtime subscription for live updates */}
      <RealtimeTicketUpdates ticketId={ticket.id} />
    </div>
  );
}
