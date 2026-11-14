# Agent Nexus v5

v4's interactive circuit with a living core. Everything v4 did is still here (`../v4/README.md`
explains the phase strip, the circuit, comms, equipment, the sector map and the keymap). v5 adds:

- **The flock.** The round instrument at the top left is a third larger and its bloom of dots is
  now a swarm in three dimensions: one dot per so many tokens of the turn's output, flying as a
  flock while the model generates and locking into a lattice while it waits.
- **The time terrain.** One ridge per thread, the focused one in front and the others receding:
  tokens a second over the last 1, 5 or 30 minutes, with tool calls, failures, flags and
  dispatches marked on the ridge they belong to.
- **Moons.** The focused thread's subagents circle its instrument.
- **Everything is a target**, down to one dot, and the keyboard reaches every mark (`[` `]`).
- **Explain mode** (`e`): the screen labels its own marks in place.

```sh
node --no-warnings v5/nexus.mjs              # live, in the current terminal
node --no-warnings v5/nexus.mjs --demo       # simulated data, labelled as such on screen
node --no-warnings v5/nexus.mjs --frames 4 --every 300 --size 1890x2460 [--demo] [--poke "key:e;key:];move:330,560"]
node v5/tools/poke.mjs <pane id> "move:330,560;wait:500;click:330,560;key:e;key:]"   # synthetic input into the live pane
node v5/tools/look.mjs out.png x y w h scale in.png [more.png]                       # crop and scale frames to look at
```

`kill -USR1 $(cat v5/nexus.pid)` writes `v5/shots/latest.png`. It writes `v5/stats.json` every two
seconds and `v5/input.json` (the last input events and what each hit).

## The table of marks

Every mark is data or a control. Hover says what it is; the screen matches this table.

| Mark | Data it encodes | What its motion means | Hover shows | Click does |
| --- | --- | --- | --- | --- |
| Flock dot | So many tokens of this turn's output (the unit is printed: "N dots × U tok"). Colour: white reply, the model's colour reasoning, an equipment colour tool input, red when its tool call failed | See "what the flock does" below | Which tokens of the turn, which part, which model call, when, its depth layer, what it is doing | Pins its card; a ring then follows the dot |
| Flock, as a body | The turn's whole output. At most 300 dots; past that one dot stands for more tokens and the label says so | Flying: the model is generating. Speed round the clock: 20 px/s plus 1.5 px/s per token a second. Slowing: nothing heard for 6 to 90 s. Locked: silent 150 s, a tool is running, or the turn is over | Size, mix of reasoning, reply and tool input, formation and why, speed, packing, lean, squads out | Pins its card |
| Depth of a dot | Where it is on the leaning disc (the lower half is nearer) plus its age: newer output rides above the disc, older sinks under it | Size, brightness and stacking follow depth, six layers | Its layer | n/a |
| Lean of the disc | 20 degrees on pace, up to 38 degrees when the turn has run to twice its usual length | Leans back as the turn overruns | The angle and how far past its usual length the turn is | Pins the flock card |
| Inner ring of points (wall) | Context fill: it stands 72% of the way to the rim when the window is full | Moves outward as the context fills, packing the flock | The flock card (packing) | Pins it |
| Outer ring of points (rim) | The edge of the flock's lane | Still | The flock card | Pins it |
| Squad at a spoke tip | The dots that were a running tool call's input (at least one) | Circles the tip of the call's spoke while the tool runs, flies back when the result returns; a failed call scatters the whole flock for 1.4 s | The dot's card: "out with <tool>" | Pins it |
| Lattice turning in notches | A tool is running | One notch (6 degrees) a second, like an escapement, for as long as it waits | The flock card: "locked, stepping" | n/a |
| Lattice breathing | A resting thread | Slower the longer it has rested, still after 45 minutes | The flock card | n/a |
| Flock gathering from all around | The focus moved to this thread | The new thread's flock forms up; the view swings in | n/a | n/a |
| View shift under the pointer | Control, not data | Near dots shift more than far ones (parallax); the flock runs at a fifth of its speed so a dot can be picked | n/a | n/a |
| Turn clock arc, usual band | Elapsed time of the turn against what such turns usually take (p25 to p75, the tick is the median) | The head runs with real time | The thread's card | Pins it |
| Bar inside the ring | One model call; longer when it wrote more | Appears when the call lands | The call: start, first words, length, tokens, tools | Pins it |
| Spoke outside the ring | One tool call; longer when it took longer (log scale); colour is the equipment, red is failed | Grows while the tool runs | The call: tool, target, start, time, result | Pins it |
| Context ring | Context used of the window; amber past 80%, red past 92% | Grows with the context | The thread's card | Pins it |
| Comet round the core | The model is generating | Faster when tokens stream faster | n/a | n/a |
| Moon on the outer circle | A subagent of the focused thread | Circles as fast as it writes; sits still when it rests; amber when it waits on you | The subagent's card | Focuses it |
| Ridge | One thread's tokens a second over the window (a call's tokens spread evenly over the time it took; estimated from text length, 3.6 characters a token, where a call reports none) | The terrain steps left with the clock, one slice at a time | Value, time, thread, slice length | Focuses that thread; on the focused ridge, pins the point |
| Ridge head (dot at "now") | A working thread's newest tokens a second | Rises and falls with the rate | n/a | n/a |
| Motes above a ridge head | One per 5 s a model call has run without a first word | The stack grows while the model has not spoken yet | The terrain card | n/a |
| Diamond on a ridge | A tool call, coloured by equipment; red and taller when it failed | Moves left with time | The call | Pins it |
| Flag on a ridge | An alert raised for that thread | Moves left with time | The alert | Focuses the thread |
| Ring on a ridge | The subagent was dispatched then | Moves left with time | n/a | n/a |
| Window buttons 1, 5, 30 MIN | Control: the terrain's window | n/a | What it does | Sets the window (`w` cycles) |
| Everything from v4 | See `../v4/README.md`: rails, cells, axon ticks, pulses, equipment, phase strip, comms, sector map, log, key hints | Unchanged | Unchanged | Unchanged |

### What the flock does, and when

| The thread | The flock |
| --- | --- |
| A model call is generating | Flies as a flock (separation, alignment, cohesion) clockwise round the clock. The head of the body is the newest output, the tail the oldest |
| Tokens arrive | New dots stream in from where the thread's wire meets the instrument, spread over up to 2.4 s |
| Nothing heard for a while | Slows from 6 s of silence; locked into the lattice after 150 s |
| A tool call starts | The flock locks into the lattice and turns one notch a second; the call's dots wait at its spoke |
| The result returns | The squad flies back and the flock releases |
| A tool call fails | The flock scatters; the call's dots are red for 2.6 s; three or more failures in a row add jitter |
| The turn ends | Forms up in the lattice and rests, dimmed, breathing |
| The context fills | The inner wall moves out and the flock packs against the rim |
| The turn runs past its usual length | The disc leans further back |

## Controls added in v5

| Key | Does |
| --- | --- |
| `e` | explain mode: a tag beside one example of every kind of mark |
| `[` `]` | walk every inspectable mark of a region, one by one (dots of the flock, calls on the clock, marks on the terrain, threads, equipment, accounts, header, footer) |
| `{` `}` | previous or next region |
| `enter` while walking | does what a click on that mark does |
| `w` | terrain window: 1, 5 or 30 minutes |

Mouse: a dot of the flock is a hover and click target, hit in screen space, nearest to the eye
first. A ridge point, a diamond, a flag and a window button are targets. A moon is a target.

## Files

As v4, plus `src/flock.mjs` (the swarm: simulation, projection, hit test), `src/terrain.mjs`
(the ridges, their heads and marks), `src/explain.mjs` (explain mode and the keyboard walk) and
`tools/look.mjs`. `src/terminal.mjs` and `src/encoder.mjs` now send a z per placement, so a
nearer dot is drawn over a farther one.

## State of the build

Done: the 3D flock core, moons, the time terrain, cards for every new mark, explain mode, the
keyboard walk, depth-ordered sprites.

Not done yet, in the order the brief gives: wires as particle streams whose density is the token
rate, accounts as draining reservoirs with a time axis, live latency lines in the equipment
boxes, a livelier sector map, scrubbing the terrain by dragging, the demo's missing project
directories.
