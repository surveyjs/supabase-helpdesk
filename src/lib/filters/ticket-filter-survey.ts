import type { TicketFilterData } from './ticket-filter';
import type { SurveyJsonDefinition } from '@/lib/constants/survey-ui-config';

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

type Choice = { value: string; text: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Deep-clone a JSON-safe value. */
function cloneJson<T>(value: T): T {
  return structuredClone(value);
}

/**
 * Append database-derived choices for a single dynamic-choice question.
 * The template keeps its sentinel rows (e.g. "All", "Unassigned") at the
 * head of `choices`; we append the dynamic options after them. For `tags`
 * the template stores no sentinel and we replace the entire `choices`
 * array.
 */
function injectChoices(
  question: Record<string, unknown>,
  filterOptions: FilterOptions,
): void {
  const name = question.name;
  const baseChoices = Array.isArray(question.choices) ? (question.choices as unknown[]) : [];

  let appended: Choice[] | null = null;

  switch (name) {
    case 'type':
      appended = filterOptions.types.map((item) => ({ value: item.id, text: item.name }));
      break;
    case 'category':
      appended = filterOptions.categories.map((item) => ({ value: item.id, text: item.name }));
      break;
    case 'agent':
      appended = filterOptions.agents.map((agent) => ({
        value: agent.id,
        text: `${agent.display_name ?? 'Agent'} (${agent.email})`,
      }));
      break;
    case 'team':
      appended = filterOptions.teams.map((item) => ({ value: item.id, text: item.name }));
      break;
    case 'tier':
      appended = filterOptions.tiers.map((item) => ({ value: item.key, text: item.display_name }));
      break;
    case 'tags':
      // Tags has no sentinel — replace entirely.
      question.choices = filterOptions.tags.map((tag) => ({ value: tag.id, text: tag.name }));
      return;
    default:
      return;
  }

  question.choices = [...baseChoices, ...appended];
}

/** Walk a SurveyJS template (deep) and apply `visit` to every named element. */
function walkElements(node: unknown, visit: (element: Record<string, unknown>) => void): void {
  if (!isRecord(node)) return;
  if (typeof node.name === 'string') visit(node);
  if (Array.isArray(node.elements)) node.elements.forEach((child) => walkElements(child, visit));
  if (Array.isArray(node.pages)) node.pages.forEach((child) => walkElements(child, visit));
}

/**
 * Take the stored agent-dashboard SurveyJS template and return a copy with
 * dynamic `choices` populated from `filterOptions`. Question names already
 * match SQL filter keys, so no name mapping is performed here.
 */
export function buildTicketFilterSurveyJson(
  filterOptions: FilterOptions,
  template: SurveyJsonDefinition,
): Record<string, unknown> {
  const cloned = cloneJson(template) as Record<string, unknown>;
  walkElements(cloned, (element) => injectChoices(element, filterOptions));
  return cloned;
}

/**
 * Read the `defaultValue` of the `sort` question from the stored template,
 * if present. Used by the server to compute SQL ORDER BY for the initial
 * page load so it matches what SurveyJS will render in the filter UI.
 */
export function getTemplateDefaultSort(template: SurveyJsonDefinition): string | undefined {
  let found: string | undefined;
  walkElements(template, (element) => {
    if (found !== undefined) return;
    if (element.name === 'sort' && typeof element.defaultValue === 'string') {
      found = element.defaultValue;
    }
  });
  return found;
}

/**
 * Coerce a stored TicketFilterData into the shape SurveyJS expects in
 * `survey.data` (e.g. ensures status defaults to all-selected when missing
 * so the checkbox renders all-checked, and tags is an array). `sort` is
 * intentionally omitted when undefined so SurveyJS applies the sort
 * question's `defaultValue` from the template.
 */
export function dataToSurveyData(data: TicketFilterData): Record<string, unknown> {
  const result: Record<string, unknown> = {
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
    tags: data.tags ?? [],
  };
  if (data.sort !== undefined) result.sort = data.sort;
  return result;
}
