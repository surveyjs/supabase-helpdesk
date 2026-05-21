import {
  changeTicketStatus,
  changeUrgency,
  changeSeverity,
  changeType,
  changeCategory,
  toggleTicketPrivacy,
  assignAgent,
  reassignAgent,
  unassignAgent,
  addTagToTicket,
  removeTagFromTicket,
} from '@/lib/actions/agent';
import { followTicket, unfollowTicket } from '@/lib/actions/tickets';
import { updateCustomFieldValue } from '@/lib/actions/admin';
import {
  CUSTOM_FIELD_QUESTION_PREFIX,
  isCustomFieldQuestionName,
  customFieldNameFromQuestion,
} from '@/lib/constants/survey-ui-config';

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asBool(value: unknown): boolean {
  return value === true;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * Map SurveyJS question name → server action calls.
 *
 * Keys equal the SurveyJS question `name` AND the canonical
 * Supabase column / relationship name. There is no mapping layer.
 *
 * Each handler returns the list of action promises to execute (often a
 * single one, sometimes a batch for tag add/remove).
 */
export type TicketDetailDispatcher = (
  ticketId: string,
  next: unknown,
  prev: unknown,
) => Array<Promise<unknown>>;

export const ticketDetailDispatch: Record<string, TicketDetailDispatcher> = {
  status(ticketId, next, prev) {
    const v = asString(next);
    if (!v || v === asString(prev)) return [];
    return [changeTicketStatus(fd({ ticket_id: ticketId, new_status: v }))];
  },
  urgency(ticketId, next, prev) {
    const v = asString(next);
    if (!v || v === asString(prev)) return [];
    return [changeUrgency(fd({ ticket_id: ticketId, new_urgency: v }))];
  },
  severity(ticketId, next, prev) {
    const v = asString(next);
    if (!v || v === asString(prev)) return [];
    return [changeSeverity(fd({ ticket_id: ticketId, new_severity: v }))];
  },
  type_id(ticketId, next, prev) {
    const v = asString(next);
    if (!v || v === asString(prev)) return [];
    return [changeType(fd({ ticket_id: ticketId, new_type_id: v }))];
  },
  category_id(ticketId, next, prev) {
    const v = asString(next);
    if (v === asString(prev)) return [];
    return [changeCategory(fd({ ticket_id: ticketId, new_category_id: v }))];
  },
  assigned_agent_id(ticketId, next, prev) {
    const v = asString(next);
    const p = asString(prev);
    if (v === p) return [];
    if (v === '') return [unassignAgent(fd({ ticket_id: ticketId }))];
    if (p === '') return [assignAgent(fd({ ticket_id: ticketId, agent_id: v }))];
    return [reassignAgent(fd({ ticket_id: ticketId, agent_id: v, reason: '' }))];
  },
  is_private(ticketId, next, prev) {
    const v = asBool(next);
    if (v === asBool(prev)) return [];
    return [toggleTicketPrivacy(fd({ ticket_id: ticketId }))];
  },
  tag_ids(ticketId, next, prev) {
    const nextIds = asStringArray(next);
    const prevIds = asStringArray(prev);
    const removed = prevIds.filter((id) => !nextIds.includes(id));
    const added = nextIds.filter((id) => !prevIds.includes(id));
    const tasks: Array<Promise<unknown>> = [];
    for (const id of removed) tasks.push(removeTagFromTicket(fd({ ticket_id: ticketId, tag_id: id })));
    for (const id of added) tasks.push(addTagToTicket(fd({ ticket_id: ticketId, tag_id: id })));
    return tasks;
  },
  is_following(ticketId, next, prev) {
    const v = asBool(next);
    if (v === asBool(prev)) return [];
    return [v ? followTicket(fd({ ticket_id: ticketId })) : unfollowTicket(fd({ ticket_id: ticketId }))];
  },
};

function coerceCustomFieldValueForAction(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'string') return value;
  return String(value);
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  return a === b;
}

function buildCustomFieldDispatcher(fieldName: string): TicketDetailDispatcher {
  return (ticketId, next, prev) => {
    if (valuesEqual(next, prev)) return [];
    const value = coerceCustomFieldValueForAction(next);
    return [
      updateCustomFieldValue(
        fd({ ticket_id: ticketId, field_name: fieldName, value }),
      ),
    ];
  };
}

/**
 * Resolve the dispatcher for a SurveyJS question name. Returns a
 * dynamic handler for any name matching the `custom_fields.<name>`
 * convention; otherwise returns the static handler (if any).
 */
export function getDispatcher(
  questionName: string,
): TicketDetailDispatcher | undefined {
  if (isCustomFieldQuestionName(questionName)) {
    const fieldName = customFieldNameFromQuestion(questionName);
    if (!fieldName) return undefined;
    return buildCustomFieldDispatcher(fieldName);
  }
  return ticketDetailDispatch[questionName];
}

// Re-export for tests that need to recognise the convention.
export { CUSTOM_FIELD_QUESTION_PREFIX };
