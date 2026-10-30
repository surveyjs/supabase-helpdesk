#!/usr/bin/env bash
# Tests of deploy/upgrade.sh's decisions against a stub `docker`: confirmation,
# snapshot, failure paths, rollback. The real path is .github/scripts/bundle-e2e.sh.
#   bash deploy/tests/upgrade.test.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DEPLOY="$(dirname "$HERE")"
PENDING='[migrate] dry run: would apply 004 005'
fails=0
dirs=()
trap 'rm -rf "${dirs[@]}"' EXIT

setup() { # setup bundled|external
  T="$(mktemp -d)"; dirs+=("$T")
  mkdir -p "$T/inst" "$T/bin" "$T/b"
  cp "$DEPLOY/upgrade.sh" "$T/inst/"
  cp "$HERE/stub-docker" "$T/bin/docker"; chmod +x "$T/bin/docker"
  if [[ $1 == external ]]; then
    printf 'HELPDESK_VERSION=1.0.0\nCOMPOSE_FILE=compose.yaml\nSUPABASE_URL=https://x.supabase.co\n' > "$T/inst/.env"
  else
    printf 'HELPDESK_VERSION=1.0.0\nCOMPOSE_FILE=compose.yaml:compose.bundled.yaml\nSUPABASE_URL=\n' > "$T/inst/.env"
  fi
  echo old > "$T/inst/compose.yaml"
  echo 1.1.0 > "$T/b/VERSION"; echo new > "$T/b/compose.yaml"
  pack
  export STUB_LOG="$T/calls.log"; : > "$STUB_LOG"
  unset STUB_DRY_RUN STUB_DRY_RUN_RC STUB_DRY_RUN_SLEEP STUB_MIGRATE_RC STUB_SNAPSHOT_RC STUB_RESTORE_RC \
    STUB_OLD_SCHEMA_MATCHES STUB_HEALTH_VERSION STUB_IMAGE_MISSING STUB_HELPER_MISSING STUB_DB_START_RC COMPOSE_FILE
}
# setup's installation and bundle with different Supabase versions (supabase/VENDORED).
revendor() { mkdir -p "$T/inst/supabase" "$T/b/supabase"; echo ref=v1 > "$T/inst/supabase/VENDORED"; echo ref=v2 > "$T/b/supabase/VENDORED"; pack; }
pack() { tar -czf "$T/bundle.tgz" -C "$T/b" .; }
# Runs from $T (not the install directory) with a bundle path relative to $T.
upgrade() { (cd "$T" && PATH="$T/bin:$PATH" HEALTH_TIMEOUT=2 bash inst/upgrade.sh "$@" </dev/null >"$T/out.log" 2>&1); rc=$?; }
check() { if eval "$2"; then echo "✅ $1"; else echo "❌ $1 (exit $rc)"; sed 's/^/    /' "$T/out.log"; fails=$((fails + 1)); fi; }
called() { grep -qF -- "$1" "$STUB_LOG"; }
version() { sed -n 's/^HELPDESK_VERSION=//p' "$T/inst/.env"; }
files() { cat "$T/inst/compose.yaml"; }
state() { sed -n "s/^$1=//p" "$T/inst/.upgrade-state"; }
archives() { find "$T/inst/backups" -name 'files-*' 2>/dev/null | wc -l | tr -d ' '; }
recreated_all() { grep -qx "docker compose up -d --force-recreate" "$STUB_LOG"; }
# chmod is a no-op on Git Bash/Windows: mode assertions only where it works.
modes_work() { local d; d="$(mktemp -d)"; chmod 755 "$d"; local a; a="$(ls -ld "$d" | cut -c1-10)"; chmod 700 "$d"; local b; b="$(ls -ld "$d" | cut -c1-10)"; rm -rf "$d"; [[ $a == drwxr-xr-x && $b == drwx------ ]]; }

setup bundled; upgrade --bundle bundle.tgz 1.1.0
check "no pending migrations: upgrades without a snapshot" '[[ $rc == 0 && $(version) == 1.1.0 && $(files) == new ]] && ! called "tar -C /src" && ! called "migrate --backup-confirmed"'
check "... and recreates proxy (a new Caddyfile), not the Supabase services" 'called "compose up -d --force-recreate proxy" && ! recreated_all'
if modes_work; then
  check "backups/ is private (700)" '[[ $(ls -ld "$T/inst/backups" | cut -c1-10) == drwx------ ]]'
else
  echo "ℹ️  backups/ mode not checked: chmod has no effect here (Git Bash/Windows)"
fi

setup bundled; STUB_DRY_RUN="$PENDING" upgrade --bundle bundle.tgz 1.1.0
check "pending without a terminal or --migrate: exit 2, nothing changed" '[[ $rc == 2 && $(version) == 1.0.0 && $(files) == old && $(archives) == 0 ]] && ! called "compose stop"'

setup bundled; STUB_DRY_RUN="$PENDING" upgrade --bundle bundle.tgz --migrate 1.1.0
check "pending with --migrate: snapshot, then migrate, then the new version" '[[ $rc == 0 && $(version) == 1.1.0 && $(state previous_version) == 1.0.0 && -s $T/inst/$(state snapshot) ]] && [[ $(grep -n "tar -C /src" "$STUB_LOG" | cut -d: -f1) -lt $(grep -n "migrate --backup-confirmed" "$STUB_LOG" | cut -d: -f1) ]]'
check "... the snapshot is written with umask 077 (private)" 'called "sh -c umask 077; tar -C /src"'
(cd "$T" && PATH="$T/bin:$PATH" HEALTH_TIMEOUT=2 bash inst/upgrade.sh --rollback </dev/null >"$T/out.log" 2>&1); rc=$?
check "--rollback without --yes and without a terminal refuses" '[[ $rc == 1 && $(version) == 1.1.0 ]] && grep -q -- "--yes" "$T/out.log"'
STUB_RESTORE_RC=1 upgrade --rollback --yes
check "--rollback whose restore fails: exit 1, the current database untouched, the way back kept" '[[ $rc == 1 && $(version) == 1.1.0 && -f $T/inst/.upgrade-state ]] && grep -q "untouched" "$T/out.log"'
upgrade --rollback --yes
check "--rollback restores the snapshot, the files and the previous version" '[[ $rc == 0 && $(version) == 1.0.0 && $(files) == old && ! -f $T/inst/.upgrade-state && $(archives) == 0 ]] && called "mv /dst/data.restore/data /dst/data"'
check "... with umask 077, and recreates proxy (the previous Caddyfile)" 'called "sh -c umask 077; rm -rf /dst/data.restore" && [[ $(grep -c "compose up -d --force-recreate proxy" "$STUB_LOG") == 2 ]]'

setup bundled; STUB_DRY_RUN="$PENDING" STUB_SNAPSHOT_RC=1 upgrade --bundle bundle.tgz --migrate 1.1.0
check "snapshot fails: no migration, previous version back, exit 3" '[[ $rc == 3 && $(version) == 1.0.0 && $(files) == old && $(archives) == 0 ]] && ! called "migrate --backup-confirmed"'

setup bundled; STUB_DRY_RUN="$PENDING" STUB_MIGRATE_RC=1 STUB_OLD_SCHEMA_MATCHES=1 upgrade --bundle bundle.tgz --migrate 1.1.0
check "migrate fails, schema unchanged: previous version back, exit 3" '[[ $rc == 3 && $(version) == 1.0.0 && $(files) == old ]]'

setup bundled; STUB_DRY_RUN="$PENDING" STUB_MIGRATE_RC=1 upgrade --bundle bundle.tgz --migrate 1.1.0
check "migrate fails after changing the schema: stopped, exit 4, rollback offered" '[[ $rc == 4 && $(version) == 1.0.0 && $(state incomplete) == 1 ]] && tail -n 1 "$STUB_LOG" | grep -q "compose stop app scheduler" && grep -q -- "--rollback" "$T/out.log"'

setup bundled; STUB_DRY_RUN="$PENDING" STUB_HEALTH_VERSION=1.0.0 upgrade --bundle bundle.tgz --migrate 1.1.0
check "migrated, then the new version never healthy: stopped, exit 4, .env back at the previous version" '[[ $rc == 4 && $(version) == 1.0.0 && $(state incomplete) == 1 ]] && tail -n 1 "$STUB_LOG" | grep -q "compose stop app scheduler"'

setup bundled; STUB_HEALTH_VERSION=1.0.0 upgrade --bundle bundle.tgz 1.1.0
check "new version never healthy, no migrations: previous version back, exit 3" '[[ $rc == 3 && $(version) == 1.0.0 && $(files) == old && $(archives) == 0 ]]'
check "... and proxy recreated on the previous Caddyfile" '[[ $(grep -c "compose up -d --force-recreate proxy" "$STUB_LOG") == 2 ]]'

setup bundled; upgrade --bundle bundle.tgz 1.2.0
check "bundle of another version: exit 1 before any change" '[[ $rc == 1 && $(version) == 1.0.0 && $(files) == old ]] && ! [[ -s "$STUB_LOG" ]]'

setup external; STUB_DRY_RUN="$PENDING" upgrade --bundle bundle.tgz --migrate 1.1.0
check "external Supabase: no snapshot, the PITR restore point is kept" '[[ $rc == 0 && $(state restore_point) == 2026-10-23T10:00:00Z ]] && ! called "tar -C /src"'
upgrade --rollback --yes
check "external --rollback first asks for the PITR restore" '[[ $rc == 1 && $(version) == 1.1.0 ]] && grep -q "2026-10-23T10:00:00Z" "$T/out.log"'
upgrade --rollback --yes --restored
check "external --rollback --restored returns to the previous version" '[[ $rc == 0 && $(version) == 1.0.0 ]]'

# --- stops before anything was stopped: the files go back ------------------------------
setup bundled; STUB_DRY_RUN_RC=1 upgrade --bundle bundle.tgz --migrate 1.1.0
check "dry run fails after the new files were unpacked: exit 1, old files, no archive left" '[[ $rc == 1 && $(version) == 1.0.0 && $(files) == old && $(archives) == 0 && ! -f $T/inst/.upgrade-state ]]'
check "... the dry run starts no dependencies (--no-deps) and the message says to start the stack" 'called "compose run --rm -T --no-deps migrate --dry-run" && grep -q "docker compose up -d" "$T/out.log"'

setup bundled; STUB_IMAGE_MISSING=1 upgrade --bundle bundle.tgz --migrate 1.1.0
check "image missing: exit 1, old files, no archive left" '[[ $rc == 1 && $(version) == 1.0.0 && $(files) == old && $(archives) == 0 ]] && ! called "migrate --dry-run"'

setup bundled; STUB_DRY_RUN="$PENDING" STUB_HELPER_MISSING=1 upgrade --bundle bundle.tgz --migrate 1.1.0
check "helper image for the snapshot missing: exit 1 before anything stops, old files" '[[ $rc == 1 && $(version) == 1.0.0 && $(files) == old && $(archives) == 0 ]] && called "pull -q alpine:3.22" && ! called "compose stop" && grep -q "alpine:3.22" "$T/out.log"'

setup bundled
(cd "$T" && PATH="$T/bin:$PATH" STUB_DRY_RUN_SLEEP=2 exec bash inst/upgrade.sh --bundle bundle.tgz --migrate 1.1.0 </dev/null >"$T/out.log" 2>&1) &
pid=$!
for _ in $(seq 100); do called "migrate --dry-run" && break; sleep 0.1; done
kill -TERM "$pid"; wait "$pid"; rc=$?
check "TERM (like Ctrl-C) before the confirmation: old files back, no archive, no state" '[[ $rc == 143 && $(version) == 1.0.0 && $(files) == old && $(archives) == 0 && ! -f $T/inst/.upgrade-state ]] && ! called "compose stop"'

# --- the way back survives a retry, a failure and rotation ------------------------------
setup bundled; STUB_DRY_RUN="$PENDING" STUB_MIGRATE_RC=1 upgrade --bundle bundle.tgz --migrate 1.1.0
first="$(state snapshot)"
STUB_DRY_RUN="$PENDING" upgrade --bundle bundle.tgz --migrate 1.1.0
check "upgrading again after exit 4 keeps the first snapshot and the way back" '[[ $rc == 0 && $(version) == 1.1.0 && $(state snapshot) == "$first" && $(state previous_version) == 1.0.0 && -z $(state incomplete) && $(grep -c "tar -C /src" "$STUB_LOG") == 1 ]]'
upgrade --rollback --yes
check "... and --rollback then returns to the files and version before the failed upgrade" '[[ $rc == 0 && $(version) == 1.0.0 && $(files) == old ]]'

setup bundled; printf 'previous_version=0.9.0\ntarget_version=1.0.0\nprevious_files=\n' > "$T/inst/.upgrade-state"
STUB_HEALTH_VERSION=1.0.0 upgrade --bundle bundle.tgz 1.1.0
check "a failed upgrade (exit 3) leaves the way back of the last good one" '[[ $rc == 3 && $(state previous_version) == 0.9.0 && $(state target_version) == 1.0.0 ]]'

setup bundled; mkdir -p "$T/inst/backups"
for i in 1 2 3 4; do touch -t "20260101000$i" "$T/inst/backups/db-0.9.$i-x.tar.gz"; done
touch -t 202501010000 "$T/inst/backups/vault-key-db-config.tar.gz"
STUB_DRY_RUN="$PENDING" upgrade --bundle bundle.tgz --migrate 1.1.0
check "rotation: 4 old + 1 new snapshot -> the newest 3; the Vault key backup stays" '[[ $rc == 0 && $(find "$T/inst/backups" -name "db-*" | wc -l) == 3 && -s $T/inst/$(state snapshot) && -e $T/inst/backups/db-0.9.4-x.tar.gz && ! -e $T/inst/backups/db-0.9.2-x.tar.gz && -e $T/inst/backups/vault-key-db-config.tar.gz ]]'

setup bundled; mkdir -p "$T/inst/backups"; touch -t 202601010000 "$T/inst/backups/db-0.9.0-good.tar.gz"
printf 'previous_version=0.9.0\ntarget_version=1.0.0\nprevious_files=\nsnapshot=backups/db-0.9.0-good.tar.gz\n' > "$T/inst/.upgrade-state"
for i in 1 2 3; do STUB_DRY_RUN="$PENDING" STUB_MIGRATE_RC=1 STUB_OLD_SCHEMA_MATCHES=1 upgrade --bundle bundle.tgz --migrate 1.1.0; sleep 1; done
check "3 failed attempts with snapshots keep the snapshot of the last good upgrade" '[[ $rc == 3 && -e $T/inst/backups/db-0.9.0-good.tar.gz && $(state snapshot) == backups/db-0.9.0-good.tar.gz && $(find "$T/inst/backups" -name "db-*" | wc -l) == 4 ]]'

# --- a bundle that changes Supabase -----------------------------------------------------
setup bundled; revendor; upgrade --bundle bundle.tgz 1.1.0
check "a new Supabase version without a terminal or --migrate: exit 2, nothing changed" '[[ $rc == 2 && $(version) == 1.0.0 && $(files) == old && $(cat "$T/inst/supabase/VENDORED") == ref=v1 ]] && grep -q "Supabase is upgraded: v1 -> v2" "$T/out.log" && ! called "compose stop"'
check "... and nothing started or recreated a container before the answer (only run --no-deps)" '! called "compose up" && [[ -z $(grep "compose run" "$STUB_LOG" | grep -v -- "--no-deps") ]]'
upgrade --bundle bundle.tgz --migrate 1.1.0
check "a new Supabase version with --migrate: snapshot first, every service recreated" '[[ $rc == 0 && $(version) == 1.1.0 && -s $T/inst/$(state snapshot) ]] && called "tar -C /src" && ! called "migrate --backup-confirmed" && recreated_all'
upgrade --rollback --yes
check "... --rollback restores the snapshot and recreates the services on the previous Supabase" '[[ $rc == 0 && $(version) == 1.0.0 && $(cat "$T/inst/supabase/VENDORED") == ref=v1 && $(grep -cx "docker compose up -d --force-recreate" "$STUB_LOG") == 2 ]]'

setup bundled; revendor; STUB_HEALTH_VERSION=1.0.0 STUB_OLD_SCHEMA_MATCHES=1 upgrade --bundle bundle.tgz --migrate 1.1.0
check "a new Supabase version never healthy: stopped, exit 4 (its schemas may have changed), rollback offered" '[[ $rc == 4 && $(version) == 1.0.0 && $(state incomplete) == 1 && -n $(state snapshot) ]] && grep -q -- "--rollback" "$T/out.log"'

setup bundled; revendor; STUB_DB_START_RC=1 upgrade --bundle bundle.tgz --migrate 1.1.0
check "a new Supabase version whose database does not start after the snapshot: stopped, exit 4" '[[ $rc == 4 && $(version) == 1.0.0 && $(state incomplete) == 1 && $(state supabase_upgrade) == 1 && -n $(state snapshot) ]]'
setup bundled; STUB_DRY_RUN="$PENDING" STUB_DB_START_RC=1 upgrade --bundle bundle.tgz --migrate 1.1.0
check "... while without a new Supabase that is still before any change: exit 3" '[[ $rc == 3 && $(version) == 1.0.0 && $(files) == old ]]'

setup bundled; revendor; upgrade --bundle bundle.tgz --migrate 1.1.0; a=$rc
STUB_DRY_RUN="$PENDING" STUB_MIGRATE_RC=1 STUB_OLD_SCHEMA_MATCHES=1 upgrade --bundle bundle.tgz --migrate 1.1.0
check "a finished Supabase upgrade is forgotten: a later run whose schema stayed the same goes back (exit 3)" '[[ $a == 0 && $rc == 3 && $(version) == 1.1.0 && -z $(state supabase_upgrade) ]]'

setup bundled; mkdir -p "$T/inst/supabase/volumes/api" "$T/b/supabase/volumes/api"
echo old > "$T/inst/supabase/volumes/api/envoy.yaml"; echo new > "$T/b/supabase/volumes/api/envoy.yaml"; pack
upgrade --bundle bundle.tgz 1.1.0
check "a changed Supabase config file (same version): every service recreated, no snapshot" '[[ $rc == 0 && $(version) == 1.1.0 ]] && recreated_all && ! called "tar -C /src"'

# --- inputs that must not be trusted ----------------------------------------------------
setup bundled; printf 'HELPDESK_VERSION="1.0.0"\nCOMPOSE_FILE='"'"'compose.yaml:compose.bundled.yaml'"'"'\nSUPABASE_URL=""\n' > "$T/inst/.env"
STUB_DRY_RUN="$PENDING" upgrade --bundle bundle.tgz --migrate 1.1.0
check ".env values in quotes are read without them" '[[ $rc == 0 && $(version) == 1.1.0 && $(state previous_version) == 1.0.0 ]] && called "tar -C /src"'

setup external; sed -i 's|^SUPABASE_URL=.*|SUPABASE_URL=|' "$T/inst/.env"
COMPOSE_FILE=compose.yaml:compose.bundled.yaml STUB_DRY_RUN="$PENDING" upgrade --bundle bundle.tgz --migrate 1.1.0
check "COMPOSE_FILE exported in the shell wins over .env (as in docker compose)" '[[ $rc == 0 && $(version) == 1.1.0 ]] && called "tar -C /src"'

setup bundled; sed -i 's|^SUPABASE_URL=.*|SUPABASE_URL=https://x.supabase.co|' "$T/inst/.env"
STUB_DRY_RUN="$PENDING" upgrade --bundle bundle.tgz --migrate 1.1.0; a=$rc
setup external; sed -i 's|^SUPABASE_URL=.*|SUPABASE_URL=|' "$T/inst/.env"
STUB_DRY_RUN="$PENDING" upgrade --bundle bundle.tgz --migrate 1.1.0
check "COMPOSE_FILE and SUPABASE_URL disagree on the mode: exit 1, nothing changed" '[[ $a == 1 && $rc == 1 && $(version) == 1.0.0 && $(files) == old ]] && grep -q "SUPABASE_URL is empty" "$T/out.log" && ! [[ -s "$STUB_LOG" ]]'

setup bundled; printf 'HELPDESK_VERSION=evil\nSECRET=x\n' > "$T/b/.env"; mkdir -p "$T/b/backups"; echo x > "$T/b/backups/x"; pack
upgrade --bundle bundle.tgz 1.1.0
check "a bundle with .env or backups/ never replaces them" '[[ $rc == 0 && $(version) == 1.1.0 && ! -e $T/inst/backups/x ]] && ! grep -q SECRET "$T/inst/.env"'

setup bundled; upgrade --rollback 1.1.0; a=$rc; upgrade --yes 1.1.0; b=$rc; upgrade 1.1.0 1.2.0; c=$rc
check "bad arguments: exit 1 before anything runs" '[[ $a == 1 && $b == 1 && $c == 1 && $(version) == 1.0.0 ]] && ! [[ -s "$STUB_LOG" ]]'

exit $(( fails > 0 ))
