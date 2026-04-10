import { createServerClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/auth';
import { TicketForm } from '@/components/features/tickets/TicketForm';

export default async function NewTicketPage() {
  await requireAuth();
  const supabase = await createServerClient();

  // Fetch ticket types
  const { data: ticketTypes } = await supabase
    .from('ticket_types')
    .select('id, name, is_default')
    .order('name');

  // Fetch categories
  const { data: categories } = await supabase
    .from('categories')
    .select('id, name')
    .order('name');

  // Fetch privacy settings
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

  const defaultPrivate = defaultPrivacySetting?.value !== 'false';
  const showPrivacyControl = privacyControlSetting?.value !== 'false';

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Create Ticket</h1>
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <TicketForm
          ticketTypes={ticketTypes ?? []}
          categories={categories ?? []}
          defaultPrivate={defaultPrivate}
          showPrivacyControl={showPrivacyControl}
        />
      </div>
    </div>
  );
}
