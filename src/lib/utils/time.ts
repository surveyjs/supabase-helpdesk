export function formatRelativeTime(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHrs / 24);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin} min ago`;
  if (diffHrs < 24) return `${diffHrs} h ago`;
  if (diffDays < 30) return `${diffDays} d ago`;
  if (diffMonths < 12) return `${diffMonths} mo ago`;
  return `${diffYears} y ago`;
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

/**
 * Precise relative time for the Agent Dashboard (#104): "27 minutes ago",
 * "3 hours ago", "1 day and 10 hours ago", "2 months and 5 days ago".
 * Below a day one unit is enough; from a day on, the next smaller unit is
 * added when it isn't zero.
 */
export function formatPreciseRelativeTime(dateStr: string, now: Date = new Date()): string {
  const diffMin = Math.max(0, Math.floor((now.getTime() - new Date(dateStr).getTime()) / 60000));
  const hours = Math.floor(diffMin / 60);
  const days = Math.floor(hours / 24);

  if (diffMin < 1) return 'just now';
  if (hours < 1) return `${plural(diffMin, 'minute')} ago`;
  if (days < 1) return `${plural(hours, 'hour')} ago`;

  let big: string;
  let small: string | null;
  if (days < 30) {
    big = plural(days, 'day');
    small = hours % 24 ? plural(hours % 24, 'hour') : null;
  } else if (days < 365) {
    big = plural(Math.floor(days / 30), 'month');
    small = days % 30 ? plural(days % 30, 'day') : null;
  } else {
    const months = Math.floor((days % 365) / 30);
    big = plural(Math.floor(days / 365), 'year');
    small = months ? plural(months, 'month') : null;
  }
  return `${big}${small ? ` and ${small}` : ''} ago`;
}
