'use client';

import { useState, type ReactNode } from 'react';

export function CollapsibleTimeline({
  hiddenCount,
  children,
}: {
  hiddenCount: number;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);

  if (expanded) {
    return <>{children}</>;
  }

  return (
    <button
      type="button"
      onClick={() => setExpanded(true)}
      className="w-full py-2 px-4 text-sm text-blue-600 hover:text-blue-800 bg-blue-50 rounded border border-blue-100 hover:bg-blue-100 transition-colors"
      data-testid="show-older-posts"
    >
      Show {hiddenCount} older {hiddenCount === 1 ? 'post' : 'posts'}
    </button>
  );
}

export function CollapsibleComments({
  hiddenCount,
  children,
}: {
  hiddenCount: number;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);

  if (expanded) {
    return <>{children}</>;
  }

  return (
    <button
      type="button"
      onClick={() => setExpanded(true)}
      className="text-xs text-blue-600 hover:text-blue-800"
      data-testid="show-older-comments"
    >
      Show {hiddenCount} older {hiddenCount === 1 ? 'comment' : 'comments'}
    </button>
  );
}
