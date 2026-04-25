'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SurveyJsonForm } from '@/components/features/survey/SurveyJsonForm';
import type { AgentTicketFilters } from '@/lib/queries/agent-dashboard';
import type { AgentDashboardSurveyConfig } from '@/lib/constants/survey-ui-config';

type SelectOption = { id: string; name: string };
type AgentOption = { id: string; display_name: string | null; email: string };
type TierOption = { key: string; display_name: string };
type TagOption = { id: string; name: string };

type FilterOptions = {
  categories: SelectOption[];
  types: SelectOption[];
  agents: AgentOption[];
  teams: SelectOption[];
  tags: TagOption[];
  tiers: TierOption[];
};

type AgentFiltersSurveyProps = {
  filters: AgentTicketFilters;
  filterOptions: FilterOptions;
  config: AgentDashboardSurveyConfig;
};

function nonEmpty(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim();
}

export function AgentFiltersSurvey({ filters, filterOptions, config }: AgentFiltersSurveyProps) {
  const router = useRouter();

  const schema = useMemo(() => {
    const elements: Array<Record<string, unknown>> = [];

    if (config.enabledFilters.q) {
      elements.push({ type: 'text', name: 'q', title: 'Search', inputType: 'search', placeholder: 'Search title & all posts...' });
    }
    if (config.enabledFilters.email) {
      elements.push({ type: 'text', name: 'email', title: 'Submitter Email', placeholder: 'email@...' });
    }
    if (config.enabledFilters.status) {
      elements.push({
        type: 'dropdown',
        name: 'status',
        title: 'Status',
        choices: [
          { value: 'all', text: 'All' },
          { value: 'active', text: 'Active' },
          { value: 'closed', text: 'Closed' },
        ],
      });
    }
    if (config.enabledFilters.sort) {
      elements.push({
        type: 'dropdown',
        name: 'sort',
        title: 'Sort By',
        choices: [
          { value: '', text: 'Last Modified' },
          { value: 'created', text: 'Created Date' },
          { value: 'sla', text: 'SLA Risk' },
        ],
      });
    }
    if (config.enabledFilters.urgency) {
      elements.push({
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
      });
    }
    if (config.enabledFilters.severity) {
      elements.push({
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
      });
    }
    if (config.enabledFilters.type) {
      elements.push({
        type: 'dropdown',
        name: 'type',
        title: 'Type',
        choices: [
          { value: '', text: 'All' },
          ...filterOptions.types.map((item) => ({ value: item.id, text: item.name })),
        ],
      });
    }
    if (config.enabledFilters.category && filterOptions.categories.length > 0) {
      elements.push({
        type: 'dropdown',
        name: 'category',
        title: 'Category',
        choices: [
          { value: '', text: 'All' },
          ...filterOptions.categories.map((item) => ({ value: item.id, text: item.name })),
        ],
      });
    }
    if (config.enabledFilters.agent) {
      elements.push({
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
      });
    }
    if (config.enabledFilters.team) {
      elements.push({
        type: 'dropdown',
        name: 'team',
        title: 'Team',
        choices: [
          { value: '', text: 'All' },
          { value: 'none', text: 'No team' },
          ...filterOptions.teams.map((item) => ({ value: item.id, text: item.name })),
        ],
      });
    }
    if (config.enabledFilters.tier && filterOptions.tiers.length > 0) {
      elements.push({
        type: 'dropdown',
        name: 'tier',
        title: 'Tier',
        choices: [
          { value: '', text: 'All' },
          { value: 'none', text: 'No tier' },
          ...filterOptions.tiers.map((item) => ({ value: item.key, text: item.display_name })),
        ],
      });
    }
    if (config.enabledFilters.tags && filterOptions.tags.length > 0) {
      elements.push({
        type: 'tagbox',
        name: 'tags',
        title: 'Tags',
        choices: filterOptions.tags.map((tag) => ({ value: tag.id, text: tag.name })),
        showSelectAllItem: false,
      });
    }

    return {
      showQuestionNumbers: 'off',
      completeText: 'Apply Filters',
      pages: [{ name: 'filters', elements }],
    };
  }, [config, filterOptions]);

  const initialData = useMemo(() => {
    const initialTags = nonEmpty(filters.tags)
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    return {
      q: nonEmpty(filters.q),
      email: nonEmpty(filters.email),
      status: nonEmpty(filters.status) || 'all',
      urgency: nonEmpty(filters.urgency),
      severity: nonEmpty(filters.severity),
      category: nonEmpty(filters.category),
      type: nonEmpty(filters.type),
      agent: nonEmpty(filters.agent),
      team: nonEmpty(filters.team),
      tier: nonEmpty(filters.tier),
      sort: nonEmpty(filters.sort) || config.defaultSort,
      tags: initialTags,
    };
  }, [config.defaultSort, filters]);

  const onComplete = (data: Record<string, unknown>) => {
    const params = new URLSearchParams();

    const textFields = ['q', 'email', 'urgency', 'severity', 'category', 'type', 'agent', 'team', 'tier'] as const;
    for (const key of textFields) {
      const value = nonEmpty(data[key]);
      if (value) params.set(key, value);
    }

    const status = nonEmpty(data.status) || 'all';
    if (status !== 'all') params.set('status', status);

    const sort = nonEmpty(data.sort);
    if (sort) params.set('sort', sort);

    if (Array.isArray(data.tags)) {
      const tags = data.tags.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
      if (tags.length > 0) {
        params.set('tags', tags.join(','));
      }
    }

    router.push(params.size > 0 ? `/agent?${params.toString()}` : '/agent');
  };

  return (
    <div data-testid="agent-filter-survey">
      <SurveyJsonForm schema={schema} data={initialData} onComplete={onComplete} />
      <div className="mt-2">
        <Link href="/agent" className="px-4 py-1.5 text-sm text-gray-600 hover:text-gray-800 inline-flex items-center">
          Clear All
        </Link>
      </div>
    </div>
  );
}
