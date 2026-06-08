/**
 * Lightweight in-page pub/sub for ticket-detail field updates persisted by
 * the SurveyJS sidebar. Sibling client components (e.g. the tag chip list)
 * can subscribe to keep their UI in sync with successful saves without a
 * full re-render or an extra fetch round-trip.
 *
 * Events are dispatched on `window` and only fire on the originating tab.
 * Callers that also need cross-tab sync should subscribe to Supabase
 * Realtime in addition to this.
 */

const EVENT_NAME = 'ticket-detail-field-change';

export type TicketDetailFieldChangeDetail = {
  ticketId: string;
  name: string;
  value: unknown;
};

export function dispatchTicketDetailFieldChange(detail: TicketDetailFieldChangeDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<TicketDetailFieldChangeDetail>(EVENT_NAME, { detail }));
}

export function subscribeTicketDetailFieldChange(
  listener: (detail: TicketDetailFieldChangeDetail) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (e: Event) => {
    const ce = e as CustomEvent<TicketDetailFieldChangeDetail>;
    listener(ce.detail);
  };
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}

const SAVE_STATUS_EVENT = 'ticket-detail-save-status';

export type TicketDetailSaveStatusTone = 'idle' | 'saving' | 'saved' | 'error';

export type TicketDetailSaveStatusDetail = {
  ticketId: string;
  tone: TicketDetailSaveStatusTone;
  /** Human-readable label to display (empty string when idle). */
  message: string;
};

/**
 * Broadcast the sidebar autosave status so it can be rendered away from the
 * survey itself (e.g. on the ticket-number header line at the top of the
 * sidebar).
 */
export function dispatchTicketDetailSaveStatus(detail: TicketDetailSaveStatusDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<TicketDetailSaveStatusDetail>(SAVE_STATUS_EVENT, { detail }));
}

export function subscribeTicketDetailSaveStatus(
  listener: (detail: TicketDetailSaveStatusDetail) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (e: Event) => {
    const ce = e as CustomEvent<TicketDetailSaveStatusDetail>;
    listener(ce.detail);
  };
  window.addEventListener(SAVE_STATUS_EVENT, handler);
  return () => window.removeEventListener(SAVE_STATUS_EVENT, handler);
}
