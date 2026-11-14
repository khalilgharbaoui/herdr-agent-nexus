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
  sat: [18, 18, (c, hex) => {
    halo(c, 9, 9, 9, hex, 0.5)
    c.fillStyle = mix(hex, "#ffffff", 0.25)
    c.beginPath()
    c.moveTo(9, 3.5)
    c.lineTo(14.5, 9)
    c.lineTo(9, 14.5)
    c.lineTo(3.5, 9)
    c.closePath()
    c.fill()
    disc(c, 8, 8, 1.4, "#ffffff", 0.9)
  }],
  // a moon: a subagent of the focused thread, lit from the upper left
  moon: [22, 22, (c, hex) => {
    halo(c, 11, 11, 11, hex, 0.42)
    disc(c, 11, 11, 5.2, hex, 1)
    disc(c, 9.4, 9.4, 2.2, mix(hex, "#ffffff", 0.7), 0.95)
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

// A dot of the flock at seven depths: farther is smaller and dimmer, nearer is larger, brighter
// and lit from the upper left like everything else on screen. [radius, alpha, halo radius]
const DOT_LEVELS = [[0.9, 0.38, 0], [1.3, 0.5, 0], [1.7, 0.64, 0], [2.2, 0.82, 0], [2.8, 0.94, 5.6], [3.5, 1, 7.2], [4.3, 1, 9]]
const STREAK_TAILS = [0, 0, 0, 14, 16, 18, 19] // how long a flying dot's streak is, by depth
const STREAK_WAYS = 12

function flockDot(c, x, y, [radius, alpha, glow], hex) {
  if (glow) halo(c, x, y, glow, hex, 0.26 + radius * 0.035)
  disc(c, x, y, radius, hex, alpha)
  if (radius >= 2.2) disc(c, x - radius * 0.26, y - radius * 0.26, radius * 0.42, mix(hex, "#ffffff", 0.3 + radius * 0.1), 0.95)
}

DOT_LEVELS.forEach((level, index) => {
  const box = Math.ceil(Math.max(level[0], level[2]) * 2) + 2
  SHAPES[`f${index + 1}`] = [box, box, (c, hex) => flockDot(c, box / 2, box / 2, level, hex)]
  const tail = STREAK_TAILS[index]
  if (!tail) return
  // the same dot in flight: a streak behind it that fades, pointing one of twelve ways. The
  // sprite is anchored on the dot itself, so the streak never shifts where the dot is.
  const side = Math.ceil(tail + level[0] * 2) + 3
  const bare = [level[0], level[1], 0] // in flight the streak stands in for the glow
  for (let way = 0; way < STREAK_WAYS; way += 1) {
    const angle = (way / STREAK_WAYS) * Math.PI * 2
    const hx = side / 2 + (Math.cos(angle) * tail) / 2
    const hy = side / 2 + (Math.sin(angle) * tail) / 2
    const tx = side / 2 - (Math.cos(angle) * tail) / 2
    const ty = side / 2 - (Math.sin(angle) * tail) / 2
    SHAPES[`s${index + 1}d${way}`] = [side, side, (c, hex) => {
      const [r, g, b] = hexToRgb(hex)
      const fade = c.createLinearGradient(hx, hy, tx, ty)
      fade.addColorStop(0, `rgba(${r},${g},${b},${0.85 * level[1]})`)
      fade.addColorStop(0.45, `rgba(${r},${g},${b},${0.34 * level[1]})`)
      fade.addColorStop(1, `rgba(${r},${g},${b},0)`)
      const nx = -Math.sin(angle) * level[0] * 0.95
      const ny = Math.cos(angle) * level[0] * 0.95
      c.fillStyle = fade
      c.beginPath()
      c.moveTo(hx + nx, hy + ny)
      c.lineTo(tx, ty)
      c.lineTo(hx - nx, hy - ny)
      c.closePath()
      c.fill()
      flockDot(c, hx, hy, bare, hex)
    }, hx, hy]
  }
})

export const SPRITE_COLORS = [
  "#a78bff", "#4aa8ff", "#2ee6c0", "#ffc247", "#ff62d0", "#ff8a3d", "#8be36a", "#6f9bff", "#9fb4ff", // models
  INK.live, INK.warn, INK.bad, INK.good, INK.text, // signals
  "#7fd6ff", "#8497b0", "#ffd166", "#7ed6a5", "#5fd4c4", // tool families
]

export class Atlas {
  constructor(cellWidth, cellHeight) {
    this.cw = cellWidth
    this.ch = cellHeight
    this.sprites = new Map()
    const padX = cellWidth - 1
    const padY = cellHeight - 1
    const rows = []
    let width = 0
    let height = 0
    for (const [shape, [bw, bh, paint, ax = bw / 2, ay = bh / 2]] of Object.entries(SHAPES)) {
      const windowW = Math.ceil((bw + padX) / cellWidth) * cellWidth
      const windowH = Math.ceil((bh + padY) / cellHeight) * cellHeight
      const tileW = padX + windowW
      const tileH = padY + windowH
      rows.push({ shape, bw, bh, ax, ay, paint, windowW, windowH, tileW, tileH, y: height })
      width = Math.max(width, tileW * SPRITE_COLORS.length)
      height += tileH
    }
    this.width = width
    this.height = height
    this.canvas = createCanvas(width, height)
    const context = this.canvas.getContext("2d")
    for (const row of rows) {
      SPRITE_COLORS.forEach((hex, index) => {
        const tileX = index * row.tileW
        context.save()
        context.translate(tileX + padX, row.y + padY)
        row.paint(context, hex)
        context.restore()
        this.sprites.set(`${row.shape}|${hex}`, {
          x: tileX + padX, // where the sprite's own box starts in the atlas
          y: row.y + padY,
          bw: row.bw,
          bh: row.bh,
          ax: row.ax, // the point of the box that is put on the wanted screen position
          ay: row.ay,
          w: row.windowW,
          h: row.windowH,
          cols: row.windowW / cellWidth,
          rows: row.windowH / cellHeight,
        })
      })
    }
  }

  // RGBA bytes, straight alpha, as the graphics protocol wants them.
  pixels() {
    const image = this.canvas.getContext("2d").getImageData(0, 0, this.width, this.height).data
    return Buffer.from(image.buffer, image.byteOffset, image.length)
  }

  has(kind) {
    return this.sprites.has(kind)
  }

  // Where to put the cursor and which window of the atlas to show so that the sprite `kind` is
  // centred on screen pixel (x, y). Null when it would not fit on a grid of cols by rows cells.
  locate(kind, x, y, cols, rows) {
    const sprite = this.sprites.get(kind)
    if (!sprite) return null
    const left = Math.round(x - sprite.ax)
    const top = Math.round(y - sprite.ay)
    if (left < 0 || top < 0) return null
    const col = Math.floor(left / this.cw)
    const row = Math.floor(top / this.ch)
    if (col + sprite.cols > cols || row + sprite.rows > rows) return null
    return { col, row, sx: sprite.x - (left - col * this.cw), sy: sprite.y - (top - row * this.ch), w: sprite.w, h: sprite.h }
  }

  // The same sprite drawn straight onto a canvas: snapshots, headless frames, the fallback path.
  draw(context, kind, x, y) {
    const sprite = this.sprites.get(kind)
    if (!sprite) return
    context.drawImage(this.canvas, sprite.x, sprite.y, sprite.bw, sprite.bh, Math.round(x - sprite.ax), Math.round(y - sprite.ay), sprite.bw, sprite.bh)
  }
}
