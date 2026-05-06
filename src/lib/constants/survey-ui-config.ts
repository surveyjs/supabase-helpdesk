import agentTemplateJson from '@/components/features/survey/form-json/admin/ticket-detail-agent-template.json';
import userTemplateJson from '@/components/features/survey/form-json/admin/ticket-detail-user-template.json';
import agentDashboardTemplateJson from '@/components/features/survey/form-json/admin/agent-dashboard-template.json';

/**
 * Allowed SurveyJS question `name` values for ticket-detail templates.
 * Each name equals a Supabase column on `public.tickets` or a canonical
 * relationship name (`tag_ids`, `is_following`). No mapping layer.
 */
export const TICKET_DETAIL_ALLOWED_QUESTION_NAMES = [
  'status',
  'urgency',
  'severity',
  'type_id',
  'category_id',
  'assigned_agent_id',
  'is_private',
  'tag_ids',
  'is_following',
] as const;

export type TicketDetailQuestionName =
  (typeof TICKET_DETAIL_ALLOWED_QUESTION_NAMES)[number];

export type SurveyJsonDefinition = Record<string, unknown>;

export type TicketDetailTierControlRules = {
  statusAllowedTiers: string[];
  severityAllowedTiers: string[];
  typeAllowedTiers: string[];
  tagsAllowedTiers: string[];
  visibilityAllowedTiers: string[];
};

export type TicketDetailTemplateWrapper = {
  template: SurveyJsonDefinition;
  tierControlRules: TicketDetailTierControlRules;
};

/**
 * Allowed SurveyJS question `name` values for the agent dashboard filter
 * template. Each name equals the SQL filter / column key consumed by
 * `generateSqlFromJson`. No mapping layer.
 */
export const AGENT_DASHBOARD_ALLOWED_QUESTION_NAMES = [
  'q',
  'email',
  'status',
  'sort',
  'urgency',
  'severity',
  'type',
  'category',
  'agent',
  'team',
  'tier',
  'tags',
] as const;

export type AgentDashboardQuestionName =
  (typeof AGENT_DASHBOARD_ALLOWED_QUESTION_NAMES)[number];

export const DEFAULT_AGENT_DASHBOARD_TEMPLATE: SurveyJsonDefinition =
  agentDashboardTemplateJson as SurveyJsonDefinition;

export const DEFAULT_TICKET_DETAIL_TIER_CONTROL_RULES: TicketDetailTierControlRules = {
  statusAllowedTiers: [],
  severityAllowedTiers: [],
  typeAllowedTiers: [],
  tagsAllowedTiers: [],
  visibilityAllowedTiers: [],
};

export const DEFAULT_TICKET_DETAIL_AGENT_TEMPLATE: TicketDetailTemplateWrapper = {
  template: agentTemplateJson as SurveyJsonDefinition,
  tierControlRules: { ...DEFAULT_TICKET_DETAIL_TIER_CONTROL_RULES },
};

export const DEFAULT_TICKET_DETAIL_USER_TEMPLATE: TicketDetailTemplateWrapper = {
  template: userTemplateJson as SurveyJsonDefinition,
  tierControlRules: { ...DEFAULT_TICKET_DETAIL_TIER_CONTROL_RULES },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

/**
 * Parse the stored `survey_agent_dashboard_template` value into a SurveyJS
 * JSON object. Falls back to the bundled default if the row is missing,
 * empty, or unparseable.
 */
export function parseAgentDashboardTemplate(raw: string | null | undefined): SurveyJsonDefinition {
  if (!raw) return DEFAULT_AGENT_DASHBOARD_TEMPLATE;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return DEFAULT_AGENT_DASHBOARD_TEMPLATE;
    return parsed as SurveyJsonDefinition;
  } catch {
    return DEFAULT_AGENT_DASHBOARD_TEMPLATE;
  }
}

/**
 * Validate that every named element in an agent-dashboard template uses an
 * allowed name. Returns the list of offending names (empty when valid).
 */
export function findInvalidAgentDashboardQuestionNames(template: unknown): string[] {
  const allowed = new Set<string>(AGENT_DASHBOARD_ALLOWED_QUESTION_NAMES);
  return collectQuestionNames(template).filter((name) => !allowed.has(name));
}

function parseTierControlRules(raw: unknown): TicketDetailTierControlRules {
  if (!isRecord(raw)) return { ...DEFAULT_TICKET_DETAIL_TIER_CONTROL_RULES };
  return {
    statusAllowedTiers: asStringArray(raw.statusAllowedTiers),
    severityAllowedTiers: asStringArray(raw.severityAllowedTiers),
    typeAllowedTiers: asStringArray(raw.typeAllowedTiers),
    tagsAllowedTiers: asStringArray(raw.tagsAllowedTiers),
    visibilityAllowedTiers: asStringArray(raw.visibilityAllowedTiers),
  };
}

function parseTemplateWrapper(
  raw: string | null | undefined,
  fallback: TicketDetailTemplateWrapper,
): TicketDetailTemplateWrapper {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return fallback;
    const template = isRecord(parsed.template) ? (parsed.template as SurveyJsonDefinition) : fallback.template;
    const tierControlRules = parseTierControlRules(parsed.tierControlRules);
    return { template, tierControlRules };
  } catch {
    return fallback;
  }
}

export function parseTicketDetailAgentTemplate(raw: string | null | undefined): TicketDetailTemplateWrapper {
  return parseTemplateWrapper(raw, DEFAULT_TICKET_DETAIL_AGENT_TEMPLATE);
}

export function parseTicketDetailUserTemplate(raw: string | null | undefined): TicketDetailTemplateWrapper {
  return parseTemplateWrapper(raw, DEFAULT_TICKET_DETAIL_USER_TEMPLATE);
}

export function canTierUseControl(allowedTiers: string[], tierKey: string | null): boolean {
  if (allowedTiers.length === 0) return true;
  if (!tierKey) return false;
  return allowedTiers.includes(tierKey);
}

/**
 * Walk a SurveyJS template (deep) and collect every element `name`.
 */
export function collectQuestionNames(template: unknown): string[] {
  const names: string[] = [];
  function walk(node: unknown) {
    if (!isRecord(node)) return;
    if (typeof node.name === 'string') names.push(node.name);
    if (Array.isArray(node.elements)) node.elements.forEach(walk);
    if (Array.isArray(node.pages)) node.pages.forEach(walk);
  }
  walk(template);
  return names;
}

/**
 * Validate that every named element in a ticket-detail template uses an
 * allowed name. Returns the list of offending names (empty when valid).
 */
export function findInvalidTicketDetailQuestionNames(template: unknown): string[] {
  const allowed = new Set<string>(TICKET_DETAIL_ALLOWED_QUESTION_NAMES);
  return collectQuestionNames(template).filter((name) => !allowed.has(name));
}
