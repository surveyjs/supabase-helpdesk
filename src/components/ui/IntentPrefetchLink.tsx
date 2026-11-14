'use client';

import Link from 'next/link';
import { useState, type ComponentProps } from 'react';

type IntentPrefetchLinkProps = Omit<ComponentProps<typeof Link>, 'prefetch'>;

/**
 * A Link that is not prefetched when it scrolls into view, only once the user
 * shows intent (hover, keyboard focus or touch). Use it for links that repeat
 * many times on a page (ticket rows, user names, pager links), where
 * viewport prefetch would fire dozens of RSC requests per page load.
 * See "Hover-triggered prefetch" in the Next.js prefetching guide.
 */
export function IntentPrefetchLink({
  onMouseEnter,
  onFocus,
  onTouchStart,
  ...props
}: IntentPrefetchLinkProps) {
  const [active, setActive] = useState(false);

  return (
    <Link
      {...props}
      prefetch={active ? null : false}
      onMouseEnter={(e) => {
        setActive(true);
        onMouseEnter?.(e);
      }}
      onFocus={(e) => {
        setActive(true);
        onFocus?.(e);
      }}
      onTouchStart={(e) => {
        setActive(true);
        onTouchStart?.(e);
      }}
    />
  );
}
