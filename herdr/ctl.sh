#!/bin/sh
# The actions of herdr-plugin.toml. herdr runs them in the plugin's own folder, with
# HERDR_BIN_PATH, HERDR_PLUGIN_ID, HERDR_PLUGIN_STATE_DIR and HERDR_PLUGIN_CONFIG_DIR set, and
# keeps what they print in its plugin log ("herdr plugin log list").
#
#   ctl.sh open [tab|split] [demo]   open Agent Nexus in a new tab, or beside the focused pane;
#                                    when it already runs, go to its pane instead
#   ctl.sh stop                      stop it and close its pane
#   ctl.sh status                    whether it runs, where, and what it last reported
#
# There is one Agent Nexus per user: it is a view of the whole machine, and its files
# (nexus.pid, stats.json, the pane it is in) live in one run directory.
set -u

NEXUS_ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
# shellcheck source=herdr/lib.sh
. "$NEXUS_ROOT/herdr/lib.sh"
nexus_load_config

H=${HERDR_BIN_PATH:-herdr}
RUN=$(nexus_run_dir)

say() { printf 'agent-nexus: %s\n' "$*"; }
die() {
  say "$*" >&2
  exit 1
}

pane_of_run() { cat "$RUN/pane" 2>/dev/null || true; }

# Closes pane $1 when it is still there, and forgets what a run that is over left behind.
# A run that quits removes its own nexus.pid and pane file. One whose pane was closed while it
# showed an error, or that was killed, cannot (measured: herdr ends such a pane's command
# before its exit trap runs).
forget_run() {
  [ -z "$1" ] || "$H" plugin pane close "$1" >/dev/null 2>&1 || true
  nexus_running_pid "$RUN" >/dev/null || rm -f "$RUN/pane" "$RUN/nexus.pid"
}

open() {
  placement=${1:-tab}
  mode=${2:-live}
  case "$placement" in
  tab | split) ;;
  *) die "open takes tab or split, not $placement" ;;
  esac

  pane=$(pane_of_run)
  if pid=$(nexus_running_pid "$RUN"); then
    if [ -n "$pane" ] && [ "${NEXUS_FOCUS:-1}" != 0 ]; then
      "$H" plugin pane focus "$pane" >/dev/null 2>&1 ||
        die "already running as pid $pid in pane $pane, which this herdr session cannot go to (another session holds it). Stop it first to open it here."
    fi
    say "already running in pane ${pane:-unknown} (pid $pid)"
    return 0
  fi
  # A pane without a running Agent Nexus is one that shows why it stopped: it had its say.
  forget_run "$pane"

  set -- --plugin "$NEXUS_PLUGIN_ID" --entrypoint nexus --placement "$placement"
  if [ "$placement" = tab ]; then
    [ -z "${NEXUS_WORKSPACE:-}" ] || set -- "$@" --workspace "$NEXUS_WORKSPACE"
  else
    # beside the pane the action was called from, upright: v5 is laid out for a tall pane
    [ -z "${HERDR_PANE_ID:-}" ] || set -- "$@" --target-pane "$HERDR_PANE_ID"
    set -- "$@" --direction right
  fi
  if [ "${NEXUS_FOCUS:-1}" = 0 ]; then
    set -- "$@" --no-focus
  else
    set -- "$@" --focus
  fi
  [ "$mode" != demo ] || set -- "$@" --env NEXUS_DEMO=1

  answer=$("$H" plugin pane open "$@" 2>&1) || die "herdr did not open the pane: $answer"
  say "opened in pane $(printf '%s' "$answer" | sed -n 's/.*"pane_id":"\([^"]*\)".*/\1/p') ($placement${mode:+, $mode})"
}

stop() {
  pane=$(pane_of_run)
  if pid=$(nexus_running_pid "$RUN"); then
    # v5 quits on TERM as it does on q: it gives the terminal back and removes nexus.pid
    kill -TERM "$pid" 2>/dev/null
    tries=0
    while kill -0 "$pid" 2>/dev/null && [ "$tries" -lt 50 ]; do
      sleep 0.1
      tries=$((tries + 1))
    done
    if kill -0 "$pid" 2>/dev/null; then
      kill -KILL "$pid" 2>/dev/null
      rm -f "$RUN/nexus.pid"
      say "stopped by force (pid $pid did not quit in five seconds)"
    else
      say "stopped (pid $pid)"
    fi
  else
    say "not running"
  fi
  # The pane closes by itself when Agent Nexus quits. One that is still there shows an error
  # and waits for enter.
  [ -z "$pane" ] || sleep 0.3
  forget_run "$pane"
}

status() {
  say "plugin $NEXUS_PLUGIN_ID at $NEXUS_ROOT"
  say "run directory $RUN"
  if node=$(nexus_find_node); then
    say "node $("$node" -p 'process.versions.node') at $node"
  else
    nexus_node_missing
  fi
  if ! pid=$(nexus_running_pid "$RUN"); then
    say "not running"
    [ ! -s "$RUN/stderr.log" ] || say "its last run stopped with an error: $RUN/stderr.log"
    return 0
  fi
  say "running in pane $(pane_of_run) (pid $pid)"
  [ -n "${node:-}" ] || return 0
  # shellcheck disable=SC2016 # JavaScript, not shell
  "$node" -e '
const fs = require("node:fs")
const file = process.argv[1]
try {
  const stats = JSON.parse(fs.readFileSync(file, "utf8"))
  const age = Math.round((Date.now() - fs.statSync(file).mtimeMs) / 1000)
  const parts = [
    stats.mode,
    `${stats.size} px in ${stats.cols}x${stats.rows} cells`,
    `${stats.fps} fps`,
    `${stats.threads} threads, ${stats.working} working`,
    stats.transport === "sprites" ? `sprites ${stats.graphics?.verdict ?? "unknown"}` : `painted${stats.fallback ? ` (${stats.fallback})` : ""}`,
    `cpu ${stats.cpuPercent}%`,
    `${stats.rssMb} MB`,
    `reported ${age} s ago`,
  ]
  if (stats.error) parts.push(`error: ${String(stats.error).split("\n")[0]}`)
  console.log(`agent-nexus: ${parts.join(", ")}`)
} catch {
  console.log(`agent-nexus: no report yet in ${file}`)
}
' "$RUN/stats.json"
}

case "${1:-}" in
open) open "${2:-tab}" "${3:-live}" ;;
stop) stop ;;
status) status ;;
*)
  die "usage: ctl.sh open [tab|split] [demo] | stop | status"
  ;;
esac
