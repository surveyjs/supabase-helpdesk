# Change: Agent Dashboard View & Filtering Panel Consolidation

> **Note (superseded in part):** The filter form layout (Search, Submitter
> email, Status, Sort, Urgency, etc.), the Saved-Views row interaction
> ("+ Add new view" inline editor, Default + per-view buttons with × delete),
> and the storage shape for `saved_views.filters` have been replaced by the
> SurveyJS-based design described in
> `promts/changes/agent-dashboard-surveyjs-filtering.md`. The collapsible
> panel structure and the "Views & Filters: [Name]" summary defined here
> still apply.

## Summary

Consolidate the **Saved Views** panel and **Filtering** panel into a single collapsible panel on the Agent Dashboard. The consolidated panel is collapsed by default and shows the currently selected view name when collapsed, or "Default" if no view is explicitly selected.

## Rationale

- **Reduce visual clutter:** Two separate panels take up significant vertical space and cognitive load
- **Improved workflow:** Agent workflow typically starts with selecting a view, then applies filters within that view
- **Better state representation:** Collapsed state clearly shows which view is active
- **Consistent UX:** Follows the pattern of the "My Stats" panel

## Changes

### Agent Dashboard Page (`src/app/(main)/agent/page.tsx`)

**Panel Structure:**
1. **"My Stats" panel** (collapsible) — unchanged, displays agent statistics for last 30 days
2. **"Views & Filters" panel** (collapsible, collapsed by default) — consolidates Saved Views and all filter controls

**Consolidated Panel Content (when expanded):**
1. **Saved Views Section** (at the top of the panel)
   - Label: "Saved Views:"
   - Default view indicator: Show "Default" as a special, non-removable view option
   - List saved views as clickable links/buttons
   - Each saved view (except "Default") has a delete button
   - Cannot remove the only non-default view if Default is selected
   - Always at least one view is selected (Default or other)

2. **Current View Indicator** (in collapsed state)
   - When panel is collapsed, show: `"Views & Filters: [Current View Name]"` or `"Views & Filters: Default"`
   - Note: the summary text does not change when the panel is expanded; it always shows the current view name

3. **Filter Controls Section** (below Saved Views)
   - All existing filters remain: Search, Submitter email, Status, Sort, Urgency, Severity, Category, Type, Assigned Agent, Team, Tier, Tags
   - Filters are organized in a grid layout (same as before)
   - "Apply Filters" button (submits form)
   - "Clear All" link (resets to default)

**Collapsed State Appearance:**
```
<details>
  <summary>Views & Filters: My Open Tickets</summary>
  <!-- panel contents -->
</details>
```

If no saved view is selected, show:
```
<details>
  <summary>Views & Filters: Default</summary>
  <!-- panel contents -->
</details>
```

**URL Behavior:**
- Clicking a saved view link updates URL with view filters
- Applying custom filters updates URL with all active filters (the panel does **not** auto-collapse — the browser navigates to the new URL and the `<details>` element starts collapsed per its default state)
- Resetting filters returns to Default view
- Browser back/forward preserves view and filter state

**Default View Semantics:**
- "Default" = no saved view selected, baseline ticket list with no special filters
- If a user has custom filters but hasn't saved them, still shows "Default" in collapsed summary
- When explicitly saved, becomes a "Saved View" that shows its name
- Can never be deleted; if last view exists, Default cannot be removed

### Saved Views Table (`saved_views` in Supabase)
No schema changes. Existing table structure remains intact.

### Saved Views Action (`src/lib/actions/saved-views.ts`)
- Existing actions unchanged: `createSavedView`, `renameSavedView`, `deleteSavedView`
- No new actions added

### Styling & Layout

**Desktop (≥ md breakpoint):**
- Consolidated panel is always visible, styled as collapsible `<details>`
- Grid layout for filters: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3`
- Panel padding: `p-4`, consistent with other sections

**Mobile (< md breakpoint):**
- Consolidated panel remains visible but can be toggled
- Filters stack vertically: `grid-cols-1`
- Panel padding: `p-4`, consistent with design

**Collapse/Expand Icon:**
- Use same chevron icon as "My Stats" panel
- Rotate icon when expanded: `group-open:rotate-180`

### Tests

**Dashboard Load Test:**
- Verify consolidated panel renders with correct collapsed state
- Verify "Default" appears when no view selected

**Saved Views Tests:**
- Create and apply saved view → panel summary shows view name
- Delete saved view (not Default) → panel reverts to showing remaining view or "Default"
- Cannot delete Default view

**Filter Application Tests:**
- Applying filters within collapsed panel → expands panel, shows filters, updates URL
- Clearing filters → reverts to "Default" in collapsed state
- Switching between saved views → correctly applies view filters

**Collapsed/Expanded State Tests:**
- Panel is collapsed on page load
- Panel expands when user clicks summary
- Mobile: filters details element toggle works

**URL State Tests:**
- Saved view URL preserved on browser back/forward
- Custom filter URL preserved on browser back/forward

## Migration

No migration needed. Existing `saved_views` table and data remain unchanged.

## Backward Compatibility

- Existing saved views continue to work
- All URL search params remain the same
- All server-side filter logic unchanged
- No breaking changes to API or data model

## Future Enhancements (Out of Scope)

- Keyboard shortcuts to switch views
- Recently used views
- Shared views across team
- View templates (e.g., "All High Priority", "All Critical SLA Risk")
