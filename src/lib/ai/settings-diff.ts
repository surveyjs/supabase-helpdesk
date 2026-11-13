/** null -> undefined (key absent); 'true'/'on' -> true; anything else -> false. */
export function parseBool(v: FormDataEntryValue | null): boolean | undefined {
  if (v === null) return undefined;
  return v === 'true' || v === 'on';
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Builds the FormData for saveAiSettings from only the fields that differ from
 * the last-saved baseline. `ai_api_key` is write-only: sent whenever non-blank,
 * never compared to the baseline.
 */
export function buildAiSettingsDiff(
  current: Record<string, unknown>,
  baseline: Record<string, unknown>,
): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(current)) {
    if (value === undefined || value === null) continue;
    if (key === 'ai_api_key') {
      const trimmed = String(value).trim();
      if (trimmed) fd.set(key, trimmed);
      continue;
    }
    if (deepEqual(value, baseline[key])) continue;
    if (typeof value === 'boolean') fd.set(key, value ? 'true' : 'false');
    else if (Array.isArray(value)) fd.set(key, value.join(','));
    else fd.set(key, String(value));
  }
  return fd;
}
