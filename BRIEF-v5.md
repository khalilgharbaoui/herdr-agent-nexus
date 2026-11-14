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
