const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The `category` search param if it is a well-formed id, else '' (#120). */
export function parseCategoryParam(value: string | string[] | undefined): string {
  const v = Array.isArray(value) ? value[0] : value;
  return v && UUID_RE.test(v) ? v : '';
}
