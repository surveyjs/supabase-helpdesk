# HelpDesk Design System

A design system for **HelpDesk** — an open-source customer-support ticket platform built by the [SurveyJS](https://surveyjs.io) team as a community-maintained replacement for the (deprecated) [SurveyJS AnswerDesk](https://surveyjs.answerdesk.io/) hosted offering. The repo at [`surveyjs/supabase-helpdesk`](https://github.com/surveyjs/supabase-helpdesk) is the canonical reference; this design system extracts its visual + content language so designers and agents can produce on-brand mockups, slides, and prototypes without copy-pasting Tailwind classes.

> **Open-source.** Code: [github.com/surveyjs/supabase-helpdesk](https://github.com/surveyjs/supabase-helpdesk) · MIT · © 2026 SurveyJS. Tech: Next.js 16 (App Router), Supabase (Postgres / Auth / Storage / Realtime / pg_cron), Tailwind CSS 4, TypeScript, Geist sans + mono. For richer work, read the upstream `docs/requirements.md` (128KB product spec) and `docs/design.md` directly.

---

## 1. Product & audience

HelpDesk is a **full-featured ticketing system** with three primary audiences and one shared visual language:

| Role | What they see | Tone |
|---|---|---|
| **End user** (submitter) | Public help center · "My Tickets" list · ticket detail with reply composer · CSAT rating page (no login required) | Plain, supportive |
| **Agent** | Agent dashboard with saved views & filters · bulk actions · canned responses · KB authoring · reports | Pragmatic, dense, action-first |
| **Admin** | `/admin` sidebar with Setup pages (Auth, AI, Categories, Email, SLA, Tiers, etc.) · audit log · subscription tier management | Operational |

All three share the same shell: a single white `<NavBar>` over a `bg-gray-50` page, content centered to `max-w-5xl`, white cards with `border-gray-200` and `rounded-lg`. There is **no dark mode** by design.

Feature surface area is intentionally broad: Markdown replies, custom fields, SLA timers, AI auto-categorization / duplicate detection / suggested replies, inbound email-to-ticket, real-time updates via Supabase Realtime, CSAT surveys, knowledge base with full-text search, role/team management, subscription tiers, and configurable authentication (built-in, social OAuth, external SSO/OIDC).

---

## 2. Content fundamentals

### 2.1 Voice & tone
- **Plain, direct, slightly clinical.** No marketing language. Sentences are short. Documentation reads like a product spec, not a brochure. The product is built for people doing work — agents triaging tickets, admins configuring SLAs — and the copy respects that.
- **Helpful, not chummy.** "Reply with Markdown support" — not "Drop us a line!" Empty states say "No tickets match your filters." Not "Looks pretty quiet in here." 🚫
- **Second person ("you") in user-facing copy, first person ("My Tickets", "My Stats") for the dashboard.** Agent dashboard panels are titled `My Stats (Last 30 Days)`, `My Tickets`, never `Your stats`. This is deliberate: agents own their queue.

### 2.2 Casing
- **Sentence case for everything except short proper labels.** Page titles are sentence case (`Create Ticket`, `Forgot password`); navigation labels are title case but short (`My Tickets`, `Agent Dashboard`, `Help Center`, `Setup`).
- **UPPERCASE only for table headers** — small (12px), letter-spaced, gray-500. `TITLE · SUBMITTER · STATUS · URGENCY · SEVERITY · SLA · POSTS · UPDATED`.
- **lowercase for status badge values when stored** (`open`, `pending`, `closed`); badge component title-cases on render.

### 2.3 Punctuation & affordances
- **Trailing arrow `→` on inline links** that lead to another section: `Browse Public Tickets →`.
- **Em dashes used sparingly** for asides, never as decoration.
- **`…` (single ellipsis char)** for loading and pending states: `Logging in…`, `Search articles…`.
- **Curly apostrophes** in user-facing copy: `Don't have an account?` → `Don&apos;t have an account?` rendered as `Don't`. The codebase explicitly escapes these.
- **Counts always include the unit and pluralize**: `3 tickets found`, `1 ticket found`, `0 tickets found`. Never `3 results` without context.

### 2.4 Microcopy patterns
- **Calls to action are verbs**: `New Ticket`, `Search`, `Sign in with GitHub`, `Apply`, `Clear`. No `Submit`, no `Go`.
- **Error banners lead with the failure, then offer a fix**: "Invalid email or password. Try again or reset your password."
- **System messages name the system** ("This saved view uses an unsupported filter type (ai). Showing all tickets instead.") so the agent knows what state they're in.
- **Times are localized, dates short** (`May 20`, `2 hours ago`). The `relative-time` format is for activity; absolute dates are for table cells.

### 2.5 Emoji & decoration
- **Effectively no emoji** in product chrome. The only emoji in source is 🔒 used as a tiny private-ticket indicator on the dashboard row (and only because no equivalent inline icon existed for that exact slot). Don't add more.
- **No exclamation marks** anywhere I could find. The voice is calm by default.
- **No "vibes" copy** ("Awesome!", "Boom!", etc.). The audience is being interrupted by a problem; we don't celebrate at them.

---

## 3. Visual foundations

### 3.1 Palette — single bright primary, restrained neutrals, status-coded pills

The system is **Tailwind defaults, hard-committed**. There's no custom palette; the visual identity comes from disciplined use of the standard scale.

- **Page background**: `gray-50` (`#F9FAFB`). Cards / nav / dropdowns are pure white. There is no other base color.
- **Primary**: `blue-600` (`#2563EB`) for buttons, links, focus ring (via `blue-500`). Hover deepens to `blue-700`. The brand mark is the same blue.
- **Text**: `gray-900` for headings, `gray-700` for body, `gray-600` for secondary, `gray-500` for meta and placeholders. `gray-400` is reserved for disabled.
- **Status colors are pill-shaped only** — never used as section backgrounds, never as page accents. They live inside `<Badge>`:
  - **Status**: `open` = green-100/green-700, `pending` = yellow-100/yellow-700, `closed` = gray-100/gray-700
  - **Priority / urgency / severity**: `low` = blue, `medium` = teal, `high` = orange, `critical` = red
  - **SLA indicator (compact)**: a 10px dot, green = on track / met, yellow = approaching, red = breached
- **Tier badges** are admin-configurable; the codebase ships 10 named colors (gray, blue, purple, green, red, yellow, orange, pink, indigo, teal) all in the same `*-100 / *-700` light-pill convention.
- **Banners**:
  - error: `bg-red-50 border-red-200 text-red-700`
  - warning: `bg-amber-50 border-amber-300 text-amber-800`
  - info: `bg-blue-50 border-blue-200 text-blue-800`

### 3.2 Typography — Geist sans + Geist mono

- **Geist** (Vercel) for body and UI, **Geist Mono** for code / IDs / commands. Loaded via the `geist` npm package in production; this design system loads them from Google Fonts at the top of `colors_and_type.css`.
- Type scale is small and tight. Body text is **14px** in the UI (table cells, buttons, labels, inputs); 16px is reserved for prose. Page H1 = 24/600, section H2 = 20/600, card H3 = 18/500. Meta is 12px, gray-500.
- Numbers and IDs use mono so they align: `TICKET-1284`, `npm run dev`.
- Antialiased everywhere (`antialiased` class on `<html>`).

### 3.3 Layout & density
- Content area centers on **`max-w-5xl`** (1024px). One documented exception: the ticket detail page goes full-bleed for its two-column layout (long code blocks need the width).
- Mobile-first responsive. **Touch targets are at minimum 44×44px** (the codebase enforces this with `min-h-[44px] min-w-[44px]` on nav items and menu items) — this comes from the WCAG 2.1 AA conformance commitment in the spec.
- Padding is on the small side: card inner padding is `p-4` (16px) for compact cards, `p-6` (24px) for prose cards. Section gap between cards is `gap-4` (16px).

### 3.4 Cards, borders, shadows
- **Cards** are `bg-white` + `border border-gray-200` + `rounded-lg` (8px). Shadows are **near-absent by default** — borders carry the affordance.
- **Hover lift is subtle**: KB category cards use `hover:shadow-sm transition-shadow`. There is no large lift, no scale, no translateY.
- **Dropdowns** (user menu, notification dropdown, mobile menu): `shadow-lg` is the only place a real shadow appears. `rounded` (4px) for the menu, `border-gray-200`.
- **No glow, no inner shadows, no gradients** — the only gradient in the entire codebase is the implicit `text-blue-600 → text-blue-800` on link hover.

### 3.5 Motion
- **Essentially no animation.** No fades on page load, no spring physics, no choreographed reveals. The site feels deliberately static.
- Two motion exceptions exist: (1) chevrons rotate via `group-open:rotate-180` on `<details>` summaries, (2) KB cards use `transition-shadow` on hover. That is the entire motion design system.
- Loading is communicated through **disabled state on the submit button** (`disabled:opacity-50`, copy changes to `Logging in…`). No spinners.

### 3.6 Interaction states
- **Hover**: links go `blue-600 → blue-800`. Backgrounds go `bg-white → bg-gray-50` or `bg-gray-100 → bg-gray-200`. Primary button `blue-600 → blue-700`. Never opacity-based.
- **Focus**: `focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none` is standard everywhere. The ring is offset for buttons (`focus:ring-offset-2`), inset for menu items.
- **Active row** (mobile menu): `bg-blue-50 text-blue-700 font-medium` + `aria-current="page"`.
- **Pressed**: no documented press treatment (no shrink, no darken-darker).
- **Disabled**: `opacity-50` plus a copy swap to communicate state.

### 3.7 Imagery & backgrounds
- **No imagery in product chrome.** No hero images, no illustrations, no decorative SVG. The empty `public/` directory in the repo (only Next.js placeholder SVGs) makes this concrete: the product ships with a custom HelpDesk logo (admin-configurable per-instance — see spec §16.27) and that is the entire image budget.
- **No background patterns, textures, gradients.** Pages are flat.
- File-attachment images render inside replies at their natural size — no chrome, no rounded thumb mosaic.

### 3.8 Accessibility (not decorative — load-bearing)
- **WCAG 2.1 Level AA** is a hard product requirement. All interactive elements are keyboard-navigable with visible focus indicators. Status badges always include their text label (color is not the sole signal). `aria-label`, `aria-current`, `aria-expanded`, `role="menu"`, `role="alert"` are present throughout. Skip-to-content link in the `<body>`.

---

## 4. Iconography

### 4.1 What the codebase actually ships
The product **hand-rolls inline `<svg>` icons** directly inside React components — no icon font, no sprite, no `lucide-react` dependency. They live in `NavBar.tsx`, `MobileMenu.tsx`, and individual feature components.

Style of those inline icons is **uniform**:
- `viewBox="0 0 24 24"`, sized to the host (h-4/h-5/h-6, i.e. 16 / 20 / 24px)
- `fill="none"` + `stroke="currentColor"` + `strokeWidth={2}` + `strokeLinecap="round"` + `strokeLinejoin="round"`
- `aria-hidden="true"` when paired with visible text; `aria-label` when standalone

This style is **identical to [Heroicons](https://heroicons.com) outline**. For new work, treat Heroicons outline as the canonical source — no substitution flag needed because the metrics, weight, and look are the same. Drop them in directly.

### 4.2 What's in this design system
- [`assets/logo.svg`](assets/logo.svg) — full wordmark lockup (HelpDesk + speech-bubble mark)
- [`assets/mark.svg`](assets/mark.svg) — mark only (favicon / app-icon use)
- [`assets/icons/ticket.svg`](assets/icons/ticket.svg) — an example outline icon in the house style

**Flag — substitution made.** The upstream repo ships **no logo asset** (the only files in `public/` are Next.js's stock `file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg`, all placeholder). The "HelpDesk logo" referenced in `docs/design.md` §16.27 is **admin-configurable per deployment** — there is no canonical brand mark. The mark in `assets/logo.svg` is a **placeholder I drew** in the house style (blue-600 rounded-square with a white "?"). **If you have an official wordmark/mark, swap it in.**

### 4.3 Other symbol use
- **Lock 🔒** is used once: as a tiny visual marker next to private ticket titles in the dashboard table. This is the only emoji in the product. Don't add more.
- **Unicode arrow `→`** is used as inline link affordance.
- **No icon for status / priority** — status is communicated by colored pills with text. Don't add an icon next to the pill.

---

## 5. UI Kit

[`ui_kits/helpdesk/`](ui_kits/helpdesk) — a click-through high-fidelity recreation of the agent + end-user surfaces. Pixel-perfect to the codebase. Use as a starting point for mocks, slides, or prototypes.

- `index.html` — clickable multi-screen prototype (Help Center · My Tickets · Ticket Detail · Agent Dashboard · New Ticket · Login)
- React components in `*.jsx` files, hand-extracted from the upstream TSX so they're easy to compose

---

## 6. Index — what's in this folder

```
.
├── README.md                       ← you are here
├── SKILL.md                        ← cross-compatible Claude/Agent Skill manifest
├── colors_and_type.css             ← :root CSS vars, semantic + raw palette, Geist import
├── assets/
│   ├── logo.svg                    ← wordmark (placeholder, see §4.2)
│   ├── mark.svg                    ← mark-only
│   └── icons/ticket.svg            ← example outline icon
├── preview/                        ← cards rendered in the Design System tab
│   ├── brand-mark.html
│   ├── type-headings.html · type-body.html
│   ├── colors-neutrals.html · colors-primary.html · colors-semantic.html · colors-tiers.html
│   ├── spacing-radii.html · elevation.html
│   ├── components-buttons.html · components-inputs.html · components-cards-rows.html
│   ├── components-nav.html · components-banners.html · components-pagination.html
│   └── iconography.html
└── ui_kits/helpdesk/
    ├── index.html                  ← interactive prototype (entry)
    ├── components.jsx              ← Badge, TierBadge, Button, Input, Card, Pagination, etc.
    ├── NavBar.jsx                  ← top nav with user menu + notification bell
    ├── HelpCenter.jsx              ← public KB category grid + article view
    ├── MyTickets.jsx               ← end-user "My Tickets" list with status filter
    ├── TicketDetail.jsx            ← ticket detail with timeline + reply composer
    ├── AgentDashboard.jsx          ← agent ticket queue with filters + stats panel
    ├── NewTicket.jsx               ← create-ticket form
    └── Login.jsx                   ← login (built-in + social)
```

## 7. References (for the reader with access)

- **Source repo**: <https://github.com/surveyjs/supabase-helpdesk> — explore further for migrations, server actions, server-side data shapes, and per-feature copy.
- **Product spec**: `docs/requirements.md` in the repo — 128KB, 22-phase numbered requirements list. The single best source of truth for *what something does*.
- **Design notes**: `docs/design.md` — the short design brief I quoted from in §3.
- **Architecture**: `docs/architecture.md` — explains the "server-rendered, no custom API, no client state" stance that drives the minimal visual style.
- **SurveyJS** (parent project): <https://surveyjs.io> · <https://github.com/surveyjs>
- **AnswerDesk** (the legacy hosted product this OSS project replaces): <https://surveyjs.answerdesk.io>
