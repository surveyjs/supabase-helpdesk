# Deployment system — design spec (2026-10-22)

## Требования
- **Кому выкатываем.** Наши инстансы (demo, internal) и клиентские установки, сразу оба варианта.
- **Supabase.** Два режима:
  - полный стек от нас (официальный Supabase compose);
  - внешний Supabase: Cloud или чужой self-hosted.
- **Платформа.** Docker Compose на Linux.
- **Версии.** Semver-релизы по ручному тегу `vX.Y.Z` плюс поток `edge` с main.
- **Обновление наших инстансов.** Та же процедура, что у клиентов, запускается из CI по SSH:
  - demo — автоматически на `edge`;
  - internal — на релиз, с approval.
- **Первый админ** создаётся командой из образа.
- **Миграции — явный шаг.** Приложение при старте только сверяет схему с образом. При любом
  несовпадении (включая «БД новее образа») оно не стартует и говорит, что делать. Флагов обхода нет.

## Артефакт
- **Один образ `ghcr.io/surveyjs/supabase-helpdesk` на версию**, без данных инстанса. Конфиг читается
  в runtime, браузер получает публичный конфиг из `/runtime-config.js`.
- **Состав образа:** standalone-сервер, `supabase/migrations/`, Supabase CLI 2.121.0 (npm, musl),
  `postgresql17-client`, скрипты `docker/`.
- **Команды:** `serve` (по умолчанию), `status`, `migrate [--dry-run] [--backup-confirmed]`.
  В плане B добавятся `init-env`, `admin create`, `admin reset-password`, `scheduler`.
- **Адрес Supabase.**
  - `SUPABASE_URL` задан → внешний Supabase: браузер и сервер ходят туда.
  - `SUPABASE_URL` не задан → полный стек на домене приложения:
    - браузер ходит на `APP_URL`, reverse proxy направляет `/auth/v1`, `/rest/v1`, `/storage/v1`,
      `/realtime/v1` в Kong;
    - сервер ходит на `SUPABASE_INTERNAL_URL` (`http://kong:8000`, задаётся в compose);
    - имя auth-cookie вычисляется по браузерному URL, чтобы сервер видел ту же сессию.
- **`/api/health`** не трогает БД и отдаёт `version` (`HELPDESK_VERSION`).

## Старт и миграция
- **`serve`:**
  - читает версии схемы через RPC `schema_migration_versions()` (миграция 003, только
    `service_role`, вызов через REST service-role ключом) и сравнивает с миграциями образа;
  - при несовпадении — exit 78 и сообщение с командой: `docker compose run --rm migrate`
    или `./upgrade.sh --rollback`.
- **`migrate`** — отдельный одноразовый сервис. Только у него есть `MIGRATION_DB_URL`: прямое
  подключение или session pooler, для полного стека с `?sslmode=disable`. Шаги:
  1. `pg_advisory_lock`;
  2. сравнение версий: разошлась история → exit 3, БД новее → exit 4, нечего применять → exit 0;
  3. `--dry-run` печатает список и выходит;
  4. без `--backup-confirmed` ничего не применяется (exit 2); перед применением печатается UTC-время —
     точка восстановления для PITR;
  5. `supabase db push --include-all --skip-vault --yes`.

## Бэкап и откат (пересмотрено 2026-10-22)
- **Проверка:** `pg_dump` + `pg_restore --clean` ролью `postgres` поверх живой Supabase-БД невозможны
  (`must be owner of event trigger pgrst_drop_watch`, 875 ошибок прав в схемах `supabase_admin`).
- **Supabase отката «на месте» не предлагает.** Откат — это восстановление всей БД:
  - Cloud: PITR (RPO 2 минуты) или ежедневные бэкапы, восстановление проекта целиком из дашборда
    или через Management API `restore-pitr`; Storage-объекты в бэкап не входят;
  - CLI `db dump` (роли, схема, данные) и восстановление через `psql` с
    `session_replication_role = replica` рассчитаны на новый пустой проект;
  - self-hosted: `update.sh` сохраняет только конфигурацию, БД нужно бэкапить отдельно.
- **Решение:**
  - полный стек: `upgrade.sh` останавливает стек и снимает снимок каталога данных Postgres
    (`volumes/db/data`), затем поднимает стек и запускает `migrate --backup-confirmed`;
    `--rollback` возвращает снимок целиком (включая auth и storage-метаданные) и прежний образ;
  - внешний Supabase: бэкап — PITR или ежедневные бэкапы провайдера; `migrate` применяет только с
    явным `--backup-confirmed` и печатает точку восстановления; `--rollback` печатает инструкцию для
    PITR с этой точкой и возвращает прежний образ после восстановления.
- В образе нет `pg_dump` и `restore`: бэкап и откат — дело `upgrade.sh` (хост) или провайдера.

## Дистрибутив, CD, сбои (детализация — в планах B и C)
- **Бандл `deploy/`:**
  - `compose.yaml` (`app`, `scheduler`, `migrate` в profile `tools`);
  - `compose.supabase.yaml` (вендоренный официальный compose через `include`);
  - `.env.example`, `Caddyfile.example`, `upgrade.sh`.
- **`upgrade.sh`:**
  1. pull → `migrate --dry-run`, показать список и размер БД, спросить подтверждение
     (без TTY нужен флаг `--migrate`);
  2. остановить `app` и `scheduler`; в полном стеке — остановить стек, снять снимок `volumes/db/data`,
     поднять стек; → `migrate --backup-confirmed` → `up -d` → health с новой версией;
  3. если схема не изменилась — поднять прежнюю версию; если изменилась частично — всё остаётся
     остановленным, печатаются два пути;
  4. `--rollback`: полный стек — вернуть снимок и прежний образ; внешний режим — инструкция для PITR
     с сохранённой точкой восстановления, затем прежний образ.
- **`scheduler`** вызывает `/api/cron/sla` и `/api/cron/notifications`. Миграция 004 снимает
  pg_cron-задачу `check-sla-timers`.
- **CI:** `image` (одна сборка) → `image-smoke`, `migration-upgrade` через образ, `bundle-e2e` на
  каждом PR (N-1 → PR, без `--migrate` стоп, с `--migrate` ок, `--rollback`).
- **CD:**
  - `publish` на main: `:sha-<sha>`, `:edge`, attestation;
  - `deploy-demo` с `--migrate`;
  - `release.yml` по тегу: retag, GitHub Release, `deploy-internal` с approval и dry-run для ревьюера.

## Факты из эксперимента с CLI 2.121.0 (на них опирается `migrate`)
- **Лишняя версия в БД** → `DbPushMissingLocalError`, exit 1, флага обхода нет. Обёртка проверяет это
  сама и заранее.
- **Без TTY** `db push` не ждёт ввода. Под `psql \!` CLI показал `[Y/n]`, поэтому `--yes` обязателен.
- **Транзакции.** Каждая обычная миграция атомарна. С `CONCURRENTLY` или явным `COMMIT` statements
  выполняются без транзакции.
- **Блокировки у CLI нет.** Двойное применение предотвращает только PK на `version`. Lock в обёртке
  через psql + `\!` проверен.
- **Идентичность миграции — только номер версии.** Файл с тем же номером CLI молча пропускает.
- **TLS по умолчанию.** Postgres в Supabase-стеке работает с `ssl=off`, нужен `sslmode=disable`.
- **Окружение.** CLI ставится в alpine из npm, Docker и `config.toml` не нужны.
- **Паритет.** Копия `migration-upgrade.sh` с `migrate` из образа прошла полностью, включая `test:db`.

---

