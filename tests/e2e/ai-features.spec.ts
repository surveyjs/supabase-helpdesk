import { test, expect, Page } from '@playwright/test';
import { createServiceRoleClient } from '../helpers/supabase';

/**
 * Helper: log in via the login form.
 */
async function loginAs(page: Page, email: string, password = 'Password123') {
  // Clear any login lockouts from prior runs
  const svc = createServiceRoleClient();
  await svc.from('login_attempts').delete().eq('email', email.toLowerCase());

  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL('/', { timeout: 10000 });
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible({ timeout: 10000 });
}

/** Navigate to an admin page, retrying once if requireAdmin() redirect race occurs. */
async function gotoAdmin(page: Page, path: string) {
  await page.goto(path);
  if (!page.url().includes('/admin')) {
    await page.goto(path);
  }
}

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

  test('provider dropdown shows correct options', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/ai');

    const providerSelect = page.locator('#ai_provider');
    await expect(providerSelect).toBeVisible();

    const options = providerSelect.locator('option');
    const optionTexts = await options.allTextContents();
    expect(optionTexts).toContain('None (unconfigured)');
    expect(optionTexts).toContain('OpenAI');
    expect(optionTexts).toContain('Anthropic');
    expect(optionTexts).toContain('Custom (OpenAI-compatible)');
  });

  test('API key field masks input', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/ai');

    const apiKeyInput = page.locator('#ai_api_key');
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

    // Check all feature toggle checkboxes exist
    await expect(page.locator('#ai_auto_categorize_enabled')).toBeVisible();
    await expect(page.locator('#ai_duplicate_detection_enabled')).toBeVisible();
    await expect(page.locator('#ai_suggested_reply_enabled')).toBeVisible();
    await expect(page.locator('#ai_ticket_summary_enabled')).toBeVisible();
    await expect(page.locator('#ai_generate_kb_article_enabled')).toBeVisible();
  });

  test('settings persist after save', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/ai');

    // Select OpenAI provider
    await page.locator('#ai_provider').selectOption('openai');
    await page.locator('#ai_model').fill('gpt-4o-test');
    await page.locator('#ai_request_timeout').fill('30');

    // Enable auto-categorize
    await page.locator('#ai_auto_categorize_enabled').check();

    // Save
    await page.getByTestId('save-ai-settings-btn').click();
    await page.waitForTimeout(2000);

    // Reload page and verify persistence
    await page.reload();
    await expect(page.locator('#ai_provider')).toHaveValue('openai');
    await expect(page.locator('#ai_model')).toHaveValue('gpt-4o-test');
    await expect(page.locator('#ai_request_timeout')).toHaveValue('30');
    await expect(page.locator('#ai_auto_categorize_enabled')).toBeChecked();

    // Reset settings
    const svc = createServiceRoleClient();
    await svc.from('app_settings').update({ value: '' }).eq('key', 'ai_provider');
    await svc.from('app_settings').update({ value: '' }).eq('key', 'ai_model');
    await svc.from('app_settings').update({ value: '60' }).eq('key', 'ai_request_timeout');
    await svc.from('app_settings').update({ value: 'false' }).eq('key', 'ai_auto_categorize_enabled');
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
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/ai');

    // Not visible with default (none)
    await expect(page.locator('#ai_custom_endpoint_url')).not.toBeVisible();

    // Select custom
    await page.locator('#ai_provider').selectOption('custom');

    // Now visible
    await expect(page.locator('#ai_custom_endpoint_url')).toBeVisible();

    // Switch to openai - hidden again
    await page.locator('#ai_provider').selectOption('openai');
    await expect(page.locator('#ai_custom_endpoint_url')).not.toBeVisible();
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
    await expect(page.getByLabel(/description/i)).toBeVisible();

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
    const firstTicket = page.locator('a[href*="/tickets/"]').first();
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
    const firstTicket = page.locator('a[href*="/tickets/"]').first();
    if (await firstTicket.isVisible()) {
      await firstTicket.click();
      await page.waitForTimeout(2000);

      // Agent should see suggest reply button
      await expect(page.getByTestId('suggest-reply-btn')).toBeVisible();
    }

    // Disable the feature
    await svc.from('app_settings').update({ value: 'false' }).eq('key', 'ai_suggested_reply_enabled');
  });

  test('suggest reply button hidden when feature disabled', async ({ page }) => {
    // Ensure disabled
    const svc = createServiceRoleClient();
    await svc.from('app_settings').update({ value: 'false' }).eq('key', 'ai_suggested_reply_enabled');

    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/agent');

    const firstTicket = page.locator('a[href*="/tickets/"]').first();
    if (await firstTicket.isVisible()) {
      await firstTicket.click();
      await page.waitForTimeout(2000);

      await expect(page.getByTestId('suggest-reply-btn')).not.toBeVisible();
    }
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

    const firstTicket = page.locator('a[href*="/tickets/"]').first();
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

    const firstTicket = page.locator('a[href*="/tickets/"]').first();
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
    const firstTicket = page.locator('a[href*="/tickets/"]').first();
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

    const firstTicket = page.locator('a[href*="/tickets/"]').first();
    if (await firstTicket.isVisible()) {
      await firstTicket.click();
      await page.waitForTimeout(2000);

      await expect(page.getByTestId('generate-kb-article-btn')).not.toBeVisible();
    }
  });
});
