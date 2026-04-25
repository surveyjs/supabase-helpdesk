import { createServerClient } from '@/lib/supabase/server';
import 'survey-core/survey-core.min.css';
import { AdminRateLimitSurveyForm } from './AdminRateLimitSurveyForm';

export default async function AdminRateLimitPage() {
  const supabase = await createServerClient();

  const { data: setting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'ticket_creation_rate_limit')
    .single();

  const currentLimit = setting?.value ?? '10';

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Rate Limit</h1>
      <AdminRateLimitSurveyForm currentLimit={parseInt(currentLimit, 10) || 10} />
    </div>
  );
}
