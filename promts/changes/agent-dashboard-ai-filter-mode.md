# Change: AI Filter Mode for the Agent Dashboard

## Summary

Implement the reserved `type: 'ai'` filter path by adding a natural-language filter
mode to the agent dashboard. Agents type a plain-English description of what they want
to see; a server action translates that prompt into a `TicketFilterData` object using
the existing AI client; the result is applied through the exact same URL-param and query
path used by standard JSON filters — the query layer is untouched.

## Visual Design

The toggle appears at the top of the **Views & Filters** panel, above the SurveyJS
survey. When "AI" mode is active the SurveyJS form is hidden and replaced by a
textarea + resolved filter chip strip.

```
┌─────────────────────────────────────────────────────────┐
│  Views & Filters                                        │
│                                                         │
│  Saved Views:  [Default]  [Billing ×]  + Add new view  │
│                                                         │
│  Filter mode:  [ Standard ]  [ ✨ AI ]   ← two-pill   │
│                ─────────────────────────               │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Describe what you're looking for…               │   │  ← textarea
│  │                                                 │   │
│  │                                    [Ask AI ▶]  │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  Generated filters:                                     │
│  ┌─────────────────────────────────────────────────┐   │
│  │  status: open · urgency: high · agent: (none)   │   │  ← read-only chips
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  [Apply]   [Clear]                                      │
└─────────────────────────────────────────────────────────┘
```

- **Two-pill toggle** ("Standard" / "✨ AI") is visible only when
  `ai_filter_enabled` is `'true'` in `app_settings`.
- While the AI call is in flight the "Ask AI" button shows a spinner and is
  disabled; the textarea remains editable.
- The chip strip is hidden until the first successful translation; each
  non-empty field in `TicketFilterData` renders as a `key: value` chip.
- If the AI call fails, an inline error appears below the textarea ("Couldn't
  interpret that — try rephrasing") and the chip strip retains its previous
  state (or stays hidden on the first attempt).
- **Saving** a view while in AI mode stores `type: 'ai'`, `prompt` (the raw
  textarea text), and `data` (the resolved `TicketFilterData`). Loading that
  view pre-fills the textarea with `prompt` and the chips with `data` — no
  re-inference on load.

## Prerequisites (already in place)

| What | Where |
|---|---|
| `TicketFilterDefinition.type: 'json' \| 'ai'` | `src/lib/filters/ticket-filter.ts:15` |
| `generateSqlFromAi()` stub (throws) | `src/lib/filters/ticket-filter.ts:126` |
| Unsupported-view banner for `type === 'ai'` | `src/app/(main)/agent/page.tsx` |
| `callAi(systemPrompt, userPrompt)` → parsed JSON | `src/lib/ai/client.ts` |
| `logAiUsage(agentId, feature, tokens)` | `src/lib/ai/client.ts` |
| `normalizeFilterData(input)` | `src/lib/filters/ticket-filter.ts` |
| `dataToUrlParams(data)` / `urlParamsToData(params)` | `src/lib/filters/ticket-filter.ts` |
| Feature-toggle pattern in admin AI settings | `src/app/(main)/admin/ai/` |

## Changes

### 1. Migration: add `ai_filter_enabled` to `app_settings`

Append to the AI settings migration (or add a new migration file
`supabase/migrations/XXX_ai_filter.sql`):

```sql
INSERT INTO app_settings (key, value)
VALUES ('ai_filter_enabled', 'false')
ON CONFLICT (key) DO NOTHING;
```

Also add `'ai_filter'` to the `CHECK` constraint on `ai_usage_log.feature` if
the table has one; otherwise just use the string in log calls.

### 2. Extend `TicketFilterDefinition` (`src/lib/filters/ticket-filter.ts`)

Add an optional `prompt` field to carry the original natural-language text
through the save/load cycle:

```ts
export type TicketFilterDefinition = {
  name: string;
  type: TicketFilterType;
  data: TicketFilterData;
  sql: string;
  /** Original natural-language prompt used when type === 'ai'. */
  prompt?: string;
};
```

Replace the `generateSqlFromAi()` stub so that it no longer throws. Because
the AI path resolves to a `TicketFilterData` object before the definition is
saved, SQL generation is identical to the JSON path:

```ts
export function generateSqlFromAi(data: TicketFilterData): string {
  return generateSqlFromJson(data);
}

export function generateSqlFromDefinition(def: TicketFilterDefinition): string {
  switch (def.type) {
    case 'json':
      return generateSqlFromJson(def.data);
    case 'ai':
      return generateSqlFromAi(def.data);
    default: {
      const _exhaustive: never = def.type;
      throw new Error(`Unknown filter type: ${String(_exhaustive)}`);
    }
  }
}
```

Remove the unsupported-view banner path that fires for `type === 'ai'` in the
agent dashboard page — the type is now fully supported.

### 3. Server action: `translateAiFilterPrompt` (`src/lib/actions/ai.ts`)

Add after the existing AI actions:

```ts
export type AiFilterResult = {
  data: TicketFilterData;
  error?: string;
};

export async function translateAiFilterPrompt(
  formData: FormData,
): Promise<AiFilterResult> {
  const { profile } = await requireAgentRole();
  const prompt = (formData.get('prompt') as string)?.trim() ?? '';
  if (!prompt) return { data: {} };

  const supabase = await createServerClient();
  const settings = await getSettingsMap(supabase, ['ai_filter_enabled']);
  if (settings.get('ai_filter_enabled') !== 'true') {
    return { data: {}, error: 'AI filter is not enabled.' };
  }

  const systemPrompt = `You are a helpdesk ticket filter assistant.
Convert the user's description into a JSON object matching this TypeScript type:
{
  q?: string;           // keyword search (title + body)
  email?: string;       // submitter email fragment
  status?: ('open' | 'pending' | 'closed')[];
  urgency?: 'low' | 'medium' | 'high' | 'critical';
  severity?: 'low' | 'medium' | 'high' | 'critical';
  sort?: 'updated' | 'created' | 'sla';
}
Omit any field you cannot confidently infer. Respond with JSON only — no prose.`;

  try {
    const { content, tokensUsed } = await callAi(systemPrompt, prompt);
    const raw = JSON.parse(content);
    const data = normalizeFilterData(raw);
    await logAiUsage(profile.id, 'ai_filter', tokensUsed);
    return { data };
  } catch {
    return { data: {}, error: 'Could not interpret your request — try rephrasing.' };
  }
}
```

Import `normalizeFilterData` from `@/lib/filters/ticket-filter`.

### 4. Admin toggle (`src/app/(main)/admin/ai/`)

Follow the same pattern used for `ai_suggested_reply_enabled`:

- Add an `ai_filter_enabled` toggle to the feature-toggles SurveyJS form JSON
  (label: "AI-powered dashboard filter").
- Include `'ai_filter_enabled'` in the keys read and written by the admin
  settings server action.
- No additional sub-settings required.

### 5. UI: `ViewsAndFiltersPanel` (`src/app/(main)/agent/ViewsAndFiltersPanel.tsx`)

All changes are within the existing client component. Load `aiFilterEnabled`
(boolean) from a new server prop read out of `app_settings` on the parent
page and passed down.

#### State additions

```ts
const [filterMode, setFilterMode] = useState<'standard' | 'ai'>('standard');
const [aiPrompt, setAiPrompt] = useState('');
const [aiChips, setAiChips] = useState<TicketFilterData | null>(null);
const [aiPending, setAiPending] = useState(false);
const [aiError, setAiError] = useState<string | null>(null);
```

When loading a saved view with `definition.type === 'ai'`:
- Set `filterMode` to `'ai'`
- Set `aiPrompt` to `definition.prompt ?? ''`
- Set `aiChips` to `definition.data`

#### Toggle render (above the SurveyJS component, only when `aiFilterEnabled`)

```tsx
{aiFilterEnabled && (
  <div role="group" aria-label="Filter mode">
    <button
      onClick={() => setFilterMode('standard')}
      aria-pressed={filterMode === 'standard'}
    >
      Standard
    </button>
    <button
      onClick={() => setFilterMode('ai')}
      aria-pressed={filterMode === 'ai'}
    >
      ✨ AI
    </button>
  </div>
)}
```

#### AI mode panel (rendered when `filterMode === 'ai'`)

```tsx
{filterMode === 'ai' && (
  <div>
    <textarea
      value={aiPrompt}
      onChange={(e) => setAiPrompt(e.target.value)}
      placeholder="Describe what you're looking for…"
      rows={3}
    />
    <button
      disabled={aiPending || !aiPrompt.trim()}
      onClick={async () => {
        setAiPending(true);
        setAiError(null);
        const fd = new FormData();
        fd.set('prompt', aiPrompt);
        const result = await translateAiFilterPrompt(fd);
        setAiPending(false);
        if (result.error) {
          setAiError(result.error);
        } else {
          setAiChips(result.data);
        }
      }}
    >
      {aiPending ? <Spinner /> : 'Ask AI ▶'}
    </button>

    {aiError && <p role="alert">{aiError}</p>}

    {aiChips && (
      <div aria-label="Generated filters">
        {Object.entries(aiChips)
          .filter(([, v]) => v !== undefined && v !== null && String(v) !== '')
          .map(([k, v]) => (
            <span key={k}>{k}: {Array.isArray(v) ? v.join(', ') : String(v)}</span>
          ))}
      </div>
    )}

    <button onClick={() => { setAiChips(null); setAiPrompt(''); setAiError(null); }}>
      Clear
    </button>
  </div>
)}
```

Hide the SurveyJS component (`display: none` or conditional render) while
`filterMode === 'ai'`.

#### Apply (AI mode)

When the user clicks "Apply" in AI mode, use `dataToUrlParams(aiChips ?? {})`
to build the query string — same `router.push` path used by the standard mode.

#### Save as View (AI mode)

When saving a view while `filterMode === 'ai'`:

```ts
const definition: TicketFilterDefinition = {
  name: viewName,
  type: 'ai',
  prompt: aiPrompt,
  data: aiChips ?? {},
  sql: generateSqlFromAi(aiChips ?? {}),
};
```

Pass `definition` to `createSavedViewReturnId` / `updateSavedViewDefinition`
as usual.

## Tests

### Unit tests (`tests/unit/ai-filter.test.ts`) — vitest with mocks

```ts
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock server-only modules before importing the action
vi.mock('@/lib/ai/client', () => ({
  callAi: vi.fn(),
  callAiText: vi.fn(),
  logAiUsage: vi.fn(),
  getAiConfig: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(),
  createServiceRoleClient: vi.fn(),
}));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { callAi, logAiUsage } from '@/lib/ai/client';
import { createServerClient } from '@/lib/supabase/server';
import { generateSqlFromAi, generateSqlFromDefinition, normalizeFilterData }
  from '@/lib/filters/ticket-filter';

// ── generateSqlFromAi ────────────────────────────────────────

describe('generateSqlFromAi', () => {
  it('produces the same SQL as generateSqlFromJson for identical data', () => {
    const data = { status: ['open'] as const, urgency: 'high' };
    const sql = generateSqlFromAi(data);
    expect(sql).toContain("status IN ('open')");
    expect(sql).toContain("urgency = 'high'");
  });

  it('returns a bare SELECT for empty data', () => {
    expect(generateSqlFromAi({})).toMatch(/^SELECT \* FROM agent_tickets/);
    expect(generateSqlFromAi({})).not.toContain('WHERE');
  });
});

describe('generateSqlFromDefinition with type=ai', () => {
  it('does not throw and delegates to generateSqlFromAi', () => {
    const def = {
      name: 'Test',
      type: 'ai' as const,
      data: { urgency: 'critical' },
      sql: '',
      prompt: 'critical tickets',
    };
    expect(() => generateSqlFromDefinition(def)).not.toThrow();
    expect(generateSqlFromDefinition(def)).toContain("urgency = 'critical'");
  });
});

// ── translateAiFilterPrompt ──────────────────────────────────

function makeSupabaseMock(aiFilterEnabled = 'true', role = 'agent') {
  const selectMock = vi.fn().mockResolvedValue({
    data: [{ key: 'ai_filter_enabled', value: aiFilterEnabled }],
  });
  const fromMock = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({ in: vi.fn().mockReturnValue(selectMock()) }),
  });

  // profile query chain
  const profileSelectMock = vi.fn().mockResolvedValue({
    data: { id: 'agent-uuid', role },
  });
  const fromProfileMock = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({ single: profileSelectMock }),
    }),
  });

  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'agent-uuid' } } }) },
    from: vi.fn((table: string) =>
      table === 'profiles' ? fromProfileMock('profiles') : fromMock(table)
    ),
  };
}

describe('translateAiFilterPrompt', async () => {
  // Dynamic import so mocks are set up first
  const { translateAiFilterPrompt } = await import('@/lib/actions/ai');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty data for a blank prompt', async () => {
    (createServerClient as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeSupabaseMock()
    );
    const fd = new FormData();
    fd.set('prompt', '  ');
    const result = await translateAiFilterPrompt(fd);
    expect(result.data).toEqual({});
    expect(callAi).not.toHaveBeenCalled();
  });

  it('returns error when feature is disabled', async () => {
    (createServerClient as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeSupabaseMock('false')
    );
    const fd = new FormData();
    fd.set('prompt', 'urgent open tickets');
    const result = await translateAiFilterPrompt(fd);
    expect(result.error).toBeTruthy();
    expect(callAi).not.toHaveBeenCalled();
  });

  it('parses AI JSON response into TicketFilterData', async () => {
    (createServerClient as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeSupabaseMock()
    );
    (callAi as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: JSON.stringify({ status: ['open'], urgency: 'high' }),
      tokensUsed: 120,
    });

    const fd = new FormData();
    fd.set('prompt', 'high urgency open tickets');
    const result = await translateAiFilterPrompt(fd);

    expect(result.error).toBeUndefined();
    expect(result.data.status).toEqual(['open']);
    expect(result.data.urgency).toBe('high');
    expect(logAiUsage).toHaveBeenCalledWith('agent-uuid', 'ai_filter', 120);
  });

  it('returns error string when callAi throws', async () => {
    (createServerClient as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeSupabaseMock()
    );
    (callAi as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('timeout'));

    const fd = new FormData();
    fd.set('prompt', 'something');
    const result = await translateAiFilterPrompt(fd);

    expect(result.error).toBeTruthy();
    expect(result.data).toEqual({});
  });

  it('returns error when AI returns unparseable JSON', async () => {
    (createServerClient as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeSupabaseMock()
    );
    (callAi as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: 'Sure! Here are some filters for you...',
      tokensUsed: 50,
    });

    const fd = new FormData();
    fd.set('prompt', 'something');
    const result = await translateAiFilterPrompt(fd);

    expect(result.error).toBeTruthy();
    expect(result.data).toEqual({});
  });

  it('strips unknown fields from the AI response', async () => {
    (createServerClient as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeSupabaseMock()
    );
    (callAi as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: JSON.stringify({ urgency: 'low', fakeField: 'should-be-removed' }),
      tokensUsed: 80,
    });

    const fd = new FormData();
    fd.set('prompt', 'low urgency');
    const result = await translateAiFilterPrompt(fd);

    expect(result.data.urgency).toBe('low');
    expect((result.data as Record<string, unknown>)['fakeField']).toBeUndefined();
  });
});
```

### E2E tests (`tests/e2e/ai-filter.spec.ts`) — Playwright with route mocking

```ts
import { test, expect, Page, Route } from '@playwright/test';
import { loginViaForm } from '../helpers/auth';

const AI_FILTER_ROUTE = '**/agent**';

async function loginAsAgent(page: Page) {
  await loginViaForm(page, 'agent.smith@example.com');
}

/** Intercept the Next.js Server Action call for translateAiFilterPrompt. */
async function mockAiFilterAction(
  page: Page,
  response: { data: Record<string, unknown>; error?: string },
) {
  await page.route('**/agent*', async (route: Route) => {
    const req = route.request();
    const body = req.postData() ?? '';
    // Server Actions are POSTed with a Next-Action header
    if (req.headers()['next-action']) {
      await route.fulfill({
        status: 200,
        contentType: 'text/x-component',
        body: JSON.stringify(response),
      });
    } else {
      await route.continue();
    }
  });
}

test.describe('AI Filter Mode', () => {
  test.describe.configure({ mode: 'serial' });

  // ── Admin: enable the feature ──────────────────────────────

  test('admin can enable AI filter toggle in /admin/ai', async ({ page }) => {
    await loginViaForm(page, 'admin@example.com');
    await page.goto('/admin/ai');
    await expect(page.getByText('AI-powered dashboard filter')).toBeVisible({ timeout: 10000 });
  });

  // ── Toggle visibility ──────────────────────────────────────

  test('AI pill is hidden when feature is disabled', async ({ page }) => {
    await loginAsAgent(page);
    await page.goto('/agent');
    // Feature off by default — toggle should not be in the DOM
    await expect(page.getByRole('button', { name: /AI/i })).not.toBeVisible();
  });

  // The following tests assume the feature has been enabled via DB seeding
  // or a beforeAll that sets ai_filter_enabled=true via service-role client.

  test.describe('when ai_filter_enabled = true', () => {
    test.beforeAll(async () => {
      const { createServiceRoleClient } = await import('../helpers/supabase');
      const svc = createServiceRoleClient();
      await svc
        .from('app_settings')
        .update({ value: 'true' })
        .eq('key', 'ai_filter_enabled');
    });

    test.afterAll(async () => {
      const { createServiceRoleClient } = await import('../helpers/supabase');
      const svc = createServiceRoleClient();
      await svc
        .from('app_settings')
        .update({ value: 'false' })
        .eq('key', 'ai_filter_enabled');
    });

    test('AI pill appears in Views & Filters panel', async ({ page }) => {
      await loginAsAgent(page);
      await page.goto('/agent');
      await expect(page.getByRole('button', { name: /✨\s*AI/i })).toBeVisible({ timeout: 10000 });
    });

    test('clicking AI pill hides SurveyJS form and shows textarea', async ({ page }) => {
      await loginAsAgent(page);
      await page.goto('/agent');
      await page.getByRole('button', { name: /✨\s*AI/i }).click();
      await expect(page.getByPlaceholder("Describe what you're looking for…")).toBeVisible();
      await expect(page.getByTestId('filter-survey')).not.toBeVisible();
    });

    test('clicking Standard pill restores SurveyJS form', async ({ page }) => {
      await loginAsAgent(page);
      await page.goto('/agent');
      await page.getByRole('button', { name: /✨\s*AI/i }).click();
      await page.getByRole('button', { name: 'Standard' }).click();
      await expect(page.getByTestId('filter-survey')).toBeVisible();
    });

    test('Ask AI button is disabled while prompt is empty', async ({ page }) => {
      await loginAsAgent(page);
      await page.goto('/agent');
      await page.getByRole('button', { name: /✨\s*AI/i }).click();
      const askBtn = page.getByRole('button', { name: /Ask AI/i });
      await expect(askBtn).toBeDisabled();
    });

    test('Ask AI button is enabled after typing a prompt', async ({ page }) => {
      await loginAsAgent(page);
      await page.goto('/agent');
      await page.getByRole('button', { name: /✨\s*AI/i }).click();
      await page.getByPlaceholder("Describe what you're looking for…").fill('urgent open tickets');
      await expect(page.getByRole('button', { name: /Ask AI/i })).toBeEnabled();
    });

    test('resolved filters appear as chips after successful AI call', async ({ page }) => {
      await loginAsAgent(page);
      await mockAiFilterAction(page, { data: { status: ['open'], urgency: 'high' } });
      await page.goto('/agent');
      await page.getByRole('button', { name: /✨\s*AI/i }).click();
      await page.getByPlaceholder("Describe what you're looking for…").fill('high urgency open tickets');
      await page.getByRole('button', { name: /Ask AI/i }).click();
      await expect(page.getByLabel('Generated filters')).toBeVisible({ timeout: 10000 });
      await expect(page.getByLabel('Generated filters')).toContainText('urgency: high');
      await expect(page.getByLabel('Generated filters')).toContainText('status: open');
    });

    test('error message shown when AI call fails', async ({ page }) => {
      await loginAsAgent(page);
      await mockAiFilterAction(page, {
        data: {},
        error: "Couldn't interpret that — try rephrasing",
      });
      await page.goto('/agent');
      await page.getByRole('button', { name: /✨\s*AI/i }).click();
      await page.getByPlaceholder("Describe what you're looking for…").fill('???');
      await page.getByRole('button', { name: /Ask AI/i }).click();
      await expect(page.getByRole('alert')).toContainText(/try rephrasing/i, { timeout: 10000 });
    });

    test('Clear resets textarea and chips', async ({ page }) => {
      await loginAsAgent(page);
      await mockAiFilterAction(page, { data: { urgency: 'low' } });
      await page.goto('/agent');
      await page.getByRole('button', { name: /✨\s*AI/i }).click();
      await page.getByPlaceholder("Describe what you're looking for…").fill('low urgency');
      await page.getByRole('button', { name: /Ask AI/i }).click();
      await expect(page.getByLabel('Generated filters')).toBeVisible({ timeout: 10000 });
      await page.getByRole('button', { name: 'Clear' }).click();
      await expect(page.getByLabel('Generated filters')).not.toBeVisible();
      await expect(page.getByPlaceholder("Describe what you're looking for…")).toHaveValue('');
    });

    test('loading a saved AI view pre-fills textarea and chips', async ({ page }) => {
      // This test requires a seeded saved view with type='ai' — seed it via service role
      const { createServiceRoleClient } = await import('../helpers/supabase');
      const svc = createServiceRoleClient();
      const { data: agent } = await svc
        .from('profiles')
        .select('id')
        .eq('email', 'agent.smith@example.com')
        .single();

      const { data: view } = await svc
        .from('saved_views')
        .insert({
          agent_id: agent!.id,
          name: 'AI Test View',
          filters: {
            type: 'ai',
            prompt: 'critical unassigned tickets',
            data: { urgency: 'critical', agent: 'unassigned' },
            sql: '',
          },
        })
        .select('id')
        .single();

      await loginAsAgent(page);
      await page.goto(`/agent?view=${view!.id}`);

      await expect(page.getByRole('button', { name: /✨\s*AI/i })).toHaveAttribute(
        'aria-pressed', 'true', { timeout: 10000 }
      );
      await expect(page.getByPlaceholder("Describe what you're looking for…"))
        .toHaveValue('critical unassigned tickets');
      await expect(page.getByLabel('Generated filters')).toContainText('urgency: critical');

      // Cleanup
      await svc.from('saved_views').delete().eq('id', view!.id);
    });

    test('non-agent does not see the AI pill', async ({ page }) => {
      await loginViaForm(page, 'alice@example.com');
      await page.goto('/agent');
      // Users are redirected; even if not, no pill should render
      await expect(page.getByRole('button', { name: /✨\s*AI/i })).not.toBeVisible();
    });
  });
});
```

## Acceptance Criteria

1. `generateSqlFromAi(data)` produces identical SQL to `generateSqlFromJson(data)` for
   any `TicketFilterData` input and never throws.
2. `generateSqlFromDefinition` dispatches correctly for both `'json'` and `'ai'` types.
3. `translateAiFilterPrompt` returns `{ data: {} }` for empty prompts without calling the
   AI client.
4. `translateAiFilterPrompt` returns an `error` string (not a thrown exception) when the
   AI call fails or returns unparseable JSON.
5. `translateAiFilterPrompt` calls `logAiUsage(agentId, 'ai_filter', tokensUsed)` on
   success.
6. The AI pill is invisible when `ai_filter_enabled` is `'false'` and appears when it is
   `'true'`.
7. Clicking the AI pill hides the SurveyJS survey and shows the textarea.
8. The "Ask AI" button is disabled while the textarea is empty.
9. Resolved filters render as `key: value` chips in `aria-label="Generated filters"`.
10. An inline `role="alert"` error message appears on failure; chips retain their prior
    state (or stay hidden on a first-attempt failure).
11. Saving a view in AI mode stores `{ type: 'ai', prompt, data, sql }` in
    `saved_views.filters`; reloading the view auto-switches to AI pill and pre-fills
    textarea + chips.
12. Standard mode continues to work exactly as before — no regressions.
13. Unsupported-view banner is removed for `type === 'ai'` (it is now supported).
14. `npm run typecheck` passes.
15. `npm run lint` passes.
16. `npm run test` passes (unit + db).
17. `npm run test:e2e -- tests/e2e/ai-filter.spec.ts` passes.

## Verification Checklist

- [ ] Migration adds `ai_filter_enabled = 'false'` to `app_settings`
- [ ] `ai_usage_log` accepts `'ai_filter'` as a feature value
- [ ] `TicketFilterDefinition.prompt?: string` added
- [ ] `generateSqlFromAi(data)` delegates to `generateSqlFromJson(data)` (no throw)
- [ ] `generateSqlFromDefinition` handles `type === 'ai'` without falling through to the
      exhaustive check
- [ ] `translateAiFilterPrompt` server action added to `src/lib/actions/ai.ts`
- [ ] Action is gated on `ai_filter_enabled` setting
- [ ] Action normalises the AI JSON response via `normalizeFilterData`
- [ ] Action logs usage with feature key `'ai_filter'`
- [ ] Admin AI settings include `ai_filter_enabled` toggle
- [ ] `ViewsAndFiltersPanel` receives `aiFilterEnabled` prop
- [ ] Two-pill toggle renders only when `aiFilterEnabled` is true
- [ ] Switching to AI mode hides SurveyJS survey and shows textarea
- [ ] Switching back to Standard shows SurveyJS survey
- [ ] "Ask AI" button disabled when textarea is empty or while pending
- [ ] Spinner shown on "Ask AI" button during pending state
- [ ] Chips render after successful translation
- [ ] `role="alert"` error renders on failure
- [ ] Apply in AI mode uses `dataToUrlParams(aiChips)` — same URL path as standard mode
- [ ] Save in AI mode stores `type: 'ai'`, `prompt`, `data`, `sql`
- [ ] Loading an AI-type saved view pre-fills textarea + chips, selects AI pill
- [ ] Unsupported-view banner is no longer shown for `type === 'ai'`
- [ ] All unit tests pass with mocked `callAi` / `logAiUsage` / Supabase client
- [ ] All E2E tests pass with Playwright Server Action route mocking
