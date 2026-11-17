#!/bin/sh
# Starts v5 from this checkout in its own herdr pane, or restarts it there in place.
#   v5/tools/restart.sh [--tab] [pane id] [-- arguments for v5/nexus.mjs]
#
# The dev pane is found, never assumed:
#   1. the pane id given on the command line, else
#   2. the pane in v5/dev-pane (this script writes it), when herdr still has it, else
#   3. a pane that carries the label "Agent Nexus dev" and stands in this checkout, else
#   4. a new one: a split to the right of the pane this is called from (that pane gives up
#      half its width), or with --tab a tab of its own in the same workspace.
# Whichever it is gets the label and goes into v5/dev-pane. herdr keeps a pane's id and its
# label across a server restart, so after one the same pane is found again, with a new shell
# in it, and v5 is started there.
#
# Nothing is typed into a pane that is not the dev pane: it has to stand in this checkout,
# hold no agent, and have nothing in the foreground but its shell (or this checkout's v5,
# which is then stopped first, by signal).
set -u

MARK="Agent Nexus dev"
HERE="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd -P)" # v5/
REPO="$(CDPATH='' cd -- "$HERE/.." && pwd -P)"
RECORD="$HERE/dev-pane"
H=${HERDR_BIN_PATH:-herdr}

say() { printf 'restart: %s\n' "$*"; }
die() {
  say "$*" >&2
  exit 1
}

placement="split"
pane=
TAB=$(printf '\t')
while [ $# -gt 0 ]; do
  case "$1" in
  --tab) placement=tab ;;
  --) shift; break ;;
  -*) die "usage: restart.sh [--tab] [pane id] [-- arguments for v5/nexus.mjs]" ;;
  *) pane=$1 ;;
  esac
  shift
done
[ "${HERDR_ENV:-}" = 1 ] || die "this runs inside herdr (HERDR_ENV is not set)"

# What herdr says about pane $1, as one line "state<TAB>cwd": state is "missing", "agent"
# (an agent runs in it), "busy" (something else than its shell is in the foreground), "v5"
# (this checkout's v5 is) or "shell".
look() {
  # shellcheck disable=SC2016 # JavaScript, not shell
  "$H" pane get "$1" 2>/dev/null | node -e '
    let text = ""
    process.stdin.on("data", (chunk) => (text += chunk)).on("end", () => {
      let pane = null
      try { pane = JSON.parse(text).result?.pane ?? null } catch {}
      if (!pane) return console.log("missing\t")
      if (pane.agent) return console.log(`agent\t${pane.cwd ?? ""}`)
      const { execFileSync } = require("node:child_process")
      let info = null
      try { info = JSON.parse(execFileSync(process.argv[1], ["pane", "process-info", "--pane", pane.pane_id], { encoding: "utf8" })).result?.process_info ?? null } catch {}
      const front = info?.foreground_processes ?? []
      const v5 = front.some((entry) => String(entry.cmdline ?? "").includes(`${process.argv[2]}/nexus.mjs`))
      const onlyShell = front.every((entry) => entry.pid === info?.shell_pid)
      console.log(`${v5 ? "v5" : onlyShell ? "shell" : "busy"}\t${pane.cwd ?? ""}`)
    })
  ' "$H" "$HERE"
}

# The first pane that carries the label and stands in this checkout, or nothing.
marked() {
  # shellcheck disable=SC2016 # JavaScript, not shell
  "$H" pane list 2>/dev/null | node -e '
    let text = ""
    process.stdin.on("data", (chunk) => (text += chunk)).on("end", () => {
      let panes = []
      try { panes = JSON.parse(text).result?.panes ?? [] } catch {}
      const found = panes.find((entry) => entry.label === process.argv[1] && entry.cwd === process.argv[2] && !entry.agent)
      if (found) console.log(found.pane_id)
    })
  ' "$MARK" "$REPO"
}

# The id of the pane herdr just made, from its answer to "pane split" or "tab create".
made() { printf '%s' "$1" | sed -n 's/.*"pane_id":"\([^"]*\)".*/\1/p'; }

how=given
if [ -z "$pane" ] && [ -s "$RECORD" ]; then
  pane=$(cat "$RECORD")
  how="on record in v5/dev-pane"
  case "$(look "$pane")" in missing*) pane= ;; esac
fi
if [ -z "$pane" ]; then
  pane=$(marked)
  how="found by its label"
fi
if [ -z "$pane" ]; then
  if [ "$placement" = tab ]; then
    answer=$("$H" tab create ${HERDR_WORKSPACE_ID:+--workspace "$HERDR_WORKSPACE_ID"} --cwd "$REPO" --label "$MARK" --no-focus 2>&1) || die "herdr made no tab: $answer"
    how="a new tab"
  else
    [ -n "${HERDR_PANE_ID:-}" ] || die "no pane to split (HERDR_PANE_ID is not set): give a pane id, or --tab"
    answer=$("$H" pane split "$HERDR_PANE_ID" --direction right --cwd "$REPO" --no-focus 2>&1) || die "herdr made no split: $answer"
    how="a new split to the right of $HERDR_PANE_ID"
  fi
  pane=$(made "$answer")
  [ -n "$pane" ] || die "herdr made a pane and did not say which: $answer"
fi

state=$(look "$pane")
where=${state#*"$TAB"}
state=${state%%"$TAB"*}
case "$state" in
missing) die "herdr has no pane $pane" ;;
agent) die "pane $pane holds an agent: not the dev pane, nothing typed into it" ;;
esac
[ "$where" = "$REPO" ] || die "pane $pane stands in ${where:-an unknown folder}, not in $REPO: not the dev pane, nothing typed into it"

# v5 quits on TERM as it does on q: it gives the terminal back and removes nexus.pid.
if [ -f "$HERE/nexus.pid" ] && old=$(cat "$HERE/nexus.pid") && kill -0 "$old" 2>/dev/null; then
  case "$(ps -p "$old" -o command= 2>/dev/null)" in
  *"$HERE/nexus.mjs"*)
    kill -TERM "$old" 2>/dev/null
    tries=0
    while kill -0 "$old" 2>/dev/null && [ "$tries" -lt 50 ]; do
      sleep 0.1
      tries=$((tries + 1))
    done
    kill -0 "$old" 2>/dev/null && die "v5 (pid $old) did not quit in five seconds"
    ;;
  esac
fi
rm -f "$HERE/nexus.pid"

# A shell that has only just started, or has only just got its terminal back, needs a moment.
tries=0
until [ "$(look "$pane" | cut -f1)" = shell ] || [ "$tries" -ge 25 ]; do
  sleep 0.2
  tries=$((tries + 1))
done
state=$(look "$pane" | cut -f1)
[ "$state" = shell ] || die "pane $pane has something else than its shell in the foreground ($state): nothing typed into it"

"$H" pane rename "$pane" "$MARK" >/dev/null 2>&1 || true
printf '%s\n' "$pane" >"$RECORD"

command="node --no-warnings v5/nexus.mjs"
for argument in "$@"; do command="$command $argument"; done
"$H" pane run "$pane" "$command" >/dev/null 2>&1 || die "herdr did not take the command for pane $pane"
tries=0
until [ -f "$HERE/nexus.pid" ] || [ "$tries" -ge 40 ]; do
  sleep 0.4
  tries=$((tries + 1))
done
[ -f "$HERE/nexus.pid" ] || die "v5 did not start in $pane ($how): the pane says why"
say "v5 runs in $pane as pid $(cat "$HERE/nexus.pid") ($how)"
