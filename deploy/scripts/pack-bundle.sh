#!/usr/bin/env bash
# Packs the operator bundle of a version: deploy/ without development files,
# plus VERSION (upgrade.sh checks it).
#   bash deploy/scripts/pack-bundle.sh <version> <out.tgz>
set -euo pipefail
VERSION="${1:?usage: pack-bundle.sh <version> <out.tgz>}"
OUT="${2:?usage: pack-bundle.sh <version> <out.tgz>}"
ROOT="$(git rev-parse --show-toplevel)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

tar -C "$ROOT/deploy" --exclude=./scripts --exclude=./tests --exclude=./.env \
  --exclude=./backups --exclude=./.upgrade-state \
  --exclude=./supabase/volumes/db/data --exclude=./supabase/volumes/storage \
  -cf - . | tar -xf - -C "$STAGE"
printf '%s\n' "$VERSION" > "$STAGE/VERSION"
mkdir -p "$(dirname "$OUT")"
tar -C "$STAGE" -czf "$OUT" .
echo "$OUT"
