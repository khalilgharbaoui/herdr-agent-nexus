# Agent Nexus v4 brief

v4 is v3 "on steroids": the same living-circuit idea, pushed much further in look, feel, detail and UX, and made fully interactive with the mouse and the keyboard. `BRIEF-v3.md` and `BRIEF-v2.md` still hold (data sources, measured terminal and herdr facts, hard requirements, process rules) unless this file says otherwise.

## The operator's words on v3 (verbatim)

> "nice work i like this
> i need you to expand the impressiveness and awsomeness of this last version even more its good now but it needs to be even more awesome and breath taking also the UX needs to be awesome
> and look and feel needs a awesome upgrade
> and keep an eye on details and accuracy and data flows and hiarchies, and clever indications and make it be alive and awesome a touch of metal gear solid feel
>
> the second thing i need to to actually interact with mouse clicks and hovers and shortkeys
> its this but on steroids and lets call it v4"

## Keep v1, v2 and v3 untouched

- v1 `v1/`, v2 repo root, v3 `v3/` (all must keep running exactly as they do). Tag v3's last commit `v3` before you start (`c72ffa1` unless you find a later v3 commit).
- Build v4 in `v4/`. Start from a copy of v3 if that serves you; do not edit v3's files.

## What "on steroids" means here

1. **Look and feel upgrade.** Richer, more deliberate visual language: typography, materials, depth, light, colour discipline, motion choreography (easing, anticipation, follow-through), transitions between states and between focus targets. Breathtaking, but still accurate and never cheesy.
2. **Details and accuracy.** Every mark encodes real data and is labelled or inspectable. Show units, rates and times precisely where it matters. If data is missing, say so honestly on screen rather than inventing it.
3. **Data flows and hierarchies.** Make the structure legible at a glance: account, then project or workspace, then main thread, then its subagents (and their subagents), plus the herdr workspace, tab and pane each lives in. Make the flows between them visible: dispatch, report back, tool calls out and results in, tokens streaming, cost accruing against an account's window.
4. **Clever indications.** Anticipate what the operator needs to notice: a thread waiting on them, a stall, a failing tool streak, a context window about to fill, an account about to run dry, a long turn past its usual length, a subagent that finished and is waiting to be read. Each should be noticeable from across the room and precise up close.
5. **A touch of Metal Gear Solid feel.** Take the *genre* of tactical-espionage HUDs as a seasoning, not a theme: the calm tactical-radar view, crisp mission typography, an alert phase that escalates and then cools down through caution, a "codec"-style call panel when a thread needs the operator, an equipment-box feel for tools. Keep it original and tasteful: no franchise names, logos, characters, fonts, sounds or recreated screens. A developer and sci-fi fan should smile at it; nobody should cringe.
6. **Alive.** Idle should still feel present and calm (breathing, not busy); activity should feel immediate. Motion stays tied to real events, as in v3.

## Interaction: mouse clicks, hovers and shortcut keys

This is the second explicit ask and it must actually work.

- **Probe first.** Find out exactly what herdr 0.9.5 forwards to a pane app: mouse reporting modes 1000, 1002, 1003 (any-event, needed for hover) and 1006 (SGR), and SGR-Pixels 1016 for sub-cell precision. Read herdr's source or binary (you did this for graphics in v3) and its config keys (`mouse_capture`, `right_click_passthrough_modifier` and similar). Report what you found.
- **Hover:** an inspection card or highlight for whatever is under the pointer (thread, subagent, tool call, account, pulse), with precise data.
- **Click:** focus a thread, expand or collapse a subtree, pin an inspection card, and other actions that make sense. A click may also jump to that session's herdr pane (`herdr pane focus` or the equivalent) as an explicit, user-initiated navigation. Never type into, send keys to, or otherwise act on another pane or session beyond focusing it.
- **Shortcut keys:** a complete, discoverable keymap, with a `?` overlay that lists it. Keep v3's keys working where they still make sense.
- **Verifiable without seeing the screen:** the operator will test by hand, so add a small input monitor you can toggle (it shows the last mouse or key event received and where it landed), and test the app's own handling by sending synthetic SGR mouse sequences to the pane's input (`herdr pane send-text` with the escape sequence) and checking the result in a snapshot. Say clearly which parts were tested through real herdr forwarding and which only synthetically.

## Performance

Stay in v3's class: 30 fps where there is motion, low CPU when quiet (v3 was 4 to 12% of a core live), sprites for anything that moves, tiles only for what changed, graceful under load. Measure and report like v3 did (fps, CPU, bytes per second, step timings, live and under stress, with hover and click activity included).

## Process

- Same rules as `BRIEF-v3.md`: look at your own rendered frames, commit checkpoints (signed through 1Password; never bypass signing), never push, work only inside this repo, read data sources read-only, never print secrets, no em dashes anywhere.
- The right-hand herdr pane `wE:pQ1` runs v3 now. When v4 is ready, quit v3 with `q` and leave v4 running there.
- This runs on the "default" account at high effort and the "appical" account is out of usage until 23:30. Stay focused on the deliverable. If default runs low, commit, and stop at a clean state with a short report rather than mid-change.

## Report back

What changed from v3 and why, how each of the operator's asks is answered (point by point, including the MGS touch), the interaction model (keymap, hover, click) and what was tested really versus synthetically, measurements, what is not verified, how to run v1 to v4, and the commits. Keep it tight.
