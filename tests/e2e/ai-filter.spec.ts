import { test, expect, Page } from '@playwright/test';
import { loginViaForm } from '../helpers/auth';
import { createServiceRoleClient } from '../helpers/supabase';

async function loginAsAgent(page: Page) {
  await loginViaForm(page, 'agent.smith@example.com');
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

async function enableAiFilter(enabled: boolean) {
  const svc = createServiceRoleClient();
  await svc
    .from('app_settings')
    .update({ value: enabled ? 'true' : 'false' })
    .eq('key', 'ai_filter_enabled');
}

/**
 * Intercept the Next.js Server Action for translateAiFilterPrompt.
 * Server Actions are POSTed with a `Next-Action` header; we match on
 * that header and short-circuit with a mock response.
 */
async function mockAiFilterAction(
  page: Page,
  response: { data: Record<string, unknown>; error?: string },
) {
  await page.route('**/agent**', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.headers()['next-action']) {
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
    await page.goto('/agent');
    await expect(page.getByRole('button', { name: /✨\s*AI/i })).not.toBeVisible();
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
    await page.goto('/agent');
    // Open the details panel first
    const summary = page.locator('details').filter({ hasText: 'Views & Filters' }).first();
    if (await summary.getAttribute('open') === null) {
      await summary.locator('summary').click();
    }
    await expect(page.getByRole('button', { name: /✨\s*AI/i })).toBeVisible({ timeout: 10000 });
  });

  test('clicking AI pill hides SurveyJS form and shows textarea', async ({ page }) => {
    await loginAsAgent(page);
    await page.goto('/agent');
    const summary = page.locator('details').filter({ hasText: 'Views & Filters' }).first();
    if (await summary.getAttribute('open') === null) {
      await summary.locator('summary').click();
    }
    await page.getByRole('button', { name: /✨\s*AI/i }).click();
    await expect(
      page.getByPlaceholder("Describe what you're looking for…"),
    ).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('filter-survey')).not.toBeVisible();
  });

  test('clicking Standard pill restores the SurveyJS form', async ({ page }) => {
    await loginAsAgent(page);
    await page.goto('/agent');
    const summary = page.locator('details').filter({ hasText: 'Views & Filters' }).first();
    if (await summary.getAttribute('open') === null) {
      await summary.locator('summary').click();
    }
    await page.getByRole('button', { name: /✨\s*AI/i }).click();
    await page.getByRole('button', { name: 'Standard' }).click();
    await expect(page.getByTestId('filter-survey')).toBeVisible({ timeout: 5000 });
  });

  test('Ask AI button is disabled when textarea is empty', async ({ page }) => {
    await loginAsAgent(page);
    await page.goto('/agent');
    const summary = page.locator('details').filter({ hasText: 'Views & Filters' }).first();
    if (await summary.getAttribute('open') === null) {
      await summary.locator('summary').click();
    }
    await page.getByRole('button', { name: /✨\s*AI/i }).click();
    await expect(page.getByRole('button', { name: /Ask AI/i })).toBeDisabled();
  });

  test('Ask AI button is enabled once text is entered', async ({ page }) => {
    await loginAsAgent(page);
    await page.goto('/agent');
    const summary = page.locator('details').filter({ hasText: 'Views & Filters' }).first();
    if (await summary.getAttribute('open') === null) {
      await summary.locator('summary').click();
    }
    await page.getByRole('button', { name: /✨\s*AI/i }).click();
    await page.getByPlaceholder("Describe what you're looking for…").fill('urgent open tickets');
    await expect(page.getByRole('button', { name: /Ask AI/i })).toBeEnabled();
  });

  test('chips appear after a successful AI call', async ({ page }) => {
    await mockAiFilterAction(page, { data: { status: ['open'], urgency: 'high' } });
    await loginAsAgent(page);
    await page.goto('/agent');
    const summary = page.locator('details').filter({ hasText: 'Views & Filters' }).first();
    if (await summary.getAttribute('open') === null) {
      await summary.locator('summary').click();
    }
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
    await page.goto('/agent');
    const summary = page.locator('details').filter({ hasText: 'Views & Filters' }).first();
    if (await summary.getAttribute('open') === null) {
      await summary.locator('summary').click();
    }
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
    await page.goto('/agent');
    const summary = page.locator('details').filter({ hasText: 'Views & Filters' }).first();
    if (await summary.getAttribute('open') === null) {
      await summary.locator('summary').click();
    }
    await page.getByRole('button', { name: /✨\s*AI/i }).click();
    await page.getByPlaceholder("Describe what you're looking for…").fill('???');
    await page.getByRole('button', { name: /Ask AI/i }).click();

    await expect(page.getByRole('alert')).toContainText(/try rephrasing/i, { timeout: 10000 });
  });

  test('chips are not shown when AI call returns an error', async ({ page }) => {
    await mockAiFilterAction(page, {
      data: {},
      error: "Couldn't interpret that — try rephrasing.",
    });
    await loginAsAgent(page);
    await page.goto('/agent');
    const summary = page.locator('details').filter({ hasText: 'Views & Filters' }).first();
    if (await summary.getAttribute('open') === null) {
      await summary.locator('summary').click();
    }
    await page.getByRole('button', { name: /✨\s*AI/i }).click();
    await page.getByPlaceholder("Describe what you're looking for…").fill('???');
    await page.getByRole('button', { name: /Ask AI/i }).click();

    await expect(page.getByLabel('Generated filters')).not.toBeVisible({ timeout: 5000 });
  });

  test('Clear resets textarea and removes chips', async ({ page }) => {
    await mockAiFilterAction(page, { data: { urgency: 'low' } });
    await loginAsAgent(page);
    await page.goto('/agent');
    const summary = page.locator('details').filter({ hasText: 'Views & Filters' }).first();
    if (await summary.getAttribute('open') === null) {
      await summary.locator('summary').click();
    }
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
      await page.goto(`/agent?view=${view!.id}`);
      const summary = page.locator('details').filter({ hasText: 'Views & Filters' }).first();
      if (await summary.getAttribute('open') === null) {
        await summary.locator('summary').click();
      }

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
