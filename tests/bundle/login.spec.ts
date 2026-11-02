import { test, expect } from '@playwright/test';

// Signs in through the bundled stack: browser -> proxy -> /auth/v1 on the app's
// own domain, session cookie shared by browser and server, admin page reachable.
test('administrator signs in and opens the admin area', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(process.env.ADMIN_EMAIL!);
  await page.getByLabel('Password').fill(process.env.ADMIN_PASSWORD!);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
  // /admin redirects to /admin/types; requireAdmin() sends anyone else to /.
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/types/);
  await expect(page.getByRole('heading', { name: 'Manage Ticket Types' })).toBeVisible();
});
