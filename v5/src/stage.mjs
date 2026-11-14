// The focus stage: one thread shown large. Left, the instrument (a clock of the turn with every
// model call and tool call on it, the context ring, the output bloom). Right, who it is, where it
// lives, its numbers and the live tail of what it thinks, says and runs.

import { portOf } from "./model.mjs"
import { FLOCK_CAP, flockUnit } from "./flock.mjs"
import { PORT_COLOR, STATE_WORD, bare, clean, homed, wrap } from "./theme.mjs"
import { FAMILY, INK, TAU, agoOf, clamp, compactOf, modelColor, moneyOf, rgba, shortModel, spanOf, timerOf, toolMeta } from "./util.mjs"

const easeOut = (t) => 1 - (1 - t) ** 3

export const stage = {
  // A circle of the leaning disc as a ring of points: larger and brighter where it is nearer.
  hoop(c, cx, cy, radius, lean, color, count) {
    const focal = 620 * this.S
    const ct = Math.cos(lean)
    const st = Math.sin(lean)
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * TAU
      const y = Math.sin(angle) * radius
      const scale = focal / (focal - y * st)
      const near = (Math.sin(angle) + 1) / 2
      this.dot(c, cx + Math.cos(angle) * radius * scale, cy + y * ct * scale, this.S * (0.7 + near * 0.9), rgba(color, 0.22 + near * 0.6))
    }
  },

  signStage(scene, ui, now) {
    const focus = scene.focused
    if (!focus) return "none"
    const session = focus.session
    // a working thread's clock moves every second, a resting one every minute
    const parts = [session.id, scene.focus.auto, focus.index, session.state, session.phase.key, session.title, session.cost.toFixed(2), session.context.used, Math.floor(now / (session.turn ? 1000 : 60e3)), ui.tailScroll]
    parts.push(session.turn?.out ?? session.lastOut, session.steps.length, Math.round(scene.rateOf(session.id, now)), session.alerts.length)
    const intro = (now - scene.focus.since) / 450
    if (intro < 1) parts.push(Math.floor(intro * 14))
    for (const item of session.tail ?? []) {
      if (item.kind === "tool") parts.push(item.tool.id, item.tool.status, item.tool.end === null && now - item.tool.start < 10e3 ? Math.floor(now / 100) : "")
      else parts.push(item.key, this.shownOf(item))
    }
    const flock = this.flock
    if (flock.sid === session.id) parts.push(flock.state, flock.count, Math.round((flock.tilt * 180) / Math.PI))
    parts.push(this.signTerrain(scene, ui, now))
    return parts.join("|")
  },

  drawStage(c, scene, ui, now) {
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
    const { cx, cy, RA, RB, frame } = core
    const intro = easeOut(clamp((now - scene.focus.since) / 450, 0, 1)) // the instrument sweeps in when the focus moves

    // the frame: a dotted circle and the four corners of its square
    this.brackets(c, { x: cx - frame - u(16), y: cy - frame - u(16), w: (frame + u(16)) * 2, h: (frame + u(16)) * 2 }, INK.faint, 14)
    for (let tick = 0; tick < 120; tick += 1) {
      const angle = (tick / 120) * TAU - Math.PI / 2
      const long = tick % 10 === 0
      this.dot(c, cx + Math.cos(angle) * frame, cy + Math.sin(angle) * frame, long ? u(1.7) : u(1), long ? INK.faint : INK.ghost)
    }
    this.hit("clock", session.id, { x: cx - frame, y: cy - frame, w: frame * 2, h: frame * 2 })

    // The turn clock. One turn of the ring is the time such a turn may take; the arc is how far
    // this one has come. A bar inside the ring is a model call (longer when it wrote more), a
    // spoke outside it is a tool call (longer when it took longer, on a log scale). A resting
    // thread shows its last turn, dimmed.
    c.strokeStyle = INK.ghost
    c.lineWidth = 1
    c.beginPath()
    c.arc(cx + 0.5, cy + 0.5, RA, 0, TAU)
    c.stroke()
    let usual = ""
    const clock = { sid: session.id, steps: [], tools: [] }
    const turn = this.turnWindow(session, now)
    if (turn) {
      const elapsed = turn.end - turn.start
      const scale = this.turnScale(session, elapsed)
      const fade = turn.live ? 1 : 0.42
      // what a quarter, a half and three quarters of the ring stand for
      for (const [share, ax, ay, align] of [[0.25, 1, 0, "left"], [0.5, 0, 1, "center"], [0.75, -1, 0, "right"]]) {
        this.text(c, spanOf(scale * share), cx + ax * (frame + u(12)), cy + ay * (frame + u(24)) + u(4), { size: 11, color: INK.faint, align })
      }
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
      this.arc(c, cx, cy, RA, 0, Math.min(0.999, elapsed / scale) * intro * TAU, rgba(color, fade), u(4))
      const longest = Math.log10(600e3)
      const most = Math.log10(20001)
      for (const step of session.steps) {
        if (step.start < turn.start - 500 || step.start > turn.end) continue
        const share = clamp((step.start - turn.start) / scale, 0, 0.999) * intro
        const angle = share * TAU - Math.PI / 2
        const wrote = step.out || step.chars / 3.6
        const depth = u(5) + (Math.log10(1 + wrote) / most) * u(21)
        c.strokeStyle = rgba(step.end === null && turn.live ? INK.text : color, (step.end === null ? 1 : 0.85) * fade)
        c.lineWidth = 2
        c.beginPath()
        c.moveTo(cx + Math.cos(angle) * (RA - u(4)), cy + Math.sin(angle) * (RA - u(4)))
        c.lineTo(cx + Math.cos(angle) * (RA - u(4) - depth), cy + Math.sin(angle) * (RA - u(4) - depth))
        c.stroke()
        clock.steps.push({ angle: share * TAU, step })
        for (const tool of step.tools) {
          const at = clamp((tool.start - turn.start) / scale, 0, 0.999) * intro
          const span = Math.max(1, (tool.end ?? now) - tool.start)
          const reach = u(5) + (Math.min(longest, Math.log10(span)) / longest) * u(30)
          const running = tool.end === null && turn.live
          const spoke = at * TAU - Math.PI / 2
          c.strokeStyle = tool.status === "error" ? rgba(INK.bad, fade) : rgba(PORT_COLOR[portOf(tool.name)], (running ? 1 : 0.8) * fade)
          c.lineWidth = running ? 3 : 2
          c.beginPath()
          c.moveTo(cx + Math.cos(spoke) * (RA + u(7)), cy + Math.sin(spoke) * (RA + u(7)))
          c.lineTo(cx + Math.cos(spoke) * (RA + u(7) + reach), cy + Math.sin(spoke) * (RA + u(7) + reach))
          c.stroke()
          clock.tools.push({ angle: at * TAU, tool, step })
        }
      }
    }
    this.clock = clock

    // the context window
    c.strokeStyle = INK.ghost
    c.lineWidth = 1
    c.beginPath()
    c.arc(cx + 0.5, cy + 0.5, RB, 0, TAU)
    c.stroke()
    const limit = session.context.limit
    const used = session.context.used
    const fill = limit && used ? used / limit : 0
    if (fill) this.arc(c, cx, cy, RB, 0, clamp(fill, 0.004, 1) * intro * TAU, fill >= 0.92 ? INK.bad : fill >= 0.8 ? INK.warn : rgba(INK.soft, 0.75), u(6))

    // The flock's lanes on the leaning disc: the rim it packs against, and the context wall that
    // moves outward as the window fills. The dots themselves fly in the moving layer (flock.mjs).
    const out = session.turn?.out ?? session.lastOut ?? 0
    const unit = flockUnit(out)
    const flock = this.flock
    const mine = flock.sid === session.id
    // drawn in whole degrees, so the lanes move only when the lean really changed
    const lean = ((mine ? Math.round((flock.tilt * 180) / Math.PI) : 20) * Math.PI) / 180
    const wall = core.r0 + (core.r1 - core.r0) * 0.72 * fill
    this.hoop(c, cx, cy, core.r1 + u(5), lean, INK.dim, 96)
    this.hoop(c, cx, cy, wall - u(2), lean, fill >= 0.92 ? INK.bad : fill >= 0.8 ? INK.warn : INK.soft, 64)
    const dots = Math.min(FLOCK_CAP, Math.floor(out / unit))
    const flockLine = out ? `${dots} dot${dots === 1 ? "" : "s"} × ${compactOf(unit)} tok  ·  ${mine ? flock.state : "forming"}` : "no output reported for this turn"
    const flockX = cx - frame - u(16)
    const flockY = cy - frame - u(26)
    const flockW = this.run(c, flockX, flockY, [["FLOCK  ", { size: 11.5, family: FAMILY.label, weight: "600", color: INK.dim, spacing: 2.6 }], [flockLine, { size: 12.5, color: working ? INK.soft : INK.dim }]]) - flockX
    this.hit("flock", session.id, { x: flockX, y: flockY - u(14), w: flockW, h: u(20) })
    this.hit("flock", session.id, { x: cx - core.RB, y: cy - core.RB, w: core.RB * 2, h: core.RB * 2 })
    this.hit("lean", session.id, { x: cx - core.r1 - u(9), y: cy + (core.r1 + u(5)) * Math.cos(lean) - u(9), w: (core.r1 + u(9)) * 2, h: u(18) })

    // centre: what it is doing and for how long
    const phase = session.phase
    const tone = { thinking: INK.live, writing: INK.live, calling: INK.live, tool: phase.tools[0] ? PORT_COLOR[portOf(phase.tools[0].name)] : INK.live, waiting: INK.warn, failed: INK.bad }[phase.key] ?? INK.dim
    let word = STATE_WORD[phase.key] ?? phase.key.toUpperCase()
    if (phase.key === "tool") word = `RUNNING ${phase.tools.length > 1 ? `${phase.tools.length} TOOLS` : clean(bare(phase.tools[0].name)).toUpperCase().slice(0, 14)}`
    this.label(c, word, cx, cy - u(36), tone, "center", 13)
    const big = session.turn ? timerOf(now - session.turn.start) : agoOf(now - (session.idleSince || session.updated))
    this.text(c, big, cx, cy + u(24), { size: 72, family: FAMILY.display, color: session.turn ? INK.text : INK.soft, align: "center" })
    this.text(c, session.turn ? usual || "no usual yet" : waiting ? "since it asked" : "since it last worked", cx, cy + u(50), { size: 12.5, color: INK.dim, align: "center" })

    // under the instrument, when the stage has the room: what this turn was made of
    const listTop = cy + frame + u(58)
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
      const x1 = G.head.x - u(40)
      const fade = turn.live ? 1 : 0.6
      this.label(c, turn.live ? "THIS TURN" : "LAST TURN", x0, listTop, INK.dim, "left", 11.5)
      this.text(c, turn.live ? `began ${agoOf(now - turn.start)} ago` : `ran ${spanOf(turn.end - turn.start)}`, x1, listTop, { size: 11.5, color: INK.faint, align: "right" })
      const lines = [{ tone: INK.text, round: true, name: "MODEL CALLS", value: String(calls) }]
      for (const [id, entry] of tally) lines.push({ tone: PORT_COLOR[id], name: scene.ports.get(id).label, value: `${entry.count}`, note: `${spanOf(entry.ms)}${entry.failed ? `  ·  ${entry.failed} failed` : ""}`, bad: entry.failed > 0 })
      lines.slice(0, Math.floor(room / lineH) - 1).forEach((line, index) => {
        const y = listTop + (index + 1) * lineH + u(4)
        if (line.round) this.dot(c, x0 + u(3), y - u(5), u(2.6), rgba(line.tone, fade))
        else {
          c.fillStyle = rgba(line.tone, fade)
          c.fillRect(x0 + u(2), y - u(12), u(2), u(13))
        }
        this.text(c, line.name, x0 + u(18), y, { size: 12.5, family: FAMILY.label, weight: "600", color: rgba(INK.soft, fade), spacing: 2.2 })
        this.text(c, line.value, x0 + u(150), y, { size: 14, family: FAMILY.monoMedium, color: rgba(INK.text, fade), align: "right" })
        if (line.note) this.text(c, this.fit(c, line.note, x1 - x0 - u(168), { size: 13 }), x0 + u(168), y, { size: 13, color: line.bad ? INK.bad : rgba(INK.dim, fade) })
      })
    }

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
    this.drawTerrain(c, scene, ui, now)
    this.drawTail(c, session, color, ui, now)
  },

  // The live tail: what the thread just thought, said and ran, read downwards, newest last.
  drawTail(c, session, color, ui, now) {
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
        const right = running ? spanOf(now - tool.start) : tool.status === "error" ? "failed" : tool.end !== null ? spanOf(tool.end - tool.start) : ""
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
