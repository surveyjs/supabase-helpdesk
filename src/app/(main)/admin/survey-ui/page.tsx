import { createServerClient } from '@/lib/supabase/server';
import 'survey-core/survey-core.min.css';
import {
  DEFAULT_AGENT_DASHBOARD_SURVEY_CONFIG,
  DEFAULT_TICKET_DETAIL_AGENT_CONFIG,
  DEFAULT_TICKET_DETAIL_USER_CONFIG,
  parseAgentDashboardSurveyConfig,
  parseTicketDetailAgentConfig,
  parseTicketDetailUserConfig,
} from '@/lib/constants/survey-ui-config';
import { resetSurveyUiConfig, updateSurveyUiConfig } from '@/lib/actions/admin';
import { SurveyUiConfigEditor } from './SurveyUiConfigEditor';

function flatten(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flatten(v as Record<string, unknown>, key));
    } else if (Array.isArray(v)) {
      out[key] = v.join(', ');
    } else {
      out[key] = v;
    }
  }
  return out;
}

const AGENT_DASHBOARD_SCHEMA = {
  pages: [
    {
      name: 'agent-dashboard',
      elements: [
        {
          type: 'panel',
          title: 'Enabled filters on Agent Dashboard',
          elements: [
            { type: 'boolean', name: 'enabledFilters.q', title: 'Search text' },
            { type: 'boolean', name: 'enabledFilters.email', title: 'Submitter email' },
            { type: 'boolean', name: 'enabledFilters.status', title: 'Status' },
            { type: 'boolean', name: 'enabledFilters.sort', title: 'Sort' },
            { type: 'boolean', name: 'enabledFilters.urgency', title: 'Urgency' },
            { type: 'boolean', name: 'enabledFilters.severity', title: 'Severity' },
            { type: 'boolean', name: 'enabledFilters.type', title: 'Type' },
            { type: 'boolean', name: 'enabledFilters.category', title: 'Category' },
            { type: 'boolean', name: 'enabledFilters.agent', title: 'Assigned agent' },
            { type: 'boolean', name: 'enabledFilters.team', title: 'Team' },
            { type: 'boolean', name: 'enabledFilters.tier', title: 'Tier' },
            { type: 'boolean', name: 'enabledFilters.tags', title: 'Tags' },
          ],
        },
        {
          type: 'dropdown',
          name: 'defaultSort',
          title: 'Default sort',
          choices: [
            { value: '', text: 'Last modified' },
            { value: 'created', text: 'Created date' },
            { value: 'sla', text: 'SLA risk' },
          ],
        },
      ],
    },
  ],
};

const DETAIL_AGENT_SCHEMA = {
  pages: [
    {
      elements: [
        {
          type: 'panel',
          title: 'Ticket detail fields visible for agents',
          elements: [
            { type: 'boolean', name: 'fields.status', title: 'Status' },
            { type: 'boolean', name: 'fields.urgency', title: 'Urgency' },
            { type: 'boolean', name: 'fields.severity', title: 'Severity' },
            { type: 'boolean', name: 'fields.type', title: 'Type' },
            { type: 'boolean', name: 'fields.category', title: 'Category' },
            { type: 'boolean', name: 'fields.assigned', title: 'Assigned' },
            { type: 'boolean', name: 'fields.createdBy', title: 'Created by' },
            { type: 'boolean', name: 'fields.createdAt', title: 'Created date' },
            { type: 'boolean', name: 'fields.updatedAt', title: 'Updated date' },
            { type: 'boolean', name: 'fields.visibility', title: 'Visibility' },
            { type: 'boolean', name: 'fields.tags', title: 'Tags' },
            { type: 'boolean', name: 'fields.customFields', title: 'Custom fields' },
            { type: 'boolean', name: 'fields.follow', title: 'Follow section' },
          ],
        },
      ],
    },
  ],
};

const DETAIL_USER_SCHEMA = {
  pages: [
    {
      elements: [
        {
          type: 'panel',
          title: 'Ticket detail fields visible for users',
          elements: [
            { type: 'boolean', name: 'fields.status', title: 'Status' },
            { type: 'boolean', name: 'fields.urgency', title: 'Urgency' },
            { type: 'boolean', name: 'fields.severity', title: 'Severity' },
            { type: 'boolean', name: 'fields.type', title: 'Type' },
            { type: 'boolean', name: 'fields.category', title: 'Category' },
            { type: 'boolean', name: 'fields.assigned', title: 'Assigned' },
            { type: 'boolean', name: 'fields.createdBy', title: 'Created by' },
            { type: 'boolean', name: 'fields.createdAt', title: 'Created date' },
            { type: 'boolean', name: 'fields.updatedAt', title: 'Updated date' },
            { type: 'boolean', name: 'fields.visibility', title: 'Visibility' },
            { type: 'boolean', name: 'fields.tags', title: 'Tags' },
            { type: 'boolean', name: 'fields.customFields', title: 'Custom fields' },
            { type: 'boolean', name: 'fields.follow', title: 'Follow section' },
          ],
        },
        {
          type: 'panel',
          title: 'Tier-based control rules (comma-separated tier keys, blank = all tiers)',
          elements: [
            { type: 'text', name: 'tierControlRules.statusAllowedTiers', title: 'Status control allowed tiers' },
            { type: 'text', name: 'tierControlRules.severityAllowedTiers', title: 'Severity control allowed tiers' },
            { type: 'text', name: 'tierControlRules.typeAllowedTiers', title: 'Type control allowed tiers' },
            { type: 'text', name: 'tierControlRules.tagsAllowedTiers', title: 'Tag control allowed tiers' },
            { type: 'text', name: 'tierControlRules.visibilityAllowedTiers', title: 'Visibility control allowed tiers' },
          ],
        },
      ],
    },
  ],
};

export default async function AdminSurveyUiPage() {
  const supabase = await createServerClient();
  const keys = [
    'survey_agent_dashboard_config',
    'survey_ticket_detail_agent_config',
    'survey_ticket_detail_user_config',
  ];

  const { data: rows } = await supabase
    .from('app_settings')
    .select('key, value')
    .in('key', keys);

  const values = new Map((rows ?? []).map((row) => [row.key, row.value]));

  const dashboardConfig = parseAgentDashboardSurveyConfig(values.get('survey_agent_dashboard_config'));
  const detailAgentConfig = parseTicketDetailAgentConfig(values.get('survey_ticket_detail_agent_config'));
  const detailUserConfig = parseTicketDetailUserConfig(values.get('survey_ticket_detail_user_config'));

  const dashboardEditorData = flatten(dashboardConfig);
  const detailAgentEditorData = flatten(detailAgentConfig);
  const detailUserEditorData = flatten(detailUserConfig);

  const userSchemaDefault = {
    ...DETAIL_USER_SCHEMA,
    pages: DETAIL_USER_SCHEMA.pages,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 mb-2">Survey UI JSON Config</h1>
        <p className="text-sm text-gray-600">
          These three JSON configurations are used by SurveyJS forms on the agent dashboard and ticket detail pages.
        </p>
      </div>

      <SurveyUiConfigEditor
        title="Agent Dashboard"
        settingKey="survey_agent_dashboard_config"
        initialData={dashboardEditorData ?? DEFAULT_AGENT_DASHBOARD_SURVEY_CONFIG}
        schema={AGENT_DASHBOARD_SCHEMA}
        saveAction={updateSurveyUiConfig}
        resetAction={resetSurveyUiConfig}
      />

      <SurveyUiConfigEditor
        title="Detail Ticket Info for Agent"
        settingKey="survey_ticket_detail_agent_config"
        initialData={detailAgentEditorData ?? DEFAULT_TICKET_DETAIL_AGENT_CONFIG}
        schema={DETAIL_AGENT_SCHEMA}
        saveAction={updateSurveyUiConfig}
        resetAction={resetSurveyUiConfig}
      />

      <SurveyUiConfigEditor
        title="Detail Ticket Info for User"
        settingKey="survey_ticket_detail_user_config"
        initialData={detailUserEditorData ?? DEFAULT_TICKET_DETAIL_USER_CONFIG}
        schema={userSchemaDefault}
        saveAction={updateSurveyUiConfig}
        resetAction={resetSurveyUiConfig}
      />
    </div>
  );
}
