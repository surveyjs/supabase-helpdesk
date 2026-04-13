'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { generateSlug } from '@/lib/utils/slug';
import { validateTitle, validateBody } from '@/lib/utils/validation';
import { notifyTicketRecipients, notifyAgent } from '@/lib/email/notify';
import { cancelCsatSurvey } from '@/lib/actions/csat';
import { initializeSlaTimer, stopFirstResponseTimer, resumeSlaTimer } from '@/lib/utils/sla';

export type TicketActionState = {
  error?: string;
  fieldErrors?: Record<string, string>;
};

const VALID_URGENCIES = ['low', 'medium', 'high', 'critical'];

export async function createTicket(
  _prev: TicketActionState,
  formData: FormData,
): Promise<TicketActionState> {
  const supabase = await createServerClient();

  // Auth check
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Get profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, is_blocked')
    .eq('id', user.id)
    .single();

  if (!profile) return { error: 'Profile not found.' };
  if (profile.is_blocked) return { error: 'Your account has been blocked.' };

  // Extract form data
  const title = (formData.get('title') as string)?.trim() ?? '';
  const body = (formData.get('body') as string) ?? '';
  const urgency = (formData.get('urgency') as string) ?? 'medium';
  const typeId = formData.get('type_id') as string;
  const categoryId = (formData.get('category_id') as string) || null;
  const privacyRaw = formData.get('is_private') === 'on';
  const sourceArticleIdRaw = formData.get('source_article_id') as string;
  const sourceArticleId = sourceArticleIdRaw ? parseInt(sourceArticleIdRaw, 10) : null;

  // Validate
  const fieldErrors: Record<string, string> = {};
  const titleError = validateTitle(title);
  if (titleError) fieldErrors.title = titleError;
  const bodyError = validateBody(body);
  if (bodyError) fieldErrors.body = bodyError;
  if (!VALID_URGENCIES.includes(urgency)) fieldErrors.urgency = 'Invalid urgency level.';

  // Validate type_id
  if (!typeId) {
    fieldErrors.type_id = 'Ticket type is required.';
  } else {
    const { data: typeExists } = await supabase
      .from('ticket_types')
      .select('id')
      .eq('id', typeId)
      .single();
    if (!typeExists) fieldErrors.type_id = 'Invalid ticket type.';
  }

  // Validate category_id if provided
  if (categoryId) {
    const { data: catExists } = await supabase
      .from('categories')
      .select('id')
      .eq('id', categoryId)
      .single();
    if (!catExists) fieldErrors.category_id = 'Invalid category.';
  }

  if (Object.keys(fieldErrors).length > 0) return { fieldErrors };

  // Rate limit check (agents exempt)
  const isAgent = profile.role === 'agent' || profile.role === 'admin';
  if (!isAgent) {
    const { data: rateLimitSetting } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'ticket_creation_rate_limit')
      .single();

    const rateLimit = rateLimitSetting ? parseInt(rateLimitSetting.value, 10) : 10;

    if (rateLimit > 0) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { count } = await supabase
        .from('tickets')
        .select('id', { count: 'exact', head: true })
        .eq('creator_id', user.id)
        .gte('created_at', since);

      if (count !== null && count >= rateLimit) {
        return { error: 'You have reached the ticket creation limit. Please try again later.' };
      }
    }
  }

  // Determine privacy
  const { data: defaultPrivacySetting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'ticket_default_privacy')
    .single();

  const { data: privacyControlSetting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'allow_user_privacy_control')
    .single();

  const defaultPrivacy = defaultPrivacySetting?.value !== 'false';
  const allowPrivacyControl = privacyControlSetting?.value !== 'false';
  const isPrivate = allowPrivacyControl ? privacyRaw : defaultPrivacy;

  // Generate slug
  const slug = generateSlug(title);

  // Process custom fields
  const { data: customFieldDefs } = await supabase
    .from('custom_fields')
    .select('*')
    .order('display_order');

  const customFieldValues: Record<string, unknown> = {};
  if (customFieldDefs) {
    for (const def of customFieldDefs) {
      const raw = formData.get(`cf_${def.name}`) as string | null;
      if (def.field_type === 'checkbox') {
        customFieldValues[def.name] = raw === 'on';
      } else if (def.field_type === 'number' && raw) {
        const num = parseFloat(raw);
        if (!isNaN(num)) customFieldValues[def.name] = num;
      } else if (def.field_type === 'text' && raw) {
        if (raw.length > 1000) {
          fieldErrors[`cf_${def.name}`] = 'Maximum 1,000 characters.';
        } else {
          customFieldValues[def.name] = raw;
        }
      } else if (def.field_type === 'dropdown' && raw) {
        const opts = def.options as string[];
        if (opts && !opts.includes(raw)) {
          fieldErrors[`cf_${def.name}`] = 'Invalid option.';
        } else {
          customFieldValues[def.name] = raw;
        }
      } else if (raw) {
        customFieldValues[def.name] = raw;
      }
      if (def.is_required && !raw && def.field_type !== 'checkbox') {
        fieldErrors[`cf_${def.name}`] = `${def.name} is required.`;
      }
    }
  }

  if (Object.keys(fieldErrors).length > 0) return { fieldErrors };

  // Insert ticket
  const { data: ticket, error: ticketError } = await supabase
    .from('tickets')
    .insert({
      title,
      slug,
      urgency,
      type_id: typeId,
      category_id: categoryId,
      creator_id: user.id,
      is_private: isPrivate,
      custom_fields: Object.keys(customFieldValues).length > 0 ? customFieldValues : {},
      source_article_id: sourceArticleId && !isNaN(sourceArticleId) ? sourceArticleId : null,
    })
    .select('id, slug')
    .single();

  if (ticketError) {
    if (ticketError.message.includes('rate limit')) {
      return { error: 'You have reached the ticket creation limit. Please try again later.' };
    }
    return { error: 'Failed to create ticket. Please try again.' };
  }

  // Insert original post
  const { error: postError } = await supabase
    .from('posts')
    .insert({
      ticket_id: ticket.id,
      author_id: user.id,
      body,
      is_original: true,
      post_type: 'post',
    });

  if (postError) {
    // Cleanup: delete the ticket if post creation fails
    await supabase.from('tickets').delete().eq('id', ticket.id);
    return { error: 'Failed to create ticket. Please try again.' };
  }

  // Auto-follow: insert ticket_followers row for creator
  await supabase
    .from('ticket_followers')
    .insert({ ticket_id: ticket.id, user_id: user.id });

  // Initialize SLA timer (defaults to medium severity)
  initializeSlaTimer(ticket.id, 'medium').catch((err) => console.error('[sla]', err));

  redirect(`/tickets/${ticket.id}/${ticket.slug}`);
}

export async function replyToTicket(
  _prev: TicketActionState,
  formData: FormData,
): Promise<TicketActionState> {
  const supabase = await createServerClient();

  // Auth check
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Get profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, is_blocked, display_name')
    .eq('id', user.id)
    .single();

  if (!profile) return { error: 'Profile not found.' };
  if (profile.is_blocked) return { error: 'Your account has been blocked.' };

  const ticketId = formData.get('ticket_id') as string;
  const body = (formData.get('body') as string) ?? '';

  const bodyError = validateBody(body);
  if (bodyError) return { error: bodyError };

  if (!ticketId) return { error: 'Ticket ID is required.' };

  // Check ticket exists and user can access it
  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, slug, status, creator_id, duplicate_of_id, assigned_agent_id')
    .eq('id', ticketId)
    .single();

  if (!ticket) return { error: 'Ticket not found.' };

  // Check duplicate restriction for non-agents
  const isAgent = profile.role === 'agent' || profile.role === 'admin';
  if (!isAgent && ticket.duplicate_of_id) {
    return { error: 'This ticket has been marked as a duplicate. You cannot reply to it.' };
  }

  // Insert new post
  const { error: postError } = await supabase
    .from('posts')
    .insert({
      ticket_id: ticket.id,
      author_id: user.id,
      body,
      post_type: 'post',
    });

  if (postError) {
    return { error: 'Failed to add reply. Please try again.' };
  }

  // If ticket is pending/closed and user is not agent: transition to 'open'
  let autoReopened = false;
  if (!isAgent && (ticket.status === 'pending' || ticket.status === 'closed')) {
    const { error: statusError } = await supabase
      .from('tickets')
      .update({ status: 'open' })
      .eq('id', ticket.id);

    if (!statusError) {
      autoReopened = true;
      // Cancel pending CSAT survey if ticket is reopened from closed
      if (ticket.status === 'closed') {
        cancelCsatSurvey(ticket.id).catch((err) => console.error('[csat]', err));
      }
      // Resume SLA timer on auto re-open (pending→open or closed→open)
      resumeSlaTimer(ticket.id).catch((err) => console.error('[sla]', err));
      // Log status change
      await supabase.from('activity_log').insert({
        ticket_id: ticket.id,
        actor_id: user.id,
        action: 'status_changed',
        details: {
          from: ticket.status,
          to: 'open',
          reason: 'User reply auto-transition',
        },
      });
    }
  }

  // --- Notifications ---
  const placeholders = { authorName: profile.display_name ?? user.email ?? '' };

  if (isAgent) {
    // Agent reply → notify ticket owner + followers (coalesced)
    notifyTicketRecipients(ticket.id, 'new_post', placeholders, user.id, user.id).catch((err) => console.error('[notify]', err));

    // Check if this is the first agent reply — stop first response timer
    const { count: agentReplyCount } = await supabase
      .from('posts')
      .select('id', { count: 'exact', head: true })
      .eq('ticket_id', ticket.id)
      .eq('post_type', 'post')
      .eq('is_original', false)
      .neq('author_id', ticket.creator_id);

    if (agentReplyCount !== null && agentReplyCount <= 1) {
      stopFirstResponseTimer(ticket.id).catch((err) => console.error('[sla]', err));
    }
  } else {
    // User reply → notify ticket owner + followers (non-agent, no coalescing)
    notifyTicketRecipients(ticket.id, 'new_post', placeholders, user.id).catch((err) => console.error('[notify]', err));

    // Notify assigned agent (already fetched in initial ticket query)
    if (ticket.assigned_agent_id && ticket.assigned_agent_id !== user.id) {
      notifyAgent(ticket.assigned_agent_id, 'user_reply_to_agent', ticket.id, placeholders).catch((err) => console.error('[notify]', err));
    }

    // If auto-reopened, also send auto_reopen notification
    if (autoReopened) {
      notifyTicketRecipients(ticket.id, 'auto_reopen', placeholders, user.id).catch((err) => console.error('[notify]', err));
    }
  }

  revalidatePath(`/tickets/${ticket.id}/${ticket.slug}`);
  return {};
}

// ---------------------------------------------------------------------------
// addComment
// ---------------------------------------------------------------------------
export async function addComment(
  _prev: TicketActionState,
  formData: FormData,
): Promise<TicketActionState> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, is_blocked, display_name')
    .eq('id', user.id)
    .single();

  if (!profile) return { error: 'Profile not found.' };
  if (profile.is_blocked) return { error: 'Your account has been blocked.' };

  const body = (formData.get('body') as string) ?? '';
  const parentPostId = formData.get('parent_post_id') as string;
  const parentCommentId = (formData.get('parent_comment_id') as string) || null;

  const bodyError = validateBody(body);
  if (bodyError) return { error: bodyError };
  if (!parentPostId) return { error: 'Parent post ID is required.' };

  // If replying to a comment, check nesting limit
  if (parentCommentId) {
    const { data: parentComment } = await supabase
      .from('posts')
      .select('id, parent_comment_id, ticket_id')
      .eq('id', parentCommentId)
      .single();

    if (!parentComment) return { error: 'Parent comment not found.' };
    if (parentComment.parent_comment_id) {
      return { error: 'Comments can only be nested up to 2 levels.' };
    }
  }

  // Fetch the parent post to get ticket info
  const { data: parentPost } = await supabase
    .from('posts')
    .select('id, ticket_id')
    .eq('id', parentPostId)
    .single();

  if (!parentPost) return { error: 'Parent post not found.' };

  // Check ticket access & duplicate restriction
  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, slug, status, creator_id, duplicate_of_id')
    .eq('id', parentPost.ticket_id)
    .single();

  if (!ticket) return { error: 'Ticket not found.' };

  const isAgent = profile.role === 'agent' || profile.role === 'admin';
  if (!isAgent && ticket.duplicate_of_id) {
    return { error: 'This ticket has been marked as a duplicate.' };
  }

  // Insert comment
  const { error: insertError } = await supabase
    .from('posts')
    .insert({
      ticket_id: ticket.id,
      author_id: user.id,
      body,
      post_type: 'comment',
      parent_post_id: parentPostId,
      parent_comment_id: parentCommentId,
    });

  if (insertError) {
    if (insertError.message.includes('nested up to 2 levels')) {
      return { error: 'Comments can only be nested up to 2 levels.' };
    }
    return { error: 'Failed to add comment. Please try again.' };
  }

  // Auto-transition for non-agents
  if (!isAgent && (ticket.status === 'pending' || ticket.status === 'closed')) {
    const { error: statusError } = await supabase
      .from('tickets')
      .update({ status: 'open' })
      .eq('id', ticket.id);

    if (!statusError) {
      // Cancel pending CSAT survey if ticket is reopened from closed
      if (ticket.status === 'closed') {
        cancelCsatSurvey(ticket.id).catch((err) => console.error('[csat]', err));
      }
      await supabase.from('activity_log').insert({
        ticket_id: ticket.id,
        actor_id: user.id,
        action: 'status_changed',
        details: { from: ticket.status, to: 'open', reason: 'User comment auto-transition' },
      });
    }
  }

  // --- Notifications ---
  const commentPlaceholders = { authorName: profile.display_name ?? user.email ?? '' };
  if (isAgent) {
    notifyTicketRecipients(ticket.id, 'new_post', commentPlaceholders, user.id, user.id).catch((err) => console.error('[notify]', err));
  } else {
    notifyTicketRecipients(ticket.id, 'new_post', commentPlaceholders, user.id).catch((err) => console.error('[notify]', err));
    // Notify assigned agent
    const { data: tkt } = await supabase
      .from('tickets')
      .select('assigned_agent_id')
      .eq('id', ticket.id)
      .single();
    if (tkt?.assigned_agent_id && tkt.assigned_agent_id !== user.id) {
      notifyAgent(tkt.assigned_agent_id, 'user_reply_to_agent', ticket.id, commentPlaceholders).catch((err) => console.error('[notify]', err));
    }
  }

  revalidatePath(`/tickets/${ticket.id}/${ticket.slug}`);
  return {};
}

// ---------------------------------------------------------------------------
// addNote
// ---------------------------------------------------------------------------
export async function addNote(
  _prev: TicketActionState,
  formData: FormData,
): Promise<TicketActionState> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .single();

  if (!profile || !['agent', 'admin'].includes(profile.role)) {
    return { error: 'Forbidden.' };
  }

  const body = (formData.get('body') as string) ?? '';
  const ticketId = formData.get('ticket_id') as string;

  const bodyError = validateBody(body);
  if (bodyError) return { error: bodyError };
  if (!ticketId) return { error: 'Ticket ID is required.' };

  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, slug')
    .eq('id', ticketId)
    .single();

  if (!ticket) return { error: 'Ticket not found.' };

  const { error: insertError } = await supabase
    .from('posts')
    .insert({
      ticket_id: ticket.id,
      author_id: user.id,
      body,
      post_type: 'note',
      is_private: true,
    });

  if (insertError) return { error: 'Failed to add note. Please try again.' };

  revalidatePath(`/tickets/${ticket.id}/${ticket.slug}`);
  return {};
}

// ---------------------------------------------------------------------------
// editPost
// ---------------------------------------------------------------------------
export async function editPost(
  _prev: TicketActionState,
  formData: FormData,
): Promise<TicketActionState> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .single();

  if (!profile) return { error: 'Profile not found.' };

  const postId = formData.get('post_id') as string;
  const body = (formData.get('body') as string) ?? '';

  if (!postId) return { error: 'Post ID is required.' };
  const bodyError = validateBody(body);
  if (bodyError) return { error: bodyError };

  const { data: post } = await supabase
    .from('posts')
    .select('id, author_id, is_original, post_type, ticket_id')
    .eq('id', postId)
    .single();

  if (!post) return { error: 'Post not found.' };
  if (post.is_original) return { error: 'The original post cannot be edited.' };

  const isAgent = profile.role === 'agent' || profile.role === 'admin';

  // Permission check
  if (post.author_id !== user.id) {
    if (!isAgent) return { error: 'You can only edit your own posts.' };
    if (post.post_type === 'note') return { error: 'You can only edit your own notes.' };
  }

  const { error: updateError } = await supabase
    .from('posts')
    .update({ body, edited_at: new Date().toISOString() })
    .eq('id', postId);

  if (updateError) return { error: 'Failed to edit post. Please try again.' };

  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, slug')
    .eq('id', post.ticket_id)
    .single();

  if (ticket) revalidatePath(`/tickets/${ticket.id}/${ticket.slug}`);
  return {};
}

// ---------------------------------------------------------------------------
// editTicketTitle
// ---------------------------------------------------------------------------
export async function editTicketTitle(
  _prev: TicketActionState,
  formData: FormData,
): Promise<TicketActionState> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .single();

  if (!profile) return { error: 'Profile not found.' };

  const ticketId = formData.get('ticket_id') as string;
  const title = (formData.get('title') as string)?.trim() ?? '';

  if (!ticketId) return { error: 'Ticket ID is required.' };
  const titleError = validateTitle(title);
  if (titleError) return { error: titleError };

  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, title, slug, creator_id')
    .eq('id', ticketId)
    .single();

  if (!ticket) return { error: 'Ticket not found.' };

  const isAgent = profile.role === 'agent' || profile.role === 'admin';
  if (ticket.creator_id !== user.id && !isAgent) {
    return { error: 'You can only edit the title of your own tickets.' };
  }

  const oldTitle = ticket.title;
  const newSlug = generateSlug(title);

  const { error: updateError } = await supabase
    .from('tickets')
    .update({ title, slug: newSlug })
    .eq('id', ticketId);

  if (updateError) return { error: 'Failed to update title. Please try again.' };

  // Log title change
  await supabase.from('activity_log').insert({
    ticket_id: ticket.id,
    actor_id: user.id,
    action: 'title_changed',
    details: { from: oldTitle, to: title },
  });

  revalidatePath(`/tickets/${ticket.id}/${newSlug}`);
  redirect(`/tickets/${ticket.id}/${newSlug}`);
}

// ---------------------------------------------------------------------------
// deletePost
// ---------------------------------------------------------------------------
export async function deletePost(formData: FormData): Promise<void> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .single();

  if (!profile) return;

  const postId = formData.get('post_id') as string;
  if (!postId) return;

  const { data: post } = await supabase
    .from('posts')
    .select('id, author_id, is_original, post_type, ticket_id')
    .eq('id', postId)
    .single();

  if (!post) return;
  if (post.is_original) return;

  const isAgent = profile.role === 'agent' || profile.role === 'admin';
  const isAdmin = profile.role === 'admin';

  // Regular users cannot delete any posts
  if (!isAgent) return;

  // Agents can delete posts/comments
  // Agents can delete own notes, admins can delete any note
  if (post.post_type === 'note' && post.author_id !== user.id && !isAdmin) return;

  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, slug')
    .eq('id', post.ticket_id)
    .single();

  await supabase.from('posts').delete().eq('id', postId);

  if (ticket) revalidatePath(`/tickets/${ticket.id}/${ticket.slug}`);
}

// ---------------------------------------------------------------------------
// togglePostPrivacy
// ---------------------------------------------------------------------------
export async function togglePostPrivacy(formData: FormData): Promise<void> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .single();

  if (!profile || !['agent', 'admin'].includes(profile.role)) return;

  const postId = formData.get('post_id') as string;
  if (!postId) return;

  const { data: post } = await supabase
    .from('posts')
    .select('id, is_original, is_private, ticket_id')
    .eq('id', postId)
    .single();

  if (!post || post.is_original) return;

  const { error } = await supabase
    .from('posts')
    .update({ is_private: !post.is_private })
    .eq('id', postId);

  if (error) return;

  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, slug')
    .eq('id', post.ticket_id)
    .single();

  if (ticket) {
    await supabase.from('activity_log').insert({
      ticket_id: ticket.id,
      actor_id: user.id,
      action: 'post_privacy_changed',
      details: { post_id: postId, is_private: !post.is_private },
    });
    revalidatePath(`/tickets/${ticket.id}/${ticket.slug}`);
  }
}

// ---------------------------------------------------------------------------
// saveDraft
// ---------------------------------------------------------------------------
export async function saveDraft(
  _prev: TicketActionState,
  formData: FormData,
): Promise<TicketActionState> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .single();

  if (!profile || !['agent', 'admin'].includes(profile.role)) {
    return { error: 'Forbidden.' };
  }

  const body = (formData.get('body') as string) ?? '';
  const ticketId = formData.get('ticket_id') as string;
  const postType = (formData.get('post_type') as string) || 'post';

  const bodyError = validateBody(body);
  if (bodyError) return { error: bodyError };
  if (!ticketId) return { error: 'Ticket ID is required.' };

  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, slug')
    .eq('id', ticketId)
    .single();

  if (!ticket) return { error: 'Ticket not found.' };

  const insertData: Record<string, unknown> = {
    ticket_id: ticket.id,
    author_id: user.id,
    body,
    post_type: postType,
    is_draft: true,
  };

  if (postType === 'note') {
    insertData.is_private = true;
  }

  const { error: insertError } = await supabase
    .from('posts')
    .insert(insertData);

  if (insertError) return { error: 'Failed to save draft. Please try again.' };

  revalidatePath(`/tickets/${ticket.id}/${ticket.slug}`);
  return {};
}

// ---------------------------------------------------------------------------
// publishDraft
// ---------------------------------------------------------------------------
export async function publishDraft(formData: FormData): Promise<void> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, display_name')
    .eq('id', user.id)
    .single();

  if (!profile || !['agent', 'admin'].includes(profile.role)) return;

  const postId = formData.get('post_id') as string;
  if (!postId) return;

  const { data: post } = await supabase
    .from('posts')
    .select('id, is_draft, author_id, ticket_id')
    .eq('id', postId)
    .single();

  if (!post || !post.is_draft || post.author_id !== user.id) return;

  const { error } = await supabase
    .from('posts')
    .update({ is_draft: false })
    .eq('id', postId);

  if (error) return;

  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, slug')
    .eq('id', post.ticket_id)
    .single();

  if (ticket) {
    await supabase.from('activity_log').insert({
      ticket_id: ticket.id,
      actor_id: user.id,
      action: 'draft_published',
      details: { post_id: postId },
    });

    // Notify owner + followers (agent-triggered, coalesced)
    notifyTicketRecipients(
      ticket.id,
      'new_post',
      { authorName: profile.display_name ?? user.email ?? '' },
      user.id,
      user.id,
    ).catch((err) => console.error('[notify]', err));

    revalidatePath(`/tickets/${ticket.id}/${ticket.slug}`);
  }
}
