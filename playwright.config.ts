import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });

const isCI = !!process.env.CI;

// Specs that write global settings other specs read (app_settings rows, SLA
// policies, tiers, templates, custom fields). They run first, serially, in
// their own project so no parallel chromium worker reads a half-changed value.
export const GLOBAL_SETTINGS_SPECS =
  /(admin-setup|ai-features|ai-filter|attach-files|attachments|auth-external|csat|inbound-email|knowledge-base|notifications|polish|sla|subscription-tiers|ticket-detail-custom-fields|ticket-layout)\.spec\.ts$/;

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  fullyParallel: true,
  forbidOnly: isCI, // a stray test.only would silently shrink a CI shard
  workers: 4,
  retries: 2,
  // CI: blob reports are merged across shards by the e2e-report job.
  reporter: isCI ? [['blob'], ['github'], ['list']] : 'html',
  use: {
    baseURL: 'http://localhost:3000',
    screenshot: 'only-on-failure',
    trace: isCI ? 'on-first-retry' : 'off',
  },
  projects: [
    {
      name: 'global-settings',
      use: { ...devices['Desktop Chrome'] },
      testMatch: GLOBAL_SETTINGS_SPECS,
      workers: 1,
      fullyParallel: false,
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: GLOBAL_SETTINGS_SPECS,
      dependencies: ['global-settings'],
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      testMatch: /cross-browser\.spec\.ts/,
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testMatch: /cross-browser\.spec\.ts/,
    },
  ],
  webServer: {
    command: 'node tests/e2e/run-server.mjs',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 180_000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      SUPABASE_URL: process.env.SUPABASE_URL!,
      SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY!,
      APP_URL: process.env.APP_URL!,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY!,
      // Required so the inbound-email route (which now fails closed without a
      // secret) can validate the bearer token the tests send.
      INBOUND_EMAIL_WEBHOOK_SECRET: process.env.INBOUND_EMAIL_WEBHOOK_SECRET!,
    },
  },
});
