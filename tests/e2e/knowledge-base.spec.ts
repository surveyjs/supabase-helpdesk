import { test, expect, Page } from '@playwright/test';
import { createServiceRoleClient } from '../helpers/supabase';

/**
 * Helper: log in via the login form.
 */
async function loginAs(page: Page, email: string, password = 'Password123') {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL('/', { timeout: 10000 });
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible({ timeout: 10000 });
}

/** Navigate to an admin page, retrying once if requireAdmin() redirect race occurs. */
async function gotoAdmin(page: Page, path: string) {
  await page.goto(path);
  if (!page.url().includes('/admin')) {
    await page.goto(path);
  }
}

// ============================================================
// HELP CENTER – Public pages
// ============================================================

test.describe('Help Center – Public', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    // Ensure KB is enabled
    const svc = createServiceRoleClient();
    await svc.from('app_settings').upsert({ key: 'kb_visible', value: 'true' });
  });

  test('help center page loads with categories', async ({ page }) => {
    await page.goto('/help');
    await expect(page.getByRole('heading', { name: 'Help Center' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Getting Started')).toBeVisible();
    await expect(page.getByText('Troubleshooting')).toBeVisible();
  });

  test('help center hidden when KB visibility disabled', async ({ page }) => {
    const svc = createServiceRoleClient();
    await svc.from('app_settings').update({ value: 'false' }).eq('key', 'kb_visible');

    await page.goto('/help');
    // Should 404
    await expect(page.getByText('404')).toBeVisible({ timeout: 10000 });

    // Restore
    await svc.from('app_settings').update({ value: 'true' }).eq('key', 'kb_visible');
  });

  test('article detail page renders Markdown', async ({ page }) => {
    // Article 1: "How to create a ticket" – published, Getting Started
    await page.goto('/help/1/getting-started/how-to-create-a-ticket');
    await expect(page.getByRole('heading', { name: 'How to create a ticket', exact: true })).toBeVisible({ timeout: 10000 });
    // Body should show rendered Markdown (an h1 inside the prose section)
    await expect(page.locator('.prose')).toBeVisible();
    await expect(page.getByText('Creating a ticket is easy')).toBeVisible();
  });

  test('article URL redirect on slug mismatch (307)', async ({ page }) => {
    // Use wrong slug — should redirect to correct URL
    await page.goto('/help/1/wrong-category/wrong-slug', { waitUntil: 'domcontentloaded' });
    // After redirect, we should land on the correct article page
    await expect(page).toHaveURL(/\/help\/1\/getting-started\/how-to-create-a-ticket/, { timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'How to create a ticket', exact: true })).toBeVisible();
  });

  test('draft article returns 404 for regular users', async ({ page }) => {
    // Article 3 is draft — anon user should not see it
    await page.goto('/help/3/troubleshooting/common-login-issues');
    await expect(page.getByText('404')).toBeVisible({ timeout: 10000 });
  });

  test('draft article visible to agents with "Draft" banner', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/help/3/troubleshooting/common-login-issues');
    await expect(page.getByRole('heading', { name: 'Common login issues', exact: true })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('draft')).toBeVisible();
    await expect(page.getByText('not visible to the public')).toBeVisible();
  });

  test('archived article shows "outdated" banner', async ({ page }) => {
    // First, archive article 2 via service role
    const svc = createServiceRoleClient();
    await svc.from('kb_articles').update({ status: 'archived' }).eq('id', 2);

    await page.goto('/help/2/getting-started/understanding-ticket-statuses');
    await expect(page.getByRole('heading', { name: 'Understanding ticket statuses', exact: true })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('may be outdated')).toBeVisible();

    // Restore
    await svc.from('kb_articles').update({ status: 'published' }).eq('id', 2);
  });

  test('search articles returns matching results', async ({ page }) => {
    await page.goto('/help');
    await page.getByPlaceholder('Search articles...').fill('ticket');
    await page.getByRole('button', { name: 'Search' }).click();

    await expect(page.getByText(/result/)).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('link', { name: 'How to create a ticket' })).toBeVisible();
  });
});

// ============================================================
// ARTICLE FEEDBACK
// ============================================================

test.describe('Article Feedback', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    // Ensure KB is visible
    const svc = createServiceRoleClient();
    await svc.from('app_settings').upsert({ key: 'kb_visible', value: 'true' });
    // Clean up any existing feedback from test users
    await svc.from('kb_article_feedback').delete().eq('article_id', 1);
    // Reset counts
    await svc.from('kb_articles').update({ helpful_count: 0, not_helpful_count: 0 }).eq('id', 1);
  });

  test('unauthenticated visitors cannot vote', async ({ page }) => {
    await page.goto('/help/1/getting-started/how-to-create-a-ticket');
    // Wait for the article page to fully render before checking feedback section
    await expect(page.getByText('Was this helpful?')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Log in to vote')).toBeVisible();
  });

  test('authenticated user can vote thumbs up', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto('/help/1/getting-started/how-to-create-a-ticket');

    await expect(page.getByText('Was this helpful?')).toBeVisible({ timeout: 10000 });

    // Click thumbs up
    const thumbsUpBtn = page.getByRole('button', { name: /👍/ });
    await thumbsUpBtn.click();

    // After voting, the button should reflect the vote (green highlight)
    // Wait for page to reload/update
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('button', { name: /👍/ })).toBeVisible();
  });
});

// ============================================================
// TICKET CREATION FROM ARTICLE
// ============================================================

test.describe('Ticket creation from article', () => {
  test.describe.configure({ mode: 'serial' });

  let ticketIdFromArticle: number | null = null;

  test.afterAll(async () => {
    // Clean up ticket created from article
    if (ticketIdFromArticle) {
      const svc = createServiceRoleClient();
      await svc.from('ticket_followers').delete().eq('ticket_id', ticketIdFromArticle);
      await svc.from('posts').delete().eq('ticket_id', ticketIdFromArticle);
      await svc.from('tickets').delete().eq('id', ticketIdFromArticle);
    }
  });

  test('"Create a ticket" link on article (authenticated only)', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto('/help/1/getting-started/how-to-create-a-ticket');

    await expect(page.getByText('Still need help?')).toBeVisible({ timeout: 10000 });
    const createLink = page.getByRole('link', { name: 'Create a ticket' });
    await expect(createLink).toBeVisible();
    await expect(createLink).toHaveAttribute('href', '/tickets/new?from_article=1');
  });

  test('ticket creation from article pre-fills title', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto('/tickets/new?from_article=1');

    await expect(page.getByLabel('Title')).toHaveValue('Question about: How to create a ticket', { timeout: 10000 });
  });

  test('creating ticket from article stores source_article_id', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto('/tickets/new?from_article=1');

    // Title should be pre-filled (also confirms page has loaded and hydrated)
    await expect(page.getByLabel('Title')).toHaveValue('Question about: How to create a ticket', { timeout: 10000 });

    // Wait for the type dropdown to be ready before selecting
    const typeSelect = page.getByLabel('Type');
    await expect(typeSelect).toBeVisible({ timeout: 10000 });
    await typeSelect.selectOption({ label: 'Issue' });

    const descField = page.getByLabel(/Description/);
    await expect(descField).toBeVisible({ timeout: 10000 });
    await descField.fill('I followed the article but still have a question.');

    // Wait for the button to be enabled before clicking
    const submitBtn = page.getByRole('button', { name: 'Create Ticket' });
    await expect(submitBtn).toBeEnabled({ timeout: 5000 });
    await submitBtn.click();

    // Wait for form submission to process (button text changes to "Creating…")
    await expect(page.getByRole('button', { name: 'Creating…' })).toBeVisible({ timeout: 5000 }).catch(() => {
      // Button may already have disappeared if redirect was fast
    });

    // Should redirect to ticket detail
    await expect(page).toHaveURL(/\/tickets\/\d+\//, { timeout: 30000 });

    // Extract ticketId from URL for cleanup
    const match = page.url().match(/\/tickets\/(\d+)\//);
    if (match) ticketIdFromArticle = parseInt(match[1], 10);

    // Verify the ticket was created
    await expect(page.getByText('Question about: How to create a ticket')).toBeVisible({ timeout: 10000 });
  });

  test('source article shows on ticket detail for agents', async ({ page }) => {
    if (!ticketIdFromArticle) {
      test.skip();
      return;
    }

    await loginAs(page, 'agent.smith@example.com');
    const svc = createServiceRoleClient();
    const { data: ticket } = await svc
      .from('tickets')
      .select('id, slug')
      .eq('id', ticketIdFromArticle)
      .single();

    if (!ticket) {
      test.skip();
      return;
    }

    await page.goto(`/tickets/${ticket.id}/${ticket.slug}`);
    await expect(page.getByText('Created from article')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('link', { name: 'How to create a ticket' })).toBeVisible();
  });
});

// ============================================================
// SUGGESTED ARTICLES ON TICKET CREATION
// ============================================================

test.describe('Suggested articles on ticket creation', () => {
  test('suggested articles appear when typing title', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto('/tickets/new');

    // Wait for the form to be interactive
    const titleInput = page.getByLabel('Title');
    await expect(titleInput).toBeVisible({ timeout: 10000 });

    // Type character-by-character to reliably trigger onChange + debounce
    await titleInput.pressSequentially('How to create', { delay: 50 });

    // Wait for debounced search to show suggestions
    await expect(page.getByText('Related articles that might help')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('How to create a ticket')).toBeVisible();
  });
});

// ============================================================
// NAVBAR LINKS
// ============================================================

test.describe('NavBar KB links', () => {
  test.beforeAll(async () => {
    const svc = createServiceRoleClient();
    await svc.from('app_settings').upsert({ key: 'kb_visible', value: 'true' });
  });

  test('Help Center link visible when KB enabled', async ({ page }) => {
    await page.goto('/help');
    await expect(page.getByRole('link', { name: 'Help Center' })).toBeVisible({ timeout: 10000 });
  });

  test('Manage Articles link visible for agents', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await expect(page.getByRole('link', { name: 'Manage Articles' })).toBeVisible({ timeout: 10000 });
  });

  test('Manage Articles link not visible for regular users', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await expect(page.getByRole('link', { name: 'Manage Articles' })).not.toBeVisible();
  });
});

// ============================================================
// ARTICLE MANAGEMENT (Agent)
// ============================================================

test.describe('Article Management', () => {
  test.describe.configure({ mode: 'serial' });

  let newArticleId: number | null = null;

  test.beforeAll(async () => {
    // Clean up any leftover E2E test articles from previous runs
    const svc = createServiceRoleClient();
    const { data: leftover } = await svc.from('kb_articles').select('id').ilike('slug', 'e2e-test-kb-article%');
    if (leftover) {
      for (const a of leftover) {
        await svc.from('kb_article_feedback').delete().eq('article_id', a.id);
        await svc.from('kb_articles').delete().eq('id', a.id);
      }
    }
  });

  test.afterAll(async () => {
    // Clean up E2E test articles
    const svc = createServiceRoleClient();
    if (newArticleId) {
      await svc.from('kb_article_feedback').delete().eq('article_id', newArticleId);
      await svc.from('kb_articles').delete().eq('id', newArticleId);
    }
    // Also clean up by slug in case id wasn't captured
    await svc.from('kb_articles').delete().ilike('slug', 'e2e-test-kb-article%');
  });

  test('manage page: list articles with pagination', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/kb/manage');

    await expect(page.getByRole('heading', { name: 'Manage Articles' })).toBeVisible({ timeout: 10000 });
    // Should show seed articles
    await expect(page.getByText('How to create a ticket')).toBeVisible();
    await expect(page.getByText('Understanding ticket statuses')).toBeVisible();
  });

  test('manage page: filter by status', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/kb/manage');

    await page.getByLabel('Status').selectOption('draft');
    await page.getByRole('button', { name: 'Filter' }).click();

    await expect(page.getByText('Common login issues')).toBeVisible({ timeout: 10000 });
    // Published articles should not be visible
    await expect(page.getByText('How to create a ticket')).not.toBeVisible();
  });

  test('article editor: create new article', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/kb/manage/new');

    await expect(page.getByRole('heading', { name: 'New Article' })).toBeVisible({ timeout: 10000 });

    await page.getByLabel('Title').fill('E2E Test KB Article');
    await page.getByLabel('Category').selectOption({ label: 'Getting Started' });
    await page.getByLabel('Body').fill('# Test Article\n\nThis is a test article created by E2E tests.');
    await page.getByRole('button', { name: /Save|Create/ }).click();

    // Should redirect to edit page
    await expect(page).toHaveURL(/\/kb\/manage\/\d+/, { timeout: 10000 });

    // Capture the article id from URL
    const match = page.url().match(/\/kb\/manage\/(\d+)/);
    if (match) newArticleId = parseInt(match[1], 10);

    // Should show success or the article in edit mode
    await expect(page.getByLabel('Title')).toHaveValue('E2E Test KB Article');
  });

  test('article editor: edit article', async ({ page }) => {
    if (!newArticleId) {
      test.skip();
      return;
    }

    await loginAs(page, 'agent.smith@example.com');
    await page.goto(`/kb/manage/${newArticleId}`);

    // Edit the title
    await page.getByLabel('Title').fill('E2E Test KB Article Updated');
    await page.getByRole('button', { name: /Save|Update/ }).click();

    // Should stay on the edit page
    await expect(page).toHaveURL(/\/kb\/manage\/\d+/, { timeout: 10000 });
    await expect(page.getByLabel('Title')).toHaveValue('E2E Test KB Article Updated');
  });

  test('article management: change status (publish)', async ({ page }) => {
    if (!newArticleId) {
      test.skip();
      return;
    }

    await loginAs(page, 'agent.smith@example.com');
    await page.goto(`/kb/manage/${newArticleId}`);

    // Click Publish on the edit page
    await expect(page.getByRole('heading', { name: 'Edit Article' })).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Publish' }).click();

    // After publish, status should change
    await page.waitForLoadState('networkidle');
    // Verify via DB
    const svc = createServiceRoleClient();
    const { data: article } = await svc.from('kb_articles').select('status').eq('id', newArticleId).single();
    expect(article?.status).toBe('published');
  });

  test('article management: change status (archive)', async ({ page }) => {
    if (!newArticleId) {
      test.skip();
      return;
    }

    await loginAs(page, 'agent.smith@example.com');
    await page.goto(`/kb/manage/${newArticleId}`);

    await expect(page.getByRole('heading', { name: 'Edit Article' })).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Archive' }).click();

    await page.waitForLoadState('networkidle');
    const svc = createServiceRoleClient();
    const { data: article } = await svc.from('kb_articles').select('status').eq('id', newArticleId).single();
    expect(article?.status).toBe('archived');
  });

  test('article management: delete article', async ({ page }) => {
    if (!newArticleId) {
      test.skip();
      return;
    }

    await loginAs(page, 'agent.smith@example.com');
    await page.goto(`/kb/manage/${newArticleId}`);

    // Wait for page to fully load before clicking delete
    await expect(page.getByRole('heading', { name: 'Edit Article' })).toBeVisible({ timeout: 10000 });
    page.on('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: /Delete/ }).click();

    // Should redirect to manage page (not the edit page)
    await expect(page.getByRole('heading', { name: 'Manage Articles' })).toBeVisible({ timeout: 10000 });

    // Verify deletion
    const svc = createServiceRoleClient();
    const { data: article } = await svc.from('kb_articles').select('id').eq('id', newArticleId).single();
    expect(article).toBeNull();

    newArticleId = null; // Prevent afterAll from trying to clean up
  });
});

// ============================================================
// KB VISIBILITY TOGGLE
// ============================================================

test.describe('KB visibility toggle', () => {
  test.describe.configure({ mode: 'serial' });

  test.afterAll(async () => {
    // Restore KB visibility
    const svc = createServiceRoleClient();
    await svc.from('app_settings').update({ value: 'true' }).eq('key', 'kb_visible');
  });

  test('admin can toggle KB visibility', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await page.goto('/kb/manage');

    await expect(page.getByText('Knowledge base visible to public')).toBeVisible({ timeout: 10000 });

    // Toggle visibility
    const toggleBtn = page.getByRole('button', { name: /Enable|Disable/ });
    await expect(toggleBtn).toBeVisible();
    await toggleBtn.click();

    await page.waitForLoadState('networkidle');
  });

  test('agent sees read-only KB visibility checkbox', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/kb/manage');

    await expect(page.getByText('Knowledge base visible to public')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('(Admin only)')).toBeVisible();
  });
});

// ============================================================
// KB CATEGORIES ADMIN
// ============================================================

test.describe('KB Categories Admin', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    // Ensure seed categories exist (may have been deleted by DB test cleanup)
    const svc = createServiceRoleClient();
    await svc.from('kb_categories').upsert(
      { id: '00000000-0000-0000-0000-000000000501', name: 'Getting Started', display_order: 1 },
      { onConflict: 'id' },
    );
    await svc.from('kb_categories').upsert(
      { id: '00000000-0000-0000-0000-000000000502', name: 'Troubleshooting', display_order: 2 },
      { onConflict: 'id' },
    );
  });

  test.afterAll(async () => {
    // Clean up E2E test category
    const svc = createServiceRoleClient();
    await svc.from('kb_categories').delete().eq('name', 'E2E Test Category');
    await svc.from('kb_categories').delete().eq('name', 'E2E Renamed Category');
  });

  test('admin can access KB categories page', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/kb-categories');

    await expect(page.getByRole('heading', { name: 'KB Categories' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Getting Started')).toBeVisible();
    await expect(page.getByText('Troubleshooting')).toBeVisible();
  });

  test('admin can create a new KB category', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/kb-categories');

    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('E2E Test Category');
    await page.getByRole('button', { name: 'Add' }).click();

    await page.waitForLoadState('networkidle');
    await expect(page.getByText('E2E Test Category')).toBeVisible({ timeout: 10000 });
  });

  test('admin can rename a KB category', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/kb-categories');

    // Find the E2E Test Category rename field
    const renameInput = page.getByRole('textbox', { name: 'Rename E2E Test Category' });
    await renameInput.fill('E2E Renamed Category');
    // Click the associated Rename button (in the same list item)
    const listItem = page.locator('li', { hasText: 'E2E Test Category' });
    await listItem.getByRole('button', { name: 'Rename' }).click();

    await page.waitForLoadState('networkidle');
    await expect(page.getByText('E2E Renamed Category')).toBeVisible({ timeout: 10000 });
  });

  test('admin can reorder KB categories', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/kb-categories');

    // Move "Troubleshooting" up
    const moveUpBtn = page.getByRole('button', { name: 'Move Troubleshooting up' });
    await moveUpBtn.click();

    await page.waitForLoadState('networkidle');

    // Confirm order changed: Troubleshooting should appear first in the categories list
    const categoryList = page.locator('ul.divide-y li');
    await expect(categoryList.first().getByText('Troubleshooting')).toBeVisible({ timeout: 10000 });

    // Restore original order
    const moveDownBtn = page.getByRole('button', { name: 'Move Troubleshooting down' });
    await moveDownBtn.click();
    await page.waitForLoadState('networkidle');
  });

  test('admin can delete a KB category', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/kb-categories');

    // Delete the E2E Renamed Category
    const deleteBtn = page.getByRole('button', { name: 'Delete E2E Renamed Category' });
    await deleteBtn.click();

    await expect(page.getByText('E2E Renamed Category')).not.toBeVisible({ timeout: 10000 });
  });
});
