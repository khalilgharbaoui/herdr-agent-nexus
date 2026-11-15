# Agent Nexus v5 brief

v5 is v4 made fully alive and fully purposeful. It adds to v4; it does not replace it. `BRIEF-v4.md`, `BRIEF-v3.md` and `BRIEF-v2.md` still hold (data sources, measured terminal and herdr facts, hard requirements, interaction rules, process rules) unless this file says otherwise. `v4/README.md` and `v4/RESEARCH.md` describe what exists.

## The operator's words on v4 (verbatim)

> "everything on screen has pourpus and goal and use and can be interacted with even smallst things
> everything is alive
> the think on the left top round also very alive even the small dots like those robot flocks in matrix or flocks of birs movements but digital dots.. what we have now but really alive and moving organic and inorganic both and also some chartlines that are alive
> make it awesome but dont kill it these things i mentioned add them
> everymovement means something every thing has a function"

## Keep v1 to v4 untouched

- Tag v4 first: `git tag v4 75e1d2d` (the last commit that changed `v4/`; use a later one if you find it).
- Build v5 in `v5/`, starting from a copy of `v4/`. Do not edit v4's files. v4 keeps running in the pane until v5 is ready.

## What the operator asks, read closely

### 1. "dont kill it ... these things i mentioned add them"

This is additive. Everything v4 does stays: the layout, the hierarchy, the flags, the phase strip, comms, equipment, the sector map, the keymap, hover and click. Do not redesign what works. New motion must not bury the data or make a calm screen noisy.

### 2. Everything has a purpose, a use, and can be interacted with, even the smallest things

- Every mark that is drawn is data or a control. Nothing is decoration. If a mark cannot say what it stands for, give it a meaning or remove it.
- Every mark is a target. Hover says what it is, its exact value with its unit, and when. Click does the most useful thing for it (focus, pin, fold, filter, go). That includes a single dot, a point on a chart line, a lamp, a tick, a label, a pulse in flight, a segment of a rail.
- The keyboard reaches them too: a way to walk every inspectable thing in a region, not only the threads.
- An explain mode on one key that labels, in place, what each kind of mark means, so the screen can be learned from the screen.
- Deliver the contract: a table in `v5/README.md` with one row per kind of mark: the data it encodes, what its motion means, what hover shows, what click does. The screen must match the table.

### 3. Everything is alive, and every movement means something

- Nothing stays frozen, and every motion is driven by something real: an event (a token batch, a tool call, a result, a dispatch, a report back, a flag raised or cleared) or a real quantity (rate, age, fill, pace, latency).
- No motion for its own sake, and no loops that play whatever happens. Where noise gives organic life, its parameters come from data (speed from tokens per second, spread from idle time, jitter from the failure rate), and the mapping is in the table.
- Idle is calm and still present: a thread that does nothing shows that it is there and what it waits on, with slow motion. Activity is immediate.

### 4. The round element at the top left, and its small dots, as a living flock

- This is the focus stage's clock with its bloom of token dots. Confirm in a snapshot of the live pane which element sits at the top left; if it is another one, apply this to that one and say so.
- The dots become a flock: a digital murmuration, like a swarm of machines or a flock of birds, but made of dots. Keep what a dot is (one dot per so many tokens of the turn's output, the unit printed) and make the flock behave.
  - Organic: flocking rules (separation, alignment, cohesion), the flock turning and breathing as one body.
  - Inorganic: lattice snaps, orbit lanes, formation changes, mechanical stepping. A flock that can lock into a formation and release again.
  - Meaning. Design the final mapping yourself and write it into the table. Examples of the kind of thing wanted:
    - new output joins the flock as new dots, at the rate the tokens stream;
    - reasoning, reply and tool input are distinct groups or colours;
    - a tool call sends a squad out along its spoke, and it comes back with the result;
    - a subagent dispatch splits a group off toward that subagent, and the report back merges it;
    - a stall slows the flock until it settles into a lattice;
    - a failure scatters it;
    - the end of a turn makes it form up and come to rest;
    - context fill sets how tightly it packs against the rim.
  - The turn's time against its usual length stays readable on the clock.
  - Each dot stays inspectable (which part of the output, when, how many tokens), and so does the flock as a whole.
- The clock, its bars and its spokes get the same treatment: alive, readable, inspectable.

### 5. Chart lines that are alive

- Add streaming line charts where a history says more than a number: tokens per second for a thread and in total, cost against an account's window with its pace line, context fill over the turn, tool latency, calls per minute. Choose where they earn their place: small ones in rows, and at least one larger one for the focused thread.
- Alive: the head draws as data arrives, the line scrolls with real time, and events mark the line (a tool call, a flag, a dispatch). Real data only, with units and a reference line or axis where it helps, and "n/a" where there is none.
- Interactive: hover a point for its value and time, click to pin it, and a key or click to change the time window (for example 1, 5 and 30 minutes).

### 6. Awesome

As `BRIEF-v4.md` means it: breathtaking and accurate, never cheesy. The tactical feel stays a seasoning.

## Performance

Stay in v4's class: 30 fps where there is motion, 5 to 7% of a core live with three to four threads working, low when quiet. A flock is many sprites, so budget it: cap the count, group dots beyond the cap and say so on screen, simulate cheaply, redraw only what moved. Measure and report as v4 did, and add: the flock at its densest, hover over the flock, and a quiet machine (v4 never measured that).

## Verification

- Extend `tools/poke.mjs` and `--poke` to every new interaction. Look at your own rendered frames, and at a sequence of frames to judge motion, not one frame.
- Say which parts were tested through real herdr forwarding and which only synthetically. The operator tests by hand.

## Process

- Same rules as before: signed commits through 1Password (never bypass signing), never push, work only inside this repo, read data sources read-only, never print secrets, no em dashes anywhere.
- Commit early and often. The Mac once slept in the middle of a turn and cut a session off. Commit as soon as v5 draws a frame, keep single tool calls small, and if a tool call fails with "timed out ... waiting for opencode to resolve the call", stop and report what is on disk.
- The right-hand herdr pane `wE:pQ1` runs v4 now. When v5 is ready, quit v4 with `q` and leave v5 running there. If v5 is not clearly better than v4 in the pane by your own judgement, leave v4 running and say why.
- `TODO.md` lists open items from v4. They are not part of this brief. Leave them unless one blocks you (the demo data has no project directories, which matters if you use the demo to show the hierarchy or the flock).

## Report back

What was added and why, how each sentence of the operator's is answered, the table of marks (or a pointer to it), what each motion means, the interaction additions, what was tested really versus synthetically, measurements, what is not verified, how to run v1 to v5, and the commits. Keep it tight.

## Addendum: the operator's second message, same evening (verbatim)

> "no do it and a thouch of 3D
> bring it to life"

### 7. A touch of 3D

- Give the screen real depth where it adds meaning and wonder. The flock moves in three dimensions: a dot's size, brightness and overlap follow its depth, and the swarm turns in space, not on a plane. The round element becomes a body with volume (a sphere, a tilted ring system, an orbit seen in perspective) rather than a flat dial. Layers shift against each other (parallax) when the focus changes or the pointer moves. Light and shadow agree across the screen.
- A touch, not an engine. Project points and simple shapes yourself, cheaply. The circuit, the rails and all text stay flat and sharp; nothing that has to be read may tilt out of legibility.
- Depth means something, like every other motion. For example: nearer is newer and output recedes as it ages; or depth separates reasoning, reply and tool input; or the view turns toward the thread that needs the operator. Put the mapping in the table of marks.
- Interaction survives it: a dot at depth is still a hover and click target (hit-test in screen space, nearest first).
- Hold the performance class, and measure the 3D flock at its densest.

"bring it to life" is the measure for all of v5: when the operator looks at the pane, it should feel like a living thing that is also an exact instrument.

## Second addendum: the operator after looking at v4 again (verbatim)

> "looked at it its nice but i expect way more from v5"

### What this changes

v5 must not land as "v4 plus a flock and a few sparklines". The operator expects a leap that is obvious within one second of looking at the pane. Everything above still holds (additive, every mark has a function, every motion means something, accuracy first, calm when idle, the performance class). What rises is the ambition. Looking at a v4 frame, this is where the leap is:

1. **The living core is the centrepiece.** In v4 the round element is a small dial, about a fifth of the stage's width. In v5 it is what the eye lands on: larger, with volume, turning in space, made of as many dots as the data supports (group them beyond the sprite budget and say so). Tools are satellites on orbit lanes that leave and return with their results. Subagents are moons with their own smaller flocks. A change of focus is an event worth watching: the old thread's flock disperses and the new one forms.
2. **No dead space.** v4 leaves large dark areas (between the stage and the circuit, the right half of the circuit rows, the lower circuit). Fill them with living data, never decoration. One strong candidate: a ridgeline terrain, one ridge per thread receding in depth, height is tokens per second over the last minutes, time flowing toward the viewer, events marked on the ridges. That is the live chart lines and the touch of 3D in one piece.
3. **Wires carry visible volume.** Streams of particles whose density is the token rate and whose weight is the traffic of the last minutes. A tool call is a packet with a shape per tool; a result comes back coloured by success and latency; a subagent's report merges into its parent as a stream you can follow.
4. **Accounts are reservoirs.** A level that visibly drains at the real burn rate, a pace marker, the projected dry time on a small time axis. Readable from across the room.
5. **Equipment and the sector map are alive.** Each tool box has a small live latency line, its calls in flight as orbiting pips, a flash on failure. Panes in the sector map rise, glow or call out with their real state.
6. **Show signals nobody shows.** The prompt cache cooling since the last call, the wait for the first token as a charge, context fill closing a ring, a turn's age against its usual length, the usage window as pressure.
7. **Choreography that explains change.** A phase change ripples outward from the thread that caused it. A focus change is a camera move. A dispatch, a report back, a failure and the end of a turn each have a signature the operator learns to read without the text.
8. **Depth and light everywhere, lightly.** One light source, glow on what is active, haze on what is old, parallax under the pointer.
9. **Interaction beyond inspection.** If the budget allows: drag along a chart to scrub the last minutes and watch the core and the wires replay them.

### Order, when time or usage is short

1. The 3D living core as the centrepiece.
2. The time terrain or an equally strong living chart in the empty space.
3. Wires with volume and the account reservoirs.
4. Smallest-things interaction, the explain mode and the table of marks.
5. Equipment and sector map.
6. The rest.

Put v5 in the pane as soon as its core is alive (v4 is no longer running there), commit that checkpoint, and keep improving it live so the operator can watch it grow.

## Continuation (director, 2026-11-14 23:25, after looking at a live v5 frame)

v5 runs live in herdr pane `wE:p1Q1` at `60a856e`. The first v5 session stopped because its account ran low, not because v5 was done. Built so far: the flock in the core with moons, the time terrain, wire streams, account reservoirs, cards for dots and ridge points, the keyboard walk, explain mode, and the table of marks in `v5/README.md`.

Seen in the frame (`v5/shots/latest.png`, 23:22), measured against "i expect way more from v5":

- The core is larger, but it still reads as a flat dial with a small clump of dots in a mostly empty disc. The 3D does not show in a still frame.
- The time terrain is good and small. Its depth is faint.
- The dead space is still there: under the core down to the circuit, the band between the stage and the circuit, and the right half of most circuit rows.
- The circuit, the equipment column, comms, the sector map and the log look like v4. The reservoirs are two thin bars that are easy to miss, and the wire streams do not show.

So the leap has not happened yet. Next session, in this order:

1. **Performance back into v4's class first, briefly.** Samples from the first session: 7.4 to 8.7% of a core with the flock flying, then 14.2% and 950 kB/s, 23.9% in explain mode with a card open, once 29% and 1.3 MB/s. Memory 488 MB at start against v4's 164 to 173 MB, 692 MB under heavy repaint. Find what is resent every frame and what allocates, fix it, and measure a quiet machine, the flock at its densest, hover over the flock and explain mode. Do not spend more than a small part of the session here.
2. **Make the core unmistakably three-dimensional and full.** The flock fills the volume of the disc instead of clumping at one side. Dots are larger near, smaller far, with short trails so motion and depth read even in a single frame. The ring becomes a body in space (a tilted ring system or a sphere), not a dial with ticks. Tools are satellites on orbit lanes around it, leaving and returning with their results. The old flock disperses and the new one gathers on a change of focus.
3. **Give the living charts the dead space.** Make the terrain large (the full band between the stage and the circuit is free) with real perspective: ridges receding, haze on the far ones, a glowing head at "now". Mark estimated heights as estimates on the chart itself, not only in the card. Add the cost, context and latency lines from the brief where the rest of the dead space is.
4. **Make the circuit visibly flow.** Streams on the wires must be seen at a glance: larger motes, glow, density as the token rate. Reservoirs become wide tubes with a moving surface, a pace mark and a dry mark that can be read from across the room.
5. **Equipment, sector map, comms and log come alive** as the second addendum describes (latency lines, calls in flight, a flash on failure, panes that rise and glow).
6. **Choreography and hidden signals:** phase ripples from the thread that caused them, the cache cooling, context closing a ring, scrubbing if the budget allows.
7. **Smallest things:** header lamps, footer labels and every remaining v4 mark become targets with cards. Fix explain-mode tags that overlap each other and the title.
8. **Tests:** poke for each new interaction, and the ones never tested: hovering a ridge and a single flying dot, `enter` while walking, moon clicks.

Keep v5 running in `wE:p1Q1` and restart it in place after each change so the operator sees it grow. Commit after every step that works, and keep the end of `v5/README.md` current with what is done and what is next.

## Third addendum: the operator's feedback on live v5 (verbatim, 2026-11-14 about 23:45)

> "if hovered on something a line is connected to it
> if pinned also line connected to it and the hover thing moves with it as if attached to it no matter how small it is
>
> also the alignments  below ..of the thread name number (like 01) and the round thingy that represents the main thred should be alingined better
>
> the accounts part is perfect actually i like it
>
> alo the things rising up should collect at the tip when at cirtain energy level they should the shoot into the orb which seems to happen now but the collecting at the tip is not clear
>
> v5 is nice just wanted to give this feedback still
> designer is still working lets see what it does"

### What this asks

1. **Leader lines.** Every hover card is tied to its mark by a visible line from the mark to the card. A pinned card has the same line. The card and its line follow the mark as it moves (a flying dot, a mote, a moon), frame by frame, however small the mark is. The line ends exactly on the mark, with a small ring on tiny marks so it is clear which one is meant.
2. **Alignment in the circuit.** The thread number (01, 02, ...), the thread name and the round node that stands for a main thread should sit on one clear grid. Check every kind of row: main thread, subagent, resting, silent.
3. **The accounts part is perfect. Leave it exactly as the operator saw it** (the state of `60a856e`). This overrides the Continuation section's "reservoirs become wide tubes". If it has been changed since, put it back.
4. **Collecting at the tip.** What rises toward the orb must visibly gather at the tip before it goes in: a charge that grows with what has arrived, and at a set energy level it shoots into the orb. The shot seems to happen already; the gathering is what does not read. Make it unmistakable, and put the unit and the threshold in the table of marks.
5. The operator likes v5 and is watching the pane. Carry on with the order of work.

## Fourth addendum: more feedback on live v5 (verbatim, 2026-11-15 about 00:15)

> "it seems the dots became a bit 3d balls which i dont like what i ment with a thouch of 3d is that their behavior has that 3d-ness flocking organically and inorganically
>
> also the collectiong at the tip is ok but it lacks that energy feel as if something is building up
>
> as for the orb the look and feel of it getting better i see"

### What this asks

1. **The dots are flat digital dots, not balls.** No shading, no highlights, no sphere look. The touch of 3D lives in how they behave: the flock turning and banking in space, depth read from motion, overlap and parallax, organic murmuration and inorganic formations. This corrects the Continuation section where it asks for dots that look larger and rounder with depth: keep them crisp and flat, as they were before they became balls.
2. **The charge at the tip must feel like energy building up.** The gathering is right; the feeling is missing. As the charge grows, let it show: the gathered motes circle tighter and faster, the glow and corona grow, the tip trembles, the pulse quickens, and at the threshold it releases with a flash and a short afterglow. Every part of that is driven by the real charge (what has arrived against the threshold) and by the real arrival rate.
3. **The orb's look and feel is going the right way.** Keep going in that direction.

## Fifth addendum: the sprite layer is gone in the live pane (verbatim, 2026-11-15 about 00:25)

> "something is off i dont see any kind of dots anymore anywhere or moving particles on lines etc"

### What the director measured (read-only, nothing in `v5/` was touched)

- The app does not know. Its own snapshot (`v5/shots/latest.png`, 00:22) shows the flock, and `stats.json` reports 177 to 359 sprites placed per frame on the `sprites` transport with `droppedSprites: 0`. A snapshot is the app's own composite, so it cannot show what the terminal lost.
- So the loss is between the app and the terminal: the atlas image (id 7200) is not there, and every placement of it draws nothing. That is every sprite at once: flock dots, motes on wires, satellites, moons.
- `f8d0c88` tripled the atlas: 1406 x 2761 px (15.5 MB of pixels) at `5df411e`, 1406 x 7300 px (41.1 MB) at `f8d0c88` and in the working tree, at 15 x 30 cells. The same commit changed the upload to strips joined into one zlib stream.
- The strip stream is valid: rebuilt outside the app exactly as `encoder.mjs` does it, `zlib.inflateSync` accepts it, the Adler sum checks and the bytes are equal. So the stream is not the fault by itself. The likely cause is herdr 0.9.5 or Ghostty dropping or evicting an image this large (their image store is shared with up to 30 MB of tiles, twice over during a flip), and `q=2` hides the refusal.
- Also seen: RSS 1.1 to 1.6 GB, 40 to 62% of a core and 2.4 MB/s at 206 columns. The brief's own limits were 164 to 173 MB and v4's class of CPU.

### What this asks, before anything else

1. **Get the sprites back on screen first.** Prove the cause instead of guessing: upload the atlas once with `q=1` (errors only) and read the reply, or bisect by size. Then make the atlas small: it holds every shape in all 19 colours with a cell of padding on each side, and 48 streak shapes on top. Only the colours a shape is ever drawn in, tighter packing, fewer streak directions or streaks drawn another way, or several small atlases, each well under what worked before (15 MB).
2. **Never be blind to this again.** After every atlas upload, verify the terminal has it (a `q=1` upload, or a query placement) and put the answer in `stats.json`. When the terminal refuses, fall back to the painted transport by itself and say so in the header line.
3. **Do not trust a snapshot for what the pane shows.** The operator's eyes are the only check of the real pane today; say in the report which claims were seen in the pane and which only in a snapshot.
4. Memory and CPU back into the brief's class is part of the same fix: a 41 MB canvas rebuilt on every resize, plus its copies, is where much of it goes.
5. Then carry on with the fourth addendum (flat dots, the charge that builds).

## Sixth addendum: an orbit phase before the globe (verbatim, 2026-11-15 about 01:05)

> "maybe the should also have a fase where they orbit the "planetary" disk as a flock in organic movement the siphon off to the globe it self"

### What this asks

1. **A third phase in a dot's life, between the shot and the globe.** Today a dot rises, gathers at the tip, is fired and lands in the globe. Add a stage in between: after the release the dots join a flock that circles the planetary disk (the tilted ring system), moving organically, a murmuration that follows the ring's plane and banks with it, passing behind and in front of the globe.
2. **Then they siphon off into the globe.** From that orbiting flock, dots peel away in a thin stream, spiral inward and settle in the globe. The stream is a visible funnel or thread from the ring to the globe, not dots vanishing and reappearing.
3. **Drive it with real data, and say with which.** The operator did not say what the orbit stands for, so choose a true meaning and put it in the table of marks. A natural reading: the dots in orbit are this turn's output that has arrived but is not yet part of the conversation (the step in flight), and they siphon into the globe when the step completes, at a rate set by what completed. If another reading fits the data better, use it and say why.
4. **Flat dots still.** The fourth addendum holds: the 3D is in the motion (the orbit's tilt, overlap, parallax, the inward spiral), never in shaded balls.
5. This comes after the fifth addendum's fix (sprites back on screen) and belongs with the fourth addendum's work on the charge: tip, release, orbit, siphon, globe is one continuous path.

## Seventh addendum: the operator on the live pane (verbatim, 2026-11-15 about 02:27)

> "looking good carry on"

Said while looking at the pane after the paged atlas, the flat dots, the charge at the tip, the orbit and siphon, and the three live charts were in. Nothing was singled out. This is the first check of the real pane since the sprites vanished, so the sprite layer counts as seen by the operator again. No change of direction: carry on with the order of work.
