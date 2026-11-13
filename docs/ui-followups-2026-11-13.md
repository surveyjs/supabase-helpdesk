# UI review follow-ups — 2026-11-13

Everything left open after PR #99 (`docs/ui-review-2026-11-12.md`): the four follow-ups listed in the PR,
plus the smaller notes the per-task and final reviewers deferred as "can wait". Each item has an ID. The
plan `docs/superpowers/plans/2026-11-13-ui-followups.md` maps every ID to a task, or to **Won't fix**
with the reason.

## A. Follow-ups named in PR #99

- **A1 Form-control convergence.** About 68 native inputs, selects, textareas and checkboxes still use
  ad-hoc classes (`rounded border border-gray-300 … focus:ring-1 focus:ring-blue-500`), so they don't match
  `.form-input`/`.form-select`/`.form-checkbox` (globals.css) and the SurveyJS controls (36 px,
  `rounded-md`, gray-300 border, blue-600 focus ring). Examples: AdminSidebar filter, canned responses,
  MarkdownPreview, KB pages, profile, admin pages. `.form-checkbox` also lost its focus ring. On
  /admin/users the Filter button is 34 px next to 36 px inputs.
- **A2 CSV export.**
  - The end date excludes the last day: `new Date('YYYY-MM-DD')` is midnight at the start of that day.
  - The daily volume CSV ignores the page's 366-day fallback to weekly.
  - A failed export shows nothing: `handleExport` has no try/catch and ignores `result.error`.
- **A3 Display-name prompt.** Users whose display name is empty or just their e-mail local part (1,534 of
  7,519 imported profiles) never get asked for a real name. The SSO callback already replaces such names
  with the provider's name when it has one.
- **A4 Collapsible admin password form** on `/login?no_redirect=true` in External mode.

## B. Deferred review notes

**Navigation / home / login**
- B1 Home page for users: no e2e covers the "New ticket" / "My tickets" buttons. The home "My tickets" link has the same accessible name as the nav "My Tickets" link (strict-mode clash risk).
- B2 No e2e covers the logged-out phone menu.
- B3 `NotificationBell` swallows a client-creation error with a bare `catch {}`.

**Ticket page**
- B4 Attachments hidden because they are referenced inline lose their Delete button.
- B5 The inline-attachment id regex runs on raw Markdown, so it also matches ids inside code spans and code blocks.
- B6 The "replying will re-open" hint only covers `closed`, but the server also re-opens `pending`.
- B7 Post action links are about 16 px tall: below 44 px touch targets on touch devices.
- B8 Sidebar CSS `.sd-row--multiple { row-gap: 4px }` tightens every wrapped row in the sidebar survey, not just the Private/Follow checkbox pair.
- B9 `showTagChips` assumes the agent template contains a `tag_ids` question. If an admin removes it, agents see no tags at all. Agents also lost the coloured tag pills.
- B10 Sidebar `<dl>` group headings are `<dt>` without `<dd>`. "From article" and "KB Article" rows land under whichever heading precedes them.
- B11 The title pencil has no visible focus ring, only an opacity change.
- B12 A boolean custom field with no value renders as an indeterminate ("mixed") checkbox in the sidebar.
- B13 `MainReplyToggle` fragment children are not indented (formatting).

**Editor**
- B14 `HeaderPlugin.select()` doesn't return focus to the textarea or the trigger.
- B15 Pressing on the heading menu's padding blurs it, which closes it before the click lands.
- B16 `AutoPreviewPlugin`'s `applying` flag can swallow the next manual toggle if no `viewchange` fires.
- B17 Programmatic value changes (canned response insert, reset) don't re-evaluate auto preview.
- B18 The hover path of the heading menu is no longer tested.

**Agent dashboard / pagination**
- B19 The Pagination range text isn't clamped past the last page (`?page=999` shows "19,961–128 of 128").
- B20 `aria-disabled` on a plain `<span>` (disabled First/Previous) means nothing to assistive tech.
- B21 The "pagination works" e2e is vacuous with about 9 seeded tickets. ai-features tests on /tickets look for `agent-ticket-table`, which doesn't exist there.
- B22 Card checkboxes and pagination links are below 44 px touch targets on phones.
- B23 Below xl the filters panel is always mounted, so SurveyJS loads on every dashboard view even when the panel stays collapsed.

**Reports**
- B24 The Export CSV `<details>` menu doesn't close on outside click or Escape.
- B25 Choosing "Daily" for a range over 366 days silently becomes weekly.
- B26 The earliest-ticket query for "All time" ignores the agent's ticket scope.
- B27 `getTierCreatorIds` is unpaged (1000-row cap) and feeds a long `.in()` URL.

**Setup**
- B28 Overview count errors are coerced to 0 (false zeros).
- B29 "Tier API secret not set" shows in Needs attention on every instance, even ones without tiers.
- B30 "Outbound e-mail configured" checks only `smtp_host` and ignores `is_verified`.
- B31 The mobile admin nav select's accessible name became just "Setup". There's also a stale `eslint-disable` comment in SurveyJsonForm (memo deps).
- B32 Notification event labels differ between /notification-settings and /admin/user-settings ("Assigned to You (agent)" vs "Assigned to Agent").
- B33 SLA row labels are unique only if policy names are unique.

**Tests (robustness)**
- B34 Negative checks use `not.toBeVisible()` where `toHaveCount(0)` is meant (reports, teams-tags specs).
- B35 The weak `it.each` regex `[^\\s]*` in markdown.test.ts.
- B36 The inline-image-paste assertion doesn't prove the image loaded (`naturalWidth`).
- B37 The ticket-layout 390 px test doesn't exercise the thumbnail row or the comment rail.
- B38 `getAliceTicketUrl()` is unscoped, so other specs' alice tickets can race it. The `loginViaForm` stability poll is effectively a single check.
- B39 runtime-config-route.test.ts calls `vi.unstubAllEnvs()` inside the test instead of in `afterEach`.
- B40 Known flaky e2e tests:
  - ticket-detail-custom-fields "owner can edit … autosaves" (input detached by re-render)
  - knowledge-base:177 "Create a ticket link on article"
  - posts-comments:388 "non-creator non-agent user cannot edit the original post"
  - auth-external:556 "non-admin refused password sign-in"
  - editor-height-preferences:92 / 123 (`ensureTestUser` race)
  - ai-filter:114 / 121
  - agent-dashboard:348 "assign an agent from the sidebar survey"

**AnswerDesk importer**
- B41 `DISTINCT ON (friendly_no)` without `ORDER BY`: duplicate FriendlyIds are resolved arbitrarily and silently.
- B42 Relink rules e/h can create nested links or break an `href` in rare shapes. No README caveat.
- B43 `import.sh relink` prints Postgres notice noise.
- B44 `--keep-automated` can only be reached by calling prepare.mjs directly (no `KEEP_AUTOMATED` env in import.sh).
- B45 No committed regression fixture for `adimport.relink_body`.
