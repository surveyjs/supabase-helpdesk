/** null -> undefined (key absent); 'true'/'on' -> true; anything else -> false. */
export function parseBool(v: FormDataEntryValue | null): boolean | undefined {
  if (v === null) return undefined;
  return v === 'true' || v === 'on';
}

type Data = Record<string, unknown>;

const API_KEY = 'ai_api_key';

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** SurveyJS drops a key from `model.data` when its value is emptied. */
function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === '';
}

function serialize(value: unknown): string {
  if (isEmpty(value)) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return value.join(',');
  return String(value);
}

/**
 * Builds the FormData for saveAiSettings from only the fields that differ from
 * the last-saved baseline. A key the baseline has but `current` lacks (or holds
 * null/undefined) was emptied in the form and is sent as ''. `ai_api_key` is
 * write-only: sent whenever non-blank, never compared to the baseline.
 *
 * `alwaysSend` names keys sent with their current value even when they equal
 * the baseline: the keys of saves still in flight, whose values the baseline
 * does not reflect yet (e.g. a field changed and then changed back).
 */
export function buildAiSettingsDiff(
  current: Data,
  baseline: Data,
  alwaysSend: Iterable<string> = [],
): FormData {
  const fd = new FormData();
  const force = new Set(alwaysSend);
  const keys = new Set([...Object.keys(baseline), ...Object.keys(current), ...force]);
  for (const key of keys) {
    const value = current[key];
    if (key === API_KEY) {
      const trimmed = isEmpty(value) ? '' : String(value).trim();
      if (trimmed) fd.set(key, trimmed);
      continue;
    }
    if (!force.has(key)) {
      if (isEmpty(value) && isEmpty(baseline[key])) continue;
      if (deepEqual(value, baseline[key])) continue;
    }
    fd.set(key, serialize(value));
  }
  return fd;
}

/**
 * The baseline after a save succeeded: only the keys that save sent move to the
 * values it sent (an emptied value removes the key). Keys of other saves, which
 * may have failed, keep their old baseline so the next diff re-sends them.
 */
export function advanceAiSettingsBaseline(
  baseline: Data,
  sent: Data,
  sentKeys: Iterable<string>,
): Data {
  const next = { ...baseline };
  for (const key of sentKeys) {
    if (key === API_KEY) continue;
    if (sent[key] === undefined || sent[key] === null) delete next[key];
    else next[key] = sent[key];
  }
  return next;
}

/**
 * Tracks the /admin/ai baseline across overlapping saves. `begin` builds a
 * save's FormData and remembers what it sent; `settle` advances the baseline
 * with exactly that save's data when it succeeded and forgets it either way.
 */
export function createAiSettingsSaveTracker(initialBaseline: Data) {
  let baseline: Data = { ...initialBaseline };
  const inFlight = new Map<FormData, { data: Data; keys: string[] }>();

  return {
    begin(current: Data): FormData {
      const pendingKeys = new Set<string>();
      for (const { keys } of inFlight.values()) for (const k of keys) pendingKeys.add(k);
      const fd = buildAiSettingsDiff(current, baseline, pendingKeys);
      inFlight.set(fd, { data: { ...current }, keys: Array.from(fd.keys()) });
      return fd;
    },
    settle(fd: FormData, ok: boolean): void {
      const entry = inFlight.get(fd);
      inFlight.delete(fd);
      if (ok && entry) baseline = advanceAiSettingsBaseline(baseline, entry.data, entry.keys);
    },
    baseline(): Data {
      return baseline;
    },
  };
}
