#!/usr/bin/env bash
# Publishes the release image of a commit that CI already published as
# $IMAGE:sha-<sha> (ci.yml, job publish).
#   bash .github/scripts/release-image.sh <X.Y.Z[-pre]> <sha>
# The release image is derived: FROM :sha-<sha> plus HELPDESK_VERSION and the
# version label. Only the config changes, so the layers are the ones CI tested.
# Before anything is pushed it checks that the image reports X.Y.Z (what
# upgrade.sh compares with /api/health) and that its layers equal the base's.
# Tags pushed: :X.Y.Z; for a stable version also :X.Y if X.Y.Z is the highest
# of the X.Y line, and :latest if it is the highest stable version, both judged
# against the v* tags of the git repository in the working directory.
# Docker's output goes to stderr; stdout gets digest=sha256:… and tags=… (the
# $GITHUB_OUTPUT format). IMAGE defaults to ghcr.io/surveyjs/supabase-helpdesk;
# the test points it at a local registry: .github/scripts/release.test.sh
set -euo pipefail
VERSION="${1:?usage: release-image.sh <version> <sha>}"
SHA="${2:?usage: release-image.sh <version> <sha>}"
IMAGE="${IMAGE:-ghcr.io/surveyjs/supabase-helpdesk}"
HERE="$(cd "$(dirname "$0")" && pwd)"
die() { echo "::error::$*" >&2; exit 1; }

info="$(bash "$HERE/release-version.sh" parse "v$VERSION")" || exit 1
minor="$(sed -n 's/^minor=//p' <<<"$info")"
prerelease="$(sed -n 's/^prerelease=//p' <<<"$info")"
[[ $SHA =~ ^[0-9a-f]{40}$ ]] || die "'$SHA' is not a full commit sha"

BASE="$IMAGE:sha-$SHA"
REF="$IMAGE:$VERSION"
docker pull -q "$BASE" >&2 || die "Cannot pull $BASE"
printf 'FROM %s\nENV HELPDESK_VERSION=%s\nLABEL org.opencontainers.image.version=%s\n' "$BASE" "$VERSION" "$VERSION" \
  | docker build -q -t "$REF" - >&2 || die "Cannot build $REF from $BASE"

# --- checks before any push -------------------------------------------------------------
reported="$(docker run --rm --entrypoint node "$REF" -p process.env.HELPDESK_VERSION | tr -d '\r')" \
  || die "Cannot run node in $REF"
[[ $reported == "$VERSION" ]] || die "$REF reports HELPDESK_VERSION=$reported, not $VERSION"
label="$(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.version"}}' "$REF")"
[[ $label == "$VERSION" ]] || die "$REF has org.opencontainers.image.version=$label, not $VERSION"
layers() { docker inspect --format '{{json .RootFS.Layers}}' "$1"; }
base_layers="$(layers "$BASE")"
[[ "$(layers "$REF")" == "$base_layers" && $base_layers == '["sha256:'* ]] \
  || die "The layers of $REF differ from those of $BASE"

# --- tags ----------------------------------------------------------------------------------
tags=("$VERSION")
if [[ $prerelease == false ]]; then
  released="$(git tag -l 'v*')"
  if [[ "$(bash "$HERE/release-version.sh" highest "$VERSION" "$minor" <<<"$released")" == true ]]; then
    tags+=("$minor")
  else
    echo "::notice::$IMAGE:$minor is left as it is: the $minor line has a higher version than $VERSION" >&2
  fi
  if [[ "$(bash "$HERE/release-version.sh" highest "$VERSION" <<<"$released")" == true ]]; then
    tags+=(latest)
  else
    echo "::notice::$IMAGE:latest is left as it is: there is a higher stable version than $VERSION" >&2
  fi
fi

for tag in "${tags[@]}"; do
  [[ $tag == "$VERSION" ]] || docker tag "$REF" "$IMAGE:$tag"
  docker push -q "$IMAGE:$tag" >&2 || die "Cannot push $IMAGE:$tag"
done

# The digest the registry stored. RepoDigests lists one entry per repository the
# image is tagged in (the containerd image store may keep others), so take $IMAGE's.
ref="$(docker inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$REF" \
  | awk -v repo="$IMAGE@" '!found && index($0, repo) == 1 { print; found = 1 }')"
[[ $ref == "$IMAGE@sha256:"* ]] || die "No digest of $IMAGE after the push (RepoDigests: $ref)"
echo "digest=${ref#*@}"
echo "tags=${tags[*]}"
