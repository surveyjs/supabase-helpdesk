import { createServerClient } from '@/lib/supabase/server';
import Link from 'next/link';
import 'survey-core/survey-core.min.css';
import {
  DEFAULT_AGENT_DASHBOARD_SURVEY_CONFIG,
  parseAgentDashboardSurveyConfig,
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

export default async function AdminSurveyUiPage() {
  const supabase = await createServerClient();

  const { data: rows } = await supabase
    .from('app_settings')
    .select('key, value')
    .in('key', ['survey_agent_dashboard_config']);

  const values = new Map((rows ?? []).map((row) => [row.key, row.value]));

  const dashboardConfig = parseAgentDashboardSurveyConfig(values.get('survey_agent_dashboard_config'));
  const dashboardEditorData = flatten(dashboardConfig);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 mb-2">Survey UI JSON Config</h1>
        <p className="text-sm text-gray-600">
          Agent dashboard SurveyJS configuration. Ticket-detail templates have moved
          to{' '}
          <Link className="text-blue-600 hover:text-blue-800" href="/admin/survey-templates">
            Survey Templates
          </Link>
          .
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
    </div>
  );
}
