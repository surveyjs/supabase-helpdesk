'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';

async function requireAdminRole() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .single();
  if (!profile || profile.role !== 'admin') {
    throw new Error('Forbidden');
  }
  return { supabase, user, profile };
}

export async function deleteTicket(formData: FormData): Promise<void> {
  const { supabase, user } = await requireAdminRole();

  const ticketId = Number(formData.get('ticket_id'));
  if (!ticketId) return;

  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, title, status')
    .eq('id', ticketId)
    .single();

  if (!ticket) return;

  // Guard: closed tickets cannot be deleted
  if (ticket.status === 'closed') return;

  // Guard: tickets with duplicates pointing to them cannot be deleted
  const { data: duplicates } = await supabase
    .from('tickets')
    .select('id')
    .eq('duplicate_of_id', ticketId);

  if (duplicates && duplicates.length > 0) return;

  // Guard: tickets that are merge targets cannot be deleted
  const { data: mergeStubs } = await supabase
    .from('tickets')
    .select('id')
    .eq('merged_into_id', ticketId);

  if (mergeStubs && mergeStubs.length > 0) return;

  // Delete the ticket (cascading handles posts, activity log, followers, etc.)
  const { error } = await supabase
    .from('tickets')
    .delete()
    .eq('id', ticketId);

  if (error) return;

  // Log in admin audit log
  await supabase.from('admin_audit_log').insert({
    admin_id: user.id,
    action: 'ticket_deleted',
    target_type: 'ticket',
    target_id: String(ticketId),
    details: { ticket_title: ticket.title },
  });

  revalidatePath('/agent');
  redirect('/agent');
}
