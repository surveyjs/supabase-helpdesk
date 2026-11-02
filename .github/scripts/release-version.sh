#!/usr/bin/env bash
# Release tag rules, shared by release.yml and release-image.sh.
#   release-version.sh parse <tag>
#     vX.Y.Z (stable) or vX.Y.Z-pre (prerelease, semver identifiers, no +build:
#     Docker tags cannot hold '+'). Prints version=, minor= and prerelease=
#     lines (the $GITHUB_OUTPUT format); anything else is an ::error:: and exit 1.
#   release-version.sh highest <X.Y.Z> [<X.Y>]  < tags
#     Prints true if X.Y.Z is at least every stable vA.B.C tag read from stdin
#     (only those of the X.Y line when X.Y is given), else false. Prereleases
#     and tags that are not versions are ignored; X.Y.Z need not be among them.
# Test: .github/scripts/release.test.sh
set -euo pipefail
NUM='(0|[1-9][0-9]*)'
ID='[0-9A-Za-z-]+'
TAG_RE="^v$NUM\\.$NUM\\.$NUM(-$ID(\\.$ID)*)?\$"
STABLE_RE="^v$NUM\\.$NUM\\.$NUM\$"

parse() {
  local tag="$1"
  if ! [[ $tag =~ $TAG_RE ]] || (( ${#tag} > 128 )); then
    echo "::error::Tag '$tag' is not a release version: vX.Y.Z or vX.Y.Z-pre (for example v1.2.3, v1.2.3-rc.1)" >&2
    exit 1
  fi
  local version="${tag#v}"
  echo "version=$version"
  echo "minor=${BASH_REMATCH[1]}.${BASH_REMATCH[2]}"
  if [[ $version == *-* ]]; then echo "prerelease=true"; else echo "prerelease=false"; fi
}

highest() {
  local version="$1" line="${2:-}"
  [[ "v$version" =~ $STABLE_RE ]] || { echo "::error::'$version' is not a stable X.Y.Z version" >&2; exit 1; }
  local x="${BASH_REMATCH[1]}" y="${BASH_REMATCH[2]}" z="${BASH_REMATCH[3]}" tag
  while IFS= read -r tag; do
    tag="${tag%$'\r'}"
    [[ $tag =~ $STABLE_RE ]] || continue
    local a="${BASH_REMATCH[1]}" b="${BASH_REMATCH[2]}" c="${BASH_REMATCH[3]}"
    [[ -z $line || "$a.$b" == "$line" ]] || continue
    if (( a > x || (a == x && (b > y || (b == y && c > z))) )); then
      echo false
      return
    fi
  done
  echo true
}

case "${1:-}" in
  parse) parse "${2-}" ;;
  highest) highest "${2:?usage: release-version.sh highest <X.Y.Z> [<X.Y>] < tags}" "${3:-}" ;;
  *) echo "usage: release-version.sh parse <tag> | highest <X.Y.Z> [<X.Y>] < tags" >&2; exit 2 ;;
esac
