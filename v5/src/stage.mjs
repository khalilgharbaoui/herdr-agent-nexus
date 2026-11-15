// The focus stage: one thread shown large.
//
// Left, the core: a body in space. A globe of dots (the turn's output, see flock.mjs) inside a
// ring system seen from above and in front: the turn clock is the outer ring, with every tool
// call standing on it as a pillar and every model call hanging under it as a bar; the context
// window is the inner ring; each kind of equipment has its own lane round the globe, and the
// thread's subagents circle on the outermost orbit. Under it the turn's time, flat and sharp.
// Right, who it is, where it lives, its numbers, three live charts and the live tail.
//
// The far half of every ring is drawn first and dimmer, the near half last and brighter, and
// the globe's dots are sprites behind and in front of this layer, so the rings pass behind the
// globe and in front of it as they would.

import { LANES, lanePoint, makeView, project, ringPoint } from "./body.mjs"
import { cacheSign, cacheState, leftWord, lifeWord } from "./cache.mjs"
import { portOf } from "./model.mjs"
import { FLOCK_CAP, flockUnit } from "./flock.mjs"
import { PORT_COLOR, STATE_WORD, bare, clean, homed, wrap } from "./theme.mjs"
import { FAMILY, INK, TAU, agoOf, clamp, clockOf, compactOf, hourMinuteOf, modelColor, moneyOf, quantile, rgba, shortModel, spanOf, timerOf, toolMeta } from "./util.mjs"

const easeOut = (t) => 1 - (1 - t) ** 3
const DEG = Math.PI / 180

export const stage = {
  // The view the still layer is drawn with: the flock's own, in whole degrees, so the rings are
  // repainted only when the lean really changed.
  coreView(session) {
    const flock = this.flock
    const mine = flock.sid === session?.id
    const degrees = mine ? Math.round(flock.pitch / DEG) : 54
    return { view: makeView(this.G.core, degrees * DEG), degrees, rs: mine && flock.rs ? Math.round(flock.rs / 4) * 4 : Math.round(this.G.core.RB * 0.66), mine }
  },

  // How the context ring closes. The context is known at every model call where the thread's
  // Claude Code transcript was found (see live.mjs, fillContext), and otherwise only when a
  // turn ends. Its pace is the tokens a model call added: the median over the last stretches
  // between two readings. From that:
  //   estimate  what the calls made since the last reading have probably added
  //   calls     how many more calls fit before the window is full
  // Both are estimates and are drawn and worded as such. Null when nothing was reported.
  contextPace(session) {
    const { used, limit } = session.context
    if (!limit || !used) return null
    const marks = []
    session.steps.forEach((step, index) => {
      if (step.ctx > 0) marks.push([index, step.ctx])
    })
    const rates = []
    for (let index = 1; index < marks.length; index += 1) {
      const calls = marks[index][0] - marks[index - 1][0]
      const gain = marks[index][1] - marks[index - 1][1]
      if (calls > 0 && gain > 0) rates.push(gain / calls)
    }
    const left = Math.max(0, limit - used)
    const since = marks.length ? session.steps.length - 1 - marks[marks.length - 1][0] : 0
    const exact = session.context.from === "transcript"
    if (!rates.length) return { left, perCall: 0, n: 0, since, estimate: 0, calls: 0, exact }
    const recent = rates.slice(-12).sort((a, b) => a - b)
    const perCall = quantile(recent, 0.5)
    const estimate = Math.min(left, perCall * since)
    return { left, perCall, n: recent.length, since, estimate, calls: Math.ceil((left - estimate) / perCall), exact }
  },

  // A stretch of a ring, from angle a0 to a1 (clockwise from the far point), drawn in pieces so
  // each piece can be as wide and as bright as its nearness. `far` picks the half to draw.
  ringArc(c, view, radius, a0, a1, hex, alpha, width, far, lift = 0) {
    if (a1 <= a0) return
    const step = 4 * DEG
    const spot = [0, 0, 0, 0]
    c.lineCap = "butt"
    for (let from = a0; from < a1 - 1e-6; from += step) {
      const to = Math.min(a1, from + step)
      const middle = (from + to) / 2
      if (Math.cos(middle) > 0 !== far) continue
      const near = (1 - Math.cos(middle)) / 2
      c.strokeStyle = rgba(hex, (0.42 + 0.58 * near) * alpha)
      c.lineWidth = Math.max(1, width * (0.7 + 0.55 * near))
      c.beginPath()
      ringPoint(view, radius, from - 0.004, lift, spot)
      c.moveTo(spot[0], spot[1])
      ringPoint(view, radius, middle, lift, spot)
      c.lineTo(spot[0], spot[1])
      ringPoint(view, radius, to + 0.004, lift, spot)
      c.lineTo(spot[0], spot[1])
      c.stroke()
    }
  },

  // A ring as a row of points: larger and brighter where it is nearer.
  ringDots(c, view, radius, color, count, far, size = 1) {
    const spot = [0, 0, 0, 0]
    for (let index = 0; index < count; index += 1) {
      const angle = ((index + 0.5) / count) * TAU
      if (Math.cos(angle) > 0 !== far) continue
      const near = (1 - Math.cos(angle)) / 2
      ringPoint(view, radius, angle, 0, spot)
      this.dot(c, spot[0], spot[1], this.S * size * (0.7 + near * 0.9), rgba(color, 0.2 + near * 0.55))
    }
  },

  // The flock's own line above the core: how many dots, what one stands for, what the flock is
  // doing. It is a region of its own because it changes with every dot.
  signFlockLine(scene) {
    const session = scene.focused?.session
    if (!session) return "none"
    const flock = this.flock
    return [session.id, session.state, session.turn?.out ?? session.lastOut ?? 0, flock.sid === session.id ? `${flock.state}|${flock.count}|${flock.unit}` : ""].join("|")
  },

  drawFlockLine(c, scene) {
    const session = scene.focused?.session
    if (!session) return
    const u = (value) => this.u(value)
    const core = this.G.core
    const flock = this.flock
    const mine = flock.sid === session.id
    const out = session.turn?.out ?? session.lastOut ?? 0
    const unit = mine ? flock.unit : flockUnit(out)
    const dots = mine ? flock.count : Math.min(FLOCK_CAP, Math.floor(out / unit))
    const flockLine = out || dots ? `${dots} dot${dots === 1 ? "" : "s"} × ${compactOf(unit)} tok  ·  ${mine ? flock.state : "forming"}` : "no output reported for this turn"
    const flockX = core.left
    const flockY = core.top - u(12)
    const flockW = this.run(c, flockX, flockY, [["FLOCK  ", { size: 11.5, family: FAMILY.label, weight: "600", color: INK.dim, spacing: 2.6 }], [flockLine, { size: 12.5, color: session.state === "working" ? INK.soft : INK.dim }]]) - flockX
    this.hit("flock", session.id, { x: flockX, y: flockY - u(14), w: flockW, h: u(20) })
  },

  signCore(scene, ui, now) {
    const focus = scene.focused
    if (!focus) return "none"
    const session = focus.session
    const { degrees, rs } = this.coreView(session)
    const turn = this.turnWindow(session, now)
    const parts = [session.id, focus.index, session.state, session.phase.key, session.context.used, session.steps.length, degrees, rs, this.flock.unit, scene.threads.filter((row) => row.parent?.session.id === session.id).length]
    const pace = this.contextPace(session)
    if (pace) parts.push(Math.round(pace.perCall / 50), pace.since, pace.calls)
    if (turn) {
      const elapsed = turn.end - turn.start
      const scale = this.turnScale(session, elapsed)
      // the arc is repainted when its head has moved two pixels, and never more than once a second
      // (a turn past its usual length has a scale that grows with it, so its head stands still: the
      // small term keeps rounding noise from flipping the figure, and the core with it, every frame)
      parts.push(Math.round(scale / 1000), turn.live ? Math.floor(Math.min(now / 1000, (elapsed / scale) * (this.G.core.RA * 3)) + 1e-4) : 0)
      for (const tool of session.phase.tools) parts.push(tool.id, Math.floor(Math.log10(Math.max(1, now - tool.start)) * 16))
      const newest = session.steps[session.steps.length - 1]
      if (newest) parts.push(newest.end === null ? "open" : "closed", newest.tools.length, newest.tools[newest.tools.length - 1]?.status ?? "")
    }
    const intro = (now - scene.focus.since) / 450
    if (intro < 1) parts.push(Math.floor(intro * 6))
    return parts.join("|")
  },

  drawCore(c, scene, ui, now) {
    const G = this.G
    const u = (value) => this.u(value)
    const focus = scene.focused
    const core = G.core
    this.clock = null
    if (!focus) {
      this.label(c, "NO THREADS YET", core.cx, core.cy, INK.dim, "center", 14)
      return
    }
    const session = focus.session
    const waiting = session.state === "waiting"
    const color = waiting ? INK.warn : modelColor(session.model, session.provider)
    const working = session.state === "working"
    const { cx, cy, RA, RB, Rm } = core
    const { view, degrees, rs, mine } = this.coreView(session)
    const flock = this.flock
    const intro = easeOut(clamp((now - scene.focus.since) / 450, 0, 1)) // the rings sweep in when the focus moves
    const spot = [0, 0, 0, 0]
    const tip = [0, 0, 0, 0]

    // the frame: four corners round the body
    const box = { x: core.left, y: core.top, w: core.right - core.left, h: core.bottom - core.top }
    this.brackets(c, box, INK.faint, 14)
    this.hit("clock", session.id, box)

    // what the turn is made of, laid on the clock
    const turn = this.turnWindow(session, now)
    const clock = { sid: session.id, steps: [], tools: [] }
    const marks = [] // every bar and pillar: { far, x0, y0, x1, y1, color, width }
    let elapsed = 0
    let scale = 0
    let fade = 1
    const lanesUsed = new Map()
    if (turn) {
      elapsed = turn.end - turn.start
      scale = this.turnScale(session, elapsed)
      fade = turn.live ? 1 : 0.42
      const longest = Math.log10(600e3)
      const most = Math.log10(20001)
      for (const step of session.steps) {
        if (step.start < turn.start - 500 || step.start > turn.end) continue
        const angle = clamp((step.start - turn.start) / scale, 0, 0.999) * intro * TAU
        const wrote = step.out || step.chars / 3.6
        const depth = u(5) + (Math.log10(1 + wrote) / most) * u(24)
        const near = (1 - Math.cos(angle)) / 2
        // a model call hangs under the ring: longer when it wrote more
        ringPoint(view, RA - u(7), angle, 0, spot)
        ringPoint(view, RA - u(7), angle, -depth, tip)
        marks.push({ far: Math.cos(angle) > 0, x0: spot[0], y0: spot[1], x1: tip[0], y1: tip[1], color: rgba(step.end === null && turn.live ? INK.text : color, (step.end === null ? 1 : 0.5 + 0.4 * near) * fade), width: 1.4 + near * 1.1 })
        clock.steps.push({ angle, step, x0: spot[0], y0: spot[1], x1: tip[0], y1: tip[1] })
        for (const tool of step.tools) {
          const at = clamp((tool.start - turn.start) / scale, 0, 0.999) * intro * TAU
          const span = Math.max(1, (tool.end ?? now) - tool.start)
          const reach = u(6) + (Math.min(longest, Math.log10(span)) / longest) * u(38)
          const running = tool.end === null && turn.live
          const port = portOf(tool.name)
          const close = (1 - Math.cos(at)) / 2
          // a tool call stands on the ring: taller when it took longer (log scale), red when it failed
          ringPoint(view, RA + u(3), at, 0, spot)
          ringPoint(view, RA + u(3), at, reach, tip)
          marks.push({ far: Math.cos(at) > 0, x0: spot[0], y0: spot[1], x1: tip[0], y1: tip[1], color: tool.status === "error" ? rgba(INK.bad, fade) : rgba(PORT_COLOR[port], (running ? 1 : 0.5 + 0.4 * close) * fade), width: running ? 3.5 : 1.4 + close * 1.2 })
          clock.tools.push({ angle: at, tool, step, x0: spot[0], y0: spot[1], x1: tip[0], y1: tip[1] })
          const lane = lanesUsed.get(port) ?? { count: 0, running: 0 }
          lane.count += 1
          if (running) lane.running += 1
          lanesUsed.set(port, lane)
        }
      }
    }
    this.clock = clock
    const limit = session.context.limit
    const used = session.context.used
    const fill = limit && used ? used / limit : 0
    const fillColor = fill >= 0.92 ? INK.bad : fill >= 0.8 ? INK.warn : INK.soft
    const kids = scene.threads.some((row) => row.parent?.session.id === session.id)
    // the context ring closes: what the calls since the last report have probably added, and
    // where each further call would take it
    const pace = this.contextPace(session)
    const guess = pace && limit ? pace.estimate / limit : 0
    const stride = pace?.perCall && limit ? pace.perCall / limit : 0
    const radial = (angle, inner, outer, color, width) => {
      ringPoint(view, inner, angle, 0, spot)
      ringPoint(view, outer, angle, 0, tip)
      this.line(c, spot[0], spot[1], tip[0], tip[1], color, width)
    }

    // one half of the ring system: the far half before the globe, the near half after it
    const half = (far) => {
      // the outermost orbit, where the subagents circle
      this.ringDots(c, view, Rm, kids ? INK.dim : INK.faint, 132, far, kids ? 1.15 : 0.9)
      // the turn clock: the track, what such turns usually take, how far this one has come
      this.ringArc(c, view, RA, 0, TAU, INK.faint, 1, 1, far)
      if (turn) {
        const expect = session.expect
        if (expect) this.ringArc(c, view, RA - u(13), (expect.p25 / scale) * TAU, Math.min(1, expect.p75 / scale) * TAU, INK.dim, 0.75 * fade, u(3.5), far)
        this.ringArc(c, view, RA, 0, Math.min(0.999, elapsed / scale) * intro * TAU, color, fade, u(4.5), far)
      }
      // the context window: the track, the gate where it closes, where it turns amber and red
      this.ringArc(c, view, RB, 0, TAU, INK.faint, 0.6, 1, far)
      if (far) {
        radial(0, RB - u(11), RB + u(11), rgba(INK.soft, fill ? 0.8 : 0.4), 1.5)
        if (fill) {
          radial(0.8 * TAU, RB + u(4), RB + u(11), rgba(INK.warn, 0.7), 1.5)
          radial(0.92 * TAU, RB + u(4), RB + u(11), rgba(INK.bad, 0.7), 1.5)
        }
      }
      if (fill) {
        const head = clamp(fill, 0.004, 1) * intro * TAU
        this.ringArc(c, view, RB, 0, head, fill >= 0.8 ? fillColor : INK.soft, fill >= 0.8 ? 1 : 0.8, u(5), far)
        // dashed: what the calls made since the last report have probably added
        const reach = clamp(fill + guess, 0, 1) * intro * TAU
        const dash = 2.2 * DEG
        for (let from = head + dash * 0.6; from < reach; from += dash * 2) this.ringArc(c, view, RB, from, Math.min(reach, from + dash), fill + guess >= 0.8 ? (fill + guess >= 0.92 ? INK.bad : INK.warn) : INK.soft, 0.75, u(3), far)
        // a tick for each further call at this pace, sixteen at most
        if (stride > 0) {
          for (let call = 1; call <= 16; call += 1) {
            const share = fill + guess + stride * call
            if (share >= 1) break
            const angle = share * intro * TAU
            if (Math.cos(angle) > 0 !== far) continue
            radial(angle, RB - u(4), RB + u(4), rgba(INK.dim, 0.35 + 0.45 * ((1 - Math.cos(angle)) / 2)), 1)
          }
        }
      }
      for (const mark of marks) {
        if (mark.far !== far) continue
        c.strokeStyle = mark.color
        c.lineWidth = mark.width
        c.beginPath()
        c.moveTo(mark.x0, mark.y0)
        c.lineTo(mark.x1, mark.y1)
        c.stroke()
      }
    }
    half(true)
    if (turn && session.expect) {
      // the tick at the median
      const angle = (session.expect.p50 / scale) * TAU
      ringPoint(view, RA - u(20), angle, 0, spot)
      ringPoint(view, RA - u(6), angle, 0, tip)
      this.line(c, spot[0], spot[1], tip[0], tip[1], rgba(INK.soft, fade), 1.5)
    }

    // the globe: its outline (it swells with the context window), its equator on the ring plane
    // and its axis, the turn's first output at the south pole and its newest at the north
    c.strokeStyle = rgba(color, working ? 0.2 : 0.12)
    c.lineWidth = 1
    c.beginPath()
    c.arc(cx, cy, rs * (view.F / Math.sqrt(view.F * view.F - rs * rs)), 0, TAU)
    c.stroke()
    this.ringDots(c, view, rs, color, 72, true, 0.8)
    for (const [sign, word] of [[1, "NEW"], [-1, "OLD"]]) {
      project(view, 0, 0, sign * (rs + u(4)), spot)
      project(view, 0, 0, sign * (rs + u(26)), tip)
      this.line(c, spot[0], spot[1], tip[0], tip[1], rgba(INK.soft, 0.55), 1)
      this.label(c, word, tip[0] + u(7), tip[1] + (sign > 0 ? u(2) : u(7)), INK.faint, "left", 9.5)
      if (sign > 0) this.hit("lean", session.id, { x: tip[0] - u(10), y: tip[1] - u(10), w: u(50), h: u(34) })
    }
    // the lanes: one for each kind of equipment this turn has used, brighter while a call is on it
    const laneRadius = rs + u(26)
    for (const [port, lane] of lanesUsed) {
      const orbit = LANES.get(port)
      if (!orbit) continue
      const world = [0, 0, 0]
      c.strokeStyle = rgba(PORT_COLOR[port], (lane.running ? 0.6 : 0.16 + Math.min(0.14, lane.count * 0.01)) * fade)
      c.lineWidth = lane.running ? 1.5 : 1
      c.beginPath()
      for (let index = 0; index <= 72; index += 1) {
        lanePoint(orbit, laneRadius, (index / 72) * TAU, world)
        project(view, world[0], world[1], world[2], spot)
        if (index) c.lineTo(spot[0], spot[1])
        else c.moveTo(spot[0], spot[1])
      }
      c.stroke()
    }
    this.ringDots(c, view, rs, color, 72, false, 0.8)
    half(false)

    // what a quarter, a half and three quarters of the clock stand for
    if (turn) {
      for (const [share, align, dx, dy] of [[0.25, "left", u(12), u(4)], [0.5, "center", 0, u(18)], [0.75, "right", -u(12), u(4)]]) {
        ringPoint(view, RA + u(44), share * TAU, 0, spot)
        this.text(c, spanOf(scale * share), spot[0] + dx, spot[1] + dy, { size: 11, color: INK.faint, align })
      }
    }

    // the ring's own caption, in the corner over it: how full, how much is left, how many calls fit
    {
      const word = !fill ? "not reported yet" : `${Math.round(fill * 100)}% full  ·  ${compactOf(limit - used)} left${pace?.perCall ? `  ·  ~${pace.calls} call${pace.calls === 1 ? "" : "s"} to full` : ""}`
      const style = { size: 12.5, color: fill >= 0.8 ? fillColor : INK.dim, align: "right" }
      const labelStyle = { size: 11.5, family: FAMILY.label, weight: "600", color: INK.dim, spacing: 2.6, align: "right" }
      const x = core.right - u(14)
      const y = core.top + u(20)
      const w = this.width(c, word, style)
      this.text(c, word, x, y, style)
      this.text(c, "CONTEXT RING", x - w - u(12), y, labelStyle)
      const full = w + u(12) + this.width(c, "CONTEXT RING", labelStyle)
      this.hit("context", session.id, { x: x - full - u(4), y: y - u(15), w: full + u(8), h: u(21) })
    }
    this.hit("flock", session.id, { x: cx - rs, y: cy - rs, w: rs * 2, h: rs * 2 })
    this.coreMeta = { degrees, rs, laneRadius, fill, guess }
  },

  signPlinth(scene, ui, now) {
    const focus = scene.focused
    if (!focus) return "none"
    const session = focus.session
    const expect = session.expect
    return [session.id, session.state, session.phase.key, session.phase.tools.length, session.phase.tools[0]?.name ?? "", Math.floor(now / (session.turn ? 1000 : 60e3)), expect ? Math.round(expect.p50 / 1000) : 0].join("|")
  },

  // Under the body, flat and sharp: what the thread is doing and for how long.
  drawPlinth(c, scene, ui, now) {
    const u = (value) => this.u(value)
    const focus = scene.focused
    if (!focus) return
    const session = focus.session
    const core = this.G.core
    const P = this.G.plinth
    const waiting = session.state === "waiting"
    const phase = session.phase
    const tone = { thinking: INK.live, writing: INK.live, calling: INK.live, tool: phase.tools[0] ? PORT_COLOR[portOf(phase.tools[0].name)] : INK.live, waiting: INK.warn, failed: INK.bad }[phase.key] ?? INK.dim
    let word = STATE_WORD[phase.key] ?? phase.key.toUpperCase()
    if (phase.key === "tool") word = `RUNNING ${phase.tools.length > 1 ? `${phase.tools.length} TOOLS` : clean(bare(phase.tools[0].name)).toUpperCase().slice(0, 14)}`
    const big = session.turn ? timerOf(now - session.turn.start) : agoOf(now - (session.idleSince || session.updated))
    const bigStyle = { size: 66, family: FAMILY.display, color: session.turn ? INK.text : INK.soft, align: "center" }
    const y = P.y + u(74)
    const half = this.width(c, big, bigStyle) / 2
    this.text(c, big, core.cx, y, bigStyle)
    this.label(c, word, core.cx - half - u(24), y - u(26), tone, "right", 13)
    this.text(c, session.turn ? "this turn" : waiting ? "since it asked" : "since it last worked", core.cx - half - u(24), y - u(4), { size: 12.5, color: INK.dim, align: "right" })
    let usual = "no usual yet"
    const expect = session.expect
    if (expect && session.turn) {
      const elapsed = now - session.turn.start
      usual = elapsed > expect.p75 ? `×${(elapsed / expect.p50).toFixed(1)} the usual` : `usually ${spanOf(expect.p50)}`
    } else if (expect) usual = `usually ${spanOf(expect.p50)}`
    this.text(c, usual, core.cx + half + u(24), y - u(26), { size: 13.5, family: FAMILY.monoMedium, color: expect && session.turn && now - session.turn.start > expect.p75 ? INK.warn : INK.soft })
    if (expect) this.text(c, `3 in 4 end by ${spanOf(expect.p75)}`, core.cx + half + u(24), y - u(4), { size: 12.5, color: INK.dim })
    this.hit("clock", session.id, { x: core.cx - half - u(10), y: y - u(56), w: half * 2 + u(20), h: u(64) })
  },

  // Where the cache axis runs: clear of the focused thread's wire, which climbs to the tip.
  cacheSpan() {
    const G = this.G
    const box = G.cacheBox
    return { x0: (G.wide || !G.busX ? G.core.left : G.busX) + this.u(34), x1: box.x + box.w - this.u(20) }
  },

  signCache(scene, ui, now) {
    const session = scene.focused?.session
    if (!session) return "none"
    const cache = session.cache
    const state = cacheState(cache, now)
    if (!state) return `${session.id}|n/a|${cache?.empty ?? ""}`
    const { x0, x1 } = this.cacheSpan()
    // the head is painted again when it has moved a pixel
    return [session.id, cacheSign(cache, now), Math.floor(cache.at / 1000), state.cold ? 0 : Math.round((x1 - x0) * (1 - state.share)), Math.round((cache.tokens ?? 0) / 1000), cache.how, x0].join("|")
  },

  // The focused thread's prompt cache as a time axis: its last model call at the left end, the
  // moment it goes cold at the right, and now moving between them. The stretch still ahead is
  // drawn in the cache's warmth; it is dashed, and the reading says so, when the lifetime is
  // assumed and not measured.
  drawCache(c, scene, ui, now) {
    const u = (value) => this.u(value)
    const session = scene.focused?.session
    const box = this.G.cacheBox
    if (!session || !box) return
    const { x0, x1 } = this.cacheSpan()
    const cache = session.cache
    const state = cacheState(cache, now)
    const y = box.y + u(20)
    const labelStyle = { size: 11.5, family: FAMILY.label, weight: "600", color: INK.dim, spacing: 2.6 }
    this.text(c, "PROMPT CACHE", x0, y, labelStyle)
    this.hit("cache", session.id, { x: x0 - u(6), y: box.y + u(4), w: x1 - x0 + u(12), h: box.h - u(6) })
    if (!state) {
      this.text(c, cache?.empty ? "nothing cached: this thread has made no model call yet" : "n/a: only a thread on a Claude model has one this program can read", x0 + this.width(c, "PROMPT CACHE", labelStyle) + u(14), y, { size: 12.5, color: INK.faint })
      return
    }
    this.chip(c, cache.measured ? "MEASURED" : "ASSUMED", x0 + this.width(c, "PROMPT CACHE", labelStyle) + u(14), y, { color: cache.measured ? INK.dim : INK.soft })
    const approx = cache.measured ? "" : "~"
    const reading = state.cold ? `cold since ${hourMinuteOf(state.coldAt)}` : `${approx}${leftWord(state.left)} left of ${cache.measured ? "" : "an assumed "}${lifeWord(cache.lifetime)}`
    this.text(c, reading, x1, y, { size: 14.5, family: FAMILY.monoMedium, color: state.cold ? INK.dim : state.color, align: "right" })
    // the axis: a tick every ten minutes of an hour, every minute of five
    const ay = box.y + u(37)
    const parts = cache.lifetime >= 3600e3 ? 6 : 5
    this.line(c, x0, ay, x1, ay, INK.faint, 1)
    for (let index = 0; index <= parts; index += 1) {
      const x = Math.round(x0 + ((x1 - x0) * index) / parts)
      const reach = index === 0 || index === parts ? u(6) : u(3)
      this.line(c, x, ay - reach, x, ay + reach, INK.faint, 1)
    }
    const head = x0 + (x1 - x0) * (1 - state.share)
    if (!state.cold) {
      c.strokeStyle = state.color
      c.lineWidth = u(4)
      c.lineCap = "butt"
      if (!cache.measured) c.setLineDash([u(7), u(5)])
      c.beginPath()
      c.moveTo(head, ay)
      c.lineTo(x1, ay)
      c.stroke()
      c.setLineDash([])
      this.dot(c, head, ay, u(5), state.color)
      this.dot(c, head, ay, u(2), INK.text)
    } else {
      // cold: the head stands at the end, hollow
      c.strokeStyle = INK.dim
      c.lineWidth = 1.5
      c.beginPath()
      c.arc(x1, ay, u(4.5), 0, TAU)
      c.stroke()
    }
    this.cacheHead = { x: state.cold ? x1 : head, y: ay }
    const sy = box.y + u(57)
    const small = { size: 11.5, color: INK.faint }
    this.text(c, `last call ${clockOf(cache.at)}`, x0, sy, small)
    this.text(c, `${state.cold ? "went cold" : "cold at"} ${clockOf(state.coldAt)}`, x1, sy, { ...small, align: "right" })
    if (cache.tokens > 0) {
      const holds = `${cache.measured ? "" : "about "}${compactOf(cache.tokens)} tok ${state.cold ? "to write again on the next call" : "kept warm"}`
      this.text(c, holds, (x0 + x1) / 2, sy, { size: 11.5, color: state.cold ? INK.faint : INK.dim, align: "center" })
    }
  },

  signUnder(scene, ui, now) {
    const focus = scene.focused
    if (!focus) return "none"
    const session = focus.session
    const turn = this.turnWindow(session, now)
    let tools = 0
    let failed = 0
    let ms = 0
    for (const step of session.steps) {
      for (const tool of step.tools) {
        tools += 1
        if (tool.status === "error") failed += 1
        ms += Math.floor(((tool.end ?? now) - tool.start) / 1000)
      }
    }
    return [session.id, session.steps.length, tools, failed, ms, turn ? Math.floor((now - turn.start) / 60e3) : 0, turn?.live].join("|")
  },

  // Under the turn's time, when the stage has the room: what this turn was made of.
  drawUnder(c, scene, ui, now) {
    const G = this.G
    const u = (value) => this.u(value)
    const focus = scene.focused
    const box = G.under
    if (!focus || !box) return
    const session = focus.session
    const turn = this.turnWindow(session, now)
    const listTop = box.y + u(26)
    const lineH = u(25)
    const room = box.h - u(34)
    if (!turn || room < lineH * 2) return
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
    const x1 = box.x + box.w - u(20)
    const fade = turn.live ? 1 : 0.6
    this.label(c, turn.live ? "THIS TURN" : "LAST TURN", x0, listTop, INK.dim, "left", 11.5)
    this.text(c, turn.live ? `began ${agoOf(now - turn.start)} ago` : `ran ${spanOf(turn.end - turn.start)}`, x1, listTop, { size: 11.5, color: INK.faint, align: "right" })
    const lines = [{ tone: INK.text, round: true, name: "MODEL CALLS", value: String(calls), note: "a bar under the ring each" }]
    for (const [id, entry] of tally) lines.push({ tone: PORT_COLOR[id], name: scene.ports.get(id).label, value: `${entry.count}`, note: `${spanOf(entry.ms)}${entry.failed ? `  ·  ${entry.failed} failed` : ""}`, bad: entry.failed > 0 })
    // two columns when there are many kinds, so the list never runs off the stage
    const perColumn = Math.max(1, Math.floor(room / lineH))
    const columns = lines.length > perColumn ? 2 : 1
    const columnW = (x1 - x0) / columns
    lines.slice(0, perColumn * columns).forEach((line, index) => {
      const x = x0 + Math.floor(index / perColumn) * columnW
      const y = listTop + ((index % perColumn) + 1) * lineH + u(4)
      if (line.round) this.dot(c, x + u(3), y - u(5), u(2.6), rgba(line.tone, fade))
      else {
        c.fillStyle = rgba(line.tone, fade)
        c.fillRect(x + u(2), y - u(12), u(2), u(13))
      }
      this.text(c, line.name, x + u(18), y, { size: 12.5, family: FAMILY.label, weight: "600", color: rgba(INK.soft, fade), spacing: 2.2 })
      this.text(c, line.value, x + u(150), y, { size: 14, family: FAMILY.monoMedium, color: rgba(INK.text, fade), align: "right" })
      if (line.note) this.text(c, this.fit(c, line.note, columnW - u(180), { size: 13 }), x + u(168), y, { size: 13, color: line.bad ? INK.bad : rgba(INK.dim, fade) })
    })
  },

  signHead(scene, ui, now) {
    const focus = scene.focused
    if (!focus) return "none"
    const session = focus.session
    const parts = [session.id, scene.focus.auto, focus.index, session.state, session.title, session.cost.toFixed(2), session.context.used, session.turn?.out ?? session.lastOut, Math.round(scene.rateOf(session.id, now)), session.alerts.map((alert) => `${alert.kind}${alert.muted}`).join(","), session.prompt?.length ?? 0, session.model, session.effort, session.pane]
    return parts.join("|")
  },

  // Who this is, where it sits in the hierarchy and in herdr, and the numbers behind the core.
  drawHead(c, scene, ui, now) {
    const G = this.G
    const u = (value) => this.u(value)
    const focus = scene.focused
    if (!focus) return
    const session = focus.session
    const waiting = session.state === "waiting"
    const turn = this.turnWindow(session, now)
    const limit = session.context.limit
    const used = session.context.used
    const fill = limit && used ? used / limit : 0
    const out = session.turn?.out ?? session.lastOut ?? 0
    const unit = flockUnit(out)
    // head: who this is, and where it sits in the hierarchy and in herdr
    const head = G.head
    let y = head.y + u(18)
    let x = this.run(c, head.x, y, [[`FOCUS ${String(focus.index + 1).padStart(2, "0")}`, { size: 12.5, family: FAMILY.label, weight: "600", color: INK.live, spacing: 2.6 }]]) + u(16)
    const follow = this.chip(c, scene.focus.auto ? "FOLLOWING THE ACTION" : "LOCKED", x, y, { color: scene.focus.auto ? INK.dim : INK.live })
    this.hit("action", scene.focus.auto ? "lock" : "follow", { x, y: y - u(16), w: follow, h: u(22) }, { tip: scene.focus.auto ? "click to hold this thread" : "click to follow the action again" })
    x += follow + u(8)
    for (const alert of session.alerts.filter((entry) => !entry.muted).slice(0, 3)) {
      x += this.chip(c, alert.kind === "call" ? "CALL" : alert.text.toUpperCase(), x, y, { color: alert.level === "alert" ? (alert.kind === "call" ? INK.warn : INK.bad) : alert.level === "caution" ? INK.warn : INK.soft, solid: alert.level === "alert" }) + u(8)
    }
    y += u(54)
    const titleStyle = { size: 44, family: FAMILY.label, weight: "600", color: INK.text }
    this.text(c, this.fit(c, session.title, head.w, titleStyle), head.x, y, titleStyle)
    y += u(30)
    // account › project › parent › this agent, and on the right the herdr place
    const crumbs = [session.account || "no account", homed(session.project) || "no project"]
    if (focus.parent) crumbs.push(clean(focus.parent.session.title).slice(0, 34))
    crumbs.push(session.agent || "main")
    const where = scene.whereOf(session.pane || (scene.byId.get(session.rootId)?.pane ?? ""))
    const whereW = where ? this.width(c, where, { size: 13.5 }) + u(20) : 0
    const crumbStyle = { size: 13.5, color: INK.dim }
    this.text(c, this.fit(c, crumbs.join("  ›  "), head.w - whereW, crumbStyle), head.x, y, crumbStyle)
    const pane = session.pane || scene.byId.get(session.rootId)?.pane
    if (where) {
      this.text(c, where, head.x + head.w, y, { size: 13.5, color: INK.soft, align: "right" })
      this.hit("pane", pane, { x: head.x + head.w - whereW + u(20), y: y - u(16), w: whereW - u(20), h: u(22) }, { tip: "click to go to this pane in herdr" })
    }
    y += u(28)
    const small = { size: 15, color: INK.dim }
    const meta = [[shortModel(session.model), { size: 15, family: FAMILY.monoMedium, color: modelColor(session.model, session.provider) }]]
    for (const part of [session.effort, session.kids ? `${session.kids} subagent${session.kids === 1 ? "" : "s"}` : "", focus.depth ? `depth ${focus.depth}` : "", session.id.slice(0, 16)]) if (part) meta.push([`  ·  ${part}`, small])
    this.run(c, head.x, y, meta)
    y += u(28)
    if (session.prompt) {
      const style = { size: 14.5, color: INK.soft }
      const asked = this.width(c, "asked  ", { size: 14.5 })
      this.text(c, "asked", head.x, y, { size: 14.5, color: INK.faint })
      this.text(c, this.fit(c, session.prompt, head.w - asked, style), head.x + asked, y, style)
    }
    // the numbers behind the instrument, with their units
    y += u(42)
    const rate = scene.rateOf(session.id, now)
    const cells = [
      [turn?.live ? "OUT THIS TURN" : "OUT LAST TURN", out ? `${compactOf(out)} tok` : "n/a"],
      ["RATE", rate ? `${rate >= 10 ? Math.round(rate) : rate.toFixed(1)} tok/s` : "n/a"],
      ["CONTEXT", limit && used ? `${Math.round(fill * 100)}% of ${compactOf(limit)}` : used ? compactOf(used) : "n/a"],
      ["SPENT", session.cost ? moneyOf(session.cost) : "n/a"],
      ["ONE DOT", `${compactOf(unit)} tok`],
    ]
    x = head.x
    for (const [name, value] of cells) {
      x = this.run(c, x, y, [
        [`${name}  `, { size: 11.5, family: FAMILY.label, weight: "600", color: INK.dim, spacing: 2.6 }],
        [value, { size: 15, family: FAMILY.monoMedium, color: value === "n/a" ? INK.faint : INK.text }],
      ])
      x += u(34)
    }
  },

  signTail(scene, ui, now) {
    const focus = scene.focused
    if (!focus) return "none"
    const session = focus.session
    const parts = [session.id, session.state, session.phase.key, ui.tailScroll]
    for (const item of session.tail ?? []) {
      if (item.kind === "tool") parts.push(item.tool.id, item.tool.status, item.tool.end === null ? Math.floor((now - item.tool.start) / 1000) : "")
      else parts.push(item.key, this.shownOf(item))
    }
    return parts.join("|")
  },

  // The live tail: what the thread just thought, said and ran, read downwards, newest last.
  drawTail(c, scene, ui, now) {
    const focus = scene.focused
    if (!focus) return
    const session = focus.session
    const color = session.state === "waiting" ? INK.warn : modelColor(session.model, session.provider)
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
    this.hit("tail", "tail", { x: box.x, y: box.y - u(10), w: box.w, h: box.h + u(10) })
    const lines = []
    const items = session.tail ?? []
    items.forEach((item, index) => {
      const newest = index === items.length - 1
      if (item.kind === "tool") {
        const tool = item.tool
        const running = tool.end === null && session.state === "working"
        const right = running ? spanOf(Math.max(1000, Math.floor((now - tool.start) / 1000) * 1000)) : tool.status === "error" ? "failed" : tool.end !== null ? spanOf(tool.end - tool.start) : ""
        lines.push({ tool, meta: toolMeta(tool.name), right, rightColor: running ? INK.live : tool.status === "error" ? INK.bad : INK.dim, running })
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
        lines.push({ value: value.slice(0, clamp(before, 0, value.length)), kind: item.kind, cursor: front || (!typing && newest && at === keep.length - 1 && generating) })
      })
    })
    if (!lines.length) {
      this.text(c, session.state === "working" ? "waiting for the first words of this step" : "nothing said in the last quarter hour", box.x + gutter, box.y + lineH, { size, color: INK.faint })
      return
    }
    // once the box is full the oldest lines leave at the top; the wheel brings them back
    const back = clamp(ui.tailScroll ?? 0, 0, Math.max(0, lines.length - maxLines))
    ui.tailScroll = back
    const view = lines.slice(Math.max(0, lines.length - maxLines - back), lines.length - back)
    const top = box.y + lineH - u(6)
    if (lines.length > maxLines) this.text(c, back ? `${back} newer line${back === 1 ? "" : "s"} below  ·  wheel` : `${lines.length - maxLines} earlier  ·  wheel`, box.x + box.w, box.y - u(20), { size: 11.5, color: back ? INK.live : INK.faint, align: "right" })
    view.forEach((line, index) => {
      const y = top + index * lineH
      if (line.tool) {
        const name = bare(line.tool.name)
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
        this.hit("tool", line.tool.id, { x: box.x, y: y - u(20), w: box.w, h: lineH }, { sid: session.id, tool: line.tool })
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
  },
}
