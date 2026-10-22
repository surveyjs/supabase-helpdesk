# Plan A: deploy artifact and explicit migrations

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Один образ на версию, без данных инстанса. Миграции применяются только явной командой
`migrate`, а приложение отказывается стартовать на несовпадающей схеме. CI проверяет ровно этот образ.

**Architecture:**
- Конфиг инстанса читается в runtime через общий модуль `src/lib/deploy/env.mjs`. Его используют
  и Next-приложение, и скрипты контейнера.
- Логика сравнения версий живёт в одном месте, `src/lib/deploy/versions.mjs`, и используется и при
  старте, и в `migrate`.
- Shell-обёртка `migrate` повторяет прототип, проверенный экспериментом. В CI появляются job'ы
  `image` и `image-smoke`, `migration-upgrade` переводится на образ.

**Tech Stack:** Next.js 16 (App Router, `output: "standalone"`), @supabase/ssr, Vitest 4,
Docker (node:24-alpine), Supabase CLI 2.121.0, PostgreSQL 17 client, GitHub Actions, bash/sh.

**Spec:** `docs/superpowers/specs/2026-10-22-deployment-design.md`.

**Ветка:** `feat/deploy-artifact` от `ci/refactor-green-fast`. План опирается на переписанный там `ci.yml`.

## Global Constraints
- Node 24 (`.nvmrc` = `24`), базовый образ `node:24-alpine`.
- Supabase CLI в образе = версии в `package.json` → `"supabase": "npx -y supabase@2.121.0"` (2.121.0).
- `postgresql17-client` (psql — держит блокировку миграции).
- Переменные: `APP_URL`, `SUPABASE_URL`, `SUPABASE_INTERNAL_URL`, `SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `MIGRATION_DB_URL`,
  `HELPDESK_VERSION` (build-arg, по умолчанию `dev`), `SCHEMA_CHECK_WAIT_SECONDS` (60).
- Exit codes:
  - `serve`/`status`: 78 — схема не совпадает, 1 — ошибка конфигурации или Supabase недоступен;
  - `migrate`: 0 — ок или нечего делать, 1 — ошибка, 2 — бэкап не подтверждён (нет `--backup-confirmed`, ничего не применено),
    3 — история разошлась, 4 — БД новее образа;
  - entrypoint: 64 — неизвестная команда.
- Пути в образе: `/app/supabase/migrations`, `/app/docker`, `/app/docker/lib` (копия `src/lib/deploy`).
- Ключ advisory lock: `7270011`.
- Перед любым кодом Next читать соответствующий гайд в `node_modules/next/dist/docs/` (AGENTS.md).
- Комментарии в коде на английском, в стиле окружающего кода.
- Коммиты оканчиваются строкой `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus
1. **Полный стек: браузер ходит на `APP_URL`, сервер — на `kong:8000`.** Пользователь должен
   оставаться залогиненным. Имя cookie закрепляет unit-тест в Task 1, а клиенты (браузер, сервер,
   proxy) передают его в Task 1–2. Сквозная проверка через reverse proxy — `bundle-e2e` в плане B
   (в плане A полного стека с прокси ещё нет).
2. **Supabase ещё не готов, когда стартует `app`** (connection refused или 502 от Kong). Ожидаемо:
   ожидание до `SCHEMA_CHECK_WAIT_SECONDS`, затем понятное сообщение без stack trace.
   Smoke-сценарий в Task 7.
3. **Неверный service-role ключ.** Ожидаемо: немедленная понятная ошибка (HTTP 401), без минутного
   ожидания. Smoke-сценарий в Task 7.
4. **`migrate` без `--backup-confirmed` при наличии pending-миграций.** Ожидаемо: exit 2, ничего не
   применено, сообщение говорит, как сделать бэкап. Без pending-миграций флаг не нужен (exit 0).
   Smoke-сценарии в Task 6.
5. **Посторонние файлы или дубли версий в `supabase/migrations`.** Ожидаемо: посторонние файлы
   игнорируются, дубль — жёсткая ошибка, из БД принимаются только цифровые версии (защита `eval`
   в `migrate.sh`). Unit-тесты в Task 5, проверка `versions-cli` в Task 6.

## Карта файлов

| Файл | Ответственность |
|---|---|
| `src/lib/deploy/env.mjs` (new) | Разбор переменных окружения в адреса Supabase, ключи и имя cookie. Общий для приложения и контейнера |
| `src/lib/deploy/versions.mjs` (new) | Разбор имён миграций, сравнение с БД, тексты сообщений |
| `src/lib/runtime-config.ts` (new) | Обёртка над `env.mjs` для Next (`process.env` в runtime) |
| `src/app/runtime-config.js/route.ts` (new) | Публичный конфиг для браузера (`window.__HELPDESK_CONFIG__`) |
| `src/lib/supabase/{client,server,middleware}.ts` | Клиенты Supabase на runtime-конфиге и общем имени cookie |
| `src/app/layout.tsx`, `src/proxy.ts` | Подключение `/runtime-config.js`, исключение его из proxy |
| `src/app/api/health/route.ts` | Отдаёт `version` |
| `supabase/migrations/003_schema_version_rpc.sql` (new) | RPC `schema_migration_versions()` |
| `docker/entrypoint.sh`, `docker/check-schema.mjs`, `docker/migrate.sh`, `docker/versions-cli.mjs` (new) | Команды образа |
| `Dockerfile`, `.dockerignore` | Образ на одну версию |
| `.github/scripts/image-smoke.sh` (new) | Сценарии образа против живого Supabase-стека |
| `.github/workflows/ci.yml`, `.github/scripts/migration-upgrade.sh` | Job'ы `image` и `image-smoke`, `migration-upgrade` через образ |
| Тесты: `src/lib/deploy/*.test.ts`, `tests/unit/*.test.ts`, `tests/db/035-schema-versions.test.ts` | — |

---

### Task 0: Зафиксировать спецификацию и план, создать ветку

**Files:**
- Create: `docs/superpowers/specs/2026-10-22-deployment-design.md` (раздел I этого документа)
- Create: `docs/superpowers/plans/2026-10-22-deploy-artifact.md` (раздел II этого документа)

- [ ] **Step 1: Ветка**

Run: `git switch -c feat/deploy-artifact ci/refactor-green-fast`
Expected: `Switched to a new branch 'feat/deploy-artifact'`

- [ ] **Step 2: Скопировать разделы I и II в два файла** (содержимое как есть, без изменений).

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-10-22-deployment-design.md docs/superpowers/plans/2026-10-22-deploy-artifact.md
git commit -m "Deployment design and plan A (artifact, explicit migrations)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1: Runtime-конфиг на сервере

**Files:**
- Create: `src/lib/deploy/env.mjs`, `src/lib/deploy/env.test.ts`, `src/lib/runtime-config.ts`
- Modify: `src/lib/supabase/server.ts`, `src/lib/supabase/middleware.ts`, `src/lib/email/csat.ts:86`,
  `src/lib/actions/auth.ts:137`, `src/lib/actions/inbound-email.ts:322`, `src/lib/actions/auth-config.ts:647`,
  `src/app/(main)/admin/tiers/page.tsx:34`, `.env.test`, `playwright.config.ts`, `.env.local.example`,
  `.env.demo.local.example`, `.env.internal.local.example`, `README.md` (раздел про env)

**Interfaces:**
- Produces:
  - `resolveSupabaseEnv(env: Record<string, string|undefined>) → { appUrl, browserSupabaseUrl,
    serverSupabaseUrl, anonKey, serviceRoleKey, authCookieName }` (все `string`), бросает `Error`
    с перечислением недостающих переменных;
  - `runtimeConfig()` (тот же объект из `process.env`);
  - `serviceRoleKey(): string`.

- [ ] **Step 1: Написать падающий тест** `src/lib/deploy/env.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { resolveSupabaseEnv } from './env.mjs';

const base = {
  APP_URL: 'https://help.example.com',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'svc',
};

describe('resolveSupabaseEnv', () => {
  it('external Supabase: browser and server both use SUPABASE_URL', () => {
    const c = resolveSupabaseEnv({ ...base, SUPABASE_URL: 'https://abc.supabase.co/', SUPABASE_INTERNAL_URL: 'http://kong:8000' });
    expect(c.browserSupabaseUrl).toBe('https://abc.supabase.co');
    expect(c.serverSupabaseUrl).toBe('https://abc.supabase.co');
  });

  it('bundled stack: browser uses APP_URL, server uses SUPABASE_INTERNAL_URL', () => {
    const c = resolveSupabaseEnv({ ...base, SUPABASE_INTERNAL_URL: 'http://kong:8000/' });
    expect(c.browserSupabaseUrl).toBe('https://help.example.com');
    expect(c.serverSupabaseUrl).toBe('http://kong:8000');
  });

  it('derives the auth cookie name from the browser URL so both sides share the session', () => {
    expect(resolveSupabaseEnv({ ...base, SUPABASE_INTERNAL_URL: 'http://kong:8000' }).authCookieName)
      .toBe('sb-help-auth-token');
  });

  it('keeps the cookie name current instances already use', () => {
    expect(resolveSupabaseEnv({ ...base, SUPABASE_URL: 'http://127.0.0.1:54321' }).authCookieName)
      .toBe('sb-127-auth-token');
  });

  it('names every missing variable', () => {
    expect(() => resolveSupabaseEnv({})).toThrow(/APP_URL.*SUPABASE_URL.*SUPABASE_ANON_KEY/s);
  });

  it('treats blank values as missing', () => {
    expect(() => resolveSupabaseEnv({ ...base, SUPABASE_URL: '  ' })).toThrow(/SUPABASE_URL/);
  });

  it('rejects an APP_URL with a path when Supabase is served on the same domain', () => {
    expect(() => resolveSupabaseEnv({ ...base, APP_URL: 'https://corp.example.com/helpdesk', SUPABASE_INTERNAL_URL: 'http://kong:8000' }))
      .toThrow(/APP_URL must not contain a path/);
  });
});
```

- [ ] **Step 2: Запустить, убедиться, что падает**

Run: `npx vitest run --config vitest.config.ts src/lib/deploy/env.test.ts`
Expected: FAIL — `Failed to resolve import "./env.mjs"`

- [ ] **Step 3: Реализовать** `src/lib/deploy/env.mjs`

```js
// Where the app reaches Supabase. Shared by the Next.js app
// (src/lib/runtime-config.ts) and the container scripts (docker/*.mjs; the
// Dockerfile copies this directory to /app/docker/lib).
//
//   SUPABASE_URL set   -> external Supabase (Cloud or self-hosted elsewhere):
//                         browser and server both use it.
//   SUPABASE_URL unset -> bundled stack on the app's own domain: the browser
//                         uses APP_URL (the reverse proxy routes /auth/v1,
//                         /rest/v1, /storage/v1 and /realtime/v1 to Kong) and
//                         the server uses SUPABASE_INTERNAL_URL (http://kong:8000).

/** @param {string | undefined} value */
function url(value) {
  return (value ?? '').trim().replace(/\/+$/, '');
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{ appUrl: string, browserSupabaseUrl: string, serverSupabaseUrl: string,
 *   anonKey: string, serviceRoleKey: string, authCookieName: string }}
 */
export function resolveSupabaseEnv(env) {
  const appUrl = url(env.APP_URL);
  const external = url(env.SUPABASE_URL);
  const internal = url(env.SUPABASE_INTERNAL_URL);
  const anonKey = (env.SUPABASE_ANON_KEY ?? '').trim();

  const missing = [];
  if (!appUrl) missing.push('APP_URL');
  if (!external && !internal) {
    missing.push('SUPABASE_URL (external Supabase) or SUPABASE_INTERNAL_URL (bundled stack)');
  }
  if (!anonKey) missing.push('SUPABASE_ANON_KEY');
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(', ')}`);

  if (!external && new URL(appUrl).pathname !== '/') {
    throw new Error(`APP_URL must not contain a path when Supabase is served on the app's domain: ${appUrl}`);
  }

  const browserSupabaseUrl = external || appUrl;
  return {
    appUrl,
    browserSupabaseUrl,
    serverSupabaseUrl: external || internal,
    anonKey,
    serviceRoleKey: (env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim(),
    // supabase-js derives its default storage key from the URL's hostname
    // (sb-<first label>-auth-token). Pin it to the browser URL so a server that
    // talks to kong:8000 still reads the browser's session cookie.
    authCookieName: `sb-${new URL(browserSupabaseUrl).hostname.split('.')[0]}-auth-token`,
  };
}
```

- [ ] **Step 4: Запустить тест**

Run: `npx vitest run --config vitest.config.ts src/lib/deploy/env.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: `src/lib/runtime-config.ts`**

```ts
import { resolveSupabaseEnv } from './deploy/env.mjs';

/**
 * Instance configuration, read from the environment at request time. Nothing
 * here is inlined by `next build`, so one image serves every instance.
 */
export function runtimeConfig() {
  return resolveSupabaseEnv(process.env);
}

export function serviceRoleKey(): string {
  const key = runtimeConfig().serviceRoleKey;
  if (!key) throw new Error('Missing environment variable: SUPABASE_SERVICE_ROLE_KEY');
  return key;
}
```

- [ ] **Step 6: Перевести серверные клиенты.** В `src/lib/supabase/server.ts`:

```ts
import { runtimeConfig, serviceRoleKey } from '@/lib/runtime-config';

export async function createServerClient() {
  const cookieStore = await cookies();
  const { serverSupabaseUrl, anonKey, authCookieName } = runtimeConfig();
  return _createServerClient(serverSupabaseUrl, anonKey, {
    cookieOptions: { name: authCookieName },
    cookies: {
      // ... getAll/setAll unchanged
    },
  });
}

export function createServiceRoleClient() {
  return createClient(runtimeConfig().serverSupabaseUrl, serviceRoleKey());
}
```

В `src/lib/supabase/middleware.ts` то же самое для `createServerClient(...)`: использовать
`serverSupabaseUrl` и `anonKey`, добавить `cookieOptions: { name: authCookieName }`.

- [ ] **Step 7: Остальные места**
  - `csat.ts:86` → `const baseUrl = runtimeConfig().appUrl;`
  - `auth.ts:137`, `inbound-email.ts:322`, `admin/tiers/page.tsx:34` → `runtimeConfig().appUrl`.
  - `auth-config.ts:647` → `const supabaseUrl = runtimeConfig().browserSupabaseUrl;` — это публичный
    callback для IdP, поэтому нужен браузерный адрес.

Run: `grep -rn "NEXT_PUBLIC_" src`
Expected: только `src/lib/supabase/client.ts` (его переводит Task 2).

- [ ] **Step 8: Тестовое и примерное окружение**
  - В `.env.test` добавить рядом с существующими:
    `SUPABASE_URL=http://127.0.0.1:54321`, `SUPABASE_ANON_KEY=<то же значение, что NEXT_PUBLIC_SUPABASE_ANON_KEY>`,
    `APP_URL=<то же значение, что NEXT_PUBLIC_APP_URL>`.
  - `NEXT_PUBLIC_*` в `.env.test` остаются: их читают `tests/helpers/supabase.ts`, тесты в `tests/db/*`
    и `.github/actions/supabase-ready`.
  - Над новыми строками комментарий: «read by the app at runtime (src/lib/deploy/env.mjs)».
  - В `playwright.config.ts` → `webServer.env` добавить `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `APP_URL`
    из `process.env`.
  - В `.env*.local.example` и README переименовать: `NEXT_PUBLIC_SUPABASE_URL`→`SUPABASE_URL`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY`→`SUPABASE_ANON_KEY`, `NEXT_PUBLIC_APP_URL`/`NEXT_PUBLIC_SITE_URL`→`APP_URL`.
    В README одна строка о том, что локальные `.env.local` нужно переименовать так же.

- [ ] **Step 9: Проверка**

Run: `npm run typecheck && npm run test:unit`
Expected: PASS

Run (локальный стек поднят: `npm run supabase -- start`): `npm run test:db`
Expected: PASS (в том числе `011-csat`, использующий базовый URL)

- [ ] **Step 10: Commit**

```bash
git add src/lib/deploy/env.mjs src/lib/deploy/env.test.ts src/lib/runtime-config.ts src/lib/supabase/server.ts src/lib/supabase/middleware.ts src/lib/email/csat.ts src/lib/actions/auth.ts src/lib/actions/inbound-email.ts src/lib/actions/auth-config.ts "src/app/(main)/admin/tiers/page.tsx" .env.test playwright.config.ts .env.local.example .env.demo.local.example .env.internal.local.example README.md
git commit -m "Read instance configuration at runtime instead of inlining NEXT_PUBLIC_* at build

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Публичный конфиг для браузера

**Files:**
- Create: `src/app/runtime-config.js/route.ts`, `tests/unit/runtime-config-route.test.ts`
- Modify: `src/lib/supabase/client.ts`, `src/app/layout.tsx`, `src/proxy.ts`

**Interfaces:**
- Consumes: `runtimeConfig()` (Task 1).
- Produces: `GET /runtime-config.js` → `window.__HELPDESK_CONFIG__ = { supabaseUrl, supabaseAnonKey, authCookieName }`.

- [ ] **Step 1: Прочитать** `node_modules/next/dist/docs/01-app/03-api-reference/02-components/script.md`
  (`strategy="beforeInteractive"` в root layout) и `.../02-guides/environment-variables.md`
  (раздел «Runtime Environment Variables»). Если `beforeInteractive` в Next 16 устроен иначе,
  остановиться и сообщить, не изобретая обходной путь.

- [ ] **Step 2: Падающий тест** `tests/unit/runtime-config-route.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GET } from '@/app/runtime-config.js/route';

function evaluate(body: string) {
  const win: { __HELPDESK_CONFIG__?: unknown } = {};
  new Function('window', body)(win);
  return win.__HELPDESK_CONFIG__;
}

describe('GET /runtime-config.js', () => {
  beforeEach(() => {
    vi.stubEnv('APP_URL', 'https://help.example.com');
    vi.stubEnv('SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_INTERNAL_URL', 'http://kong:8000');
    vi.stubEnv('SUPABASE_ANON_KEY', 'anon</script><script>alert(1)');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'secret-service-key');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('exposes only the public values', async () => {
    const body = await GET().text();
    expect(body).not.toContain('secret-service-key');
    expect(body).not.toContain('kong:8000');
    expect(evaluate(body)).toEqual({
      supabaseUrl: 'https://help.example.com',
      supabaseAnonKey: 'anon</script><script>alert(1)',
      authCookieName: 'sb-help-auth-token',
    });
  });

  it('cannot close a script element', async () => {
    expect(await GET().text()).not.toContain('</script>');
  });

  it('is served as uncached JavaScript', () => {
    const res = GET();
    expect(res.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
```

- [ ] **Step 3: Run** `npx vitest run --config vitest.config.ts tests/unit/runtime-config-route.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/runtime-config.js/route"`

- [ ] **Step 4: Реализовать** `src/app/runtime-config.js/route.ts`

```ts
import { runtimeConfig } from '@/lib/runtime-config';

// Public, per-instance settings for the browser bundle, loaded before
// hydration by <Script strategy="beforeInteractive"> in the root layout. The
// image is shared by every instance, so these cannot be inlined at build time.
export const dynamic = 'force-dynamic';

export function GET() {
  const { browserSupabaseUrl, anonKey, authCookieName } = runtimeConfig();
  const json = JSON.stringify({ supabaseUrl: browserSupabaseUrl, supabaseAnonKey: anonKey, authCookieName })
    .replace(/</g, '\\u003c');
  return new Response(`window.__HELPDESK_CONFIG__=${json};`, {
    headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' },
  });
}
```

- [ ] **Step 5: Run тест** → PASS (3 tests)

- [ ] **Step 6: Браузерный клиент** `src/lib/supabase/client.ts`

```ts
import { createBrowserClient as _createBrowserClient } from '@supabase/ssr';

declare global {
  interface Window {
    __HELPDESK_CONFIG__?: { supabaseUrl: string; supabaseAnonKey: string; authCookieName: string };
  }
}

// Settings come from /runtime-config.js (see src/app/runtime-config.js/route.ts).
export function createBrowserClient() {
  const config = window.__HELPDESK_CONFIG__;
  if (!config) throw new Error('/runtime-config.js has not been loaded');
  return _createBrowserClient(config.supabaseUrl, config.supabaseAnonKey, {
    cookieOptions: { name: config.authCookieName },
  });
}
```

- [ ] **Step 7: Layout и proxy**
  - В `src/app/layout.tsx`: `import Script from 'next/script';`, первым элементом `<body>` —
    `<Script src="/runtime-config.js" strategy="beforeInteractive" />`.
  - В `src/proxy.ts` добавить в matcher исключение `runtime-config\\.js`, чтобы на конфиг не делался
    запрос `getUser()`:
    `'/((?!_next/static|_next/image|favicon.ico|runtime-config\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'`.

- [ ] **Step 8: Проверка.** Все вызовы `createBrowserClient()` находятся в обработчиках событий
  и `useEffect` (проверено), поэтому при SSR они не выполняются.

Run: `npm run typecheck && npm run test:unit && npm run build:e2e`
Expected: PASS, сборка без ошибок

Run (стек поднят): `npx playwright test --project=chromium tests/e2e/auth.spec.ts tests/e2e/realtime-notifications.spec.ts`
Expected: PASS — логин и realtime работают через runtime-конфиг

- [ ] **Step 9: Commit**

```bash
git add src/app/runtime-config.js/route.ts tests/unit/runtime-config-route.test.ts src/lib/supabase/client.ts src/app/layout.tsx src/proxy.ts
git commit -m "Serve browser Supabase settings from /runtime-config.js

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Версия в `/api/health`

**Files:**
- Modify: `src/app/api/health/route.ts`
- Create: `tests/unit/health-route.test.ts`

**Interfaces:** Produces: `GET /api/health` → `{ status: 'ok', version: string, time: string }`.

- [ ] **Step 1: Тест**

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { GET } from '@/app/api/health/route';

describe('GET /api/health', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('reports the image version', async () => {
    vi.stubEnv('HELPDESK_VERSION', '1.4.0');
    expect(await GET().json()).toMatchObject({ status: 'ok', version: '1.4.0' });
  });

  it('reports dev outside an image', async () => {
    vi.stubEnv('HELPDESK_VERSION', undefined);
    expect(await GET().json()).toMatchObject({ version: 'dev' });
  });
});
```

- [ ] **Step 2: Run** `npx vitest run --config vitest.config.ts tests/unit/health-route.test.ts` → FAIL (`version` undefined)

- [ ] **Step 3: Реализация**

```ts
import { NextResponse } from 'next/server';

// Liveness probe for docker, the reverse proxy and deploy/upgrade.sh (which
// waits for the new `version`). Intentionally does not touch the database —
// the schema is checked once at startup (docker/check-schema.mjs).
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({
    status: 'ok',
    version: process.env.HELPDESK_VERSION ?? 'dev',
    time: new Date().toISOString(),
  });
}
```

- [ ] **Step 4: Run** → PASS

- [ ] **Step 5: Commit** `git add src/app/api/health/route.ts tests/unit/health-route.test.ts && git commit -m "Report the image version from /api/health" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

### Task 4: Миграция 003 — RPC версии схемы

**Files:**
- Create: `supabase/migrations/003_schema_version_rpc.sql`, `tests/db/035-schema-versions.test.ts`

**Interfaces:** Produces: `public.schema_migration_versions() → text[]`, упорядоченный, `EXECUTE` только у `service_role`.

- [ ] **Step 1: Тест** `tests/db/035-schema-versions.test.ts`

```ts
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { describe, it, expect } from 'vitest';
import { createAnonClient, createServiceRoleClient } from '../helpers/supabase';

// The app's startup check (docker/check-schema.mjs) reads the applied
// migrations through this RPC with the service_role key.

const shipped = readdirSync(path.resolve(__dirname, '../../supabase/migrations'))
  .map((f) => /^(\d+)_.+\.sql$/.exec(f)?.[1])
  .filter((v): v is string => Boolean(v))
  .sort();

describe('schema_migration_versions()', () => {
  it('returns every applied migration to service_role', async () => {
    const { data, error } = await createServiceRoleClient().rpc('schema_migration_versions');
    expect(error).toBeNull();
    expect(data).toEqual(shipped);
  });

  it('is not callable with the anon key', async () => {
    const { error } = await createAnonClient().rpc('schema_migration_versions');
    expect(error?.code).toBe('42501');
  });

  it('is not callable by a signed-in user', async () => {
    const alice = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    await alice.auth.signInWithPassword({ email: 'alice@example.com', password: 'Password123' });
    const { error } = await alice.rpc('schema_migration_versions');
    expect(error?.code).toBe('42501');
  });
});
```

- [ ] **Step 2: Run** `npm run test:db -- tests/db/035-schema-versions.test.ts`
Expected: FAIL — `Could not find the function public.schema_migration_versions` (PGRST202)

- [ ] **Step 3: Миграция** `supabase/migrations/003_schema_version_rpc.sql`

```sql
-- ============================================================
-- 003 — Schema version RPC for the app's startup check
-- ============================================================
-- The app refuses to start unless the database has exactly the migrations
-- shipped in its image (docker/check-schema.mjs). It reads them through this
-- function over the Data API with the service_role key, so the running server
-- needs no database credentials; only the one-off `migrate` command has them.
-- Re-runnable: CREATE OR REPLACE, REVOKE/GRANT are idempotent.

CREATE OR REPLACE FUNCTION public.schema_migration_versions()
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RETURN ARRAY[]::text[];
  END IF;
  RETURN ARRAY(SELECT version FROM supabase_migrations.schema_migrations ORDER BY version);
END;
$$;

-- Instances created under Supabase's OLD default privileges grant EXECUTE on
-- every new function to anon/authenticated explicitly (see 002), so revoke from
-- them by name, not only from PUBLIC.
REVOKE EXECUTE ON FUNCTION public.schema_migration_versions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.schema_migration_versions() TO service_role;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 4: Применить локально и прогнать**

Run: `npm run supabase -- migration up --local && npm run test:db`
Expected: PASS, включая 035 и `034-grants`

- [ ] **Step 5: Проверить идемпотентность** (правило migration-upgrade)

Run: `docker exec -i supabase_db_helpdesk psql -U postgres -v ON_ERROR_STOP=1 < supabase/migrations/003_schema_version_rpc.sql`
Expected: exit 0

- [ ] **Step 6: Commit** `git add supabase/migrations/003_schema_version_rpc.sql tests/db/035-schema-versions.test.ts && git commit -m "Add schema_migration_versions() for the startup schema check" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

### Task 5: Сравнение версий (одна реализация для `serve` и `migrate`)

**Files:**
- Create: `src/lib/deploy/versions.mjs`, `src/lib/deploy/versions.test.ts`, `tests/unit/migrations.test.ts`

**Interfaces:**
- Produces:
  - `migrationVersions(fileNames: string[]): string[]` — отсортированные версии, бросает ошибку на дубль;
  - `compareVersions(image: string[], db: string[]): { status: 'ok'|'pending'|'newer'|'diverged',
    pending: string[], dbOnly: string[] }`;
  - `explain(result): string` — многострочный текст для оператора.

- [ ] **Step 1: Тесты** `src/lib/deploy/versions.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { compareVersions, explain, migrationVersions } from './versions.mjs';

describe('migrationVersions', () => {
  it('extracts numeric prefixes in order and ignores other files', () => {
    expect(migrationVersions(['002_b.sql', '001_a.sql', '.gitkeep', 'README.md', 'notes.sql']))
      .toEqual(['001', '002']);
  });

  it('rejects two files with one version (the CLI would silently skip one)', () => {
    expect(() => migrationVersions(['002_a.sql', '002_b.sql']))
      .toThrow('Duplicate migration version 002: 002_a.sql and 002_b.sql');
  });
});

describe('compareVersions', () => {
  const image = ['001', '002', '003'];

  it('ok when identical', () => {
    expect(compareVersions(image, ['001', '002', '003'])).toEqual({ status: 'ok', pending: [], dbOnly: [] });
  });

  it('pending on an empty database', () => {
    expect(compareVersions(image, [])).toEqual({ status: 'pending', pending: image, dbOnly: [] });
  });

  it('pending when the database is behind', () => {
    expect(compareVersions(image, ['001'])).toEqual({ status: 'pending', pending: ['002', '003'], dbOnly: [] });
  });

  it('newer when the database has versions this image does not ship', () => {
    expect(compareVersions(['001', '002'], image)).toEqual({ status: 'newer', pending: [], dbOnly: ['003'] });
  });

  it('diverged when both sides have versions the other lacks', () => {
    expect(compareVersions(['001', '002', '004'], image))
      .toEqual({ status: 'diverged', pending: ['004'], dbOnly: ['003'] });
  });
});

describe('explain', () => {
  it('pending: names the migrations and the migrate command', () => {
    expect(explain(compareVersions(['001', '002', '003'], ['001'])))
      .toMatch(/Pending migrations: 002, 003[\s\S]*docker compose run --rm migrate/);
  });

  it('newer: points to the rollback, never to a bypass', () => {
    const text = explain(compareVersions(['001'], ['001', '002']));
    expect(text).toMatch(/newer than this image[\s\S]*002[\s\S]*\.\/upgrade\.sh --rollback/);
  });

  it('diverged: says nothing was changed', () => {
    expect(explain(compareVersions(['001', '004'], ['001', '003']))).toMatch(/diverged[\s\S]*nothing was changed/i);
  });
});
```

`tests/unit/migrations.test.ts`:

```ts
import { readdirSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { migrationVersions } from '@/lib/deploy/versions.mjs';

// The Supabase CLI identifies a migration by its numeric prefix only: a second
// file with a used prefix is skipped in production without any error.
const files = readdirSync('supabase/migrations');

describe('supabase/migrations', () => {
  it('every migration has a unique version', () => {
    expect(() => migrationVersions(files)).not.toThrow();
  });

  it('no .sql file is silently ignored', () => {
    expect(files.filter((f) => f.endsWith('.sql') && !/^\d+_.+\.sql$/.test(f))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run --config vitest.config.ts src/lib/deploy/versions.test.ts tests/unit/migrations.test.ts`
Expected: FAIL — import not found

- [ ] **Step 3: Реализация** `src/lib/deploy/versions.mjs`

```js
// Migration versions: the image's files vs. the database's history.
// Used by the app's startup check (docker/check-schema.mjs) and by the explicit
// `migrate` command (docker/versions-cli.mjs), so both always agree.

const FILE = /^(\d+)_.+\.sql$/;

/** @param {string[]} fileNames @returns {string[]} */
export function migrationVersions(fileNames) {
  /** @type {Map<string, string>} */
  const seen = new Map();
  for (const name of [...fileNames].sort()) {
    const match = FILE.exec(name);
    if (!match) continue;
    const previous = seen.get(match[1]);
    if (previous) throw new Error(`Duplicate migration version ${match[1]}: ${previous} and ${name}`);
    seen.set(match[1], name);
  }
  return [...seen.keys()].sort();
}

/**
 * @param {string[]} image versions shipped in the image
 * @param {string[]} db versions recorded in supabase_migrations.schema_migrations
 * @returns {{ status: 'ok'|'pending'|'newer'|'diverged', pending: string[], dbOnly: string[] }}
 */
export function compareVersions(image, db) {
  const inDb = new Set(db);
  const inImage = new Set(image);
  const pending = image.filter((v) => !inDb.has(v));
  const dbOnly = db.filter((v) => !inImage.has(v)).sort();
  const status = pending.length && dbOnly.length ? 'diverged'
    : dbOnly.length ? 'newer'
    : pending.length ? 'pending'
    : 'ok';
  return { status, pending, dbOnly };
}

/** @param {ReturnType<typeof compareVersions>} result */
export function explain(result) {
  switch (result.status) {
    case 'ok':
      return 'Database schema matches this image.';
    case 'pending':
      return `Database schema is behind this image. Pending migrations: ${result.pending.join(', ')}.\n`
        + 'Run the migration explicitly: docker compose run --rm migrate';
    case 'newer':
      return `Database schema is newer than this image (applied, unknown here: ${result.dbOnly.join(', ')}).\n`
        + 'An older image cannot run on a newer schema. Roll back the database with the app: ./upgrade.sh --rollback';
    case 'diverged':
      return `Migration history has diverged: pending here ${result.pending.join(', ')}; `
        + `applied but unknown here ${result.dbOnly.join(', ')}.\nNothing was changed; this needs manual investigation.`;
  }
}
```

- [ ] **Step 4: Run** → PASS

- [ ] **Step 5: Commit** `git add src/lib/deploy/versions.mjs src/lib/deploy/versions.test.ts tests/unit/migrations.test.ts && git commit -m "Compare image and database migration versions in one place" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

### Task 6: Образ и команда `migrate`

> **Пересмотрено 2026-10-22 по результату проверки (gate).** `pg_restore --clean` ролью `postgres`
> на Supabase-БД падает: `must be owner of event trigger pgrst_drop_watch`, 875 ошибок прав, все в
> схемах `supabase_admin`. Документация Supabase отката «на месте» не предлагает: откат —
> восстановление всей БД (Cloud — PITR или ежедневный бэкап; self-hosted — своими средствами).
> Решение пользователя: в полном стеке `upgrade.sh` (план B) делает снимок каталога данных Postgres,
> во внешнем режиме используется PITR провайдера. В образе остаётся только `migrate`: он ничего не
> применяет без явного `--backup-confirmed` и печатает UTC-время как точку восстановления для PITR.
> Команды `restore` и `pg_dump` в образе нет.

**Files:**
- Create: `docker/entrypoint.sh`, `docker/migrate.sh`, `docker/versions-cli.mjs`,
  `.github/scripts/image-smoke.sh`, `tests/unit/deploy-pins.test.ts`
- Modify: `Dockerfile` (переписать), `.dockerignore`

**Interfaces:**
- Consumes: `migrationVersions`, `compareVersions` (Task 5).
- Produces:
  - образ с `ENTRYPOINT sh /app/docker/entrypoint.sh` и командами `serve | migrate`
    (`serve` пока без проверки; проверку и `status` добавляет Task 7);
  - `migrate [--dry-run] [--backup-confirmed]`: exit 0, 1, 2 (бэкап не подтверждён, ничего не
    применено), 3, 4;
  - `image-smoke.sh` с хелперами `run <name> [docker opts] -- <args>` (результат в `$rc` и
    `$OUT/<name>.log`), `expect_run`, `expect_eq`, `applied`, `psql_val`, `variant`.

- [ ] **Step 1: Тест закреплённых версий** `tests/unit/deploy-pins.test.ts`

```ts
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const dockerfile = readFileSync('Dockerfile', 'utf8');
const arg = (name: string) => new RegExp(`^ARG ${name}=(\\S+)$`, 'm').exec(dockerfile)?.[1];

describe('Dockerfile pins', () => {
  it('ships the Supabase CLI version package.json pins (the one CI and developers use)', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(arg('SUPABASE_CLI_VERSION')).toBe(/supabase@(\S+)/.exec(pkg.scripts.supabase)?.[1]);
  });

  it('uses the Node major from .nvmrc', () => {
    expect(arg('NODE_VERSION')).toBe(readFileSync('.nvmrc', 'utf8').trim());
  });
});
```

Run: `npx vitest run --config vitest.config.ts tests/unit/deploy-pins.test.ts` → FAIL (ARG нет)

- [ ] **Step 2: `Dockerfile`** (полная замена)

```dockerfile
# syntax=docker/dockerfile:1

# One image per release, shared by every instance and both Supabase modes:
# nothing instance-specific is baked in (src/lib/deploy/env.mjs reads it at
# runtime). Commands (docker/entrypoint.sh): serve (default) | migrate.
ARG NODE_VERSION=24

# ---- deps ---------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
# package-lock.json is not committed: CI passes the tree .github/actions/setup
# resolved for this commit; locally it is the one `npm install` wrote.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---- builder ------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- runner -------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS runner
ARG SUPABASE_CLI_VERSION=2.121.0
ARG HELPDESK_VERSION=dev
# psql holds the migration lock for `migrate`; the CLI's npm package brings a
# musl binary (@supabase/cli-linux-x64-musl) — no Docker needed.
RUN apk add --no-cache postgresql17-client \
 && npm install -g --no-audit --no-fund supabase@${SUPABASE_CLI_VERSION} \
 && npm cache clean --force
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3001 \
    HOSTNAME=0.0.0.0 \
    HELPDESK_VERSION=${HELPDESK_VERSION}
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 -G nodejs nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY supabase/migrations ./supabase/migrations
COPY docker ./docker
COPY src/lib/deploy ./docker/lib
USER nextjs
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:3001/api/health || exit 1
ENTRYPOINT ["sh", "/app/docker/entrypoint.sh"]
CMD ["serve"]
```

В `.dockerignore`:
- добавить `**/*.test.ts` (тесты из `src/` в образ не нужны);
- проверить, что `docker/`, `supabase/` и `package-lock.json` не исключены. Сейчас не исключены;
  `tests`, `docs`, `deploy`, `*.md` остаются в исключениях.

Run: `npx vitest run --config vitest.config.ts tests/unit/deploy-pins.test.ts` → PASS

- [ ] **Step 3: `docker/versions-cli.mjs`**

```js
// Glue for docker/migrate.sh: reads the database's applied versions (one per
// line) on stdin and prints shell assignments (status, image, db, pending,
// dbonly) for `eval`. Versions are validated as digits, so eval is safe.
import { readFileSync, readdirSync } from 'node:fs';
import { compareVersions, migrationVersions } from './lib/versions.mjs';

const image = migrationVersions(readdirSync(process.argv[2]));
const db = readFileSync(0, 'utf8').split(/\s+/).filter(Boolean);
const bad = db.filter((v) => !/^\d+$/.test(v));
if (bad.length) {
  console.error(`[migrate] unexpected versions in supabase_migrations.schema_migrations: ${bad.join(', ')}`);
  process.exit(1);
}
const { status, pending, dbOnly } = compareVersions(image, db);
const vars = { status, image: image.join(' '), db: db.join(' '), pending: pending.join(' '), dbonly: dbOnly.join(' ') };
for (const [key, value] of Object.entries(vars)) console.log(`${key}='${value}'`);
```

- [ ] **Step 4: `docker/migrate.sh`**

```sh
#!/bin/sh
# Explicit database migration — the only place the schema is changed:
#   migrate [--dry-run] [--backup-confirmed]
# Holds a session advisory lock (the Supabase CLI has none) and refuses a
# database that is newer than this image or has diverged (the CLI would fail
# with DbPushMissingLocalError). It applies nothing until the operator confirms
# a backup exists: Supabase offers no in-place logical restore, so a rollback is
# a whole-database restore — the Postgres data-directory snapshot taken by
# deploy/upgrade.sh (bundled stack) or the provider's PITR/daily backup
# (external Supabase). The UTC time printed before applying is the PITR point.
# Exit: 0 ok/nothing to do, 1 error, 2 backup not confirmed (nothing applied),
#       3 history diverged, 4 database newer than this image.
# MIGRATION_DB_URL: direct or session-pooler connection (the lock needs a
# session); bundled stack: ...?sslmode=disable (its Postgres has ssl=off).
set -eu
DB="${MIGRATION_DB_URL:?MIGRATION_DB_URL is required}"
MIG=/app/supabase/migrations
LOCK_KEY=7270011
log() { echo "[migrate] $*" >&2; }

dry_run=0; confirmed=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=1 ;;
    --backup-confirmed) confirmed=1 ;;
    *) log "unknown option: $arg"; exit 1 ;;
  esac
done

if [ "${MIGRATE_LOCKED:-}" != 1 ]; then
  # psql keeps the session (and the lock) open while \! runs the real work.
  rcfile="$(mktemp)"
  log "waiting for the migration lock"
  if ! psql "$DB" -X -q -o /dev/null -v ON_ERROR_STOP=1 <<SQL
select pg_advisory_lock($LOCK_KEY);
\! MIGRATE_LOCKED=1 sh $0 $* 1>&2; echo \$? > $rcfile
SQL
  then log "cannot connect to the database"; rm -f "$rcfile"; exit 1; fi
  rc="$(cat "$rcfile")"; rm -f "$rcfile"
  exit "${rc:-1}"
fi

applied="$(psql "$DB" -X -qtA -c 'select version from supabase_migrations.schema_migrations order by 1' 2>/dev/null || true)"
eval "$(printf '%s\n' "$applied" | node /app/docker/versions-cli.mjs "$MIG")"
log "image: $image | database: ${db:-<empty>}"
case "$status" in
  ok)       log "up to date"; exit 0 ;;
  newer)    log "database is newer than this image (unknown here: $dbonly); nothing changed"; exit 4 ;;
  diverged) log "history diverged: pending here [$pending], unknown here [$dbonly]; nothing changed"; exit 3 ;;
esac
if [ "$dry_run" = 1 ]; then log "dry run: would apply $pending"; exit 0; fi

if [ "$confirmed" != 1 ]; then
  log "refusing to apply $pending without a confirmed backup; nothing was applied."
  log "Bundled stack: run ./upgrade.sh — it snapshots the database before migrating."
  log "External Supabase: make sure PITR or a recent backup exists, then re-run with --backup-confirmed."
  exit 2
fi

log "restore point (UTC, for PITR): $(date -u +%Y-%m-%dT%H:%M:%SZ)"
if ! supabase db push --db-url "$DB" --include-all --skip-vault --workdir /app --yes </dev/null 1>&2; then
  log "migration failed (see above); migrations applied before the failing one stay applied"
  exit 1
fi
log "applied: $pending"
```

- [ ] **Step 5: `docker/entrypoint.sh`**

```sh
#!/bin/sh
# Image commands. `serve` is the default (CMD in the Dockerfile).
set -eu
cmd="${1:-serve}"
[ $# -gt 0 ] && shift
case "$cmd" in
  serve)   exec node /app/server.js ;;
  migrate) exec sh /app/docker/migrate.sh "$@" ;;
  *) echo "usage: serve | migrate [--dry-run] [--backup-confirmed]" >&2; exit 64 ;;
esac
```

- [ ] **Step 6: `.github/scripts/image-smoke.sh`** (часть для `migrate`)

```bash
#!/usr/bin/env bash
# Smoke test of the release image against a real local Supabase stack that
# starts with NO schema: the explicit `migrate` command (dry run, backup
# confirmation, lock, refusals) and the app's startup schema check. CI: job
# image-smoke. Locally (Git Bash + Docker), stops this project's local stack:
#   docker build -t supabase-helpdesk:ci --build-arg HELPDESK_VERSION=local .
#   IMAGE=supabase-helpdesk:ci EXPECTED_VERSION=local bash .github/scripts/image-smoke.sh
set -euo pipefail
export MSYS_NO_PATHCONV=1   # Git Bash: pass container paths unchanged

ROOT="$(git rev-parse --show-toplevel)"
IMAGE="${IMAGE:-supabase-helpdesk:ci}"
EXPECTED_VERSION="${EXPECTED_VERSION:-local}"
WORK="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/image-smoke"
PROJ="$WORK/project" OUT="$WORK/out"
SUMMARY="${GITHUB_STEP_SUMMARY:-$OUT/summary.md}"
EXCLUDE='studio,postgres-meta,imgproxy,edge-runtime,logflare,vector,supavisor'
native_path() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else echo "$1"; fi; }
supabase() { (cd "$ROOT" && npm run --silent supabase -- "$@"); }

rm -rf "$WORK"; mkdir -p "$PROJ/supabase/migrations" "$OUT"
# The repo's stack config with no migrations and no seed.
awk '/^\[/{s=$0} { if (s=="[db.seed]" && $1=="enabled") print "enabled = false"; else print }' \
  "$ROOT/supabase/config.toml" > "$PROJ/supabase/config.toml"
PID="$(sed -n 's/^project_id *= *"\(.*\)"/\1/p' "$PROJ/supabase/config.toml" | head -1)"
NET="supabase_network_$PID" DBC="supabase_db_$PID"
set -a; source "$ROOT/.env.test"; set +a
DB_URL="postgresql://postgres:postgres@$DBC:5432/postgres?sslmode=disable"

supabase stop --no-backup >/dev/null 2>&1 || true
supabase start --workdir "$(native_path "$PROJ")" -x "$EXCLUDE"
trap 'supabase stop --workdir "$(native_path "$PROJ")" --no-backup >/dev/null 2>&1 || true' EXIT

# run <name> [docker run options] -- <image args>   -> $OUT/<name>.log, exit code in $rc
run() {
  local name="$1"; shift
  local opts=(); while [[ "$1" != -- ]]; do opts+=("$1"); shift; done; shift
  set +e
  docker run --rm --network "$NET" \
    -e SUPABASE_URL="http://supabase_kong_$PID:8000" -e APP_URL=http://localhost:3001 \
    -e SUPABASE_ANON_KEY -e SUPABASE_SERVICE_ROLE_KEY -e MIGRATION_DB_URL="$DB_URL" \
    -e SCHEMA_CHECK_WAIT_SECONDS=15 "${opts[@]}" "$IMAGE" "$@" > "$OUT/$name.log" 2>&1
  rc=$?
  set -e
}
fails=0
pass() { echo "✅ $1" | tee -a "$SUMMARY"; }
fail() { echo "❌ $1" | tee -a "$SUMMARY"; fails=$((fails + 1)); }
expect_run() { # <log> <exit> <text> <description>
  if [[ "$rc" == "$2" ]] && grep -qF -- "$3" "$OUT/$1.log"; then pass "$4"
  else fail "$4 (exit $rc, want $2)"; tail -20 "$OUT/$1.log" | sed 's/^/    /'; fi
}
expect_eq() { if [[ "$1" == "$2" ]]; then pass "$3"; else fail "$3 (got '$1', want '$2')"; fi; }
psql_val() { docker exec -i "$DBC" psql -U postgres -X -qtA -c "$1" 2>/dev/null || true; }
applied() { psql_val "select string_agg(version, ' ' order by version) from supabase_migrations.schema_migrations"; }
# variant <name> <drop-last 0|1> [<file> <sql>]: a migrations dir to mount over the image's
variant() {
  local d="$WORK/variants/$1"; mkdir -p "$d"; cp "$ROOT/supabase/migrations/"*.sql "$d/"
  if [[ "$2" == 1 ]]; then rm "$d/$(ls "$d" | sort | tail -1)"; fi
  if [[ -n "${3:-}" ]]; then printf '%s\n' "$4" > "$d/$3"; fi
  native_path "$d"
}
ALL="$(ls "$ROOT/supabase/migrations" | sed -n 's/^\([0-9]*\)_.*\.sql$/\1/p' | sort | paste -sd ' ')"
echo "## Image smoke: $IMAGE" >> "$SUMMARY"

# --- migrate ---------------------------------------------------------------------
run dry-run -- migrate --dry-run
expect_run dry-run 0 "dry run: would apply $ALL" "migrate --dry-run lists every pending migration"
expect_eq "$(applied)" "" "migrate --dry-run applies nothing"

run unconfirmed -- migrate
expect_run unconfirmed 2 "refusing to apply $ALL without a confirmed backup" "pending migrations are not applied without --backup-confirmed (exit 2)"
expect_eq "$(applied)" "" "nothing applied without a backup confirmation"

run first -- migrate --backup-confirmed
expect_run first 0 "applied: $ALL" "migrate --backup-confirmed applies every migration to an empty database"
expect_eq "$(grep -c 'restore point (UTC, for PITR)' "$OUT/first.log")" 1 "migrate prints the PITR restore point before applying"
expect_eq "$(applied)" "$ALL" "history records every migration"

run again -- migrate
expect_run again 0 "up to date" "with nothing pending, migrate needs no confirmation and does nothing"

# --- (Task 7 inserts the startup-check scenarios on a matching schema here) ---------

V="$(variant lock 0 990_smoke_lock.sql "select pg_sleep(5); create table if not exists smoke_lock(id int); insert into smoke_lock values (1);")"
( run lock-a -v "$V:/app/supabase/migrations:ro" -- migrate --backup-confirmed; echo "$rc" > "$OUT/lock-a.rc" ) &
( run lock-b -v "$V:/app/supabase/migrations:ro" -- migrate --backup-confirmed; echo "$rc" > "$OUT/lock-b.rc" ) &
wait
expect_eq "$(cat "$OUT/lock-a.rc") $(cat "$OUT/lock-b.rc")" "0 0" "two concurrent migrate runs both succeed"
expect_eq "$(psql_val 'select count(*) from smoke_lock')" 1 "the lock lets only one of them apply"

V="$(variant newer 1)"
run newer -v "$V:/app/supabase/migrations:ro" -- migrate --backup-confirmed
expect_run newer 4 "database is newer than this image" "an older image refuses to migrate (exit 4)"

# Image: repo + 992; database: repo + 990 -> pending 992, unknown here 990.
V="$(variant diverged 0 992_other.sql "select 1;")"
run diverged -v "$V:/app/supabase/migrations:ro" -- migrate --backup-confirmed
expect_run diverged 3 "history diverged" "diverged history is refused (exit 3)"

echo "Logs: $OUT" >> "$SUMMARY"
exit $(( fails > 0 ))
```

- [ ] **Step 7: Собрать и прогнать**

Run: `npm install && docker build -t supabase-helpdesk:ci --build-arg HELPDESK_VERSION=local . && bash .github/scripts/image-smoke.sh`
Expected: все строки ✅, exit 0. После прогона вернуть обычный стек: `npm run supabase -- start`.

Проверка защиты `eval` (Review Focus 5):
Run: `printf "001\n1'; rm -rf /\n" | docker run --rm -i --entrypoint node supabase-helpdesk:ci /app/docker/versions-cli.mjs /app/supabase/migrations; echo "exit $?"`
Expected: `[migrate] unexpected versions in supabase_migrations.schema_migrations: 1';` и `exit 1`.

- [ ] **Step 8: Если сборка в Step 7 упала из-за env на prerender** (страница вызывает `runtimeConfig()`
при статической генерации) — сделать эту страницу динамической (`await connection()` из `next/server`,
см. `node_modules/next/dist/docs/01-app/02-guides/environment-variables.md`) и повторить Step 7.

- [ ] **Step 9: Commit**

```bash
git add Dockerfile .dockerignore docker/ .github/scripts/image-smoke.sh tests/unit/deploy-pins.test.ts
git commit -m "Single-version image with an explicit migrate command

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Проверка схемы при старте (`serve`, `status`)

**Files:**
- Create: `docker/check-schema.mjs`
- Modify: `docker/entrypoint.sh`, `.github/scripts/image-smoke.sh`

**Interfaces:**
- Consumes: `resolveSupabaseEnv` (Task 1), `migrationVersions`/`compareVersions`/`explain` (Task 5),
  RPC `schema_migration_versions()` (Task 4).
- Produces: `node /app/docker/check-schema.mjs [--report]` → exit 0, 78 или 1.

- [ ] **Step 1: Сценарии в `image-smoke.sh`** (до появления проверки они падают)

Перед блоком `# --- migrate ---` вставить:

```bash
# --- startup check on an empty database -------------------------------------------
run serve-empty -- serve
expect_run serve-empty 78 "Run the migration explicitly: docker compose run --rm migrate" "app refuses to start on an empty database (exit 78)"

run serve-down -e SUPABASE_URL=http://nowhere.invalid:8000 -e SCHEMA_CHECK_WAIT_SECONDS=3 -- serve
expect_run serve-down 1 "did not answer within 3s" "unreachable Supabase: waits, then a clear message (exit 1)"

run serve-badkey -e SUPABASE_SERVICE_ROLE_KEY=wrong -- serve
expect_run serve-badkey 1 "HTTP 401" "wrong service-role key fails at once (exit 1)"
```

На место строки-маркера `# --- (Task 7 inserts the startup-check scenarios on a matching schema here) ---`
(после `again`, база ровно `$ALL`) вставить:

```bash
run status -- status
expect_run status 0 "Database schema matches this image." "status reports a matching schema"
docker run -d --name image-smoke-app --network "$NET" -p 13001:3001 \
  -e SUPABASE_URL="http://supabase_kong_$PID:8000" -e APP_URL=http://localhost:3001 \
  -e SUPABASE_ANON_KEY -e SUPABASE_SERVICE_ROLE_KEY "$IMAGE" serve >/dev/null
version=""; for _ in $(seq 60); do
  version="$(curl -fsS http://localhost:13001/api/health 2>/dev/null | node -pe 'JSON.parse(require("fs").readFileSync(0)).version' 2>/dev/null || true)"
  [[ -n "$version" ]] && break; sleep 1
done
docker logs image-smoke-app > "$OUT/serve-ok.log" 2>&1; docker rm -f image-smoke-app >/dev/null
expect_eq "$version" "$EXPECTED_VERSION" "app starts on a matching schema and reports its version"
```

Сразу после этого блока, до lock-сценария (миграция 990 превратила бы `pending` в `diverged`):

```bash
run serve-newer -v "$(variant newer2 1):/app/supabase/migrations:ro" -- serve
expect_run serve-newer 78 "./upgrade.sh --rollback" "an older image refuses to start on a newer schema (exit 78)"
run serve-pending -v "$(variant pending 0 993_pending.sql "select 1;"):/app/supabase/migrations:ro" -- serve
expect_run serve-pending 78 "Pending migrations: 993" "a newer image refuses to start before migrate (exit 78)"
```

Run: `docker build -t supabase-helpdesk:ci --build-arg HELPDESK_VERSION=local . && bash .github/scripts/image-smoke.sh`
Expected: новые сценарии ❌ (`serve` пока стартует без проверки), exit 1

- [ ] **Step 2: `docker/check-schema.mjs`**

```js
// Startup schema check — `serve` runs it before the server, `status` with
// --report. The app starts only when the database has exactly the migrations
// shipped in this image; otherwise it stops with what to do. Nothing is ever
// migrated here: that is the explicit `migrate` command.
// Exit: 0 match (always 0 with --report when Supabase answered), 78 mismatch,
//       1 configuration error or Supabase unreachable.
import { readdirSync } from 'node:fs';
import { resolveSupabaseEnv } from './lib/env.mjs';
import { compareVersions, explain, migrationVersions } from './lib/versions.mjs';

const EXIT_MISMATCH = 78;
const report = process.argv.includes('--report');
const waitSeconds = Number(process.env.SCHEMA_CHECK_WAIT_SECONDS ?? 60);
const log = (message) => console.error(`[schema-check] ${message}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One RPC attempt: ok | missing (no function: empty or pre-003 schema) | retry | fatal. */
async function attempt(url, key) {
  try {
    const res = await fetch(`${url}/rest/v1/rpc/schema_migration_versions`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    const body = await res.json().catch(() => null);
    if (res.ok) return { kind: 'ok', versions: body };
    if (body?.code === 'PGRST202') return { kind: 'missing' };
    const detail = `HTTP ${res.status} ${JSON.stringify(body)}`;
    return res.status >= 500 ? { kind: 'retry', detail } : { kind: 'fatal', detail };
  } catch (err) {
    return { kind: 'retry', detail: err instanceof Error ? err.message : String(err) };
  }
}

/** @returns {Promise<string[] | null>} */
async function appliedVersions(url, key) {
  const deadline = Date.now() + waitSeconds * 1000;
  for (;;) {
    const result = await attempt(url, key);
    if (result.kind === 'ok') return result.versions;
    if (result.kind === 'missing') return null;
    if (result.kind === 'fatal') throw new Error(`Supabase rejected the request: ${result.detail}`);
    if (Date.now() >= deadline) throw new Error(`Supabase did not answer within ${waitSeconds}s: ${result.detail}`);
    await sleep(2000);
  }
}

async function main() {
  const env = resolveSupabaseEnv(process.env);
  if (!env.serviceRoleKey) throw new Error('Missing environment variable: SUPABASE_SERVICE_ROLE_KEY');
  const image = migrationVersions(readdirSync('/app/supabase/migrations'));
  const version = process.env.HELPDESK_VERSION ?? 'dev';
  const applied = await appliedVersions(env.serverSupabaseUrl, env.serviceRoleKey);
  if (applied === null) {
    log(`Image ${version} ships migrations ${image.join(', ')}.`);
    log('Cannot read the schema version: the database is empty or older than migration 003.');
    log('Run the migration explicitly: docker compose run --rm migrate');
    return report ? 0 : EXIT_MISMATCH;
  }
  const result = compareVersions(image, applied);
  log(`Image ${version}: ${image.join(', ')} | database: ${applied.join(', ') || '<empty>'}`);
  for (const line of explain(result).split('\n')) log(line);
  return result.status === 'ok' || report ? 0 : EXIT_MISMATCH;
}

main().then(
  (code) => process.exit(code),
  (err) => { log(err instanceof Error ? err.message : String(err)); process.exit(1); },
);
```

- [ ] **Step 3: `docker/entrypoint.sh`** — заменить ветки:

```sh
  serve)   node /app/docker/check-schema.mjs; exec node /app/server.js ;;
  status)  exec node /app/docker/check-schema.mjs --report ;;
```

и строку usage: `serve | status | migrate [--dry-run] [--backup-confirmed]`.
`set -e` останавливает `serve` с кодом проверки (78 или 1).

- [ ] **Step 4: Пересобрать и прогнать**

Run: `docker build -t supabase-helpdesk:ci --build-arg HELPDESK_VERSION=local . && bash .github/scripts/image-smoke.sh`
Expected: все ✅, exit 0

- [ ] **Step 5: Commit** `git add docker/check-schema.mjs docker/entrypoint.sh .github/scripts/image-smoke.sh && git commit -m "Refuse to start unless the schema matches the image" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

### Task 8: CI — `image`, `image-smoke`, `migration-upgrade` через образ

**Files:**
- Modify: `.github/workflows/ci.yml`, `.github/scripts/migration-upgrade.sh`

**Interfaces:** Consumes: образ (Tasks 6–7), `image-smoke.sh`. Produces: артефакт `image`
(`supabase-helpdesk:ci`, `docker save`), который в плане C использует job `publish`.

- [ ] **Step 1: Job'ы в `ci.yml`** (после `lint`)

```yaml
  image:
    name: Docker image
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      # Writes package-lock.json: the dependency tree resolved for this commit,
      # which the Dockerfile installs with `npm ci`.
      - uses: ./.github/actions/setup
      - name: docker build
        run: |
          docker build -t supabase-helpdesk:ci --build-arg "HELPDESK_VERSION=sha-$GITHUB_SHA" .
          docker save supabase-helpdesk:ci | gzip -1 > "$RUNNER_TEMP/image.tar.gz"
      - uses: actions/upload-artifact@v7
        with:
          name: image
          path: ${{ runner.temp }}/image.tar.gz
          retention-days: 3
          compression-level: 0

  image-smoke:
    name: Image smoke (migrate · startup check)
    needs: image
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: actions/setup-node@v7
        with:
          node-version-file: .nvmrc
      - uses: actions/download-artifact@v8
        with:
          name: image
          path: ${{ runner.temp }}
      - name: docker load
        run: gunzip -c "$RUNNER_TEMP/image.tar.gz" | docker load
      - name: Smoke scenarios
        env:
          IMAGE: supabase-helpdesk:ci
          EXPECTED_VERSION: sha-${{ github.sha }}
        run: bash .github/scripts/image-smoke.sh
      - name: Upload diagnostics
        if: failure()
        uses: ./.github/actions/upload-diagnostics
        with:
          name: diagnostics-image-smoke
          extra-path: ${{ runner.temp }}/image-smoke/out
```

- [ ] **Step 2: `migration-upgrade`.** В job добавить `needs: image` и перед `Upgrade and verify` шаги
  (под тем же `if: steps.detect.outputs.changed == 'true'`): `actions/download-artifact@v8` (`name: image`)
  и `gunzip -c "$RUNNER_TEMP/image.tar.gz" | docker load`.

- [ ] **Step 3: `migration-upgrade.sh` — прод-путь через образ.** В `cmd_verify` заменить блок
  `supabase migration up --local ...` (строки 271–279) на:

```bash
  # The production path: the image's explicit `migrate` command (job `image`;
  # locally: docker build -t supabase-helpdesk:ci .). The CI database is
  # disposable, so the backup is confirmed.
  cp "$ROOT"/supabase/migrations/*.sql "$PROJ/supabase/migrations/"   # for the idempotency re-run below
  local dbc image="${MIGRATE_IMAGE:-supabase-helpdesk:ci}"
  dbc="$(db_container)"
  if MSYS_NO_PATHCONV=1 docker run --rm --network "supabase_network_${dbc#supabase_db_}" \
       -e MIGRATION_DB_URL="postgresql://postgres:postgres@${dbc}:5432/postgres?sslmode=disable" \
       "$image" migrate --backup-confirmed > "$OUT/migrate.log" 2>&1; then
    note "✅ \`migrate\` ($image) applied: $(paste -sd ' ' "$WORK/new-migrations")"
  else
    cat "$OUT/migrate.log"
    error "migrate failed (see migrate.log in the diagnostics artifact)"
    note "❌ \`migrate\` failed:"; note '```'; tail -n 30 "$OUT/migrate.log" >> "$SUMMARY"; note '```'
    return 1
  fi
```

  В шапке скрипта шаг 3 описать как «`migrate` из образа (как в проде)», в `local` — добавить строку
  `docker build -t supabase-helpdesk:ci .` перед запуском.

- [ ] **Step 4: `ci-result`** → `needs: [lint, db, e2e, cross-browser, migration-upgrade, image, image-smoke]`.

- [ ] **Step 5: Локальная проверка migration-upgrade**

Run: `docker build -t supabase-helpdesk:ci . && BASE=main bash .github/scripts/migration-upgrade.sh local`
Expected: summary, все ✅. Новые миграции: `002`, `003`. `test:db` проходит на обновлённой БД,
включая 035 на старых default privileges.

- [ ] **Step 6: Commit и push, проверить CI**

```bash
git add .github/workflows/ci.yml .github/scripts/migration-upgrade.sh
git commit -m "CI: build the image once, smoke it, run migration-upgrade through it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin feat/deploy-artifact
```

  Push выполнять только после подтверждения пользователя. В PR проверить: все job'ы зелёные,
  `ci-result` ждёт `image` и `image-smoke`. Записать в описание PR длительность `image` и сравнить
  с самым длинным шардом e2e.

---

## Проверка плана A целиком
- `npm run lint && npm run typecheck && npm run test:unit && npm run test:db` — зелёные.
- `docker build` на чистом клоне после `npm install`. `image-smoke.sh` и
  `migration-upgrade.sh local` — зелёные.
- Ручная проверка: `docker run` с `SUPABASE_URL` не задан и `SUPABASE_INTERNAL_URL=http://kong:8000`
  против локального стека даёт в `/runtime-config.js` `supabaseUrl` = `APP_URL`, а в `serve.log`
  нет ошибок конфигурации. Сквозной путь полного стека через прокси проверяет `bundle-e2e` в плане B.
- PR зелёный, `ci-result` агрегирует новые job'ы.

---

