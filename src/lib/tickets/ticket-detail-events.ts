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
