# Agent Nexus

Every opencode session, subagent and herdr agent on this machine as one living circuit you
can point at, drawn in a terminal pane. It renders with Skia (`@napi-rs/canvas`) at the
terminal's native pixel size and shows the frames through the Kitty graphics protocol. It
is a [herdr](https://herdr.dev) plugin, `herdr-agent-nexus`.

The current version is v5. [`v5/README.md`](v5/README.md) says what every mark means, how
the picture gets to the screen and what was measured.

## Install

```sh
herdr plugin install khalilgharbaoui/herdr-agent-nexus
```

herdr fetches the repository into a folder of its own, shows what the plugin will run, and
runs the build step, `herdr/build.sh`: `npm ci` for the one dependency, then a check that
this node can draw a picture and open a database. Nothing else is installed.

It needs:

- herdr 0.9.5 or newer, running inside a terminal that speaks the Kitty graphics protocol
  (Ghostty or kitty);
- Node.js 22.13 or newer with npm (22.12 has no `node:sqlite` without a flag), and git;
- for live data, opencode: Agent Nexus reads its database at
  `~/.local/share/opencode/opencode.db` and never writes to it. Without opencode there is
  the demo.

It is developed and measured on macOS. The type is FiraCode Nerd Font Mono when
`~/Library/Fonts` has it (Menlo otherwise), with DIN Condensed and Avenir Next Condensed,
which macOS ships. Linux is declared in the manifest and has not been measured yet: the
type falls back to the system's sans and mono faces there.

```sh
herdr plugin update khalilgharbaoui.agent-nexus      # the newest commit
herdr plugin uninstall khalilgharbaoui.agent-nexus
```

## Use

The plugin adds five actions to herdr:

| Action       | What it does                                                                |
| ------------ | --------------------------------------------------------------------------- |
| `open`       | Starts the live view in a new tab, or goes to it when it already runs       |
| `open-split` | Starts it in a split to the right of the focused pane                       |
| `demo`       | The same view over made-up sessions: needs no opencode and reads nothing    |
| `stop`       | Quits the live view and closes its pane                                     |
| `status`     | Whether it runs, in which pane, and what it last reported about itself      |

```sh
herdr plugin action invoke khalilgharbaoui.agent-nexus.open
herdr plugin action invoke khalilgharbaoui.agent-nexus.stop
herdr plugin action invoke khalilgharbaoui.agent-nexus.status
herdr plugin log list --plugin khalilgharbaoui.agent-nexus --limit 1    # what status said
```

A key for it, in herdr's `config.toml` (the form is from herdr's plugin documentation):

```toml
[[keys.command]]
key = "prefix+n"
type = "plugin_action"
command = "khalilgharbaoui.agent-nexus.open"
description = "agent nexus"
```

In the view, `?` lists the keys and what the mouse does, and `q` quits and closes the pane.
There is one Agent Nexus per user, since it is a view of the whole machine: opening it a
second time goes to the pane it already runs in.

It keeps what a run writes (`nexus.pid`, `stats.json`, `input.json`, `shots/`,
`stderr.log`) in herdr's state folder for the plugin,
`~/.local/state/herdr/plugins/khalilgharbaoui.agent-nexus/run`, and nothing in the
installed copy. When it cannot start, the pane says why and waits for enter.

Settings are optional: `KEY=value` lines in `nexus.env` in the plugin's config folder
(`herdr plugin config-dir khalilgharbaoui.agent-nexus` prints the folder).

| Setting           | Meaning                                                                    |
| ----------------- | -------------------------------------------------------------------------- |
| `NEXUS_NODE`      | The node to run, when herdr's PATH holds none that is new enough            |
| `NEXUS_ARGS`      | More arguments for `v5/nexus.mjs`, such as `--fps 20` or `--db /a/path.db`  |
| `NEXUS_FOCUS`     | `0` opens the pane without switching to it                                  |
| `NEXUS_WORKSPACE` | The workspace a new tab opens in, instead of the active one                 |

## Develop

Running from a checkout is unchanged, and independent of an installed copy (the two keep
their files apart, so both can run at once):

```sh
npm install
node --no-warnings v5/nexus.mjs            # live, in the current terminal
node --no-warnings v5/nexus.mjs --demo     # simulated data
v5/tools/restart.sh <pane id>              # restart it in place in a herdr pane
```

The plugin is four files: `herdr-plugin.toml` (what herdr reads), `herdr/build.sh` (the
build step), `herdr/pane.sh` (the pane: finds node, runs v5, says why when it cannot) and
`herdr/ctl.sh` (the actions), with `herdr/lib.sh` shared between them. To try a change to
them without pushing it, link the checkout in place of the installed copy:

```sh
herdr plugin uninstall khalilgharbaoui.agent-nexus   # herdr refuses a link over an install, and the reverse
herdr plugin link "$PWD"                             # runs from this checkout, with its node_modules
herdr plugin unlink khalilgharbaoui.agent-nexus
```

herdr does not build a linked folder. A release is a push: bump `version` in
`herdr-plugin.toml` and `package.json`, and an installed copy follows with
`herdr plugin update`.

## The first tape (v2, at the repository root)

The files at the root (`nexus.mjs`, `encoder.mjs`, `src/`, `tools/`) are the second version,
a flight recorder drawn as a score on one shared time axis. It is kept as it was, beside
`v1/`, `v3/` and `v4/`. What follows describes it.

```sh
node --no-warnings nexus.mjs            # live, in the current terminal
node --no-warnings nexus.mjs --demo     # simulated data
node --no-warnings nexus.mjs --frames 3 --size 1590x2460 [--demo]   # headless PNGs in shots/
```

Keys: `q` quit, `d` switch between live and demo, `s` save a snapshot to `shots/`.
`kill -USR1 $(cat nexus.pid)` writes `shots/latest.png`. While it runs it writes
`stats.json` every two seconds and `nexus.pid` once. It reads opencode's database, the
Claude Code plugin's state files and `herdr agent list`. It writes nothing outside this
folder.

### What it shows

The score is the centre. Every thread is a lane on one shared time axis that runs into a
hard NOW edge.

- Upper row of a lane: the model. A solid block is the model speaking, a dim block with a
  bright top edge is thinking, and the height is how fast it wrote (characters a second,
  log scale). The colour is the model family.
- Lower row: tool calls with their real durations. Brightness says what kind (a write is
  brightest, a read dimmest), red is a failed call, an outlined block with a hatch is still
  in flight, an outlined block without one is a subagent dispatch.
- A flag opens a turn, a bracket closes it (green finished, red failed, amber interrupted).
- A subagent's lane hangs under its parent. A line with a dot drops from the parent where
  it was dispatched and a line with an arrow climbs back where it reported.
- Right of NOW the axis becomes logarithmic (+1m, +5m, +20m, +1h). A hatched band there is
  where turns of this agent and model usually end (quartiles from the plugin's
  `turn-history.json`), with a tick at the median. Past that it says how many times the
  usual the turn has run.
- The right gutter has the turn timer, cost, context window fill and output tokens of the
  running turn, and the account rails: each thread taps the rail of the account it bills,
  and a pulse runs down the rail into the account's gauge when one of its model calls lands.
- The bottom track sums all threads: stream rate as bars, threads active at once as a band.

Below it: the herdr pane map (the number in a tile is the lane) with the list of panes
waiting on you, the account usage windows with a pace marker and the time they run dry at
the current pace, tool latency as one tick per call on a log axis, and the event log.

A session whose busy flag is set but where nothing has moved for five minutes is shown as
stalled, not as working.

### How the frames get to the screen

- Native resolution. The canvas is exactly `columns x cell width` by `rows x cell height`
  pixels, so one canvas pixel is one terminal pixel. Positions are whole pixels and the
  timeline advances in whole pixels, so hairlines and type stay crisp.
- Transparent ground. Nothing paints a backdrop. Pixels that are not ink are fully
  transparent RGBA, so the terminal's own background is the background.
- Tiles. The frame is cut into tiles of 16 by 3 cells. Each tile is its own Kitty image.
  A tile is sent only when its pixels changed, and a tile with nothing in it has no image.
- No flicker by construction. A changed tile goes out under the other of two image ids:
  the new image is placed, then the old one is deleted, and the whole frame is wrapped in
  one synchronized-output bracket (DEC mode 2026). A tile is never empty in between.
- Stillness is free. The loop runs at 30 Hz, but a frame that would be identical to the
  last one is not drawn, read back or sent. Only rows where something moved are read back
  (everything once a second and whenever the tape advances). Motion is tied to events:
  the write cursor of a working thread blinks, a ring and a flare answer each model call,
  pulses run down the account rails and along fork lines, new log lines flash.
- Two layers. Everything that changes only with data or with the tape lives in an
  offscreen canvas that is redrawn a few times a second. The moving parts are drawn over
  a copy of it each frame.

`stats.json` reports `fps` (frames the loop finished on time, changed or still), `changed`
(frames a second that differed and were sent), kB and tiles per changed frame, and the
draw, read-back, encode and write times.

### Files

- `nexus.mjs`: options, the frame loop, snapshots, stats.
- `encoder.mjs`: the worker that compresses changed tiles and writes them to the terminal.
- `src/terminal.mjs`: terminal queries, input, tile diffing against what the screen shows.
- `src/live.mjs`: the live data (opencode database, plugin state, herdr).
- `src/demo.mjs`: simulated data of the same shape.
- `src/model.mjs`: which sessions become lanes, the event log, pulses, header numbers.
- `src/draw.mjs`: the renderer.
- `src/util.mjs`: colour, type and formatting helpers.
- `tools/probe.mjs`: asks the terminal what it supports and times frame shapes.
- `tools/edge.mjs`: renders the awkward cases (empty, idle, tiny, crowded) to `shots/`.
- `tools/crop.mjs`: cuts a region out of a PNG at full size.

### Requirements

Node 24 or newer (`node:sqlite`), a terminal that speaks the Kitty graphics protocol with
RGBA and zlib (Ghostty, kitty, herdr inside either), and the fonts FiraCode Nerd Font Mono,
DIN Condensed and Avenir Next Condensed.
