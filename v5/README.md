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
- **REACH.** Under THIS TURN, a tree off the focused thread's own wire: what the turn has
  touched (files under their folder, programs, searches, hosts, agents) with one bar per call
  on the turn's time. The rest of the stage says how the turn works; this says on what.
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
| Context ring | The context window, closing. The ring is shut at the bar on its far side when the window is full, so the open stretch is what is left. Solid arc: the context as last read, amber past 80%, red past 92% (the two notches outside the ring). It is read at every model call where the thread's Claude Code transcript was found (the same match as for the cache), and otherwise only when a turn ends | Grows with the context | The context card: used, left, pace, how many calls fit, measured or reported | Pins it (the ring's line and its caption "CONTEXT RING 50% full · 501k left · ~141 calls to full" are both targets) |
| Head of the context ring | Where the context stands | When a reading moves it, the head runs along the ring to its new place in half a second; after a compaction it runs back and a ripple marks where the ring opened | The context card | Pins it |
| Dashed stretch ahead of the head | An estimate: what the model calls made since the last reading have probably added, at the thread's pace (the median growth per call over its last stretches between two readings, twelve at most). Empty for a thread read at every call | Grows with every call until the next reading replaces it | The context card | Pins it |
| Ticks ahead of the head | One tick per further model call at that pace, sixteen at most: when the ticks reach the bar, the ring closes within the calls you see. An estimate | Move with the head | The context card | Pins it |
| PROMPT CACHE axis under the turn's time | The focused thread's prompt cache as a time axis: the left end is its last model call, the right end the moment the cache goes cold, with a tick every ten minutes of an hour or every minute of five. The bright stretch is what is left of its lifetime, drawn in the colours the cache will pass through: its colour now at the head, a cold indigo blue at the right end. The cache has a ramp of its own and the hue is the reading: rose when a call has just touched it, through a dusty orchid, to cold blue when it is nearly cold, grey once it is cold. No model, signal or tool colour is on that ramp (see `src/cache.mjs`). The chip says MEASURED or ASSUMED. Measured: the lifetime (five minutes or an hour) is read from the thread's own Claude Code transcript. Assumed: one hour, and then the stretch is dashed and the reading starts with "~" and says "an assumed 1 h" | The head is now: it moves right in real time, and jumps back to the left end when a model call goes out. Cold: the head stands hollow at the right end | The cache card: state, lifetime, measured or assumed and why, how the transcript was found, last touched, when it goes cold, what it holds | Pins it |
| Cache arc round a cell body | The same cache for every thread on a Claude model: the share of its lifetime that is left. Its colour is the same ramp: rose, orchid, cold blue. A full circle when a call has just gone out, no arc when it is cold. Solid when the lifetime is measured, dashed when it is assumed. Beside it on the row: "cache 52m", "cache ~52m" when assumed, "cache cold 12m" for the first hour after it went cold, nothing after that | Shrinks with real time (painted again each minute, each ten seconds under ten minutes, each second under two) and springs back to a full circle when a model call goes out | The cache card | Pins it |
| Moon on the outermost orbit | A subagent of the focused thread | Circles as fast as it writes; sits still when it rests; amber when it waits on you | The subagent's card | Focuses it |
| Ridge | One thread's tokens a second over the window (a call's tokens spread evenly over the time it took; estimated from text length, 3.6 characters a token, where a call reports none) | The terrain steps left with the clock, one slice at a time | Value, time, thread, slice length | Focuses that thread; on the focused ridge, pins the point |
| Ridge head (dot at "now") | A working thread's newest tokens a second | Rises and falls with the rate | n/a | n/a |
| Ground of the terrain | A plane in perspective: the focused thread's ridge at the front edge at full size, each ridge behind it scaled by 1 / (1 + 1.9 k / 6) for depth k, hazier with distance. The lines running back are equal times; the cyan edge is now | Steps with the clock | n/a | n/a |
| Dashed step on a ridge | An open model call: what it probably writes, at the thread's last measured rate, from the call's start to now. An estimate, and named "estimate" on the front ridge | Grows to the right until the call reports | The ridge point | Pins it |
| CONTEXT chart | The focused thread's context at every model call, against its limit; the dashed lines are 80% and 92%, where the context ring turns amber and red. "n/a" until a call reports its tokens | Steps with the terrain's window | The model call | Pins it |
| LATENCY chart | Every tool call of the focused thread as a stem (height is how long it took, log scale from 0.1 s to 10 min, the equipment's colour, red when it failed, hollow while it runs) and every model call as a thin bar; the dotted line is the median tool call | Steps with the terrain's window; a running call grows | The tool call | Pins it |
| WINDOW chart | The focused thread's account: used share of its five-hour window over the window's own time, against an even pace (the diagonal). Solid: what this program has seen since it started. Dashed: where it goes at this pace, an estimate. Hollow diamond: when it runs dry | Redrawn with every reading | The account | Pins it |
| Packet on a synapse | One tool call leaving for its equipment and its result coming back, as a flat sign: a prompt for the shell, a page for a read, a stroke for a write, a globe for the web, two squares for an agent, a block for anything else. Red when the result is a failure | Travels the synapse once: out when the call starts, back when it ends | n/a | n/a |
| Red flash on an equipment box | A call through it just failed | 0.5 s | n/a | n/a |
| Latency line under an equipment box | Every call through that equipment in the last 8 minutes: a stem where it started, as tall as it took (log scale, 0.1 s to 10 min), red when it failed, capped while it still runs. The dotted line is the usual time | Moves left with time | The equipment's card | Pins it |
| Flash on a pane of the sector map | Its thread just did something: the model's colour when a call reported, cyan when a turn started, green when it ended, red when a tool call or the turn failed, amber when it began to wait on you | 0.4 s, 0.9 s for the end of a turn | n/a | n/a |
| Amber breath on a pane of the sector map | That pane waits on you | Breathes until it is answered, as its row does | The pane | As in v4 |
| Ripple from a cell body | The phase strip changed because of this thread (an alert was raised), in the alert's colour, and a quarter of a second later the same ripple arrives at the strip's lamp; or one of its tool calls failed, in red | Two rings run outward, 0.6 s | n/a | n/a |
| Motes above a ridge head | One per 5 s a model call has run without a first word | The stack grows while the model has not spoken yet | The terrain card | n/a |
| Diamond on a ridge | A tool call, coloured by equipment; red and taller when it failed | Moves left with time | The call | Pins it |
| Flag on a ridge | An alert raised for that thread | Moves left with time | The alert | Focuses the thread |
| Ring on a ridge | The subagent was dispatched then | Moves left with time | n/a | n/a |
| Motes along an axon | A working thread's words: one mote every 180, 104, 66 or 44 px for under 15, 15 to 40, 40 to 80 and over 80 tokens a second | Flow right at 110 px/s; the focused thread's stream also runs up the wire into its flock | n/a | n/a |
| Account reservoir | The tube is the five hour window, the level what is left of it, the cyan triangle an even pace, the hollow amber triangle where on the window's time axis it runs dry at this pace | Motes sink through it while a thread draws on the account: every 64 px under an even pace, 36 px at or above it, 22 px at twice it | The account's card | Pins it |
| Window buttons 1, 5, 30 MIN | Control: the terrain's window | n/a | What it does | Sets the window (`w` cycles) |
| Flag line in comms | One alert: its level (filled red square: needs you now; amber outline: watch it; grey outline: worth a look), its thread, what it is, since when. Cut at the end of a word, never inside one | A flag that is raised arrives here last: a ripple from its thread, a quarter of a second later one at the phase lamp, half a second after it was raised a ripple and a flash on its own line. The marker of a flag that needs you now breathes red until it is dealt with or muted | The flag in full, long lines wrapped | Focuses the flagged thread |
| Log line | One thing that happened: when, which thread, what (a tool call, a turn that began or ended, a call for you, a dispatch), how long it took. Bright for 20 s, dimmer for five minutes, faint after that | A new line lights up where it begins, in its own tone. When a tool call comes back, the end of its line flashes in the equipment's colour, red when it failed | A tool call: the same card as its pillar and its diamond. Anything else: the line in full | Focuses its thread; on the focused thread, pins the line |
| Track under a running log line | A tool call that has not come back: the line counts its seconds, the tick on the track stands at that equipment's usual time (the median of the last 8 minutes), the end of the track at 1.67 times it. No track when the equipment has no usual time yet | The head runs along the track with the call's own elapsed time, cyan up to the tick, amber past it, and stops at the end | The tool call | As the line |
| Rings from a flag or a log line | Control: what the line under the pointer (or the pinned one) is about | A ring on its thread's cell body, on its pane in the sector map and, for a tool call, on the equipment it went through, for as long as the pointer is on the line | n/a | n/a |
| Source lamp beside the title | LIVE (cyan) or DEMO (amber): where the data comes from | Still | What is read, how often, and that nothing is written | Pins it |
| Clock and date | This machine's clock: every "ago", countdown and time axis is measured against it | Ticks | What it is | Pins it |
| Phase line beside the lamps | The headline of the phase and the flag it names | Changes with the phase | The flag itself when it names one; otherwise what each phase means | Focuses the flagged thread, or pins it |
| A count in the header | One figure each: working, calls, silent, listed, panes, cost in 24 h, tokens out a minute | Changes with the data | What exactly is counted, and from where | Pins it |
| This program's line (right of the counts) | The pane's size, frames a second, sprites and whether the terminal holds them, kB/s, CPU | Rewritten every 2 s | What each figure is | Pins it |
| Turn readout under the core | The state word, the turn's time and its usual length (median; "3 in 4 end by" is the third quartile) | The timer runs with real time | The thread's card | Pins it |
| A line of THIS TURN | Model calls, then each kind of equipment the turn called: how often, how long together, how many failed | Changes when a call lands | The equipment's card; for model calls, what one is | Pins it |
| REACH tree (left column, under THIS TURN) | What the focused thread's turn has touched: every file under the folder it is in, every program, search, host and dispatch under its equipment. Folders are named from the root they share ("in ~/code/..."); when a stray file makes that root the disk or the home folder, the branch with the most calls is followed down and the rest is named in full, as outside. Read from each tool call's name and the first field of its input in opencode's record (path, command, pattern, address). A program is the first word of its command after any leading `cd` and assignments, with the subcommand for git, npm and the like. Shown when the thread rows leave the stage room for its head and three rows | A target appears when it is first touched. When the rows do not fit, every group shows as many of its most recently touched targets as all can show alike, and a last line counts the rest | The target: its path or last command, calls by kind, failures, time together, first and last touch. A folder or a kind of equipment: what it holds. The root. The rest that is not shown | Pins it |
| Bar on a REACH row | One tool call on that target, on the turn's time: where it starts is when the call started, its length how long it took (3 px at least), its colour the equipment, red when it failed, hollow while it runs. One scale for every row: the first round span the turn still fits in (1, 2, 5, 10, 20, 30 minutes, 1 hour and so on) | A running call's bar grows. The scale stands still until the turn outgrows it | The tool call (the same card as its pillar, its diamond and its log line) | Pins it |
| Cyan line through REACH | Now, on the turn's time | Moves right in whole seconds, two pixels at a time | The axis: when the turn began, the span across | Pins it |
| Tone of a name in REACH, and the word at its right | How long ago the target was last touched: bright for 20 s, softer for five minutes, dim after that. The word: "now", "20s", "3m", or "running" in cyan while a call on it is out; a clock time for a turn that has ended | Changes every ten seconds under a minute, every minute after | The target | Pins it |
| Packet on a REACH branch | A call of the focused thread leaving its wire for its target, and its result coming back: the same sign per equipment as on a synapse, red when it failed | Out when the call starts, back when it ends, a flash at the target when the result lands (longer and red for a failure) | n/a | n/a |
| Motes on a REACH branch | A call that is still out | Run from the wire to the target for as long as the call runs | The branch: what it is, how many calls are out | Pins it |
| Scrubbed moment (a drag along the terrain) | One moment of the terrain's window, read on the front ridge in whole slices. A white mark on every ridge where it stood then (and one on the ground under it), a white line at the same moment on the CONTEXT and LATENCY charts and, when it lies in the turn, on REACH | Follows the drag; then steps left with the terrain and is let go when it leaves the window | The SCRUB card: the time, and for every listed thread its tokens a second in that slice and what it had open then (the tool it ran, reasoning, writing, or waiting for the first words) | A press on a ridge or the ground is a click when released without a drag, so a drag never moves the focus. Escape lets the moment go |
| The focused thread's wire (circuit to tip) | The path of what the thread writes: motes run up it while it works (density is the rate), a burst when a call reports | See "Motes along an axon" | What it is, what it carries, where it ends | Pins it |
| Synapse (curve from a thread's wire to an equipment box) | That the thread acted on that equipment: shown for the three kinds a working thread used last (two for a resting one, for 90 s), brighter the more recent, in the equipment's colour while a call is out, amber to YOU while the thread waits on you | Packets and motes travel it (see "Packet on a synapse") | Thread and equipment, whether a call is out, when it was last used | Pins it |
| Focus header (right of the core) | FOCUS and the number: which thread is on the stage. Title: the thread. Path line: account, project, parent, agent. Model line: model, effort, subagents, depth, id. "asked": the message that started the turn. Figures: output this turn, rate, context, spent, one dot | Change with the data | The title opens the thread's card; the other lines say each part in full; CONTEXT opens the context card, ONE DOT the flock's, a figure what is counted and from where | Pins it |
| Section label (TIME TERRAIN, ACCOUNTS, CIRCUIT, EQUIPMENT, COMMS, SECTOR MAP, LOG) and a chart's head | The name of a part of the screen | Still | What the part shows, its marks, its keys; a chart's head opens the chart's own card (context, account) or says what the chart is | Pins it |
| Workspace name in the sector map | A herdr workspace; its tabs follow on the line | Still | Its panes by state, and whether herdr shows it now | Pins it |
| Log line "compacted" | A thread's context fell by more than a fiftieth of its window and 5k tokens between two readings: a compaction or a pruning, with both figures | Lights up as any new line; on the stage the head of the context ring runs back | The line in full | Focuses its thread |
| Last turn on a resting row (right half of its meta line) | What the thread's last turn was, however long ago: how long it ran, its model calls, its tool calls and how many failed (in red), what it wrote, what it cost, and how it ended: a full green dot and "done", a red cross and "failed", a ring and "interrupted" (or "ended" when the record does not say). Read from opencode's record of the thread, from the newest message of the user to its newest step: one small summary a thread, read again only when the thread's record moves, at most four threads a poll, from at most 400 of the turn's newest steps ("over 400 calls" then). A narrow row drops parts from the left (the label, the cost, the output, the tools, the calls); how it ended always stays | Still. It changes when the thread's next turn ends | The LAST TURN card: began, ended, ran, model calls, tool calls, wrote, cost, where it is read from | Pins it |
| The stage at a held moment (THEN) | While a moment is held on the terrain, the core, the flock line, the turn readout, THIS TURN and the focus header show the focused thread as it stood at that moment, not now: the turn clock with the calls made by then (a call that was open then is open), the context ring where the context stood at the last call before it, the output written by then (a call that reported no count is read from its text: an estimate), the state word and the timer of then. Read from the thread's own steps, tool calls and marks, which are kept for the terrain's widest window and for the whole of a running turn. Marked as the past: the still parts at about half strength, every dot, satellite and mote in one grey, and a white tag "THEN 08:12:30" at the core. Not replayed: the live text, the charts and REACH (they mark the moment with a white line), the cache axis, the subagent moons, the rows of the circuit | When the moment is first held, the flock of now flies off and the flock of then gathers. It flies in the formation of what was open then (a murmuration while the model reasoned, parallels while it wrote, locked in its lattice while a tool ran, at rest when the thread rested) on its own running clock, so a held moment is still alive. On release the flock of then flies off and the flock of now gathers | Marks answer as they do now: a pillar or a bar opens its call's card. The THEN tag says what is shown and where it is read from | The tag: pins its card. Escape lets the moment go |
| Wires at a held moment | Every listed thread that had a model call or a tool call open at the held moment: grey motes along its axon at its rate of that moment (the terrain's slice, in the same four densities as now; the sparsest stream when the slice holds no figure), the focused thread's also up its wire into the flock, and grey motes on the synapse to the equipment of each tool call that was out | Flow as now, in grey. What happens now still travels in colour (a packet, a flash) | n/a | n/a || Everything from v4 | See `../v4/README.md`: rails, cells, axon ticks, pulses, equipment, phase strip, comms, sector map, log, key hints | Unchanged | Unchanged | Unchanged |

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
| drag along the terrain | holds one moment of the window (see "Scrubbed moment" in the table); `escape` lets it go |

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
- `pages` is how many sprite pages this program has built, `sent` how many of those are on the
  terminal now, `held` how many of the sent ones the terminal last answered `OK` for. The
  verdict compares held with sent, so "22 held of 32 pages" is "held": the other ten are built
  here and not on the terminal. A resize clears the terminal and every page with it; a page
  goes up again when a sprite next needs it, and one that nothing uses stays down.

## The prompt cache

The provider keeps what a thread has sent for a set time after the thread's last model call:
five minutes or an hour, chosen per request. While it is kept the next call reads it back
cheaply; once it is cold the next call writes all of it again. Nobody shows this, and it is
what decides whether going back to a resting thread is cheap.

- **Measured.** Claude Code writes every model call into the thread's transcript with how many
  tokens it wrote to the cache under each lifetime (`cache_creation.ephemeral_5m_input_tokens`
  and `ephemeral_1h_input_tokens`). The lifetime shown is the one the thread's newest writing
  call wrote under. `src/cache-worker.mjs` reads only those numbers and the timestamps, never
  the text, in a worker thread, forwards from where its last read ended.
- **Which transcript.** By the plugin's own record of which Claude session answers the thread
  (`claude-sessions.json`, written when a turn ends), or, for a thread in its first turn and
  for most subagents, by timing: a block of thinking or of reply ends at the same moment in
  opencode's store and in the transcript (measured 0 to 2 ms apart), so the transcript in the
  thread's project folder that has a record within a quarter of a second of two or more of the
  thread's last block ends, with no runner-up matching more than half as many, is its own.
  Measured on this machine: 12 of 12 for a subagent in its first turn and for a fresh fork.
- **Assumed.** One hour, what a Claude Code session on a subscription uses, when no transcript
  is found (a thread that has written fewer than two blocks, a transcript that is behind the
  thread). The mark is then dashed, its reading starts with "~", its chip says ASSUMED and its
  card says why. A thread on a model that is not served through Claude Code shows "n/a".
- **Last touched** is when the thread's newest model call went out, from opencode's own record
  of that call, not from the session's "updated" time, which moves for other reasons.
- `node --no-warnings v5/tools/cache-probe.mjs` prints what is found for every thread.

## Memory

Measured with `tools/mem-watch.mjs` (the physical footprint as macOS counts it, split into the
allocator's large and small blocks and V8's heaps) in the live pane at 84 columns by 82 rows.

| | Before (22:50 to 22:57, five working) | After (23:53 to 00:03, six working, four from 00:02) |
| --- | --- | --- |
| Footprint | 420 MB rising to 433 | 206 MB at start, 171 to 176 from the fifth minute on |
| Large blocks | 141 MB | 64 MB, the same in every sample |
| Small blocks | 129 to 140 MB | 39 to 43 MB once settled |
| V8, three threads | 114 to 118 MB | 47 to 52 MB |

Four causes, each measured on its own before it was changed:

- **The transcript reader** read each transcript's last 4 MB and the plugin's 9 MB record whole
  and parsed the record: 110 MB the moment it ran (`tools/mem-source.mjs`: the data side alone
  was 153 to 164 MB with it and 41 to 55 without). Both now pass through one 256 KB buffer;
  the record is walked byte by byte for its four fields and never parsed. 72 to 82 MB for the
  data side, the reader's own heap 8 of 13 MB where it was 32 of 63. Same answers on all 49
  threads (`tools/cache-probe.mjs`, old against new).
- **The encoder** called `zlib.deflateSync` per tile. Each call leaves a stream wrapper that
  keeps a 16 KB output buffer cut from a 64 KB slab until V8 collects in full, which a thread
  that small does only when some 60 MB of them have piled up: 721 dead slabs (46 MB) in the
  live process, 178 to 772 in a test by itself. One stream per level is kept and reset: 16
  slabs, constant. Its output is byte for byte what `deflateSync` gives (420 of 420), it is
  checked against `inflateSync` when the worker starts, and `stats.json` says which path runs
  (`deflate`).
- **The young generation** of the main thread was meant to be 4 MB and was 34: the flag was
  set after the start, where it changes nothing. The program now replaces itself with the same
  command and the flag (`process.execve`: same pid, same terminal). 8 MB held, and the main
  heap is 21 to 26 MB where it was 78 to 143.
- **Tile pixels** went to the encoder in one buffer of exactly the bytes needed, so every large
  repaint freed a block of a new size (2 to 13 MB), and the allocator keeps up to sixteen such
  dead blocks: large blocks climbed from 79 to 130 MB in fifteen minutes. They now travel in
  buffers of fixed sizes (32 KB to 1 MB, several of 1 MB for a large repaint), and a frame
  leaves the encoder through one kept buffer.

`stats.json` carries `heaps` (V8 per thread, and the main thread's by space), `cacheWorker`
(what the reader keeps) and `deflate`. `NEXUS_ALLOC=120 node v5/nexus.mjs` writes
`v5/alloc.json`: who allocates on the main thread, in MB a second (22 MB/s before; the sprite
diff, a quarter of it, no longer makes an object per sprite per frame).

Not flat by the letter of the brief: six threads worked for the first eight and a half minutes
of that watch and four after. The line did not move when they dropped.

**Which level is the settled one (2026-11-16).** There is not one level but a band, about 171
to 218 MB, and it does not leak. One run was left alone for 2 hours 49 minutes at 91 columns:
210 MB six minutes in, 209 MB at the end (large blocks 64, small blocks 75, V8 53). What moves
is the allocator's small blocks, 42 to 77 MB: memory the program has already freed and the
allocator hands back to the system late and in steps. A watch after a restart shows it: 213 to
218 MB for seven minutes, then 198 to 201, then 185, with small blocks going 77, 56, 42 MB
and nothing else changing (V8 43 to 50 MB, large blocks flat). The 171 to 176 MB of the fifth
session was the low end of that band (small blocks 39 to 43) at 84 columns; large blocks were
64 MB there and are 64 to 77 MB at 91 columns. So the footprint to hold it to is "under about
220 MB and not rising", not a single figure.

**A resize (2026-11-16, seventh session).** The operator dragged the split from 91 to 139
columns while v5 ran: 417 MB two hours later (large blocks 140 MB), with a peak of 780 MB,
where a fresh start at 139 columns settles at 204 to 219 MB (large blocks 98 MB). So it was
what the resize left, not what the width costs. `tools/resize-check.py` reproduces it on a
second copy of v5 that draws on a stand-in terminal (a pty the script answers for), so the
pane the operator looks at is never resized:

| A drag from 91 to 139 columns | Before | After |
| --- | --- | --- |
| At 91 columns, before the drag | 198 to 222 MB | 167 to 177 MB |
| Right after it | 1008 to 1027 MB (large blocks 862 MB) | 214 MB (large blocks 103 MB) |
| Two to four minutes later | 273 to 368 MB | 203 to 225 MB, where a fresh start at 139 columns stands at 209 to 213 |
| Back from 139 to 91 columns | not measured | 159 to 169 MB, as a fresh start at 91 |

Three causes, each measured on its own:

- **One resize per column.** A hand on a split sends a resize for every column it crosses, and
  each built both layers of the picture and the shadow of the screen afresh: 48 sizes in two
  seconds. The size is now taken once it has stood still for 160 ms, and nothing is sent
  while it moves.
- **macOS keeps freed large blocks.** A surface that is freed stays with the allocator as
  "Malloc Large (empty)", dirty and counted against the process, until a block of that very
  size is asked for again (48 freed surfaces: 640 MB, still there after a full collection and
  handed out again only to canvases that fit them). Two answers. The layers and the shadow are
  built on a grid of 8 columns by 4 rows and kept while the pane fits them without wasting a
  quarter, and the shadow is cleared instead of replaced at a reset: a nudge of the split
  frees nothing. And the allocator is told to give freed large blocks back at once
  (`MallocLargeCache=0`, set where the process already replaces itself at its start): the
  same 48 surfaces are 41 MB after a collection instead of 816.
- **The old size's owners.** The layers of the size before are only freed when V8 collects
  the objects that own them, which with a heap this small can be many minutes away. It is
  asked to collect once, a second after a resize and after a snapshot (`--expose-gc`, given
  with the young generation's size).

What the allocator setting costs: in pairs of copies fed the same data, 1.1 points of a core
(median 7.9% against 6.4% at 139 columns with five threads working, higher in 17 of 20
samples) for some 50 MB less at rest (208 to 243 MB against 255 to 302) and nothing left by a
resize. `MallocLargeCache=1 node v5/nexus.mjs` runs with the system's default.

In the real pane with all of it: 211 to 253 MB at 139 columns (large blocks 102 to 103 MB,
four threads working, thirteen minutes) and 183 to 196 MB at 91 columns (large blocks 68 MB,
eight to nine working, twelve minutes; small blocks went from 44 to 48 MB and V8 from 60 to
63 MB in that time, with nine threads working, and it was not watched for longer). The rule is about 220 MB at 91 columns and that times the pane's
area elsewhere (336 MB at 139). A resize of the real pane while it ran happened once with the
new code (the operator took the split back to 91 columns; `stats.json` counts the sizes
settled on under `resizes`); the footprint after it was not caught on its own.
## Files

As v4, plus `src/flock.mjs` (the swarm: a dot's life from the tip to the globe, simulation,
projection, hit test), `src/body.mjs` (the view of the core: projection, rings, lanes),
`src/card.mjs` (the card as its own image and its leader line), `src/terrain.mjs` (the ridges),
`src/explain.mjs` (explain mode and the keyboard walk), `src/charts.mjs` (the three live charts), `src/cache.mjs` (the prompt cache as the screen
shows it), `src/cache-worker.mjs` (reads the transcripts off the main thread), `tools/cache-probe.mjs`
(what the worker finds for every thread), `tools/look.mjs`, `tools/restart.sh` (restarts v5 in its pane in place) and
`tools/gfx-probe.mjs`, `tools/mem-watch.mjs` and `tools/mem-source.mjs` (see "Memory"),
`tools/coverage.mjs` (which ink on the still layer no target covers), `src/replay.mjs` (a held
moment replayed: the thread as it stood then), `tools/resize-check.py` (what a resize costs,
on a stand-in terminal), `src/allocations.mjs`
(the allocation sampler), `src/reach.mjs` (REACH: what the turn touched), `tools/burst-watch.mjs`
(cost and repaint causes, report by report) and `tools/compact-check.mjs` (provokes a
compaction in the demo). `src/sprites.mjs` is the paged atlas; `src/terminal.mjs` and
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

Since then (2026-11-15 evening): the prompt cache cooling, as an axis under the turn's time and
an arc round every cell body, measured from the transcripts where one is found and marked as
assumed where not (see "The prompt cache"). And a fault that was older than v5 is gone: between
two changes of the layout, the rows of the circuit showed the poll they were laid out in (cost,
context, flags and the live line stood still until the focus moved or a row changed height);
a laid-out row now follows its thread at every poll.

Context closing a ring is in as well: the gate where the ring closes, the head that runs to
each new reading, the dashed estimate and the call ticks, a caption with the calls that still
fit, and the context itself read at every model call from the transcript where there is one
(before, a thread in the middle of a turn showed the figure of its last turn's end, and a
subagent in its first turn showed none: the ring, the CONTEXT chart, the rows and the globe
all gain from it).

Looked at since (2026-11-15, 22:30 to 22:40), from the brief's third item:

- **A fault in long turns.** For a turn that had run past its usual length, the core (the
  largest region there is) was painted again every other frame: its signature flipped on
  rounding noise. With such a turn in focus that was 2.2 to 2.3 MB/s and 17 to 20% of a core;
  it is 470 to 620 kB/s and 6.4 to 8.8% again (five threads working, 84 columns), the core
  painted 1 to 2.5 times a second.
- **Landscape.** A chart too narrow for its name and its value shows the value in brief, so
  the three charts no longer run into their own titles at 206 columns. The cache axis sits
  under the turn's time there too. Seen in a simulated frame only.
- **`z` zoom** in the real pane: toggled on and off through herdr, no error, the terminal
  still held every page.
- **The painted transport** in the real pane (`p`): it works, and at 30 frames a second it
  cost 8.9 MB/s and 53% of a core with five threads working, so it now runs at 15 frames a
  second: 3.8 MB/s and 23%. Back on sprites the terminal answered "held" at once.
- **Pane resize.** The pane was 90, then 84 and 83 columns at successive restarts and v5 laid
  itself out for each; a resize while it runs was not tried (it would move the split of the
  directing session's pane).

- **The event-driven marks in the real pane.** `stats.json` now counts, under `eventsPlaced`,
  every packet, flash and ripple when it is first placed on the terminal (red ones apart). With
  the pages held, that is the pane's own account of having shown them, which a snapshot cannot
  give. In the live pane at 22:42, within three minutes of a restart: 5 packets, 16 flashes and
  2 ripples; and after one tool call of a listed thread was made to fail on purpose (a read of
  a file that does not exist): 1 failed packet coming back, 4 red flashes (the equipment box,
  the end of its log line, its pane on the sector map) and 1 red ripple from its cell body, the
  terminal holding 28 of 28 pages, none lost. What a counter cannot say is how they look: that
  is still the operator's eye.

In landscape the stage still has empty space above the terrain.

Verified since, in a snapshot: the ring formation once it has settled (parallels turning against
each other), and a 206 column frame in the landscape layout (28 pages, 3.9 MB; its tiles are at
most 30.4 MB, so 34 MB of the 67 MB store by arithmetic). Through real herdr forwarding a hover
answered on the charge at the tip, the turn clock, the terrain and the WINDOW chart; the LATENCY
plot and an equipment's latency line answered in a synthetic run only.

With the cache marks in (2026-11-15, 22:07): the pane is 84 columns by 82 rows now, the
terminal answered "held" for 19 of 19 sprite pages after the restart, and a hover sent through
herdr onto the PROMPT CACHE axis opened its card ("1 h, measured", "found by timing: 12 of the
thread's last 12 blocks"). Six threads working: 30 frames a second, 400 to 440 kB/s, 5.3 to
6.6% of a core, 294 MB physical footprint, 14 MB of the terminal's store. The arc and the
reading on a row were seen in this program's snapshot of the live pane only.

The context ring (22:25): its caption answered a hover sent through herdr in the live pane; the
ring's own line answered a hover and a click in a simulated run only. Seen in snapshots only:
the head, the dashed stretch and the ticks. Not seen at all: the head running back after a
compaction (no thread compacted while this was built).

Memory (2026-11-15 night, fifth session): back under its class, 171 to 176 MB where it was 420
to 433. See "Memory" above for the four causes and the numbers.

The cache has its own ramp (rose, orchid, cold blue; grey when cold), seen in headless frames
of live data only: the axis, and "cache 1h", "cache 34m" and "cache 5m40" on three rows in
three colours of it.

Small marks: `tools/coverage.mjs` counted 474 of 2909 inked cells of the still layer with no
target under them (16.3%), and 298 of 2988 (10.0%) after the header, the turn readout and the
lines of THIS TURN became targets. Through herdr in the live pane a hover answered on a count
("note count-working") and on the source lamp ("note mode"); the rest was poked headless.
Still bare: the focus header (title, path line, the row of figures under it), the section
labels (TIME TERRAIN, ACCOUNTS, CIRCUIT, EQUIPMENT, COMMS, SECTOR MAP, LOG), the workspace
names in the sector map, the focused thread's wire up to the tip and the synapse wires to the
equipment.

Sixth session (2026-11-16, 02:55 to 04:55), in the tenth addendum's order:

- **The core repaint bursts.** Not the pointer: a running tool call. Its pillar on the turn
  clock is on a log scale, 24 steps in the call's first second, and every step painted the
  whole core again, so a thread that makes quick calls held it at 6 to 8.5 paints a second
  (816 kB/s and 10.3% of a core in the report where it was caught). Running pillars are now
  read on one shared half-second grid: 4 steps in a call's first two seconds where there were
  23. A second, slower one: a turn past its usual length grew its clock's scale every second
  (one core paint a second); the scale now grows in steps of a quarter of a percent. The core
  and the flock line name the parts of their signature, and `stats.json` counts which part
  caused each repaint (`repaintCauses`); `tools/burst-watch.mjs` prints them report by report.
  A minute with nothing touching the pane: median 5.0% of a core and 281 kB/s, highest 6.3%
  and 345 kB/s, the core painted 0 to 1 times a second. A minute with the pointer moving
  across the whole pane (3.5 to 5.5 moves a second, sent through herdr, cards opening):
  median 5.9% and 358 kB/s, highest 9.8% and 590 kB/s. No report over the class in either.
- **A fault in the small marks of the session before.** A "note" (the header's marks, the turn
  readout, the lines of THIS TURN) answered the pointer but its card opened only on a click:
  the kind was missing from the list of marks that open a card on hover. It is in now.
- **REACH** fills the left column (see the table of marks). It shows when the thread rows leave
  the stage room; with many threads listed the stage is at its smallest and neither THIS TURN
  nor REACH has room.
- **Small marks.** `tools/coverage.mjs`: 1 of 3051 inked cells of the still layer has no
  target under it (0.0%); it was 14.6% on the same data when this session began and 10.0% at
  the end of the one before. The focus header, every section label, the workspace names, each
  whole chart, the focused thread's wire and every synapse answer now. The wires are a row of
  small targets along the line; the keyboard walk stops on each wire once.
- **Explain mode.** No two tags overlap: a tag may stand on any side of its mark and slide
  along it, twenty places are tried (three rounds), and a tag keeps its place while its mark
  stays within 30 px. Tags still cover what is under them: that is what the mode is.
- **Scrubbing** the terrain by dragging (see the table of marks). What is not built: the core
  and the wires do not replay the scrubbed moment; the moment is read out, not re-enacted.
- **The context head running back.** Not seen live (no thread compacted). Provoked in the
  demo: `tools/compact-check.mjs` runs the demo on its own clock until a window nine tenths
  full is compacted and reports it (898k to 260k of 1.00M, the head at rest 500 ms after the
  reading, six places on the way, one ripple where it landed, the log line "compacted").
- **Memory.** A band, not a level, and no leak: see "Memory".

Seen in the real pane through herdr (synthetic input, the terminal holding every page): a
hover on REACH's head opened its card, and a press, three drags and a release on the terrain
scrubbed it (`input.json`: "scrubbing the terrain: 04:32:30"). Seen only in this program's
own frames: how REACH, the scrub marks, the explain tags and the compaction look. Not seen by
anyone yet: REACH and scrubbing with a real hand, and a packet travelling a REACH branch
(placed, by the counters, as any packet).

The last look at the whole screen (04:51, the live pane's own frame, four threads working):
with REACH in, no part of the portrait screen is empty while threads work. The weakest part
left is the circuit's resting rows: a thread that rests shows its name, its figures, its cache
and "resting 4h30", and the right half of its row is bare, because the line there is the
thread's last minutes and it has none. It was left as it is: what would belong there (what the
thread's last turn did, what it ended on) is only in memory for the 31 minutes of history
this program reads, so a mark there would appear and vanish by the age of the data, not by
the state of the thread. It needs a decision on reading further back before it is drawn.

Seventh session (2026-11-16, 06:55 to 10:30), in the eleventh addendum's order:

- **Memory after a resize.** See "Memory": a resize leaves nothing behind now, and "22 held
  of 32 pages" is explained under "What the terminal holds".
- **The wide pane.** Upright, the scale was the width's share alone until the height ran
  short at a design height of 2200 units: at 139 columns everything was drawn a tenth larger
  than designed, the stage stood at its smallest, THIS TURN and REACH had no room and the list
  scrolled after four rows. The height's share is 2800 units now: from 111 columns on the
  scale stands still (0.88 at 82 rows) and the extra width goes to what grows sideways (the
  charts, the live text, the terrain, the rows). At 139 columns the core is 323 px in radius
  where it was 406, and 266 at 91 columns. THIS TURN and REACH always have their room (three
  steps of the stage: the five lines and REACH's head with some five rows); when many threads
  are listed the list gives way and scrolls, and what its window leaves over is air between
  the rows. 91 columns is as it was (same scale, all eight threads listed, REACH whole).
- **Resting rows show their last turn** (see the table of marks). Read for every resting
  thread, however old: 8.8 ms for the first poll of 17 threads, then cached.
- **A held moment is replayed** (see the table of marks: "The stage at a held moment" and
  "Wires at a held moment"). The flock keeps two clocks for it: the moment the thread is
  shown at, and its own running time.
- **A fault found on the way.** REACH's row budget looped for ever when the groups left
  after folding fitted whole in a small room. Nothing reached it while REACH had either a
  large room or none; with its room guaranteed it froze the demo at once and could have
  frozen the pane. It stops at the largest group now.

Seen in the real pane through herdr (synthetic input, the terminal holding every page): a
drag on the terrain held a moment ("scrubbing the terrain: 09:58:34", 33 of 33 pages held, no
error) and escape let it go; the pane's own frame of that moment shows the dimmed core, the
grey flock, the THEN tag and the turn readout of then. Seen only in this program's own
frames: the layout at 139 columns with the new scale (the pane was back at 91 columns by the
time it was restarted on it for good; it ran at 139 with the new scale from 09:02 to 09:16),
the last turn on resting rows and its card, the flock gathering again on release. Not seen
by anyone yet: any of this with a real hand.

The last look at the whole screen (10:20, 91 columns, eight of eleven threads working; and
the 139 column frame of 09:03): the weakest part left is the footer in a wide pane. At 139
columns comms, the sector map and the log each have their right third empty: the lines fit
at 91 columns already and the extra width brings them nothing. It was left: what belongs
there is a decision (a wider sector map with pane titles, or the log's lines in full), not a
gap to fill with decoration. The second weakest is the replay's edge: a moment before the
focused thread's kept history shows an empty globe and "resting" rather than saying that
nothing is kept for it.

Not done: the live text, the charts' own lines, REACH and the subagent moons at a held
moment (they stay at now, with the moment marked); a dot of the flock of then answers with
the card of now's flock; REACH in landscape (the left column does not exist there); the
stage's empty space above the terrain in landscape; the footer's use of a wide pane.

Not verified: a 206 column pane in the real terminal, a quiet machine, the footprint right
after a real resize with the new code (measured on the stand-in terminal only), and how the
event-driven marks look in the pane (that they are placed there is counted, see above).

Measured in the real pane with all of the above. At 139 columns by 82 rows (09:02 to 09:16,
four threads working, the new scale): 30 frames a second, 350 to 820 kB/s, 5.3 to 9.9% of a
core with single reports to 13.9%; the class for 91 columns times the pane's area is 313 to
1025 kB/s. At 91 columns by 82 rows (10:15 to 10:21, eight to nine of eleven threads
working, twice as many as the class was measured with): 595 to 930 kB/s and 9 to 13% of a
core, single reports to 19% and 1.9 MB/s. The rows are what it costs there: each working row
is painted again one to three times a second for its timer and its live line.

Measured at 105 columns by 82 rows, three to four threads working, with the charts and the
perspective terrain in: 30 frames a second; 250 to 370 kB/s and 4 to 8% of a core while the
focused thread runs tools, 450 to 650 kB/s and 5 to 11% while its whole flock flies; for a
second or two after the focus moves to another thread, up to 1.6 MB/s and 18% (the core and the
tail are drawn afresh); 300 to 340 MB physical footprint then, 171 to 176 MB since the fifth
session (see "Memory"; resident size is not the measure: it read 354 MB while the footprint
was 209); 16 to 18 MB of the terminal's 67 MB store.
`stats.json` says what costs it:
`repaintsPerSecond` by region of the still layer and `movedPerFrameBy` by kind of mark. Painted
fallback: 1.5 to 4.7 MB/s and about one core.
