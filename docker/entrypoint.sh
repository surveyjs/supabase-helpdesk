#!/bin/sh
# Image commands. `serve` is the default (CMD in the Dockerfile).
set -eu
cmd="${1:-serve}"
[ $# -gt 0 ] && shift
case "$cmd" in
  serve)   node /app/docker/check-schema.mjs; exec node /app/server.js ;;
  status)  exec node /app/docker/check-schema.mjs --report ;;
  migrate) exec sh /app/docker/migrate.sh "$@" ;;
  *) echo "usage: serve | status | migrate [--dry-run] [--backup-confirmed]" >&2; exit 64 ;;
esac
