#!/usr/bin/env bash
# Upgrade test for database migrations — emulates how production applies them.
#
# Production (self-hosted) applies migrations forward-only with
# `supabase db push --include-all`: versions already recorded in
# supabase_migrations.schema_migrations are never re-run. Its databases were
# created under Supabase's OLD default privileges (anon/authenticated/
# service_role auto-granted on everything in `public`). Fresh-install CI jobs
# cannot see problems that only exist on such a database, so this script:
#
#   1. detect   resolves the base revision and the migrations new since it;
#               fails if an already-applied migration was edited/removed;
#               exits early (success) if no migration changed.
#   2. prepare  extracts supabase/ from the base revision into a temp project
#               and drops `auto_expose_new_tables` from its config.toml so the
#               stack starts with the OLD defaults (like production).
#   (the caller starts that project: `supabase start --workdir <project>`)
#   3. verify   guard (old defaults really active) -> supabase/upgrade-fixtures.sql
#               (production-like volume + edge cases) -> schema + data fingerprint
#               -> `migrate` from the release image (as in production) ->
#               data / privileges / idempotency checks -> `npm run test:db`.
#
#   local      runs all of the above on this machine (Git Bash + Docker):
#                docker build -t supabase-helpdesk:ci .
#                BASE=main bash .github/scripts/migration-upgrade.sh local
#              Stops any running local stack of this project first.
#
# Rules this enforces for NEW migrations:
#   * never edit or delete a migration that exists on the base revision —
#     production will not re-run it; add a new migration instead;
#   * migrations must be re-runnable (IF NOT EXISTS, CREATE OR REPLACE,
#     DROP ... IF EXISTS, idempotent data fixes), and a re-run must not change
#     data;
#   * existing data in key tables must survive unchanged (compared over the
#     columns that existed before the upgrade, so adding columns is fine).
#     Intended data changes are declared in supabase/upgrade-expectations.json,
#     keyed by migration file name (only migrations new in this run count):
#
#       { "003_dedupe_tags.sql": {
#           "tags":    { "rows": 10,      "reason": "remove duplicate tags" },
#           "tickets": { "changed": true, "reason": "backfill priority" } } }
#
#     "rows": the row count expected after the upgrade (content may change);
#     "changed": any difference in that table is accepted.
#
# Env: BASE (override base revision), GITHUB_EVENT_NAME, GITHUB_BASE_REF,
#      PUSH_BEFORE (github.event.before), RUNNER_TEMP, GITHUB_STEP_SUMMARY,
#      GITHUB_OUTPUT. Invoke as `bash migration-upgrade.sh <command>`.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
WORK="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/migration-upgrade"
PROJ="$WORK/project"
OUT="$WORK/out"
SUMMARY="${GITHUB_STEP_SUMMARY:-$OUT/summary.md}"
GH_OUTPUT="${GITHUB_OUTPUT:-/dev/null}"
KEY_TABLES=(profiles teams categories tags tickets posts ticket_tags ticket_followers attachments app_settings)
VAULT_FN_RE='^(store|get|delete|has)_.*(secret|api_key)$'
VAULT_FN_MIN=10
EXCLUDE='studio,postgres-meta,imgproxy,edge-runtime,logflare,vector,supavisor'

mkdir -p "$OUT"

note()  { echo "$*" >> "$SUMMARY"; }
error() { echo "::error title=migration-upgrade::$*"; }
# Paths handed to the native supabase binary on Windows (Git Bash) need converting.
native_path() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else echo "$1"; fi; }
supabase() { (cd "$ROOT" && npm run --silent supabase -- "$@"); }

db_container() {
  local id
  id="$(sed -n 's/^project_id *= *"\(.*\)"/\1/p' "$PROJ/supabase/config.toml" | head -1)"
  echo "supabase_db_${id}"
}
psql_db() { docker exec -i "$(db_container)" psql -U postgres -X -q -v ON_ERROR_STOP=1 "$@"; }
psql_val() { psql_db -tA -c "$1"; }

# ---------------------------------------------------------------------------
resolve_base() {
  if [[ -n "${BASE:-}" ]]; then git rev-parse "$BASE^{commit}"; return; fi
  case "${GITHUB_EVENT_NAME:-}" in
    pull_request)
      git merge-base "origin/${GITHUB_BASE_REF:?}" HEAD ;;
    push)
      if [[ -n "${PUSH_BEFORE:-}" && ! "$PUSH_BEFORE" =~ ^0+$ ]] \
         && git cat-file -e "${PUSH_BEFORE}^{commit}" 2>/dev/null; then
        echo "$PUSH_BEFORE"
      else
        git rev-parse HEAD~1   # first push of a branch, or a force-push
      fi ;;
    *)
      local mb
      mb="$(git merge-base origin/main HEAD)"
      if [[ "$mb" == "$(git rev-parse HEAD)" ]]; then git rev-parse HEAD~1; else echo "$mb"; fi ;;
  esac
}

cmd_detect() {
  local base status path bad=0
  base="$(resolve_base)"
  echo "$base" > "$WORK/base"
  : > "$WORK/new-migrations"
  note "## Migration upgrade test"
  note ""
  note "Base revision: \`$(git log -1 --format='%h %s' "$base")\`"
  note ""

  while IFS=$'\t' read -r status path; do
    [[ -z "$status" ]] && continue
    case "$status" in
      A) [[ "$path" == *.sql ]] && basename "$path" >> "$WORK/new-migrations" ;;
      *) bad=1
         echo "::error file=$path,title=Applied migration changed::$path is already on the base revision and production will never re-run it (supabase db push tracks applied versions). Revert the change and add a new migration instead."
         note "❌ \`$path\` ($status): already-applied migration edited or removed" ;;
    esac
  done < <(git diff --name-status --no-renames "$base" HEAD -- supabase/migrations/)

  if ! git diff --quiet "$base" HEAD -- supabase/seed.sql; then
    echo "::warning title=seed.sql changed::The upgrade test seeds the database with the BASE seed.sql; test:db runs against that data."
    note "⚠️ \`supabase/seed.sql\` changed — the upgraded database carries the base seed."
  fi

  if (( bad )); then
    echo "changed=false" >> "$GH_OUTPUT"
    return 1
  fi
  if [[ ! -s "$WORK/new-migrations" ]]; then
    note "No changes in \`supabase/migrations/\` — nothing to upgrade."
    echo "changed=false" >> "$GH_OUTPUT"
    echo "No migration changes since $base."
    return 0
  fi
  note "New migrations: $(sed 's/.*/`&`/' "$WORK/new-migrations" | paste -sd ' ')"
  note ""
  echo "changed=true" >> "$GH_OUTPUT"
  echo "workdir=$(native_path "$PROJ")" >> "$GH_OUTPUT"
  echo "New migrations since $base:"; cat "$WORK/new-migrations"
}

cmd_prepare() {
  local base
  base="$(cat "$WORK/base")"
  rm -rf "$PROJ"
  mkdir -p "$PROJ"
  git archive "$base" supabase | tar -x -C "$PROJ"
  # Old (pre-2026-10-30) default privileges, like the production databases.
  sed -i '/^auto_expose_new_tables[[:space:]]*=/d' "$PROJ/supabase/config.toml"
  echo "Base project extracted to $PROJ"
}

# ---------------------------------------------------------------------------
# fingerprint <out.tsv> [<columns-from.tsv>]
#   one line per table: name, column list, row count, order-independent hash.
#   With a columns file, hashes only those columns (the pre-upgrade set).
fingerprint() {
  local out="$1" cols_from="${2:-}" t cols res
  : > "$out"
  for t in $(tables_to_fingerprint); do
    if [[ -n "$cols_from" ]]; then
      cols="$(awk -F'\t' -v t="$t" '$1 == t { print $2 }' "$cols_from")"
    else
      cols="$(psql_val "select string_agg(quote_ident(column_name), ',' order by ordinal_position)
                        from information_schema.columns
                        where table_schema = 'public' and table_name = '$t'")"
    fi
    if [[ -z "$cols" ]]; then
      printf '%s\t\tmissing\tmissing\n' "$t" >> "$out"
      continue
    fi
    if res="$(psql_db -tA -F $'\t' -c "select count(*), md5(coalesce(string_agg(h, '' order by h), ''))
                                        from (select md5(row($cols)::text) as h from public.$t) s" 2>"$OUT/fingerprint-error.txt")"; then
      printf '%s\t%s\t%s\n' "$t" "$cols" "$res" >> "$out"
    else
      printf '%s\t%s\terror\terror\n' "$t" "$cols" >> "$out"
    fi
  done
}

# Key tables plus any table named in expectations for the new migrations.
tables_to_fingerprint() {
  { printf '%s\n' "${KEY_TABLES[@]}"; cut -f1 "$WORK/expectations.tsv" 2>/dev/null || true; } | awk 'NF && !seen[$0]++'
}

# Expectations for the new migrations only -> table \t rows|changed \t reason
load_expectations() {
  : > "$WORK/expectations.tsv"
  local file="$ROOT/supabase/upgrade-expectations.json"
  [[ -f "$file" ]] || return 0
  node -e '
    const fs = require("fs");
    const [file, listFile] = process.argv.slice(1);
    const wanted = new Set(fs.readFileSync(listFile, "utf8").split(/\r?\n/).filter(Boolean));
    const all = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const [migration, tables] of Object.entries(all)) {
      if (!wanted.has(migration)) continue;
      for (const [table, e] of Object.entries(tables)) {
        const kind = e.changed ? "changed" : (Number.isInteger(e.rows) ? String(e.rows) : null);
        if (kind === null) { console.error(`${migration}/${table}: expected "rows" (integer) or "changed": true`); process.exit(1); }
        console.log([table, kind, `${migration}: ${e.reason ?? ""}`].join("\t"));
      }
    }' "$(native_path "$file")" "$(native_path "$WORK/new-migrations")" > "$WORK/expectations.tsv"
}

# compare_fingerprints <before> <after> <use-expectations 0|1> -> 0 ok / 1 mismatch
compare_fingerprints() {
  local before="$1" after="$2" use_exp="$3" rc=0 t b_cols b_rows b_hash a_rows a_hash exp reason verdict
  while IFS=$'\t' read -r t b_cols b_rows b_hash; do
    a_rows=missing; a_hash=missing; exp=""; reason=""
    IFS=$'\t' read -r _ _ a_rows a_hash < <(awk -F'\t' -v t="$t" '$1 == t' "$after") || true
    if (( use_exp )); then
      IFS=$'\t' read -r _ exp reason < <(awk -F'\t' -v t="$t" '$1 == t' "$WORK/expectations.tsv") || true
    fi
    if [[ "$exp" == changed ]]; then
      verdict="✅ changed as declared ($reason)"
    elif [[ "$a_rows" == error || "$a_rows" == missing ]]; then
      verdict="❌ table or pre-upgrade columns no longer readable"
    elif [[ -n "$exp" ]]; then
      if [[ "$a_rows" == "$exp" ]]; then verdict="✅ $a_rows rows as declared ($reason)"
      else verdict="❌ expected $exp rows ($reason), got $a_rows"; fi
    elif [[ "$a_rows" == "$b_rows" && "$a_hash" == "$b_hash" ]]; then
      verdict="✅ unchanged"
    else
      verdict="❌ changed but not declared in supabase/upgrade-expectations.json"
    fi
    [[ "$verdict" == ❌* ]] && rc=1
    note "| \`$t\` | $b_rows | $a_rows | $verdict |"
  done < "$before"
  return "$rc"
}

cmd_verify() {
  local fail=0 n

  # --- guard: are we really on the old (production-like) defaults? --------
  n="$(psql_val "select count(*) from pg_default_acl d
                 join pg_namespace ns on ns.oid = d.defaclnamespace, unnest(d.defaclacl) a
                 where ns.nspname = 'public' and d.defaclobjtype = 'r'
                   and pg_get_userbyid(d.defaclrole) = 'postgres' and a::text like 'anon=arwd%'")"
  if [[ "$n" == 0 ]]; then
    error "The base database does not have Supabase's old default privileges, so it no longer emulates production. The pinned CLI probably dropped \`auto_expose_new_tables\`; update cmd_prepare to recreate the old defaults."
    note "❌ Guard: base database is not on the old default privileges (see job log)."
    return 1
  fi
  note "✅ Guard: base database runs with the old default privileges (like production)."

  # --- production-like data on top of seed.sql --------------------------------
  # The fixtures target the base schema, so the base revision's copy is used;
  # HEAD's copy only when the base predates the file.
  local fixtures="$PROJ/supabase/upgrade-fixtures.sql" fixtures_from="base revision"
  if [[ ! -f "$fixtures" && -f "$ROOT/supabase/upgrade-fixtures.sql" ]]; then
    fixtures="$ROOT/supabase/upgrade-fixtures.sql"; fixtures_from="HEAD (not on the base revision yet)"
  fi
  if [[ -f "$fixtures" ]]; then
    SECONDS=0
    if ! psql_db < "$fixtures" > "$OUT/fixtures.log" 2>&1; then
      cat "$OUT/fixtures.log"
      error "Loading supabase/upgrade-fixtures.sql into the base database failed: $(grep -m1 ERROR "$OUT/fixtures.log")"
      note "❌ Loading \`supabase/upgrade-fixtures.sql\` ($fixtures_from) failed."
      return 1
    fi
    note "✅ Loaded \`supabase/upgrade-fixtures.sql\` from the $fixtures_from in ${SECONDS}s."
  else
    note "⚠️ No \`supabase/upgrade-fixtures.sql\`: the upgrade runs on seed data only."
  fi

  # --- snapshot before -------------------------------------------------------
  load_expectations
  docker exec "$(db_container)" pg_dump -U postgres --schema-only --schema=public postgres > "$OUT/schema-before.sql"
  fingerprint "$OUT/fingerprint-before.tsv"

  # --- upgrade -----------------------------------------------------------------
  # The production path: the image's explicit `migrate` command (job `image`;
  # locally: docker build -t supabase-helpdesk:ci .). The CI database is
  # disposable, so the backup is confirmed.
  cp "$ROOT"/supabase/migrations/*.sql "$PROJ/supabase/migrations/"   # for the idempotency re-run below
  local dbc image="${MIGRATE_IMAGE:-supabase-helpdesk:ci}"
  dbc="$(db_container)"
  if MSYS_NO_PATHCONV=1 docker run --rm --network "supabase_network_${dbc#supabase_db_}" \
       -e MIGRATION_DB_URL="postgresql://postgres:postgres@${dbc}:5432/postgres?sslmode=disable" \
       "$image" migrate --backup-confirmed > "$OUT/migrate.log" 2>&1; then
    note "✅ \`migrate\` ($image) applied: $(paste -sd ' ' "$WORK/new-migrations")"
  else
    cat "$OUT/migrate.log"
    error "migrate failed (see migrate.log in the diagnostics artifact)"
    note "❌ \`migrate\` failed:"; note '```'; tail -n 30 "$OUT/migrate.log" >> "$SUMMARY"; note '```'
    return 1
  fi
  cat "$OUT/migrate.log"
  docker exec "$(db_container)" pg_dump -U postgres --schema-only --schema=public postgres > "$OUT/schema-after.sql"

  # --- data ------------------------------------------------------------------------
  fingerprint "$OUT/fingerprint-after.tsv" "$OUT/fingerprint-before.tsv"
  note ""
  note "| Table | Rows before | Rows after | Data |"
  note "|---|---|---|---|"
  if ! compare_fingerprints "$OUT/fingerprint-before.tsv" "$OUT/fingerprint-after.tsv" 1; then
    error "Existing data changed in a way not declared in supabase/upgrade-expectations.json (see the job summary)"
    fail=1
  fi
  note ""

  # --- privileges -----------------------------------------------------------------
  psql_db -tA -c "
    select format('%s lacks %s on %s', r.role, p.priv, c.oid::regclass)
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    cross join (values ('anon'), ('authenticated'), ('service_role')) r(role)
    cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) p(priv)
    where ns.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p')
      and not has_table_privilege(r.role, c.oid, p.priv)
    order by 1" > "$OUT/privileges-tables.txt"
  n="$(psql_val "select count(*) from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                 where ns.nspname = 'public' and p.proname ~ '$VAULT_FN_RE'")"
  psql_db -tA -c "
    select format('%s can EXECUTE %s', r.role, p.oid::regprocedure)
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    cross join (values ('anon'), ('authenticated')) r(role)
    where ns.nspname = 'public' and p.proname ~ '$VAULT_FN_RE'
      and has_function_privilege(r.role, p.oid, 'EXECUTE')
    union all
    select format('service_role cannot EXECUTE %s', p.oid::regprocedure)
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.proname ~ '$VAULT_FN_RE'
      and not has_function_privilege('service_role', p.oid, 'EXECUTE')
    order by 1" > "$OUT/privileges-vault.txt"
  if [[ -s "$OUT/privileges-tables.txt" ]]; then
    error "Data API roles are missing table privileges: $(head -5 "$OUT/privileges-tables.txt" | paste -sd ';')"
    note "❌ Table privileges: $(wc -l < "$OUT/privileges-tables.txt") missing grants, e.g. \`$(head -1 "$OUT/privileges-tables.txt")\`"
    fail=1
  else
    note "✅ Table privileges: anon, authenticated and service_role hold SELECT/INSERT/UPDATE/DELETE on every table and view in \`public\`."
  fi
  if (( n < VAULT_FN_MIN )); then
    error "Found only $n Vault functions matching $VAULT_FN_RE (expected >= $VAULT_FN_MIN) — update VAULT_FN_RE"
    note "❌ Vault functions: only $n matched the pattern."
    fail=1
  elif [[ -s "$OUT/privileges-vault.txt" ]]; then
    error "Vault RPC privileges are wrong: $(paste -sd ';' "$OUT/privileges-vault.txt")"
    note "❌ Vault RPCs: $(paste -sd ';' "$OUT/privileges-vault.txt")"
    fail=1
  else
    note "✅ Vault RPCs ($n): service_role only."
  fi

  # --- idempotency -----------------------------------------------------------------
  local m idem=0
  while read -r m; do
    if ! psql_db < "$PROJ/supabase/migrations/$m" > "$OUT/rerun-$m.log" 2>&1; then
      error "Re-running $m failed — migrations must be re-runnable: $(tail -1 "$OUT/rerun-$m.log")"
      note "❌ Re-running \`$m\` failed: \`$(tail -1 "$OUT/rerun-$m.log")\`"
      idem=1
    fi
  done < "$WORK/new-migrations"
  if (( ! idem )); then
    fingerprint "$OUT/fingerprint-rerun.tsv" "$OUT/fingerprint-before.tsv"
    if ! diff <(cut -f1,3,4 "$OUT/fingerprint-after.tsv") <(cut -f1,3,4 "$OUT/fingerprint-rerun.tsv") > "$OUT/rerun.diff"; then
      error "Re-running the new migrations changed data again (see rerun.diff)"
      note "❌ Re-running the new migrations changed data: \`$(head -3 "$OUT/rerun.diff" | paste -sd ' ')\`"
      idem=1
    else
      note "✅ Idempotent: re-running the new migrations succeeded and left the data unchanged."
    fi
  fi
  (( idem )) && fail=1

  # --- schema diff (informational) --------------------------------------------------
  diff -u "$OUT/schema-before.sql" "$OUT/schema-after.sql" > "$OUT/schema.diff" || true
  note ""
  note "<details><summary>Schema diff (public), $(grep -c '^[-+][^-+]' "$OUT/schema.diff" || true) changed lines</summary>"
  note ""
  note '```diff'
  head -n 400 "$OUT/schema.diff" >> "$SUMMARY"
  note '```'
  note "</details>"
  note ""

  # --- the regular DB suite on the upgraded database ----------------------------------
  if (cd "$ROOT" && npm run test:db) 2>&1 | tee "$OUT/test-db.log"; then
    note "✅ \`npm run test:db\` passed on the upgraded database."
  else
    note "❌ \`npm run test:db\` failed on the upgraded database: \`$(grep -E 'Tests ' "$OUT/test-db.log" | tail -1)\`"
    fail=1
  fi
  return "$fail"
}

cmd_local() {
  local rc=0 workdir
  echo "Stopping any running local stack of this project..."
  supabase stop --no-backup >/dev/null 2>&1 || true
  : > "$SUMMARY"
  cmd_detect
  if [[ ! -s "$WORK/new-migrations" ]]; then cat "$SUMMARY"; return 0; fi
  cmd_prepare
  workdir="$(native_path "$PROJ")"
  supabase start --workdir "$workdir" -x "$EXCLUDE"
  cmd_verify || rc=$?
  supabase stop --workdir "$workdir" --no-backup || true
  echo; echo "===== summary ($SUMMARY) ====="; cat "$SUMMARY"
  return "$rc"
}

case "${1:-}" in
  detect)  cmd_detect ;;
  prepare) cmd_prepare ;;
  verify)  cmd_verify ;;
  local)   cmd_local ;;
  *) echo "usage: bash migration-upgrade.sh detect|prepare|verify|local" >&2; exit 2 ;;
esac
