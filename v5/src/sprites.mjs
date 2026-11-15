// The sprite atlas. Everything that moves is one of these small images, uploaded to the terminal
// once and then shown at any pixel position with a placement command of a few dozen bytes.
//
// herdr hands the host terminal a whole-cell box for every placement, so a sprite stays pixel
// exact only when its source window is a whole number of cells. Each sprite therefore sits in a
// padded tile, and it is positioned by sliding a cell-sized window over that tile: the window
// starts on a cell boundary of the screen, the padding decides where inside it the sprite lands.

import { createCanvas } from "@napi-rs/canvas"
import { INK, hexToRgb, mix } from "./util.mjs"

// name: [bbox width, bbox height, painter]
const SHAPES = {
  // a travelling pulse: hot core, soft halo
  pulse: [26, 26, (c, hex) => {
    halo(c, 13, 13, 13, hex, 0.42)
    disc(c, 13, 13, 4.2, hex, 1)
    disc(c, 13, 13, 2.2, mix(hex, "#ffffff", 0.75), 1)
  }],
  // a smaller one, for streams and comet heads
  dot: [14, 14, (c, hex) => {
    halo(c, 7, 7, 7, hex, 0.34)
    disc(c, 7, 7, 2.6, mix(hex, "#ffffff", 0.35), 1)
  }],
  // tail segments
  tail: [8, 8, (c, hex) => disc(c, 4, 4, 2.3, hex, 0.62)],
  mote: [6, 6, (c, hex) => disc(c, 3, 3, 1.7, hex, 0.42)],
  // one model call on an axon, three sizes by how much it wrote
  bar1: [5, 9, (c, hex) => bar(c, 5, 9, hex)],
  bar2: [5, 15, (c, hex) => bar(c, 5, 15, hex)],
  bar3: [5, 21, (c, hex) => bar(c, 5, 21, hex)],
  // one tool call on an axon
  pip: [8, 8, (c, hex) => {
    c.fillStyle = hex
    c.beginPath()
    c.moveTo(4, 0.5)
    c.lineTo(7.5, 4)
    c.lineTo(4, 7.5)
    c.lineTo(0.5, 4)
    c.closePath()
    c.fill()
  }],
  // a flash where something arrived
  glow: [44, 44, (c, hex) => {
    halo(c, 22, 22, 22, hex, 0.5)
    halo(c, 22, 22, 9, mix(hex, "#ffffff", 0.5), 0.7)
  }],
  // the same, fainter: the second half of a flash
  glow2: [44, 44, (c, hex) => halo(c, 22, 22, 22, hex, 0.24)],
  // reticle corners: four of them bracket what is in focus or under the pointer
  cornerA: [13, 13, (c, hex) => corner(c, hex, 0)],
  cornerB: [13, 13, (c, hex) => corner(c, hex, 1)],
  cornerC: [13, 13, (c, hex) => corner(c, hex, 2)],
  cornerD: [13, 13, (c, hex) => corner(c, hex, 3)],
  // a resting cell body breathing: three depths of one soft halo
  breath1: [44, 44, (c, hex) => halo(c, 22, 22, 13, hex, 0.2)],
  breath2: [44, 44, (c, hex) => halo(c, 22, 22, 17, hex, 0.27)],
  breath3: [44, 44, (c, hex) => halo(c, 22, 22, 21, hex, 0.34)],
  // the same at its fullest: the peak of the pulse of a charge that is about to fire
  breath4: [44, 44, (c, hex) => halo(c, 22, 22, 22, hex, 0.5)],
  // a chevron for the alert strip
  chev: [12, 18, (c, hex) => {
    c.strokeStyle = hex
    c.lineWidth = 3
    c.lineJoin = "miter"
    c.beginPath()
    c.moveTo(2, 2)
    c.lineTo(9.5, 9)
    c.lineTo(2, 16)
    c.stroke()
  }],
  // one segment of a level meter
  seg: [14, 5, (c, hex) => {
    c.fillStyle = hex
    c.fillRect(0, 0, 14, 5)
  }],
  // a satellite: one tool call in flight on its equipment's lane
  sat: [14, 14, (c, hex) => {
    c.fillStyle = hex
    c.beginPath()
    c.moveTo(7, 1)
    c.lineTo(13, 7)
    c.lineTo(7, 13)
    c.lineTo(1, 7)
    c.closePath()
    c.fill()
  }],
  // a moon: a subagent of the focused thread, drawn like a thread's cell body in the circuit
  moon: [20, 20, (c, hex) => {
    c.strokeStyle = hex
    c.lineWidth = 2
    c.beginPath()
    c.arc(10, 10, 7.5, 0, Math.PI * 2)
    c.stroke()
    disc(c, 10, 10, 3, hex, 1)
  }],
  // a ring around one mark that is pinned or walked to
  ring: [20, 20, (c, hex) => {
    c.strokeStyle = hex
    c.lineWidth = 1.5
    c.beginPath()
    c.arc(10, 10, 8, 0, Math.PI * 2)
    c.stroke()
  }],
  // a wider ring, around a cell body
  ring2: [38, 38, (c, hex) => {
    c.strokeStyle = hex
    c.lineWidth = 1.5
    c.beginPath()
    c.arc(19, 19, 17, 0, Math.PI * 2)
    c.stroke()
  }],
  // one dot of a leader line, from a mark to its card
  lead: [4, 4, (c, hex) => disc(c, 2, 2, 1.5, hex, 0.95)],
  // the head of a chart line: where the newest reading is
  head: [10, 10, (c, hex) => {
    halo(c, 5, 5, 5, hex, 0.5)
    disc(c, 5, 5, 2.2, mix(hex, "#ffffff", 0.5), 1)
  }],
}

function disc(c, x, y, radius, hex, alpha) {
  const [r, g, b] = hexToRgb(hex)
  c.fillStyle = `rgba(${r},${g},${b},${alpha})`
  c.beginPath()
  c.arc(x, y, radius, 0, Math.PI * 2)
  c.fill()
}

function halo(c, x, y, radius, hex, alpha) {
  const [r, g, b] = hexToRgb(hex)
  const gradient = c.createRadialGradient(x, y, 0, x, y, radius)
  gradient.addColorStop(0, `rgba(${r},${g},${b},${alpha})`)
  gradient.addColorStop(0.45, `rgba(${r},${g},${b},${alpha * 0.32})`)
  gradient.addColorStop(1, `rgba(${r},${g},${b},0)`)
  c.fillStyle = gradient
  c.fillRect(x - radius, y - radius, radius * 2, radius * 2)
}

function corner(c, hex, turn) {
  c.save()
  c.translate(6.5, 6.5)
  c.rotate((turn * Math.PI) / 2)
  c.translate(-6.5, -6.5)
  c.fillStyle = hex
  c.fillRect(0, 0, 12, 2)
  c.fillRect(0, 0, 2, 12)
  c.restore()
}

function bar(c, width, height, hex) {
  const [r, g, b] = hexToRgb(hex)
  c.fillStyle = `rgba(${r},${g},${b},0.28)`
  c.fillRect(0, 0, width, height)
  c.fillStyle = mix(hex, "#ffffff", 0.3)
  c.fillRect(1, 1, width - 2, height - 2)
}

// A dot of the flock at seven depths. The dots are flat digital dots: one colour, a crisp edge,
// no shading and no glow. Depth shows in how they move, overlap and shift against each other;
// a far dot is only a little smaller and dimmer than a near one. [radius, alpha]
const DOT_LEVELS = [[1.1, 0.36], [1.3, 0.46], [1.5, 0.57], [1.75, 0.68], [2.0, 0.8], [2.25, 0.91], [2.5, 1]]
DOT_LEVELS.forEach(([radius, alpha], index) => {
  const box = Math.ceil(radius * 2) + 2
  SHAPES[`f${index + 1}`] = [box, box, (c, hex) => disc(c, box / 2, box / 2, radius, hex, alpha)]
})

// The same dot in flight: a flat streak behind it that thins out, pointing one of twelve ways.
// Two sizes, far (sa) and near (sb). The sprite is anchored on the dot itself, so the streak
// never shifts where the dot is. [radius, alpha, length of the streak]
export const STREAK_DIRS = 12
const STREAKS = { sa: [1.6, 0.66, 9], sb: [2.35, 0.95, 14] }
for (const [name, [radius, alpha, tail]] of Object.entries(STREAKS)) {
  const side = Math.ceil(tail + radius * 2) + 3
  for (let way = 0; way < STREAK_DIRS; way += 1) {
    const angle = (way / STREAK_DIRS) * Math.PI * 2
    const hx = side / 2 + (Math.cos(angle) * tail) / 2
    const hy = side / 2 + (Math.sin(angle) * tail) / 2
    const tx = side / 2 - (Math.cos(angle) * tail) / 2
    const ty = side / 2 - (Math.sin(angle) * tail) / 2
    SHAPES[`${name}${way}`] = [side, side, (c, hex) => {
      const [r, g, b] = hexToRgb(hex)
      const fade = c.createLinearGradient(hx, hy, tx, ty)
      fade.addColorStop(0, `rgba(${r},${g},${b},${0.6 * alpha})`)
      fade.addColorStop(1, `rgba(${r},${g},${b},0)`)
      const nx = -Math.sin(angle) * radius * 0.7
      const ny = Math.cos(angle) * radius * 0.7
      c.fillStyle = fade
      c.beginPath()
      c.moveTo(hx + nx, hy + ny)
      c.lineTo(tx, ty)
      c.lineTo(hx - nx, hy - ny)
      c.closePath()
      c.fill()
      disc(c, hx, hy, radius, hex, alpha)
    }, hx, hy]
  }
}

// Which streak a flying dot of a depth layer wears.
export const streakOf = (level, way) => `${level >= 6 ? "sb" : "sa"}${way}`

export const SPRITE_COLORS = [
  "#a78bff", "#4aa8ff", "#2ee6c0", "#ffc247", "#ff62d0", "#ff8a3d", "#8be36a", "#6f9bff", "#9fb4ff", // models
  INK.live, INK.warn, INK.bad, INK.good, INK.text, // signals
  "#7fd6ff", "#8497b0", "#ffd166", "#7ed6a5", "#5fd4c4", // tool families
]

// Shapes that are needed together share a page, so a colour that only ever marks a pinned dot
// does not pay for the flock.
const FAMILIES = {
  dots: Object.keys(SHAPES).filter((name) => /^f\d$/.test(name)),
  streaks: Object.keys(SHAPES).filter((name) => /^s[ab]\d+$/.test(name)),
  travel: ["pulse", "dot", "tail", "mote", "bar1", "bar2", "bar3", "pip", "head", "lead"],
  glow: ["glow", "glow2", "breath1", "breath2", "breath3", "breath4"],
  frame: ["cornerA", "cornerB", "cornerC", "cornerD", "ring", "ring2", "chev", "seg", "sat", "moon"],
}
const FAMILY_OF = {}
for (const [family, shapes] of Object.entries(FAMILIES)) for (const shape of shapes) FAMILY_OF[shape] = family

const PAGE_WIDTHS = [240, 300, 360, 420, 480, 540, 600, 720, 840, 960] // a page takes the width that wastes least
const PAGE_IDS = 96 // image ids the pages may use
const IDLE_MS = 30e3 // a page nobody placed for this long may be dropped to make room

// The sprite atlas, in small pages that are built when they are first needed.
//
// A page holds one family of shapes in one colour. The terminal keeps every image a pane shows
// in one store (64 MiB under herdr 0.9.5, measured with tools/gfx-probe.mjs) and silently drops
// the oldest image when the store is full, so the atlas must stay small next to the tiles: a
// page is some tens to a few hundred kilobytes of pixels, and all pages together stay under
// `budget` bytes. A page that was not used for half a minute is dropped when room is needed.
//
// Tiles on a page sit one sliding window apart: the window of a sprite reaches at most to the
// next sprite's box, and the next sprite's window reaches back at most to the end of this one's
// box, so the padding between two sprites is shared.
export class Atlas {
  constructor(cellWidth, cellHeight, budget = 10e6) {
    this.cw = cellWidth
    this.ch = cellHeight
    this.budget = budget
    this.sprites = new Map() // kind -> sprite, or null for a kind that does not exist
    this.pages = new Map() // "family|hex" -> page
    this.byId = new Map()
    this.freeIds = []
    for (let id = PAGE_IDS - 1; id >= 0; id -= 1) this.freeIds.push(id)
    this.bytes = 0
    this.retired = [] // ids of pages that were dropped and must be deleted on the terminal
    this.refused = 0 // sprites that could not be made because the budget was full
    this.now = 0
  }

  sprite(kind) {
    let sprite = this.sprites.get(kind)
    if (sprite === undefined) sprite = this.make(kind)
    if (sprite) sprite.page.usedAt = this.now
    return sprite
  }

  make(kind) {
    const bar = kind.indexOf("|")
    const shape = kind.slice(0, bar)
    const hex = kind.slice(bar + 1)
    const family = FAMILY_OF[shape]
    if (bar < 0 || !family || !/^#[0-9a-f]{6}$/i.test(hex)) {
      this.sprites.set(kind, null)
      return null
    }
    const key = `${family}|${hex}`
    if (this.pages.has(key)) return this.sprites.get(kind) ?? null
    // lay the family out on shelves
    const { cw, ch } = this
    const tiles = FAMILIES[family].map((name) => {
      const [bw, bh, paint, ax = bw / 2, ay = bh / 2] = SHAPES[name]
      return { name, bw, bh, ax, ay, paint, w: Math.ceil((bw + cw - 1) / cw) * cw, h: Math.ceil((bh + ch - 1) / ch) * ch }
    })
    tiles.sort((a, b) => b.h - a.h || b.w - a.w)
    const lay = (limit, keep) => {
      let x = cw
      let y = ch
      let shelf = 0
      let width = 0
      for (const tile of tiles) {
        if (x > cw && x + tile.w > limit) {
          x = cw
          y += shelf
          shelf = 0
        }
        if (keep) {
          tile.x = x
          tile.y = y
        }
        x += tile.w
        shelf = Math.max(shelf, tile.h)
        width = Math.max(width, x)
      }
      return { width, height: y + shelf }
    }
    let best = PAGE_WIDTHS[0]
    let least = Infinity
    for (const limit of PAGE_WIDTHS) {
      const size = lay(limit, false)
      if (size.width * size.height < least) {
        least = size.width * size.height
        best = limit
      }
    }
    const { width, height } = lay(best, true)
    const bytes = width * height * 4
    if (!this.room(bytes)) {
      this.refused += 1
      return null
    }
    const canvas = createCanvas(width, height)
    const context = canvas.getContext("2d")
    const page = { id: this.freeIds.pop(), key, canvas, width, height, bytes, kinds: [], sent: false, held: null, usedAt: this.now, sentAt: 0 }
    for (const tile of tiles) {
      context.save()
      context.translate(tile.x, tile.y)
      tile.paint(context, hex)
      context.restore()
      const name = `${tile.name}|${hex}`
      page.kinds.push(name)
      this.sprites.set(name, { page, x: tile.x, y: tile.y, bw: tile.bw, bh: tile.bh, ax: tile.ax, ay: tile.ay, w: tile.w, h: tile.h, cols: tile.w / cw, rows: tile.h / ch })
    }
    this.pages.set(key, page)
    this.byId.set(page.id, page)
    this.bytes += bytes
    return this.sprites.get(kind) ?? null
  }

  // Makes room for `bytes` more by dropping pages nobody used for a while, oldest first.
  room(bytes) {
    if (!this.freeIds.length || this.bytes + bytes > this.budget) {
      const idle = [...this.pages.values()].filter((page) => this.now - page.usedAt > IDLE_MS).sort((a, b) => a.usedAt - b.usedAt)
      for (const page of idle) {
        if (this.freeIds.length && this.bytes + bytes <= this.budget) break
        this.drop(page)
      }
    }
    return this.freeIds.length > 0 && this.bytes + bytes <= this.budget
  }

  drop(page) {
    for (const kind of page.kinds) this.sprites.delete(kind)
    this.pages.delete(page.key)
    this.byId.delete(page.id)
    this.freeIds.push(page.id)
    this.bytes -= page.bytes
    if (page.sent) this.retired.push(page.id)
    page.sent = false
  }

  // Drops every page: the painted transport needs none of them on the terminal.
  clear() {
    for (const page of [...this.pages.values()]) this.drop(page)
  }

  // The terminal was cleared: nothing is up there any more.
  forget() {
    for (const page of this.pages.values()) {
      page.sent = false
      page.held = null
    }
    this.retired = []
  }

  // RGBA bytes of one page, straight alpha, as the graphics protocol wants them.
  pixels(page) {
    const image = page.canvas.getContext("2d").getImageData(0, 0, page.width, page.height).data
    return image.buffer.slice(image.byteOffset, image.byteOffset + image.length)
  }

  has(kind) {
    return Boolean(this.sprite(kind))
  }

  // Where to put the cursor and which window of which page to show so that the sprite `kind`
  // sits with its anchor on screen pixel (x, y). Null when it would not fit on a grid of cols
  // by rows cells, or when there is no such sprite.
  locate(kind, x, y, cols, rows) {
    const sprite = this.sprite(kind)
    if (!sprite) return null
    const left = Math.round(x - sprite.ax)
    const top = Math.round(y - sprite.ay)
    if (left < 0 || top < 0) return null
    const col = Math.floor(left / this.cw)
    const row = Math.floor(top / this.ch)
    if (col + sprite.cols > cols || row + sprite.rows > rows) return null
    return { page: sprite.page, col, row, sx: sprite.x - (left - col * this.cw), sy: sprite.y - (top - row * this.ch), w: sprite.w, h: sprite.h }
  }

  // The same sprite drawn straight onto a canvas: snapshots, headless frames, the painted path.
  draw(context, kind, x, y) {
    const sprite = this.sprite(kind)
    if (!sprite) return
    context.drawImage(sprite.page.canvas, sprite.x, sprite.y, sprite.bw, sprite.bh, Math.round(x - sprite.ax), Math.round(y - sprite.ay), sprite.bw, sprite.bh)
  }

  get state() {
    let sent = 0
    let held = 0
    let lost = 0
    for (const page of this.pages.values()) {
      if (page.sent) sent += 1
      if (page.held === true) held += 1
      if (page.held === false) lost += 1
    }
    return { pages: this.pages.size, sent, held, lost, mb: Number((this.bytes / 1e6).toFixed(2)), budgetMb: this.budget / 1e6, refused: this.refused }
  }
}
