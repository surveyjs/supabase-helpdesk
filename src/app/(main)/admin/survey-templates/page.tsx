import Link from 'next/link';
import { createServerClient } from '@/lib/supabase/server';
import {
  DEFAULT_AGENT_DASHBOARD_TEMPLATE,
  DEFAULT_TICKET_DETAIL_AGENT_TEMPLATE,
  DEFAULT_TICKET_DETAIL_USER_TEMPLATE,
  parseAgentDashboardTemplate,
  parseTicketDetailAgentTemplate,
  parseTicketDetailUserTemplate,
  type SurveyJsonDefinition,
  type TicketDetailTemplateWrapper,
} from '@/lib/constants/survey-ui-config';

type TemplateEntry =
  | {
      key: 'survey_ticket_detail_agent_template' | 'survey_ticket_detail_user_template';
      label: string;
      description: string;
      kind: 'ticket-detail';
      defaultValue: TicketDetailTemplateWrapper;
      parse: (raw: string | null) => TicketDetailTemplateWrapper;
    }
  | {
      key: 'survey_agent_dashboard_template';
      label: string;
      description: string;
      kind: 'agent-dashboard';
      defaultValue: SurveyJsonDefinition;
      parse: (raw: string | null) => SurveyJsonDefinition;
    };

const TEMPLATE_KEYS: TemplateEntry[] = [
  {
    key: 'survey_agent_dashboard_template',
    label: 'Agent Dashboard Filters',
    description: 'SurveyJS form rendered in the Agent Dashboard "Views & Filters" panel.',
    kind: 'agent-dashboard',
    defaultValue: DEFAULT_AGENT_DASHBOARD_TEMPLATE,
    parse: parseAgentDashboardTemplate,
  },
  {
    key: 'survey_ticket_detail_agent_template',
    label: 'Ticket Detail (Agent)',
    description: 'Sidebar form shown to agents on the ticket detail page.',
    kind: 'ticket-detail',
    defaultValue: DEFAULT_TICKET_DETAIL_AGENT_TEMPLATE,
    parse: parseTicketDetailAgentTemplate,
  },
  {
    key: 'survey_ticket_detail_user_template',
    label: 'Ticket Detail (User)',
    description: 'Sidebar form shown to non-agent users on the ticket detail page.',
    kind: 'ticket-detail',
    defaultValue: DEFAULT_TICKET_DETAIL_USER_TEMPLATE,
    parse: parseTicketDetailUserTemplate,
  },
];

// Stable JSON serializer that sorts object keys so semantically equal
// wrappers (regardless of property order) compare equal.
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

function isDefaultEntry(
  entry: TemplateEntry,
  raw: string | null,
): boolean {
  if (raw === null) return true;
  const parsed = entry.parse(raw);
  return stableStringify(parsed) === stableStringify(entry.defaultValue);
}

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
          SurveyJS JSON templates that drive the Agent Dashboard filter form
          and the Ticket Detail editable sidebar. Edit the raw JSON for each
          template.
        </p>
      </div>

      <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
        {TEMPLATE_KEYS.map((t) => {
          const raw = stored.has(t.key) ? stored.get(t.key) ?? null : null;
          const isDefault = isDefaultEntry(t, raw);
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
                {isDefault ? 'Default' : 'Custom'}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
