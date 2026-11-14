// Input: turns the bytes the terminal sends into key and mouse events.
//
// Mouse reports arrive in SGR form, ESC [ < b ; x ; y M (press, motion) or m (release). With
// mode 1016 on, x and y are pixels inside the pane (herdr counts them from 1, Ghostty on its own
// from 0: `origin` says which); without it they are 1-based cells and are mapped to the middle
// of the cell. Everything else that starts with ESC and is not a
// key (answers to queries, graphics acknowledgements) is swallowed.

const KEYS = {
  "\x1b[A": "up",
  "\x1b[B": "down",
  "\x1b[C": "right",
  "\x1b[D": "left",
  "\x1bOA": "up",
  "\x1bOB": "down",
  "\x1bOC": "right",
  "\x1bOD": "left",
  "\x1b[H": "home",
  "\x1b[F": "end",
  "\x1b[1~": "home",
  "\x1b[4~": "end",
  "\x1b[5~": "pageup",
  "\x1b[6~": "pagedown",
  "\x1b[Z": "backtab",
  "\r": "enter",
  "\n": "enter",
  "\t": "tab",
  "\x7f": "backspace",
  "\x03": "ctrl-c",
  " ": "space",
}

const MOUSE = /^\x1b\[<(\d+);(-?\d+);(-?\d+)([Mm])/
const CSI = /^\x1b\[[\d;?$<>=]*[ -/]*[@-~]/
const STRING = /^\x1b[_P\]^][^\x1b\x07]*(?:\x1b\\|\x07)/

export class Input {
  constructor() {
    this.pixels = false // set once the terminal confirmed mode 1016
    this.origin = 0 // what the terminal calls the first pixel: 1 inside herdr
    this.cell = { width: 15, height: 30 }
    this.listeners = []
    this.pending = ""
  }

  on(listener) {
    this.listeners.push(listener)
  }

  emit(event) {
    for (const listener of this.listeners) listener(event)
  }

  feed(text) {
    let rest = this.pending + text
    this.pending = ""
    while (rest.length) {
      if (rest[0] !== "\x1b") {
        const key = KEYS[rest[0]] ?? rest[0]
        this.emit({ type: "key", key, raw: rest[0] })
        rest = rest.slice(1)
        continue
      }
      const mouse = MOUSE.exec(rest)
      if (mouse) {
        this.emit(this.mouse(Number(mouse[1]), Number(mouse[2]), Number(mouse[3]), mouse[4] === "m", mouse[0]))
        rest = rest.slice(mouse[0].length)
        continue
      }
      let named = null
      for (const sequence in KEYS) {
        if (sequence.length > 1 && rest.startsWith(sequence)) {
          named = sequence
          break
        }
      }
      if (named) {
        this.emit({ type: "key", key: KEYS[named], raw: named })
        rest = rest.slice(named.length)
        continue
      }
      const reply = CSI.exec(rest) ?? STRING.exec(rest)
      if (reply) {
        rest = rest.slice(reply[0].length)
        continue
      }
      // a sequence cut in two by the read: wait for the rest of it
      if (rest.length < 3 || /^\x1b(\[[\d;?$<>=]*|[_P\]^][^\x1b\x07]*\x1b?)$/.test(rest)) {
        if (rest === "\x1b") this.emit({ type: "key", key: "escape", raw: rest })
        else this.pending = rest
        return
      }
      this.emit({ type: "key", key: "escape", raw: "\x1b" })
      rest = rest.slice(1)
    }
  }

  mouse(code, x, y, release, raw) {
    const wheel = (code & 64) !== 0
    const motion = (code & 32) !== 0
    const low = code & 3
    const event = {
      type: "mouse",
      kind: "move",
      button: wheel ? null : low === 3 ? null : ["left", "middle", "right"][low],
      shift: (code & 4) !== 0,
      alt: (code & 8) !== 0,
      ctrl: (code & 16) !== 0,
      raw,
    }
    if (wheel) {
      event.kind = "wheel"
      event.dy = low === 0 ? -1 : low === 1 ? 1 : 0
      event.dx = low === 2 ? -1 : low === 3 ? 1 : 0
    } else if (motion) event.kind = event.button ? "drag" : "move"
    else event.kind = release ? "up" : "down"
    if (this.pixels) {
      event.x = x - this.origin
      event.y = y - this.origin
    } else {
      event.x = Math.round((x - 0.5) * this.cell.width)
      event.y = Math.round((y - 0.5) * this.cell.height)
    }
    event.col = Math.floor(event.x / this.cell.width)
    event.row = Math.floor(event.y / this.cell.height)
    return event
  }
}

// The same report the terminal would send, for tests: tools/poke.mjs writes these into the pane.
export function sgr(kind, x, y, { button = "left", pixels = true, origin = 0, cell = { width: 15, height: 30 } } = {}) {
  let code = { left: 0, middle: 1, right: 2 }[button] ?? 0
  if (kind === "move") code = 35
  else if (kind === "drag") code += 32
  else if (kind === "wheel-up") code = 64
  else if (kind === "wheel-down") code = 65
  const px = pixels ? Math.round(x) + origin : Math.floor(x / cell.width) + 1
  const py = pixels ? Math.round(y) + origin : Math.floor(y / cell.height) + 1
  return `\x1b[<${code};${px};${py}${kind === "up" ? "m" : "M"}`
}
