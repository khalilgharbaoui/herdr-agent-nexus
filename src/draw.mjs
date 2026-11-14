// The renderer. Two layers: a slow one (everything that only changes when data arrives or the
// timeline steps one pixel) kept in an offscreen canvas, and a fast one drawn over it every
// frame (write heads, running hatches, pulses, timers, the clock). Nothing paints a backdrop:
// every pixel that is not ink stays transparent, so the terminal's own dark shows through.

import { createCanvas } from "@napi-rs/canvas"
import { FAMILY, INK, TAU, agoOf, clamp, clockOf, compactOf, dayOf, fontOf, hashUnit, hourMinuteOf, mix, modelColor, moneyOf, rgba, shortModel, spanOf, timerOf, toolMeta } from "./util.mjs"

const DARK = "#05080c"
const TOOL_TONE = { write: INK.text, exec: "#9db2c9", web: "#7fa6c9", read: "#5c7087", search: "#5c7087", meta: "#5c7087", other: "#71869e", agent: INK.soft, ask: INK.warn }
const FUTURE_TAU = 30e3
const FUTURE_SPAN = 3600e3
const FUTURE_TICKS = [
  [60e3, "+1m"],
  [300e3, "+5m"],
  [1200e3, "+20m"],
  [3600e3, "+1h"],
]

export class Renderer {
  constructor() {
    this.W = 0
    this.H = 0
    this.S = 1
    this.fits = new Map()
    this.lastStep = -1
    this.lastWorld = null
    this.spots = this.emptySpots()
  }

  emptySpots() {
    return { heads: [], live: [], timers: [], glyphs: [], tiles: [], logRows: [], lanes: new Map(), rails: new Map(), forks: new Map() }
  }

  resize(width, height, cellHeight) {
    if (width === this.W && height === this.H) return
    this.W = width
    this.H = height
    this.S = clamp(cellHeight / 30, 0.4, 3)
    this.canvas = createCanvas(width, height)
    this.context = this.canvas.getContext("2d")
    this.slowCanvas = createCanvas(width, height)
    this.slow = this.slowCanvas.getContext("2d")
    this.lastWorld = null
    this.fits.clear()
    this.layout()
  }

  u(value) {
    return Math.round(value * this.S)
  }

  layout() {
    const { W, H } = this
    const u = (value) => this.u(value)
    const M = u(30)
    const wide = W / this.S >= 2400
    const L = { M, wide }
    L.header = { x: M, y: u(22), w: W - 2 * M, h: u(176) }
    const cols = wide ? 4 : 2
    const rows = wide ? 1 : 2
    const gap = u(34)
    const panelH = wide ? u(540) : u(404)
    const panelsTop = H - u(26) - rows * panelH - (rows - 1) * gap
    const panelW = Math.floor((W - 2 * M - (cols - 1) * gap) / cols)
    const names = wide ? ["panes", "tools", "log", "accounts"] : ["panes", "accounts", "tools", "log"]
    L.panels = {}
    names.forEach((name, index) => {
      L.panels[name] = { x: M + (index % cols) * (panelW + gap), y: panelsTop + Math.floor(index / cols) * (panelH + gap), w: panelW, h: panelH }
    })
    L.score = { x: M, y: L.header.y + L.header.h + u(20), w: W - 2 * M }
    L.score.h = panelsTop - u(44) - L.score.y
    L.gutterL = wide ? u(560) : u(404)
    L.gutterR = u(236)
    L.future = wide ? u(280) : u(150)
    L.pastX = M + L.gutterL
    L.nowX = W - M - L.gutterR - L.future
    L.pastW = L.nowX - L.pastX
    L.futureEnd = L.nowX + L.future
    L.rulerH = u(46)
    L.rulerY = L.score.y + L.rulerH
    L.masterH = u(92)
    L.lanesTop = L.rulerY + u(12)
    L.masterY = L.score.y + L.score.h - L.masterH
    L.lanesBottom = L.masterY - u(22)
    L.pps = (wide ? 3 : 1.5) * this.S
    L.windowMs = (L.pastW / L.pps) * 1000
    L.capacity = Math.max(3, Math.floor((L.lanesBottom - L.lanesTop) / u(60)))
    this.L = L
  }

  // ---------------------------------------------------------------- primitives

  text(c, value, x, y, { size = 18, family = FAMILY.mono, weight = "", color = INK.text, align = "left", spacing = 0 } = {}) {
    c.font = fontOf(size * this.S, family, weight)
    c.letterSpacing = `${(spacing * this.S).toFixed(1)}px`
    c.fillStyle = color
    c.textAlign = align
    c.textBaseline = "alphabetic"
    c.fillText(value, Math.round(x), Math.round(y))
  }

  width(c, value, { size = 18, family = FAMILY.mono, weight = "", spacing = 0 } = {}) {
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

  rect(c, x, y, w, h, color) {
    c.fillStyle = color
    c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h))
  }

  frame(c, x, y, w, h, color, line = 1) {
    this.rect(c, x, y, w, line, color)
    this.rect(c, x, y + h - line, w, line, color)
    this.rect(c, x, y + line, line, h - 2 * line, color)
    this.rect(c, x + w - line, y + line, line, h - 2 * line, color)
  }

  dots(c, x0, x1, y, color, on = 2, off = 6) {
    c.fillStyle = color
    for (let x = Math.round(x0); x < x1; x += on + off) c.fillRect(x, Math.round(y), on, 1)
  }

  cross(c, x, y, arm, color) {
    this.rect(c, x - arm, y, arm * 2 + 1, 1, color)
    this.rect(c, x, y - arm, 1, arm * 2 + 1, color)
  }

  micro(c, value, x, y, color = INK.dim, align = "left") {
    this.text(c, value, x, y, { size: 15, family: FAMILY.label, weight: "600", color, spacing: 2.6, align })
  }

  panelHead(c, box, title, note = "") {
    const u = (value) => this.u(value)
    this.micro(c, title, box.x, box.y + u(16), INK.soft)
    if (note) this.text(c, note, box.x + box.w, box.y + u(16), { size: 14, color: INK.dim, align: "right" })
    this.rect(c, box.x, box.y + u(27), box.w, 1, INK.faint)
    const arm = u(7)
    for (const [cx, cy, dx, dy] of [
      [box.x, box.y + box.h, 1, -1],
      [box.x + box.w, box.y + box.h, -1, -1],
    ]) {
      this.rect(c, dx > 0 ? cx : cx - arm, cy - 1, arm, 1, INK.faint)
      this.rect(c, dx > 0 ? cx : cx - 1, cy - arm, 1, arm, INK.faint)
    }
  }

  // ---------------------------------------------------------------- frame

  draw(scene, now, meta) {
    const L = this.L
    scene.capacity = L.capacity
    scene.windowMs = L.windowMs
    const step = Math.floor((now * L.pps) / 1000)
    if (step !== this.lastStep || scene.world !== this.lastWorld) {
      this.lastStep = step
      this.lastWorld = scene.world
      this.spots = this.emptySpots()
      this.slow.clearRect(0, 0, this.W, this.H)
      if (scene.world) this.drawSlow(this.slow, scene, now, step)
    }
    const c = this.context
    c.clearRect(0, 0, this.W, this.H)
    c.drawImage(this.slowCanvas, 0, 0)
    if (scene.world) this.drawFast(c, scene, now, meta)
  }

  drawSlow(c, scene, now, step) {
    const L = this.L
    const time = {
      x: (at) => L.nowX - (step - Math.round((at * L.pps) / 1000)),
      future: (ahead) => L.nowX + Math.round((L.future * Math.log(1 + Math.max(0, ahead) / FUTURE_TAU)) / Math.log(1 + FUTURE_SPAN / FUTURE_TAU)),
    }
    this.header(c, scene, now)
    this.ruler(c, scene, now, time)
    this.lanes(c, scene, now, time)
    this.master(c, scene, now, time)
    this.panes(c, scene, now)
    this.accounts(c, scene, now)
    this.tools(c, scene, now)
    this.log(c, scene, now)
  }

  // ---------------------------------------------------------------- header

  header(c, scene, now) {
    const u = (value) => this.u(value)
    const { header: box, M } = this.L
    const world = scene.world
    const counts = scene.counts
    this.text(c, "AGENT NEXUS", box.x, box.y + u(16), { size: 17, family: FAMILY.label, weight: "700", color: INK.text, spacing: 7 })
    const brand = this.width(c, "AGENT NEXUS", { size: 17, family: FAMILY.label, weight: "700", spacing: 7 })
    this.micro(c, world.mode === "LIVE" ? "LIVE" : "DEMO  SIMULATED DATA", box.x + brand + u(18), box.y + u(16), world.mode === "LIVE" ? INK.live : INK.dim)
    const base = box.y + box.h - u(8)
    const big = { size: 168, family: FAMILY.display, weight: "bold" }
    const working = String(counts.working).padStart(2, "0")
    this.text(c, working, box.x - u(4), base + u(12), { ...big, color: counts.working ? INK.text : INK.faint })
    let x = box.x + this.width(c, working, big) + u(14)
    this.micro(c, "WORKING", x, base - u(84), counts.working ? INK.live : INK.dim)
    this.text(c, `${counts.panes} panes`, x, base - u(54), { size: 16, color: INK.dim })
    this.text(c, counts.stalled ? `${counts.stalled} stalled` : `${scene.lanes.length} lanes`, x, base - u(30), { size: 16, color: INK.dim })
    const mid = { size: 92, family: FAMILY.display, weight: "bold" }
    const block = (left, value, label, color, labelColor) => {
      const shown = String(value).padStart(2, "0")
      this.text(c, shown, left, base + u(6), { ...mid, color })
      this.micro(c, label, left + this.width(c, shown, mid) + u(12), base - u(48), labelColor)
      return left + this.width(c, shown, mid) + u(12)
    }
    x = box.x + u(318)
    const waitX = block(x, counts.waiting, "WAITING", counts.waiting ? INK.warn : INK.faint, counts.waiting ? INK.warn : INK.dim)
    this.micro(c, "ON YOU", waitX, base - u(26), counts.waiting ? INK.warn : INK.dim)
    x = box.x + u(560)
    block(x, counts.idle, "IDLE", INK.dim, INK.dim)
    x = box.x + u(770)
    const value = { size: 30, family: FAMILY.monoMedium, color: INK.text }
    this.micro(c, "OUT / MIN", x, base - u(84))
    this.text(c, compactOf(scene.outPerMinute ?? 0), x, base - u(50), value)
    this.micro(c, "24 H SPEND", x + u(190), base - u(84))
    this.text(c, moneyOf(world.cost24h?.cost ?? 0), x + u(190), base - u(50), value)
    this.text(c, `${world.cost24h?.sessions ?? 0} sessions`, x + u(190), base - u(24), { size: 14, color: INK.dim })
    this.text(c, "tokens, all threads", x, base - u(24), { size: 14, color: INK.dim })
    this.text(c, dayOf(now), box.x + box.w, box.y + u(16), { size: 15, family: FAMILY.label, weight: "600", color: INK.dim, spacing: 2.6, align: "right" })
    this.rect(c, M, box.y + box.h + u(6), this.W - 2 * M, 1, INK.faint)
  }

  // ---------------------------------------------------------------- score

  ruler(c, scene, now, time) {
    const u = (value) => this.u(value)
    const L = this.L
    const y = L.rulerY
    this.micro(c, "THREADS", L.M, y - u(14), INK.soft)
    const label = this.width(c, "THREADS", { size: 15, family: FAMILY.label, weight: "600", spacing: 2.6 })
    this.text(c, `${scene.lanes.length}${scene.hidden ? `  +${scene.hidden} not shown` : ""}`, L.M + label + u(14), y - u(14), { size: 15, color: INK.dim })
    this.rect(c, L.pastX, y, L.futureEnd - L.pastX, 1, INK.faint)
    const first = Math.ceil((now - L.windowMs) / 10e3) * 10e3
    for (let at = first; at <= now; at += 10e3) {
      const x = time.x(at)
      if (x < L.pastX) continue
      const major = at % 60e3 === 0
      this.rect(c, x, y - (major ? u(12) : u(5)), 1, major ? u(12) : u(5), major ? INK.dim : INK.faint)
      if (major && x > L.pastX + u(30) && x < L.nowX - u(124)) this.text(c, hourMinuteOf(at), x + u(6), y - u(14), { size: 15, color: INK.dim })
    }
    for (const [ahead, name] of FUTURE_TICKS) {
      const x = time.future(ahead)
      this.rect(c, x - 1, y - u(8), 1, u(8), INK.faint)
      this.text(c, name, x - u(5), y - u(14), { size: 14, color: INK.dim, align: "right" })
    }
    // the present
    c.fillStyle = INK.live
    c.beginPath()
    c.moveTo(L.nowX - u(7), y - u(12))
    c.lineTo(L.nowX + u(8), y - u(12))
    c.lineTo(L.nowX + 0.5, y - u(2))
    c.closePath()
    c.fill()
    this.micro(c, "NOW", L.nowX - u(12), y - u(14), INK.live, "right")
    this.rect(c, L.nowX, y, 1, L.masterY + L.masterH - y, rgba(INK.live, 0.5))
    this.micro(c, "TURN", L.futureEnd + u(14), y - u(14), INK.dim)
    this.micro(c, "COST", this.W - L.M - u(8) - Math.max(1, scene.world.accounts.length) * u(16) - u(4), y - u(14), INK.dim, "right")
  }

  lanes(c, scene, now, time) {
    const u = (value) => this.u(value)
    const L = this.L
    const lanes = scene.lanes
    if (!lanes.length) {
      this.text(c, "no sessions in the last day", L.pastX, L.lanesTop + u(60), { size: 20, color: INK.dim })
      return
    }
    const LH = clamp(Math.floor((L.lanesBottom - L.lanesTop) / lanes.length), u(60), u(102))
    const roomy = LH >= u(66)
    const rails = [...new Set(scene.world.accounts.map((account) => account.name))]
    rails.forEach((name, index) => this.spots.rails.set(name, { x: this.W - L.M - u(8) - index * u(16), taps: [] }))
    const boxes = lanes.map((lane, index) => {
      const y = L.lanesTop + index * LH
      const wavTop = y + Math.round(LH * 0.15)
      const wavH = Math.round(LH * 0.3)
      const toolTop = wavTop + wavH + Math.round(LH * 0.09)
      const toolH = Math.round(LH * 0.27)
      return { y, LH, wavTop, wavH, wavBase: wavTop + wavH, toolTop, toolH, mid: y + Math.round(LH / 2) }
    })
    lanes.forEach((lane, index) => this.spots.lanes.set(lane.session.id, boxes[index]))

    // fork and join traces sit under the ink
    lanes.forEach((lane, index) => {
      if (!lane.parent) return
      const child = boxes[index]
      const parent = boxes[lane.parent.index]
      const color = modelColor(lane.session.model, lane.session.provider)
      let newest = null
      for (const mark of lane.session.marks) {
        const x = time.x(mark.at)
        if (x <= L.pastX + 2 || x > L.nowX) continue
        const fork = mark.kind === "user"
        const top = fork ? parent.wavBase : parent.toolTop + parent.toolH
        this.rect(c, x - 1, top, 2, child.wavBase - top, rgba(color, 0.55))
        c.fillStyle = color
        c.beginPath()
        if (fork) {
          c.arc(x, top, u(4), 0, TAU)
        } else {
          c.moveTo(x - u(6), top + u(9))
          c.lineTo(x + u(6), top + u(9))
          c.lineTo(x, top)
        }
        c.fill()
        newest = { x, top, bottom: child.wavBase, fork }
      }
      // a first dispatch that is older than any message we hold still has a known moment
      if (!newest && lane.session.created > now - L.windowMs) {
        const x = time.x(lane.session.created)
        if (x > L.pastX + 2) {
          this.rect(c, x - 1, parent.wavBase, 2, child.wavBase - parent.wavBase, rgba(color, 0.55))
          c.fillStyle = color
          c.beginPath()
          c.arc(x, parent.wavBase, u(4), 0, TAU)
          c.fill()
          newest = { x, top: parent.wavBase, bottom: child.wavBase, fork: true }
        }
      }
      this.spots.forks.set(lane.session.id, newest ?? { x: L.M + u(34) + lane.depth * u(22) - u(11), top: parent.mid, bottom: child.mid, fork: true })
    })

    lanes.forEach((lane, index) => this.lane(c, scene, lane, boxes[index], now, time, roomy, index))
  }

  lane(c, scene, lane, box, now, time, roomy, index) {
    const u = (value) => this.u(value)
    const L = this.L
    const session = lane.session
    const color = modelColor(session.model, session.provider)
    const state = session.state
    const { y, LH, wavTop, wavH, wavBase, toolTop, toolH } = box

    if (lane.depth === 0 && index > 0) this.rect(c, L.M, y - 1, L.futureEnd - L.M, 1, INK.ghost)

    // ---- gutter: who this is
    const indent = lane.depth * u(22)
    const gx = L.M + u(34) + indent
    const titleY = roomy ? y + Math.round(LH * 0.42) : y + Math.round(LH * 0.5) + u(7)
    this.text(c, String(index + 1).padStart(2, "0"), L.M, titleY, { size: 15, color: INK.dim })
    if (lane.parent) {
      const from = this.spots.lanes.get(lane.parent.session.id)
      const tx = gx - u(13)
      this.rect(c, tx, from.mid + u(10), 1, titleY - u(7) - from.mid - u(10), INK.faint)
      this.rect(c, tx, titleY - u(7), u(9), 1, INK.faint)
    }
    const gy = titleY - u(7)
    this.spots.glyphs.push({ x: gx, y: gy, state, id: session.id })
    c.lineWidth = Math.max(1, u(2))
    if (state === "working") {
      c.fillStyle = INK.live
      c.beginPath()
      c.arc(gx, gy, u(5), 0, TAU)
      c.fill()
    } else if (state === "waiting") {
      c.fillStyle = INK.warn
      c.beginPath()
      c.moveTo(gx, gy - u(7))
      c.lineTo(gx + u(7), gy)
      c.lineTo(gx, gy + u(7))
      c.lineTo(gx - u(7), gy)
      c.fill()
    } else if (state === "failed") {
      c.strokeStyle = INK.bad
      c.beginPath()
      c.moveTo(gx - u(5), gy - u(5))
      c.lineTo(gx + u(5), gy + u(5))
      c.moveTo(gx + u(5), gy - u(5))
      c.lineTo(gx - u(5), gy + u(5))
      c.stroke()
    } else {
      c.strokeStyle = state === "stalled" ? rgba(INK.live, 0.5) : INK.faint
      c.beginPath()
      c.arc(gx, gy, u(5), 0, TAU)
      c.stroke()
    }
    const titleX = gx + u(16)
    const gutterEnd = L.pastX - u(20)
    const titleStyle = { size: 22, family: FAMILY.label, weight: "600" }
    const titleColor = state === "working" ? INK.text : state === "waiting" ? INK.warn : state === "failed" ? INK.soft : INK.soft
    const model = shortModel(session.model)
    if (roomy) {
      this.text(c, this.fit(c, session.title, gutterEnd - titleX, titleStyle), titleX, titleY, { ...titleStyle, color: titleColor })
      const metaY = titleY + u(27)
      const meta = { size: 15 }
      this.text(c, model, titleX, metaY, { ...meta, color })
      let mx = titleX + this.width(c, model, meta)
      const pane = session.pane || ""
      const paneW = pane ? this.width(c, pane, meta) + u(12) : 0
      const rest = [session.effort, session.agent].filter(Boolean).join(" · ")
      const restText = this.fit(c, rest ? ` · ${rest}` : "", gutterEnd - mx - paneW, meta)
      this.text(c, restText, mx, metaY, { ...meta, color: INK.dim })
      if (pane) this.text(c, pane, gutterEnd, metaY, { ...meta, color: INK.dim, align: "right" })
    } else {
      const meta = { size: 15 }
      const modelW = this.width(c, model, meta)
      this.text(c, model, gutterEnd, titleY, { ...meta, color, align: "right" })
      this.text(c, this.fit(c, session.title, gutterEnd - modelW - u(14) - titleX, titleStyle), titleX, titleY, { ...titleStyle, color: titleColor })
    }

    // ---- the track
    this.dots(c, L.pastX, L.nowX, wavBase, INK.faint, 1, 5)
    const clipL = L.pastX
    let liveRow = null
    for (const step of session.steps) {
      const genEnd = step.streamed ?? step.end ?? now
      let x0 = time.x(step.start)
      let x1 = Math.min(time.x(genEnd), L.nowX)
      if (x1 > clipL) {
        x0 = Math.max(x0, clipL)
        const open = step.streamed === null && step.end === null
        const seconds = Math.max(0.4, (genEnd - step.start) / 1000)
        const level = open ? 0.55 : 0.3 + 0.7 * clamp(Math.log10(1 + step.chars / seconds) / Math.log10(601), 0, 1)
        const h = Math.max(u(4), Math.round(wavH * level))
        const w = Math.max(2, x1 - x0)
        // thinking is the dim body, speaking the solid one
        this.rect(c, x0, wavBase - h, w, h, rgba(color, 0.26))
        let cursor = x0
        const spans = step.reasoning.map((span) => [Math.max(time.x(span[0]), x0), Math.min(time.x(span[1] ?? now), x0 + w)]).filter((span) => span[1] > span[0])
        for (const [from, to] of spans) {
          if (from > cursor) this.rect(c, cursor, wavBase - h, from - cursor, h, rgba(color, open ? 0.6 : 0.9))
          cursor = Math.max(cursor, to)
        }
        if (cursor < x0 + w && !(open && spans.length === 0)) this.rect(c, cursor, wavBase - h, x0 + w - cursor, h, rgba(color, open ? 0.6 : 0.9))
        this.rect(c, x0, wavBase - h, w, Math.max(1, u(2)), color)
        if (open) liveRow = { y: wavBase - h, h, color }
      }
      // tools: parallel calls share the row
      const rows = []
      for (const tool of step.tools) {
        let row = rows.findIndex((end) => end <= tool.start)
        if (row < 0) row = rows.length
        rows[row] = tool.end ?? Infinity
        tool.row = row
      }
      const each = Math.max(u(3), Math.floor((toolH - (rows.length - 1) * u(2)) / Math.max(1, rows.length)))
      for (const tool of step.tools) {
        const t1 = Math.min(time.x(tool.end ?? now), L.nowX)
        if (t1 <= clipL) continue
        const t0 = Math.max(time.x(tool.start), clipL)
        const w = Math.max(2, t1 - t0)
        const ty = toolTop + tool.row * (each + u(2))
        const meta = toolMeta(tool.name)
        const running = tool.end === null
        const name = tool.name.replace(/^mcp__[^_]+__/, "")
        let ink = DARK
        if (running) {
          this.frame(c, t0, ty, w, each, INK.live, Math.max(1, u(2)))
          this.spots.live.push({ x: t0, y: ty, w, h: each })
          liveRow = { y: ty, h: each, color: INK.live }
          ink = INK.live
        } else if (tool.status === "error") {
          this.rect(c, t0, ty, w, each, INK.bad)
        } else if (meta.kind === "agent") {
          this.frame(c, t0, ty, w, each, INK.soft, 1)
          ink = INK.soft
        } else {
          this.rect(c, t0, ty, w, each, TOOL_TONE[meta.kind] ?? TOOL_TONE.other)
        }
        if (w >= u(86) && each >= u(17)) {
          const style = { size: 14, family: FAMILY.monoBold }
          const span = running ? "" : ` ${spanOf(tool.end - tool.start)}`
          this.text(c, this.fit(c, `${name}${span}`, w - u(12), style), t0 + u(6), ty + Math.round(each / 2) + u(5), { ...style, color: ink })
        }
      }
    }
    for (const mark of session.marks) {
      const x = time.x(mark.at)
      if (x <= clipL || x > L.nowX) continue
      if (mark.kind === "user") {
        this.rect(c, x, wavTop - u(4), 1, toolTop + toolH - wavTop + u(4), INK.soft)
        c.fillStyle = INK.text
        c.beginPath()
        c.moveTo(x, wavTop - u(4))
        c.lineTo(x + u(8), wavTop)
        c.lineTo(x, wavTop + u(4))
        c.fill()
      } else {
        const tone = mark.outcome === "failed" ? INK.bad : mark.outcome === "interrupted" ? INK.warn : INK.good
        this.rect(c, x, wavTop, Math.max(1, u(2)), toolTop + toolH - wavTop, tone)
        this.rect(c, x - u(5), wavTop, u(5), Math.max(1, u(2)), tone)
        this.rect(c, x - u(5), toolTop + toolH - Math.max(1, u(2)), u(5), Math.max(1, u(2)), tone)
      }
    }
    if (state === "working") this.spots.heads.push(liveRow ?? { y: wavBase - u(6), h: u(6), color: INK.live, pending: true })

    // ---- the future: where this turn usually ends
    const elapsed = session.turn ? now - session.turn.start : 0
    if (state === "working" && session.expect) {
      const { p25, p50, p75 } = session.expect
      const by = wavTop + Math.round(wavH * 0.2)
      const bh = wavH - Math.round(wavH * 0.2)
      if (p75 > elapsed) {
        const b0 = time.future(p25 - elapsed)
        const b1 = time.future(p75 - elapsed)
        c.save()
        c.beginPath()
        c.rect(b0, by, Math.max(2, b1 - b0), bh)
        c.clip()
        c.strokeStyle = rgba(color, 0.6)
        c.lineWidth = 1
        c.beginPath()
        for (let x = b0 - bh; x < b1; x += u(6)) {
          c.moveTo(x + 0.5, by + bh)
          c.lineTo(x + bh + 0.5, by)
        }
        c.stroke()
        c.restore()
        this.rect(c, b0, by, 1, bh, rgba(color, 0.8))
        this.rect(c, Math.max(b0, b1 - 1), by, 1, bh, rgba(color, 0.8))
        if (p50 > elapsed) this.rect(c, time.future(p50 - elapsed) - 1, by - u(4), Math.max(2, u(2)), bh + u(8), color)
        this.dots(c, L.nowX + u(4), b0 - u(2), wavBase - Math.round(bh / 2), rgba(color, 0.7), 2, 4)
      } else {
        const over = elapsed / p50
        this.text(c, `×${over >= 10 ? Math.round(over) : over.toFixed(1)} the usual`, L.nowX + u(12), wavBase - u(6), { size: 14, color: INK.dim })
      }
    }

    // ---- readouts
    const rx = L.futureEnd + u(14)
    const rEnd = this.W - L.M - u(8) - Math.max(1, this.spots.rails.size) * u(16) - u(4)
    const rowA = roomy ? titleY : titleY
    const rowB = titleY + u(27)
    this.spots.timers.push({ x: rx, y: rowA, session, state })
    const cost = session.cost > 0 ? moneyOf(session.cost) : ""
    if (cost) this.text(c, cost, rEnd, rowA, { size: 15, color: INK.dim, align: "right" })
    if (roomy) {
      const { used, limit } = session.context
      if (limit > 0 && used > 0 && used <= limit * 1.05) {
        const share = clamp(used / limit, 0, 1)
        const bw = u(60)
        this.rect(c, rx, rowB - u(9), bw, u(7), INK.ghost)
        this.rect(c, rx, rowB - u(9), Math.max(2, Math.round(bw * share)), u(7), share > 0.9 ? INK.bad : INK.soft)
        this.text(c, `${Math.round(share * 100)}%`, rx + bw + u(8), rowB, { size: 15, color: share > 0.9 ? INK.bad : INK.dim })
      } else {
        this.text(c, "ctx n/a", rx, rowB, { size: 15, color: INK.faint })
      }
      const out = session.turn?.out ? `${compactOf(session.turn.out)} out` : state === "stalled" ? "silent" : ""
      if (out) this.text(c, out, rEnd, rowB, { size: 15, color: INK.dim, align: "right" })
    }
    const rail = this.spots.rails.get(session.account)
    if (rail && (state === "working" || session.last > now - L.windowMs)) {
      const ty = titleY - u(7)
      rail.taps.push({ y: ty, id: session.id, live: state === "working" })
    }
  }

  master(c, scene, now, time) {
    const u = (value) => this.u(value)
    const L = this.L
    const y = L.masterY
    const h = L.masterH
    this.rect(c, L.M, y - u(11), L.futureEnd - L.M, 1, INK.faint)
    this.micro(c, "ALL THREADS", L.M, y + u(22), INK.soft)
    const binPx = u(6)
    const bins = Math.floor(L.pastW / binPx)
    const binMs = (binPx / L.pps) * 1000
    const start = now - bins * binMs
    const chars = new Float64Array(bins)
    const active = new Float64Array(bins)
    for (const session of scene.world.sessions) {
      const busy = new Uint8Array(bins)
      for (const step of session.steps) {
        const genEnd = step.streamed ?? step.end ?? now
        const a = Math.max(0, Math.floor((step.start - start) / binMs))
        const b = Math.min(bins - 1, Math.floor((genEnd - start) / binMs))
        if (b >= 0 && a < bins) {
          const share = step.chars / Math.max(1, (genEnd - step.start) / binMs)
          for (let bin = a; bin <= b; bin += 1) chars[bin] += share
        }
        const end = Math.min(bins - 1, Math.floor(((step.end ?? now) - start) / binMs))
        for (let bin = a; bin <= end; bin += 1) if (bin >= 0) busy[bin] = 1
      }
      for (let bin = 0; bin < bins; bin += 1) active[bin] += busy[bin]
    }
    let peak = 0
    let most = 0
    for (let bin = 0; bin < bins; bin += 1) {
      peak = Math.max(peak, chars[bin])
      most = Math.max(most, active[bin])
    }
    const perSecond = peak / (binMs / 1000)
    this.text(c, `peak ${compactOf(perSecond)} ch/s`, L.M, y + u(48), { size: 15, color: INK.dim })
    this.text(c, `up to ${most} at once`, L.M, y + u(72), { size: 15, color: INK.dim })
    const barsH = Math.round(h * 0.6)
    const lineH = h - barsH - u(8)
    const scale = Math.max(peak, 1)
    for (let bin = 0; bin < bins; bin += 1) {
      const x = L.nowX - (bins - bin) * binPx
      if (chars[bin] > 0) {
        const bh = Math.max(1, Math.round((chars[bin] / scale) * barsH))
        this.rect(c, x, y + barsH - bh, binPx - 1, bh, INK.soft)
      }
      if (active[bin] > 0) {
        const ah = Math.max(2, Math.round((active[bin] / Math.max(most, 1)) * lineH))
        this.rect(c, x, y + h - ah, binPx, ah, rgba(INK.live, 0.28))
        this.rect(c, x, y + h - ah, binPx, Math.max(1, u(2)), INK.live)
      }
    }
    this.rect(c, L.pastX, y + barsH, L.pastW, 1, INK.ghost)
    this.rect(c, L.pastX, y + h, L.futureEnd - L.pastX, 1, INK.faint)
    this.micro(c, "STREAM", L.nowX + u(12), y + u(22), INK.dim)
    this.micro(c, "ACTIVE", L.nowX + u(12), y + h - u(8), INK.dim)
    this.legend(c, y + h + u(27))
  }

  legend(c, y) {
    const u = (value) => this.u(value)
    const L = this.L
    const sample = INK.soft
    let x = L.pastX
    const item = (name, paint, width) => {
      paint(x)
      this.text(c, name, x + width + u(8), y, { size: 14, color: INK.dim })
      x += width + u(8) + this.width(c, name, { size: 14 }) + u(26)
    }
    item("speaking", (px) => this.rect(c, px, y - u(12), u(22), u(12), sample), u(22))
    item("thinking", (px) => {
      this.rect(c, px, y - u(12), u(22), u(12), rgba(sample, 0.26))
      this.rect(c, px, y - u(12), u(22), Math.max(1, u(2)), sample)
    }, u(22))
    item("tool call", (px) => this.rect(c, px, y - u(10), u(22), u(8), TOOL_TONE.exec), u(22))
    item("in flight", (px) => this.frame(c, px, y - u(12), u(22), u(12), INK.live, Math.max(1, u(2))), u(22))
    item("failed", (px) => this.rect(c, px, y - u(10), u(22), u(8), INK.bad), u(22))
    if (!L.wide && x > L.nowX - u(260)) return
    item("subagent", (px) => this.frame(c, px, y - u(12), u(22), u(12), INK.soft, 1), u(22))
    item("usual end of turn", (px) => {
      c.strokeStyle = sample
      c.lineWidth = 1
      c.beginPath()
      for (let dx = 0; dx < u(22); dx += u(6)) {
        c.moveTo(px + dx + 0.5, y)
        c.lineTo(px + dx + u(6) + 0.5, y - u(12))
      }
      c.stroke()
    }, u(26))
  }

  // ---------------------------------------------------------------- panels

  panes(c, scene, now) {
    const u = (value) => this.u(value)
    const box = this.L.panels.panes
    const panes = scene.world.panes
    this.panelHead(c, box, "PANES", panes.length ? `${panes.length} in herdr` : "herdr not reachable")
    const groups = new Map()
    for (const pane of panes) {
      const list = groups.get(pane.workspace) ?? []
      list.push(pane)
      groups.set(pane.workspace, list)
    }
    const size = u(30)
    const gap = u(5)
    let x = box.x
    let y = box.y + u(48)
    const labelStyle = { size: 15 }
    for (const [workspace, list] of [...groups.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const labelW = this.width(c, workspace, labelStyle) + u(10)
      const need = labelW + Math.min(list.length, 4) * (size + gap)
      if (x + need > box.x + box.w) {
        x = box.x
        y += size + u(16)
      }
      this.text(c, workspace, x, y + size - u(9), { ...labelStyle, color: INK.dim })
      x += labelW
      for (const pane of list) {
        if (x + size > box.x + box.w) {
          x = box.x + labelW
          y += size + u(16)
        }
        const tag = pane.lane >= 0 ? String(pane.lane + 1).padStart(2, "0") : ""
        let ink = INK.dim
        if (pane.status === "working") {
          this.rect(c, x, y, size, size, INK.live)
          ink = DARK
        } else if (pane.status === "blocked") {
          this.rect(c, x, y, size, size, INK.warn)
          this.spots.tiles.push({ x, y, size })
          ink = DARK
        } else if (pane.status === "done") {
          this.frame(c, x, y, size, size, INK.good, Math.max(1, u(2)))
          ink = INK.good
        } else {
          this.frame(c, x, y, size, size, INK.faint, 1)
          if (pane.status === "unknown" || !pane.kind) this.rect(c, x + size / 2 - 1, y + size / 2 - 1, 2, 2, INK.faint)
        }
        if (tag) this.text(c, tag, x + size / 2, y + size - u(9), { size: 14, family: FAMILY.monoBold, color: ink, align: "center" })
        x += size + gap
      }
      x += u(18)
    }
    y += size + u(34)
    const waiting = scene.waiting
    this.micro(c, "WAITING ON YOU", box.x, y, waiting.length ? INK.warn : INK.dim)
    this.rect(c, box.x, y + u(10), box.w, 1, INK.ghost)
    y += u(40)
    if (!waiting.length) {
      this.text(c, "nobody is waiting on you", box.x, y, { size: 17, color: INK.dim })
      y += u(30)
    }
    const rowH = u(30)
    const room = Math.floor((box.y + box.h - u(46) - y) / rowH) + 1
    waiting.slice(0, Math.max(1, room)).forEach((pane) => {
      c.fillStyle = INK.warn
      c.beginPath()
      c.moveTo(box.x + u(6), y - u(12))
      c.lineTo(box.x + u(12), y - u(6))
      c.lineTo(box.x + u(6), y)
      c.lineTo(box.x, y - u(6))
      c.fill()
      this.text(c, pane.id, box.x + u(24), y, { size: 17, family: FAMILY.monoMedium, color: INK.warn })
      const since = pane.since ? timerOf(now - pane.since) : ""
      this.text(c, since, box.x + box.w, y, { size: 17, color: INK.text, align: "right" })
      const style = { size: 19, family: FAMILY.label, weight: "500" }
      this.text(c, this.fit(c, pane.title || pane.kind, box.w - u(124) - u(90), style), box.x + u(124), y, { ...style, color: INK.soft })
      y += rowH
    })
    // legend
    const ly = box.y + box.h - u(18)
    let lx = box.x
    for (const [name, paint] of [
      ["working", (px) => this.rect(c, px, ly - u(11), u(12), u(12), INK.live)],
      ["waiting", (px) => this.rect(c, px, ly - u(11), u(12), u(12), INK.warn)],
      ["done", (px) => this.frame(c, px, ly - u(11), u(12), u(12), INK.good, Math.max(1, u(2)))],
      ["idle", (px) => this.frame(c, px, ly - u(11), u(12), u(12), INK.faint, 1)],
    ]) {
      paint(lx)
      this.text(c, name, lx + u(20), ly, { size: 14, color: INK.dim })
      lx += u(20) + this.width(c, name, { size: 14 }) + u(22)
    }
    this.text(c, "number = lane", box.x + box.w, ly, { size: 14, color: INK.dim, align: "right" })
  }

  accounts(c, scene, now) {
    const u = (value) => this.u(value)
    const box = this.L.panels.accounts
    const accounts = scene.world.accounts
    this.panelHead(c, box, "ACCOUNTS")
    if (!accounts.length) {
      this.text(c, "no usage readings yet", box.x, box.y + u(70), { size: 17, color: INK.dim })
      return
    }
    const each = Math.min(u(190), Math.floor((box.h - u(40)) / accounts.length))
    accounts.forEach((account, index) => {
      const top = box.y + u(40) + index * each
      const nameStyle = { size: 22, family: FAMILY.label, weight: "600" }
      this.text(c, account.name.toUpperCase(), box.x, top + u(26), { ...nameStyle, color: INK.text, spacing: 1.5 })
      const nameW = this.width(c, account.name.toUpperCase(), { ...nameStyle, spacing: 1.5 })
      this.text(c, account.tier, box.x + nameW + u(12), top + u(26), { size: 15, color: INK.dim })
      const rail = this.spots.rails.get(account.name)
      if (rail) {
        rail.wireY = top + u(19)
        rail.wireX = box.x + nameW + u(22) + this.width(c, account.tier, { size: 15 })
      }
      const windows = [
        ["5H", account.five],
        ["7D", account.seven],
      ]
      windows.forEach(([label, window], row) => {
        const y = top + u(64) + row * u(58)
        this.text(c, label, box.x, y, { size: 16, family: FAMILY.monoMedium, color: INK.soft })
        const bx = box.x + u(44)
        const bw = box.w - u(44) - u(86)
        const seg = u(7)
        const pitch = seg + u(3)
        const count = Math.floor(bw / pitch)
        if (!window || window.used === null) {
          for (let i = 0; i < count; i += 1) this.rect(c, bx + i * pitch, y - u(15), seg, u(16), INK.ghost)
          this.text(c, "no reading", bx, y + u(24), { size: 14, color: INK.dim })
          return
        }
        const used = window.used
        const lit = Math.round((count * used) / 100)
        const hot = used >= 90
        for (let i = 0; i < count; i += 1) this.rect(c, bx + i * pitch, y - u(15), seg, u(16), i < lit ? (hot ? INK.bad : INK.text) : INK.ghost)
        this.text(c, `${Math.round(used)}%`, box.x + box.w - u(30), y, { size: 22, family: FAMILY.monoMedium, color: hot ? INK.bad : INK.text, align: "right" })
        if (!window.resetsAt) {
          this.text(c, "fresh window", bx, y + u(24), { size: 14, color: INK.dim })
          return
        }
        const elapsed = clamp(1 - (window.resetsAt - now) / window.span, 0, 1)
        const mx = bx + Math.round(count * pitch * elapsed)
        c.fillStyle = INK.live
        c.beginPath()
        c.moveTo(mx, y + u(3))
        c.lineTo(mx - u(5), y + u(11))
        c.lineTo(mx + u(5), y + u(11))
        c.fill()
        const left = window.resetsAt - now
        const reset = left > 86400e3 ? `${dayOf(window.resetsAt).slice(0, 3)} ${hourMinuteOf(window.resetsAt)}` : hourMinuteOf(window.resetsAt)
        let note = `resets ${reset}, in ${agoOf(left)}`
        let tone = INK.dim
        if (elapsed > 0.04 && used > 3) {
          const pace = used / 100 / elapsed
          const emptyAt = now + ((100 - used) / used) * (elapsed * window.span)
          if (pace > 1.02 && emptyAt < window.resetsAt) {
            note += ` · pace ×${pace.toFixed(1)}, empty ${hourMinuteOf(emptyAt)}`
            tone = pace > 1.3 ? INK.bad : INK.soft
          } else note += ` · pace ×${pace.toFixed(1)}`
        }
        this.text(c, this.fit(c, note, box.w - u(44) - u(30), { size: 14 }), bx, y + u(28), { size: 14, color: tone })
      })
    })
  }

  tools(c, scene, now) {
    const u = (value) => this.u(value)
    const box = this.L.panels.tools
    const minutes = Math.round(this.L.windowMs / 60e3)
    this.panelHead(c, box, "TOOL LATENCY", `last ${minutes} min`)
    const rowH = u(36)
    const axisY = box.y + box.h - u(30)
    const top = box.y + u(44)
    const rows = Math.max(1, Math.floor((axisY - top) / rowH))
    const sx = box.x + u(190)
    const sw = box.w - u(190) - u(86)
    const toX = (ms) => sx + Math.round((sw * (Math.log10(clamp(ms, 10, 6e5)) - 1)) / (Math.log10(6e5) - 1))
    for (const [ms, name] of [
      [10, "10ms"],
      [100, "100ms"],
      [1000, "1s"],
      [10e3, "10s"],
      [60e3, "1m"],
      [600e3, "10m"],
    ]) {
      const x = toX(ms)
      this.rect(c, x, top - u(6), 1, axisY - top + u(6), INK.ghost)
      this.text(c, name, x, axisY + u(20), { size: 13, color: INK.dim, align: ms >= 600e3 ? "right" : ms <= 10 ? "left" : "center" })
    }
    this.rect(c, sx, axisY, sw, 1, INK.faint)
    if (!scene.tools.length) {
      this.text(c, `no tool calls in the last ${minutes} minutes`, box.x, top + u(26), { size: 17, color: INK.dim })
      return
    }
    scene.tools.slice(0, rows).forEach((tool, index) => {
      const y = top + index * rowH
      const base = y + u(24)
      this.text(c, this.fit(c, tool.name, u(118), { size: 17 }), box.x, base, { size: 17, color: INK.soft })
      this.text(c, String(tool.count), box.x + u(170), base, { size: 17, family: FAMILY.monoMedium, color: INK.text, align: "right" })
      const done = tool.spans.filter((span) => !span.live).map((span) => span.ms).sort((a, b) => a - b)
      for (const span of tool.spans) {
        const x = toX(span.ms)
        if (span.live) this.rect(c, x - 1, y + u(4), Math.max(2, u(3)), u(26), INK.live)
        else if (span.bad) this.rect(c, x - 1, y + u(4), Math.max(2, u(2)), u(26), INK.bad)
        else this.rect(c, x, y + u(9), Math.max(1, u(2)), u(16), rgba(INK.soft, 0.62))
      }
      if (done.length) this.text(c, spanOf(done[Math.floor((done.length - 1) / 2)]), box.x + box.w, base, { size: 15, color: INK.dim, align: "right" })
      if (tool.errors) this.text(c, `${tool.errors}✕`, box.x + box.w - u(58), base, { size: 15, color: INK.bad, align: "right" })
    })
  }

  log(c, scene, now) {
    const u = (value) => this.u(value)
    const box = this.L.panels.log
    this.panelHead(c, box, "EVENTS", "newest first")
    const rowH = u(30)
    const top = box.y + u(40)
    const rows = Math.floor((box.h - u(50)) / rowH)
    const laneOf = new Map(scene.lanes.map((lane) => [lane.session.id, lane.index]))
    if (!scene.log.length) {
      this.text(c, "quiet. nothing has happened yet", box.x, top + u(26), { size: 17, color: INK.dim })
      return
    }
    const tones = { run: INK.live, bad: INK.bad, ok: INK.good, warn: INK.warn, plain: INK.soft }
    scene.log.slice(0, rows).forEach((entry, index) => {
      const y = top + index * rowH + u(22)
      const fade = index < 3 ? 1 : clamp(1 - (index - 3) / (rows * 1.25), 0.38, 1)
      const style = { size: 16 }
      this.text(c, clockOf(entry.at), box.x, y, { ...style, color: rgba(INK.dim, fade) })
      const lane = laneOf.get(entry.sessionId)
      this.text(c, lane === undefined ? "··" : String(lane + 1).padStart(2, "0"), box.x + u(112), y, { ...style, color: rgba(INK.dim, fade) })
      const name = entry.name.replace(/^mcp__[^_]+__/, "")
      this.text(c, this.fit(c, name, u(104), { size: 16, family: FAMILY.monoMedium }), box.x + u(150), y, { size: 16, family: FAMILY.monoMedium, color: rgba(tones[entry.tone] ?? INK.soft, fade) })
      const span = entry.span === null ? (entry.tone === "run" ? "running" : "") : spanOf(entry.span)
      const spanW = span ? this.width(c, span, style) + u(14) : 0
      if (span) this.text(c, span, box.x + box.w, y, { ...style, color: rgba(entry.tone === "run" ? INK.live : INK.text, fade), align: "right" })
      const dx = box.x + u(262)
      this.text(c, this.fit(c, entry.detail || "", box.x + box.w - spanW - dx, style), dx, y, { ...style, color: rgba(INK.dim, fade) })
      this.spots.logRows.push({ y: y - u(20), h: rowH - u(4), born: entry.born, settled: entry.settled ?? 0 })
    })
  }

  // ---------------------------------------------------------------- the fast layer

  drawFast(c, scene, now, meta) {
    const u = (value) => this.u(value)
    const L = this.L
    const seconds = now / 1000
    const spots = this.spots

    // rails: each account is a wire the lanes tap into
    for (const [name, rail] of spots.rails) {
      if (!rail.taps.length || rail.wireY === undefined) continue
      const top = Math.min(...rail.taps.map((tap) => tap.y))
      this.rect(c, rail.x, top, 1, rail.wireY - top, INK.faint)
      this.rect(c, rail.wireX, rail.wireY, rail.x - rail.wireX, 1, INK.faint)
      for (const tap of rail.taps) {
        this.rect(c, rail.x - u(5), tap.y, u(5), 1, tap.live ? INK.soft : INK.faint)
        this.rect(c, rail.x - 1, tap.y - 1, 3, 3, tap.live ? INK.text : INK.faint)
      }
    }

    // running tools: a hatch that walks, because the call is in flight
    if (spots.live.length) {
      c.save()
      c.beginPath()
      for (const box of spots.live) c.rect(box.x + 2, box.y + 2, box.w - 4, box.h - 4)
      c.clip()
      c.strokeStyle = rgba(INK.live, 0.5)
      c.lineWidth = Math.max(1, u(2))
      const pitch = u(9)
      const shift = (seconds * u(18)) % pitch
      c.beginPath()
      for (const box of spots.live) {
        for (let x = box.x - box.h + shift - pitch; x < box.x + box.w; x += pitch) {
          c.moveTo(x, box.y + box.h)
          c.lineTo(x + box.h, box.y)
        }
      }
      c.stroke()
      c.restore()
    }

    // write heads on the NOW edge
    spots.heads.forEach((head, index) => {
      const beat = 0.62 + 0.38 * Math.sin(seconds * 5.2 + index * 1.7)
      const hx = L.nowX
      this.rect(c, hx - u(7), head.y, u(15), head.h, rgba(INK.live, 0.1 * beat))
      this.rect(c, hx - u(3), head.y, u(7), head.h, rgba(INK.live, 0.26 * beat))
      this.rect(c, hx - 1, head.y - u(3), Math.max(2, u(3)), head.h + u(6), head.pending ? rgba(INK.live, 0.5 + 0.5 * beat) : INK.text)
    })

    // state glyphs
    for (const glyph of spots.glyphs) {
      if (glyph.state === "working") {
        const phase = (seconds * 0.7 + hashUnit(glyph.id)) % 1
        c.strokeStyle = rgba(INK.live, 0.8 * (1 - phase))
        c.lineWidth = Math.max(1, u(1.5))
        c.beginPath()
        c.arc(glyph.x, glyph.y, u(5) + phase * u(8), 0, TAU)
        c.stroke()
      } else if (glyph.state === "waiting") {
        const breath = 0.5 + 0.5 * Math.sin(seconds * 2.6)
        c.strokeStyle = rgba(INK.warn, 0.25 + 0.6 * breath)
        c.lineWidth = Math.max(1, u(1.5))
        const r = u(10) + breath * u(2)
        c.beginPath()
        c.moveTo(glyph.x, glyph.y - r)
        c.lineTo(glyph.x + r, glyph.y)
        c.lineTo(glyph.x, glyph.y + r)
        c.lineTo(glyph.x - r, glyph.y)
        c.closePath()
        c.stroke()
      }
    }
    for (const tile of spots.tiles) {
      const breath = 0.5 + 0.5 * Math.sin(seconds * 2.6)
      this.frame(c, tile.x - u(3), tile.y - u(3), tile.size + u(6), tile.size + u(6), rgba(INK.warn, 0.2 + 0.7 * breath), 1)
    }

    // lane timers
    for (const spot of spots.timers) {
      const session = spot.session
      const style = { size: 21, family: FAMILY.monoMedium }
      if (spot.state === "working" && session.turn) this.text(c, timerOf(now - session.turn.start), spot.x, spot.y, { ...style, color: INK.text })
      else if (spot.state === "waiting") this.text(c, "waiting", spot.x, spot.y, { size: 16, family: FAMILY.monoMedium, color: INK.warn })
      else if (spot.state === "stalled" && session.turn) this.text(c, timerOf(now - session.turn.start), spot.x, spot.y, { ...style, color: INK.dim })
      else if (session.idleSince) this.text(c, `idle ${agoOf(now - session.idleSince)}`, spot.x, spot.y, { size: 16, color: INK.dim })
    }

    // pulses: a call was billed (down the account's rail), a subagent left or came back
    for (const pulse of scene.pulses) {
      const age = now - pulse.born
      if (age < 0) continue
      const box = spots.lanes.get(pulse.sessionId)
      if (!box) continue
      if (pulse.kind === "rail") {
        const rail = spots.rails.get(pulse.account)
        const tap = rail?.taps.find((candidate) => candidate.id === pulse.sessionId)
        if (!rail || !tap || rail.wireY === undefined) continue
        const down = rail.wireY - tap.y
        const along = rail.x - rail.wireX
        const speed = u(1500) / 1000
        const head = age * speed
        const tail = Math.max(0, head - u(60) - Math.min(u(120), (pulse.weight ?? 0) / 40))
        if (tail > down + along) continue
        const segment = (from, to, alpha) => {
          if (to <= from) return
          if (from < down) this.rect(c, rail.x - 1, tap.y + from, 3, Math.min(to, down) - from, rgba(INK.text, alpha))
          if (to > down) {
            const a = Math.max(from, down) - down
            const b = Math.min(to, down + along) - down
            if (b > a) this.rect(c, rail.x - b, rail.wireY - 1, b - a, 3, rgba(INK.text, alpha))
          }
        }
        const midpoint = (head + tail) / 2
        segment(tail, midpoint, 0.4)
        segment(midpoint, head, 1)
      } else {
        const trace = spots.forks.get(pulse.sessionId)
        if (!trace || age > 900) continue
        const k = age / 900
        const eased = 1 - (1 - k) * (1 - k)
        const from = pulse.kind === "fork" ? trace.top : trace.bottom
        const to = pulse.kind === "fork" ? trace.bottom : trace.top
        const y = from + (to - from) * eased
        this.rect(c, trace.x - u(3), y - u(9), u(6), u(18), rgba(INK.text, 1 - k * 0.5))
        this.rect(c, trace.x - u(7), y - u(4), u(14), u(8), rgba(INK.text, 0.3 * (1 - k)))
      }
    }

    // fresh log lines
    for (const row of spots.logRows) {
      const age = now - Math.max(row.born, row.settled)
      if (age < 0 || age > 1400) continue
      const box = L.panels.log
      this.rect(c, box.x - u(12), row.y, u(4), row.h, rgba(INK.live, 1 - age / 1400))
    }

    // the clock, and the instrument reading itself
    const header = L.header
    this.text(c, clockOf(now), header.x + header.w + u(3), header.y + header.h - u(58), { size: 62, family: FAMILY.monoLight, color: INK.text, align: "right" })
    if (meta?.line) this.text(c, meta.line, header.x + header.w, header.y + header.h - u(30), { size: 14, color: INK.dim, align: "right" })
    if (meta?.line2) this.text(c, meta.line2, header.x + header.w, header.y + header.h - u(10), { size: 14, color: INK.dim, align: "right" })
  }

  // The frame as a person would see it: composited over the terminal's own background.
  flatten(background = "#000000") {
    const out = createCanvas(this.W, this.H)
    const c = out.getContext("2d")
    c.fillStyle = background
    c.fillRect(0, 0, this.W, this.H)
    c.drawImage(this.canvas, 0, 0)
    return out
  }
}
