#!/bin/sh
# herdr's [[build]] step. herdr runs it once, in the plugin's own folder, when the plugin is
# installed or updated from GitHub ("herdr plugin install", "herdr plugin update"), and not
# when a local folder is linked ("herdr plugin link"): there, run it by hand.
#
# It installs the one dependency, @napi-rs/canvas (Skia, a prebuilt binary for this platform),
# exactly as package-lock.json names it, and then proves that this node can draw a picture
# and open a database, so a broken install fails here and not in the pane later.
set -eu

NEXUS_ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
# shellcheck source=herdr/lib.sh
. "$NEXUS_ROOT/herdr/lib.sh"

say() { printf 'agent-nexus: %s\n' "$*"; }

if ! node=$(nexus_find_node); then
  nexus_node_missing >&2
  exit 1
fi
say "node $("$node" -p 'process.versions.node') at $node"

# npm is a script that runs "node": the one beside the node that was found, with that node
# first in PATH.
node_dir=$(dirname -- "$node")
if [ -x "$node_dir/npm" ]; then
  npm=$node_dir/npm
else
  npm=$(command -v npm 2>/dev/null) || {
    say "found no npm beside $node or in PATH. npm comes with Node.js." >&2
    exit 1
  }
fi
PATH="$node_dir:$PATH"
export PATH

cd "$NEXUS_ROOT"
say "installing @napi-rs/canvas (npm ci)"
"$npm" ci --omit=dev --no-audit --no-fund

"$node" --no-warnings -e '
const { createCanvas } = require("@napi-rs/canvas")
const canvas = createCanvas(16, 16)
canvas.getContext("2d").fillRect(0, 0, 16, 16)
if (canvas.toBuffer("image/png").length < 50) throw new Error("@napi-rs/canvas drew nothing")
const { DatabaseSync } = require("node:sqlite")
new DatabaseSync(":memory:").close()
'
say "built: Skia draws and node:sqlite opens"
