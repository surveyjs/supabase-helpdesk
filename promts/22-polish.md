# Phase 22 — Polish & Accessibility

## Context

You are performing the final polish pass — mobile responsiveness, WCAG 2.1 AA accessibility compliance, error pages, content-length validation, and cross-browser testing — for a **HelpDesk** application. Read `docs/requirements.md` section 22 (UI/accessibility), `docs/design.md` (mobile responsive, accessibility), `docs/architecture.md` constraint 9 (content-length limits), and the error page templates section (§16.23).

Phases 0–21 are complete: all core features, admin setup, AI, subscription tiers, and authentication modes. Every functional feature is implemented and tested.

This phase is the final quality pass that ensures the application is production-ready: fully responsive on mobile devices, accessible to users with disabilities, and robust against edge cases.

### Existing Infrastructure

- **Layout**: `src/app/layout.tsx` — root layout with Geist font, global CSS.
- **Nav bar**: `src/components/layout/NavBar.tsx` — horizontal navigation with links, bell icon, user dropdown.
- **Global CSS**: `src/app/globals.css` — Tailwind CSS base styles.
- **Error page templates**: Admin-configurable templates stored in `app_settings` keys (§16.23, from Phase 7): `error_template_404`, `error_template_403`, `error_template_500`, `error_template_csat_token_error`. These support `{{statusCode}}`, `{{message}}`, `{{homeUrl}}` placeholders.
- **Content-length limits** (architecture constraint 9): DB-level CHECK constraints exist on all tables. This phase adds matching application-level validation.
- **All pages and components** built across Phases 0–21 — this phase audits and fixes them.

## Tasks

### 1. Mobile Responsive Design

Audit and update all pages and components for mobile responsiveness:

#### Nav Bar (`src/components/layout/NavBar.tsx`)
- On screens below `md` breakpoint (768px):
  - Collapse the nav into a **hamburger menu** (three-line icon button)
  - Tapping opens a slide-out or dropdown panel with all navigation links
  - The notification bell and user info remain visible outside the hamburger (compact layout)
- Ensure minimum **44×44px** touch targets for all interactive elements in the nav
- The hamburger menu must be keyboard-accessible (Escape closes it, Tab cycles through items)

#### Ticket List Pages (`/tickets`, `/agent`)
- On small screens:
  - Switch from table/multi-column layout to a **compact single-column card layout**
  - Each ticket card shows: title (truncated), status badge, urgency, date
  - Pagination controls remain accessible
- Agent dashboard checkboxes (bulk actions): ensure touch targets are at least 44×44px
- Bulk action toolbar: on small screens, wrap buttons or use a dropdown/overflow menu

#### Ticket Detail Page (`/tickets/[id]/[slug]`)
- On small screens:
  - Stack metadata **above** the timeline (instead of side-by-side)
  - Agent action controls: collapse into a dropdown or compact panel
  - Reply form: full-width, larger touch targets for buttons
  - Attachment thumbnails: wrap to fit screen width

#### Filter Controls (Agent Dashboard, Ticket Lists)
- On small screens:
  - Collapse filter controls into an **expandable panel** (e.g., "Filters ▼" button)
  - Panel opens/closes with a toggle
  - When open, filters stack vertically

#### Admin Setup Pages
- Sidebar navigation:
  - On small screens, collapse into a dropdown or top-of-page select
  - Main content area takes full width
- Forms and tables: stack vertically, full-width inputs

#### Reporting Dashboard
- Charts: ensure they resize responsively (already should if using responsive chart libraries)
- Filter controls: collapse into expandable panel on small screens

#### Knowledge Base / Help Center
- Article list: single-column on mobile
- Article detail: full-width content, images scale to fit

#### General
- Images and media: `max-width: 100%` to prevent horizontal overflow
- No horizontal scrollbar on any page at any breakpoint
- Test at viewport widths: 320px (small phone), 375px (iPhone), 768px (tablet), 1024px+

### 2. WCAG 2.1 AA Accessibility Compliance

Audit and fix all pages and components:

#### Keyboard Navigation
- All interactive elements (buttons, links, inputs, checkboxes, dropdowns, toggles) must be fully **keyboard-navigable**
- Tab order follows visual reading order (logical DOM order)
- Custom dropdowns and dialogs: implement proper keyboard patterns (Arrow keys for navigation, Enter/Space for selection, Escape to close)
- No keyboard traps — user can always Tab away from any element
- **Skip to main content** link at the top of every page (visually hidden until focused)

#### Focus Indicators
- All focusable elements must have **visible focus indicators** (outline or ring)
- Default browser focus ring or a custom Tailwind `focus-visible:ring-2 focus-visible:ring-blue-500`
- Focus indicators must have sufficient contrast (at least 3:1 against adjacent colors)
- Do not use `outline: none` without providing an alternative focus style

#### ARIA Attributes
- **Buttons without visible text**: add `aria-label` (e.g., close buttons, icon-only buttons, hamburger menu)
- **Notification bell**: `aria-label="Notifications, N unread"` with live region for count updates
- **Status badges**: include text alongside color (already done per design doc, verify)
- **Dropdowns/modals**: `aria-expanded`, `aria-haspopup`, `aria-controls`, `role="dialog"`, `aria-modal="true"`
- **Form inputs**: every input has an associated `<label>` (or `aria-label` / `aria-labelledby`)
- **Error messages**: `aria-describedby` linking error text to the input, `aria-invalid="true"` on invalid inputs, `role="alert"` on error containers
- **Live regions**: use `aria-live="polite"` for dynamic content updates (notification count, bulk action results, loading states)
- **Tables**: proper `<table>`, `<thead>`, `<th scope="col">` structure. If using divs for layout, add appropriate ARIA roles.
- **Pagination**: `nav` element with `aria-label="Pagination"`

#### Color and Contrast
- **Color must not be the sole means of conveying information** (§design doc):
  - Status badges: include text labels alongside colors (open/pending/closed) — verify
  - SLA indicators: include text/icon alongside color dots
  - Tier pills: include text alongside colors
  - Form validation: error messages + icon + red border (not just color)
- **Text contrast**: minimum 4.5:1 for normal text, 3:1 for large text (18px+ or 14px+ bold)
- **Non-text contrast**: minimum 3:1 for UI components and graphical objects (borders, icons)
- Audit all color combinations: gray text on white background, badge text on colored backgrounds, link colors

#### Images and Icons
- All informational images: `alt` text describing the content
- Decorative images/icons: `aria-hidden="true"` or empty `alt=""`
- Logo: `alt="HelpDesk"` (or configured app name)
- User avatars (if any): `alt="{display name}"`
- File attachment thumbnails: `alt="{filename}"`

#### Forms
- Every form input has a visible label (or `aria-label` for icon inputs)
- Required fields marked with `aria-required="true"` and visual indicator (asterisk)
- Error messages appear below the input and are programmatically associated (`aria-describedby`)
- Submit buttons have clear text labels (not just icons)
- Loading states: `aria-busy="true"` on forms during submission, button text changes to "Saving..." with `aria-disabled="true"`

### 3. Error Pages

Implement error pages rendered from admin-configurable templates (§16.23, configured in Phase 7):

**`src/app/not-found.tsx`** (404):
- Fetch `error_template_404` from `app_settings`
- Render the template with placeholders: `{{statusCode}}` = 404, `{{message}}` = "Page not found", `{{homeUrl}}` = "/"
- Render as sanitized Markdown/HTML
- Include a "Go home" link
- Accessible: proper heading hierarchy, descriptive text

**`src/app/(main)/tickets/[id]/[slug]/not-found.tsx`** (404 for missing tickets):
- Same as above but with ticket-specific message

**`src/app/error.tsx`** (500 — client error boundary):
- `"use client"` component (Next.js requirement for error boundaries)
- Fetch error template from a pre-rendered fallback (cannot do server fetch in error boundary)
- Render with: `{{statusCode}}` = 500, `{{message}}` = "Something went wrong", `{{homeUrl}}` = "/"
- Include "Try again" button (calls `reset()`) and "Go home" link

**Forbidden page component** (403):
- Used when a user tries to access a page they don't have permission to view
- Render `error_template_403` with: `{{statusCode}}` = 403, `{{message}}` = "Access denied", `{{homeUrl}}` = "/"

**CSAT token error page** (`src/app/csat/[token]/error.tsx` or inline in the CSAT page):
- When a CSAT token is invalid/expired
- Render `error_template_csat_token_error` with appropriate message

### 4. Content-Length Validation at Application Level

Add client-side and server-side validation that matches the DB CHECK constraints (architecture constraint 9):

**`src/lib/utils/validation.ts`** — extend the existing validation utilities:

```typescript
export const LIMITS = {
  TICKET_TITLE: 300,
  POST_BODY: 50_000,
  CANNED_RESPONSE_BODY: 50_000,
  KB_ARTICLE_BODY: 100_000,
  DISPLAY_NAME: 100,
  TEAM_NAME: 100,
  TAG_NAME: 50,
  CATEGORY_NAME: 100,
  TYPE_NAME: 100,
  CUSTOM_FIELD_TEXT_VALUE: 1_000,
  CSAT_COMMENT: 2_000,
  USER_NOTE_BODY: 50_000,
  ATTACHMENT_FILENAME: 255,
  TIER_KEY: 50,
  TIER_DISPLAY_NAME: 100,
} as const;
```

Audit all forms and Server Actions to ensure:
- **Client-side**: `maxLength` attribute on text inputs, `<textarea>` character counters showing remaining characters for long-form fields (body, comment, article)
- **Server-side**: validate length before DB insert/update; return descriptive error if exceeded
- Error messages: "Title must be 300 characters or fewer" (not just generic "too long")

### 5. Final Accessibility Audit with axe-core

**`tests/e2e/accessibility.spec.ts`** (new file):

Run automated accessibility audits on key pages using `@axe-core/playwright`:

```typescript
import AxeBuilder from '@axe-core/playwright';

// Test key pages
const pagesToAudit = [
  { name: 'Login', path: '/login' },
  { name: 'Signup', path: '/signup' },
  { name: 'My Tickets', path: '/tickets' },
  { name: 'Ticket Detail', path: '/tickets/{id}/{slug}' },
  { name: 'Agent Dashboard', path: '/agent' },
  { name: 'Admin Setup', path: '/admin/types' },
  { name: 'Help Center', path: '/help' },
  { name: 'Notifications', path: '/notifications' },
  { name: 'Profile', path: '/profile' },
  { name: 'Reports', path: '/reports' },
  { name: 'KB Management', path: '/kb/manage' },
  { name: 'Canned Responses', path: '/canned-responses' },
];

for (const page of pagesToAudit) {
  test(`${page.name} has no accessibility violations`, async ({ page: p }) => {
    await p.goto(page.path);
    const results = await new AxeBuilder({ page: p })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    expect(results.violations).toEqual([]);
  });
}
```

### 6. Cross-Browser Smoke Tests

**`tests/e2e/cross-browser.spec.ts`** (new file):

Configure Playwright to run key flows across browsers:

```typescript
// playwright.config.ts already includes Chromium. Add:
// - Firefox (Gecko)
// - WebKit (Safari)
// Each configured in the projects array

// Cross-browser test: basic user flow
test('complete user flow works', async ({ page }) => {
  // Login
  // Create a ticket
  // View ticket detail
  // Reply to ticket
  // View notifications
  // (These are smoke tests — core flow works, not exhaustive)
});
```

Update `playwright.config.ts` to include Firefox and WebKit projects for the cross-browser spec file only (to avoid tripling the full E2E run time).

### 7. Tests

**`tests/e2e/polish.spec.ts`** (new file):

- **Mobile responsive tests** (using Playwright viewport settings):
  - At 375px width:
    - Nav bar shows hamburger menu (not full links)
    - Hamburger opens and shows all links
    - Ticket list uses single-column card layout
    - Ticket detail stacks metadata above timeline
    - Filter controls collapsed into expandable panel
    - All touch targets are at least 44×44px (measure via bounding box)
  - At 768px width:
    - Nav bar may show abbreviated links or hamburger
    - Layouts adapt appropriately

- **Keyboard navigation tests:**
  - Tab through login form: all fields and buttons reachable
  - Tab through ticket creation form: all fields, dropdowns, buttons reachable
  - Escape closes dropdowns and modals
  - Skip-to-content link works (focus moves to main content)

- **Error pages:**
  - Navigating to `/nonexistent-path` shows 404 template
  - Navigating to `/admin/types` as a non-admin shows 403 (or redirect)
  - CSAT page with invalid token shows appropriate error

- **Content-length validation:**
  - Form rejects title longer than 300 characters with clear error
  - Form rejects body longer than 50,000 characters with clear error
  - Character counter updates as user types

- **Accessibility (axe-core):**
  - All audited pages pass WCAG 2.1 AA (see section 5 above)

## Implementation Notes

- **Hamburger menu**: Use a simple client-side toggle (`"use client"` component) that shows/hides the mobile nav. Keep it minimal per architecture constraint 2. Can use `<details>/<summary>` pattern or a lightweight toggle.
- **Touch targets**: Use Tailwind's `min-h-[44px] min-w-[44px]` utility on all interactive mobile elements. Apply `p-3` or similar padding to ensure icon buttons meet the 44×44px minimum.
- **axe-core integration**: Install `@axe-core/playwright` as a dev dependency. Run the accessibility tests as part of the E2E suite but in a separate test file that can be run independently.
- **Focus-visible**: Use Tailwind's `focus-visible:` modifier (not `focus:`) to show focus indicators only for keyboard navigation, not mouse clicks. This follows the recommended pattern.
- **Skip to content link**: Add as the first child of `<body>` (in root layout): `<a href="#main" class="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-white focus:p-2 focus:rounded">Skip to main content</a>`. Add `id="main"` to the main content wrapper.
- **Character counter component**: Create a small `"use client"` component `CharacterCounter` that takes `current: number` and `max: number` and displays "X / Y" with color change when approaching the limit.
- **Error pages**: Next.js App Router uses `not-found.tsx` for 404s and `error.tsx` for runtime errors. The 403 is handled by the page itself (check permissions and render the forbidden template).
- **Cross-browser config**: Only run the cross-browser spec across all browsers. Other E2E tests run on Chromium only to keep CI times reasonable.

## Verification Checklist

- [ ] Nav bar collapses to hamburger menu on mobile (<768px)
- [ ] Hamburger menu is keyboard-accessible
- [ ] Ticket lists use single-column card layout on mobile
- [ ] Ticket detail stacks metadata above timeline on mobile
- [ ] Filter controls collapse into expandable panel on mobile
- [ ] Admin sidebar collapses on mobile
- [ ] All interactive elements have minimum 44×44px touch targets on mobile
- [ ] No horizontal scrollbar at any viewport width (320px–1440px+)
- [ ] All interactive elements keyboard-navigable
- [ ] Visible focus indicators on all focusable elements
- [ ] Skip-to-content link works
- [ ] All form inputs have associated labels
- [ ] Error messages programmatically associated with inputs (`aria-describedby`)
- [ ] ARIA attributes on custom dropdowns, modals, notifications
- [ ] Notification bell has descriptive `aria-label` with count
- [ ] Color is not the sole means of conveying information
- [ ] Text contrast meets WCAG AA (4.5:1 normal, 3:1 large)
- [ ] All images have appropriate alt text
- [ ] 404 page renders from admin-configurable template
- [ ] 403 page renders from admin-configurable template
- [ ] 500 page renders from admin-configurable template with "Try again" button
- [ ] CSAT token error page renders from admin-configurable template
- [ ] Content-length validation matches DB CHECK constraints (all limits from constraint 9)
- [ ] Character counters on long-form text inputs
- [ ] Server-side validation returns descriptive error messages
- [ ] axe-core audit passes WCAG 2.1 AA on all key pages
- [ ] Cross-browser smoke tests pass on Chromium, Firefox, WebKit
- [ ] `npm run test:e2e` passes polish and accessibility tests
