#!/usr/bin/env bash
# Upgrade or roll back this HelpDesk installation — the same script for
# operators and for CD.
#
#   ./upgrade.sh [--bundle FILE] [--migrate] VERSION   upgrade to VERSION
#   ./upgrade.sh --rollback [--yes] [--restored]       undo the last upgrade
#
# The mode comes from COMPOSE_FILE (the shell's, else .env's, as for docker
# compose; init-env writes it): bundled Supabase when it includes
# compose.bundled.yaml, external otherwise.
#
# Upgrade:
#  1. Unpack the bundle of VERSION (GitHub Release, or --bundle FILE) over this
#     directory; .env, backups/ and data stay. The current files are saved
#     first and put back if the upgrade stops (also on Ctrl-C) before step 4.
#  2. Pull images; `migrate --dry-run` says what would change.
#  3. Pending migrations, and a new Supabase version in the bundle (it
#     migrates its own schemas), need an explicit yes: the prompt, or --migrate
#     when there is no terminal.
#  4. Stop the app. Bundled Supabase: stop the stack and snapshot the Postgres
#     data directory into backups/db-<previous>-<UTC>.tar.gz (the last 3 are
#     kept, and always the one the way back needs) — Supabase has no in-place
#     restore, so a rollback restores the whole database. External Supabase:
#     its PITR is the backup; the restore point `migrate` prints is kept for
#     --rollback.
#  5. Migrate, start everything (proxy recreated for its Caddyfile, and every
#     service when supabase/ changed), wait until /api/health reports VERSION.
#
# Rollback (.upgrade-state records the way back from the last upgrade):
#   bundled: restores the snapshot, the previous files and version; asks first
#   (--yes when there is no terminal). External: prints the PITR restore point
#   and stops; restore the project to it, then run --rollback --restored.
#
# Exit: 0 done; 1 error, nothing changed; 2 pending migrations (or a Supabase
#       upgrade) not confirmed, nothing changed; 3 failed, schema unchanged, the
#       previous version runs again; 4 failed after the schema changed —
#       everything stays stopped: ship a fix and upgrade, or ./upgrade.sh
#       --rollback; 130/143 interrupted (Ctrl-C/TERM): before step 4 nothing
#       changed, from step 4 on HelpDesk may be stopped, as after exit 4.
set -euo pipefail

RELEASES_URL="${HELPDESK_RELEASES_URL:-https://github.com/surveyjs/supabase-helpdesk/releases/download}"
STATE=.upgrade-state
KEEP_SNAPSHOTS=3
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"
HELPER_IMAGE=alpine:3.22
USAGE="usage: ./upgrade.sh [--bundle FILE] [--migrate] VERSION | ./upgrade.sh --rollback [--yes] [--restored]"
# Never taken from a bundle, never saved with the files.
PROTECTED=(.env backups "$STATE" supabase/volumes/db/data supabase/volumes/storage supabase/volumes/snippets)

log() { echo "[upgrade] $*" >&2; }
die() { log "$*"; exit 1; }
env_get() { # the last value of $1 in .env, one level of quotes removed (as docker compose reads it)
  local v; v="$(sed -n "s/^$1=//p" .env | tail -n 1 | tr -d '\r')"
  if [[ ${#v} -ge 2 && ( "$v" == \"*\" || "$v" == \'*\' ) ]]; then v="${v:1:${#v}-2}"; fi
  printf '%s\n' "$v"
}
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
# Git Bash: docker.exe gets /src, /dst/... as they are (only docker: curl and
# tar there are other programs and need the conversion).
docker() { MSYS_NO_PATHCONV=1 command docker "$@"; }
compose() { docker compose "$@"; }
BUNDLED=0
bundled() { (( BUNDLED )); }
# The mode is what makes a local database exist: compose.bundled.yaml in
# COMPOSE_FILE (exported in the shell, it wins over .env, as in docker compose).
# SUPABASE_URL must agree, or a snapshot could be skipped.
detect_mode() {
  local files url; files="${COMPOSE_FILE:-$(env_get COMPOSE_FILE)}"
  url="$(env_get SUPABASE_URL)"
  if [[ "$files" == *compose.bundled.yaml* ]]; then
    BUNDLED=1
    [[ -z "$url" ]] || die "COMPOSE_FILE includes compose.bundled.yaml (Supabase runs here) but .env sets SUPABASE_URL=$url;" \
      "empty it for the bundled Supabase, or drop compose.bundled.yaml from COMPOSE_FILE for an external one. Nothing changed."
  else
    BUNDLED=0
    [[ -n "$url" ]] || die "COMPOSE_FILE has no compose.bundled.yaml (external Supabase) but SUPABASE_URL is empty in .env;" \
      "set it, or add compose.bundled.yaml to COMPOSE_FILE for the bundled Supabase. Nothing changed."
  fi
}
# docker run -v needs native paths from Git Bash.
host_path() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$PWD/$1"; else echo "$PWD/$1"; fi; }
save_files() { # the installed bundle, without .env, backups and data
  local p excludes=()
  for p in "${PROTECTED[@]}"; do excludes+=("--exclude=./$p"); done
  # Snapshots hold the whole database: only the owner may read backups/.
  (umask 077 && mkdir -p backups) || return
  chmod 700 backups || log "warning: cannot make backups/ private (chmod 700)"
  tar -czf "$1" "${excludes[@]}" .
}
# Caddy reads the Caddyfile, and Supabase its configs under supabase/ (gateway,
# database, pooler), only when they start; compose does not see a changed file.
supabase_sum() { # a checksum of supabase/, without its data
  local p prune=()
  for p in "${PROTECTED[@]}"; do if [[ "$p" == supabase/* ]]; then prune+=(-o -path "$p"); fi; done
  { find supabase \( "${prune[@]:1}" \) -prune -o -type f -exec cksum {} + 2>/dev/null || true; } | LC_ALL=C sort | cksum
}
start_stack() { # start_stack <supabase/ changed 0|1>
  if bundled && [[ "$1" == 1 ]]; then compose up -d --force-recreate; else compose up -d && compose up -d --force-recreate proxy; fi
}
# Archives of replaced files matter only while .upgrade-state points at one.
prune_saved_files() {
  local keep f; keep="$(state_get previous_files)"
  for f in backups/files-*.tgz; do
    if [[ -f "$f" && "$f" != "$keep" ]]; then rm -f "$f"; fi
  done
}
# Keeps the newest KEEP_SNAPSHOTS, and always <protected> (the way back of the
# last good upgrade, which a failed run puts back).
rotate_snapshots() { # rotate_snapshots <protected or "">
  local f n=0
  while IFS= read -r f; do
    if [[ "$f" == "$1" ]]; then continue; fi
    n=$((n + 1))
    if (( n > KEEP_SNAPSHOTS )); then rm -f "$f"; fi
  done < <(ls -1t backups/db-*.tar.gz 2>/dev/null || true)
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
  local answer; read -r -p "$2 [y/N] " answer || answer=""
  [[ "$answer" == [yY]* ]]
}
# supabase/VENDORED (ref=self-hosted/vX, sha=...) names the Supabase version.
vendored() { if [[ -f "$1" ]]; then tr -d '\r' < "$1"; fi; } # vendored <file>
vendored_ref() { sed -n 's/^ref=//p' <<<"$1" | sed 's|^self-hosted/||'; } # vendored_ref <contents>
db_size() {
  compose exec -T db psql -U postgres -tAc "select pg_size_pretty(pg_database_size('postgres'))" 2>/dev/null \
    | tr -d '\r' || echo "size unknown"
}

# State of one upgrade run: the version and files it replaced, whether it
# continues an upgrade that already changed the schema, and how far it got:
# INSTALLED — the new files are in place, nothing stopped yet;
# COMMITTED — the way back is written and HelpDesk is being stopped/migrated.
# SUPABASE_CHANGED: the new files change supabase/; SUPABASE_UPGRADE: to
# another Supabase version (supabase/VENDORED).
CURRENT="" UNDO="" STAGING="" CARRY=0 INSTALLED=0 COMMITTED=0 SUPABASE_CHANGED=0 SUPABASE_UPGRADE=0

# Exit, Ctrl-C (INT) or TERM at any point: see what this run leaves behind.
on_exit() {
  local rc=$?
  if (( INSTALLED )); then
    INSTALLED=0
    tar -xzf "$UNDO" -C . || log "could not put back the files from $UNDO"
    if [[ -f "$STAGING/state" ]]; then cp "$STAGING/state" "$STATE"; else rm -f "$STATE"; fi
    (( CARRY )) || rm -f "$UNDO"
    log "stopped (exit $rc) before anything was stopped or migrated: the previous files are back; nothing changed"
    (( rc != 0 )) || rc=1
  elif (( COMMITTED )); then
    COMMITTED=0
    # Conservative: the next run continues this upgrade and keeps its way back.
    state_set incomplete 1
    env_set HELPDESK_VERSION "$CURRENT"
    log "stopped (exit $rc) during the upgrade; HelpDesk may be stopped. Run ./upgrade.sh <version> again"
    log "(it continues this upgrade) or ./upgrade.sh --rollback."
    if (( rc != 130 && rc != 143 )); then rc=4; fi
  fi
  if [[ -n "$STAGING" ]]; then rm -rf "$STAGING"; fi
  exit "$rc"
}

# Nothing was stopped or migrated yet: put the files back and exit.
nothing_changed() { # nothing_changed <exit code> <message>
  tar -xzf "$UNDO" -C .
  (( CARRY )) || rm -f "$UNDO"
  INSTALLED=0
  log "$2"
  exit "$1"
}

# Upgrade stopped before the schema changed: put the previous version back.
restore_previous() { # restore_previous <message>
  COMMITTED=0
  log "$1"
  local files="$UNDO" version="$CURRENT" origin=0
  # Continuing a failed upgrade whose schema turned out unchanged: back to
  # where its way back leads.
  if (( CARRY )) && [[ "$(state_get incomplete)" == 1 && -f "$(state_get previous_files)" ]]; then
    files="$(state_get previous_files)"; version="$(state_get previous_version)"; origin=1
  fi
  tar -xzf "$files" -C .
  env_set HELPDESK_VERSION "$version"
  if (( origin )); then
    rm -f "$STATE"
  elif [[ -f "$STAGING/state" ]]; then
    cp "$STAGING/state" "$STATE"   # the way back recorded before this run stays
  else
    rm -f "$STATE"
  fi
  (( CARRY )) || rm -f "$UNDO"
  prune_saved_files
  start_stack "$SUPABASE_CHANGED" || true
  if wait_healthy "$version"; then log "$version runs again; the schema is unchanged"; else log "$version did not become healthy either — check: docker compose logs app"; fi
  exit 3
}

# Upgrade failed after migrate ran or while the new version started.
after_failure() { # after_failure <message> <schema may have changed 0|1>
  log "$1"
  [[ "$2" == 1 ]] || restore_previous "no migration ran — restarting $CURRENT"
  # A new Supabase migrates its own schemas when it starts, which `app status`
  # does not check: only the snapshot goes back from there.
  local supabase=0
  if (( SUPABASE_UPGRADE )) || [[ "$(state_get supabase_upgrade)" == 1 ]]; then supabase=1; fi
  if (( ! supabase )); then
    if bundled; then compose up -d --wait rest api-gw >/dev/null 2>&1 || true; fi
    local status; status="$(HELPDESK_VERSION="$CURRENT" compose run --rm -T app status 2>&1 || true)"
    if grep -q 'Database schema matches this image.' <<<"$status"; then
      restore_previous "the schema is still the one of $CURRENT — restarting it"
    fi
  fi
  COMMITTED=0
  # The next ./upgrade.sh continues from here (as $CURRENT) and keeps this way back.
  state_set incomplete 1
  env_set HELPDESK_VERSION "$CURRENT"
  compose stop app scheduler >/dev/null 2>&1 || true
  if (( supabase )); then
    log "Supabase was upgraded and may have migrated its schemas, so $CURRENT stays stopped. Either:"
  else
    log "The schema has changed, so $CURRENT cannot run on it; HelpDesk stays stopped. Either:"
  fi
  log "  - fix the cause (or wait for a fixed release) and run ./upgrade.sh <version>, or"
  log "  - run ./upgrade.sh --rollback to restore the database and $(state_get previous_version)."
  exit 4
}

upgrade() { # upgrade <target> <bundle or ""> <confirmed 0|1>
  local target="$1" bundle="$2" confirmed="$3"
  local ts; ts="$(date -u +%Y%m%dT%H%M%SZ)"
  CURRENT="$(env_get HELPDESK_VERSION)"
  STAGING="$(mktemp -d)"
  trap on_exit EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  if [[ -z "$bundle" ]]; then
    bundle="$STAGING/bundle.tgz"
    curl -fsSL "$RELEASES_URL/v$target/helpdesk-deploy-v$target.tar.gz" -o "$bundle" \
      || die "cannot download the bundle of $target from $RELEASES_URL"
  fi
  mkdir "$STAGING/files"
  tar --no-same-owner -xzf "$bundle" -C "$STAGING/files" || die "cannot unpack $bundle"
  local got; got="$(tr -d '\r\n' < "$STAGING/files/VERSION" 2>/dev/null || true)"
  [[ "$got" == "$target" ]] || die "$bundle is the bundle of '${got:-?}', not $target; nothing changed"
  local p
  for p in "${PROTECTED[@]}"; do
    if [[ -e "$STAGING/files/$p" ]]; then log "ignoring $p in the bundle"; rm -rf "${STAGING:?}/files/$p"; fi
  done

  # Continuing an upgrade that stopped after changing the schema (exit 4), or
  # re-running the version the last upgrade installed: the recorded way back
  # (previous version, files, snapshot, restore point) stays.
  if [[ -f "$STATE" ]]; then
    cp "$STATE" "$STAGING/state"
    if [[ "$(state_get incomplete)" == 1 ]] \
       || [[ "$(state_get target_version)" == "$CURRENT" && "$CURRENT" == "$target" ]]; then CARRY=1; fi
  fi
  if (( CARRY )); then UNDO="$STAGING/files.tgz"; else UNDO="backups/files-${CURRENT:-none}-$ts.tgz"; fi
  save_files "$UNDO" || { rm -f "$UNDO"; die "cannot save the current files into $UNDO; nothing changed"; }
  local vendored_from vendored_to sum_before
  vendored_from="$(vendored supabase/VENDORED)" vendored_to="$(vendored "$STAGING/files/supabase/VENDORED")"
  if bundled && [[ -n "$vendored_to" && "$vendored_to" != "$vendored_from" ]]; then SUPABASE_UPGRADE=1; fi
  sum_before="$(supabase_sum)"
  INSTALLED=1
  cp -R "$STAGING/files/." .
  if [[ "$(supabase_sum)" != "$sum_before" ]]; then SUPABASE_CHANGED=1; fi

  local image; image="$(env_get HELPDESK_IMAGE)"; image="${image:-ghcr.io/surveyjs/supabase-helpdesk}"
  HELPDESK_VERSION="$target" compose pull --quiet --ignore-pull-failures >/dev/null 2>&1 || true
  docker image inspect "$image:$target" >/dev/null 2>&1 \
    || nothing_changed 1 "image $image:$target is not available; nothing changed"
  # Snapshots and restores run in it: pulled now, not once the stack is stopped.
  if bundled; then
    docker pull -q "$HELPER_IMAGE" >/dev/null 2>&1 || docker image inspect "$HELPER_IMAGE" >/dev/null 2>&1 \
      || nothing_changed 1 "the helper image $HELPER_IMAGE (database snapshots) is not available; nothing changed"
  fi

  local dry rc=0
  dry="$(HELPDESK_VERSION="$target" compose run --rm -T migrate --dry-run 2>&1)" || rc=$?
  printf '%s\n' "$dry" >&2
  (( rc == 0 )) || nothing_changed 1 "migrate --dry-run failed (exit $rc); nothing changed"
  local pending; pending="$(sed -n 's/.*dry run: would apply //p' <<<"$dry" | tr -d '\r')"
  # What changes the schema needs the yes and (bundled) a snapshot first.
  local schema="$pending"
  if [[ -n "$pending" ]]; then log "pending migrations: $pending"; fi
  if (( SUPABASE_UPGRADE )); then
    log "Supabase is upgraded: $(vendored_ref "$vendored_from") -> $(vendored_ref "$vendored_to")" \
        "(it migrates its own schemas when it starts)"
    schema="${schema:+$schema and }the Supabase upgrade"
  fi

  if [[ -n "$schema" ]]; then
    if bundled; then
      log "HelpDesk and Supabase stop while the database ($(db_size)) is snapshotted into backups/"
    else
      log "Supabase is external: its PITR or a recent backup is the only way back — make sure it exists"
    fi
    if [[ "$confirmed" != 1 ]]; then
      [[ -t 0 ]] || nothing_changed 2 "pending migrations and Supabase upgrades need --migrate when there is no terminal; nothing changed"
      local answer; read -r -p "Apply $schema? [y/N] " answer || answer=""
      [[ "$answer" == [yY]* ]] || nothing_changed 2 "not confirmed; nothing changed"
    fi
  fi

  # From here on a stop leaves the way back recorded.
  local changed=0
  if (( CARRY )); then
    [[ "$(state_get incomplete)" == 1 ]] && changed=1
    state_set target_version "$target"
    log "--rollback keeps returning to $(state_get previous_version)"
  else
    printf 'previous_version=%s\ntarget_version=%s\nprevious_files=%s\n' "$CURRENT" "$target" "$UNDO" > "$STATE"
  fi
  COMMITTED=1 INSTALLED=0
  compose stop app scheduler || after_failure "cannot stop HelpDesk" "$changed"

  if [[ -n "$schema" ]]; then
    # A continued upgrade keeps the snapshot taken before the schema changed.
    if bundled && [[ -z "$(state_get snapshot)" ]]; then
      local snapshot="backups/db-${CURRENT:-none}-$ts.tar.gz"
      local name; name="$(basename "$snapshot")"
      compose stop || after_failure "cannot stop the stack for the database snapshot" 0
      # Verified before anything relies on it: non-empty and a Postgres data directory.
      if ! docker run --rm -v "$(host_path supabase/volumes/db):/src:ro" -v "$(host_path backups):/dst" "$HELPER_IMAGE" \
           sh -c "umask 077; tar -C /src -czf /dst/$name data && test -s /dst/$name && tar -tzf /dst/$name | grep -qx data/PG_VERSION"; then
        rm -f "$snapshot"
        restore_previous "the database snapshot failed or is incomplete; nothing was migrated"
      fi
      state_set snapshot "$snapshot"
      local protect=""   # the snapshot of the way back a failed run puts back
      if [[ -f "$STAGING/state" ]]; then protect="$(sed -n 's/^snapshot=//p' "$STAGING/state" | tail -n 1)"; fi
      rotate_snapshots "$protect"
      compose up -d --wait db || after_failure "the database did not start after the snapshot" 0
    fi
    changed=1
    if (( SUPABASE_UPGRADE )); then state_set supabase_upgrade 1; fi
  fi
  if [[ -n "$pending" ]]; then
    local out mrc=0
    out="$(HELPDESK_VERSION="$target" compose run --rm -T migrate --backup-confirmed 2>&1)" || mrc=$?
    printf '%s\n' "$out" >&2
    local point; point="$(sed -n 's/.*restore point (UTC, for PITR): //p' <<<"$out" | tr -d '\r')"
    # The first point is the one before any of these migrations.
    if [[ -n "$point" && -z "$(state_get restore_point)" ]]; then state_set restore_point "$point"; fi
    (( mrc == 0 )) || after_failure "migrate failed (exit $mrc)" 1
  fi

  env_set HELPDESK_VERSION "$target"
  start_stack "$SUPABASE_CHANGED" || true
  wait_healthy "$target" || after_failure "HelpDesk $target did not report healthy within ${HEALTH_TIMEOUT}s" "$changed"
  state_del incomplete
  COMMITTED=0
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
    # Unpacked next to the data first; the current data is replaced only after that worked.
    local name; name="$(basename "$snapshot")"
    docker run --rm -v "$(host_path supabase/volumes/db):/dst" -v "$(host_path backups):/src:ro" "$HELPER_IMAGE" \
      sh -c "umask 077; rm -rf /dst/data.restore && mkdir /dst/data.restore \
             && tar -C /dst/data.restore -xzf /src/$name && test -f /dst/data.restore/data/PG_VERSION \
             || { rm -rf /dst/data.restore; exit 1; }
             rm -rf /dst/data && mv /dst/data.restore/data /dst/data && rmdir /dst/data.restore" \
      || die "restoring $snapshot failed; the current database is untouched and the stack stays stopped —" \
             "start it with docker compose up -d, or run ./upgrade.sh --rollback again"
  elif ! bundled && [[ -n "$point" && "$2" != 1 ]]; then
    log "Restore your Supabase project to $point (UTC): Dashboard -> Database -> Backups -> Point in time,"
    log "or the Management API restore-pitr. Then run: ./upgrade.sh --rollback --restored"
    exit 1
  else
    confirm "$1" "Go back to $previous?" || die "not confirmed; nothing changed"
  fi

  local sum_before; sum_before="$(supabase_sum)"
  if [[ -n "$files" && -f "$files" ]]; then
    tar -xzf "$files" -C .
  else
    log "warning: the files of $previous (${files:-not recorded}) are missing; the current files stay —" \
        "unpack the bundle of $previous here if they differ"
  fi
  env_set HELPDESK_VERSION "$previous"
  if [[ "$(supabase_sum)" != "$sum_before" ]]; then SUPABASE_CHANGED=1; fi
  start_stack "$SUPABASE_CHANGED" || true
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
  if (( do_rollback )); then
    [[ -z "$target$bundle" && "$migrate" == 0 ]] || die "--rollback takes no VERSION, --bundle or --migrate"$'\n'"$USAGE"
  else
    [[ -n "$target" ]] || die "$USAGE"
    [[ "$yes$restored" == 00 ]] || die "--yes and --restored go with --rollback"$'\n'"$USAGE"
  fi
  cd "$(dirname "$0")"
  [[ -f .env ]] || die "no .env here — create it with init-env (see README.md)"
  detect_mode

  if (( do_rollback )); then rollback "$yes" "$restored"; else upgrade "$target" "$bundle" "$migrate"; fi
}
main "$@"; exit
