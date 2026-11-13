import { test, expect, Page } from './fixtures';
import { createServiceRoleClient } from '../helpers/supabase';
import { loginViaForm, gotoAuthed } from '../helpers/auth';

const SEED_PASSWORD = 'Password123';

/**
 * A throwaway user per parallel worker slot. The file runs fully parallel, so
 * its two tests (and every --repeat-each copy) run in different workers, each
 * with its own beforeAll/afterAll. With one shared user, one worker's hooks
 * deleted or re-created the user while another worker was signed in as it
 * (500 on save, bounced to /login, "Database error creating new user").
 * parallelIndex is unique among workers running at the same time.
 */
function testUser(): { id: string; email: string } {
  const slot = String(test.info().parallelIndex).padStart(2, '0');
  return {
    id: `00000000-0000-0000-0000-0009110000${slot}`,
    email: `editor-heights-e2e-${slot}@test.local`,
  };
}

async function deleteTestUser(): Promise<void> {
  const { id } = testUser();
  const svc = createServiceRoleClient();
  // profiles → auth.users has no cascade: drop the profile first.
  const { error } = await svc.from('profiles').delete().eq('id', id);
  if (error) throw new Error(`delete profile: ${error.message}`);
  const { error: authErr } = await svc.auth.admin.deleteUser(id);
  if (authErr && authErr.status !== 404) throw new Error(`deleteUser: ${authErr.message}`);
}

async function ensureTestUser(): Promise<void> {
  const { id, email } = testUser();
  const svc = createServiceRoleClient();
  const { data: existing } = await svc.auth.admin.getUserById(id);
  if (existing?.user) {
    const { error } = await svc.auth.admin.updateUserById(id, {
      email,
      password: SEED_PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: 'Editor Heights E2E' },
    });
    if (error) throw new Error(`updateUserById(${email}): ${error.message}`);
  } else {
    const { error } = await svc.auth.admin.createUser({
      id,
      email,
      password: SEED_PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: 'Editor Heights E2E' },
    });
    if (error) throw new Error(`createUser(${email}): ${error.message}`);
  }

  const { error } = await svc.from('profiles').upsert({
    id,
    email,
    display_name: 'Editor Heights E2E',
    role: 'user',
    editor_view_mode: 'both',
    editor_min_height_px: 300,
    editor_max_height_px: 540,
  });
  if (error) throw new Error(`upsert profile: ${error.message}`);
}

async function resetHeights(): Promise<void> {
  const svc = createServiceRoleClient();
  const { error } = await svc
    .from('profiles')
    .update({
      editor_view_mode: 'both',
      editor_min_height_px: 300,
      editor_max_height_px: 540,
    })
    .eq('id', testUser().id);
  if (error) throw new Error(`reset heights: ${error.message}`);
}

async function loginAs(page: Page): Promise<void> {
  await ensureTestUser();
  await resetHeights();
  await loginViaForm(page, testUser().email, SEED_PASSWORD);
}

test.beforeAll(async () => {
  // Start from a clean user even if a previous run died before afterAll.
  await deleteTestUser();
  await ensureTestUser();
});

test.afterAll(async () => {
  await deleteTestUser();
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
