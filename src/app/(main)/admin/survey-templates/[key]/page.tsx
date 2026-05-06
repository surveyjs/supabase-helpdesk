import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createServerClient } from '@/lib/supabase/server';
import {
  DEFAULT_TICKET_DETAIL_AGENT_TEMPLATE,
  DEFAULT_TICKET_DETAIL_USER_TEMPLATE,
  parseTicketDetailAgentTemplate,
  parseTicketDetailUserTemplate,
} from '@/lib/constants/survey-ui-config';
import { SurveyTemplateEditor } from '@/components/features/survey/SurveyTemplateEditor';

const TITLES = {
  survey_ticket_detail_agent_template: 'Ticket Detail (Agent)',
  survey_ticket_detail_user_template: 'Ticket Detail (User)',
} as const;

type Key = keyof typeof TITLES;

function isKey(k: string): k is Key {
  return k in TITLES;
}

export default async function AdminSurveyTemplateEditPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  if (!isKey(key)) notFound();

  const supabase = await createServerClient();
  const { data: row } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();

  const raw = (row?.value as string | null) ?? null;
  const wrapper =
    key === 'survey_ticket_detail_agent_template'
      ? parseTicketDetailAgentTemplate(raw)
      : parseTicketDetailUserTemplate(raw);
  const fallback =
    key === 'survey_ticket_detail_agent_template'
      ? DEFAULT_TICKET_DETAIL_AGENT_TEMPLATE
      : DEFAULT_TICKET_DETAIL_USER_TEMPLATE;

  const initialJson = JSON.stringify(raw ? wrapper : fallback, null, 2);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/survey-templates"
          className="text-sm text-blue-600 hover:text-blue-800"
        >
          ← Back to Survey Templates
        </Link>
        <h1 className="text-2xl font-semibold text-gray-900 mt-2">{TITLES[key]}</h1>
        <p className="text-sm text-gray-600">
          Edit the SurveyJS template JSON. Question <code>name</code> values must
          match Supabase ticket columns (status, urgency, severity, type_id,
          category_id, assigned_agent_id, is_private, tag_ids, is_following).
        </p>
      </div>

      <SurveyTemplateEditor
        settingKey={key}
        title={TITLES[key]}
        initialJson={initialJson}
      />
    </div>
  );
}
