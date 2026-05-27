# Change: Persist Active Dashboard View Across Navigation

## Summary

Fix a bug where a custom/saved view selected in the agent dashboard was lost
whenever the agent navigated away (e.g. opened a ticket) and returned to `/agent`.
The root cause: the active view was expressed only in the URL (`?view=<id>`), which
is erased when navigating to a different route.  On returning to `/agent` with no
query string the page defaulted to the hard-coded "Default" view.

The fix stores the agent's last-selected view in the database (`profiles.active_view_id`)
and restores it on load when there are no explicit URL parameters.

## Prerequisites (already in place)

| What | Where |
|---|---|
| `saved_views` table | `supabase/migrations/001_core_schema.sql` |
| `getSavedViews(agentId)` | `src/lib/queries/agent-dashboard.ts` |
| `createSavedViewReturnId` / `updateSavedViewDefinition` | `src/lib/actions/saved-views.ts` |
| `DEFAULT_VIEW_NAME`, `EMPTY_FILTER_DATA` | `src/lib/filters/ticket-filter.ts` |

## Changes

### 1. Migration (`supabase/migrations/031_active_dashboard_view.sql`)

```sql
ALTER TABLE profiles
  ADD COLUMN active_view_id UUID REFERENCES saved_views(id) ON DELETE SET NULL;
```

`ON DELETE SET NULL` ensures the stored preference is silently cleared when a
saved view is deleted — no application-level cleanup needed.

### 2. New server action: `setAgentActiveView` (`src/lib/actions/saved-views.ts`)

```ts
export async function setAgentActiveView(viewId: string | null): Promise<void> {
  const { supabase, user } = await requireAgentRole();
  await supabase
    .from('profiles')
    .update({ active_view_id: viewId })
    .eq('id', user.id);
}
```

### 3. Agent dashboard page (`src/app/(main)/agent/page.tsx`)

- Add `active_view_id` to the `profiles` select.
- In the view-resolution block: when there is no `?view=` param **and** no URL
  filter params, look up `profile.active_view_id` in `savedViews`.  If the stored
  view still exists, use it; otherwise fall back to Default.

Resolution priority:

1. `?view=<id>` URL param (explicit user navigation or pagination link)
2. URL filter params (`?status=...`, `?q=...`, etc.) → Default view with those filters
3. `profiles.active_view_id` → stored saved view (or Default if null / deleted)

### 4. `ViewsAndFiltersPanel` (`src/app/(main)/agent/ViewsAndFiltersPanel.tsx`)

- Import `setAgentActiveView` from `@/lib/actions/saved-views`.
- In `handleSelectView(viewId)`: fire `setAgentActiveView(viewId)` before
  `router.push` (fire-and-forget — navigation is not blocked).
- In `handleAddOk()`: after a successful `createSavedViewReturnId`, fire
  `setAgentActiveView(id)` so the new view is immediately the stored preference.

## Acceptance Criteria

1. After selecting a saved view, navigating to any ticket, and returning to `/agent`
   (no query params), the previously-selected view is restored automatically.
2. Selecting "Default" resets the stored preference to `null`; navigating away and
   back shows the Default view.
3. Applying ad-hoc URL filters (without selecting a named view) does not overwrite
   the stored `active_view_id`.
4. Deleting the stored active view causes the profile column to be set to `NULL`
   (via `ON DELETE SET NULL`); the dashboard falls back to Default.
5. `npm run typecheck` passes.
6. `npm run lint` passes.
7. `npm run test` passes (unit + db).
8. `npm run test:e2e -- tests/e2e/agent-dashboard.spec.ts` passes (new tests included).

## Verification Checklist

- [ ] Migration adds `active_view_id UUID REFERENCES saved_views(id) ON DELETE SET NULL`
      to `profiles`
- [ ] `setAgentActiveView` server action exists in `saved-views.ts`
- [ ] `page.tsx` selects `active_view_id` from `profiles`
- [ ] `page.tsx` falls back to stored view when there are no URL params
- [ ] `ViewsAndFiltersPanel` calls `setAgentActiveView` in `handleSelectView`
- [ ] `ViewsAndFiltersPanel` calls `setAgentActiveView` after `createSavedViewReturnId`
- [ ] DB test verifies `ON DELETE SET NULL` behaviour
- [ ] E2E test: select view → open ticket → return → view is still active
- [ ] E2E test: select Default → navigate away → return → Default is shown
