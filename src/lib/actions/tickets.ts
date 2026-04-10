'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { generateSlug } from '@/lib/utils/slug';
import { validateTitle, validateBody } from '@/lib/utils/validation';

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
    .select('id, role, is_blocked')
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
    .select('id, slug, status, creator_id, duplicate_of_id')
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
  if (!isAgent && (ticket.status === 'pending' || ticket.status === 'closed')) {
    const { error: statusError } = await supabase
      .from('tickets')
      .update({ status: 'open' })
      .eq('id', ticket.id);

    if (!statusError) {
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

  revalidatePath(`/tickets/${ticket.id}/${ticket.slug}`);
  return {};
}
