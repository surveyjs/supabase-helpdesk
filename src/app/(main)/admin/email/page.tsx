import 'survey-core/survey-core.min.css';
import { createServerClient } from '@/lib/supabase/server';
import { EmailConfigForm } from './EmailConfigForm';

export default async function AdminEmailPage() {
  const supabase = await createServerClient();

  const { data: config } = await supabase
    .from('email_config')
    .select('*')
    .limit(1)
    .single();

  const { data: coalescingSetting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'notification_coalescing_delay_minutes')
    .single();

  const coalescingDelay = coalescingSetting ? parseInt(coalescingSetting.value, 10) : 2;

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Email Configuration</h1>

      <EmailConfigForm
        config={config ? {
          smtp_host: config.smtp_host,
          smtp_port: config.smtp_port,
          smtp_username: config.smtp_username,
          smtp_password: config.smtp_password,
          sender_email: config.sender_email,
          sender_name: config.sender_name,
          is_verified: config.is_verified,
        } : null}
        coalescingDelay={coalescingDelay}
      />
    </div>
  );
}
