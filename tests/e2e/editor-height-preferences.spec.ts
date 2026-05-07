import { test, expect, Page } from '@playwright/test';
import { createServiceRoleClient } from '../helpers/supabase';

const SEED_PASSWORD = 'Password123';
const TEST_EMAIL = 'alice@example.com';

async function loginAs(page: Page, email: string) {
  const svc = createServiceRoleClient();

  // Reset to defaults so each run starts deterministic.
  await svc
    .from('profiles')
    .update({
      editor_view_mode: 'both',
      editor_min_height_px: 300,
      editor_max_height_px: 540,
    })
    .eq('email', email.toLowerCase());

  await svc.from('app_settings').update({ value: 'built-in' }).eq('key', 'auth_mode');
  await svc.from('login_attempts').delete().eq('email', email.toLowerCase());

  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL('/', { timeout: 15000 });
}

test.describe('Editor height preferences', () => {
  test.afterEach(async () => {
    const svc = createServiceRoleClient();
    await svc
      .from('profiles')
      .update({
        editor_view_mode: 'both',
        editor_min_height_px: 300,
        editor_max_height_px: 540,
      })
      .eq('email', TEST_EMAIL.toLowerCase());
  });

  test('initial editor renders at the user-configured min height', async ({ page }) => {
    await loginAs(page, TEST_EMAIL);

    // Configure non-default heights via the profile form.
    await page.goto('/profile');
    const minInput = page.getByTestId('editor-min-height-input');
    const maxInput = page.getByTestId('editor-max-height-input');
    await expect(minInput).toBeVisible({ timeout: 10000 });
    await minInput.fill('350');
    await maxInput.fill('600');
    await page.getByRole('button', { name: /Save Preference/i }).click();
    await expect(page.getByText('Editor preference saved.')).toBeVisible();

    // Reload — values persist.
    await page.reload();
    await expect(page.getByTestId('editor-min-height-input')).toHaveValue('350');
    await expect(page.getByTestId('editor-max-height-input')).toHaveValue('600');

    // Open the new ticket page and inspect the editor wrapper height.
    await page.goto('/tickets/new');
    const editor = page.getByTestId('markdown-editor').first();
    await expect(editor).toBeVisible({ timeout: 10000 });
    const innerHeight = await editor.locator('.rc-md-editor').first().evaluate(
      (el) => (el as HTMLElement).getBoundingClientRect().height,
    );
    expect(Math.round(innerHeight)).toBe(350);
  });

  test('rejects min greater than max with an inline error', async ({ page }) => {
    await loginAs(page, TEST_EMAIL);
    await page.goto('/profile');
    await page.getByTestId('editor-min-height-input').fill('800');
    await page.getByTestId('editor-max-height-input').fill('400');
    await expect(
      page.getByText(/Initial height must be less than or equal to maximum height\./i),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /Save Preference/i })).toBeDisabled();
  });
});
