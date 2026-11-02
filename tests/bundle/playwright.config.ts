import { defineConfig, devices } from '@playwright/test';

// The deploy-bundle smoke (.github/scripts/bundle-e2e.sh): a running installation
// at BASE_URL, no webServer, no seed data.
export default defineConfig({
  testDir: '.',
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: { baseURL: process.env.BASE_URL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
