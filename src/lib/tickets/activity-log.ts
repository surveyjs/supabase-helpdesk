/**
 * Pure helpers for rendering ticket `activity_log` entries in the Logs (history)
 * tab. Kept free of React / Supabase so the old->new comparison logic for
 * issue #74 is unit-testable.
 */

export type ActivityLabelLookups = {
  /** Resolve a ticket-type id to its name, or undefined if unknown. */
  typeName: (id: string) => string | undefined;
  /** Resolve a category id to its name, or undefined if unknown. */
  categoryName: (id: string) => string | undefined;
  /** Resolve an agent/profile id to a display name, or undefined if unknown. */
  agentName: (id: string) => string | undefined;
  /** Resolve a tag id to its name, or undefined if unknown. */
  tagName: (id: string) => string | undefined;
};

export type ActivityDescriptor = {
  actorName: string;
  /** Human-readable field name; presence enables old->new comparison rendering. */
  field?: string;
  oldValue?: string | null;
  newValue?: string | null;
  /** Predicate-only prose (no leading actor name) for events without before/after. */
  message?: string;
  note?: string | null;
};

/** Title-cases an enum-ish token, e.g. "in_progress" -> "In progress". */
export function titleCaseValue(value: unknown): string {
  const s = String(value ?? '')
    .replace(/_/g, ' ')
    .trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '—';
}

/**
 * Turns one activity-log row into a render descriptor. FK ids in `details` are
 * resolved to labels via `lookups`; unresolved ids degrade gracefully.
 */
export function buildActivityDescriptor(
  action: string,
  details: Record<string, unknown> | null | undefined,
  actorName: string,
  lookups: ActivityLabelLookups,
): ActivityDescriptor {
  const d = (details ?? {}) as Record<string, unknown>;
  const note = typeof d.reason === 'string' ? d.reason : null;

  const typeLabel = (id: unknown) =>
    id ? (lookups.typeName(String(id)) ?? 'Unknown') : 'None';
  const categoryLabel = (id: unknown) =>
    id ? (lookups.categoryName(String(id)) ?? 'Unknown') : 'None';
  const agentLabel = (id: unknown) =>
    id ? (lookups.agentName(String(id)) ?? 'an agent') : 'Unassigned';
  const tagLabel = () =>
    (typeof d.tag_name === 'string' && d.tag_name) ||
    (d.tag_id ? (lookups.tagName(String(d.tag_id)) ?? 'a tag') : 'a tag');

  switch (action) {
    case 'status_changed':
      return { actorName, field: 'status', oldValue: titleCaseValue(d.from), newValue: titleCaseValue(d.to) };
    case 'urgency_changed':
      return { actorName, field: 'urgency', oldValue: titleCaseValue(d.from), newValue: titleCaseValue(d.to) };
    case 'severity_changed':
      return { actorName, field: 'severity', oldValue: titleCaseValue(d.from), newValue: titleCaseValue(d.to) };
    case 'type_changed':
      return { actorName, field: 'type', oldValue: typeLabel(d.from), newValue: typeLabel(d.to) };
    case 'category_changed':
      return { actorName, field: 'category', oldValue: categoryLabel(d.from), newValue: categoryLabel(d.to) };
    case 'title_changed':
      return {
        actorName,
        field: 'title',
        oldValue: d.from != null ? `"${d.from}"` : '—',
        newValue: d.to != null ? `"${d.to}"` : '—',
      };
    case 'ticket_privacy_changed':
    case 'privacy_changed':
      return {
        actorName,
        field: 'privacy',
        oldValue: d.from ? 'Private' : 'Public',
        newValue: d.to ? 'Private' : 'Public',
      };
    case 'agent_assigned':
      return { actorName, field: 'assignee', oldValue: 'Unassigned', newValue: agentLabel(d.agent_id) };
    case 'agent_reassigned':
      return { actorName, field: 'assignee', oldValue: agentLabel(d.from_agent_id), newValue: agentLabel(d.to_agent_id), note };
    case 'agent_unassigned':
      return { actorName, field: 'assignee', oldValue: agentLabel(d.previous_agent_id), newValue: 'Unassigned' };
    case 'tag_added':
      return { actorName, message: `added tag "${tagLabel()}"` };
    case 'tag_removed':
      return { actorName, message: `removed tag "${tagLabel()}"` };
    case 'post_privacy_changed':
      return { actorName, message: `changed post privacy to ${d.is_private ? 'private' : 'public'}` };
    case 'draft_published':
      return { actorName, message: 'published a draft' };
    case 'marked_duplicate':
      return {
        actorName,
        message:
          d.original_ticket_id != null
            ? `marked as duplicate of #${d.original_ticket_id}`
            : 'marked as duplicate',
      };
    case 'duplicate_removed':
      return { actorName, message: `removed duplicate link (was #${d.previous_original_id ?? '?'})` };
    case 'merged_from':
      return { actorName, message: `merged ticket #${d.source_ticket_id ?? '?'} into this ticket` };
    case 'merged_into':
      return { actorName, message: `merged this ticket into #${d.target_ticket_id ?? '?'}` };
    case 'merged':
      return { actorName, message: 'merged ticket' };
    case 'file_uploaded':
      return { actorName, message: `uploaded file "${d.filename ?? ''}"` };
    case 'file_deleted':
      return { actorName, message: `deleted file "${d.filename ?? ''}"` };
    case 'created':
      return { actorName, message: 'created the ticket' };
    default:
      return { actorName, message: `performed ${action}` };
  }
}
