# Agent Nexus

A live, animated view of every opencode session, subagent and herdr agent on this Mac,
drawn with Skia and shown in the terminal through the Kitty graphics protocol.

```sh
node --no-warnings nexus.mjs            # live
node --no-warnings nexus.mjs --demo     # simulated activity
node --no-warnings nexus.mjs --frames 3 --size 1026x1463 [--demo]   # PNGs into ./shots, no terminal
```

Keys: `q` quit, `d` switch live and demo, `s` snapshot to `shots/`. `kill -USR1 <pid in nexus.pid>`
also writes `shots/latest.png`. Options: `--fps 30`, `--pixels 1500000` (render budget),
`--scale 0.5`, `--roots 9`, `--hours 6`.

Needs a terminal that answers the Kitty graphics protocol (Ghostty, Kitty, WezTerm, and herdr
inside one of them). Not tmux.

## What it reads

All read-only:

- `~/.local/share/opencode/opencode.db` (opencode 2): `session_v2` for threads, subagents,
  busy state, agent, model, cost; the newest two assistant messages per active session for
  tool calls (name, status, a short input label) and step text length.
- The plugin's state dir: `account-usage.json` (5-hour and 7-day windows per account) and
  `turn-progress.json` (output tokens per API call, which is what the tok/s tile shows).
- `herdr agent list`: which pane holds which session, `blocked` (awaiting you), and the other
  agents shown as stations.

opencode 2 writes a step's text when the step ends, so text arrives in step-sized bursts, while
tool calls show up as they start and finish.

## How it draws

`nexus.mjs` draws each frame on the main thread; `encoder.mjs` runs in a worker that drops the
lowest bit of each colour channel, deflates the RGB, and writes the Kitty escapes straight to the
terminal, so drawing and writing overlap. Large gradients are computed pixel by pixel instead of
with Skia's gradients, because Skia dithers them and dither noise roughly doubles a frame's size.
