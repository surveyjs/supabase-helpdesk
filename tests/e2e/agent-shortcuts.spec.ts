import { test, expect } from './fixtures';
import { createServiceRoleClient } from '../helpers/supabase';
import { loginViaForm } from '../helpers/auth';

// #1: agent keyboard shortcuts on the ticket page, configurable by the admin.
// Writes the global agent_keyboard_shortcuts setting: runs in global-settings.

const SLUG = 'e2e-agent-shortcuts';
const KEY = 'agent_keyboard_shortcuts';

async function seedTicket(): Promise<{ url: string; id: number }> {
  const admin = createServiceRoleClient();
  const { data: stale } = await admin.from('tickets').select('id').eq('slug', SLUG);
  if (stale?.length) {
    const ids = stale.map((t: { id: number }) => t.id);
    await admin.from('activity_log').delete().in('ticket_id', ids);
    await admin.from('posts').delete().in('ticket_id', ids);
    await admin.from('tickets').delete().in('id', ids);
  }
  const { data: alice } = await admin.from('profiles').select('id').eq('email', 'alice@example.com').single();
  const { data: type } = await admin.from('ticket_types').select('id').limit(1).single();
  const { data: ticket, error } = await admin
    .from('tickets')
    .insert({ title: 'E2E Agent Shortcuts', slug: SLUG, creator_id: alice!.id, type_id: type!.id })
    .select('id, slug')
    .single();
  if (error) throw new Error(error.message);
  await admin.from('posts').insert({
    ticket_id: ticket!.id, author_id: alice!.id, body: 'Shortcut test.', is_original: true, post_type: 'post',
  });
  return { url: `/tickets/${ticket!.id}/${ticket!.slug}`, id: ticket!.id };
}

test.describe('Agent keyboard shortcuts', () => {
  test.describe.configure({ mode: 'serial' });
  let original: string | null = null;

  test.beforeAll(async () => {
    const admin = createServiceRoleClient();
    const { data } = await admin.from('app_settings').select('value').eq('key', KEY).maybeSingle();
    original = data?.value ?? null;
    await admin.from('app_settings').delete().eq('key', KEY);
  });

  test.afterAll(async () => {
    const admin = createServiceRoleClient();
    if (original === null) await admin.from('app_settings').delete().eq('key', KEY);
    else await admin.from('app_settings').upsert({ key: KEY, value: original });
  });

  test('Ctrl+S sends the reply; Ctrl+Alt+P sends it and closes the ticket; Alt+C copies the ticket info', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const { url, id } = await seedTicket();
    await loginViaForm(page, 'agent.smith@example.com');
    await page.goto(url);
    await expect(page.getByTestId('shortcuts-help')).toContainText('Ctrl+Alt+P');

    const admin = createServiceRoleClient();
    const editor = () => page.getByTestId('main-reply-panel').locator('.rc-md-editor textarea').first();

    await page.getByTestId('main-reply-btn').click();
    await editor().fill('Saved with Ctrl+S');
    await page.keyboard.press('Control+S');
    await expect.poll(async () => {
      const { count } = await admin.from('posts').select('id', { count: 'exact', head: true })
        .eq('ticket_id', id).eq('body', 'Saved with Ctrl+S');
      return count;
    }, { timeout: 15000 }).toBe(1);
    let { data: t } = await admin.from('tickets').select('status').eq('id', id).single();
    expect(t!.status).not.toBe('closed');

    await page.getByTestId('main-reply-btn').click();
    await editor().fill('Answer, then close');
    await page.keyboard.press('Control+Alt+KeyP');
    await expect.poll(async () => {
      ({ data: t } = await admin.from('tickets').select('status').eq('id', id).single());
      return t!.status;
    }, { timeout: 15000 }).toBe('closed');

    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Alt+KeyC');
    await expect(page.getByTestId('shortcut-toast')).toHaveText('Ticket info copied');
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain(`#${id} E2E Agent Shortcuts`);
    expect(clip).toContain(url);
  });

  test('the admin changes a shortcut and agents get it; invalid input is refused', async ({ page }) => {
    await loginViaForm(page, 'admin@example.com');
    await page.goto('/admin/shortcuts');
    const form = page.getByTestId('shortcuts-survey-form');
    const save = form.locator('.sd-question[data-name="save"] input');
    await save.fill('S');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(form).toContainText('is not a valid shortcut');

    await save.fill('ctrl+enter');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(form).toContainText('Shortcuts saved.');

    const { url } = await seedTicket();
    await page.goto(url);
    await expect(page.getByTestId('shortcuts-help')).toContainText('Ctrl+Enter');
  });
});
