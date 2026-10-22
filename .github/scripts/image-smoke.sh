#!/usr/bin/env bash
# Smoke test of the release image against a real local Supabase stack that
# starts with NO schema: the explicit `migrate` command (dry run, backup
# confirmation, lock, refusals) and the app's startup schema check. CI: job
# image-smoke. Locally (Git Bash + Docker), stops this project's local stack and
# WIPES its data (volumes are dropped):
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
trap 'supabase stop --workdir "$(native_path "$PROJ")" --no-backup >/dev/null 2>&1 || true' EXIT
supabase start --workdir "$(native_path "$PROJ")" -x "$EXCLUDE"

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

BEFORE="$(applied)"
V="$(variant newer 1)"
run newer -v "$V:/app/supabase/migrations:ro" -- migrate --backup-confirmed
expect_run newer 4 "database is newer than this image" "an older image refuses to migrate (exit 4)"
expect_eq "$(applied)" "$BEFORE" "the exit-4 refusal changes nothing"

# Image: repo + 992; database: repo + 990 -> pending 992, unknown here 990.
V="$(variant diverged 0 992_other.sql "select 1;")"
run diverged -v "$V:/app/supabase/migrations:ro" -- migrate --backup-confirmed
expect_run diverged 3 "history diverged" "diverged history is refused (exit 3)"
expect_eq "$(applied)" "$BEFORE" "the exit-3 refusal changes nothing"

# Duplicate version in the image's migrations: versions-cli fails -> exit 1, not 2.
V="$(variant dup 0 003_duplicate.sql "select 1;")"
run dup -v "$V:/app/supabase/migrations:ro" -- migrate --backup-confirmed
expect_run dup 1 "Duplicate migration version 003" "a duplicate migration version is an error (exit 1)"
expect_eq "$(applied)" "$BEFORE" "the exit-1 error changes nothing"

echo "Logs: $OUT" >> "$SUMMARY"
exit $(( fails > 0 ))
