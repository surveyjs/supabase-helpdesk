# Change: Admin Setup Sidebar Grouping & Filter

## Summary

The Admin Setup sidebar (`src/app/(main)/admin/AdminSidebar.tsx`) currently lists 25 settings as a flat alphabetical-ish list. This change reorganizes them into **task-oriented groups** with section headings and adds a **filter input** at the top to make discovery faster as the list continues to grow.

## Goals

- Make admin settings scannable by purpose, not by name.
- Keep daily-touch items (Ticket Types, Categories, Agents) at the top of their group; push rare items (Audit Log, Rate Limit) to the bottom of theirs.
- Allow growth past 30+ items without redesign.
- Preserve existing routes — this is a navigation-only change; no settings pages move.

## Non-Goals

- Renaming or merging existing settings pages.
- Changing route paths (`/admin/*` URLs stay the same).
- Adding new settings.

## Grouping

Replace the flat `SECTIONS` array with a grouped structure. Order within each group is by frequency-of-use, then alphabetical.

### 1. Ticket Structure
How tickets are classified and shaped.
- Ticket Types → `/admin/types`
- Categories → `/admin/categories`
- Tags → `/admin/tags`
- Custom Fields → `/admin/custom-fields`
- Ticket Privacy → `/admin/privacy`

### 2. People & Access
Who can sign in and what they can do.
- User Management → `/admin/users`
- Agents & Admins → `/admin/agents`
- Teams → `/admin/teams`
- Authentication → `/admin/auth`
- Subscription Tiers → `/admin/tiers`

### 3. Workflow & SLAs
Operational rules applied to tickets.
- SLA Policies → `/admin/sla`
- CSAT Settings → `/admin/csat`
- Templates → `/admin/templates`

### 4. Channels & Communication
How tickets enter and leave the system.
- Email → `/admin/email`
- Inbound Email → `/admin/inbound-email`
- AI Configuration → `/admin/ai`

### 5. Knowledge Base
- KB Categories → `/admin/kb-categories`

### 6. System Limits & Uploads
- Pagination → `/admin/pagination`
- Rate Limit → `/admin/rate-limit`
- File Uploads → `/admin/file-settings`

### 7. Appearance & UX
- Survey UI Config → `/admin/survey-ui`
- User Settings → `/admin/user-settings`

### 8. Audit & Compliance
- Audit Log → `/admin/audit-log`

## UI Changes

### Desktop sidebar (`md:` and up)
- Replace single `<ul>` with one `<section>` per group.
- Each group: small uppercase heading (`text-xs font-semibold text-gray-500 uppercase tracking-wider`) above its `<ul>`.
- Active link styling and `aria-current="page"` behavior unchanged.
- A **filter input** sits above the first group (`<input type="search" placeholder="Filter settings…">`).
  - Filtering is client-side, case-insensitive, matches against the visible label.
  - Empty groups (all items hidden) are hidden entirely (heading included).
  - When filter is active, no group should appear collapsed; matches stay visible.

### Mobile (`<md`)
- Keep the existing `<select>` dropdown, but render `<optgroup label="…">` per group so users see the same structure.
- Filter input is **not** rendered on mobile (the native select is already searchable on most platforms).

## Implementation Notes

- Define groups as a typed constant:
  ```ts
  type AdminLink = { label: string; href: string };
  type AdminGroup = { heading: string; links: AdminLink[] };
  const GROUPS: AdminGroup[] = [ /* … */ ];
  ```
- Derive `currentSection` by flattening `GROUPS.flatMap(g => g.links)` and matching against `pathname` exactly as today.
- Filter state: `const [query, setQuery] = useState('')`; component becomes/stays `'use client'` (it already is).
- No server-side or DB changes. No new routes.
- Accessibility:
  - Each group `<section>` gets `aria-labelledby` pointing at its heading `<h3 id="…">`.
  - Filter input has a visible or `sr-only` label and `aria-controls` on the nav region.
  - Keyboard focus order: filter → first group's first link → onward.

## Acceptance Criteria

- [ ] All 25 existing routes are still reachable from the sidebar; none are removed.
- [ ] Each link appears in exactly one group.
- [ ] Group headings render on desktop; `<optgroup>` labels render on the mobile `<select>`.
- [ ] Active link highlight and `aria-current="page"` still work for every route.
- [ ] Filter input narrows visible links by label substring (case-insensitive); groups with zero matches are hidden.
- [ ] Clearing the filter restores the full grouped view.
- [ ] No console errors; existing admin E2E tests still pass (update selectors only if they relied on flat list order).

## Out of Scope / Follow-ups

- Collapsible groups with persisted open/closed state (`localStorage`).
- Per-group permission gating (e.g., hide "Subscription Tiers" when feature flag is off) — track separately.
- Renaming "Setup" to something else in the user menu.
