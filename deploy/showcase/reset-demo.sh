#!/usr/bin/env bash
#
# Nightly reset of the SHOWCASE (public demo) instance back to a pristine
# baseline so the public demo never accumulates junk or stray accounts.
#
# Strategy: restore a baseline dump captured once, right after the instance was
# first provisioned (migrations applied + supabase/seed.sql loaded + the demo
# admin/agent accounts created). The dump is a Postgres custom-format archive
# that includes the public + auth + storage data, so a single restore rewinds
# users and storage rows together.
#
# DO NOT run this against the internal instance — it destroys all data.
#
# One-time baseline capture (run after first provisioning the demo):
#   cd /opt/helpdesk/showcase
#   docker compose -p helpdesk-showcase exec -T db \
#     pg_dump -U postgres -Fc -n public -n auth -n storage postgres \
#     > /opt/helpdesk/showcase/baseline.dump
#
# Schedule (root crontab) — every night at 04:00:
#   0 4 * * * /opt/helpdesk/showcase/reset-demo.sh >> /var/log/helpdesk-demo-reset.log 2>&1
set -euo pipefail

# Directory of the showcase stack on the demos machine. Override via env if the
# demos host lays examples out differently (e.g. /opt/demos/helpdesk).
INSTANCE_DIR="${INSTANCE_DIR:-/opt/demos/helpdesk}"
PROJECT="helpdesk-showcase"
BASELINE="${INSTANCE_DIR}/baseline.dump"

cd "$INSTANCE_DIR"

if [[ ! -f "$BASELINE" ]]; then
  echo "[$(date -Is)] ERROR: baseline dump not found at $BASELINE — capture it first (see header)." >&2
  exit 1
fi

echo "[$(date -Is)] Resetting demo from baseline..."

# --clean --if-exists drops the existing demo objects before reloading. The
# baseline only spans public/auth/storage, so the rest of the stack is untouched.
docker compose -p "$PROJECT" exec -T db \
  pg_restore -U postgres -d postgres --clean --if-exists --no-owner < "$BASELINE"

# Restart the app so any cached state is dropped.
docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.app.yml restart app

echo "[$(date -Is)] Demo reset complete."
