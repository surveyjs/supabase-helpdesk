# HelpDesk UI Kit

A clickable, hi-fi recreation of the [`surveyjs/supabase-helpdesk`](https://github.com/surveyjs/supabase-helpdesk) product. React + Tailwind, mirroring the upstream component structure (Next.js App Router pages → individual JSX files here).

## Run

Open [`index.html`](index.html) directly in a browser. No build step — it's React 18 + Babel standalone + Tailwind CDN, deliberately so it's drag-and-droppable into mocks.

## Screens covered

| File | Mirrors upstream | What it shows |
|---|---|---|
| `Login.jsx` | `src/app/(auth)/login/LoginForm.tsx` | Built-in + social OAuth |
| `HelpCenter.jsx` | `src/app/(main)/help/page.tsx` | Public KB: category grid → article list → article reader |
| `MyTickets.jsx` | `src/app/(main)/tickets/page.tsx` | End-user ticket list with status chip filter + search |
| `NewTicket.jsx` | `src/app/(main)/tickets/new/page.tsx` | Create-ticket form with AI-suggested articles |
| `TicketDetail.jsx` | `src/app/(main)/tickets/[id]/[slug]/page.tsx` | Two-column ticket detail with timeline + composer + sidebar |
| `AgentDashboard.jsx` | `src/app/(main)/agent/page.tsx` | Stats panel + filters + table + bulk actions |
| `NavBar.jsx` | `src/components/layout/NavBar.tsx` (+ `MobileMenu.tsx`) | Top nav with notification bell, role badge, user menu, mobile drawer |

## Component primitives — `components.jsx`

`Badge`, `TierBadge`, `RoleBadge`, `Button`, `Input`, `Textarea`, `Select`, `Card`, `Banner`, `Pagination`, `Icon`. Reuse these when composing new screens. The upstream codebase inlines most patterns with Tailwind utility classes; this file consolidates them so prototypes don't have to re-derive the look.

## What's intentionally not here

The upstream product has ~150 component files spread across admin setup pages, reports, canned responses, notification dropdown, KB management, audit log, custom-field rendering, survey-driven config forms, and more. The kit covers **the visual vocabulary and the screens a designer is most likely to mock** — not the full feature surface. Other routes render a placeholder pointing back at the source.

## Substitutions / flags

- **Logo** — the upstream repo ships no real logo (only Next.js's placeholder SVGs). The wordmark in `../../assets/mark.svg` is a placeholder drawn in the brand style; swap it for a deployment's configured logo when you have one. See the root README §4.2.
- **Geist font** — loaded from Google Fonts here for portability. In production it's the `geist` npm package.
- **Tailwind** — loaded via CDN here. In production it's Tailwind 4 with `@import "tailwindcss"`.
