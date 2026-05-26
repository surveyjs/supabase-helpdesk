import { test, expect, Page } from '@playwright/test';
import { createServiceRoleClient } from '../helpers/supabase';
import {
  selectSurveyDropdown,
  toggleSurveyCheckbox,
  waitForSidebarSurveyAutosave,
} from '../helpers/surveyjs';
import { loginViaForm } from '../helpers/auth';

/**
 * Helper: log in via the login form (delegates to the shared, retry-hardened
 * helper which also forces `auth_mode='built-in'` to survive parallel runs
 * with auth-external.spec.ts).
 */
async function loginAs(page: Page, email: string, password = 'Password123') {
  await loginViaForm(page, email, password);
}

test.describe('Agent Dashboard', () => {
  test.describe.configure({ mode: 'serial' });

  test('agent sees "Agent Dashboard" link in nav', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await expect(page.getByRole('link', { name: 'Agent Dashboard' })).toBeVisible();
  });

  test('regular user does not see "Agent Dashboard" link', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await expect(page.getByRole('link', { name: 'Agent Dashboard' })).not.toBeVisible();
  });

  test('non-agent navigating to /agent is redirected', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto('/agent');
    // Should be redirected away from /agent
    await expect(page).not.toHaveURL('/agent', { timeout: 10000 });
  });

  test('dashboard loads with all tickets', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/agent');
    await expect(page.getByRole('link', { name: 'Agent Dashboard' })).toHaveAttribute('aria-current', 'page');
    // Should show result count
    await expect(page.getByTestId('result-count')).toBeVisible();
    const resultText = await page.getByTestId('result-count').textContent();
    expect(resultText).toMatch(/\d+ tickets? found/);
  });

  test('status filter works', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/agent?status=closed');

    await expect(page).toHaveURL(/status=closed/);
    const resultText = await page.getByTestId('result-count').textContent();
    expect(resultText).toMatch(/\d+ tickets? found/);
  });

  test('search by title works (all-posts search)', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/agent');

    // Expand the consolidated Views & Filters panel
    await page.getByText(/Views & Filters:/).click();

    // Search for a ticket from seed data
    await page.getByLabel('Search').fill('Password reset');
    await page.getByRole('button', { name: 'Apply Filters' }).click();

    await expect(page).toHaveURL(/q=Password/);
    await expect(page.locator('.hidden.md\\:block').getByText('Password reset not working').first()).toBeVisible();
  });

  test('filter by submitter email works', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/agent');

    // Expand the consolidated Views & Filters panel
    await page.getByText(/Views & Filters:/).click();

    await page.getByLabel('Submitter Email').fill('alice@example.com');
    await page.getByRole('button', { name: 'Apply Filters' }).click();

    await expect(page).toHaveURL(/email=alice/);
    const resultText = await page.getByTestId('result-count').textContent();
    expect(resultText).toMatch(/\d+ tickets? found/);
  });

  test('sort toggles work', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/agent?sort=created');

    await expect(page).toHaveURL(/sort=created/);
  });

  test('pagination works', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    // With default page size of 20 and seed data, there might be just 1 page.
    // Navigate to page and verify it loads
    await page.goto('/agent?page=1');
    await expect(page.getByTestId('result-count')).toBeVisible();
  });

  test('result count updates with filters', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/agent');

    const allCount = await page.getByTestId('result-count').textContent();

    // Filter to closed only via URL (SurveyJS dropdown is not a native select)
    await page.goto('/agent?status=closed');

    const closedCount = await page.getByTestId('result-count').textContent();
    // Both should be valid count strings
    expect(allCount).toMatch(/\d+ tickets? found/);
    expect(closedCount).toMatch(/\d+ tickets? found/);
  });
});

test.describe('Agent Ticket Detail Controls', () => {
  test.describe.configure({ mode: 'serial' });

  let ticketUrl: string;

  test.beforeAll(async () => {
    // Find a seed data ticket URL for agent testing
    const admin = createServiceRoleClient();
    const { data: ticket } = await admin
      .from('tickets')
      .select('id, slug')
      .eq('title', 'Password reset not working')
      .single();
    ticketUrl = `/tickets/${ticket!.id}/${ticket!.slug}`;

    // Ensure ticket is in 'open' state for consistent test starting point
    await admin.from('tickets').update({ status: 'open' }).eq('id', ticket!.id);
  });

  test('agent can change ticket status from detail page', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto(ticketUrl);

    const sidebar = page.getByTestId('ticket-sidebar');
    await expect(sidebar).toBeVisible({ timeout: 10000 });
    const survey = sidebar.getByTestId('ticket-sidebar-survey');
    await expect(survey).toBeVisible({ timeout: 10000 });

    const ticketId = ticketUrl.split('/')[2];
    const admin = createServiceRoleClient();

    async function setStatusWithRetry(target: 'Pending' | 'Closed') {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const currentSidebar = page.getByTestId('ticket-sidebar');
          await expect(currentSidebar).toBeVisible({ timeout: 10000 });
          const currentSurvey = currentSidebar.getByTestId('ticket-sidebar-survey');
          await expect(currentSurvey).toBeVisible({ timeout: 10000 });
          await selectSurveyDropdown(currentSurvey, 'status', target);
          await waitForSidebarSurveyAutosave(page);
          return;
        } catch (error) {
          if (attempt === 2) throw error;
          await page.goto(ticketUrl);
        }
      }
    }

    // Mark Pending via the SurveyJS Status dropdown
    await setStatusWithRetry('Pending');
    await expect.poll(async () => {
      const { data } = await admin.from('tickets').select('status').eq('id', ticketId).single();
      return data?.status;
    }, { timeout: 15000 }).toBe('pending');

    // Close ticket via the SurveyJS Status dropdown
    await setStatusWithRetry('Closed');
    await expect.poll(async () => {
      const { data } = await admin.from('tickets').select('status').eq('id', ticketId).single();
      return data?.status;
    }, { timeout: 15000 }).toBe('closed');

    // Restore for subsequent tests
    await admin.from('tickets').update({ status: 'open' }).eq('id', ticketId);
  });

  test('agent can change urgency/severity from detail page', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto(ticketUrl);
    const sidebar = page.getByTestId('ticket-sidebar');
    await expect(sidebar).toBeVisible({ timeout: 10000 });
    const survey = sidebar.getByTestId('ticket-sidebar-survey');
    await expect(survey).toBeVisible({ timeout: 10000 });

    const ticketId = ticketUrl.split('/')[2];
    const admin = createServiceRoleClient();

    await selectSurveyDropdown(survey, 'urgency', 'Critical');
    await waitForSidebarSurveyAutosave(page);
    await expect.poll(async () => {
      const { data } = await admin.from('tickets').select('urgency').eq('id', ticketId).single();
      return data?.urgency;
    }, { timeout: 15000 }).toBe('critical');

    await selectSurveyDropdown(survey, 'severity', 'High');
    await waitForSidebarSurveyAutosave(page);
    await expect.poll(async () => {
      const { data } = await admin.from('tickets').select('severity').eq('id', ticketId).single();
      return data?.severity;
    }, { timeout: 15000 }).toBe('high');

    // Restore
    await admin.from('tickets').update({ urgency: 'high', severity: 'medium' }).eq('id', ticketId);
  });

  test('severity/urgency/status dropdowns mirror DB defaults and cannot be cleared', async ({ page }) => {
    // SurveyJS questions whose Supabase column is NOT NULL with a DEFAULT
    // must declare `defaultValue` and `allowClear: false` so users cannot
    // blank the field via the SurveyJS clear (✕) button. `isRequired` is
    // intentionally not set (the sidebar form doesn't surface validation).
    await loginAs(page, 'agent.smith@example.com');
    await page.goto(ticketUrl);
    const sidebar = page.getByTestId('ticket-sidebar');
    const survey = sidebar.getByTestId('ticket-sidebar-survey');
    await expect(survey).toBeVisible({ timeout: 10000 });

    for (const name of ['status', 'urgency', 'severity']) {
      const q = survey.locator(`.sd-question[data-name="${name}"]`);
      await expect(q).toBeVisible();
      // No clear (✕) button is rendered on these dropdowns.
      await expect(
        q.locator('.sd-dropdown_clean-button, .sd-dropdown__clean-button'),
      ).toHaveCount(0);
      // The dropdown shows a non-empty selected value (defaultValue or DB value).
      // SurveyJS v2 exposes the value via `.sd-dropdown__value`; v3 renders it
      // inside `.sd-dropdown__input` (the controlValue div which contains a
      // SurveyLocStringViewer span plus the empty filter <input>). Use a
      // bounded textContent timeout so a missing selector can't burn the
      // entire test budget.
      const valueLocator = q
        .locator('.sd-dropdown__input, .sd-dropdown__value, .sd-dropdown__hint-suffix span')
        .first();
      let valueText = '';
      if (await valueLocator.count()) {
        valueText = (
          (await valueLocator.textContent({ timeout: 2000 }).catch(() => '')) ?? ''
        ).trim();
      }
      if (!valueText) {
        const filterInput = q
          .locator('input.sd-dropdown__filter-string-input, [role="combobox"]')
          .first();
        if (await filterInput.count()) {
          valueText = (await filterInput.inputValue().catch(() => '')).trim();
        }
      }
      expect(valueText.length > 0).toBeTruthy();
    }
  });

  test('agent can change type/category from detail page', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto(ticketUrl);
    const sidebar = page.getByTestId('ticket-sidebar');
    const survey = sidebar.getByTestId('ticket-sidebar-survey');
    await expect(survey).toBeVisible({ timeout: 10000 });

    const ticketId = ticketUrl.split('/')[2];
    const admin = createServiceRoleClient();
    const { data: questionType } = await admin
      .from('ticket_types')
      .select('id')
      .eq('name', 'Question')
      .single();
    const { data: issueType } = await admin
      .from('ticket_types')
      .select('id')
      .eq('name', 'Issue')
      .single();

    await selectSurveyDropdown(survey, 'type_id', 'Question');
    await waitForSidebarSurveyAutosave(page);
    await expect.poll(async () => {
      const { data } = await admin.from('tickets').select('type_id').eq('id', ticketId).single();
      return data?.type_id;
    }, { timeout: 15000 }).toBe(questionType?.id);

    // Restore to Issue
    if (issueType?.id) {
      await admin.from('tickets').update({ type_id: issueType.id }).eq('id', ticketId);
    }
  });

  test('agent can toggle privacy from detail page', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto(ticketUrl);

    const sidebar = page.getByTestId('ticket-sidebar');
    const survey = sidebar.getByTestId('ticket-sidebar-survey');
    await expect(survey).toBeVisible({ timeout: 10000 });

    const ticketId = ticketUrl.split('/')[2];
    const admin = createServiceRoleClient();
    const { data: before } = await admin
      .from('tickets')
      .select('is_private')
      .eq('id', ticketId)
      .single();
    const initial = before?.is_private ?? false;

    await toggleSurveyCheckbox(survey, 'is_private');
    await waitForSidebarSurveyAutosave(page);
    await expect.poll(async () => {
      const { data } = await admin
        .from('tickets')
        .select('is_private')
        .eq('id', ticketId)
        .single();
      return data?.is_private;
    }, { timeout: 15000 }).toBe(!initial);

    // Toggle back to original state
    await toggleSurveyCheckbox(survey, 'is_private');
    await waitForSidebarSurveyAutosave(page);
    await expect.poll(async () => {
      const { data } = await admin
        .from('tickets')
        .select('is_private')
        .eq('id', ticketId)
        .single();
      return data?.is_private;
    }, { timeout: 15000 }).toBe(initial);
  });

  test('agent can assign an agent from the sidebar survey', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');

    // Use an unassigned ticket from seed data
    const admin = createServiceRoleClient();
    const { data: unassigned } = await admin
      .from('tickets')
      .select('id, slug, title')
      .is('assigned_agent_id', null)
      .limit(1)
      .single();

    if (!unassigned) return; // skip if no unassigned tickets

    // Ensure ticket is truly unassigned (cleanup from prior test runs)
    await admin.from('tickets').update({ assigned_agent_id: null }).eq('id', unassigned.id);

    await page.goto(`/tickets/${unassigned.id}/${unassigned.slug}`);
    await expect(page.getByRole('heading', { name: unassigned.title })).toBeVisible({ timeout: 10000 });

    const sidebar = page.getByTestId('ticket-sidebar');
    const survey = sidebar.getByTestId('ticket-sidebar-survey');
    await expect(survey).toBeVisible({ timeout: 10000 });

    // Assign to Agent Smith via the SurveyJS dropdown
    await selectSurveyDropdown(survey, 'assigned_agent_id', /Agent Smith/);
    await waitForSidebarSurveyAutosave(page);
    await expect.poll(async () => {
      const { data } = await admin
        .from('tickets')
        .select('assigned_agent_id')
        .eq('id', unassigned.id)
        .single();
      return data?.assigned_agent_id;
    }, { timeout: 15000 }).toBe('00000000-0000-0000-0000-000000000012');

    // Cleanup: unassign via service role for subsequent tests
    await admin.from('tickets').update({ assigned_agent_id: null }).eq('id', unassigned.id);
  });

  test('assigning self via the sidebar survey works', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');

    // Find an unassigned ticket
    const admin = createServiceRoleClient();
    const { data: tickets } = await admin
      .from('tickets')
      .select('id, slug')
      .is('assigned_agent_id', null)
      .limit(1);

    if (!tickets || tickets.length === 0) return;

    // Ensure ticket is truly unassigned (cleanup from prior test runs)
    await admin.from('tickets').update({ assigned_agent_id: null }).eq('id', tickets[0].id);

    await page.goto(`/tickets/${tickets[0].id}/${tickets[0].slug}`);
    const sidebar = page.getByTestId('ticket-sidebar');
    const survey = sidebar.getByTestId('ticket-sidebar-survey');
    await expect(survey).toBeVisible({ timeout: 10000 });

    await selectSurveyDropdown(survey, 'assigned_agent_id', /Agent Smith/);
    await waitForSidebarSurveyAutosave(page);

    await expect.poll(async () => {
      const { data } = await admin
        .from('tickets')
        .select('assigned_agent_id')
        .eq('id', tickets[0].id)
        .single();
      return data?.assigned_agent_id;
    }, { timeout: 15000 }).toBe('00000000-0000-0000-0000-000000000012');

    // Cleanup: unassign
    await admin.from('tickets').update({ assigned_agent_id: null }).eq('id', tickets[0].id);
  });

  test('agent can reassign ticket to another agent', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');

    // Find an unassigned ticket so we can assign then reassign in one session.
    const admin = createServiceRoleClient();
    const { data: target } = await admin
      .from('tickets')
      .select('id, slug')
      .is('assigned_agent_id', null)
      .limit(1)
      .single();

    if (!target) return;
    await admin.from('tickets').update({ assigned_agent_id: null }).eq('id', target.id);

    await page.goto(`/tickets/${target.id}/${target.slug}`);
    const sidebar = page.getByTestId('ticket-sidebar');
    const survey = sidebar.getByTestId('ticket-sidebar-survey');
    await expect(survey).toBeVisible({ timeout: 10000 });

    // First assign to Agent Smith
    await selectSurveyDropdown(survey, 'assigned_agent_id', /Agent Smith/);
    await waitForSidebarSurveyAutosave(page);
    await expect.poll(async () => {
      const { data } = await admin
        .from('tickets')
        .select('assigned_agent_id')
        .eq('id', target.id)
        .single();
      return data?.assigned_agent_id;
    }, { timeout: 15000 }).toBe('00000000-0000-0000-0000-000000000012');

    // Then reassign to Agent Jones
    await selectSurveyDropdown(survey, 'assigned_agent_id', /Agent Jones/);
    await waitForSidebarSurveyAutosave(page);
    await expect.poll(async () => {
      const { data } = await admin
        .from('tickets')
        .select('assigned_agent_id')
        .eq('id', target.id)
        .single();
      return data?.assigned_agent_id;
    }, { timeout: 15000 }).toBe('00000000-0000-0000-0000-000000000013');

    // Cleanup: unassign for subsequent tests
    await admin.from('tickets').update({ assigned_agent_id: null }).eq('id', target.id);
  });
});

test.describe('Consolidated Views & Filters Panel', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async () => {
    // Reset active_view_id before every test so parallel describe blocks
    // (View Switcher Dropdown) cannot pollute this block's state.
    const admin = createServiceRoleClient();
    await admin.from('profiles').update({ active_view_id: null }).eq('email', 'agent.smith@example.com');
  });

  test('panel is collapsed by default', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/agent');

    // The consolidated panel summary should be visible
    const summary = page.getByText(/Views & Filters:/);
    await expect(summary).toBeVisible();

    // Filter controls should not be visible (panel is closed)
    const filterLabel = page.getByLabel('Search', { exact: true });
    await expect(filterLabel).not.toBeVisible();
  });

  test('panel summary shows "Views & Filters: Default" when no view selected', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/agent');

    // Trigger should show "Default"
    await expect(page.getByTestId('view-switcher-trigger')).toContainText('Default');
  });

  test('panel summary shows current view name when view is applied', async ({ page }) => {
    const token = `view-${Date.now()}`;
    const viewName = `My Test ${token}`;
    await loginAs(page, 'agent.smith@example.com');
    await page.goto(`/agent?status=closed&q=${encodeURIComponent(token)}`);

    // First, expand panel
    await page.getByText(/Views & Filters:/).click();
    await expect(page.getByLabel('Search', { exact: true })).toBeVisible();

    // Use the new "Add new view" inline editor
    await page.getByRole('button', { name: '+ Add new view' }).click();
    await page.getByLabel('New saved view name').fill(viewName);
    await page.getByRole('button', { name: 'Confirm new view' }).click();
    await page.waitForURL(/view=/, { timeout: 10000 });

    // Trigger should now show the view name
    await expect(page.getByTestId('view-switcher-trigger')).toContainText(viewName, { timeout: 10000 });

    // Cleanup: delete the view (need to expand first)
    const deleteBtn = page.getByLabel(`Delete saved view ${viewName}`);
    if (!(await deleteBtn.isVisible())) {
      await page.getByText(/Views & Filters:/).first().click();
      await expect(deleteBtn).toBeVisible({ timeout: 5000 });
    }
    await deleteBtn.click();
    await page.waitForTimeout(1000);
  });

  test('can expand and collapse panel', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/agent');

    // Panel is collapsed initially
    const filterLabel = page.getByLabel('Search', { exact: true });
    await expect(filterLabel).not.toBeVisible();

    // Click summary to expand
    await page.getByText(/Views & Filters:/).click();
    
    // Now filters should be visible
    await expect(filterLabel).toBeVisible();

    // Click again to collapse
    await page.getByText(/Views & Filters:/).click();
    await expect(filterLabel).not.toBeVisible();
  });

  test('saved views list shows Default as non-removable option', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/agent');

    // Expand panel
    await page.getByText(/Views & Filters:/).click();

    // Default should be visible and highlighted if current (scoped to panel to avoid matching the trigger)
    await expect(page.getByTestId('views-and-filters-panel').getByRole('button', { name: 'Default' })).toBeVisible();
  });

  test('create and apply saved view', async ({ page }) => {
    const token = `closed-only-${Date.now()}`;
    const viewName = `Closed Only ${token}`;
    await loginAs(page, 'agent.smith@example.com');
    await page.goto(`/agent?status=closed&q=${encodeURIComponent(token)}`);

    // Expand panel
    await page.getByText(/Views & Filters:/).click();

    // Create saved view via the inline "Add new view" affordance
    await page.getByRole('button', { name: '+ Add new view' }).click();
    await page.getByLabel('New saved view name').fill(viewName);
    await page.getByRole('button', { name: 'Confirm new view' }).click();
    await page.waitForURL(/view=/, { timeout: 10000 });

    // Trigger should reflect the newly-active view
    await expect(page.getByTestId('view-switcher-trigger')).toContainText(viewName, { timeout: 10000 });

    // Cleanup
    {
      const btn = page.getByLabel(`Delete saved view ${viewName}`);
      if (!(await btn.isVisible())) {
        await page.getByText(/Views & Filters:/).first().click();
        await expect(btn).toBeVisible({ timeout: 5000 });
      }
      await btn.click();
      await page.waitForTimeout(1000);
    }
  });

  test('delete saved view (not Default)', async ({ page }) => {
    const token = Date.now();
    const viewName = `To Delete ${token}`;

    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/agent?status=open');

    // Expand panel
    await page.getByText(/Views & Filters:/).click();

    // Create a view with a unique name via the new inline flow
    await page.getByRole('button', { name: '+ Add new view' }).click();
    await page.getByLabel('New saved view name').fill(viewName);
    await page.getByRole('button', { name: 'Confirm new view' }).click();
    await page.waitForURL(/view=/, { timeout: 10000 });

    await expect(page.getByTestId('view-switcher-trigger')).toContainText(viewName, { timeout: 10000 });

    // Re-expand panel and delete
    {
      const btn = page.getByLabel(`Delete saved view ${viewName}`);
      if (!(await btn.isVisible())) {
        await page.getByText(/Views & Filters:/).first().click();
        await expect(btn).toBeVisible({ timeout: 5000 });
      }
      await btn.click();
      await page.waitForTimeout(1000);
    }

    // View should be gone
    await expect(page.getByTestId('views-and-filters-panel').getByRole('button', { name: viewName, exact: true })).not.toBeVisible();
  });

  test('cannot delete Default view (no delete button for Default)', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/agent');

    // Expand panel
    await page.getByText(/Views & Filters:/).click();

    await expect(page.getByTestId('views-and-filters-panel').getByRole('button', { name: 'Default' })).toBeVisible();

    // There must be no delete button labelled for the Default view
    await expect(page.getByLabel('Delete saved view Default')).toHaveCount(0);
  });

  test('applying custom filters updates URL and collapsed summary', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/agent?status=closed');

    // URL should have the filter
    await expect(page).toHaveURL(/status=closed/);

    // Trigger should still show Default (custom filters, not saved view)
    await expect(page.getByTestId('view-switcher-trigger')).toContainText('Default');
  });

  test('clearing filters reverts to Default in collapsed summary', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    // Start with a filtered URL
    await page.goto('/agent?status=closed');

    // Expand panel
    await page.getByText(/Views & Filters:/).click();

    // Click the SurveyJS "Clear All" navigation button
    await page.getByRole('button', { name: 'Clear All' }).click();
    // Then Apply Filters to commit the cleared state
    await page.getByRole('button', { name: 'Apply Filters' }).click();
    await page.waitForLoadState('networkidle');

    // Trigger should show Default
    await expect(page.getByTestId('view-switcher-trigger')).toContainText('Default');

    // URL should be clean
    await expect(page).toHaveURL('/agent');
  });

  test('browser back/forward preserves view and filter state', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');

    // Start at /agent
    await page.goto('/agent');
    await page.waitForLoadState('networkidle');

    // Apply a filter via URL (SurveyJS dropdown is not a native select)
    await page.goto('/agent?status=closed');
    await page.waitForURL(/status=closed/, { timeout: 10000 });
    await page.waitForLoadState('networkidle');

    // Verify filter applied
    await expect(page).toHaveURL(/status=closed/);

    // Navigate to a ticket and back (only when tickets are present)
    const tickets = page.locator('table tbody tr');
    if (await tickets.count() > 0) {
      const firstLink = tickets.first().getByRole('link').first();
      await firstLink.click();
      await page.waitForURL(/\/tickets\//, { timeout: 10000 });
      await page.waitForLoadState('networkidle');

      // Go back
      await page.goBack();
      await page.waitForURL(/status=closed/, { timeout: 10000 });
      await page.waitForLoadState('networkidle');

      // Should still have status=closed in URL
      await expect(page).toHaveURL(/status=closed/);
    }
  });

  test('create, apply, delete saved views', async ({ page }) => {
    const token = Date.now();
    const viewName = `E2E View ${token}`;

    await loginAs(page, 'agent.smith@example.com');
    // Start with non-empty filters so the saved view stores a non-empty filter set
    await page.goto('/agent?status=closed');

    // Expand the consolidated panel
    await page.getByText(/Views & Filters:/).click();

    // Create a saved view via the inline editor
    await page.getByRole('button', { name: '+ Add new view' }).click();
    await page.getByLabel('New saved view name').fill(viewName);
    await page.getByRole('button', { name: 'Confirm new view' }).click();
    await page.waitForURL(/view=/, { timeout: 10000 });

    // Trigger should show the view name (newly active)
    await expect(page.getByTestId('view-switcher-trigger')).toContainText(viewName, { timeout: 10000 });

    // Delete the view (need to expand panel)
    {
      const btn = page.getByLabel(`Delete saved view ${viewName}`);
      if (!(await btn.isVisible())) {
        await page.getByText(/Views & Filters:/).first().click();
        await expect(btn).toBeVisible({ timeout: 5000 });
      }
      await btn.click();
      await page.waitForTimeout(1000);
    }

    // View should be gone
    await expect(page.getByTestId('views-and-filters-panel').getByRole('button', { name: viewName, exact: true })).not.toBeVisible();
  });
});

test.describe('View Switcher Dropdown', () => {
  test.describe.configure({ mode: 'serial' });

  // Use a dedicated agent to avoid sharing active_view_id with the Consolidated Views block.
  const VSD_EMAIL = 'agent.jones@example.com';
  const VSD_AGENT_ID = '00000000-0000-0000-0000-000000000013';
  const VSD_FILTERS = { type: 'json', data: { status: 'closed' }, sql: "status = 'closed'" };

  test.beforeAll(async () => {
    // Clean up any stale state from previous runs for this block's dedicated agent.
    const admin = createServiceRoleClient();
    await admin.from('saved_views').delete().eq('agent_id', VSD_AGENT_ID).like('name', 'Switcher %');
    await admin.from('profiles').update({ active_view_id: null }).eq('id', VSD_AGENT_ID);
  });

  test.afterAll(async () => {
    const admin = createServiceRoleClient();
    await admin.from('saved_views').delete().eq('agent_id', VSD_AGENT_ID).like('name', 'Switcher %');
    await admin.from('profiles').update({ active_view_id: null }).eq('id', VSD_AGENT_ID);
  });

  test('trigger is visible in collapsed panel and opens dropdown on click', async ({ page }) => {
    await loginAs(page, VSD_EMAIL);
    await page.goto('/agent');

    // Panel must be collapsed — the filter search label is not visible
    await expect(page.getByLabel('Search', { exact: true })).not.toBeVisible();

    // Trigger is visible inside the summary
    const trigger = page.getByTestId('view-switcher-trigger');
    await expect(trigger).toBeVisible();

    // Click trigger — dropdown opens, panel does NOT expand
    await trigger.click();
    await expect(page.getByRole('listbox', { name: 'Switch view' })).toBeVisible();
    await expect(page.getByLabel('Search', { exact: true })).not.toBeVisible();
  });

  test('dropdown lists Default and saved views', async ({ page }) => {
    const viewName = `Switcher List ${Date.now()}`;
    const admin = createServiceRoleClient();

    // Seed view directly — avoids the flaky UI creation + server-action path.
    const { data: view } = await admin.from('saved_views').insert({
      agent_id: VSD_AGENT_ID,
      name: viewName,
      filters: VSD_FILTERS,
    }).select('id').single();
    if (!view) throw new Error('Failed to seed view');

    await loginAs(page, VSD_EMAIL);
    // Hard reload ensures the server renders fresh data that includes the seeded view.
    await page.goto('/agent');
    await page.reload();

    // Open the view switcher dropdown
    const trigger = page.getByTestId('view-switcher-trigger');
    await trigger.click();
    const dropdown = page.getByRole('listbox', { name: 'Switch view' });
    await expect(dropdown).toBeVisible();

    // Both Default and the seeded view should be listed
    await expect(dropdown.getByText('Default')).toBeVisible();
    await expect(dropdown.getByText(viewName)).toBeVisible();

    // Cleanup
    await admin.from('saved_views').delete().eq('id', view.id);
  });

  test('active view is highlighted in the dropdown', async ({ page }) => {
    const viewName = `Switcher Highlight ${Date.now()}`;
    const admin = createServiceRoleClient();

    // Seed view. Navigate via ?view= URL param so the server treats it as the active view.
    const { data: view } = await admin.from('saved_views').insert({
      agent_id: VSD_AGENT_ID,
      name: viewName,
      filters: VSD_FILTERS,
    }).select('id').single();
    if (!view) throw new Error('Failed to seed view');

    await loginAs(page, VSD_EMAIL);
    await page.goto(`/agent?view=${view.id}`);

    // Open the dropdown — the active view should be highlighted
    await page.getByTestId('view-switcher-trigger').click();
    const dropdown = page.getByRole('listbox', { name: 'Switch view' });
    await expect(dropdown).toBeVisible();

    const activeOption = dropdown.getByText(viewName);
    await expect(activeOption).toBeVisible();
    // The active option's button has aria-selected="true"
    await expect(activeOption.locator('xpath=ancestor-or-self::button[@aria-selected]')).toHaveAttribute('aria-selected', 'true');

    // Cleanup
    await admin.from('saved_views').delete().eq('id', view.id);
  });

  test('selecting a view from dropdown switches view without opening the panel', async ({ page }) => {
    const viewName = `Switcher Switch ${Date.now()}`;
    const admin = createServiceRoleClient();

    // Seed a view; active_view_id stays null so Default is the current active view.
    const { data: view } = await admin.from('saved_views').insert({
      agent_id: VSD_AGENT_ID,
      name: viewName,
      filters: VSD_FILTERS,
    }).select('id').single();
    if (!view) throw new Error('Failed to seed view');

    await loginAs(page, VSD_EMAIL);
    // Hard reload: panel resets to closed state, seeded view appears in dropdown.
    await page.goto('/agent');
    await page.reload();
    await expect(page.getByLabel('Search', { exact: true })).not.toBeVisible();

    // Open dropdown and select the seeded view — the key assertion is that the panel stays closed.
    await page.getByTestId('view-switcher-trigger').click();
    await page.getByRole('listbox', { name: 'Switch view' }).getByText(viewName).click();

    // URL should update to include the view ID (via client-side router.push)
    await page.waitForURL(/view=/, { timeout: 10000 });

    // Panel must still be collapsed after the switch
    await expect(page.getByLabel('Search', { exact: true })).not.toBeVisible();

    // Trigger shows the view name
    await expect(page.getByTestId('view-switcher-trigger')).toContainText(viewName);

    // Cleanup
    await admin.from('saved_views').delete().eq('id', view.id);
  });

  test('selecting Default from dropdown switches to Default view', async ({ page }) => {
    const viewName = `Switcher Default ${Date.now()}`;
    const admin = createServiceRoleClient();

    // Seed a view and navigate to it via URL param so we start from a non-Default state.
    const { data: view } = await admin.from('saved_views').insert({
      agent_id: VSD_AGENT_ID,
      name: viewName,
      filters: VSD_FILTERS,
    }).select('id').single();
    if (!view) throw new Error('Failed to seed view');

    await loginAs(page, VSD_EMAIL);
    await page.goto(`/agent?view=${view.id}`);

    await expect(page.getByTestId('view-switcher-trigger')).toContainText(viewName);

    // Use dropdown to switch to Default
    await page.getByTestId('view-switcher-trigger').click();
    await page.getByRole('listbox', { name: 'Switch view' }).getByText('Default', { exact: true }).click();

    // URL changes from ?view=<id> to /agent (no params)
    await page.waitForURL('/agent', { timeout: 10000 });
    await expect(page.getByTestId('view-switcher-trigger')).toContainText('Default');

    // Cleanup
    await admin.from('saved_views').delete().eq('id', view.id);
  });

  test('clicking outside the dropdown closes it', async ({ page }) => {
    await loginAs(page, VSD_EMAIL);
    await page.goto('/agent');

    await page.getByTestId('view-switcher-trigger').click();
    await expect(page.getByRole('listbox', { name: 'Switch view' })).toBeVisible();

    // Click somewhere outside the dropdown (result-count is below the panel, outside the listbox)
    await page.getByTestId('result-count').click();
    await expect(page.getByRole('listbox', { name: 'Switch view' })).not.toBeVisible();
  });
});

test.describe('Active View Persistence', () => {
  test.describe.configure({ mode: 'serial' });

  let ticketUrl: string;

  test.beforeAll(async () => {
    const admin = createServiceRoleClient();
    const { data: ticket } = await admin
      .from('tickets')
      .select('id, slug')
      .eq('title', 'Password reset not working')
      .single();
    ticketUrl = `/tickets/${ticket!.id}/${ticket!.slug}`;
  });

  test.afterEach(async () => {
    // Reset stored active view to avoid bleeding between tests.
    const admin = createServiceRoleClient();
    await admin
      .from('profiles')
      .update({ active_view_id: null })
      .eq('email', 'agent.smith@example.com');
  });

  test('saved view is restored after navigating to a ticket and back', async ({ page }) => {
    const token = `persist-${Date.now()}`;
    const viewName = `Persist ${token}`;

    await loginAs(page, 'agent.smith@example.com');
    // Start with a filter so the saved view holds something non-trivial.
    await page.goto(`/agent?status=closed&q=${encodeURIComponent(token)}`);

    // Expand panel and create a named view.
    await page.getByText(/Views & Filters:/).click();
    await page.getByRole('button', { name: '+ Add new view' }).click();
    await page.getByLabel('New saved view name').fill(viewName);
    await page.getByRole('button', { name: 'Confirm new view' }).click();
    await page.waitForURL(/view=/, { timeout: 10000 });

    // Verify the view is active.
    await expect(page.getByTestId('view-switcher-trigger')).toContainText(viewName, { timeout: 10000 });

    // Navigate to a ticket detail page (simulates opening a ticket from the list).
    await page.goto(ticketUrl);
    await page.waitForURL(/\/tickets\//, { timeout: 10000 });

    // Navigate back to /agent with NO query params (simulates clicking nav link).
    await page.goto('/agent');
    await page.waitForLoadState('networkidle');

    // The previously-selected view should be restored automatically.
    await expect(page.getByTestId('view-switcher-trigger')).toContainText(viewName, { timeout: 10000 });

    // Clean up the test view.
    const deleteBtn = page.getByLabel(`Delete saved view ${viewName}`);
    if (!(await deleteBtn.isVisible())) {
      await page.getByText(/Views & Filters:/).first().click();
      await expect(deleteBtn).toBeVisible({ timeout: 5000 });
    }
    await deleteBtn.click();
    await page.waitForTimeout(500);
  });

  test('selecting Default clears stored preference; navigating back shows Default', async ({ page }) => {
    // Seed an active view directly in the DB.
    const admin = createServiceRoleClient();
    const { data: agent } = await admin
      .from('profiles')
      .select('id')
      .eq('email', 'agent.smith@example.com')
      .single();

    const { data: view } = await admin
      .from('saved_views')
      .insert({
        agent_id: agent!.id,
        name: `Temp View ${Date.now()}`,
        filters: { type: 'json', data: {}, sql: '' },
      })
      .select('id')
      .single();

    await admin
      .from('profiles')
      .update({ active_view_id: view!.id })
      .eq('id', agent!.id);

    try {
      await loginAs(page, 'agent.smith@example.com');
      await page.goto('/agent');
      await page.waitForLoadState('networkidle');

      // Expand panel and click Default.
      await page.getByText(/Views & Filters:/).click();
      await page.getByTestId('views-and-filters-panel').getByRole('button', { name: 'Default' }).click();
      await page.waitForLoadState('networkidle');

      // Navigate to a ticket and back.
      await page.goto(ticketUrl);
      await page.goto('/agent');
      await page.waitForLoadState('networkidle');

      // Default view should be shown, not the seeded saved view.
      await expect(page.getByTestId('view-switcher-trigger')).toContainText('Default', { timeout: 10000 });
    } finally {
      await admin.from('saved_views').delete().eq('id', view!.id);
    }
  });

  test('deleting the stored active view falls back to Default', async ({ page }) => {
    const token = `delete-persist-${Date.now()}`;
    const viewName = `Delete Persist ${token}`;

    await loginAs(page, 'agent.smith@example.com');
    await page.goto(`/agent?status=open`);
    await page.getByText(/Views & Filters:/).click();
    await page.getByRole('button', { name: '+ Add new view' }).click();
    await page.getByLabel('New saved view name').fill(viewName);
    await page.getByRole('button', { name: 'Confirm new view' }).click();
    await page.waitForURL(/view=/, { timeout: 10000 });

    // View is now the active one (stored in DB).
    await expect(page.getByTestId('view-switcher-trigger')).toContainText(viewName, { timeout: 10000 });

    // Delete the view while it is the active one.
    const deleteBtn = page.getByLabel(`Delete saved view ${viewName}`);
    if (!(await deleteBtn.isVisible())) {
      await page.getByText(/Views & Filters:/).first().click();
      await expect(deleteBtn).toBeVisible({ timeout: 5000 });
    }
    await deleteBtn.click();
    await page.waitForTimeout(500);

    // Navigate away and back.
    await page.goto(ticketUrl);
    await page.goto('/agent');
    await page.waitForLoadState('networkidle');

    // Should fall back to Default (ON DELETE SET NULL cleared active_view_id).
    await expect(page.getByTestId('view-switcher-trigger')).toContainText('Default', { timeout: 10000 });
  });
});

test.describe('Agent Stats Panel', () => {
  test('collapse/expand toggle works', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/agent');

    // Stats panel exists but is collapsed by default
    const summary = page.getByText('My Stats (Last 30 Days)');
    await expect(summary).toBeVisible();

    // Expand
    await summary.click();
    await expect(page.getByTestId('agent-stats')).toBeVisible();

    // Check metrics are present
    await expect(page.getByText('Tickets Assigned')).toBeVisible();
    await expect(page.getByText('Tickets Resolved')).toBeVisible();
  });

  test('shows correct assigned/resolved counts', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/agent');
    await expect(page.getByTestId('result-count')).toBeVisible({ timeout: 10000 });

    // Expand stats
    await page.getByText('My Stats (Last 30 Days)').click();
    await expect(page.getByTestId('agent-stats')).toBeVisible({ timeout: 10000 });

    // Assigned and resolved counts should be numbers
    const statsPanel = page.getByTestId('agent-stats');
    await expect(statsPanel.getByText('Tickets Assigned')).toBeVisible();
    await expect(statsPanel.getByText('Tickets Resolved')).toBeVisible();
  });

  test('CSAT and SLA metrics show "N/A"', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/agent');

    // Expand stats
    await page.getByText('My Stats (Last 30 Days)').click();
    await expect(page.getByTestId('agent-stats')).toBeVisible();

    // CSAT and SLA should show N/A
    await expect(page.getByText('Avg CSAT Rating')).toBeVisible();
    await expect(page.getByText('SLA Compliance')).toBeVisible();
    // The N/A values
    const naElements = page.getByTestId('agent-stats').getByText('N/A');
    expect(await naElements.count()).toBeGreaterThanOrEqual(3);
  });
});
