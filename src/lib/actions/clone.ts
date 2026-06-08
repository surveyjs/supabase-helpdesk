'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServerClient, createServiceRoleClient } from '@/lib/supabase/server';
import { generateSlug } from '@/lib/utils/slug';
import { initializeSlaTimer } from '@/lib/utils/sla';
import { DEFAULT_TEMPLATES } from '@/lib/constants/notification-templates';

async function requireAgentRole() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .single();
  if (!profile || !['agent', 'admin'].includes(profile.role)) {
    throw new Error('Forbidden');
  }
  return { supabase, user, profile };
}

/**
 * Render a notification template body for the given event type, substituting
 * {{placeholder}} tokens. Falls back to the built-in default when the row is
 * missing or empty.
 */
async function renderTemplate(
  svc: ReturnType<typeof createServiceRoleClient>,
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
  svc: ReturnType<typeof createServiceRoleClient>,
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
// cloneTicket — create a copy of an existing ticket, owned by its creator.
// ---------------------------------------------------------------------------
export async function cloneTicket(formData: FormData): Promise<void> {
  const { user } = await requireAgentRole();

  const ticketId = Number(formData.get('ticket_id'));
  if (!ticketId) return;

  const supabase = await createServerClient();

  const { data: source } = await supabase
    .from('tickets')
    .select('id, title, slug, type_id, category_id, urgency, severity, is_private, custom_fields, creator_id, merged_into_id')
    .eq('id', ticketId)
    .single();

  if (!source) return;
  // Cannot clone a merged stub — it has no usable content.
  if (source.merged_into_id) return;

  // Fetch the source's original post body.
  const { data: originalPost } = await supabase
    .from('posts')
    .select('body')
    .eq('ticket_id', ticketId)
    .eq('is_original', true)
    .single();

  // Use the service role for cross-user inserts (the clone is owned by the
  // source creator, not the acting agent — RLS insert policies require
  // creator_id = auth.uid()).
  const svc = createServiceRoleClient();

  const newTitle = clampTitle(`Copy of ${source.title}`);
  const newSlug = generateSlug(newTitle);

  const originNote = await renderTemplate(svc, 'clone_origin_note', {
    ticketId: source.id,
  });
  const newBody = `${originNote}\n\n${originalPost?.body ?? ''}`;

  // Insert the new ticket.
  const { data: newTicket, error: ticketError } = await svc
    .from('tickets')
    .insert({
      title: newTitle,
      slug: newSlug,
      type_id: source.type_id,
      category_id: source.category_id,
      urgency: source.urgency,
      severity: source.severity,
      is_private: source.is_private,
      custom_fields: source.custom_fields ?? {},
      creator_id: source.creator_id,
      cloned_from_id: source.id,
    })
    .select('id, slug')
    .single();

  if (ticketError || !newTicket) {
    throw new Error(`Clone failed (create ticket): ${ticketError?.message ?? 'unknown'}`);
  }

  // Insert the original post.
  const { error: postError } = await svc.from('posts').insert({
    ticket_id: newTicket.id,
    author_id: source.creator_id,
    body: newBody,
    is_original: true,
    post_type: 'post',
  });

  if (postError) {
    // Roll back the orphaned ticket.
    await svc.from('tickets').delete().eq('id', newTicket.id);
    throw new Error(`Clone failed (create post): ${postError.message}`);
  }

  await copyTags(svc, source.id, newTicket.id);

  // Owner auto-follows.
  await svc
    .from('ticket_followers')
    .insert({ ticket_id: newTicket.id, user_id: source.creator_id });

  initializeSlaTimer(newTicket.id, source.severity).catch((err) => console.error('[sla]', err));

  // Activity log on both tickets.
  await svc.from('activity_log').insert([
    {
      ticket_id: source.id,
      actor_id: user.id,
      action: 'cloned_to',
      details: { new_ticket_id: newTicket.id },
    },
    {
      ticket_id: newTicket.id,
      actor_id: user.id,
      action: 'cloned_from',
      details: { source_ticket_id: source.id },
    },
  ]);

  revalidatePath(`/tickets/${source.id}/${source.slug}`);
  revalidatePath('/agent');
  redirect(`/tickets/${newTicket.id}/${newTicket.slug}`);
}

// ---------------------------------------------------------------------------
// cloneCommentToTicket — spin a user post/comment off into a new ticket and
// replace the original comment in the source thread with a link to the clone.
// ---------------------------------------------------------------------------
export async function cloneCommentToTicket(formData: FormData): Promise<void> {
  const { user } = await requireAgentRole();

  const postId = formData.get('post_id') as string;
  if (!postId) return;
  const titleInput = (formData.get('title') as string)?.trim() ?? '';

  const supabase = await createServerClient();

  const { data: post } = await supabase
    .from('posts')
    .select('id, body, author_id, ticket_id, post_type, is_original')
    .eq('id', postId)
    .single();

  if (!post) return;
  // Only real user content can be cloned: not the original post (use Clone
  // Ticket for that) and not private agent notes.
  if (post.is_original || post.post_type === 'note') return;

  const [{ data: author }, { data: source }] = await Promise.all([
    supabase.from('profiles').select('display_name').eq('id', post.author_id).single(),
    supabase
      .from('tickets')
      .select('id, title, slug, type_id, category_id, urgency, severity, is_private, merged_into_id')
      .eq('id', post.ticket_id)
      .single(),
  ]);

  if (!source) return;
  if (source.merged_into_id) return;

  const svc = createServiceRoleClient();

  const newTitle = clampTitle(titleInput || `Copy of ${source.title}`);
  const newSlug = generateSlug(newTitle);

  const originNote = await renderTemplate(svc, 'clone_origin_note', {
    ticketId: source.id,
  });
  const newBody = `${originNote}\n\n${post.body}`;

  // Insert the new ticket, owned by the comment's author.
  const { data: newTicket, error: ticketError } = await svc
    .from('tickets')
    .insert({
      title: newTitle,
      slug: newSlug,
      type_id: source.type_id,
      category_id: source.category_id,
      urgency: source.urgency,
      severity: source.severity,
      is_private: source.is_private,
      creator_id: post.author_id,
      cloned_from_id: source.id,
      cloned_from_post_id: post.id,
    })
    .select('id, slug')
    .single();

  if (ticketError || !newTicket) {
    throw new Error(`Clone failed (create ticket): ${ticketError?.message ?? 'unknown'}`);
  }

  const { error: postError } = await svc.from('posts').insert({
    ticket_id: newTicket.id,
    author_id: post.author_id,
    body: newBody,
    is_original: true,
    post_type: 'post',
  });

  if (postError) {
    await svc.from('tickets').delete().eq('id', newTicket.id);
    throw new Error(`Clone failed (create post): ${postError.message}`);
  }

  await svc
    .from('ticket_followers')
    .insert({ ticket_id: newTicket.id, user_id: post.author_id });

  initializeSlaTimer(newTicket.id, source.severity).catch((err) => console.error('[sla]', err));

  // Replace the source comment body with the configurable reply text.
  const replyText = await renderTemplate(svc, 'clone_comment_reply', {
    userName: author?.display_name ?? 'there',
    ticketTitle: newTitle,
    ticketId: newTicket.id,
  });

  const previousBody = post.body;
  await svc
    .from('posts')
    .update({ body: replyText, edited_at: new Date().toISOString() })
    .eq('id', post.id);

  // Activity log: record the clone and retain the replaced body for audit.
  await svc.from('activity_log').insert([
    {
      ticket_id: source.id,
      actor_id: user.id,
      action: 'comment_cloned',
      details: { post_id: post.id, new_ticket_id: newTicket.id, previous_body: previousBody },
    },
    {
      ticket_id: newTicket.id,
      actor_id: user.id,
      action: 'cloned_from',
      details: { source_ticket_id: source.id, source_post_id: post.id },
    },
  ]);

  revalidatePath(`/tickets/${source.id}/${source.slug}`);
  revalidatePath('/agent');
  redirect(`/tickets/${newTicket.id}/${newTicket.slug}`);
}
