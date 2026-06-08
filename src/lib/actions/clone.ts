// Server-only clone helpers (no 'use server': these are plain functions called
// from the create-ticket page and the createTicket action, not form actions).
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServerClient, createServiceRoleClient } from '@/lib/supabase/server';
import { DEFAULT_TEMPLATES } from '@/lib/constants/notification-templates';

/**
 * Render a notification template body for the given event type, substituting
 * {{placeholder}} tokens. Falls back to the built-in default when the row is
 * missing or empty.
 */
async function renderTemplate(
  svc: SupabaseClient,
  eventType: string,
  values: Record<string, string | number>,
): Promise<string> {
  const { data: tpl } = await svc
    .from('notification_templates')
    .select('body')
    .eq('event_type', eventType)
    .single();

  const body = tpl?.body ?? DEFAULT_TEMPLATES[eventType]?.body ?? '';

  return Object.entries(values).reduce(
    (acc, [key, value]) =>
      acc.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value)),
    body,
  );
}

// 300-char limit on tickets.title
function clampTitle(title: string): string {
  return title.length > 300 ? title.slice(0, 300) : title;
}

async function copyTags(
  svc: SupabaseClient,
  sourceTicketId: number,
  newTicketId: number,
): Promise<void> {
  const { data: sourceTags } = await svc
    .from('ticket_tags')
    .select('tag_id')
    .eq('ticket_id', sourceTicketId);

  if (sourceTags && sourceTags.length > 0) {
    await svc.from('ticket_tags').insert(
      sourceTags.map((t) => ({ ticket_id: newTicketId, tag_id: t.tag_id })),
    );
  }
}

// ---------------------------------------------------------------------------
// Clone is a two-step flow:
//   1. The agent clicks "Clone" on a ticket/comment, which navigates to the
//      create-ticket page with `?clone_from=` / `?clone_post=`. The page calls
//      `resolveCloneSource` to PREFILL the form (title, body w/ origin note,
//      type, category, urgency, privacy, custom fields). Nothing is written yet.
//   2. The agent reviews/edits and submits. `createTicket` re-resolves the source
//      (never trusting the form for ownership), inserts the new ticket owned by
//      the ORIGINAL author via the service role, then calls `finalizeClone` to
//      copy tags, record lineage in the activity log, and — for a comment clone —
//      replace the source comment with the configured reply. If the agent
//      cancels, the create page never submits and nothing changes.
// ---------------------------------------------------------------------------

export type CloneSource = {
  kind: 'ticket' | 'comment';
  sourceTicketId: number;
  sourceSlug: string;
  /** The created clone is owned by this user (source creator / comment author). */
  ownerId: string;
  severity: string | null;
  /** Set only for a comment clone — the post that gets replaced on create. */
  sourcePostId: string | null;
  /** Comment author display name, for the `clone_comment_reply` template. */
  authorName: string;
  /** Values used to prefill the create-ticket form. */
  prefill: {
    title: string;
    body: string;
    typeId: string | null;
    categoryId: string | null;
    urgency: string | null;
    isPrivate: boolean;
    customFields: Record<string, unknown>;
  };
};

/**
 * Resolve a clone source from `clone_from` (ticket id) or `clone_post` (post
 * uuid), applying the same guards as before: a merged stub cannot be cloned, and
 * the original post / private notes cannot be comment-cloned. Returns `null`
 * when the source is missing or not clonable. The caller is responsible for the
 * agent-role check.
 */
export async function resolveCloneSource(
  cloneFromRaw: string | null,
  clonePostRaw: string | null,
): Promise<CloneSource | null> {
  const supabase = await createServerClient();
  const svc = createServiceRoleClient();

  // ----- Comment clone -----------------------------------------------------
  if (clonePostRaw) {
    const { data: post } = await supabase
      .from('posts')
      .select('id, body, author_id, ticket_id, post_type, is_original')
      .eq('id', clonePostRaw)
      .single();

    if (!post) return null;
    // Only real user content: not the original post (use Clone Ticket) and not
    // private agent notes.
    if (post.is_original || post.post_type === 'note') return null;

    const [{ data: author }, { data: source }] = await Promise.all([
      supabase.from('profiles').select('display_name').eq('id', post.author_id).single(),
      supabase
        .from('tickets')
        .select('id, title, slug, type_id, category_id, urgency, severity, is_private, merged_into_id')
        .eq('id', post.ticket_id)
        .single(),
    ]);

    if (!source || source.merged_into_id) return null;

    const originNote = await renderTemplate(svc, 'clone_origin_note', { ticketId: source.id });

    return {
      kind: 'comment',
      sourceTicketId: source.id,
      sourceSlug: source.slug,
      ownerId: post.author_id,
      severity: source.severity,
      sourcePostId: post.id,
      authorName: author?.display_name ?? 'there',
      prefill: {
        title: clampTitle(`Copy of ${source.title}`),
        body: `${originNote}\n\n${post.body}`,
        typeId: source.type_id,
        categoryId: source.category_id,
        urgency: source.urgency,
        isPrivate: source.is_private,
        customFields: {},
      },
    };
  }

  // ----- Ticket clone ------------------------------------------------------
  const cloneFromId = Number(cloneFromRaw);
  if (!cloneFromId) return null;

  const { data: source } = await supabase
    .from('tickets')
    .select('id, title, slug, type_id, category_id, urgency, severity, is_private, custom_fields, creator_id, merged_into_id')
    .eq('id', cloneFromId)
    .single();

  if (!source || source.merged_into_id) return null;

  const [{ data: originalPost }, { data: author }] = await Promise.all([
    supabase
      .from('posts')
      .select('body')
      .eq('ticket_id', source.id)
      .eq('is_original', true)
      .single(),
    supabase.from('profiles').select('display_name').eq('id', source.creator_id).single(),
  ]);

  const originNote = await renderTemplate(svc, 'clone_origin_note', { ticketId: source.id });

  return {
    kind: 'ticket',
    sourceTicketId: source.id,
    sourceSlug: source.slug,
    ownerId: source.creator_id,
    severity: source.severity,
    sourcePostId: null,
    authorName: author?.display_name ?? 'there',
    prefill: {
      title: clampTitle(`Copy of ${source.title}`),
      body: `${originNote}\n\n${originalPost?.body ?? ''}`,
      typeId: source.type_id,
      categoryId: source.category_id,
      urgency: source.urgency,
      isPrivate: source.is_private,
      customFields: (source.custom_fields as Record<string, unknown>) ?? {},
    },
  };
}

/**
 * Side effects performed after the cloned ticket + its original post have been
 * created: copy the source's tags, record lineage in the activity log, and —
 * for a comment clone — replace the source comment with the configured reply
 * (preserving the previous body for audit). Uses the service role because it
 * writes across the source and new tickets on behalf of the original users.
 */
export async function finalizeClone(
  svc: SupabaseClient,
  opts: {
    source: CloneSource;
    agentId: string;
    newTicketId: number;
    newTitle: string;
  },
): Promise<void> {
  const { source, agentId, newTicketId, newTitle } = opts;

  await copyTags(svc, source.sourceTicketId, newTicketId);

  if (source.kind === 'comment' && source.sourcePostId) {
    const replyText = await renderTemplate(svc, 'clone_comment_reply', {
      userName: source.authorName,
      ticketTitle: newTitle,
      ticketId: newTicketId,
    });

    // Preserve the previous body for audit before replacing it.
    const { data: prev } = await svc
      .from('posts')
      .select('body')
      .eq('id', source.sourcePostId)
      .single();

    await svc
      .from('posts')
      .update({ body: replyText, edited_at: new Date().toISOString() })
      .eq('id', source.sourcePostId);

    await svc.from('activity_log').insert([
      {
        ticket_id: source.sourceTicketId,
        actor_id: agentId,
        action: 'comment_cloned',
        details: { post_id: source.sourcePostId, new_ticket_id: newTicketId, previous_body: prev?.body ?? null },
      },
      {
        ticket_id: newTicketId,
        actor_id: agentId,
        action: 'cloned_from',
        details: { source_ticket_id: source.sourceTicketId, source_post_id: source.sourcePostId },
      },
    ]);
    return;
  }

  await svc.from('activity_log').insert([
    {
      ticket_id: source.sourceTicketId,
      actor_id: agentId,
      action: 'cloned_to',
      details: { new_ticket_id: newTicketId },
    },
    {
      ticket_id: newTicketId,
      actor_id: agentId,
      action: 'cloned_from',
      details: { source_ticket_id: source.sourceTicketId },
    },
  ]);
}
