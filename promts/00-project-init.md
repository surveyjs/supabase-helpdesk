# Phase 0 — Project Initialization & CI

## Context

You are building a **HelpDesk** application — a customer-support ticket system. Read the full specs in `docs/requirements.md`, `docs/design.md`, `docs/architecture.md`, and the build plan in `docs/build-plan.md`.

This is Phase 0: set up the project skeleton with all tooling, CI, and a verified dev environment. **No feature code yet.**

## Tasks

### 1. Initialize Next.js Project

```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm
```

- Use Next.js 15 (latest) with App Router
- TypeScript strict mode enabled
- Tailwind CSS configured

### 2. Install Dependencies

```bash
# Supabase
npm install @supabase/supabase-js @supabase/ssr

# Testing
npm install -D vitest @playwright/test @testing-library/react

# Markdown (will be used later, install now for consistency)
npm install react-markdown rehype-sanitize remark-gfm

# Font
npm install geist
```

### 3. Initialize Supabase

```bash
npx supabase init
```

This creates a `supabase/` directory at the project root.

Create `supabase/config.toml` adjustments if needed for local dev (default port settings are fine).

### 4. Configure Geist Font

In `src/app/layout.tsx`, configure Geist Sans and Geist Mono fonts per the design spec.

### 5. Create Base Layout

Create a minimal `src/app/layout.tsx` with:
- Geist font family
- Tailwind CSS globals
- A placeholder `<nav>` bar with the text "HelpDesk" on the left and "Log in" on the right
- Light gray background (`bg-gray-50`)
- Centered content area (`max-w-5xl mx-auto`)

Create `src/app/page.tsx` with a simple "Welcome to HelpDesk" message.

### 6. Create Supabase Client Helpers

Create these files (empty implementations, just structure):

**`src/lib/supabase/server.ts`** — Server-side Supabase client using `@supabase/ssr` with cookie-based auth.

**`src/lib/supabase/client.ts`** — Browser-side Supabase client (for Realtime subscriptions only).

**`src/lib/supabase/middleware.ts`** — Middleware helper to refresh the auth session.

**`src/middleware.ts`** — Next.js middleware that calls the Supabase session refresh on every request.

Use environment variables:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (for DB tests and admin operations)

Create a `.env.local.example` file with these variables (no values).
Create a `.env.test` file with local Supabase defaults:
```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<local anon key from supabase start output>
SUPABASE_SERVICE_ROLE_KEY=<local service_role key from supabase start output>
```

### 7. Create Test Infrastructure

**`vitest.config.ts`**:
- Configure vitest with TypeScript support
- Set up path aliases matching `tsconfig.json`

**`playwright.config.ts`**:
- Base URL: `http://localhost:3000`
- Web server: start `npm run dev` before tests
- Projects: chromium only (for now)
- Screenshot on failure

**`tests/db/.gitkeep`** — Placeholder for database tests.

**`tests/e2e/.gitkeep`** — Placeholder for e2e tests.

**`tests/helpers/supabase.ts`** — Helper to create Supabase test clients (anon + service_role) pointing at the local Supabase instance (`http://127.0.0.1:54321`).

### 8. Add NPM Scripts

Add to `package.json`:
```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test:db": "vitest run --config vitest.config.ts tests/db",
    "test:e2e": "npx playwright test",
    "test": "npm run test:db && npm run test:e2e"
  }
}
```

### 9. Create CI Pipeline

**`.github/workflows/ci.yml`**:

Note: Local Supabase (`supabase start`) provides deterministic keys. Use `supabase status -o env` to extract them in CI instead of GitHub secrets.

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  lint-and-typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck

  db-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - uses: supabase/setup-cli@v1
        with:
          version: latest
      - run: supabase start
      - run: npm ci
      - name: Run DB tests
        run: |
          eval "$(supabase status -o env)"
          npm run test:db

  e2e-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - uses: supabase/setup-cli@v1
        with:
          version: latest
      - run: supabase start
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - name: Build and test
        run: |
          eval "$(supabase status -o env)"
          npm run build
          npm run test:e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/
```

### 10. Create .gitignore Additions

Ensure `.gitignore` includes:
```
.env.local
node_modules/
.next/
playwright-report/
test-results/
```

### 11. Smoke Test

Create a minimal Playwright test `tests/e2e/smoke.spec.ts`:
```typescript
import { test, expect } from '@playwright/test';

test('home page loads', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('nav')).toBeVisible();
  await expect(page.getByText('HelpDesk')).toBeVisible();
});
```

## Verification Checklist

- [ ] `npm run dev` starts the app at localhost:3000
- [ ] `npx supabase start` starts local Supabase
- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run test:e2e` passes with the smoke test
- [ ] CI pipeline YAML is valid
- [ ] All files follow the folder structure in `docs/build-plan.md`
