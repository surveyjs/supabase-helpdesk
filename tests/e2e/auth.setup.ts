import { test as setup, expect } from '@playwright/test';

const users = [
  'admin@example.com',
  'alice@example.com',
  'agent.smith@example.com',
  'bob@example.com',
  'dave@example.com',
  'eve@example.com',
];

for (const email of users) {
  const name = email.split('@')[0];
  setup(`authenticate as ${name}`, async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('Password123');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL('/', { timeout: 15000 });
    await page.context().storageState({ path: `.auth/${name}.json` });
  });
}
