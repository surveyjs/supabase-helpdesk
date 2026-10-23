#!/usr/bin/env bash
# End-to-end test of the deploy bundle with the bundled Supabase stack, run the
# way an operator runs it (README.md, Install): pack -> init-env -> (app refuses
# before migrate) -> migrate -> up -> admin create -> sign in through the proxy on
# one domain. Also checks that pack-bundle.sh leaks no ignored files.
# Then upgrade.sh to a next version (this image + one migration) and --rollback.
# CI: job bundle-e2e.
# Locally (Linux, or Git Bash + Docker Desktop; needs port 80 and Supabase's
# fixed container names supabase-*, so no other official-compose stack may run):
#   docker build -t supabase-helpdesk:ci --build-arg HELPDESK_VERSION=ci .
#   bash .github/scripts/bundle-e2e.sh
set -euo pipefail
export MSYS_NO_PATHCONV=1
# COMPOSE_FILE in .env is colon-separated; docker.exe on Windows splits on ';'.
export COMPOSE_PATH_SEPARATOR=:

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
echo "## Bundle e2e: $IMAGE:$VERSION" >> "$SUMMARY"

# --- install -------------------------------------------------------------------------
if bash "$ROOT/deploy/tests/pack-bundle.test.sh" > "$OUT/pack-bundle-test.log" 2>&1; then
  pass "the bundle holds what git tracks in deploy/, no ignored files (.env, data, snippets)"
else
  fail "pack-bundle.sh packs the wrong files"; cat "$OUT/pack-bundle-test.log"
fi
bash "$ROOT/deploy/scripts/pack-bundle.sh" "$VERSION" "$WORK/bundle-$VERSION.tgz" >/dev/null
tar -xzf "$WORK/bundle-$VERSION.tgz" -C "$DIR"
docker run --rm "$IMAGE:$VERSION" init-env --mode bundled --app-url "$APP_URL" --version "$VERSION" > "$DIR/.env"
printf 'HELPDESK_IMAGE=%s\n' "$IMAGE" >> "$DIR/.env"
sed -i 's/^ENABLE_EMAIL_AUTOCONFIRM=.*/ENABLE_EMAIL_AUTOCONFIRM=true/' "$DIR/.env"   # no SMTP in CI

# The README's order: migrate, then up. The app started first refuses and says why.
set +e; compose run --rm -T app > "$OUT/app-before-migrate.log" 2>&1; rc=$?; set -e
if [[ $rc == 78 ]] && grep -q 'Run the migration explicitly' "$OUT/app-before-migrate.log"; then
  pass "app refuses to start before migrate (exit 78) and says what to do"
else
  fail "app before migrate: exit $rc, expected 78 and 'Run the migration explicitly'"; tail -30 "$OUT/app-before-migrate.log"
fi

# On a fresh stack: needs the auth and storage schemas their services create.
if compose run --rm -T migrate --backup-confirmed > "$OUT/install-migrate.log" 2>&1; then
  pass "migrate --backup-confirmed builds the schema of the new installation"
else
  fail "migrate failed on the new installation"; tail -30 "$OUT/install-migrate.log"
fi
compose up -d
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

# --- upgrade to a next version with a new migration, then roll back --------------------
# The next version: this image plus one migration (spec: a synthetic next version).
NEXT="$VERSION-next"
printf 'create table if not exists public.bundle_e2e_marker (id int);\n' > "$WORK/999_bundle_e2e.sql"
printf 'FROM %s:%s\nCOPY 999_bundle_e2e.sql /app/supabase/migrations/\nENV HELPDESK_VERSION=%s\n' \
  "$IMAGE" "$VERSION" "$NEXT" > "$WORK/Dockerfile.next"
marker() { compose exec -T db psql -U postgres -tAc "select to_regclass('public.bundle_e2e_marker') is not null" | tr -d '\r '; }
snapshots() { find "$DIR/backups" -name 'db-*.tar.gz' 2>/dev/null | wc -l | tr -d ' '; }
upgrade() { # upgrade <log name> <args...>: sets rc
  local name="$1"; shift
  set +e; "$DIR/upgrade.sh" "$@" </dev/null > "$OUT/$name.log" 2>&1; rc=$?; set -e
}

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
