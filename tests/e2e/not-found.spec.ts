import { test, expect } from './fixtures';
import { loginViaForm } from '../helpers/auth';

test.describe('404 pages for signed-in users', () => {
  for (const path of ['/tickets/999999/x', '/no-such-page']) {
    test(`signed-in user sees 404 page for ${path}`, async ({ page }) => {
      await loginViaForm(page, 'alice@example.com');
      await page.goto(path);
      await expect(page.getByRole('heading', { name: /404/ })).toBeVisible();
      await expect(page.getByText('500 — Something Went Wrong')).toHaveCount(0);
    });
  }
});
