#!/bin/sh
# Image commands. `serve` is the default (CMD in the Dockerfile).
set -eu
cmd="${1:-serve}"
[ $# -gt 0 ] && shift
case "$cmd" in
  serve)   node /app/docker/check-schema.mjs; exec node /app/server.js ;;
  status)  exec node /app/docker/check-schema.mjs --report ;;
  migrate) exec sh /app/docker/migrate.sh "$@" ;;
  scheduler) exec node /app/docker/scheduler.mjs ;;
  init-env) exec node /app/docker/init-env.mjs "$@" ;;
  admin) exec node /app/docker/admin.mjs "$@" ;;
  *) echo "usage: serve | status | migrate [--dry-run] [--backup-confirmed] | scheduler | init-env --mode bundled|external --app-url URL [--edge caddy|own] [--version V] | admin create|reset-password --email EMAIL" >&2; exit 64 ;;
esac
