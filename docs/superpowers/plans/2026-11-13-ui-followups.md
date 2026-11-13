# UI Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every item in `docs/ui-followups-2026-11-13.md` (A1–A4, B1–B45) except the explicit Won't-fix list.

**Architecture:** Small, area-scoped changes to existing components, CSS utilities, report queries, the
AnswerDesk scripts and e2e specs. No new dependencies and no DB migrations.

**Tech Stack:** Next.js 16 (read `node_modules/next/dist/docs/` before any Next API), React 19, Tailwind 4, SurveyJS 3, react-markdown-editor-lite 1.4.2, Vitest, Playwright, Postgres.

**Spec:** `docs/ui-followups-2026-11-13.md` (IDs A1–A4, B1–B45). Background: `docs/ui-review-2026-11-12.md`.

## Global Constraints

- Branch `fix/ui-followups` (off `origin/main` 0d302d3), worktree `c:\Work\supabase-helpdesk-ui`. Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push until Task 10.
- Keep every existing `data-testid`. When a label/markup an e2e spec asserts on changes, update that spec in the same commit.
- E2E: `npx playwright test -c playwright.alt.config.ts <specs> --project=chromium --reporter=line` (local-only config, port 3200, rebuilds per run; batch specs). Never point e2e at :8080; never print customer data.
- Per task: `npm run typecheck`, `npm run lint`, `npm run test:unit`, listed e2e; changed pages have no horizontal overflow at 390 px.
- CI also runs `tests/bundle/` (bundle e2e against the previous release too) and the migration-upgrade data check (`supabase/upgrade-expectations.json`) — keep both green.
- Tailwind + existing CSS files only (`src/app/globals.css`, `src/styles/*`).

## Review Focus

1. Display-name banner (A3): never shown to users with a real name or on `/profile`, never blocks the page, dismissal persists across reloads. → Task 2 tests.
2. Collapsible admin login (A4): form auto-expanded when the provider is unregistered or after a failed attempt; toggle is keyboard-operable. → Task 2 tests.
3. CSV/report end date (A2): a one-day range includes that day's tickets in both the page and the CSV. → Task 6 test.
4. Pagination with 0 items and with `?page=` beyond the last page (B19). → Task 5 unit test.
5. Lazily mounted filters panel (B23): at ≥1280 px still open on load; below that, expanding loads the form and Apply works. → Task 5 e2e.

## Won't fix

- **B33** — `sla_policies.name` is `UNIQUE` in the schema (001), so per-row labels are already unique.

---

### Task 1: Form-control convergence (A1)

**Files:** every `src/**/*.tsx` with a native `input` (text/email/search/date/number/password/url/datetime-local), `select`, `textarea` or checkbox that still uses the ad-hoc border/ring classes (grep `border-gray-300` together with `focus:ring` on those elements); `src/app/globals.css`.

Decisions: replace the ad-hoc class strings with `.form-input` / `.form-select` / `.form-checkbox` (keep layout utilities like `w-full`, `flex-1`, widths). Inputs inside the MarkdownEditor/SurveyJS are out of scope. `.form-checkbox` gets `focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1`. Buttons placed in the same row as these controls (e.g. /admin/users Filter/Reset, canned-responses search) get the same 36 px height (`h-9`).

- [ ] **Step 1:** List every target control (file:line) in the report; apply the classes.
- [ ] **Step 2:** Throwaway Playwright screenshots (under the SDD workspace, not the repo) of /admin/users, /canned-responses, /profile, /kb/manage, /admin/sla, /admin/email at 1440 and 390 px; no overflow, controls 36 px tall (measure 3 samples).
- [ ] **Step 3:** Run `accessibility.spec.ts tickets.spec.ts knowledge-base.spec.ts admin-setup.spec.ts sla.spec.ts reports.spec.ts` → PASS.
- [ ] **Step 4:** Commit `ui: converge native form controls on shared form classes`.

### Task 2: Navigation, login, display name (A3, A4, B1, B2, B3)

**Files:** `src/app/(main)/page.tsx`, `src/app/(main)/layout.tsx`, create `src/components/layout/DisplayNamePrompt.tsx`, the profile update action (find the existing one used by `/profile`), `src/app/(auth)/login/LoginForm.tsx`, `src/components/features/notifications/NotificationBell.tsx`; tests `tests/e2e/auth.spec.ts`, `tests/e2e/polish.spec.ts`, `tests/e2e/auth-external.spec.ts`, new `tests/e2e/display-name.spec.ts`.

**Interfaces:**
- Produces: `needsDisplayName(profile: { display_name: string | null; email: string }): boolean` in `src/lib/users/display-name.ts` — true when trimmed name is empty or equals the e-mail local part (case-insensitive).

Decisions:
- A3: `(main)` layout renders `DisplayNamePrompt` (client) above `<main>` content when `needsDisplayName` and the path isn't `/profile` and cookie `hd_dn_prompt_dismissed` is absent. Banner: "Add your name so others know who they're talking to." + labelled input (prefilled empty, placeholder = current name) + Save (reuses the profile update action, same 1–100 char validation) + "Not now" (sets the cookie for 30 days, banner hides). Success hides the banner and refreshes. Amber-50 callout style, no overflow at 390 px.
- A4: External mode + `no_redirect`: below the SSO button render a text button "Sign in with password (administrators)" (`aria-expanded`, `aria-controls`) that toggles the existing `AdminPasswordFallback` form. Expanded initially when the provider isn't registered, when the URL has `error`, or when the password action returned an error. The container keeps `data-testid="admin-password-fallback"`. Built-in mode unchanged.
- B1: home link text becomes "View my tickets" (no name clash); e2e `regular user home shows New ticket and View my tickets` clicks both and checks URLs `/tickets/new`, `/tickets`.
- B2: e2e `logged-out phone menu shows Help Center only when KB is visible and no Sign out` (toggle `kb_visible` via service client, restore after).
- B3: replace bare `catch {}` with `console.warn('HelpDesk: realtime notifications disabled —', err)` once.

- [ ] **Step 1:** Unit `tests/unit/display-name.test.ts`: `needsDisplayName({display_name:'', email:'a@x.io'})` → true; `'alice'`/`alice@x.io` → true; `'Alice'`/`alice@x.io` → true (case-insensitive); `'Alice Smith'` → false; `null` → true.
- [ ] **Step 2:** E2E in `display-name.spec.ts` (seed a user whose display_name = local part, restore after): banner visible on `/tickets`, absent on `/profile`; Save "E2E Name" → banner gone and nav shows "E2E Name"; second user: "Not now" → reload → banner absent. A user with a real name never sees it. In `auth-external.spec.ts`: with `no_redirect` the password form is collapsed; Enter on the toggle expands it; unregistered provider → expanded; after a wrong password → still expanded with the error. Update existing auth-external assertions to expand first.
- [ ] **Step 3:** Run them → FAIL. **Step 4:** Implement. **Step 5:** Run `display-name.spec.ts auth.spec.ts auth-external.spec.ts polish.spec.ts` + unit → PASS. Also `npx tsc` covers `tests/bundle/login.spec.ts` (built-in mode, unaffected).
- [ ] **Step 6:** Commit `feat: display-name prompt; collapsible admin password form; home/menu tests`.

### Task 3: Ticket page polish (B4–B13)

**Files:** `src/app/(main)/tickets/[id]/[slug]/page.tsx`, `EditablePost.tsx`, `EditableTitle.tsx`, `MainReplyToggle.tsx`, `TicketSidebarSurvey.tsx`, `src/components/features/attachments/AttachmentList.tsx`, `src/lib/tickets/custom-fields-template.ts`, `src/styles/surveyjs-bridge.css`; tests `tests/e2e/ticket-layout.spec.ts`, `tests/e2e/teams-tags.spec.ts`, unit tests next to changed libs.

**Interfaces:**
- Produces: `inlineAttachmentIds(html: string): string[]` in `src/lib/tickets/inline-attachments.ts` — ids from `src="/attachments/<uuid>"` and `href="/attachments/<uuid>"` attributes of the *rendered* HTML (so code spans/blocks, which are escaped text, never match).

Decisions:
- B4: `AttachmentList` still lists inline-referenced files, collapsed into one muted line `Shown inline: <name> · <name>` with a Delete control per file for users who can delete (same server action/testids as the full rows).
- B5: page computes hide-ids with `inlineAttachmentIds(htmlBody)`.
- B6: hint shows for non-agents when status is `closed` or `pending`; text "Replying will re-open this ticket."
- B7: post action links/buttons: `inline-flex items-center [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:px-2`.
- B8: replace the sidebar `.sd-row--multiple { row-gap }` rule with one scoped to the row containing `[data-name="is_private"]` (`:has()`).
- B9: `showTagChips` = viewer is not an agent OR the final sidebar template has no visible `tag_ids` question. In the sidebar tagbox, colour each chip by its tag colour (border + 10 % tint background, text stays readable) via the survey's after-render hook, re-applied on value change.
- B10: sidebar details become `<section aria-labelledby>` groups, each with an `<h3>` and its own `<dl>` of term/definition pairs: People (Created by), Dates (Created, Updated), Source (From article, KB Article — only when present), Actions (Advanced, Delete).
- B11: title pencil gets `focus-visible:ring-2 focus-visible:ring-blue-500 rounded`.
- B12: a boolean custom field without a value renders as an unchecked checkbox (no indeterminate state) and no value is written unless the user toggles it.
- B13: format MainReplyToggle (prettier-style indentation only).

- [ ] **Step 1:** Unit `tests/unit/inline-attachments.test.ts`: `<img src="/attachments/<uuid1>">` and `<a href="/attachments/<uuid2>">` → both ids; `<code>/attachments/<uuid3></code>` → not included; duplicates once.
- [ ] **Step 2:** E2E (ticket-layout.spec.ts): inline-referenced attachment appears in "Shown inline" with Delete for the owner; pending ticket viewed by its creator shows the re-open hint; sidebar has headings People/Dates/Actions as `h3` and no `dt` without a following `dd`; tag chip for a coloured tag has a non-gray border colour; agent template without `tag_ids` → `ticket-tags` chips visible for the agent; boolean custom field with no value: checkbox not indeterminate (`el.indeterminate === false`), and saving another field leaves `custom_fields` without that key.
- [ ] **Step 3:** Run → FAIL. **Step 4:** Implement. **Step 5:** Run unit + `ticket-layout.spec.ts teams-tags.spec.ts posts-comments.spec.ts attachments.spec.ts inline-image-paste.spec.ts ticket-detail-custom-fields.spec.ts` → PASS.
- [ ] **Step 6:** Commit `ui: ticket page follow-ups — inline attachments, sidebar semantics, tag colours, touch targets`.

### Task 4: Editor follow-ups (B14–B18)

**Files:** `src/components/features/tickets/HeaderPlugin.tsx`, `AutoPreviewPlugin.tsx`, `MarkdownEditor.tsx`; test `tests/e2e/ticket-layout.spec.ts`.

Decisions: after inserting a heading, focus returns to the editor textarea (B14). The menu container cancels `mousedown` default so pressing its padding doesn't blur/close it (B15). AutoPreview decides by comparing desired vs current view each time instead of an `applying` flag; manual override = user clicked the mode-toggle (detect via the toggle's click, not `viewchange`) (B16). MarkdownEditor notifies AutoPreview on every value change it applies, including programmatic ones (canned response insert, reset) (B17).

- [ ] **Step 1:** E2E: hover opens the heading menu and clicking "H3" inserts `### ` (B18); after choosing a heading via keyboard the textarea is focused (B14); mousedown on the menu padding keeps it open (B15); with preference 'both' at 1440 px, inserting a canned response into an empty editor shows the preview (B17); toggle to write-only, type → stays write-only (B16).
- [ ] **Step 2:** Run → FAIL where applicable. **Step 3:** Implement. **Step 4:** Run `ticket-layout.spec.ts editor-height-preferences.spec.ts posts-comments.spec.ts` → PASS.
- [ ] **Step 5:** Commit `fix: heading menu focus/press handling; robust auto preview`.

### Task 5: Agent dashboard and pagination (B19–B23)

**Files:** `src/components/ui/Pagination.tsx`, `src/app/(main)/agent/page.tsx`, `src/app/(main)/admin/users/page.tsx`, `ViewsFiltersCollapsible.tsx`, `ViewsAndFiltersPanel.tsx`; tests `tests/unit/pagination.test.ts`, `tests/e2e/agent-dashboard.spec.ts`, `tests/e2e/ai-features.spec.ts`.

**Interfaces:**
- Produces: `clampPage(page: number, totalPages: number): number` (min 1, max `max(totalPages,1)`) exported from `Pagination.tsx`; pages that render `Pagination` clamp before querying.

Decisions: range text uses the clamped page and is omitted when `totalItems` is 0 (B19). Disabled First/Previous/Next/Last render as `aria-hidden="true"` inert spans (B20). On coarse pointers, card checkbox hit area and pagination links are ≥ 44 px (B22). Below xl the filters panel renders its SurveyJS form only after the first expand (SSR shell + client mount); at ≥ 1280 px it renders open as today (B23).

- [ ] **Step 1:** Unit: `clampPage(999, 128)` → 128; `clampPage(0, 5)` → 1; `clampPage(3, 0)` → 1; Pagination with `totalItems=0` renders no range text (render to string).
- [ ] **Step 2:** E2E: `?page=999` on /agent shows the last page and a range ending in the total (B19); pagination test seeds enough tickets or uses the supported page-size param so ≥ 2 pages exist, clicks Next/Last and asserts rows change (B21); at 820 px the filters panel has no SurveyJS markup before expanding and Apply works after (B23); at 1440 px the panel is open on load. Fix ai-features `/tickets` assertions to target elements that exist on /tickets (B21).
- [ ] **Step 3:** Run → FAIL. **Step 4:** Implement. **Step 5:** Run unit + `agent-dashboard.spec.ts ai-features.spec.ts ai-filter.spec.ts admin-setup.spec.ts subscription-tiers.spec.ts` → PASS.
- [ ] **Step 6:** Commit `fix: pagination clamp and a11y; lazy filters panel below xl; touch targets`.

### Task 6: Reports and CSV (A2, B24–B27)

**Files:** `src/lib/utils/date-range.ts`, `src/lib/queries/reports.ts`, `src/lib/actions/reports.ts`, `src/app/(main)/reports/page.tsx`, `src/components/features/reports/ReportControls.tsx`; tests `tests/unit/date-range.test.ts` (create if missing), `tests/e2e/reports.spec.ts`.

**Interfaces:**
- Produces in `date-range.ts`: `effectiveGroupBy(start: string, end: string, groupBy: 'day'|'week'|'month'): 'day'|'week'|'month'` (day → week when the inclusive range exceeds 366 days) and `endExclusive(end: string): string` (end date + 1 day, `YYYY-MM-DD`). Page and CSV both use them.

Decisions: queries filter `created_at < endExclusive(end)` (inclusive end day) everywhere, page and CSV (A2). CSV volume uses `effectiveGroupBy` (A2). `handleExport` wraps the action in try/catch, shows `result.error` or a generic message in a `role="alert"` next to the Export menu (A2). The export `<details>` closes on outside pointerdown and Escape, returning focus to its summary (B24). The "Daily" option is `disabled` with suffix " (up to 1 year)" when the range exceeds 366 days (B25). The earliest-ticket query applies the same agent scope as the report queries (B26). `getTierCreatorIds` uses `fetchAllRows` and `.in()` in chunks of 200 (B27).

- [ ] **Step 1:** Unit: `endExclusive('2026-03-31')` → `'2026-04-01'`; `effectiveGroupBy('2025-01-01','2026-03-01','day')` → `'week'`; `('2026-01-01','2026-12-31','day')` → `'day'`; month/week unchanged.
- [ ] **Step 2:** E2E: a ticket created at noon on day D, range D..D → volume shows 1 and CSV (via the action's returned text, read with the page's download hook or by calling the action from the test page) has a row for D; failing export (simulate by an invalid range the action rejects) shows the alert; Escape closes the export menu; with an "All time" range the Daily option is disabled.
- [ ] **Step 3:** Run → FAIL. **Step 4:** Implement. **Step 5:** Run unit + `reports.spec.ts csat.spec.ts sla.spec.ts` → PASS.
- [ ] **Step 6:** Commit `fix: inclusive report end date, CSV grouping and errors, export menu and daily option`.

### Task 7: Setup pages (B28–B32)

**Files:** `src/app/(main)/admin/page.tsx`, `src/app/(main)/admin/AdminSidebar.tsx`, `src/components/features/survey/SurveyJsonForm.tsx`, `src/app/(main)/notification-settings/*`, `src/app/(main)/admin/user-settings/*`, create `src/lib/notifications/event-labels.ts`; tests `tests/e2e/admin-setup.spec.ts`, `tests/e2e/notifications.spec.ts`.

**Interfaces:**
- Produces: `NOTIFICATION_EVENT_LABELS: Record<string, string>` in `event-labels.ts`, used by both pages; agent-only events end with " (agents)".

Decisions: a failed count shows "—" and a muted "Couldn't load" note, never 0 (B28). The tier-secret warning appears only when at least one subscription tier exists (B29). E-mail is "Configured" only when `smtp_host` is set and `is_verified`; host set but unverified shows "Not verified" and a Needs-attention item linking to /admin/email (B30). The mobile admin select gets `aria-label="Setup section"`; fix the stale eslint comment in SurveyJsonForm to describe the real deps (B31).

- [ ] **Step 1:** E2E: /admin with no tiers → no tier warning; with a tier → warning (restore after); email host set + unverified → "Not verified"; both notification pages show identical labels for each event (compare the two lists).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run `admin-setup.spec.ts notifications.spec.ts subscription-tiers.spec.ts accessibility.spec.ts` → PASS.
- [ ] **Step 5:** Commit `fix: setup overview accuracy; shared notification labels; admin nav name`.

### Task 8: Test robustness and flaky tests (B34–B40)

**Files:** `tests/e2e/reports.spec.ts`, `tests/e2e/teams-tags.spec.ts`, `src/lib/utils/__tests__/markdown.test.ts`, `tests/e2e/inline-image-paste.spec.ts`, `tests/e2e/ticket-layout.spec.ts`, `tests/e2e/ticket-detail-custom-fields.spec.ts`, `tests/helpers/auth.ts`, `tests/unit/runtime-config-route.test.ts`, plus whatever the flaky-test investigations touch.

Decisions: B34 negative checks → `toHaveCount(0)`. B35 regex → `/<img[^>]+src="(?:https?:)?\/\//` style assertion that actually checks for remote srcs. B36 assert `naturalWidth > 0`. B37 the 390 px test seeds an image attachment with a real storage object and a 2-level comment, asserts no overflow. B38 `getAliceTicketUrl` selects by a title owned by that spec; `loginViaForm` waits until `page.url()` is unchanged across two checks 250 ms apart. B39 `afterEach(() => vi.unstubAllEnvs())`. B40: for each listed flaky test use superpowers:systematic-debugging — reproduce with `--repeat-each=10` (default workers, then `--workers=1`), find the root cause (app or test), fix it, and show 10/10 passes; if a test does not reproduce in 20 runs, record the evidence in the report and leave it unchanged.

- [ ] **Step 1:** Apply B34–B39; run the touched specs + unit → PASS.
- [ ] **Step 2:** Investigate and fix each B40 test (one commit per root cause, message `test: fix flaky <name> — <root cause>`).
- [ ] **Step 3:** Commit remaining changes `test: robustness fixes from review notes`.

### Task 9: AnswerDesk importer (B41–B45)

**Files:** `scripts/answerdesk/relink.sql`, `scripts/answerdesk/prepare.mjs`, `scripts/answerdesk/import.sh`, `scripts/answerdesk/README.md`, create `scripts/answerdesk/relink.test.sql`.

Decisions: `DISTINCT ON (friendly_no)` gets `ORDER BY friendly_no, legacy_id`; prepare.mjs notes the number of duplicate FriendlyIds in report.txt (B41). README documents the rare nested-link/`href` shapes rules e/h can produce (B42). `relink` runs with `client_min_messages = warning` and prints its counts as one SELECT row (B43). `KEEP_AUTOMATED=1` in import.sh passes `--keep-automated` (B44). `relink.test.sql`: self-contained, wrapped in `BEGIN … ROLLBACK`, loads synthetic fixtures (fake ticket map entries and post bodies covering rules a–h, labels with newlines, 10-digit ids), calls `adimport.relink_body(...)`, and `RAISE EXCEPTION` on any mismatch; `import.sh test-relink` runs it against `$DB_CONTAINER` (B45). Run it against the LOCAL TEST stack container `supabase_db_helpdesk` only (`DB_CONTAINER=supabase_db_helpdesk`), never `supabase-db`.

- [ ] **Step 1:** Write `relink.test.sql` with expectations → run → FAIL on the cases B41 affects. **Step 2:** Implement. **Step 3:** Run → "relink tests passed". **Step 4:** Commit `import: deterministic FriendlyId map, quieter relink, KEEP_AUTOMATED, relink self-test`.

### Task 10: Verification, docs, PR

- [ ] **Step 1:** `npm run typecheck && npm run lint && npm run test:unit && npm run test:db`.
- [ ] **Step 2:** Full `npx playwright test -c playwright.alt.config.ts` (all projects); record results.
- [ ] **Step 3:** Mark every ID in `docs/ui-followups-2026-11-13.md` with its status (fixed / won't fix + reason). Commit.
- [ ] **Step 4:** Push `fix/ui-followups`, open the PR (Problem / Change / Testing, IDs per area, `🤖 Generated with [Claude Code](https://claude.com/claude-code)`), watch CI to green.
