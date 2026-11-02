import { test, expect } from './fixtures';

test('home page redirects to login for unauthenticated users', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
});
