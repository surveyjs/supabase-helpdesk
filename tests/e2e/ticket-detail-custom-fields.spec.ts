import { test, expect, Page } from '@playwright/test';
import { createServiceRoleClient } from '../helpers/supabase';
import { loginViaForm } from '../helpers/auth';
import {
  waitForSidebarSurveyAutosave,
} from '../helpers/surveyjs';

async function loginAs(page: Page, email: string, password = 'Password123') {
  await loginViaForm(page, email, password);
}

const TEST_CF_TEXT = 'E2EAutoText';
const TEST_CF_DROPDOWN = 'E2EAutoDrop';

async function seedTestFields() {
  const svc = createServiceRoleClient();
  await svc.from('custom_fields').delete().ilike('name', 'E2EAuto%');
  await svc.from('custom_fields').insert([
    {
      name: TEST_CF_TEXT,
      field_type: 'text',
      is_required: false,
      options: null,
      default_value: null,
      display_order: 9001,
    },
    {
      name: TEST_CF_DROPDOWN,
      field_type: 'dropdown',
      is_required: false,
      options: ['Alpha', 'Beta'],
      default_value: null,
      display_order: 9002,
    },
  ]);
}

async function cleanupTestFields() {
  const svc = createServiceRoleClient();
  await svc.from('custom_fields').delete().ilike('name', 'E2EAuto%');
  // Reset wrapper toggles to default true.
  for (const key of [
    'survey_ticket_detail_agent_template',
    'survey_ticket_detail_user_template',
  ]) {
    const { data: row } = await svc
      .from('app_settings')
      .select('value')
      .eq('key', key)
      .single();
    if (!row?.value) continue;
    try {
      const parsed = JSON.parse(row.value as string);
      if (parsed && typeof parsed === 'object' && parsed.autoGenerateCustomFields !== true) {
        parsed.autoGenerateCustomFields = true;
        await svc
          .from('app_settings')
          .update({ value: JSON.stringify(parsed) })
          .eq('key', key);
      }
    } catch {
      /* ignore */
    }
  }
}

async function getAliceTicketUrl(): Promise<{ url: string; id: number }> {
  const svc = createServiceRoleClient();
  const { data: alice } = await svc
    .from('profiles')
    .select('id')
    .eq('email', 'alice@example.com')
    .single();
  const { data: ticket } = await svc
    .from('tickets')
    .select('id, slug')
    .eq('creator_id', alice!.id)
    .order('id', { ascending: false })
    .limit(1)
    .single();
  return { url: `/tickets/${ticket!.id}/${ticket!.slug}`, id: ticket!.id as number };
}

test.describe('Ticket detail custom fields (SurveyJS)', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    await seedTestFields();
  });

  test.afterAll(async () => {
    await cleanupTestFields();
  });

  test('owner can edit auto-generated custom-field question and it autosaves', async ({ page }) => {
    const { url, id } = await getAliceTicketUrl();
    const svc = createServiceRoleClient();
    await svc.from('tickets').update({ custom_fields: {} }).eq('id', id);

    await loginAs(page, 'alice@example.com');
    await page.goto(url);

    const survey = page.getByTestId('ticket-sidebar-survey');
    await expect(survey).toBeVisible({ timeout: 15000 });

    const cfQuestion = survey.locator(
      `.sd-question[data-name="custom_fields.${TEST_CF_TEXT}"]`,
    );
    await expect(cfQuestion).toBeVisible({ timeout: 10000 });

    const input = cfQuestion.locator('input').first();
    await input.fill('hello-world');
    await input.blur();
    await waitForSidebarSurveyAutosave(page);

    await expect.poll(
      async () => {
        const { data } = await svc
          .from('tickets')
          .select('custom_fields')
          .eq('id', id)
          .single();
        return ((data?.custom_fields ?? {}) as Record<string, unknown>)[TEST_CF_TEXT];
      },
      { timeout: 15000 },
    ).toBe('hello-world');
  });

  test('agent can edit auto-generated custom field', async ({ page }) => {
    const { url, id } = await getAliceTicketUrl();
    const svc = createServiceRoleClient();
    await svc.from('tickets').update({ custom_fields: {} }).eq('id', id);

    await loginAs(page, 'agent.smith@example.com');
    await page.goto(url);

    const survey = page.getByTestId('ticket-sidebar-survey');
    await expect(survey).toBeVisible({ timeout: 15000 });

    const cfQuestion = survey.locator(
      `.sd-question[data-name="custom_fields.${TEST_CF_TEXT}"]`,
    );
    await expect(cfQuestion).toBeVisible({ timeout: 10000 });
    // Question must be editable for agents (not marked readonly).
    await expect(cfQuestion).not.toHaveClass(/--readonly|sd-question--readonly/);

    const input = cfQuestion.locator('input').first();
    await input.fill('agent-edit');
    await input.blur();
    await waitForSidebarSurveyAutosave(page);

    await expect.poll(
      async () => {
        const { data } = await svc
          .from('tickets')
          .select('custom_fields')
          .eq('id', id)
          .single();
        return ((data?.custom_fields ?? {}) as Record<string, unknown>)[TEST_CF_TEXT];
      },
      { timeout: 15000 },
    ).toBe('agent-edit');
  });

  test('non-owner non-agent sees custom fields read-only', async ({ page }) => {
    // bob is a different non-agent user; the ticket is alice's so bob is
    // neither owner nor agent. The ticket must be public for bob to load it.
    const { url, id } = await getAliceTicketUrl();
    const svc = createServiceRoleClient();
    await svc.from('tickets').update({ is_private: false, custom_fields: { [TEST_CF_TEXT]: 'visible' } }).eq('id', id);

    await loginAs(page, 'bob@example.com');
    await page.goto(url);

    const survey = page.getByTestId('ticket-sidebar-survey');
    await expect(survey).toBeVisible({ timeout: 15000 });

    const cfQuestion = survey.locator(
      `.sd-question[data-name="custom_fields.${TEST_CF_TEXT}"]`,
    );
    await expect(cfQuestion).toBeVisible({ timeout: 10000 });
    // Read-only questions in SurveyJS get the `--readonly` modifier on the
    // root element.
    await expect(cfQuestion).toHaveClass(/--readonly|sd-question--readonly/);

    // Restore privacy
    await svc.from('tickets').update({ is_private: true }).eq('id', id);
  });

  test('admin opt-out hides auto-generated custom field questions', async ({ page }) => {
    const svc = createServiceRoleClient();
    const key = 'survey_ticket_detail_user_template';
    const { data: row } = await svc
      .from('app_settings')
      .select('value')
      .eq('key', key)
      .single();
    const wrapper = row?.value ? JSON.parse(row.value as string) : {};
    const original = JSON.stringify(wrapper);
    wrapper.autoGenerateCustomFields = false;
    await svc.from('app_settings').update({ value: JSON.stringify(wrapper) }).eq('key', key);

    try {
      const { url, id } = await getAliceTicketUrl();
      await svc.from('tickets').update({ is_private: false }).eq('id', id);

      await loginAs(page, 'alice@example.com');
      await page.goto(url);

      const survey = page.getByTestId('ticket-sidebar-survey');
      await expect(survey).toBeVisible({ timeout: 15000 });

      const cfQuestion = survey.locator(
        `.sd-question[data-name="custom_fields.${TEST_CF_TEXT}"]`,
      );
      await expect(cfQuestion).toHaveCount(0);

      await svc.from('tickets').update({ is_private: true }).eq('id', id);
    } finally {
      await svc.from('app_settings').update({ value: original }).eq('key', key);
    }
  });
});
