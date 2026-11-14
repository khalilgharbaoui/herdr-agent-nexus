# Agent Nexus v3

Every opencode session, subagent and herdr agent on this Mac, drawn as a living circuit in the
terminal. v2 (the repo root) is a flight recorder: it shows that work happened. v3 shows the
work happening. `RESEARCH.md` says where the idea came from and what was measured first.

```sh
node --no-warnings v3/nexus.mjs              # live, in the current terminal
node --no-warnings v3/nexus.mjs --demo       # simulated data, labelled as such on screen
node --no-warnings v3/nexus.mjs --frames 3 --size 1890x2460 [--demo]   # headless PNGs in v3/shots/
```

Keys: `j` `k` (or the arrows) move the focus, `1` to `9` pick a thread, `a` follows the action
again, `d` switches between live and demo, `p` switches the moving layer between sprites and
painted tiles, `s` saves a snapshot, `q` quits. `kill -USR1 $(cat v3/nexus.pid)` writes
`v3/shots/latest.png`. While it runs it writes `v3/stats.json` every two seconds. It reads
opencode's database, the Claude Code plugin's state files and `herdr agent list`, and writes
nothing outside this folder.

## How to read it

Every thread is a neuron.

- **The cell body** is the model. Its ring is the model's colour, the dot inside grows with the
  context window. A comet circles it while the model is writing, faster when it writes faster.
- **The rail on the left** is the account the thread bills. What is left of its five-hour window
  stands in the rail like fuel, the triangle marks where an even pace would stand. A pulse runs
  down the rail into the cell body each time a model call starts.
- **The axon** carries the thread's own words: the end of what it just thought or said, or the
  command it is running. The ticks drifting along it are its model calls (taller when the call
  wrote more) and its tool calls (diamonds), each moving away at 12 pixels a second, so their
  spacing is the thread's rhythm over the last minute and a half.
- **Synapses** fan out to what a model acts on: you, the shell, reading, writing, the web, other
  agents. A tool call is a pulse out, a stream of dots for exactly as long as the call runs, and
  a pulse back into the cell body when the result returns (red when it failed). A subagent hangs
  under its parent on a link that is lit while it works.
- **The focus** (top) is one thread shown large. It follows the action unless you move it. The
  instrument is a clock of the turn: one turn of the outer ring is how long such a turn may
  take (from the plugin's turn history, the slim band is where they usually end), the arc is
  how far this one has come, a bead is a model call, a spoke is a tool call and its length is
  how long it took. The inner ring is the context window. The bloom is the turn's output, one
  dot per so many tokens. Beside it: the live tail of what the thread thinks, says and runs.

Nothing moves unless something happened or is in flight. A quiet machine is a still, dark
picture that ticks ten times a second and sends almost nothing.

## How the frames get to the screen

- **Native resolution, transparent ground.** One canvas pixel is one terminal pixel, and a pixel
  that is not ink is fully transparent, so the terminal's own dark is the background.
- **Two layers.** The still layer (type, wires, rings, gauges) is cut into tiles of 16 by 3
  cells; a tile is sent only when its pixels changed. The moving layer is sprites: one atlas
  image is uploaded once and every pulse, tick and comet is a placement of a small window of
  it, one layer above the tiles. Moving a sprite is one command of about 70 bytes.
- **Why sprites.** herdr keeps the pane's images in its own Ghostty VT and re-emits to the host
  only uploads, placements and deletes. A placement whose image did not change goes out as a
  short placement command, so a moving sprite never costs pixels. Measured in the live pane:
  the same picture costs 0.2 to 0.6 MB/s and 4 to 12% of a core with sprites, and 4 to 9.5 MB/s
  and 26 to 47% with the particles painted into tiles (`p` switches, to compare).
- **Pixel exact through herdr.** herdr gives the host a whole-cell box for every placement, so a
  sprite is positioned by sliding a cell-sized source window over a padded atlas tile and never
  uses a cell offset. Nothing is scaled.
- **No flicker.** Each frame is one write inside one synchronized-output bracket (DEC 2026). A
  changed tile goes out under the other of two image ids and the old one is deleted after.
- **Only what changed.** The screen is cut into regions (header, focus, rails, one per thread,
  ports, footer) and a region is repainted only when its signature changed. Text types itself
  in place: the lines are laid out from the whole block first, so nothing shifts while it types.
- **Not usable here:** the animation-frames protocol. The pane accepts frames, but herdr 0.9.5
  never forwards them, so the host would not animate anything (`tools/probe.mjs`, `probe.json`).

## Files

- `nexus.mjs`: options, the loop, keys, snapshots, stats.
- `src/live.mjs`: the live data (opencode database, plugin state, herdr), with the live tail.
- `src/demo.mjs`: simulated data of the same shape.
- `src/model.mjs`: which sessions become rows, signals, streams, the focus.
- `src/draw.mjs`: the still layer, the layout, and what the moving layer should show.
- `src/flow.mjs`: pulses, streams and flashes along paths.
- `src/sprites.mjs`: the atlas and the window arithmetic.
- `src/terminal.mjs`: terminal queries, input, tile and sprite diffing.
- `src/encoder.mjs`: the worker that compresses and writes each frame.
- `tools/probe.mjs`: asks the terminal what it does with placements, layers and animation.

## Requirements

Node 24 or newer (`node:sqlite`), a terminal that speaks the Kitty graphics protocol with RGBA,
zlib and placements with source rectangles (Ghostty, kitty, herdr inside either), and the fonts
FiraCode Nerd Font Mono, DIN Condensed and Avenir Next Condensed.
