import { test, expect } from './fixtures';
import { createServiceRoleClient } from '../helpers/supabase';
import { loginViaForm } from '../helpers/auth';
import { waitForSidebarSurveyAutosave } from '../helpers/surveyjs';
import { randomUUID } from 'crypto';

// Several describes below mutate global state (custom fields, the agent sidebar
// template) and share seeded tickets, so keep the whole file in one worker.
test.describe.configure({ mode: 'default' });

const SLUG = 'e2e-ticket-layout';
const CLOSED_SLUG = 'e2e-ticket-layout-closed';
const PENDING_SLUG = 'e2e-ticket-layout-pending';
const LONG_URL = `https://example.com/${'a'.repeat(300)}`;

async function seedWithStatus(
  slug: string,
  status: 'closed' | 'pending',
  title = `E2E Ticket Layout ${status}`, // must slugify to `slug`
) {
  const admin = createServiceRoleClient();
  const { data: stale } = await admin.from('tickets').select('id').eq('slug', slug);
  if (stale?.length) {
    const ids = stale.map((t: { id: number }) => t.id);
    await admin.from('activity_log').delete().in('ticket_id', ids);
    await admin.from('posts').delete().in('ticket_id', ids);
    await admin.from('tickets').delete().in('id', ids);
  }
  const { data: alice } = await admin.from('profiles').select('id').eq('email', 'alice@example.com').single();
  const { data: type } = await admin.from('ticket_types').select('id').limit(1).single();
  const { data: ticket } = await admin
    .from('tickets')
    .insert({ title, slug, creator_id: alice!.id, type_id: type!.id, status })
    .select('id, slug')
    .single();
  await admin.from('posts').insert({
    ticket_id: ticket!.id, author_id: alice!.id, body: `${status} original.`, is_original: true, post_type: 'post',
  });
  return `/tickets/${ticket!.id}/${ticket!.slug}`;
}

let inlineId: string;
let codeRefId: string;

async function seed() {
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
  const { data: ticket } = await admin
    .from('tickets')
    .insert({ title: 'E2E Ticket Layout', slug: SLUG, creator_id: alice!.id, type_id: type!.id })
    .select('id, slug')
    .single();
  await admin.from('posts').insert({
    ticket_id: ticket!.id, author_id: alice!.id, body: 'Original post.', is_original: true, post_type: 'post',
  });
  inlineId = randomUUID();
  codeRefId = randomUUID();
  const { data: reply } = await admin
    .from('posts')
    .insert({
      ticket_id: ticket!.id,
      author_id: alice!.id,
      // The code span only mentions an id: that file is not shown inline.
      body: `See ${LONG_URL}\n\n![shot](/attachments/${inlineId})\n\nSee \`/attachments/${codeRefId}\``,
      is_original: false,
      post_type: 'post',
    })
    .select('id')
    .single();
  const { error: attErr } = await admin.from('attachments').insert([
    {
      id: inlineId, post_id: reply!.id, uploader_id: alice!.id, legacy_blob_id: randomUUID(),
      original_filename: 'inline-shot-only.png', file_size: 1234, mime_type: 'image/png',
    },
    {
      id: randomUUID(), post_id: reply!.id, uploader_id: alice!.id, legacy_blob_id: randomUUID(),
      original_filename: `${'long-file-name-'.repeat(12)}.txt`, file_size: 4321, mime_type: 'text/plain',
    },
    {
      id: codeRefId, post_id: reply!.id, uploader_id: alice!.id, legacy_blob_id: randomUUID(),
      original_filename: 'code-ref-only.txt', file_size: 99, mime_type: 'text/plain',
    },
  ]);
  if (attErr) throw new Error(attErr.message);
  const { data: agent } = await admin.from('profiles').select('id').eq('email', 'agent.smith@example.com').single();
  await admin.from('ticket_followers').upsert({ ticket_id: ticket!.id, user_id: agent!.id });
  return `/tickets/${ticket!.id}/${ticket!.slug}`;
}

test.describe('Ticket thread layout', () => {
  test.describe.configure({ mode: 'serial' });
  let url: string;
  let closedUrl: string;
  let pendingUrl: string;
  test.beforeAll(async () => {
    url = await seed();
    closedUrl = await seedWithStatus(CLOSED_SLUG, 'closed');
    pendingUrl = await seedWithStatus(PENDING_SLUG, 'pending');
  });

  test('ticket number shows in header', async ({ page }) => {
    await loginViaForm(page, 'agent.smith@example.com');
    await page.goto(url);
    const id = url.split('/')[2];
    const num = page.getByTestId('ticket-main-content').getByText(`#${id}`, { exact: true });
    await expect(num).toBeVisible();
    const tabs = await page.getByRole('tab').first().boundingBox();
    const numBox = await num.boundingBox();
    expect(numBox!.y).toBeLessThan(tabs!.y);
    await expect(page.getByTestId('ticket-sidebar').getByText(`#${id}`, { exact: true })).toHaveCount(0);
  });

  test('closed ticket has no delete row', async ({ page }) => {
    await loginViaForm(page, 'admin@example.com');
    await page.goto(closedUrl);
    await expect(page.getByTestId('ticket-sidebar')).toBeVisible();
    await expect(page.getByTestId('delete-ticket-btn-disabled')).toHaveCount(0);
    await expect(page.getByTestId('delete-ticket-btn')).toHaveCount(0);
    await expect(page.getByText(/Closed tickets cannot be deleted/)).toHaveCount(0);
  });

  test('followers count appears once', async ({ page }) => {
    await loginViaForm(page, 'agent.smith@example.com');
    await page.goto(url);
    await expect(page.getByTestId('follow-section')).toBeVisible();
    await expect(page.getByText(/\d+ followers?/)).toHaveCount(1);
  });

  test('advanced actions share one style and are not truncated', async ({ page }) => {
    await loginViaForm(page, 'agent.smith@example.com');
    await page.goto(url);
    const btns = [
      page.getByTestId('mark-duplicate-btn'),
      page.getByTestId('merge-ticket-btn'),
      page.getByTestId('clone-ticket-btn'),
    ];
    const bgs = new Set<string>();
    for (const b of btns) {
      await expect(b).toBeVisible();
      bgs.add(await b.evaluate((el) => getComputedStyle(el).backgroundColor));
      expect(await b.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
    expect(bgs.size).toBe(1);
    await expect(btns[1]).toHaveText('Merge into…');
  });

  test('private and follow checkboxes are close together', async ({ page }) => {
    await loginViaForm(page, 'agent.smith@example.com');
    await page.goto(url);
    const survey = page.getByTestId('ticket-sidebar-survey');
    const priv = survey.getByText('Private ticket', { exact: true });
    const follow = survey.getByText('Follow this ticket', { exact: true });
    await expect(priv).toBeVisible();
    await expect(follow).toBeVisible();
    const a = (await priv.boundingBox())!;
    const b = (await follow.boundingBox())!;
    const gap = b.y >= a.y + a.height - 2 ? b.y - (a.y + a.height) : b.x - (a.x + a.width);
    expect(gap).toBeLessThanOrEqual(12);
  });

  test('post actions are on one row', async ({ page }) => {
    await loginViaForm(page, 'agent.smith@example.com');
    await page.goto(url);
    const post = page.locator('[data-post-kind="post"]').nth(1);
    const edit = await post.getByTestId('edit-post-btn').first().boundingBox();
    const del = await post.getByTestId('delete-post-btn').first().boundingBox();
    expect(edit).not.toBeNull();
    expect(del).not.toBeNull();
    expect(Math.abs(edit!.y - del!.y)).toBeLessThanOrEqual(4);
  });

  test('inline-referenced attachment is listed once, under "Shown inline", with Delete for the owner', async ({ page }) => {
    await loginViaForm(page, 'alice@example.com');
    await page.goto(url);
    const list = page.getByTestId('attachment-list');
    await expect(list.getByText('long-file-name-', { exact: false })).toBeVisible();
    // A code span only mentions an id: that file keeps its full row.
    await expect(list.getByText('code-ref-only.txt')).toBeVisible();
    await expect(page.getByTestId('attachment-inline-list').getByText('code-ref-only.txt')).toHaveCount(0);

    const inline = page.getByTestId('attachment-inline-list');
    await expect(inline).toContainText('Shown inline:');
    await expect(inline.getByText('inline-shot-only.png')).toHaveCount(1);
    await expect(list.getByText('inline-shot-only.png')).toHaveCount(1);
    await expect(inline.getByTestId(`attachment-${inlineId}`).getByTestId('delete-attachment-btn')).toBeVisible();
  });

  test('re-open hint shows for the creator on pending and closed tickets', async ({ page }) => {
    await loginViaForm(page, 'alice@example.com');
    for (const u of [pendingUrl, closedUrl]) {
      await page.goto(u);
      await expect(page.getByTestId('reopen-hint')).toHaveText('Replying will re-open this ticket.');
    }
    await page.goto(url);
    await expect(page.getByTestId('main-reply-btn')).toBeVisible();
    await expect(page.getByTestId('reopen-hint')).toHaveCount(0);
  });

  test('sidebar details are labelled sections with h3 headings and paired dt/dd', async ({ page }) => {
    await loginViaForm(page, 'admin@example.com');
    await page.goto(url);
    const sidebar = page.getByTestId('ticket-sidebar');
    for (const name of ['People', 'Dates', 'Actions']) {
      await expect(sidebar.getByRole('heading', { level: 3, name, exact: true })).toBeVisible();
      await expect(sidebar.getByRole('region', { name, exact: true })).toBeVisible();
    }
    const orphanDts = await sidebar.evaluate((root) =>
      Array.from(root.querySelectorAll('dt'))
        .filter((dt) => dt.nextElementSibling?.tagName !== 'DD')
        .map((dt) => dt.textContent),
    );
    expect(orphanDts).toEqual([]);
  });

  test('post actions have touch-size targets on coarse pointers', async ({ browser }) => {
    const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    try {
      await loginViaForm(page, 'agent.smith@example.com');
      await page.goto(url);
      const post = page.locator('[data-post-kind="post"]').nth(1);
      for (const id of ['edit-post-btn', 'delete-post-btn', 'clone-comment-btn']) {
        const box = await post.getByTestId(id).first().boundingBox();
        expect(box, id).not.toBeNull();
        expect(box!.height, id).toBeGreaterThanOrEqual(44);
      }
    } finally {
      await ctx.close();
    }
  });

  test('title pencil shows a focus ring when focused by keyboard', async ({ page }) => {
    await loginViaForm(page, 'alice@example.com');
    await page.goto(url);
    const pencil = page.getByTestId('edit-title-btn');
    await pencil.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(pencil).toBeFocused();
    const shadow = await pencil.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(shadow).not.toBe('none');
  });

  test.describe('phone width', () => {
    test.use({ viewport: { width: 390, height: 844 } });
    test('no horizontal overflow at 390px on a ticket with an attachment and a long link', async ({ page }) => {
      await loginViaForm(page, 'agent.smith@example.com');
      await page.goto(url);
      await expect(page.getByTestId('attachment-list')).toBeVisible();
      const { sw, cw } = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth,
      }));
      expect(sw).toBeLessThanOrEqual(cw);
    });
  });
});

test.describe('Markdown editor on /tickets/new', () => {
  test('new ticket page has a single h1', async ({ page }) => {
    await loginViaForm(page, 'alice@example.com');
    await page.goto('/tickets/new');
    await expect(page.getByTestId('markdown-editor')).toBeVisible();
    await expect(page.locator('h1')).toHaveCount(1);
  });

  test.describe('preview pane (preference "both")', () => {
    test.use({ viewport: { width: 1440, height: 900 } });
    test('wide: hidden while empty, shown once there is content', async ({ page }) => {
      await loginViaForm(page, 'alice@example.com');
      await page.goto('/tickets/new');
      const editor = page.getByTestId('markdown-editor');
      const textarea = editor.locator('.rc-md-editor textarea').first();
      await expect(textarea).toBeVisible();
      await expect(editor.locator('.sec-html')).toBeHidden();
      await textarea.fill('hello **world**');
      await expect(editor.locator('.sec-html')).toBeVisible();
    });
  });

  test.describe('heading menu keyboard access', () => {
    test.use({ viewport: { width: 1440, height: 900 } });
    test('Enter opens the menu, arrows move, Enter inserts "## "', async ({ page }) => {
      await loginViaForm(page, 'alice@example.com');
      await page.goto('/tickets/new');
      const editor = page.getByTestId('markdown-editor');
      const trigger = editor.locator('.button-type-header [role="button"]');
      await expect(trigger).toBeVisible();
      await trigger.focus();
      await page.keyboard.press('Enter');
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      await expect(editor.getByTestId('editor-heading-1')).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(editor.getByTestId('editor-heading-2')).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(editor.locator('.rc-md-editor textarea').first()).toHaveValue(/## /);
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });
    test('Escape closes the menu and returns focus to the trigger', async ({ page }) => {
      await loginViaForm(page, 'alice@example.com');
      await page.goto('/tickets/new');
      const editor = page.getByTestId('markdown-editor');
      const trigger = editor.locator('.button-type-header [role="button"]');
      await trigger.focus();
      await page.keyboard.press('Space');
      await expect(editor.getByTestId('editor-heading-1')).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(trigger).toBeFocused();
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });
  });

  test.describe('phone width', () => {
    test.use({ viewport: { width: 390, height: 844 } });
    test('new ticket page has no horizontal overflow at 390px', async ({ page }) => {
      await loginViaForm(page, 'alice@example.com');
      await page.goto('/tickets/new');
      const editor = page.getByTestId('markdown-editor');
      await expect(editor).toBeVisible();
      await editor.locator('.rc-md-editor textarea').first().fill('typed content');
      await expect(editor.locator('.sec-html')).toBeHidden();
      const { sw, cw } = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth,
      }));
      expect(sw).toBeLessThanOrEqual(cw);
    });
  });
});

test.describe('Sidebar Tags tagbox', () => {
  test.describe.configure({ mode: 'serial' }); // tests share the seeded ticket
  test.use({ viewport: { width: 1280, height: 720 } });
  const TAG_SLUG = 'e2e-ticket-layout-tags';
  // 50 chars (the tags.name limit): wider than the sidebar's tagbox minus the other chips.
  const LONG_TAG = `E2E long tag name ${randomUUID().slice(0, 8)} `.padEnd(50, 'x');
  let tagUrl: string;
  let tagId: string;

  test.beforeAll(async () => {
    const admin = createServiceRoleClient();
    const { data: stale } = await admin.from('tickets').select('id').eq('slug', TAG_SLUG);
    if (stale?.length) {
      const ids = stale.map((t: { id: number }) => t.id);
      await admin.from('activity_log').delete().in('ticket_id', ids);
      await admin.from('posts').delete().in('ticket_id', ids);
      await admin.from('tickets').delete().in('id', ids);
    }
    const { data: alice } = await admin.from('profiles').select('id').eq('email', 'alice@example.com').single();
    const { data: type } = await admin.from('ticket_types').select('id').limit(1).single();
    const { data: ticket } = await admin
      .from('tickets')
      .insert({ title: 'E2E Ticket Layout Tags', slug: TAG_SLUG, creator_id: alice!.id, type_id: type!.id })
      .select('id, slug')
      .single();
    await admin.from('posts').insert({
      ticket_id: ticket!.id, author_id: alice!.id, body: 'Original post.', is_original: true, post_type: 'post',
    });
    const { data: tag, error } = await admin.from('tags').insert({ name: LONG_TAG }).select('id').single();
    if (error) throw new Error(error.message);
    tagId = tag!.id;
    const { data: seedTags } = await admin.from('tags').select('id').in('name', ['urgent', 'bug']);
    await admin.from('ticket_tags').insert(
      [tagId, ...(seedTags ?? []).map((t: { id: string }) => t.id)].map((id) => ({ ticket_id: ticket!.id, tag_id: id })),
    );
    tagUrl = `/tickets/${ticket!.id}/${ticket!.slug}`;
  });

  test.afterAll(async () => {
    const admin = createServiceRoleClient();
    const { data: t } = await admin.from('tickets').select('id').eq('slug', TAG_SLUG);
    const ids = (t ?? []).map((r: { id: number }) => r.id);
    if (ids.length) {
      await admin.from('ticket_tags').delete().in('ticket_id', ids);
      await admin.from('activity_log').delete().in('ticket_id', ids);
      await admin.from('posts').delete().in('ticket_id', ids);
      await admin.from('tickets').delete().in('id', ids);
    }
    await admin.from('tags').delete().eq('id', tagId);
  });

  test('chips wrap instead of truncating and the filter input stays usable', async ({ page }) => {
    await loginViaForm(page, 'agent.smith@example.com');
    await page.goto(tagUrl);
    const q = page.getByTestId('ticket-sidebar-survey').locator('.sd-question', { hasText: 'Tags' }).first();
    await expect(q.getByText(LONG_TAG)).toBeVisible();

    const m = await q.evaluate((root) => {
      const labels = Array.from(root.querySelectorAll('.sd-tagbox-item')).map((chip) => {
        const el = (chip.querySelector('.sd-tagbox-item__text span') ?? chip) as HTMLElement;
        return { text: el.textContent, truncated: el.scrollWidth > el.clientWidth || chip.scrollWidth > chip.clientWidth };
      });
      const input = root.querySelector('.sd-tagbox__filter-string-input') as HTMLElement | null;
      const box = root.querySelector('.sd-tagbox') as HTMLElement;
      return {
        labels,
        inputWidth: input ? input.getBoundingClientRect().width : -1,
        boxOverflow: box.scrollWidth - box.clientWidth,
      };
    });
    expect(m.labels.length).toBe(3);
    for (const l of m.labels) expect(l.truncated, `chip "${l.text}" is truncated`).toBe(false);
    expect(m.inputWidth, 'tagbox filter input width').toBeGreaterThan(20);
    expect(m.boxOverflow, 'tagbox horizontal overflow').toBeLessThanOrEqual(1);
  });

  test('tagbox chips carry their tag colour', async ({ page }) => {
    await loginViaForm(page, 'agent.smith@example.com');
    await page.goto(tagUrl);
    const q = page.getByTestId('ticket-sidebar-survey').locator('.sd-question[data-name="tag_ids"]');
    // Seeded tag "urgent" is #EF4444.
    const chip = q.locator('.sd-tagbox-item', { hasText: /^urgent$/ });
    await expect(chip).toBeVisible();
    await expect
      .poll(() => chip.evaluate((el) => getComputedStyle(el).boxShadow))
      .toContain('rgb(239, 68, 68)');
    const bg = await chip.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toMatch(/^rgba?\(255, 255, 255/);
  });

  test('agent template without a Tags question: read-only tag chips show instead', async ({ page }) => {
    const admin = createServiceRoleClient();
    const key = 'survey_ticket_detail_agent_template';
    const { data: row } = await admin.from('app_settings').select('value').eq('key', key).single();
    const original = row!.value as string;
    const wrapper = JSON.parse(original) as { template: { pages: { elements: { name?: string }[] }[] } };
    for (const pg of wrapper.template.pages) pg.elements = pg.elements.filter((el) => el.name !== 'tag_ids');
    await admin.from('app_settings').update({ value: JSON.stringify(wrapper) }).eq('key', key);
    try {
      await loginViaForm(page, 'agent.smith@example.com');
      await page.goto(tagUrl);
      await expect(page.getByTestId('ticket-sidebar-survey')).toBeVisible();
      await expect(page.locator('.sd-question[data-name="tag_ids"]')).toHaveCount(0);
      const chips = page.getByTestId('ticket-tags');
      await expect(chips).toBeVisible();
      await expect(chips.getByText('urgent', { exact: true })).toBeVisible();
    } finally {
      await admin.from('app_settings').update({ value: original }).eq('key', key);
    }
  });
});

test.describe('Boolean custom field without a value', () => {
  test.describe.configure({ mode: 'serial' });
  // Not prefixed `E2E` (admin-setup.spec bulk-deletes `E2E%` custom fields).
  const SUFFIX = randomUUID().slice(0, 8);
  const CF_BOOL = `LayoutBool${SUFFIX}`;
  const CF_TEXT = `LayoutText${SUFFIX}`;
  const BOOL_SLUG = 'e2e-ticket-layout-bool-cf';
  let boolUrl: string;
  let boolTicketId: number;

  test.beforeAll(async () => {
    const admin = createServiceRoleClient();
    await admin.from('custom_fields').insert([
      { name: CF_BOOL, field_type: 'checkbox', is_required: false, options: null, default_value: null, display_order: 9200 },
      { name: CF_TEXT, field_type: 'text', is_required: false, options: null, default_value: null, display_order: 9201 },
    ]);
    boolUrl = await seedWithStatus(BOOL_SLUG, 'pending', 'E2E Ticket Layout Bool CF');
    boolTicketId = Number(boolUrl.split('/')[2]);
    await admin.from('tickets').update({ custom_fields: {} }).eq('id', boolTicketId);
  });

  test.afterAll(async () => {
    const admin = createServiceRoleClient();
    try {
      await admin.from('activity_log').delete().eq('ticket_id', boolTicketId);
      await admin.from('posts').delete().eq('ticket_id', boolTicketId);
      await admin.from('tickets').delete().eq('id', boolTicketId);
    } finally {
      await admin.from('custom_fields').delete().in('name', [CF_BOOL, CF_TEXT]);
    }
  });

  test('renders unchecked (not indeterminate) and is not written when another field saves', async ({ page }) => {
    await loginViaForm(page, 'agent.smith@example.com');
    await page.goto(boolUrl);
    const survey = page.getByTestId('ticket-sidebar-survey');
    const box = survey.locator(`.sd-question[data-name="custom_fields.${CF_BOOL}"] input[type=checkbox]`);
    await expect(box).toBeVisible({ timeout: 15000 });
    expect(await box.evaluate((el) => (el as HTMLInputElement).indeterminate)).toBe(false);
    await expect(box).not.toBeChecked();

    const text = survey.locator(`.sd-question[data-name="custom_fields.${CF_TEXT}"] input`).first();
    await text.fill('saved');
    await text.blur();
    await waitForSidebarSurveyAutosave(page);
    const admin = createServiceRoleClient();
    await expect
      .poll(async () => {
        const { data } = await admin.from('tickets').select('custom_fields').eq('id', boolTicketId).single();
        return (data?.custom_fields ?? {}) as Record<string, unknown>;
      }, { timeout: 15000 })
      .toEqual({ [CF_TEXT]: 'saved' });
  });
});

test.describe('Markdown editor follow-ups', () => {
  test.describe.configure({ mode: 'serial' });
  test.use({ viewport: { width: 1440, height: 900 } });
  const FOLLOWUP_SLUG = 'e2e-editor-followups';
  const CANNED_TITLE = 'E2E editor followup canned';
  let ticketUrl: string;

  test.beforeAll(async () => {
    ticketUrl = await seedWithStatus(FOLLOWUP_SLUG, 'pending', 'E2E Editor Followups');
    const admin = createServiceRoleClient();
    await admin.from('canned_responses').delete().eq('title', CANNED_TITLE);
    const { data: agent } = await admin.from('profiles').select('id').eq('email', 'agent.smith@example.com').single();
    const { error } = await admin
      .from('canned_responses')
      .insert({ title: CANNED_TITLE, body: 'Canned **body** text', visibility: 'public', author_id: agent!.id });
    if (error) throw new Error(error.message);
  });

  test.afterAll(async () => {
    const admin = createServiceRoleClient();
    await admin.from('canned_responses').delete().eq('title', CANNED_TITLE);
  });

  test('hover opens the heading menu and clicking H3 inserts "### "', async ({ page }) => {
    await loginViaForm(page, 'alice@example.com');
    await page.goto('/tickets/new');
    const editor = page.getByTestId('markdown-editor');
    const trigger = editor.locator('.button-type-header [role="button"]');
    await trigger.hover();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await editor.getByTestId('editor-heading-3').click();
    await expect(editor.locator('.rc-md-editor textarea').first()).toHaveValue(/### /);
  });

  test('choosing a heading via keyboard returns focus to the textarea', async ({ page }) => {
    await loginViaForm(page, 'alice@example.com');
    await page.goto('/tickets/new');
    const editor = page.getByTestId('markdown-editor');
    const trigger = editor.locator('.button-type-header [role="button"]');
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(editor.getByTestId('editor-heading-1')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(editor.locator('.rc-md-editor textarea').first()).toBeFocused();
  });

  test('mousedown on the menu padding keeps it open', async ({ page }) => {
    await loginViaForm(page, 'alice@example.com');
    await page.goto('/tickets/new');
    const editor = page.getByTestId('markdown-editor');
    const trigger = editor.locator('.button-type-header [role="button"]');
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const box = await editor.locator('.button-type-header .header-list').boundingBox();
    // Left padding edge of the list, outside any menu item.
    await page.mouse.move(box!.x + 1, box!.y + box!.height / 2);
    await page.mouse.down();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await page.mouse.up();
  });

  test('canned response inserted into an empty editor shows the preview', async ({ page }) => {
    await loginViaForm(page, 'agent.smith@example.com');
    await page.goto(ticketUrl);
    await page.getByTestId('main-reply-btn').click();
    const editor = page.getByTestId('main-reply-panel').getByTestId('markdown-editor');
    await expect(editor.locator('.rc-md-editor textarea').first()).toBeVisible();
    await expect(editor.locator('.sec-html')).toBeHidden();
    await editor.getByTestId('canned-response-toolbar-btn').click();
    await editor.getByPlaceholder('Search canned responses…').fill('E2E editor followup');
    await editor.getByRole('button', { name: CANNED_TITLE }).click();
    await expect(editor.locator('.rc-md-editor textarea').first()).toHaveValue(/Canned \*\*body\*\* text/);
    await expect(editor.locator('.sec-html')).toBeVisible();
  });

  test('write-only chosen with the mode toggle stays write-only while typing', async ({ page }) => {
    await loginViaForm(page, 'alice@example.com');
    await page.goto('/tickets/new');
    const editor = page.getByTestId('markdown-editor');
    const textarea = editor.locator('.rc-md-editor textarea').first();
    await textarea.fill('some text');
    await expect(editor.locator('.sec-html')).toBeVisible();
    // both -> write-only
    await editor.locator('.button-type-mode').click();
    await expect(editor.locator('.sec-html')).toBeHidden();
    await textarea.click();
    await page.keyboard.type(' more');
    await expect(editor.locator('.sec-html')).toBeHidden();
  });
});
