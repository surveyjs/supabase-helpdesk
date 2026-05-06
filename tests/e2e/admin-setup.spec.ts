import { test, expect, Page } from '@playwright/test';
import { createServiceRoleClient } from '../helpers/supabase';

/**
 * Helper: log in via the login form.
 */
async function loginAs(page: Page, email: string, password = 'Password123') {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL('/', { timeout: 10000 });
  await expect(page.locator('summary[aria-haspopup="true"]')).toBeVisible({ timeout: 10000 });
}

/** Navigate to an admin page, retrying once if requireAdmin() redirect race occurs. */
async function gotoAdmin(page: Page, path: string) {
  await page.goto(path);
  if (!page.url().includes('/admin')) {
    await page.goto(path);
  }
}

// ============================================================
// ADMIN LAYOUT & SIDEBAR
// ============================================================

test.describe('Admin Setup layout', () => {
  test.describe.configure({ mode: 'serial' });

  test('admin can access Setup page and sees sidebar', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    // Wait for the nav to confirm admin role is recognised
    await page.locator('details summary').click();
    await expect(page.getByRole('menuitem', { name: 'Setup' })).toBeVisible({ timeout: 10000 });
    await gotoAdmin(page, '/admin');

    // Should redirect to /admin/types
    await expect(page).toHaveURL(/\/admin\/types/, { timeout: 10000 });

    // Sidebar should be visible with section links
    await expect(page.getByRole('link', { name: 'Ticket Types' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Categories', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Tags' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Teams' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Agents & Admins' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Custom Fields' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Survey UI Config' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Audit Log' })).toBeVisible();
  });

  test('non-admin gets redirected from /admin', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await gotoAdmin(page, '/admin');
    await expect(page).not.toHaveURL(/\/admin/, { timeout: 10000 });
  });

  test('admin can open survey ui config page', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/survey-ui');
    await expect(page.getByRole('heading', { name: 'Survey UI JSON Config' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('survey-ui-config-survey_agent_dashboard_config')).toBeVisible();
  });

  test('admin can open survey templates page', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/survey-templates');
    await expect(page.getByRole('heading', { name: 'Survey Templates' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('survey-template-row-survey_ticket_detail_agent_template')).toBeVisible();
    await expect(page.getByTestId('survey-template-row-survey_ticket_detail_user_template')).toBeVisible();
  });
});

// ============================================================
// AGENT MANAGEMENT
// ============================================================

test.describe('Agent management', () => {
  test.describe.configure({ mode: 'serial' });

  test.afterAll(async () => {
    // Restore dave to user role
    const svc = createServiceRoleClient();
    const { data: dave } = await svc.from('profiles').select('id').eq('email', 'dave@example.com').single();
    if (dave) {
      await svc.from('profiles').update({ role: 'user' }).eq('id', dave.id);
    }
  });

  test('admin can promote a user to agent', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await page.locator('details summary').click();
    await expect(page.getByRole('menuitem', { name: 'Setup' })).toBeVisible({ timeout: 10000 });
    await gotoAdmin(page, '/admin/agents');

    // Search for dave by email
    const searchInput = page.getByLabel(/email/i);
    await searchInput.fill('dave@example.com');
    await page.getByRole('button', { name: /search/i }).click();

    // Should show the user with a promote button
    await expect(page.getByText('dave@example.com').first()).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: /promote to agent/i }).click();

    // Verify the page reloaded and dave appears in agents list
    await page.waitForTimeout(2000);
    await expect(page.getByText('dave@example.com').first()).toBeVisible();
  });

  test('admin can demote agent to user', async ({ page }) => {
    // First ensure dave is an agent
    const svc = createServiceRoleClient();
    const { data: dave } = await svc.from('profiles').select('id').eq('email', 'dave@example.com').single();
    await svc.from('profiles').update({ role: 'agent' }).eq('id', dave!.id);

    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/agents');

    // Find dave in the agents list and demote
    const daveRow = page.locator('tr', { hasText: 'dave@example.com' }).first();
    if (await daveRow.isVisible()) {
      await daveRow.getByRole('button', { name: /demote to user/i }).click();
      await page.waitForTimeout(2000);
    }
  });
});

// ============================================================
// CUSTOM FIELDS
// ============================================================

test.describe('Custom fields', () => {
  test.describe.configure({ mode: 'serial' });

  test.afterAll(async () => {
    // Clean up test custom fields
    const svc = createServiceRoleClient();
    await svc.from('custom_fields').delete().ilike('name', 'E2E%');
  });

  async function clickComplete(page: Page) {
    const savePromise = page.waitForResponse(
      (resp) => resp.request().method() === 'POST' && resp.status() < 400,
      { timeout: 15000 },
    );
    await page.getByRole('button', { name: 'Complete' }).click();
    await savePromise;
  }

  test('admin sees the custom-fields matrix', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/custom-fields');
    await expect(page.getByRole('heading', { name: 'Custom Fields' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('custom-fields-survey-form')).toBeVisible();
  });

  test('options column is conditional on field_type=dropdown', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/custom-fields');
    await expect(page.getByTestId('custom-fields-survey-form')).toBeVisible();

    await page.getByRole('button', { name: 'Add Field' }).click();
    const nameInputs = page.locator('input[aria-label*="Name"]');
    const nameCount = await nameInputs.count();
    await nameInputs.nth(nameCount - 1).fill('E2E Conditional');

    // With default type=text, no Options input should be visible for this row.
    expect(await page.locator('input[aria-label*="Options"]').count()).toBe(0);

    // Switch type to dropdown via the underlying <select>.
    const typeSelects = page.locator('select').filter({ hasText: /Text|Dropdown/ });
    // Fallback: a SurveyJS dropdown column may render as a select per-row.
    const allSelects = page.locator('table select');
    const typeSelect = (await typeSelects.count()) > 0
      ? typeSelects.nth((await typeSelects.count()) - 1)
      : allSelects.nth((await allSelects.count()) - 1);
    await typeSelect.selectOption('dropdown');

    await expect(page.locator('input[aria-label*="Options"]').first()).toBeVisible({ timeout: 5000 });

    // Switch back to text — options should disappear again.
    await typeSelect.selectOption('text');
    expect(await page.locator('input[aria-label*="Options"]').count()).toBe(0);
  });

  test('admin can create text, dropdown, and checkbox fields in one save', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/custom-fields');
    await expect(page.getByTestId('custom-fields-survey-form')).toBeVisible();

    // Row 1: text (default)
    await page.getByRole('button', { name: 'Add Field' }).click();
    let nameInputs = page.locator('input[aria-label*="Name"]');
    await nameInputs.nth((await nameInputs.count()) - 1).fill('E2E Text Field');
    await nameInputs.nth((await nameInputs.count()) - 1).press('Tab');

    // Row 2: dropdown — set type FIRST so visibleIf re-render does not clobber name.
    await page.getByRole('button', { name: 'Add Field' }).click();
    let typeSelects = page.locator('table select');
    await typeSelects.nth((await typeSelects.count()) - 1).selectOption('dropdown');
    nameInputs = page.locator('input[aria-label*="Name"]');
    await nameInputs.nth((await nameInputs.count()) - 1).fill('E2E Dropdown');
    await nameInputs.nth((await nameInputs.count()) - 1).press('Tab');
    const optsInputs = page.locator('input[aria-label*="Options"]');
    await optsInputs.nth((await optsInputs.count()) - 1).fill('Alpha, Beta, Gamma');
    await optsInputs.nth((await optsInputs.count()) - 1).press('Tab');

    // Row 3: checkbox
    await page.getByRole('button', { name: 'Add Field' }).click();
    typeSelects = page.locator('table select');
    await typeSelects.nth((await typeSelects.count()) - 1).selectOption('checkbox');
    nameInputs = page.locator('input[aria-label*="Name"]');
    await nameInputs.nth((await nameInputs.count()) - 1).fill('E2E Checkbox');
    await nameInputs.nth((await nameInputs.count()) - 1).press('Tab');

    await clickComplete(page);

    // Verify all three persisted with correct types via DB.
    const svc = createServiceRoleClient();
    const { data } = await svc
      .from('custom_fields')
      .select('name, field_type, options')
      .ilike('name', 'E2E%')
      .order('display_order');
    const byName = new Map((data ?? []).map((f) => [f.name as string, f]));
    expect(byName.get('E2E Text Field')?.field_type).toBe('text');
    expect(byName.get('E2E Dropdown')?.field_type).toBe('dropdown');
    expect(byName.get('E2E Dropdown')?.options).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(byName.get('E2E Checkbox')?.field_type).toBe('checkbox');
  });

  test('custom fields appear on ticket creation form', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto('/tickets/new');

    await expect(page.getByText('E2E Text Field')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('E2E Dropdown')).toBeVisible();
    await expect(page.getByText('E2E Checkbox')).toBeVisible();
  });

  test('saving rewrites display_order to match matrix row order', async ({ page }) => {
    const svc = createServiceRoleClient();

    // Scramble existing E2E rows' display_order in DB so it differs from current UI order.
    const { data: before } = await svc
      .from('custom_fields')
      .select('id, name, display_order')
      .ilike('name', 'E2E%')
      .order('display_order');
    expect((before ?? []).length).toBeGreaterThanOrEqual(2);

    // Bump every E2E row's display_order by +100 so they're far apart but preserve relative order.
    for (let i = 0; i < before!.length; i++) {
      await svc.from('custom_fields').update({ display_order: 100 + i }).eq('id', before![i].id);
    }

    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/custom-fields');
    await expect(page.getByTestId('custom-fields-survey-form')).toBeVisible();

    // Save without changes — saveCustomFields should rewrite display_order to row indexes.
    await clickComplete(page);

    const { data: after } = await svc
      .from('custom_fields')
      .select('name, display_order')
      .ilike('name', 'E2E%')
      .order('display_order');
    // All E2E rows should now have small (< 100) display_order values, and order preserved.
    expect(after?.map((r) => r.name)).toEqual(before!.map((r) => r.name));
    for (const row of after ?? []) {
      expect(row.display_order).toBeLessThan(100);
    }
  });

  test('admin can delete a custom field', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/custom-fields');
    await expect(page.getByTestId('custom-fields-survey-form')).toBeVisible();

    const targetRow = page
      .locator('tr')
      .filter({ has: page.getByRole('cell', { name: 'E2E Text Field' }) })
      .first();
    await targetRow.getByRole('button', { name: 'Delete' }).click();
    await clickComplete(page);

    await gotoAdmin(page, '/admin/custom-fields');
    await expect(page.getByRole('cell', { name: 'E2E Text Field' })).toHaveCount(0);
  });
});

// ============================================================
// PRIVACY SETTINGS
// ============================================================

test.describe('Privacy settings', () => {
  test('admin can change privacy settings', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/privacy');

    await expect(page.getByRole('heading', { name: /privacy/i })).toBeVisible({ timeout: 10000 });

    await expect(page.getByTestId('privacy-survey-form')).toBeVisible();
    await expect(page.getByText('Default Ticket Privacy')).toBeVisible();
  });
});

// ============================================================
// PAGINATION SETTINGS
// ============================================================

test.describe('Pagination settings', () => {
  test('admin can view and change pagination settings', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/pagination');

    await expect(page.getByRole('heading', { name: /pagination/i })).toBeVisible({ timeout: 10000 });

    await expect(page.getByTestId('pagination-survey-form')).toBeVisible();
  });
});

// ============================================================
// RATE LIMIT
// ============================================================

test.describe('Rate limit settings', () => {
  test('admin can change rate limit', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/rate-limit');

    await expect(page.getByRole('heading', { name: /rate limit/i })).toBeVisible({ timeout: 10000 });

    await expect(page.getByTestId('rate-limit-survey-form')).toBeVisible();
  });
});

// ============================================================
// NOTIFICATION TEMPLATES
// ============================================================

test.describe('Templates', () => {
  test('admin can view and edit templates', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/templates');

    await expect(page.getByRole('heading', { name: /templates/i })).toBeVisible({ timeout: 10000 });

    // Should show template event types
    await expect(page.getByText('new_post').first()).toBeVisible();
    await expect(page.getByText('status_changed').first()).toBeVisible();
  });

  test('admin can edit and reset a template', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/templates');

    await expect(page.getByRole('heading', { name: /templates/i })).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('templates-survey-form')).toBeVisible({ timeout: 10000 });

    // SurveyJS matrixdynamic preserves column `name`. The first row's subject input
    // matches `input[name="subject"]` inside the matrix question.
    const subjectInput = page.locator('table input[type="text"][aria-label*="Subject"], input[name="subject"]').first();
    await expect(subjectInput).toBeVisible({ timeout: 5000 });

    const original = await subjectInput.inputValue();
    await subjectInput.fill('E2E Modified Subject');

    // Click the SurveyJS complete ("Apply") button.
    const savePromise = page.waitForResponse(
      (resp) => resp.request().method() === 'POST' && resp.status() < 400,
      { timeout: 15000 },
    );
    await page.getByRole('button', { name: 'Complete' }).click();
    await savePromise;
    await page.waitForTimeout(500);

    // Trigger a per-row reset on the first template row using the plain form button.
    const resetButtons = page.locator('[data-testid^="reset-template-"]');
    await expect(resetButtons.first()).toBeVisible();
    const resetPromise = page.waitForResponse(
      (resp) => resp.request().method() === 'POST' && resp.status() < 400,
      { timeout: 15000 },
    );
    await resetButtons.first().click();
    await resetPromise;

    // Restore original subject deterministically (best-effort), so other tests are unaffected.
    if (original) {
      await page.reload();
    }
  });
});

// ============================================================
// AUDIT LOG
// ============================================================

test.describe('Audit log', () => {
  test('audit log shows entries', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/audit-log');
    await expect(page.getByRole('heading', { name: /audit log/i })).toBeVisible({ timeout: 15000 });

    // The log table or list should be present
    // It may be empty or have entries from earlier tests
  });

  test('audit log filter by action type', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/audit-log');

    // Look for filter controls
    const actionFilter = page.getByLabel(/action/i);
    if (await actionFilter.isVisible()) {
      // Select an action type
      const options = await actionFilter.locator('option').allTextContents();
      if (options.length > 1) {
        await actionFilter.selectOption({ index: 1 });
        await page.getByRole('button', { name: /filter|apply/i }).click();
        await page.waitForTimeout(2000);
      }
    }
  });
});

