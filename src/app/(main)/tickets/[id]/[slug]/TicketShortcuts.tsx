'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  matchesShortcut,
  parseShortcut,
  SHORTCUT_ACTIONS,
  type ShortcutActionId,
  type ShortcutMap,
} from '@/lib/shortcuts';

/**
 * Agent keyboard shortcuts on the ticket page (#1); the key combinations come
 * from Admin > Keyboard Shortcuts.
 *  - save: submit the editor form that has focus (reply, comment, note, edit);
 *  - reply_and_close: submit the focused reply form and close the ticket;
 *  - copy_ticket_info: copy "#<id> <title>" and the ticket link.
 */
export function TicketShortcuts({
  ticketId,
  title,
  slug,
  shortcuts,
}: {
  ticketId: number;
  title: string;
  slug: string;
  shortcuts: ShortcutMap;
}) {
  const [toast, setToast] = useState('');
  const parsed = useMemo(
    () =>
      SHORTCUT_ACTIONS.flatMap(({ id }) => {
        const p = shortcuts[id] ? parseShortcut(shortcuts[id]) : null;
        return p ? [{ id: id as ShortcutActionId, p }] : [];
      }),
    [shortcuts],
  );

  useEffect(() => {
    let toastTimer: ReturnType<typeof setTimeout> | undefined;
    const say = (msg: string) => {
      setToast(msg);
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => setToast(''), 2500);
    };

    function focusedEditorForm(): HTMLFormElement | null {
      const form = document.activeElement?.closest('form') ?? null;
      return form && form.querySelector('textarea') ? form : null;
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.repeat) return;
      const hit = parsed.find(({ p }) => matchesShortcut(e, p));
      if (!hit) return;

      if (hit.id === 'save') {
        const form = focusedEditorForm();
        if (!form) return;
        e.preventDefault();
        form.requestSubmit();
      } else if (hit.id === 'reply_and_close') {
        const form = focusedEditorForm();
        const flag = form?.querySelector<HTMLInputElement>('input[data-close-after]');
        if (!form || !flag) return;
        e.preventDefault();
        flag.value = '1';
        form.requestSubmit();
        // A failed submit (e.g. empty body) must not close on the next plain Save.
        setTimeout(() => { flag.value = ''; }, 0);
      } else if (hit.id === 'copy_ticket_info') {
        e.preventDefault();
        const text = `#${ticketId} ${title}\n${window.location.origin}/tickets/${ticketId}/${slug}`;
        navigator.clipboard
          .writeText(text)
          .then(() => say('Ticket info copied'))
          .catch(() => say('Could not copy to the clipboard'));
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      clearTimeout(toastTimer);
    };
  }, [parsed, ticketId, title, slug]);

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="shortcut-toast"
      className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-50 rounded bg-gray-900 px-3 py-2 text-sm text-white shadow ${toast ? '' : 'sr-only'}`}
    >
      {toast}
    </div>
  );
}
