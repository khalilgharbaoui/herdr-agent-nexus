You are a subagent spawned by another session.
You are taking a working prototype, Agent Nexus, to v2. It is a live, animated view of every opencode session, subagent and herdr agent on Khalil's Mac. It draws with Skia (`@napi-rs/canvas`) in Node and shows the frames in the terminal through the Kitty graphics protocol. You have full creative lead on the visual design. Below is what the operator asked for, what v1 is, what was measured, and the hard requirements.

## The operator's words (verbatim)

After seeing v1 live:

> "i feel its LCD quality and i need to go even above and beyond and be technical and as well as impressive and and not flicker and keep a lot of dark from the terminal next version should be a massive upgrade of this prototype i mean way more than a radar with a solar system but great and enjoyable for a developer and si-fi fan but solid and good not cheese"
> "sharp cool awesome above and beyond impressive"

Earlier, the original ask: "a live way of visualizing [my many opencode sessions and subagents] in a very futuristic way.. activity and data flowing and more just next level beyond star trek or matrix or jarvis.. breath takingly awesome", "i already have something in herdr that does this or similar but its very flat and booring", "all inside the terminal ... animated as well".

## Where to work

- Project: `~/code/Private/agent-nexus` (absolute: `/Users/khalil/code/Private/agent-nexus`). It is a local git repo with no remote. v1 is commit `d103b73` ("Agent Nexus prototype v1"). Files: `nexus.mjs` (data, scene, renderer, terminal loop), `encoder.mjs` (worker: compress and write frames), `README.md`, `package.json` with `@napi-rs/canvas` installed in `node_modules`.
- Work only in that folder. Do not touch the opencode-claude-code-plugin repo that this session's cwd points at. Commit checkpoints locally as you go (short, plain commit messages, no co-author trailer, never push; there is no remote). Restructure into several files freely.
- The folder is outside this session's project directory, so opencode may ask the operator for external-directory permission on your first write there. The operator is present and will approve.
- Writing rule from the operator, applies to code comments, README and your report: never use the em dash character. Use commas, colons, parentheses or two sentences.

## What v1 does (read `nexus.mjs` first; keep what is solid, especially the data layer)

- Layout: a reactor "core" in the middle, sessions as glowing spheres on a tilted orbit, subagents orbiting their parent, comet particles along tethers, tool calls as hexagon satellites, a radar sweep, starfield, nebula haze, scanlines and a vignette; below it telemetry tiles with sparklines, a 2-minute stream-activity scope, an event log that types itself in, account usage gauges and herdr "stations". Modes: live, `--demo` (simulated), headless `--frames N --size WxH` (writes PNGs to `shots/`). Keys: `q` quit, `d` live/demo, `s` snapshot; `SIGUSR1` writes `shots/latest.png`; it writes `stats.json` every 2 s (fps, size, KB per frame, draw/encode/write ms) and `nexus.pid`.
- Why it reads as "LCD quality", by my diagnosis (verify): it renders at about 0.58 of the pane's native pixel size (1026x1463 for about 1725x2460) and the terminal upscales it, so text and lines are soft; and the scanline + vignette overlay literally looks like a CRT/LCD panel. The full opaque frame (haze, nebulae, grid) also paints over the terminal's own black, which is the opposite of "keep a lot of dark from the terminal". The orbit/radar/solar-system metaphor is what the operator wants to go "way more than".
- Possible flicker source: each frame is sent under one of two alternating image ids, placed, then the other id is deleted, with no synchronized-output bracketing.

## Measured facts and constraints (from building v1; trust these, re-measure if you change the transport)

Terminal and transport:
- The live pane is herdr pane `wE:pQ1` (the right half of the operator's screen; the operator's own opencode is the left pane `wE:pP0`, never send anything to it). It is currently running v1. About 105 to 118 columns by 82 rows; cells are 15x30 px, so the native area is roughly 1575-1770 x 2460 px (portrait). herdr 0.9.5 runs inside Ghostty. herdr answers the Kitty graphics query with OK for `f=24` and `f=32` with `o=z` (zlib), and for `f=100` (PNG). herdr has no sixel. Its binary mentions synchronized output support (DEC mode 2026), which is the obvious anti-flicker tool: wrap each frame's escape output in `CSI ?2026h` ... `CSI ?2026l`. Check how herdr and Ghostty handle Kitty placements with z-index and alpha before relying on them.
- Kitty escapes must be chunked at 4096 base64 bytes (`m=1` continuation). Use `q=2` so the terminal sends no replies. Hide the cursor, use the alternate screen, restore both on exit (v1 does this in `KittyTerminal.restore`).
- v1 numbers: opaque 1026x1463 frames of about 1.1 MB base64 (RGB, lowest bit of each channel dropped, zlib level 1), draw 10-15 ms, encode 16-20 ms and write 12-17 ms in the worker, 15 to 29 fps depending on machine load. Writing straight to fd 1 from the worker (`fs.writeSync`, retry on EAGAIN) works.
- Skia dithers every gradient (alternating 54/55 values), and that noise roughly doubled frame size: one full-screen radial gradient alone deflated to 733 KB. v1 replaced big gradients with pixel-computed canvases (`radialPixels`, `verticalStrip`, computed background and overlay). Keep avoiding Skia gradients over large areas, or measure what they cost.
- A transparent background (`f=32` RGBA with real alpha, background pixels fully transparent) should compress to almost nothing in the empty areas, which is what could make full native resolution affordable and let the terminal's own dark show through. Measure it. Other options worth weighing: splitting the screen into several images (regions) and resending only the ones that changed, static layers sent rarely, a frame budget that adapts.
- The Node frame loop must yield to the event loop every frame (`setImmediate` when there is no time left), or keys, signals and file writes stall. That was a real v1 bug.
- `canvas.data()` returns plain RGBA bytes; copy it before handing the buffer to a worker.

Data (all read-only, all already wired in v1's `LiveSource`):
- opencode 2's database `~/.local/share/opencode/opencode.db`, about 7.5 GB, opened with `node:sqlite` `DatabaseSync(path, { readOnly: true })`. Query by indexed columns only. SQLite string literals take single quotes here (double quotes are identifiers). Never query the `account`, `control_account` or `credential` tables (they hold tokens), and never print `opencode.json`, `auth.json` or other secret-bearing files.
  - `session_v2`: `id, parent_id, title, agent, model` (JSON `{id, providerID, variant}`), `cost, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, time_created, time_updated, time_busy, time_idle, idle_outcome` (succeeded, failed, interrupted), `time_compacting, time_archived, directory`. A session is busy when `time_busy > coalesce(time_idle, 0)`.
  - `session_message` (`session_id, type, seq, time_created, time_updated, data`): types include `user`, `assistant`, `idle`, `system`, `synthetic`. One assistant message per step. A step's `data.content` (reasoning, text, tool items) is written when the step ends, so text arrives in step-sized bursts; a tool item (`{type:'tool', id, name, state:{status, input, ...}, time:{created, ran}}`) shows `status: 'running'` live while it runs, then `completed` or `error`. v1's `activityQuery` extracts the newest two steps' text length and tool list with SQL JSON functions in well under a millisecond.
  - `job` table: background subagent jobs (`session_id, child_session_id, kind, title, status, time_created, time_updated`).
- The plugin's state dir `~/.local/state/opencode-claude-code-plugin/` (all small JSON):
  - `account-usage.json`: per account `five_hour` / `seven_day` `{utilization (fraction), resetsAt, status}`, plus `known` (account names and plan tier) and `logins`.
  - `turn-progress.json`: `turns[sessionTag] = {turn, out, at}`: output tokens so far in the running turn, updated once per API call. `sessionTag` is FNV-1a over the session id, eight hex digits (v1 has it).
  - `session-spawns.json`: per session the model, effort, account and agent it really spawned with.
  - `turn-history.json`: per `agent/model` key, samples of finished turns `{ms, chars, effort, calls, out, failed, session, at}`: real turn durations, tool-call counts and output tokens, usable for "how long does this usually take" visuals.
- `herdr agent list` (JSON, run every few seconds): each pane's agent kind, status (`working`, `idle`, `blocked` = awaiting the operator, `done`, `unknown`), pane id, terminal title, and for opencode panes the session id it holds.
- Model palette v1 used: opus violet, fable gold, sonnet blue, haiku teal, mythos magenta, local models orange. Two accounts: `default` and `appical`.

Fonts available to Skia: FiraCode Nerd Font Mono (Regular, Bold, and more weights in `~/Library/Fonts`, v1 registers two as "Nexus Mono"; it has the Nerd icon glyphs), DIN Condensed, DIN Alternate, Avenir Next Condensed, Avenir Next, SF Mono (`.SF NS Mono`), Menlo, Futura, Helvetica Neue.

## Hard requirements

1. Sharp: native resolution (or as close as the pipeline can hold), crisp type and hairlines. No upscaled-soft look, no scanlines, no CRT or LCD effects.
2. No flicker. Use synchronized output and whatever else the measurements call for, and explain in your report what you did about it.
3. Keep a lot of the terminal's own dark. The image must not paint a full opaque backdrop; empty space is the terminal's black.
4. Smooth: a steady frame rate of at least 24 fps in that pane is the target, with the loop measuring itself (keep `stats.json`). Motion should encode data, not decoration.
5. A massive upgrade, not a reskin: "way more than a radar with a solar system". It should be great and enjoyable for a developer and a sci-fi fan, solid, not cheesy. Ground every element in real data the sources above provide.
6. Keep the live/demo/headless modes, the keys, `SIGUSR1` snapshots and `stats.json`, and keep it read-only: it writes nothing outside its own folder.
7. Robust on the real data, including many sessions (the operator often has 9+ threads and 30 herdr panes), long titles, zero activity, and a pane resize. Portrait (the current pane) is primary; landscape (full screen, about 3540x2460) must still look deliberate.

## Direction (yours to decide; these are seeds, not a spec)

The operator lives in many parallel threads and subagents. Information a developer would actually love to watch, done with the restraint and precision of film UI and mission control (fine vector line work, strict typographic hierarchy, purposeful motion), could include: per-thread live timelines of turns, steps and tool calls (swimlanes) with real durations; context-window fill against the model's limit and cache read ratio per thread; token and cost burn; how long the current turn has run against what `turn-history.json` says such turns usually take; tool latency and error flashes; the subagent tree as a living structure; which herdr pane holds what and who is blocked waiting for the operator; account windows. Delight should come from precision and data density, not glow everywhere.

## How to work and verify

- You cannot see the operator's screen. Inspect your own output: render headless PNGs (`node --no-warnings nexus.mjs --frames 3 --size 1590x2460` and a landscape size, with and without `--demo`) and look at them with your Read tool. Iterate on what you see. Check composition at the real size, not a thumbnail.
- Live test in pane `wE:pQ1` only: `herdr pane send-text wE:pQ1 q` quits the running copy (wait until `nexus.pid` disappears), `herdr pane run wE:pQ1 "cd ~/code/Private/agent-nexus && clear && node --no-warnings nexus.mjs"` starts it, then read `stats.json` and send `kill -USR1 $(cat nexus.pid)` for a `shots/latest.png` of the live frame. Never close the pane and never send anything to other panes.
- Dependencies: adding npm packages inside the project is fine if they earn their place. If an install fails with a 403, a reset connection or an unexpectedly old version, Aikido Device Protection is the likely cause: check `aikidoctl events --json` before anything else.
- Cost: you run on Fable 5.2 at xhigh effort on the `default` account, whose 5-hour usage window had roughly 40% left at about 01:40 local time (it resets near 02:50). Work efficiently and commit working checkpoints often, so progress survives if the window runs out.
- At the end leave v2 running live in pane `wE:pQ1`.

## Report back

Keep it short: what v2 shows and why, how you solved sharpness, flicker, darkness and frame rate (with the measured `stats.json` numbers), the paths of your final live and demo PNGs, the commits, and anything you could not verify or left open.