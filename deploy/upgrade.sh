#!/usr/bin/env bash
# Upgrade or roll back this HelpDesk installation — the same script for
# operators and for CD.
#
#   ./upgrade.sh [--bundle FILE] [--migrate] VERSION   upgrade to VERSION
#   ./upgrade.sh --rollback [--yes] [--restored]       undo the last upgrade
#
# Upgrade:
#  1. Unpack the bundle of VERSION (GitHub Release, or --bundle FILE) over this
#     directory; .env, backups/ and data stay. The current files are saved
#     first and put back if the upgrade stops.
#  2. Pull images; `migrate --dry-run` says what would change.
#  3. Pending migrations need an explicit yes: the prompt, or --migrate when
#     there is no terminal.
#  4. Stop the app. Bundled Supabase: stop the stack and snapshot the Postgres
#     data directory into backups/db-<previous>-<UTC>.tar.gz (the last 3 are
#     kept) — Supabase has no in-place restore, so a rollback restores the
#     whole database. External Supabase: its PITR is the backup; the restore
#     point `migrate` prints is kept for --rollback.
#  5. Migrate, start everything, wait until /api/health reports VERSION.
#
# Rollback (.upgrade-state records the way back from the last upgrade):
#   bundled: restores the snapshot, the previous files and version; asks first
#   (--yes when there is no terminal). External: prints the PITR restore point
#   and stops; restore the project to it, then run --rollback --restored.
#
# Exit: 0 done; 1 error, nothing changed; 2 pending migrations not confirmed,
#       nothing changed; 3 failed, schema unchanged, the previous version runs
#       again; 4 failed after the schema changed — everything stays stopped:
#       ship a fix and upgrade, or ./upgrade.sh --rollback.
set -euo pipefail

RELEASES_URL="${HELPDESK_RELEASES_URL:-https://github.com/surveyjs/supabase-helpdesk/releases/download}"
STATE=.upgrade-state
KEEP_SNAPSHOTS=3
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"
HELPER_IMAGE=alpine:3.22
USAGE="usage: ./upgrade.sh [--bundle FILE] [--migrate] VERSION | ./upgrade.sh --rollback [--yes] [--restored]"

log() { echo "[upgrade] $*" >&2; }
die() { log "$*"; exit 1; }
env_get() { sed -n "s/^$1=//p" .env | tail -n 1 | tr -d '\r'; }
env_set() {
  local tmp; tmp="$(mktemp)"
  if grep -q "^$1=" .env; then sed "s|^$1=.*|$1=$2|" .env > "$tmp"; else { cat .env; echo "$1=$2"; } > "$tmp"; fi
  cat "$tmp" > .env; rm -f "$tmp"
}
state_get() { if [[ -f "$STATE" ]]; then sed -n "s/^$1=//p" "$STATE" | tail -n 1; fi; }
state_set() { # state_set <key> <value>: replaces the key's line
  local tmp; tmp="$(mktemp)"
  { grep -v "^$1=" "$STATE" 2>/dev/null || true; echo "$1=$2"; } > "$tmp"
  cat "$tmp" > "$STATE"; rm -f "$tmp"
}
state_del() {
  local tmp; tmp="$(mktemp)"
  grep -v "^$1=" "$STATE" > "$tmp" || true
  cat "$tmp" > "$STATE"; rm -f "$tmp"
}
compose() { docker compose "$@"; }
bundled() { [[ -z "$(env_get SUPABASE_URL)" ]]; }
# docker run -v needs native paths from Git Bash.
host_path() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$PWD/$1"; else echo "$PWD/$1"; fi; }
save_files() { # the installed bundle, without .env, backups and data
  mkdir -p backups
  tar -czf "$1" --exclude=./.env --exclude=./backups --exclude="./$STATE" \
    --exclude=./supabase/volumes/db/data --exclude=./supabase/volumes/storage \
    --exclude=./supabase/volumes/snippets .
}
# Archives of replaced files matter only while .upgrade-state points at one.
prune_saved_files() {
  local keep f; keep="$(state_get previous_files)"
  for f in backups/files-*.tgz; do
    if [[ -f "$f" && "$f" != "$keep" ]]; then rm -f "$f"; fi
  done
}
health_version() {
  compose exec -T app wget -qO- http://127.0.0.1:3001/api/health 2>/dev/null \
    | sed -n 's/.*"version":"\([^"]*\)".*/\1/p' | tr -d '\r'
}
wait_healthy() {
  local end=$((SECONDS + HEALTH_TIMEOUT))
  until [[ "$(health_version)" == "$1" ]]; do
    (( SECONDS < end )) || return 1
    sleep 3
  done
}
confirm() { # confirm <yes 0|1> <question>
  [[ "$1" == 1 ]] && return 0
  [[ -t 0 ]] || die "no terminal to confirm \"$2\" — re-run with --yes"
  local answer; read -r -p "$2 [y/N] " answer
  [[ "$answer" == [yY]* ]]
}
db_size() {
  compose exec -T db psql -U postgres -tAc "select pg_size_pretty(pg_database_size('postgres'))" 2>/dev/null \
    | tr -d '\r' || echo "size unknown"
}

# State of one upgrade run: the version and files it replaced, and whether it
# continues an upgrade that already changed the schema.
CURRENT="" UNDO="" STAGING="" CARRY=0

# Nothing was stopped or migrated yet: put the files back and exit.
nothing_changed() { # nothing_changed <exit code> <message>
  tar -xzf "$UNDO" -C .
  (( CARRY )) || rm -f "$UNDO"
  log "$2"
  exit "$1"
}

# Upgrade stopped before the schema changed: put the previous version back.
restore_previous() { # restore_previous <message>
  log "$1"
  tar -xzf "$UNDO" -C .
  env_set HELPDESK_VERSION "$CURRENT"
  # The way back recorded before this run stays the way back.
  if [[ -f "$STAGING/state" ]]; then cp "$STAGING/state" "$STATE"; else rm -f "$STATE"; fi
  (( CARRY )) || rm -f "$UNDO"
  compose up -d || true
  if wait_healthy "$CURRENT"; then log "$CURRENT runs again; the schema is unchanged"; else log "$CURRENT did not become healthy either — check: docker compose logs app"; fi
  exit 3
}

# Upgrade failed after migrate ran or while the new version started.
after_failure() { # after_failure <message> <schema may have changed 0|1>
  log "$1"
  [[ "$2" == 1 ]] || restore_previous "no migration ran — restarting $CURRENT"
  if bundled; then compose up -d --wait rest api-gw >/dev/null 2>&1 || true; fi
  local status; status="$(HELPDESK_VERSION="$CURRENT" compose run --rm -T app status 2>&1 || true)"
  if grep -q 'Database schema matches this image.' <<<"$status"; then
    restore_previous "the schema is still the one of $CURRENT — restarting it"
  fi
  compose stop app scheduler >/dev/null 2>&1 || true
  # The next ./upgrade.sh continues from here and keeps this way back.
  state_set incomplete 1
  log "The schema has changed, so $CURRENT cannot run on it; HelpDesk stays stopped. Either:"
  log "  - fix the cause (or wait for a fixed release) and run ./upgrade.sh <version>, or"
  log "  - run ./upgrade.sh --rollback to restore the database and $(state_get previous_version)."
  exit 4
}

upgrade() { # upgrade <target> <bundle or ""> <confirmed 0|1>
  local target="$1" bundle="$2" confirmed="$3"
  [[ -f .env ]] || die "no .env here — create it with init-env (see README.md)"
  local ts; ts="$(date -u +%Y%m%dT%H%M%SZ)"
  CURRENT="$(env_get HELPDESK_VERSION)"
  STAGING="$(mktemp -d)"
  trap 'rm -rf "$STAGING"' EXIT

  if [[ -z "$bundle" ]]; then
    bundle="$STAGING/bundle.tgz"
    curl -fsSL "$RELEASES_URL/v$target/helpdesk-deploy-v$target.tar.gz" -o "$bundle" \
      || die "cannot download the bundle of $target from $RELEASES_URL"
  fi
  mkdir "$STAGING/files"
  tar -xzf "$bundle" -C "$STAGING/files" || die "cannot unpack $bundle"
  local got; got="$(tr -d '\r\n' < "$STAGING/files/VERSION" 2>/dev/null || true)"
  [[ "$got" == "$target" ]] || die "$bundle is the bundle of '${got:-?}', not $target; nothing changed"

  # Continuing an upgrade that stopped after changing the schema (exit 4), or
  # re-running the version the last upgrade installed: the recorded way back
  # (previous version, files, snapshot, restore point) stays.
  if [[ -f "$STATE" ]]; then
    cp "$STATE" "$STAGING/state"
    if [[ "$(state_get incomplete)" == 1 ]] \
       || [[ "$(state_get target_version)" == "$CURRENT" && "$CURRENT" == "$target" ]]; then CARRY=1; fi
  fi
  if (( CARRY )); then UNDO="$STAGING/files.tgz"; else UNDO="backups/files-${CURRENT:-none}-$ts.tgz"; fi
  save_files "$UNDO"
  cp -R "$STAGING/files/." .

  local image; image="$(env_get HELPDESK_IMAGE)"; image="${image:-ghcr.io/surveyjs/supabase-helpdesk}"
  HELPDESK_VERSION="$target" compose pull --quiet --ignore-pull-failures >/dev/null 2>&1 || true
  docker image inspect "$image:$target" >/dev/null 2>&1 \
    || nothing_changed 1 "image $image:$target is not available; nothing changed"

  local dry rc=0
  dry="$(HELPDESK_VERSION="$target" compose run --rm -T migrate --dry-run 2>&1)" || rc=$?
  printf '%s\n' "$dry" >&2
  (( rc == 0 )) || nothing_changed 1 "migrate --dry-run failed (exit $rc); nothing changed"
  local pending; pending="$(sed -n 's/.*dry run: would apply //p' <<<"$dry" | tr -d '\r')"

  if [[ -n "$pending" ]]; then
    log "pending migrations: $pending"
    if bundled; then
      log "HelpDesk and Supabase stop while the database ($(db_size)) is snapshotted into backups/"
    else
      log "Supabase is external: its PITR or a recent backup is the only way back — make sure it exists"
    fi
    if [[ "$confirmed" != 1 ]]; then
      [[ -t 0 ]] || nothing_changed 2 "pending migrations need --migrate when there is no terminal; nothing changed"
      local answer; read -r -p "Apply $pending? [y/N] " answer
      [[ "$answer" == [yY]* ]] || nothing_changed 2 "not confirmed; nothing changed"
    fi
  fi

  local changed=0
  if (( CARRY )); then
    [[ "$(state_get incomplete)" == 1 ]] && changed=1
    state_set target_version "$target"
    log "--rollback keeps returning to $(state_get previous_version)"
  else
    printf 'previous_version=%s\ntarget_version=%s\nprevious_files=%s\n' "$CURRENT" "$target" "$UNDO" > "$STATE"
  fi
  compose stop app scheduler || after_failure "cannot stop HelpDesk" "$changed"

  if [[ -n "$pending" ]]; then
    # A continued upgrade keeps the snapshot taken before the schema changed.
    if bundled && [[ -z "$(state_get snapshot)" ]]; then
      local snapshot="backups/db-${CURRENT:-none}-$ts.tar.gz"
      compose stop || after_failure "cannot stop the stack for the database snapshot" 0
      if ! docker run --rm -v "$(host_path supabase/volumes/db):/src:ro" -v "$(host_path backups):/dst" \
           "$HELPER_IMAGE" tar -C /src -czf "/dst/$(basename "$snapshot")" data; then
        rm -f "$snapshot"
        restore_previous "the database snapshot failed; nothing was migrated"
      fi
      state_set snapshot "$snapshot"
      { ls -1t backups/db-*.tar.gz 2>/dev/null || true; } | tail -n "+$((KEEP_SNAPSHOTS + 1))" | xargs -r rm -f
      compose up -d --wait db || after_failure "the database did not start after the snapshot" 0
    fi
    changed=1
    local out mrc=0
    out="$(HELPDESK_VERSION="$target" compose run --rm -T migrate --backup-confirmed 2>&1)" || mrc=$?
    printf '%s\n' "$out" >&2
    local point; point="$(sed -n 's/.*restore point (UTC, for PITR): //p' <<<"$out" | tr -d '\r')"
    # The first point is the one before any of these migrations.
    if [[ -n "$point" && -z "$(state_get restore_point)" ]]; then state_set restore_point "$point"; fi
    (( mrc == 0 )) || after_failure "migrate failed (exit $mrc)" 1
  fi

  env_set HELPDESK_VERSION "$target"
  compose up -d || true
  wait_healthy "$target" || after_failure "HelpDesk $target did not report healthy within ${HEALTH_TIMEOUT}s" "$changed"
  state_del incomplete
  prune_saved_files
  log "upgraded ${CURRENT:-?} -> $target; to undo: ./upgrade.sh --rollback"
}

rollback() { # rollback <yes 0|1> <restored 0|1>
  [[ -f "$STATE" ]] || die "nothing to roll back: no $STATE"
  local previous target files snapshot point
  previous="$(state_get previous_version)"; target="$(state_get target_version)"
  files="$(state_get previous_files)"; snapshot="$(state_get snapshot)"; point="$(state_get restore_point)"

  if bundled && [[ -n "$snapshot" ]]; then
    [[ -f "$snapshot" ]] || die "the snapshot $snapshot is missing"
    confirm "$1" "Restore the database to the snapshot taken before $target ($snapshot)? Everything written since is lost." \
      || die "not confirmed; nothing changed"
    compose stop || die "cannot stop the stack"
    docker run --rm -v "$(host_path supabase/volumes/db):/dst" -v "$(host_path backups):/src:ro" "$HELPER_IMAGE" \
      sh -c "rm -rf /dst/data && tar -C /dst -xzf /src/$(basename "$snapshot")" \
      || die "restoring $snapshot failed; the stack stays stopped — run ./upgrade.sh --rollback again"
  elif ! bundled && [[ -n "$point" && "$2" != 1 ]]; then
    log "Restore your Supabase project to $point (UTC): Dashboard -> Database -> Backups -> Point in time,"
    log "or the Management API restore-pitr. Then run: ./upgrade.sh --rollback --restored"
    exit 1
  else
    confirm "$1" "Go back to $previous?" || die "not confirmed; nothing changed"
  fi

  if [[ -n "$files" && -f "$files" ]]; then tar -xzf "$files" -C .; fi
  env_set HELPDESK_VERSION "$previous"
  compose up -d || true
  wait_healthy "$previous" || die "$previous did not report healthy after the rollback — check: docker compose logs app"
  rm -f "$STATE"
  prune_saved_files
  log "rolled back $target -> $previous"
}

# Everything runs from main, parsed before any of it: upgrade() replaces this
# file with the one of the new version while it runs.
main() {
  local bundle="" migrate=0 do_rollback=0 yes=0 restored=0 target=""
  while (($#)); do
    case "$1" in
      --bundle) [[ $# -ge 2 ]] || die "--bundle needs a file"
                [[ -f "$2" ]] || die "no such bundle: $2"
                bundle="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"; shift 2 ;;
      --migrate) migrate=1; shift ;;
      --rollback) do_rollback=1; shift ;;
      --yes) yes=1; shift ;;
      --restored) restored=1; shift ;;
      -h|--help) sed -n '2,/^set -euo pipefail$/p' "$0" | sed '$d; s/^# \{0,1\}//'; exit 0 ;;
      -*) die "unknown option: $1"$'\n'"$USAGE" ;;
      *) [[ -z "$target" ]] || die "one VERSION only, got: $target $1"; target="$1"; shift ;;
    esac
  done
  cd "$(dirname "$0")"

  if (( do_rollback )); then
    [[ -z "$target$bundle" && "$migrate" == 0 ]] || die "--rollback takes no VERSION, --bundle or --migrate"$'\n'"$USAGE"
    rollback "$yes" "$restored"
  else
    [[ -n "$target" ]] || die "$USAGE"
    [[ "$yes$restored" == 00 ]] || die "--yes and --restored go with --rollback"$'\n'"$USAGE"
    upgrade "$target" "$bundle" "$migrate"
  fi
}
main "$@"; exit
