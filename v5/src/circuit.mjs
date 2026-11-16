// The circuit: account rails on the left, projects and their threads in the middle (every thread
// a neuron: cell body, axon, synapses), and on the right the equipment a model acts with.

import { cacheSign, cacheState, cacheWord } from "./cache.mjs"
import { FILTER_NAME } from "./model.mjs"
import { PANEL, PORT_COLOR, bare, clean, homed } from "./theme.mjs"
import { FAMILY, INK, TAU, agoOf, clamp, clockOf, hourMinuteOf, mix, modelColor, moneyOf, rgba, shortModel, spanOf, timerOf, toolMeta } from "./util.mjs"

export const circuit = {
  // ---------------------------------------------------------------- wires

  signWires(scene, now) {
    const parts = [scene.focus.id]
    for (const g of this.G.rows) {
      if (!g.row) continue
      const session = g.row.session
      parts.push(session.state, g.row.parent ? 1 : 0)
      for (const [id, port] of scene.ports) {
        const used = port.used?.get(session.id)
        if (!used) continue
        const age = now - used
        parts.push(`${id}${age < 60e3 ? 3 : age < 240e3 ? 2 : 1}`)
      }
    }
    for (const stream of scene.streams) parts.push(stream.key)
    return parts.join("|")
  },

  drawWires(scene, now) {
    const c = this.wires
    const G = this.G
    const u = (value) => this.u(value)
    c.clearRect(0, 0, this.W, this.H)
    const lit = new Map()
    for (const stream of scene.streams) lit.set(stream.type === "kid" ? `kid:${stream.sid}` : `${stream.sid}:${stream.port}`, stream)
    // the wires answer to the pointer too: a row of small targets along each one
    const targets = []
    const along = (points, id, card, every = 1) => {
      const reach = u(5)
      for (let index = 0; index < points.length; index += every) targets.push({ kind: "note", id, rect: { x: points[index][0] - reach, y: points[index][1] - reach, w: reach * 2, h: reach * 2 }, card })
    }
    for (const g of G.rows) {
      if (!g.row) continue
      const session = g.row.session
      const color = modelColor(session.model, session.provider)
      const working = session.state === "working"
      const waiting = session.state === "waiting"
      const tone = working ? rgba(color, 0.5) : waiting ? rgba(INK.warn, 0.45) : INK.ghost
      // tap from the account rail
      const rail = G.rails.find((candidate) => candidate.name === session.account)
      if (rail) {
        this.line(c, rail.x, g.axonY, g.somaX - g.r - 1, g.axonY, working ? rgba(color, 0.34) : INK.ghost)
        this.dot(c, rail.x + 0.5, g.axonY + 0.5, u(2.5), working ? color : INK.faint)
      }
      // axon and its terminal
      this.line(c, g.somaX + g.r + 1, g.axonY, G.termX, g.axonY, tone)
      this.dot(c, G.termX + 0.5, g.axonY + 0.5, working || waiting ? u(3) : u(2), working ? color : waiting ? INK.warn : INK.faint)
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
        const port = scene.ports.get(id)
        const used = port.used?.get(session.id)
        along(path.points, `syn:${g.sid}:${id}`, {
          kicker: "SYNAPSE",
          title: `${clean(session.title).slice(0, 40)}  ›  ${port.label}`,
          tone: stream?.type === "wait" ? INK.warn : PORT_COLOR[id],
          lines: [
            ["WHAT", stream?.type === "wait" ? "this thread waits on you: the wire to YOU stays lit until it is answered" : "the wire from this thread to a kind of equipment it acted on"],
            ["CARRIES", "a tool call leaves along it as a packet with the equipment's sign, and the result comes back the same way, red when it failed"],
            ["NOW", stream ? (stream.type === "wait" ? "waiting on an answer" : "a call is out: motes run along it") : "nothing out"],
            ["LAST USED", used ? clockOf(used) : "not in this program's memory"],
            ["SHOWN", "for the three kinds of equipment a working thread used last, two for a resting one within 90 s; brighter the more recent"],
          ],
        })
      }
      // the link to the parent
      if (g.row.parent) {
        const path = this.flow.paths.get(`kid:${g.sid}`)
        if (path) this.poly(c, path.points, lit.has(`kid:${g.sid}`) ? rgba(PORT_COLOR.agent, 0.6) : INK.faint, lit.has(`kid:${g.sid}`) ? 1.5 : 1)
      }
    }
    const focus = this.flow.paths.get(`focus:${scene.focus.id}`)
    if (focus) {
      this.poly(c, focus.points, rgba(INK.live, 0.5), 1)
      // a target every few pixels of its length, so the whole run answers
      const card = {
        kicker: "WIRE",
        title: "from the focused thread up to the tip",
        tone: INK.live,
        lines: [
          ["WHAT", "the focused thread's own wire: it leaves the thread's cell body in the circuit and climbs to the tip under the core"],
          ["CARRIES", "what the thread writes. While it works, motes run up it, closer together the faster it writes (one every 180, 104, 66 or 44 px for under 15, 15 to 40, 40 to 80 and over 80 tokens a second), and a burst when a model call reports"],
          ["ENDS", "at the tip, where the tokens gather as a charge until a dot is released into the rings"],
          ["BRANCH", "REACH leaves it on the way: what this turn touched"],
        ],
      }
      const step = u(12)
      for (let index = 1; index < focus.points.length; index += 1) {
        const [x0, y0] = focus.points[index - 1]
        const [x1, y1] = focus.points[index]
        const count = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step))
        const points = []
        for (let part = 0; part <= count; part += 1) points.push([x0 + ((x1 - x0) * part) / count, y0 + ((y1 - y0) * part) / count])
        along(points, `wire:${scene.focus.id}`, card)
      }
    }
    this.hits.set("wires", targets)
  },

  // ---------------------------------------------------------------- rails (accounts)

  signRails(scene, now) {
    return (scene.world?.accounts ?? []).map((account) => `${account.name}:${Math.round(account.five?.used ?? -1)}:${Math.round(account.seven?.used ?? -1)}:${account.five?.resetsAt ?? 0}:${Math.floor(now / 60e3)}`).join("|")
  },

  drawRails(c, scene, now) {
    const G = this.G
    const u = (value) => this.u(value)
    this.label(c, "ACCOUNTS", G.circuit.x + G.M, G.circuit.y + u(36))
    this.note("section:accounts", { x: G.circuit.x + G.M - u(4), y: G.circuit.y + u(20), w: this.width(c, "ACCOUNTS", { size: 12.5, family: FAMILY.label, weight: "600", spacing: 2.6 }) + u(8), h: u(22) }, "SECTION", "ACCOUNTS", [["WHAT", "one tube per account: the tube is its five hour window, the level what is left of it"], ["MARKS", "cyan triangle: where an even pace would stand. Hollow amber triangle: when it runs dry at this pace. Motes sink through it while a thread draws on it"], ["FROM", "the Claude Code plugin's usage readings, as each model call reports them"], ["WIRES", "every thread taps the rail of the account that pays for it"]])
    for (const rail of G.rails) {
      const account = scene.world.accounts.find((candidate) => candidate.name === rail.name)
      const five = account?.five
      const height = G.railBottom - G.railTop
      // the track, and what is left of the five hour window standing in it like fuel
      this.line(c, rail.x, G.railTop, rail.x, G.railBottom, INK.ghost, 1)
      for (let tick = 0; tick <= 4; tick += 1) this.line(c, rail.x - u(3), G.railBottom - Math.round((height * tick) / 4), rail.x + u(4), G.railBottom - Math.round((height * tick) / 4), INK.ghost, 1)
      const left = account?.left === null || account?.left === undefined ? null : clamp(account.left / 100, 0, 1)
      const tone = left === null ? INK.dim : left < 0.06 ? INK.bad : left < 0.16 ? INK.warn : INK.soft
      // the reservoir: a tube, and what is left of the window standing in it
      const half = u(6)
      c.strokeStyle = INK.ghost
      c.lineWidth = 1
      c.strokeRect(rail.x - half + 0.5, G.railTop + 0.5, half * 2, height)
      if (left !== null) {
        const top = G.railBottom - Math.round(height * left)
        const body = c.createLinearGradient(0, top, 0, G.railBottom)
        body.addColorStop(0, rgba(tone, 0.5))
        body.addColorStop(1, rgba(tone, 0.14))
        c.fillStyle = body
        c.fillRect(rail.x - half + 1, top, half * 2 - 1, G.railBottom - top)
        c.fillStyle = tone
        c.fillRect(rail.x - 1, top, 3, G.railBottom - top)
        this.line(c, rail.x - u(9), top, rail.x + u(10), top, tone, 2)
        // where on the window's own time axis it runs dry at this pace: a hollow amber mark
        if (account.dryAt && five.resetsAt) {
          const at = G.railBottom - Math.round(height * (1 - clamp(1 - (five.resetsAt - account.dryAt) / five.span, 0, 1)))
          c.strokeStyle = INK.warn
          c.lineWidth = 1.5
          c.beginPath()
          c.moveTo(rail.x - u(6), at)
          c.lineTo(rail.x - u(13), at - u(4))
          c.lineTo(rail.x - u(13), at + u(4))
          c.closePath()
          c.stroke()
        }
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
      this.text(c, left === null ? "n/a" : `${Math.round(left * 100)}%`, cx, G.railBottom + u(26), { size: 14.5, family: FAMILY.monoMedium, color: left === null ? INK.dim : tone === INK.soft ? INK.text : tone, align: "center" })
      this.text(c, "5h left", cx, G.railBottom + u(44), { size: 11, color: INK.dim, align: "center" })
      // two short lines, so neighbouring rails never run into each other
      if (left === 0 && five?.resetsAt) {
        this.text(c, "back", cx, G.railBottom + u(62), { size: 11, color: INK.bad, align: "center" })
        this.text(c, hourMinuteOf(five.resetsAt), cx, G.railBottom + u(78), { size: 11, color: INK.bad, align: "center" })
      } else if (account?.dryAt) {
        this.text(c, "dry", cx, G.railBottom + u(62), { size: 11, color: INK.warn, align: "center" })
        this.text(c, hourMinuteOf(account.dryAt), cx, G.railBottom + u(78), { size: 11, color: INK.warn, align: "center" })
      } else if (account?.seven && account.seven.used !== null) this.text(c, `7d ${Math.round(100 - account.seven.used)}%`, cx, G.railBottom + u(62), { size: 11, color: INK.faint, align: "center" })
    }
  },

  drawCircuitHead(c, scene) {
    const G = this.G
    const u = (value) => this.u(value)
    const y = G.circuit.y + u(36)
    let x = this.run(c, G.busX + u(12), y, [
      ["CIRCUIT", { size: 12.5, family: FAMILY.label, weight: "600", color: INK.dim, spacing: 2.6 }],
      [`   ${scene.threads.length} thread${scene.threads.length === 1 ? "" : "s"}  ·  ${scene.projects.length} project${scene.projects.length === 1 ? "" : "s"}`, { size: 13, color: INK.soft }],
    ]) + u(18)
    this.note("section:circuit", { x: G.busX + u(8), y: y - u(16), w: x - u(18) - (G.busX + u(8)), h: u(22) }, "SECTION", "CIRCUIT", [["WHAT", "every listed thread as a cell on a wire, under its project: the cell body is the thread, the line to its right its last minutes, the curves at the far end what it acted on"], ["LISTED", `${scene.threads.length} thread${scene.threads.length === 1 ? "" : "s"} in ${scene.projects.length} project${scene.projects.length === 1 ? "" : "s"}, showing ${FILTER_NAME[scene.filter].toLowerCase()}`], ["NESTED", "a subagent hangs under the thread that dispatched it"], ["KEYS", "up and down move the focus, f changes which threads are listed, left and right fold a project"]])
    const w = this.chip(c, `SHOWING ${FILTER_NAME[scene.filter]}`, x, y, { color: scene.filter === "active" ? INK.dim : INK.live })
    this.hit("action", "filter", { x, y: y - u(16), w, h: u(22) }, { tip: "click to change which threads are listed" })
    x += w + u(14)
    if (G.above || G.below) {
      const text = `${G.above ? `${G.above} above` : ""}${G.above && G.below ? "  ·  " : ""}${G.below ? `${G.below} below` : ""}  ·  wheel to scroll`
      this.text(c, text, x, y, { size: 12.5, color: INK.warn })
    }
  },

  drawRest(c, scene) {
    const G = this.G
    if (!scene.rows.length) this.text(c, scene.filter === "needs" ? "nothing needs you" : "no sessions in the last day", G.busX + this.u(60), G.rowsTop + this.u(40), { size: 16, color: INK.faint })
  },

  // ---------------------------------------------------------------- projects

  signProject(g) {
    const tally = g.project.tally
    return `${g.project.closed}|${tally.threads}|${tally.working}|${tally.cost.toFixed(1)}|${tally.flags}`
  },

  drawProject(c, g) {
    const G = this.G
    const u = (value) => this.u(value)
    const project = g.project
    const y = g.y + g.h - u(15)
    const x = G.busX + u(20)
    this.caret(c, x, y - u(5), !project.closed, INK.dim)
    let at = this.run(c, x + u(16), y, [[project.name.toUpperCase(), { size: 14, family: FAMILY.label, weight: "600", color: INK.soft, spacing: 2.6 }]])
    const tally = project.tally
    const right = G.termX - u(18)
    const pieces = [[`${tally.threads} thread${tally.threads === 1 ? "" : "s"}`, { size: 12.5, color: INK.dim }]]
    if (tally.working) pieces.push(["  ·  ", { size: 12.5, color: INK.faint }], [`${tally.working} working`, { size: 12.5, color: INK.live }])
    if (tally.flags) pieces.push(["  ·  ", { size: 12.5, color: INK.faint }], [`${tally.flags} to watch`, { size: 12.5, color: INK.warn }])
    pieces.push(["  ·  ", { size: 12.5, color: INK.faint }], [moneyOf(tally.cost), { size: 12.5, color: INK.dim }])
    const width = pieces.reduce((sum, [value, style]) => sum + this.width(c, value, style), 0)
    this.run(c, right - width, y, pieces)
    const pathStyle = { size: 12.5, color: INK.faint }
    const path = this.fit(c, homed(project.dir), right - width - at - u(60), pathStyle)
    this.text(c, path, at + u(14), y, pathStyle)
    at += u(14) + this.width(c, path, pathStyle) + u(14)
    if (right - width - u(16) > at) this.line(c, at, y - u(4), right - width - u(16), y - u(4), INK.ghost)
  },

  // ---------------------------------------------------------------- threads

  liveOf(session) {
    if (session.state === "waiting") return { kind: "wait" }
    if (session.state !== "working") return null
    const tool = session.phase.tools[0]
    if (tool) return { kind: "tool", tool, more: session.phase.tools.length - 1 }
    const tail = session.tail ?? []
    for (let index = tail.length - 1; index >= 0; index -= 1) if (tail[index].kind !== "tool") return { kind: tail[index].kind, item: tail[index] }
    return { kind: "none" }
  },

  signRow(g, scene, now) {
    const session = g.row.session
    const parts = [session.state, session.phase.key, session.title, session.model, session.effort, session.agent, session.pane, session.cost.toFixed(2), session.context.used, scene.focus.id === session.id, g.row.index, g.row.closed, g.row.kids]
    for (const alert of session.alerts) parts.push(alert.kind, alert.level, alert.muted, alert.text)
    if (g.row.tally) parts.push(g.row.tally.threads, g.row.tally.working)
    if (session.turn) parts.push(Math.floor((now - session.turn.start) / 1000))
    else parts.push(Math.floor((now - (session.idleSince || session.updated)) / 60e3))
    parts.push(cacheSign(session.cache, now))
    const live = g.live ? this.liveOf(session) : null
    if (live?.kind === "tool") parts.push(live.tool.id, live.more, Math.floor((now - live.tool.start) / 1000))
    else if (live?.item) parts.push(live.item.key, this.shownOf(live.item))
    return parts.join("|")
  },

  drawRow(c, g, scene, now) {
    const G = this.G
    const u = (value) => this.u(value)
    const row = g.row
    const session = row.session
    const color = modelColor(session.model, session.provider)
    const working = session.state === "working"
    const waiting = session.state === "waiting"
    const focused = scene.focus.id === session.id
    const { somaX, axonY } = g

    // the cell body: its ring is the model, the dot inside grows with the context window
    if (working || waiting) {
      const tone = waiting ? INK.warn : color
      c.strokeStyle = tone
      c.lineWidth = 2
      c.beginPath()
      c.arc(somaX + 0.5, axonY + 0.5, g.r, 0, TAU)
      c.stroke()
      const fill = session.context.limit ? clamp(session.context.used / session.context.limit, 0, 1) : 0.3
      this.dot(c, somaX + 0.5, axonY + 0.5, u(3.5) + fill * (g.r - u(6.5)), tone)
    } else {
      const tone = session.state === "failed" ? INK.bad : session.unread ? INK.good : session.state === "stalled" ? INK.dim : INK.faint
      c.strokeStyle = tone
      c.lineWidth = 1.5
      if (session.state === "stalled") c.setLineDash([u(3), u(3)])
      c.beginPath()
      c.arc(somaX + 0.5, axonY + 0.5, g.r, 0, TAU)
      c.stroke()
      c.setLineDash([])
      if (session.unread) this.dot(c, somaX + 0.5, axonY + 0.5, u(2.5), INK.good)
    }
    // the prompt cache cooling: an arc round the cell body, a full circle when a model call has
    // just gone out, gone when the cache is cold. Dashed when its lifetime is assumed.
    const cache = session.cache
    const heat = cacheState(cache, now)
    if (heat && !heat.cold) {
      c.strokeStyle = heat.color
      c.lineWidth = u(2)
      c.lineCap = "butt"
      if (!cache.measured) c.setLineDash([u(3), u(3)])
      c.beginPath()
      c.arc(somaX + 0.5, axonY + 0.5, g.r + u(4.5), -Math.PI / 2, -Math.PI / 2 + Math.max(0.06, heat.share) * TAU)
      c.stroke()
      c.setLineDash([])
    }
    // a folded subtree: a second ring, and how many are inside
    if (row.closed) {
      c.strokeStyle = INK.dim
      c.lineWidth = 1
      c.beginPath()
      c.arc(somaX + 0.5, axonY + 0.5, g.r + (heat && !heat.cold ? u(9) : u(5)), 0, TAU)
      c.stroke()
    }

    // right side of the title line: how long, and before it what needs noticing
    const titleY = g.y + (g.live ? u(36) : u(32))
    let right = ""
    let rightStyle = { size: 14.5, color: INK.dim, align: "right" }
    if (working) {
      right = timerOf(now - session.turn.start)
      rightStyle = { size: 19, family: FAMILY.monoMedium, color: INK.text, align: "right" }
    } else if (waiting) {
      right = `waiting ${agoOf(now - (session.idleSince || session.updated))}`
      rightStyle = { size: 15, family: FAMILY.monoMedium, color: INK.warn, align: "right" }
    } else if (session.state === "stalled") right = `silent ${agoOf(now - session.last)}`
    else right = `${session.state === "failed" ? "failed" : "resting"} ${agoOf(now - (session.idleSince || session.updated))}`
    this.text(c, right, g.textRight, titleY, rightStyle)
    let edge = g.textRight - this.width(c, right, rightStyle) - u(14)
    for (const alert of session.alerts.slice(0, 3)) {
      const tone = alert.muted ? INK.faint : alert.level === "alert" ? (alert.kind === "call" ? INK.warn : INK.bad) : alert.level === "caution" ? INK.warn : alert.kind === "unread" ? INK.good : INK.dim
      const word = { call: "CALL", stall: "SILENT", streak: `${session.failStreak} FAILS`, context: `CTX ${Math.round((session.context.used / session.context.limit) * 100)}%`, long: alert.text.match(/×[\d.]+/)?.[0] ?? "LONG", unread: "UNREAD", failed: "FAILED" }[alert.kind] ?? alert.kind.toUpperCase()
      const w = this.chip(c, word, edge, titleY - u(1), { color: tone, solid: alert.level === "alert" && !alert.muted, align: "right" })
      this.hit("alert", alert.key, { x: edge - w, y: titleY - u(17), w, h: u(22) }, { alert })
      edge -= w + u(6)
    }

    // One grid for every row. The cell body's column: the thread's number stands over its cell
    // body on the title's baseline, tied to it by a stem. Then a gutter that holds the fold
    // caret when the thread has subagents. Then the text column: title, meta line and live
    // line all start at the same x, with or without a caret.
    const index = String(row.index + 1).padStart(2, "0")
    this.text(c, index, somaX, titleY, { size: 13, family: FAMILY.monoMedium, color: focused ? INK.live : working || waiting ? INK.soft : INK.dim, align: "center" })
    if (axonY - g.r - u(5) > titleY + u(8)) this.line(c, somaX, titleY + u(8), somaX, axonY - g.r - u(5), focused ? rgba(INK.live, 0.5) : INK.faint)
    const titleX = g.textX
    if (row.kids) this.caret(c, somaX + u(23), titleY - u(8), !row.closed, focused ? INK.live : INK.dim)
    const titleStyle = { size: 25, family: FAMILY.label, weight: "600", color: working || waiting || focused ? INK.text : INK.soft }
    this.text(c, this.fit(c, session.title, edge - titleX - u(8), titleStyle), titleX, titleY, titleStyle)

    // meta line: model, effort, agent, where it lives, cost, context
    const metaY = titleY + u(25)
    const small = { size: 14, color: INK.dim }
    let x = this.run(c, titleX, metaY, [[shortModel(session.model), { size: 14, family: FAMILY.monoMedium, color: working || waiting ? color : rgba(color, 0.7) }]])
    for (const part of [session.effort, session.agent]) if (part) x = this.run(c, x, metaY, [[`  ·  ${part}`, small]])
    if (session.pane) {
      x = this.run(c, x, metaY, [["  ·  ", small]])
      const paneStyle = { size: 14, color: INK.soft }
      this.text(c, session.pane, x, metaY, paneStyle)
      const w = this.width(c, session.pane, paneStyle)
      this.hit("pane", session.pane, { x: x - u(3), y: metaY - u(15), w: w + u(6), h: u(20) }, { tip: "click to go to this pane in herdr" })
      x += w
    }
    if (session.cost) x = this.run(c, x, metaY, [[`  ·  ${moneyOf(session.cost)}`, small]])
    if (session.context.limit && session.context.used) x = this.run(c, x, metaY, [[`  ·  ctx ${Math.round((session.context.used / session.context.limit) * 100)}%`, small]])
    const cacheText = cacheWord(cache, heat, now)
    if (cacheText) {
      x = this.run(c, x, metaY, [["  ·  ", small]])
      const style = { size: 14, color: heat.cold ? INK.faint : rgba(heat.color, working || waiting ? 1 : 0.85) }
      const w = this.width(c, cacheText, style)
      this.text(c, cacheText, x, metaY, style)
      this.hit("cache", session.id, { x: x - u(3), y: metaY - u(15), w: w + u(6), h: u(20) })
      x += w
    }
    if (row.closed && row.tally) this.run(c, x, metaY, [[`  ·  ${row.tally.threads} subagent${row.tally.threads === 1 ? "" : "s"} folded${row.tally.working ? `, ${row.tally.working} working` : ""}`, { size: 14, color: row.tally.working ? INK.live : INK.soft }]])
    if (working) {
      const phase = session.phase
      const word = phase.key === "tool" ? "" : `${phase.key === "calling" ? "calling the model" : phase.key} ${spanOf(Math.max(0, now - (phase.since ?? now)))}`
      if (word) this.text(c, word, g.textRight, metaY, { size: 14, color: INK.live, align: "right" })
    }
    if (!g.live) return

    // the live line: the thread's own words, or the command it is running
    const liveY = metaY + u(26)
    const live = this.liveOf(session)
    const size = 15
    const room = g.textRight - titleX
    if (!live) return
    if (live.kind === "wait") {
      const style = { size, color: INK.warn }
      this.text(c, this.fit(c, session.question ? `asks: ${session.question}` : "it asked you something and is waiting for the answer", room, style), titleX, liveY, style)
    } else if (live.kind === "tool") {
      const tool = live.tool
      const name = bare(tool.name)
      // a running call counts in whole seconds: tenths would repaint this whole row ten times a second
      const timer = spanOf(Math.max(1000, Math.floor((now - tool.start) / 1000) * 1000))
      const timerW = this.width(c, timer, { size, family: FAMILY.monoMedium }) + u(16)
      const nameStyle = { size, family: FAMILY.monoMedium, color: toolMeta(tool.name).color }
      this.text(c, name, titleX, liveY, nameStyle)
      const nameW = this.width(c, `${name}  `, nameStyle)
      const style = { size, color: INK.soft }
      this.text(c, this.fit(c, `${tool.label}${live.more > 0 ? `  +${live.more}` : ""}`, room - nameW - timerW, style), titleX + nameW, liveY, style)
      this.text(c, timer, g.textRight, liveY, { size, family: FAMILY.monoMedium, color: INK.live, align: "right" })
    } else if (live.item) {
      // the end of what it said, typed in place: the window is fixed, the characters fill it
      const charW = this.width(c, "M", { size })
      const perLine = Math.max(10, Math.floor(room / charW) - 2)
      const body = clean(live.item.text)
      const window = body.length > perLine ? `…${body.slice(-(perLine - 1))}` : body
      const part = live.item.text.length ? this.shownOf(live.item) / live.item.text.length : 1
      c.fillStyle = live.kind === "say" ? color : rgba(color, 0.4)
      c.fillRect(titleX, liveY - u(13), u(2), u(17))
      this.text(c, part >= 1 ? window : window.slice(0, Math.round(part * window.length)), titleX + u(12), liveY, { size, color: live.kind === "say" ? INK.text : INK.dim })
    } else {
      this.text(c, "waiting for the first words of this step", titleX, liveY, { size, color: INK.faint })
    }
  },

  // ---------------------------------------------------------------- equipment

  signPorts(scene) {
    const parts = []
    for (const port of scene.ports.values()) parts.push(port.id, port.inflight, port.count, port.errors, Math.round(port.p50 / 100))
    parts.push(Math.floor((scene.world?.now ?? 0) / 2500)) // the latency lines move left with time
    return parts.join("|")
  },

  // Each thing a model acts with is a box: its sign, how many calls went through it in the last
  // minutes, how long they take, and a lamp per call in flight.
  drawPorts(c, scene) {
    const G = this.G
    const u = (value) => this.u(value)
    this.label(c, "EQUIPMENT", G.portX, G.circuit.y + u(36))
    this.text(c, `last ${Math.round(scene.windowMs / 60e3)} min`, G.portX + G.boxW, G.circuit.y + u(36), { size: 11.5, color: INK.faint, align: "right" })
    this.note("section:equipment", { x: G.portX - u(4), y: G.circuit.y + u(20), w: G.boxW + u(8), h: u(22) }, "SECTION", "EQUIPMENT", [["WHAT", "what the models act with. Every tool call of every listed thread goes to exactly one of these"], ["COUNT", `the figure on a box is its calls in the last ${Math.round(scene.windowMs / 60e3)} minutes`], ["MARKS", "the line under a box: each call as a stem, as tall as it took. A lamp: a call in flight. A red flash: a call through it just failed"], ["WIRES", "a curve from a thread's wire to a box is a synapse: its calls leave along it and their results come back"]])
    for (const port of scene.ports.values()) {
      const spot = G.ports.get(port.id)
      const color = PORT_COLOR[port.id]
      const hot = port.inflight > 0
      const tone = port.id === "you" && hot ? INK.warn : color
      const rect = { x: spot.x, y: spot.y - G.boxH / 2, w: G.boxW, h: G.boxH }
      if (hot) {
        c.fillStyle = rgba(tone, 0.07)
        c.fillRect(rect.x, rect.y, rect.w, rect.h)
      }
      this.brackets(c, rect, hot ? tone : port.count ? INK.dim : INK.faint, 10, hot ? 2 : 1)
      // where the synapses land
      this.dot(c, rect.x + 0.5, spot.y + 0.5, hot ? u(4) : u(3), hot ? tone : port.count ? INK.dim : INK.faint)
      const x = rect.x + u(18)
      this.text(c, port.icon, x, spot.y + u(9), { size: 24, color: hot ? tone : port.count ? INK.soft : INK.faint })
      this.text(c, port.label, x + u(42), spot.y - u(8), { size: 16, family: FAMILY.label, weight: "600", color: hot ? INK.text : port.count ? INK.soft : INK.dim, spacing: 2.4 })
      // the quantity, set like a count on a crate
      this.text(c, port.count ? `×${port.count}` : "×0", rect.x + rect.w - u(14), spot.y - u(4), { size: 26, family: FAMILY.display, color: port.count ? INK.text : INK.faint, align: "right" })
      let stats = port.note
      if (hot) stats = port.id === "you" ? `${port.inflight} waiting on you` : `${port.inflight} in flight`
      else if (port.count) stats = `${port.p50 ? `usually ${spanOf(port.p50)}` : "in flight"}${port.errors ? `  ·  ${port.errors} failed` : ""}`
      this.text(c, stats, x + u(42), spot.y + u(16), { size: 12.5, color: hot ? tone : port.errors ? mix(INK.dim, INK.bad, 0.5) : port.count ? INK.dim : INK.faint })
      // a lamp per call in flight
      for (let lamp = 0; lamp < Math.min(8, port.inflight); lamp += 1) {
        c.fillStyle = tone
        c.fillRect(rect.x + rect.w - u(16) - lamp * u(10), rect.y + rect.h - u(14), u(6), u(6))
      }
      // The latency line under the box: every call of the window as a stem at the time it
      // started, as tall as it took (log scale, a tenth of a second to ten minutes), red when it
      // failed, hollow at the top while it still runs. The dotted line is the usual time.
      const calls = port.calls ?? []
      if (calls.length && port.id !== "you") {
        const now = scene.world?.now ?? Date.now()
        const strip = { x: rect.x + u(6), y: rect.y + rect.h + u(6), w: rect.w - u(12), h: u(24) }
        const floor = strip.y + strip.h
        const tall = (ms) => clamp((Math.log10(Math.max(100, ms) / 1000) + 1) / (Math.log10(600) + 1), 0.1, 1) * strip.h
        this.line(c, strip.x, floor, strip.x + strip.w, floor, rgba(INK.faint, 0.7))
        if (port.p50) {
          const y = Math.round(floor - tall(port.p50))
          c.setLineDash([u(1.5), u(4)])
          this.line(c, strip.x, y, strip.x + strip.w, y, rgba(INK.soft, 0.4))
          c.setLineDash([])
        }
        for (const call of calls) {
          const x = Math.round(strip.x + clamp((call.start - (now - scene.windowMs)) / scene.windowMs, 0, 1) * strip.w)
          const h = Math.round(tall(call.ms))
          c.fillStyle = call.failed ? INK.bad : rgba(color, call.open ? 1 : 0.7)
          c.fillRect(x, floor - h, call.failed ? 2 : 1.5, h)
          if (call.open) c.fillRect(x - 2, floor - h - 1, 5.5, 1.5)
        }
        this.hit("port", port.id, strip)
      }
    }
  },
}

export { PANEL }
