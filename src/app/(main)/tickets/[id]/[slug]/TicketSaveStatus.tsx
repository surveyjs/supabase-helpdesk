'use client';

import { useEffect, useState } from 'react';
import {
  subscribeTicketDetailSaveStatus,
  type TicketDetailSaveStatusTone,
} from '@/lib/tickets/ticket-detail-events';

const TONE_CLASSES: Record<TicketDetailSaveStatusTone, string> = {
  idle: 'text-gray-500',
  saving: 'text-gray-500',
  saved: 'text-green-600',
  error: 'text-red-600',
};

/**
 * Renders the sidebar autosave status (Saving…/Saved/error) emitted by
 * {@link TicketSidebarSurvey}. Lives on the ticket-number header line so the
 * save state is easy to notice (issue #77).
 */
export function TicketSaveStatus({ ticketId }: { ticketId: string }) {
  const [state, setState] = useState<{ tone: TicketDetailSaveStatusTone; message: string }>({
    tone: 'idle',
    message: '',
  });

  useEffect(
    () =>
      subscribeTicketDetailSaveStatus((detail) => {
        if (detail.ticketId !== ticketId) return;
        setState({ tone: detail.tone, message: detail.message });
      }),
    [ticketId],
  );

  return (
    <span
      aria-live="polite"
      data-testid="ticket-sidebar-survey-status"
      className={`text-xs ${TONE_CLASSES[state.tone]}`}
    >
      {state.message}
    </span>
  );
}
