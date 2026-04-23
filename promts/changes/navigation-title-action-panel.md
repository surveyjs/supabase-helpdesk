# Change: Navigation Active State and Page-Title De-duplication

## Summary

This change removes duplicated top-level page titles that repeat nav labels, highlights the selected nav item, and moves primary create actions into filter/search panels.

## UX Rules

- For top-level sections shown in the navigation (`/tickets`, `/agent`, `/help`, `/kb/manage`):
  - Do not render a duplicate visible page title heading.
  - The selected nav item is the section label.
- Active nav state must be explicit on desktop and mobile:
  - Selected link has distinct active styling.
  - Selected link has `aria-current="page"`.
- Primary create actions should live in the search/filter control row:
  - `/tickets`: `New Ticket`
  - `/kb/manage`: `New Article`

## Implementation Notes

- Because layouts are server-rendered and do not re-render for pathname changes, active-link logic should be in client components using `usePathname()`.
- Keep existing role/visibility logic unchanged:
  - `My Tickets` top-level link is for regular users only.
  - `Agent Dashboard` and `Manage Articles` are for agents/admins.
  - `Help Center` is shown only when `kb_visible=true`.

## Affected Areas

- Navigation components:
  - `src/components/layout/NavBar.tsx`
  - `src/components/layout/MobileMenu.tsx`
  - `src/components/layout/TopNavLinks.tsx`
- Pages:
  - `src/app/(main)/tickets/page.tsx`
  - `src/app/(main)/agent/page.tsx`
  - `src/app/(main)/help/page.tsx`
  - `src/app/(main)/kb/manage/page.tsx`
- E2E expectations:
  - Update assertions from removed headings to active nav checks with `aria-current="page"`.

## Test Guidance

- Prefer assertions like:
  - `await expect(page.getByRole('link', { name: 'Agent Dashboard' })).toHaveAttribute('aria-current', 'page')`
  - `await expect(page.getByRole('link', { name: 'Help Center' })).toHaveAttribute('aria-current', 'page')`
  - `await expect(page.getByRole('link', { name: 'Manage Articles' })).toHaveAttribute('aria-current', 'page')`
- Do not assert visibility of removed top-level page headings for these sections.
