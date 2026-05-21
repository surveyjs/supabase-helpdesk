'use client';

import { useState, type ReactNode } from 'react';

export function ComposerToggle({
  triggerLabel,
  triggerTestId,
  panelTestId,
  triggerClassName,
  panelClassName,
  triggerIcon,
  trigger,
  children,
}: {
  triggerLabel?: string;
  triggerTestId?: string;
  panelTestId?: string;
  triggerClassName?: string;
  panelClassName?: string;
  triggerIcon?: ReactNode;
  /**
   * Custom render function for the closed trigger. Receives `open` so the
   * caller can render any markup it wants (e.g. a pill, an icon-only button)
   * and still toggle the panel open. When provided, `triggerLabel`,
   * `triggerIcon`, and `triggerClassName` are ignored.
   */
  trigger?: (ctx: { open: () => void }) => ReactNode;
  children: ReactNode | ((context: { close: () => void }) => ReactNode);
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    if (trigger) {
      return <>{trigger({ open: () => setOpen(true) })}</>;
    }
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={triggerClassName}
        data-testid={triggerTestId}
      >
        {triggerIcon}
        {triggerLabel}
      </button>
    );
  }

  return (
    <div className={panelClassName} data-testid={panelTestId}>
      {typeof children === 'function' ? children({ close: () => setOpen(false) }) : children}
    </div>
  );
}