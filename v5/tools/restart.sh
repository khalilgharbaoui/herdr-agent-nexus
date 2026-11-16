#!/bin/sh
# Restarts v5 in its herdr pane, in place: q, then the same command line again.
#   v5/tools/restart.sh [pane id]
PANE="${1:-wE:p1QF}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
if [ -f "$HERE/nexus.pid" ] && kill -0 "$(cat "$HERE/nexus.pid")" 2>/dev/null; then
  herdr pane send-text "$PANE" q
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    [ -f "$HERE/nexus.pid" ] || break
    sleep 0.2
  done
fi
rm -f "$HERE/nexus.pid"
herdr pane send-text "$PANE" "node --no-warnings v5/nexus.mjs
"
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40; do
  [ -f "$HERE/nexus.pid" ] && break
  sleep 0.4
done
[ -f "$HERE/nexus.pid" ] && echo "v5 runs in $PANE as pid $(cat "$HERE/nexus.pid")" || echo "v5 did not start in $PANE"
