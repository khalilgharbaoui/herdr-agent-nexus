#!/bin/sh
# The pane herdr opens for Agent Nexus: the [[panes]] entry "nexus" of herdr-plugin.toml.
# It runs the current version (v5) from wherever this copy of the plugin lives, and keeps what
# a run writes (nexus.pid, stats.json, input.json, shots) in herdr's state directory for the
# plugin, not among the plugin's own files. When v5 cannot start, or stops with an error, the
# reason stays on screen until enter, instead of a pane that closes before anyone can read it.
#
#   NEXUS_DEMO=1   simulated data (the demo action opens the pane with it)
# The operator's own settings are read from nexus.env in the plugin's config directory, see
# lib.sh.

NEXUS_ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
# shellcheck source=herdr/lib.sh
. "$NEXUS_ROOT/herdr/lib.sh"
nexus_load_config

fail() {
  printf '%s\n\nPress enter to close.' "$1"
  # shellcheck disable=SC2034 # only the wait for enter matters
  read -r nexus_reply
  exit 1
}

node=$(nexus_find_node) || fail "$(nexus_node_missing)"

[ -d "$NEXUS_ROOT/node_modules/@napi-rs/canvas" ] || fail "Agent Nexus is not built: $NEXUS_ROOT has no node_modules.
herdr builds a plugin when it installs one from GitHub, and not when it links a local folder.
Build this one by hand:
  sh $NEXUS_ROOT/herdr/build.sh"

RUN=$(nexus_run_dir)
mkdir -p "$RUN" || fail "Agent Nexus cannot write to $RUN"

# One Agent Nexus per user: a second one would write over the first one's files.
if pid=$(nexus_running_pid "$RUN"); then
  fail "Agent Nexus already runs in pane $(cat "$RUN/pane" 2>/dev/null || echo "?") (pid $pid).
Go to that pane, or stop it first with the action \"Agent Nexus: stop\"."
fi

set --
if [ "${NEXUS_DEMO:-}" = 1 ]; then
  set -- --demo
else
  # Live data is opencode's database. Without one there is nothing to show but the demo.
  case " ${NEXUS_ARGS:-} " in
  *" --db "* | *" --demo "* | *" --demo-quiet "*) ;;
  *)
    [ -f "$HOME/.local/share/opencode/opencode.db" ] || fail "Agent Nexus shows the sessions of opencode, and found no opencode database at
  $HOME/.local/share/opencode/opencode.db
Run the action \"Agent Nexus: demo\" to see it with simulated data, or point it at
another database with a line NEXUS_ARGS=\"--db /path/to/opencode.db\" in
  $(nexus_config_file)"
    ;;
  esac
fi

# v5 asks herdr for the panes by running "herdr": make that the herdr this pane belongs to.
if [ -n "${HERDR_BIN_PATH:-}" ]; then
  PATH="$(dirname -- "$HERDR_BIN_PATH"):$PATH"
  export PATH
fi

# The pane this run is in, for the open and stop actions. A hangup (herdr closed the pane, or
# its server went away) is taken so this file is still removed.
printf '%s\n' "${HERDR_PANE_ID:-}" >"$RUN/pane"
trap 'rm -f "$RUN/pane"' EXIT
trap 'exit 129' HUP
trap 'exit 143' TERM

# shellcheck disable=SC2086 # NEXUS_ARGS is a list of arguments
NEXUS_RUN="$RUN" "$node" --no-warnings "$NEXUS_ROOT/v5/nexus.mjs" "$@" ${NEXUS_ARGS:-} 2>"$RUN/stderr.log"
status=$?
[ "$status" -eq 0 ] && exit 0

# It did not end by its own hand, so the terminal is as v5 left it: give it back first (what
# v5 itself sends when it quits: synchronized output off, mouse reports off, its images
# deleted, the cursor back, the main screen back).
printf '\033[?2026l\033[?1016l\033[?1006l\033[?1003l\033_Ga=d,d=A,q=2\033\\\033[?25h\033[?1049l'
stty sane 2>/dev/null
fail "Agent Nexus stopped with an error (exit $status). What it said:

$(tail -n 20 "$RUN/stderr.log" 2>/dev/null)

The whole of it is in $RUN/stderr.log"
