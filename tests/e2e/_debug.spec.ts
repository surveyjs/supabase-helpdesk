import { test } from '@playwright/test';
import { loginViaForm } from '../helpers/auth';
import * as fs from 'fs';

async function gotoAdmin(page: any, path: string) {
  await page.goto(path);
  try { await page.waitForURL(/\/admin\//, { timeout: 5000 }); }
  catch { await page.goto(path); await page.waitForURL(/\/admin\//, { timeout: 10000 }); }
}

test('debug inbound', async ({ page }) => {
  await loginViaForm(page, 'admin@example.com', 'Password123');
  await gotoAdmin(page, '/admin/inbound-email');
  const form = page.getByTestId('inbound-email-survey-form');
  await form.waitFor();
  const q = form.locator('.sd-question[data-name="inbound_email_enabled"]');
  await q.scrollIntoViewIfNeeded();
  fs.writeFileSync('_bool.html', await q.innerHTML(), 'utf8');
});
