# Agent Nexus: open items

Kept by the directing session so open questions survive a lost context. Remove an entry when it
is done or dropped.

## In progress

- 2026-11-16 10:30: v5 runs live in herdr pane `wE:p1QF` (sprite transport, the terminal holds
  every sprite page; restart it in place with `v5/tools/restart.sh`). The pane was 139 columns
  by 82 rows from early morning and is 91 by 82 again since about 09:58 (the operator moves
  the split himself; v5 follows without a restart). A seventh designer session (on `appical`,
  06:55 to 10:30) worked through the eleventh addendum's list. Done: a resize no longer
  leaves memory behind (one resize per settled size instead of one per column, buffers kept
  while the pane fits them, the allocator gives freed large blocks back:
  `v5/tools/resize-check.py` measures it on a stand-in terminal); the upright scale is set by
  the height too, so a wide pane has room and THIS TURN and REACH always show; resting rows
  say what their last turn was; a moment held on the terrain is replayed in the core, the
  flock and the wires, marked THEN; an endless loop in REACH's row budget is fixed. Commits
  are signed again (1Password answers); `da9ec45`, `fb3629f`, `f94e7d6` and the README commit
  after them. `v5/README.md` ends with what was seen where and the measurements.
- Left for a next session: the footer's use of a wide pane (comms, the sector map and the
  log each leave their right third empty at 139 columns); a held moment that lies before the
  focused thread's kept history should say so; the live text, the charts' lines, REACH and
  the moons at a held moment; REACH and the stage's empty space in landscape; a look at REACH,
  scrubbing and the replay with a real hand; the footprint right after a real resize.
- For the operator to judge, each a decision taken for him that he can overrule: the scale at
  139 columns is 0.88 now (it was 1.10: everything is a fifth smaller than he saw it there
  this morning, and REACH, THIS TURN and six of eight rows show where four rows did);
  `MallocLargeCache=0` costs about one point of a core for some 50 MB less and a clean resize
  (`MallocLargeCache=1 node v5/nexus.mjs` runs without it); the cache ramp still waits for
  his word.

## Open from the operator

The operator answered the director's questions on 2026-11-15 with "do the most recommended and
move forward with it". The decisions are in `BRIEF-v5.md`, eighth addendum. A third designer
session (`ses_e22bbcd86ffepxmgCR4m3131yw`, on `default`, started 04:35) worked from it until it
was cut off (comms and log are in); a fourth continues from the same list.

Still the operator's own:

1. Not verified with a real hand: go to pane (`herdr agent focus <pane>`, reached by `enter`, a
   click on a pane id, a middle click or alt + click), the real wheel and real typed keys. Real
   hover and one real left click were seen.
