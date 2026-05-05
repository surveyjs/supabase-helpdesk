import type { TicketFilterData } from './ticket-filter';
import type { AgentDashboardSurveyConfig } from '@/lib/constants/survey-ui-config';

type SelectOption = { id: string; name: string };
type AgentOption = { id: string; display_name: string | null; email: string };
type TierOption = { key: string; display_name: string };
type TagOption = { id: string; name: string };

export type FilterOptions = {
  categories: SelectOption[];
  types: SelectOption[];
  agents: AgentOption[];
  teams: SelectOption[];
  tags: TagOption[];
  tiers: TierOption[];
};

/**
 * Build the SurveyJS JSON schema used by the Agent Dashboard filter panel.
 * Question names MUST equal the SQL filter / column keys to avoid binding.
 */
export function buildTicketFilterSurveyJson(
  filterOptions: FilterOptions,
  config: AgentDashboardSurveyConfig,
): Record<string, unknown> {
  const definitions: Record<string, Record<string, unknown> | null> = {
    q: config.enabledFilters.q
      ? { type: 'text', name: 'q', title: 'Search', inputType: 'search', placeholder: 'Search title & all posts...' }
      : null,
    email: config.enabledFilters.email
      ? { type: 'text', name: 'email', title: 'Submitter Email', placeholder: 'email@...' }
      : null,
    status: config.enabledFilters.status
      ? {
          type: 'checkbox',
          name: 'status',
          title: 'Status',
          colCount: 0,
          // SurveyJS enforces this in the UI, so it is impossible to submit
          // an empty status set. Empty/undefined therefore unambiguously
          // means "no status predicate" (i.e. all statuses).
          minSelectedChoices: 1,
          choices: [
            { value: 'open', text: 'Active' },
            { value: 'pending', text: 'Pending' },
            { value: 'closed', text: 'Closed' },
          ],
          defaultValue: ['open', 'pending', 'closed'],
        }
      : null,
    sort: config.enabledFilters.sort
      ? {
          type: 'dropdown',
          name: 'sort',
          title: 'Sort By',
          choices: [
            { value: '', text: 'Last Modified' },
            { value: 'created', text: 'Created Date' },
            { value: 'sla', text: 'SLA Risk' },
          ],
        }
      : null,
    urgency: config.enabledFilters.urgency
      ? {
          type: 'dropdown',
          name: 'urgency',
          title: 'Urgency',
          choices: [
            { value: '', text: 'All' },
            { value: 'low', text: 'Low' },
            { value: 'medium', text: 'Medium' },
            { value: 'high', text: 'High' },
            { value: 'critical', text: 'Critical' },
          ],
        }
      : null,
    severity: config.enabledFilters.severity
      ? {
          type: 'dropdown',
          name: 'severity',
          title: 'Severity',
          choices: [
            { value: '', text: 'All' },
            { value: 'low', text: 'Low' },
            { value: 'medium', text: 'Medium' },
            { value: 'high', text: 'High' },
            { value: 'critical', text: 'Critical' },
          ],
        }
      : null,
    type: config.enabledFilters.type
      ? {
          type: 'dropdown',
          name: 'type',
          title: 'Type',
          choices: [
            { value: '', text: 'All' },
            ...filterOptions.types.map((item) => ({ value: item.id, text: item.name })),
          ],
        }
      : null,
    category:
      config.enabledFilters.category && filterOptions.categories.length > 0
        ? {
            type: 'dropdown',
            name: 'category',
            title: 'Category',
            choices: [
              { value: '', text: 'All' },
              ...filterOptions.categories.map((item) => ({ value: item.id, text: item.name })),
            ],
          }
        : null,
    agent: config.enabledFilters.agent
      ? {
          type: 'dropdown',
          name: 'agent',
          title: 'Assigned Agent',
          choices: [
            { value: '', text: 'All' },
            { value: 'unassigned', text: 'Unassigned' },
            ...filterOptions.agents.map((agent) => ({
              value: agent.id,
              text: `${agent.display_name ?? 'Agent'} (${agent.email})`,
            })),
          ],
        }
      : null,
    team: config.enabledFilters.team
      ? {
          type: 'dropdown',
          name: 'team',
          title: 'Team',
          choices: [
            { value: '', text: 'All' },
            { value: 'none', text: 'No team' },
            ...filterOptions.teams.map((item) => ({ value: item.id, text: item.name })),
          ],
        }
      : null,
    tier:
      config.enabledFilters.tier && filterOptions.tiers.length > 0
        ? {
            type: 'dropdown',
            name: 'tier',
            title: 'Tier',
            choices: [
              { value: '', text: 'All' },
              { value: 'none', text: 'No tier' },
              ...filterOptions.tiers.map((item) => ({ value: item.key, text: item.display_name })),
            ],
          }
        : null,
    tags:
      config.enabledFilters.tags && filterOptions.tags.length > 0
        ? {
            type: 'tagbox',
            name: 'tags',
            title: 'Tags',
            choices: filterOptions.tags.map((tag) => ({ value: tag.id, text: tag.name })),
            showSelectAllItem: false,
          }
        : null,
  };

  const groups: Array<Array<keyof typeof definitions>> = [
    ['q'],
    ['email'],
    ['status'],
    ['sort'],
    ['urgency', 'severity'],
    ['type', 'category'],
    ['agent', 'team', 'tier'],
    ['tags'],
  ];

  const elements: Array<Record<string, unknown>> = [];
  for (const group of groups) {
    const present = group
      .map((key) => definitions[key])
      .filter((item): item is Record<string, unknown> => item !== null);
    present.forEach((element, index) => {
      elements.push(index === 0 ? element : { ...element, startWithNewLine: false });
    });
  }

  return {
    showQuestionNumbers: 'off',
    completeText: 'Apply Filters',
    pages: [{ name: 'filters', elements }],
  };
}

/**
 * Coerce a stored TicketFilterData into the shape SurveyJS expects in
 * `survey.data` (e.g. ensures status defaults to all-selected when missing
 * so the checkbox renders all-checked, and tags is an array).
 */
export function dataToSurveyData(data: TicketFilterData, defaultSort: string): Record<string, unknown> {
  return {
    q: data.q ?? '',
    email: data.email ?? '',
    status: data.status ?? ['open', 'pending', 'closed'],
    urgency: data.urgency ?? '',
    severity: data.severity ?? '',
    category: data.category ?? '',
    type: data.type ?? '',
    agent: data.agent ?? '',
    team: data.team ?? '',
    tier: data.tier ?? '',
    sort: data.sort ?? defaultSort,
    tags: data.tags ?? [],
  };
}
