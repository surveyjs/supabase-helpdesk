#!/usr/bin/env bash
# Vendors Supabase's official self-hosted Docker setup (github.com/supabase/
# supabase, docker/) at a release tag into deploy/supabase/, unmodified: our
# changes live in deploy/compose.bundled.yaml and deploy/supabase.override.yml,
# so moving to a newer tag is a plain re-run plus review of the diff.
#   bash deploy/scripts/vendor-supabase.sh self-hosted/v0.8.3
set -euo pipefail
TAG="${1:?usage: vendor-supabase.sh <self-hosted/vX.Y.Z>}"
ROOT="$(git rev-parse --show-toplevel)"
DEST="$ROOT/deploy/supabase"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

git clone --quiet --depth 1 --branch "$TAG" --filter=blob:none --sparse \
  https://github.com/supabase/supabase "$TMP/repo"
git -C "$TMP/repo" sparse-checkout set docker
sha="$(git -C "$TMP/repo" rev-parse HEAD)"

rm -rf "$DEST"
mkdir -p "$DEST"
# tests/ and dev/ are upstream's own CI and dev mail server — not part of an install.
tar -C "$TMP/repo/docker" --exclude=./tests --exclude=./dev -cf - . | tar -xf - -C "$DEST"
# Not .supabase-version: upstream's .gitignore ignores that name.
printf 'ref=%s\nsha=%s\n' "$TAG" "$sha" > "$DEST/VENDORED"
echo "Vendored $TAG ($sha) into deploy/supabase"
