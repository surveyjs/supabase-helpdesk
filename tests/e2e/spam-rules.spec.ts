import { test, expect } from './fixtures';
import { createServiceRoleClient } from '../helpers/supabase';
import { loginViaForm } from '../helpers/auth';

// #28: spam rules screen tickets customers create. Writes the global
// spam_rules setting: runs in the global-settings project.

const KEY = 'spam_rules';
const SUFFIX = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const WORD = `zzcasino${SUFFIX}`;

async function setRules(action: 'close' | 'flag') {
  const { error } = await createServiceRoleClient().from('app_settings').upsert({
    key: KEY,
    value: JSON.stringify({ enabled: true, action, keywords: [WORD], aiEnabled: false }),
  });
  if (error) throw new Error(error.message);
}

async function createTicket(page: import('@playwright/test').Page, title: string, body: string) {
  await page.goto('/tickets/new');
  await page.getByLabel('Title').fill(title);
  await page.locator('[data-testid="markdown-editor"] textarea[name="textarea"]').fill(body);
  await page.getByRole('button', { name: 'Create Ticket' }).click();
  await expect(page).toHaveURL(/\/tickets\/\d+\//, { timeout: 20000 });
  return Number(page.url().match(/\/tickets\/(\d+)\//)![1]);
}

test.describe('Spam rules', () => {
  test.describe.configure({ mode: 'serial' });
  let original: string | null = null;
  const created: number[] = [];

  test.beforeAll(async () => {
    const { data } = await createServiceRoleClient().from('app_settings').select('value').eq('key', KEY).maybeSingle();
    original = data?.value ?? null;
  });

  test.afterAll(async () => {
    const admin = createServiceRoleClient();
    if (original === null) await admin.from('app_settings').delete().eq('key', KEY);
    else await admin.from('app_settings').upsert({ key: KEY, value: original });
    if (created.length) {
      await admin.from('activity_log').delete().in('ticket_id', created);
      await admin.from('posts').delete().in('ticket_id', created);
      await admin.from('tickets').delete().in('id', created);
    }
  });

  test('"close": a matching ticket is closed and its Logs say why; a clean one stays open', async ({ page }) => {
    await setRules('close');
    await loginViaForm(page, 'alice@example.com');
    const spamId = await createTicket(page, `Great ${WORD} bonus`, 'Visit now');
    created.push(spamId);
    const cleanId = await createTicket(page, `Matrix question ${SUFFIX}`, 'How do I add a row?');
    created.push(cleanId);

    const admin = createServiceRoleClient();
    const { data: rows } = await admin.from('tickets').select('id, status').in('id', [spamId, cleanId]);
    expect(rows!.find((r) => r.id === spamId)!.status).toBe('closed');
    expect(rows!.find((r) => r.id === cleanId)!.status).toBe('open');

    // Customers don't see the spam filter's log entry; agents do.
    await expect(page.getByText(/Spam filter/)).toHaveCount(0);
    await loginViaForm(page, 'agent.smith@example.com');
    await page.goto(`/tickets/${spamId}/redirect`);
    await page.getByTestId('logs-tab').click();
    await expect(page.locator('[data-testid^="activity-"]').filter({ hasText: 'Spam filter' }))
      .toContainText(`keyword "${WORD}"`);
  });

  test('"flag": a matching ticket stays open with the spam tag', async ({ page }) => {
    await setRules('flag');
    await loginViaForm(page, 'alice@example.com');
    const id = await createTicket(page, `Cheap ${WORD} offer`, 'Buy');
    created.push(id);
    const admin = createServiceRoleClient();
    const { data: t } = await admin.from('tickets').select('status').eq('id', id).single();
    expect(t!.status).toBe('open');
    const { data: tags } = await admin.from('ticket_tags').select('tags(name)').eq('ticket_id', id);
    expect((tags ?? []).map((r) => (Array.isArray(r.tags) ? r.tags[0]?.name : (r.tags as { name: string } | null)?.name))).toContain('spam');
  });

  test('the admin form refuses a broken pattern and saves rules', async ({ page }) => {
    await loginViaForm(page, 'admin@example.com');
    await page.goto('/admin/spam');
    const form = page.getByTestId('spam-survey-form');
    await expect(form).toBeVisible();
    const patterns = form.locator('.sd-question[data-name="patterns"] textarea');
    await patterns.fill('(unclosed');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(form).toContainText('Not a valid regular expression');
    await patterns.fill('seo.*offer');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(form).toContainText('Spam rules saved.');
    const { data } = await createServiceRoleClient().from('app_settings').select('value').eq('key', KEY).single();
    expect(JSON.parse(data!.value).patterns).toEqual(['seo.*offer']);
  });
});
