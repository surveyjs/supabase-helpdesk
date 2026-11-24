/** `?a=1&b=2` from the non-empty entries, or ''. */
export function toQuery(params: Record<string, string>): string {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
  return qs ? `?${qs}` : '';
}
