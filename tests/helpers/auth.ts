import { Page, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const AUTH_DIR = path.resolve(__dirname, '..', '..', '.auth');

/**
 * Fast login using cached storageState from auth.setup.ts.
 * Injects auth cookies and navigates to '/' — much faster than form-based login.
 * If cookies are stale (middleware redirects to /login), falls back to form login.
 * Falls back to form-based login if no cached state exists (e.g. for dynamic test users).
 */
export async function loginAs(page: Page, email: string, password = 'Password123') {
  const name = email.split('@')[0];
  const stateFile = path.join(AUTH_DIR, `${name}.json`);

  if (fs.existsSync(stateFile)) {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    await page.context().clearCookies();
    await page.context().addCookies(state.cookies);
    await page.goto('/');
    // If cookies were stale, middleware redirects to /login — fall back to form login
    if (page.url().includes('/login')) {
      await page.getByLabel('Email').fill(email);
      await page.getByLabel('Password').fill(password);
      await page.getByRole('button', { name: 'Log in' }).click();
      await expect(page).toHaveURL('/', { timeout: 15000 });
    }
    return;
  }

  // No cached state — full form-based login
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL('/', { timeout: 15000 });
}

/**
 * Navigate to an admin page, retrying once if requireAdmin() redirect race occurs.
 */
export async function gotoAdmin(page: Page, adminPath: string) {
  await page.goto(adminPath);
  if (!page.url().includes('/admin')) {
    await page.goto(adminPath);
  }
  await expect(page.getByRole('navigation', { name: 'Admin navigation' })).toBeVisible();
}
