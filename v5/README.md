# Agent Nexus v5

v4's interactive circuit with a living core. Everything v4 did is still here (`../v4/README.md`
explains the phase strip, the circuit, comms, equipment, the sector map and the keymap). v5 adds:

- **The core is a body in space.** A globe of flat dots (one dot per so many tokens of the turn's
  output) inside a ring system seen from above and in front: the context ring, the turn clock
  with every tool call standing on it and every model call hanging under it, a satellite for
  every running tool call and a moon for every subagent.
- **One path for a dot.** Tokens gather as a charge at the tip of the thread's wire. A full charge
  releases one dot. The dot circles the ring system in a flock while its model call is open, and
  when the call reports it siphons into the globe as a thread.
- **The time terrain.** One ridge per thread, the focused one in front and the others receding:
  tokens a second over the last 1, 5 or 30 minutes, with tool calls, failures, flags and
  dispatches marked on the ridge they belong to.
- **Everything is a target**, down to one dot, and the keyboard reaches every mark (`[` `]`). A
  card is tied to its mark by a leader line and follows it.
- **Explain mode** (`e`): the screen labels its own marks in place.
- **It asks the terminal.** Every sprite image is acknowledged by the terminal and checked every
  two seconds. See "What the terminal holds".

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
| Flock dot | So many tokens of this turn's output (the unit is printed: "N dots × U tok"). Colour: white reply, the model's colour reasoning, an equipment colour tool input. Flat on purpose: its depth is in how it moves | See the next table | The dot: thread, the tokens it stands for, part, model call, when, where it is in its life | Pins it |
| Charge at the tip | Tokens toward the next dot. Eight sockets stand round the tip of the thread's wire; one socket is an eighth of a dot. The threshold is one unit of tokens (10, 25, 50, 100, 250 and so on, chosen so the turn fits in 300 dots): at eight of eight the charge fires | Lit motes leave their sockets and circle the tip, from 24 px out at 1.6 rad/s when empty to 10 px out at 10 rad/s when full; the corona grows in three sizes and beats 1.3 to 7 times a second; near full the tip trembles. Nothing moves when no tokens arrive | Holds, sockets, fires at, reported, the open call's estimate, fired, energy | Pins it |
| Release | The charge reached one dot's worth | A white flash, a ring that runs outward and an afterglow of 0.7 s, while the dot flies to the ring system. At most some three flashes a second: a burst is a steady stream of dots | n/a | n/a |
| Flock in orbit | The dots of the model call that is still open, between the context ring and the turn clock. Tokens are counted when a call reports, once per call; until then the call's output is an estimate: its open time times the thread's last measured rate, capped at 120 tok/s | Circles the ring system as fast as that rate (70 px/s plus 2.4 px/s per tok/s), bunched behind its head, riding a wave over and under the ring plane | The dot card: "in orbit round the rings: its call is still open" | Pins it |
| Siphon thread | Dots whose call has reported, on their way into the globe | One after another (every 25 to 90 ms, a backlog clears in about 1.6 s) a dot leaves the orbit and spirals 0.85 of a turn inward and up to its place in 1.4 s; it circles at least 0.9 s first. When the call reported fewer tokens than estimated, the surplus dots drift outward and fade | The dot card: "spiralling from the orbit into the globe" | Pins it |
| Globe | The turn's reported output: the south pole its first tokens, the north pole its newest. Its radius is 66% of the context ring when the context is empty and 92% when it is full | See the next table | The flock card | Pins it |
| Depth of a dot | Where it is in space: seven sizes from 1.1 to 2.5 px radius, far is smaller and dimmer; south of the ring plane it is drawn behind the rings, north of it in front | Follows the dot | n/a | n/a |
| Streak behind a dot | It flies faster than 46 px/s; the streak points the way it goes (twelve directions) | Follows the dot | n/a | n/a |
| Pitch of the ring system | 54 degrees on pace, up to 66 degrees when the turn has run to twice its usual length | Tips slowly | The flock card | Pins it |
| Satellite on a lane | One running tool call on its equipment's lane round the globe; the dots that were its input fly in line behind it | One lap per that equipment's usual latency | The tool call | Pins it |
| Spark | A tool result landed: the equipment's colour, red when it failed | 0.5 s | n/a | n/a |
| Lattice turning in notches | A tool is running | One notch (6 degrees) a second, like an escapement, for as long as it runs | The flock card | Pins it |
| Lattice breathing | A resting thread | Slower the longer it has rested, still after 45 minutes | The flock card | Pins it |
| Flock gathering from all around | The focus moved to this thread | The new thread's flock forms up; the old one flies outward and fades | n/a | n/a |
| View shift under the pointer | Control, not data | Near dots shift more than far ones (parallax); the flock slows under the pointer so a dot can be picked | n/a | n/a |
| Turn clock arc, usual band | Elapsed time of the turn against what such turns usually take (p25 to p75, the tick is the median) | The head runs with real time | The thread's card | Pins it |
| Bar under the turn clock | One model call; longer when it wrote more | Appears when the call lands | The call: start, first words, length, tokens, tools | Pins it |
| Pillar on the turn clock | One tool call; taller when it took longer (log scale); colour is the equipment, red is failed | Grows while the tool runs | The call: tool, target, start, time, result | Pins it |
| Context ring | Context used of the window; amber past 80%, red past 92% | Grows with the context | The thread's card | Pins it |
| Moon on the outermost orbit | A subagent of the focused thread | Circles as fast as it writes; sits still when it rests; amber when it waits on you | The subagent's card | Focuses it |
| Ridge | One thread's tokens a second over the window (a call's tokens spread evenly over the time it took; estimated from text length, 3.6 characters a token, where a call reports none) | The terrain steps left with the clock, one slice at a time | Value, time, thread, slice length | Focuses that thread; on the focused ridge, pins the point |
| Ridge head (dot at "now") | A working thread's newest tokens a second | Rises and falls with the rate | n/a | n/a || Ground of the terrain | A plane in perspective: the focused thread's ridge at the front edge at full size, each ridge behind it scaled by 1 / (1 + 1.9 k / 6) for depth k, hazier with distance. The lines running back are equal times; the cyan edge is now | Steps with the clock | n/a | n/a |
| Dashed step on a ridge | An open model call: what it probably writes, at the thread's last measured rate, from the call's start to now. An estimate, and named "estimate" on the front ridge | Grows to the right until the call reports | The ridge point | Pins it |
| CONTEXT chart | The focused thread's context at every model call, against its limit; the dashed lines are 80% and 92%, where the context ring turns amber and red. "n/a" until a call reports its tokens | Steps with the terrain's window | The model call | Pins it |
| LATENCY chart | Every tool call of the focused thread as a stem (height is how long it took, log scale from 0.1 s to 10 min, the equipment's colour, red when it failed, hollow while it runs) and every model call as a thin bar; the dotted line is the median tool call | Steps with the terrain's window; a running call grows | The tool call | Pins it |
| WINDOW chart | The focused thread's account: used share of its five-hour window over the window's own time, against an even pace (the diagonal). Solid: what this program has seen since it started. Dashed: where it goes at this pace, an estimate. Hollow diamond: when it runs dry | Redrawn with every reading | The account | Pins it || Packet on a synapse | One tool call leaving for its equipment and its result coming back, as a flat sign: a prompt for the shell, a page for a read, a stroke for a write, a globe for the web, two squares for an agent, a block for anything else. Red when the result is a failure | Travels the synapse once: out when the call starts, back when it ends | n/a | n/a |
| Red flash on an equipment box | A call through it just failed | 0.5 s | n/a | n/a |
| Latency line under an equipment box | Every call through that equipment in the last 8 minutes: a stem where it started, as tall as it took (log scale, 0.1 s to 10 min), red when it failed, capped while it still runs. The dotted line is the usual time | Moves left with time | The equipment's card | Pins it || Flash on a pane of the sector map | Its thread just did something: the model's colour when a call reported, cyan when a turn started, green when it ended, red when a tool call or the turn failed, amber when it began to wait on you | 0.4 s, 0.9 s for the end of a turn | n/a | n/a |
| Amber breath on a pane of the sector map | That pane waits on you | Breathes until it is answered, as its row does | The pane | As in v4 || Ripple from a cell body | The phase strip changed because of this thread (an alert was raised), in the alert's colour, and a quarter of a second later the same ripple arrives at the strip's lamp; or one of its tool calls failed, in red | Two rings run outward, 0.6 s | n/a | n/a |
| Motes above a ridge head | One per 5 s a model call has run without a first word | The stack grows while the model has not spoken yet | The terrain card | n/a |
| Diamond on a ridge | A tool call, coloured by equipment; red and taller when it failed | Moves left with time | The call | Pins it |
| Flag on a ridge | An alert raised for that thread | Moves left with time | The alert | Focuses the thread |
| Ring on a ridge | The subagent was dispatched then | Moves left with time | n/a | n/a |
| Motes along an axon | A working thread's words: one mote every 180, 104, 66 or 44 px for under 15, 15 to 40, 40 to 80 and over 80 tokens a second | Flow right at 110 px/s; the focused thread's stream also runs up the wire into its flock | n/a | n/a |
| Account reservoir | The tube is the five hour window, the level what is left of it, the cyan triangle an even pace, the hollow amber triangle where on the window's time axis it runs dry at this pace | Motes sink through it while a thread draws on the account: every 64 px under an even pace, 36 px at or above it, 22 px at twice it | The account's card | Pins it |
| Window buttons 1, 5, 30 MIN | Control: the terrain's window | n/a | What it does | Sets the window (`w` cycles) |
| Everything from v4 | See `../v4/README.md`: rails, cells, axon ticks, pulses, equipment, phase strip, comms, sector map, log, key hints | Unchanged | Unchanged | Unchanged |

### What the flock does, and when

| The thread | The flock |
| --- | --- |
| A model call is open and no part of it has ended (reasoning) | The globe's dots fly as a murmuration: bunched behind a head (the newest output leads) on an orbit that leans 34 degrees off the globe's axis and precesses, so it climbs over the north, dives under the south and passes behind and in front of the rings |
| A part of the call has ended and the next is being written | The dots draw up in 2 to 9 parallels, oldest at the south, that turn against each other |
| A model call is open | The tip charges at the thread's last measured rate and releases dots into the orbit |
| The call reports | Its dots siphon from the orbit into the globe and the estimate is replaced by the call's count |
| Nothing heard for a while | Slows from 6 s of silence; locked into the lattice after 150 s |
| A tool call starts | The globe locks into its lattice (a spiral from pole to pole) and turns one notch a second; the call's dots leave as a satellite on that equipment's lane |
| The result returns | The satellite's dots return; a spark where it landed |
| A tool call fails | The flock scatters; the call's dots are red for 2.6 s; three or more failures in a row keep it jittering |
| The turn ends | The last dots siphon in; the globe forms up and rests, dimmed, breathing |
| The context fills | The globe swells toward the context ring |
| The turn runs past its usual length | The ring system tips further back |
| The focus moves | The old flock flies outward and fades; the new one gathers from all around |

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

## What the terminal holds

A snapshot (`shots/latest.png`) is this program's own composite. It cannot show what the terminal
lost, so the program asks the terminal instead.

- herdr 0.9.5 keeps 64 MiB of image pixels per pane and, when that is full, drops images without
  a word: unplaced ones first, then the oldest placed one. Measured with `tools/gfx-probe.mjs`
  (the 34th 2 MB image evicted the first; every upload up to 41 MB was answered `OK`). That is
  how the whole moving layer once vanished: the atlas was one 39 MB image, the oldest in the
  store, and a wide pane's tiles pushed it out.
- The atlas is now small pages, one per colour and family of shapes (dots, streaks, travelling
  marks, glows, frames), built when a sprite first needs them: 2 to 4 MB in all, 10 MB at most.
  A page nobody used for 30 s is dropped when room is needed. A page goes up after the tiles
  and right before its first placement.
- Every page upload is answered by the terminal, and every two seconds a clear cell of every page
  is placed in the corner and answered `OK` or `ENOENT`. A page the terminal lost is sent again.
  Three losses in a minute, or tiles that leave no room for sprites, and the moving layer is
  painted into the tiles instead; the header line says so and sprites are tried again a minute
  later. `kill -USR2 $(cat v5/nexus.pid)` deletes one page behind the program's back to test it.
- `stats.json` carries the answer under `graphics` (pages, sent, held, verdict, answers,
  lostLastMinute, storeMb of storeLimitMb) and `fallback` (why the layer is painted, or null).

## Files

As v4, plus `src/flock.mjs` (the swarm: a dot's life from the tip to the globe, simulation,
projection, hit test), `src/body.mjs` (the view of the core: projection, rings, lanes),
`src/card.mjs` (the card as its own image and its leader line), `src/terrain.mjs` (the ridges),
`src/explain.mjs` (explain mode and the keyboard walk), `src/charts.mjs` (a stub: the live charts
are not built), `tools/look.mjs`, `tools/restart.sh` (restarts v5 in its pane in place) and
`tools/gfx-probe.mjs`. `src/sprites.mjs` is the paged atlas; `src/terminal.mjs` and
`src/encoder.mjs` send a z per placement, the page a sprite sits on, and the heartbeat.

## State of the build

Done: the core as a globe in a ring system, flat dots, the charge at the tip, the orbit and the
siphon, the murmuration and ring formations, satellites, moons, the time terrain, cards with
leader lines that follow their mark, explain mode, the keyboard walk, the paged atlas with the
terminal's own acknowledgement, the painted fallback and the way back.

Seen by the operator in the live pane (2026-11-15 about 02:30, "looking good carry on", nothing
singled out): the sprites are back, with the flat dots, the charge, the orbit, the siphon and
the charts. Everything after that (the terrain in perspective, the wire streams, the packets and
the latency lines) was seen only in this program's own snapshots. What the
terminal answered (not a snapshot): 13 to 19 sprite pages held of as many sent, a deleted page
noticed and sent again, the fallback after three losses.

Since then: three live charts beside the core (context, latency, the account's window), the
terrain in real perspective with an open call's estimate drawn dashed, wire streams that are
seen at a glance (solid motes, every fourth a glowing head; a faint sparse stream when the rate
is not known), a tool call that travels as a packet with a sign per equipment, a red flash on
the equipment when a call fails, a latency line under every equipment box, a sector map whose
panes answer to their threads, and project directories in the demo.

Not done yet, in the order the brief gives: comms and the log coming alive, the cache cooling (how long a thread's prompt cache lives is not in the data this program reads, so
it would be a guess), context closing a ring, scrubbing the terrain by dragging, the remaining
v4 marks as targets, explain-mode tags that overlap. In landscape the three charts are cramped
and the stage has empty space above the terrain.

Verified since, in a snapshot: the ring formation once it has settled (parallels turning against
each other), and a 206 column frame in the landscape layout (28 pages, 3.9 MB; its tiles are at
most 30.4 MB, so 34 MB of the 67 MB store by arithmetic). Through real herdr forwarding a hover
answered on the charge at the tip, the turn clock, the terrain and the WINDOW chart; the LATENCY
plot and an equipment's latency line answered in a synthetic run only.

Not verified: a 206 column pane in the real terminal, a quiet machine, and the marks that need
an event to fire while someone looks: a packet in flight, the red flash on a failure, a pane of
the sector map lighting up, a ripple. They ran for 16 s of simulated work without an error.

Measured at 105 columns by 82 rows, three to four threads working, with the charts and the
perspective terrain in: 30 frames a second; 250 to 370 kB/s and 4 to 8% of a core while the
focused thread runs tools, 450 to 650 kB/s and 5 to 11% while its whole flock flies; for a
second or two after the focus moves to another thread, up to 1.6 MB/s and 18% (the core and the
tail are drawn afresh); 300 to 340 MB physical footprint (resident size swings from 130 to 500
MB with the machine's memory pressure); 16 to 18 MB of the terminal's 67 MB store.
`stats.json` says what costs it:
`repaintsPerSecond` by region of the still layer and `movedPerFrameBy` by kind of mark. Painted
fallback: 1.5 to 4.7 MB/s and about one core.
