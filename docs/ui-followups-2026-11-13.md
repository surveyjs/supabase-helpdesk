# UI review follow-ups — 2026-11-13

Everything left open after PR #99 (`docs/ui-review-2026-11-12.md`): the four follow-ups listed in the PR,
plus the smaller notes the per-task and final reviewers deferred as "can wait". Each item has an ID. The
plan `docs/superpowers/plans/2026-11-13-ui-followups.md` maps every ID to a task, or to **Won't fix**
with the reason.

## A. Follow-ups named in PR #99

- **A1 Form-control convergence.** About 68 native inputs, selects, textareas and checkboxes still use **[Fixed in 316a33f, 1a1c0b0]**
  ad-hoc classes (`rounded border border-gray-300 … focus:ring-1 focus:ring-blue-500`), so they don't match
  `.form-input`/`.form-select`/`.form-checkbox` (globals.css) and the SurveyJS controls (36 px,
  `rounded-md`, gray-300 border, blue-600 focus ring). Examples: AdminSidebar filter, canned responses,
  MarkdownPreview, KB pages, profile, admin pages. `.form-checkbox` also lost its focus ring. On
  /admin/users the Filter button is 34 px next to 36 px inputs.
- **A2 CSV export.** **[Fixed in e72a3d9, 3d56616]**
  - The end date excludes the last day: `new Date('YYYY-MM-DD')` is midnight at the start of that day.
  - The daily volume CSV ignores the page's 366-day fallback to weekly.
  - A failed export shows nothing: `handleExport` has no try/catch and ignores `result.error`.
- **A3 Display-name prompt.** Users whose display name is empty or just their e-mail local part (1,534 of **[Fixed in 39600cc]**
  7,519 imported profiles) never get asked for a real name. The SSO callback already replaces such names
  with the provider's name when it has one.
- **A4 Collapsible admin password form** on `/login?no_redirect=true` in External mode. **[Fixed in 39600cc]**

## B. Deferred review notes

**Navigation / home / login**
- B1 Home page for users: no e2e covers the "New ticket" / "My tickets" buttons. The home "My tickets" link has the same accessible name as the nav "My Tickets" link (strict-mode clash risk). **[Fixed in 39600cc]**
- B2 No e2e covers the logged-out phone menu. **[Fixed in 39600cc]**
- B3 `NotificationBell` swallows a client-creation error with a bare `catch {}`. **[Fixed in 39600cc]**

**Ticket page**
- B4 Attachments hidden because they are referenced inline lose their Delete button. **[Fixed in 5952700]**
- B5 The inline-attachment id regex runs on raw Markdown, so it also matches ids inside code spans and code blocks. **[Fixed in 5952700]**
- B6 The "replying will re-open" hint only covers `closed`, but the server also re-opens `pending`. **[Fixed in 5952700]**
- B7 Post action links are about 16 px tall: below 44 px touch targets on touch devices. **[Fixed in 5952700]**
- B8 Sidebar CSS `.sd-row--multiple { row-gap: 4px }` tightens every wrapped row in the sidebar survey, not just the Private/Follow checkbox pair. **[Fixed in 5952700]**
- B9 `showTagChips` assumes the agent template contains a `tag_ids` question. If an admin removes it, agents see no tags at all. Agents also lost the coloured tag pills. **[Fixed in 5952700]**
- B10 Sidebar `<dl>` group headings are `<dt>` without `<dd>`. "From article" and "KB Article" rows land under whichever heading precedes them. **[Fixed in 5952700]**
- B11 The title pencil has no visible focus ring, only an opacity change. **[Fixed in 5952700]**
- B12 A boolean custom field with no value renders as an indeterminate ("mixed") checkbox in the sidebar. **[Fixed in 5952700]**
- B13 `MainReplyToggle` fragment children are not indented (formatting). **[Fixed in 5952700]**

**Editor**
- B14 `HeaderPlugin.select()` doesn't return focus to the textarea or the trigger. **[Fixed in 6565f60, 058ff94]**
- B15 Pressing on the heading menu's padding blurs it, which closes it before the click lands. **[Fixed in 6565f60, 058ff94]**
- B16 `AutoPreviewPlugin`'s `applying` flag can swallow the next manual toggle if no `viewchange` fires. **[Fixed in 6565f60, 058ff94]**
- B17 Programmatic value changes (canned response insert, reset) don't re-evaluate auto preview. **[Fixed in 6565f60, 058ff94]**
- B18 The hover path of the heading menu is no longer tested. **[Fixed in 6565f60, 058ff94]**

**Agent dashboard / pagination**
- B19 The Pagination range text isn't clamped past the last page (`?page=999` shows "19,961–128 of 128"). **[Fixed in 209e83a, 74667ab, 541f0f9]**
- B20 `aria-disabled` on a plain `<span>` (disabled First/Previous) means nothing to assistive tech. **[Fixed in 209e83a, 418d6d3 (contrast)]**
- B21 The "pagination works" e2e is vacuous with about 9 seeded tickets. ai-features tests on /tickets look for `agent-ticket-table`, which doesn't exist there. **[Fixed in 209e83a, 74667ab, 541f0f9]**
- B22 Card checkboxes and pagination links are below 44 px touch targets on phones. **[Fixed in 209e83a, 74667ab, 541f0f9]**
- B23 Below xl the filters panel is always mounted, so SurveyJS loads on every dashboard view even when the panel stays collapsed. **[Fixed in 209e83a, 74667ab, 541f0f9]**

**Reports**
- B24 The Export CSV `<details>` menu doesn't close on outside click or Escape. **[Fixed in e72a3d9, 3d56616]**
- B25 Choosing "Daily" for a range over 366 days silently becomes weekly. **[Fixed in e72a3d9, 3d56616]**
- B26 The earliest-ticket query for "All time" ignores the agent's ticket scope. **[Fixed in e72a3d9, 3d56616]**
- B27 `getTierCreatorIds` is unpaged (1000-row cap) and feeds a long `.in()` URL. **[Fixed in e72a3d9, 3d56616]**

**Setup**
- B28 Overview count errors are coerced to 0 (false zeros). **[Fixed in f997950]**
- B29 "Tier API secret not set" shows in Needs attention on every instance, even ones without tiers. **[Fixed in f997950]**
- B30 "Outbound e-mail configured" checks only `smtp_host` and ignores `is_verified`. **[Fixed in f997950]**
- B31 The mobile admin nav select's accessible name became just "Setup". There's also a stale `eslint-disable` comment in SurveyJsonForm (memo deps). **[Fixed in f997950]**
- B32 Notification event labels differ between /notification-settings and /admin/user-settings ("Assigned to You (agent)" vs "Assigned to Agent"). **[Fixed in f997950]**
- B33 SLA row labels are unique only if policy names are unique. **[Won't fix: `sla_policies.name` is UNIQUE (migration 001), so row labels are already unique]**

**Tests (robustness)**
- B34 Negative checks use `not.toBeVisible()` where `toHaveCount(0)` is meant (reports, teams-tags specs). **[Fixed in 3c21286]**
- B35 The weak `it.each` regex `[^\\s]*` in markdown.test.ts. **[Fixed in 3c21286, 4af5435]**
- B36 The inline-image-paste assertion doesn't prove the image loaded (`naturalWidth`). **[Fixed in 3c21286]**
- B37 The ticket-layout 390 px test doesn't exercise the thumbnail row or the comment rail. **[Fixed in 3c21286]**
- B38 `getAliceTicketUrl()` is unscoped, so other specs' alice tickets can race it. The `loginViaForm` stability poll is effectively a single check. **[Fixed in 3c21286]**
- B39 runtime-config-route.test.ts calls `vi.unstubAllEnvs()` inside the test instead of in `afterEach`. **[Fixed in 3c21286]**
- B40 Known flaky e2e tests: **Status per test:**
  - ticket-detail-custom-fields "owner can edit … autosaves" (input detached by re-render) — Documented, unchanged: 0/20 failures after B38 (3c21286) removed the trigger; "Boolean custom field … create form" fixed in 78206e0
  - knowledge-base:177 "Create a ticket link on article" — Fixed in faf1e35, 0ddacb2
  - posts-comments:388 "non-creator non-agent user cannot edit the original post" — Documented, unchanged: not reproduced in 20 runs
  - auth-external:556 "non-admin refused password sign-in" — Fixed in e2806cc
  - editor-height-preferences:92 / 123 (`ensureTestUser` race) — Fixed in 1a454c7
  - ai-filter:114 / 121 — Fixed in 1989814 (the /admin/ai lost update itself is a product follow-up below)
  - agent-dashboard:348 "assign an agent from the sidebar survey" — Documented, unchanged: not reproduced in 35 runs (related Apply flakes fixed in 654297d, 7bc83c0, 5bda093)

**AnswerDesk importer**
- B41 `DISTINCT ON (friendly_no)` without `ORDER BY`: duplicate FriendlyIds are resolved arbitrarily and silently. **[Fixed in 65a4e21]**
- B42 Relink rules e/h can create nested links or break an `href` in rare shapes. No README caveat. **[Fixed in 65a4e21]**
- B43 `import.sh relink` prints Postgres notice noise. **[Fixed in 65a4e21]**
- B44 `--keep-automated` can only be reached by calling prepare.mjs directly (no `KEEP_AUTOMATED` env in import.sh). **[Fixed in 65a4e21]**
- B45 No committed regression fixture for `adimport.relink_body`. **[Fixed in 65a4e21, 6ea17ac]**

## Product follow-ups found during this work

Found during PR #100; fixed on `fix/review-followups` (plan: `docs/superpowers/plans/2026-11-14-review-followups.md`).

- **C1 — /admin/ai `saveAiSettings` lost update.** The form writes every toggle on each autosave, so two admins (or a test) overwrite each other's changes. The ai-features suggest-reply tests still flake from it. Fix: save only changed fields; a cleared field is sent as `''`, and overlapping saves each advance the baseline only with what they sent. **[Fixed in 3d289f9, 16c13ba, 9371374, fe6f47b]**
- **C2 — Description editor layout shift.** The editor (`ssr:false`) mounts with no placeholder, shifting the ticket create form by about 300 px. **[Fixed in a79d794]**
- **C3 — `TicketSidebarSurvey` rebuilds its model on every realtime refresh,** dropping in-progress edits. **[Fixed in 08e60e3]**
- **C4 — `/agent` prefetch storm.** Every ticket-row and pager link is prefetched as a full dynamic RSC render (~25 per view). On the 2-vCPU CI runner a page=2 navigation took 6.5 s while competing with them. **[Fixed in 719ccc3]**
- **C5 — E2E isolation for global settings.** Specs that change global settings (`app_settings`) should run in their own `workers: 1` Playwright project so they never race specs that read those settings. **[Fixed in fff3076, f306f52, 174e267]**
- **C6 — Ticket page Realtime is silent about failures.** Found while fixing C3: `RealtimeTicketUpdates` subscribes without a status callback, so `CHANNEL_ERROR`/`TIMED_OUT` are swallowed, nothing can tell when the channel is ready, and events missed during a reconnect are never backfilled. No e2e proves that a browser receives `postgres_changes` (the notifications spec reloads the page). Root cause: the channels joined Realtime as anon (no JWT on the socket), so RLS dropped every event. The ticket page, notification bell and agent dashboard are all fixed. Live refreshes are coalesced (one `router.refresh()` per burst, none while the tab is hidden) and the /agent filter panel keeps unapplied picks across them. **[Fixed in f7b4e25, 65b2874, 4ec47f2]**
