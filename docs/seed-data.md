# HelpDesk — Seed / Test Data

---

### Seed / Test Data

For local development, create seed data with these accounts (all passwords: `Password123`):

| Email | Display Name | Role | Team |
|---|---|---|---|
| admin@example.com | Admin | admin | — |
| agent.smith@example.com | Agent Smith | agent | — |
| agent.jones@example.com | Agent Jones | agent | — |
| alice@example.com | Alice | user | Alice's Team |
| bob@example.com | Bob | user | Alice's Team |
| carol@example.com | Carol | user | Alice's Team |
| dave@example.com | Dave | user | — |
| eve@example.com | Eve | user | — |

Seed **9 tickets** across Alice, Bob, Carol, and Dave with realistic helpdesk subjects (password reset issues, feature requests, billing questions, bug reports, etc.) in mixed statuses. Dave has 2 tickets (testing the no-team experience). Eve has no tickets (testing the empty state, see 3.3). Each ticket must have an original post. Seed additional **posts**, **comments**, and **notes** that simulate realistic agent–customer conversations.

Additionally, seed the following reference data:

- **3 categories**: "Billing", "Technical", "Account".
- **5 tags** with distinct colors: "urgent" (red), "bug" (orange), "feature-request" (blue), "documentation" (teal), "UI" (purple).
- **1 SLA policy** ("Standard SLA") mapped to Critical (1h response / 4h resolution) and High (4h response / 24h resolution). Low and Medium have no SLA policy.
- **2 canned responses**: one public ("Greeting" — a standard welcome reply), one private to agent.smith ("Reassignment note" — an internal reassignment template).
- **3 knowledge base articles** across 2 categories ("Getting Started" and "Troubleshooting"): two published articles and one draft article.
- **Severity on 3 tickets**: Override the default Medium severity on 3 of the 9 seeded tickets (e.g., one Critical, one High, one Low) so that the seeded SLA policy is exercised and SLA indicators are visible on the agent dashboard.
- **1 custom field**: a dropdown named "Browser" with values Chrome, Firefox, Safari, and Edge (not required). Populate it on 3 of the 9 seeded tickets.
- **3 subscription tiers**: "Free" (key: `free`, gray, no capability overrides, no limit overrides), "Licensed" (key: `licensed`, blue, overrides: change ticket visibility; rate limit override: 20), "Enterprise" (key: `enterprise`, purple, overrides: all five; rate limit override: 50, max file size: 25 MB). Tier assignments: Alice → Enterprise (no expiration), Bob → Licensed (expires 2026-12-31), Carol → no tier, Dave → Licensed (expired 2026-01-01, testing expired tier display), Eve → no tier.

---