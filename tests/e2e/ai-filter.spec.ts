import { test, expect, Page } from './fixtures';
import { loginViaForm } from '../helpers/auth';
import { createServiceRoleClient } from '../helpers/supabase';
import { openViewsFilters } from '../helpers/agent-dashboard';

async function loginAsAgent(page: Page) {
  await loginViaForm(page, 'agent.smith@example.com');
}

test.describe.configure({ mode: 'serial' });

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

async function enableAiFilter(enabled: boolean) {
  const svc = createServiceRoleClient();
  const { error } = await svc
    .from('app_settings')
    .update({ value: enabled ? 'true' : 'false' })
    .eq('key', 'ai_filter_enabled');
  if (error) throw new Error(`ai_filter_enabled: ${error.message}`);
}

/**
 * Intercept the Next.js Server Action for translateAiFilterPrompt.
 *
 * Next.js Server Actions POST to the page URL with a `Next-Action` header.
 * The client calls `createFromFetch` (react-server-dom-webpack) to decode the
 * response and reads `response.a` as the action return value.  In the RSC wire
 * protocol `response.a` is a deferred chunk reference (`$@<hex-id>`), so the
 * body needs at least two rows:
 *
 *   Row 0  – root object:  `0:{"a":"$@1"}`
 *   Row 1  – return value: `1:<return-value-json>`
 *
 * Using a plain-JSON row 0 makes `.a` undefined and the Promise never resolves.
 *
 * Route pattern: we match only the exact /agent pathname so that
 * /_next/static/chunks/agent-*.js bundle requests are not accidentally
 * intercepted and served as RSC text (which breaks page hydration).
 */
async function mockAiFilterAction(
  page: Page,
  response: { data: Record<string, unknown>; error?: string },
) {
  await page.route(
    (url) => url.pathname === '/agent',
    async (route) => {
      const req = route.request();
      // Playwright normalises all headers to lowercase.
      if (req.method() === 'POST' && req.headers()['next-action']) {
        await route.fulfill({
          status: 200,
          contentType: 'text/x-component',
          // RSC wire format (react-server-dom-webpack):
          //   Row 0: root object — "a" is a deferred ref to row 1
          //   Row 1: the action's return value
          // Row 0: root — "a" is deferred ref to row 1, "f":"" means no page
          // re-render needed (avoids normalizeFlightData TypeError on undefined).
          body: `0:{"a":"$@1","f":""}\n1:${JSON.stringify(response)}\n`,
        });
      } else {
        await route.continue();
      }
    },
  );
}

/**
 * Open /agent (or `path`) with the Views & Filters panel expanded, rendered
 * with the AI filter on or off.
 *
 * ai_filter_enabled is global, and /admin/ai autosaves its whole form
 * (ai-features.spec.ts), writing every AI toggle back with the value it had
 * when that page loaded. A parallel worker can so flip the flag after we
 * set it. The pill renders with the panel, so once the panel is open its
 * presence tells which value the page saw. Re-apply and reload only when the
 * stored flag shows someone else changed it; otherwise return and let the
 * test's own assertions report what the page did.
 */
async function gotoAgentWithAiFilter(page: Page, enabled: boolean, path = '/agent') {
  const svc = createServiceRoleClient();
  const pill = page.getByRole('button', { name: /✨\s*AI/i });
  for (let attempt = 1; ; attempt++) {
    await enableAiFilter(enabled);
    await page.goto(path);
    // Shared helper waits for the post-hydration mount at xl instead of collapsing the panel.
    await openViewsFilters(page);
    if ((await pill.count()) > 0 === enabled) return;
    const { data, error } = await svc.from('app_settings').select('value').eq('key', 'ai_filter_enabled').single();
    if (error) throw new Error(`read ai_filter_enabled: ${error.message}`);
    if (data.value === String(enabled)) return;
    if (attempt === 5) throw new Error(`ai_filter_enabled kept being reset (wanted ${enabled})`);
  }
}

// ─────────────────────────────────────────────────────────────
// Admin: feature toggle visibility
// ─────────────────────────────────────────────────────────────

test.describe('Admin AI Configuration — ai_filter toggle', () => {
  test('toggle is visible on /admin/ai', async ({ page }) => {
    await loginViaForm(page, 'admin@example.com');
    await page.goto('/admin/ai');
    await expect(
      page.getByText('AI-powered dashboard filter'),
    ).toBeVisible({ timeout: 10000 });
  });
});

// ─────────────────────────────────────────────────────────────
// Feature disabled (default)
// ─────────────────────────────────────────────────────────────

test.describe('AI Filter — disabled state', () => {
  test.beforeAll(async () => { await enableAiFilter(false); });

  test('AI pill is not visible when feature is disabled', async ({ page }) => {
    await loginAsAgent(page);
    await gotoAgentWithAiFilter(page, false);
    await expect(page.getByRole('button', { name: /✨\s*AI/i })).toHaveCount(0);
  });
});

// ─────────────────────────────────────────────────────────────
// Feature enabled
// ─────────────────────────────────────────────────────────────

test.describe('AI Filter — enabled state', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => { await enableAiFilter(true); });
  test.afterAll(async () => { await enableAiFilter(false); });

  test('AI pill appears in Views & Filters panel for agents', async ({ page }) => {
    await loginAsAgent(page);
    await gotoAgentWithAiFilter(page, true);
    await expect(page.getByRole('button', { name: /✨\s*AI/i })).toBeVisible({ timeout: 10000 });
  });

  test('clicking AI pill hides SurveyJS form and shows textarea', async ({ page }) => {
    await loginAsAgent(page);
    await gotoAgentWithAiFilter(page, true);
    await page.getByRole('button', { name: /✨\s*AI/i }).click();
    await expect(
      page.getByPlaceholder("Describe what you're looking for…"),
    ).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('filter-survey')).not.toBeVisible();
  });

  test('clicking Standard pill restores the SurveyJS form', async ({ page }) => {
    await loginAsAgent(page);
    await gotoAgentWithAiFilter(page, true);
    await page.getByRole('button', { name: /✨\s*AI/i }).click();
    await page.getByRole('button', { name: 'Standard' }).click();
    await expect(page.getByTestId('filter-survey')).toBeVisible({ timeout: 5000 });
  });

  test('Ask AI button is disabled when textarea is empty', async ({ page }) => {
    await loginAsAgent(page);
    await gotoAgentWithAiFilter(page, true);
    await page.getByRole('button', { name: /✨\s*AI/i }).click();
    await expect(page.getByRole('button', { name: /Ask AI/i })).toBeDisabled();
  });

  test('Ask AI button is enabled once text is entered', async ({ page }) => {
    await loginAsAgent(page);
    await gotoAgentWithAiFilter(page, true);
    await page.getByRole('button', { name: /✨\s*AI/i }).click();
    await page.getByPlaceholder("Describe what you're looking for…").fill('urgent open tickets');
    await expect(page.getByRole('button', { name: /Ask AI/i })).toBeEnabled();
  });

  test('chips appear after a successful AI call', async ({ page }) => {
    await mockAiFilterAction(page, { data: { status: ['open'], urgency: 'high' } });
    await loginAsAgent(page);
    await gotoAgentWithAiFilter(page, true);
    await page.getByRole('button', { name: /✨\s*AI/i }).click();
    await page.getByPlaceholder("Describe what you're looking for…").fill('high urgency open');
    await page.getByRole('button', { name: /Ask AI/i }).click();

    const chips = page.getByLabel('Generated filters');
    await expect(chips).toBeVisible({ timeout: 10000 });
    await expect(chips).toContainText('urgency: high');
    await expect(chips).toContainText('status: open');
  });

  test('Apply button appears alongside chips after successful AI call', async ({ page }) => {
    await mockAiFilterAction(page, { data: { urgency: 'low' } });
    await loginAsAgent(page);
    await gotoAgentWithAiFilter(page, true);
    await page.getByRole('button', { name: /✨\s*AI/i }).click();
    await page.getByPlaceholder("Describe what you're looking for…").fill('low urgency');
    await page.getByRole('button', { name: /Ask AI/i }).click();

    await expect(page.getByRole('button', { name: 'Apply' })).toBeVisible({ timeout: 10000 });
  });

  test('error alert is shown when AI call fails', async ({ page }) => {
    await mockAiFilterAction(page, {
      data: {},
      error: "Couldn't interpret that — try rephrasing.",
    });
    await loginAsAgent(page);
    await gotoAgentWithAiFilter(page, true);
    await page.getByRole('button', { name: /✨\s*AI/i }).click();
    await page.getByPlaceholder("Describe what you're looking for…").fill('???');
    await page.getByRole('button', { name: /Ask AI/i }).click();

    // Filter out the Next.js route announcer (also role="alert") to avoid strict-mode violation.
    await expect(
      page.getByRole('alert').filter({ hasText: /try rephrasing/i }),
    ).toBeVisible({ timeout: 10000 });
  });

  test('chips are not shown when AI call returns an error', async ({ page }) => {
    await mockAiFilterAction(page, {
      data: {},
      error: "Couldn't interpret that — try rephrasing.",
    });
    await loginAsAgent(page);
    await gotoAgentWithAiFilter(page, true);
    await page.getByRole('button', { name: /✨\s*AI/i }).click();
    await page.getByPlaceholder("Describe what you're looking for…").fill('???');
    await page.getByRole('button', { name: /Ask AI/i }).click();

    await expect(page.getByLabel('Generated filters')).not.toBeVisible({ timeout: 5000 });
  });

  test('Clear resets textarea and removes chips', async ({ page }) => {
    await mockAiFilterAction(page, { data: { urgency: 'low' } });
    await loginAsAgent(page);
    await gotoAgentWithAiFilter(page, true);
    await page.getByRole('button', { name: /✨\s*AI/i }).click();
    await page.getByPlaceholder("Describe what you're looking for…").fill('low urgency');
    await page.getByRole('button', { name: /Ask AI/i }).click();

    await expect(page.getByLabel('Generated filters')).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Clear' }).click();

    await expect(page.getByLabel('Generated filters')).not.toBeVisible();
    await expect(
      page.getByPlaceholder("Describe what you're looking for…"),
    ).toHaveValue('');
  });

  test('loading a saved AI view pre-fills textarea and chips, selects AI pill', async ({ page }) => {
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
        name: 'AI Test View E2E',
        filters: {
          type: 'ai',
          prompt: 'critical unassigned tickets',
          data: { urgency: 'critical', agent: 'unassigned' },
          sql: '',
        },
      })
      .select('id')
      .single();

    try {
      await loginAsAgent(page);
      await gotoAgentWithAiFilter(page, true, `/agent?view=${view!.id}`);

      await expect(
        page.getByRole('button', { name: /✨\s*AI/i }),
      ).toHaveAttribute('aria-pressed', 'true', { timeout: 10000 });

      await expect(
        page.getByPlaceholder("Describe what you're looking for…"),
      ).toHaveValue('critical unassigned tickets');

      await expect(page.getByLabel('Generated filters')).toContainText('urgency: critical');
    } finally {
      await svc.from('saved_views').delete().eq('id', view!.id);
    }
  });

  test('non-agent (regular user) is redirected away from /agent', async ({ page }) => {
    await loginViaForm(page, 'alice@example.com');
    await page.goto('/agent');
    await expect(page).not.toHaveURL('/agent', { timeout: 10000 });
  });
});
