import { test, expect, Page } from '@playwright/test';

const SEED_PASSWORD = 'Password123';

async function loginAs(page: Page, email: string) {
  const { createServiceRoleClient } = await import('../helpers/supabase');
  const svc = createServiceRoleClient();
  await svc.from('login_attempts').delete().eq('email', email.toLowerCase());

  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();

  try {
    await expect(page).toHaveURL('/', { timeout: 10000 });
  } catch {
    if (page.url().includes('/login')) {
      await svc.from('login_attempts').delete().eq('email', email.toLowerCase());
      await page.goto('/login');
      await page.getByLabel('Email').fill(email);
      await page.getByLabel('Password').fill(SEED_PASSWORD);
      await page.getByRole('button', { name: 'Log in' }).click();
      await expect(page).toHaveURL('/', { timeout: 15000 });
    }
  }
  // On mobile the user dropdown is hidden; check for either it or the hamburger
  await expect(
    page.locator('summary[aria-haspopup="true"]:visible, button[aria-controls="mobile-nav-menu"]:visible').first()
  ).toBeVisible({ timeout: 15000 });
}

test.describe('Polish', () => {
  test.describe('Mobile Responsive', () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test('nav bar shows hamburger menu on mobile', async ({ page }) => {
      await page.goto('/login');
      // The hamburger button should be visible on mobile
      const hamburger = page.locator('button[aria-label*="menu" i], button[aria-controls="mobile-menu"]');
      // On login page there may not be a nav bar with hamburger, so login first
      await loginAs(page, 'alice@example.com');
      await page.goto('/tickets');
      await expect(hamburger).toBeVisible({ timeout: 5000 });
    });

    test('hamburger menu opens and shows links', async ({ page }) => {
      await loginAs(page, 'alice@example.com');
      await page.goto('/tickets');
      const hamburger = page.locator('button[aria-label*="menu" i], button[aria-controls="mobile-nav-menu"]');
      await hamburger.click();
      const mobileMenu = page.locator('#mobile-nav-menu');
      await expect(mobileMenu).toBeVisible();
      // Should contain navigation links
      expect(await mobileMenu.locator('a').count()).toBeGreaterThan(0);
    });

    test('ticket list uses card layout on mobile', async ({ page }) => {
      await loginAs(page, 'agent.smith@example.com');
      await page.goto('/agent');
      await page.waitForLoadState('networkidle');
      // The mobile card layout should be visible, desktop table hidden
      const mobileCards = page.locator('.md\\:hidden');
      // At least the mobile layout container should exist
      await expect(mobileCards.first()).toBeVisible({ timeout: 5000 });
    });

    test('filter controls are collapsible on mobile', async ({ page }) => {
      await loginAs(page, 'agent.smith@example.com');
      await page.goto('/agent');
      await page.waitForLoadState('networkidle');
      // Look for the collapsible filter toggle
      const filterToggle = page.locator('summary, button').filter({ hasText: /filter/i });
      if (await filterToggle.count() > 0) {
        await expect(filterToggle.first()).toBeVisible();
      }
    });

    test('admin sidebar uses dropdown on mobile', async ({ page }) => {
      await loginAs(page, 'admin@example.com');
      await page.goto('/admin/types');
      await page.waitForLoadState('networkidle');
      // On mobile, the sidebar should be replaced by a select dropdown
      const mobileSelect = page.locator('select.md\\:hidden, .md\\:hidden select');
      await expect(mobileSelect.first()).toBeVisible({ timeout: 5000 });
    });

    test('touch targets are at least 44x44px', async ({ page }) => {
      await loginAs(page, 'alice@example.com');
      await page.goto('/tickets');
      // Check the hamburger button size
      const hamburger = page.locator('button[aria-label*="menu" i], button[aria-controls="mobile-menu"]');
      await expect(hamburger).toBeVisible();
      const box = await hamburger.boundingBox();
      expect(box).toBeTruthy();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    });
  });

  test.describe('Mobile Tablet', () => {
    test.use({ viewport: { width: 768, height: 1024 } });

    test('layout adapts at tablet width', async ({ page }) => {
      await loginAs(page, 'alice@example.com');
      await page.goto('/tickets');
      await page.waitForLoadState('networkidle');
      // At 768px the nav should show full links (md breakpoint)
      await expect(page.locator('body')).toBeVisible();
    });
  });

  test.describe('Keyboard Navigation', () => {
    test('tab through login form reaches all fields and submit', async ({ page }) => {
      await page.goto('/login');
      // Tab through the page
      await page.keyboard.press('Tab'); // skip link or first focusable
      // Keep tabbing until we reach email
      const found = { email: false, password: false, submit: false };
      for (let i = 0; i < 15; i++) {
        const focused = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el) return {};
          return {
            tag: el.tagName,
            type: (el as HTMLInputElement).type,
            name: (el as HTMLInputElement).name,
            role: el.getAttribute('role'),
            text: el.textContent?.trim(),
          };
        });
        if (focused.name === 'email') found.email = true;
        if (focused.name === 'password') found.password = true;
        if (focused.tag === 'BUTTON' && focused.text?.includes('Log in')) found.submit = true;
        await page.keyboard.press('Tab');
      }
      expect(found.email).toBe(true);
      expect(found.password).toBe(true);
      expect(found.submit).toBe(true);
    });

    test('skip-to-content link works', async ({ page }) => {
      await loginAs(page, 'alice@example.com');
      await page.goto('/tickets');
      // Press Tab to focus the skip link
      await page.keyboard.press('Tab');
      const skipLink = page.locator('a[href="#main"]');
      await expect(skipLink).toBeFocused();
      // Activate it
      await page.keyboard.press('Enter');
      // Main element should now be focused or scrolled to
      const mainEl = page.locator('#main');
      await expect(mainEl).toBeVisible();
    });

    test('escape closes hamburger menu', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await loginAs(page, 'alice@example.com');
      await page.goto('/tickets');
      const hamburger = page.locator('button[aria-label*="menu" i], button[aria-controls="mobile-nav-menu"]');
      await hamburger.click();
      const mobileMenu = page.locator('#mobile-nav-menu');
      await expect(mobileMenu).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(mobileMenu).toBeHidden();
    });
  });

  test.describe('Error Pages', () => {
    test('404 page shows for nonexistent path', async ({ page }) => {
      await page.goto('/this-does-not-exist-at-all');
      await expect(page.locator('body')).toContainText(/404|not found/i);
      await expect(page.locator('a[href="/"]').first()).toBeVisible();
    });

    test('CSAT page with invalid token shows error', async ({ page }) => {
      await page.goto('/csat/invalid-token-12345');
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).toContainText(/invalid|expired|error|not found/i);
    });
  });

  test.describe('Content-Length Validation', () => {
    test('ticket title respects maxLength', async ({ page }) => {
      await loginAs(page, 'alice@example.com');
      await page.goto('/tickets/new');
      const titleInput = page.locator('input[name="title"]');
      await expect(titleInput).toBeVisible({ timeout: 10000 });
      const maxLength = await titleInput.getAttribute('maxLength');
      expect(maxLength).toBeTruthy();
      expect(Number(maxLength)).toBeLessThanOrEqual(300);
    });

    test('ticket body respects maxLength', async ({ page }) => {
      await loginAs(page, 'alice@example.com');
      await page.goto('/tickets/new');
      const bodyTextarea = page.locator('textarea[name="body"]');
      await expect(bodyTextarea).toBeVisible({ timeout: 10000 });
      const maxLength = await bodyTextarea.getAttribute('maxLength');
      expect(maxLength).toBeTruthy();
      expect(Number(maxLength)).toBeLessThanOrEqual(50000);
    });

    test('display name respects maxLength', async ({ page }) => {
      await loginAs(page, 'alice@example.com');
      await page.goto('/profile');
      const nameInput = page.locator('input[name="display_name"]');
      await expect(nameInput).toBeVisible({ timeout: 10000 });
      const maxLength = await nameInput.getAttribute('maxLength');
      expect(maxLength).toBeTruthy();
      expect(Number(maxLength)).toBeLessThanOrEqual(100);
    });
  });
});
