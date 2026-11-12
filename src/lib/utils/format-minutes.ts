/** Formats a duration in minutes; `null` means "no data" and renders as an em dash. */
export function formatMinutes(mins: number | null): string {
  if (mins === null) return '—';
  if (mins <= 0) return '0m';
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
