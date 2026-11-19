# Agent Nexus: open items

Kept by the directing session so open questions survive a lost context. Remove an entry when it
is done or dropped.

## Where it runs

No pane id is written down any more: herdr hands out new ones, and the server restart of
2026-11-16 22:01 left every id in this file stale.

- **The installed plugin** (`khalilgharbaoui.agent-nexus`, from GitHub) is the operator's live
  view, in a tab of its own. Where and how it runs:
  `herdr plugin action invoke khalilgharbaoui.agent-nexus.status`, then
  `herdr plugin log list --plugin khalilgharbaoui.agent-nexus --limit 1`. Its run files are in
  `~/.local/state/herdr/plugins/khalilgharbaoui.agent-nexus/run` (`pane` holds the pane id).
- **The dev copy** from this checkout: `v5/tools/restart.sh` finds its pane (the id in
  `v5/dev-pane`, else the label "Agent Nexus dev") or makes one (a split of the calling pane,
  or a tab with `--tab`), and restarts v5 there in place. It runs beside the installed one.
- A change reaches the installed copy with a push and
  `herdr plugin update khalilgharbaoui.agent-nexus --yes`, then the plugin's stop and open
  actions.

## In progress

- 2026-11-17, ninth session (directed from the AAV session, 00:40 to 01:30 on `appical`,
  09:20 to 10:15 on `default`), four tasks. Done, each a signed commit on local `master`:
  - `03af1c6`, `dc27d80`: **the startup entry.** herdr 0.9.5 runs a plugin's `[[startup]]`
    command when its server has started; ours brings Agent Nexus back in the place of its
    pane when it ran as the server stopped (README, "After a herdr server restart"). Proven
    by running the entry by hand, with herdr's own variables, against panes staged as a
    stopping server leaves them. **Seen on a real server restart, 2026-11-17 10:16:** the
    first log of that server's life, herdr's own startup run, says "brought back in pane
    wE:p1WQ (pid 51354, live), in the place of wE:p1WP".
  - `0f2ac6b`: **`restart.sh` names no pane.** It finds the dev pane or makes one.
  - `bee73b7`: **landscape.** REACH and THIS TURN have their column, the charts stack in a
    narrow head, the terrain is taller, the focused thread's wire has a route. Also a fault
    in the thread list's window (`v5/README.md`, ninth session).
  - **The measured minute** (`v5/README.md`, "What the picture costs"), at 183 columns by 82
    rows on a stand-in terminal, 2026-11-17 09:40 to 09:50:
    - the demo held at eight or more working (`--demo-working 8`: 11 to 13 of 28 working):
      **788 to 3418 kB/s (median 1432), 10.5 to 38.9% of a core (median 19.1%), 219 to 279
      MB.** Above the class (350 to 820 kB/s, 5.3 to 9.9%). It was 861 to 3946 kB/s and 27.3
      to 63.3% (median 42.3%) before this session's three changes;
    - live data, 7 of 12 working: **412 to 470 kB/s (median 432), 5.9 to 9.5% of a core
      (median 7.6%), 208 to 209 MB.** Inside the class. It was 9.1 to 14.9% (median 11.3%)
      the old way, side by side in the same minute. But only one of those seven was really
      writing; the other six carry a busy flag from turns cut off hours before.
    - **So: still open, a live minute with eight or more threads really writing.** The
      machine had none, and making them costs the usage window: the operator's call.
  - `tools/check.mjs`: 36 checks, all passing at 91, 139 and 183 columns by 82 rows and in
    landscape (163 by 59, 206 by 59, 120 by 40).
- Pushed by the directing session on 2026-11-19 (`57955cb..e5a5532`); the installed copy is
  at `e5a5532` and `herdr plugin update` says it is up to date. The ninth session's own
  report never reached the directing session (its last turn was cut off); this file and the
  commits are the record.
- Left from the eighth session: the result of the thirteen-minute side-by-side watch for cost
  bursts (the bursts' cause is found now: the read back, see above).
- For the operator to judge, each a decision taken for him that he can overrule: during a
  hold the circuit's rows stay the present under a NOW chip (their wires carry the grey
  motes of then); in a working row the chips stand in one column, clear of the widest timer
  (a short timer leaves a gap); the rows that type share one typist's steps; the scale at
  139 columns, the allocator setting and the cache ramp still wait for his word. New in
  landscape, his to overrule too: the stage in two columns as upright, the charts one above
  the other in a narrow head, the terrain half as tall again, the wire's route under the
  equipment.

## Open from the operator

The operator answered the director's questions on 2026-11-15 with "do the most recommended and
move forward with it". The decisions are in `BRIEF-v5.md`, eighth addendum.

Still the operator's own, with a real hand in the real pane:

1. REACH: hover a target and a bar, click to pin.
2. The terrain: drag to hold a moment, escape to let the card go and then the moment.
3. Go to pane (`herdr agent focus <pane>`, reached by `enter`, a click on a pane id, a middle
   click or alt + click).
4. The real wheel and real typed keys. Real hover and one real left click were seen.
5. The cache ramp (rose through orchid to cold blue): does it read right? The alternative is
   a pale warm white to ice blue.
