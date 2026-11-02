#!/usr/bin/env bash
# Packs the operator bundle of a version: deploy/ without development files,
# plus VERSION (upgrade.sh checks it).
#   bash deploy/scripts/pack-bundle.sh <version> <out.tgz>
# Only files git knows about go in: tracked ones and new ones that are not
# ignored (so uncommitted edits are packed). Ignored files never are — .env
# secrets, database data, Studio snippets, local overrides — because upgrade.sh
# unpacks a bundle over an installation. Test: deploy/tests/pack-bundle.test.sh
set -euo pipefail
VERSION="${1:?usage: pack-bundle.sh <version> <out.tgz>}"
OUT="${2:?usage: pack-bundle.sh <version> <out.tgz>}"
ROOT="$(git rev-parse --show-toplevel)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# Paths relative to deploy/, without development files and runtime state; a
# tracked file deleted in the working tree is skipped.
git -C "$ROOT" -c core.quotePath=false ls-files -co --exclude-standard -- deploy \
  | sed -n 's|^deploy/||p' \
  | grep -Ev '^(scripts|tests|backups)/|^\.upgrade-state$|(^|/)\.env$' \
  | while IFS= read -r f; do if [[ -f "$ROOT/deploy/$f" ]]; then printf '%s\n' "$f"; fi; done \
  > "$STAGE/files"
mkdir "$STAGE/bundle"
# Owned by root (0/0): the packer's uid means nothing on the host, and root unpacking it
# (tar keeps owners for root) must not hand the files to some local user.
OWNER=(--owner=0 --group=0 --numeric-owner)
tar -C "$ROOT/deploy" "${OWNER[@]}" -cf - -T "$STAGE/files" | tar -xpf - -C "$STAGE/bundle"
printf '%s\n' "$VERSION" > "$STAGE/bundle/VERSION"
mkdir -p "$(dirname "$OUT")"
tar -C "$STAGE/bundle" "${OWNER[@]}" -czf "$OUT" .
echo "$OUT"
