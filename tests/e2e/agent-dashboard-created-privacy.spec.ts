import { test, expect } from './fixtures';
import { createServiceRoleClient } from '../helpers/supabase';
import { loginViaForm } from '../helpers/auth';
import { selectSurveyDropdown } from '../helpers/surveyjs';
import { applyFilters, openViewsFilters } from '../helpers/agent-dashboard';

// #113: Created date range and Visibility (private/public) filters on /agent.

const MARK = `CreatedPrivacy${Date.now()}${Math.floor(Math.random() * 1000)}`;
const OLD_PUBLIC = `E2E ${MARK} old public`;
const NEW_PRIVATE = `E2E ${MARK} new private`;

test.describe('Agent dashboard: Created and Visibility filters', () => {
  test.beforeAll(async () => {
    const admin = createServiceRoleClient();
    const { data: alice } = await admin.from('profiles').select('id').eq('email', 'alice@example.com').single();
    const { data: type } = await admin.from('ticket_types').select('id').limit(1).single();
    const { error } = await admin.from('tickets').insert([
      {
        title: OLD_PUBLIC, slug: `e2e-${MARK.toLowerCase()}-old`, creator_id: alice!.id, type_id: type!.id,
        is_private: false, created_at: '2020-01-15T10:00:00Z',
      },
      {
        title: NEW_PRIVATE, slug: `e2e-${MARK.toLowerCase()}-new`, creator_id: alice!.id, type_id: type!.id,
        is_private: true,
      },
    ]);
    if (error) throw new Error(error.message);
  });

  test.afterAll(async () => {
    const admin = createServiceRoleClient();
    await admin.from('tickets').delete().in('title', [OLD_PUBLIC, NEW_PRIVATE]);
  });

  test('privacy and a custom created range narrow the list', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginViaForm(page, 'agent.smith@example.com');
    const table = page.getByTestId('agent-ticket-table');

    await page.goto(`/agent?q=${MARK}&privacy=private`);
    await expect(table.getByText(NEW_PRIVATE)).toBeVisible({ timeout: 20000 });
    await expect(table.getByText(OLD_PUBLIC)).toHaveCount(0);

    await page.goto(`/agent?q=${MARK}&created=custom&created_from=2020-01-01&created_to=2020-01-31`);
    await expect(table.getByText(OLD_PUBLIC)).toBeVisible({ timeout: 20000 });
    await expect(table.getByText(NEW_PRIVATE)).toHaveCount(0);

    await page.goto(`/agent?q=${MARK}&created=30d`);
    await expect(table.getByText(NEW_PRIVATE)).toBeVisible({ timeout: 20000 });
    await expect(table.getByText(OLD_PUBLIC)).toHaveCount(0);
  });

  test('the filter panel offers Visibility and applies it', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginViaForm(page, 'agent.smith@example.com');
    await page.goto(`/agent?q=${MARK}`);
    await openViewsFilters(page);
    const panel = page.getByTestId('views-and-filters-panel');
    await selectSurveyDropdown(panel, 'privacy', 'Public');
    await applyFilters(page, /privacy=public/);
    await expect(page.getByTestId('agent-ticket-table').getByText(OLD_PUBLIC)).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('agent-ticket-table').getByText(NEW_PRIVATE)).toHaveCount(0);
  });
});
