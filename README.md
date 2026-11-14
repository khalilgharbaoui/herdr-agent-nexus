# Agent Nexus

A flight recorder for every opencode session, subagent and herdr agent on this Mac, drawn
in the terminal. It renders with Skia (`@napi-rs/canvas`) at the terminal's native pixel
size on a transparent ground, and shows the frames through the Kitty graphics protocol.

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

## What it shows

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

## How the frames get to the screen

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

## Files

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

## Requirements

Node 24 or newer (`node:sqlite`), a terminal that speaks the Kitty graphics protocol with
RGBA and zlib (Ghostty, kitty, herdr inside either), and the fonts FiraCode Nerd Font Mono,
DIN Condensed and Avenir Next Condensed.
