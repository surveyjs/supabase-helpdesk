# Change: Navigation Menu Consolidation

## Summary

Consolidate the navigation bar by moving role-specific links and the Sign out action into the user menu dropdown. Remove the duplicate "agent" menu — there should be only one user menu (the user's display name).

## Changes

### NavBar Structure (`src/components/layout/NavBar.tsx`)

**Top-level navigation bar (left side):**
- "HelpDesk" logo link → `/`
- "My Tickets" → `/tickets` (visible only to **regular users**; agents/admins get this inside the user dropdown)
- "Agent Dashboard" → `/agent` (visible to agents/admins)
- "Help Center" → `/help` (if KB is enabled)
- "Manage Articles" → `/kb/manage` (visible to agents/admins)
- Selected top-level link is highlighted and marked with `aria-current="page"` on both desktop and mobile menus.

**User menu dropdown (right side, `<details>`/`<summary>`):**
- Summary: `{displayName}` + role badge + chevron
- Dropdown contents (in order):
  1. **Admin only:** "Setup" → `/admin` (first item)
  2. **Agents/admins only:** "My Tickets" → `/tickets`
  3. **Agents/admins only:** "Reports" → `/reports`
  4. **Agents/admins only:** "Canned Responses" → `/canned-responses`
  5. **All users:** "Profile" → `/profile`
  6. **All users:** "Notification Settings" → `/notification-settings`
  7. **All users:** "Sign out" (always last, `<form>` with server action, `role="menuitem"`)

**Removed:**
- Standalone "Sign out" button outside the dropdown
- Top-level "Setup" link (moved to dropdown)
- Top-level "Reports" link (moved to dropdown)
- Top-level "Canned Responses" link (moved to dropdown)
- Top-level "My Tickets" link for agents/admins (moved to dropdown; remains top-level for regular users)

### Page Header De-duplication

For nav-driven top-level sections (`/tickets`, `/agent`, `/help`, `/kb/manage`):
- Remove repeated visible page title headings when they duplicate the selected nav label.
- Keep content sections and filter/search controls intact.
- Place contextual primary actions in the filter/search control row (e.g., "New Ticket", "New Article") instead of a separate page title header row.

### E2E Test Updates

**Login confirmation pattern:**
- Old: `await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()`
- New: `await expect(page.locator('summary[aria-haspopup="true"]')).toBeVisible()`

**Sign out action:**
- Old: `await page.getByRole('button', { name: 'Sign out' }).click()`
- New: Open dropdown first, then click menuitem:
  ```typescript
  await page.locator('details summary').click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  ```

**Setup/Reports/Canned Responses link visibility tests:**
- Old: `await expect(page.getByRole('link', { name: 'Setup' })).toBeVisible()`
- New: Open dropdown first, then check menuitem:
  ```typescript
  await page.locator('details summary').click();
  await expect(page.getByRole('menuitem', { name: 'Setup' })).toBeVisible();
  ```

### Files Modified

**Source:**
- `src/components/layout/NavBar.tsx` — Restructured nav links and dropdown menu

**E2E Tests (all loginAs + nav interaction updates):**
- `tests/e2e/auth.spec.ts` — Sign out test, dropdown test, sign out location test
- `tests/e2e/reports.spec.ts` — Reports link visibility test (now checks menuitem in dropdown)
- `tests/e2e/teams-tags.spec.ts` — Setup link visibility tests (now checks menuitem in dropdown)
- `tests/e2e/admin-setup.spec.ts` — Setup link checks (now opens dropdown first)
- `tests/e2e/ai-features.spec.ts` — Setup link check (now opens dropdown first)
- `tests/e2e/csat.spec.ts` — Setup link check (now opens dropdown first)
- All other e2e test files — loginAs confirmation changed from Sign out button to user menu summary

**Prompts Updated:**
- `promts/02-authentication.md` — NavBar spec, dropdown contents, e2e test descriptions
- `promts/04-agent-dashboard.md` — NavBar update section
- `promts/05-teams-types-categories-tags.md` — Setup link location
- `promts/07-admin-setup.md` — Setup link location
- `promts/14-reporting.md` — Reports link location
- `promts/16-canned-responses-follow.md` — Canned Responses link location
