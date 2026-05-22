import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { createServerClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/auth';
import { generateSlug } from '@/lib/utils/slug';
import { renderMarkdown } from '@/lib/utils/markdown';
import { formatRelativeTime } from '@/lib/utils/time';
import { DisplayName } from '@/components/features/users/DisplayName';
import { MainReplyToggle } from './MainReplyToggle';
import { EditablePost } from './EditablePost';
import { PrivacyCheckbox } from './PrivacyCheckbox';
import { EditableTitle } from './EditableTitle';
import { ReplyToggle } from './ReplyToggle';
import { NoteForm } from './NoteForm';
import { CollapsibleTimeline, CollapsibleComments } from './CollapsibleTimeline';
import { AttachmentList } from '@/components/features/attachments/AttachmentList';
import { RealtimeTicketUpdates } from '@/components/features/tickets/RealtimeTicketUpdates';
import {
  deletePost,
  publishDraft,
  getFollowers,
} from '@/lib/actions/tickets';
import { getCsatRating, requestCsatToken } from '@/lib/actions/csat';
import { getSlaStatus, type SlaTimer, type SlaIndicatorStatus } from '@/lib/utils/sla';
import { removeDuplicateLink } from '@/lib/actions/duplicate';
import { DeleteTicketButton } from './DeleteTicketButton';
import { AiTicketSummary } from './AiTicketSummary';
import { GenerateKbArticleButton } from './GenerateKbArticleButton';
import { TicketTabs } from './TicketTabs';
import { MarkAsDuplicateForm } from './MarkAsDuplicateForm';
import { MergeTicketForm } from './MergeTicketForm';
import { TicketSidebarSurvey } from './TicketSidebarSurvey';
import { TicketTagChips } from './TicketTagChips';
import {
  parseTicketDetailAgentTemplate,
  parseTicketDetailUserTemplate,
} from '@/lib/constants/survey-ui-config';
import { computeTicketDetailFieldPolicy } from '@/lib/tickets/ticket-detail-policy';
import { applyTemplatePolicy, injectTemplateChoices } from '@/lib/tickets/apply-template-policy';
import {
  injectCustomFieldsPanel,
  type CustomFieldDef,
} from '@/lib/tickets/custom-fields-template';

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
      creator:profiles!tickets_creator_id_fkey(id, display_name, team_id)
    `)
    .eq('id', id)
    .single();

  if (!ticket) notFound();

  // Extract FK relations (Supabase returns arrays for embedded selects)
  const creator = Array.isArray(ticket.creator) ? ticket.creator[0] : ticket.creator;

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

  // Backward-compatible: editor_view_mode may not exist before migration 021 is applied,
  // and the height columns may not exist before migration 027.
  let editorViewMode: 'both' | 'preview' | 'editor' = 'both';
  let editorMinHeightPx: number | undefined;
  let editorMaxHeightPx: number | undefined;
  const { data: editorPref } = await supabase
    .from('profiles')
    .select('editor_view_mode, editor_min_height_px, editor_max_height_px')
    .eq('id', user.id)
    .maybeSingle();
  const pref = (editorPref as {
    editor_view_mode?: string;
    editor_min_height_px?: number | null;
    editor_max_height_px?: number | null;
  } | null);
  if (pref?.editor_view_mode === 'both' || pref?.editor_view_mode === 'preview' || pref?.editor_view_mode === 'editor') {
    editorViewMode = pref.editor_view_mode;
  }
  if (typeof pref?.editor_min_height_px === 'number') {
    editorMinHeightPx = pref.editor_min_height_px;
  }
  if (typeof pref?.editor_max_height_px === 'number') {
    editorMaxHeightPx = pref.editor_max_height_px;
  }
  if (editorMinHeightPx === undefined || editorMaxHeightPx === undefined) {
    // Older DB schema (no height columns yet): fall back to view-mode-only select.
    const { data: legacyPref } = await supabase
      .from('profiles')
      .select('editor_view_mode')
      .eq('id', user.id)
      .maybeSingle();
    const legacy = (legacyPref as { editor_view_mode?: string } | null)?.editor_view_mode;
    if (legacy === 'both' || legacy === 'preview' || legacy === 'editor') {
      editorViewMode = legacy;
    }
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
      author:profiles!posts_author_id_fkey(id, display_name, role)
    `)
    .eq('ticket_id', ticket.id)
    .order('created_at', { ascending: true });

  // Fetch activity log
  const { data: activityLog } = await supabase
    .from('activity_log')
    .select('id, action, details, created_at, actor:profiles!activity_log_actor_id_fkey(id, display_name)')
    .eq('ticket_id', ticket.id)
    .order('created_at', { ascending: false });

  // Fetch timeline thresholds and AI settings in a single batch
  const { data: allSettings } = await supabase
    .from('app_settings')
    .select('key, value')
    .in('key', [
      'visible_comments_threshold',
      'ai_suggested_reply_enabled',
      'ai_ticket_summary_enabled',
      'ai_ticket_summary_min_posts',
      'ai_generate_kb_article_enabled',
      'survey_ticket_detail_agent_template',
      'survey_ticket_detail_user_template',
    ]);

  const settingsMap = new Map(allSettings?.map((s) => [s.key, s.value]) ?? []);

  const aiSuggestedReplyEnabled = settingsMap.get('ai_suggested_reply_enabled') === 'true';
  const aiTicketSummaryEnabled = settingsMap.get('ai_ticket_summary_enabled') === 'true';
  const aiTicketSummaryMinPosts = parseInt(settingsMap.get('ai_ticket_summary_min_posts') ?? '10', 10) || 10;
  const aiGenerateKbArticleEnabled = settingsMap.get('ai_generate_kb_article_enabled') === 'true';

  const visibleCommentsThreshold = parseInt(settingsMap.get('visible_comments_threshold') ?? '3', 10) || 3;
  const detailAgentTemplate = parseTicketDetailAgentTemplate(settingsMap.get('survey_ticket_detail_agent_template'));
  const detailUserTemplate = parseTicketDetailUserTemplate(settingsMap.get('survey_ticket_detail_user_template'));

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

  // Flatten comment hierarchy: re-parent any comment-of-comment to its
  // grandparent post so the redesigned thread has exactly two levels
  // (post → comment). Render-only flatten, no schema change.
  const postById = new Map(renderedPosts.map((p) => [p.id, p] as const));
  const commentsByParentPost = new Map<string, typeof renderedPosts>();

  for (const p of renderedPosts) {
    if (p.post_type !== 'comment') continue;
    let parentPostId = p.parent_post_id ?? undefined;
    if (!parentPostId && p.parent_comment_id) {
      // Walk up through comment chain to find a parent post.
      // Visited set + depth cap guard against pathological cycles.
      const visited = new Set<string>();
      let cursor: (typeof renderedPosts)[number] | undefined = postById.get(p.parent_comment_id);
      let depth = 0;
      while (cursor && !parentPostId && depth < 64 && !visited.has(cursor.id)) {
        visited.add(cursor.id);
        depth++;
        if (cursor.parent_post_id && postById.has(cursor.parent_post_id)) {
          parentPostId = cursor.parent_post_id;
          break;
        }
        cursor = cursor.parent_comment_id ? postById.get(cursor.parent_comment_id) : undefined;
      }
    }
    if (parentPostId) {
      const arr = commentsByParentPost.get(parentPostId) ?? [];
      arr.push(p);
      commentsByParentPost.set(parentPostId, arr);
    }
  }
  // Stable order: by created_at ascending within a post
  for (const [k, arr] of commentsByParentPost) {
    arr.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    commentsByParentPost.set(k, arr);
  }

  // Separate activity log entries visible to this viewer
  const visibleActivityEntries = (activityLog ?? []).filter((a) => {
    if (!isAgent && (a.action === 'draft_published' || a.action === 'post_privacy_changed')) return false;
    return true;
  });

  // Thread items: original post (if any) first, then root reply posts sorted by date.
  type ThreadItem = { kind: 'post'; data: (typeof renderedPosts)[number] };
  const replyItems: ThreadItem[] = rootPosts
    .slice()
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .map((p) => ({ kind: 'post' as const, data: p }));
  const threadItems: ThreadItem[] = originalPost
    ? [{ kind: 'post' as const, data: originalPost }, ...replyItems]
    : replyItems;

  // Fold pattern: when more than POST_INLINE_MAX items, keep the first item
  // (the original post / earliest reply) plus the last POST_TAIL items inline,
  // and hide the middle behind a single timeline collapse node.
  const POST_INLINE_MAX = 4;
  const POST_TAIL = 2;
  const shouldCollapse = threadItems.length > POST_INLINE_MAX;
  let leadingItems: ThreadItem[] = threadItems;
  let hiddenItems: ThreadItem[] = [];
  let tailItems: ThreadItem[] = [];
  if (shouldCollapse) {
    leadingItems = threadItems.slice(0, 1);
    tailItems = threadItems.slice(threadItems.length - POST_TAIL);
    hiddenItems = threadItems.slice(1, threadItems.length - POST_TAIL);
  }

  const hiddenPostCount = hiddenItems.length;

  // Keep old type alias for renderTimelineItems compatibility
  type TimelineItem = ThreadItem;

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
    context: 'thread' | 'comment' | 'note' = 'thread',
  ) {
    const author = Array.isArray(post.author) ? post.author[0] : post.author;
    const authorName = author?.display_name ?? 'Unknown';
    const isCurrentUser = author?.id === user.id;
    const isNote = post.post_type === 'note';
    const isDraft = post.is_draft;
    const isOriginal = post.is_original;
    const authorRole = (author && 'role' in author ? (author as { role?: string }).role : undefined) ?? '';
    const authorIsAgent = authorRole === 'agent' || authorRole === 'admin';

    // Permission checks
    // Editing the original post is allowed for the ticket creator (its author)
    // and any agent. All other posts/comments follow the standard rules.
    const canEditPost = (
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
    const canReplyToPost = canReply && !isDraft && !isNote && context === 'thread';

    const bgClass = isNote
      ? 'bg-amber-50 border-amber-200'
      : isDraft
        ? 'bg-white border-dashed border-gray-400'
        : 'bg-white border-gray-200';

    const initials =
      (authorName.match(/\b\w/g) ?? []).slice(0, 2).join('').toUpperCase() || '?';
    const avatarTone = isNote
      ? 'bg-amber-100 text-amber-700'
      : authorIsAgent
        ? 'bg-blue-100 text-blue-700'
        : 'bg-teal-100 text-teal-700';

    // Comments on this post (only relevant for top-level thread posts)
    const postComments = context === 'thread' ? (commentsByParentPost.get(post.id) ?? []) : [];
    const visibleCommentCount = visibleCommentsThreshold;
    const shouldCollapseComments = postComments.length > visibleCommentCount;
    const hiddenComments = shouldCollapseComments ? postComments.slice(0, postComments.length - visibleCommentCount) : [];
    const shownComments = shouldCollapseComments ? postComments.slice(postComments.length - visibleCommentCount) : postComments;

    const card = (
      <article className={`rounded-lg border p-4 ${bgClass}`}>
        <header className="flex items-center justify-between mb-2">
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
              <span data-testid="private-badge" className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
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
        </header>

        <EditablePost
          postId={post.id}
          htmlBody={post.htmlBody}
          rawBody={post.body}
          canEdit={canEditPost}
          editorViewMode={ticketDetailEditorViewMode}
          editorMinHeightPx={editorMinHeightPx}
          editorMaxHeightPx={editorMaxHeightPx}
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
            <PrivacyCheckbox postId={post.id} isPrivate={post.is_private} />
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
      </article>
    );

    if (context === 'comment') {
      return (
        <div
          key={post.id}
          data-testid={`post-${post.id}`}
          data-post-kind="comment"
        >
          {card}
        </div>
      );
    }

    if (context === 'note') {
      return (
        <div key={post.id} data-testid={`post-${post.id}`} data-post-kind="note">
          {card}
        </div>
      );
    }

    // context === 'thread'
    return (
      <li
        key={post.id}
        className="relative list-none"
        data-testid={`post-${post.id}`}
        data-post-kind="post"
      >
        <div className="flex gap-3">
          <div className="shrink-0 flex flex-col items-center">
            <span
              aria-hidden="true"
              className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-semibold ${avatarTone}`}
            >
              {initials}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            {card}

            {(postComments.length > 0 || canReplyToPost) && (
              <div
                className="mt-2 ml-5 pl-4 border-l-2 border-gray-100 space-y-2"
                data-comments-rail="true"
              >
                {shouldCollapseComments && (
                  <CollapsibleComments hiddenCount={hiddenComments.length}>
                    {hiddenComments.map((c) => renderPostCard(c, 'comment'))}
                  </CollapsibleComments>
                )}
                {shownComments.map((c) => renderPostCard(c, 'comment'))}
                {canReplyToPost && (
                  <div className="pt-1">
                    <ReplyToggle
                      parentPostId={post.id}
                      editorViewMode={ticketDetailEditorViewMode}
                      editorMinHeightPx={editorMinHeightPx}
                      editorMaxHeightPx={editorMaxHeightPx}
                      commentCount={postComments.length}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </li>
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
    return items.map((item) => renderPostCard(item.data, 'thread'));
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
  const { data: customFieldDefsRaw } = await supabase
    .from('custom_fields')
    .select('*')
    .order('display_order');

  const customFieldDefs: CustomFieldDef[] = (customFieldDefsRaw ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    field_type: row.field_type as CustomFieldDef['field_type'],
    is_required: !!row.is_required,
    options: Array.isArray(row.options) ? (row.options as string[]) : null,
    default_value: row.default_value == null ? null : String(row.default_value),
    display_order: typeof row.display_order === 'number' ? row.display_order : 0,
  }));

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

  // Build SurveyJS sidebar template via template-policy pipeline.
  const detailTemplateWrapper = isAgent ? detailAgentTemplate : detailUserTemplate;
  const detailFieldPolicy = computeTicketDetailFieldPolicy({
    isAgent,
    isMerged: !!ticket.merged_into_id,
    isOwner,
    isBlocked,
    hasTypes: allTypes.length > 0,
    hasTags: allTags.length > 0,
    tierKey: viewerTierKey,
    tierCaps,
    tierRules: detailUserTemplate.tierControlRules,
    customFieldNames: customFieldDefs.map((d) => d.name),
  });

  const templateWithCustomFields = detailTemplateWrapper.autoGenerateCustomFields
    ? injectCustomFieldsPanel(detailTemplateWrapper.template, customFieldDefs)
    : detailTemplateWrapper.template;

  const trimmedTemplate = applyTemplatePolicy(
    templateWithCustomFields,
    detailFieldPolicy,
  );

  const sidebarTemplateJson = injectTemplateChoices(trimmedTemplate, {
    type_id: [
      { value: '', text: 'None' },
      ...allTypes.map((t) => ({ value: t.id, text: t.name })),
    ],
    category_id: [
      { value: '', text: 'None' },
      ...allCategories.map((c) => ({ value: c.id, text: c.name })),
    ],
    assigned_agent_id: [
      { value: '', text: 'Unassigned' },
      ...allAgents.map((a) => ({
        value: a.id,
        text: a.display_name ?? a.email,
      })),
    ],
    tag_ids: allTags.map((t) => ({ value: t.id, text: t.name })),
  });

  const sidebarTemplateInitial: Record<string, unknown> = {
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
  for (const def of customFieldDefs) {
    const v = ticketCustomFields[def.name];
    if (v !== undefined) {
      sidebarTemplateInitial[`custom_fields.${def.name}`] = v;
    }
  }

  const hasAnySidebarSurveyField = Object.values(detailFieldPolicy).some((p) => p.visible);

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

          {/* Thread / Notes / Logs tabs */}
          <TicketTabs
            threadContent={
              <div className="space-y-4">
                <ul className="list-none p-0 m-0 space-y-4">
                  {renderTimelineItems(leadingItems)}
                  {hiddenPostCount > 0 && (
                    <CollapsibleTimeline hiddenCount={hiddenPostCount}>
                      {renderTimelineItems(hiddenItems)}
                    </CollapsibleTimeline>
                  )}
                  {renderTimelineItems(tailItems)}
                </ul>
                {canReply && !ticket.merged_into_id && (
                  <MainReplyToggle
                    ticketId={ticket.id}
                    isAgent={isAgent}
                    editorViewMode={ticketDetailEditorViewMode}
                    editorMinHeightPx={editorMinHeightPx}
                    editorMaxHeightPx={editorMaxHeightPx}
                    aiSuggestedReplyEnabled={aiSuggestedReplyEnabled}
                  />
                )}
              </div>
            }
            notesContent={isAgent ? (
              <div className="space-y-4">
                {notePosts.length > 0 ? (
                  notePosts.map((note) => renderPostCard(note, 'note'))
                ) : (
                  <p className="text-sm text-gray-500 italic">No internal notes yet.</p>
                )}
                {!ticket.merged_into_id && (
                  <NoteForm ticketId={ticket.id} editorViewMode={ticketDetailEditorViewMode} editorMinHeightPx={editorMinHeightPx} editorMaxHeightPx={editorMaxHeightPx} />
                )}
              </div>
            ) : undefined}
            logsContent={visibleActivityEntries.length > 0 ? (
              <div className="space-y-1">
                {visibleActivityEntries.map((entry) => renderActivityEntry(entry))}
              </div>
            ) : undefined}
            noteCount={isAgent ? noteCount : undefined}
            logCount={visibleActivityEntries.length}
          />
        </div>

        {/* RIGHT: Sidebar */}
        <aside className="w-full lg:w-[400px] lg:min-w-[400px] lg:max-w-[400px] flex-shrink-0 lg:sticky lg:top-4 lg:self-start" data-testid="ticket-sidebar">
          <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
            {/* Ticket # */}
            <div className="mb-3">
              <span className="text-xs text-gray-500 font-mono">#{ticket.id}</span>
            </div>

            {ticket.merged_into_id && (
              <p className="mb-3 text-xs text-gray-500 italic">Read-only (merged)</p>
            )}

            {/* Editable info via SurveyJS template (per-tier configurable) */}
            {hasAnySidebarSurveyField && (
              <div className="mb-3">
                <TicketSidebarSurvey
                  ticketId={ticket.id}
                  templateJson={sidebarTemplateJson}
                  initial={sidebarTemplateInitial}
                />
              </div>
            )}

            {/* Read-only / non-editable info rows (fields not represented in the survey template) */}
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
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

              <>
                <dt className="text-gray-500">Created</dt>
                <dd className="text-gray-900" title={new Date(ticket.created_at).toLocaleString()}>
                  {formatDateTimeWithRelative(ticket.created_at)}
                </dd>
              </>
              <>
                <dt className="text-gray-500">Updated</dt>
                <dd className="text-gray-900" title={new Date(ticket.updated_at).toLocaleString()}>
                  {formatDateTimeWithRelative(ticket.updated_at)}
                </dd>
              </>

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
                        <span className="text-green-700">Met · {formatMinutesAsHours(slaStatus.firstResponse.elapsedMinutes)}</span>
                      ) : slaStatus.firstResponse.status === 'breached' && slaStatus.firstResponse.completedAt ? (
                        <span className="text-red-700">Breached · {formatMinutesAsHours(slaStatus.firstResponse.elapsedMinutes)}/{formatMinutesAsHours(slaStatus.firstResponse.targetMinutes)}</span>
                      ) : (
                        <span>{formatMinutesAsHours(slaStatus.firstResponse.elapsedMinutes)}/{formatMinutesAsHours(slaStatus.firstResponse.targetMinutes)} ({slaStatus.firstResponse.percentage}%)</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <SlaStatusDot status={slaStatus.resolution.status} />
                      <span className="text-gray-500">Resolution:</span>
                      {slaStatus.resolution.status === 'met' ? (
                        <span className="text-green-700">Met · {formatMinutesAsHours(slaStatus.resolution.elapsedMinutes)}</span>
                      ) : slaStatus.resolution.status === 'breached' && slaStatus.resolution.completedAt ? (
                        <span className="text-red-700">Breached · {formatMinutesAsHours(slaStatus.resolution.elapsedMinutes)}/{formatMinutesAsHours(slaStatus.resolution.targetMinutes)}</span>
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

            {/* Tags (chip list shown next to the SurveyJS tagbox so colors stay visible).
                Lives as a client component so the chips update live when the tagbox
                writes back via TicketSidebarSurvey. */}
            <TicketTagChips
              ticketId={ticket.id}
              initialTagIds={ticketTags.map((t) => t.id)}
              tagsById={Object.fromEntries(
                [...ticketTags, ...allTags].map((t) => [t.id, t]),
              )}
            />

            {/* Follow status (owner / blocked / agent counter — toggle is in the SurveyJS form) */}
            {(isTicketOwner || (isAgent && followers.length > 0)) && (
              <div className="mt-3 border-t border-gray-200 pt-3" data-testid="follow-section">
                <div className="flex items-center gap-2">
                  {isTicketOwner && <span className="text-xs text-gray-500">Following (owner)</span>}
                  {isAgent && followers.length > 0 && (
                    <span className="text-xs text-gray-400">{followers.length} follower{followers.length !== 1 ? 's' : ''}</span>
                  )}
                </div>
              </div>
            )}

            {/* Custom fields are now rendered inside the SurveyJS sidebar as
                auto-generated `custom_fields.<name>` questions appended to the
                template (see `customFieldDefs` / `injectCustomFieldsPanel`
                above). The legacy inline form has been removed. */}

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
