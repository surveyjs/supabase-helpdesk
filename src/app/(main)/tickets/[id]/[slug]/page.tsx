import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { createServerClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/auth';
import { generateSlug } from '@/lib/utils/slug';
import { renderMarkdown } from '@/lib/utils/markdown';
import { formatRelativeTime } from '@/lib/utils/time';
import { Badge } from '@/components/ui/Badge';
import { DisplayName } from '@/components/features/users/DisplayName';
import { ReplyForm } from './ReplyForm';
import { EditablePost } from './EditablePost';
import { EditableTitle } from './EditableTitle';
import { ReplyToggle } from './ReplyToggle';
import { NoteForm } from './NoteForm';
import { CollapsibleTimeline, CollapsibleComments } from './CollapsibleTimeline';
import { AttachmentList } from '@/components/features/attachments/AttachmentList';
import { RealtimeTicketUpdates } from '@/components/features/tickets/RealtimeTicketUpdates';
import {
  deletePost,
  togglePostPrivacy,
  publishDraft,
  getFollowers,
} from '@/lib/actions/tickets';
import { getCsatRating, requestCsatToken } from '@/lib/actions/csat';
import { getSlaStatus, type SlaTimer, type SlaIndicatorStatus } from '@/lib/utils/sla';
import { updateCustomFieldValue } from '@/lib/actions/admin';
import { removeDuplicateLink } from '@/lib/actions/duplicate';
import { DeleteTicketButton } from './DeleteTicketButton';
import { SuggestReplyButton } from './SuggestReplyButton';
import { AiTicketSummary } from './AiTicketSummary';
import { GenerateKbArticleButton } from './GenerateKbArticleButton';
import { TicketTabs } from './TicketTabs';
import { MarkAsDuplicateForm } from './MarkAsDuplicateForm';
import { MergeTicketForm } from './MergeTicketForm';
import { TicketSidebarSurvey } from './TicketSidebarSurvey';
import {
  canTierUseControl,
  parseTicketDetailAgentConfig,
  parseTicketDetailUserConfig,
} from '@/lib/constants/survey-ui-config';

function getContrastColor(hex: string): string {
  const c = hex.replace('#', '');
  const srgb = [0, 2, 4].map((i) => {
    const v = parseInt(c.substring(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  const L = 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
  const ratioWhite = 1.05 / (L + 0.05);
  const ratioDark = (L + 0.05) / 0.05;
  return ratioWhite >= ratioDark ? '#FFFFFF' : '#000000';
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
      source_article_id,
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
    .select('role, is_blocked, tier_expires_at, tier:subscription_tiers(key)')
    .eq('id', user.id)
    .single();

  const isAgent = profile?.role === 'agent' || profile?.role === 'admin';
  const viewerTier = Array.isArray(profile?.tier) ? profile?.tier[0] : profile?.tier;
  const nowIso = new Date().toISOString();
  const tierExpired = !!profile?.tier_expires_at && profile.tier_expires_at < nowIso;
  const viewerTierKey = !tierExpired ? (viewerTier?.key ?? null) : null;

  // Backward-compatible: editor_view_mode may not exist before migration 021 is applied.
  let editorViewMode: 'both' | 'preview' | 'editor' = 'both';
  const { data: editorPref } = await supabase
    .from('profiles')
    .select('editor_view_mode')
    .eq('id', user.id)
    .maybeSingle();
  const pref = (editorPref as { editor_view_mode?: string } | null)?.editor_view_mode;
  if (pref === 'both' || pref === 'preview' || pref === 'editor') {
    editorViewMode = pref;
  }

  // Keep ticket detail editors actionable on first render: preview-only mode hides editing toolbox.
  const ticketDetailEditorViewMode: 'both' | 'preview' | 'editor' =
    editorViewMode === 'preview' ? 'both' : editorViewMode;

  // Tier capability checks for ticket creator
  const isCreator = user.id === ticket.creator_id;
  const tierCaps = {
    change_visibility: false,
    set_severity: false,
    change_status: false,
    change_type: false,
    add_remove_tags: false,
  };
  if (isCreator && !isAgent) {
    const capNames = Object.keys(tierCaps) as (keyof typeof tierCaps)[];
    const results = await Promise.all(
      capNames.map((cap) => supabase.rpc('user_has_tier_capability', { capability: cap }))
    );
    capNames.forEach((cap, i) => {
      tierCaps[cap] = results[i].data === true;
    });
  }
  const hasAnyTierCap = Object.values(tierCaps).some(Boolean);

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

  // Fetch timeline thresholds and AI settings in a single batch
  const { data: allSettings } = await supabase
    .from('app_settings')
    .select('key, value')
    .in('key', [
      'visible_posts_threshold',
      'visible_comments_threshold',
      'ai_suggested_reply_enabled',
      'ai_ticket_summary_enabled',
      'ai_ticket_summary_min_posts',
      'ai_generate_kb_article_enabled',
      'survey_ticket_detail_agent_config',
      'survey_ticket_detail_user_config',
    ]);

  const settingsMap = new Map(allSettings?.map((s) => [s.key, s.value]) ?? []);

  const aiSuggestedReplyEnabled = settingsMap.get('ai_suggested_reply_enabled') === 'true';
  const aiTicketSummaryEnabled = settingsMap.get('ai_ticket_summary_enabled') === 'true';
  const aiTicketSummaryMinPosts = parseInt(settingsMap.get('ai_ticket_summary_min_posts') ?? '10', 10) || 10;
  const aiGenerateKbArticleEnabled = settingsMap.get('ai_generate_kb_article_enabled') === 'true';

  const visiblePostsThreshold = parseInt(settingsMap.get('visible_posts_threshold') ?? '10', 10) || 10;
  const visibleCommentsThreshold = parseInt(settingsMap.get('visible_comments_threshold') ?? '3', 10) || 3;
  const detailAgentConfig = parseTicketDetailAgentConfig(settingsMap.get('survey_ticket_detail_agent_config'));
  const detailUserConfig = parseTicketDetailUserConfig(settingsMap.get('survey_ticket_detail_user_config'));
  const detailFieldConfig = isAgent ? detailAgentConfig.fields : detailUserConfig.fields;

  const canTierStatusControl = canTierUseControl(detailUserConfig.tierControlRules.statusAllowedTiers, viewerTierKey);
  const canTierSeverityControl = canTierUseControl(detailUserConfig.tierControlRules.severityAllowedTiers, viewerTierKey);
  const canTierTypeControl = canTierUseControl(detailUserConfig.tierControlRules.typeAllowedTiers, viewerTierKey);
  const canTierTagsControl = canTierUseControl(detailUserConfig.tierControlRules.tagsAllowedTiers, viewerTierKey);
  const canTierVisibilityControl = canTierUseControl(detailUserConfig.tierControlRules.visibilityAllowedTiers, viewerTierKey);

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

  // Separate notes from non-notes for tab separation
  const notePosts = renderedPosts.filter((p) => p.post_type === 'note');
  const nonNotePosts = renderedPosts.filter((p) => p.post_type !== 'note');
  const noteCount = notePosts.length;

  const rootPosts = nonNotePosts.filter(
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

  function formatDateTimeWithRelative(dateStr: string) {
    const d = new Date(dateStr);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString()} (${formatRelativeTime(dateStr)})`;
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
        return d?.original_ticket_id != null
          ? `${actorName} marked as duplicate of #${d.original_ticket_id}`
          : `${actorName} marked as duplicate`;
      case 'duplicate_removed':
        return `${actorName} removed duplicate link (was #${d?.previous_original_id ?? '?'})`;
      case 'merged_from':
        return `${actorName} merged ticket #${d?.source_ticket_id ?? '?'} into this ticket`;
      case 'merged_into':
        return `${actorName} merged this ticket into #${d?.target_ticket_id ?? '?'}`;
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
              <DisplayName
                userId={author?.id ?? ticket!.creator_id}
                displayName={authorName}
                isCurrentUserAgent={isAgent}
              />
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
                <span className="ml-2 text-xs text-gray-500">(edited)</span>
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
              editorViewMode={ticketDetailEditorViewMode}
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
            <ReplyToggle parentPostId={post.id} editorViewMode={ticketDetailEditorViewMode} />
          </div>
        )}
        {canReplyToPost && level === 1 && (
          <div className="mt-1 ml-12">
            <ReplyToggle
              parentPostId={post.parent_post_id!}
              parentCommentId={post.id}
              editorViewMode={ticketDetailEditorViewMode}
            />
          </div>
        )}
      </div>
    );
  }

  function renderActivityEntry(entry: NonNullable<typeof activityLog>[number]) {
    return (
      <div key={entry.id} className="py-1 px-4 text-xs text-gray-500" data-testid={`activity-${entry.id}`}>
        <span>{formatActivityMessage(entry)}</span>
        <span className="ml-2 text-gray-500">{formatTime(entry.created_at)}</span>
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
  if (isAgent || hasAnyTierCap) {
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

  // Fetch source article if present (for agents)
  let sourceArticle: { id: number; title: string; slug: string; category_name: string | null } | null = null;
  if (isAgent && ticket.source_article_id) {
    const { data: art } = await supabase
      .from('kb_articles')
      .select('id, title, slug, category:kb_categories(name)')
      .eq('id', ticket.source_article_id)
      .single();
    if (art) {
      const artCat = Array.isArray(art.category) ? art.category[0] : art.category;
      sourceArticle = { id: art.id, title: art.title, slug: art.slug, category_name: artCat?.name ?? null };
    }
  }

  // Fetch user notes for the ticket creator (agents only)
  let creatorNoteCount = 0;
  let creatorNotes: { id: string; body: string; created_at: string; edited_at: string | null; author: { display_name: string | null } | null }[] = [];
  if (isAgent) {
    const { count } = await supabase
      .from('user_notes')
      .select('id', { count: 'exact', head: true })
      .eq('target_user_id', ticket.creator_id);
    creatorNoteCount = count ?? 0;
    if (creatorNoteCount > 0) {
      const { data: noteRows } = await supabase
        .from('user_notes')
        .select('id, body, created_at, edited_at, author:profiles!user_notes_author_id_fkey(display_name)')
        .eq('target_user_id', ticket.creator_id)
        .order('created_at', { ascending: false });
      creatorNotes = (noteRows ?? []).map((n) => ({
        ...n,
        author: Array.isArray(n.author) ? n.author[0] : n.author,
      }));
    }
  }

  // Fetch follow status and followers list
  const { data: followRow } = await supabase
    .from('ticket_followers')
    .select('user_id')
    .eq('ticket_id', ticket.id)
    .eq('user_id', user.id)
    .maybeSingle();

  const isFollowing = !!followRow;
  const isTicketOwner = ticket.creator_id === user.id;
  const isBlocked = !!profile?.is_blocked;

  let followers: { user_id: string; display_name: string; created_at: string }[] = [];
  if (isAgent) {
    followers = await getFollowers(ticket.id);
  }

  // SurveyJS sidebar: which editable fields are shown to this viewer
  const sidebarSurveyFields = {
    status:
      detailFieldConfig.status &&
      (isAgent || (tierCaps.change_status && canTierStatusControl)) &&
      !ticket.merged_into_id,
    urgency: detailFieldConfig.urgency && isAgent && !ticket.merged_into_id,
    severity:
      detailFieldConfig.severity &&
      (isAgent || (tierCaps.set_severity && canTierSeverityControl)) &&
      !ticket.merged_into_id,
    type:
      detailFieldConfig.type &&
      (isAgent || (tierCaps.change_type && canTierTypeControl)) &&
      !ticket.merged_into_id &&
      allTypes.length > 0,
    category: detailFieldConfig.category && isAgent && !ticket.merged_into_id,
    assigned: detailFieldConfig.assigned && isAgent && !ticket.merged_into_id,
    visibility:
      detailFieldConfig.visibility &&
      (isAgent || (tierCaps.change_visibility && canTierVisibilityControl)) &&
      !ticket.merged_into_id,
    tags:
      detailFieldConfig.tags &&
      (isAgent || (tierCaps.add_remove_tags && canTierTagsControl)) &&
      allTags.length > 0,
    follow: detailFieldConfig.follow && !isOwner && !isBlocked,
  };

  const sidebarSurveyInitial = {
    status: ticket.status as string,
    urgency: ticket.urgency as string,
    severity: ticket.severity as string,
    type_id: (ticket.type_id ?? '') as string,
    category_id: (ticket.category_id ?? '') as string,
    assigned_agent_id: (ticket.assigned_agent_id ?? '') as string,
    is_private: !!ticket.is_private,
    is_following: isFollowing,
    tag_ids: ticketTags.map((t) => t.id),
  };

  const sidebarSurveyOptions = {
    types: allTypes,
    categories: allCategories,
    agents: allAgents,
    tags: allTags.map((t) => ({ id: t.id, name: t.name })),
  };

  const hasAnySidebarSurveyField = Object.values(sidebarSurveyFields).some(Boolean);

  return (
    <div className="relative left-1/2 right-1/2 w-screen -translate-x-1/2 px-6">
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
          {isAgent && (
            <form action={removeDuplicateLink} className="inline ml-2">
              <input type="hidden" name="ticket_id" value={ticket.id} />
              <button
                type="submit"
                className="text-xs text-red-600 hover:text-red-800 underline"
                data-testid="remove-duplicate-link-btn"
              >
                Remove duplicate link
              </button>
            </form>
          )}
        </div>
      )}

      {/* Merge banner */}
      {ticket.merged_into_id && (
        <div className="mb-4 p-4 rounded bg-blue-50 border border-blue-200 text-blue-800 text-sm" data-testid="merge-banner">
          This ticket has been merged into{' '}
          <Link
            href={`/tickets/${ticket.merged_into_id}/redirect`}
            className="text-blue-600 hover:text-blue-800 font-medium"
          >
            #{ticket.merged_into_id}
          </Link>
          . All posts have been moved. Please continue the conversation there.
        </div>
      )}

      {/* Two-column layout: fluid content + 400px information panel */}
      <div className="flex flex-col lg:flex-row gap-6">
        {/* LEFT: Main content area */}
        <div className="w-full flex-1 min-w-0" data-testid="ticket-main-content">
          {/* Subject */}
          <div className="mb-4">
            <EditableTitle ticketId={ticket.id} title={ticket.title} canEdit={canEditTitle} />
            <div className="flex items-center gap-2 mt-1 text-sm text-gray-500">
              <time title={new Date(ticket.created_at).toLocaleString()}>{formatRelativeTime(ticket.created_at)}</time>
              <span>·</span>
              <span>
                <DisplayName
                  userId={ticket.creator_id}
                  displayName={creatorName}
                  isCurrentUserAgent={isAgent}
                />
              </span>
            </div>
          </div>

          {/* Posts / Notes tabs (agents see two tabs, users see only posts) */}
          {isAgent ? (
            <TicketTabs
              postsContent={
                <div className="space-y-4">
                  {originalPost && renderPostCard(originalPost, 0)}
                  {shouldCollapse && hiddenPostCount > 0 && (
                    <CollapsibleTimeline hiddenCount={hiddenPostCount}>
                      {renderTimelineItems(hiddenItems)}
                    </CollapsibleTimeline>
                  )}
                  {renderTimelineItems(visibleItems)}
                  {canReply && !ticket.merged_into_id && (
                    <div className="bg-white rounded-lg border border-gray-200 p-6">
                      <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-medium text-gray-900">Reply</h2>
                        {aiSuggestedReplyEnabled && (
                          <SuggestReplyButton ticketId={ticket.id} />
                        )}
                      </div>
                      <ReplyForm
                        ticketId={ticket.id}
                        isAgent={isAgent}
                        editorViewMode={ticketDetailEditorViewMode}
                      />
                    </div>
                  )}
                </div>
              }
              notesContent={
                <div className="space-y-4">
                  {notePosts.length > 0 ? (
                    notePosts.map((note) => renderPostCard(note, 0))
                  ) : (
                    <p className="text-sm text-gray-500 italic">No internal notes yet.</p>
                  )}
                  {!ticket.merged_into_id && (
                    <NoteForm ticketId={ticket.id} editorViewMode={ticketDetailEditorViewMode} />
                  )}
                </div>
              }
              noteCount={noteCount}
            />
          ) : (
            <div className="space-y-4">
              {originalPost && renderPostCard(originalPost, 0)}
              {shouldCollapse && hiddenPostCount > 0 && (
                <CollapsibleTimeline hiddenCount={hiddenPostCount}>
                  {renderTimelineItems(hiddenItems)}
                </CollapsibleTimeline>
              )}
              {renderTimelineItems(visibleItems)}
              {canReply && !ticket.merged_into_id && (
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                  <h2 className="text-lg font-medium text-gray-900 mb-4">Reply</h2>
                  <ReplyForm ticketId={ticket.id} isAgent={isAgent} editorViewMode={ticketDetailEditorViewMode} />
                </div>
              )}
            </div>
          )}
        </div>

        {/* RIGHT: Sidebar */}
        <aside className="w-full lg:w-[400px] lg:min-w-[400px] lg:max-w-[400px] flex-shrink-0 lg:sticky lg:top-4 lg:self-start" data-testid="ticket-sidebar">
          <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
            {/* Ticket # and status */}
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-gray-500 font-mono">#{ticket.id}</span>
              <Badge variant="status" value={ticket.status} />
            </div>

            {ticket.merged_into_id && (
              <p className="mb-3 text-xs text-gray-500 italic">Read-only (merged)</p>
            )}

            {/* Editable info via SurveyJS (per-tier configurable) */}
            {hasAnySidebarSurveyField && (
              <div className="mb-3">
                <TicketSidebarSurvey
                  ticketId={ticket.id}
                  isAgent={isAgent}
                  fields={sidebarSurveyFields}
                  initial={sidebarSurveyInitial}
                  options={sidebarSurveyOptions}
                />
              </div>
            )}

            {/* Read-only / non-editable info rows */}
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              {detailFieldConfig.urgency && !sidebarSurveyFields.urgency && (
                <>
                  <dt className="text-gray-500">Urgency</dt>
                  <dd>
                    <Badge variant="priority" value={ticket.urgency} />
                  </dd>
                </>
              )}

              {detailFieldConfig.severity && !sidebarSurveyFields.severity && (
                <>
                  <dt className="text-gray-500">Severity</dt>
                  <dd>
                    <Badge variant="priority" value={ticket.severity} />
                  </dd>
                </>
              )}

              {detailFieldConfig.type && !sidebarSurveyFields.type && (
                <>
                  <dt className="text-gray-500">Type</dt>
                  <dd>
                    <span className="text-gray-900">{typeName}</span>
                  </dd>
                </>
              )}

              {detailFieldConfig.category && !sidebarSurveyFields.category && (categoryName || isAgent) && (
                <>
                  <dt className="text-gray-500">Category</dt>
                  <dd>
                    <span className="text-gray-900">{categoryName ?? 'None'}</span>
                  </dd>
                </>
              )}

              {detailFieldConfig.createdBy && (
                <>
                  <dt className="text-gray-500">Created by</dt>
                  <dd className="text-gray-900">
                    <DisplayName
                      userId={ticket.creator_id}
                      displayName={creatorName}
                      isCurrentUserAgent={isAgent}
                    />
                    {teamName && (
                      <span className="ml-1 text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">
                        {teamName}
                      </span>
                    )}
                  </dd>
                </>
              )}

              {detailFieldConfig.assigned && !sidebarSurveyFields.assigned && (
                <>
                  <dt className="text-gray-500">Assigned</dt>
                  <dd className="text-gray-900">
                    <span>{assignedAgentName ?? 'Unassigned'}</span>
                  </dd>
                </>
              )}

              {isAgent && !ticket.merged_into_id && !ticket.duplicate_of_id && (
                <>
                  <dt className="text-gray-500">Advanced</dt>
                  <dd>
                    <div className="flex flex-wrap gap-2">
                      <MarkAsDuplicateForm ticketId={ticket.id} />
                      <MergeTicketForm ticketId={ticket.id} />
                    </div>
                  </dd>
                </>
              )}

              {detailFieldConfig.createdAt && (
                <>
                  <dt className="text-gray-500">Created</dt>
                  <dd className="text-gray-900" title={new Date(ticket.created_at).toLocaleString()}>
                    {formatDateTimeWithRelative(ticket.created_at)}
                  </dd>
                </>
              )}
              {detailFieldConfig.updatedAt && (
                <>
                  <dt className="text-gray-500">Updated</dt>
                  <dd className="text-gray-900" title={new Date(ticket.updated_at).toLocaleString()}>
                    {formatDateTimeWithRelative(ticket.updated_at)}
                  </dd>
                </>
              )}

              {detailFieldConfig.visibility && !sidebarSurveyFields.visibility && (
                <>
                  <dt className="text-gray-500">Visibility</dt>
                  <dd className="flex items-center gap-2">
                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                      {ticket.is_private ? 'Private' : 'Public'}
                    </span>
                  </dd>
                </>
              )}

              {sourceArticle && (
                <>
                  <dt className="text-gray-500">From article</dt>
                  <dd data-testid="source-article">
                    <Link
                      href={`/help/${sourceArticle.id}/${sourceArticle.category_name ? generateSlug(sourceArticle.category_name) : 'uncategorized'}/${sourceArticle.slug}`}
                      className="text-blue-600 hover:text-blue-800 text-xs"
                    >
                      {sourceArticle.title}
                    </Link>
                  </dd>
                </>
              )}

              {profile?.role === 'admin' && !ticket.merged_into_id && (
                <>
                  <dt className="text-gray-500">Delete</dt>
                  <dd>
                    <DeleteTicketButton ticketId={ticket.id} isClosed={ticket.status === 'closed'} />
                  </dd>
                </>
              )}

              {isAgent && ticket.status === 'closed' && aiGenerateKbArticleEnabled && !ticket.merged_into_id && (
                <>
                  <dt className="text-gray-500">KB Article</dt>
                  <dd>
                    <GenerateKbArticleButton ticketId={ticket.id} />
                  </dd>
                </>
              )}
            </dl>

            {/* SLA Indicators (agents only) */}
            {isAgent && (
              <div className="mt-3 border-t border-gray-200 pt-3" data-testid="sla-indicators">
                <h3 className="text-xs font-medium text-gray-500 mb-1">SLA</h3>
                {slaStatus ? (
                  <div className="space-y-1 text-xs">
                    <div className="flex items-center gap-1.5">
                      <SlaStatusDot status={slaStatus.firstResponse.status} />
                      <span className="text-gray-500">Response:</span>
                      {slaStatus.firstResponse.status === 'met' ? (
                        <span className="text-green-700">✓ {formatMinutesAsHours(slaStatus.firstResponse.elapsedMinutes)}</span>
                      ) : slaStatus.firstResponse.status === 'breached' && slaStatus.firstResponse.completedAt ? (
                        <span className="text-red-700">✗ {formatMinutesAsHours(slaStatus.firstResponse.elapsedMinutes)}/{formatMinutesAsHours(slaStatus.firstResponse.targetMinutes)}</span>
                      ) : (
                        <span>{formatMinutesAsHours(slaStatus.firstResponse.elapsedMinutes)}/{formatMinutesAsHours(slaStatus.firstResponse.targetMinutes)} ({slaStatus.firstResponse.percentage}%)</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <SlaStatusDot status={slaStatus.resolution.status} />
                      <span className="text-gray-500">Resolution:</span>
                      {slaStatus.resolution.status === 'met' ? (
                        <span className="text-green-700">✓ {formatMinutesAsHours(slaStatus.resolution.elapsedMinutes)}</span>
                      ) : slaStatus.resolution.status === 'breached' && slaStatus.resolution.completedAt ? (
                        <span className="text-red-700">✗ {formatMinutesAsHours(slaStatus.resolution.elapsedMinutes)}/{formatMinutesAsHours(slaStatus.resolution.targetMinutes)}</span>
                      ) : (
                        <span>{formatMinutesAsHours(slaStatus.resolution.elapsedMinutes)}/{formatMinutesAsHours(slaStatus.resolution.targetMinutes)} ({slaStatus.resolution.percentage}%)</span>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-gray-400">No SLA</p>
                )}
              </div>
            )}

            {/* CSAT Rating display */}
            {(csatRating || canRate) && (
              <div className="mt-3 border-t border-gray-200 pt-3" data-testid="csat-section">
                <h3 className="text-xs font-medium text-gray-500 mb-1">CSAT</h3>
                {csatRating ? (
                  <div>
                    <div className="flex items-center gap-1" data-testid="csat-rating-display">
                      <span className="text-sm">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <span key={star} className={star <= csatRating.rating ? 'text-yellow-400' : 'text-gray-300'}>★</span>
                        ))}
                      </span>
                      <span className="text-xs text-gray-700">{csatRating.rating}/5</span>
                    </div>
                    {csatRating.comment && (
                      <details className="text-xs text-gray-600 mt-1">
                        <summary className="cursor-pointer text-blue-600 hover:text-blue-800">Comment</summary>
                        <p className="mt-1 pl-2 border-l-2 border-gray-200">{csatRating.comment}</p>
                      </details>
                    )}
                    {isOwner && isRegularUser && (
                      <form action={async () => { 'use server'; await requestCsatToken(ticket.id); }}>
                        <button type="submit" className="mt-1 text-xs text-blue-600 hover:text-blue-800" data-testid="update-rating-link">Update</button>
                      </form>
                    )}
                  </div>
                ) : canRate ? (
                  <form action={async () => { 'use server'; await requestCsatToken(ticket.id); }}>
                    <button type="submit" className="text-xs text-blue-600 hover:text-blue-800" data-testid="rate-ticket-link">Rate this ticket</button>
                  </form>
                ) : null}
              </div>
            )}

            {/* Tags (read-only chip list when not in survey) */}
            {detailFieldConfig.tags && !sidebarSurveyFields.tags && ticketTags.length > 0 && (
              <div className="mt-3 border-t border-gray-200 pt-3" data-testid="ticket-tags">
                <div className="flex flex-wrap gap-1">
                  {ticketTags.map((tag) => {
                    const textColor = getContrastColor(tag.color);
                    return (
                      <span
                        key={tag.id}
                        className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium"
                        style={{ backgroundColor: tag.color, color: textColor }}
                      >
                        {tag.name}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Tags (chip list shown next to the SurveyJS tagbox so colors stay visible) */}
            {sidebarSurveyFields.tags && ticketTags.length > 0 && (
              <div className="mt-3 border-t border-gray-200 pt-3" data-testid="ticket-tags">
                <div className="flex flex-wrap gap-1">
                  {ticketTags.map((tag) => {
                    const textColor = getContrastColor(tag.color);
                    return (
                      <span
                        key={tag.id}
                        className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium"
                        style={{ backgroundColor: tag.color, color: textColor }}
                      >
                        {tag.name}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Follow status (owner / blocked / agent counter — toggle is in the SurveyJS form) */}
            {detailFieldConfig.follow && (isTicketOwner || (isAgent && followers.length > 0)) && (
              <div className="mt-3 border-t border-gray-200 pt-3" data-testid="follow-section">
                <div className="flex items-center gap-2">
                  {isTicketOwner && <span className="text-xs text-gray-500">Following (owner)</span>}
                  {isAgent && followers.length > 0 && (
                    <span className="text-xs text-gray-400">{followers.length} follower{followers.length !== 1 ? 's' : ''}</span>
                  )}
                </div>
              </div>
            )}

            {/* Custom fields */}
            {detailFieldConfig.customFields && customFieldDefs && customFieldDefs.length > 0 && (
              <div className="mt-3 border-t border-gray-200 pt-3" data-testid="custom-fields">
                <h3 className="text-xs font-medium text-gray-500 mb-1">Custom Fields</h3>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  {customFieldDefs.map((field) => {
                    const val = ticketCustomFields[field.name];
                    const displayVal = field.field_type === 'checkbox'
                      ? (val ? 'Yes' : 'No')
                      : val != null ? String(val) : '—';
                    return (
                      <div key={field.id} className="contents">
                        <dt className="text-gray-500">{field.name}</dt>
                        <dd className="text-gray-900 flex items-center gap-1">
                          <span>{displayVal}</span>
                          {(isAgent || isOwner) && (
                            <details className="inline">
                              <summary className="text-xs text-blue-600 cursor-pointer">✎</summary>
                              <form action={updateCustomFieldValue} className="mt-1 flex gap-1 items-center">
                                <input type="hidden" name="ticket_id" value={ticket.id} />
                                <input type="hidden" name="field_name" value={field.name} />
                                {field.field_type === 'text' && (
                                  <input type="text" name="value" defaultValue={val != null ? String(val) : ''} maxLength={1000} className="rounded border border-gray-300 px-1.5 py-0.5 text-xs w-24" />
                                )}
                                {field.field_type === 'number' && (
                                  <input type="number" name="value" defaultValue={val != null ? String(val) : ''} className="rounded border border-gray-300 px-1.5 py-0.5 text-xs w-20" />
                                )}
                                {field.field_type === 'dropdown' && (
                                  <select name="value" defaultValue={val != null ? String(val) : ''} className="rounded border border-gray-300 px-1.5 py-0.5 text-xs">
                                    <option value="">Select…</option>
                                    {(field.options as string[] | null)?.map((opt: string) => (
                                      <option key={opt} value={opt}>{opt}</option>
                                    ))}
                                  </select>
                                )}
                                {field.field_type === 'checkbox' && (
                                  <select name="value" defaultValue={val ? 'true' : 'false'} className="rounded border border-gray-300 px-1.5 py-0.5 text-xs">
                                    <option value="true">Yes</option>
                                    <option value="false">No</option>
                                  </select>
                                )}
                                {field.field_type === 'date' && (
                                  <input type="date" name="value" defaultValue={val != null ? String(val) : ''} className="rounded border border-gray-300 px-1.5 py-0.5 text-xs" />
                                )}
                                <button type="submit" className="px-1.5 py-0.5 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200">Save</button>
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

          {/* User Notes (agents only, when creator has notes) */}
          {isAgent && creatorNoteCount > 0 && (
            <details className="bg-white rounded-lg border border-gray-200 p-4 mb-4" data-testid="user-notes-tab">
              <summary className="cursor-pointer text-sm font-semibold text-gray-700 uppercase tracking-wider">
                User Notes
                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                  {creatorNoteCount}
                </span>
              </summary>
              <div className="mt-4">
                <Link
                  href={`/agent/users/${ticket.creator_id}`}
                  className="text-sm text-blue-600 hover:text-blue-800 mb-3 inline-block"
                >
                  Open profile →
                </Link>
                <div className="space-y-3">
                  {creatorNotes.map((note) => (
                    <div key={note.id} className="border border-gray-200 rounded p-3 text-sm">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-gray-900">
                          {note.author?.display_name ?? 'Unknown'}
                        </span>
                        <span className="text-xs text-gray-500">
                          {new Date(note.created_at).toLocaleDateString()}
                          {note.edited_at && ' (edited)'}
                        </span>
                      </div>
                      <p className="text-gray-700 whitespace-pre-wrap">{note.body}</p>
                    </div>
                  ))}
                </div>
              </div>
            </details>
          )}

          {/* AI Summary panel (agents only) */}
          {isAgent && aiTicketSummaryEnabled && allPosts.length >= aiTicketSummaryMinPosts && (
            <div className="mb-4">
              <AiTicketSummary ticketId={ticket.id} />
            </div>
          )}

          {/* Agent ticket information (bottom) */}
          {isAgent && !ticket.merged_into_id && (
            <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4" data-testid="agent-info-under-ticket-info">
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-gray-500">Followers</dt>
                <dd className="text-gray-900">
                  {followers.length} follower{followers.length !== 1 ? 's' : ''}
                </dd>
                <dt className="text-gray-500">User notes</dt>
                <dd className="text-gray-900">{creatorNoteCount}</dd>
                <dt className="text-gray-500">AI summary</dt>
                <dd className="text-gray-900">
                  {aiTicketSummaryEnabled && allPosts.length >= aiTicketSummaryMinPosts ? 'Available' : 'Not available'}
                </dd>
              </dl>
            </div>
          )}
        </aside>
      </div>

      {/* Realtime subscription for live updates */}
      <RealtimeTicketUpdates ticketId={ticket.id} />
    </div>
  );
}
