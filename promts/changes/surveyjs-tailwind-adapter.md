# Change: Replace the Custom SurveyJS Theme Bridge with the SurveyJS Tailwind Adapter

## Summary

All SurveyJS styling lives in `src/styles/surveyjs-bridge.css` (347 lines). Most of it
repeats generic "make SurveyJS look like Tailwind" work: it remaps the whole gray palette,
shrinks the V3 base units (3px spacing, 7px font) to get a denser layout, and then patches
the side effects. It re-pins control heights to 36px and overrides row margins with four
high-specificity selectors.

SurveyJS publishes a small, token-only Tailwind v4 adapter (122 lines) that does this work
through the layout tokens meant for it:

<https://github.com/surveyjs/surveyjs-healthcare-demo/blob/v1/src/survey/tailwind-adapter.css>

The adapter is still in development and has known bugs and gaps against 3.2.1. Copy it into
the project and fix it there; the fixes are listed one by one in
[surveyjs-tailwind-adapter-fixes.md](surveyjs-tailwind-adapter-fixes.md). Feed the adapter the
app's colours through Tailwind theme variables. Cut `surveyjs-bridge.css` down to a thin app
layer that holds only the styling specific to this app. Target size for the app layer: under
100 lines, most of them comments (about 35 declarations).

No TypeScript changes. Surveys must not call `model.applyTheme(...)` (see §4).

## Facts verified against the installed survey-core 3.2.1

Read these before changing anything. Several comments in the current bridge are out of date.

| Fact | Consequence |
|---|---|
| survey-core declares its base `--sjs2-*` tokens under `:where(.sd-theme-root)`, which has zero specificity. | Any class selector on the root wins, in any import order. The bridge's `.sd-root-modern.sd-theme-root` (0,2,0) reasoning is obsolete. |
| The survey root has the classes `sd-root-modern sd-theme-root sjs-theme-overrides` (`defaultCss.rootTheme`). | The adapter's single `.sjs-theme-overrides` selector reaches the survey. |
| All 55 `--sjs2-*` tokens the upstream adapter sets are still used by `survey-core.css` 3.2.1. The adapter header says it was "verified against 3.1.x". | A sound base, but not complete: see fixes F1–F7 and F9–F12. |
| Non-modal popups (dropdown, tagbox) render in place, inside the survey root (`survey-react-ui` `Popup` → `setComponentElement(containerRef)`). Only modal popups are portaled to `<body>`. | The `:root` duplicates in the bridge are no longer needed for dropdown lists. |
| `model.applyTheme(theme)` stores `theme.cssVariables` in `survey.themeVariables`, and React binds that object as the root's inline `style`. | Inline styles beat any stylesheet, so a theme passed to `applyTheme` silently overrides the adapter (§4). |
| Page rows are spaced with `row-gap: var(--sjs2-layout-component-page-content-area-gap-vertical)`. The stock `.sd-row.sd-page__row` `margin-top` rules that bridge §F was written to outrank no longer exist. | Bridge §F's `margin-top` now **adds** space on top of the gap instead of collapsing it. Delete it. |
| Framed questions (`.sd-question--with-frame`) take their background, border and padding from the `panel-simple` tokens: `--sjs2-color-component-panel-simple-default-bg`, `--sjs2-border-effect-component-panel-simple-default` (built from `--sjs2-color-component-panel-simple-default-border`) and `--sjs2-layout-component-panel-simple-content-area-padding-*`. The bridge's current frameless rule sets `panel-default-bg` and `border-effect-surface-default`, which questions never read. | The frameless rule is a no-op for questions today. Delete it; adapter fix F2 sets the panel-simple tokens that `DefaultLightPanelless` sets. |
| `--sd-base-padding`, `--sd-base-vertical-padding` and `--sd-page-vertical-padding` are still read in 3.2.1: multi-column rows inside panels (`.sd-row--multiple`), dynamic panels, and the survey title. | Keep the bridge §F padding variable block. |
| Tailwind is 4.2.2. `@theme static` is supported and always emits its variables. Plain `@theme` emits only variables that some utility uses. | Declare the host contract with `@theme static` (§2). |

## Prerequisites (already in place)

| What | Where |
|---|---|
| Survey CSS import order | `src/app/layout.tsx`: `survey-core/survey-core.css`, then `@/styles/surveyjs-bridge.css` |
| Current bridge | `src/styles/surveyjs-bridge.css`, sections A–H |
| Tailwind theme | `src/app/globals.css` (`@theme inline` with fonts only) |
| Survey components | `src/components/features/survey/SurveyJsonForm.tsx`, `AdminSurveyForm.tsx`, `SurveyTemplateEditor.tsx`, `src/app/(main)/agent/ViewsAndFiltersPanel.tsx`, `src/app/(main)/tickets/[id]/[slug]/TicketSidebarSurvey.tsx`, and the `src/app/(main)/admin/**/*SurveyForm.tsx` forms |

## Changes

### 0. Capture "before" screenshots

Before you edit anything, start the app and save full-page screenshots to the scratchpad
(not the repo). Take them at 1280px wide and at 390px (mobile):

- `/agent`: the Views & Filters panel, with a dropdown and a tagbox popup open
- a ticket detail page (`/tickets/<id>/<slug>`): the sidebar survey, as an agent and as a user
- `/admin/custom-fields`, `/admin/tiers`, `/admin/templates`: matrixdynamic rows and Add buttons
- `/admin/privacy`, `/admin/user-settings`: simple single-panel forms
- the survey-template editor (the JSON `comment` field)

You will compare against these in **Verification**.

### 1. Copy the adapter and apply the fixes

Create `src/styles/surveyjs-tailwind-adapter.css` from the upstream file pinned to commit
`7d9b1f31706c5965222fac77ec9448e8bc2af482`:

<https://raw.githubusercontent.com/surveyjs/surveyjs-healthcare-demo/7d9b1f31706c5965222fac77ec9448e8bc2af482/src/survey/tailwind-adapter.css>

- Copy the file verbatim first, then apply fixes **F1–F7 and F9–F12** from
  [surveyjs-tailwind-adapter-fixes.md](surveyjs-tailwind-adapter-fixes.md) one at a time,
  exactly as written there. Do not apply F8 (deferred). Do not reformat or reorder untouched
  lines, so a diff against the upstream commit shows only the fixes.
- Put a provenance comment above the adapter header: the source URL, the base commit SHA, the
  copy date, and the line "Modified: fixes F1–F7 and F9–F12, see
  promts/changes/surveyjs-tailwind-adapter-fixes.md".
- Where a change goes: if any Tailwind host would need it, it is an adapter fix. Add a new
  `F<n>` entry to the fixes file and apply it to the adapter. If only this app needs it, put
  it in the app layer (§3). Never fix the adapter from the app layer.

### 2. Declare the adapter's host contract in `globals.css`

The adapter reads Tailwind-namespaced colours (`--color-primary`, …). Today the app defines
shadcn-style `--primary`, `--foreground`, … only inside the bridge's `:root` block. If they
are not mapped, the survey silently turns SurveyJS teal (`#19b394`), which is the adapter's
last fallback.

Add this to `src/app/globals.css`, below the existing `@theme inline` block:

```css
/* Semantic colours. Consumed by the SurveyJS Tailwind adapter
 * (src/styles/surveyjs-tailwind-adapter.css). `static` makes Tailwind always
 * emit these variables; plain `@theme` drops the ones no utility uses, and the
 * survey would then fall back to SurveyJS teal. */
@theme static {
  --color-primary: #2563eb;            /* blue-600 */
  --color-primary-foreground: #ffffff;
  --color-foreground: #111827;         /* gray-900 */
  --color-muted: #f3f4f6;              /* gray-100: hover fills in the app layer */
  --color-muted-foreground: #6b7280;   /* gray-500 */
  --color-card: #ffffff;
  --color-input: #d1d5db;              /* gray-300: same as the app's native <select> borders */
  --color-border: #e5e7eb;             /* gray-200 */
  --color-ring: #2563eb;
  --color-destructive: #dc2626;        /* red-600 */
}
```

These also add `bg-primary`, `text-muted-foreground`, … utilities. No existing class in `src`
uses those names (checked), so nothing collides. Do not convert app markup to the new
utilities in this change.

Leave `--color-primary-hover` unset. The adapter derives it as `l × 0.85`, which is the same
formula survey-core uses.

### 3. Cut `surveyjs-bridge.css` down to the app layer

Keep the file name and its import in `layout.tsx`. Import the adapter between them:

```ts
import "survey-core/survey-core.css";
import "@/styles/surveyjs-tailwind-adapter.css";
import "@/styles/surveyjs-bridge.css";
```

Rewrite the bridge header comment to say it is the app layer on top of the adapter, and
summarise the cascade facts from the table above. Use `.sjs-theme-overrides` for token rules,
since it ties with the adapter's selector and wins by import order. App-layer rules may read
the adapter's resolved `--sjstw-*` variables, which are declared on the same element.

**Delete** these parts of the current bridge:

| Section | Why |
|---|---|
| `:root` design-token block (`--background` … `--font-sans`) | Replaced by §2. `--font-sans` already comes from `@theme inline`. |
| A: gray ramp, brand-600, red palette | The adapter maps text, surface and border colours semantically. The error text shade (red-700) is derived by adapter fix F4. |
| `:root` brand-400/700/800 block | Its "inline DefaultTheme" premise is false in 3.2.1. survey-core derives these itself. |
| B: base units (`3px`/`7px`/`9px`, radius, font family) | Replaced by the adapter's typography, padding, gap and radius tokens. Question padding comes from adapter fix F2; page, footer, matrix and nested-panel padding from F3 and F9. |
| `.sd-root-modern .sd-element--with-frame` frameless rule | A no-op for questions in 3.2.1 (see the facts table). Adapter fix F2 removes the question frame. |
| C: semantic tokens | Replaced by the adapter, except the neutral-primary mapping (kept below). |
| E: filled `--muted` formbox backgrounds | **Decision:** use the adapter's white, bordered inputs, which match the app's native `border-gray-300` controls. To restore filled inputs later, re-add the six `--sjs2-color-component-formbox-*-bg` lines to the app layer. |
| F: the four `.sd-row.sd-page__row` `margin-top` selectors | Actively wrong in 3.2.1 (see the facts table). |
| F: `.sd-question__header--location-top` `padding-bottom` | Replaced by the adapter's `question-header-gap-vertical`. |
| G: `.sd-dropdown, .sd-tagbox { min-height: 36px }` | The adapter's input padding already gives 36px. Verify this, don't assume it. |
| §H's "regardless of stylesheet order" comment | Keep the rules, update the comment. |

**Keep** these, adapted:

```css
.sjs-theme-overrides {
  /* Every survey here sits inside a padded Tailwind card, so the survey adds
   * no side padding of its own: fields and the Complete button line up with
   * the card's other content. Set on the layout tokens, so it holds at every
   * width (the adapter's default is 16px). */
  --sjs2-layout-component-page-content-area-padding-horizontal: 0px;
  --sjs2-layout-component-survey-footer-padding-horizontal: 0px;

  /* Stock V3 draws a neutral primary button near-black; this app uses brand. */
  --sjs2-color-bg-neutral-primary: var(--sjstw-primary);
  --sjs2-color-bg-neutral-primary-dim: var(--sjs2-color-project-brand-700);
  --sjs2-color-fg-neutral-on-primary: var(--sjstw-primary-foreground);
  --sjs2-color-bg-neutral-secondary-dim: var(--color-muted);
  --sjs2-color-bg-neutral-tertiary-dim: var(--color-muted);
}
```

- **Navigation bar (§E):** keep both rules, the muted Prev label and the Next/Complete
  promoted to a filled brand button. Replace `var(--foreground)` with
  `var(--sjstw-foreground)` and `var(--muted-foreground)` with
  `var(--sjstw-muted-foreground)`.
- **Legacy padding variables (§F):** keep the `.sd-root-modern.sd-root-modern,
  .sd-container-modern.sd-container-modern` block with its current values (8px / 4px / 0).
  Correct its comment: the variables now drive nested multi-column rows, dynamic panels and
  the survey title, not page row spacing.
- **SVG fixes for Tailwind preflight (§G):** delete them. Checked with all of them removed:
  the dropdown chevron, the clear button, list-item check marks, and the matrixdynamic drag
  and remove icons render correctly. survey-core 3.2.1 sizes its icons itself, so the
  matrixdynamic drag and remove icons now show at their designed 24px instead of the 16px the
  old rules forced. If a future survey-core breaks an icon, restore only the rule that fixes
  it and say which icon in its comment.
- **Scroll wrapper (§H):** keep the rules as they are.

### 4. Do not call `applyTheme`

The upstream adapter header suggests pairing it with
`model.applyTheme(DefaultLightPanelless)`. **Do not.** Adapter fix F1 removes that advice.
That theme sets three tokens the adapter also sets:

- `--sjs2-color-utility-surface-survey`
- `--sjs2-layout-component-page-content-area-gap-vertical`
- `--sjs2-layout-component-page-content-area-gap-horizontal`

`applyTheme` writes them as inline styles, so they beat the adapter. The survey background
stops being transparent and the field and column gaps revert to stock. Adapter fix F2 sets
the same panel-simple tokens as `DefaultLightPanelless`, without that conflict. No survey
component calls `applyTheme` today; keep it that way.

## Verification

1. `npm run lint` and `npm run build` pass.
2. **Brand colour actually applied.** On `/agent`, in DevTools, run
   `getComputedStyle(document.querySelector('.sd-root-modern')).getPropertyValue('--sjs2-color-project-brand-600')`.
   It must resolve to the blue `#2563eb` / `rgb(37, 99, 235)`, not teal. Check the same on an
   admin form, and check that a focused dropdown's ring is blue. If you edited `globals.css`
   while `next dev` was running and see teal, restart the dev server first: hot reload can
   keep serving a `globals.css` compile without the new `@theme static` block. The production
   build is the source of truth.
3. **Control height.** The computed height of `.sd-dropdown`, `.sd-tagbox` (empty) and a text
   question's `.sd-text` wrapper is 36px on `/agent` and in the ticket sidebar. Measure the
   wrapper, not the inner `.sd-formbox__input`, which has no border.
4. **Frames and padding.** On `/agent` and in the ticket sidebar, a `.sd-question--with-frame`
   has a transparent computed `background-color` and no visible border, and its
   `.sd-question__header-and-content-container` has 0px horizontal padding (F2).
   `.sd-page__content` and `.sd-body__navigation` have 0px left and right padding at both
   1280px and 390px (app layer over F3/F9). The first question, the first navigation button
   and the host card's other content share the same left edge. On `/admin/categories` and
   `/admin/tiers`, the matrix (`.sd-question--table`) has no background or border, and its
   first cell and Add button start at that same edge (F12). With a dropdown list open, the
   chevron button sits 2px inside the field and the blue focus ring runs unbroken around it
   (F11).
   Trigger a required-field error: the message colour is derived from `#dc2626`, not stock
   `#C30935` (F4).
5. **Popups.** An open dropdown list and an open tagbox list use the app font, white
   background, `--color-border` dividers and the brand colour for the selected item. Check at
   1280px and at 390px (mobile overlay mode).
6. **Screenshot comparison** against §0, page by page. These differences are expected:
   inputs are white with a gray-300 border instead of a gray-100 fill; questions have no card
   frame and sit flush with the host card's content; field spacing follows `gap-4` (16px);
   body text is 14px; matrixdynamic drag/remove icons are 24px. Anything else, such as clipped content, a missing
   matrixdynamic Add button, oversized icons, a coloured survey background, or teal anywhere,
   is a regression. Fix it where §1 says: an adapter fix with a new `F<n>` entry if any
   Tailwind host would hit it, the app layer otherwise.
7. **e2e.** Run `npx playwright test` for `agent-dashboard`, `ticket-detail-custom-fields`,
   `tickets`, `teams-tags`, `subscription-tiers`, `inbound-email`, `auth-external` and
   `accessibility`. The axe run covers colour contrast; `--color-muted-foreground` (gray-500)
   on white is 4.8:1. All must pass. The SurveyJS selectors in `tests/helpers/surveyjs.ts`
   target structural classes and should not need changes.
8. **Adapter diff.** Download the upstream file at the base commit to the scratchpad and diff
   it against `src/styles/surveyjs-tailwind-adapter.css`. Apart from the provenance comment,
   every hunk must belong to one of the fixes in the fixes file, and every applied fix must
   appear.
9. Run `git diff --stat` and confirm only these files changed: `globals.css`, `layout.tsx`,
   `surveyjs-bridge.css`, the new `surveyjs-tailwind-adapter.css`, and the prompt files
   listed below.

## Prompt updates in the same commit

- `promts/changes/surveyjs-tailwind-adapter-fixes.md`: already written. Update it only if you
  add a fix (new `F<n>` entry) or a fix's change has to differ from what it describes; record
  why in that fix's entry.
- `promts/changes/surveyjs-forms-admin-dashboard-ticket-detail.md`: add a "superseded for
  SurveyJS styling" note at the top that points here. Its `theme.json` / `applyTheme` /
  `survey-overrides.css` description predates the V3 migration.
- `promts/changes/ticket-detail-survey-template-refactor.md`: change the two references to the
  deleted `survey-overrides.css` to `src/styles/surveyjs-bridge.css`.

## Out of scope

- Dark mode. The app has none. The adapter would need a `.dark` block mapping the same
  `--color-*` slots.
- The official shadcn adapters shipped in `survey-core/themes/adapters/`. They are larger
  (879 lines plus a style file), need the full shadcn token set (`--ring`, `--input`,
  `--spacing`, `--text-*--line-height`, …), and restyle controls to look like shadcn
  components.
- Modal popups mounted on `<body>` (adapter fix F8, deferred). Not reachable in this app
  today.
- Survey Creator styling.
- Converting app markup to the new `bg-primary` / `text-foreground` utilities.
