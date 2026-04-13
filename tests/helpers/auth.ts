import { Page, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const AUTH_DIR = path.resolve(__dirname, '..', '..', '.auth');

/**
 * Fast login using cached storageState from auth.setup.ts.
 * Injects auth cookies and navigates to '/' — much faster than form-based login.
 * Falls back to form-based login if no cached state exists (e.g. for dynamic test users).
 */
export async function loginAs(page: Page, email: string, password = 'Password123') {
  const name = email.split('@')[0];
  const stateFile = path.join(AUTH_DIR, `${name}.json`);

  if (fs.existsSync(stateFile)) {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    await page.context().clearCookies();
    await page.context().addCookies(state.cookies);
    // Set localStorage for each origin
    for (const origin of state.origins ?? []) {
      if (origin.localStorage?.length) {
        await page.goto(origin.origin);
        await page.evaluate((items: { name: string; value: string }[]) => {
          for (const item of items) {
            localStorage.setItem(item.name, item.value);
          }
        }, origin.localStorage);
      }
    }
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible({ timeout: 10000 });
    return;
  }

  // Fallback: form-based login for users not in auth.setup.ts
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL('/', { timeout: 10000 });
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible({ timeout: 10000 });
}

/**
 * Navigate to an admin page, retrying once if requireAdmin() redirect race occurs.
 */
export async function gotoAdmin(page: Page, adminPath: string) {
  await page.goto(adminPath);
  if (!page.url().includes('/admin')) {
    await page.goto(adminPath);
  }
  await expect(page.getByRole('navigation', { name: 'Admin navigation' })).toBeVisible({ timeout: 10000 });
}
