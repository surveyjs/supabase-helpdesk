#!/usr/bin/env bash
# End-to-end test of the deploy bundle with the bundled Supabase stack, run the
# way an operator runs it (README.md, Install): pack -> init-env -> (app refuses
# before migrate) -> migrate -> up -> admin create -> sign in through the proxy on
# one domain. Also checks that pack-bundle.sh leaks no ignored files.
# Then upgrade.sh to a next version (this image + one migration) and --rollback.
# CI: job bundle-e2e.
#
# FROM_RELEASE=1 (CI: job bundle-e2e-upgrade): the upgrade an operator of the
# last release makes. Installs the latest stable release (N-1: the bundle of the
# release and its image) the same way, signs in, runs that installation's
# upgrade.sh --bundle <this bundle> --migrate VERSION, signs in, --rollback --yes
# and checks that N-1 runs again on the database it had. No stable release yet:
# nothing to test, a skip note in the Summary, exit 0. Where N-1 comes from:
#   FROM_RELEASE_VERSION   X.Y.Z; default: GitHub's latest release of
#                          GITHUB_REPOSITORY from GITHUB_API_URL (never a draft or
#                          a prerelease; GH_TOKEN, if set, authenticates the call)
#   FROM_RELEASE_IMAGE     repository of the N-1 image (tag X.Y.Z, pulled unless
#                          present); default ghcr.io/<repository>. Tagged as
#                          IMAGE:X.Y.Z, so one HELPDESK_IMAGE serves both versions.
#   HELPDESK_RELEASES_URL  the bundle is <it>/vX.Y.Z/helpdesk-deploy-vX.Y.Z.tar.gz, as
#                          upgrade.sh downloads it; default the repository's releases.
#   FROM_RELEASE_DRY_RUN=1 prints version=, image= and bundle= of N-1 and exits.
#
# Locally (Linux, or Git Bash + Docker Desktop; needs port 80 and Supabase's
# fixed container names supabase-*, so no other official-compose stack may run):
#   docker build -t supabase-helpdesk:ci --build-arg HELPDESK_VERSION=ci .
#   bash .github/scripts/bundle-e2e.sh
# From a fake release 0.0.1-test (this image as N-1, its bundle served over HTTP):
#   printf 'FROM supabase-helpdesk:ci\nENV HELPDESK_VERSION=0.0.1-test\n' | docker build -t supabase-helpdesk:0.0.1-test -
#   bash deploy/scripts/pack-bundle.sh 0.0.1-test /tmp/releases/v0.0.1-test/helpdesk-deploy-v0.0.1-test.tar.gz
#   docker run -d --rm --name fake-releases -p 8099:80 -v /tmp/releases:/www:ro busybox:1.37 httpd -f -h /www
#   FROM_RELEASE=1 FROM_RELEASE_VERSION=0.0.1-test FROM_RELEASE_IMAGE=supabase-helpdesk \
#     HELPDESK_RELEASES_URL=http://localhost:8099 bash .github/scripts/bundle-e2e.sh
set -euo pipefail
export MSYS_NO_PATHCONV=1
# COMPOSE_FILE in .env is colon-separated; docker.exe on Windows splits on ';'.
export COMPOSE_PATH_SEPARATOR=:

ROOT="$(git rev-parse --show-toplevel)"
IMAGE="${IMAGE:-supabase-helpdesk}"      # repository; the tag is the version
VERSION="${VERSION:-ci}"                  # must equal the image's HELPDESK_VERSION
FROM_RELEASE="${FROM_RELEASE:-0}"
REPO="${GITHUB_REPOSITORY:-surveyjs/supabase-helpdesk}"
if [[ "$FROM_RELEASE" == 1 ]]; then WORK_NAME=bundle-e2e-upgrade; else WORK_NAME=bundle-e2e; fi
WORK="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/$WORK_NAME"
DIR="$WORK/helpdesk" OUT="$WORK/out"
SUMMARY="${GITHUB_STEP_SUMMARY:-$OUT/summary.md}"
APP_URL=http://localhost
ADMIN_EMAIL=admin@example.com
native_path() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else echo "$1"; fi; }

# Database files from a previous run belong to the container's user.
[[ -d "$WORK" ]] && docker run --rm -v "$(native_path "$WORK"):/w" alpine:3.22 rm -rf /w/helpdesk /w/out
rm -rf "$WORK"; mkdir -p "$DIR" "$OUT"

latest_release() { # the X.Y.Z of REPO's latest stable release; nothing if it has none
  local auth=() body="$OUT/latest-release.json" code tag
  if [[ -n "${GH_TOKEN:-}" ]]; then auth=(-H "Authorization: Bearer $GH_TOKEN"); fi
  code="$(curl -sS -o "$(native_path "$body")" -w '%{http_code}' --retry 3 --retry-all-errors "${auth[@]}" -H 'Accept: application/vnd.github+json' \
            "${GITHUB_API_URL:-https://api.github.com}/repos/$REPO/releases/latest")" \
    || { echo "cannot reach the GitHub API for the latest release of $REPO" >&2; return 1; }
  case "$code" in
    404) return 0 ;;
    200) tag="$(grep -o '"tag_name": *"[^"]*"' "$body" | head -n 1 | sed 's/.*"\([^"]*\)"$/\1/')"
         [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] \
           || { echo "the latest release of $REPO has the tag '$tag', not vX.Y.Z" >&2; return 1; }
         echo "${tag#v}" ;;
    *) echo "GitHub API: HTTP $code for the latest release of $REPO: $(head -c 300 "$body")" >&2; return 1 ;;
  esac
}

# What gets installed (BASE) and what it is upgraded to (NEXT).
if [[ "$FROM_RELEASE" == 1 ]]; then
  BASE="${FROM_RELEASE_VERSION:-}"
  if [[ -z "$BASE" ]]; then BASE="$(latest_release)"; fi
  if [[ -z "$BASE" ]]; then
    echo "## Bundle e2e: upgrade from the latest release to $IMAGE:$VERSION" >> "$SUMMARY"
    echo "⏭️ $REPO has no stable release yet: the upgrade from N-1 is skipped" | tee -a "$SUMMARY"
    exit 0
  fi
  NEXT="$VERSION"
  FROM_IMAGE="${FROM_RELEASE_IMAGE:-ghcr.io/${REPO,,}}"
  RELEASES_URL="${HELPDESK_RELEASES_URL:-https://github.com/$REPO/releases/download}"
  BUNDLE_URL="$RELEASES_URL/v$BASE/helpdesk-deploy-v$BASE.tar.gz"
  if [[ "${FROM_RELEASE_DRY_RUN:-0}" == 1 ]]; then   # what would be installed; nothing runs
    printf 'version=%s\nimage=%s:%s\nbundle=%s\n' "$BASE" "$FROM_IMAGE" "$BASE" "$BUNDLE_URL"
    exit 0
  fi
else
  BASE="$VERSION" NEXT="$VERSION-next"
fi

fails=0
pass() { echo "✅ $1" | tee -a "$SUMMARY"; }
fail() { echo "❌ $1" | tee -a "$SUMMARY"; fails=$((fails + 1)); }
compose() { (cd "$DIR" && docker compose "$@"); }
cleanup() {
  compose logs --no-color > "$OUT/compose.log" 2>&1 || true
  compose --profile tools down -v --remove-orphans >/dev/null 2>&1 || true
  echo "Logs: $OUT" >> "$SUMMARY"
}
trap cleanup EXIT
wait_for() { # wait_for <description> <seconds> <command...>; records ✅/❌, never aborts the run
  local d="$1" t="$2"; shift 2
  local end=$((SECONDS + t))
  until "$@" >/dev/null 2>&1; do
    (( SECONDS < end )) || { fail "$d (timed out after ${t}s)"; return 0; }
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

# --- install -------------------------------------------------------------------------
if [[ "$FROM_RELEASE" == 1 ]]; then
  echo "## Bundle e2e: upgrade from release v$BASE ($FROM_IMAGE:$BASE) to $IMAGE:$VERSION" >> "$SUMMARY"
  if ! curl -fsSL --retry 3 --retry-all-errors "$BUNDLE_URL" -o "$(native_path "$WORK/bundle-$BASE.tgz")"; then
    fail "cannot download the bundle of v$BASE from $BUNDLE_URL"; exit 1
  fi
  if ! docker image inspect "$FROM_IMAGE:$BASE" >/dev/null 2>&1 && ! docker pull -q "$FROM_IMAGE:$BASE"; then
    fail "cannot pull the image of v$BASE, $FROM_IMAGE:$BASE"; exit 1
  fi
  docker tag "$FROM_IMAGE:$BASE" "$IMAGE:$BASE"
  pass "release v$BASE: the bundle downloaded from $RELEASES_URL, the image $FROM_IMAGE:$BASE"
else
  echo "## Bundle e2e: $IMAGE:$VERSION" >> "$SUMMARY"
  if bash "$ROOT/deploy/tests/pack-bundle.test.sh" > "$OUT/pack-bundle-test.log" 2>&1; then
    pass "the bundle holds what git tracks in deploy/, no ignored files (.env, data, snippets)"
  else
    fail "pack-bundle.sh packs the wrong files"; cat "$OUT/pack-bundle-test.log"
  fi
  bash "$ROOT/deploy/scripts/pack-bundle.sh" "$BASE" "$WORK/bundle-$BASE.tgz" >/dev/null
fi
tar --no-same-owner -xzf "$WORK/bundle-$BASE.tgz" -C "$DIR"
docker run --rm "$IMAGE:$BASE" init-env --mode bundled --app-url "$APP_URL" --version "$BASE" > "$DIR/.env"
printf 'HELPDESK_IMAGE=%s\n' "$IMAGE" >> "$DIR/.env"
sed -i 's/^ENABLE_EMAIL_AUTOCONFIRM=.*/ENABLE_EMAIL_AUTOCONFIRM=true/' "$DIR/.env"   # no SMTP in CI

# The README's order: migrate, then up. The app started first refuses and says
# why (checked for this image, not for a release).
if [[ "$FROM_RELEASE" != 1 ]]; then
  set +e; compose run --rm -T app > "$OUT/app-before-migrate.log" 2>&1; rc=$?; set -e
  if [[ $rc == 78 ]] && grep -q 'Run the migration explicitly' "$OUT/app-before-migrate.log"; then
    pass "app refuses to start before migrate (exit 78) and says what to do"
  else
    fail "app before migrate: exit $rc, expected 78 and 'Run the migration explicitly'"; tail -30 "$OUT/app-before-migrate.log"
  fi
fi

# On a fresh stack: needs the auth and storage schemas their services create.
if compose run --rm -T migrate --backup-confirmed > "$OUT/install-migrate.log" 2>&1; then
  pass "migrate --backup-confirmed builds the schema of the new installation"
else
  fail "migrate failed on the new installation"; tail -30 "$OUT/install-migrate.log"
fi
compose up -d
wait_for "HelpDesk $BASE answers through the proxy" 180 health_is "$BASE"

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

# --- upgrade, then roll back -----------------------------------------------------------
snapshots() { find "$DIR/backups" -name 'db-*.tar.gz' 2>/dev/null | wc -l | tr -d ' '; }
upgrade() { # upgrade <log name> <args...>: sets rc
  local name="$1"; shift
  set +e; "$DIR/upgrade.sh" "$@" </dev/null > "$OUT/$name.log" 2>&1; rc=$?; set -e
}

if [[ "$FROM_RELEASE" == 1 ]]; then
  # To this image, with its bundle, by the release's own upgrade.sh. Pending
  # migrations (or a new Supabase) mean a snapshot, which --rollback restores.
  applied() { compose exec -T db psql -U postgres -tAc \
    "select coalesce(string_agg(version, ' ' order by version), '') from supabase_migrations.schema_migrations" | tr -d '\r'; }
  count() { wc -w <<<"$1" | tr -d ' '; }
  before="$(applied)"
  if bash "$ROOT/deploy/scripts/pack-bundle.sh" "$NEXT" "$WORK/bundle-$NEXT.tgz" > "$OUT/pack-next.log" 2>&1; then
    upgrade upgrade --bundle "$WORK/bundle-$NEXT.tgz" --migrate "$NEXT"
    after="$(applied)"
    if [[ $rc == 0 ]] && health_is "$NEXT"; then
      pass "upgrade --migrate from v$BASE runs $NEXT ($(( $(count "$after") - $(count "$before") )) new migrations, database snapshots: $(snapshots))"
    else
      fail "upgrade from v$BASE: exit $rc, version $(health_version)"; tail -40 "$OUT/upgrade.log"
    fi
    if [[ "$after" != "$before" && "$(snapshots)" != 1 ]]; then
      fail "the migrations changed, but there are $(snapshots) database snapshots instead of 1"
    fi
    login upgraded

    upgrade rollback --rollback --yes
    if [[ $rc == 0 ]] && health_is "$BASE" && [[ "$(applied)" == "$before" && ! -e "$DIR/.upgrade-state" ]]; then
      pass "--rollback restores v$BASE and its migration history"
    else
      fail "rollback: exit $rc, version $(health_version), $(count "$(applied)") migrations (before the upgrade: $(count "$before"))"
      tail -40 "$OUT/rollback.log"
    fi
    login rolled-back
  else
    fail "cannot pack the bundle of $NEXT"; tail -30 "$OUT/pack-next.log"
  fi
  exit $(( fails > 0 ))
fi

# The next version: this image plus one migration (spec: a synthetic next version).
printf 'create table if not exists public.bundle_e2e_marker (id int);\n' > "$WORK/999_bundle_e2e.sql"
printf 'FROM %s:%s\nCOPY 999_bundle_e2e.sql /app/supabase/migrations/\nENV HELPDESK_VERSION=%s\n' \
  "$IMAGE" "$VERSION" "$NEXT" > "$WORK/Dockerfile.next"
marker() { compose exec -T db psql -U postgres -tAc "select to_regclass('public.bundle_e2e_marker') is not null" | tr -d '\r '; }

if docker build -q -t "$IMAGE:$NEXT" -f "$(native_path "$WORK/Dockerfile.next")" "$(native_path "$WORK")" > "$OUT/build-next.log" 2>&1 \
   && bash "$ROOT/deploy/scripts/pack-bundle.sh" "$NEXT" "$WORK/bundle-$NEXT.tgz" >> "$OUT/build-next.log" 2>&1; then
  upgrade upgrade-unconfirmed --bundle "$WORK/bundle-$NEXT.tgz" "$NEXT"
  if [[ $rc == 2 ]] && health_is "$VERSION" && [[ "$(marker)" == f ]]; then
    pass "upgrade without --migrate and without a terminal stops, nothing changed (exit 2)"
  else
    fail "unconfirmed upgrade: exit $rc, version $(health_version), marker $(marker)"; tail -30 "$OUT/upgrade-unconfirmed.log"
  fi

  upgrade upgrade --bundle "$WORK/bundle-$NEXT.tgz" --migrate "$NEXT"
  if [[ $rc == 0 ]] && health_is "$NEXT" && [[ "$(marker)" == t && "$(snapshots)" == 1 ]]; then
    pass "upgrade --migrate snapshots the database, migrates and runs $NEXT"
  else
    fail "upgrade: exit $rc, version $(health_version), marker $(marker), snapshots $(snapshots)"; tail -40 "$OUT/upgrade.log"
  fi
  login upgraded

  upgrade rollback --rollback --yes
  if [[ $rc == 0 ]] && health_is "$VERSION" && [[ "$(marker)" == f && ! -e "$DIR/.upgrade-state" ]]; then
    pass "--rollback restores the database and $VERSION"
  else
    fail "rollback: exit $rc, version $(health_version), marker $(marker)"; tail -40 "$OUT/rollback.log"
  fi
  login rolled-back
else
  fail "cannot build the next version $IMAGE:$NEXT or its bundle"; tail -30 "$OUT/build-next.log"
fi

exit $(( fails > 0 ))
