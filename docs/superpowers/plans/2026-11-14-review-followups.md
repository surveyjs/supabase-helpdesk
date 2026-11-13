# Review Follow-ups (C1–C5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the five product follow-ups C1–C5 left open by PR #100.

**Architecture:** Five independent, area-scoped changes: Playwright project config (+ CI command), the /admin/ai save path (client diff + server partial update), the ticket sidebar SurveyJS model lifecycle, a sized placeholder for the lazily loaded Markdown editor, and an intent-based prefetch link for list pages. No new dependencies, no DB migrations.

**Tech Stack:** Next.js 16.4 (read `node_modules/next/dist/docs/` before any Next API), React 19, SurveyJS 3 (`survey-core`/`survey-react-ui`), react-markdown-editor-lite, Vitest, Playwright 1.65, Supabase/Postgres.

**Spec:** `docs/ui-followups-2026-11-13.md`, section "Product follow-ups found during this work" (C1–C5).

## Global Constraints

- Branch `fix/review-followups` (off `main` fcb9f3c), worktree `c:\Work\supabase-helpdesk-fixes`. Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push; the controller pushes after the final review.
- Keep every existing `data-testid`. When markup an e2e spec asserts on changes, update that spec in the same commit.
- E2E locally: `npx playwright test -c playwright.alt.config.ts <specs> --reporter=line` (local-only config, port 3200, rebuilds the app per run — batch specs into one run). After Task 1, pass `--project=global-settings --project=chromium` (a spec in the isolated project is ignored by `chromium`). Never point e2e at :8080; never print customer data.
- The e2e suite is fullyParallel on one shared DB: never mutate seeded users or global settings when a scoped alternative exists; supabase-js returns `{error}` and never rejects — check it; delete `profiles` before `auth.admin.deleteUser`.
- Per task: `npm run typecheck`, `npm run lint`, `npm run test:unit`, plus the task's e2e specs — all green before commit. Run an e2e you add/modify 3× (`--repeat-each=3`) to show it is not flaky.
- When a task's item is fixed, mark it in `docs/ui-followups-2026-11-13.md` with ` **[Fixed in <sha>]**` in a follow-up commit or amend-free second commit of the same task.
- Tailwind + existing CSS files only (`src/app/globals.css`, `src/styles/*`).

## Review Focus

1. C1: an admin changing one toggle, or only saving the API key, never rewrites any other `ai_*` key; validation clamps still apply; non-admins still get Forbidden. → Task 2 unit tests.
2. C3: a remote change to a sidebar field the user is NOT editing still appears after the refresh (no frozen UI); after the user's own save resolves, later remote updates to that field apply again. → Task 3 unit tests.
3. C2: no shift with a custom editor min height (profile preference) and on the ticket reply editor; the placeholder is not focusable and not announced. → Task 4 e2e.
4. C4: ticket links still prefetch on hover, keyboard focus and touch; clicks still navigate; pagination still works. → Task 5 e2e.
5. C5: CI still runs every chromium spec exactly once across the 4 shards, and a failure in the isolated project is visible in the merged report. → Task 1 verification.

---

### Task 1: Isolate global-settings specs (C5)

**Files:**
- Modify: `playwright.config.ts`
- Modify: `.github/workflows/ci.yml` (the chromium shard step, ~line 257: `--project=chromium --shard=…`)
- Possibly modify: specs whose global writes can be replaced by scoped data (only if trivial)

**Interfaces:**
- Produces: Playwright project `global-settings` (Desktop Chrome, `workers: 1`, `fullyParallel: false`), and `chromium` with `dependencies: ['global-settings']`. One exported-in-file constant `GLOBAL_SETTINGS_SPECS: RegExp` used as `testMatch` of `global-settings` and in `testIgnore` of `chromium` (together with the existing cross-browser exclusion).

Decisions:
- Membership rule: a spec file belongs in `global-settings` iff it writes a global setting that other specs read — an `app_settings` row (auth_mode/auth_*, ai_*, kb_visible, csat_*, inbound_email_*, layout/template JSON, page-size, etc.) or another singleton/global config (global templates, SLA policies, tiers) — directly via the service client or by saving an admin settings form. Start from these candidates and verify each by grep: `auth-external`, `ai-features`, `ai-filter`, `knowledge-base`, `csat`, `inbound-email`, `attach-files`, `attachments`, `polish`, `ticket-layout`, `notifications`, `agent-dashboard`, `sla`, `subscription-tiers`, `admin-setup`, `ticket-detail-custom-fields`. `cross-browser.spec.ts` stays in firefox/webkit only. `loginViaForm()` writing `auth_mode='built-in'` is not by itself a reason to move a spec. List each candidate with its verdict and the evidence (file:line) in the report.
- CI: the shard step runs `--project=global-settings --project=chromium --shard=${i}/4`. firefox/webkit job unchanged. `e2e-report` merge unchanged.
- A dependency failure skips `chromium` in that shard — accepted (fail-fast; the failure is in the blob report).

- [ ] **Step 1:** Grep the candidates; write the verdict table into the report.
- [ ] **Step 2:** Edit `playwright.config.ts` and `ci.yml` as decided.
- [ ] **Step 3:** Verify: `npx playwright test --list --project=global-settings --project=chromium | tail -1` total equals the pre-change `--project=chromium` total (record both numbers); and for i in 1..4 `--list --shard=i/4` totals sum to the same number.
- [ ] **Step 4:** Run the isolated project alone locally: `npx playwright test -c playwright.alt.config.ts --project=global-settings --reporter=line` → PASS; record wall time.
- [ ] **Step 5:** Commit `test(e2e): run global-settings specs in their own workers:1 project`.

### Task 2: /admin/ai saves only changed fields (C1)

**Files:**
- Create: `src/lib/ai/settings-diff.ts`
- Modify: `src/lib/actions/ai.ts` (`saveAiSettings`, ~671-755)
- Modify: `src/app/(main)/admin/ai/AiConfigSurveyForm.tsx`
- Modify (only if needed for the baseline): `src/components/features/survey/AdminSurveyForm.tsx`
- Test: create `tests/unit/ai-settings-save.test.ts`, `tests/unit/ai-settings-diff.test.ts`; modify `tests/e2e/ai-features.spec.ts`

**Interfaces:**
- Produces: `buildAiSettingsDiff(current: Record<string, unknown>, baseline: Record<string, unknown>): FormData` — only keys whose value differs (deep-equal); booleans as `'true'`/`'false'`; numbers/strings as `String(v)`; `ai_api_key` only when its trimmed value is non-empty (never compared to the baseline).
- Produces: `parseBool(v: FormDataEntryValue | null): boolean | undefined` — `null` → `undefined`; `'true'`/`'on'` → `true`; anything else → `false`.
- `saveAiSettings(formData: FormData)` keeps its signature; it writes only keys present in `formData` (`formData.has(key)`), with every existing validation rule unchanged (provider allowlist, timeout clamp 10–300, min body length 10, context window 5–50, rate limit ≥ 0, min posts ≥ 5, threshold enum). If no valid key remains, it returns `{}` without DB writes or audit row. The audit row's `updated_keys` lists exactly the written keys.

Decisions:
- Root cause (investigated): `defaultToFormData` sends the whole form, false booleans are omitted, and the server maps absent → `'false'`, rewriting all 17 keys.
- `AiConfigSurveyForm` passes `toFormData` to `AdminSurveyForm`, computing the diff against a `baselineRef` initialised from `buildData(settings)` and advanced only after a successful save. `data` is memoised on `settings` (`useMemo(() => buildData(settings), [settings])`) so `AdminSurveyForm`'s `useEffect([data])` doesn't reset its snapshot every render. After a successful key save the key field is cleared.
- Same-key concurrent edits remain last-write-wins (out of scope).

- [ ] **Step 1: Write failing tests.** `tests/unit/ai-settings-save.test.ts` (mock style of `tests/unit/ai-filter.test.ts`; chainable supabase stub recording `.update({value}).eq('key', k)`; admin profile):
  - `only updates keys present in FormData` — `{ai_filter_enabled:'true'}` → exactly one update, `ai_filter_enabled` = `'true'`.
  - `absent boolean is not reset` — `{ai_model:'gpt-4o'}` → no update to any `*_enabled` key.
  - `explicit false is written` — `ai_filter_enabled:'false'` → `'false'`.
  - `legacy 'on' still means true`.
  - `validation preserved` — timeout `'9999'` → `'300'`; invalid provider and invalid threshold → no update for those keys.
  - `blank api key does not touch vault`; non-blank key calls `store_ai_api_key`.
  - `audit updated_keys equals written keys`; `no-op FormData writes nothing`.
  - `non-admin gets Forbidden`.
  `tests/unit/ai-settings-diff.test.ts`: emits only changed keys; booleans as `'true'`/`'false'`; blank `ai_api_key` omitted, non-blank included; equal arrays/objects not emitted.
- [ ] **Step 2:** Run `npx vitest run tests/unit/ai-settings-save.test.ts tests/unit/ai-settings-diff.test.ts` → FAIL.
- [ ] **Step 3:** Implement as decided.
- [ ] **Step 4:** Unit tests → PASS.
- [ ] **Step 5: e2e** in `ai-features.spec.ts` (inside an existing serial AI-settings describe, restoring what it changes): `changing one field on /admin/ai does not overwrite other AI settings` — load `/admin/ai`, then set `ai_suggested_reply_enabled` via service client to the opposite of what the page shows, change only the model field in the UI, wait for the save indicator, assert the DB still holds the service-client value. Run `ai-features.spec.ts ai-filter.spec.ts` with `--repeat-each=3` → PASS.
- [ ] **Step 6:** Commit `fix(ai): /admin/ai saves only changed settings`.

### Task 3: Ticket sidebar keeps in-progress edits across realtime refresh (C3)

**Files:**
- Modify: `src/app/(main)/tickets/[id]/[slug]/TicketSidebarSurvey.tsx`
- Modify: `src/lib/tickets/sidebar-survey-model.ts`
- Test: `src/lib/tickets/__tests__/sidebar-survey-model.test.ts`; e2e in `tests/e2e/ticket-detail-custom-fields.spec.ts`

**Interfaces:**
- Produces: `mergeServerValues(model: SurveyModel, incoming: Record<string, unknown>, previous: Record<string, unknown>, dirty: ReadonlySet<string>): Record<string, unknown>` in `sidebar-survey-model.ts` — for each key in `incoming ∪ previous` whose incoming value differs (deep-equal) from `previous`: if `dirty.has(key)` skip it and keep `previous[key]` in the returned baseline; otherwise apply it to the model without firing `onValueChanged` (e.g. `model.mergeData` or `setValue` with notification suppressed — verify against installed `survey-core`) and take it into the baseline. Re-applies the existing empty-boolean unchecking afterwards. Returns the new baseline.

Decisions:
- Root cause (investigated): `RealtimeTicketUpdates` calls `router.refresh()`; `page.tsx` rebuilds `sidebarTemplateJson` each render; `useMemo([templateJson])` compares by identity → new `Model` from server values, dropping drafts. `previousRef` is never re-synced.
- Model memo keys on template content: `templateKey = JSON.stringify(templateJson)`; `initial`/`tagColors` read through refs.
- Dirty set (`useRef<Set<string>>`): add on `onValueChanged` (user edits) and on focus-in of a question (verify the event name in installed `survey-core`, e.g. `onFocusInQuestion`); remove when that field's save resolves/reverts and on blur with no pending change.
- `useEffect` on `initial` runs `previousRef.current = mergeServerValues(model, initial, previousRef.current, dirtyRef.current)`.

- [ ] **Step 1: Failing unit tests** (`describe('mergeServerValues')`, real `new Model({...})` with a text + dropdown + boolean): `applies changed server values to untouched fields without firing onValueChanged`; `keeps a dirty field's local value`; `does not advance the baseline for a skipped dirty field`; `no-op for deep-equal values (arrays)`; `applies a field again once it is no longer dirty`; `empty booleans stay unchecked after merge`.
- [ ] **Step 2:** `npx vitest run src/lib/tickets/__tests__/sidebar-survey-model.test.ts` → FAIL.
- [ ] **Step 3:** Implement helper + component changes.
- [ ] **Step 4:** Unit tests → PASS.
- [ ] **Step 5: e2e** `typed sidebar text survives a realtime refresh` — as an agent, open a ticket (scoped test ticket, not seeded shared data) whose template has a text custom field; type `draft` into it without blurring; via service client change another sidebar-visible ticket field (e.g. priority); wait until the page shows the new value (proves the refresh); assert the text field still has `draft` and focus; blur; assert the value is saved (DB). Run it plus the rest of `ticket-detail-custom-fields.spec.ts ticket-layout.spec.ts` with `--repeat-each=3` → PASS.
- [ ] **Step 6:** Commit `fix(tickets): sidebar survey keeps edits across realtime refresh`.

### Task 4: Reserve the Markdown editor's height before it loads (C2)

**Files:**
- Modify: `src/components/features/tickets/MarkdownEditor.tsx` (dynamic import ~45, wrapper ~503, `MdEditor` ~529)
- Test: create `tests/e2e/editor-layout-shift.spec.ts`; modify `tests/e2e/ticket-detail-custom-fields.spec.ts` (~302-306 workaround wait)

Decisions:
- Root cause (investigated): `dynamic(..., { ssr:false })` has no `loading`, the wrapper is ~0 px until the chunk loads, then the editor mounts at `renderedHeight` (300 px default or the profile `minHeightPx`; `.rc-md-editor` is border-box).
- `loading` renders `<div data-testid="markdown-editor-placeholder" aria-hidden="true">` styled like the editor frame (1 px `#e0e0e0` border, a 38 px `#f5f5f5` toolbar strip, white body) with `height: 100%`; the `MdEditor` is wrapped in a div with `minHeight: renderedHeight` so the placeholder fills exactly the mounted height. Not focusable. Applies to every `MarkdownEditor` use (create form, reply, `MarkdownActionForm`).

- [ ] **Step 1: Failing e2e** `tests/e2e/editor-layout-shift.spec.ts`: delay editor chunks (`page.route('**/_next/static/chunks/**', r => setTimeout(() => r.continue(), 1500))`), log in as a regular user (non-seeded or read-only use), `goto('/tickets/new')`; assert the placeholder is visible and `.rc-md-editor` count is 0; read `y0` of the Create Ticket button's bounding box; wait for `.rc-md-editor`; read `y1`; assert `Math.abs(y1 - y0) <= 2`. Tests: `create form does not shift when the Description editor mounts`; same with a 350 px editor min height set for a dedicated test user (via the existing preference mechanism, scoped to that user); `ticket reply editor does not shift when it mounts`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run with `--repeat-each=3` → PASS; remove/relax the workaround wait in `ticket-detail-custom-fields.spec.ts` and run that spec + `editor-height-preferences.spec.ts inline-image-paste.spec.ts accessibility.spec.ts` → PASS.
- [ ] **Step 5:** Commit `fix(editor): reserve Markdown editor height before it loads`.

### Task 5: Intent-based prefetch on list pages (C4)

**Files:**
- Create: `src/components/ui/IntentPrefetchLink.tsx`
- Modify: `src/app/(main)/agent/page.tsx` (ticket links ~280, ~350), `src/components/features/tickets/TicketList.tsx` (~32), `src/components/features/users/DisplayName.tsx` (~14), `src/components/ui/Pagination.tsx` (~71, ~96)
- Test: create `tests/e2e/agent-prefetch.spec.ts`

**Interfaces:**
- Produces: `IntentPrefetchLink` — `'use client'`; props = `ComponentProps<typeof Link>` minus `prefetch`; renders `<Link prefetch={active ? null : false}>` where `active` flips true on `onMouseEnter`, `onFocus`, `onTouchStart` (calling through any passed handlers). Pattern from `node_modules/next/dist/docs/01-app/02-guides/prefetching.md` ("Hover-triggered prefetch").

Decisions:
- Investigated: Next 16.4.6, prefetch is production-only, on viewport entry by default; `prefetch={false}` disables viewport and hover prefetch; the prefetch request carries header `next-router-prefetch: 1` (`_rsc` is on every RSC request, not a marker). The e2e server is `next start` (production), so prefetch is observable.
- Use `IntentPrefetchLink` for ticket-row links, `DisplayName` user links and `Pagination` links. Top nav, mobile menu and notification links keep the default.

- [ ] **Step 1: Failing e2e** `tests/e2e/agent-prefetch.spec.ts`: log in as an agent; record requests with header `next-router-prefetch`; `goto('/agent')`, wait for `networkidle` + 1 s. Tests: `/agent does not prefetch ticket rows, user links or pager links on load` — no prefetch URL matches `/tickets/\d`, `/agent/users/` or `[?&]page=`; and a sanity assertion that the recorder works (it saw ≥ 1 prefetch, e.g. a top-nav link — if the baseline has none, assert instead via the hover test). `hovering a ticket row prefetches that ticket` — hover the first row link, expect a prefetch request whose URL contains that ticket's path within 5 s. `focusing a pager link prefetches it` (keyboard).
- [ ] **Step 2:** Run → FAIL (first test).
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `agent-prefetch.spec.ts` with `--repeat-each=3`, plus `agent-dashboard.spec.ts tickets.spec.ts notifications.spec.ts knowledge-base.spec.ts` → PASS.
- [ ] **Step 5:** Commit `perf(agent): prefetch ticket, user and pager links on intent only`.

---

## Finish (controller)

1. Final whole-branch review; one fix wave.
2. Full local suite: `npx playwright test -c playwright.alt.config.ts --reporter=line` (all projects), plus `npm run test:db` if any SQL changed (none planned).
3. Push `fix/review-followups`, open PR "Review follow-ups C1–C5", watch CI to green.
