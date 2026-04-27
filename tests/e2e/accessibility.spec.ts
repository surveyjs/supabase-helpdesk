import { test, expect, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

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
  await expect(page.locator('summary[aria-haspopup="true"]')).toBeVisible({ timeout: 15000 });
}

// Pages that don't require authentication
const publicPages = [
  { name: 'Login', path: '/login' },
  { name: 'Signup', path: '/signup' },
];

// Pages that require a regular user
const userPages = [
  { name: 'My Tickets', path: '/tickets' },
  { name: 'Help Center', path: '/help' },
  { name: 'Profile', path: '/profile' },
];

// Pages that require an agent/admin
const agentPages = [
  { name: 'Agent Dashboard', path: '/agent' },
  { name: 'Notifications', path: '/notifications' },
  { name: 'Canned Responses', path: '/canned-responses' },
  { name: 'KB Management', path: '/kb/manage' },
];

const adminPages = [
  { name: 'Admin Setup', path: '/admin/types' },
  { name: 'Reports', path: '/reports' },
];

test.describe('Accessibility', () => {
  for (const pg of publicPages) {
    test(`${pg.name} has no critical accessibility violations`, async ({ page }) => {
      await page.goto(pg.path);
      await page.waitForLoadState('networkidle');
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa'])
        .analyze();
      const critical = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious',
      );
      expect(critical).toEqual([]);
    });
  }

  test.describe('User pages', () => {
    test.beforeEach(async ({ page }) => {
      await loginAs(page, 'alice@example.com');
    });

    for (const pg of userPages) {
      test(`${pg.name} has no critical accessibility violations`, async ({ page }) => {
        await page.goto(pg.path);
        await page.waitForLoadState('domcontentloaded');
        await page.waitForLoadState('networkidle');
        // Ensure the page <main> has rendered before scanning to avoid mid-hydration violations
        await page.locator('main').first().waitFor({ state: 'visible', timeout: 15000 });
        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa'])
          .analyze();
        const critical = results.violations.filter(
          (v) => v.impact === 'critical' || v.impact === 'serious',
        );
        expect(critical).toEqual([]);
      });
    }
  });

  test.describe('Agent pages', () => {
    test.beforeEach(async ({ page }) => {
      await loginAs(page, 'agent.smith@example.com');
    });

    for (const pg of agentPages) {
      test(`${pg.name} has no critical accessibility violations`, async ({ page }) => {
        await page.goto(pg.path);
        await page.waitForLoadState('networkidle');
        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa'])
          .analyze();
        const critical = results.violations.filter(
          (v) => v.impact === 'critical' || v.impact === 'serious',
        );
        expect(critical).toEqual([]);
      });
    }
  });

  test.describe('Admin pages', () => {
    test.beforeEach(async ({ page }) => {
      await loginAs(page, 'admin@example.com');
    });

    for (const pg of adminPages) {
      test(`${pg.name} has no critical accessibility violations`, async ({ page }) => {
        await page.goto(pg.path);
        await page.waitForLoadState('networkidle');
        const builder = new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa']);
        // Exclude third-party chart containers from scan
        if (pg.path === '/reports') {
          builder.exclude('.recharts-wrapper');
        }
        const results = await builder.analyze();
        const critical = results.violations.filter(
          (v) => v.impact === 'critical' || v.impact === 'serious',
        );
        expect(critical).toEqual([]);
      });
    }
  });
});
