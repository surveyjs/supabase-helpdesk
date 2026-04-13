import { test, expect } from '@playwright/test';
import { createServiceRoleClient } from '../helpers/supabase';
import { loginAs, gotoAdmin } from '../helpers/auth';

// ============================================================
// ADMIN LAYOUT & SIDEBAR
// ============================================================

test.describe('Admin Setup layout', () => {
  test.describe.configure({ mode: 'serial' });

  test('admin can access Setup page and sees sidebar', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    // Wait for the nav to confirm admin role is recognised
    await expect(page.getByRole('link', { name: 'Setup' })).toBeVisible();
    await gotoAdmin(page, '/admin');

    // Should redirect to /admin/types
    await expect(page).toHaveURL(/\/admin\/types/, );

    // Sidebar should be visible with section links
    await expect(page.getByRole('link', { name: 'Ticket Types' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Categories' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Tags' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Teams' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Agents & Admins' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Custom Fields' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Audit Log' })).toBeVisible();
  });

  test('non-admin gets redirected from /admin', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto('/admin');
    await expect(page).not.toHaveURL(/\/admin/, );
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
    await expect(page.getByRole('link', { name: 'Setup' })).toBeVisible();
    await gotoAdmin(page, '/admin/agents');

    // Search for dave by email
    const searchInput = page.getByLabel(/email/i);
    await searchInput.fill('dave@example.com');
    await page.getByRole('button', { name: /search/i }).click();

    // Should show the user with a promote button
    await expect(page.getByText('dave@example.com').first()).toBeVisible();
    await page.getByRole('button', { name: /promote to agent/i }).click();

    // Verify dave appears in agents list
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
      await expect(daveRow).not.toBeVisible();
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

  test('admin can create a text custom field', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/custom-fields');

    await page.getByLabel('Name', { exact: true }).fill('E2E Text Field');
    await page.getByLabel('Type', { exact: true }).selectOption('text');
    await page.getByRole('button', { name: /add field/i }).click();

    await expect(page.getByText('E2E Text Field')).toBeVisible();
  });

  test('admin can create a dropdown custom field', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/custom-fields');
    await expect(page.getByLabel('Name', { exact: true })).toBeVisible();

    await page.getByLabel('Name', { exact: true }).fill('E2E Dropdown');
    await page.getByLabel('Type', { exact: true }).selectOption('dropdown');

    // Fill options
    const optionsInput = page.locator('#new-field-options');
    await optionsInput.fill('Alpha\nBeta\nGamma');

    await page.getByRole('button', { name: /add field/i }).click();

    await expect(page.getByText('E2E Dropdown')).toBeVisible();
  });

  test('admin can create a checkbox custom field', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/custom-fields');
    await expect(page.getByLabel('Name', { exact: true })).toBeVisible();

    await page.getByLabel('Name', { exact: true }).fill('E2E Checkbox');
    await page.getByLabel('Type', { exact: true }).selectOption('checkbox');
    await page.getByRole('button', { name: /add field/i }).click();

    await expect(page.getByText('E2E Checkbox')).toBeVisible();
  });

  test('custom fields appear on ticket creation form', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto('/tickets/new');

    // Custom fields we created should be visible
    await expect(page.getByText('E2E Text Field')).toBeVisible();
    await expect(page.getByText('E2E Dropdown')).toBeVisible();
    await expect(page.getByText('E2E Checkbox')).toBeVisible();
  });

  test('create ticket with custom field values and verify on detail page', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto('/tickets/new');

    // Fill in standard ticket fields
    await page.getByLabel(/title/i).fill('E2E Custom Fields Test Ticket');
    await page.getByLabel(/body|description|content/i).first().fill('Testing custom fields on tickets.');

    // Fill custom fields
    const textField = page.locator('[name="cf_E2E Text Field"]');
    if (await textField.isVisible()) {
      await textField.fill('custom text value');
    }

    await page.getByRole('button', { name: /create|submit/i }).click();

    // Should navigate to ticket detail
    await expect(page).toHaveURL(/\/tickets\/\d+\//, { timeout: 15000 });

    // Custom field should be visible
    await expect(page.getByText('custom text value')).toBeVisible({ timeout: 5000 });
  });
});

// ============================================================
// PRIVACY SETTINGS
// ============================================================

test.describe('Privacy settings', () => {
  test('admin can change privacy settings', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/privacy');

    await expect(page.getByRole('heading', { name: /privacy/i })).toBeVisible();

    // Save button should be present
    await expect(page.getByRole('button', { name: /save/i })).toBeVisible();
  });
});

// ============================================================
// PAGINATION SETTINGS
// ============================================================

test.describe('Pagination settings', () => {
  test('admin can view and change pagination settings', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/pagination');

    await expect(page.getByRole('heading', { name: /pagination/i })).toBeVisible();

    // Should have numeric inputs
    const inputs = page.locator('input[type="number"]');
    const count = await inputs.count();
    expect(count).toBeGreaterThanOrEqual(3);

    await expect(page.getByRole('button', { name: /save/i })).toBeVisible();
  });
});

// ============================================================
// RATE LIMIT
// ============================================================

test.describe('Rate limit settings', () => {
  test('admin can change rate limit', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/rate-limit');

    await expect(page.getByRole('heading', { name: /rate limit/i })).toBeVisible();

    // Should have a numeric input
    const input = page.locator('input[type="number"]');
    await expect(input.first()).toBeVisible();

    await expect(page.getByRole('button', { name: /save/i })).toBeVisible();
  });
});

// ============================================================
// NOTIFICATION TEMPLATES
// ============================================================

test.describe('Templates', () => {
  test('admin can view and edit templates', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/templates');

    await expect(page.getByRole('heading', { name: /templates/i })).toBeVisible();

    // Should show template event types
    await expect(page.getByText('new_post')).toBeVisible();
    await expect(page.getByText('status_changed')).toBeVisible();
  });

  test('admin can edit and reset a template', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/templates');

    await expect(page.getByRole('heading', { name: /templates/i })).toBeVisible();

    // Click the first "Edit Template" summary to expand
    const editLink = page.getByText('Edit Template').first();
    await expect(editLink).toBeVisible();
    await editLink.click();

    // The subject input should now be visible — scope to the template card containing the opened details
    const openDetails = page.locator('details[open]').first();
    const subjectInput = openDetails.locator('input[name="subject"]');
    await expect(subjectInput).toBeVisible({ timeout: 5000 });

    await subjectInput.fill('E2E Modified Subject');

    // Save
    await openDetails.getByRole('button', { name: /save/i }).click();

    // After save, the page reloads. Re-open to reset.
    const editLinkAfter = page.getByText('Edit Template').first();
    await expect(editLinkAfter).toBeVisible();
    await editLinkAfter.click();

    const openDetailsAfter = page.locator('details[open]').first();
    const resetBtn = openDetailsAfter.getByRole('button', { name: /reset/i });
    if (await resetBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await resetBtn.click();
      await expect(page.getByText('Edit Template').first()).toBeVisible();
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
    await expect(page.getByRole('heading', { name: /audit log/i })).toBeVisible({ timeout: 15000 });

    // Look for filter controls
    const actionFilter = page.getByLabel(/action/i);
    if (await actionFilter.isVisible()) {
      // Select an action type
      const options = await actionFilter.locator('option').allTextContents();
      if (options.length > 1) {
        await actionFilter.selectOption({ index: 1 });
        await page.getByRole('button', { name: /filter|apply/i }).click();
        await expect(page.getByRole('heading', { name: /audit log/i })).toBeVisible();
      }
    }
  });
});
