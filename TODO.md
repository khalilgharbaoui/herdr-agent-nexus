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

- 2026-11-17 01:10: **the startup entry** is in (`dc27d80`, with `03af1c6` for a pane that
  starts before a client is attached). herdr 0.9.5 runs a plugin's `[[startup]]` command when
  its server has started; ours brings Agent Nexus back in the place of its pane when it ran as
  the server stopped (README, "After a herdr server restart"). Proven by running the entry by
  hand, with herdr's own variables, against panes staged as a stopping server leaves them.
  **Not seen yet: a real server restart.** The first one is the test: afterwards
  `herdr plugin log list --plugin khalilgharbaoui.agent-nexus` shows what the entry did.
- Left from the eighth session: landscape (REACH and THIS TURN have no place there; two
  checks of `check.mjs` fail there on purpose until they do); a live minute with eight or
  more threads working, to turn the estimate of the cost class into a reading
  (`tools/cost-watch.mjs`); the result of the thirteen-minute side-by-side watch for cost
  bursts; a look at the held moment in the real pane through herdr (`tools/poke.mjs`: down,
  drag, up on the terrain).
- For the operator to judge, each a decision taken for him that he can overrule: during a
  hold the circuit's rows stay the present under a NOW chip (their wires carry the grey
  motes of then); in a working row the chips stand in one column, clear of the widest timer
  (a short timer leaves a gap); the rows that type share one typist's steps; the scale at
  139 columns, the allocator setting and the cache ramp still wait for his word.

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
