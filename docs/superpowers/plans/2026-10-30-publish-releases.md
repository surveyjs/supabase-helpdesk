# План C: публикация образа и релизов (без CD)

## Context
PR #94 (CI, план A — образ и явная `migrate`, план B — бандл `deploy/` и `upgrade.sh`) зелёный.
Пока образ живёт только как артефакт CI, а `upgrade.sh` и `deploy/README.md` уже ссылаются на
`ghcr.io/surveyjs/supabase-helpdesk:X.Y.Z` и на `releases/download/vX.Y.Z/helpdesk-deploy-vX.Y.Z.tar.gz`
(`deploy/upgrade.sh:43,315`). План C делает эти адреса настоящими. Деплоя из CI нет: `upgrade.sh`
на наших серверах запускает человек.

Решения пользователя:
- **образ релиза** — производный: `FROM …:sha-<sha>` + `ENV HELPDESK_VERSION=X.Y.Z`. Слои те же, что прошли CI;
- **архитектура** — только linux/amd64;
- **работа** — продолжаем в ветке `ci/refactor-green-fast` (PR #94) или новой ветке от неё, если PR
  к тому времени слит. Коммиты без Co-Authored-By, PR — без строки Claude Code, PR открывает пользователь.

## Что есть и переиспользуется
- `ci.yml` job `image`: `docker build --build-arg HELPDESK_VERSION=sha-$GITHUB_SHA`, артефакт `image`
  (`image.tar.gz`); `ci-result` — сводный job.
- Производный образ уже делается в `.github/scripts/bundle-e2e.sh:108` (`FROM …` + `ENV HELPDESK_VERSION`).
- `deploy/scripts/pack-bundle.sh <version> <out.tgz>` пишет `VERSION`, который сверяет `upgrade.sh`.
- `upgrade.sh`: версия без `v`, тег образа = `HELPDESK_VERSION` = то, что отдаёт `/api/health`.

## Шаги

### Task 1: Метаданные образа (`Dockerfile`)
- `LABEL org.opencontainers.image.source="https://github.com/surveyjs/supabase-helpdesk"` и
  `org.opencontainers.image.licenses` (взять из `package.json`/LICENSE) в стадии `runner`.
  Метка source связывает GHCR-пакет с репозиторием: `GITHUB_TOKEN` получает права на пакет.
- `org.opencontainers.image.revision`/`version` передаются `--label` в CI (`$GITHUB_SHA`, `sha-$GITHUB_SHA`).
- Тест: `tests/unit/deploy-pins.test.ts` (или рядом) проверяет метку source в Dockerfile.

### Task 2: Job `publish` в `ci.yml` (только push в `main`)
- `needs: ci-result`, `if: github.event_name == 'push' && github.ref == 'refs/heads/main'`.
- `permissions` только у job: `contents: read`, `packages: write`, `id-token: write`, `attestations: write`.
- Шаги: скачать артефакт `image` → `docker load` → `docker login ghcr.io` (`GITHUB_TOKEN`) →
  тег и push `:sha-<sha>` → digest из `docker inspect --format '{{index .RepoDigests 0}}'` →
  `actions/attest-build-provenance` (`subject-name`, `subject-digest`, `push-to-registry: true`).
- `:edge` — только если этот коммит всё ещё голова `main` (`git ls-remote origin refs/heads/main`);
  иначе пропустить с сообщением. Так поздний прогон старого коммита не откатит `:edge`.
- Бандл: `pack-bundle.sh sha-<sha>` → артефакт `helpdesk-deploy-sha-<sha>` (для ручного
  `./upgrade.sh --bundle FILE sha-<sha>` на demo).
- В Summary: адрес образа, digest, команда обновления demo.
- Версии actions (`docker/login-action`, `actions/attest-build-provenance`) — текущие мажорные,
  сверить на GitHub при реализации; как остальные в `ci.yml`.

### Task 3: `.github/workflows/release.yml` (push тега `v*.*.*`)
- `permissions`: `contents: write`, `packages: write`, `id-token: write`, `attestations: write`, `actions: read`.
- Проверки (каждая — понятный `::error::` и выход):
  1. тег — semver `vX.Y.Z` или `vX.Y.Z-pre`;
  2. коммит тега входит в `main` (`git merge-base --is-ancestor`, `fetch-depth: 0`);
  3. для этого sha есть успешный прогон `CI` на push в main (`gh run list --workflow ci.yml --commit <sha> --event push --status success`);
  4. `ghcr.io/…:sha-<sha>` существует (`docker buildx imagetools inspect`).
- Образ: скрипт `.github/scripts/release-image.sh X.Y.Z <sha>` —
  `printf 'FROM …:sha-<sha>\nENV HELPDESK_VERSION=X.Y.Z\nLABEL org.opencontainers.image.version=X.Y.Z\n' | docker build -`,
  push `:X.Y.Z`; для стабильной версии ещё `:X.Y` и `:latest` (`latest` — только если X.Y.Z наибольшая
  стабильная среди тегов); attestation на digest.
- Проверка образа перед публикацией релиза: `docker run --rm --entrypoint node <img> -p process.env.HELPDESK_VERSION`
  = X.Y.Z; слои (`docker inspect .RootFS.Layers`) совпадают со слоями `:sha-<sha>`.
- Бандл: `pack-bundle.sh X.Y.Z dist/helpdesk-deploy-vX.Y.Z.tar.gz` и `sha256sum` рядом.
- Релиз: `gh release create vX.Y.Z --verify-tag --generate-notes` (+ `--prerelease` для `-pre`),
  assets — бандл и `.sha256`. Имя совпадает с `RELEASES_URL` в `upgrade.sh`.
- Повторный запуск того же тега идемпотентен: существующий релиз → `gh release upload --clobber`.

### Task 4: `bundle-e2e` с прошлого релиза (N-1)
- В `bundle-e2e.sh` режим `FROM_RELEASE`: если у репозитория есть стабильный релиз
  (`gh release view --json tagName` / API latest), установка идёт из его бандла и образа
  `ghcr.io/…:X.Y.Z`, затем `upgrade.sh --bundle <PR-бандл> --migrate <VERSION>` на образ PR,
  проверка входа и `--rollback` обратно на X.Y.Z. Нет релизов → шаг пропускается с пометкой в Summary.
- Отдельный job `bundle-e2e-upgrade` в `ci.yml` (параллельно текущему `bundle-e2e`), входит в `ci-result`.

### Task 5: Документация
- `deploy/README.md`: откуда брать образ и бандл; каналы `X.Y.Z`/`X.Y`/`latest` и `edge`/`sha-<sha>`;
  проверка attestation (`gh attestation verify oci://ghcr.io/…:X.Y.Z --repo surveyjs/supabase-helpdesk`);
  обновление demo на `sha-<sha>` с бандлом из артефакта.
- `docs/RELEASING.md` (новый, коротко): как выпустить версию (тег `vX.Y.Z` на коммите main с зелёным CI),
  что делает `release.yml`, как перевыпустить.
- Спека `docs/superpowers/specs/2026-10-22-deployment-design.md`: раздел CD заменить на «только
  публикация», добавить решение про производный образ и amd64.

### Task 6: Хвосты ревью `upgrade.sh` (из плана B)
- Блокировка: `mkdir .upgrade.lock` + trap в `main` до очистки `.part`; занята → exit 1
  «another upgrade.sh is running». Тест на заглушке.
- `supabase_from` хранит и сравнивает весь `VENDORED` (ref + sha). Тест.

## Ручные шаги (делает пользователь, один раз)
- После первого `publish`: GHCR → пакет `supabase-helpdesk` → Package settings → Change visibility → Public.
- Проверить, что настройки организации разрешают Actions публиковать пакеты.

## Проверка
- Локально: `bash -n`/`shellcheck`-уровень для новых скриптов, `npm run lint`, `typecheck`, unit;
  `release-image.sh` на локальном образе (`supabase-helpdesk:ci`) с локальным registry
  (`registry:2` в Docker) — слои совпадают, версия X.Y.Z; `deploy/tests/upgrade.test.sh` с новыми проверками.
- В PR: `publish` и `release.yml` на PR не запускаются — проверяем `actionlint` (если есть) и dry-run
  скриптов. Новый job `bundle-e2e-upgrade` в PR зелёный (пропуск, пока нет релизов).
- После слияния в main: `publish` кладёт `:sha-<sha>` и `:edge`, attestation видна
  (`gh attestation verify`). Затем тестовый тег `v0.1.0-rc.1` → prerelease с бандлом, образ
  `:0.1.0-rc.1` отдаёт эту версию; удалить тестовый релиз или оставить как первый — решает пользователь.
- Первый стабильный релиз `v0.1.0` → `bundle-e2e-upgrade` в следующих PR начинает работать по-настоящему.
