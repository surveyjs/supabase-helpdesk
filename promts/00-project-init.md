# Phase 0 — Project Initialization & CI

## Context

You are building a **HelpDesk** application — a customer-support ticket system. Read the full specs in `docs/requirements.md`, `docs/design.md`, `docs/architecture.md`, and the build plan in `docs/build-plan.md`.

This is Phase 0: set up the project skeleton with all tooling, CI, and a verified dev environment. **No feature code yet.**

## Tasks

### 1. Initialize Next.js Project

```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm
```

> **Note:** The directory already contains `docs/` and `promts/` folders. `create-next-app` may warn about a non-empty directory — accept the prompt to proceed, or pass `--yes` to skip confirmation. These existing folders will not be overwritten.

- Use Next.js 15 (latest) with App Router
- TypeScript strict mode enabled
- Tailwind CSS configured

### 2. Install Dependencies

```bash
# Supabase
npm install @supabase/supabase-js @supabase/ssr

# Testing
npm install -D vitest @playwright/test dotenv

# Markdown — server-side pipeline
npm install unified remark-parse remark-gfm remark-rehype rehype-sanitize rehype-stringify

# Markdown — client-side preview (used in Phase 6+)
npm install react-markdown

# Font
npm install geist
```

Do NOT install `@testing-library/react` — the project uses Playwright for UI tests and Vitest for DB/logic tests. There is no need for React Testing Library given the server-rendered architecture.

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

Create these files with minimal working stubs (not empty — provide the import structure and exported function signatures so later phases can fill in the implementation):

**`src/lib/supabase/server.ts`** — Server-side Supabase client using `@supabase/ssr` with cookie-based auth:
```typescript
import { createServerClient as _createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createServerClient() {
  const cookieStore = await cookies();
  return _createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
    }
  );
}
```

**`src/lib/supabase/client.ts`** — Browser-side Supabase client (for Realtime subscriptions only):
```typescript
import { createBrowserClient as _createBrowserClient } from '@supabase/ssr';

export function createBrowserClient() {
  return _createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

**`src/lib/supabase/middleware.ts`** — Middleware helper to refresh the auth session:
```typescript
import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );
  await supabase.auth.getUser();
  return supabaseResponse;
}
```

**`src/middleware.ts`** — Next.js middleware that calls the Supabase session refresh on every request:
```typescript
import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
```

Use environment variables:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (for DB tests and admin operations)

Create a `.env.local.example` file with these variables (no values — for production/hosted Supabase).

Create a `.env.test` file with the **deterministic local Supabase keys** (these are always the same for `supabase start` and are safe to commit):
```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU
```
These are the default keys from the Supabase CLI — they only work against local instances and are safe to commit.

### 7. Create Test Infrastructure

**`vitest.config.ts`**:
- Configure vitest with TypeScript support
- Set up path aliases matching `tsconfig.json`
- Load `.env.test` automatically using the `dotenv` package in a setup file or vitest's `envDir`/`env` config:
```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });

export default defineConfig({
  test: {
    globals: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

**`playwright.config.ts`**:
- Base URL: `http://localhost:3000`
- Load `.env.test` at the top of the config: `import dotenv from 'dotenv'; dotenv.config({ path: '.env.test' });`
- Web server: use `npm run start` (production mode) for CI reliability. Build before running tests.
- Projects: chromium only (for now)
- Screenshot on failure

Example:
```typescript
import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run build && npm run start',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    },
  },
});
```

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
        run: npm run test:db
        # .env.test contains deterministic local keys — no mapping needed

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
      - name: Run E2E tests
        run: npm run test:e2e
        # Playwright config loads .env.test and runs build+start via webServer
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

**Note:** `.env.test` is NOT in `.gitignore` — it contains only deterministic local Supabase keys that are safe to commit and needed by CI.

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
