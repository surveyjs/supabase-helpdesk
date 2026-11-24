/**
 * Ticket filter definition shared by the Agent Dashboard.
 *
 * A "filter definition" couples four things:
 *   - a display name (Saved View name; empty -> "Default")
 *   - a generator type (only "json" is implemented today; "ai" is reserved)
 *   - the SurveyJS response JSON (i.e. `survey.data`) — question names match
 *     the SQL filter / column keys to avoid a binding layer
 *   - the SQL text generated from `data` (or, in the future, an AI prompt)
 */

export const TICKET_STATUS_VALUES = ['open', 'pending', 'closed'] as const;
export type TicketStatusValue = (typeof TICKET_STATUS_VALUES)[number];

export type TicketFilterType = 'json' | 'ai';

export type TicketFilterData = {
  q?: string;
  email?: string;
  status?: TicketStatusValue[];
  urgency?: string;
  severity?: string;
  category?: string;
  type?: string;
  agent?: string;
  team?: string;
  tier?: string;
  tags?: string[];
  sort?: string;
  /** Created-date preset, or 'custom' with created_from / created_to (#113). */
  created?: CreatedPreset;
  /** YYYY-MM-DD, inclusive; only with created === 'custom'. */
  created_from?: string;
  /** YYYY-MM-DD, inclusive; only with created === 'custom'. */
  created_to?: string;
  /** 'private' or 'public' tickets only (#113). */
  privacy?: 'private' | 'public';
};

export const CREATED_PRESETS = ['today', 'yesterday', '7d', '30d', '6m', '1y', 'custom'] as const;
export type CreatedPreset = (typeof CREATED_PRESETS)[number];

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDay(v: unknown): v is string {
  return typeof v === 'string' && ISO_DAY.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * The created_at window a filter asks for, as ISO timestamps: `gte` inclusive,
 * `lt` exclusive (#113). Days are UTC days. Empty when there is no filter.
 */
export function createdRange(
  data: Pick<TicketFilterData, 'created' | 'created_from' | 'created_to'>,
  now: Date = new Date(),
): { gte?: string; lt?: string } {
  const day = 24 * 60 * 60 * 1000;
  const today = startOfUtcDay(now);
  switch (data.created) {
    case 'today':
      return { gte: today.toISOString() };
    case 'yesterday':
      return { gte: new Date(today.getTime() - day).toISOString(), lt: today.toISOString() };
    case '7d':
      return { gte: new Date(now.getTime() - 7 * day).toISOString() };
    case '30d':
      return { gte: new Date(now.getTime() - 30 * day).toISOString() };
    case '6m': {
      const d = new Date(now);
      d.setUTCMonth(d.getUTCMonth() - 6);
      return { gte: d.toISOString() };
    }
    case '1y': {
      const d = new Date(now);
      d.setUTCFullYear(d.getUTCFullYear() - 1);
      return { gte: d.toISOString() };
    }
    case 'custom': {
      const out: { gte?: string; lt?: string } = {};
      if (isIsoDay(data.created_from)) out.gte = `${data.created_from}T00:00:00.000Z`;
      if (isIsoDay(data.created_to)) {
        out.lt = new Date(Date.parse(`${data.created_to}T00:00:00Z`) + day).toISOString();
      }
      return out;
    }
    default:
      return {};
  }
}

export type TicketFilterDefinition = {
  /** Display name. Empty / missing => "Default". */
  name: string;
  /** Generator type. */
  type: TicketFilterType;
  /** SurveyJS response JSON. Question names match SQL filter keys. */
  data: TicketFilterData;
  /** Generated SQL (informational; query layer parameterises real values). */
  sql: string;
  /** Original natural-language prompt used when type === 'ai'. */
  prompt?: string;
};

export const DEFAULT_VIEW_NAME = 'Default';

export const EMPTY_FILTER_DATA: TicketFilterData = {};

export function isAllStatusSelected(status: TicketStatusValue[] | undefined): boolean {
  if (!status) return true;
  if (status.length !== TICKET_STATUS_VALUES.length) return false;
  return TICKET_STATUS_VALUES.every((s) => status.includes(s));
}

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Generate a human-readable SQL fragment from a SurveyJS response.
 * The query layer does NOT execute this string — it re-derives parameterised
 * filters from the same data — but storing it on the saved view keeps the
 * round-trip honest and makes the AI version drop-in compatible later.
 */
export function generateSqlFromJson(data: TicketFilterData): string {
  const conditions: string[] = [];

  if (data.q && data.q.trim()) {
    const term = `%${escapeSqlString(data.q.trim())}%`;
    conditions.push(
      `(title ILIKE '${term}' OR EXISTS (SELECT 1 FROM posts p WHERE p.ticket_id = t.id AND p.body ILIKE '${term}'))`,
    );
  }

  if (data.email && data.email.trim()) {
    conditions.push(`creator_email ILIKE '%${escapeSqlString(data.email.trim())}%'`);
  }

  // Status semantics: undefined or all-3 selected => no predicate.
  // The SurveyJS checkbox enforces minSelectedChoices: 1, so empty is
  // not reachable from the UI; if it shows up via a hand-crafted URL we
  // treat it as "no filter" (consistent with undefined).
  if (data.status && data.status.length > 0 && !isAllStatusSelected(data.status)) {
    const list = data.status.map((s) => `'${s}'`).join(', ');
    conditions.push(`status IN (${list})`);
  }

  if (data.urgency) conditions.push(`urgency = '${escapeSqlString(data.urgency)}'`);
  if (data.severity) conditions.push(`severity = '${escapeSqlString(data.severity)}'`);
  if (data.category) conditions.push(`category_id = '${escapeSqlString(data.category)}'`);
  if (data.type) conditions.push(`type_id = '${escapeSqlString(data.type)}'`);

  if (data.agent === 'unassigned') {
    conditions.push('assigned_agent_id IS NULL');
  } else if (data.agent) {
    conditions.push(`assigned_agent_id = '${escapeSqlString(data.agent)}'`);
  }

  if (data.team === 'none') {
    conditions.push('creator_team_id IS NULL');
  } else if (data.team) {
    conditions.push(`creator_team_id = '${escapeSqlString(data.team)}'`);
  }

  if (data.tier === 'none') {
    conditions.push('creator_tier_key IS NULL');
  } else if (data.tier) {
    conditions.push(`creator_tier_key = '${escapeSqlString(data.tier)}'`);
  }

  if (data.tags && data.tags.length > 0) {
    const tagList = data.tags.map((t) => `'${escapeSqlString(t)}'`).join(', ');
    conditions.push(
      `id IN (SELECT ticket_id FROM ticket_tags WHERE tag_id IN (${tagList}))`,
    );
  }

  const range = createdRange(data);
  if (range.gte) conditions.push(`created_at >= '${range.gte}'`);
  if (range.lt) conditions.push(`created_at < '${range.lt}'`);
  if (data.privacy === 'private') conditions.push('is_private = true');
  else if (data.privacy === 'public') conditions.push('is_private = false');

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const order = data.sort === 'sla'
    ? 'ORDER BY sla_risk_rank ASC, sla_remaining_minutes ASC'
    : `ORDER BY ${sortOrder(data.sort).map((o) => `${o.column} ${o.ascending ? 'ASC' : 'DESC'}${o.nullsFirst === false ? ' NULLS LAST' : ''}`).join(', ')}`;

  return `SELECT * FROM agent_tickets t ${where} ${order}`.replace(/\s+/g, ' ').trim();
}

/**
 * Dashboard sort modes (#7). `sla` is special (sorted after SLA enrichment);
 * every other mode is a list of view columns. Unknown values sort by Last
 * Modified, newest first.
 *  - updated / updated_asc: tickets.updated_at
 *  - activated / activated_asc: the customer's latest post (#104 column)
 *  - created: creation time, newest first
 *  - auto: Enterprise customers first, then the higher of urgency/severity,
 *    then the most recently modified
 */
export type SortColumn = { column: string; ascending: boolean; nullsFirst?: boolean };

const SORT_ORDERS: Record<string, SortColumn[]> = {
  updated: [{ column: 'updated_at', ascending: false }],
  updated_asc: [{ column: 'updated_at', ascending: true }],
  activated: [{ column: 'last_user_activity_at', ascending: false }],
  activated_asc: [{ column: 'last_user_activity_at', ascending: true }],
  created: [{ column: 'created_at', ascending: false }],
  auto: [
    { column: 'is_enterprise', ascending: false, nullsFirst: false },
    { column: 'priority_rank', ascending: false, nullsFirst: false },
    { column: 'updated_at', ascending: false },
  ],
};

export function sortOrder(sort: string | undefined): SortColumn[] {
  return SORT_ORDERS[sort ?? ''] ?? SORT_ORDERS.updated;
}

export function generateSqlFromAi(data: TicketFilterData): string {
  return generateSqlFromJson(data);
}

export function generateSqlFromDefinition(def: TicketFilterDefinition): string {
  switch (def.type) {
    case 'json':
      return generateSqlFromJson(def.data);
    case 'ai':
      return generateSqlFromAi(def.data);
    default: {
      const _exhaustive: never = def.type;
      throw new Error(`Unknown filter type: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Best-effort coercion of a stored `saved_views.filters` blob into the new
 * shape. Legacy rows (flat `{ status: 'closed', urgency: 'high' }`) are
 * rewrapped as `{ type: 'json', data, sql }` so old data keeps working.
 */
export function normalizeStoredDefinition(
  name: string,
  raw: unknown,
): TicketFilterDefinition {
  const fallback: TicketFilterDefinition = {
    name,
    type: 'json',
    data: EMPTY_FILTER_DATA,
    sql: generateSqlFromJson(EMPTY_FILTER_DATA),
  };

  if (!raw || typeof raw !== 'object') return fallback;
  const obj = raw as Record<string, unknown>;

  // New shape: { type, data, sql }
  if (obj.type === 'json' || obj.type === 'ai') {
    const data = (obj.data && typeof obj.data === 'object' ? obj.data : {}) as TicketFilterData;
    const normalizedData = normalizeFilterData(data);
    const sql = typeof obj.sql === 'string' && obj.sql.length > 0
      ? obj.sql
      : (obj.type === 'json' ? generateSqlFromJson(normalizedData) : generateSqlFromAi(normalizedData));
    const def: TicketFilterDefinition = {
      name,
      type: obj.type,
      data: normalizedData,
      sql,
    };
    if (obj.type === 'ai' && typeof obj.prompt === 'string') {
      def.prompt = obj.prompt;
    }
    return def;
  }

  // Legacy flat shape — wrap and migrate.
  const legacyData = legacyFlatToData(obj as Record<string, string>);
  return {
    name,
    type: 'json',
    data: legacyData,
    sql: generateSqlFromJson(legacyData),
  };
}

function legacyFlatToData(flat: Record<string, string>): TicketFilterData {
  const data: TicketFilterData = {};
  if (flat.q) data.q = flat.q;
  if (flat.email) data.email = flat.email;
  if (flat.urgency) data.urgency = flat.urgency;
  if (flat.severity) data.severity = flat.severity;
  if (flat.category) data.category = flat.category;
  if (flat.type) data.type = flat.type;
  if (flat.agent) data.agent = flat.agent;
  if (flat.team) data.team = flat.team;
  if (flat.tier) data.tier = flat.tier;
  if (flat.sort) data.sort = flat.sort;
  if (flat.tags) {
    data.tags = flat.tags.split(',').map((t) => t.trim()).filter(Boolean);
  }
  // Legacy status semantics: "all" => no filter; "active" => open+pending;
  // "closed" => closed; "open"/"pending" => single value.
  if (flat.status) {
    if (flat.status === 'all' || flat.status === '') {
      // no filter — leave undefined
    } else if (flat.status === 'active') {
      data.status = ['open', 'pending'];
    } else if (TICKET_STATUS_VALUES.includes(flat.status as TicketStatusValue)) {
      data.status = [flat.status as TicketStatusValue];
    }
  }
  return data;
}

export function normalizeFilterData(input: unknown): TicketFilterData {
  if (!input || typeof input !== 'object') return {};
  const obj = input as Record<string, unknown>;
  const out: TicketFilterData = {};
  const stringKeys = ['q', 'email', 'urgency', 'severity', 'category', 'type', 'agent', 'team', 'tier', 'sort'] as const;
  for (const key of stringKeys) {
    const v = obj[key];
    if (typeof v === 'string' && v.length > 0) (out as Record<string, unknown>)[key] = v;
  }
  if (Array.isArray(obj.status)) {
    const status = obj.status.filter((s): s is TicketStatusValue =>
      typeof s === 'string' && TICKET_STATUS_VALUES.includes(s as TicketStatusValue),
    );
    if (status.length > 0) out.status = status;
  } else if (typeof obj.status === 'string') {
    // Tolerate legacy single-string status from URL params
    if (obj.status === 'active') out.status = ['open', 'pending'];
    else if (TICKET_STATUS_VALUES.includes(obj.status as TicketStatusValue)) {
      out.status = [obj.status as TicketStatusValue];
    }
  }
  if (Array.isArray(obj.tags)) {
    const tags = obj.tags.filter((t): t is string => typeof t === 'string' && t.length > 0);
    if (tags.length > 0) out.tags = tags;
  } else if (typeof obj.tags === 'string' && obj.tags.length > 0) {
    out.tags = obj.tags.split(',').map((t) => t.trim()).filter(Boolean);
  }
  Object.assign(out, normalizeCreatedAndPrivacy(obj));
  return out;
}

/** The #113 keys of `obj`, validated; dates only for a custom range. */
function normalizeCreatedAndPrivacy(obj: Record<string, unknown>): TicketFilterData {
  const out: TicketFilterData = {};
  if (typeof obj.created === 'string' && (CREATED_PRESETS as readonly string[]).includes(obj.created)) {
    out.created = obj.created as CreatedPreset;
    if (out.created === 'custom') {
      if (isIsoDay(obj.created_from)) out.created_from = obj.created_from;
      if (isIsoDay(obj.created_to)) out.created_to = obj.created_to;
    }
  }
  if (obj.privacy === 'private' || obj.privacy === 'public') out.privacy = obj.privacy;
  return out;
}

/**
 * Encode a filter definition's `data` into URL search params for the Default
 * view. Saved views use `?view=<id>` instead.
 */
export function dataToUrlParams(data: TicketFilterData): URLSearchParams {
  const params = new URLSearchParams();
  if (data.q) params.set('q', data.q);
  if (data.email) params.set('email', data.email);
  if (data.urgency) params.set('urgency', data.urgency);
  if (data.severity) params.set('severity', data.severity);
  if (data.category) params.set('category', data.category);
  if (data.type) params.set('type', data.type);
  if (data.agent) params.set('agent', data.agent);
  if (data.team) params.set('team', data.team);
  if (data.tier) params.set('tier', data.tier);
  if (data.sort) params.set('sort', data.sort);
  if (data.tags && data.tags.length > 0) params.set('tags', data.tags.join(','));
  if (data.created) params.set('created', data.created);
  if (data.created === 'custom' && data.created_from) params.set('created_from', data.created_from);
  if (data.created === 'custom' && data.created_to) params.set('created_to', data.created_to);
  if (data.privacy) params.set('privacy', data.privacy);
  if (data.status && !isAllStatusSelected(data.status)) {
    params.set('status', data.status.join(','));
  }
  return params;
}

/**
 * Decode URL search params (plain string map) into normalized filter data.
 * Honours legacy single-status values like `status=closed` and `status=active`.
 */
export function urlParamsToData(params: Record<string, string | string[] | undefined>): TicketFilterData {
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === 'string') flat[k] = v;
    else if (Array.isArray(v) && v.length > 0) flat[k] = v[0];
  }
  const data: TicketFilterData = {};
  if (flat.q) data.q = flat.q;
  if (flat.email) data.email = flat.email;
  if (flat.urgency) data.urgency = flat.urgency;
  if (flat.severity) data.severity = flat.severity;
  if (flat.category) data.category = flat.category;
  if (flat.type) data.type = flat.type;
  if (flat.agent) data.agent = flat.agent;
  if (flat.team) data.team = flat.team;
  if (flat.tier) data.tier = flat.tier;
  if (flat.sort) data.sort = flat.sort;
  if (flat.tags) {
    const tags = flat.tags.split(',').map((t) => t.trim()).filter(Boolean);
    if (tags.length > 0) data.tags = tags;
  }
  if (flat.status && flat.status !== 'all') {
    if (flat.status === 'active') {
      data.status = ['open', 'pending'];
    } else {
      const parts = flat.status
        .split(',')
        .map((s) => s.trim())
        .filter((s): s is TicketStatusValue =>
          TICKET_STATUS_VALUES.includes(s as TicketStatusValue),
        );
      if (parts.length > 0) data.status = parts;
    }
  }
  Object.assign(data, normalizeCreatedAndPrivacy(flat));
  return data;
}
