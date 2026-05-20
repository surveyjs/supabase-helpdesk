---
name: helpdesk-design
description: Use this skill to generate well-branded interfaces and assets for HelpDesk (the open-source SurveyJS ticketing system at github.com/surveyjs/supabase-helpdesk), either for production or throwaway prototypes / mocks / slides. Contains essential design guidelines, colors, type, Geist font, sample assets, and a UI kit of React components for prototyping.
user-invocable: true
---

Read the `README.md` file within this skill first — it contains the brand voice, visual foundations, iconography rules, and an index of every other file. Then explore as needed:

- `colors_and_type.css` — drop-in CSS variables (raw Tailwind scale + semantic tokens) and Geist font import. Link this from any throwaway HTML to inherit the brand instantly.
- `assets/` — wordmark, mark, and example house-style outline icon. The upstream repo ships no logo, so the wordmark in here is a placeholder — swap it for the deployment's configured logo if you have one.
- `preview/` — small standalone HTML cards (type, colors, spacing, components). Useful as visual references when answering "what does a button look like".
- `ui_kits/helpdesk/` — high-fidelity React + Tailwind recreation of the product UI. Open `index.html` for an interactive prototype; reuse `components.jsx` and the per-screen JSX files when composing new mockups.

**Visual rules in one breath.** Tailwind defaults, hard-committed. Page bg `gray-50`, white cards with `border-gray-200 rounded-lg`, no shadows except `shadow-lg` dropdowns. Primary is `blue-600`. Status / priority live in `*-100 / *-700` pills only — never as backgrounds. Geist sans + mono. No emoji (except 🔒 for private). No animations. Touch targets ≥ 44px. WCAG 2.1 AA.

**Iconography.** The product hand-rolls inline outline SVGs at 2px stroke with round caps — identical to Heroicons outline. Use Heroicons directly; no substitution flag needed.

**When invoked without guidance.** Ask the user what they want to build (mock screen, slide, full prototype, production component), what surface (end-user, agent dashboard, admin setup), and any specific copy or data they want shown. Then either copy assets out and produce static HTML, or — if they're working in their own codebase — read the rules here and behave as an expert designer giving production-ready Tailwind markup. Keep the voice direct and the visuals restrained; the product earns its trust by not being loud.

Upstream code (read further for component-level questions): <https://github.com/surveyjs/supabase-helpdesk>
