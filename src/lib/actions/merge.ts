'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { cancelCsatSurvey } from '@/lib/actions/csat';
import { stopResolutionTimer, recalculateSlaTargets } from '@/lib/utils/sla';

const SEVERITY_ORDER: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

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

export async function mergeTickets(formData: FormData): Promise<void> {
  const { supabase, user } = await requireAgentRole();

  const sourceTicketId = Number(formData.get('source_ticket_id'));
  const targetTicketId = Number(formData.get('target_ticket_id'));

  if (!sourceTicketId || !targetTicketId || sourceTicketId === targetTicketId) return;

  // Fetch both tickets
  const [{ data: source }, { data: target }] = await Promise.all([
    supabase
      .from('tickets')
      .select('id, status, slug, merged_into_id, duplicate_of_id, severity, creator_id')
      .eq('id', sourceTicketId)
      .single(),
    supabase
      .from('tickets')
      .select('id, status, slug, merged_into_id, severity')
      .eq('id', targetTicketId)
      .single(),
  ]);

  if (!source || !target) return;

  // Guards
  if (source.merged_into_id) return; // Already merged
  if (source.duplicate_of_id) return; // Must remove duplicate link first
  if (target.merged_into_id) return; // Cannot merge into a stub

  // Move posts — update is_original on source's original post
  await supabase
    .from('posts')
    .update({ is_original: false })
    .eq('ticket_id', sourceTicketId)
    .eq('is_original', true);

  // Move all posts
  await supabase
    .from('posts')
    .update({ ticket_id: targetTicketId })
    .eq('ticket_id', sourceTicketId);

  // Move attachments
  await supabase
    .from('attachments')
    .update({ ticket_id: targetTicketId })
    .eq('ticket_id', sourceTicketId);

  // Move activity log entries
  await supabase
    .from('activity_log')
    .update({ ticket_id: targetTicketId })
    .eq('ticket_id', sourceTicketId);

  // Consolidate followers
  const { data: sourceFollowers } = await supabase
    .from('ticket_followers')
    .select('user_id')
    .eq('ticket_id', sourceTicketId);

  if (sourceFollowers && sourceFollowers.length > 0) {
    // Try to insert each follower for the target (ignore conflicts)
    for (const f of sourceFollowers) {
      await supabase
        .from('ticket_followers')
        .upsert(
          { ticket_id: targetTicketId, user_id: f.user_id },
          { onConflict: 'ticket_id,user_id' },
        );
    }
  }

  // Source owner becomes follower of target
  await supabase
    .from('ticket_followers')
    .upsert(
      { ticket_id: targetTicketId, user_id: source.creator_id },
      { onConflict: 'ticket_id,user_id' },
    );

  // Delete source followers
  await supabase
    .from('ticket_followers')
    .delete()
    .eq('ticket_id', sourceTicketId);

  // Combine tags
  const { data: sourceTags } = await supabase
    .from('ticket_tags')
    .select('tag_id')
    .eq('ticket_id', sourceTicketId);

  if (sourceTags && sourceTags.length > 0) {
    for (const t of sourceTags) {
      await supabase
        .from('ticket_tags')
        .upsert(
          { ticket_id: targetTicketId, tag_id: t.tag_id },
          { onConflict: 'ticket_id,tag_id' },
        );
    }
    // Delete source tags
    await supabase
      .from('ticket_tags')
      .delete()
      .eq('ticket_id', sourceTicketId);
  }

  // Severity inheritance: higher severity wins
  const sourceSev = SEVERITY_ORDER[source.severity] ?? 2;
  const targetSev = SEVERITY_ORDER[target.severity] ?? 2;
  if (sourceSev > targetSev) {
    await supabase
      .from('tickets')
      .update({ severity: source.severity })
      .eq('id', targetTicketId);

    // Log severity change on target
    await supabase.from('activity_log').insert({
      ticket_id: targetTicketId,
      actor_id: user.id,
      action: 'severity_changed',
      details: { from: target.severity, to: source.severity, reason: 'merge_inheritance' },
    });

    // Recalculate SLA targets
    recalculateSlaTargets(targetTicketId, source.severity).catch((err) =>
      console.error('[sla]', err),
    );
  }

  // Cancel source CSAT
  cancelCsatSurvey(sourceTicketId).catch((err) => console.error('[csat]', err));

  // Freeze source SLA
  stopResolutionTimer(sourceTicketId).catch((err) => console.error('[sla]', err));

  // Close and mark source as merged
  await supabase
    .from('tickets')
    .update({ merged_into_id: targetTicketId, status: 'closed' })
    .eq('id', sourceTicketId);

  // Fetch merge post template and insert on source ticket
  const { data: tpl } = await supabase
    .from('notification_templates')
    .select('body')
    .eq('event_type', 'merge_post')
    .single();

  const templateBody = tpl?.body ?? `This ticket has been merged into [#${targetTicketId}](/tickets/${targetTicketId}).`;
  const renderedBody = templateBody.replace(/\{\{ticketId\}\}/g, String(targetTicketId));

  await supabase.from('posts').insert({
    ticket_id: sourceTicketId,
    author_id: user.id,
    body: renderedBody,
    post_type: 'post',
  });

  // Activity log entries
  await supabase.from('activity_log').insert({
    ticket_id: targetTicketId,
    actor_id: user.id,
    action: 'merged_from',
    details: { source_ticket_id: sourceTicketId },
  });

  await supabase.from('activity_log').insert({
    ticket_id: sourceTicketId,
    actor_id: user.id,
    action: 'merged_into',
    details: { target_ticket_id: targetTicketId },
  });

  revalidatePath(`/tickets/${sourceTicketId}/${source.slug}`);
  revalidatePath(`/tickets/${targetTicketId}/${target.slug}`);
  revalidatePath('/agent');
}
