# Agent Nexus v4: what herdr forwards to a pane app

v3's research (`../v3/RESEARCH.md`) still holds for the picture and the transport. v4 adds the
mouse, so the one open question was what herdr 0.9.5 gives a program running inside a pane. It
was answered twice: by reading herdr's source at tag v0.9.5, and by the operator's own hand on
the live pane.

## Read in the source (herdr v0.9.5)

Files read: `src/client/shell/mouse.rs`, `src/pane/input.rs`, `src/server/pane_input.rs`,
`src/input/mouse.rs`, the vendored `libghostty-vt/src/input/mouse_encode.zig`, and the config
reference.

**Routing (the herdr client decides who gets an event).** herdr captures the host terminal's
mouse for its own interface (`ui.mouse_capture`, default `true`: sidebar, tabs, splits, text
selection). An event inside a pane goes to the pane's program only when that program turned
mouse reporting on. Then:

| Event | What herdr does |
| --- | --- |
| Left press | Forwarded. Drag and release follow to the same pane. herdr also focuses the pane. |
| Middle press | Forwarded, with drag and release. The pane focus does not change. |
| Motion, no button | Forwarded. The program receives it only in any-event mode (1003). |
| Wheel | Forwarded as a mouse report. herdr focuses the pane first when it was not focused. |
| Right press | Kept by herdr for its context menus. It reaches the program only with `ui.right_click_passthrough_modifier` set and held (the modifier is stripped), or when the pane declared right-click passthrough. The default is empty, so by default it never arrives. |
| Ctrl + left press | Taken by herdr to activate a link under the pointer; the click is only a fallback. Not reliable for an app. |
| Shift + anything | Stays with the host terminal (Ghostty's own selection). herdr's config refuses shift as a passthrough modifier for that reason. |

**Encoding (the pane's own terminal state decides the bytes).** herdr encodes each forwarded
event with libghostty's mouse encoder, set from the pane's VT, so a program gets exactly the
protocol it asked for:

- Event modes: 9 (X10: presses only), 1000 (press and release, no motion), 1002 (motion only
  while a button is down), 1003 (all motion, which is what hover needs).
- Formats: X10 bytes, 1005 (UTF-8), 1006 (SGR), 1015 (urxvt), 1016 (SGR with pixels).
- Motion is reported once per cell, except with 1016, where every pixel step is reported.
- Button code: left 0, middle 1, right 2, no button 3, wheel 64 and 65 (66 and 67 sideways);
  shift adds 4, alt 8, ctrl 16, motion 32. Release is the final `m` in SGR.

**Pixels (1016).** When the program enabled 1016 it always gets pixel numbers, but they are
exact only if the host terminal reports pixels to herdr, herdr knows the host's cell size, and
the pane's size agrees on both sides. Otherwise herdr falls back to the cell and reports that
cell's centre pixel. Positions are 1-based: the pane's first pixel is `1;1`.

**Config keys that matter:** `ui.mouse_capture` (default `true`),
`ui.right_click_passthrough_modifier` (default empty), `ui.mouse_scroll_lines` (default 3,
herdr's own scrollback only), `ui.copy_on_select`.

Not read: how the server derives a pane's "reports the mouse" flag (that file was not fetched).
The behaviour below says it follows the pane's mouse modes.

## Measured in the live pane (wE:pQ1, herdr 0.9.5 inside Ghostty, 2026-11-14)

- After `CSI ?1003h ?1006h ?1016h` the pane answers the mode queries (`CSI ?n$p`) with
  1003 set, 1006 set, 1016 set, 1000 and 1002 reset. v4 shows these in the input monitor.
- The operator moved the pointer over the pane and clicked, by hand. v4 received 600 motion
  reports in a few seconds with no button held (so any-event forwarding works), at positions
  such as x 1692, y 1166, which is 12 px into column 112 and 26 px into row 38 and so not a
  cell centre (so the pixels are real, not the fallback), and one left press that pinned the
  SHELL equipment card. `v4/input.json` keeps the last events.
- Typed keys reach the program as usual once the pane has the focus, which a left click gives it.

## What v4 does with that

- Turns on 1003, 1006 and 1016, asks which were taken, and uses pixels when 1016 is confirmed
  and cells otherwise (a cell report is taken as the middle of the cell).
- Uses the left button for everything primary, the middle button or alt + click for "go to the
  pane", and the wheel for scrolling. It never needs the right button, ctrl + click or shift,
  because herdr or Ghostty keep those.
- Every pointer action has a key that does the same, so nothing depends on the mouse.

## The terminal's image store (measured 2026-11-15, herdr 0.9.5 in Ghostty)

Measured from inside the pane with `tools/gfx-probe.mjs`, which uploads images with replies on
and reads what the terminal says.

- herdr answers graphics commands itself (each pane is a Ghostty terminal core inside herdr), so
  a reply tells what herdr holds for the pane. That is what herdr draws from.
- An upload is answered `OK` at 4, 15.5 and 41 MB of pixels, as one zlib stream and as a stream
  of sync-flushed strips alike. Size and encoding are not refused.
- The store holds 64 MiB of pixels per pane: with 2 MB images that are all placed, the 34th
  evicts the first (66 MB held, 68 MB not).
- Eviction is silent with `q=2`. Unplaced images go first (110 unplaced 2 MB images never cost a
  placed one its place), then the oldest placed image.
- A placement of an image that is gone answers `ENOENT: image not found`; a placement of one
  that is there answers `OK`. That is the heartbeat v5 uses.
- herdr's own protocol to its client has further limits that were not reached ("graphics asset
  payload too large", "too many graphics placements", "too many retained graphics assets" are in
  its binary). What Ghostty itself shows cannot be asked from inside a pane.

What v5 does with that: tiles are 4 bytes per pixel of the pane wherever something is drawn
(15.5 MB at 105 columns by 82 rows, 30.4 MB at 206), so the sprite atlas is small pages under a
10 MB budget, uploaded after the tiles and right before their first placement, acknowledged, and
checked every two seconds.
