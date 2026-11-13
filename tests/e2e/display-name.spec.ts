import { test, expect } from './fixtures';
import { createServiceRoleClient } from '../helpers/supabase';
import { loginViaForm } from '../helpers/auth';

// Each test creates (and deletes) its own throwaway user, so no shared state is mutated.
test.describe.configure({ mode: 'default' });

async function createUser(localPart: string, displayName: string) {
  const svc = createServiceRoleClient();
  const email = `${localPart}@example.com`;
  const { data, error } = await svc.auth.admin.createUser({
    email,
    password: 'Password123',
    email_confirm: true,
  });
  if (error) throw new Error(`createUser: ${error.message}`);
  const id = data.user.id;
  const { error: profileErr } = await svc
    .from('profiles')
    .upsert({ id, email, display_name: displayName, role: 'user' });
  if (profileErr) {
    // Don't leak the auth user when the profile can't be written (profile first: no cascade)
    await removeUser(id);
    throw new Error(`createUser profile upsert: ${profileErr.message}`);
  }
  return { id, email };
}

async function removeUser(id: string) {
  const svc = createServiceRoleClient();
  // profiles.id has no ON DELETE CASCADE from auth.users: delete the profile first
  const { error: profileErr } = await svc.from('profiles').delete().eq('id', id);
  if (profileErr) throw new Error(`removeUser profile delete: ${profileErr.message}`);
  const { error } = await svc.auth.admin.deleteUser(id);
  if (error) throw new Error(`removeUser auth delete: ${error.message}`);
}

const banner = (page: import('@playwright/test').Page) => page.getByTestId('display-name-prompt');

test.describe('Display name prompt', () => {
  test('shown on /tickets, absent on /profile; saving hides it and updates the nav', async ({ page }) => {
    const stamp = Date.now();
    const local = `dn-save-${stamp}`;
    const user = await createUser(local, local);
    try {
      await loginViaForm(page, user.email, 'Password123', { showDisplayNamePrompt: true });
      await page.goto('/tickets');
      await expect(banner(page)).toBeVisible();
      await expect(page.getByText("Add your name so others know who they're talking to.")).toBeVisible();
      await page.goto('/profile');
      await expect(page.getByRole('heading', { name: /profile/i }).first()).toBeVisible();
      await expect(banner(page)).toHaveCount(0);

      await page.goto('/tickets');
      await banner(page).getByLabel('Your name').fill('E2E Name');
      await banner(page).getByRole('button', { name: 'Save' }).click();
      await expect(banner(page)).toHaveCount(0);
      await expect(page.getByText('E2E Name').first()).toBeVisible();
    } finally {
      await removeUser(user.id);
    }
  });

  test('"Not now" hides the banner and it stays hidden after reload', async ({ page }) => {
    const local = `dn-skip-${Date.now()}`;
    const user = await createUser(local, local);
    try {
      await loginViaForm(page, user.email, 'Password123', { showDisplayNamePrompt: true });
      await page.goto('/tickets');
      await expect(banner(page)).toBeVisible();
      await banner(page).getByRole('button', { name: 'Not now' }).click();
      await expect(banner(page)).toHaveCount(0);
      await page.reload();
      await expect(page.getByRole('heading', { name: /tickets/i }).first()).toBeVisible();
      await expect(banner(page)).toHaveCount(0);
    } finally {
      await removeUser(user.id);
    }
  });

  test('a user with a real name never sees it', async ({ page }) => {
    const user = await createUser(`dn-real-${Date.now()}`, 'Real Person');
    try {
      await loginViaForm(page, user.email, 'Password123', { showDisplayNamePrompt: true });
      await page.goto('/tickets');
      await expect(page.getByRole('heading', { name: /tickets/i }).first()).toBeVisible();
      await expect(banner(page)).toHaveCount(0);
    } finally {
      await removeUser(user.id);
    }
  });

  test('banner does not overflow at 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const local = `dn-narrow-${Date.now()}`;
    const user = await createUser(local, local);
    try {
      await loginViaForm(page, user.email, 'Password123', { showDisplayNamePrompt: true });
      await page.goto('/tickets');
      await expect(banner(page)).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    } finally {
      await removeUser(user.id);
    }
  });
});
