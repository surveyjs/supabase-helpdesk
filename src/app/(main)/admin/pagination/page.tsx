import { createServerClient } from '@/lib/supabase/server';
import 'survey-core/survey-core.min.css';
import { AdminPaginationSurveyForm } from './AdminPaginationSurveyForm';

export default async function AdminPaginationPage() {
  const supabase = await createServerClient();

  const keys = [
    'user_page_size',
    'agent_dashboard_page_size',
    'other_lists_page_size',
    'visible_posts_threshold',
    'visible_comments_threshold',
  ];

  const { data: settings } = await supabase
    .from('app_settings')
    .select('key, value')
    .in('key', keys);

  const settingsMap: Record<string, string> = {};
  for (const s of settings ?? []) {
    settingsMap[s.key] = s.value;
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Pagination Settings</h1>
      <AdminPaginationSurveyForm
        values={{
          user_page_size: parseInt(settingsMap.user_page_size ?? '20', 10) || 20,
          agent_dashboard_page_size: parseInt(settingsMap.agent_dashboard_page_size ?? '20', 10) || 20,
          other_lists_page_size: parseInt(settingsMap.other_lists_page_size ?? '20', 10) || 20,
          visible_posts_threshold: parseInt(settingsMap.visible_posts_threshold ?? '10', 10) || 10,
          visible_comments_threshold: parseInt(settingsMap.visible_comments_threshold ?? '3', 10) || 3,
        }}
      />
    </div>
  );
}
