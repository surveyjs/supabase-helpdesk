import Link from 'next/link';
import { createServerClient } from '@/lib/supabase/server';

const TEMPLATE_KEYS: Array<{ key: string; label: string; description: string }> = [
  {
    key: 'survey_ticket_detail_agent_template',
    label: 'Ticket Detail (Agent)',
    description: 'Sidebar form shown to agents on the ticket detail page.',
  },
  {
    key: 'survey_ticket_detail_user_template',
    label: 'Ticket Detail (User)',
    description: 'Sidebar form shown to non-agent users on the ticket detail page.',
  },
];

export default async function AdminSurveyTemplatesPage() {
  const supabase = await createServerClient();
  const { data: rows } = await supabase
    .from('app_settings')
    .select('key, value')
    .in(
      'key',
      TEMPLATE_KEYS.map((t) => t.key),
    );

  const stored = new Map((rows ?? []).map((r) => [r.key as string, r.value as string | null]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 mb-2">Survey Templates</h1>
        <p className="text-sm text-gray-600">
          SurveyJS JSON templates that drive the Ticket Detail editable sidebar.
          Edit the raw JSON for each role-specific template.
        </p>
      </div>

      <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
        {TEMPLATE_KEYS.map((t) => {
          const has = stored.has(t.key);
          return (
            <li key={t.key} className="p-4 flex items-center justify-between gap-4" data-testid={`survey-template-row-${t.key}`}>
              <div>
                <Link
                  href={`/admin/survey-templates/${t.key}`}
                  className="text-blue-600 hover:text-blue-800 font-medium"
                >
                  {t.label}
                </Link>
                <p className="text-xs text-gray-500 mt-0.5">{t.description}</p>
              </div>
              <span className="text-xs text-gray-500">
                {has ? 'Custom' : 'Default'}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
