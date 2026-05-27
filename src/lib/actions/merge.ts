'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServerClient, createServiceRoleClient } from '@/lib/supabase/server';
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

  // Use service role for cross-table data migration (some tables lack UPDATE RLS policies)
  const svc = createServiceRoleClient();

  // Move posts — update is_original on source's original post
  const { error: e1 } = await svc
    .from('posts')
    .update({ is_original: false })
    .eq('ticket_id', sourceTicketId)
    .eq('is_original', true);

  if (e1) throw new Error(`Merge failed (is_original): ${e1.message}`);

  // Move all posts
  const { error: e2 } = await svc
    .from('posts')
    .update({ ticket_id: targetTicketId })
    .eq('ticket_id', sourceTicketId);

  if (e2) throw new Error(`Merge failed (move posts): ${e2.message}`);

  // Attachments are linked to posts (via post_id), not tickets.
  // Moving posts above implicitly moves their attachments.

  // Move activity log entries
  const { error: e4 } = await svc
    .from('activity_log')
    .update({ ticket_id: targetTicketId })
    .eq('ticket_id', sourceTicketId);

  if (e4) throw new Error(`Merge failed (move activity_log): ${e4.message}`);

  // Consolidate followers
  const { data: sourceFollowers } = await svc
    .from('ticket_followers')
    .select('user_id')
    .eq('ticket_id', sourceTicketId);

  if (sourceFollowers && sourceFollowers.length > 0) {
    // Try to insert each follower for the target (ignore conflicts)
    for (const f of sourceFollowers) {
      await svc
        .from('ticket_followers')
        .upsert(
          { ticket_id: targetTicketId, user_id: f.user_id },
          { onConflict: 'ticket_id,user_id' },
        );
    }
  }

  // Source owner becomes follower of target
  await svc
    .from('ticket_followers')
    .upsert(
      { ticket_id: targetTicketId, user_id: source.creator_id },
      { onConflict: 'ticket_id,user_id' },
    );

  // Delete source followers
  await svc
    .from('ticket_followers')
    .delete()
    .eq('ticket_id', sourceTicketId);

  // Combine tags
  const { data: sourceTags } = await svc
    .from('ticket_tags')
    .select('tag_id')
    .eq('ticket_id', sourceTicketId);

  if (sourceTags && sourceTags.length > 0) {
    for (const t of sourceTags) {
      await svc
        .from('ticket_tags')
        .upsert(
          { ticket_id: targetTicketId, tag_id: t.tag_id },
          { onConflict: 'ticket_id,tag_id' },
        );
    }
    // Delete source tags
    await svc
      .from('ticket_tags')
      .delete()
      .eq('ticket_id', sourceTicketId);
  }

  // Severity inheritance: higher severity wins
  const sourceSev = SEVERITY_ORDER[source.severity] ?? 2;
  const targetSev = SEVERITY_ORDER[target.severity] ?? 2;
  if (sourceSev > targetSev) {
    await svc
      .from('tickets')
      .update({ severity: source.severity })
      .eq('id', targetTicketId);

    // Log severity change on target
    await svc.from('activity_log').insert({
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
  const { error: mergeErr } = await svc
    .from('tickets')
    .update({ merged_into_id: targetTicketId, status: 'closed' })
    .eq('id', sourceTicketId);

  if (mergeErr) throw new Error(`Merge failed (close source): ${mergeErr.message}`);

  // Fetch merge post template and insert on source ticket
  const { data: tpl } = await svc
    .from('notification_templates')
    .select('body')
    .eq('event_type', 'merge_post')
    .single();

  const templateBody = tpl?.body ?? `This ticket has been merged into [#${targetTicketId}](/tickets/${targetTicketId}/redirect).`;
  const renderedBody = templateBody.replace(/\{\{ticketId\}\}/g, String(targetTicketId));

  await svc.from('posts').insert({
    ticket_id: sourceTicketId,
    author_id: user.id,
    body: renderedBody,
    post_type: 'post',
  });

  // Activity log entries
  await svc.from('activity_log').insert({
    ticket_id: targetTicketId,
    actor_id: user.id,
    action: 'merged_from',
    details: { source_ticket_id: sourceTicketId },
  });

  await svc.from('activity_log').insert({
    ticket_id: sourceTicketId,
    actor_id: user.id,
    action: 'merged_into',
    details: { target_ticket_id: targetTicketId },
  });

  revalidatePath(`/tickets/${sourceTicketId}/${source.slug}`);
  revalidatePath(`/tickets/${targetTicketId}/${target.slug}`);
  revalidatePath('/agent');
}
