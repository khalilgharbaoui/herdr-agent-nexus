# Agent Nexus v4

v3's living circuit, made into something you can point at. Every opencode session, subagent and
herdr agent on this Mac is a neuron in a circuit; v4 groups them by project, watches them for
you, and answers to the mouse and the keyboard. `RESEARCH.md` says what herdr forwards to a pane
program and how that was measured. `../v3/README.md` explains the transport, which is unchanged.

```sh
node --no-warnings v4/nexus.mjs              # live, in the current terminal
node --no-warnings v4/nexus.mjs --demo       # simulated data, labelled as such on screen
node --no-warnings v4/nexus.mjs --frames 1 --size 1890x2460 [--demo] [--poke "move:420,1055;wait:500;key:?"]
node v4/tools/poke.mjs wE:pQ1 "move:480,1376;wait:500;click:480,1376;key:i"   # synthetic input into the live pane
```

Press `?` for the controls. `kill -USR1 $(cat v4/nexus.pid)` writes `v4/shots/latest.png`. While
it runs it writes `v4/stats.json` every two seconds and `v4/input.json` (the last input events,
what each hit and what it did). It reads opencode's database, the plugin's state files and
`herdr agent list`, writes nothing outside this folder, and the only thing it ever asks of herdr
is to bring a pane to the front when you click or press for exactly that.

## How to read it

- **Phase strip** (top): NORMAL, CAUTION or ALERT, with the one line that says why. It rises at
  once and cools down through CAUTION before it returns to NORMAL.
- **Focus stage**: one thread, large. The clock is the turn against what such turns usually
  take (from the plugin's turn history), a bar is a model call, a spoke is a tool call, the
  bloom is the turn's output, one dot per so many tokens (the unit is printed). Beside it: who
  it is (account, project, parent, agent, herdr workspace, tab and pane), its numbers with
  units, and the live tail of what it thinks, says and runs. Missing numbers show as a dash.
- **Circuit**: account rails on the left (the level is what is left of the five-hour window,
  the triangle is where an even pace would stand, under it when it runs dry at this pace or when
  it is back), then the threads grouped by project, each with its subagents hanging under it.
  A pulse runs from the rail into a thread when a model call starts, out to the equipment when
  a tool call starts, and back when the result returns (red when it failed).
- **Equipment** (right): what the models act with: you, shell, read, write, web, agents, other.
  Calls in the last eight minutes, in flight now, the usual latency, failures.
- **Comms** (bottom left): calls and flags, oldest first. A thread that waits on you rings here.
- **Sector map**: every herdr pane as a blip, by workspace and tab: working, calling, unread.
- **Log**, or the **input monitor** when it is on (`i`).

What it flags by itself: a thread waiting on you, a thread marked busy that went silent, three
or more failed tool calls in a row, a context window past 80%, a turn far past its usual length,
a finished thread nobody read, a failed turn, an account that is out, nearly out, or will run
dry before its window resets.

## Controls

| Key | Does |
| --- | --- |
| `j` `k` or arrows up, down | move the focus |
| arrows left, right, `h` `l` | fold or open a subtree, step out or in |
| `1` to `9`, `g`, `G` | focus by number, first, last |
| `enter` | go to the focused thread's pane in herdr |
| `tab`, shift+`tab` | next or previous thing that needs you |
| `c` | answer the oldest call: go to its pane |
| `x` | mute or unmute the focused thread's flags |
| `space` | pin or unpin the focused thread's card |
| `a` | follow the action again |
| `f` | list: active, all open, needs you |
| `z` | zoom the focus stage |
| page up, page down | scroll the live tail |
| `i` | input monitor |
| `d` `p` `s` | demo or live, sprites or painted tiles, snapshot |
| `?`, `esc`, `q` | controls, close, quit |

Mouse: hovering brackets what is under the pointer and opens its inspection card after a short
rest. A click focuses a thread, folds a project or a subtree, pins the card of equipment, a
rail or a mark, focuses the thread behind a blip, a call or a flag. A click on a pane id, a
middle click or alt + click on a thread goes to its pane. The wheel scrolls the threads, or the
live tail when over it. Every key hint at the bottom is a button. Right click, ctrl + click and
shift are not used, because herdr and Ghostty keep them.

## Files

As v3, plus `src/input.mjs` (keys and SGR mouse reports), `src/ui.mjs` (what an event means),
`src/circuit.mjs`, `src/stage.mjs`, `src/hud.mjs` (the three parts of the picture, with their
hit regions), `src/theme.mjs`, and `tools/poke.mjs`.
