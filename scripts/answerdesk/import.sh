#!/usr/bin/env bash
# AnswerDesk -> HelpDesk import driver for a local deploy-bundle instance
# (bundled Supabase, DB container `supabase-db`). See README.md next to this file.
#
#   scripts/answerdesk/import.sh prepare   # source CSVs -> $WORK/*.tsv (+ report.txt)
#   scripts/answerdesk/import.sh upload    # blobs -> Storage attachments/migrated/<id>
#   scripts/answerdesk/import.sh load      # $WORK/*.tsv -> database (one transaction)
#   scripts/answerdesk/import.sh all       # prepare + upload + load
#   scripts/answerdesk/import.sh relink    # rewrite cross-ticket references in imported posts
#   scripts/answerdesk/import.sh test-relink  # self-test of relink.sql on synthetic data (rolled back)
#   scripts/answerdesk/import.sh status    # what is imported so far
#   scripts/answerdesk/import.sh reset     # remove imported tickets and created users
#
# Settings (env vars):
#   PKG                                export package dir (required)
#   WORK=$PKG/work                     staging dir (holds customer data; keep outside the repo)
#   DEPLOY                             deploy bundle dir, its .env has SERVICE_ROLE_KEY (required for upload)
#   FRACTION=0.1                       share of tickets to import (deterministic sample)
#   ADMIN_EMAIL=                       source user who becomes admin (others in UserInRole -> agent)
#   API_URL=http://127.0.0.1:8000      Supabase API gateway, for Storage uploads
#   KEEP_AUTOMATED=                    set to 1 to also import automated DMARC report tickets (prepare)
#   DB_CONTAINER=supabase-db
set -euo pipefail
export MSYS_NO_PATHCONV=1 # Git Bash: don't rewrite /tmp/... args passed to docker

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && (pwd -W 2>/dev/null || pwd))" # pwd -W: Windows form for node under Git Bash
# Git Bash: /e/x -> E:/x, since MSYS_NO_PATHCONV stops the automatic conversion for node and docker.
winpath() { if [ -n "$1" ] && command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }
PKG="$(winpath "${PKG:-}")"
WORK="$(winpath "${WORK:-${PKG:+$PKG/work}}")"
DEPLOY="${DEPLOY:-}"
FRACTION="${FRACTION:-0.1}"
ADMIN_EMAIL="${ADMIN_EMAIL:-}"
API_URL="${API_URL:-http://127.0.0.1:8000}"
DB_CONTAINER="${DB_CONTAINER:-supabase-db}"

psql_c() { docker exec -i "$DB_CONTAINER" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 "$@"; }

# need VAR... : stop with a hint when a required setting is empty.
need() {
  local v
  for v in "$@"; do
    [ -n "${!v}" ] || { echo "Set $v (see the header of $0 or README.md)." >&2; exit 2; }
  done
}

prepare() {
  need PKG WORK
  node --max-old-space-size=4096 "$HERE/prepare.mjs" --pkg "$PKG" --out "$WORK" \
    --fraction "$FRACTION" --admin-email "$ADMIN_EMAIL" ${KEEP_AUTOMATED:+--keep-automated}
}

upload() {
  need WORK DEPLOY
  node "$HERE/upload-attachments.mjs" --work "$WORK" --env "$DEPLOY/.env" --url "$API_URL"
}

load() {
  need WORK
  [ -f "$WORK/tickets.tsv" ] || { echo "No staging files in $WORK - run 'prepare' first." >&2; exit 1; }
  [ -f "$WORK/ticket_friendly.tsv" ] || { echo "Staging predates relink support - re-run 'prepare' first." >&2; exit 1; }
  echo "Copying staging files into $DB_CONTAINER:/tmp/adimport ..."
  docker exec "$DB_CONTAINER" rm -rf /tmp/adimport
  docker exec "$DB_CONTAINER" mkdir -p /tmp/adimport
  for f in "$WORK"/*.tsv "$HERE/relink.sql"; do docker cp "$f" "$DB_CONTAINER:/tmp/adimport/" >/dev/null; done
  docker exec -u root "$DB_CONTAINER" chmod -R a+rX /tmp/adimport
  local rc=0
  psql_c -q < "$HERE/load.sql" || rc=$?
  # The staging files hold customer data: never leave them in the container.
  docker exec "$DB_CONTAINER" rm -rf /tmp/adimport
  return $rc
}

# Re-run only the cross-ticket reference rewrite (relink.sql) on an existing import.
relink() {
  need WORK
  [ -f "$WORK/ticket_friendly.tsv" ] || { echo "No $WORK/ticket_friendly.tsv - run 'prepare' first." >&2; exit 1; }
  docker exec "$DB_CONTAINER" rm -rf /tmp/adimport
  docker exec "$DB_CONTAINER" mkdir -p /tmp/adimport
  docker cp "$WORK/ticket_friendly.tsv" "$DB_CONTAINER:/tmp/adimport/" >/dev/null
  docker cp "$HERE/relink.sql" "$DB_CONTAINER:/tmp/adimport/" >/dev/null
  docker exec -u root "$DB_CONTAINER" chmod -R a+rX /tmp/adimport
  local rc=0
  psql_c -q -t -A <<'SQL' || rc=$?
SET client_min_messages = warning; -- no NOTICE noise; the counts are one SELECT row below
BEGIN;
\i /tmp/adimport/relink.sql
CREATE TEMP TABLE relink_before ON COMMIT DROP AS SELECT count(*) AS n FROM public.posts WHERE body LIKE '%FriendlyId%';
CREATE TEMP TABLE relink_changed ON COMMIT DROP AS SELECT adimport.relink_ticket_refs() AS n;
SELECT 'posts with FriendlyId before: ' || (SELECT n FROM relink_before)
  || ', posts changed: ' || (SELECT n FROM relink_changed)
  || ', posts with FriendlyId after: ' || (SELECT count(*) FROM public.posts WHERE body LIKE '%FriendlyId%');
COMMIT;
SQL
  docker exec "$DB_CONTAINER" rm -rf /tmp/adimport
  return $rc
}

# Self-test of relink.sql on synthetic data only (relink.test.sql); rolled back, DB unchanged.
test_relink() {
  docker exec "$DB_CONTAINER" rm -rf /tmp/adimport
  docker exec "$DB_CONTAINER" mkdir -p /tmp/adimport
  # Synthetic ticket_friendly.tsv: 4504 appears twice (high legacy_id first) to test the duplicate rule.
  docker exec "$DB_CONTAINER" sh -c "printf '4502	00000000-0000-4000-8000-000000000001
4503	00000000-0000-4000-8000-000000000002
4504	00000000-0000-4000-8000-000000000005
4504	00000000-0000-4000-8000-000000000004
' > /tmp/adimport/ticket_friendly.tsv"
  docker cp "$HERE/relink.sql" "$DB_CONTAINER:/tmp/adimport/" >/dev/null
  docker cp "$HERE/relink.test.sql" "$DB_CONTAINER:/tmp/adimport/" >/dev/null
  docker exec -u root "$DB_CONTAINER" chmod -R a+rX /tmp/adimport
  local rc=0
  psql_c -q -t -A -f /tmp/adimport/relink.test.sql || rc=$?
  [ $rc -eq 0 ] && echo "relink tests passed"
  docker exec "$DB_CONTAINER" rm -rf /tmp/adimport
  return $rc
}

status() {
  psql_c -c "select ran_at, summary from adimport.runs order by id desc limit 1" -x \
    || echo "(no import yet)"
}

reset() {
  read -r -p "Delete ALL imported tickets and the accounts the import created in $DB_CONTAINER? [y/N] " ans
  [ "$ans" = "y" ] || { echo "aborted"; exit 1; }
  psql_c -q < "$HERE/reset.sql"
  echo "Note: blobs under Storage attachments/migrated/ were kept (see README to remove them)."
}

case "${1:-}" in
  prepare) prepare ;;
  upload) upload ;;
  load) load ;;
  all) prepare && upload && load ;;
  relink) relink ;;
  test-relink) test_relink ;;
  status) status ;;
  reset) reset ;;
  *) sed -n '2,20p' "$0"; exit 2 ;;
esac
