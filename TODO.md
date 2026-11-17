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

- 2026-11-17 01:30, ninth session (directed from the AAV session), four tasks. Done, each a
  signed commit on local `master`:
  - `03af1c6`, `dc27d80`: **the startup entry.** herdr 0.9.5 runs a plugin's `[[startup]]`
    command when its server has started; ours brings Agent Nexus back in the place of its
    pane when it ran as the server stopped (README, "After a herdr server restart"). Proven
    by running the entry by hand, with herdr's own variables, against panes staged as a
    stopping server leaves them. **Not seen yet: a real server restart.** The first one is
    the test: afterwards `herdr plugin log list --plugin khalilgharbaoui.agent-nexus` shows
    what the entry did.
  - `0f2ac6b`: **`restart.sh` names no pane.** It finds the dev pane or makes one.
  - `bee73b7`: **landscape.** REACH and THIS TURN have their column, the charts stack in a
    narrow head, the terrain is taller, the focused thread's wire has a route, and
    `check.mjs` (32 checks now) passes at 91, 139, 183 columns and in landscape. Also a fault
    in the thread list's window (`v5/README.md`, ninth session).
- **NOT PUSHED.** This session's permission rules refuse `git push`. The directing session
  has to run `git push origin master`, then
  `herdr plugin update khalilgharbaoui.agent-nexus --yes`, then the plugin's stop and open
  actions, for the installed pane to run the new build.
- Still open from the four tasks: **the measured minute with eight or more threads working**
  (bytes a second, per cent of a core, memory, at 183 columns; the class to beat is 350 to
  820 kB/s and 5.3 to 9.9% of a core).
- Left from the eighth session: the result of the thirteen-minute side-by-side watch for cost
  bursts; a look at the held moment in the installed pane through herdr (done in the dev pane
  in landscape, see `v5/README.md`).
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
