// The renderer. It draws the still layer: type, wires, rings, gauges. Everything that travels is
// a sprite and is only listed here (see sprites() and react()), never painted into this layer,
// so the still layer changes only when data does and costs nothing in between.
//
// The screen is cut into regions (header, stage, rails, one per thread, ports, footer). Each has
// a signature; a region is repainted only when its signature changed. Nothing paints a backdrop:
// a pixel that is not ink stays transparent and the terminal's own dark shows through.

import { createCanvas } from "@napi-rs/canvas"
import { PORTS, portOf } from "./model.mjs"
import { SPRITE_COLORS } from "./sprites.mjs"
import { FAMILY, INK, TAU, agoOf, clamp, clockOf, compactOf, dayOf, fontOf, mix, modelColor, moneyOf, rgba, shortModel, spanOf, timerOf, toolMeta } from "./util.mjs"

const PORT_COLOR = { you: INK.text, exec: "#7fd6ff", read: "#8497b0", write: "#ffd166", web: "#7ed6a5", agent: "#ff62d0", other: "#5fd4c4" }
const NICE_SPANS = [60e3, 120e3, 300e3, 600e3, 1200e3, 1800e3, 3600e3, 7200e3, 4 * 3600e3, 8 * 3600e3, 24 * 3600e3]
const GOLDEN = 2.399963229728653
const STATE_WORD = { thinking: "THINKING", writing: "WRITING", calling: "CALLING THE MODEL", tool: "RUNNING", waiting: "WAITING ON YOU", idle: "IDLE", stalled: "SILENT", failed: "FAILED" }
const spriteHex = (hex) => (SPRITE_COLORS.includes(hex) ? hex : INK.text)
const clean = (text) => String(text ?? "").replace(/\s+/g, " ").trim()

export class Renderer {
  constructor(flow) {
    this.flow = flow
    this.W = 0
    this.H = 0
    this.S = 1
    this.fits = new Map()
    this.regions = []
    this.marks = new Uint8Array(0)
    this.bandHeight = 90
    this.reveal = new Map()
    this.theta = new Map()
    this.bloomSeen = new Map()
    this.arranged = ""
    this.wiresSignature = ""
    this.lastUpdate = 0
    this.G = null
  }

  resize(width, height, cell) {
    this.W = width
    this.H = height
    this.cell = cell
    const wide = width > height * 1.15
    this.S = clamp(wide ? Math.min(height / 2460, width / 3300) : Math.min(width / 1890, height / 2200), 0.34, 1.6)
    this.canvas = createCanvas(width, height)
    this.base = this.canvas.getContext("2d")
    this.wiresCanvas = createCanvas(width, height)
    this.wires = this.wiresCanvas.getContext("2d")
    this.fits.clear()
    this.arranged = ""
    this.wiresSignature = ""
    this.extra = 0
    this.layout(wide)
  }

  u(value) {
    return Math.round(value * this.S)
  }

  // ---------------------------------------------------------------- geometry

  // `extra` is how many pixels taller than its normal size the focus stage is (portrait only):
  // what the thread rows leave unused goes to the live text.
  layout(wide, extra = 0) {
    const { W, H } = this
    const u = (value) => this.u(value)
    const M = u(30)
    const G = { wide, M }
    G.header = { x: 0, y: 0, w: W, h: u(120) }
    const footerH = u(210)
    if (wide) {
      const left = Math.round((W * 0.56) / this.cell.width) * this.cell.width
      G.circuit = { x: 0, y: G.header.h, w: left, h: H - G.header.h - footerH }
      G.footer = { x: 0, y: H - footerH, w: left, h: footerH }
      G.stage = { x: left, y: G.header.h, w: W - left, h: H - G.header.h }
    } else {
      G.stage = { x: 0, y: G.header.h, w: W, h: u(630) + extra }
      G.circuit = { x: 0, y: G.stage.y + G.stage.h, w: W, h: H - G.stage.y - G.stage.h - footerH }
      G.footer = { x: 0, y: H - footerH, w: W, h: footerH }
    }
    // the focus instrument
    const core = { RA: u(206), RB: u(178), r0: u(84), r1: u(160) }
    core.cx = G.stage.x + M + u(250)
    core.cy = G.stage.y + u(304)
    G.core = core
    if (wide) {
      G.head = { x: core.cx + core.RA + u(70), y: G.stage.y + u(40), w: G.stage.x + G.stage.w - M - (core.cx + core.RA + u(70)) }
      G.tail = { x: G.stage.x + M + u(20), y: core.cy + core.RA + u(100), w: G.stage.w - 2 * M - u(20), h: G.stage.y + G.stage.h - u(40) - (core.cy + core.RA + u(100)) }
    } else {
      G.head = { x: core.cx + core.RA + u(70), y: G.stage.y + u(40), w: W - M - (core.cx + core.RA + u(70)) }
      G.tail = { x: G.head.x, y: G.stage.y + u(258), w: G.head.w, h: G.stage.h - u(258) - u(28) }
    }
    // the circuit
    const C = G.circuit
    G.rowsTop = C.y + u(62)
    G.rowsBottom = C.y + C.h - u(16)
    G.railTop = G.rowsTop + u(6)
    G.railPitch = u(54)
    G.railX0 = C.x + M + u(22)
    G.portX = C.x + C.w - M - u(236)
    G.termX = G.portX - u(290)
    G.ports = new Map()
    G.capacity = Math.max(3, Math.floor((G.rowsBottom - G.rowsTop + extra) / u(106)))
    G.speed = 12 * this.S // pixels a second a tick drifts along an axon
    G.rows = []
    this.G = G
  }

  // Lays the rows out, hands every path to the moving layer and rebuilds the region list.
  // Runs only when the set of rows, their order, their size or the focus changed.
  arrange(scene, now) {
    let G = this.G
    const u = (value) => this.u(value)
    const accounts = scene.world?.accounts ?? []
    const signature = [this.W, this.H, scene.focus.id, accounts.map((account) => account.name).join(","), ...scene.rows.map((row) => `${row.session.id}:${row.depth}:${this.tall(row.session) ? 1 : 0}`)].join("|")
    if (signature === this.arranged) return false
    this.arranged = signature
    if (!G.wide) {
      // few threads: the stage takes what they leave, in steps of four lines of text
      const wanted = scene.rows.reduce((sum, row) => sum + (this.tall(row.session) ? u(144) : u(114)), 0)
      const spare = G.rowsBottom - G.rowsTop + this.extra - Math.max(wanted, PORTS.length * u(104)) - u(40)
      const step = u(112)
      const extra = clamp(Math.floor(spare / step) * step, 0, step * 6)
      if (extra !== this.extra) {
        this.extra = extra
        this.layout(false, extra)
        G = this.G
      }
    }
    G.rails = accounts.map((account, index) => ({ name: account.name, x: G.railX0 + index * (accounts.length > 3 ? Math.round((G.railPitch * 3) / accounts.length) : G.railPitch) }))
    const railsRight = G.rails.length ? G.rails[G.rails.length - 1].x + u(30) : G.railX0 + u(30)
    G.railsRight = railsRight
    G.busX = railsRight + u(14)
    const somaX0 = G.busX + u(66)
    let heights = scene.rows.map((row) => (this.tall(row.session) ? u(120) : u(90)))
    const room = G.rowsBottom - G.rowsTop
    const need = heights.reduce((sum, height) => sum + height, 0)
    if (need > room && heights.length) {
      const each = Math.max(u(56), Math.floor(room / heights.length))
      heights = heights.map((height) => Math.min(height, each))
    } else if (heights.length) {
      // a few threads get a little more air each, never enough to look stretched
      const air = Math.min(u(24), Math.floor((room - need) / heights.length))
      heights = heights.map((height) => height + air)
    }
    // the ports and the rails stand beside the rows, not beside empty space
    const used = heights.reduce((sum, height) => sum + height, 0)
    const extent = Math.min(room, Math.max(used, PORTS.length * u(104)))
    PORTS.forEach((port, index) => {
      G.ports.set(port.id, { x: G.portX, y: Math.round(G.rowsTop + ((index + 0.5) * extent) / PORTS.length) })
    })
    G.railBottom = G.rowsTop + Math.min(room, Math.max(used, u(720))) - u(84)
    let y = G.rowsTop
    G.rows = scene.rows.map((row, index) => {
      const h = heights[index]
      const working = row.session.state === "working" || row.session.state === "waiting"
      const somaX = somaX0 + Math.min(row.depth, 4) * u(44)
      const geometry = {
        row,
        sid: row.session.id,
        y,
        h,
        somaX,
        r: working ? u(13) : u(8),
        axonY: y + h - (h >= u(110) ? u(18) : u(16)),
        textX: somaX + u(32),
        textRight: G.termX - u(18),
        live: this.tall(row.session) && h >= u(110),
        slim: h < u(80),
      }
      y += h
      return geometry
    })
    G.rowOf = new Map(G.rows.map((geometry) => [geometry.sid, geometry]))

    // paths for the moving layer
    const flow = this.flow
    flow.clearPaths()
    for (const g of G.rows) {
      const session = g.row.session
      const rail = G.rails.find((candidate) => candidate.name === session.account)
      if (rail) flow.setPath(`in:${g.sid}`, [[rail.x, G.railTop], [rail.x, g.axonY], [g.somaX - g.r, g.axonY]])
      flow.setPath(`axon:${g.sid}`, [[g.somaX + g.r, g.axonY], [G.termX, g.axonY]])
      for (const [id, port] of G.ports) {
        flow.setPath(`syn:${g.sid}:${id}`, this.curve(G.termX, g.axonY, port.x - u(12), port.y))
        flow.join(`out:${g.sid}:${id}`, [`axon:${g.sid}`, `syn:${g.sid}:${id}`])
        flow.join(`back:${g.sid}:${id}`, [`axon:${g.sid}`, `syn:${g.sid}:${id}`], true)
      }
      if (g.row.parent) {
        const parent = G.rowOf.get(g.row.parent.session.id)
        if (parent) {
          flow.setPath(`kid:${g.sid}`, this.elbow(parent.somaX, parent.axonY + parent.r, g.somaX - g.r, g.axonY))
          flow.join(`kidback:${g.sid}`, [`kid:${g.sid}`], true)
        }
      }
    }
    const focus = G.rowOf.get(scene.focus.id)
    if (focus && !G.wide) {
      // straight up the bus to where it meets the instrument's dotted frame
      const core = G.core
      const frame = core.RA + u(44)
      const reach = Math.sqrt(Math.max(0, frame * frame - (core.cx - G.busX) ** 2))
      flow.setPath(`focus:${focus.sid}`, [[focus.somaX - focus.r, focus.axonY], [G.busX, focus.axonY], [G.busX, Math.round(core.cy + reach + u(5))]])
    }
    this.buildRegions()
    this.wiresSignature = ""
    return true
  }

  tall(session) {
    return session.state === "working" || session.state === "waiting"
  }

  // A synapse: leaves horizontally, arrives horizontally (or vertically for the focus link).
  curve(x0, y0, x1, y1, vertical = false) {
    const points = []
    const dx = x1 - x0
    const dy = y1 - y0
    const c1 = vertical ? [x0, y0 + dy * 0.55] : [x0 + dx * 0.55, y0]
    const c2 = vertical ? [x1, y0 + dy * 0.45] : [x1 - dx * 0.55, y1]
    for (let step = 0; step <= 28; step += 1) {
      const t = step / 28
      const a = (1 - t) ** 3
      const b = 3 * (1 - t) ** 2 * t
      const c = 3 * (1 - t) * t ** 2
      const d = t ** 3
      points.push([a * x0 + b * c1[0] + c * c2[0] + d * x1, a * y0 + b * c1[1] + c * c2[1] + d * y1])
    }
    return points
  }

  // Parent to child: straight down, then a quarter turn into the child's cell body.
  elbow(x0, y0, x1, y1) {
    const radius = Math.min(this.u(16), Math.abs(x1 - x0), Math.abs(y1 - y0))
    const points = [[x0, y0], [x0, y1 - radius]]
    for (let step = 1; step <= 8; step += 1) {
      const angle = (step / 8) * (Math.PI / 2)
      points.push([x0 + radius - Math.cos(angle) * radius, y1 - radius + Math.sin(angle) * radius])
    }
    points.push([x1, y1])
    return points
  }

  buildRegions() {
    const G = this.G
    const C = G.circuit
    const regions = []
    regions.push({ name: "header", rect: G.header, sign: (scene, now, meta) => this.signHeader(scene, now, meta), draw: (c, scene, now, meta) => this.drawHeader(c, scene, now, meta) })
    regions.push({ name: "stage", rect: G.stage, sign: (scene, now) => this.signStage(scene, now), draw: (c, scene, now) => this.drawStage(c, scene, now) })
    const rowsLeft = G.railsRight
    regions.push({ name: "rails", circuit: true, rect: { x: C.x, y: C.y, w: rowsLeft - C.x, h: C.h }, sign: (scene, now) => this.signRails(scene, now), draw: (c, scene, now) => this.drawRails(c, scene, now) })
    const rowsRight = G.termX + this.u(12)
    regions.push({ name: "top", circuit: true, rect: { x: rowsLeft, y: C.y, w: rowsRight - rowsLeft, h: G.rowsTop - C.y }, sign: (scene) => `${scene.rows.length}|${scene.hidden}`, draw: (c, scene) => this.drawCircuitLabels(c, scene) })
    for (const g of G.rows) {
      regions.push({ name: `row:${g.sid}`, circuit: true, rect: { x: rowsLeft, y: g.y, w: rowsRight - rowsLeft, h: g.h }, sign: (scene, now) => this.signRow(g, scene, now), draw: (c, scene, now) => this.drawRow(c, g, scene, now) })
    }
    const last = G.rows[G.rows.length - 1]
    const restY = last ? last.y + last.h : G.rowsTop
    regions.push({ name: "rest", circuit: true, rect: { x: rowsLeft, y: restY, w: rowsRight - rowsLeft, h: C.y + C.h - restY }, sign: (scene) => (scene.rows.length ? "" : "empty"), draw: (c, scene) => this.drawRest(c, scene) })
    regions.push({ name: "ports", circuit: true, rect: { x: rowsRight, y: C.y, w: C.x + C.w - rowsRight, h: C.h }, sign: (scene, now) => this.signPorts(scene, now), draw: (c, scene, now) => this.drawPorts(c, scene, now) })
    regions.push({ name: "footer", rect: G.footer, sign: (scene, now) => this.signFooter(scene, now), draw: (c, scene, now) => this.drawFooter(c, scene, now) })
    for (const region of regions) region.last = null
    this.regions = regions
  }

  // ---------------------------------------------------------------- frame

  // Repaints what changed. Returns true when anything did; this.marks then flags the tile rows
  // that have to be read back.
  update(scene, now, meta) {
    const dt = this.lastUpdate ? Math.min(0.25, (now - this.lastUpdate) / 1000) : 0
    this.lastUpdate = now
    const rearranged = this.arrange(scene, now)
    this.advance(scene, now, dt)
    const bands = Math.ceil(this.H / this.bandHeight)
    this.marks = new Uint8Array(bands)
    const wires = this.signWires(scene, now)
    const rewire = wires !== this.wiresSignature || rearranged
    if (rewire) {
      this.wiresSignature = wires
      this.drawWires(scene, now)
    }
    let any = false
    if (rearranged) this.base.clearRect(0, 0, this.W, this.H)
    for (const region of this.regions) {
      const signature = region.sign(scene, now, meta)
      if (signature === region.last && !(rewire && region.circuit) && !rearranged) continue
      region.last = signature
      this.paint(region, scene, now, meta)
      any = true
    }
    if (rearranged) this.marks.fill(1)
    return any
  }

  paint(region, scene, now, meta) {
    const c = this.base
    const { x, y, w, h } = region.rect
    if (w <= 0 || h <= 0) return
    c.save()
    c.beginPath()
    c.rect(x, y, w, h)
    c.clip()
    c.clearRect(x, y, w, h)
    if (region.circuit || region.name === "stage") c.drawImage(this.wiresCanvas, x, y, w, h, x, y, w, h)
    region.draw(c, scene, now, meta)
    c.restore()
    const first = Math.floor(y / this.bandHeight)
    const last = Math.min(this.marks.length - 1, Math.floor((y + h - 1) / this.bandHeight))
    for (let band = first; band <= last; band += 1) this.marks[band] = 1
  }

  // Things that ease or type themselves: text reveal, comet angles.
  advance(scene, now, dt) {
    const live = new Set()
    // text types in steps of a fifteenth of a second: it reads the same and repaints half as often
    this.typeClock = (this.typeClock ?? 0) + dt
    const typeStep = this.typeClock >= 0.066 ? this.typeClock : 0
    if (typeStep) this.typeClock = 0
    for (const g of this.G.rows) {
      const session = g.row.session
      for (const item of session.tail ?? []) {
        if (item.kind === "tool") continue
        live.add(item.key)
        const length = item.text.length
        let state = this.reveal.get(item.key)
        if (!state) {
          // text that was already there when this thread first showed is not typed again
          const fresh = scene.primed && this.knownSessions?.has(session.id) && now - (item.end ?? item.at ?? 0) < 20e3
          state = { shown: fresh ? 0 : length, length }
          this.reveal.set(item.key, state)
        }
        state.length = length
        if (state.shown < length) {
          const left = length - state.shown
          if (typeStep) state.shown = Math.min(length, state.shown + Math.max(260, left / 0.9) * typeStep)
        } else state.shown = length
      }
      const rate = scene.rateOf(session.id, now)
      const omega = 1.5 + Math.min(7, rate / 28) // radians a second: faster when it writes faster
      this.theta.set(session.id, ((this.theta.get(session.id) ?? 0) + omega * dt) % TAU)
    }
    this.knownSessions = new Set(this.G.rows.map((g) => g.sid))
    if (this.reveal.size > 600) for (const key of this.reveal.keys()) if (!live.has(key)) this.reveal.delete(key)
  }

  shownOf(item) {
    const state = this.reveal.get(item.key)
    return state ? Math.floor(state.shown) : item.text.length
  }

  // ---------------------------------------------------------------- primitives

  text(c, value, x, y, { size = 16, family = FAMILY.mono, weight = "", color = INK.text, align = "left", spacing = 0 } = {}) {
    c.font = fontOf(size * this.S, family, weight)
    c.letterSpacing = `${(spacing * this.S).toFixed(1)}px`
    c.fillStyle = color
    c.textAlign = align
    c.textBaseline = "alphabetic"
    c.fillText(value, Math.round(x), Math.round(y))
  }

  width(c, value, { size = 16, family = FAMILY.mono, weight = "", spacing = 0 } = {}) {
    c.font = fontOf(size * this.S, family, weight)
    c.letterSpacing = `${(spacing * this.S).toFixed(1)}px`
    return c.measureText(value).width
  }

  fit(c, value, maxWidth, style) {
    const key = `${style.size}|${style.family ?? ""}|${style.weight ?? ""}|${Math.round(maxWidth)}|${value}`
    let result = this.fits.get(key)
    if (result !== undefined) return result
    result = value
    if (this.width(c, value, style) > maxWidth) {
      let low = 0
      let high = value.length
      while (low < high) {
        const middle = (low + high + 1) >> 1
        if (this.width(c, `${value.slice(0, middle).trimEnd()}…`, style) <= maxWidth) low = middle
        else high = middle - 1
      }
      result = low > 0 ? `${value.slice(0, low).trimEnd()}…` : ""
    }
    if (this.fits.size > 4000) this.fits.clear()
    this.fits.set(key, result)
    return result
  }

  // A run of differently styled pieces on one baseline. Returns where it ended.
  run(c, x, y, pieces) {
    let at = x
    for (const [value, style] of pieces) {
      if (!value) continue
      this.text(c, value, at, y, style)
      at += this.width(c, value, style)
    }
    return at
  }

  line(c, x0, y0, x1, y1, color, width = 1) {
    c.strokeStyle = color
    c.lineWidth = width
    c.beginPath()
    const half = width % 2 ? 0.5 : 0
    c.moveTo(Math.round(x0) + (x0 === x1 ? half : 0), Math.round(y0) + (y0 === y1 ? half : 0))
    c.lineTo(Math.round(x1) + (x0 === x1 ? half : 0), Math.round(y1) + (y0 === y1 ? half : 0))
    c.stroke()
  }

  poly(c, points, color, width = 1) {
    c.strokeStyle = color
    c.lineWidth = width
    c.lineJoin = "round"
    c.beginPath()
    points.forEach(([x, y], index) => (index ? c.lineTo(x + 0.5, y + 0.5) : c.moveTo(x + 0.5, y + 0.5)))
    c.stroke()
  }

  arc(c, x, y, radius, from, to, color, width) {
    if (to <= from) return
    c.strokeStyle = color
    c.lineWidth = width
    c.lineCap = "butt"
    c.beginPath()
    c.arc(x, y, radius, from - Math.PI / 2, to - Math.PI / 2)
    c.stroke()
  }

  label(c, value, x, y, color = INK.dim, align = "left", size = 12.5) {
    this.text(c, value, x, y, { size, family: FAMILY.label, weight: "600", color, align, spacing: 2.6 })
  }

  // ---------------------------------------------------------------- wires

  signWires(scene, now) {
    const parts = [scene.focus.id]
    const streams = new Set(scene.streams.map((stream) => stream.key))
    for (const g of this.G.rows) {
      const session = g.row.session
      parts.push(session.state, g.row.parent ? 1 : 0)
      for (const [id, port] of scene.ports) {
        const used = port.used?.get(session.id)
        if (!used) continue
        const age = now - used
        parts.push(`${id}${age < 60e3 ? 3 : age < 240e3 ? 2 : 1}`)
      }
    }
    for (const key of streams) parts.push(key)
    return parts.join("|")
  }

  drawWires(scene, now) {
    const c = this.wires
    const G = this.G
    const u = (value) => this.u(value)
    c.clearRect(0, 0, this.W, this.H)
    const lit = new Map()
    for (const stream of scene.streams) lit.set(stream.type === "kid" ? `kid:${stream.sid}` : `${stream.sid}:${stream.port}`, stream)
    for (const g of G.rows) {
      const session = g.row.session
      const color = modelColor(session.model, session.provider)
      const working = session.state === "working"
      const waiting = session.state === "waiting"
      const tone = working ? rgba(color, 0.5) : waiting ? rgba(INK.warn, 0.45) : INK.ghost
      // tap from the account rail
      const rail = G.rails.find((candidate) => candidate.name === session.account)
      if (rail) {
        this.line(c, rail.x, g.axonY, g.somaX - g.r - 1, g.axonY, working ? rgba(color, 0.34) : INK.ghost)
        c.fillStyle = working ? color : INK.faint
        c.beginPath()
        c.arc(rail.x + 0.5, g.axonY + 0.5, u(2.5), 0, TAU)
        c.fill()
      }
      // axon and its terminal
      this.line(c, g.somaX + g.r + 1, g.axonY, G.termX, g.axonY, tone)
      c.fillStyle = working ? color : waiting ? INK.warn : INK.faint
      c.beginPath()
      c.arc(G.termX + 0.5, g.axonY + 0.5, working || waiting ? u(3) : u(2), 0, TAU)
      c.fill()
      // synapses: the three things this thread acted on last, brightest where something is in flight
      const recent = []
      for (const [id, port] of scene.ports) {
        const used = port.used?.get(session.id)
        if (used && (working || now - used < 90e3)) recent.push([id, used])
      }
      recent.sort((a, b) => b[1] - a[1])
      const faint = new Map(recent.slice(0, working ? 3 : 2))
      for (const id of scene.ports.keys()) {
        const stream = lit.get(`${g.sid}:${id}`)
        if (!stream && !faint.has(id)) continue
        const path = this.flow.paths.get(`syn:${g.sid}:${id}`)
        if (!path) continue
        if (stream) this.poly(c, path.points, rgba(stream.type === "wait" ? INK.warn : PORT_COLOR[id], 0.62), 1.5)
        else {
          const age = now - faint.get(id)
          this.poly(c, path.points, rgba(INK.dim, age < 60e3 ? 0.36 : age < 240e3 ? 0.2 : 0.1), 1)
        }
      }
      // the link to the parent
      if (g.row.parent) {
        const path = this.flow.paths.get(`kid:${g.sid}`)
        if (path) this.poly(c, path.points, lit.has(`kid:${g.sid}`) ? rgba(PORT_COLOR.agent, 0.6) : INK.faint, lit.has(`kid:${g.sid}`) ? 1.5 : 1)
      }
    }
    const focus = this.flow.paths.get(`focus:${scene.focus.id}`)
    if (focus) this.poly(c, focus.points, rgba(INK.live, 0.5), 1)
  }

  // ---------------------------------------------------------------- header

  signHeader(scene, now, meta) {
    const world = scene.world
    return [Math.floor(now / 1000), world?.mode, scene.counts.working, scene.counts.waiting, scene.counts.panes, scene.counts.stalled, Math.round(world?.cost24h?.cost ?? 0), Math.round((scene.outPerMinute ?? 0) / 50), meta?.line].join("|")
  }

  drawHeader(c, scene, now, meta) {
    const { M } = this.G
    const u = (value) => this.u(value)
    const W = this.W
    const demo = scene.world?.mode === "DEMO"
    let x = this.run(c, M, u(54), [
      ["AGENT NEXUS", { size: 22, family: FAMILY.label, weight: "600", color: INK.text, spacing: 7 }],
      ["  3", { size: 22, family: FAMILY.label, weight: "600", color: INK.dim, spacing: 2 }],
    ])
    x += u(26)
    c.fillStyle = demo ? INK.warn : INK.live
    c.beginPath()
    c.arc(x + u(4), u(47), u(4), 0, TAU)
    c.fill()
    this.label(c, demo ? "DEMO  ·  SIMULATED DATA" : "LIVE", x + u(16), u(52.5), demo ? INK.warn : INK.live, "left", 13)
    const clock = clockOf(now)
    this.text(c, clock, W - M, u(60), { size: 40, family: FAMILY.monoLight, color: INK.text, align: "right" })
    const clockW = this.width(c, clock, { size: 40, family: FAMILY.monoLight })
    this.label(c, dayOf(now), W - M - clockW - u(20), u(58), INK.dim, "right", 13)
    // one line of what matters
    const counts = scene.counts
    const number = (value, color = INK.text) => [String(value), { size: 16, family: FAMILY.monoMedium, color }]
    const word = (value) => [value, { size: 14.5, color: INK.dim }]
    const pieces = [number(counts.working, counts.working ? INK.live : INK.soft), word(" working    ")]
    pieces.push(number(counts.waiting, counts.waiting ? INK.warn : INK.soft), word(" waiting on you    "))
    if (counts.stalled) pieces.push(number(counts.stalled), word(" silent    "))
    pieces.push(number(counts.panes), word(" panes    "))
    pieces.push(number(moneyOf(scene.world?.cost24h?.cost ?? 0)), word(" in 24 h    "))
    pieces.push(number(compactOf(scene.outPerMinute ?? 0)), word(" tokens out a minute"))
    this.run(c, M, u(94), pieces)
    if (meta?.line) this.text(c, meta.line, W - M, u(94), { size: 12.5, color: INK.dim, align: "right" })
    this.line(c, M, u(112), W - M, u(112), INK.ghost)
  }

  // ---------------------------------------------------------------- stage

  // The turn the instrument shows: the running one, or the last one while the thread rests.
  turnWindow(session, now) {
    if (session.turn) return { start: session.turn.start, end: now, live: true }
    let start = 0
    for (const mark of session.marks) if (mark.kind === "user") start = mark.at
    const end = session.idleSince || session.updated
    if (!start || end <= start) return null
    return { start, end, live: false }
  }

  // How much time one full circle of the turn ring stands for.
  turnScale(session, elapsed) {
    const expect = session.expect
    if (expect) return Math.max(expect.p75 * 1.25, elapsed * 1.08)
    return NICE_SPANS.find((span) => span >= elapsed * 1.15) ?? elapsed * 1.2
  }

  bloomUnit(out) {
    for (const unit of [25, 50, 100, 250, 500, 1000, 2500, 5000]) if (out / unit <= 520) return unit
    return 10000
  }

  signStage(scene, now) {
    const focus = scene.focused
    if (!focus) return "none"
    const session = focus.session
    // a working thread's clock moves every second, a resting one every minute
    const parts = [session.id, scene.focus.auto, focus.index, session.state, session.phase.key, session.title, session.cost.toFixed(2), session.context.used, Math.floor(now / (session.turn ? 1000 : 60e3))]
    parts.push(session.turn?.out ?? session.lastOut, session.steps.length)
    for (const item of session.tail ?? []) {
      if (item.kind === "tool") parts.push(item.tool.id, item.tool.status, item.tool.end === null && now - item.tool.start < 10e3 ? Math.floor(now / 100) : "")
      else parts.push(item.key, this.shownOf(item))
    }
    const seen = this.bloomSeen.get(session.id)
    if (seen && now - seen.at < 700) parts.push(Math.floor(now / 80))
    return parts.join("|")
  }

  drawStage(c, scene, now) {
    const G = this.G
    const u = (value) => this.u(value)
    const focus = scene.focused
    const core = G.core
    if (!focus) {
      this.label(c, "NO THREADS YET", core.cx, core.cy, INK.dim, "center", 14)
      return
    }
    const session = focus.session
    const color = modelColor(session.model, session.provider)
    const working = session.state === "working"
    const { cx, cy, RA, RB } = core

    // The turn clock. One turn of ring A is the time such a turn may take; the arc is how far
    // this one has come, a bead is a model call, a spoke outside it is a tool call (as long as
    // the call took, on a log scale). A resting thread shows its last turn, dimmed.
    const frame = RA + u(44)
    for (let tick = 0; tick < 120; tick += 1) {
      const angle = (tick / 120) * TAU - Math.PI / 2
      const long = tick % 10 === 0
      c.fillStyle = long ? INK.faint : INK.ghost
      c.beginPath()
      c.arc(cx + Math.cos(angle) * frame, cy + Math.sin(angle) * frame, long ? u(1.6) : u(1), 0, TAU)
      c.fill()
    }
    c.strokeStyle = INK.ghost
    c.lineWidth = 1
    c.beginPath()
    c.arc(cx + 0.5, cy + 0.5, RA, 0, TAU)
    c.stroke()
    let usual = ""
    const turn = this.turnWindow(session, now)
    if (turn) {
      const elapsed = turn.end - turn.start
      const scale = this.turnScale(session, elapsed)
      const fade = turn.live ? 1 : 0.42
      const expect = session.expect
      if (expect) {
        this.arc(c, cx, cy, RA - u(9), (expect.p25 / scale) * TAU, Math.min(1, expect.p75 / scale) * TAU, rgba(INK.dim, 0.6 * fade), u(3))
        const angle = (expect.p50 / scale) * TAU - Math.PI / 2
        c.strokeStyle = rgba(INK.soft, fade)
        c.lineWidth = 1.5
        c.beginPath()
        c.moveTo(cx + Math.cos(angle) * (RA - u(15)), cy + Math.sin(angle) * (RA - u(15)))
        c.lineTo(cx + Math.cos(angle) * (RA - u(3)), cy + Math.sin(angle) * (RA - u(3)))
        c.stroke()
        if (turn.live) usual = elapsed > expect.p75 ? `×${(elapsed / expect.p50).toFixed(1)} the usual` : `usually ${spanOf(expect.p50)}`
      }
      this.arc(c, cx, cy, RA, 0, Math.min(0.999, elapsed / scale) * TAU, rgba(color, fade), u(4))
      const longest = Math.log10(600e3)
      for (const step of session.steps) {
        if (step.start < turn.start - 500 || step.start > turn.end) continue
        const angle = clamp((step.start - turn.start) / scale, 0, 0.999) * TAU - Math.PI / 2
        c.fillStyle = rgba(INK.text, fade)
        c.beginPath()
        c.arc(cx + Math.cos(angle) * RA, cy + Math.sin(angle) * RA, u(2.2), 0, TAU)
        c.fill()
        for (const tool of step.tools) {
          const at = clamp((tool.start - turn.start) / scale, 0, 0.999) * TAU - Math.PI / 2
          const span = Math.max(1, (tool.end ?? now) - tool.start)
          const reach = u(5) + (Math.min(longest, Math.log10(span)) / longest) * u(30)
          const running = tool.end === null && turn.live
          c.strokeStyle = tool.status === "error" ? rgba(INK.bad, fade) : rgba(PORT_COLOR[portOf(tool.name)], (running ? 1 : 0.8) * fade)
          c.lineWidth = running ? 3 : 2
          c.beginPath()
          c.moveTo(cx + Math.cos(at) * (RA + u(7)), cy + Math.sin(at) * (RA + u(7)))
          c.lineTo(cx + Math.cos(at) * (RA + u(7) + reach), cy + Math.sin(at) * (RA + u(7) + reach))
          c.stroke()
        }
      }
    }

    // ring B: the context window
    c.strokeStyle = INK.ghost
    c.lineWidth = 1
    c.beginPath()
    c.arc(cx + 0.5, cy + 0.5, RB, 0, TAU)
    c.stroke()
    const limit = session.context.limit
    const used = session.context.used
    if (limit && used) this.arc(c, cx, cy, RB, 0, clamp(used / limit, 0.004, 1) * TAU, rgba(INK.soft, 0.75), u(7))

    // the bloom: one dot per so many output tokens of this turn, laid out as a seed head
    const out = session.turn?.out ?? session.lastOut ?? 0
    const unit = this.bloomUnit(out)
    const dots = Math.floor(out / unit)
    let seen = this.bloomSeen.get(session.id)
    if (!seen || seen.turn !== (session.turn?.start ?? 0)) {
      seen = { turn: session.turn?.start ?? 0, dots, from: dots, at: 0 }
      this.bloomSeen.set(session.id, seen)
    }
    if (dots > seen.dots) {
      seen.from = seen.dots
      seen.at = now
    }
    seen.dots = dots
    const spacing = (core.r1 * core.r1 - core.r0 * core.r0) / 560
    const fresh = now - seen.at < 700
    for (let index = 0; index < dots; index += 1) {
      const radius = Math.sqrt(core.r0 * core.r0 + spacing * (index + 0.5))
      if (radius > core.r1 + u(4)) break
      const angle = index * GOLDEN
      const hot = fresh && index >= seen.from
      c.fillStyle = hot ? "#ffffff" : rgba(color, working ? 0.92 : 0.4)
      c.beginPath()
      c.arc(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius, hot ? u(3.1) : u(2.2), 0, TAU)
      c.fill()
    }

    // centre: what it is doing and for how long
    const phase = session.phase
    const tone = { thinking: INK.live, writing: INK.live, calling: INK.live, tool: phase.tools[0] ? PORT_COLOR[portOf(phase.tools[0].name)] : INK.live, waiting: INK.warn, failed: INK.bad }[phase.key] ?? INK.dim
    let word = STATE_WORD[phase.key] ?? phase.key.toUpperCase()
    if (phase.key === "tool") word = `RUNNING ${phase.tools.length > 1 ? `${phase.tools.length} TOOLS` : clean(phase.tools[0].name.replace(/^mcp__.+?__/, "")).toUpperCase().slice(0, 14)}`
    this.label(c, word, cx, cy - u(36), tone, "center", 13)
    const big = session.turn ? timerOf(now - session.turn.start) : agoOf(now - (session.idleSince || session.updated))
    this.text(c, big, cx, cy + u(24), { size: 74, family: FAMILY.display, color: session.turn ? INK.text : INK.soft, align: "center" })
    this.text(c, session.turn ? usual || "no usual yet" : "since it last worked", cx, cy + u(50), { size: 12.5, color: INK.dim, align: "center" })

    // under the instrument, when the stage has the room: what this turn was made of
    const listTop = cy + frame + u(44)
    const lineH = u(25)
    const room = G.stage.y + G.stage.h - u(20) - listTop
    if (turn && !G.wide && room >= lineH * 3) {
      const tally = new Map()
      let calls = 0
      for (const step of session.steps) {
        if (step.start < turn.start - 500 || step.start > turn.end) continue
        calls += 1
        for (const tool of step.tools) {
          const id = portOf(tool.name)
          const entry = tally.get(id) ?? { count: 0, ms: 0, failed: 0 }
          entry.count += 1
          entry.ms += Math.max(0, (tool.end ?? now) - tool.start)
          if (tool.status === "error") entry.failed += 1
          tally.set(id, entry)
        }
      }
      const x0 = G.busX + u(34)
      const x1 = G.head.x - u(56)
      const fade = turn.live ? 1 : 0.6
      this.label(c, turn.live ? "THIS TURN" : "LAST TURN", x0, listTop, INK.dim, "left", 11.5)
      const lines = [{ tone: INK.text, round: true, name: "MODEL CALLS", value: String(calls) }]
      for (const port of PORTS) {
        const entry = tally.get(port.id)
        if (entry) lines.push({ tone: PORT_COLOR[port.id], name: port.label, value: `${entry.count}`, note: `${spanOf(entry.ms)}${entry.failed ? `  ·  ${entry.failed} failed` : ""}`, bad: entry.failed > 0 })
      }
      lines.slice(0, Math.floor(room / lineH) - 1).forEach((line, index) => {
        const y = listTop + (index + 1) * lineH + u(4)
        c.fillStyle = rgba(line.tone, fade)
        if (line.round) {
          c.beginPath()
          c.arc(x0 + u(3), y - u(5), u(2.6), 0, TAU)
          c.fill()
        } else c.fillRect(x0 + u(2), y - u(12), u(2), u(13))
        this.text(c, line.name, x0 + u(18), y, { size: 12.5, family: FAMILY.label, weight: "600", color: rgba(INK.soft, fade), spacing: 2.2 })
        this.text(c, line.value, x0 + u(150), y, { size: 14, family: FAMILY.monoMedium, color: rgba(INK.text, fade), align: "right" })
        if (line.note) this.text(c, this.fit(c, line.note, x1 - x0 - u(168), { size: 13 }), x0 + u(168), y, { size: 13, color: line.bad ? mix(INK.dim, INK.bad, 0.5) : rgba(INK.dim, fade) })
      })
    }

    // head: who this is
    const head = G.head
    let y = head.y + u(18)
    this.run(c, head.x, y, [
      [`FOCUS ${String(focus.index + 1).padStart(2, "0")}`, { size: 12.5, family: FAMILY.label, weight: "600", color: INK.live, spacing: 2.6 }],
      [scene.focus.auto ? "   FOLLOWING THE ACTION" : "   LOCKED   ·   A TO FOLLOW", { size: 12.5, family: FAMILY.label, weight: "600", color: INK.dim, spacing: 2.6 }],
    ])
    y += u(52)
    const titleStyle = { size: 44, family: FAMILY.label, weight: "600", color: INK.text }
    this.text(c, this.fit(c, session.title, head.w, titleStyle), head.x, y, titleStyle)
    y += u(34)
    const small = { size: 15, color: INK.dim }
    const meta = [[shortModel(session.model), { size: 15, family: FAMILY.monoMedium, color }]]
    for (const part of [session.effort, session.agent, session.account, session.pane]) if (part) meta.push([`  ·  ${part}`, small])
    this.run(c, head.x, y, meta)
    y += u(30)
    if (session.prompt) {
      const style = { size: 14.5, color: INK.soft }
      const asked = this.width(c, "asked  ", { size: 14.5 })
      this.text(c, "asked", head.x, y, { size: 14.5, color: INK.faint })
      this.text(c, this.fit(c, session.prompt, head.w - asked, style), head.x + asked, y, style)
    }
    // the numbers behind the instrument
    y += u(44)
    const cells = [
      [turn?.live ? "OUT THIS TURN" : "OUT LAST TURN", out ? `${compactOf(out)} tok` : "–"],
      ["CONTEXT", limit && used ? `${Math.round((used / limit) * 100)}% of ${compactOf(limit)}` : used ? compactOf(used) : "–"],
      ["SPENT", moneyOf(session.cost)],
      ["ONE DOT", `${compactOf(unit)} tok`],
    ]
    let x = head.x
    for (const [name, value] of cells) {
      x = this.run(c, x, y, [
        [`${name}  `, { size: 11.5, family: FAMILY.label, weight: "600", color: INK.dim, spacing: 2.6 }],
        [value, { size: 15, family: FAMILY.monoMedium, color: INK.text }],
      ])
      x += u(40)
    }

    this.drawTail(c, session, color, now)
  }

  // The live tail: what the thread just thought, said and ran, newest at the bottom.
  drawTail(c, session, color, now) {
    const G = this.G
    const u = (value) => this.u(value)
    const box = G.tail
    const size = 16.5
    const lineH = u(28)
    const charW = this.width(c, "M", { size })
    const gutter = u(18)
    // a line of prose stops well short of the timing column, and never runs past a readable measure
    const perLine = Math.max(20, Math.min(116, Math.floor((box.w - gutter - u(90)) / charW)))
    const maxLines = Math.max(2, Math.floor(box.h / lineH))
    this.line(c, box.x, box.y - u(12), box.x + box.w, box.y - u(12), INK.ghost)
    const lines = []
    const items = session.tail ?? []
    items.forEach((item, index) => {
      const newest = index === items.length - 1
      if (item.kind === "tool") {
        const tool = item.tool
        const meta = toolMeta(tool.name)
        const running = tool.end === null && session.state === "working"
        const right = running ? spanOf(now - tool.start) : tool.status === "error" ? "failed" : tool.end !== null ? spanOf(tool.end - tool.start) : ""
        lines.push({ tool, meta, right, rightColor: running ? INK.live : tool.status === "error" ? INK.bad : INK.dim, running })
        return
      }
      // The lines are laid out from the whole text and then filled in as it types, so nothing
      // on screen moves while a block is being revealed.
      const wrapped = wrap(clean(item.text), perLine)
      const most = item.kind === "think" ? Math.max(4, Math.floor(maxLines / 5)) : Math.max(7, Math.floor(maxLines / 3))
      const cut = item.length > item.text.length || wrapped.length > most
      const keep = wrapped.slice(-most)
      if (cut && keep.length) keep[0] = `…${keep[0].slice(1)}`
      const shown = this.shownOf(item)
      const typing = shown < item.text.length
      const total = keep.reduce((sum, value) => sum + value.length, 0)
      let budget = typing ? Math.round((shown / Math.max(1, item.text.length)) * total) : total
      const generating = session.state === "working" && session.phase.key !== "tool"
      keep.forEach((value, at) => {
        const before = budget
        budget -= value.length
        const front = typing && before >= 0 && before < value.length // the line being typed right now
        const last = at === keep.length - 1
        lines.push({ value: value.slice(0, clamp(before, 0, value.length)), kind: item.kind, cursor: front || (!typing && newest && last && generating) })
      })
    })
    if (!lines.length) {
      this.text(c, session.state === "working" ? "waiting for the first words of this step" : "nothing said in the last quarter hour", box.x + gutter, box.y + lineH, { size, color: INK.faint })
      return
    }
    // read downwards from the rule; once the box is full the oldest lines leave at the top
    const view = lines.slice(-maxLines)
    const top = box.y + lineH - u(6)
    view.forEach((line, index) => {
      const y = top + index * lineH
      if (line.tool) {
        const name = line.tool.name.replace(/^mcp__.+?__/, "")
        const rightW = line.right ? this.width(c, line.right, { size: 14.5 }) + u(14) : 0
        c.fillStyle = line.running ? line.meta.color : rgba(line.meta.color, 0.55)
        c.beginPath()
        c.moveTo(box.x + u(2), y - u(11))
        c.lineTo(box.x + u(11), y - u(5.5))
        c.lineTo(box.x + u(2), y)
        c.closePath()
        c.fill()
        const nameStyle = { size, family: FAMILY.monoMedium, color: line.running ? line.meta.color : rgba(line.meta.color, 0.8) }
        this.text(c, name, box.x + gutter, y, nameStyle)
        const nameW = this.width(c, `${name}  `, nameStyle)
        const style = { size, color: line.running ? INK.text : INK.soft }
        this.text(c, this.fit(c, line.tool.label, box.w - gutter - nameW - rightW, style), box.x + gutter + nameW, y, style)
        if (line.right) this.text(c, line.right, box.x + box.w, y, { size: 14.5, family: FAMILY.monoMedium, color: line.rightColor, align: "right" })
        return
      }
      c.fillStyle = line.kind === "say" ? color : rgba(color, 0.32)
      c.fillRect(box.x + u(4), y - u(15), u(2), u(20))
      this.text(c, line.value, box.x + gutter, y, { size, color: line.kind === "say" ? INK.text : INK.dim })
      if (line.cursor) {
        c.fillStyle = INK.live
        c.fillRect(Math.round(box.x + gutter + line.value.length * charW + u(3)), y - u(14), u(8), u(17))
      }
    })
  }

  // ---------------------------------------------------------------- rails (accounts)

  signRails(scene, now) {
    return (scene.world?.accounts ?? []).map((account) => `${account.name}:${Math.round(account.five?.used ?? -1)}:${Math.round(account.seven?.used ?? -1)}:${account.five?.resetsAt ?? 0}:${Math.floor(now / 60e3)}`).join("|")
  }

  drawRails(c, scene, now) {
    const G = this.G
    const u = (value) => this.u(value)
    this.label(c, "ACCOUNTS", G.circuit.x + G.M, G.circuit.y + u(36))
    for (const rail of G.rails) {
      const account = scene.world.accounts.find((candidate) => candidate.name === rail.name)
      const five = account?.five
      const height = G.railBottom - G.railTop
      // the track, and what is left of the five hour window standing in it like fuel
      this.line(c, rail.x, G.railTop, rail.x, G.railBottom, INK.ghost, 1)
      const left = five && five.used !== null ? clamp(1 - five.used / 100, 0, 1) : null
      if (left !== null) {
        const top = G.railBottom - Math.round(height * left)
        const tone = left < 0.12 ? INK.bad : left < 0.3 ? INK.warn : INK.soft
        c.fillStyle = tone
        c.fillRect(rail.x - 1, top, 3, G.railBottom - top)
        this.line(c, rail.x - u(6), top, rail.x + u(7), top, tone, 1)
        // where the level would stand at an even pace
        if (five.resetsAt) {
          const gone = clamp(1 - (five.resetsAt - now) / five.span, 0, 1)
          const pace = G.railBottom - Math.round(height * (1 - gone))
          c.fillStyle = INK.live
          c.beginPath()
          c.moveTo(rail.x - u(5), pace)
          c.lineTo(rail.x - u(12), pace - u(4))
          c.lineTo(rail.x - u(12), pace + u(4))
          c.closePath()
          c.fill()
        }
      }
      // name, written down the rail
      c.save()
      c.translate(rail.x + u(11), G.railTop + u(4))
      c.rotate(Math.PI / 2)
      this.label(c, `${rail.name.toUpperCase()}${account?.tier ? `   ${account.tier.toUpperCase()}` : ""}`, 0, 0, INK.dim, "left", 11.5)
      c.restore()
      const cx = rail.x + 1
      this.text(c, left === null ? "–" : `${Math.round(left * 100)}%`, cx, G.railBottom + u(26), { size: 14.5, family: FAMILY.monoMedium, color: left !== null && left < 0.12 ? INK.bad : left !== null && left < 0.3 ? INK.warn : INK.text, align: "center" })
      this.text(c, "5h left", cx, G.railBottom + u(44), { size: 11, color: INK.dim, align: "center" })
      const seven = account?.seven
      if (seven && seven.used !== null) this.text(c, `7d ${Math.round(100 - seven.used)}%`, cx, G.railBottom + u(62), { size: 11, color: INK.faint, align: "center" })
    }
  }

  drawCircuitLabels(c, scene) {
    const G = this.G
    const u = (value) => this.u(value)
    const x = G.rows[0]?.somaX ?? G.railsRight + u(80)
    const end = this.run(c, x - u(8), G.circuit.y + u(36), [
      ["THREADS", { size: 12.5, family: FAMILY.label, weight: "600", color: INK.dim, spacing: 2.6 }],
      [`   ${scene.rows.length}`, { size: 13, family: FAMILY.monoMedium, color: INK.soft }],
    ])
    if (scene.hidden) this.text(c, `${scene.hidden} more active, not shown`, end + u(18), G.circuit.y + u(36), { size: 12.5, color: INK.warn })
  }

  drawRest(c, scene) {
    if (scene.rows.length) return
    const G = this.G
    this.text(c, "no sessions in the last day", G.railsRight + this.u(80), G.rowsTop + this.u(40), { size: 16, color: INK.faint })
  }

  // ---------------------------------------------------------------- rows (threads)

  liveOf(session, now) {
    if (session.state === "waiting") return { kind: "wait" }
    if (session.state !== "working") return null
    const tool = session.phase.tools[0]
    if (tool) return { kind: "tool", tool, more: session.phase.tools.length - 1 }
    const tail = session.tail ?? []
    for (let index = tail.length - 1; index >= 0; index -= 1) if (tail[index].kind !== "tool") return { kind: tail[index].kind, item: tail[index] }
    return { kind: "none" }
  }

  signRow(g, scene, now) {
    const session = g.row.session
    const parts = [session.state, session.phase.key, session.title, session.model, session.effort, session.agent, session.pane, session.cost.toFixed(2), session.context.used, scene.focus.id === session.id, g.row.index]
    if (session.turn) parts.push(Math.floor((now - session.turn.start) / 1000))
    else parts.push(Math.floor((now - (session.idleSince || session.updated)) / 60e3))
    const live = g.live ? this.liveOf(session, now) : null
    if (live?.kind === "tool") parts.push(live.tool.id, live.more, now - live.tool.start < 10e3 ? Math.floor(now / 100) : Math.floor(now / 1000))
    else if (live?.item) parts.push(live.item.key, this.shownOf(live.item))
    return parts.join("|")
  }

  drawRow(c, g, scene, now) {
    const G = this.G
    const u = (value) => this.u(value)
    const session = g.row.session
    const color = modelColor(session.model, session.provider)
    const working = session.state === "working"
    const waiting = session.state === "waiting"
    const focused = scene.focus.id === session.id
    const { somaX, axonY } = g

    // the cell body
    if (working || waiting) {
      const tone = waiting ? INK.warn : color
      c.strokeStyle = tone
      c.lineWidth = 2
      c.beginPath()
      c.arc(somaX + 0.5, axonY + 0.5, g.r, 0, TAU)
      c.stroke()
      const fill = session.context.limit ? clamp(session.context.used / session.context.limit, 0, 1) : 0.3
      c.fillStyle = tone
      c.beginPath()
      c.arc(somaX + 0.5, axonY + 0.5, u(3.5) + fill * (g.r - u(6.5)), 0, TAU)
      c.fill()
    } else {
      const tone = session.state === "failed" ? INK.bad : session.state === "stalled" ? INK.dim : INK.faint
      c.strokeStyle = tone
      c.lineWidth = 1.5
      if (session.state === "stalled") c.setLineDash([u(3), u(3)])
      c.beginPath()
      c.arc(somaX + 0.5, axonY + 0.5, g.r, 0, TAU)
      c.stroke()
      c.setLineDash([])
    }
    if (focused) {
      const reach = g.r + u(8)
      const arm = u(6)
      c.strokeStyle = INK.live
      c.lineWidth = 1.5
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        c.beginPath()
        c.moveTo(somaX + 0.5 + sx * reach, axonY + 0.5 + sy * (reach - arm))
        c.lineTo(somaX + 0.5 + sx * reach, axonY + 0.5 + sy * reach)
        c.lineTo(somaX + 0.5 + sx * (reach - arm), axonY + 0.5 + sy * reach)
        c.stroke()
      }
    }

    // right side of the title line: how long
    const titleY = g.y + (g.slim ? u(26) : g.live ? u(36) : u(32))
    let right = ""
    let rightStyle = { size: 14.5, color: INK.dim, align: "right" }
    if (working) {
      right = timerOf(now - session.turn.start)
      rightStyle = { size: 19, family: FAMILY.monoMedium, color: INK.text, align: "right" }
    } else if (waiting) {
      right = `waiting ${agoOf(now - (session.idleSince || session.updated))}`
      rightStyle = { size: 15, family: FAMILY.monoMedium, color: INK.warn, align: "right" }
    } else if (session.state === "stalled") right = `silent ${agoOf(now - session.last)}`
    else right = `${session.state === "failed" ? "failed" : "idle"} ${agoOf(now - (session.idleSince || session.updated))}`
    this.text(c, right, g.textRight, titleY, rightStyle)
    const rightW = this.width(c, right, rightStyle) + u(22)

    // index and title
    const index = String(g.row.index + 1).padStart(2, "0")
    this.text(c, index, g.textX, titleY, { size: 13, color: focused ? INK.live : INK.faint })
    const titleX = g.textX + u(30)
    const titleStyle = { size: g.slim ? 21 : 25, family: FAMILY.label, weight: "600", color: working || waiting || focused ? INK.text : INK.soft }
    this.text(c, this.fit(c, session.title, g.textRight - titleX - rightW, titleStyle), titleX, titleY, titleStyle)
    if (g.slim) return

    // meta line
    const metaY = titleY + u(25)
    const small = { size: 14, color: INK.dim }
    const meta = [[shortModel(session.model), { size: 14, family: FAMILY.monoMedium, color: working || waiting ? color : rgba(color, 0.7) }]]
    for (const part of [session.effort, session.agent, session.pane, moneyOf(session.cost)]) if (part) meta.push([`  ·  ${part}`, small])
    if (session.context.limit && session.context.used) meta.push([`  ·  ctx ${Math.round((session.context.used / session.context.limit) * 100)}%`, small])
    this.run(c, titleX, metaY, meta)
    if (working) {
      const phase = session.phase
      const word = phase.key === "tool" ? "" : `${phase.key === "calling" ? "calling the model" : phase.key} ${spanOf(Math.max(0, now - (phase.since ?? now))).replace(/ms$/, "ms")}`
      if (word) this.text(c, word, g.textRight, metaY, { size: 14, color: INK.live, align: "right" })
    }
    if (!g.live) return

    // the live line: the thread's own words, or the command it is running
    const liveY = metaY + u(26)
    const live = this.liveOf(session, now)
    const size = 15
    const room = g.textRight - titleX
    if (!live) return
    if (live.kind === "wait") {
      this.text(c, "it asked you something and is waiting for the answer", titleX, liveY, { size, color: INK.warn })
    } else if (live.kind === "tool") {
      const tool = live.tool
      const meta2 = toolMeta(tool.name)
      const name = tool.name.replace(/^mcp__.+?__/, "")
      const timer = spanOf(now - tool.start)
      const timerW = this.width(c, timer, { size, family: FAMILY.monoMedium }) + u(16)
      const nameStyle = { size, family: FAMILY.monoMedium, color: meta2.color }
      this.text(c, name, titleX, liveY, nameStyle)
      const nameW = this.width(c, `${name}  `, nameStyle)
      const more = live.more > 0 ? `  +${live.more}` : ""
      const style = { size, color: INK.soft }
      this.text(c, this.fit(c, `${tool.label}${more}`, room - nameW - timerW, style), titleX + nameW, liveY, style)
      this.text(c, timer, g.textRight, liveY, { size, family: FAMILY.monoMedium, color: INK.live, align: "right" })
    } else if (live.item) {
      const charW = this.width(c, "M", { size })
      const perLine = Math.max(10, Math.floor(room / charW) - 2)
      // the end of what it said, typed in place: the window is fixed, the characters fill it
      const body = clean(live.item.text)
      const window = body.length > perLine ? `…${body.slice(-(perLine - 1))}` : body
      const part = live.item.text.length ? this.shownOf(live.item) / live.item.text.length : 1
      const value = part >= 1 ? window : window.slice(0, Math.round(part * window.length))
      c.fillStyle = live.kind === "say" ? color : rgba(color, 0.4)
      c.fillRect(titleX, liveY - u(13), u(2), u(17))
      this.text(c, value, titleX + u(12), liveY, { size, color: live.kind === "say" ? INK.text : INK.dim })
    } else {
      this.text(c, "waiting for the first words of this step", titleX, liveY, { size, color: INK.faint })
    }
  }

  // ---------------------------------------------------------------- ports

  signPorts(scene, now) {
    const parts = []
    for (const port of scene.ports.values()) parts.push(port.id, port.inflight, port.count, port.errors, Math.round(port.p50 / 100))
    return parts.join("|")
  }

  drawPorts(c, scene, now) {
    const G = this.G
    const u = (value) => this.u(value)
    this.label(c, "ACTS ON", G.portX - u(7), G.circuit.y + u(36))
    for (const port of scene.ports.values()) {
      const spot = G.ports.get(port.id)
      const color = PORT_COLOR[port.id]
      const hot = port.inflight > 0
      const tone = port.id === "you" && hot ? INK.warn : color
      c.lineWidth = 1.5
      c.strokeStyle = hot ? tone : port.count ? INK.dim : INK.faint
      c.beginPath()
      c.arc(spot.x + 0.5, spot.y + 0.5, u(7), 0, TAU)
      c.stroke()
      if (hot) {
        c.fillStyle = tone
        c.beginPath()
        c.arc(spot.x + 0.5, spot.y + 0.5, u(3.5), 0, TAU)
        c.fill()
      }
      const x = spot.x + u(24)
      const end = this.run(c, x, spot.y + u(6), [[port.label, { size: 17, family: FAMILY.label, weight: "600", color: hot ? INK.text : port.count ? INK.soft : INK.dim, spacing: 2.4 }]])
      if (hot) this.text(c, port.id === "you" ? `${port.inflight} waiting` : `${port.inflight} in flight`, end + u(14), spot.y + u(6), { size: 14, family: FAMILY.monoMedium, color: tone })
      let stats = port.note
      if (port.count) {
        stats = `${port.count} call${port.count === 1 ? "" : "s"}`
        if (port.p50) stats += `  ·  ${spanOf(port.p50)}`
        if (port.errors) stats += `  ·  ${port.errors} failed`
      }
      this.text(c, stats, x, spot.y + u(28), { size: 12.5, color: port.errors ? mix(INK.dim, INK.bad, 0.45) : port.count ? INK.dim : INK.faint })
    }
  }

  // ---------------------------------------------------------------- footer

  signFooter(scene, now) {
    const parts = [scene.waiting.length, Math.floor(now / 10e3), scene.log[0]?.key, scene.log[0]?.span, scene.focus.id]
    for (const pane of scene.world?.panes ?? []) parts.push(`${pane.id}${pane.status[0]}${pane.row}`)
    return parts.join("|")
  }

  drawFooter(c, scene, now) {
    const G = this.G
    const u = (value) => this.u(value)
    const F = G.footer
    const M = G.M
    this.line(c, F.x + M, F.y, F.x + F.w - M, F.y, INK.ghost)
    const colW = Math.floor((F.w - 2 * M) / 3)
    // waiting on you
    let x = F.x + M
    let y = F.y + u(34)
    this.label(c, "WAITING ON YOU", x, y, scene.waiting.length ? INK.warn : INK.dim)
    if (!scene.waiting.length) this.text(c, "nobody is waiting on you", x, y + u(30), { size: 14.5, color: INK.faint })
    scene.waiting.slice(0, 4).forEach((pane, index) => {
      const lineY = y + u(30) + index * u(25)
      const style = { size: 14.5, color: INK.text }
      const id = `${pane.id}  `
      this.text(c, id, x, lineY, { size: 14.5, family: FAMILY.monoMedium, color: INK.warn })
      const idW = this.width(c, id, { size: 14.5, family: FAMILY.monoMedium })
      const since = pane.since ? agoOf(now - pane.since) : ""
      const sinceW = this.width(c, since, { size: 13 }) + u(26)
      this.text(c, this.fit(c, pane.title || pane.kind, colW - idW - sinceW, style), x + idW, lineY, style)
      this.text(c, since, x + colW - u(26), lineY, { size: 13, color: INK.dim, align: "right" })
    })
    // every herdr pane, by workspace
    x = F.x + M + colW
    const panes = scene.world?.panes ?? []
    this.run(c, x, y, [
      ["PANES", { size: 12.5, family: FAMILY.label, weight: "600", color: INK.dim, spacing: 2.6 }],
      [`   ${panes.length}`, { size: 13, family: FAMILY.monoMedium, color: INK.soft }],
    ])
    const side = u(17)
    const gap = u(6)
    let px = x
    let py = y + u(16)
    let workspace = null
    const rowH = side + u(11)
    for (const pane of panes) {
      if (pane.workspace !== workspace) {
        workspace = pane.workspace
        const nameW = this.width(c, workspace, { size: 11.5 }) + u(8)
        if (px + nameW + side > x + colW - u(30)) {
          px = x
          py += rowH
        }
        if (px > x) px += u(10)
        this.text(c, workspace, px, py + side - u(3), { size: 11.5, color: INK.faint })
        px += nameW
      }
      if (px + side > x + colW - u(30)) {
        px = x
        py += rowH
      }
      if (py + side > F.y + F.h - u(34)) break
      const tone = pane.status === "working" ? INK.live : pane.status === "blocked" ? INK.warn : pane.status === "done" ? INK.good : null
      if (tone && pane.status !== "done") {
        c.fillStyle = tone
        c.fillRect(px, py, side, side)
      } else {
        c.strokeStyle = tone ?? (pane.row >= 0 ? INK.dim : INK.faint)
        c.lineWidth = 1
        c.strokeRect(px + 0.5, py + 0.5, side - 1, side - 1)
      }
      if (pane.sessionId && pane.sessionId === scene.focus.id) {
        c.strokeStyle = INK.text
        c.lineWidth = 1
        c.strokeRect(px - 2.5, py - 2.5, side + 4, side + 4)
      }
      px += side + gap
    }
    // the last things that happened, anywhere
    x = F.x + M + 2 * colW
    this.label(c, "JUST NOW", x, y)
    scene.log.slice(0, 4).forEach((entry, index) => {
      const lineY = y + u(30) + index * u(25)
      const row = scene.rowOf?.get(entry.sid)
      const tone = entry.tone === "bad" ? INK.bad : entry.tone === "warn" ? INK.warn : entry.tone === "ok" ? INK.good : entry.tone === "run" ? INK.live : INK.soft
      const lead = `${clockOf(entry.at).slice(0, 8)}  ${row ? String(row.index + 1).padStart(2, "0") : "··"}  `
      this.text(c, lead, x, lineY, { size: 13, color: INK.faint })
      const leadW = this.width(c, lead, { size: 13 })
      const name = `${entry.name.replace(/^mcp__.+?__/, "")}  `
      this.text(c, name, x + leadW, lineY, { size: 13, family: FAMILY.monoMedium, color: tone })
      const nameW = this.width(c, name, { size: 13, family: FAMILY.monoMedium })
      const span = entry.span === null ? (entry.tone === "run" ? "running" : "") : spanOf(entry.span)
      const spanW = span ? this.width(c, span, { size: 13 }) + u(12) : 0
      const style = { size: 13, color: INK.dim }
      this.text(c, this.fit(c, clean(entry.detail), colW - leadW - nameW - spanW, style), x + leadW + nameW, lineY, style)
      if (span) this.text(c, span, x + colW, lineY, { size: 13, color: entry.tone === "run" ? INK.live : INK.dim, align: "right" })
    })
    // what the marks mean, and the keys
    const legendY = F.y + F.h - u(16)
    this.text(c, "pulse in: a model call   ·   tick: one call, drifting   ·   pulse out and back: a tool call and its result   ·   comet: writing now", F.x + M, legendY, { size: 11.5, color: INK.faint })
    this.text(c, "j k focus   a follow   d demo   p sprites   s shot   q quit", F.x + F.w - M, legendY, { size: 11.5, color: INK.faint, align: "right" })
  }

  // ---------------------------------------------------------------- the moving layer

  // Sprites whose place follows from state and the clock: ticks drifting along axons, the comet
  // around a cell body that is writing, the head of the turn ring.
  sprites(scene, now, out) {
    const G = this.G
    if (!G?.rows) return
    const u = (value) => this.u(value)
    for (const g of G.rows) {
      const session = g.row.session
      const hex = spriteHex(modelColor(session.model, session.provider))
      const from = g.somaX + g.r + u(4)
      const reach = G.termX - u(6) - from
      const horizon = now - (reach / G.speed) * 1000
      for (const step of session.steps) {
        const at = step.streamed ?? step.items[0]?.at ?? null
        if (at !== null && at > horizon && at <= now) {
          const wrote = step.out || step.chars / 3.6
          out.push({ key: `k:${g.sid}:${step.seq}`, kind: `${wrote > 900 ? "bar3" : wrote > 150 ? "bar2" : "bar1"}|${hex}`, x: from + ((now - at) / 1000) * G.speed, y: g.axonY })
        }
        for (const tool of step.tools) {
          if (tool.start <= horizon || tool.start > now) continue
          const tone = tool.status === "error" ? INK.bad : spriteHex(PORT_COLOR[portOf(tool.name)])
          out.push({ key: `t:${tool.id}`, kind: `pip|${tone}`, x: from + ((now - tool.start) / 1000) * G.speed, y: g.axonY })
        }
      }
      if (session.state === "working" && session.phase.key !== "tool") this.comet(out, `c:${g.sid}`, g.somaX, g.axonY, g.r + u(8), this.theta.get(g.sid) ?? 0, hex, 3, 0.42)
    }
    const focus = scene.focused
    if (focus) {
      const session = focus.session
      const core = G.core
      const hex = spriteHex(modelColor(session.model, session.provider))
      if (session.turn) {
        const elapsed = now - session.turn.start
        const angle = Math.min(0.999, elapsed / this.turnScale(session, elapsed)) * TAU - Math.PI / 2
        out.push({ key: "ring-head", kind: `pulse|${hex}`, x: core.cx + Math.cos(angle) * core.RA, y: core.cy + Math.sin(angle) * core.RA })
      }
      if (session.state === "working" && session.phase.key !== "tool") this.comet(out, "core", core.cx, core.cy, (core.r1 + core.RB) / 2 + u(1), this.theta.get(session.id) ?? 0, hex, 7, 0.085, true)
    }
  }

  comet(out, key, x, y, radius, theta, hex, tail, step, big = false) {
    out.push({ key, kind: `${big ? "pulse" : "dot"}|${hex}`, x: x + Math.cos(theta) * radius, y: y + Math.sin(theta) * radius })
    for (let segment = 1; segment <= tail; segment += 1) {
      const angle = theta - segment * step
      out.push({ key: `${key}.${segment}`, kind: `${segment <= Math.ceil(tail / 2) ? "tail" : "mote"}|${hex}`, x: x + Math.cos(angle) * radius, y: y + Math.sin(angle) * radius })
    }
  }

  // Turns what just happened into pulses, and what is in flight into streams.
  react(scene, signals, now) {
    const G = this.G
    const flow = this.flow
    const u = (value) => this.u(value)
    for (const signal of signals) {
      const g = G.rowOf?.get(signal.sid)
      if (!g) continue
      const session = g.row.session
      const hex = spriteHex(modelColor(session.model, session.provider))
      const tailKind = `tail|${hex}`
      if (signal.type === "call") {
        flow.pulse({ path: `in:${signal.sid}`, kind: `pulse|${hex}`, tailKind, tail: 5, speed: u(1500), flash: hex, now })
      } else if (signal.type === "tokens") {
        const count = clamp(Math.ceil(signal.tokens / 500), 1, 6)
        for (let index = 0; index < count; index += 1) flow.pulse({ path: `focus:${signal.sid}`, kind: `dot|${hex}`, tailKind: `mote|${hex}`, tail: 2, speed: u(1300), delay: index * 70, now })
      } else if (signal.type === "tool-start") {
        const tone = spriteHex(PORT_COLOR[signal.port])
        if (signal.port === "agent" && this.childOf(scene, signal.sid)) continue
        flow.pulse({ path: `out:${signal.sid}:${signal.port}`, kind: `pulse|${tone}`, tailKind: `tail|${tone}`, tail: 5, speed: u(1500), now })
      } else if (signal.type === "tool-end") {
        const tone = signal.failed ? INK.bad : spriteHex(PORT_COLOR[signal.port])
        if (signal.port === "agent" && this.childOf(scene, signal.sid)) continue
        flow.pulse({ path: `back:${signal.sid}:${signal.port}`, kind: `pulse|${tone}`, tailKind: `tail|${tone}`, tail: 5, speed: u(1500), delay: 120, flash: tone, now })
      } else if (signal.type === "speak") {
        const count = clamp(Math.ceil(signal.chars / 320), 1, 5)
        for (let index = 0; index < count; index += 1) flow.pulse({ path: `out:${signal.sid}:you`, kind: `dot|${INK.text}`, tailKind: `mote|${INK.text}`, tail: 3, speed: u(1100), delay: index * 110, now })
      } else if (signal.type === "turn-start") {
        if (!g.row.parent) flow.pulse({ path: `back:${signal.sid}:you`, kind: `pulse|${INK.text}`, tailKind: `tail|${INK.text}`, tail: 5, speed: u(1400), flash: hex, now })
      } else if (signal.type === "turn-end") {
        flow.flash(g.somaX, g.axonY, signal.failed ? INK.bad : INK.good, now, 900)
      } else if (signal.type === "dispatch") {
        flow.pulse({ path: `kid:${signal.sid}`, kind: `pulse|${PORT_COLOR.agent}`, tailKind: `tail|${PORT_COLOR.agent}`, tail: 5, speed: u(700), flash: hex, now })
      } else if (signal.type === "report") {
        const tone = signal.failed ? INK.bad : INK.good
        flow.pulse({ path: `kidback:${signal.sid}`, kind: `pulse|${tone}`, tailKind: `tail|${tone}`, tail: 5, speed: u(700), flash: tone, now })
      } else if (signal.type === "wait") {
        flow.pulse({ path: `out:${signal.sid}:you`, kind: `pulse|${INK.warn}`, tailKind: `tail|${INK.warn}`, tail: 5, speed: u(900), now })
      }
    }
    const streams = []
    for (const stream of scene.streams) {
      if (stream.type === "tool") streams.push({ key: stream.key, path: `syn:${stream.sid}:${stream.port}`, kind: `tail|${spriteHex(PORT_COLOR[stream.port])}`, speed: u(64), gap: u(34) })
      else if (stream.type === "kid") streams.push({ key: stream.key, path: `kid:${stream.sid}`, kind: `tail|${PORT_COLOR.agent}`, speed: u(40), gap: u(26) })
      else if (stream.type === "wait") streams.push({ key: stream.key, path: `syn:${stream.sid}:you`, kind: `tail|${INK.warn}`, speed: u(30), gap: u(46) })
    }
    flow.setStreams(streams, now)
  }

  childOf(scene, sid) {
    return scene.rows.some((row) => row.parent?.session.id === sid && row.session.state === "working")
  }

  // ---------------------------------------------------------------- output

  // The frame as one opaque picture: the still layer and the sprites over the pane's own colour.
  flatten(background, sprites, atlas) {
    const canvas = createCanvas(this.W, this.H)
    const context = canvas.getContext("2d")
    context.fillStyle = background
    context.fillRect(0, 0, this.W, this.H)
    context.drawImage(this.canvas, 0, 0)
    for (const sprite of sprites) atlas.draw(context, sprite.kind, sprite.x, sprite.y)
    return canvas
  }
}

function wrap(text, width) {
  const lines = []
  let rest = text
  while (rest.length > width) {
    let cut = rest.lastIndexOf(" ", width)
    if (cut < width * 0.6) cut = width
    lines.push(rest.slice(0, cut))
    rest = rest.slice(cut).trimStart()
  }
  if (rest.length) lines.push(rest)
  return lines
}
