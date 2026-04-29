'use client';

import { useState, type ReactNode } from 'react';

export function ComposerToggle({
  triggerLabel,
  triggerTestId,
  panelTestId,
  triggerClassName,
  panelClassName,
  children,
}: {
  triggerLabel: string;
  triggerTestId: string;
  panelTestId?: string;
  triggerClassName: string;
  panelClassName?: string;
  children: ReactNode | ((context: { close: () => void }) => ReactNode);
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={triggerClassName}
        data-testid={triggerTestId}
      >
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