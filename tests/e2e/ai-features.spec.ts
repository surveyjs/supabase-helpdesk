import { test, expect, Page } from './fixtures';
import { createServiceRoleClient } from '../helpers/supabase';
import { loginViaForm } from '../helpers/auth';

/**
 * Helper: log in via the login form (delegates to the shared, hardened helper).
 */
async function loginAs(page: Page, email: string, password = 'Password123') {
  await loginViaForm(page, email, password);
}

/** Navigate to an admin page, retrying once if requireAdmin() redirect race occurs. */
async function gotoAdmin(page: Page, path: string) {
  await page.goto(path);
  if (!page.url().includes('/admin')) {
    await page.goto(path);
  }
}

/** First ticket link in the /tickets list (a plain <ul>; only /agent has `agent-ticket-table`). */
const TICKET_ROW_LINK = (page: Page) => page.locator('main ul li a[href^="/tickets/"]').first();

// ============================================================
// ADMIN AI CONFIGURATION
// ============================================================

test.describe('Admin AI Configuration', () => {
  test.describe.configure({ mode: 'serial' });

  test('admin can navigate to /admin/ai', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await expect(page.getByRole('link', { name: 'Setup' })).toBeVisible({ timeout: 10000 });
    await gotoAdmin(page, '/admin/ai');

    await expect(page.getByRole('heading', { name: 'AI Configuration' })).toBeVisible({ timeout: 10000 });
  });

  test('AI Configuration link appears in sidebar', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/ai');

    await expect(page.getByRole('link', { name: 'AI Configuration' })).toBeVisible();
  });

  test('provider radio shows correct options', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/ai');

    const form = page.getByTestId('ai-config-survey-form');
    await expect(form.getByText('None (unconfigured)', { exact: true })).toBeVisible();
    await expect(form.getByText('OpenAI', { exact: true })).toBeVisible();
    await expect(form.getByText('Anthropic', { exact: true })).toBeVisible();
    await expect(form.getByText('Custom (OpenAI-compatible)', { exact: true })).toBeVisible();
  });

  test('API key field masks input', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/ai');

    const apiKeyInput = page.getByLabel('API Key');
    await expect(apiKeyInput).toBeVisible();
    await expect(apiKeyInput).toHaveAttribute('type', 'password');
  });

  test('Test Connection button is present', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/ai');

    const testBtn = page.getByTestId('test-connection-btn');
    await expect(testBtn).toBeVisible();
  });

  test('feature toggles are visible', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/ai');

    // Check all feature toggle checkboxes exist by their question titles
    await expect(page.getByText('Auto-categorize tickets', { exact: true })).toBeVisible();
    await expect(page.getByText('Duplicate ticket detection', { exact: true })).toBeVisible();
    await expect(page.getByText('Suggested reply for agents', { exact: true })).toBeVisible();
    await expect(page.getByText('Ticket summary', { exact: true })).toBeVisible();
    await expect(page.getByText('Generate KB article from ticket', { exact: true })).toBeVisible();
  });

  test('settings persist after save', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/ai');

    const form = page.getByTestId('ai-config-survey-form');

    // Select OpenAI provider via radiogroup, fill model + timeout, enable auto-categorize.
    await form.getByText('OpenAI', { exact: true }).click();
    await page.getByLabel('Model').fill('gpt-4o-test');
    await page.getByLabel('Request Timeout (seconds)').fill('30');
    await form.getByText('Auto-categorize tickets', { exact: true }).click();

    // Trigger flush of debounced autosave and wait for the request.
    const savePromise = page.waitForResponse(
      (resp) => resp.request().method() === 'POST' && resp.status() < 400,
      { timeout: 15000 },
    );
    await page.getByLabel('Request Timeout (seconds)').blur();
    await savePromise;
    await page.waitForTimeout(500);

    // Reload page and verify persistence
    await page.reload();
    await expect(page.getByLabel('Model')).toHaveValue('gpt-4o-test');
    await expect(page.getByLabel('Request Timeout (seconds)')).toHaveValue('30');

    // Reset settings
    const svc = createServiceRoleClient();
    await svc.from('app_settings').update({ value: '' }).eq('key', 'ai_provider');
    await svc.from('app_settings').update({ value: '' }).eq('key', 'ai_model');
    await svc.from('app_settings').update({ value: '60' }).eq('key', 'ai_request_timeout');
    await svc.from('app_settings').update({ value: 'false' }).eq('key', 'ai_auto_categorize_enabled');
  });

  test('changing one field on /admin/ai does not overwrite other AI settings', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/ai');

    const svc = createServiceRoleClient();
    const key = 'ai_suggested_reply_enabled';
    const { data: before, error: readErr } = await svc.from('app_settings').select('value').eq('key', key).single();
    expect(readErr).toBeNull();
    const original = before?.value ?? 'false';
    const opposite = original === 'true' ? 'false' : 'true';

    try {
      // Changed behind the page's back: the page still shows `original`.
      const { error: setErr } = await svc.from('app_settings').update({ value: opposite }).eq('key', key);
      expect(setErr).toBeNull();

      await page.getByLabel('Model').fill('gpt-4o-partial');
      const savePromise = page.waitForResponse(
        (resp) => resp.request().method() === 'POST' && resp.status() < 400,
        { timeout: 15000 },
      );
      await page.getByLabel('Model').blur();
      await savePromise;
      await expect(page.getByText('AI settings saved.')).toBeVisible({ timeout: 10000 });

      const { data: after, error: afterErr } = await svc.from('app_settings').select('value').eq('key', key).single();
      expect(afterErr).toBeNull();
      expect(after?.value).toBe(opposite);
      const { data: model } = await svc.from('app_settings').select('value').eq('key', 'ai_model').single();
      expect(model?.value).toBe('gpt-4o-partial');
    } finally {
      const r1 = await svc.from('app_settings').update({ value: original }).eq('key', key);
      const r2 = await svc.from('app_settings').update({ value: '' }).eq('key', 'ai_model');
      expect(r1.error).toBeNull();
      expect(r2.error).toBeNull();
    }
  });

  test('choosing provider None and clearing Model on /admin/ai is saved', async ({ page }) => {
    // SurveyJS drops emptied keys from the form data; the save must still send them as ''.
    const svc = createServiceRoleClient();
    const keys = ['ai_provider', 'ai_model'] as const;
    const { data: before, error: readErr } = await svc.from('app_settings').select('key, value').in('key', [...keys]);
    expect(readErr).toBeNull();
    const original = Object.fromEntries((before ?? []).map((r) => [r.key, r.value as string]));
    const read = async (key: string) => {
      const { data, error } = await svc.from('app_settings').select('value').eq('key', key).single();
      expect(error).toBeNull();
      return data?.value as string;
    };

    try {
      const r1 = await svc.from('app_settings').update({ value: 'openai' }).eq('key', 'ai_provider');
      const r2 = await svc.from('app_settings').update({ value: 'e2e-clear-model' }).eq('key', 'ai_model');
      expect(r1.error).toBeNull();
      expect(r2.error).toBeNull();

      await loginAs(page, 'admin@example.com');
      await gotoAdmin(page, '/admin/ai');
      const form = page.getByTestId('ai-config-survey-form');
      await expect(page.getByLabel('Model')).toHaveValue('e2e-clear-model');

      await form.getByText('None (unconfigured)', { exact: true }).click();
      await page.getByLabel('Model').fill('');
      await page.getByLabel('Model').blur();

      await expect.poll(() => read('ai_provider'), { timeout: 15000 }).toBe('');
      await expect.poll(() => read('ai_model'), { timeout: 15000 }).toBe('');
      await expect(page.getByText('AI settings saved.')).toBeVisible({ timeout: 10000 });
    } finally {
      for (const key of keys) {
        const { error } = await svc.from('app_settings').update({ value: original[key] ?? '' }).eq('key', key);
        expect(error).toBeNull();
      }
    }
  });

  test('usage counter section shows data', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/ai');

    // Usage counter should be visible
    await expect(page.getByText('Current Month Usage')).toBeVisible();
    await expect(page.getByTestId('usage-total-calls')).toBeVisible();
    await expect(page.getByTestId('usage-total-tokens')).toBeVisible();
  });

  test('custom endpoint URL shown only for custom provider', async ({ page }) => {
    // The form autosaves the provider clicks: restore the global setting afterwards.
    const svc = createServiceRoleClient();
    const { data: before, error: readErr } = await svc.from('app_settings').select('value').eq('key', 'ai_provider').single();
    expect(readErr).toBeNull();
    const original = (before?.value as string | undefined) ?? '';

    try {
      await loginAs(page, 'admin@example.com');
      await gotoAdmin(page, '/admin/ai');

      const form = page.getByTestId('ai-config-survey-form');

      // Not visible with default (none)
      await expect(page.getByLabel('Custom Endpoint URL')).not.toBeVisible();

      // Select custom provider
      await form.getByText('Custom (OpenAI-compatible)', { exact: true }).click();

      // Now visible
      await expect(page.getByLabel('Custom Endpoint URL')).toBeVisible();

      // Switch to OpenAI - hidden again
      await form.getByText('OpenAI', { exact: true }).click();
      await expect(page.getByLabel('Custom Endpoint URL')).not.toBeVisible();

      // Let the autosave land before restoring, so it cannot overwrite the restore.
      await expect.poll(async () => {
        const { data, error } = await svc.from('app_settings').select('value').eq('key', 'ai_provider').single();
        expect(error).toBeNull();
        return data?.value;
      }, { timeout: 15000 }).toBe('openai');
    } finally {
      const { error } = await svc.from('app_settings').update({ value: original }).eq('key', 'ai_provider');
      expect(error).toBeNull();
    }
  });
});

// ============================================================
// TICKET CREATION FORM - AI FEATURES
// ============================================================

test.describe('Ticket creation form AI features', () => {
  test.describe.configure({ mode: 'serial' });

  test('auto-categorization UI elements are present when feature disabled', async ({ page }) => {
    // Feature is disabled by default, so no AI suggestions should appear
    await loginAs(page, 'alice@example.com');
    await page.goto('/tickets/new');

    await expect(page.getByLabel('Title')).toBeVisible();
    await expect(page.locator('[data-testid="markdown-editor"]').first().locator('textarea[name="textarea"]')).toBeVisible();

    // No AI suggested labels should appear
    await expect(page.getByTestId('ai-suggested-type')).not.toBeVisible();
    await expect(page.getByTestId('ai-suggested-urgency')).not.toBeVisible();
  });

  test('duplicate detection section hidden when feature disabled', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto('/tickets/new');

    await page.getByLabel('Title').fill('Test duplicate detection');
    await page.waitForTimeout(1000);

    // No similar tickets section should appear
    await expect(page.getByTestId('similar-tickets')).not.toBeVisible();
  });
});

// ============================================================
// TICKET DETAIL - SUGGESTED REPLY
// ============================================================

test.describe('Ticket detail AI features', () => {
  test.describe.configure({ mode: 'serial' });

  test('suggest reply button not visible for non-agents', async ({ page }) => {
    await loginAs(page, 'alice@example.com');

    // Find a ticket to view
    await page.goto('/tickets');
    const firstTicket = TICKET_ROW_LINK(page);
    if (await firstTicket.isVisible()) {
      await firstTicket.click();
      await page.waitForTimeout(2000);

      // Non-agent should not see suggest reply
      await expect(page.getByTestId('suggest-reply-btn')).not.toBeVisible();
    }
  });

  test('suggest reply button visible for agent when feature enabled', async ({ page }) => {
    // Enable the feature
    const svc = createServiceRoleClient();
    await svc.from('app_settings').update({ value: 'true' }).eq('key', 'ai_suggested_reply_enabled');

    await loginAs(page, 'agent.smith@example.com');

    // Navigate to agent dashboard and click first ticket
    await page.goto('/agent');
    const firstTicket = page.getByTestId('agent-ticket-table').locator('a[href*="/tickets/"]').first();
    if (await firstTicket.isVisible()) {
      await firstTicket.click();
      await page.waitForTimeout(2000);

      // Suggest button is rendered inside the reply composer panel.
      await page.getByTestId('main-reply-btn').click();
      const replyPanel = page.getByTestId('main-reply-panel');
      await expect(replyPanel).toBeVisible({ timeout: 10000 });

      // Agent should see suggest reply button
      await expect(replyPanel.getByTestId('suggest-reply-btn')).toBeVisible();
    }

    // Disable the feature
    await svc.from('app_settings').update({ value: 'false' }).eq('key', 'ai_suggested_reply_enabled');
  });

  test('suggest reply button hidden when feature disabled', async ({ page }) => {
    // Ensure disabled, and verify the write is observable before navigating —
    // the previous test in this serial describe enables then disables this
    // setting, and a stale read on the next page render shows the button.
    const svc = createServiceRoleClient();
    await svc.from('app_settings').update({ value: 'false' }).eq('key', 'ai_suggested_reply_enabled');
    for (let i = 0; i < 20; i++) {
      const { data } = await svc.from('app_settings').select('value').eq('key', 'ai_suggested_reply_enabled').single();
      if (data?.value === 'false') break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/agent');

    const firstTicket = page.getByTestId('agent-ticket-table').locator('a[href*="/tickets/"]').first();
    await expect(firstTicket).toBeVisible({ timeout: 10000 });
    await firstTicket.click();
    await page.waitForLoadState('domcontentloaded');

    await page.getByTestId('main-reply-btn').click();
    const replyPanel = page.getByTestId('main-reply-panel');
    await expect(replyPanel).toBeVisible({ timeout: 10000 });

    await expect(replyPanel.getByTestId('suggest-reply-btn')).not.toBeVisible();
  });
});

// ============================================================
// TICKET DETAIL - AI SUMMARY
// ============================================================

test.describe('AI Summary panel', () => {
  test.describe.configure({ mode: 'serial' });

  test('summary panel hidden when feature disabled', async ({ page }) => {
    const svc = createServiceRoleClient();
    await svc.from('app_settings').update({ value: 'false' }).eq('key', 'ai_ticket_summary_enabled');

    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/agent');

    const firstTicket = page.getByTestId('agent-ticket-table').locator('a[href*="/tickets/"]').first();
    if (await firstTicket.isVisible()) {
      await firstTicket.click();
      await page.waitForTimeout(2000);

      await expect(page.getByTestId('ai-summary-panel')).not.toBeVisible();
      await expect(page.getByTestId('ai-summary-loading')).not.toBeVisible();
    }
  });

  test('summary panel hidden for non-agents', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto('/tickets');

    const firstTicket = TICKET_ROW_LINK(page);
    if (await firstTicket.isVisible()) {
      await firstTicket.click();
      await page.waitForTimeout(2000);

      await expect(page.getByTestId('ai-summary-panel')).not.toBeVisible();
    }
  });
});

// ============================================================
// TICKET DETAIL - GENERATE KB ARTICLE
// ============================================================

test.describe('Generate KB Article', () => {
  test.describe.configure({ mode: 'serial' });

  test('generate KB article button hidden on open tickets', async ({ page }) => {
    const svc = createServiceRoleClient();
    await svc.from('app_settings').update({ value: 'true' }).eq('key', 'ai_generate_kb_article_enabled');

    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/agent');

    // Find an open ticket
    const firstTicket = page.getByTestId('agent-ticket-table').locator('a[href*="/tickets/"]').first();
    if (await firstTicket.isVisible()) {
      await firstTicket.click();
      await page.waitForTimeout(2000);

      // If ticket is open, button should not be visible
      // Check if GenKB button is present only on closed tickets
      const isOpen = await page.getByText('Status: open').isVisible().catch(() => false);
      if (isOpen) {
        await expect(page.getByTestId('generate-kb-article-btn')).not.toBeVisible();
      }
    }

    await svc.from('app_settings').update({ value: 'false' }).eq('key', 'ai_generate_kb_article_enabled');
  });

  test('generate KB article button hidden when feature disabled', async ({ page }) => {
    const svc = createServiceRoleClient();
    await svc.from('app_settings').update({ value: 'false' }).eq('key', 'ai_generate_kb_article_enabled');

    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/agent');

    const firstTicket = page.getByTestId('agent-ticket-table').locator('a[href*="/tickets/"]').first();
    if (await firstTicket.isVisible()) {
      await firstTicket.click();
      await page.waitForTimeout(2000);

      await expect(page.getByTestId('generate-kb-article-btn')).not.toBeVisible();
    }
  });
});
