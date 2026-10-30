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
  psql_rc=0
  psql "$DB" -X -q -o /dev/null -v ON_ERROR_STOP=1 <<SQL || psql_rc=$?
select pg_advisory_lock($LOCK_KEY);
\! MIGRATE_LOCKED=1 sh $0 $* 1>&2; echo \$? > $rcfile
select 1;
SQL
  rc="$(cat "$rcfile")"; rm -f "$rcfile"
  if [ "$psql_rc" != 0 ]; then
    if [ -n "$rc" ] && [ "$rc" != 0 ]; then exit "$rc"; fi
    if [ -n "$rc" ]; then log "the migration lock session was lost during the run"
    else log "could not take the migration lock (connection or lock error, see above)"; fi
    exit 1
  fi
  exit "${rc:-1}"
fi

have_history="$(psql "$DB" -X -qtA -v ON_ERROR_STOP=1 -c "select to_regclass('supabase_migrations.schema_migrations') is not null")" \
  || { log "cannot query the database (see above)"; exit 1; }
applied=""
if [ "$have_history" = t ]; then
  applied="$(psql "$DB" -X -qtA -v ON_ERROR_STOP=1 -c 'select version from supabase_migrations.schema_migrations order by 1')" \
    || { log "cannot read the migration history"; exit 1; }
fi
vars="$(printf '%s\n' "$applied" | node /app/docker/versions-cli.mjs "$MIG")" || exit 1
eval "$vars"
log "image: $image | database: ${db:-<empty>}"
case "$status" in
  ok)       log "up to date"; exit 0 ;;
  newer)    log "database is newer than this image (unknown here: $dbonly); nothing changed"; exit 4 ;;
  diverged) log "history diverged: pending here [$pending], unknown here [$dbonly]; nothing changed"; exit 3 ;;
  pending)  ;;
  *)        log "unexpected status: $status"; exit 1 ;;
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
