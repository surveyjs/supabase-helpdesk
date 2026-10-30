#!/usr/bin/env bash
# Tests of the release rules (release-version.sh: tags, the highest version)
# and of release-image.sh against a local registry:2: the derived image reports
# X.Y.Z, keeps the layers of :sha-<sha>, and :X.Y / :latest move only for the
# highest version. release.yml itself runs only on a tag in GitHub.
#   bash .github/scripts/release.test.sh              # all (needs Docker)
#   bash .github/scripts/release.test.sh --no-docker  # the rules only
set -uo pipefail
# Git Bash: git.exe needs the /tmp paths below converted (callers may disable that).
unset MSYS_NO_PATHCONV
HERE="$(cd "$(dirname "$0")" && pwd)"
fails=0
check() { if eval "$2"; then echo "✅ $1"; else echo "❌ $1 (exit $rc)"; sed 's/^/    /' <<<"$out"; fails=$((fails + 1)); fi; }
parse() { out="$(bash "$HERE/release-version.sh" parse "$1" 2>&1)"; rc=$?; }
field() { sed -n "s/^$1=//p" <<<"$out"; }
TAGS=$'v1.0.0\nv1.2.3\nv1.10.0-rc.1\nv2.0.0-rc.1\nvfoo\nv3.0\nrelease-9.9.9'
highest() { out="$(bash "$HERE/release-version.sh" highest "$@" <<<"$TAGS" 2>&1)"; rc=$?; }

# --- tags -------------------------------------------------------------------------------
parse v1.2.3
check "v1.2.3 is a stable release 1.2.3 of the 1.2 line" '[[ $rc == 0 && $(field version) == 1.2.3 && $(field minor) == 1.2 && $(field prerelease) == false ]]'
parse v1.2.3-rc.1
check "v1.2.3-rc.1 is a prerelease 1.2.3-rc.1" '[[ $rc == 0 && $(field version) == 1.2.3-rc.1 && $(field minor) == 1.2 && $(field prerelease) == true ]]'
parse v0.10.0-beta-2.x.7
check "v0.10.0-beta-2.x.7 is a prerelease" '[[ $rc == 0 && $(field version) == 0.10.0-beta-2.x.7 && $(field prerelease) == true ]]'
for bad in 1.2.3 v1.2 vfoo v1.2.3.4 v01.2.3 v1.2.3- v1.2.3-rc..1 v1.2.3+build.1 'v1.2.3 ' V1.2.3 ''; do
  parse "$bad"
  check "'$bad' is rejected with an ::error::" '[[ $rc == 1 && $out == "::error::"*"vX.Y.Z or vX.Y.Z-pre"* ]]'
done

# --- the highest stable version (:latest) and of a line (:X.Y) ---------------------------
highest 1.2.3;   check "1.2.3 among v1.0.0, v1.2.3 (and prereleases): :latest" '[[ $rc == 0 && $out == true ]]'
highest 1.2.4;   check "1.2.4, not tagged yet, above all: :latest" '[[ $out == true ]]'
highest 1.2.2;   check "1.2.2 below v1.2.3: not :latest" '[[ $out == false ]]'
highest 1.9.0;   check "numbers compare as numbers: 1.9.0 above v1.2.3, prerelease v1.10.0-rc.1 ignored" '[[ $out == true ]]'
TAGS+=$'\nv1.10.0'
highest 1.9.0;   check "... and below a stable v1.10.0" '[[ $out == false ]]'
highest 2.0.0;   check "2.0.0 above every stable tag (v2.0.0-rc.1 ignored): :latest" '[[ $out == true ]]'
highest 1.0.1;   check "1.0.1 below v1.2.3: not :latest" '[[ $out == false ]]'
highest 1.0.1 1.0; check "... but the highest of the 1.0 line: :1.0" '[[ $out == true ]]'
highest 1.2.2 1.2; check "1.2.2 below v1.2.3 of its line: not :1.2" '[[ $out == false ]]'
TAGS=''
highest 0.1.0;   check "no tags at all: the first release is :latest" '[[ $out == true ]]'
TAGS=$'v1.2.3\r\nv0.9.0\r'
highest 1.0.0;   check "CRLF tag lists are read too" '[[ $out == false ]]'
highest 1.2.3-rc.1
check "highest of a prerelease is an error" '[[ $rc == 1 && $out == "::error::"* ]]'

if [[ ${1:-} == --no-docker ]]; then
  echo "ℹ️  release-image.sh not run (--no-docker)"
  echo; if [[ $fails == 0 ]]; then echo "All checks passed"; else echo "$fails check(s) failed"; fi
  exit $(( fails > 0 ))
fi

# --- release-image.sh against a local registry ------------------------------------------
T="$(mktemp -d)"
REGISTRY="helpdesk-release-test-$$"
NAME=helpdesk-release-test
cleanup() {
  local refs
  refs="$(docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | grep -F "/$NAME:")"
  [[ -n $refs ]] && docker rmi -f $refs >/dev/null 2>&1
  docker rm -f -v "$REGISTRY" >/dev/null 2>&1
  rm -rf "$T"
}
trap cleanup EXIT

# Host networking: Docker Desktop's daemon cannot reach a published port on
# localhost, but it reaches the registry in its own network namespace. The API
# is read from inside the registry container (busybox wget) for the same reason.
PORT="${REGISTRY_PORT:-5000}"
docker run -d --name "$REGISTRY" --network host -e "REGISTRY_HTTP_ADDR=127.0.0.1:$PORT" registry:2 >/dev/null \
  || { echo "❌ cannot start registry:2"; exit 1; }
export IMAGE="localhost:$PORT/$NAME"
API="http://127.0.0.1:$PORT/v2/$NAME"
api() { docker exec "$REGISTRY" wget -q "$@"; }
for _ in $(seq 50); do api -O - "http://127.0.0.1:$PORT/v2/" >/dev/null 2>&1 && break; sleep 0.2; done

SHA=0123456789abcdef0123456789abcdef01234567
OTHER_SHA=89abcdef0123456789abcdef0123456789abcdef
out="$(printf 'FROM node:24-alpine\nENV HELPDESK_VERSION=sha-test\n' | docker build -q -t "$IMAGE:sha-$SHA" - 2>&1 \
  && docker push -q "$IMAGE:sha-$SHA" 2>&1)"; rc=$?
check "base image pushed as :sha-<sha> to $IMAGE" '[[ $rc == 0 ]]'
BASE_LAYERS="$(docker inspect --format '{{json .RootFS.Layers}}' "$IMAGE:sha-$SHA")"

# A scratch repository with the release tags (release-image.sh reads `git tag`).
REPO="$T/repo"
git init -q "$REPO" && git -C "$REPO" -c user.name=t -c user.email=t@t commit -q --allow-empty -m x
tag() { local t; for t in "$@"; do git -C "$REPO" tag "$t"; done; }
release() { out="$(cd "$REPO" && bash "$HERE/release-image.sh" "$@" 2>"$T/err")"; rc=$?; out+=$'\n'"$(cat "$T/err")"; }
digest_of() { # the digest the registry serves for a tag
  api -S -O - "$API/manifests/$1" \
    --header 'Accept: application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json' \
    2>&1 >/dev/null | tr -d '\r' | sed -n 's/^ *[Dd]ocker-[Cc]ontent-[Dd]igest: //p'
}
registry_tags() { api -O - "$API/tags/list" | tr -d '"[]{}' | sed 's/.*tags://' | tr ',' '\n' | sort | xargs; }
# Runs the pushed tag from the registry (the local copy is removed first).
reports() { docker rmi -f "$IMAGE:$1" >/dev/null 2>&1; docker pull -q "$IMAGE:$1" >/dev/null 2>&1 \
  && docker run --rm --entrypoint node "$IMAGE:$1" -p process.env.HELPDESK_VERSION | tr -d '\r'; }
layers_of() { docker inspect --format '{{json .RootFS.Layers}}' "$IMAGE:$1"; }

tag v1.0.0 v1.2.3 v2.0.0-rc.1
release 1.2.3 "$SHA"
D123="$(sed -n 's/^digest=//p' <<<"$out")"
check "1.2.3, the highest stable: pushes :1.2.3, :1.2 and :latest" '[[ $rc == 0 && $(sed -n "s/^tags=//p" <<<"$out") == "1.2.3 1.2 latest" && $(registry_tags) == "1.2 1.2.3 latest sha-$SHA" ]]'
check "... the registry serves the printed digest for all three" '[[ $D123 == sha256:* && $(digest_of 1.2.3) == "$D123" && $(digest_of 1.2) == "$D123" && $(digest_of latest) == "$D123" ]]'
check "... :1.2.3 from the registry reports HELPDESK_VERSION=1.2.3" '[[ $(reports 1.2.3) == 1.2.3 ]]'
check "... with the layers of :sha-<sha>" '[[ -n $BASE_LAYERS && $(layers_of 1.2.3) == "$BASE_LAYERS" ]]'
check "... and the version label 1.2.3" '[[ $(docker inspect --format "{{index .Config.Labels \"org.opencontainers.image.version\"}}" "$IMAGE:1.2.3") == 1.2.3 ]]'

tag v1.1.9
release 1.1.9 "$SHA"
check "1.1.9, an older line: pushes :1.1.9 and :1.1, not :latest" '[[ $rc == 0 && $(sed -n "s/^tags=//p" <<<"$out") == "1.1.9 1.1" && $(digest_of latest) == "$D123" ]] && grep -q "::notice::.*:latest is left" <<<"$out"'
check "... :1.1.9 reports 1.1.9 with the same layers" '[[ $(reports 1.1.9) == 1.1.9 && $(layers_of 1.1.9) == "$BASE_LAYERS" ]]'

tag v1.2.4
release 1.2.3 "$SHA"
check "1.2.3 released again after v1.2.4: only :1.2.3 moves, :1.2 and :latest stay" '[[ $rc == 0 && $(sed -n "s/^tags=//p" <<<"$out") == "1.2.3" && $(digest_of 1.2.3) == "$(sed -n "s/^digest=//p" <<<"$out")" && $(digest_of 1.2) == "$D123" && $(digest_of latest) == "$D123" ]]'

release 2.0.0-rc.1 "$SHA"
check "2.0.0-rc.1, a prerelease: only :2.0.0-rc.1, reporting 2.0.0-rc.1" '[[ $rc == 0 && $(sed -n "s/^tags=//p" <<<"$out") == "2.0.0-rc.1" && $(digest_of latest) == "$D123" && $(reports 2.0.0-rc.1) == 2.0.0-rc.1 ]]'

release 1.3.0 "$OTHER_SHA"
check "a commit without :sha-<sha>: ::error::, exit 1, nothing pushed" '[[ $rc == 1 && $out == *"::error::Cannot pull"* && $(registry_tags) == *latest* && $(registry_tags) != *1.3.0* ]]'

# A base that cannot report its version (no node): the checks stop it before any push.
out="$(printf 'FROM alpine:3.22\nENV HELPDESK_VERSION=sha-test\n' | docker build -q -t "$IMAGE:sha-$OTHER_SHA" - 2>&1 \
  && docker push -q "$IMAGE:sha-$OTHER_SHA" 2>&1)" || echo "❌ cannot push the base without node: $out"
release 1.4.0 "$OTHER_SHA"
check "an image that does not report X.Y.Z: ::error::, exit 1, nothing pushed" '[[ $rc == 1 && $out == *"::error::Cannot run node"* && $(registry_tags) == *latest* && $(registry_tags) != *1.4.0* ]]'

release 1.2 "$SHA"
check "a version that is not X.Y.Z: ::error:: before Docker, exit 1" '[[ $rc == 1 && $out == *"::error::Tag '"'"'v1.2'"'"'"* ]]'

release 1.3.0 "sha-$SHA"
check "a sha that is not a full commit sha: ::error::, exit 1" '[[ $rc == 1 && $out == *"not a full commit sha"* ]]'

echo; if [[ $fails == 0 ]]; then echo "All checks passed"; else echo "$fails check(s) failed"; fi
exit $(( fails > 0 ))
