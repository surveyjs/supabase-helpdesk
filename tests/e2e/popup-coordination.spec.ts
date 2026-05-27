import { test, expect, Page } from '@playwright/test';
import { loginViaForm } from '../helpers/auth';

async function loginAs(page: Page, email: string, password = 'Password123') {
  await loginViaForm(page, email, password);
}

const userMenuSummary = (page: Page) =>
  page.locator('details > summary[aria-haspopup="true"]').first();

const userMenuDetails = (page: Page) =>
  page.locator('details:has(> summary[aria-haspopup="true"])').first();

const notificationBell = (page: Page) => page.getByLabel(/^Notifications/);

// "Mark all as read" / "View all" are unique to the open notification dropdown.
const notificationDropdownMarker = (page: Page) =>
  page.getByText('Mark all as read');

async function openUserMenu(page: Page) {
  const summary = userMenuSummary(page);
  await expect(summary).toBeVisible({ timeout: 15000 });
  await summary.click();
  const details = userMenuDetails(page);
  if (!(await details.evaluate((el) => (el as HTMLDetailsElement).open))) {
    await details.evaluate((el) => ((el as HTMLDetailsElement).open = true));
  }
}

async function isUserMenuOpen(page: Page): Promise<boolean> {
  return userMenuDetails(page).evaluate((el) => (el as HTMLDetailsElement).open);
}

// ============================================================
// POPUP COORDINATION — issue #73
// Opening one popup must close any other open popup.
// ============================================================

test.describe('Popup coordination', () => {
  test.describe.configure({ mode: 'serial' });

  test('opening notifications closes the user menu', async ({ page }) => {
    await loginAs(page, 'alice@example.com');

    await openUserMenu(page);
    await expect(page.getByRole('menuitem', { name: 'Profile' })).toBeVisible({ timeout: 10000 });
    expect(await isUserMenuOpen(page)).toBe(true);

    await notificationBell(page).click();
    await expect(notificationDropdownMarker(page)).toBeVisible({ timeout: 10000 });

    // The user menu should have closed.
    expect(await isUserMenuOpen(page)).toBe(false);
    await expect(page.getByRole('menuitem', { name: 'Profile' })).toBeHidden();
  });

  test('opening the user menu closes the notifications dropdown', async ({ page }) => {
    await loginAs(page, 'alice@example.com');

    await notificationBell(page).click();
    await expect(notificationDropdownMarker(page)).toBeVisible({ timeout: 10000 });

    await openUserMenu(page);
    await expect(page.getByRole('menuitem', { name: 'Profile' })).toBeVisible({ timeout: 10000 });

    // The notification dropdown should have closed.
    await expect(notificationDropdownMarker(page)).toBeHidden();
  });

  test('Escape closes the user menu', async ({ page }) => {
    await loginAs(page, 'alice@example.com');

    await openUserMenu(page);
    expect(await isUserMenuOpen(page)).toBe(true);

    await page.keyboard.press('Escape');
    await expect.poll(() => isUserMenuOpen(page), { timeout: 5000 }).toBe(false);
  });

  test('clicking outside closes the user menu', async ({ page }) => {
    await loginAs(page, 'alice@example.com');

    await openUserMenu(page);
    expect(await isUserMenuOpen(page)).toBe(true);

    // Click in the page body, away from the dropdown.
    await page.locator('main#main').click({ position: { x: 10, y: 10 } });
    await expect.poll(() => isUserMenuOpen(page), { timeout: 5000 }).toBe(false);
  });
});
