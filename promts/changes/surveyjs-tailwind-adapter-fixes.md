# SurveyJS Tailwind Adapter: Fixes

Fixes applied to the SurveyJS Tailwind v4 adapter while it is still in development. The base
is the upstream file at commit `7d9b1f31706c5965222fac77ec9448e8bc2af482`:

<https://raw.githubusercontent.com/surveyjs/surveyjs-healthcare-demo/7d9b1f31706c5965222fac77ec9448e8bc2af482/src/survey/tailwind-adapter.css>

Our working copy is `src/styles/surveyjs-tailwind-adapter.css`. Each fix below is
self-contained: what is wrong, the evidence, the exact change, and how to check it. Line
numbers marked "adapter" refer to the upstream file at the commit above. Line numbers marked
"survey-core" refer to `node_modules/survey-core/survey-core.css` (or `fesm/survey-core.mjs`)
in survey-core 3.2.1.

Rule for new fixes: if any Tailwind host would need the change, it belongs in the adapter
and gets an entry here. If only this app needs it, it belongs in `surveyjs-bridge.css`.

| ID | Kind | Summary | Status |
|---|---|---|---|
| F1 | Bug | Header recommends `applyTheme(DefaultLightPanelless)`, which overrides the adapter | Apply |
| F2 | Gap | Questions keep the stock white card frame and 24px/40px padding | Apply |
| F3 | Gap | Page content keeps the stock 40px side padding | Apply |
| F4 | Gap | Error text keeps stock red-700 instead of following `--color-destructive` | Apply |
| F5 | Bug | Row-spacing comment describes 3.1.x | Apply |
| F6 | Bug | Header says "Verified against 3.1.x" | Apply |
| F7 | Gap | Header does not say how to keep host variables from being tree-shaken | Apply |
| F8 | Gap | Modal popups mounted on `<body>` get no adapter tokens | Deferred |
| F9 | Gap | Matrix cells, nested/dynamic panels and the survey header/footer keep stock 40px/24px padding | Apply |
| F10 | Bug | Icons (matrix remove, input icons) render at ~2.5:1 contrast, below the WCAG 3:1 minimum | Apply |
| F11 | Bug | The open dropdown's chevron button fills the field edge to edge and paints over the focus ring | Apply |
| F12 | Gap | Matrices keep a card frame and 16px inset while every other question is frameless | Apply |

---

## F1. Remove the `applyTheme(DefaultLightPanelless)` advice

**Problem.** Adapter lines 6–7 tell hosts to pair the adapter with
`model.applyTheme(DefaultLightPanelless)`. `applyTheme` stores the theme's variables in
`survey.themeVariables`, and the renderers bind that object as the root's inline `style`
(`survey-react-ui`: `style: this.survey.themeVariables`). Inline styles beat any stylesheet.
`DefaultLightPanelless` sets three tokens the adapter also sets, so the adapter loses them:

- `--sjs2-color-utility-surface-survey` (adapter: `transparent`) → the survey gets a background
- `--sjs2-layout-component-page-content-area-gap-vertical` (adapter: 16px) → stock gap
- `--sjs2-layout-component-page-content-area-gap-horizontal` (adapter: 16px) → stock gap

**Change.** Replace adapter lines 6–7:

```css
   Pair with a panelless base theme when surveys are embedded in host cards:
     model.applyTheme(DefaultLightPanelless);
```

with:

```css
   Embedded by default: questions have no card frame (the panelless look) and
   the survey background is transparent. Do not call model.applyTheme(...):
   it writes theme variables as inline styles, which override this file.
```

F2 supplies the panelless tokens the header used to delegate to the theme.

**Check.** `grep -n applyTheme src/styles/surveyjs-tailwind-adapter.css` finds only the
warning. No survey component in `src` calls `applyTheme`.

---

## F2. Remove the question card frame

**Problem.** Framed questions (`.sd-question--with-frame`) read their background, border and
padding from the `panel-simple` tokens (survey-core lines 5086–5098). The adapter sets none of
them, so every top-level question renders as a white card with a 1px border, 24px top/bottom
and 40px side padding:

| Token | Stock 3.2.1 value | survey-core line |
|---|---|---|
| `--sjs2-color-component-panel-simple-default-bg` | `bg-basic-primary` (white) | 1263 |
| `--sjs2-color-component-panel-simple-default-border` | `border-basic-secondary` | 1264 |
| `--sjs2-radius-component-panel-simple` | `radius-component-panel` | 600 |
| `--sjs2-layout-component-panel-simple-content-area-padding-horizontal` | `spacing-large-horizontal` (40px) | 341 |
| `--sjs2-layout-component-panel-simple-content-area-padding-top` / `-bottom` | `spacing-medium-vertical` (24px) | 342–343 |

`--sjs2-border-effect-component-panel-simple-default` (line 1657) is built from
`panel-simple-default-border`, so making the border colour transparent removes the visible
border.

The `.sd-element--with-frame` rule that `surveyjs-bridge.css` uses today sets
`panel-default-bg` and `border-effect-surface-default`. Questions never read those, so that
rule has no effect on questions.

**Change.** Add a section after the "Panels as nested host cards" block (after adapter line
112). These are the same `panel-simple` values `DefaultLightPanelless` sets
(`survey-core/themes/default-light-panelless.js`):

```css
  /* --- Questions without a card frame (the panelless look). Panels keep
         their card (above); matrices are handled further down. Nested
         questions already have 0 padding. */
  --sjs2-color-component-panel-simple-default-bg: transparent;
  --sjs2-color-component-panel-simple-default-border: transparent;
  --sjs2-radius-component-panel-simple: 0px;
  --sjs2-layout-component-panel-simple-content-area-padding-horizontal: 0px;
  --sjs2-layout-component-panel-simple-content-area-padding-top: 0px;
  --sjs2-layout-component-panel-simple-content-area-padding-bottom: 0px;
```

**Check.** On a rendered survey, a `.sd-question--with-frame` has a transparent computed
`background-color` and no visible border. Its `.sd-question__header-and-content-container`
(which reads the padding, survey-core line 5122) has 0px padding.

---

## F3. Set the page side padding

**Problem.** `.sd-page__content` takes its side padding from
`--sjs2-layout-component-page-content-area-padding-horizontal` (survey-core lines 6589–6592).
The stock value is `spacing-large-horizontal` (line 293): 40px, or 16px when the survey is
narrower than 600px and gets `.sd-root-modern--mobile` (lines 12115–12123). The adapter does
not set it, so controls in narrow containers such as sidebars lose up to 80px of width.

**Change.** Add after adapter line 95 (`survey-box-padding-bottom`):

```css
  --sjs2-layout-component-page-content-area-padding-horizontal: calc(var(--sjstw-space) * 4);
```

16px matches the adapter's "p-4 cards" density. Setting the layout token directly, not
`spacing-large-horizontal`, keeps it the same at every width. A host whose card already
provides padding can set it to `0px` in its own layer.

**Check.** `.sd-page__content` has 16px left and right padding at 1280px and at 390px.

---

## F4. Derive the error text colour from `--color-destructive`

**Problem.** The adapter maps only `--sjs2-palette-red-600` (adapter line 121). survey-core
3.2.1 reads two red shades (`grep 'var(--sjs2-palette-red-'`):

| Shade | Used by | survey-core line |
|---|---|---|
| red-600 | alert backgrounds and borders (6 uses) | 809–814, 869 |
| red-700 | `--sjs2-color-fg-alert-primary` (error **text**) and `bg-alert-primary-dim` | 850, 812 |

red-400, red-500 and red-800 are declared but never read, so they need no mapping. Without
this fix, error messages stay stock `#C30935` while the borders follow the host's
destructive colour.

**Change.** Add after adapter line 121, using the same derivation as `brand-700` (adapter
line 46):

```css
  --sjs2-palette-red-700: hsl(from var(--sjstw-destructive) h s calc(l * 0.85));
```

**Check.** With `--color-destructive: #dc2626`, the computed `--sjs2-color-fg-alert-primary`
on `.sd-root-modern` is a darker red derived from `#dc2626`, not `#C30935`. The axe
colour-contrast check passes on a form that shows a validation error.

---

## F5. Correct the row-spacing comment

**Problem.** Adapter line 91 says: "NOTE (3.1.x): row→row spacing is page-BOX-gap;
content-area-gap is columns". In 3.2.1 that is wrong:

- Rows inside a page are spaced by `.sd-page__content { row-gap:
  var(--sjs2-layout-component-page-content-area-gap-vertical) }` (survey-core line 6593).
- `page-box-gap-vertical` is the `row-gap` of `.sd-page` (line 6544). It spaces the page's
  own blocks: title, description, content.

Both are 16px in the adapter, so nothing renders wrong today. Anyone who retunes field
spacing by following the comment changes the wrong token.

**Change.** Replace adapter lines 90–91:

```css
  /* --- Vertical rhythm (gap-4 between fields; tight label→input).
         NOTE (3.1.x): row→row spacing is page-BOX-gap; content-area-gap is columns */
```

with:

```css
  /* --- Vertical rhythm (gap-4 between fields; tight label→input).
         Field rows: page-content-area-gap-vertical (.sd-page__content row-gap).
         Page title/description/content: page-box-gap-vertical (.sd-page row-gap). */
```

**Check.** Comment-only change.

---

## F6. Update the verified version

**Problem.** Adapter line 3 says "Verified against survey-core 3.1.x". The fixes above were
verified against 3.2.1, and all 55 `--sjs2-*` tokens the upstream adapter sets are still read
by `survey-core.css` 3.2.1.

**Change.** Replace adapter line 3 with:

```css
   Verified against survey-core 3.2.1. Load order:
```

**Check.** Comment-only change.

---

## F7. Tell hosts to declare the contract with `@theme static`

**Problem.** Adapter lines 11–12 say Tailwind v4 tree-shakes unused theme variables but do not
say what to do about it. A host that declares `--color-primary` in a plain `@theme` block,
and never uses `bg-primary` or similar, gets no `--color-primary` in the output CSS. The
survey then falls back silently to SurveyJS teal (`#19b394`). Tailwind 4 has
`@theme static`, which always emits its variables.

**Change.** Replace adapter lines 11–12:

```css
   with zero configuration. Every slot falls back to Tailwind's standard
   variables, then to a literal (Tailwind v4 tree-shakes unused theme vars):
```

with:

```css
   with zero configuration. Every slot falls back to Tailwind's standard
   variables, then to a literal. Declare the slots in `@theme static { … }`:
   plain `@theme` drops variables no utility uses, and the survey then
   silently falls back to the literals below.
```

**Check.** Comment-only change. The app's own contract in `src/app/globals.css` already uses
`@theme static`.

---

## F8. Modal popups get no adapter tokens (deferred)

**Problem.** The adapter's only selector is `.sjs-theme-overrides`, which survey-core puts on
the survey root (`rootTheme`, survey-core.mjs line 18202). Dropdown and tagbox lists render
inside the root, so they are covered. Modal popups (confirm dialogs, `showDialog`) are
mounted in a new container appended to `settings.environment.popupMountContainer`, which is
`<body>` by default (survey-core.mjs lines 84745–84750). Their classes are `sv-popup`, the
popup model's `cssClass`, and `sv-popup--modal-popup` / `sv-popup--modal-overlay` (lines
84532, 85273–85278). None of them is `.sjs-theme-overrides`, so the adapter's tokens never
reach them.

**Why deferred.** This app cannot show one today. Every `matrixdynamic` in
`src/components/features/survey/form-json/admin/*.json` sets `confirmDelete: false`, and
nothing in `src` calls `showDialog` or sets `popupMountContainer`. The fix also needs a
decision: either the adapter adds the modal classes to its selector, or survey-core adds the
root theme classes to modal containers. It also needs confirmation of where body-mounted
modals get the base `:where(.sd-theme-root)` tokens from.

**Change.** None in this round. Revisit before enabling `confirmDelete` or using dialogs.

---

## F9. Compact the spacing scale for components without their own tokens

Found while verifying F1–F7 in the app: with F3 applied, the Complete / Apply Filters
buttons still sat 24px to the right of the fields, and matrix tables kept 40px insets.

**Problem.** The adapter sets layout tokens for the page, panels and inputs, but many other
layout tokens still derive from two survey-core spacing scales:

| Scale | Stock desktop value | Layout tokens that read it and the adapter does not set |
|---|---|---|
| `--sjs2-spacing-large-horizontal` | 40px | `survey-footer-padding-horizontal` (navigation bar), `survey-header-padding-horizontal`, `page-header-padding-horizontal`, `matrix-(header-)cell-left/right-padding-*`, `panel-footer-*`, `panel-nested-*`, `panel-dynamic-*`, and the `panel-simple(-nested)-content-area-gap-horizontal` column gaps |
| `--sjs2-spacing-medium-vertical` | 24px | `matrix-box-padding-top/bottom`, `panel-dynamic-*`, `panel-nested-*`, `panel-footer-padding-bottom`, `panel-simple(-nested)-content-area-gap-vertical`, `panel-simple-nested-box-gap-vertical` |

Defaults: survey-core lines 211–212 and 12104–12112. Every consumer is a layout token
declared on the survey root, so `var()` resolves there; no rule reads the scales directly.
`spacing-large-vertical` is read only by tokens the adapter already sets, and
`spacing-medium-horizontal` is not read at all.

The visible effect: `.sd-body__navigation` takes `padding-left:
var(--sjs2-layout-component-survey-footer-padding-horizontal)` (survey-core line 10550), so
the navigation buttons start 40px in while the fields start at the page padding (16px, F3).

**Change.** Add after the F2 block:

```css
  /* --- Spacing scale for everything not tuned above (matrix cells, nested
         and dynamic panels, survey header/footer): p-4 sides, py-3 ends.
         Under 600px survey-core's --mobile rule sets both to 16px. */
  --sjs2-spacing-large-horizontal: calc(var(--sjstw-space) * 4);
  --sjs2-spacing-medium-vertical: calc(var(--sjstw-space) * 3);
```

These match the adapter's own panel padding (16px sides, 12px top). `.sjs-theme-overrides`
ties with survey-core's `.sd-root-modern` rule and wins by import order. Under 600px,
`.sd-root-modern.sd-root-modern--mobile` (higher specificity) sets both scales to 16px, which
is already compact.

**Check.** On `/agent`, the first `.sd-body__navigation .sd-action` and the first
`.sd-question` have the same left edge. In a `matrixdynamic`, the first cell has 16px left
padding.

---

## F10. Give icons a legible colour

Found in the final review of the migration; confirmed in the browser.

**Problem.** The adapter maps `fg-basic-primary` and `fg-basic-secondary` but not
`--sjs2-color-fg-basic-tertiary`. Its stock value is `rgba(from fg-basic-primary r g b /
0.4)` (survey-core line 827): the foreground colour at 40% opacity. survey-core uses it for
icons:

- `--sjs2-color-component-action-neutral-quaternary-default-icon` (line 1096). Desktop
  matrixdynamic row actions render as neutral quaternary actions (survey-core.mjs line 55184),
  so this colours the remove-row and drag icons.
- `--sjs2-color-component-input-default-icon` (line 1166).

With `--color-foreground: #111827`, the remove-row icon on `/admin/tiers` measured
`#111827` at 40% opacity, roughly `rgb(160,163,169)` on white: about 2.5:1. That is below the
WCAG 1.4.11 minimum of 3:1 for UI graphics. axe's colour-contrast rule does not check SVG
icons, so the e2e accessibility run does not catch this.

**Change.** In the "Text" block, after `--sjs2-color-fg-basic-secondary`:

```css
  --sjs2-color-fg-basic-tertiary: var(--sjstw-muted-foreground); /* icons */
```

**Check.** On `/admin/tiers`, the computed `fill` of the remove-row icon's `<use>` element is
the opaque muted foreground (`rgb(107, 114, 128)` with gray-500), 4.8:1 on white.

---

## F11. Keep in-field buttons inside the focus ring

Reported from the app: with a dropdown list open, the chevron sits in a gray square that
covers the right end of the blue focus border.

**Problem.** To reach 36px controls, the upstream adapter sets the formbox padding to 0
(adapter lines 85–86) and puts all the height into the input padding (2 × 8px + 20px). But
the in-field buttons (the dropdown chevron, the clear button) are small actions whose own
box is 2 × 8px padding + a 20px icon = 36px (`action-small-box-padding-*` = `spacing-x100`,
survey-core lines 232–233). So the chevron button fills the field from edge to edge.

The focus ring is an inset `box-shadow` on `.sd-formbox`
(`--sjs2-border-effect-component-formbox-focused`, survey-core line 1525), and a child's
background paints over its parent's inset shadow. While the list is open the chevron gets
`sd-action--popup-active` and an opaque "dim" background, which hides the ring on the
button's top, right and bottom edges. Stock 3.2.1 avoids this with a 4px formbox inset
(`formbox-medium-padding-*` = `spacing-x050`, lines 252–253).

**Change.** Replace the four lines of the "Control height" block (adapter lines 83–88):

```css
  /* --- Control height: 1lh + 2×input padding + 2×formbox padding
         text-sm (20px) + 2×6px + 2×2px → 36px, matching Tailwind/shadcn h-9
         controls. The 2px formbox inset keeps in-field buttons (the dropdown
         chevron: 20px icon + 2×6px = 32px) off the 2px inset focus ring;
         text still starts 12px (px-3) from the edge. */
  --sjs2-layout-component-formbox-medium-padding-vertical: calc(var(--sjstw-space) * 0.5);
  --sjs2-layout-component-formbox-medium-padding-horizontal: calc(var(--sjstw-space) * 0.5);
  --sjs2-layout-component-input-medium-content-padding-vertical: calc(var(--sjstw-space) * 1.5);
  --sjs2-layout-component-input-medium-content-padding-horizontal: calc(var(--sjstw-space) * 2.5);
  --sjs2-layout-component-action-small-box-padding-vertical: calc(var(--sjstw-space) * 1.5);
  --sjs2-layout-component-action-small-box-padding-horizontal: calc(var(--sjstw-space) * 1.5);
```

The control stays 36px and the text stays 12px from the left edge. The 2px inset equals the
focus ring width, so the ring is never covered. Small actions elsewhere (matrix row
remove/drag buttons) shrink by 4px, in line with Tailwind's `h-8` icon buttons.

**Check.** On a ticket sidebar, open a dropdown. The `.sd-action--popup-active` button is
32×32 and sits 2px inside the `.sd-formbox` on the top, right and bottom. The blue ring is
continuous around it. `.sd-dropdown`, `.sd-tagbox` and `.sd-text` are still 36px tall.

---

## F12. Remove the matrix card frame

Reported from the app: on the admin pages, each matrixdynamic draws its own rounded card
inside the page's card, while every other question is frameless (F2).

**Problem.** Matrices and composites (`.sd-question--table`, `.sd-composite`) are not
"simple" questions, so F2 does not reach them. Their frame comes from the **panel** tokens
(survey-core lines 6106–6110):

```css
.sd-question--table:where(.sd-question--with-frame) {
  --sd-question-container-border-radius: var(--sjs2-radius-component-panel);
  --sd-question-container-background: var(--sjs2-color-component-panel-default-bg);
  --sd-question-container-box-shadow: var(--sjs2-border-effect-component-panel-default);
}
```

Setting those tokens would also strip the card from panels, which the adapter keeps on
purpose. survey-core's own panelless conversion (`initDefaultCssVariables`, survey-core.mjs
line 20309) has the same limit: it makes `panel-default-bg` transparent but keeps the border.
The matrix also insets its content from the frame:

| What | Source | Value |
|---|---|---|
| First/last cell outer padding | `matrix-(header-)cell-left-padding-left`, `matrix-(header-)cell-right-padding-right` (lines 524–545) | `spacing-large-horizontal` (16px with F9) |
| Space above and below the table | `matrix-box-padding-top/bottom` (lines 506–507) | `spacing-medium-vertical` (12px with F9) |
| Add-row toolbar inset | `--sd-matrixdynamic-toolbar-padding-*` from the `panel-footer-*` tokens (lines 5888–5893) | 16px sides |
| Header separator | `--sd-question-header-border-bottom` (line 6140) | 1px line |

**Change.** In the root block, after the F2 block:

```css
  /* --- Matrices flush with the content edge: no outer cell inset and no
         box padding (their card frame is removed by the rule below). */
  --sjs2-layout-component-matrix-box-padding-top: 0px;
  --sjs2-layout-component-matrix-box-padding-bottom: 0px;
  --sjs2-layout-component-matrix-cell-left-padding-left: 0px;
  --sjs2-layout-component-matrix-cell-right-padding-right: 0px;
  --sjs2-layout-component-matrix-header-cell-left-padding-left: 0px;
  --sjs2-layout-component-matrix-header-cell-right-padding-right: 0px;
```

These tokens are read only by matrices, so they can live on the root. The frame and toolbar
variables are shared with panels, so they need the adapter's one selector rule, placed after
the root block:

```css
/* --- Matrices and composites without a card frame (the panelless look).
       They share the panel frame tokens, so panels would lose their card
       too; survey-core's own per-question variables are re-pointed instead. */
.sjs-theme-overrides .sd-question--table.sd-question--with-frame,
.sjs-theme-overrides .sd-composite.sd-question--with-frame {
  --sd-question-container-background: transparent;
  --sd-question-container-box-shadow: none;
  --sd-question-container-border-radius: 0px;
  --sd-question-header-padding-inline: 0px;
  --sd-question-header-border-bottom: none;
  --sd-matrixdynamic-toolbar-padding-inline: 0px;
  --sd-matrixdynamic-toolbar-padding-block-end: 0px;
}
```

Specificity (0,3,0) beats survey-core's `.sd-question--table` (0,1,0) and
`.sd-question--matrixdynamic` (0,1,0) declarations on the same element. Panels, and matrices
nested inside a panel (`.sd-question--nested`, no `--with-frame`), are unaffected.

**Check.** On `/admin/categories` and `/admin/tiers`, the `.sd-question--table` has a
transparent `background-color` and `box-shadow: none`. The first cell's content and the Add
button start at the `.sd-page__content` left edge. Wide matrices still scroll sideways
inside the question, as in stock.
