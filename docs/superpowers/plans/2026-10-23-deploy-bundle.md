# Plan B: deploy bundle (compose, upgrade.sh, init-env, admin, scheduler, bundle-e2e)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Оператор (клиент или наш CD) ставит и обновляет HelpDesk из одного каталога `deploy/`.
Работают оба режима Supabase. Обновление — один скрипт `upgrade.sh`: явная миграция, снимок БД
и `--rollback`. Весь путь проверяет CI-job `bundle-e2e`.

**Architecture:**
- **Каталог `deploy/`.** `compose.yaml` — общие сервисы (`app`, `scheduler`, `migrate`, `proxy`).
  `proxy` (Caddy) — всегда внутренний маршрутизатор одного домена. Внешний вход и TLS делает он сам
  (`--edge caddy`) или прокси оператора (`--edge own`, пример для Traefik в `examples/traefik.yml`).
  `compose.bundled.yaml` подключает через `include` официальный Supabase, неизменный в
  `deploy/supabase/`, и наш `supabase.override.yml`. Режим выбирает `COMPOSE_FILE` в `.env`.
- **Новые команды образа.** `scheduler`, `init-env`, `admin`. Их логика — чистые модули в
  `src/lib/deploy/*.mjs` с unit-тестами.
- **`upgrade.sh`** — bash. Его решения проверяются тестами на заглушке `docker`, сквозной путь —
  `bundle-e2e` на живом стеке.

**Tech Stack:** Docker Compose v2.24+ (`include`, `!reset`), Supabase self-hosted `self-hosted/v0.8.3`
(Envoy gateway, Postgres 17), Caddy 2, bash, Node 24 ESM, Vitest 4, Playwright, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-22-deployment-design.md` (разделы «Бэкап и откат» и
«План B: уточнения»).

**Ветка:** `feat/deploy-bundle` от `ci/refactor-green-fast`.

## Global Constraints
- Supabase: тег `self-hosted/v0.8.3` в `deploy/supabase/`. Это неизменная копия `docker/` без `tests/`
  и `dev/` плюс файл `VENDORED` (`ref=`, `sha=`). Наши правки только в `deploy/compose*.yaml`,
  `deploy/supabase.override.yml`, `deploy/Caddyfile`.
- Режимы задаются в `.env`:
  - bundled: `COMPOSE_FILE=compose.yaml:compose.bundled.yaml`, `SUPABASE_URL` пуст;
  - external: `COMPOSE_FILE=compose.yaml`, `SUPABASE_URL` задан.
- Bundled:
  - сервер ходит на `SUPABASE_INTERNAL_URL=http://api-gw:8000`;
  - `SUPABASE_PUBLIC_URL=SITE_URL=APP_URL`, `API_EXTERNAL_URL=${APP_URL}/auth/v1`;
  - `API_GW_HTTP_PORT=127.0.0.1:8000`, порты `supavisor` сброшены;
  - `MIGRATION_DB_URL=postgresql://postgres:${POSTGRES_PASSWORD}@db:5432/postgres?sslmode=disable`.
- `proxy` (Caddy) всегда запущен и маршрутизирует `/auth/v1 /rest/v1 /storage/v1 /realtime/v1 /functions/v1 /graphql/v1`
  на `api-gw:8000`, остальное — на `app:3001`. Режимы внешнего входа (`init-env --edge`):
  - `caddy` (по умолчанию): `SITE_ADDRESS` = хост из `APP_URL` (https) или `:80`, порты 80/443;
  - `own`: `SITE_ADDRESS=:80`, `PROXY_HTTP_PORT=127.0.0.1:8080`, `PROXY_HTTPS_PORT=127.0.0.1:8443`.
- Образ: `${HELPDESK_IMAGE:-ghcr.io/surveyjs/supabase-helpdesk}:${HELPDESK_VERSION}`. Версию в
  `/api/health` задаёт образ (`ENV HELPDESK_VERSION`), а `HELPDESK_VERSION` в `.env` — его тег.
  У релиза они совпадают.
- Ключи: HS256, `{role, iss:"supabase", iat, exp: iat+5 лет}`, подпись `JWT_SECRET`, как в
  `utils/generate-keys.sh`.
- Команды образа: `serve | status | migrate [--dry-run] [--backup-confirmed] | scheduler |
  init-env --mode bundled|external --app-url URL [--edge caddy|own] [--version V] | admin create|reset-password --email EMAIL`;
  неизвестная команда — exit 64.
- Scheduler: `POST /api/cron/notifications` каждые 60 с и `POST /api/cron/sla` каждые 300 с,
  `Authorization: Bearer ${CRON_SECRET}`, цель `APP_INTERNAL_URL` (по умолчанию `http://app:3001`).
- `upgrade.sh`, коды выхода:
  - 0 — готово;
  - 1 — ошибка, ничего не изменено;
  - 2 — pending-миграции не подтверждены, ничего не изменено;
  - 3 — сбой, схема прежняя, прежняя версия снова запущена;
  - 4 — сбой после изменения схемы, всё остановлено.
- Снимок: `backups/db-<prev>-<UTC>.tar.gz` из `supabase/volumes/db/data`, контейнер `alpine:3.22`,
  стек остановлен, хранятся 3 последних. Именованный том `db-config` не трогается.
- Ответ на Next.js: перед кодом Next читать `node_modules/next/dist/docs/` (AGENTS.md).
- tsc target < ES2018: в `.ts` нельзя флаг регулярки `/s` (используйте `[\s\S]`).
- `*.sh` и все файлы `deploy/**` — LF.
- Коммиты оканчиваются `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus
1. **Оператор запустил `docker compose up -d` до `migrate` на новой установке.** Ожидаемо: `app`
   пишет «Run the migration explicitly», после `migrate` и рестарта работает. Проверка в
   `bundle-e2e` (Task 5).
2. **`upgrade.sh` без терминала и без `--migrate` при pending-миграциях.** Ожидаемо: exit 2, файлы
   бандла и версия прежние, ничего не остановлено. Тест на заглушке (Task 6) и `bundle-e2e` (Task 6).
3. **Снимок не удался (диск, права).** Ожидаемо: миграция не запускается, прежняя версия поднята,
   exit 3. Тест на заглушке (Task 6).
4. **Бандл не той версии (`--bundle` от 1.1.0, а просили 1.2.0).** Ожидаемо: exit 1 до любых
   изменений. Тест на заглушке (Task 6).
5. **`upgrade.sh` запущен из другого каталога, с относительным `--bundle`.** Ожидаемо: работает с
   каталогом скрипта, путь к бандлу считается от каталога вызова. Тесты на заглушке запускают
   скрипт из соседнего каталога (Task 6).

## Карта файлов

| Файл | Ответственность |
|---|---|
| `deploy/scripts/vendor-supabase.sh` | Копирует `docker/` Supabase по тегу в `deploy/supabase/` |
| `deploy/supabase/**` (vendored) | Официальный стек, без правок |
| `src/lib/deploy/scheduler.mjs`, `docker/scheduler.mjs` | Расписание cron-эндпоинтов |
| `supabase/migrations/004_sla_cron_to_scheduler.sql` | Снимает pg_cron-задачу `check-sla-timers` |
| `src/lib/deploy/init-env.mjs`, `docker/init-env.mjs` | Генерация `.env` для двух режимов |
| `src/lib/deploy/admin.mjs`, `docker/admin.mjs` | Первый админ и восстановление доступа |
| `docker/entrypoint.sh`, `Dockerfile`, `.dockerignore` | Новые команды; `supabase.env.example` в образе |
| `deploy/compose.yaml`, `deploy/compose.bundled.yaml`, `deploy/supabase.override.yml`, `deploy/Caddyfile` | Состав и режимы |
| `deploy/examples/traefik.yml` | Пример: Traefik оператора перед `proxy` |
| `deploy/README.md` | Руководство оператора |
| `deploy/scripts/pack-bundle.sh` | Бандл версии (`VERSION` + файлы) |
| `deploy/upgrade.sh`, `deploy/tests/stub-docker`, `deploy/tests/upgrade.test.sh` | Обновление и откат; тесты логики |
| `.github/scripts/bundle-e2e.sh`, `tests/bundle/*` | Сквозной тест бандла |
| `.github/workflows/ci.yml` | Job `bundle-e2e`, шаг тестов `upgrade.sh` |

---

### Task 0: Ветка и план (контроллер)

- [ ] `git switch -c feat/deploy-bundle ci/refactor-green-fast`; коммит этого плана и обновлённой спецификации.

---

### Task 1: Вендоринг официального Supabase

**Files:**
- Create: `deploy/scripts/vendor-supabase.sh`, `deploy/supabase/**` (результат скрипта), `tests/unit/vendored-supabase.test.ts`
- Modify: `.gitattributes`, `.gitignore`

**Interfaces:** Produces: `deploy/supabase/docker-compose.yml` с сервисами `studio, api-gw, auth, rest,
realtime, storage, imgproxy, meta, functions, db, supavisor`; `deploy/supabase/.env.example`;
`deploy/supabase/VENDORED`.

- [ ] **Step 1: Тест** `tests/unit/vendored-supabase.test.ts`

```ts
import { existsSync, readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const DIR = 'deploy/supabase';
// Created by the containers at runtime (gitignored upstream).
const RUNTIME = ['volumes/db/data', 'volumes/storage', 'volumes/snippets'];

describe('vendored Supabase self-hosted setup', () => {
  it('is pinned to the release tag the bundle is tested with', () => {
    expect(readFileSync(`${DIR}/VENDORED`, 'utf8')).toMatch(/^ref=self-hosted\/v0\.8\.3$/m);
  });

  it('has every file its docker-compose.yml mounts', () => {
    const compose = readFileSync(`${DIR}/docker-compose.yml`, 'utf8');
    const mounts = [...compose.matchAll(/^\s+- \.\/(volumes\/[^:]+):/gm)].map((m) => m[1]);
    expect(mounts.length).toBeGreaterThan(5);
    for (const path of mounts.filter((p) => !RUNTIME.includes(p))) {
      expect(existsSync(`${DIR}/${path}`), path).toBe(true);
    }
  });

  it("keeps LF line endings (Envoy's entrypoint breaks on CRLF)", () => {
    expect(readFileSync(`${DIR}/volumes/api/envoy/docker-entrypoint.sh`, 'utf8')).not.toContain('\r');
  });
});
```

Run: `npx vitest run --config vitest.config.ts tests/unit/vendored-supabase.test.ts` → FAIL (нет файлов)

- [ ] **Step 2: `deploy/scripts/vendor-supabase.sh`**

```bash
#!/usr/bin/env bash
# Vendors Supabase's official self-hosted Docker setup (github.com/supabase/
# supabase, docker/) at a release tag into deploy/supabase/, unmodified: our
# changes live in deploy/compose.bundled.yaml and deploy/supabase.override.yml,
# so moving to a newer tag is a plain re-run plus review of the diff.
#   bash deploy/scripts/vendor-supabase.sh self-hosted/v0.8.3
set -euo pipefail
TAG="${1:?usage: vendor-supabase.sh <self-hosted/vX.Y.Z>}"
ROOT="$(git rev-parse --show-toplevel)"
DEST="$ROOT/deploy/supabase"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

git clone --quiet --depth 1 --branch "$TAG" --filter=blob:none --sparse \
  https://github.com/supabase/supabase "$TMP/repo"
git -C "$TMP/repo" sparse-checkout set docker
sha="$(git -C "$TMP/repo" rev-parse HEAD)"

rm -rf "$DEST"
mkdir -p "$DEST"
# tests/ and dev/ are upstream's own CI and dev mail server — not part of an install.
tar -C "$TMP/repo/docker" --exclude=./tests --exclude=./dev -cf - . | tar -xf - -C "$DEST"
# Not .supabase-version: upstream's .gitignore ignores that name.
printf 'ref=%s\nsha=%s\n' "$TAG" "$sha" > "$DEST/VENDORED"
echo "Vendored $TAG ($sha) into deploy/supabase"
```

- [ ] **Step 3: Line endings and ignores.**
  - В корневой `.gitattributes` добавить строку
    `deploy/** text=auto eol=lf` с комментарием `# The deploy bundle runs on Linux hosts; Envoy's entrypoint breaks on CRLF.`
  - В `.gitignore` добавить `/deploy/backups/`, `/deploy/.upgrade-state`.

- [ ] **Step 4: Завендорить**

Run: `bash deploy/scripts/vendor-supabase.sh self-hosted/v0.8.3 && git add --renormalize deploy && git status --short deploy | head`
Expected: `deploy/supabase/` содержит `docker-compose.yml`, `.env.example`, `volumes/...`, `VENDORED`.
Внутри `deploy/supabase/` должен оказаться и upstream-овский `.gitignore`, исключающий `volumes/db/data`, `.env`, `backups`.

- [ ] **Step 5: Run тест** → PASS (3). `npm run test:unit` → PASS.

- [ ] **Step 6: Commit**

```bash
git add .gitattributes .gitignore deploy/scripts/vendor-supabase.sh deploy/supabase tests/unit/vendored-supabase.test.ts
git commit -m "Vendor Supabase's self-hosted Docker setup at self-hosted/v0.8.3

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `scheduler` и миграция 004

**Files:**
- Create: `src/lib/deploy/scheduler.mjs`, `src/lib/deploy/scheduler.test.ts`, `docker/scheduler.mjs`,
  `supabase/migrations/004_sla_cron_to_scheduler.sql`
- Modify: `docker/entrypoint.sh`

**Interfaces:** Produces: `JOBS`, `dueJobs(nowMs, lastRun: Map<string, number>, jobs?)`,
`runJob(job, { baseUrl, secret, fetchImpl? }) → Promise<string>`; команда образа `scheduler`.

- [ ] **Step 1: Тест** `src/lib/deploy/scheduler.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import { JOBS, dueJobs, runJob } from './scheduler.mjs';

describe('dueJobs', () => {
  it('runs every job on the first tick', () => {
    expect(dueJobs(0, new Map()).map((j) => j.path)).toEqual(['/api/cron/notifications', '/api/cron/sla']);
  });

  it('runs notifications every 60 s and SLA checks every 300 s', () => {
    const last = new Map([['/api/cron/notifications', 0], ['/api/cron/sla', 0]]);
    expect(dueJobs(59_000, last)).toEqual([]);
    expect(dueJobs(60_000, last).map((j) => j.path)).toEqual(['/api/cron/notifications']);
    expect(dueJobs(300_000, last).map((j) => j.path)).toEqual(['/api/cron/notifications', '/api/cron/sla']);
  });
});

describe('runJob', () => {
  it('POSTs with the cron secret and reports the status', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    expect(await runJob(JOBS[0], { baseUrl: 'http://app:3001', secret: 's3', fetchImpl })).toBe('/api/cron/notifications -> HTTP 200');
    expect(fetchImpl).toHaveBeenCalledWith('http://app:3001/api/cron/notifications', expect.objectContaining({
      method: 'POST', headers: { Authorization: 'Bearer s3' },
    }));
  });

  it('never throws: a network error becomes a log line', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('connect ECONNREFUSED'); });
    expect(await runJob(JOBS[1], { baseUrl: 'http://app:3001', secret: 's3', fetchImpl }))
      .toBe('/api/cron/sla failed: connect ECONNREFUSED');
  });
});
```

Run: `npx vitest run --config vitest.config.ts src/lib/deploy/scheduler.test.ts` → FAIL (нет модуля)

- [ ] **Step 2: `src/lib/deploy/scheduler.mjs`**

```js
// Calls the app's cron endpoints on a fixed schedule — the image's `scheduler`
// command (docker/scheduler.mjs). The same in both Supabase modes, unlike the
// pg_cron job in 001, which needed database-side settings nobody sets (004).

export const JOBS = [
  { path: '/api/cron/notifications', everySeconds: 60 },
  { path: '/api/cron/sla', everySeconds: 300 },
];

/**
 * @param {number} now ms
 * @param {Map<string, number>} lastRun ms of the last run, keyed by path
 */
export function dueJobs(now, lastRun, jobs = JOBS) {
  return jobs.filter((job) => now - (lastRun.get(job.path) ?? -Infinity) >= job.everySeconds * 1000);
}

/**
 * POST one job. Resolves to a log line; never throws.
 * @param {{ path: string }} job
 * @param {{ baseUrl: string, secret: string, fetchImpl?: typeof fetch }} options
 */
export async function runJob(job, { baseUrl, secret, fetchImpl = fetch }) {
  try {
    const res = await fetchImpl(`${baseUrl}${job.path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(55_000),
    });
    return `${job.path} -> HTTP ${res.status}`;
  } catch (err) {
    return `${job.path} failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}
```

Тест вызывает `fetchImpl` с `signal` внутри объекта, `expect.objectContaining` это допускает.
Run тест → PASS (4).

- [ ] **Step 3: `docker/scheduler.mjs`**

```js
// `scheduler` command: calls the app's cron endpoints (src/lib/deploy/scheduler.mjs).
import { JOBS, dueJobs, runJob } from './lib/scheduler.mjs';

const baseUrl = (process.env.APP_INTERNAL_URL ?? 'http://app:3001').replace(/\/+$/, '');
const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error('[scheduler] CRON_SECRET is required');
  process.exit(1);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

console.log(`[scheduler] ${baseUrl}: ${JOBS.map((j) => `${j.path} every ${j.everySeconds}s`).join(', ')}`);
const lastRun = new Map();
for (;;) {
  const now = Date.now();
  for (const job of dueJobs(now, lastRun)) {
    lastRun.set(job.path, now);
    console.log(`[scheduler] ${await runJob(job, { baseUrl, secret })}`);
  }
  await sleep(10_000);
}
```

- [ ] **Step 4: `docker/entrypoint.sh`** — добавить ветку перед `*)`:
  `  scheduler) exec node /app/docker/scheduler.mjs ;;` и в usage — `| scheduler`
  (`serve | status | migrate [--dry-run] [--backup-confirmed] | scheduler`).

- [ ] **Step 5: Миграция** `supabase/migrations/004_sla_cron_to_scheduler.sql`

```sql
-- ============================================================
-- 004 — SLA checks move from pg_cron to the image's scheduler
-- ============================================================
-- 001 schedules `check-sla-timers` (only where pg_cron exists) to POST
-- /api/cron/sla using app.settings.base_url / app.settings.cron_secret, which
-- nothing sets. The image's `scheduler` command now calls the cron endpoints in
-- every deployment mode. Re-runnable: unschedules only an existing job. The
-- nested IF keeps cron.job unparsed where pg_cron is absent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'check-sla-timers') THEN
      PERFORM cron.unschedule('check-sla-timers');
    END IF;
  END IF;
END
$$;
```

Run: `npm run supabase -- migration up --local && docker exec -i supabase_db_helpdesk psql -U postgres -v ON_ERROR_STOP=1 < supabase/migrations/004_sla_cron_to_scheduler.sql && npm run test:db`
Expected: exit 0 (повтор идемпотентен), `test:db` PASS (035 теперь ждёт 001–004).

- [ ] **Step 6: Образ.** `docker build -t supabase-helpdesk:ci --build-arg HELPDESK_VERSION=local . && docker run --rm -e CRON_SECRET=x -e APP_INTERNAL_URL=http://127.0.0.1:9 supabase-helpdesk:ci scheduler & sleep 5; docker ps -q --filter ancestor=supabase-helpdesk:ci | xargs -r docker rm -f`
Expected: в выводе `[scheduler] http://127.0.0.1:9: ...` и две строки `... failed: ...`.

- [ ] **Step 7: Commit** — `git add src/lib/deploy/scheduler.mjs src/lib/deploy/scheduler.test.ts docker/scheduler.mjs docker/entrypoint.sh supabase/migrations/004_sla_cron_to_scheduler.sql && git commit -m "Scheduler command for the cron endpoints; drop the pg_cron SLA job" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

### Task 3: `init-env`

**Files:**
- Create: `src/lib/deploy/init-env.mjs`, `src/lib/deploy/init-env.test.ts`, `docker/init-env.mjs`
- Modify: `docker/entrypoint.sh`, `Dockerfile`, `.dockerignore`

**Interfaces:**
- Consumes: `deploy/supabase/.env.example` (Task 1).
- Produces: `signApiKey(role, secret, nowSeconds) → string`, `generateSupabaseSecrets(rand?, nowSeconds?) → Record<string,string>`,
  `renderEnv({ mode, appUrl, version, edge?, supabaseEnvExample?, rand?, nowSeconds? }) → string`
  (`edge`: `'caddy'` по умолчанию или `'own'`); команда
  `init-env --mode bundled|external --app-url URL [--edge caddy|own] [--version V]` (stdout — содержимое `.env`).

- [ ] **Step 1: Тест** `src/lib/deploy/init-env.test.ts`

```ts
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { generateSupabaseSecrets, renderEnv, signApiKey } from './init-env.mjs';

const example = readFileSync('deploy/supabase/.env.example', 'utf8');
const env = (text: string) => Object.fromEntries(
  text.split('\n').filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const claims = (jwt: string) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());

describe('signApiKey', () => {
  it('signs an HS256 JWT like Supabase generate-keys.sh', () => {
    const jwt = signApiKey('anon', 'secret', 1_000);
    const [h, p, s] = jwt.split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(claims(jwt)).toEqual({ role: 'anon', iss: 'supabase', iat: 1_000, exp: 1_000 + 5 * 365 * 24 * 3600 });
    expect(s).toBe(createHmac('sha256', 'secret').update(`${h}.${p}`).digest('base64url'));
  });
});

describe('generateSupabaseSecrets', () => {
  it('meets the length rules of the Supabase services', () => {
    const s = generateSupabaseSecrets();
    expect(s.REALTIME_DB_ENC_KEY).toHaveLength(16);
    expect(s.VAULT_ENC_KEY).toHaveLength(32);
    expect(s.SECRET_KEY_BASE.length).toBeGreaterThanOrEqual(64);
    expect(s.JWT_SECRET.length).toBeGreaterThanOrEqual(32);
    expect(s.POSTGRES_PASSWORD).toMatch(/^[0-9a-f]{32}$/); // URL-safe inside MIGRATION_DB_URL
  });
});

describe('renderEnv bundled', () => {
  const text = renderEnv({ mode: 'bundled', appUrl: 'https://help.example.com/', version: '1.2.0', supabaseEnvExample: example });
  const e = env(text);

  it('selects the bundled stack', () => {
    expect(e.COMPOSE_FILE).toBe('compose.yaml:compose.bundled.yaml');
    expect(e.HELPDESK_VERSION).toBe('1.2.0');
    expect(e.SUPABASE_URL).toBe('');
  });

  it('serves Supabase on the app domain', () => {
    expect(e.APP_URL).toBe('https://help.example.com');
    expect(e.SUPABASE_PUBLIC_URL).toBe('https://help.example.com');
    expect(e.SITE_URL).toBe('https://help.example.com');
    expect(e.API_EXTERNAL_URL).toBe('https://help.example.com/auth/v1');
    expect(e.API_GW_HTTP_PORT).toBe('127.0.0.1:8000');
    expect(e.SITE_ADDRESS).toBe('help.example.com');
  });

  it('replaces every demo secret and signs the keys with the generated JWT secret', () => {
    expect(text).not.toMatch(/your-super-secret|this_password_is_insecure|supabase-demo/);
    expect(claims(e.ANON_KEY).role).toBe('anon');
    expect(claims(e.SERVICE_ROLE_KEY).role).toBe('service_role');
    const [h, p, s] = e.ANON_KEY.split('.');
    expect(s).toBe(createHmac('sha256', e.JWT_SECRET).update(`${h}.${p}`).digest('base64url'));
  });

  it('keeps one value per variable and every variable of the upstream example', () => {
    const names = text.split('\n').filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => l.slice(0, l.indexOf('=')));
    expect(new Set(names).size).toBe(names.length);
    for (const name of Object.keys(env(example))) expect(names, name).toContain(name);
  });

  it('generates the HelpDesk secrets', () => {
    expect(e.CRON_SECRET).toMatch(/^[0-9a-f]{64}$/);
    expect(e.INBOUND_EMAIL_WEBHOOK_SECRET).toMatch(/^[0-9a-f]{64}$/);
  });

  it('lets Caddy take the public ports and the certificate by default', () => {
    expect(e.PROXY_HTTP_PORT).toBe('80');
    expect(e.PROXY_HTTPS_PORT).toBe('443');
  });

  it('serves plain HTTP on the port of an http APP_URL', () => {
    const e2 = env(renderEnv({ mode: 'bundled', appUrl: 'http://localhost:8080', version: 'x', supabaseEnvExample: example }));
    expect(e2.SITE_ADDRESS).toBe(':80');
    expect(e2.PROXY_HTTP_PORT).toBe('8080');
  });

  it('with --edge own, leaves TLS to your proxy and listens on localhost only', () => {
    const e3 = env(renderEnv({ mode: 'bundled', appUrl: 'https://help.example.com', version: 'x', edge: 'own', supabaseEnvExample: example }));
    expect(e3.SITE_ADDRESS).toBe(':80');
    expect(e3.PROXY_HTTP_PORT).toBe('127.0.0.1:8080');
    expect(e3.PROXY_HTTPS_PORT).toBe('127.0.0.1:8443');
  });

  it('rejects an unknown edge', () => {
    expect(() => renderEnv({ mode: 'bundled', appUrl: 'https://h.example.com', version: 'x', edge: 'nginx', supabaseEnvExample: example }))
      .toThrow(/edge/);
  });

  it('fails loudly if the upstream example lacks a variable it must set', () => {
    expect(() => renderEnv({ mode: 'bundled', appUrl: 'https://h.example.com', version: 'x', supabaseEnvExample: 'FOO=1\n' }))
      .toThrow(/POSTGRES_PASSWORD/);
  });
});

describe('renderEnv external', () => {
  const e = env(renderEnv({ mode: 'external', appUrl: 'https://help.example.com', version: '1.2.0' }));

  it('selects the external mode and leaves the Supabase settings to fill in', () => {
    expect(e.COMPOSE_FILE).toBe('compose.yaml');
    expect(e.SUPABASE_URL).toBe('');
    expect(e.SUPABASE_ANON_KEY).toBe('');
    expect(e.SUPABASE_SERVICE_ROLE_KEY).toBe('');
    expect(e.MIGRATION_DB_URL).toBe('');
    expect(e.POSTGRES_PASSWORD).toBeUndefined();
  });
});
```

Run → FAIL (нет модуля).

- [ ] **Step 2: `src/lib/deploy/init-env.mjs`**

```js
// `init-env`: the .env of a new installation (docker/init-env.mjs). Bundled
// mode starts from Supabase's own .env.example (shipped in the image) and fills
// in fresh secrets the way its utils/generate-keys.sh does; external mode lists
// only HelpDesk's settings.
import { createHmac, randomBytes } from 'node:crypto';

const b64url = (value) => Buffer.from(value).toString('base64url');
const FIVE_YEARS = 5 * 365 * 24 * 3600;

/** HS256 API key: { role, iss: 'supabase', iat, exp: +5 years }, as generate-keys.sh. */
export function signApiKey(role, secret, nowSeconds) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ role, iss: 'supabase', iat: nowSeconds, exp: nowSeconds + FIVE_YEARS }));
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

/** Secrets of the bundled Supabase stack (lengths as in utils/generate-keys.sh). */
export function generateSupabaseSecrets(rand = randomBytes, nowSeconds = Math.floor(Date.now() / 1000)) {
  const b64 = (n) => rand(n).toString('base64');
  const hex = (n) => rand(n).toString('hex');
  const JWT_SECRET = b64(30);
  return {
    POSTGRES_PASSWORD: hex(16),
    JWT_SECRET,
    ANON_KEY: signApiKey('anon', JWT_SECRET, nowSeconds),
    SERVICE_ROLE_KEY: signApiKey('service_role', JWT_SECRET, nowSeconds),
    DASHBOARD_PASSWORD: hex(16),
    SECRET_KEY_BASE: b64(48),
    REALTIME_DB_ENC_KEY: hex(8),
    VAULT_ENC_KEY: hex(16),
    PG_META_CRYPTO_KEY: b64(24),
    LOGFLARE_PUBLIC_ACCESS_TOKEN: b64(24),
    LOGFLARE_PRIVATE_ACCESS_TOKEN: b64(24),
    S3_PROTOCOL_ACCESS_KEY_ID: hex(16),
    S3_PROTOCOL_ACCESS_KEY_SECRET: hex(32),
    MINIO_ROOT_PASSWORD: hex(16),
  };
}

// Who takes public traffic: the bundled Caddy (TLS for the domain in APP_URL),
// or the operator's own proxy (Traefik, nginx) in front of proxy:80.
function edgeLines(edge, url) {
  if (edge === 'own') {
    return [
      '# Your proxy terminates TLS and forwards everything to proxy:80 (see examples/traefik.yml)',
      '# or to 127.0.0.1:8080 on this host.',
      'SITE_ADDRESS=:80',
      'PROXY_HTTP_PORT=127.0.0.1:8080',
      'PROXY_HTTPS_PORT=127.0.0.1:8443',
    ];
  }
  if (edge !== 'caddy') throw new Error(`Unknown edge "${edge}": use caddy or own`);
  const https = url.protocol === 'https:';
  return [
    '# The bundled Caddy takes ports 80/443 and gets the certificate for APP_URL',
    `SITE_ADDRESS=${https ? url.hostname : ':80'}`,
    `PROXY_HTTP_PORT=${!https && url.port ? url.port : '80'}`,
    'PROXY_HTTPS_PORT=443',
  ];
}

function helpdeskSection({ mode, appUrl, version, edge, rand }) {
  const url = new URL(appUrl);
  const lines = [
    '# ---- HelpDesk (written by init-env) -------------------------------------',
    `COMPOSE_FILE=${mode === 'bundled' ? 'compose.yaml:compose.bundled.yaml' : 'compose.yaml'}`,
    ...edgeLines(edge, url),
    `HELPDESK_VERSION=${version}`,
    `APP_URL=${appUrl}`,
    `CRON_SECRET=${rand(32).toString('hex')}`,
    `INBOUND_EMAIL_WEBHOOK_SECRET=${rand(32).toString('hex')}`,
    '# Optional AI features: AI_PROVIDER, AI_API_KEY, AI_MODEL, AI_CUSTOM_ENDPOINT_URL',
  ];
  if (mode === 'bundled') {
    lines.push('# Empty: Supabase runs in this stack, on APP_URL', 'SUPABASE_URL=');
  } else {
    lines.push(
      '# Your Supabase project (Cloud: Project Settings -> API / Database)',
      'SUPABASE_URL=',
      'SUPABASE_ANON_KEY=',
      'SUPABASE_SERVICE_ROLE_KEY=',
      '# Direct or session-pooler connection string, used only by `migrate`',
      'MIGRATION_DB_URL=',
    );
  }
  return lines.join('\n');
}

/**
 * @param {{ mode: 'bundled'|'external', appUrl: string, version: string, edge?: 'caddy'|'own',
 *   supabaseEnvExample?: string, rand?: (n: number) => Buffer, nowSeconds?: number }} options
 */
export function renderEnv({ mode, appUrl, version, edge = 'caddy', supabaseEnvExample = '', rand = randomBytes, nowSeconds }) {
  const app = appUrl.trim().replace(/\/+$/, '');
  const ours = helpdeskSection({ mode, appUrl: app, version, edge, rand });
  if (mode === 'external') return `${ours}\n`;

  const values = {
    ...generateSupabaseSecrets(rand, nowSeconds),
    SUPABASE_PUBLIC_URL: app,
    API_EXTERNAL_URL: `${app}/auth/v1`,
    SITE_URL: app,
    ADDITIONAL_REDIRECT_URLS: `${app}/**`,
    API_GW_HTTP_PORT: '127.0.0.1:8000',
    POOLER_TENANT_ID: 'helpdesk',
  };
  const lines = supabaseEnvExample.split(/\r?\n/);
  for (const [name, value] of Object.entries(values)) {
    const i = lines.findIndex((l) => l.startsWith(`${name}=`));
    if (i < 0) throw new Error(`Supabase's .env.example has no ${name}= line — re-check deploy/supabase after re-vendoring`);
    lines[i] = `${name}=${value}`;
  }
  // HelpDesk's section sets COMPOSE_FILE.
  const upstream = lines.filter((l) => !l.startsWith('COMPOSE_FILE=')).join('\n');
  return `${ours}\n\n# ---- Supabase (from deploy/supabase/.env.example) -------------------------\n${upstream}\n`;
}
```

Run тест → PASS.

- [ ] **Step 3: `docker/init-env.mjs`**

```js
// `init-env --mode bundled|external --app-url URL [--version V]` prints a new
// .env to stdout (src/lib/deploy/init-env.mjs).
import { readFileSync } from 'node:fs';
import { renderEnv } from './lib/init-env.mjs';

const usage = 'usage: init-env --mode bundled|external --app-url https://help.example.com [--edge caddy|own] [--version X.Y.Z]';
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const mode = opt('--mode');
const appUrl = opt('--app-url');
const version = opt('--version') ?? process.env.HELPDESK_VERSION ?? 'dev';
const edge = opt('--edge') ?? 'caddy';
if (!['bundled', 'external'].includes(mode ?? '') || !appUrl || !['caddy', 'own'].includes(edge)) {
  console.error(usage);
  process.exit(64);
}
try {
  const supabaseEnvExample = mode === 'bundled' ? readFileSync('/app/docker/supabase.env.example', 'utf8') : '';
  process.stdout.write(renderEnv({ mode, appUrl, version, edge, supabaseEnvExample }));
} catch (err) {
  console.error(`[init-env] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
```

- [ ] **Step 4: Образ.**
  - `Dockerfile` (runner, после `COPY src/lib/deploy ./docker/lib`):
    `COPY deploy/supabase/.env.example ./docker/supabase.env.example`.
  - `.dockerignore`: после строки `deploy` добавить `!deploy/supabase/.env.example`.
  - `docker/entrypoint.sh`:
    - ветка `  init-env) exec node /app/docker/init-env.mjs "$@" ;;`;
    - usage `... | scheduler | init-env --mode bundled|external --app-url URL [--edge caddy|own] [--version V]`.

Run: `docker build -t supabase-helpdesk:ci --build-arg HELPDESK_VERSION=local . && docker run --rm supabase-helpdesk:ci init-env --mode bundled --app-url https://help.example.com | grep -E '^(COMPOSE_FILE|HELPDESK_VERSION|API_EXTERNAL_URL)='`
Expected: `COMPOSE_FILE=compose.yaml:compose.bundled.yaml`, `HELPDESK_VERSION=local`, `API_EXTERNAL_URL=https://help.example.com/auth/v1`.
`docker run --rm supabase-helpdesk:ci init-env; echo $?` → usage и `64`.

- [ ] **Step 5: Commit** — `git add src/lib/deploy/init-env.mjs src/lib/deploy/init-env.test.ts docker/init-env.mjs docker/entrypoint.sh Dockerfile .dockerignore && git commit -m "init-env: generate the .env of a new installation" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

### Task 4: `admin create` / `admin reset-password`

**Files:**
- Create: `src/lib/deploy/admin.mjs`, `src/lib/deploy/admin.test.ts`, `docker/admin.mjs`
- Modify: `docker/entrypoint.sh`

**Interfaces:**
- Consumes: `resolveSupabaseEnv` (`serverSupabaseUrl`, `serviceRoleKey`).
- Produces: `generatePassword(rand?) → string` (24 символа base64url);
  `createAdmin({ supabaseUrl, serviceRoleKey, email, password, fetchImpl? }) → Promise<string>` (id);
  `resetPassword({ supabaseUrl, serviceRoleKey, email, password, fetchImpl? }) → Promise<void>`.
- Вывод `admin create`: строка `One-time password: <pw>` — по ней пароль находит bundle-e2e.

- [ ] **Step 1: Тест** `src/lib/deploy/admin.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import { createAdmin, generatePassword, resetPassword } from './admin.mjs';

const base = { supabaseUrl: 'http://api-gw:8000', serviceRoleKey: 'svc', email: 'boss@example.com', password: 'pw' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('createAdmin', () => {
  it('creates a confirmed user, then gives its profile the admin role', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ id: 'u1' }))
      .mockResolvedValueOnce(json([{ id: 'u1', role: 'admin' }]));
    expect(await createAdmin({ ...base, fetchImpl })).toBe('u1');
    const [[url1, init1], [url2, init2]] = fetchImpl.mock.calls;
    expect(url1).toBe('http://api-gw:8000/auth/v1/admin/users');
    expect(JSON.parse(init1.body)).toEqual({ email: 'boss@example.com', password: 'pw', email_confirm: true });
    expect(init1.headers).toMatchObject({ apikey: 'svc', Authorization: 'Bearer svc' });
    expect(url2).toBe('http://api-gw:8000/rest/v1/profiles?id=eq.u1');
    expect(init2.method).toBe('PATCH');
    expect(JSON.parse(init2.body)).toEqual({ role: 'admin' });
  });

  it('reports what Supabase said when the user cannot be created', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json({ msg: 'A user with this email address has already been registered' }, 422));
    await expect(createAdmin({ ...base, fetchImpl })).rejects.toThrow('Creating the user failed: HTTP 422 A user with this email address has already been registered');
  });

  it('fails if no profile got the admin role', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json({ id: 'u1' })).mockResolvedValueOnce(json([]));
    await expect(createAdmin({ ...base, fetchImpl })).rejects.toThrow(/no profile for user u1/);
  });
});

describe('resetPassword', () => {
  it('finds the user by email and sets the new password', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json([{ id: 'u1' }])).mockResolvedValueOnce(json({ id: 'u1' }));
    await resetPassword({ ...base, fetchImpl });
    expect(fetchImpl.mock.calls[0][0]).toBe('http://api-gw:8000/rest/v1/profiles?select=id&email=eq.boss%40example.com');
    expect(fetchImpl.mock.calls[1][0]).toBe('http://api-gw:8000/auth/v1/admin/users/u1');
    expect(fetchImpl.mock.calls[1][1].method).toBe('PUT');
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({ password: 'pw' });
  });

  it('says so when no user has that email', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json([]));
    await expect(resetPassword({ ...base, fetchImpl })).rejects.toThrow('No user with email boss@example.com');
  });
});

describe('generatePassword', () => {
  it('is 24 URL-safe characters', () => {
    expect(generatePassword()).toMatch(/^[A-Za-z0-9_-]{24}$/);
  });
});
```

Run → FAIL.

- [ ] **Step 2: `src/lib/deploy/admin.mjs`**

```js
// `admin create` / `admin reset-password` (docker/admin.mjs): the first
// administrator of a new installation, and access recovery. Talks to Supabase
// over HTTP with the service-role key: GoTrue's admin API creates the user, the
// on_auth_user_created trigger creates its profile, PostgREST sets the role.
import { randomBytes } from 'node:crypto';

export function generatePassword(rand = randomBytes) {
  return rand(18).toString('base64url');
}

async function call(fetchImpl, url, key, init, what) {
  const res = await fetchImpl(url, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...init.headers },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`${what} failed: HTTP ${res.status} ${body?.msg ?? body?.message ?? JSON.stringify(body)}`);
  }
  return body;
}

export async function createAdmin({ supabaseUrl, serviceRoleKey, email, password, fetchImpl = fetch }) {
  const user = await call(fetchImpl, `${supabaseUrl}/auth/v1/admin/users`, serviceRoleKey, {
    method: 'POST',
    body: JSON.stringify({ email, password, email_confirm: true }),
  }, 'Creating the user');
  const updated = await call(fetchImpl, `${supabaseUrl}/rest/v1/profiles?id=eq.${user.id}`, serviceRoleKey, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ role: 'admin' }),
  }, 'Granting the admin role');
  if (!Array.isArray(updated) || updated.length !== 1) {
    throw new Error(`Granting the admin role failed: no profile for user ${user.id}`);
  }
  return user.id;
}

export async function resetPassword({ supabaseUrl, serviceRoleKey, email, password, fetchImpl = fetch }) {
  const rows = await call(fetchImpl, `${supabaseUrl}/rest/v1/profiles?select=id&email=eq.${encodeURIComponent(email)}`,
    serviceRoleKey, { method: 'GET' }, 'Looking up the user');
  if (!Array.isArray(rows) || rows.length === 0) throw new Error(`No user with email ${email}`);
  await call(fetchImpl, `${supabaseUrl}/auth/v1/admin/users/${rows[0].id}`, serviceRoleKey, {
    method: 'PUT',
    body: JSON.stringify({ password }),
  }, 'Setting the password');
}
```

Run тест → PASS.

- [ ] **Step 3: `docker/admin.mjs`**

```js
// `admin create --email E` / `admin reset-password --email E`: prints a one-time
// password for the account (src/lib/deploy/admin.mjs).
import { resolveSupabaseEnv } from './lib/env.mjs';
import { createAdmin, generatePassword, resetPassword } from './lib/admin.mjs';

const usage = 'usage: admin create|reset-password --email EMAIL';
const [action, flag, email] = process.argv.slice(2);
if (!['create', 'reset-password'].includes(action ?? '') || flag !== '--email' || !email) {
  console.error(usage);
  process.exit(64);
}
try {
  const env = resolveSupabaseEnv(process.env);
  if (!env.serviceRoleKey) throw new Error('Missing environment variable: SUPABASE_SERVICE_ROLE_KEY');
  const password = generatePassword();
  const options = { supabaseUrl: env.serverSupabaseUrl, serviceRoleKey: env.serviceRoleKey, email, password };
  if (action === 'create') {
    await createAdmin(options);
    console.log(`Administrator ${email} created.`);
  } else {
    await resetPassword(options);
    console.log(`Password of ${email} reset.`);
  }
  console.log(`One-time password: ${password}`);
  console.log('Sign in and change it on the profile page.');
} catch (err) {
  console.error(`[admin] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
```

- [ ] **Step 4: `docker/entrypoint.sh`**:
  - ветка `  admin) exec node /app/docker/admin.mjs "$@" ;;`;
  - usage
    `serve | status | migrate [--dry-run] [--backup-confirmed] | scheduler | init-env --mode bundled|external --app-url URL [--edge caddy|own] [--version V] | admin create|reset-password --email EMAIL`.

Run: `npm run test:unit` → PASS; `docker build … && docker run --rm supabase-helpdesk:ci admin; echo $?` → usage, `64`.
Живая проверка — в Task 5 (`bundle-e2e`).

- [ ] **Step 5: Commit** — `git add src/lib/deploy/admin.mjs src/lib/deploy/admin.test.ts docker/admin.mjs docker/entrypoint.sh && git commit -m "admin create / reset-password commands" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

### Task 5: Compose-бандл, прокси, руководство и сквозная установка

**Files:**
- Create: `deploy/compose.yaml`, `deploy/compose.bundled.yaml`, `deploy/supabase.override.yml`,
  `deploy/Caddyfile`, `deploy/examples/traefik.yml`, `deploy/README.md`, `deploy/scripts/pack-bundle.sh`,
  `.github/scripts/bundle-e2e.sh`, `tests/bundle/playwright.config.ts`, `tests/bundle/login.spec.ts`
- Modify: `vitest.config.ts` (только если `tests/bundle` попадает в unit-прогон — проверить; не должен)

**Interfaces:**
- Consumes: команды образа (Tasks 2–4), `deploy/supabase/docker-compose.yml` (Task 1).
- Produces:
  - `pack-bundle.sh <version> <out.tgz>`: бандл с файлом `VERSION`;
  - `bundle-e2e.sh` с переменными `IMAGE`, `VERSION`, `DIR`, `OUT`, `APP_URL` и хелперами `pass`, `fail`, `wait_for`,
    `health_version`, `login`, а также строка-маркер для Task 6.

- [ ] **Step 1: Прочитать** <https://docs.docker.com/reference/compose-file/include/> и
  <https://docs.docker.com/reference/compose-file/merge/> (`!reset`), и записать в отчёт минимальную
  версию Compose. Выполнить `docker pull caddy:2-alpine` и закрепить её точный тег
  (`docker image inspect … --format '{{index .RepoDigests 0}}'` и тег вида `2.x.y-alpine` из
  `docker run --rm caddy:2-alpine caddy version`) — подставить в `compose.yaml` ниже вместо `2.10.2-alpine`,
  если версия другая.

- [ ] **Step 2: `deploy/compose.yaml`**

```yaml
# HelpDesk — the services of both Supabase modes. The mode is chosen by
# COMPOSE_FILE in .env (written by `init-env`):
#   bundled:  compose.yaml:compose.bundled.yaml  (Supabase runs here, on APP_URL)
#   external: compose.yaml                       (Supabase Cloud or another server)
# Operator guide: README.md
name: helpdesk

x-image: &image ${HELPDESK_IMAGE:-ghcr.io/surveyjs/supabase-helpdesk}:${HELPDESK_VERSION:?HELPDESK_VERSION is not set in .env}

services:
  app:
    image: *image
    restart: unless-stopped
    init: true
    environment:
      APP_URL: ${APP_URL:?APP_URL is not set in .env}
      SUPABASE_URL: ${SUPABASE_URL:-}
      SUPABASE_ANON_KEY: ${SUPABASE_ANON_KEY:-${ANON_KEY:-}}
      SUPABASE_SERVICE_ROLE_KEY: ${SUPABASE_SERVICE_ROLE_KEY:-${SERVICE_ROLE_KEY:-}}
      CRON_SECRET: ${CRON_SECRET:?CRON_SECRET is not set in .env}
      INBOUND_EMAIL_WEBHOOK_SECRET: ${INBOUND_EMAIL_WEBHOOK_SECRET:-}
      AI_PROVIDER: ${AI_PROVIDER:-}
      AI_API_KEY: ${AI_API_KEY:-}
      AI_MODEL: ${AI_MODEL:-}
      AI_CUSTOM_ENDPOINT_URL: ${AI_CUSTOM_ENDPOINT_URL:-}

  scheduler:
    image: *image
    command: scheduler
    restart: unless-stopped
    init: true
    environment:
      APP_INTERNAL_URL: http://app:3001
      CRON_SECRET: ${CRON_SECRET:?CRON_SECRET is not set in .env}
    depends_on: [app]

  # One-off: docker compose run --rm migrate [--dry-run] [--backup-confirmed]
  migrate:
    image: *image
    command: migrate
    profiles: [tools]
    environment:
      MIGRATION_DB_URL: ${MIGRATION_DB_URL:-}

  # Same-domain router (Caddyfile): Supabase's API paths -> api-gw, the rest -> app.
  # Public entry and TLS: Caddy itself (init-env --edge caddy) or your proxy in
  # front of proxy:80 / 127.0.0.1:8080 (--edge own, examples/traefik.yml).
  proxy:
    image: caddy:2.10.2-alpine
    restart: unless-stopped
    ports:
      - ${PROXY_HTTP_PORT:-80}:80
      - ${PROXY_HTTPS_PORT:-443}:443
    environment:
      SITE_ADDRESS: ${SITE_ADDRESS:-:80}
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    depends_on: [app]

volumes:
  caddy-data:
  caddy-config:
```

- [ ] **Step 3: `deploy/compose.bundled.yaml`**

```yaml
# Bundled mode: Supabase's official self-hosted stack (deploy/supabase/,
# unmodified) plus our overrides, with HelpDesk wired to it.
include:
  - path:
      - supabase/docker-compose.yml
      - supabase.override.yml

services:
  app:
    environment:
      SUPABASE_INTERNAL_URL: http://api-gw:8000
    depends_on:
      api-gw: { condition: service_healthy }
      auth: { condition: service_healthy }
      rest: { condition: service_healthy }

  migrate:
    environment:
      # Postgres in the stack has ssl=off; the hex password from init-env is URL-safe.
      MIGRATION_DB_URL: postgresql://postgres:${POSTGRES_PASSWORD:?}@db:5432/postgres?sslmode=disable
    depends_on:
      db: { condition: service_healthy }
```

- [ ] **Step 4: `deploy/supabase.override.yml`**

```yaml
# Our changes to the vendored Supabase stack (deploy/supabase/ stays pristine).
services:
  # The database is not published on the host: `migrate` reaches db over the
  # compose network. (The gateway binds to 127.0.0.1 via API_GW_HTTP_PORT.)
  supavisor:
    ports: !reset []
```

- [ ] **Step 5: `deploy/Caddyfile`**

```
# Same-domain routing: Supabase's API paths go to its gateway (bundled mode),
# everything else to HelpDesk. With an external Supabase the browser talks to
# SUPABASE_URL directly, so only the app routes are used. SITE_ADDRESS (from
# init-env --edge): the APP_URL domain for automatic HTTPS (caddy), or ":80"
# when your own proxy terminates TLS in front of this one (own).
{$SITE_ADDRESS::80} {
	@supabase path /auth/v1/* /rest/v1/* /storage/v1/* /realtime/v1/* /functions/v1/* /graphql/v1/*
	handle @supabase {
		reverse_proxy api-gw:8000
	}
	handle {
		reverse_proxy app:3001
	}
}
```

- [ ] **Step 5a: `deploy/examples/traefik.yml`** — пример для оператора со своим Traefik
  (docker provider) перед `proxy`. Labels ставятся только на наш сервис `proxy`: сервисы Supabase
  подключены через `include`, и Compose не даёт их дополнять.

```yaml
# Example: your own Traefik (docker provider) in front of HelpDesk instead of
# the bundled Caddy taking ports 80/443. Use with `init-env --edge own`, then
# add this file to COMPOSE_FILE in .env, e.g.
#   COMPOSE_FILE=compose.yaml:compose.bundled.yaml:examples/traefik.yml
# and set APP_HOST (help.example.com), TRAEFIK_NETWORK (the external network
# Traefik watches) and TRAEFIK_CERT_RESOLVER. Traefik terminates TLS and sends
# everything to proxy:80; Caddy keeps routing Supabase's paths on the same domain.
services:
  proxy:
    networks: [default, traefik]
    labels:
      traefik.enable: "true"
      traefik.docker.network: ${TRAEFIK_NETWORK:-traefik}
      traefik.http.routers.helpdesk.rule: Host(`${APP_HOST:?set APP_HOST}`)
      traefik.http.routers.helpdesk.entrypoints: ${TRAEFIK_ENTRYPOINT:-websecure}
      traefik.http.routers.helpdesk.tls.certresolver: ${TRAEFIK_CERT_RESOLVER:-letsencrypt}
      traefik.http.services.helpdesk.loadbalancer.server.port: "80"

networks:
  traefik:
    external: true
    name: ${TRAEFIK_NETWORK:-traefik}
```

- [ ] **Step 6: `deploy/scripts/pack-bundle.sh`**

```bash
#!/usr/bin/env bash
# Packs the operator bundle of a version: deploy/ without development files,
# plus VERSION (upgrade.sh checks it).
#   bash deploy/scripts/pack-bundle.sh <version> <out.tgz>
set -euo pipefail
VERSION="${1:?usage: pack-bundle.sh <version> <out.tgz>}"
OUT="${2:?usage: pack-bundle.sh <version> <out.tgz>}"
ROOT="$(git rev-parse --show-toplevel)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

tar -C "$ROOT/deploy" --exclude=./scripts --exclude=./tests --exclude=./.env \
  --exclude=./backups --exclude=./.upgrade-state \
  --exclude=./supabase/volumes/db/data --exclude=./supabase/volumes/storage \
  -cf - . | tar -xf - -C "$STAGE"
printf '%s\n' "$VERSION" > "$STAGE/VERSION"
mkdir -p "$(dirname "$OUT")"
tar -C "$STAGE" -czf "$OUT" .
echo "$OUT"
```

- [ ] **Step 7: `deploy/README.md`** — руководство оператора, по-английски, разделы:
  1. Requirements: Linux, Docker Engine с Compose v2.24+, порты 80 и 443 для `proxy`.
  2. Install (bundled):
     - `docker run --rm ghcr.io/surveyjs/supabase-helpdesk:X.Y.Z init-env --mode bundled --app-url https://help.example.com --version X.Y.Z > .env`;
     - настроить SMTP (`SMTP_*`, иначе `ENABLE_EMAIL_AUTOCONFIRM=true`);
     - `docker compose run --rm migrate --backup-confirmed` (новая БД, бэкапить нечего);
     - `docker compose up -d`;
     - `docker compose run --rm app admin create --email you@example.com`.
  3. Install (external): `init-env --mode external`, заполнить `SUPABASE_*` и `MIGRATION_DB_URL`
     (прямое подключение или session pooler), дальше те же шаги.
  4. Upgrade: `./upgrade.sh X.Y.Z` (подтверждение, `--migrate` без терминала), коды выхода.
  5. Rollback: `./upgrade.sh --rollback`; во внешнем режиме PITR, затем `--rollback --restored`.
  6. Backups: снимки в `backups/` (3 последних), том `db-config` с ключом Vault —
     никогда не удалять (`docker compose down -v` уничтожит его).
  7. Supabase Studio: `ssh -L 8000:127.0.0.1:8000 host`, логин `DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD` из `.env`.
  8. Your own reverse proxy (Traefik, nginx): `init-env --edge own`.
     - Ваш прокси терминирует TLS и отправляет весь трафик домена на один upstream: `proxy:80` в
       docker-сети (Traefik — `examples/traefik.yml`) или `127.0.0.1:8080` на хосте.
     - Websocket (`/realtime/v1`) нужно пропускать; пример заголовков для nginx — 5 строк.
     - Caddy остаётся внутренним маршрутизатором: путей Supabase ваш прокси не знает.
  9. Если `app` пишет «Run the migration explicitly»: выполнить `migrate`, затем `docker compose restart app`.

- [ ] **Step 8: Playwright-конфиг и спека бандла**

`tests/bundle/playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

// The deploy-bundle smoke (.github/scripts/bundle-e2e.sh): a running installation
// at BASE_URL, no webServer, no seed data.
export default defineConfig({
  testDir: '.',
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: { baseURL: process.env.BASE_URL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
```

`tests/bundle/login.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

// Signs in through the bundled stack: browser -> proxy -> /auth/v1 on the app's
// own domain, session cookie shared by browser and server, admin page reachable.
test('administrator signs in and opens the admin area', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(process.env.ADMIN_EMAIL!);
  await page.getByLabel('Password').fill(process.env.ADMIN_PASSWORD!);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin/);
});
```

Проверить, что `npm run test:unit` (`vitest run src tests/unit`) и `npm run test:e2e` (`testDir: ./tests/e2e`)
не подхватывают `tests/bundle`.

- [ ] **Step 9: `.github/scripts/bundle-e2e.sh`** (установка; обновление добавит Task 6)

```bash
#!/usr/bin/env bash
# End-to-end test of the deploy bundle with the bundled Supabase stack, run the
# way an operator runs it: pack -> init-env -> (app refuses before migrate) ->
# migrate -> up -> admin create -> sign in through the proxy on one domain.
# Task 6 adds upgrade.sh to a next version and --rollback. CI: job bundle-e2e.
# Locally (Linux, or Git Bash + Docker Desktop; needs port 80 and Supabase's
# fixed container names supabase-*, so no other official-compose stack may run):
#   docker build -t supabase-helpdesk:ci --build-arg HELPDESK_VERSION=ci .
#   bash .github/scripts/bundle-e2e.sh
set -euo pipefail
export MSYS_NO_PATHCONV=1

ROOT="$(git rev-parse --show-toplevel)"
IMAGE="${IMAGE:-supabase-helpdesk}"      # repository; the tag is the version
VERSION="${VERSION:-ci}"                  # must equal the image's HELPDESK_VERSION
WORK="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/bundle-e2e"
DIR="$WORK/helpdesk" OUT="$WORK/out"
SUMMARY="${GITHUB_STEP_SUMMARY:-$OUT/summary.md}"
APP_URL=http://localhost
ADMIN_EMAIL=admin@example.com
native_path() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else echo "$1"; fi; }

# Database files from a previous run belong to the container's user.
[[ -d "$WORK" ]] && docker run --rm -v "$(native_path "$WORK"):/w" alpine:3.22 rm -rf /w/helpdesk /w/out
rm -rf "$WORK"; mkdir -p "$DIR" "$OUT"

fails=0
pass() { echo "✅ $1" | tee -a "$SUMMARY"; }
fail() { echo "❌ $1" | tee -a "$SUMMARY"; fails=$((fails + 1)); }
compose() { (cd "$DIR" && docker compose "$@"); }
cleanup() {
  compose logs --no-color > "$OUT/compose.log" 2>&1 || true
  compose --profile tools down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT
wait_for() { # wait_for <description> <seconds> <command...>
  local d="$1" t="$2"; shift 2
  local end=$((SECONDS + t))
  until "$@" >/dev/null 2>&1; do
    (( SECONDS < end )) || { fail "$d (timed out after ${t}s)"; return 1; }
    sleep 3
  done
  pass "$d"
}
health_version() { curl -fsS "$APP_URL/api/health" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p'; }
health_is() { [[ "$(health_version)" == "$1" ]]; }
login() { # login <description>
  if (cd "$ROOT" && BASE_URL="$APP_URL" ADMIN_EMAIL="$ADMIN_EMAIL" ADMIN_PASSWORD="$ADMIN_PASSWORD" \
        npx playwright test --config tests/bundle/playwright.config.ts) > "$OUT/login-$1.log" 2>&1
  then pass "sign-in through the proxy works ($1)"; else fail "sign-in through the proxy fails ($1)"; tail -30 "$OUT/login-$1.log"; fi
}
echo "## Bundle e2e: $IMAGE:$VERSION" >> "$SUMMARY"

# --- install -------------------------------------------------------------------------
bash "$ROOT/deploy/scripts/pack-bundle.sh" "$VERSION" "$WORK/bundle-$VERSION.tgz" >/dev/null
tar -xzf "$WORK/bundle-$VERSION.tgz" -C "$DIR"
docker run --rm "$IMAGE:$VERSION" init-env --mode bundled --app-url "$APP_URL" --version "$VERSION" > "$DIR/.env"
printf 'HELPDESK_IMAGE=%s\n' "$IMAGE" >> "$DIR/.env"
sed -i 's/^ENABLE_EMAIL_AUTOCONFIRM=.*/ENABLE_EMAIL_AUTOCONFIRM=true/' "$DIR/.env"   # no SMTP in CI

compose up -d
app_waits_for_migrate() { compose logs app 2>&1 | grep -q 'Run the migration explicitly'; }
wait_for "app refuses to start before migrate and says what to do" 240 app_waits_for_migrate

if compose run --rm -T migrate --backup-confirmed > "$OUT/install-migrate.log" 2>&1; then
  pass "migrate --backup-confirmed builds the schema of the new installation"
else
  fail "migrate failed on the new installation"; tail -30 "$OUT/install-migrate.log"
fi
compose restart app >/dev/null
wait_for "HelpDesk $VERSION answers through the proxy" 180 health_is "$VERSION"

if curl -fsS "$APP_URL/runtime-config.js" | grep -qF "\"supabaseUrl\":\"$APP_URL\""; then
  pass "the browser talks to Supabase on the app's own domain"
else
  fail "runtime-config.js does not point the browser at $APP_URL"
fi

admin_out="$(compose run --rm -T app admin create --email "$ADMIN_EMAIL" 2>&1)" || true
ADMIN_PASSWORD="$(sed -n 's/^One-time password: //p' <<<"$admin_out" | tr -d '\r')"
if [[ -n "$ADMIN_PASSWORD" ]]; then pass "admin create prints a one-time password"; else fail "admin create failed: $admin_out"; fi

ANON_KEY="$(sed -n 's/^ANON_KEY=//p' "$DIR/.env")"
if curl -fsS -X POST "$APP_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" \
     -H 'Content-Type: application/json' -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" | grep -q access_token
then pass "GoTrue answers on /auth/v1 through the proxy"; else fail "no token from /auth/v1 through the proxy"; fi
login install

# --- (Task 6 adds the upgrade and rollback scenarios here) -------------------------

echo "Logs: $OUT" >> "$SUMMARY"
exit $(( fails > 0 ))
```

- [ ] **Step 10: Прогон**

Run: `npm install && docker build -t supabase-helpdesk:ci --build-arg HELPDESK_VERSION=ci . && bash .github/scripts/bundle-e2e.sh`
Expected: все строки ✅, exit 0. Скрипт удаляет за собой контейнеры и тома. Порт 80 должен быть
свободен. Стек Supabase CLI (`supabase_*_helpdesk`) не мешает: у официального стека свои имена
контейнеров (`supabase-db` и т. д.) и сеть.

Проверка примера Traefik (без запуска):
Run: `cd "$RUNNER_TEMP_OR_TMP/bundle-e2e/helpdesk"` (или любой распакованный бандл с `.env` от
`init-env --edge own`), затем
`APP_HOST=help.example.com COMPOSE_FILE=compose.yaml:compose.bundled.yaml:examples/traefik.yml docker compose config -q`
Expected: exit 0. У `proxy` в `docker compose config` есть labels `traefik.*` и сеть `traefik`.

Если что-то не работает из-за поведения официального стека (имя сервиса, healthcheck, переменная),
исправить в наших файлах (`compose.bundled.yaml`, `supabase.override.yml`, `Caddyfile`), не в
`deploy/supabase/`. Каждое отклонение от плана описать в отчёте с доказательствами.

- [ ] **Step 11: Commit**

```bash
git add deploy/compose.yaml deploy/compose.bundled.yaml deploy/supabase.override.yml deploy/Caddyfile deploy/examples deploy/README.md deploy/scripts/pack-bundle.sh .github/scripts/bundle-e2e.sh tests/bundle
git commit -m "Deploy bundle: compose for both Supabase modes, proxy, operator guide, install e2e

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `upgrade.sh` — обновление, снимок, откат

**Files:**
- Create: `deploy/upgrade.sh`, `deploy/tests/stub-docker`, `deploy/tests/upgrade.test.sh`
- Modify: `.github/scripts/bundle-e2e.sh` (сценарии обновления), `.github/workflows/ci.yml` (job `lint`: шаг тестов)

**Interfaces:**
- Consumes: `migrate --dry-run` выводит `dry run: would apply <versions>` или `up to date`;
  `migrate --backup-confirmed` выводит `restore point (UTC, for PITR): <ts>`; `app status` выводит
  `Database schema matches this image.`; `/api/health` → `{"version": …}`; бандл содержит `VERSION`.
- Produces: `deploy/upgrade.sh` (коды выхода 0–4); `.upgrade-state` (`previous_version`,
  `target_version`, `previous_files`, `snapshot`, `restore_point`).

- [ ] **Step 1: Заглушка `deploy/tests/stub-docker`**

```bash
#!/usr/bin/env bash
# Test double for `docker` (deploy/tests/upgrade.test.sh): records each call in
# $STUB_LOG and answers from STUB_* variables.
echo "docker $*" >> "$STUB_LOG"
case "$*" in
  "compose run --rm -T migrate --dry-run")
    printf '%s\n' "${STUB_DRY_RUN:-[migrate] up to date}"; exit "${STUB_DRY_RUN_RC:-0}" ;;
  "compose run --rm -T migrate --backup-confirmed")
    echo "[migrate] restore point (UTC, for PITR): 2026-10-23T10:00:00Z"; exit "${STUB_MIGRATE_RC:-0}" ;;
  "compose run --rm -T app status")
    [[ "${STUB_OLD_SCHEMA_MATCHES:-0}" == 1 ]] && echo "[schema-check] Database schema matches this image."; exit 0 ;;
  "compose exec -T app wget -qO- http://127.0.0.1:3001/api/health")
    printf '{"status":"ok","version":"%s"}\n' "${STUB_HEALTH_VERSION:-$(sed -n 's/^HELPDESK_VERSION=//p' .env | tail -n 1)}"; exit 0 ;;
  "compose exec -T db psql"*) echo "42 MB"; exit 0 ;;
  "run --rm -v"*"tar -C /src -czf"*) exit "${STUB_SNAPSHOT_RC:-0}" ;;
  *) exit 0 ;;
esac
```

- [ ] **Step 2: Тесты** `deploy/tests/upgrade.test.sh`

```bash
#!/usr/bin/env bash
# Tests of deploy/upgrade.sh's decisions against a stub `docker`: confirmation,
# snapshot, failure paths, rollback. The real path is .github/scripts/bundle-e2e.sh.
#   bash deploy/tests/upgrade.test.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DEPLOY="$(dirname "$HERE")"
PENDING='[migrate] dry run: would apply 004 005'
fails=0

setup() { # setup bundled|external
  T="$(mktemp -d)"
  mkdir -p "$T/inst" "$T/bin" "$T/b"
  cp "$DEPLOY/upgrade.sh" "$T/inst/"
  cp "$HERE/stub-docker" "$T/bin/docker"; chmod +x "$T/bin/docker"
  printf 'HELPDESK_VERSION=1.0.0\nSUPABASE_URL=%s\n' "$([[ $1 == external ]] && echo https://x.supabase.co)" > "$T/inst/.env"
  echo old > "$T/inst/compose.yaml"
  echo 1.1.0 > "$T/b/VERSION"; echo new > "$T/b/compose.yaml"
  tar -czf "$T/bundle.tgz" -C "$T/b" .
  export STUB_LOG="$T/calls.log"; : > "$STUB_LOG"
  unset STUB_DRY_RUN STUB_MIGRATE_RC STUB_SNAPSHOT_RC STUB_OLD_SCHEMA_MATCHES STUB_HEALTH_VERSION
}
# Runs from $T (not the install directory) with a bundle path relative to $T.
upgrade() { (cd "$T" && PATH="$T/bin:$PATH" HEALTH_TIMEOUT=2 bash inst/upgrade.sh "$@" </dev/null >"$T/out.log" 2>&1); rc=$?; }
check() { if eval "$2"; then echo "✅ $1"; else echo "❌ $1 (exit $rc)"; sed 's/^/    /' "$T/out.log"; fails=$((fails + 1)); fi; }
called() { grep -qF -- "$1" "$STUB_LOG"; }
version() { sed -n 's/^HELPDESK_VERSION=//p' "$T/inst/.env"; }
files() { cat "$T/inst/compose.yaml"; }
state() { sed -n "s/^$1=//p" "$T/inst/.upgrade-state"; }

setup bundled; upgrade --bundle bundle.tgz 1.1.0
check "no pending migrations: upgrades without a snapshot" '[[ $rc == 0 && $(version) == 1.1.0 && $(files) == new ]] && ! called "tar -C /src" && ! called "migrate --backup-confirmed"'

setup bundled; STUB_DRY_RUN="$PENDING" upgrade --bundle bundle.tgz 1.1.0
check "pending without a terminal or --migrate: exit 2, nothing changed" '[[ $rc == 2 && $(version) == 1.0.0 && $(files) == old ]] && ! called "compose stop"'

setup bundled; STUB_DRY_RUN="$PENDING" upgrade --bundle bundle.tgz --migrate 1.1.0
check "pending with --migrate: snapshot, then migrate, then the new version" '[[ $rc == 0 && $(version) == 1.1.0 && $(state previous_version) == 1.0.0 && -n $(state snapshot) ]] && [[ $(grep -n "tar -C /src" "$STUB_LOG" | cut -d: -f1) -lt $(grep -n "migrate --backup-confirmed" "$STUB_LOG" | cut -d: -f1) ]]'
snapshot="$(state snapshot)"; mkdir -p "$T/inst/backups"; touch "$T/inst/$snapshot"
(cd "$T" && PATH="$T/bin:$PATH" HEALTH_TIMEOUT=2 bash inst/upgrade.sh --rollback </dev/null >"$T/out.log" 2>&1); rc=$?
check "--rollback without --yes and without a terminal refuses" '[[ $rc == 1 && $(version) == 1.1.0 ]] && grep -q -- "--yes" "$T/out.log"'
upgrade --rollback --yes
check "--rollback restores the snapshot, the files and the previous version" '[[ $rc == 0 && $(version) == 1.0.0 && $(files) == old && ! -f $T/inst/.upgrade-state ]] && called "rm -rf /dst/data && tar -C /dst -xzf"'

setup bundled; STUB_DRY_RUN="$PENDING" STUB_SNAPSHOT_RC=1 upgrade --bundle bundle.tgz --migrate 1.1.0
check "snapshot fails: no migration, previous version back, exit 3" '[[ $rc == 3 && $(version) == 1.0.0 && $(files) == old ]] && ! called "migrate --backup-confirmed"'

setup bundled; STUB_DRY_RUN="$PENDING" STUB_MIGRATE_RC=1 STUB_OLD_SCHEMA_MATCHES=1 upgrade --bundle bundle.tgz --migrate 1.1.0
check "migrate fails, schema unchanged: previous version back, exit 3" '[[ $rc == 3 && $(version) == 1.0.0 && $(files) == old ]]'

setup bundled; STUB_DRY_RUN="$PENDING" STUB_MIGRATE_RC=1 upgrade --bundle bundle.tgz --migrate 1.1.0
check "migrate fails after changing the schema: stopped, exit 4, rollback offered" '[[ $rc == 4 ]] && tail -n 1 "$STUB_LOG" | grep -q "compose stop app scheduler" && grep -q -- "--rollback" "$T/out.log"'

setup bundled; STUB_HEALTH_VERSION=1.0.0 upgrade --bundle bundle.tgz 1.1.0
check "new version never healthy, no migrations: previous version back, exit 3" '[[ $rc == 3 && $(version) == 1.0.0 ]]'

setup bundled; upgrade --bundle bundle.tgz 1.2.0
check "bundle of another version: exit 1 before any change" '[[ $rc == 1 && $(version) == 1.0.0 && $(files) == old ]] && ! [[ -s "$STUB_LOG" ]]'

setup external; STUB_DRY_RUN="$PENDING" upgrade --bundle bundle.tgz --migrate 1.1.0
check "external Supabase: no snapshot, the PITR restore point is kept" '[[ $rc == 0 && $(state restore_point) == 2026-10-23T10:00:00Z ]] && ! called "tar -C /src"'
upgrade --rollback --yes
check "external --rollback first asks for the PITR restore" '[[ $rc == 1 && $(version) == 1.1.0 ]] && grep -q "2026-10-23T10:00:00Z" "$T/out.log"'
upgrade --rollback --yes --restored
check "external --rollback --restored returns to the previous version" '[[ $rc == 0 && $(version) == 1.0.0 ]]'

exit $(( fails > 0 ))
```

Run: `bash deploy/tests/upgrade.test.sh` → FAIL (нет `deploy/upgrade.sh`).

- [ ] **Step 3: `deploy/upgrade.sh`**

```bash
#!/usr/bin/env bash
# Upgrade or roll back this HelpDesk installation — the same script for
# operators and for CD.
#
#   ./upgrade.sh [--bundle FILE] [--migrate] VERSION   upgrade to VERSION
#   ./upgrade.sh --rollback [--yes] [--restored]       undo the last upgrade
#
# Upgrade:
#  1. Unpack the bundle of VERSION (GitHub Release, or --bundle FILE) over this
#     directory; .env, backups/ and data stay. The current files are saved
#     first and put back if the upgrade stops.
#  2. Pull images; `migrate --dry-run` says what would change.
#  3. Pending migrations need an explicit yes: the prompt, or --migrate when
#     there is no terminal.
#  4. Stop the app. Bundled Supabase: stop the stack and snapshot the Postgres
#     data directory into backups/ — Supabase has no in-place restore, so a
#     rollback restores the whole database. External Supabase: its PITR is the
#     backup; the restore point `migrate` prints is kept for --rollback.
#  5. Migrate, start everything, wait until /api/health reports VERSION.
#
# Exit: 0 done; 1 error, nothing changed; 2 pending migrations not confirmed,
#       nothing changed; 3 failed, schema unchanged, the previous version runs
#       again; 4 failed after the schema changed — everything stays stopped:
#       ship a fix and upgrade, or ./upgrade.sh --rollback.
set -euo pipefail

RELEASES_URL="${HELPDESK_RELEASES_URL:-https://github.com/surveyjs/supabase-helpdesk/releases/download}"
STATE=.upgrade-state
KEEP_SNAPSHOTS=3
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"
HELPER_IMAGE=alpine:3.22

log() { echo "[upgrade] $*" >&2; }
die() { log "$*"; exit 1; }
env_get() { sed -n "s/^$1=//p" .env | tail -n 1 | tr -d '\r'; }
env_set() {
  local tmp; tmp="$(mktemp)"
  if grep -q "^$1=" .env; then sed "s|^$1=.*|$1=$2|" .env > "$tmp"; else { cat .env; echo "$1=$2"; } > "$tmp"; fi
  cat "$tmp" > .env; rm -f "$tmp"
}
state_get() { sed -n "s/^$1=//p" "$STATE" 2>/dev/null | tail -n 1; }
compose() { docker compose "$@"; }
bundled() { [[ -z "$(env_get SUPABASE_URL)" ]]; }
# docker run -v needs native paths from Git Bash.
host_path() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$PWD/$1"; else echo "$PWD/$1"; fi; }
save_files() { # the installed bundle, without .env, backups and data
  mkdir -p backups
  tar -czf "$1" --exclude=./.env --exclude=./backups --exclude="./$STATE" \
    --exclude=./supabase/volumes/db/data --exclude=./supabase/volumes/storage .
}
health_version() {
  compose exec -T app wget -qO- http://127.0.0.1:3001/api/health 2>/dev/null \
    | sed -n 's/.*"version":"\([^"]*\)".*/\1/p' | tr -d '\r'
}
wait_healthy() {
  local end=$((SECONDS + HEALTH_TIMEOUT))
  until [[ "$(health_version)" == "$1" ]]; do
    (( SECONDS < end )) || return 1
    sleep 3
  done
}
confirm() { # confirm <yes 0|1> <question>
  [[ "$1" == 1 ]] && return 0
  [[ -t 0 ]] || die "no terminal to confirm \"$2\" — re-run with --yes"
  local answer; read -r -p "$2 [y/N] " answer
  [[ "$answer" == [yY]* ]]
}
db_size() {
  compose exec -T db psql -U postgres -tAc "select pg_size_pretty(pg_database_size('postgres'))" 2>/dev/null \
    | tr -d '\r' || echo "size unknown"
}

# Upgrade stopped before the schema changed: put the previous version back.
restore_previous() { # restore_previous <previous> <saved files> <message>
  log "$3"
  tar -xzf "$2" -C .
  env_set HELPDESK_VERSION "$1"
  compose up -d
  if wait_healthy "$1"; then log "$1 runs again; the schema is unchanged"; else log "$1 did not become healthy either — check: docker compose logs app"; fi
  exit 3
}

# Upgrade failed after migrate ran or while the new version started.
after_failure() { # after_failure <previous> <saved files> <message> <migrated 0|1>
  log "$3"
  [[ "$4" == 1 ]] || restore_previous "$1" "$2" "no migration ran — restarting $1"
  if bundled; then compose up -d --wait rest api-gw >/dev/null 2>&1 || true; fi
  if HELPDESK_VERSION="$1" compose run --rm -T app status 2>&1 | grep -q 'Database schema matches this image.'; then
    restore_previous "$1" "$2" "the schema is still the one of $1 — restarting it"
  fi
  compose stop app scheduler >/dev/null 2>&1 || true
  log "The schema has changed, so $1 cannot run on it; HelpDesk stays stopped. Either:"
  log "  - fix the cause (or wait for a fixed release) and run ./upgrade.sh <version>, or"
  log "  - run ./upgrade.sh --rollback to restore the database and $1."
  exit 4
}

upgrade() { # upgrade <target> <bundle or ""> <confirmed 0|1>
  local target="$1" bundle="$2" confirmed="$3"
  [[ -f .env ]] || die "no .env here — create it with init-env (see README.md)"
  local previous ts staging saved
  previous="$(env_get HELPDESK_VERSION)"
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  staging="$(mktemp -d)"
  trap 'rm -rf "$staging"' EXIT

  if [[ -z "$bundle" ]]; then
    bundle="$staging/bundle.tgz"
    curl -fsSL "$RELEASES_URL/v$target/helpdesk-deploy-v$target.tar.gz" -o "$bundle" \
      || die "cannot download the bundle of $target from $RELEASES_URL"
  fi
  mkdir "$staging/files"
  tar -xzf "$bundle" -C "$staging/files" || die "cannot unpack $bundle"
  local got; got="$(tr -d '\r\n' < "$staging/files/VERSION" 2>/dev/null || true)"
  [[ "$got" == "$target" ]] || die "$bundle is the bundle of '${got:-?}', not $target; nothing changed"

  saved="backups/files-${previous:-none}-$ts.tgz"
  save_files "$saved"
  cp -R "$staging/files/." .

  local image; image="$(env_get HELPDESK_IMAGE)"; image="${image:-ghcr.io/surveyjs/supabase-helpdesk}"
  HELPDESK_VERSION="$target" compose pull --quiet --ignore-pull-failures >/dev/null 2>&1 || true
  if ! docker image inspect "$image:$target" >/dev/null 2>&1; then
    tar -xzf "$saved" -C .; die "image $image:$target is not available; nothing changed"
  fi

  local dry rc=0
  dry="$(HELPDESK_VERSION="$target" compose run --rm -T migrate --dry-run 2>&1)" || rc=$?
  printf '%s\n' "$dry" >&2
  if (( rc != 0 )); then tar -xzf "$saved" -C .; die "migrate --dry-run failed (exit $rc); nothing changed"; fi
  local pending; pending="$(sed -n 's/.*dry run: would apply //p' <<<"$dry" | tr -d '\r')"

  if [[ -n "$pending" ]]; then
    log "pending migrations: $pending"
    if bundled; then
      log "HelpDesk and Supabase stop while the database ($(db_size)) is snapshotted into backups/"
    else
      log "Supabase is external: its PITR or a recent backup is the only way back — make sure it exists"
    fi
    if [[ "$confirmed" != 1 ]]; then
      if [[ -t 0 ]]; then
        local answer; read -r -p "Apply $pending? [y/N] " answer
        [[ "$answer" == [yY]* ]] || { tar -xzf "$saved" -C .; log "not confirmed; nothing changed"; exit 2; }
      else
        tar -xzf "$saved" -C .
        log "pending migrations need --migrate when there is no terminal; nothing changed"
        exit 2
      fi
    fi
  fi

  printf 'previous_version=%s\ntarget_version=%s\nprevious_files=%s\n' "$previous" "$target" "$saved" > "$STATE"
  compose stop app scheduler

  if [[ -n "$pending" ]]; then
    if bundled; then
      local snapshot="backups/db-${previous:-none}-$ts.tar.gz"
      compose stop
      if ! docker run --rm -v "$(host_path supabase/volumes/db):/src:ro" -v "$(host_path backups):/dst" \
           "$HELPER_IMAGE" tar -C /src -czf "/dst/$(basename "$snapshot")" data; then
        rm -f "$snapshot"
        restore_previous "$previous" "$saved" "the database snapshot failed; nothing was migrated"
      fi
      echo "snapshot=$snapshot" >> "$STATE"
      ls -1t backups/db-*.tar.gz 2>/dev/null | tail -n "+$((KEEP_SNAPSHOTS + 1))" | xargs -r rm -f
      compose up -d --wait db
    fi
    local out mrc=0
    out="$(HELPDESK_VERSION="$target" compose run --rm -T migrate --backup-confirmed 2>&1)" || mrc=$?
    printf '%s\n' "$out" >&2
    local point; point="$(sed -n 's/.*restore point (UTC, for PITR): //p' <<<"$out" | tr -d '\r')"
    [[ -n "$point" ]] && echo "restore_point=$point" >> "$STATE"
    (( mrc == 0 )) || after_failure "$previous" "$saved" "migrate failed (exit $mrc)" 1
  fi

  env_set HELPDESK_VERSION "$target"
  compose up -d
  wait_healthy "$target" || after_failure "$previous" "$saved" "HelpDesk $target did not report healthy within ${HEALTH_TIMEOUT}s" "$([[ -n $pending ]] && echo 1 || echo 0)"
  log "upgraded ${previous:-?} -> $target"
}

rollback() { # rollback <yes 0|1> <restored 0|1>
  [[ -f "$STATE" ]] || die "nothing to roll back: no $STATE"
  local previous target files snapshot point
  previous="$(state_get previous_version)"; target="$(state_get target_version)"
  files="$(state_get previous_files)"; snapshot="$(state_get snapshot)"; point="$(state_get restore_point)"

  if bundled && [[ -n "$snapshot" ]]; then
    [[ -f "$snapshot" ]] || die "the snapshot $snapshot is missing"
    confirm "$1" "Restore the database to the snapshot taken before $target ($snapshot)? Everything written since is lost." \
      || die "not confirmed; nothing changed"
    compose stop
    docker run --rm -v "$(host_path supabase/volumes/db):/dst" -v "$(host_path backups):/src:ro" "$HELPER_IMAGE" \
      sh -c "rm -rf /dst/data && tar -C /dst -xzf /src/$(basename "$snapshot")" \
      || die "restoring $snapshot failed"
  elif ! bundled && [[ -n "$point" && "$2" != 1 ]]; then
    log "Restore your Supabase project to $point (UTC): Dashboard -> Database -> Backups -> Point in time,"
    log "or the Management API restore-pitr. Then run: ./upgrade.sh --rollback --restored"
    exit 1
  else
    confirm "$1" "Go back to $previous?" || die "not confirmed; nothing changed"
  fi

  if [[ -n "$files" && -f "$files" ]]; then tar -xzf "$files" -C .; fi
  env_set HELPDESK_VERSION "$previous"
  compose up -d
  wait_healthy "$previous" || die "$previous did not report healthy after the rollback — check: docker compose logs app"
  rm -f "$STATE"
  log "rolled back $target -> $previous"
}

bundle="" migrate=0 do_rollback=0 yes=0 restored=0 target=""
while (($#)); do
  case "$1" in
    --bundle) [[ $# -ge 2 ]] || die "--bundle needs a file"
              [[ -f "$2" ]] || die "no such bundle: $2"
              bundle="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"; shift 2 ;;
    --migrate) migrate=1; shift ;;
    --rollback) do_rollback=1; shift ;;
    --yes) yes=1; shift ;;
    --restored) restored=1; shift ;;
    -h|--help) sed -n '2,/^set -euo pipefail$/p' "$0" | sed '$d; s/^# \{0,1\}//'; exit 0 ;;
    -*) die "unknown option: $1" ;;
    *) target="$1"; shift ;;
  esac
done
cd "$(dirname "$0")"

if (( do_rollback )); then
  rollback "$yes" "$restored"
else
  [[ -n "$target" ]] || die "usage: ./upgrade.sh [--bundle FILE] [--migrate] VERSION | ./upgrade.sh --rollback [--yes]"
  upgrade "$target" "$bundle" "$migrate"
fi
```

Обратить внимание:
- **Заглушка и `wget`.** Заглушка отвечает на `compose exec -T app wget -qO- …`, поэтому строка в
  `health_version` должна совпадать посимвольно.
- **Сценарий «бандл не той версии».** Ожидается, что заглушка не вызывалась вообще: проверка
  версии идёт до `pull`.
- **Тест rollback без `--yes`.** Он проверяет путь со снимком; без снимка `confirm` также требует
  `--yes` без терминала.

Run: `bash deploy/tests/upgrade.test.sh` → все ✅, exit 0. Если тест упирается в мелкое расхождение
со скриптом (например, порядок вызовов), исправлять скрипт под поведение из спецификации, а не тест.

- [ ] **Step 4: Шаг в CI** — в job `lint` после `Unit tests`:

```yaml
      - name: Deploy script tests
        if: ${{ !cancelled() && steps.setup.outcome == 'success' }}
        run: bash deploy/tests/upgrade.test.sh
```

- [ ] **Step 5: Сценарии обновления в `bundle-e2e.sh`** — заменить строку-маркер
  `# --- (Task 6 adds the upgrade and rollback scenarios here) ---` на:

```bash
# --- upgrade to a next version with a new migration, then roll back --------------------
NEXT="$VERSION-next"
printf 'create table if not exists public.bundle_e2e_marker (id int);\n' > "$WORK/999_bundle_e2e.sql"
printf 'FROM %s:%s\nCOPY 999_bundle_e2e.sql /app/supabase/migrations/\nENV HELPDESK_VERSION=%s\n' \
  "$IMAGE" "$VERSION" "$NEXT" > "$WORK/Dockerfile.next"
docker build -q -t "$IMAGE:$NEXT" -f "$WORK/Dockerfile.next" "$WORK" >/dev/null
bash "$ROOT/deploy/scripts/pack-bundle.sh" "$NEXT" "$WORK/bundle-$NEXT.tgz" >/dev/null
marker() { compose exec -T db psql -U postgres -tAc "select to_regclass('public.bundle_e2e_marker') is not null" | tr -d '\r '; }
snapshots() { find "$DIR/backups" -name 'db-*.tar.gz' 2>/dev/null | wc -l | tr -d ' '; }

set +e; "$DIR/upgrade.sh" --bundle "$WORK/bundle-$NEXT.tgz" "$NEXT" </dev/null > "$OUT/upgrade-unconfirmed.log" 2>&1; rc=$?; set -e
if [[ $rc == 2 ]] && health_is "$VERSION" && [[ "$(marker)" == f ]]; then
  pass "upgrade without --migrate and without a terminal stops, nothing changed (exit 2)"
else
  fail "unconfirmed upgrade: exit $rc, version $(health_version), marker $(marker)"; tail -30 "$OUT/upgrade-unconfirmed.log"
fi

set +e; "$DIR/upgrade.sh" --bundle "$WORK/bundle-$NEXT.tgz" --migrate "$NEXT" </dev/null > "$OUT/upgrade.log" 2>&1; rc=$?; set -e
if [[ $rc == 0 ]] && health_is "$NEXT" && [[ "$(marker)" == t && "$(snapshots)" == 1 ]]; then
  pass "upgrade --migrate snapshots the database, migrates and runs $NEXT"
else
  fail "upgrade: exit $rc, version $(health_version), marker $(marker), snapshots $(snapshots)"; tail -40 "$OUT/upgrade.log"
fi
login upgraded

set +e; "$DIR/upgrade.sh" --rollback --yes </dev/null > "$OUT/rollback.log" 2>&1; rc=$?; set -e
if [[ $rc == 0 ]] && health_is "$VERSION" && [[ "$(marker)" == f ]]; then
  pass "--rollback restores the database and $VERSION"
else
  fail "rollback: exit $rc, version $(health_version), marker $(marker)"; tail -40 "$OUT/rollback.log"
fi
login rolled-back
```

Run: `docker build -t supabase-helpdesk:ci --build-arg HELPDESK_VERSION=ci . && bash .github/scripts/bundle-e2e.sh`
Expected: все ✅, exit 0.

- [ ] **Step 6: Commit**

```bash
git add deploy/upgrade.sh deploy/tests .github/scripts/bundle-e2e.sh .github/workflows/ci.yml
git commit -m "upgrade.sh: explicit migration, database snapshot and rollback

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: CI-job `bundle-e2e`

**Files:** Modify: `.github/workflows/ci.yml`

**Interfaces:** Consumes: артефакт `image` (`supabase-helpdesk:ci`, внутри `HELPDESK_VERSION=sha-<sha>`), `bundle-e2e.sh` (`IMAGE`, `VERSION`).

- [ ] **Step 1: Job** (после `image-smoke`)

```yaml
  bundle-e2e:
    name: Bundle e2e (install · upgrade · rollback)
    needs: image
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - id: setup
        uses: ./.github/actions/setup          # node_modules for Playwright
      - name: Install Chromium (background)
        run: bash .github/scripts/bg.sh start playwright npx playwright install --with-deps --only-shell chromium
      - uses: actions/download-artifact@v8
        with:
          name: image
          path: ${{ runner.temp }}
      - name: docker load
        # The bundle's image tag is the version the image reports.
        run: |
          gunzip -c "$RUNNER_TEMP/image.tar.gz" | docker load
          docker tag supabase-helpdesk:ci "supabase-helpdesk:sha-$GITHUB_SHA"
      - name: Wait for Chromium
        run: bash .github/scripts/bg.sh wait playwright 600
      - name: Install, upgrade and roll back the bundle
        env:
          IMAGE: supabase-helpdesk
          VERSION: sha-${{ github.sha }}
        run: bash .github/scripts/bundle-e2e.sh
      - name: Upload diagnostics
        if: failure()
        uses: ./.github/actions/upload-diagnostics
        with:
          name: diagnostics-bundle-e2e
          extra-path: ${{ runner.temp }}/bundle-e2e/out
```

- [ ] **Step 2: `ci-result`** → добавить `bundle-e2e` в `needs`.

- [ ] **Step 3: Проверка:** `npx --yes yaml-lint .github/workflows/ci.yml`; совпадение имени артефакта и пути с job `image`.

- [ ] **Step 4: Commit** — `git add .github/workflows/ci.yml && git commit -m "CI: bundle-e2e — install, upgrade and roll back the deploy bundle" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

## Проверка плана B целиком
- `npm run lint && npm run typecheck && npm run test:unit && npm run test:db` и
  `bash deploy/tests/upgrade.test.sh` — зелёные.
- `image-smoke.sh` — зелёный: entrypoint расширен, `migrate` не менялся.
- `bundle-e2e.sh` локально — зелёный: установка, вход, обновление, отказ без подтверждения,
  `--rollback`.
- Push и PR — только после подтверждения пользователя. На GitHub job'ы `bundle-e2e` и `lint`
  (тесты `upgrade.sh`) должны быть зелёными.
