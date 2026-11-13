import { test, expect, Page } from './fixtures';
import { createServiceRoleClient } from '../helpers/supabase';
import { loginViaForm } from '../helpers/auth';
import {
  waitForSidebarSurveyAutosave,
} from '../helpers/surveyjs';

async function loginAs(page: Page, email: string, password = 'Password123') {
  await loginViaForm(page, email, password);
}

const BOOL_SUFFIX = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const BOOL_TICKET_PREFIX = 'E2E Bool CF Ticket';
const BOOL_TICKET_TITLE = `${BOOL_TICKET_PREFIX} ${BOOL_SUFFIX}`;
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

// alice's ticket owned by this spec (per worker), so no other spec's alice
// ticket can be picked up or changed under these tests.
const CF_TICKET_TITLE = `E2E CF Detail Ticket ${BOOL_SUFFIX}`;
const CF_TICKET_SLUG = `e2e-cf-detail-ticket-${BOOL_SUFFIX}`;

async function seedAliceTicket() {
  const svc = createServiceRoleClient();
  const { data: alice, error: aErr } = await svc
    .from('profiles')
    .select('id')
    .eq('email', 'alice@example.com')
    .single();
  if (aErr) throw new Error(aErr.message);
  const { data: type, error: tErr } = await svc.from('ticket_types').select('id').limit(1).single();
  if (tErr) throw new Error(tErr.message);
  const { data: ticket, error } = await svc
    .from('tickets')
    .insert({
      title: CF_TICKET_TITLE, slug: CF_TICKET_SLUG, creator_id: alice.id, type_id: type.id, is_private: true,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  const { error: pErr } = await svc.from('posts').insert({
    ticket_id: ticket.id, author_id: alice.id, body: 'Custom fields detail test.', is_original: true, post_type: 'post',
  });
  if (pErr) throw new Error(pErr.message);
}

async function deleteAliceTicket() {
  const svc = createServiceRoleClient();
  const { error } = await svc.from('tickets').delete().eq('title', CF_TICKET_TITLE);
  if (error) throw new Error(error.message);
}

async function getAliceTicketUrl(): Promise<{ url: string; id: number }> {
  const svc = createServiceRoleClient();
  const { data: ticket, error } = await svc
    .from('tickets')
    .select('id, slug')
    .eq('title', CF_TICKET_TITLE)
    .single();
  if (error) throw new Error(error.message);
  return { url: `/tickets/${ticket.id}/${ticket.slug}`, id: ticket.id as number };
}

// Both describes mutate the global survey_ticket_detail_user_template settings, so
// they must not run in parallel workers; 'default' keeps file order in one worker
// without skipping the rest after a failure (unlike 'serial').
test.describe.configure({ mode: 'default' });

test.describe('Ticket detail custom fields (SurveyJS)', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    await seedTestFields();
    await seedAliceTicket();
  });

  test.afterAll(async () => {
    try {
      await deleteAliceTicket();
    } finally {
      await cleanupTestFields();
    }
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

  test('typed sidebar text survives a realtime refresh', async ({ page }) => {
    const { url, id } = await getAliceTicketUrl();
    const svc = createServiceRoleClient();
    const { error: resetErr } = await svc
      .from('tickets')
      .update({ custom_fields: {}, urgency: 'low' })
      .eq('id', id);
    if (resetErr) throw new Error(resetErr.message);

    // Local Realtime does not deliver postgres_changes to the browser session,
    // so relay the server's join reply and push the change event over the
    // page's own socket: the real RealtimeTicketUpdates handler still runs
    // and calls router.refresh().
    const topic = `realtime:ticket-${id}`;
    let relayToPage: ((frame: string) => void) | null = null;
    let joinRef: string | null = null;
    let changeIds: number[] = [];
    await page.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
      const server = ws.connectToServer();
      relayToPage = (frame) => ws.send(frame);
      ws.onMessage((m) => {
        const msg = JSON.parse(String(m));
        if (msg[2] === topic && msg[3] === 'phx_join') joinRef = msg[0];
        server.send(m);
      });
      server.onMessage((m) => {
        const msg = JSON.parse(String(m));
        if (msg[2] === topic && msg[3] === 'phx_reply') {
          const bindings = (msg[4]?.response?.postgres_changes ?? []) as { id: number; table: string }[];
          changeIds = bindings.filter((b) => b.table === 'tickets').map((b) => b.id);
        }
        ws.send(m);
      });
    });

    await loginAs(page, 'agent.smith@example.com');
    await page.goto(url);

    const survey = page.getByTestId('ticket-sidebar-survey');
    const urgency = survey.locator('.sd-question[data-name="urgency"]');
    await expect(urgency).toContainText('Low', { timeout: 15000 });
    const input = survey
      .locator(`.sd-question[data-name="custom_fields.${TEST_CF_TEXT}"]`)
      .locator('input')
      .first();
    await expect(input).toBeVisible({ timeout: 10000 });
    await expect.poll(() => changeIds.length, { timeout: 15000 }).toBeGreaterThan(0);

    // Type without blurring, so the draft is not yet committed to the model.
    await input.click();
    await input.pressSequentially('draft');

    // Another sidebar field changes remotely and the page is told about it;
    // the refresh shows the new urgency in the (untouched) dropdown.
    const { error: updErr } = await svc.from('tickets').update({ urgency: 'critical' }).eq('id', id);
    if (updErr) throw new Error(updErr.message);
    relayToPage!(
      JSON.stringify([
        joinRef,
        null,
        topic,
        'postgres_changes',
        {
          ids: changeIds,
          data: {
            schema: 'public',
            table: 'tickets',
            type: 'UPDATE',
            commit_timestamp: new Date().toISOString(),
            columns: [],
            record: { id },
            old_record: { id },
            errors: null,
          },
        },
      ]),
    );
    await expect(urgency).toContainText('Critical', { timeout: 20000 });

    await expect(input).toHaveValue('draft');
    await expect(input).toBeFocused();

    await input.blur();
    await waitForSidebarSurveyAutosave(page);
    await expect.poll(
      async () => {
        const { data, error } = await svc.from('tickets').select('custom_fields').eq('id', id).single();
        if (error) throw new Error(error.message);
        return ((data?.custom_fields ?? {}) as Record<string, unknown>)[TEST_CF_TEXT];
      },
      { timeout: 15000 },
    ).toBe('draft');
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

// Unique per run and not prefixed `E2E` (admin-setup.spec bulk-deletes `E2E%`).
const CF_BOOL = `BoolCf${BOOL_SUFFIX}`;

test.describe('Boolean custom field rendering', () => {
  test.describe.configure({ mode: 'serial' }); // tests share the created ticket

  test.beforeAll(async () => {
    const svc = createServiceRoleClient();
    await svc.from('custom_fields').delete().eq('name', CF_BOOL);
    await svc.from('custom_fields').insert({
      name: CF_BOOL,
      field_type: 'checkbox',
      is_required: false,
      options: null,
      default_value: null,
      display_order: 9100,
    });
  });

  test.afterAll(async () => {
    const svc = createServiceRoleClient();
    try {
      await svc.from('tickets').delete().eq('title', BOOL_TICKET_TITLE);
    } finally {
      await svc.from('custom_fields').delete().eq('name', CF_BOOL);
    }
  });

  test('create form: inline checkbox, toggles, stores true; no overflow at 390px', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto('/tickets/new');
    await expect(page.getByRole('button', { name: 'Create Ticket' })).toBeVisible({ timeout: 10000 });

    const box = page.getByLabel(CF_BOOL);
    await expect(box).toBeVisible();
    // The Description editor mounts client-side (ssr: false, no placeholder) and
    // then pushes the custom fields ~300 px down. Measured between two separate
    // boundingBox() calls, that shift read as a 304 px misalignment. Wait for
    // the editor, then take both centres in one synchronous read.
    await expect(page.getByTestId('markdown-editor').first().locator('.rc-md-editor')).toBeVisible();
    const offset = await box.evaluate((input) => {
      const text = input.closest('label')!.querySelector('span')!;
      const a = input.getBoundingClientRect();
      const b = text.getBoundingClientRect();
      return Math.abs(a.top + a.height / 2 - (b.top + b.height / 2));
    });
    expect(offset).toBeLessThanOrEqual(4);

    await page.setViewportSize({ width: 390, height: 800 });
    expect(await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    )).toBe(true);
    await page.setViewportSize({ width: 1280, height: 800 });

    const typeSelect = page.getByLabel('Type');
    await expect(typeSelect.locator('option').filter({ hasText: 'Issue' })).toBeAttached({ timeout: 10000 });
    await page.getByLabel('Title').fill(BOOL_TICKET_TITLE);
    await typeSelect.selectOption({ label: 'Issue' });
    const editor = page.getByTestId('markdown-editor').first();
    await editor.locator('textarea[name="textarea"]').fill('Body for boolean custom field test.');
    await expect(editor.locator('textarea[name="body"]')).toHaveValue(
      'Body for boolean custom field test.',
      { timeout: 5000 },
    );
    await box.check();
    await expect(box).toBeChecked();
    await page.getByRole('button', { name: 'Create Ticket' }).click();
    await expect(page).toHaveURL(/\/tickets\/\d+\//, { timeout: 30000 });
    const ticketId = Number(page.url().match(/\/tickets\/(\d+)\//)![1]);

    const svc = createServiceRoleClient();
    const { data } = await svc.from('tickets').select('custom_fields').eq('id', ticketId).single();
    expect((data?.custom_fields as Record<string, unknown>)[CF_BOOL]).toBe(true);
  });

  test('sidebar: checkbox (not switch), name once; read-only for non-owner', async ({ page }) => {
    const svc = createServiceRoleClient();
    const { data: t } = await svc
      .from('tickets')
      .select('id, slug')
      .eq('title', BOOL_TICKET_TITLE)
      .single();
    await svc.from('tickets').update({ is_private: false }).eq('id', t!.id);
    const url = `/tickets/${t!.id}/${t!.slug}`;
    const sel = `.sd-question[data-name="custom_fields.${CF_BOOL}"]`;

    await loginAs(page, 'alice@example.com');
    await page.goto(url);
    const q = page.getByTestId('ticket-sidebar-survey').locator(sel);
    await expect(q).toBeVisible({ timeout: 15000 });
    await expect(q.locator('input[type=checkbox]')).toHaveCount(1);
    await expect(q.locator('.sd-boolean')).toHaveCount(0);
    expect(await q.getByText(CF_BOOL, { exact: true }).count()).toBe(1);
    await expect(q).not.toHaveClass(/sd-question--readonly/);

    await page.context().clearCookies();
    await loginAs(page, 'bob@example.com');
    await page.goto(url);
    const qb = page.getByTestId('ticket-sidebar-survey').locator(sel);
    await expect(qb).toBeVisible({ timeout: 15000 });
    await expect(qb).toHaveClass(/sd-question--readonly/);
  });
});
