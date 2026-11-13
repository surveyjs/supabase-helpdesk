# UI Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every bug and apply every improvement listed in `docs/ui-review-2026-11-12.md`, plus GitHub issues #50 (filters panel on the left) and #51 (bigger font, more space between "Add comment" and "Add a reply").

**Architecture:** Mostly presentational changes to existing Next.js server/client components and Tailwind classes. A few logic changes: inline runtime config (404 fix), a rehype plugin for remote images, nullable report metrics, a reusable Pagination/RoleBadge, and a SQL relink step in the AnswerDesk importer. No DB migrations.

**Tech Stack:** Next.js 16 (read `node_modules/next/dist/docs/` before using any Next API), React 19, Tailwind 4, SurveyJS (survey-core/survey-react-ui 3.x), unified/rehype, Vitest, Playwright, Postgres (importer).

**Spec:** `docs/ui-review-2026-11-12.md` (item ids B1–B8, I1–I6, §3.x refer to it).

## Global Constraints

- Branch `fix/ui-review` (already created off `origin/main`). One commit per task, message prefixed `ui:`/`fix:`/`import:`; end every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Keep every existing `data-testid`. When a visible label/markup an e2e spec asserts on changes, update that spec **in the same commit**.
- E2E runs against the local Supabase CLI stack (`npm run supabase -- start`, API `127.0.0.1:54321`, `.env.test`) via `npx playwright test <spec>`; never point the e2e suite at `127.0.0.1:8080` (it holds imported customer data).
- Customer data rule: never print, commit or put in tests any post body, name or e-mail from the AnswerDesk package or the 8080 DB. SQL inspection there = counts and masked shapes only (`regexp_replace` digits/GUIDs).
- Verification per task: `npm run typecheck`, `npm run lint`, `npm run test:unit`, plus the e2e specs listed in the task. Every changed page must have no horizontal overflow at 390 px.
- Tailwind only (no new CSS frameworks/deps). New CSS goes in `src/app/globals.css` or a new file under `src/styles/` imported from `src/app/layout.tsx`.

## Review Focus

1. **Role variants** — every changed nav/home/ticket view must still work for a plain `user`, an `agent` and an `admin`, and logged-out. (Task 2 tests user + agent + admin home and mobile menu.)
2. **Phone width (390 px)** — changed pages must not scroll horizontally. (Task 5 and Task 9 assert `scrollWidth <= clientWidth` on ticket and dashboard pages.)
3. **Remote-image blocking must not hit own content** — relative `/attachments/…`, Supabase storage URLs and KB articles keep rendering images. (Task 4 unit tests.)
4. **Report "no data" vs real zero** — show "—" only when the denominator is 0; a real 0 % with tickets stays "0%". (Task 10 unit test.)
5. **Importer relink idempotency** — running relink twice changes nothing the second time; unresolved references stay readable text. (Task 14 SQL check.)

---

### Task 1: Runtime config always present (B1)

**Files:**
- Modify: `src/app/layout.tsx` (replace `<Script src="/runtime-config.js" strategy="beforeInteractive" />`)
- Modify: `src/app/runtime-config.js/route.ts` (export the config-building function if not already exported)
- Modify: `src/components/features/notifications/NotificationBell.tsx` (catch a client-creation error → render bell without realtime)
- Test: `tests/e2e/not-found.spec.ts` (new), `tests/unit/runtime-config.test.ts` (extend if the builder moves)

**Interfaces:** Produces nothing for later tasks.

- [ ] **Step 1: Write the failing e2e test** `tests/e2e/not-found.spec.ts`: `signed-in user sees 404 page for a missing ticket` — log in with an existing helper from `tests/helpers/auth.ts`, `page.goto('/tickets/999999/x')`, expect `getByRole('heading', { name: /404/ })` visible and `getByText('500 — Something Went Wrong')` count 0; same for `/no-such-page`.
- [ ] **Step 2: Run** `npx playwright test tests/e2e/not-found.spec.ts` → FAIL (500 page).
- [ ] **Step 3: Implement.** Render the config as an inline `<script dangerouslySetInnerHTML={{ __html: 'window.__HELPDESK_CONFIG__=' + JSON.stringify(cfg) }} />` in `<head>` of the root layout (root layout must be dynamic for runtime env; check the route's existing caching and keep the `/runtime-config.js` route for backward compatibility). Escape `<` in the JSON (`.replace(/</g,'\\u003c')`). In NotificationBell, wrap `createBrowserClient()` in try/catch so a missing config never crashes the page.
- [ ] **Step 4: Run** the new spec + `tests/unit/runtime-config*.test.ts` + `tests/e2e/auth.spec.ts` → PASS.
- [ ] **Step 5: Commit** `fix: inline runtime config so 404 pages don't crash for signed-in users`.

### Task 2: Navigation, mobile menu, home page (B2, §3.1 nav/home/badge)

**Files:**
- Modify: `src/components/layout/NavBar.tsx`, `MobileMenu.tsx`, `UserMenu.tsx`, `TopNavLinks.tsx` (if needed)
- Create: `src/components/ui/RoleBadge.tsx` (moved out of `UserMenu.tsx`)
- Modify: `src/app/(main)/page.tsx`
- Test: `tests/e2e/polish.spec.ts`, `tests/e2e/auth.spec.ts`, `tests/e2e/reports.spec.ts`, `tests/e2e/popup-coordination.spec.ts` (update), new cases below

**Interfaces:**
- Produces: `export function RoleBadge({ role }: { role: 'admin' | 'agent' | string | null }): JSX.Element | null` in `src/components/ui/RoleBadge.tsx` — admin `bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200`, agent `bg-gray-100 text-gray-700 ring-1 ring-inset ring-gray-300`, text "Admin"/"Agent" (unchanged text).

Decisions:
- Top nav (agents/admins): Agent Dashboard, Reports, Manage Articles, Help Center (if KB visible), Setup (admin only). User dropdown: My Tickets, Canned Responses (agents), Profile, Notification Settings, Sign out. Regular users unchanged (My Tickets in top nav).
- `MobileMenu` props become `{ links, userLinks, displayName, role }`; it renders nav links, a divider, the user's name + RoleBadge, user links, and a Sign out form (`signOut` from `src/lib/actions/auth.ts`). The open/close button moves to the right edge of the bar on mobile (bell stays visible). Keep `button[aria-controls="mobile-nav-menu"]` and `#mobile-nav-menu`.
- Home `/`: agents/admins → `redirect('/agent')`; users keep "Welcome, …" and get a "New ticket" primary button and "My tickets" link under the subtitle.

- [ ] **Step 1: Write failing tests** in `tests/e2e/polish.spec.ts`: `mobile menu offers Sign out and Setup for admin` (viewport 390×844, open menu, expect `#mobile-nav-menu` to contain links Setup, My Tickets, Profile and a button "Sign out"); `mobile menu for regular user has Sign out but no Setup`. In `auth.spec.ts`: `agent landing on / is redirected to /agent`. Update `reports.spec.ts:147-163` to use `getByRole('link', { name: 'Reports' })` in the top nav.
- [ ] **Step 2: Run** those specs → FAIL.
- [ ] **Step 3: Implement** per decisions above.
- [ ] **Step 4: Run** `npx playwright test tests/e2e/polish.spec.ts tests/e2e/auth.spec.ts tests/e2e/reports.spec.ts tests/e2e/popup-coordination.spec.ts tests/e2e/knowledge-base.spec.ts tests/e2e/cross-browser.spec.ts --project=chromium` → PASS.
- [ ] **Step 5: Commit** `ui: mobile menu with account links, top-nav Reports/Setup, agents land on dashboard`.

### Task 3: Typography and form-control baseline (#51 font, §3.1 widths/controls)

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/app/(main)/notification-settings/page.tsx` (drop the narrower centered column; use the standard `(main)` width)
- Test: `tests/e2e/accessibility.spec.ts` (must still pass)

Decisions:
- `body` font → `var(--font-geist-sans)` (Geist, per `docs/design.md`; Arial was the scaffold default); mono → Geist Mono.
- `html { font-size: 106.25%; }` (17 px root → `text-sm` ≈ 14.9 px, `text-xs` ≈ 12.75 px) — answers #51 "font is too small" app-wide.
- Native controls already carry ad-hoc Tailwind classes, so global element selectors would fight them. Instead create utility classes `.form-input`, `.form-select` in `globals.css` matching SurveyJS (`rounded-md`, `border-[--color-input]`, `px-2.5 py-1.5`, `text-sm`, focus `ring-2 ring-blue-600`), and apply them to the native controls on `/tickets/new` (TicketForm), `/reports` (ReportControls), `/admin/users` filters, `/tickets` search. Native checkboxes get `accent-blue-600 h-4 w-4`.

- [ ] **Step 1:** Make the CSS changes; apply the classes to the listed files.
- [ ] **Step 2: Run** `npm run typecheck && npm run lint` and `npx playwright test tests/e2e/accessibility.spec.ts tests/e2e/tickets.spec.ts --project=chromium` → PASS.
- [ ] **Step 3:** Screenshot `/tickets/new`, `/reports`, `/admin/users` at 1440 and 390 (Playwright script in scratchpad) and check nothing overflows or wraps badly.
- [ ] **Step 4: Commit** `ui: Geist font, larger base size, consistent native form controls (#51)`.

### Task 4: Post Markdown rendering — remote images, wrapping (I2, B4)

**Files:**
- Modify: `src/lib/utils/markdown.ts`
- Modify: `src/app/(main)/tickets/[id]/[slug]/page.tsx` (only the `renderMarkdown(post.body)` call sites for posts/comments/notes, ~L242-247)
- Modify: `src/app/(main)/tickets/[id]/[slug]/EditablePost.tsx` (prose container classes)
- Test: `src/lib/utils/__tests__/markdown.test.ts`

**Interfaces:**
- Produces: `renderMarkdown(markdown: string, options?: { blockRemoteImages?: boolean }): Promise<string>` — default `false` (KB/articles unchanged).

Decisions: with `blockRemoteImages`, a rehype plugin running **after** sanitize replaces each `<img>` whose `src` is absolute `http(s)` and does not start with `process.env.NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_URL` or `APP_URL` by `<a href="{src}" target="_blank" rel="noopener noreferrer nofollow" class="external-image" data-external-image="">External image: {alt || hostname}</a>`. Relative src (`/attachments/…`) untouched. Prose container gets `break-words [&_a]:break-all`. `.external-image` styled in `globals.css` as a small gray pill with an image icon (CSS `::before`).

- [ ] **Step 1: Write failing tests:** `blocks remote images when asked` (`![logo](https://example.org/a.png)` → output contains `class="external-image"` and no `<img`); `keeps relative attachment images` (`![x](/attachments/<uuid>)` → `<img src="/attachments/…`); `keeps storage-hosted images` (src = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/…` → `<img`); `does not block by default` (no option → `<img src="https://example.org/a.png"`); `uses hostname when alt is empty`.
- [ ] **Step 2: Run** `npx vitest run src/lib/utils/__tests__/markdown.test.ts` → FAIL.
- [ ] **Step 3: Implement** plugin + option; pass `{ blockRemoteImages: true }` for post/comment/note bodies only.
- [ ] **Step 4: Run** the unit test + `npx playwright test tests/e2e/tickets.spec.ts tests/e2e/inline-image-paste.spec.ts tests/e2e/attachments.spec.ts --project=chromium` → PASS.
- [ ] **Step 5: Commit** `fix: don't hot-load remote images in ticket posts; wrap long links`.

### Task 5: Ticket thread — post actions, attachments, nesting, reply spacing (B3, I6, §3.3 thread, #51 spacing)

**Files:**
- Modify: `src/app/(main)/tickets/[id]/[slug]/page.tsx` (`renderPostCard` action row L457-488, comments rail L539-541, main reply area L889-900)
- Modify: `src/app/(main)/tickets/[id]/[slug]/EditablePost.tsx`, `ReplyToggle.tsx`, `MainReplyToggle.tsx`, `CloneCommentButton.tsx`, `PrivacyCheckbox.tsx`
- Modify: `src/components/features/attachments/AttachmentList.tsx`
- Test: `tests/e2e/posts-comments.spec.ts`, `tests/e2e/attachments.spec.ts`, `tests/e2e/clone.spec.ts` (run; update only if markup assertions break), new `tests/e2e/ticket-layout.spec.ts`

**Interfaces:**
- `EditablePost` gets `actions?: React.ReactNode`, rendered in the same row as the Edit button: `flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-xs text-gray-500`. Edit, Delete, Private, Clone all gray (`hover:text-gray-900`; Delete `hover:text-red-600`). Keep all testids.
- `AttachmentList` gets `hideIds?: string[]`; the page passes ids found in the post body via `/\/attachments\/([0-9a-f-]{36})/gi`.

Decisions: attachment row `flex flex-wrap items-center gap-3`, thumbnail `w-20 sm:w-32 shrink-0`, name/size `min-w-0 flex-1`, delete form `ml-auto`. Comments rail `ml-2 pl-3 sm:ml-5 sm:pl-4`. Main reply: `mt-8` above it plus a top border so "Add comment" (per post) and "Reply to this ticket…" (whole ticket) are visibly separate (#51); the reply toggle gets a real input look (`border-gray-300 bg-white h-11`). If posting a reply on a closed ticket re-opens it (check `src/lib/actions` reply action), show "Replying will re-open this ticket" under the toggle when status is closed; otherwise skip.

- [ ] **Step 1: Write failing tests** in `tests/e2e/ticket-layout.spec.ts`: `post actions are on one row` (Edit and Delete buttons of the same post have equal `boundingBox().y` ±4 px); `no horizontal overflow at 390px on a ticket with an attachment and a long link` (create ticket via service client with a 300-char URL + attachment row, `scrollWidth <= clientWidth`); `inline image is not repeated in the attachment list` (post body references `/attachments/<id>` of its own attachment → the list does not show that file name).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx playwright test tests/e2e/ticket-layout.spec.ts tests/e2e/posts-comments.spec.ts tests/e2e/attachments.spec.ts tests/e2e/clone.spec.ts tests/e2e/inline-image-paste.spec.ts --project=chromium` → PASS.
- [ ] **Step 5: Commit** `ui: compact post actions, responsive attachment rows, separate reply area (#51)`.

### Task 6: Ticket sidebar and header (§3.3 sidebar)

**Files:**
- Modify: `src/app/(main)/tickets/[id]/[slug]/page.tsx` (header + `<aside>` L926-1185), `EditableTitle.tsx`, `DeleteTicketButton.tsx`, `MarkAsDuplicateForm.tsx`, `MergeTicketForm.tsx`, `CloneTicketButton.tsx`
- Modify (CSS only if needed): `src/styles/surveyjs-bridge.css` (scoped to `[data-testid="ticket-sidebar-survey"]`)
- Test: `tests/e2e/advanced-tickets.spec.ts`, `clone.spec.ts`, `sla.spec.ts`, `teams-tags.spec.ts`, `posts-comments.spec.ts`, `ticket-detail-custom-fields.spec.ts` (run; update assertions that target removed duplicates)

Decisions:
- Header meta line: `#{id} · {relative date} · {author}`; drop the `#id` from the sidebar top (keep `TicketSaveStatus` there).
- Closed ticket: hide the Delete row entirely (keep `delete-ticket-btn-disabled` only if a spec needs it — otherwise remove and update spec).
- Advanced actions: one secondary style `inline-flex items-center rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50`, `flex-wrap gap-2`, no truncation ("Merge into…" full text).
- Remove duplicates: drop the Followers row from the second card (`agent-info-under-ticket-info`; keep `follow-section`); render `TicketTagChips` only when the viewer cannot edit tags (non-agents).
- Group the `<dl>` under small headings (`text-xs font-semibold uppercase tracking-wide text-gray-500`): "People" (Created by, team), "Dates" (Created, Updated), "Actions" (Advanced, Delete).
- Gap between the "Private ticket" and "Follow this ticket" checkboxes ≤ 12 px.
- Title pencil: gray `text-gray-400 hover:text-gray-700`, visible on hover/focus of the title group (`opacity-0 group-hover:opacity-100 focus-visible:opacity-100`, always visible on touch: `[@media(hover:none)]:opacity-100`), hit area ≥ 32×32.

- [ ] **Step 1:** Add to `tests/e2e/ticket-layout.spec.ts`: `ticket number shows in header` (`#<id>` visible above the tabs); `closed ticket has no delete row`; `followers count appears once` (`getByText(/\d+ followers?/)` count 1).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the specs listed under Files with `--project=chromium` → PASS.
- [ ] **Step 5: Commit** `ui: tidy ticket sidebar — grouped details, uniform actions, no duplicates`.

### Task 7: Markdown editor (B5, §3.4 editor)

**Files:**
- Modify: `src/components/features/tickets/MarkdownEditor.tsx`
- Create: `src/components/features/tickets/HeaderPlugin.tsx`, `src/styles/markdown-editor.css` (import in `src/app/layout.tsx`)
- Test: `tests/e2e/editor-height-preferences.spec.ts`, `posts-comments.spec.ts`, `inline-image-paste.spec.ts`, `attach-files.spec.ts` (run), new case in `tests/e2e/ticket-layout.spec.ts`

Decisions: replace the library `'header'` plugin with `HeaderPlugin` (same `pluginName = 'header'` registration pattern as the existing `AttachFilePlugin.tsx`) whose dropdown items are `<span>`s (no `<h1>`–`<h6>` elements), inserting `#`…`######` like the original. Default view `{ menu: true, md: true, html: false }` with the existing mode-toggle to switch to preview/split. Toolbar icons 18 px, `color: var(--color-gray-600)`, hover `gray-900`, `title` tooltips kept.

- [ ] **Step 1: Test** `new ticket page has a single h1` (`/tickets/new`: `locator('h1')` count 1) → FAIL.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Run** listed specs → PASS.
- [ ] **Step 4: Commit** `fix: editor header menu without real headings; editor opens in write mode`.

### Task 8: Create-ticket form and boolean custom fields (§3.4 form)

**Files:**
- Modify: `src/components/features/tickets/TicketForm.tsx` (L476-582)
- Modify: `src/lib/tickets/custom-fields-template.ts` (L76-78)
- Test: `src/lib/tickets/__tests__/custom-fields-template.test.ts`, `tests/e2e/ticket-detail-custom-fields.spec.ts`, `tests/e2e/inbound-email.spec.ts`, `tests/e2e/tickets.spec.ts`, `clone.spec.ts`

Decisions: checkbox custom fields render as one inline row (`<label class="inline-flex items-center gap-2">` checkbox + field name) on the form; in the sidebar template add `renderAs: 'checkbox'` for `checkbox` custom fields (same look as `is_private`). Buttons row `flex justify-end gap-3`: Cancel = secondary (`border border-gray-300 bg-white`), Create Ticket = primary; neither `flex-1`; on phones both full-width stacked (`flex-col-reverse sm:flex-row`).

- [ ] **Step 1: Unit test** `checkbox custom field renders as checkbox` in `custom-fields-template.test.ts` (generated question has `type: 'boolean', renderAs: 'checkbox'`) → FAIL.
- [ ] **Step 2: Implement**; update `inbound-email.spec.ts:81` / `ticket-detail-custom-fields.spec.ts` selectors if `label.sd-boolean` no longer exists.
- [ ] **Step 3: Run** unit test + listed e2e → PASS.
- [ ] **Step 4: Commit** `ui: consistent boolean custom fields; right-aligned form buttons`.

### Task 9: Agent dashboard, badges, pagination, filters on the left (§3.2, #50)

**Files:**
- Modify: `src/components/ui/Badge.tsx`, `src/components/ui/Pagination.tsx`
- Modify: `src/app/(main)/agent/page.tsx`, `ViewsFiltersCollapsible.tsx`, `ViewsAndFiltersPanel.tsx`
- Modify: `src/components/features/survey/form-json/admin/agent-dashboard-template.json` (status text "Active" → "Open"; Sort By `defaultValue` = the "Last Modified" choice value)
- Modify: `src/components/features/tickets/StatusFilter.tsx` (label "Active" → "Open"), `src/app/(main)/tickets/page.tsx` (add `<h1 className="sr-only">My Tickets</h1>`)
- Modify: `src/lib/queries/agent-dashboard.ts` (expose whether any SLA policy exists, if not already available)
- Test: `tests/e2e/agent-dashboard.spec.ts` (L70 selector → `getByTestId('agent-ticket-table')`), `sla.spec.ts`, `ai-filter.spec.ts`, `tickets.spec.ts`, new `tests/unit/pagination.test.ts`

**Interfaces:**
- Produces: `Pagination({ currentPage, totalPages, basePath, searchParams?, pageSize?, totalItems? })` — renders First, Previous, a window of 5 pages with `…` gaps to 1 and last, Next, Last, and when `totalItems` is given the text "{from}–{to} of {totalItems formatted with toLocaleString('en-US')}". Pure helper `export function pageWindow(current: number, total: number, size = 5): (number | '…')[]` in the same file.
- Badge colors (all `ring-1 ring-inset`): status open `bg-green-50 text-green-800 ring-green-300`, pending `bg-yellow-50 text-yellow-800 ring-yellow-300`, closed `bg-white text-gray-600 ring-gray-300`; priority low `bg-slate-50 text-slate-600 ring-slate-200`, medium `bg-slate-100 text-slate-700 ring-slate-300`, high `bg-amber-50 text-amber-800 ring-amber-300`, critical `bg-red-50 text-red-700 ring-red-300`.

Decisions:
- Table shows from `lg` (was `md`); cards below. Table wrapper gets `data-testid="agent-ticket-table"`.
- Title cell `line-clamp-2` + `title` attribute; submitter `whitespace-nowrap max-w-[10rem] truncate`; rows `py-2`.
- Private marker: inline 14 px outline lock SVG `text-gray-400` with `aria-label="Private"` (replaces 🔒) — reuse wherever the emoji appears (grep `🔒`).
- SLA column hidden when no SLA policy exists.
- Mobile cards: title, submitter · posts · updated date, status badge, and urgency/severity badges only when not `medium`, labelled ("Urgency: High", "Severity: Critical"). Checkbox column `w-8`.
- #50: at `xl` the page widens to `max-w-7xl` (use the same escape the ticket page uses from the `(main)` `max-w-5xl` container) and Views & Filters becomes a left column `w-72 shrink-0 sticky top-4` (expanded by default, collapsible header kept); below `xl` it stays on top as now. Fix My Stats markup to a real `<dl>`.
- Use `Pagination` with `totalItems` on the dashboard.

- [ ] **Step 1: Write failing tests:** `tests/unit/pagination.test.ts`: `pageWindow(1,128)` → `[1,2,3,4,5,'…',128]`; `pageWindow(64,128)` → `[1,'…',62,63,64,65,66,'…',128]`; `pageWindow(128,128)` → `[1,'…',124,125,126,127,128]`; `pageWindow(2,3)` → `[1,2,3]`. E2E in `agent-dashboard.spec.ts`: `dashboard has no horizontal overflow at 820px and 390px`; `filters panel is left of the list at 1440px` (panel `boundingBox().x` < list `x` and `y` overlaps).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run tests/unit/pagination.test.ts` and `npx playwright test tests/e2e/agent-dashboard.spec.ts tests/e2e/sla.spec.ts tests/e2e/ai-filter.spec.ts tests/e2e/tickets.spec.ts tests/e2e/teams-tags.spec.ts --project=chromium` → PASS.
- [ ] **Step 5: Commit** `ui: agent dashboard — meaningful badges, responsive table, full pagination, filters on the left (#50)`.

### Task 10: Reports (B6, §3.5)

**Files:**
- Modify: `src/lib/queries/reports.ts` (L137, L148, L365-366, L413), `src/components/features/reports/ReportControls.tsx`, `TicketVolumeChart.tsx`, `ResolutionMetricsPanel.tsx`, `SlaCompliancePanel.tsx`, `src/app/(main)/reports/page.tsx`
- Create: `src/lib/utils/format-minutes.ts`
- Test: `src/lib/utils/__tests__/format-minutes.test.ts`, `tests/e2e/reports.spec.ts`

**Interfaces:**
- Produces: `formatMinutes(mins: number | null): string` — `null` → `'—'`, `0` → `'0m'`, `<60` → `'{m}m'`, else `'{h}h {m}m'` (keep the existing output format for non-null; read the current duplicated implementations first). Report metric fields that can lack data become `number | null`.

Decisions: SLA % = `null` when no timers/denominator 0 → gauge shows gray "—" and caption "No tickets in period"; a real 0 % stays red "0%". Ticket Volume empty state keeps its `h3` and `data-testid="ticket-volume-chart"`. Presets: Last 7 days, Last 30 days, Last 90 days, Last 12 months (365 d), All time (start = earliest `tickets.created_at`, end = today); highlight the active preset. Export: one `<details>` "Export CSV ▾" menu at the top-right of the controls card, items labelled via a map `{ ticket_volume: 'Ticket volume', resolution_metrics: 'Resolution metrics', agent_performance: 'Agent performance', csat_summary: 'CSAT summary', sla_compliance: 'SLA compliance', backlog: 'Backlog' }`.

- [ ] **Step 1: Write failing tests:** `format-minutes.test.ts`: `null → '—'`, `0 → '0m'`, `45 → '45m'`, `135 → '2h 15m'` (adjust the last to the current format if different). Add a `reports.spec.ts` case: with a date range containing no tickets, `getByTestId('ticket-volume-chart')` is visible and the SLA gauges show "—" not "0%".
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**; update `reports.spec.ts` export-button assertions to the new menu.
- [ ] **Step 4: Run** unit + `npx playwright test tests/e2e/reports.spec.ts tests/e2e/csat.spec.ts --project=chromium` → PASS.
- [ ] **Step 5: Commit** `ui: reports show "—" for no data, export menu, 12-month and all-time presets`.

### Task 11: Setup / admin (§3.6, B8)

**Files:**
- Modify: `src/components/features/survey/AdminSurveyForm.tsx` (complete-mode button text "Save changes")
- Modify: e2e specs asserting `getByRole('button', { name: 'Complete' })`: `subscription-tiers.spec.ts`, `admin-setup.spec.ts`, `knowledge-base.spec.ts`, `teams-tags.spec.ts` (grep for `'Complete'`)
- Modify: `src/app/(main)/admin/tiers/TiersSurveyForm.tsx` / tiers JSON (empty state), `TierApiSecretCard.tsx` (`<pre>` → `overflow-x-auto`; warning → amber callout)
- Modify: `src/app/(main)/admin/users/page.tsx` (RoleBadge from Task 2, Status column, hide all-empty Team/Tier columns, cards below `md`, filter row `flex-wrap`, `Pagination` from Task 9 with `totalItems`)
- Modify: `src/app/(main)/admin/page.tsx` (overview instead of redirect), `AdminSidebar.tsx` (sticky, `prefetch={false}`, distinct aria-labels)
- Test: `tests/e2e/admin-setup.spec.ts` (L54 redirect assertion → overview heading), the specs above

Decisions:
- `/admin` overview `<h1>Setup</h1>` + cards: users (total / agents / admins / blocked), tickets (open / pending / closed), auth mode + provider name, outbound e-mail configured yes/no, and a "Needs attention" list (e.g. tier API secret not set, e-mail not configured) linking to the right settings page. Server component, counts via the service/admin client already used by admin pages.
- Sidebar desktop: `md:sticky md:top-4 md:max-h-[calc(100vh-2rem)] md:overflow-y-auto`; all `<Link prefetch={false}>`; desktop nav `aria-label="Admin navigation"`, mobile select wrapper `aria-label="Admin navigation (mobile)"`.
- Tiers empty matrix: show "No tiers yet. Click Add Tier to create the first one." (SurveyJS `noRowsText` or a message above the matrix).
- Users table: Role → `RoleBadge` ("User" for plain users as gray text), Status column "Active"/"Blocked" (red-50 pill), Team/Tier columns rendered only if any row on the page has a value; label the tier `select` (L207) with `aria-label`.

- [ ] **Step 1: Update tests first:** replace `'Complete'` with `'Save changes'` in the listed specs; change `admin-setup.spec.ts:54` to expect heading "Setup" at `/admin`; add `admin users page has no horizontal overflow at 390px`.
- [ ] **Step 2: Run** `npx playwright test tests/e2e/admin-setup.spec.ts --project=chromium` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx playwright test tests/e2e/admin-setup.spec.ts tests/e2e/subscription-tiers.spec.ts tests/e2e/knowledge-base.spec.ts tests/e2e/teams-tags.spec.ts tests/e2e/sla.spec.ts --project=chromium` → PASS.
- [ ] **Step 5: Commit** `ui: setup overview, sticky sidebar without prefetch storm, clearer users and tiers pages`.

### Task 12: Accessibility labels and headings (B7) + login divider (§3.7)

**Files:**
- Modify: `src/app/(main)/notification-settings/NotificationPreferencesForm.tsx` (L57-70), `src/app/(main)/admin/user-settings/DefaultNotificationPreferencesForm.tsx` (L75-88), `src/app/(main)/admin/sla/SlaSettingsSurveyForm.tsx` (L71-76, L98-110), `src/app/(main)/canned-responses/page.tsx` (L74), `src/app/(main)/admin/auth/page.tsx` (L59-66), `src/app/(main)/kb/manage/page.tsx` (add `<h1>Manage Articles</h1>`), `src/app/(auth)/login/LoginForm.tsx` (divider L146-148)
- Test: `tests/e2e/accessibility.spec.ts` (add the five pages above to its page list if missing), `notifications.spec.ts`, `sla.spec.ts`, `knowledge-base.spec.ts`, `auth-external.spec.ts`

Decisions: matrix checkboxes `aria-label="{Event label} — Email"` / `"… — In-app"`; SLA inputs get `<label htmlFor>` or `aria-label` equal to their column name; canned search `aria-label="Search canned responses"`; auth Redirect URI label `htmlFor` → the readonly input's id. Login: keep the admin form visible (tests rely on it); divider text `text-sm font-medium text-gray-600 normal-case` "Administrator sign-in".

- [ ] **Step 1:** Add the pages to `accessibility.spec.ts` → run → FAIL (axe `label` violations).
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Run** listed specs → PASS.
- [ ] **Step 4: Commit** `fix: label notification/SLA/search inputs, add missing page headings`.

### Task 13: AnswerDesk importer — ticket references, report, automated mail (I1, I3, I4, I5)

**Files:**
- Create: `scripts/answerdesk/lib/rules.mjs`
- Modify: `scripts/answerdesk/prepare.mjs`, `scripts/answerdesk/load.sql`, `scripts/answerdesk/import.sh`, `scripts/answerdesk/README.md`
- Test: `tests/unit/answerdesk-rules.test.ts`

**Interfaces (rules.mjs):**
- `export function isAutomatedReport(subject: string): boolean` — true for DMARC aggregate reports: `/^(\[Preview\]\s*)?Report Domain:\s*\S+\s+Submitter:\s*\S+\s+Report-ID:/i`.
- `export function friendlyNo(value: string): number | null` — `'T4502'`/`'t4502'`/`'4502'` → `4502`, anything else → `null`.
- `export function distribution(values: Iterable<string | null | undefined>): Array<[string, number]>` — counts, `''`/null/undefined as `'(none)'`, sorted by count desc.

Decisions:
- prepare: skip tickets where `isAutomatedReport(subject)` unless `--keep-automated` (note count "ticket skipped: automated DMARC report"); write `ticket_friendly.tsv` (`friendly_no`, `legacy_id`) for **all** source tickets (not only the sample); append to `report.txt` the distributions of `TicketStatus`, `Severity`, `Urgent`, assignee present yes/no, `IsPrivate` for the sampled tickets (counts only).
- load.sql: `CREATE TABLE IF NOT EXISTS adimport.ticket_friendly (friendly_no INT PRIMARY KEY, legacy_id UUID NOT NULL)`, upsert from staging; `CREATE OR REPLACE FUNCTION adimport.relink_ticket_refs() RETURNS INT` that, for imported posts only (`posts.id` in `adimport` post ids/`s_posts` history — use posts whose ticket is in `ticket_map`), rewrites:
  1. `[label]({'FriendlyId':'T123',…})` → `[label](/tickets/{id}/{slug})` if T123 maps to an imported ticket, else `label (legacy ticket T123)`;
  2. a marker used as link text `[{'FriendlyId':'T123',…}](url)` → `[T123](url)` (url handled by 3);
  3. any remaining bare marker → `[T123](/tickets/{id}/{slug})` or `T123 (legacy ticket)`;
  4. `https?://<host>.answerdesk.io/…` URLs whose path contains a ticket friendly id (`/t(\d+)` — confirm the real path shape with a masked-shape query first) → `/tickets/{id}/{slug}` when mapped; others unchanged.
  Returns the number of posts changed; called at the end of `load.sql` and recorded in the `adimport.runs` summary as `"ticket refs relinked"`. Second call must return 0.
- import.sh: new `relink` command = copy `ticket_friendly.tsv` into the container, load the map, `SELECT adimport.relink_ticket_refs()`, print counts before/after (`count(*) from posts where body like '%FriendlyId%'`). README: document `--keep-automated`, `relink`, and the caveat that references converted to "legacy ticket" text are not re-linked if the sample grows later (use `reset` + reload for exact results).

- [ ] **Step 1: Write failing unit tests** `tests/unit/answerdesk-rules.test.ts`: `isAutomatedReport('[Preview] Report Domain: example.com Submitter: mail.example.net Report-ID: 123')` → true; `isAutomatedReport('Report Domain: example.com Submitter: x.org Report-ID:2026.03.15.1')` → true; `isAutomatedReport('Report a bug in matrix')` → false; `friendlyNo('T4502')` → 4502, `friendlyNo('t17')` → 17, `friendlyNo('abc')` → null; `distribution(['Closed','Closed','Active',null])` → `[['Closed',2],['Active',1],['(none)',1]]`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/answerdesk-rules.test.ts` → FAIL.
- [ ] **Step 3: Implement** rules.mjs, prepare.mjs, load.sql, import.sh, README.
- [ ] **Step 4: Verify on the local deploy DB** (container `supabase-db`, local sample): `PKG=/e/Work/answerdesk-migration FRACTION=0.1 ADMIN_EMAIL= scripts/answerdesk/import.sh prepare` (ADMIN_EMAIL may stay empty: relink loads only the ticket map, not users) then `scripts/answerdesk/import.sh relink` → prints posts-with-FriendlyId before (393) and after (0); run `relink` again → "0 posts changed". Print counts only.
- [ ] **Step 5: Commit** `import: relink AnswerDesk ticket references, skip DMARC reports, value distributions in report`.

### Task 14: Final verification, docs, PR

**Files:**
- Modify: `docs/ui-review-2026-11-12.md` (add a "Status" column/line per item: fixed in this branch, or deferred with reason). Deferred by plan: §3.1 "prompt for a display name on first login" (new onboarding flow, out of scope) and §3.7 collapsible admin login (kept visible; only the divider is restyled).
- Commit the review doc and this plan.

- [ ] **Step 1:** `npm run typecheck && npm run lint && npm run test:unit` → all PASS.
- [ ] **Step 2:** `npx playwright test` (full suite, all projects) → PASS (record any pre-existing flaky failures with their output).
- [ ] **Step 3:** Run the read-only walkthrough (`walk.cjs` from the review, kept in the session scratchpad) against a local `next dev` pointed at the deploy-bundle Supabase (`127.0.0.1:8000`, anon key from `E:\Work\answerdesk-data\.env`) → no console errors, no 500 on 404 routes, no horizontal overflow at 390/820/1440 on the reviewed pages; visually re-check the screenshots of dashboard, ticket #1435/#446, reports, admin users, mobile menu.
- [ ] **Step 4:** Push branch, open PR "UI review fixes" with a summary per area, test evidence, `Closes #50`, `Closes #51`, and the trailer `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- [ ] **Step 5:** Comment on #50 and #51 with what changed and the PR link (they close automatically when the PR merges).
