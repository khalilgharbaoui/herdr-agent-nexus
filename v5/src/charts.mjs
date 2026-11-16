// The live charts beside the core: three histories of the focused thread that say more than a
// number, between its numbers and its live tail.
//
//   CONTEXT   how full the context window was at every model call, against its limit. The 80%
//             and 92% lines are where the context ring turns amber and red.
//   LATENCY   every tool call as a stem (its height is how long it took, log scale, its colour
//             the equipment, red when it failed) and every model call as a thin bar in the
//             model's colour. A call that still runs is hollow and grows.
//   WINDOW    the thread's account: the share of its five-hour window that is used, against an
//             even pace (the diagonal). The solid line is what this program has seen since it
//             started; the dashed line is where the use goes at this pace, an estimate, and the
//             mark where it meets 100% is when the account runs dry.
//
// CONTEXT and LATENCY share the terrain's time window (1, 5 or 30 minutes, `w`) and step with
// it; WINDOW spans the account's own five hours. Every point is a target: a call opens its
// card, the account its own.

import { portOf } from "./model.mjs"
import { WINDOWS } from "./terrain.mjs"
import { PORT_COLOR } from "./theme.mjs"
import { FAMILY, INK, clamp, compactOf, hourMinuteOf, modelColor, rgba, spanOf } from "./util.mjs"

const SLICES = 150
const LOG_LOW = Math.log10(0.1) // a tenth of a second at the foot
const LOG_HIGH = Math.log10(600) // ten minutes at the top
const TRAIL_MS = 5 * 3600e3

export const charts = {
  // What this program has seen of each account's five-hour window: [{ at, used }].
  trailOf(account, now) {
    this.trails ??= new Map()
    const five = account?.five
    if (!account || !five || five.used === null) return []
    let trail = this.trails.get(account.name)
    if (!trail || (trail.resetsAt && five.resetsAt && Math.abs(trail.resetsAt - five.resetsAt) > 60e3)) {
      trail = { resetsAt: five.resetsAt, points: [] } // a new window: the old line is over
      this.trails.set(account.name, trail)
    }
    const last = trail.points[trail.points.length - 1]
    if (!last || last.used !== five.used || now - last.at > 60e3) trail.points.push({ at: now, used: five.used })
    while (trail.points.length > 2 && now - trail.points[0].at > TRAIL_MS) trail.points.shift()
    return trail.points
  },

  signCharts(scene, ui, now) {
    const focus = scene.focused
    if (!focus) return "none"
    const session = focus.session
    const span = ui.window ?? WINDOWS[1]
    const account = (scene.world?.accounts ?? []).find((entry) => entry.name === session.account)
    const trail = this.trailOf(account, now)
    const newest = session.steps[session.steps.length - 1]
    let running = 0
    for (const tool of newest?.tools ?? []) if (tool.end === null) running += 1
    return [this.scrubAt(ui) ?? "", session.id, span, Math.floor(now / (span / SLICES)), session.steps.length, newest?.end ?? 0, newest?.tools.length ?? 0, running, session.context.used, session.context.limit, account?.name ?? "", account?.five?.used ?? "", account?.five?.resetsAt ?? 0, trail.length, Math.floor(now / 30e3)].join("|")
  },

  drawCharts(c, scene, ui, now) {
    const box = this.G.charts
    const focus = scene.focused
    if (!box || !focus || box.w < this.u(360)) return
    const u = (value) => this.u(value)
    const session = focus.session
    const gap = u(26)
    const w = Math.floor((box.w - 2 * gap) / 3)
    const span = ui.window ?? WINDOWS[1]
    const slice = span / SLICES
    const from = Math.floor(now / slice) * slice + slice - span
    const color = modelColor(session.model, session.provider)
    const frame = (index) => ({ x: box.x + index * (w + gap), y: box.y, w, h: box.h, px: box.x + index * (w + gap), py: box.y + u(34), pw: w, ph: box.h - u(34) - u(20) })
    this.chartContext(c, frame(0), session, from, span, now, color)
    this.chartLatency(c, frame(1), session, from, span, now, color)
    this.chartWindow(c, frame(2), scene, session, now)
    // a moment scrubbed on the terrain stands on the two charts that share its window
    const held = this.scrubAt(ui)
    if (held !== null && held >= from && held <= from + span) {
      for (const f of [frame(0), frame(1)]) {
        const x = Math.round(f.px + ((held - from) / span) * f.pw)
        this.line(c, x, f.py, x, f.py + f.ph, rgba(INK.text, 0.75), 1)
      }
    }
  },

  // The head of a chart: its name, what it measures, and the newest value at the right.
  // `brief` is the value in fewer words, for a chart too narrow to hold the name and the value.
  // `target` makes the whole chart answer where no point of it is under the pointer: a card
  // that exists already ({ kind, id }) or what the chart is ({ lines }).
  chartHead(c, f, name, note, value, tone = INK.text, brief = "", target = null) {
    const u = (v) => this.u(v)
    const whole = { x: f.x - u(3), y: f.y, w: f.w + u(6), h: f.py + f.ph + u(22) - f.y }
    if (target?.kind) this.hit(target.kind, target.id, whole)
    else if (target?.lines) this.note(`chart:${name}`, whole, "CHART", `${name}${value ? `: ${value}` : ""}`, target.lines)
    this.label(c, name, f.x, f.y + u(13), INK.dim, "left", 11.5)
    const nameW = this.width(c, name, { size: 11.5, family: FAMILY.label, weight: "600", spacing: 2.6 })
    const valueStyle = { size: 12.5, family: FAMILY.monoMedium, color: tone, align: "right" }
    if (value && brief && nameW + this.width(c, value, valueStyle) + u(12) > f.w) value = brief
    const valueW = value ? this.width(c, value, valueStyle) : 0
    if (value) this.text(c, value, f.x + f.w, f.y + u(13), valueStyle)
    const room = f.w - nameW - valueW - u(26)
    if (room > u(60)) this.text(c, this.fit(c, note, room, { size: 11 }), f.x + nameW + u(12), f.y + u(13), { size: 11, color: INK.faint })
    // the plot's floor and its time axis
    this.line(c, f.px, f.py + f.ph, f.px + f.pw, f.py + f.ph, INK.faint)
  },

  timeAxis(c, f, span) {
    const u = (v) => this.u(v)
    for (let tick = 0; tick <= 2; tick += 1) {
      const x = Math.round(f.px + (tick / 2) * f.pw)
      this.line(c, x, f.py + f.ph, x, f.py + f.ph + u(4), INK.faint)
      this.text(c, tick === 2 ? "now" : `-${spanOf(span * (1 - tick / 2))}`, x, f.py + f.ph + u(16), { size: 10.5, color: tick === 2 ? INK.live : INK.faint, align: tick === 2 ? "right" : tick === 0 ? "left" : "center" })
    }
  },

  chartContext(c, f, session, from, span, now, color) {
    const u = (v) => this.u(v)
    const limit = session.context.limit || 0
    const readings = session.steps.filter((step) => step.ctx > 0)
    const used = session.context.used || readings[readings.length - 1]?.ctx || 0
    const share = limit && used ? used / limit : null
    const tone = share === null ? INK.soft : share >= 0.92 ? INK.bad : share >= 0.8 ? INK.warn : INK.text
    this.chartHead(c, f, "CONTEXT", "at every model call", used ? `${compactOf(used)}${limit ? ` of ${compactOf(limit)}  ·  ${Math.round(share * 100)}%` : ""}` : "n/a", tone, used && limit ? `${Math.round(share * 100)}%` : "", { kind: "context", id: session.id })
    this.timeAxis(c, f, span)
    const top = limit || Math.max(1, ...readings.map((step) => step.ctx)) * 1.15
    const xOf = (time) => f.px + clamp((time - from) / span, 0, 1) * f.pw
    const yOf = (value) => f.py + f.ph - clamp(value / top, 0, 1) * f.ph
    if (limit) {
      // where the context ring turns amber and red
      for (const [level, hex] of [[0.8, INK.warn], [0.92, INK.bad]]) {
        const y = Math.round(yOf(limit * level))
        c.setLineDash([u(3), u(5)])
        this.line(c, f.px, y, f.px + f.pw, y, rgba(hex, 0.5))
        c.setLineDash([])
        this.text(c, `${Math.round(level * 100)}%`, f.px + f.pw, y - u(3), { size: 10, color: rgba(hex, 0.8), align: "right" })
      }
    }
    if (!readings.length) {
      this.text(c, "no model call has reported its context yet", f.px, f.py + f.ph - u(10), { size: 11, color: INK.faint })
      return
    }
    // a step line: the context a call was given holds until the next call
    let level = 0
    for (const step of readings) if (step.start <= from) level = step.ctx
    c.strokeStyle = color
    c.lineWidth = 1.75
    c.lineJoin = "round"
    c.beginPath()
    let pen = false
    if (level) {
      c.moveTo(f.px, yOf(level))
      pen = true
    }
    const inside = readings.filter((step) => step.start > from)
    for (const step of inside) {
      const x = xOf(step.start)
      if (pen) c.lineTo(x, yOf(level))
      else c.moveTo(x, yOf(step.ctx))
      c.lineTo(x, yOf(step.ctx))
      level = step.ctx
      pen = true
    }
    c.lineTo(f.px + f.pw, yOf(level))
    c.stroke()
    // the light under the line, and a point at every call
    c.lineTo(f.px + f.pw, f.py + f.ph)
    c.lineTo(f.px, f.py + f.ph)
    c.closePath()
    c.fillStyle = rgba(color, 0.07)
    c.fill()
    for (const step of inside) {
      const x = Math.round(xOf(step.start))
      const y = Math.round(yOf(step.ctx))
      c.fillStyle = color
      c.fillRect(x - 1.5, y - 1.5, 3, 3)
      this.hit("step", `${session.id}:${step.seq}`, { x: x - u(6), y: y - u(6), w: u(12), h: u(12) }, { sid: session.id, step })
    }
    this.hit("thread", session.id, { x: f.px, y: f.py, w: f.pw, h: f.ph })
  },

  chartLatency(c, f, session, from, span, now, color) {
    const u = (v) => this.u(v)
    const xOf = (time) => f.px + clamp((time - from) / span, 0, 1) * f.pw
    const yOf = (ms) => f.py + f.ph - clamp((Math.log10(Math.max(100, ms) / 1000) - LOG_LOW) / (LOG_HIGH - LOG_LOW), 0, 1) * f.ph
    const tools = []
    const calls = []
    for (const step of session.steps) {
      if ((step.end ?? now) >= from) calls.push(step)
      for (const tool of step.tools) if ((tool.end ?? now) >= from) tools.push({ tool, step })
    }
    const done = tools.filter((entry) => entry.tool.end !== null).map((entry) => entry.tool.end - entry.tool.start).sort((a, b) => a - b)
    const median = done.length ? done[Math.floor(done.length / 2)] : null
    this.chartHead(c, f, "LATENCY", "tool calls and model calls", median === null ? (tools.length ? "running" : "n/a") : `median tool ${spanOf(median)}`, INK.text, median === null ? "" : spanOf(median), { lines: [["WHAT", "every tool call of the focused thread as a stem at the moment it started: as tall as it took, on a log scale from 0.1 s to 10 min, in its equipment's colour, red when it failed, hollow while it runs. A thin bar is a model call"], ["DOTTED", "the median tool call in the window"], ["WINDOW", "the terrain's own (1, 5 or 30 minutes): w changes it"], ["POINT", "a stem is a target: the call's own card"]] })
    this.timeAxis(c, f, span)
    for (const [ms, word] of [[1000, "1s"], [10e3, "10s"], [60e3, "1m"], [600e3, "10m"]]) {
      const y = Math.round(yOf(ms))
      this.line(c, f.px, y, f.px + f.pw, y, rgba(INK.ghost, 0.9))
      this.text(c, word, f.px + f.pw, y - u(3), { size: 10, color: INK.faint, align: "right" })
    }
    if (!tools.length && !calls.length) {
      this.text(c, "no call in this window", f.px, f.py + f.ph - u(10), { size: 11, color: INK.faint })
      return
    }
    const floor = f.py + f.ph
    // model calls: a thin bar from the floor to how long the call took
    for (const step of calls) {
      const open = step.end === null
      const x = Math.round(xOf(step.start))
      const y = Math.round(yOf((step.end ?? now) - step.start))
      c.fillStyle = rgba(color, open ? 0.75 : 0.34)
      c.fillRect(x, y, 1, floor - y)
      if (open) c.fillRect(x - 2, y, 5, 1)
    }
    // tool calls: a stem with a diamond on it, the equipment's colour, red when it failed
    for (const { tool, step } of tools) {
      const open = tool.end === null
      const failed = tool.status === "error"
      const hex = failed ? INK.bad : PORT_COLOR[portOf(tool.name)]
      const x = Math.round(xOf(tool.start))
      const y = Math.round(yOf((tool.end ?? now) - tool.start))
      c.fillStyle = rgba(hex, 0.55)
      c.fillRect(x, y, 1.5, floor - y)
      const r = u(failed ? 4 : 3.2)
      c.beginPath()
      c.moveTo(x, y - r)
      c.lineTo(x + r, y)
      c.lineTo(x, y + r)
      c.lineTo(x - r, y)
      c.closePath()
      if (open) {
        c.strokeStyle = hex
        c.lineWidth = 1.5
        c.stroke()
      } else {
        c.fillStyle = hex
        c.fill()
      }
      this.hit("tool", tool.id, { x: x - u(6), y: y - u(7), w: u(12), h: u(14) }, { sid: session.id, tool, step })
    }
    this.hit("thread", session.id, { x: f.px, y: f.py, w: f.pw, h: f.ph })
    if (median !== null) {
      const y = Math.round(yOf(median))
      c.setLineDash([u(2), u(4)])
      this.line(c, f.px, y, f.px + f.pw, y, rgba(INK.soft, 0.55))
      c.setLineDash([])
    }
  },

  chartWindow(c, f, scene, session, now) {
    const u = (v) => this.u(v)
    const account = (scene.world?.accounts ?? []).find((entry) => entry.name === session.account)
    const five = account?.five
    const known = five && five.used !== null && five.resetsAt && five.span
    const name = `WINDOW${account ? `  ${String(account.name).toUpperCase()}` : ""}`
    if (!known) {
      this.chartHead(c, f, name, "five hours of the account", five && five.used !== null ? `${Math.round(five.used)}% used` : "n/a", INK.soft, "", account ? { kind: "account", id: account.name } : { lines: [["WHAT", "the focused thread's account: the used share of its five hour window over the window's own time, against an even pace"], ["NOW", "this thread's account is not known, so there is nothing to draw"]] })
      this.text(c, account ? "the account has not reported a window yet" : "this thread's account is not known", f.px, f.py + f.ph - u(10), { size: 11, color: INK.faint })
      return
    }
    const start = five.resetsAt - five.span
    const tone = five.used >= 90 ? INK.bad : account.dryAt ? INK.warn : INK.text
    this.chartHead(c, f, name, "used against an even pace", `${Math.round(five.used)}% used${account.dryAt ? `  ·  dry ${hourMinuteOf(account.dryAt)}` : ""}`, tone, `${Math.round(five.used)}%`, { kind: "account", id: account.name })
    const xOf = (time) => f.px + clamp((time - start) / five.span, 0, 1) * f.pw
    const yOf = (used) => f.py + f.ph - clamp(used / 100, 0, 1) * f.ph
    // the axis is the window itself: when it began, when it resets
    for (const [time, align] of [[start, "left"], [five.resetsAt, "right"]]) {
      this.line(c, xOf(time), f.py + f.ph, xOf(time), f.py + f.ph + u(4), INK.faint)
      this.text(c, `${align === "right" ? "resets " : ""}${hourMinuteOf(time)}`, xOf(time), f.py + f.ph + u(16), { size: 10.5, color: INK.faint, align })
    }
    this.line(c, f.px, f.py, f.px + f.pw, f.py, rgba(INK.bad, 0.4))
    this.text(c, "100%", f.px + f.pw, f.py + u(11), { size: 10, color: rgba(INK.bad, 0.8), align: "right" })
    // an even pace: used up exactly at the reset
    this.line(c, f.px, f.py + f.ph, f.px + f.pw, f.py, rgba(INK.live, 0.45))
    // what was seen since this program started
    const trail = this.trailOf(account, now)
    const nowX = xOf(now)
    const nowY = yOf(five.used)
    c.strokeStyle = tone
    c.lineWidth = 1.75
    c.lineJoin = "round"
    c.beginPath()
    trail.forEach((point, index) => {
      const x = xOf(point.at)
      const y = yOf(point.used)
      if (index) c.lineTo(x, y)
      else c.moveTo(x, y)
    })
    c.lineTo(nowX, nowY)
    c.stroke()
    // before that nothing is known but the level now: a faint dotted line from the window's start
    const firstX = xOf(trail[0]?.at ?? now)
    if (firstX - f.px > u(8)) {
      c.setLineDash([u(1.5), u(5)])
      this.line(c, f.px, f.py + f.ph, firstX, yOf(trail[0]?.used ?? five.used), rgba(INK.soft, 0.4))
      c.setLineDash([])
    }
    // where it goes at this pace: an estimate, dashed, to the reset or to the moment it runs dry
    if (account.pace && five.used > 0 && five.used < 100) {
      const endAt = account.dryAt || five.resetsAt
      const endUsed = account.dryAt ? 100 : five.used + ((five.resetsAt - now) / (now - start)) * five.used
      c.setLineDash([u(5), u(4)])
      this.line(c, nowX, nowY, xOf(endAt), yOf(endUsed), rgba(tone, 0.7), 1.25)
      c.setLineDash([])
      const labelLeft = xOf(endAt) > f.px + f.pw * 0.55
      this.text(c, account.dryAt ? "dry at this pace" : "at this pace", xOf(endAt) + (labelLeft ? -u(8) : u(8)), Math.min(f.py + f.ph - u(6), yOf(endUsed) + u(14)), { size: 10, color: rgba(tone, 0.85), align: labelLeft ? "right" : "left" })
      if (account.dryAt) {
        // the dry mark: a hollow diamond where the line meets the top
        const x = Math.round(xOf(account.dryAt))
        c.strokeStyle = INK.warn
        c.lineWidth = 1.5
        c.beginPath()
        c.moveTo(x, f.py - u(5))
        c.lineTo(x + u(5), f.py)
        c.lineTo(x, f.py + u(5))
        c.lineTo(x - u(5), f.py)
        c.closePath()
        c.stroke()
      }
    }
    // now
    this.line(c, nowX, f.py, nowX, f.py + f.ph, rgba(INK.live, 0.28))
    c.fillStyle = tone
    c.fillRect(Math.round(nowX) - 2, Math.round(nowY) - 2, 5, 5)
    this.hit("account", account.name, { x: f.px, y: f.py, w: f.pw, h: f.ph })
  },
}
