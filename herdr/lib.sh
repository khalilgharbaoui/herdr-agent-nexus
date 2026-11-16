# Shared by build.sh, pane.sh and ctl.sh. Sourced, never run. POSIX sh.

# The oldest Node.js that runs v5. Measured: 22.13.0 runs it, 22.12.0 stops at
# "No such built-in module: node:sqlite" (22.13 is where node:sqlite needs no flag).
NEXUS_MIN_NODE=22.13
NEXUS_MIN_MAJOR=22
NEXUS_MIN_MINOR=13

NEXUS_PLUGIN_ID=${HERDR_PLUGIN_ID:-khalilgharbaoui.agent-nexus}

# The file with the operator's own settings: nexus.env in the plugin's config directory, which
# herdr creates and never touches ("herdr plugin config-dir khalilgharbaoui.agent-nexus"
# prints it). Outside herdr the same place is worked out by herdr's own rule.
nexus_config_file() {
  if [ -n "${HERDR_PLUGIN_CONFIG_DIR:-}" ]; then
    printf '%s\n' "$HERDR_PLUGIN_CONFIG_DIR/nexus.env"
  else
    printf '%s\n' "${XDG_CONFIG_HOME:-$HOME/.config}/herdr/plugins/config/$NEXUS_PLUGIN_ID/nexus.env"
  fi
}

# Reads those settings: one KEY=value a line, the value as written or in one pair of quotes.
# NEXUS_NODE       the node to run, when herdr's PATH has none that is new enough
# NEXUS_ARGS       more arguments for v5/nexus.mjs, such as --fps 20 or --db /path/opencode.db
# NEXUS_FOCUS      0 opens the pane without switching to it
# NEXUS_WORKSPACE  the workspace a new tab opens in, instead of the active one
# The file is read, not run: a line that is not one of these four is skipped, so a slip in it
# cannot stop the pane from opening, and nothing in it is ever executed.
nexus_load_config() {
  nexus_config=$(nexus_config_file)
  [ -f "$nexus_config" ] || return 0
  while IFS= read -r nexus_line || [ -n "$nexus_line" ]; do
    case "$nexus_line" in
    NEXUS_NODE=* | NEXUS_ARGS=* | NEXUS_FOCUS=* | NEXUS_WORKSPACE=*)
      nexus_key=${nexus_line%%=*}
      nexus_value=${nexus_line#*=}
      case "$nexus_value" in
      \"*\")
        nexus_value=${nexus_value#\"}
        nexus_value=${nexus_value%\"}
        ;;
      \'*\')
        nexus_value=${nexus_value#\'}
        nexus_value=${nexus_value%\'}
        ;;
      esac
      # the key is one of the four names above, so this assigns and runs nothing
      eval "$nexus_key=\$nexus_value"
      ;;
    esac
  done <"$nexus_config"
}

# Succeeds when $1 is a Node.js version of at least NEXUS_MIN_NODE.
nexus_version_ok() {
  nexus_major=${1%%.*}
  nexus_rest=${1#*.}
  nexus_minor=${nexus_rest%%.*}
  case "$nexus_major$nexus_minor" in
  "" | *[!0-9]*) return 1 ;;
  esac
  [ "$nexus_major" -gt "$NEXUS_MIN_MAJOR" ] && return 0
  [ "$nexus_major" -eq "$NEXUS_MIN_MAJOR" ] && [ "$nexus_minor" -ge "$NEXUS_MIN_MINOR" ]
}

# Prints the first node that is new enough and succeeds, or fails and leaves in
# NEXUS_NODE_TOO_OLD the one it met that was not ("path (version)"), for the message.
# herdr starts plugin commands with the PATH its server was started with, which may hold
# no node at all, so the places version managers and package managers put one are tried too.
nexus_find_node() {
  NEXUS_NODE_TOO_OLD=
  for nexus_candidate in \
    "${NEXUS_NODE:-}" \
    "$(command -v node 2>/dev/null)" \
    "$HOME/.local/share/mise/shims/node" \
    "$HOME/.asdf/shims/node" \
    "$HOME/.volta/bin/node" \
    "$HOME/.local/share/fnm/aliases/default/bin/node" \
    "$HOME/Library/Application Support/fnm/aliases/default/bin/node" \
    "${NVM_DIR:-$HOME/.nvm}"/versions/node/*/bin/node \
    /opt/homebrew/bin/node \
    /home/linuxbrew/.linuxbrew/bin/node \
    /usr/local/bin/node \
    "$HOME/.local/bin/node" \
    /usr/bin/node; do
    [ -n "$nexus_candidate" ] && [ -x "$nexus_candidate" ] || continue
    nexus_version=$("$nexus_candidate" -p 'process.versions.node' 2>/dev/null) || continue
    if nexus_version_ok "$nexus_version"; then
      printf '%s\n' "$nexus_candidate"
      return 0
    fi
    [ -n "$NEXUS_NODE_TOO_OLD" ] || NEXUS_NODE_TOO_OLD="$nexus_candidate ($nexus_version)"
  done
  return 1
}

# Why no node was found, for whoever reads the pane or the build output.
nexus_node_missing() {
  if [ -n "${NEXUS_NODE_TOO_OLD:-}" ]; then
    printf 'Agent Nexus needs Node.js %s or newer. Found only %s.\n' "$NEXUS_MIN_NODE" "$NEXUS_NODE_TOO_OLD"
  else
    printf 'Agent Nexus needs Node.js %s or newer, and found no node at all.\n' "$NEXUS_MIN_NODE"
  fi
  printf 'Install one (https://nodejs.org), or name it with a line NEXUS_NODE=/path/to/node in\n'
  printf '  %s\n' "$(nexus_config_file)"
}

# Where a run keeps what it says about itself (nexus.pid, stats.json, input.json, shots, and
# the pane it runs in). Under herdr that is the plugin's state directory, never the plugin's
# own files: an installed plugin is a checkout herdr manages and replaces on update.
nexus_run_dir() {
  if [ -n "${NEXUS_RUN:-}" ]; then
    printf '%s\n' "$NEXUS_RUN"
  elif [ -n "${HERDR_PLUGIN_STATE_DIR:-}" ]; then
    printf '%s\n' "$HERDR_PLUGIN_STATE_DIR/run"
  else
    printf '%s\n' "${XDG_STATE_HOME:-$HOME/.local/state}/herdr/plugins/$NEXUS_PLUGIN_ID/run"
  fi
}

# Prints the pid of the Agent Nexus that runs from run directory $1 and succeeds, or fails.
# v5 writes nexus.pid when it starts and removes it when it quits. One that was killed leaves
# the file behind, and the number may since belong to something else, so the process is
# looked at too.
nexus_running_pid() {
  [ -f "$1/nexus.pid" ] || return 1
  nexus_pid=$(cat "$1/nexus.pid" 2>/dev/null)
  case "$nexus_pid" in
  "" | *[!0-9]*) return 1 ;;
  esac
  kill -0 "$nexus_pid" 2>/dev/null || return 1
  case "$(ps -p "$nexus_pid" -o command= 2>/dev/null)" in
  *nexus.mjs*) ;;
  *) return 1 ;;
  esac
  printf '%s\n' "$nexus_pid"
}
