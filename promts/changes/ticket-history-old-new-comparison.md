# Ticket History: Detailed Changes with Old/New Value Comparison

> Implements [#74](https://github.com/surveyjs/supabase-helpdesk/issues/74) — the **Logs** tab should be
> a true change history: for every change show *who* did it, *what* changed, and an
> **old → new** value comparison (as in other helpdesk products).

## Summary

The ticket detail **Logs** tab already lists activity entries, but each entry is a single line
of plain prose with a relative timestamp. This change turns it into an auditable history that:

1. Renders an **old → new comparison** (previous value struck through / muted, arrow, new value emphasized).
2. Shows **human-readable values** for fields that currently store only UUIDs (type, category, assignee, tags).
3. Shows the **exact timestamp** alongside the relative time.
4. Records the ticket **creation** event so the history has a beginning.

This is an enhancement of the existing `activity_log` infrastructure — not a new subsystem.

---

## Implementation status

**Done** (render-time approach — see "Decisions" below):
- `src/lib/tickets/activity-log.ts` — pure `buildActivityDescriptor()` + `titleCaseValue()`, turning each
  `activity_log` row into a structured `{ field, oldValue, newValue }` (comparison) or `{ message }`
  (prose) descriptor. FK ids are resolved via injected label lookups; unresolved ids degrade gracefully
  (`Unknown` / `a tag` / `Unassigned`).
- `src/app/(main)/tickets/[id]/[slug]/ActivityLogItem.tsx` — presentational entry rendering
  `{actor} changed {field}: old → new` (old muted + struck, new emphasized) with the exact timestamp in
  the `time` title; prose mode for non-comparison events. Preserves `data-testid="activity-${id}"`.
- `src/app/(main)/tickets/[id]/[slug]/page.tsx` — builds id→label maps from the already-loaded
  `allTypes/allCategories/allAgents/allTags`, passes them to the descriptor, renders `<ActivityLogItem>`.
  Fixes the empty-tag bug and the value-less type/category/assignee entries with no write-site changes.
- `src/lib/tickets/__tests__/activity-log.test.ts` — 15 unit tests (green). Typecheck + lint clean; full
  unit suite unaffected.

**Deferred** (optional hardening, not required for the visible feature):
- Write-time label persistence in `details` (immutable history; needed for non-agent viewers who don't
  load the lookup maps). The render-time fallback covers the agent Logs tab today.
- Logging a `created` event at ticket-creation time (the descriptor already renders it if present).
- Logging custom-field changes (the sidebar custom-field path does not currently write `activity_log`).
- Extra e2e assertion for the old→new rendering. The existing `data-testid="activity-${id}"` contract is
  unchanged, so current e2e remains valid.

---

## Current state (baseline)

### Data model
`activity_log` (defined in `supabase/migrations/001_core_schema.sql`):

| column      | type        | notes                                              |
|-------------|-------------|----------------------------------------------------|
| id          | uuid        | PK                                                 |
| ticket_id   | bigint      | FK → tickets, ON DELETE CASCADE                    |
| actor_id    | uuid        | FK → profiles                                      |
| action      | text        | e.g. `status_changed`, `agent_assigned`            |
| details     | jsonb       | per-action payload (`{from,to}`, ids, …)           |
| created_at  | timestamptz | default now()                                      |

RLS already allows **agents, the ticket creator, teammates, and any viewer of a non-private ticket**
to read entries (`activity_log_select`), and agents / self to insert (`activity_log_insert`).
No schema change is required.

### Write sites (~35 inserts)
`src/lib/actions/{agent,tickets,bulk,merge,duplicate,attachments,csat,admin,inbound-email}.ts`.

### Render pipeline
`src/app/(main)/tickets/[id]/[slug]/page.tsx`
- fetches `activityLog` (newest first),
- filters to `visibleActivityEntries` (hides `draft_published` / `post_privacy_changed` from non-agents),
- `formatActivityMessage()` builds a string per `action`,
- `renderActivityEntry()` renders one muted line + relative time (`data-testid="activity-${id}"`),
- passed to `TicketTabs` as `logsContent` with `logCount`.

---

## Gaps to fix

1. **No old→new comparison UI.** `renderActivityEntry` emits one prose line; there is no before/after.
2. **FK changes store raw UUIDs.** `type_changed` / `category_changed` write `{from: <uuid>, to: <uuid>}`
   and render as just "changed type" / "changed category" (no values). Assignee actions
   (`agent_assigned {agent_id}`, `agent_reassigned {from_agent_id,to_agent_id}`,
   `agent_unassigned {previous_agent_id}`) store UUIDs and render as "assigned an agent" with no names.
3. **Bug:** `tag_added` / `tag_removed` store only `{tag_id}`, but the renderer reads `d.tag_name`
   (never written) → renders `added tag ""`.
4. **Usable-value fields just need the UI.** `status`, `urgency`, `severity`, `is_private`, `title`
   already store real `{from,to}`.
5. **Relative timestamps only.** Helper `formatDateTimeWithRelative` exists but is unused for activity.
6. **Creation not logged** (no `created` action), so the history has no opening event.

---

## Plan

### Phase 0 — Verify remaining write paths
- Confirm whether the SurveyJS **sidebar** save (status / type / category / assignee / custom fields)
  routes through the `agent.ts` actions or a separate update path that may not log.
- Confirm whether **custom-field** changes are logged at all.
- Output: list of write paths that need payload changes vs. that need logging added.

### Phase 1 — Capture human-readable old/new labels (data, immutable history)
- Add `src/lib/actions/_activity.ts` with a `logTicketActivity(supabase, { ticketId, actorId, action, field, fromLabel, toLabel, ...raw })`
  helper; route the existing inserts through it so payloads are consistent
  (`{ from, to, from_label, to_label }`, plus action-specific extras).
- Resolve names at **write** time so history is self-contained (names survive renames/deletes):
  - `type_changed` / `category_changed`: add `from_label` / `to_label` from `ticket_types` / `categories`.
  - `agent_assigned` / `reassigned` / `unassigned`: add `from_label` / `to_label` display names
    (assign already fetches the new agent's name for notifications — reuse; also fetch the previous agent).
  - `tag_added` / `tag_removed`: store `tag_name` (fixes the empty-tag bug).
- Add a `created` activity log on ticket creation.
- Keep raw ids alongside labels for traceability.

### Phase 2 — Structured rendering with old → new comparison (headline)
- Refactor `formatActivityMessage` into a **descriptor**: `{ actor, verb, field?, oldValue?, newValue?, note? }`.
- New component `src/app/(main)/tickets/[id]/[slug]/ActivityLogItem.tsx` rendering:
  actor · action label · `oldValue` (muted/strikethrough) → `newValue` (emphasized) · exact timestamp
  (`title` / `formatDateTimeWithRelative`). Keep `data-testid="activity-${id}"`.
- **Backward compatibility:** legacy rows lack `*_label`. Fallback at render:
  for agents resolve via already-loaded `allTypes/allCategories/allAgents/allTags`; otherwise degrade to
  the current prose. No data backfill required.
- Friendly enum formatting (title-case statuses / priorities).

### Phase 3 — Tests
- Unit tests for the descriptor: each `action` → expected `{ field, oldValue, newValue }`
  (covers the tag / type / category / assignee fixes).
- Extend `tests/e2e/posts-comments.spec.ts` ("Logs tab shows activity entries") to assert the
  old→new rendering for at least a status change and an assignee change.

### Phase 4 — Optional polish
- Exact-time toggle, grouping consecutive changes by the same actor.
- Customer-facing history is already permitted by RLS; surfacing it only needs UI (no DB change).

---

## Decisions / risks

- **Label-at-write vs resolve-at-render** — recommended: write-time labels (immutable history) with a
  render-time fallback. Render-only resolution is less work but means non-agent viewers won't see
  type/category/agent names (those lookup maps aren't loaded for them).
- **No backfill needed** with the fallback; a one-off label backfill migration is optional.
- **No schema/RLS change** required.

## Related files

- `supabase/migrations/001_core_schema.sql` — `activity_log` table + RLS
- `src/app/(main)/tickets/[id]/[slug]/page.tsx` — fetch + `formatActivityMessage` + `renderActivityEntry`
- `src/app/(main)/tickets/[id]/[slug]/TicketTabs.tsx` — Logs tab (`logsContent` / `logCount`)
- `src/app/(main)/tickets/[id]/[slug]/ActivityLogItem.tsx` — **new** comparison component
- `src/lib/actions/_activity.ts` — **new** `logTicketActivity` helper
- `src/lib/actions/{agent,tickets,bulk,merge,duplicate,attachments,csat,admin,inbound-email}.ts` — log writes
- `tests/e2e/posts-comments.spec.ts` — e2e coverage
