import { createServerClient } from '@/lib/supabase/server';
import 'survey-core/survey-core.min.css';
import { InboundEmailForm } from './InboundEmailForm';

export default async function AdminInboundEmailPage() {
  const supabase = await createServerClient();

  const [enabledRes, replyToRes] = await Promise.all([
    supabase.from('app_settings').select('value').eq('key', 'inbound_email_enabled').single(),
    supabase.from('app_settings').select('value').eq('key', 'inbound_email_reply_to_address').single(),
  ]);

  const enabled = enabledRes.data?.value === 'true';
  const replyToAddress = replyToRes.data?.value ?? '';

  // Fetch auto-reply templates
  const { data: templates } = await supabase
    .from('notification_templates')
    .select('event_type, subject')
    .in('event_type', [
      'auto_reply_unknown_sender',
      'auto_reply_blocked_user',
      'auto_reply_duplicate_ticket',
      'auto_reply_rate_limit',
    ]);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Inbound Email</h1>
      <InboundEmailForm
        enabled={enabled}
        replyToAddress={replyToAddress}
        autoReplyTemplates={templates ?? []}
      />
    </div>
  );
}
