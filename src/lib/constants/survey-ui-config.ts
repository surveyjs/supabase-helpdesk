export type AgentDashboardSurveyConfig = {
  enabledFilters: {
    q: boolean;
    email: boolean;
    status: boolean;
    sort: boolean;
    urgency: boolean;
    severity: boolean;
    type: boolean;
    category: boolean;
    agent: boolean;
    team: boolean;
    tier: boolean;
    tags: boolean;
  };
  defaultSort: '' | 'created' | 'sla';
};

export type TicketDetailSectionConfig = {
  fields: {
    status: boolean;
    urgency: boolean;
    severity: boolean;
    type: boolean;
    category: boolean;
    assigned: boolean;
    createdBy: boolean;
    createdAt: boolean;
    updatedAt: boolean;
    visibility: boolean;
    tags: boolean;
    customFields: boolean;
    follow: boolean;
  };
};

export type TicketDetailUserConfig = TicketDetailSectionConfig & {
  tierControlRules: {
    statusAllowedTiers: string[];
    severityAllowedTiers: string[];
    typeAllowedTiers: string[];
    tagsAllowedTiers: string[];
    visibilityAllowedTiers: string[];
  };
};

export const DEFAULT_AGENT_DASHBOARD_SURVEY_CONFIG: AgentDashboardSurveyConfig = {
  enabledFilters: {
    q: true,
    email: true,
    status: true,
    sort: true,
    urgency: true,
    severity: true,
    type: true,
    category: true,
    agent: true,
    team: true,
    tier: true,
    tags: true,
  },
  defaultSort: '',
};

export const DEFAULT_TICKET_DETAIL_AGENT_CONFIG: TicketDetailSectionConfig = {
  fields: {
    status: true,
    urgency: true,
    severity: true,
    type: true,
    category: true,
    assigned: true,
    createdBy: true,
    createdAt: true,
    updatedAt: true,
    visibility: true,
    tags: true,
    customFields: true,
    follow: true,
  },
};

export const DEFAULT_TICKET_DETAIL_USER_CONFIG: TicketDetailUserConfig = {
  fields: {
    status: true,
    urgency: true,
    severity: true,
    type: true,
    category: true,
    assigned: true,
    createdBy: true,
    createdAt: true,
    updatedAt: true,
    visibility: true,
    tags: true,
    customFields: true,
    follow: true,
  },
  tierControlRules: {
    statusAllowedTiers: [],
    severityAllowedTiers: [],
    typeAllowedTiers: [],
    tagsAllowedTiers: [],
    visibilityAllowedTiers: [],
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

export function parseAgentDashboardSurveyConfig(raw: string | null | undefined): AgentDashboardSurveyConfig {
  if (!raw) return DEFAULT_AGENT_DASHBOARD_SURVEY_CONFIG;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return DEFAULT_AGENT_DASHBOARD_SURVEY_CONFIG;

    const enabled = isRecord(parsed.enabledFilters) ? parsed.enabledFilters : {};

    return {
      enabledFilters: {
        q: enabled.q !== false,
        email: enabled.email !== false,
        status: enabled.status !== false,
        sort: enabled.sort !== false,
        urgency: enabled.urgency !== false,
        severity: enabled.severity !== false,
        type: enabled.type !== false,
        category: enabled.category !== false,
        agent: enabled.agent !== false,
        team: enabled.team !== false,
        tier: enabled.tier !== false,
        tags: enabled.tags !== false,
      },
      defaultSort: parsed.defaultSort === 'created' || parsed.defaultSort === 'sla' ? parsed.defaultSort : '',
    };
  } catch {
    return DEFAULT_AGENT_DASHBOARD_SURVEY_CONFIG;
  }
}

export function parseTicketDetailAgentConfig(raw: string | null | undefined): TicketDetailSectionConfig {
  if (!raw) return DEFAULT_TICKET_DETAIL_AGENT_CONFIG;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.fields)) return DEFAULT_TICKET_DETAIL_AGENT_CONFIG;

    return {
      fields: {
        status: parsed.fields.status !== false,
        urgency: parsed.fields.urgency !== false,
        severity: parsed.fields.severity !== false,
        type: parsed.fields.type !== false,
        category: parsed.fields.category !== false,
        assigned: parsed.fields.assigned !== false,
        createdBy: parsed.fields.createdBy !== false,
        createdAt: parsed.fields.createdAt !== false,
        updatedAt: parsed.fields.updatedAt !== false,
        visibility: parsed.fields.visibility !== false,
        tags: parsed.fields.tags !== false,
        customFields: parsed.fields.customFields !== false,
        follow: parsed.fields.follow !== false,
      },
    };
  } catch {
    return DEFAULT_TICKET_DETAIL_AGENT_CONFIG;
  }
}

export function parseTicketDetailUserConfig(raw: string | null | undefined): TicketDetailUserConfig {
  if (!raw) return DEFAULT_TICKET_DETAIL_USER_CONFIG;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.fields)) return DEFAULT_TICKET_DETAIL_USER_CONFIG;

    const tierRules = isRecord(parsed.tierControlRules) ? parsed.tierControlRules : {};

    return {
      fields: {
        status: parsed.fields.status !== false,
        urgency: parsed.fields.urgency !== false,
        severity: parsed.fields.severity !== false,
        type: parsed.fields.type !== false,
        category: parsed.fields.category !== false,
        assigned: parsed.fields.assigned !== false,
        createdBy: parsed.fields.createdBy !== false,
        createdAt: parsed.fields.createdAt !== false,
        updatedAt: parsed.fields.updatedAt !== false,
        visibility: parsed.fields.visibility !== false,
        tags: parsed.fields.tags !== false,
        customFields: parsed.fields.customFields !== false,
        follow: parsed.fields.follow !== false,
      },
      tierControlRules: {
        statusAllowedTiers: asStringArray(tierRules.statusAllowedTiers),
        severityAllowedTiers: asStringArray(tierRules.severityAllowedTiers),
        typeAllowedTiers: asStringArray(tierRules.typeAllowedTiers),
        tagsAllowedTiers: asStringArray(tierRules.tagsAllowedTiers),
        visibilityAllowedTiers: asStringArray(tierRules.visibilityAllowedTiers),
      },
    };
  } catch {
    return DEFAULT_TICKET_DETAIL_USER_CONFIG;
  }
}

export function canTierUseControl(allowedTiers: string[], tierKey: string | null): boolean {
  if (allowedTiers.length === 0) return true;
  if (!tierKey) return false;
  return allowedTiers.includes(tierKey);
}
