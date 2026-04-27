import { test, expect, Page } from '@playwright/test';
import { createServiceRoleClient } from '../helpers/supabase';
import { addSurveyTag, waitForSidebarSurveyAutosave } from '../helpers/surveyjs';

/**
 * Helper: log in via the login form.
 */
async function loginAs(page: Page, email: string, password = 'Password123') {
  const svc = createServiceRoleClient();
  await svc.from('login_attempts').delete().eq('email', email.toLowerCase());

  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();

  // Retry once on transient auth failure (rate-limit / timing)
  try {
    await expect(page).toHaveURL('/', { timeout: 10000 });
  } catch {
    // Only retry if we're actually on the login page (not already logged in)
    if (page.url().includes('/login')) {
      await svc.from('login_attempts').delete().eq('email', email.toLowerCase());
      await page.goto('/login');
      await page.getByLabel('Email').fill(email);
      await page.getByLabel('Password').fill(password);
      await page.getByRole('button', { name: 'Log in' }).click();
      await expect(page).toHaveURL('/', { timeout: 15000 });
    }
  }

  await expect(page.locator('summary[aria-haspopup="true"]')).toBeVisible({ timeout: 15000 });
}

/** Navigate to an admin page, retrying once if requireAdmin() redirect race occurs. */
async function gotoAdmin(page: Page, path: string) {
  await page.goto(path);
  try {
    await page.waitForURL(/\/admin/, { timeout: 5000 });
  } catch {
    await page.goto(path);
    await page.waitForURL(/\/admin/, { timeout: 10000 });
  }
}

test.describe('Team Tickets', () => {
  test.describe.configure({ mode: 'serial' });

  test('user on a team sees team toggle', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto('/tickets');
    await expect(page.getByTestId('team-toggle')).toBeVisible();
  });

  test('user not on a team does not see toggle', async ({ page }) => {
    await loginAs(page, 'dave@example.com');
    await page.goto('/tickets');
    await expect(page.getByTestId('team-toggle')).not.toBeVisible();
  });

  test('team tickets view shows teammates\' tickets with display names', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto('/tickets?view=team');

    // Confirm team view is active (the "Team Tickets" tab is highlighted)
    await expect(page.getByTestId('team-toggle')).toBeVisible({ timeout: 10000 });
    const teamBtn = page.getByTestId('team-toggle').getByRole('link', { name: 'Team Tickets' });
    await expect(teamBtn).toHaveClass(/bg-blue-600/, { timeout: 10000 });

    // Alice is on Alice's Team with Bob and Carol
    // Should see tickets from all team members with "by" display names
    await expect(page.getByText('by', { exact: false }).first()).toBeVisible();
  });
});

test.describe('Tag Display and Management', () => {
  test.describe.configure({ mode: 'serial' });

  let ticketUrl: string;

  test.beforeAll(async () => {
    const admin = createServiceRoleClient();
    // Use ticket 1 (Password reset not working) which has tags: urgent, bug
    const { data: ticket } = await admin
      .from('tickets')
      .select('id, slug')
      .eq('title', 'Password reset not working')
      .single();
    ticketUrl = `/tickets/${ticket!.id}/${ticket!.slug}`;

    // Reset ticket tags to seed state (urgent, bug only) to ensure idempotency
    const { data: urgentTag } = await admin.from('tags').select('id').eq('name', 'urgent').single();
    const { data: bugTag } = await admin.from('tags').select('id').eq('name', 'bug').single();
    await admin.from('ticket_tags').delete().eq('ticket_id', ticket!.id);
    await admin.from('ticket_tags').insert([
      { ticket_id: ticket!.id, tag_id: urgentTag!.id },
      { ticket_id: ticket!.id, tag_id: bugTag!.id },
    ]);
  });

  test('ticket detail shows tags as colored pills', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto(ticketUrl);

    const tagSection = page.getByTestId('ticket-tags');
    await expect(tagSection).toBeVisible();
    await expect(tagSection.getByText('urgent')).toBeVisible();
    await expect(tagSection.getByText('bug')).toBeVisible();
  });

  test('agent can add a tag to a ticket', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto(ticketUrl);

    const sidebar = page.getByTestId('ticket-sidebar');
    const survey = sidebar.getByTestId('ticket-sidebar-survey');
    await expect(survey).toBeVisible({ timeout: 10000 });

    // Pick a tag that is not already on the ticket from the seed data.
    const admin = createServiceRoleClient();
    const ticketId = ticketUrl.split('/')[2];
    const { data: ticketTagRows } = await admin
      .from('ticket_tags')
      .select('tag_id')
      .eq('ticket_id', ticketId);
    const existing = new Set((ticketTagRows ?? []).map((r) => r.tag_id));
    const { data: allTags } = await admin.from('tags').select('id, name').order('name');
    const target = (allTags ?? []).find((t) => !existing.has(t.id));
    expect(target, 'expected at least one tag not already on the ticket').toBeTruthy();

    await addSurveyTag(survey, 'tag_ids', target!.name);
    await waitForSidebarSurveyAutosave(page);

    await expect.poll(async () => {
      const { data } = await admin
        .from('ticket_tags')
        .select('tag_id')
        .eq('ticket_id', ticketId);
      return (data ?? []).map((r) => r.tag_id).includes(target!.id);
    }, { timeout: 20000, intervals: [500, 500, 1000] }).toBe(true);

    // Cleanup so other tests see the original tag set
    await admin.from('ticket_tags').delete().eq('ticket_id', ticketId).eq('tag_id', target!.id);
  });

  test('agent can remove a tag from a ticket', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto(ticketUrl);

    const sidebar = page.getByTestId('ticket-sidebar');
    const survey = sidebar.getByTestId('ticket-sidebar-survey');
    await expect(survey).toBeVisible({ timeout: 10000 });

    const admin = createServiceRoleClient();
    const ticketId = ticketUrl.split('/')[2];
    const { data: existing } = await admin
      .from('ticket_tags')
      .select('tag_id, tags(name)')
      .eq('ticket_id', ticketId);
    const firstRow = (existing ?? [])[0] as
      | { tag_id: string; tags: { name: string } | { name: string }[] | null }
      | undefined;
    expect(firstRow, 'ticket should have at least one tag in seed data').toBeTruthy();
    const tagsField = firstRow!.tags;
    const tagName = Array.isArray(tagsField) ? tagsField[0]?.name : tagsField?.name;
    expect(tagName).toBeTruthy();
    const firstTagId = firstRow!.tag_id;

    // Remove by toggling the tag off in the SurveyJS tagbox popup
    await addSurveyTag(survey, 'tag_ids', tagName!);
    await waitForSidebarSurveyAutosave(page);

    await expect.poll(async () => {
      const { data } = await admin
        .from('ticket_tags')
        .select('tag_id')
        .eq('ticket_id', ticketId);
      return (data ?? []).map((r) => r.tag_id).includes(firstTagId);
    }, { timeout: 15000 }).toBe(false);

    // Restore the tag for other tests
    await admin.from('ticket_tags').insert({ ticket_id: ticketId, tag_id: firstTagId });
  });
});

test.describe('Agent Dashboard Tag Filter', () => {
  test('tag filter shows and filters tickets', async ({ page }) => {
    const svc = createServiceRoleClient();
    const { data: urgentTag } = await svc.from('tags').select('id').eq('name', 'urgent').single();
    expect(urgentTag?.id).toBeTruthy();

    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/agent');

    // Expand the consolidated Views & Filters panel
    await page.getByText(/Views & Filters:/).click();

    // The Tags filter is rendered as a SurveyJS tagbox question.
    const tagFilter = page.locator('.sd-question[data-name="tags"]').first();
    await expect(tagFilter).toBeVisible();

    await page.goto(`/agent?tags=${urgentTag!.id}`);

    // URL should contain tags param
    await expect(page).toHaveURL(/tags=/, { timeout: 10000 });

    // Should show filtered results
    const resultText = await page.getByTestId('result-count').textContent();
    expect(resultText).toMatch(/\d+ tickets? found/);
  });
});

test.describe('Admin Types Management', () => {
  test.describe.configure({ mode: 'serial' });

  test('non-admin cannot access admin pages', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto('/admin/types');
    // Should be redirected away
    await expect(page).not.toHaveURL('/admin/types', { timeout: 10000 });
  });

  test('admin can access types page and see existing types', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/types');

    await expect(page.getByRole('heading', { name: 'Manage Ticket Types' })).toBeVisible();
    await expect(page.getByText('Question')).toBeVisible();
    await expect(page.getByText('Issue')).toBeVisible();
    await expect(page.getByText('Suggestion')).toBeVisible();
    await expect(page.getByText('(default)')).toBeVisible();
  });

  test('admin can create a new ticket type', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/types');

    await page.locator('#new-type-name').fill('E2E Test Type');
    await page.getByRole('button', { name: 'Add Type' }).click();
    await page.waitForTimeout(2000);

    await expect(page.getByText('E2E Test Type')).toBeVisible();
  });

  test('admin can delete a type', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/types');

    // Delete the E2E Test Type
    const row = page.locator('li').filter({ hasText: 'E2E Test Type' });
    await row.getByRole('button', { name: /Delete/ }).click();
    await page.waitForTimeout(2000);

    await expect(page.getByText('E2E Test Type')).not.toBeVisible();
  });

  test('admin can set default type', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/types');
    await expect(page.getByRole('heading', { name: /Types/ })).toBeVisible({ timeout: 10000 });

    // Issue should have a "Set Default" button
    const issueRow = page.locator('li').filter({ hasText: 'Issue' });
    const setDefaultBtn = issueRow.getByRole('button', { name: 'Set Default' });
    if (await setDefaultBtn.isVisible()) {
      await setDefaultBtn.click();
      // Wait for the "Default" badge to appear confirming the action
      await expect(issueRow.getByText('Default')).toBeVisible({ timeout: 10000 });
    }

    // Restore Question as default
    await gotoAdmin(page, '/admin/types');
    await expect(page.getByRole('heading', { name: /Types/ })).toBeVisible({ timeout: 10000 });
    const questionRow = page.locator('li').filter({ hasText: 'Question' });
    const restoreBtn = questionRow.getByRole('button', { name: 'Set Default' });
    if (await restoreBtn.isVisible()) {
      await restoreBtn.click();
      await expect(questionRow.getByText('Default')).toBeVisible({ timeout: 10000 });
    }
  });
});

test.describe('Admin Categories Management', () => {
  test.describe.configure({ mode: 'serial' });

  test('admin can access categories page', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/categories');

    await expect(page.getByRole('heading', { name: 'Manage Categories' })).toBeVisible();
  });

  test('admin can create and delete a category', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/categories');

    await expect(page.getByRole('heading', { name: 'Manage Categories' })).toBeVisible({ timeout: 10000 });

    await page.locator('#new-category-name').fill('E2E Test Category');
    await page.getByRole('button', { name: 'Add Category' }).click();
    await page.waitForTimeout(2000);

    await expect(page.getByText('E2E Test Category')).toBeVisible();

    // Delete it
    const row = page.locator('li').filter({ hasText: 'E2E Test Category' });
    await row.getByRole('button', { name: /Delete/ }).click();
    await page.waitForTimeout(2000);

    await expect(page.getByText('E2E Test Category')).not.toBeVisible();
  });
});

test.describe('Admin Tags Management', () => {
  test.describe.configure({ mode: 'serial' });

  test('admin can see tags page with colored pills', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/tags');

    await expect(page.getByRole('heading', { name: 'Manage Tags' })).toBeVisible();
    await expect(page.getByText('urgent')).toBeVisible();
    await expect(page.getByText('bug')).toBeVisible();
  });

  test('admin can create a tag with color and delete it', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/tags');

    await page.locator('#new-tag-name').fill('e2e-test-tag');
    // Color input — just submit with default
    await page.getByRole('button', { name: 'Add Tag' }).click();
    await page.waitForTimeout(2000);

    await expect(page.getByText('e2e-test-tag')).toBeVisible();

    // Delete it
    const row = page.locator('li').filter({ hasText: 'e2e-test-tag' });
    await row.getByRole('button', { name: /Delete/ }).click();
    await page.waitForTimeout(2000);

    await expect(page.getByText('e2e-test-tag')).not.toBeVisible();
  });
});

test.describe('Admin Teams Management', () => {
  test.describe.configure({ mode: 'serial' });

  test('admin can access teams page', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/teams');

    await expect(page.getByRole('heading', { name: 'Manage Teams' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Alice's Team")).toBeVisible({ timeout: 10000 });
  });

  test('admin can create a team', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/teams');
    await expect(page.getByRole('heading', { name: /Teams/ })).toBeVisible({ timeout: 10000 });

    // Wait for the form input to be ready
    await expect(page.locator('#new-team-name')).toBeVisible({ timeout: 10000 });
    await page.locator('#new-team-name').fill('E2E Test Team');

    // Wait for the server action to complete
    const responsePromise = page.waitForResponse(
      (resp) => resp.request().method() === 'POST' && resp.status() < 400,
      { timeout: 15000 },
    );
    await page.getByRole('button', { name: 'Create Team' }).click();
    await responsePromise;

    // Reload to get fresh server-rendered page after revalidatePath
    await gotoAdmin(page, '/admin/teams');
    await expect(page.getByText('E2E Test Team')).toBeVisible({ timeout: 10000 });
  });

  test('admin can add member to team', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/teams');
    await expect(page.getByRole('heading', { name: 'Teams' })).toBeVisible({ timeout: 10000 });

    // Find the E2E Test Team section and add Dave
    const teamSection = page.locator('div.bg-white').filter({ hasText: 'E2E Test Team' });
    await teamSection.getByPlaceholder('user@example.com').fill('dave@example.com');
    await teamSection.getByRole('button', { name: 'Add' }).click();

    // Wait for Dave to appear after the server action revalidates the page
    await expect(
      page.locator('div.bg-white').filter({ hasText: 'E2E Test Team' }).getByText('Dave', { exact: true })
    ).toBeVisible({ timeout: 15000 });
  });

  test('admin cannot delete team with members', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/teams');
    await expect(page.getByText('E2E Test Team')).toBeVisible({ timeout: 10000 });

    const teamSection = page.locator('div.bg-white').filter({ hasText: 'E2E Test Team' });
    const responsePromise = page.waitForResponse(resp => resp.request().method() === 'POST');
    await teamSection.getByRole('button', { name: /Delete E2E/ }).click();
    await responsePromise;

    // Team should still be there (server action silently refuses to delete team with members)
    await expect(page.getByText('E2E Test Team')).toBeVisible({ timeout: 10000 });
  });

  test('admin can remove member and delete empty team', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/teams');

    const teamSection = page.locator('div.bg-white').filter({ hasText: 'E2E Test Team' });

    // Remove Dave — wait for the member to disappear
    await teamSection.getByRole('button', { name: /Remove/ }).click();
    await expect(
      page.locator('div.bg-white').filter({ hasText: 'E2E Test Team' }).getByText('Dave', { exact: true })
    ).not.toBeVisible({ timeout: 10000 });

    // Delete the now-empty team
    await gotoAdmin(page, '/admin/teams');
    await expect(page.getByText('E2E Test Team')).toBeVisible({ timeout: 10000 });
    const updatedTeamSection = page.locator('div.bg-white').filter({ hasText: 'E2E Test Team' });
    await updatedTeamSection.getByRole('button', { name: /Delete E2E/ }).click();

    await expect(page.getByText('E2E Test Team')).not.toBeVisible({ timeout: 10000 });
  });
});

test.describe('NavBar Setup Link', () => {
  test('admin sees Setup link in user menu', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await page.locator('details summary').click();
    await expect(page.getByRole('menuitem', { name: 'Setup' })).toBeVisible({ timeout: 10000 });
  });

  test('non-admin does not see Setup link', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.locator('details summary').click();
    await expect(page.getByRole('menuitem', { name: 'Setup' })).not.toBeVisible();
  });

  test('agent does not see Setup link', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.locator('details summary').click();
    await expect(page.getByRole('menuitem', { name: 'Setup' })).not.toBeVisible();
  });
});
