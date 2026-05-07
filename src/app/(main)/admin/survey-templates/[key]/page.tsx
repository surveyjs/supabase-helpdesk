import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createServerClient } from '@/lib/supabase/server';
import {
  DEFAULT_AGENT_DASHBOARD_TEMPLATE,
  DEFAULT_TICKET_DETAIL_AGENT_TEMPLATE,
  DEFAULT_TICKET_DETAIL_USER_TEMPLATE,
  parseAgentDashboardTemplate,
  parseTicketDetailAgentTemplate,
  parseTicketDetailUserTemplate,
} from '@/lib/constants/survey-ui-config';
import { SurveyTemplateEditor } from '@/components/features/survey/SurveyTemplateEditor';

const TITLES = {
  survey_agent_dashboard_template: 'Agent Dashboard Filters',
  survey_ticket_detail_agent_template: 'Ticket Detail (Agent)',
  survey_ticket_detail_user_template: 'Ticket Detail (User)',
} as const;

const FIELD_HINTS: Record<keyof typeof TITLES, string> = {
  survey_agent_dashboard_template:
    'Question name values must match the SQL filter / column keys: q, email, status, sort, urgency, severity, type, category, agent, team, tier, tags.',
  survey_ticket_detail_agent_template:
    'Question name values must match Supabase ticket columns (status, urgency, severity, type_id, category_id, assigned_agent_id, is_private, tag_ids, is_following).',
  survey_ticket_detail_user_template:
    'Question name values must match Supabase ticket columns (status, urgency, severity, type_id, category_id, assigned_agent_id, is_private, tag_ids, is_following).',
};

type Key = keyof typeof TITLES;

function isKey(k: string): k is Key {
  return k in TITLES;
}

function loadInitialJson(key: Key, raw: string | null): string {
  switch (key) {
    case 'survey_agent_dashboard_template': {
      const parsed = raw ? parseAgentDashboardTemplate(raw) : DEFAULT_AGENT_DASHBOARD_TEMPLATE;
      return JSON.stringify(parsed, null, 2);
    }
    case 'survey_ticket_detail_agent_template': {
      const parsed = raw ? parseTicketDetailAgentTemplate(raw) : DEFAULT_TICKET_DETAIL_AGENT_TEMPLATE;
      return JSON.stringify(parsed, null, 2);
    }
    case 'survey_ticket_detail_user_template': {
      const parsed = raw ? parseTicketDetailUserTemplate(raw) : DEFAULT_TICKET_DETAIL_USER_TEMPLATE;
      return JSON.stringify(parsed, null, 2);
    }
  }
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
  const initialJson = loadInitialJson(key, raw);

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
          Edit the SurveyJS template JSON. {FIELD_HINTS[key]}
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
