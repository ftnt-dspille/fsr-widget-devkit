#!/usr/bin/env bash
# Kill ORPHANED e2e harness servers -- and only those.
#
# The e2e make targets used to start with `lsof -ti:14401 | xargs kill -9`,
# which killed whatever held the port: including another run that was
# mid-flight (another session, the IDE). That run then died with exit 137 or
# a wall of net::ERR_CONNECTION_REFUSED. Runs now claim their own port pair
# (tests/e2e/_port.js), so there is nothing to clear except servers whose run
# is gone: a `node server.js` on 14401-14499 whose parent is PID 1. A live
# run's servers always have a live parent (the playwright runner).
set -uo pipefail

for pid in $(lsof -nP -iTCP:14401-14499 -sTCP:LISTEN -t 2>/dev/null | sort -u); do
  ppid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
  cmd=$(ps -o command= -p "$pid" 2>/dev/null)
  if [[ "$ppid" == "1" && "$cmd" == *"server.js"* ]]; then
    echo "reaping orphaned e2e server pid=$pid"
    kill "$pid" 2>/dev/null || true
  fi
done
exit 0
