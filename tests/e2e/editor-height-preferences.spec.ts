import { test, expect, Page } from '@playwright/test';
import { createServiceRoleClient } from '../helpers/supabase';
import { loginViaForm, gotoAuthed } from '../helpers/auth';

const SEED_PASSWORD = 'Password123';
// Dedicated test user so concurrent specs (which mutate the seeded users'
// editor preferences) cannot race with the assertions in this file.
const TEST_USER_ID = '00000000-0000-0000-0000-000000000911';
const TEST_EMAIL = 'editor-heights-e2e@test.local';

async function resetHeights(): Promise<void> {
  const svc = createServiceRoleClient();
  await svc
    .from('profiles')
    .update({
      editor_view_mode: 'both',
      editor_min_height_px: 300,
      editor_max_height_px: 540,
    })
    .eq('id', TEST_USER_ID);
}

async function loginAs(page: Page): Promise<void> {
  await resetHeights();
  await loginViaForm(page, TEST_EMAIL, SEED_PASSWORD);
}

test.beforeAll(async () => {
  const svc = createServiceRoleClient();
  // Idempotent create — survives partial cleanup from previous failed runs.
  // The auth.users → profiles FK isn't always cascading on local dev, so
  // drop the profile row first to avoid a 500 from auth.admin.deleteUser.
  await svc.from('profiles').delete().eq('id', TEST_USER_ID).then(() => undefined, () => undefined);
  await svc.auth.admin.deleteUser(TEST_USER_ID).catch(() => undefined);
  const { error } = await svc.auth.admin.createUser({
    id: TEST_USER_ID,
    email: TEST_EMAIL,
    password: SEED_PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: 'Editor Heights E2E' },
  });
  if (error) {
    throw new Error(`createUser(${TEST_EMAIL}): ${error.message}`);
  }
  await resetHeights();
});

test.afterAll(async () => {
  const svc = createServiceRoleClient();
  await svc.from('profiles').delete().eq('id', TEST_USER_ID).then(() => undefined, () => undefined);
  await svc.auth.admin.deleteUser(TEST_USER_ID).catch(() => undefined);
});

test.describe('Editor height preferences', () => {
  test.afterEach(async () => {
    await resetHeights();
  });

  test('initial editor renders at the user-configured min height', async ({ page }) => {
    await loginAs(page);

    // Configure non-default heights via the profile form.
    await gotoAuthed(page, '/profile', () => loginAs(page));
    const minInput = page.getByTestId('editor-min-height-input');
    const maxInput = page.getByTestId('editor-max-height-input');
    await expect(minInput).toBeVisible({ timeout: 10000 });
    await minInput.fill('350');
    await maxInput.fill('600');
    await page.getByRole('button', { name: /Save Preference/i }).click();
    await expect(page.getByText('Editor preference saved.')).toBeVisible({ timeout: 10000 });

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
    // Allow a few px of variance for browser/OS font metrics, borders, and
    // sub-pixel rounding across CI runners.
    expect(innerHeight).toBeGreaterThanOrEqual(346);
    expect(innerHeight).toBeLessThanOrEqual(354);
  });

  test('rejects min greater than max with an inline error', async ({ page }) => {
    await loginAs(page);
    await gotoAuthed(page, '/profile', () => loginAs(page));
    await page.getByTestId('editor-min-height-input').fill('800');
    await page.getByTestId('editor-max-height-input').fill('400');
    await expect(
      page.getByText(/Initial height must be less than or equal to maximum height\./i),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /Save Preference/i })).toBeDisabled();
  });
});
