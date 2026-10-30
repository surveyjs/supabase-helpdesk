#!/usr/bin/env bash
# pack-bundle.sh packs what git knows about in deploy/ and nothing that is
# ignored: a scratch repository with the real .gitignore files gets tracked,
# new, ignored, development and deleted files, and the bundle is checked.
#   bash deploy/tests/pack-bundle.test.sh
set -euo pipefail
# Git Bash: git.exe needs the /tmp paths below converted (callers may disable that).
unset MSYS_NO_PATHCONV
ROOT="$(git rev-parse --show-toplevel)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
R="$T/repo"

fails=0
check() { if eval "$2"; then echo "✅ $1"; else echo "❌ $1"; fails=$((fails + 1)); fi; }
put() { mkdir -p "$(dirname "$R/$1")"; printf '%s\n' "${2:-x}" > "$R/$1"; }

git init -q "$R"
cp "$ROOT/.gitignore" "$R/.gitignore"
put deploy/supabase/.gitignore; cp "$ROOT/deploy/supabase/.gitignore" "$R/deploy/supabase/.gitignore"
put deploy/scripts/pack-bundle.sh; cp "$ROOT/deploy/scripts/pack-bundle.sh" "$R/deploy/scripts/pack-bundle.sh"
# Tracked
put deploy/compose.yaml
put deploy/supabase/docker-compose.yml
put deploy/supabase/volumes/functions/main/index.ts
put deploy/supabase/run.sh '#!/bin/sh'; chmod +x "$R/deploy/supabase/run.sh"
put deploy/tests/some.test.sh
put deploy/gone.txt
git -C "$R" -c core.autocrlf=false add -A
git -C "$R" update-index --chmod=+x deploy/supabase/run.sh
git -C "$R" -c user.name=t -c user.email=t@example.com commit -qm init
rm "$R/deploy/gone.txt"
# New, not ignored: an uncommitted file still goes in
put deploy/examples/new.yml
# Ignored, development and runtime files: never go in
put deploy/.env SECRET
put deploy/supabase/.env SECRET
put deploy/local/notes.txt
put deploy/supabase/docker-compose.override.yml
put deploy/supabase/volumes/snippets/mine.sql
put deploy/supabase/volumes/functions/mine/index.ts
put deploy/supabase/volumes/db/data/PG_VERSION
put deploy/supabase/volumes/storage/stub/file
put deploy/backups/db-1.0.0-20261023T000000Z.tar.gz
put deploy/.upgrade-state

(cd "$R" && bash deploy/scripts/pack-bundle.sh 9.9.9 "$T/out/bundle.tgz") > "$T/pack.log" 2>&1 \
  || { cat "$T/pack.log"; echo "❌ pack-bundle.sh failed"; exit 1; }
tar -tvzf "$T/out/bundle.tgz" > "$T/listing"
files="$(awk '{print $NF}' "$T/listing" | sed 's|^\./||' | grep -v '/$' | grep -v '^$' | sort)"
has() { grep -qx "$1" <<<"$files"; }

check "tracked files are packed" 'has compose.yaml && has supabase/docker-compose.yml && has supabase/volumes/functions/main/index.ts'
check "a new file that is not ignored is packed" 'has examples/new.yml'
check "VERSION holds the version" '[[ "$(tar -xzOf "$T/out/bundle.tgz" ./VERSION)" == 9.9.9 ]]'
check "every entry is owned by 0/0, not by the packer's user" '[[ "$(awk "{print \$2}" "$T/listing" | sort -u)" == 0/0 ]]'
check "executables stay executable" 'grep -E " \./supabase/run\.sh$" "$T/listing" | grep -q "^-rwx"'
check "no .env, local, override, snippets, functions, data, storage, backups or state" \
  '! grep -Eq "(^|/)\.env$|^local/|override|snippets|functions/mine|db/data|volumes/storage|^backups/|upgrade-state" <<<"$files"'
check "no development files (scripts/, tests/)" '! grep -Eq "^(scripts|tests)/" <<<"$files"'
check "a tracked file deleted locally is skipped" '! has gone.txt'
check "nothing else is packed" '[[ "$files" == "$(printf "%s\n" VERSION compose.yaml examples/new.yml supabase/.gitignore supabase/docker-compose.yml supabase/run.sh supabase/volumes/functions/main/index.ts | sort)" ]]'

(( fails == 0 )) || { echo "bundle contents:"; cat "$T/listing"; }
exit $(( fails > 0 ))
