# HelpDesk — Design & Layout

---

### Navigation Bar

- **Left side**: App logo and name (links to a configurable URL — see 16.27), "My Tickets" link, (if KB enabled — see 19.5) "Help Center" link, (for agents) "Agent Dashboard" link, (for agents) "Manage Articles" link, (for agents) "Canned Responses" link, (for agents) "Reports" link, and (for admins only) "Setup" link. By default, the logo is a custom Help Desk logo and the link points to the root website (`/`). An admin can change both the logo image and the link URL from the Admin Setup page (see 16.27).
- **Right side**: Notification bell icon with unread count badge (see 14a.1), current user's display name (or email if no display name is set — showing the user's own email in the nav bar is permitted, see 20.3), role badges, and a "Sign out" button. A dropdown menu on the user name provides links to "Profile" and "Notification Settings".
- The nav bar is always visible. For unauthenticated visitors it shows the app logo and name (with the configured link), (if KB enabled) "Help Center" link, and a "Log in" link. If the admin has enabled public access for unauthenticated visitors (see 16.10), a "Browse Tickets" link is also shown, linking to the public tickets page (`/tickets/public`). The full nav bar (My Tickets, Agent Dashboard, user menu, Sign out) is only shown to logged-in users.

---

### Visual Design

- Clean, minimal look. Light gray page background (`gray-50`), white cards with subtle borders.
- Blue primary color for buttons and active states.
- Status badges: **open** = green pill, **pending** = yellow pill, **closed** = gray pill.
- Centered content area, max-width ~5xl. **Exception:** The ticket detail page (`/tickets/[id]/[slug]`) uses full viewport width to accommodate the two-column layout and long code blocks.
- Use Geist font family (sans + mono).
- Forms in white card containers with padding and rounded corners.
- No dark mode needed (just light theme).
- **Mobile responsive** — All pages must be fully responsive. On small screens: the nav bar collapses into a hamburger menu, ticket lists use a compact single-column layout, the ticket detail page stacks metadata above the timeline, and filter controls collapse into an expandable panel. Touch targets must be at least 44×44px.
- **Accessibility** — The application must conform to **WCAG 2.1 Level AA**. All interactive elements must be keyboard-navigable, have visible focus indicators, and include appropriate ARIA attributes. Images and icons must have alt text or `aria-label`. Color must not be the sole means of conveying information (e.g., status badges include text labels alongside colors). Form inputs must have associated labels. Error messages must be programmatically associated with their fields.

---
