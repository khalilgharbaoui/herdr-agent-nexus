// The time terrain: every listed thread's output over the last minutes as a ridge, the focused
// thread in front and the others receding behind it. Height is tokens per second, time runs
// from the left to now at the right edge, and the whole terrain moves with the clock. Tool
// calls, failures, flags and dispatches are marked on the ridge they belong to.
//
// It is drawn into the still layer by the stage; the heads of the ridges (the newest reading of
// a working thread) and the charge of a model call that has not said its first word yet are
// sprites, so they move between repaints.

import { portOf, wroteOf } from "./model.mjs"
import { LEVEL_COLOR, PORT_COLOR, clean, spriteHex } from "./theme.mjs"
import { FAMILY, INK, clamp, modelColor, rgba, spanOf } from "./util.mjs"

export const WINDOWS = [60e3, 5 * 60e3, 30 * 60e3]
const BINS = 150
const MAX_RIDGES = 7
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
    for (const row of scene.threads.slice(0, 24)) parts.push(row.session.id, row.session.steps.length, row.session.steps[row.session.steps.length - 1]?.end ?? 0, row.session.alerts.length)
    return parts.join("|")
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
    this.text(c, "tokens a second, every listed thread, the focused one in front", T.x + titleW + u(18), T.y + u(16), { size: 11.5, color: INK.faint })
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
    const frontY = T.y + T.h - u(24)
    const backY = T.y + u(70)
    const stepY = count > 1 ? Math.min(u(30), (frontY - backY) / (count - 1)) : 0
    const gutter = u(170)
    const geo = { from, span, slice, top, ridges: [] }
    // far to near, so a nearer ridge is drawn over a farther one
    for (let index = count - 1; index >= 0; index -= 1) {
      const ridge = ridges[index]
      const depth = count > 1 ? index / (MAX_RIDGES - 1) : 0
      const shrink = 1 - depth * 0.3
      const left = T.x + gutter + index * u(20)
      const right = T.x + T.w - u(8) - index * u(9)
      const base = Math.round(frontY - index * stepY)
      const height = u(104) * shrink
      const color = ridge.session.state === "waiting" ? INK.warn : modelColor(ridge.session.model, ridge.session.provider)
      const alpha = index === 0 ? 1 : 0.72 - depth * 0.4
      const xOf = (bin) => left + ((bin + 0.5) / BINS) * (right - left)
      const yOf = (value) => base - (Math.min(value, top) / top) * height
      // the ground line, then the ridge with a light under it
      this.line(c, left, base, right, base, rgba(INK.faint, index === 0 ? 0.9 : 0.45))
      const smooth = (bin) => (ridge.values[Math.max(0, bin - 1)] + 2 * ridge.values[bin] + ridge.values[Math.min(BINS - 1, bin + 1)]) / 4
      if (!ridge.empty) {
        c.beginPath()
        c.moveTo(left, base)
        for (let bin = 0; bin < BINS; bin += 1) c.lineTo(xOf(bin), yOf(smooth(bin)))
        c.lineTo(right, base)
        c.closePath()
        const gradient = c.createLinearGradient(0, base - height, 0, base)
        gradient.addColorStop(0, rgba(color, 0.34 * alpha))
        gradient.addColorStop(1, rgba(color, 0.02))
        c.fillStyle = gradient
        c.fill()
        c.strokeStyle = rgba(color, alpha)
        c.lineWidth = index === 0 ? 2 : 1.25
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
      // events on the ridge: tool calls (a failure stands taller, in red), flags, a dispatch
      const xAt = (time) => left + ((time - from) / span) * (right - left)
      const near = index < 3
      for (const step of ridge.session.steps) {
        for (const tool of step.tools) {
          if (tool.start < from) continue
          const failed = tool.status === "error"
          if (!near && !failed) continue
          const x = Math.round(xAt(tool.start))
          const size = u(failed ? 4 : 3) * shrink
          c.fillStyle = failed ? INK.bad : rgba(PORT_COLOR[portOf(tool.name)], alpha * (tool.end === null ? 1 : 0.8))
          if (failed) c.fillRect(x - 1, base - u(14) * shrink, 2, u(14) * shrink)
          c.beginPath()
          c.moveTo(x, base - size)
          c.lineTo(x + size, base)
          c.lineTo(x, base + size)
          c.lineTo(x - size, base)
          c.closePath()
          c.fill()
          if (index === 0) this.hit("tool", tool.id, { x: x - u(6), y: base - u(7), w: u(12), h: u(14) }, { sid: ridge.session.id, tool, step })
        }
      }
      for (const alert of ridge.session.alerts) {
        if (!alert.since || alert.since < from || alert.muted) continue
        const x = Math.round(xAt(alert.since))
        c.fillStyle = LEVEL_COLOR[alert.level] ?? INK.soft
        c.beginPath()
        c.moveTo(x, base - u(20) * shrink)
        c.lineTo(x + u(7) * shrink, base - u(16) * shrink)
        c.lineTo(x, base - u(12) * shrink)
        c.closePath()
        c.fill()
        c.fillRect(x - 1, base - u(20) * shrink, 1, u(20) * shrink)
        this.hit("alert", alert.key, { x: x - u(4), y: base - u(22) * shrink, w: u(14), h: u(22) * shrink }, { alert })
      }
      if (ridge.session.parentId && ridge.session.created >= from) {
        const x = Math.round(xAt(ridge.session.created))
        c.strokeStyle = PORT_COLOR.agent
        c.lineWidth = 1.5
        c.beginPath()
        c.arc(x, base, u(5) * shrink, 0, Math.PI * 2)
        c.stroke()
      }
      // who this ridge is
      const focused = index === 0 && ridge.session.id === scene.focus.id
      const number = String(ridge.row.index + 1).padStart(2, "0")
      const nameStyle = { size: index === 0 ? 12.5 : 11.5, color: focused ? INK.text : rgba(INK.soft, 0.5 + alpha * 0.5) }
      this.text(c, number, T.x + index * u(6), base + u(4), { size: 11.5, color: rgba(color, Math.max(0.5, alpha)) })
      this.text(c, this.fit(c, clean(ridge.session.title), gutter - u(40) - index * u(6) + index * u(20), nameStyle), T.x + u(24) + index * u(6), base + u(4), nameStyle)
      this.hit("thread", ridge.session.id, { x: T.x, y: base - u(12), w: gutter + index * u(20) - u(8), h: u(18) })
      geo.ridges.push({ sid: ridge.session.id, index: ridge.row.index, left, right, base, height, values: ridge.values, color, empty: ridge.empty, depth: index })
    }
    geo.ridges.reverse() // nearest first, for hit testing
    // the time axis under the front ridge, and what the height stands for
    const front = geo.ridges[0]
    if (front) {
      for (let tick = 0; tick <= 5; tick += 1) {
        const x = front.left + (tick / 5) * (front.right - front.left)
        this.line(c, x, frontY, x, frontY + u(4), INK.faint)
        this.text(c, tick === 5 ? "now" : `-${spanOf(span * (1 - tick / 5))}`, x, frontY + u(18), { size: 11, color: tick === 5 ? INK.live : INK.faint, align: tick === 5 ? "right" : tick === 0 ? "left" : "center" })
      }
      this.text(c, peak > 0 ? `a ridge at full height is ${top} tok/s  ·  peak ${peak >= 10 ? Math.round(peak) : peak.toFixed(1)}` : "no output in this window", T.x + T.w, T.y + u(44), { size: 11, color: INK.faint, align: "right" })
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

  // The moving parts: a head where each working thread's ridge meets now, at the height of its
  // newest reading, and above it one mote for every five seconds a model call has been running
  // without a first word (the charge before it speaks).
  terrainSprites(scene, now, out) {
    const geo = this.terrainGeo
    if (!geo) return
    const u = (value) => this.u(value)
    for (const ridge of geo.ridges) {
      const session = scene.byId.get(ridge.sid)
      if (!session || session.state !== "working") continue
      const hex = spriteHex(modelColor(session.model, session.provider))
      const rate = scene.rateOf(session.id, now)
      const y = ridge.base - (Math.min(rate, geo.top) / geo.top) * ridge.height
      out.push({ key: `rh:${ridge.sid}`, kind: `head|${hex}`, x: ridge.right, y })
      const newest = session.steps[session.steps.length - 1]
      if (newest && newest.end === null && newest.streamed === null && !newest.tools.length) {
        const motes = clamp(Math.floor((now - newest.start) / 5000), 0, 9)
        for (let mote = 0; mote < motes; mote += 1) out.push({ key: `rc:${ridge.sid}:${mote}`, kind: `mote|${INK.live}`, x: ridge.right + u(9), y: ridge.base - u(5) - mote * u(7) * (1 - ridge.depth * 0.05) })
      }
    }
  },
}
