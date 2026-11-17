#!/bin/sh
# The actions of herdr-plugin.toml. herdr runs them in the plugin's own folder, with
# HERDR_BIN_PATH, HERDR_PLUGIN_ID, HERDR_PLUGIN_STATE_DIR and HERDR_PLUGIN_CONFIG_DIR set, and
# keeps what they print in its plugin log ("herdr plugin log list").
#
#   ctl.sh open [tab|split] [demo]   open Agent Nexus in a new tab, or beside the focused pane;
#                                    when it already runs, go to its pane instead
#   ctl.sh stop                      stop it and close its pane
#   ctl.sh status                    whether it runs, where, and what it last reported
#   ctl.sh startup                   the [[startup]] entry: herdr runs it when its server has
#                                    started. Brings Agent Nexus back when it ran as the
#                                    server stopped
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

# One open at a time. v5 writes nexus.pid a moment after its pane opens, so a second call in
# that moment (a key pressed twice, or the startup entry and a hand at once) would see nothing
# running and open a second pane. A mark older than a minute is from an open that was cut
# off, and is taken over.
one_at_a_time() {
  mkdir -p "$RUN" || die "cannot write to $RUN"
  if ! mkdir "$RUN/opening" 2>/dev/null && [ -z "$(find "$RUN/opening" -maxdepth 0 -mmin +1 2>/dev/null)" ]; then
    say "already opening"
    return 1
  fi
  trap 'rmdir "$RUN/opening" 2>/dev/null' EXIT
}

# The id of the pane herdr just opened, from its answer to "plugin pane open".
opened_pane() { printf '%s' "$1" | sed -n 's/.*"pane_id":"\([^"]*\)".*/\1/p'; }

# A pane is open. Whether Agent Nexus runs in it is known once v5 has the terminal and has
# written nexus.pid: up to eight seconds for that. Leaves the pid in $pid.
wait_for_v5() {
  tries=0
  until pid=$(nexus_running_pid "$RUN") || [ "$tries" -ge 80 ]; do
    sleep 0.1
    tries=$((tries + 1))
  done
  [ -n "$pid" ]
}

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

  one_at_a_time || return 0

  pane=$(pane_of_run)
  if pid=$(nexus_running_pid "$RUN"); then
    if [ -n "$pane" ] && [ "${NEXUS_FOCUS:-1}" != 0 ]; then
      "$H" plugin pane focus "$pane" >/dev/null 2>&1 ||
        die "already running as pid $pid, in a pane herdr cannot go to as $pane (it was moved to another workspace, or another herdr session holds it). Stop it to open it afresh."
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
    # to the right of the pane the action was called from, which makes a tall pane: the
    # upright layout is the one v5 has finished
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
  pane=$(opened_pane "$answer")
  wait_for_v5 || die "pane ${pane:-?} is open, but Agent Nexus has not started in it: the pane says why"
  say "running in pane ${pane:-?} (pid $pid, $placement, $mode)"
}

# The [[startup]] entry of herdr-plugin.toml. herdr runs it once when its server has started
# and restored the session, and again when a new server takes over from a running one (a live
# handoff). What it prints is in herdr's plugin log, as an action's is.
#
# A server that stops takes Agent Nexus with it, and the one that starts puts a new shell in
# every pane it restores. So when Agent Nexus ran as the server stopped, its pane is back, in
# the plugin's folder, with nothing in it. The record of the run (see "reopen" in lib.sh)
# names that pane, and herdr keeps a pane's id across a restart. Agent Nexus is brought back
# in exactly that place: a plugin pane is opened as a split of the restored shell, and the
# shell is closed, which leaves the new pane with the whole of the old one's room.
#
# It is not brought back when the pane is gone from the layout (it was closed before the
# server stopped, so Agent Nexus was not running then), when the pane has become something
# else (another folder, an agent), when the record is another herdr session's, or when
# NEXUS_REOPEN=0 says so. The focus stays where herdr restored it.
startup() {
  if [ ! -f "$RUN/reopen" ]; then
    say "nothing to bring back: Agent Nexus was not running when the server stopped"
    return 0
  fi
  was_socket=$(nexus_reopen_value "$RUN" socket)
  was_pane=$(nexus_reopen_value "$RUN" pane)
  was_root=$(nexus_reopen_value "$RUN" root)
  was_mode=$(nexus_reopen_value "$RUN" mode)

  # Every herdr session has a server of its own, each runs this entry, and there is one
  # Agent Nexus per user: only the session it ran in brings it back.
  if [ -n "$was_socket" ] && [ -n "${HERDR_SOCKET_PATH:-}" ] && [ "$was_socket" != "$HERDR_SOCKET_PATH" ]; then
    say "left as it is: Agent Nexus ran in another herdr session ($was_socket)"
    return 0
  fi
  # A live handoff keeps every pane's process: nothing stopped, so there is nothing to do.
  if pid=$(nexus_running_pid "$RUN"); then
    say "still running in pane ${was_pane:-unknown} (pid $pid): nothing to bring back"
    return 0
  fi
  # Nor when its pane script is at work in that pane without v5's pid on file: it is between
  # writing the record and v5's first sign of life, or it shows why v5 stopped.
  if [ -n "$was_pane" ]; then
    case "$("$H" pane process-info --pane "$was_pane" 2>&1)" in
    *herdr/pane.sh* | *v5/nexus.mjs*)
      say "left as it is: Agent Nexus is at work in pane $was_pane"
      return 0
      ;;
    esac
  fi
  one_at_a_time || return 0
  # From here on the record is used up, whatever comes of it. One that outlived a server
  # start could bring Agent Nexus back later into a pane that has since become something else.
  rm -f "$RUN/reopen"
  if [ "${NEXUS_REOPEN:-1}" = 0 ]; then
    say "not brought back: NEXUS_REOPEN=0 in $(nexus_config_file)"
    return 0
  fi
  if [ -z "$was_pane" ] || [ -z "$was_root" ]; then
    say "not brought back: the record of the last run names no pane"
    return 0
  fi

  # The answer is one line of JSON, and a folder is written in it as it is unless it holds a
  # quote or a backslash. Such a folder is not recognized, and then nothing is touched.
  # A server that has only just started may not answer its first call: it is asked for
  # five seconds before that counts as no answer.
  tries=0
  while :; do
    answer=$("$H" pane get "$was_pane" 2>&1) || true
    case "$answer" in
    *'"pane_not_found"'* | *'"pane_id":"'"$was_pane"'"'*) break ;;
    esac
    tries=$((tries + 1))
    [ "$tries" -lt 10 ] || break
    sleep 0.5
  done
  now_root=$(printf '%s' "$answer" | sed -n 's/.*"cwd":"\([^"]*\)".*/\1/p')
  now_root=$(CDPATH='' cd -- "${now_root:-/nonexistent}" 2>/dev/null && pwd -P)
  case "$answer" in
  *'"pane_not_found"'*)
    say "not brought back: pane $was_pane was closed before the server stopped"
    return 0
    ;;
  *'"pane_id":"'"$was_pane"'"'*) ;;
  *) die "not brought back: herdr did not answer for pane $was_pane: $answer" ;;
  esac
  case "$answer" in
  *'"agent":"'*)
    say "not brought back: pane $was_pane holds an agent now"
    return 0
    ;;
  esac
  if [ "$now_root" != "$was_root" ]; then
    say "not brought back: pane $was_pane is no longer in $was_root"
    return 0
  fi

  set -- --plugin "$NEXUS_PLUGIN_ID" --entrypoint nexus --placement split \
    --target-pane "$was_pane" --direction right --no-focus
  [ "$was_mode" != demo ] || set -- "$@" --env NEXUS_DEMO=1
  answer=$("$H" plugin pane open "$@" 2>&1) || die "not brought back: herdr did not open a pane beside $was_pane: $answer"
  pane=$(opened_pane "$answer")
  # Plain "pane close": herdr's record of which panes a plugin opened does not outlive its
  # server, so "plugin pane close" does not know the restored shell.
  "$H" pane close "$was_pane" >/dev/null 2>&1 || say "the restored shell in pane $was_pane could not be closed"
  wait_for_v5 || die "pane ${pane:-?} took the place of $was_pane, but Agent Nexus has not started in it: the pane says why"
  say "brought back in pane ${pane:-?} (pid $pid, ${was_mode:-live}), in the place of $was_pane"
}

stop() {
  pane=$(pane_of_run)
  # stopped by hand: it stays stopped across a server restart
  rm -f "$RUN/reopen"
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
    [ ! -f "$RUN/reopen" ] || say "it was cut off in pane $(nexus_reopen_value "$RUN" pane): the next start of herdr's server brings it back if that pane is still there"
    return 0
  fi
  say "running in pane $(pane_of_run) (pid $pid)"
  if [ "${NEXUS_REOPEN:-1}" = 0 ]; then
    say "after a restart of herdr's server it stays closed (NEXUS_REOPEN=0)"
  elif [ -f "$RUN/reopen" ]; then
    say "after a restart of herdr's server it comes back in this pane"
  fi
  [ -n "${node:-}" ] || return 0
  # shellcheck disable=SC2016 # JavaScript, not shell
  "$node" -e '
const fs = require("node:fs")
const [file, pidFile] = process.argv.slice(1)
try {
  // a report from before this run started is the last run speaking, not this one
  if (fs.statSync(file).mtimeMs < fs.statSync(pidFile).mtimeMs) throw new Error("stale")
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
  console.log(`agent-nexus: no report of this run yet in ${file} (it writes one every two seconds)`)
}
' "$RUN/stats.json" "$RUN/nexus.pid"
}

case "${1:-}" in
open) open "${2:-tab}" "${3:-live}" ;;
stop) stop ;;
status) status ;;
startup) startup ;;
*)
  die "usage: ctl.sh open [tab|split] [demo] | stop | status | startup"
  ;;
esac
