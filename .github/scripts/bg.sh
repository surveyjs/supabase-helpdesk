#!/usr/bin/env bash
# Run long commands in the background across GitHub Actions steps (each step
# is its own shell, but processes it detaches keep running until the job ends).
#
#   bash bg.sh start <name> <cmd...>   detach; output -> $RUNNER_TEMP/bg/<name>.log
#   bash bg.sh wait  <name> [timeout]  block until done (default 600 s), print the
#                                      log in a collapsible group, propagate exit code
#
# Always invoked as `bash bg.sh ...`, so the file needs no executable bit.
set -euo pipefail

dir="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/bg"
mkdir -p "$dir"
action="${1:?usage: bg.sh start|wait <name> ...}"
name="${2:?missing task name}"
shift 2

case "$action" in
  start)
    rm -f "$dir/$name.exit"
    # stdout/stderr go to a file and stdin to /dev/null so the step does not
    # wait on inherited pipes; setsid (when present) detaches from the step's
    # process group. The exit code is written atomically (tmp file + mv).
    detach=()
    command -v setsid >/dev/null 2>&1 && detach=(setsid)
    nohup "${detach[@]}" bash -c '"${@:2}"; echo $? > "$1.tmp" && mv "$1.tmp" "$1"' \
      bg-task "$dir/$name.exit" "$@" > "$dir/$name.log" 2>&1 < /dev/null &
    echo "started '$name' in background (log: $dir/$name.log)"
    ;;
  wait)
    timeout="${1:-600}"
    SECONDS=0
    until [[ -f "$dir/$name.exit" ]]; do
      if (( SECONDS >= timeout )); then
        echo "::error title=$name timed out::still running after ${timeout}s"
        cat "$dir/$name.log" || true
        exit 1
      fi
      sleep 2
    done
    code="$(cat "$dir/$name.exit")"
    echo "::group::$name output (exit $code, waited ${SECONDS}s)"
    cat "$dir/$name.log"
    echo "::endgroup::"
    if [[ "$code" != 0 ]]; then
      echo "::error title=$name failed::exit code $code (see the '$name output' group)"
      exit "$code"
    fi
    ;;
  *)
    echo "unknown action: $action" >&2
    exit 2
    ;;
esac
