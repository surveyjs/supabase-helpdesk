import Link from 'next/link';
import { createServerClient } from '@/lib/supabase/server';
import {
  DEFAULT_TICKET_DETAIL_AGENT_TEMPLATE,
  DEFAULT_TICKET_DETAIL_USER_TEMPLATE,
  parseTicketDetailAgentTemplate,
  parseTicketDetailUserTemplate,
  type TicketDetailTemplateWrapper,
} from '@/lib/constants/survey-ui-config';

const TEMPLATE_KEYS: Array<{
  key: string;
  label: string;
  description: string;
  defaultWrapper: TicketDetailTemplateWrapper;
  parse: (raw: string | null) => TicketDetailTemplateWrapper;
}> = [
  {
    key: 'survey_ticket_detail_agent_template',
    label: 'Ticket Detail (Agent)',
    description: 'Sidebar form shown to agents on the ticket detail page.',
    defaultWrapper: DEFAULT_TICKET_DETAIL_AGENT_TEMPLATE,
    parse: parseTicketDetailAgentTemplate,
  },
  {
    key: 'survey_ticket_detail_user_template',
    label: 'Ticket Detail (User)',
    description: 'Sidebar form shown to non-agent users on the ticket detail page.',
    defaultWrapper: DEFAULT_TICKET_DETAIL_USER_TEMPLATE,
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

function isDefaultWrapper(
  raw: string | null,
  parse: (raw: string | null) => TicketDetailTemplateWrapper,
  defaultWrapper: TicketDetailTemplateWrapper,
): boolean {
  // No row → falls back to default at runtime.
  if (raw === null) return true;
  const parsed = parse(raw);
  return stableStringify(parsed) === stableStringify(defaultWrapper);
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
          SurveyJS JSON templates that drive the Ticket Detail editable sidebar.
          Edit the raw JSON for each role-specific template.
        </p>
      </div>

      <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
        {TEMPLATE_KEYS.map((t) => {
          const raw = stored.has(t.key) ? stored.get(t.key) ?? null : null;
          const isDefault = isDefaultWrapper(raw, t.parse, t.defaultWrapper);
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
