# Change: Quick View Switcher Dropdown

## Summary

Add a lightweight dropdown to the agent dashboard that lets agents switch between
saved views without opening the full Views & Filters panel.

Previously an agent had to expand the collapsible panel, find the view button, and
click it — three interactions.  With this change the active view name in the panel
header is itself a clickable dropdown trigger: one click opens a list of all saved
views, clicking any item switches immediately.

## Changes

### New component: `ViewSwitcherDropdown` (`src/app/(main)/agent/ViewSwitcherDropdown.tsx`)

Client component rendered inside the `<summary>` element of the Views & Filters
`<details>` panel.

Key design decisions:

- **Click-triggered, not hover-triggered.** Hover dropdowns fire accidentally while
  mousing past and do not work on touch devices.
- **`e.stopPropagation()` on the trigger button.** The `<summary>` element captures
  all clicks to toggle `<details>`.  Stopping propagation on the dropdown button
  prevents the panel from opening/closing when the agent is only switching views.
- **Outside-click to dismiss.** A `mousedown` listener on `document` closes the
  dropdown when the agent clicks anywhere outside the component.
- **Reuses `setAgentActiveView` + `router.push`.** Same two-line logic already in
  `ViewsAndFiltersPanel.handleSelectView` — no new server actions needed.
- **`data-testid="view-switcher-trigger"`** on the button for reliable E2E targeting.

Props:

| Prop | Type | Description |
|---|---|---|
| `savedViews` | `Array<{ id: string; name: string }>` | All saved views for this agent |
| `activeViewId` | `string \| null` | Currently selected view (`null` = Default) |
| `activeViewName` | `string` | Display name of active view |

### `src/app/(main)/agent/page.tsx`

- Import `ViewSwitcherDropdown`.
- Replace the plain `<span>Views & Filters: {currentViewName}</span>` in the
  `<summary>` with a flex container:
  ```
  <span>Views & Filters:</span>  <ViewSwitcherDropdown ... />
  ```
- Remove the now-unused `currentViewName` local variable.

## Acceptance Criteria

1. Clicking the active view name in the collapsed panel header opens a dropdown
   listing "Default" and all saved views.
2. The currently active view is visually highlighted (blue, font-medium).
3. Clicking a view in the dropdown switches to it immediately (URL updates, tickets
   refresh) without the filter panel opening.
4. Clicking outside the dropdown closes it without switching views.
5. The `<details>` panel does **not** expand/collapse when the dropdown trigger is
   clicked.
6. When there are no saved views, the dropdown lists only "Default".
7. `npm run typecheck` passes.
8. `npm run lint` passes.
9. `npm run test:e2e -- tests/e2e/agent-dashboard.spec.ts` passes (new tests included).

## Verification Checklist

- [ ] `ViewSwitcherDropdown.tsx` created in `src/app/(main)/agent/`
- [ ] Trigger button has `data-testid="view-switcher-trigger"`
- [ ] Click on trigger stops propagation (panel does not toggle)
- [ ] Selecting a view calls `setAgentActiveView` + navigates
- [ ] Outside click dismisses dropdown
- [ ] `page.tsx` uses the component in the `<summary>` label
- [ ] `currentViewName` variable removed from `page.tsx`
- [ ] E2E: dropdown opens on trigger click
- [ ] E2E: selecting a view switches without opening the panel
- [ ] E2E: clicking outside closes the dropdown
- [ ] E2E: active view is highlighted in the dropdown
