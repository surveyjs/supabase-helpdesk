#!/usr/bin/env bash
#
# Auto-deploy pipeline, triggered by the webhook receiver on a verified GitHub
# push to the deploy branch (default: main). Invoked as:
#
#     redeploy.sh <ref> <after-sha>
#
# e.g.  redeploy.sh refs/heads/main 1a2b3c4...
#
# This deploys exactly ONE instance — the one running on THIS machine. Set
# INSTANCE=internal | showcase in the webhook unit's EnvironmentFile
# (/etc/helpdesk-webhook.env). The internal helpdesk and the public demo live
# on SEPARATE machines, each with its own checkout + webhook + this script.
#
# Steps:
#   1. fast-forward the local checkout to the pushed commit
#   2. (internal only) back up the DB, and refuse if the DB has been wiped
#   3. apply any new DB migrations (forward-only)
#   4. rebuild the app image (NEXT_PUBLIC_* build args) + recreate the app
#   5. health-check the new container
#
# Idempotent and safe to re-run. Logs to stdout (captured by the webhook unit).
set -euo pipefail

REF="${1:-}"
AFTER="${2:-}"
DEPLOY_BRANCH="refs/heads/main"

# Paths (override in the webhook unit's EnvironmentFile to match this machine).
# Demos machine, for example: ROOT=/opt/demos/helpdesk  SRC=/opt/demos/helpdesk/src
ROOT="${ROOT:-/opt/helpdesk}"
SRC="${SRC:-${ROOT}/src}"

# Which instance this machine hosts. Override via env (set in the webhook unit).
INSTANCE="${INSTANCE:-}"

log() { echo "[$(date -Is)] $*"; }

if [[ "$REF" != "$DEPLOY_BRANCH" ]]; then
  log "Ignoring push to $REF (deploy branch is $DEPLOY_BRANCH)."
  exit 0
fi

# --- 1. Sync source --------------------------------------------------------
log "Syncing $SRC to ${AFTER:-origin/main}"
cd "$SRC"
git fetch --quiet origin
if [[ -n "$AFTER" ]]; then
  git reset --hard "$AFTER"
else
  git reset --hard origin/main
fi

# DATA DURABILITY CONTRACT (internal instance holds real customer data):
#   * This script NEVER tears down stateful services and NEVER passes `-v`.
#   * It only rebuilds/recreates the stateless `app` service.
#   * It NEVER runs `supabase db reset` or drops schema — migrations are
#     forward-only via `db push`.
#   * Postgres/Storage data lives in named volumes OUTSIDE this checkout, so
#     `git reset --hard` on $SRC (above) cannot touch it.
#   * Instances flagged `backup` are pg_dump'd before any migration.
#
# Per-instance config: dir | compose project | backup?(yes|no) | guard?(yes|no)
# The internal helpdesk holds real data (back up + wiped-DB guard); the public
# demo is throwaway (no backup, no guard — it is reset nightly).
case "$INSTANCE" in
  internal) I_DIR="${ROOT}/internal"; I_PROJECT="helpdesk-internal"; I_BACKUP=yes; I_GUARD=yes ;;
  showcase) I_DIR="${ROOT}/showcase"; I_PROJECT="helpdesk-showcase"; I_BACKUP=no;  I_GUARD=no  ;;
  *) log "ERROR: set INSTANCE=internal|showcase in the environment (got '${INSTANCE}')."; exit 2 ;;
esac
# The instance's stack dir (vendored supabase compose + overlay + .env) may not
# follow ${ROOT}/${INSTANCE} (e.g. the demos machine). Override with INSTANCE_DIR.
I_DIR="${INSTANCE_DIR:-$I_DIR}"

BACKUP_DIR="${ROOT}/backups"
BACKUP_RETENTION=14   # keep this many pre-migrate dumps per instance

# Refuse to deploy/start a real-data instance whose database has been wiped.
# Detection: the DB must be reachable AND already contain data. Gated by a
# one-time marker (<dir>/.initialized) so first provisioning is not blocked —
# create it once after the instance is provisioned and the data is loaded:
#     touch /opt/helpdesk/internal/.initialized
# After the marker exists, an empty/missing DB aborts the deploy BEFORE any
# migration or app start, so the loss fails loudly instead of silently serving
# (and re-seeding) an empty database.
guard_data_present() {
  local name="$1" dir="$2" project="$3"
  local marker="${dir}/.initialized"

  if [[ ! -f "$marker" ]]; then
    log "[$name] No ${marker} — treating as first provision; data guard skipped."
    return 0
  fi

  # Optional explicit named-volume check (set DB_DATA_VOLUME in .env to enable).
  if [[ -n "${DB_DATA_VOLUME:-}" ]]; then
    if ! docker volume inspect "$DB_DATA_VOLUME" >/dev/null 2>&1; then
      log "[$name] GUARD FAILED: expected DB volume '$DB_DATA_VOLUME' is missing." >&2
      return 1
    fi
  fi

  # Core check: DB reachable and populated. `tickets` is a real data table that
  # only exists/has rows once the schema is migrated and data is present.
  local rows
  rows=$(docker compose -p "$project" exec -T db \
    psql -U postgres -d postgres -tAc \
    "SELECT count(*) FROM public.tickets;" 2>/dev/null | tr -d '[:space:]' || true)

  if [[ -z "$rows" || ! "$rows" =~ ^[0-9]+$ ]]; then
    log "[$name] GUARD FAILED: cannot read public.tickets — DB is unreachable or" >&2
    log "[$name]   freshly created (volume wiped?). Refusing to migrate/start the app." >&2
    log "[$name]   Investigate the data volume before re-running. Marker: ${marker}" >&2
    return 1
  fi

  log "[$name] Data guard OK (public.tickets rows=${rows})."
  return 0
}

backup_db() {
  local name="$1" project="$2"
  mkdir -p "$BACKUP_DIR"
  local out="${BACKUP_DIR}/${name}-premigrate-$(date +%Y%m%dT%H%M%S).dump"
  log "[$name] Backing up DB before migration -> $out"
  # -Fc custom format; whole DB (public + auth + storage rows). Fail the deploy
  # if the backup fails — we do NOT migrate real data without a fresh dump.
  docker compose -p "$project" exec -T db \
    pg_dump -U postgres -Fc postgres > "$out"
  # Retention: keep the newest $BACKUP_RETENTION dumps for this instance.
  ls -1t "${BACKUP_DIR}/${name}-premigrate-"*.dump 2>/dev/null \
    | tail -n +"$((BACKUP_RETENTION + 1))" | xargs -r rm -f
}

deploy_instance() {
  local name="$1" dir="$2" project="$3" backup="$4" guard="$5"
  log "=== Deploying '$name' ==="
  cd "$dir"

  # Load this instance's env (ANON_KEY, NEXT_PUBLIC_*, POSTGRES_HOST_PORT, ...)
  set -a; # shellcheck disable=SC1091
  source "${dir}/.env"; set +a

  # --- 1b. Refuse to proceed if a real-data DB has been wiped --------------
  if [[ "$guard" == "yes" ]]; then
    guard_data_present "$name" "$dir" "$project" || return 1
  fi

  # --- 2. Back up (real-data instances), then apply migrations -------------
  if [[ "$backup" == "yes" ]]; then
    backup_db "$name" "$project"
  fi
  # Migrations live in the shared checkout; push them to this instance's DB.
  # Forward-only — never `db reset`. Existing rows are preserved.
  local db_url="postgresql://postgres:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_HOST_PORT}/postgres"
  log "[$name] Applying migrations via supabase db push"
  ( cd "$SRC" && supabase db push --db-url "$db_url" --include-all )

  # --- 3. Rebuild + recreate ONLY the stateless app service ----------------
  # No `down`, no `-v` — db/auth/storage/kong keep running on their volumes.
  log "[$name] Building + recreating app container"
  docker compose -p "$project" \
    -f docker-compose.yml -f docker-compose.app.yml \
    up -d --build app

  # --- 4. Health check -----------------------------------------------------
  log "[$name] Waiting for health check"
  local container="helpdesk-${name}-app"
  for i in $(seq 1 30); do
    if docker exec "$container" wget -q -T2 --spider http://127.0.0.1:3001/api/health 2>/dev/null; then
      log "[$name] Healthy."
      return 0
    fi
    sleep 2
  done
  log "[$name] ERROR: health check failed after new deploy." >&2
  return 1
}

rc=0
if ! deploy_instance "$INSTANCE" "$I_DIR" "$I_PROJECT" "$I_BACKUP" "$I_GUARD"; then
  rc=1
  log "Deploy of '$INSTANCE' FAILED."
fi

log "Redeploy finished (exit $rc)."
exit "$rc"
