// The time terrain: every listed thread's output over the last minutes as a ridge on a ground
// plane in perspective, the focused thread at the front edge and the others receding behind it,
// smaller and hazier. Height is tokens per second, time runs from the left to now at the right
// edge, and the whole terrain moves with the clock. Tool calls, failures, flags and dispatches
// are marked on the ridge they belong to. What an open model call probably writes is drawn
// dashed and hollow: an estimate, marked as one.
//
// It is drawn into the still layer by the stage; the heads of the ridges (the newest reading of
// a working thread) and the charge of a model call that has not said its first word yet are
// sprites, so they move between repaints.

import { portOf, wroteOf } from "./model.mjs"
import { LEVEL_COLOR, PORT_COLOR, clean, spriteHex } from "./theme.mjs"
import { FAMILY, INK, clamp, mix, modelColor, rgba, spanOf } from "./util.mjs"

export const WINDOWS = [60e3, 5 * 60e3, 30 * 60e3]
const BINS = 150
const MAX_RIDGES = 7
const HAZE = "#4c5c70" // the air between the eye and a far ridge
const windowWord = (ms) => (ms >= 60e3 ? `${Math.round(ms / 60e3)} MIN` : `${Math.round(ms / 1000)} S`)

export const terrain = {
  // Tokens per second in each slice of the window, from the model calls that reported what they
  // wrote: a call's tokens are spread evenly from its first words to its end.
  seriesOf(session, from, span) {
    const bins = new Float32Array(BINS)
    const slice = span / BINS
    let any = false
    for (const step of session.steps) {
      if (step.end === null || step.end <= from) continue
      const wrote = wroteOf(step)
      if (!wrote) continue
      const began = Math.min(step.start, step.end - 1000)
      const perMs = wrote / (step.end - began)
      const first = clamp(Math.floor((began - from) / slice), 0, BINS - 1)
      const last = clamp(Math.floor((step.end - from) / slice), 0, BINS - 1)
      for (let bin = first; bin <= last; bin += 1) {
        const a = Math.max(began, from + bin * slice)
        const b = Math.min(step.end, from + (bin + 1) * slice)
        if (b > a) {
          bins[bin] += (perMs * (b - a)) / (slice / 1000)
          any = true
        }
      }
    }
    return any ? bins : null
  },

  signTerrain(scene, ui, now) {
    const span = ui.window ?? WINDOWS[1]
    const parts = [span, Math.floor(now / (span / BINS)), scene.focus.id]
    for (const row of scene.threads.slice(0, 24)) parts.push(row.session.id, row.session.steps.length, row.session.steps[row.session.steps.length - 1]?.end ?? 0, row.session.alerts.length, row.session.phase?.key === "thinking" || row.session.phase?.key === "writing" ? Math.round(scene.rateOf(row.session.id, now) / 8) + 1 : 0)
    return parts.join("|")
  },

  // The ground is a plane seen from in front and above: the focused thread's ridge stands at
  // the front edge at full size, every ridge behind it is smaller, narrower and hazier, and the
  // lines of the ground run to one vanishing point. A ridge slot at depth k (0 in front) is
  // scaled by 1 / (1 + 1.9 k / 6).
  terrainPlane() {
    const u = (value) => this.u(value)
    const T = this.G.terrain
    const frontY = T.y + T.h - u(24)
    const horizon = T.y + u(40)
    const frontLeft = T.x + u(190)
    const frontRight = T.x + T.w - u(34)
    const vanish = frontLeft + (frontRight - frontLeft) * 0.5
    const full = Math.min(u(190), (frontY - horizon) * 0.66)
    const place = (index) => {
      const s = 1 / (1 + 1.9 * (index / (MAX_RIDGES - 1)))
      return { s, base: Math.round(horizon + (frontY - horizon) * s), left: vanish + (frontLeft - vanish) * s, right: vanish + (frontRight - vanish) * s, height: full * s }
    }
    return { frontY, horizon, frontLeft, frontRight, place }
  },

  drawTerrain(c, scene, ui, now) {
    const u = (value) => this.u(value)
    const T = this.G.terrain
    const span = ui.window ?? WINDOWS[1]
    const slice = span / BINS
    const from = Math.floor(now / slice) * slice + slice - span // the window ends on a slice boundary, so it steps
    this.terrainGeo = null
    if (!T || T.w < u(300)) return
    // title, unit and the window buttons
    this.label(c, "TIME TERRAIN", T.x, T.y + u(16), INK.dim, "left", 11.5)
    const titleW = this.width(c, "TIME TERRAIN", { size: 11.5, family: FAMILY.label, weight: "600", spacing: 2.6 })
    const about = "tokens a second, every listed thread, the focused one in front"
    this.text(c, about, T.x + titleW + u(18), T.y + u(16), { size: 11.5, color: INK.faint })
    this.note("section:terrain", { x: T.x - u(4), y: T.y, w: titleW + u(26) + this.width(c, about, { size: 11.5 }), h: u(24) }, "SECTION", "TIME TERRAIN", [["WHAT", "one ridge per listed thread: its tokens a second over the window, the focused thread in front at full size and the others receding behind it"], ["WINDOW", `the last ${windowWord(span).toLowerCase()}: w or a button at the right changes it`], ["MARKS", "diamond: a tool call, red and taller when it failed. Flag: an alert. Ring: a dispatch. Dashed step: an open call's estimate. Dot at the right edge: now"], ["CLICK", "a ridge focuses its thread; a point on the focused ridge is pinned"]])
    let chipX = T.x + T.w
    for (const option of [...WINDOWS].reverse()) {
      const on = option === span
      const w = this.chip(c, windowWord(option), chipX, T.y + u(17), { color: on ? INK.live : INK.faint, align: "right", solid: false })
      this.hit("action", `window:${option}`, { x: chipX - w, y: T.y, w, h: u(24) }, { tip: `click: show the last ${windowWord(option).toLowerCase()}  ·  w: next window` })
      chipX -= w + u(6)
    }
    // which threads, in which order: the focus in front, then whoever was heard last
    const rows = scene.threads.filter((row) => row.session.id !== scene.focus.id).sort((a, b) => (b.session.last || 0) - (a.session.last || 0))
    if (scene.focused) rows.unshift(scene.focused)
    const ridges = []
    let peak = 0
    for (const row of rows) {
      if (ridges.length >= MAX_RIDGES) break
      const bins = this.seriesOf(row.session, from, span)
      if (!bins && ridges.length && row.session.state !== "working") continue // a thread that wrote nothing in the window gets no ridge, except the focus
      const values = bins ?? new Float32Array(BINS)
      for (const value of values) if (value > peak) peak = value
      ridges.push({ row, session: row.session, values, empty: !bins })
    }
    const top = [10, 20, 40, 60, 80, 120, 160, 240, 320, 480, 640, 1000].find((value) => value >= peak) ?? Math.ceil(peak / 500) * 500
    const count = ridges.length
    const plane = this.terrainPlane()
    const { frontY } = plane
    const geo = { from, span, slice, top, ridges: [] }

    // the ground: lines of equal time running back to the vanishing point, one line of ground
    // per ridge slot, and the edge where time is now
    const front = plane.place(0)
    const back = plane.place(MAX_RIDGES - 1)
    for (let tick = 0; tick <= 5; tick += 1) {
      const a = front.left + (tick / 5) * (front.right - front.left)
      const b = back.left + (tick / 5) * (back.right - back.left)
      this.line(c, a, front.base, b, back.base, tick === 5 ? rgba(INK.live, 0.42) : rgba(INK.faint, 0.3))
    }
    for (let slot = count; slot < MAX_RIDGES; slot += 1) {
      const at = plane.place(slot)
      this.line(c, at.left, at.base, at.right, at.base, rgba(INK.faint, 0.22 * at.s + 0.06))
    }

    // far to near, so a nearer ridge is drawn over a farther one
    for (let index = count - 1; index >= 0; index -= 1) {
      const ridge = ridges[index]
      const { s, base, left, right, height } = plane.place(index)
      const tone = ridge.session.state === "waiting" ? INK.warn : modelColor(ridge.session.model, ridge.session.provider)
      // haze: a far ridge loses colour and contrast to the air in between
      const color = index === 0 ? tone : mix(tone, HAZE, (1 - s) * 0.8)
      const alpha = index === 0 ? 1 : 0.2 + 0.72 * s * s
      const xOf = (bin) => left + ((bin + 0.5) / BINS) * (right - left)
      const yOf = (value) => base - (Math.min(value, top) / top) * height
      const xAt = (time) => left + ((time - from) / span) * (right - left)
      this.line(c, left, base, right, base, rgba(INK.faint, index === 0 ? 0.95 : 0.25 + 0.4 * s))
      const smooth = (bin) => (ridge.values[Math.max(0, bin - 1)] + 2 * ridge.values[bin] + ridge.values[Math.min(BINS - 1, bin + 1)]) / 4
      if (!ridge.empty) {
        c.beginPath()
        c.moveTo(left, base)
        for (let bin = 0; bin < BINS; bin += 1) c.lineTo(xOf(bin), yOf(smooth(bin)))
        c.lineTo(right, base)
        c.closePath()
        const gradient = c.createLinearGradient(0, base - height, 0, base)
        gradient.addColorStop(0, rgba(color, 0.4 * alpha))
        gradient.addColorStop(1, rgba(color, 0.03))
        c.fillStyle = gradient
        c.fill()
        c.strokeStyle = rgba(color, alpha)
        c.lineWidth = Math.max(1, 2.2 * s)
        c.lineJoin = "round"
        c.beginPath()
        for (let bin = 0; bin < BINS; bin += 1) {
          const x = xOf(bin)
          const y = yOf(smooth(bin))
          if (bin) c.lineTo(x, y)
          else c.moveTo(x, y)
        }
        c.stroke()
      }
      // An open model call has reported nothing yet. What it probably writes is drawn as an
      // estimate, and marked as one: a dashed, hollow step at the thread's last measured rate
      // from the call's start to now.
      const session = ridge.session
      const newest = session.steps[session.steps.length - 1]
      const phase = session.phase?.key
      const rate = session.state === "working" && (phase === "thinking" || phase === "writing") ? scene.rateOf(session.id, now) : 0
      if (rate > 0 && newest && newest.end === null) {
        const x0 = xAt(Math.max(from, newest.start))
        const y = yOf(rate)
        c.strokeStyle = rgba(color, Math.max(0.45, alpha))
        c.lineWidth = Math.max(1, 1.5 * s)
        c.setLineDash([u(4) * s + 1, u(4) * s + 1])
        c.beginPath()
        c.moveTo(x0, base)
        c.lineTo(x0, y)
        c.lineTo(right, y)
        c.stroke()
        c.setLineDash([])
        if (index === 0 && right - x0 > u(46)) this.text(c, "estimate", x0 + u(6), y - u(5), { size: 10, color: rgba(INK.soft, 0.9) })
      }
      // events on the ridge: tool calls (a failure stands taller, in red), flags, a dispatch
      const near = index < 3
      for (const step of session.steps) {
        for (const tool of step.tools) {
          if (tool.start < from) continue
          const failed = tool.status === "error"
          if (!near && !failed) continue
          const x = Math.round(xAt(tool.start))
          const size = u(failed ? 4 : 3) * Math.max(0.6, s)
          c.fillStyle = failed ? INK.bad : rgba(PORT_COLOR[portOf(tool.name)], alpha * (tool.end === null ? 1 : 0.8))
          if (failed) c.fillRect(x - 1, base - u(14) * s, 2, u(14) * s)
          c.beginPath()
          c.moveTo(x, base - size)
          c.lineTo(x + size, base)
          c.lineTo(x, base + size)
          c.lineTo(x - size, base)
          c.closePath()
          c.fill()
          if (index === 0) this.hit("tool", tool.id, { x: x - u(6), y: base - u(7), w: u(12), h: u(14) }, { sid: session.id, tool, step })
        }
      }
      for (const alert of session.alerts) {
        if (!alert.since || alert.since < from || alert.muted) continue
        const x = Math.round(xAt(alert.since))
        c.fillStyle = LEVEL_COLOR[alert.level] ?? INK.soft
        c.beginPath()
        c.moveTo(x, base - u(20) * s)
        c.lineTo(x + u(7) * s, base - u(16) * s)
        c.lineTo(x, base - u(12) * s)
        c.closePath()
        c.fill()
        c.fillRect(x - 1, base - u(20) * s, 1, u(20) * s)
        this.hit("alert", alert.key, { x: x - u(4), y: base - u(22) * s, w: u(14), h: u(22) * s }, { alert })
      }
      if (session.parentId && session.created >= from) {
        const x = Math.round(xAt(session.created))
        c.strokeStyle = PORT_COLOR.agent
        c.lineWidth = 1.5
        c.beginPath()
        c.arc(x, base, u(5) * s, 0, Math.PI * 2)
        c.stroke()
      }
      // who this ridge is: its name ends where its ground begins, so the names recede with it
      const focused = index === 0 && session.id === scene.focus.id
      const number = String(ridge.row.index + 1).padStart(2, "0")
      const size = 10 + 2.5 * s
      const nameStyle = { size, color: focused ? INK.text : rgba(INK.soft, 0.35 + alpha * 0.6), align: "right" }
      const nameRight = left - u(14)
      const name = this.fit(c, clean(session.title), nameRight - T.x - u(34), nameStyle)
      this.text(c, name, nameRight, base + u(4), nameStyle)
      const nameW = this.width(c, name, nameStyle)
      this.text(c, number, nameRight - nameW - u(8), base + u(4), { size, color: rgba(tone, Math.max(0.5, alpha)), align: "right" })
      this.hit("thread", session.id, { x: nameRight - nameW - u(30), y: base - u(12), w: nameW + u(34), h: u(18) })
      geo.ridges.push({ sid: session.id, index: ridge.row.index, left, right, base, height, values: ridge.values, color: tone, empty: ridge.empty, depth: index, s })
    }
    geo.ridges.reverse() // nearest first, for hit testing
    // the time axis under the front ridge, and what the height stands for
    if (geo.ridges[0]) {
      for (let tick = 0; tick <= 5; tick += 1) {
        const x = front.left + (tick / 5) * (front.right - front.left)
        this.line(c, x, frontY, x, frontY + u(4), INK.faint)
        this.text(c, tick === 5 ? "now" : `-${spanOf(span * (1 - tick / 5))}`, x, frontY + u(18), { size: 11, color: tick === 5 ? INK.live : INK.faint, align: tick === 5 ? "right" : tick === 0 ? "left" : "center" })
      }
      this.text(c, peak > 0 ? `the front ridge at full height is ${top} tok/s  ·  peak ${peak >= 10 ? Math.round(peak) : peak.toFixed(1)}` : "no output in this window", T.x + T.w, T.y + u(44), { size: 11, color: INK.faint, align: "right" })
      this.text(c, "solid: what calls reported, spread evenly over each call  ·  dashed: an open call at its last rate, an estimate", T.x + T.w, T.y + u(60), { size: 10.5, color: rgba(INK.faint, 0.9), align: "right" })
    }
    this.hit("terrain", "terrain", { x: T.x, y: T.y + u(26), w: T.w, h: T.h - u(26) })
    this.terrainGeo = geo
  },

  // The point of a ridge under the pointer: the nearest ridge first.
  terrainAt(x, y) {
    const geo = this.terrainGeo
    const T = this.G.terrain
    if (!geo || !T || x < T.x || x > T.x + T.w || y < T.y + this.u(26) || y > T.y + T.h) return null
    const reach = this.u(9)
    for (const ridge of geo.ridges) {
      if (x < ridge.left || x > ridge.right) continue
      const bin = clamp(Math.floor(((x - ridge.left) / (ridge.right - ridge.left)) * BINS), 0, BINS - 1)
      const value = ridge.values[bin]
      const py = ridge.base - (Math.min(value, geo.top) / geo.top) * ridge.height
      if (y < py - reach || y > ridge.base + reach) continue
      const px = ridge.left + ((bin + 0.5) / BINS) * (ridge.right - ridge.left)
      return { kind: "ridge", id: `${ridge.sid}:${geo.from + bin * geo.slice}`, sid: ridge.sid, value, at: geo.from + bin * geo.slice, slice: geo.slice, span: geo.span, rect: { x: px - this.u(7), y: py - this.u(7), w: this.u(14), h: this.u(14) } }
    }
    return null
  },

  // Scrubbing. A drag along the terrain holds one moment of the window: it is read on the front
  // ridge (the focused thread's, at full size) in whole slices, and every ridge shows where it
  // stood then. The moment is the pinned card's own target, so letting the card go lets it go.
  scrubAt(ui) {
    return ui?.pinned?.target.kind === "scrub" ? ui.pinned.target.at : null
  },

  terrainTimeAt(x, y) {
    const geo = this.terrainGeo
    const T = this.G.terrain
    const front = geo?.ridges.find((ridge) => ridge.depth === 0)
    if (!front || !T || y < T.y + this.u(26) || y > T.y + T.h || x < T.x || x > T.x + T.w) return null
    const share = clamp((x - front.left) / (front.right - front.left), 0, 1)
    return geo.from + Math.min(BINS - 1, Math.round(share * BINS)) * geo.slice
  },

  // Where a moment stands on a ridge: on its line, at the height the ridge had then.
  ridgeSpot(ridge, at) {
    const geo = this.terrainGeo
    const share = (at - geo.from) / (geo.slice * BINS)
    if (share < 0 || share > 1) return null
    const value = ridge.values[clamp(Math.floor(share * BINS), 0, BINS - 1)]
    return { x: ridge.left + share * (ridge.right - ridge.left), y: ridge.base - (Math.min(value, geo.top) / geo.top) * ridge.height, base: ridge.base, value }
  },

  // The moving parts: a head where each working thread's ridge meets now, at the height of its
  // newest reading, and above it one mote for every five seconds a model call has been running
  // without a first word (the charge before it speaks).
  terrainSprites(scene, now, out, ui) {
    const geo = this.terrainGeo
    if (!geo) return
    // the scrubbed moment: a mark on every ridge where it stood then, and one on the ground
    // under it, so the moment reads as a line running back with the terrain's own perspective
    const held = this.scrubAt(ui)
    if (held !== null) {
      for (const ridge of geo.ridges) {
        const spot = this.ridgeSpot(ridge, held)
        if (!spot) continue
        out.push({ key: `scrub:${ridge.sid}`, kind: `${ridge.depth === 0 ? "pulse" : "dot"}|${INK.text}`, x: spot.x, y: spot.y, z: 12 })
        if (spot.y < spot.base - this.u(6)) out.push({ key: `scrubbase:${ridge.sid}`, kind: `mote|${INK.text}`, x: spot.x, y: spot.base, z: 12 })
      }
    }
    const u = (value) => this.u(value)
    for (const ridge of geo.ridges) {
      const session = scene.byId.get(ridge.sid)
      if (!session || session.state !== "working") continue
      const hex = spriteHex(modelColor(session.model, session.provider))
      const rate = scene.rateOf(session.id, now)
      const y = ridge.base - (Math.min(rate, geo.top) / geo.top) * ridge.height
      // the head at now: the front ridge's glows, the ones behind it are smaller with distance
      out.push({ key: `rh:${ridge.sid}`, kind: `${ridge.depth === 0 ? "pulse" : ridge.depth <= 2 ? "dot" : "mote"}|${hex}`, x: ridge.right, y })
      const newest = session.steps[session.steps.length - 1]
      if (newest && newest.end === null && newest.streamed === null && !newest.tools.length) {
        const motes = clamp(Math.floor((now - newest.start) / 5000), 0, 9)
        for (let mote = 0; mote < motes; mote += 1) out.push({ key: `rc:${ridge.sid}:${mote}`, kind: `mote|${INK.live}`, x: ridge.right + u(11), y: ridge.base - u(5) - mote * u(7) * ridge.s })
      }
    }
  },
}
