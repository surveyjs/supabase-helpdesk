'use client';

import { useState, type ReactNode } from 'react';

function ChevronUp() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5 rotate-180 inline-block"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/**
 * Collapsed-posts row that visually integrates with the avatar gutter timeline.
 * Renders like a small timeline node with a connector line so it reads as part
 * of the conversation, not as a banner.
 */
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
    <li className="relative list-none">
      <span
        aria-hidden="true"
        className="absolute left-[19px] top-0 bottom-0 w-px bg-gray-200"
      />
      <div className="flex gap-3 items-center py-1">
        <div className="shrink-0 w-10 flex justify-center">
          <span className="block w-2 h-2 rounded-full bg-gray-300" />
        </div>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-[13px] text-blue-600 hover:text-blue-800 font-medium inline-flex items-center gap-1"
          data-testid="show-older-posts"
        >
          <ChevronUp />
          Show {hiddenCount} earlier {hiddenCount === 1 ? 'reply' : 'replies'}
        </button>
      </div>
    </li>
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
      className="inline-flex items-center gap-1 text-[12px] text-blue-600 hover:text-blue-800 font-medium"
      data-testid="show-older-comments"
    >
      <ChevronUp />
      Show {hiddenCount} earlier {hiddenCount === 1 ? 'comment' : 'comments'}
    </button>
  );
}
