// The renderer core: layout, regions, overlays, hit targets and the sprite list.
//
// The still layer (type, wires, rings, gauges) is cut into regions, each with a signature; a
// region is repainted only when its signature changed. Overlays (the inspection card, the help
// sheet) are opaque panels painted over the regions they cover. Everything that travels or
// breathes is a sprite and is only listed here, never painted into the still layer. Nothing
// paints a backdrop: a pixel that is not ink stays transparent.
//
// The drawing itself lives in stage.mjs (the focus instrument and live tail), circuit.mjs (rails,
// projects, threads, equipment) and hud.mjs (header, phase, footer, card, help).

import { createCanvas } from "@napi-rs/canvas"
import { ringAngle, ringPoint } from "./body.mjs"
import { card } from "./card.mjs"
import { charts } from "./charts.mjs"
import { circuit } from "./circuit.mjs"
import { Flock } from "./flock.mjs"
import { hud } from "./hud.mjs"
import { PORTS, portOf } from "./model.mjs"
import { reach } from "./reach.mjs"
import { stage } from "./stage.mjs"
import { terrain } from "./terrain.mjs"
import { LEVEL_COLOR, LOG_USUAL_AT, NICE_SPANS, PANEL, PORT_COLOR, inside, intersects, spriteHex } from "./theme.mjs"
import { FAMILY, INK, TAU, clamp, fontOf, modelColor } from "./util.mjs"

export class Renderer {
  constructor(flow) {
    this.flow = flow
    this.W = 0
    this.H = 0
    this.S = 1
    this.fits = new Map()
    this.regions = []
    this.overlays = []
    this.occluders = []
    this.hits = new Map()
    this.sink = null
    this.marks = new Uint8Array(0)
    this.bandHeight = 90
    this.reveal = new Map()
    this.theta = new Map()
    this.flock = new Flock()
    this.arranged = ""
    this.wiresSignature = ""
    this.lastUpdate = 0
    this.dt = 0
    this.scroll = 0
    this.reticle = { focus: null, hover: null }
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
    this.overlays = []
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
    G.header = { x: 0, y: 0, w: W, h: u(150) }
    const footerH = u(330)
    if (wide) {
      const left = Math.round((W * 0.56) / this.cell.width) * this.cell.width
      G.circuit = { x: 0, y: G.header.h, w: left, h: H - G.header.h - footerH }
      G.footer = { x: 0, y: H - footerH, w: left, h: footerH }
      G.stage = { x: left, y: G.header.h, w: W - left, h: H - G.header.h }
    } else {
      // the stage, then the time terrain across the whole width, then the circuit
      const bandH = u(340)
      G.stage = { x: 0, y: G.header.h, w: W, h: u(770) + extra }
      G.band = { x: 0, y: G.stage.y + G.stage.h, w: W, h: bandH }
      G.circuit = { x: 0, y: G.band.y + bandH, w: W, h: H - G.band.y - bandH - footerH }
      G.footer = { x: 0, y: H - footerH, w: W, h: footerH }
    }
    // The living core, the centrepiece: a globe inside a ring system seen from above and in
    // front. Rm is the outermost orbit (the subagents), RA the turn clock, RB the context ring.
    const core = { Rm: u(368), RA: u(310), RB: u(252) }
    core.cx = G.stage.x + M + u(386)
    core.cy = G.stage.y + u(300)
    core.top = G.stage.y + u(44)
    core.bottom = core.cy + u(268)
    core.left = G.stage.x + M + u(4)
    core.right = core.cx + core.Rm + u(12)
    G.core = core
    const headX = core.cx + core.Rm + u(42)
    const split = headX - u(22) // where the core's column ends and the head's begins
    G.head = { x: headX, y: G.stage.y + u(34), w: G.stage.x + G.stage.w - M - headX }
    // the flock's own line of text changes with every dot that is fired: it has its own strip,
    // so the core under it (the largest region there is) is not painted again for it
    G.flockBox = { x: G.stage.x, y: G.stage.y, w: split - G.stage.x, h: u(38) }
    G.coreBox = { x: G.stage.x, y: G.stage.y + u(38), w: split - G.stage.x, h: core.bottom - G.stage.y - u(38) }
    G.plinth = { x: G.stage.x, y: core.bottom, w: split - G.stage.x, h: u(100) }
    // under the turn's time, the thread's prompt cache: an axis from its last call to when it goes cold
    G.cacheBox = { x: G.stage.x, y: G.plinth.y + G.plinth.h, w: split - G.stage.x, h: u(66) }
    const underTop = G.cacheBox.y + G.cacheBox.h
    G.charts = { x: headX, y: G.stage.y + u(262), w: G.head.w, h: u(170) }
    const stageBottom = G.stage.y + G.stage.h
    if (wide) {
      // landscape: the tail runs under the core across the stage, the terrain closes the stage
      G.terrain = { x: G.stage.x + M, y: stageBottom - u(350), w: G.stage.w - 2 * M, h: u(330) }
      G.band = { x: G.stage.x, y: G.terrain.y - u(10), w: G.stage.w, h: stageBottom - (G.terrain.y - u(10)) }
      const tailTop = underTop + u(46)
      G.tail = { x: G.stage.x + M + u(20), y: tailTop, w: G.stage.w - 2 * M - u(20), h: G.band.y - u(20) - tailTop }
      G.under = null
      G.reach = null
      G.tailBox = { x: G.stage.x, y: tailTop - u(36), w: G.stage.w, h: G.band.y - (tailTop - u(36)) }
      G.headBox = { x: split, y: G.stage.y, w: G.stage.x + G.stage.w - split, h: G.charts.y - G.stage.y }
      G.chartsBox = { x: split, y: G.charts.y, w: G.stage.x + G.stage.w - split, h: G.tailBox.y - G.charts.y }
    } else {
      G.tail = { x: headX, y: G.stage.y + u(478), w: G.head.w, h: G.stage.h - u(478) - u(22) }
      G.under = { x: G.stage.x, y: underTop, w: split - G.stage.x, h: stageBottom - underTop }
      // what the turn touched takes the room under THIS TURN's five lines, when there is room
      // for its head and three rows (the stage is as tall as the thread rows let it be)
      const listH = u(26) + 5 * u(25) + u(18)
      G.reach = null
      if (G.under.h - listH >= u(150)) {
        G.reach = { x: G.stage.x, y: underTop + listH, w: split - G.stage.x, h: G.under.h - listH }
        G.under.h = listH
      }
      G.tailBox = { x: split, y: G.tail.y - u(36), w: W - split, h: stageBottom - (G.tail.y - u(36)) }
      G.headBox = { x: split, y: G.stage.y, w: W - split, h: G.charts.y - G.stage.y }
      G.chartsBox = { x: split, y: G.charts.y, w: W - split, h: G.tailBox.y - G.charts.y }
      // the time terrain: every thread's output over the last minutes, the whole width
      G.terrain = { x: M, y: G.band.y + u(6), w: W - 2 * M, h: G.band.h - u(12) }
    }
    // the circuit
    const C = G.circuit
    G.rowsTop = C.y + u(62)
    G.rowsBottom = C.y + C.h - u(14)
    G.railTop = G.rowsTop + u(6)
    G.railPitch = u(54)
    G.railX0 = C.x + M + u(22)
    G.boxW = u(236)
    G.boxH = u(76)
    G.portX = C.x + C.w - M - G.boxW
    G.termX = G.portX - u(250)
    G.ports = new Map()
    G.speed = 12 * this.S // pixels a second a tick drifts along an axon
    G.rows = []
    G.rowOf = new Map()
    this.G = G
  }

  rowHeight(row) {
    if (row.type === "project") return this.u(46)
    return this.tall(row.session) ? this.u(120) : this.u(86)
  }

  tall(session) {
    return session.state === "working" || session.state === "waiting"
  }

  // Lays the rows out, hands every path to the moving layer and rebuilds the region list.
  // Runs only when the rows, their order or size, the focus, the scroll or the zoom changed.
  arrange(scene, ui, now) {
    let G = this.G
    const u = (value) => this.u(value)
    const accounts = scene.world?.accounts ?? []
    if (scene.focus.id !== this.scrollFocus) this.follow = true
    const signature = [this.W, this.H, scene.focus.id, this.scroll, ui.zoom, this.follow, accounts.map((account) => account.name).join(","), ...scene.rows.map((row) => (row.type === "project" ? `P${row.key}${row.closed ? "-" : "+"}` : `${row.key}:${row.depth}:${this.tall(row.session) ? 1 : 0}${row.closed ? "-" : ""}`))].join("|")
    if (signature === this.arranged) return false
    const rows = scene.rows
    const natural = rows.map((row) => this.rowHeight(row))
    const wanted = natural.reduce((sum, height) => sum + height, 0)
    if (!G.wide) {
      // few threads: the stage takes what they leave, in steps of four lines of text. Zoom takes more.
      const step = u(112)
      const spare = G.rowsBottom - G.rowsTop + this.extra - Math.max(wanted, PORTS.length * u(96)) - u(30)
      const extra = Math.max(clamp(Math.floor(spare / step) * step, 0, step * 7), ui.zoom ? step * 5 : 0)
      if (extra !== this.extra) {
        this.extra = extra
        this.layout(false, extra)
        G = this.G
      }
    }
    G.rails = accounts.map((account, index) => ({ name: account.name, x: G.railX0 + index * (accounts.length > 3 ? Math.round((G.railPitch * 3) / accounts.length) : G.railPitch) }))
    G.railsRight = (G.rails.length ? G.rails[G.rails.length - 1].x : G.railX0) + u(30)
    G.busX = G.railsRight + u(14)
    const somaX0 = G.busX + u(66)
    const room = G.rowsBottom - G.rowsTop
    // which rows are on screen: everything when it fits, else a window that keeps the focus in view
    let heights = natural
    let first = 0
    let end = rows.length
    if (wanted <= room) {
      this.scroll = 0
      const air = rows.length ? Math.min(u(22), Math.floor((room - wanted) / rows.length)) : 0
      heights = natural.map((height, index) => (rows[index].type === "project" ? height : height + air))
    } else {
      const fit = (from) => {
        let used = 0
        let index = from
        while (index < rows.length && used + natural[index] <= room) used += natural[index++]
        return index
      }
      this.scroll = clamp(this.scroll, 0, rows.length - 1)
      while (this.scroll > 0 && fit(this.scroll - 1) === rows.length) this.scroll -= 1
      if (this.follow) {
        const at = rows.findIndex((row) => row.type === "thread" && row.session.id === scene.focus.id)
        if (at >= 0) {
          if (at < this.scroll) this.scroll = at > 0 && rows[at - 1].type === "project" ? at - 1 : at
          while (fit(this.scroll) <= at && this.scroll < at) this.scroll += 1
        }
      }
      first = this.scroll
      end = fit(first)
    }
    this.follow = false
    this.scrollFocus = scene.focus.id
    this.arranged = [this.W, this.H, scene.focus.id, this.scroll, ui.zoom, false, signature.split("|").slice(6).join("|")].join("|")
    let y = G.rowsTop
    G.rows = []
    for (let index = first; index < end; index += 1) {
      const row = rows[index]
      const h = heights[index]
      if (row.type === "project") G.rows.push({ project: row, key: row.key, y, h })
      else {
        const working = this.tall(row.session)
        const somaX = somaX0 + Math.min(row.depth, 4) * u(44)
        G.rows.push({ row, key: row.key, sid: row.session.id, y, h, somaX, r: working ? u(13) : u(8), axonY: y + h - u(18), textX: somaX + u(38), textRight: G.termX - u(18), live: working && h >= u(110) })
      }
      y += h
    }
    G.above = rows.slice(0, first).filter((row) => row.type === "thread").length
    G.below = rows.slice(end).filter((row) => row.type === "thread").length
    G.used = y - G.rowsTop
    G.rowOf = new Map(G.rows.filter((g) => g.row).map((g) => [g.sid, g]))
    // the equipment and the rails stand beside the rows, not beside empty space
    const extent = Math.min(room, Math.max(G.used, PORTS.length * u(96)))
    PORTS.forEach((port, index) => G.ports.set(port.id, { x: G.portX, y: Math.round(G.rowsTop + ((index + 0.5) * extent) / PORTS.length) }))
    G.railBottom = G.rowsTop + Math.min(room, Math.max(G.used, u(640))) - u(88)

    // paths for the moving layer
    const flow = this.flow
    flow.clearPaths()
    for (const g of G.rows) {
      if (!g.row) continue
      const rail = G.rails.find((candidate) => candidate.name === g.row.session.account)
      if (rail) {
        flow.setPath(`in:${g.sid}`, [[rail.x, G.railTop], [rail.x, g.axonY], [g.somaX - g.r, g.axonY]])
        flow.setPath(`spend:${g.sid}`, [[g.somaX - g.r, g.axonY], [rail.x, g.axonY], [rail.x, G.railBottom]])
      }
      flow.setPath(`axon:${g.sid}`, [[g.somaX + g.r, g.axonY], [G.termX, g.axonY]])
      for (const [id, port] of G.ports) {
        flow.setPath(`syn:${g.sid}:${id}`, this.curve(G.termX, g.axonY, port.x - u(3), port.y))
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
      // straight up the bus to the tip, where what it writes gathers before it enters the core
      const tip = this.tipOf()
      flow.setPath(`focus:${focus.sid}`, [[focus.somaX - focus.r, focus.axonY], [G.busX, focus.axonY], [G.busX, Math.round(tip.y + u(24))]])
    }
    this.buildRegions()
    this.layoutHits()
    this.wiresSignature = ""
    return true
  }

  // Where the focused thread's wire ends: under the core's near left, below the outer orbit.
  tipOf() {
    const G = this.G
    const core = G.core
    if (G.wide || !G.busX) return { x: core.left + this.u(40), y: core.bottom - this.u(30) }
    return { x: G.busX, y: core.bottom - this.u(30) }
  }

  // A synapse: leaves horizontally, arrives horizontally.
  curve(x0, y0, x1, y1) {
    const points = []
    const dx = x1 - x0
    for (let step = 0; step <= 28; step += 1) {
      const t = step / 28
      const a = (1 - t) ** 3
      const b = 3 * (1 - t) ** 2 * t
      const c = 3 * (1 - t) * t ** 2
      const d = t ** 3
      points.push([a * x0 + b * (x0 + dx * 0.55) + c * (x1 - dx * 0.55) + d * x1, a * y0 + b * y0 + c * y1 + d * y1])
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
    const add = (name, rect, sign, draw, circuit = false, wires = circuit) => regions.push({ name, rect, sign, draw, circuit, wires, last: null })
    add("header", G.header, (scene, ui, now, meta) => this.signHeader(scene, ui, now, meta), (c, scene, ui, now, meta) => this.drawHeader(c, scene, ui, now, meta))
    // the stage in parts, so a second ticking or a word typed repaints only where it happened
    add("core", G.coreBox, (scene, ui, now) => this.signCore(scene, ui, now), (c, scene, ui, now) => this.drawCore(c, scene, ui, now), false, true)
    add("flockline", G.flockBox, (scene) => this.signFlockLine(scene), (c, scene) => this.drawFlockLine(c, scene))
    add("plinth", G.plinth, (scene, ui, now) => this.signPlinth(scene, ui, now), (c, scene, ui, now) => this.drawPlinth(c, scene, ui, now), false, true)
    add("cache", G.cacheBox, (scene, ui, now) => this.signCache(scene, ui, now), (c, scene, ui, now) => this.drawCache(c, scene, ui, now), false, true)
    if (G.under) add("under", G.under, (scene, ui, now) => this.signUnder(scene, ui, now), (c, scene, ui, now) => this.drawUnder(c, scene, ui, now), false, true)
    if (G.reach) add("reach", G.reach, (scene, ui, now) => this.signReach(scene, ui, now), (c, scene, ui, now) => this.drawReach(c, scene, ui, now), false, true)
    add("head", G.headBox, (scene, ui, now) => this.signHead(scene, ui, now), (c, scene, ui, now) => this.drawHead(c, scene, ui, now))
    add("charts", G.chartsBox, (scene, ui, now) => this.signCharts(scene, ui, now), (c, scene, ui, now) => this.drawCharts(c, scene, ui, now))
    add("tail", G.tailBox, (scene, ui, now) => this.signTail(scene, ui, now), (c, scene, ui, now) => this.drawTail(c, scene, ui, now))
    add("terrain", G.band, (scene, ui, now) => this.signTerrain(scene, ui, now), (c, scene, ui, now) => this.drawTerrain(c, scene, ui, now))
    const left = G.railsRight
    const right = G.termX + this.u(12)
    add("rails", { x: C.x, y: C.y, w: left - C.x, h: C.h }, (scene, ui, now) => this.signRails(scene, now), (c, scene, ui, now) => this.drawRails(c, scene, now), true)
    add("top", { x: left, y: C.y, w: right - left, h: G.rowsTop - C.y }, (scene) => `${scene.threads.length}|${scene.filter}|${G.above}|${G.below}|${scene.focus.auto}`, (c, scene) => this.drawCircuitHead(c, scene), true)
    for (const g of G.rows) {
      const rect = { x: left, y: g.y, w: right - left, h: g.h }
      if (g.project) add(`proj:${g.key}`, rect, (scene) => this.signProject(g), (c, scene) => this.drawProject(c, g, scene), true)
      else add(`row:${g.sid}`, rect, (scene, ui, now) => this.signRow(g, scene, now), (c, scene, ui, now) => this.drawRow(c, g, scene, now), true)
    }
    const last = G.rows[G.rows.length - 1]
    const restY = last ? last.y + last.h : G.rowsTop
    add("rest", { x: left, y: restY, w: right - left, h: C.y + C.h - restY }, (scene) => `${scene.rows.length}|${G.below}`, (c, scene) => this.drawRest(c, scene), true)
    add("ports", { x: right, y: C.y, w: C.x + C.w - right, h: C.h }, (scene, ui, now) => this.signPorts(scene, now), (c, scene, ui, now) => this.drawPorts(c, scene, now), true)
    // the footer in four parts; the sector map keeps the name "footer" (its blips are looked up by it)
    const cols = this.footerCols()
    add("comms", cols.comms, (scene, ui, now) => this.signComms(scene, now), (c, scene, ui, now) => this.drawCommsRegion(c, scene, now))
    add("footer", cols.map, (scene) => this.signMap(scene), (c, scene) => this.drawMapRegion(c, scene))
    add("log", cols.log, (scene, ui, now) => this.signLog(scene, ui, now), (c, scene, ui, now) => this.drawLogRegion(c, scene, ui, now))
    add("hints", cols.hints, (scene, ui) => ui.tip, (c, scene, ui) => this.drawHints(c, ui))
    this.regions = regions
  }

  // ---------------------------------------------------------------- hit targets

  // Targets that follow from the layout alone. Regions add their own while they paint.
  layoutHits() {
    const G = this.G
    const u = (value) => this.u(value)
    const list = []
    const left = G.railsRight
    for (const g of G.rows) {
      if (g.project) list.push({ kind: "project", id: g.key, rect: { x: left, y: g.y, w: G.termX - left, h: g.h } })
      else {
        list.push({ kind: "thread", id: g.sid, rect: { x: left, y: g.y, w: G.termX + u(8) - left, h: g.h } })
        if (g.row.kids) list.push({ kind: "fold", id: g.sid, rect: { x: g.somaX - u(20), y: g.axonY - u(20), w: u(40), h: u(40) } })
      }
    }
    for (const [id, port] of G.ports) list.push({ kind: "port", id, rect: { x: port.x, y: port.y - G.boxH / 2, w: G.boxW, h: G.boxH } })
    for (const rail of G.rails) list.push({ kind: "account", id: rail.name, rect: { x: rail.x - u(20), y: G.railTop - u(4), w: u(42), h: G.railBottom - G.railTop + u(76) } })
    this.hits.set("layout", list)
  }

  hit(kind, id, rect, more) {
    if (this.sink) this.sink.push({ kind, id, rect, ...more })
  }

  // A small mark that is a reading or a label: a target whose card is written where the mark
  // is drawn, so the two cannot say different things. `lines` are [name, value] pairs.
  note(id, rect, kicker, title, lines, tone) {
    this.hit("note", id, rect, { card: { kicker, title, lines, tone } })
  }

  // What is under a point: an overlay first, then a mark on the instrument or an axon, then the
  // smallest target that holds the point.
  hitTest(x, y, scene, now) {
    const onCard = this.cardHit(x, y)
    if (onCard) return onCard
    for (const overlay of this.overlays) {
      if (!inside(overlay.rect, x, y)) continue
      for (const target of this.hits.get(overlay.name) ?? []) if (inside(target.rect, x, y)) return target
      return { kind: "overlay", id: overlay.name, rect: overlay.rect }
    }
    for (const moon of this.moons ?? []) {
      const r = this.u(13)
      if (Math.abs(x - moon.x) <= r && Math.abs(y - moon.y) <= r) return { kind: "thread", id: moon.sid, moon: true, moving: true, rect: { x: moon.x - r, y: moon.y - r, w: r * 2, h: r * 2 } }
    }
    const tip = this.flock.tip
    if (tip && scene.focused && this.flock.sid === scene.focus.id && Math.hypot(x - tip.x, y - tip.y) <= this.u(26)) {
      const r = this.u(16)
      return { kind: "charge", id: this.flock.sid, rect: { x: tip.x - r, y: tip.y - r, w: r * 2, h: r * 2 } }
    }
    const dot = this.dotAt(x, y, scene)
    if (dot) return dot
    const mark = this.markAt(x, y, scene, now)
    if (mark) return mark
    let best = null
    for (const list of this.hits.values()) {
      for (const target of list) {
        if (!inside(target.rect, x, y)) continue
        if (!best || target.rect.w * target.rect.h < best.rect.w * best.rect.h) best = target
      }
    }
    // on the terrain a point of a ridge, unless a mark on it (a tool call, a flag, a name) is under the pointer
    if (best?.kind === "terrain") return this.terrainAt(x, y) ?? best
    return best
  }

  // A dot of the flock: hit in screen space, the nearest to the eye first.
  dotAt(x, y, scene) {
    const flock = this.flock
    const core = this.G.core
    if (!scene.focused || flock.sid !== scene.focus.id || !inside(this.G.coreBox, x, y)) return null
    // a satellite: a tool call in flight on its lane
    for (const sat of flock.sats) {
      const r = this.u(11)
      if (Math.abs(x - sat.x) <= r && Math.abs(y - sat.y) <= r) return { kind: "tool", id: sat.id, sid: flock.sid, tool: sat.tool, sat: true, moving: true, rect: { x: sat.x - r, y: sat.y - r, w: r * 2, h: r * 2 } }
    }
    const index = flock.hit(x, y, this.u(9))
    if (index < 0) return null
    const r = this.u(8)
    return { kind: "dot", id: `${flock.sid}:${flock.turn}:${index}`, sid: flock.sid, index, moving: true, rect: { x: flock.sx[index] - r, y: flock.sy[index] - r, w: r * 2, h: r * 2 } }
  }

  // A model call or a tool call drawn as a mark: a spoke or a bar on the turn clock, a tick on an axon.
  markAt(x, y, scene, now) {
    const u = (value) => this.u(value)
    const G = this.G
    const clock = this.clock
    if (clock && inside(G.coreBox, x, y)) {
      // a pillar (a tool call) or a bar (a model call) on the turn clock: the nearest one within reach
      const reach = u(5)
      let best = null
      for (const list of [clock.tools, clock.steps]) {
        for (const entry of list) {
          const sx = entry.x1 - entry.x0
          const sy = entry.y1 - entry.y0
          const along = clamp(((x - entry.x0) * sx + (y - entry.y0) * sy) / (sx * sx + sy * sy || 1), 0, 1)
          const gap = Math.hypot(x - (entry.x0 + sx * along), y - (entry.y0 + sy * along))
          if (gap <= reach && (!best || gap < best.gap)) best = { entry, gap }
        }
      }
      if (best) {
        const { entry } = best
        const mx = (entry.x0 + entry.x1) / 2
        const my = (entry.y0 + entry.y1) / 2
        const h = Math.max(u(16), Math.abs(entry.y1 - entry.y0) + u(8))
        return { kind: entry.tool ? "tool" : "step", id: entry.tool ? entry.tool.id : `${clock.sid}:${entry.step.seq}`, sid: clock.sid, tool: entry.tool, step: entry.step, rect: { x: mx - u(8), y: my - h / 2, w: u(16), h } }
      }
    }
    // the context ring itself: within reach of its line, the target sits on the ring there
    const focused = scene.focused?.session
    if (focused?.context.limit && focused.context.used && inside(G.coreBox, x, y)) {
      const { view } = this.coreView(focused)
      const at = ringAngle(view, x, y)
      if (Math.abs(at.radius - G.core.RB) <= u(9)) {
        const spot = ringPoint(view, G.core.RB, at.angle, 0, [0, 0, 0, 0])
        const r = u(9)
        return { kind: "context", id: focused.id, rect: { x: spot[0] - r, y: spot[1] - r, w: r * 2, h: r * 2 } }
      }
    }
    for (const g of G.rows) {
      if (!g.row || Math.abs(y - g.axonY) > u(11)) continue
      const from = g.somaX + g.r + u(4)
      if (x < from || x > G.termX) continue
      let best = null
      for (const step of g.row.session.steps) {
        const at = step.streamed ?? step.items[0]?.at ?? null
        if (at !== null) {
          const px = from + ((now - at) / 1000) * G.speed
          const gap = Math.abs(px - x)
          if (gap <= u(8) && (!best || gap < best.gap)) best = { gap, px, step }
        }
        for (const tool of step.tools) {
          const px = from + ((now - tool.start) / 1000) * G.speed
          const gap = Math.abs(px - x)
          if (gap <= u(8) && (!best || gap <= best.gap)) best = { gap, px, step, tool }
        }
      }
      if (best) return { kind: best.tool ? "tool" : "step", id: best.tool ? best.tool.id : `${g.sid}:${best.step.seq}`, sid: g.sid, tool: best.tool, step: best.step, moving: true, rect: { x: best.px - u(9), y: g.axonY - u(11), w: u(18), h: u(22) } }
    }
    return null
  }

  // ---------------------------------------------------------------- frame

  // Repaints what changed. Returns true when anything did; this.marks then flags the tile rows
  // that have to be read back.
  update(scene, ui, now, meta) {
    this.dt = this.lastUpdate ? Math.min(0.25, (now - this.lastUpdate) / 1000) : 0
    this.lastUpdate = now
    const rearranged = this.arrange(scene, ui, now)
    if (!rearranged && scene.rows !== this.rowsSeen) {
      // every poll brings new row and session objects: a laid-out row follows its thread, or it
      // would show the poll it was laid out in until the layout next changes
      const fresh = new Map(scene.rows.map((row) => [row.key, row]))
      for (const g of this.G.rows) {
        const row = fresh.get(g.key)
        if (!row) continue
        if (g.project) g.project = row
        else g.row = row
      }
    }
    this.rowsSeen = scene.rows
    this.advance(scene, now, this.dt)
    const bands = Math.ceil(this.H / this.bandHeight)
    this.marks = new Uint8Array(bands)
    // per tile row, the columns that were painted: x0 and x1
    this.spans = new Int32Array(bands * 2)
    for (let band = 0; band < bands; band += 1) this.spans[band * 2] = this.W
    const wires = this.signWires(scene, now)
    const rewire = wires !== this.wiresSignature || rearranged
    this.repaints ??= {}
    if (rewire) {
      this.wiresSignature = wires
      this.drawWires(scene, now)
      this.repaints.wires = (this.repaints.wires ?? 0) + 1
    }
    // overlays wanted now, and the ground that has to be repainted because one moved, changed or left
    const overlays = this.overlaysFor(scene, ui, now)
    const stale = []
    for (const before of this.overlays) {
      const after = overlays.find((overlay) => overlay.name === before.name)
      if (!after || after.signature !== before.signature || after.rect.x !== before.rect.x || after.rect.y !== before.rect.y || after.rect.w !== before.rect.w || after.rect.h !== before.rect.h) stale.push(before.rect)
    }
    for (const after of overlays) {
      const before = this.overlays.find((overlay) => overlay.name === after.name)
      after.fresh = !before || stale.includes(before.rect)
    }
    for (const name of this.hits.keys()) if (name.startsWith("over:") && !overlays.some((overlay) => overlay.name === name)) this.hits.delete(name)
    let any = false
    const painted = []
    if (rearranged) this.base.clearRect(0, 0, this.W, this.H)
    this.causes ??= {}
    for (const region of this.regions) {
      this.signed = null
      const signature = region.sign(scene, ui, now, meta)
      const signed = this.signed
      const under = stale.some((rect) => intersects(rect, region.rect))
      if (signature === region.last && !(rewire && region.circuit) && !rearranged && !under) {
        continue
      }
      // why it is painted again: the named parts of its signature that changed (where the region
      // names them), or what forced it
      const before = region.parts
      if (signed) region.parts = signed
      const named = new Set()
      if (signature === region.last) named.add(rearranged ? "layout" : under ? "an overlay moved" : "wires")
      else if (signed && before) {
        const count = Math.max(signed.parts.length, before.parts.length)
        for (let index = 0; index < count; index += 1) if (signed.parts[index] !== before.parts[index] || signed.labels[index] !== before.labels[index]) named.add(signed.labels[index] ?? before.labels[index])
      }
      for (const label of named) {
        const key = `${region.name}: ${label}`
        this.causes[key] = (this.causes[key] ?? 0) + 1
      }
      region.last = signature
      this.paint(region, scene, ui, now, meta)
      this.repaints[region.name] = (this.repaints[region.name] ?? 0) + 1
      painted.push(region.rect)
      any = true
    }
    for (const overlay of overlays) {
      if (!overlay.fresh && !painted.some((rect) => intersects(rect, overlay.rect))) continue
      this.paint(overlay, scene, ui, now, meta)
      any = true
    }
    this.overlays = overlays
    this.occluders = overlays.map((overlay) => overlay.rect)
    if (rearranged) {
      this.marks.fill(1)
      for (let band = 0; band < bands; band += 1) {
        this.spans[band * 2] = 0
        this.spans[band * 2 + 1] = this.W
      }
    }
    return any
  }

  paint(region, scene, ui, now, meta) {
    const c = this.base
    const { x, y, w, h } = region.rect
    if (w <= 0 || h <= 0) return
    this.sink = []
    c.save()
    c.beginPath()
    c.rect(x, y, w, h)
    c.clip()
    c.clearRect(x, y, w, h)
    if (region.wires) c.drawImage(this.wiresCanvas, x, y, w, h, x, y, w, h)
    region.draw(c, scene, ui, now, meta)
    c.restore()
    this.hits.set(region.name, this.sink)
    this.sink = null
    const first = Math.max(0, Math.floor(y / this.bandHeight))
    const last = Math.min(this.marks.length - 1, Math.floor((y + h - 1) / this.bandHeight))
    for (let band = first; band <= last; band += 1) {
      this.marks[band] = 1
      if (x < this.spans[band * 2]) this.spans[band * 2] = Math.max(0, Math.floor(x))
      if (x + w > this.spans[band * 2 + 1]) this.spans[band * 2 + 1] = Math.min(this.W, Math.ceil(x + w))
    }
  }

  // Things that ease or type themselves: text reveal, comet angles, the reticles.
  advance(scene, now, dt) {
    const live = new Set()
    // text types in steps of a fifteenth of a second: it reads the same and repaints half as often
    this.typeClock = (this.typeClock ?? 0) + dt
    const typeStep = this.typeClock >= 0.066 ? this.typeClock : 0
    if (typeStep) this.typeClock = 0
    for (const row of scene.threads) {
      const session = row.session
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
    this.knownSessions = new Set(scene.threads.map((row) => row.session.id))
    if (this.reveal.size > 900) for (const key of this.reveal.keys()) if (!live.has(key)) this.reveal.delete(key)
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
    if (maxWidth <= 0) result = ""
    else if (this.width(c, value, style) > maxWidth) {
      let low = 0
      let high = value.length
      while (low < high) {
        const middle = (low + high + 1) >> 1
        if (this.width(c, `${value.slice(0, middle).trimEnd()}…`, style) <= maxWidth) low = middle
        else high = middle - 1
      }
      result = low > 0 ? `${value.slice(0, low).trimEnd()}…` : ""
    }
    if (this.fits.size > 5000) this.fits.clear()
    this.fits.set(key, result)
    return result
  }

  // The same, for prose: the cut falls at the end of a word, never inside one. A line that is
  // one long word (a path) is still cut where the room ends.
  fitWords(c, value, maxWidth, style) {
    const cut = this.fit(c, value, maxWidth, style)
    if (cut === value || !cut) return cut
    const body = cut.slice(0, -1)
    if (!value.startsWith(body) || /\s/.test(value[body.length] ?? " ")) return cut
    const at = body.lastIndexOf(" ")
    if (at < body.length * 0.5) return cut
    return `${body.slice(0, at).replace(/[\s,;:.·-]+$/, "")}…`
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

  dot(c, x, y, radius, color) {
    c.fillStyle = color
    c.beginPath()
    c.arc(x, y, radius, 0, TAU)
    c.fill()
  }

  label(c, value, x, y, color = INK.dim, align = "left", size = 12.5) {
    this.text(c, value, x, y, { size, family: FAMILY.label, weight: "600", color, align, spacing: 2.6 })
  }

  // Four corner marks around a rectangle: the frame every instrument and box shares.
  brackets(c, rect, color, arm = 9, width = 1) {
    const a = this.u(arm)
    const x0 = Math.round(rect.x) + 0.5
    const y0 = Math.round(rect.y) + 0.5
    const x1 = Math.round(rect.x + rect.w) - 0.5
    const y1 = Math.round(rect.y + rect.h) - 0.5
    c.strokeStyle = color
    c.lineWidth = width
    c.beginPath()
    for (const [x, y, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x1, y1, -1, -1], [x0, y1, 1, -1]]) {
      c.moveTo(x + sx * a, y)
      c.lineTo(x, y)
      c.lineTo(x, y + sy * a)
    }
    c.stroke()
  }

  // A small tag. Returns its width, so tags can be set in a row. `x` is its left edge, or its
  // right edge with align "right".
  chip(c, value, x, y, { color = INK.dim, solid = false, align = "left", size = 11.5 } = {}) {
    const u = (v) => this.u(v)
    const style = { size, family: FAMILY.label, weight: "600", spacing: 2 }
    const w = Math.round(this.width(c, value, style)) + u(14)
    const h = u(20)
    const left = Math.round(align === "right" ? x - w : x)
    const top = Math.round(y - h + u(5))
    if (solid) {
      c.fillStyle = color
      c.fillRect(left, top, w, h)
    } else {
      c.strokeStyle = color
      c.lineWidth = 1
      c.strokeRect(left + 0.5, top + 0.5, w - 1, h - 1)
    }
    this.text(c, value, left + u(7) + u(1), y, { ...style, color: solid ? PANEL : color })
    return w
  }

  caret(c, x, y, open, color) {
    const s = this.u(5)
    c.fillStyle = color
    c.beginPath()
    if (open) {
      c.moveTo(x - s, y - s * 0.6)
      c.lineTo(x + s, y - s * 0.6)
      c.lineTo(x, y + s * 0.8)
    } else {
      c.moveTo(x - s * 0.6, y - s)
      c.lineTo(x + s * 0.8, y)
      c.lineTo(x - s * 0.6, y + s)
    }
    c.closePath()
    c.fill()
  }

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

  // ---------------------------------------------------------------- the moving layer

  // Sprites whose place follows from state and the clock: ticks drifting along axons, comets,
  // breathing, the reticles, the alert strip. Ends by dropping what an overlay covers.
  sprites(scene, ui, now, out) {
    const G = this.G
    if (!G?.rows) return
    const u = (value) => this.u(value)
    for (const g of G.rows) {
      if (!g.row) continue
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
      if (session.state === "working") {
        if (session.phase.key !== "tool") this.comet(out, `c:${g.sid}`, g.somaX, g.axonY, g.r + u(8), this.theta.get(g.sid) ?? 0, hex, 3, 0.42)
      } else if (session.state === "waiting") {
        // a call rings: a quick amber breath
        const level = Math.floor(((Math.sin(now / 220) + 1) / 2) * 3.999)
        if (level) out.push({ key: `b:${g.sid}`, kind: `breath${level}|${INK.warn}`, x: g.somaX, y: g.axonY })
      } else {
        // a resting cell breathes, slower the longer it has rested, and lies still after 45 minutes
        const rest = now - (session.idleSince || session.updated)
        if (rest < 45 * 60e3 && session.state !== "stalled") {
          const period = 5000 + Math.min(9000, rest / 200)
          const level = Math.floor(((Math.sin((now / period) * TAU + g.y) + 1) / 2) * 3.999)
          if (level) out.push({ key: `b:${g.sid}`, kind: `breath${level}|${hex}`, x: g.somaX, y: g.axonY })
        }
      }
    }
    const focus = scene.focused
    if (focus) {
      const session = focus.session
      const core = G.core
      const hex = spriteHex(modelColor(session.model, session.provider))
      // the flock: the turn's output, flying or in formation
      const turn = this.turnWindow(session, now)
      const started = performance.now()
      const flock = this.flock
      flock.held = ui.hover?.kind === "dot" ? ui.hover.index : -1
      flock.step({ session, turn, now, dt: this.dt, core, S: this.S, rate: scene.rateOf(session.id, now), entry: this.tipOf(), pointer: ui.pointer && !ui.help ? ui.pointer : null, ports: scene.ports })
      flock.emit(out, { core, S: this.S, session, now, dt: this.dt })
      this.flockMs = performance.now() - started
      const view = flock.view
      const spot = [0, 0, 0, 0]
      // a point of a ring as the flock's view sees it this frame, shifted with the pointer like the dots
      const onRing = (radius, angle) => {
        ringPoint(view, radius, angle, 0, spot)
        return { x: spot[0] + spot[2] * flock.parX, y: spot[1] + spot[2] * flock.parY, under: false }
      }
      if (session.turn) {
        // the head of the turn clock's arc
        const elapsed = now - session.turn.start
        const at = onRing(core.RA, Math.min(0.999, elapsed / this.turnScale(session, elapsed)) * TAU)
        out.push({ key: "ring-head", kind: `pulse|${hex}`, x: at.x, y: at.y, z: 12 })
      }
      // The head of the context ring: where the reported context stands. When a report moves
      // it, the head runs along the ring to its new place in half a second, and back when a
      // compaction has opened the ring again (with a ripple where it lands).
      const limit = session.context.limit
      const fill = limit && session.context.used ? clamp(session.context.used / limit, 0.004, 1) : 0
      if (fill) {
        let head = this.contextHead
        const ease = (entry) => entry.from + (entry.to - entry.from) * (1 - (1 - clamp((now - entry.at) / 520, 0, 1)) ** 3)
        if (!head || head.sid !== session.id) head = this.contextHead = { sid: session.id, from: fill, to: fill, at: 0 }
        else if (Math.abs(head.to - fill) > 1e-4) {
          const opened = fill < head.to - 0.02
          head = this.contextHead = { sid: session.id, from: ease(head), to: fill, at: now, opened }
        }
        const share = ease(head)
        const at = onRing(core.RB, share * TAU)
        out.push({ key: "ctx-head", kind: `head|${share >= 0.92 ? INK.bad : share >= 0.8 ? INK.warn : INK.text}`, x: at.x, y: at.y, z: 12 })
        if (head.opened && now - head.at >= 520) {
          this.ripple(at.x, at.y, INK.live, now)
          head.opened = false
        }
      } else this.contextHead = null
      if (session.state === "working" && session.phase.key !== "tool") {
        // the comet on the context ring: the model is generating, faster when tokens stream faster
        const theta = this.theta.get(session.id) ?? 0
        for (let segment = 0; segment <= 7; segment += 1) {
          const at = onRing(core.RB, theta - segment * 0.075)
          out.push({ key: segment ? `core.${segment}` : "core", kind: `${segment === 0 ? "pulse" : segment <= 4 ? "tail" : "mote"}|${hex}`, x: at.x, y: at.y, z: 11 })
        }
      }
      // Moons: the focused thread's subagents ride the outermost orbit. One that works circles
      // as fast as its own tokens stream, with a small flock of its own (one dot at 250 tokens
      // of its turn, one more each time that doubles, eight at most); one that rests sits still.
      this.moons = []
      let slot = 0
      for (const row of scene.threads) {
        if (row.parent?.session.id !== session.id) continue
        const child = row.session
        const tone = spriteHex(child.state === "waiting" ? INK.warn : modelColor(child.model, child.provider))
        const busy = child.state === "working"
        const theta = busy ? (this.theta.get(child.id) ?? 0) * 0.35 + slot * 2.4 : Math.PI * 1.3 + slot * 0.2
        const at = onRing(core.Rm, theta)
        const wrote = child.turn?.out ?? child.lastOut ?? 0
        const minis = wrote >= 250 ? clamp(1 + Math.floor(Math.log2(wrote / 250)), 1, 8) : 0
        const turnBy = busy ? (this.theta.get(child.id) ?? 0) * 0.8 : slot
        for (let mini = 0; mini < minis; mini += 1) {
          const angle = turnBy + (mini / minis) * TAU
          const lift = Math.sin(angle)
          out.push({ key: `moon:${child.id}.${mini}`, kind: `${lift > 0.3 ? "f4" : lift > -0.3 ? "f3" : "f2"}|${tone}`, x: at.x + Math.cos(angle) * u(17), y: at.y + lift * u(8), z: lift > 0 ? 14 : 8 })
        }
        out.push({ key: `moon:${child.id}`, kind: `moon|${tone}`, x: at.x, y: at.y, z: 10 })
        this.moons.push({ sid: child.id, x: at.x, y: at.y })
        slot += 1
      }
    }
    if (this.ripples?.length) {
      this.ripples = this.ripples.filter((entry) => now - entry.at < 620)
      for (const entry of this.ripples) {
        const age = now - entry.at
        if (age >= 0) out.push({ key: `rp:${entry.at}:${Math.round(entry.x)}`, kind: `${age < 210 ? "ring" : "ring2"}|${entry.hex}`, x: entry.x, y: entry.y })
      }
    }
    // a pane that waits on the operator rings on the sector map as its row does: an amber breath
    for (const hit of this.hits.get("footer") ?? []) {
      if (hit.kind !== "blip" || hit.pane?.status !== "blocked") continue
      const level = Math.floor(((Math.sin(now / 220) + 1) / 2) * 3.999)
      if (level) out.push({ key: `bp:${hit.id}`, kind: `breath${level}|${INK.warn}`, x: hit.rect.x + hit.rect.w / 2, y: hit.rect.y + hit.rect.h / 2 })
    }
    // Comms: a flag that needs you now breathes red on its marker until it is dealt with or muted
    // (a call has its own ring: the level meter in its box).
    for (const [key, mark] of this.commsMarks ?? []) {
      if (mark.level !== "alert" || mark.muted || mark.call) continue
      const level = Math.floor(((Math.sin(now / 260) + 1) / 2) * 3.999)
      if (level) out.push({ key: `cm:${key}`, kind: `breath${level}|${INK.bad}`, x: mark.x, y: mark.y })
    }
    // The log: a running call's head runs along the track under its line. It reaches the tick
    // when the call has run as long as its equipment usually takes, turns amber there, and
    // stops at the end of the track (at 1 / LOG_USUAL_AT times the usual).
    for (const mark of this.logMarks ?? []) {
      if (!mark.track) continue
      const elapsed = now - mark.start
      const share = Math.min(1, (elapsed / mark.track.usual) * LOG_USUAL_AT)
      out.push({ key: `lg:${mark.key}`, kind: `dot|${elapsed > mark.track.usual ? INK.warn : INK.live}`, x: mark.track.x0 + (mark.track.x1 - mark.track.x0) * share, y: mark.track.y })
    }
    // A flag in comms or a line of the log points at what it is about while the pointer (or a
    // pin) is on it: a ring on its thread's cell body, on its pane in the sector map and, for a
    // tool call, on the equipment it went through.
    const pointing = [ui.hover, ui.pinned?.target].find((target) => target && (target.kind === "alert" || target.kind === "log"))
    if (pointing && !ui.help) {
      const sid = pointing.sid ?? pointing.alert?.sid ?? pointing.entry?.sid
      const row = sid ? G.rowOf.get(sid) : null
      if (row) out.push({ key: "link-row", kind: `ring2|${INK.text}`, x: row.somaX, y: row.axonY, top: true })
      const blip = sid ? this.blipOf(sid) : null
      if (blip) out.push({ key: "link-pane", kind: `ring|${INK.text}`, x: blip.x, y: blip.y, top: true })
      const box = pointing.entry?.port ? G.ports.get(pointing.entry.port) : null
      if (box) out.push({ key: "link-port", kind: `ring2|${INK.text}`, x: box.x, y: box.y, top: true })
    }    this.terrainSprites(scene, now, out, ui)
    // the inspection card follows its mark, tied to it by a leader
    this.layCard(scene, ui, now)
    // explain mode: a ring on the one mark each tag is about
    if (ui.explain && !ui.help) (this.explainAnchors ?? []).forEach((anchor, index) => out.push({ key: `ex${index}`, kind: `ring|${INK.live}`, x: anchor.x, y: anchor.y, top: true }))
    // the reticles: focus (cyan) and pointer (white) ease from one target to the next
    const g = G.rowOf.get(scene.focus.id)
    this.track("focus", g ? { x: g.somaX - g.r - u(11), y: g.axonY - g.r - u(11), w: (g.r + u(11)) * 2, h: (g.r + u(11)) * 2 } : null, INK.live, 14, out)
    const hover = ui.hover && ui.hover.kind !== "overlay" && !ui.help ? ui.hover.rect : null
    this.track("hover", hover ? { x: hover.x - u(3), y: hover.y - u(3), w: hover.w + u(6), h: hover.h + u(6) } : null, INK.text, 26, out, true)
    // the phase: chevrons march along the header's lower edge while something needs the operator
    if (scene.phase.level === "alert") {
      const y = G.header.h - u(7)
      const gap = u(96)
      const shift = ((now / 1000) * u(80)) % gap
      for (let x = G.M + shift, index = 0; x < this.W - G.M; x += gap, index += 1) out.push({ key: `chev${index}`, kind: `chev|${INK.bad}`, x, y })
    } else if (scene.phase.level === "normal" && this.lamp) {
      const level = Math.floor(((Math.sin((now / 6000) * TAU) + 1) / 2) * 3.999)
      if (level) out.push({ key: "lamp", kind: `breath${level}|${INK.live}`, x: this.lamp.x, y: this.lamp.y })
    }
    // a call rings in the comms panel: the longer it has waited, the taller it rings
    if (this.codec && scene.calls.length) {
      const waited = now - scene.calls[0].since
      const top = clamp(2 + Math.floor(waited / 120e3), 2, 6)
      for (let column = 0; column < 7; column += 1) {
        const height = Math.max(1, Math.round(((Math.sin(now / 170 + column * 0.85) + 1) / 2) * top))
        for (let level = 0; level < height; level += 1) out.push({ key: `lv${column}.${level}`, kind: `seg|${INK.warn}`, x: this.codec.x + column * u(18), y: this.codec.y - level * u(8), top: true })
      }
    }
    for (const flash of ui.flashes ?? []) if (now - flash.at < 240) out.push({ key: `click${flash.at}`, kind: `glow2|${INK.text}`, x: flash.x, y: flash.y, top: true })
    if (this.occluders.length) {
      let keep = 0
      for (const sprite of out) {
        if (!sprite.top && this.occluders.some((rect) => inside(rect, sprite.x, sprite.y))) continue
        out[keep++] = sprite
      }
      out.length = keep
    }
    if (this.card) {
      // nothing rides over the card except its own leader
      const rect = { x: this.card.left, y: this.card.top, w: this.card.w, h: this.card.h }
      let keep = 0
      for (const sprite of out) {
        if (sprite.top && inside(rect, sprite.x, sprite.y)) continue
        out[keep++] = sprite
      }
      out.length = keep
      this.leadSprites(out)
    }
  }

  // Four corner sprites that chase a rectangle. `rate` is how eagerly (per second).
  track(name, target, hex, rate, out, top = false) {
    let state = this.reticle[name]
    if (!target) {
      this.reticle[name] = null
      return
    }
    if (!state) state = this.reticle[name] = { ...target }
    const k = 1 - Math.exp(-rate * this.dt)
    for (const key of ["x", "y", "w", "h"]) {
      state[key] += (target[key] - state[key]) * k
      if (Math.abs(target[key] - state[key]) < 0.5) state[key] = target[key]
    }
    const x0 = state.x + 6.5
    const y0 = state.y + 6.5
    const x1 = state.x + state.w - 6.5
    const y1 = state.y + state.h - 6.5
    out.push({ key: `${name}A`, kind: `cornerA|${hex}`, x: x0, y: y0, top }, { key: `${name}B`, kind: `cornerB|${hex}`, x: x1, y: y0, top }, { key: `${name}C`, kind: `cornerC|${hex}`, x: x1, y: y1, top }, { key: `${name}D`, kind: `cornerD|${hex}`, x: x0, y: y1, top })
  }

  get easing() {
    for (const name of ["focus", "hover"]) {
      const state = this.reticle[name]
      if (state && state.moving) return true
    }
    return false
  }

  comet(out, key, x, y, radius, theta, hex, tail, step, big = false) {
    out.push({ key, kind: `${big ? "pulse" : "dot"}|${hex}`, x: x + Math.cos(theta) * radius, y: y + Math.sin(theta) * radius })
    for (let segment = 1; segment <= tail; segment += 1) {
      const angle = theta - segment * step
      out.push({ key: `${key}.${segment}`, kind: `${segment <= Math.ceil(tail / 2) ? "tail" : "mote"}|${hex}`, x: x + Math.cos(angle) * radius, y: y + Math.sin(angle) * radius })
    }
  }

  // A ripple: two rings that run outward from a point, 0.6 s.
  ripple(x, y, hex, at) {
    this.ripples ??= []
    if (this.ripples.length < 40) this.ripples.push({ x, y, hex, at })
  }

  // Where a thread's pane stands on the sector map: the middle of its square, or null.
  blipOf(sid) {
    for (const hit of this.hits.get("footer") ?? []) {
      if (hit.kind === "blip" && hit.pane?.sessionId === sid) return { x: hit.rect.x + hit.rect.w / 2, y: hit.rect.y + hit.rect.h / 2 }
    }
    return null
  }

  // Turns what just happened into pulses, and what is in flight into streams.
  react(scene, signals, now) {
    const G = this.G
    const flow = this.flow
    const u = (value) => this.u(value)
    for (const signal of signals) {
      // A flag that is raised arrives in comms last: after the ripple from its thread (now) and
      // the one at the phase lamp (a quarter of a second later), a ripple and a flash on its
      // own line, half a second after it was raised.
      if (signal.type === "alarm") {
        const mark = signal.key ? this.commsMarks?.get(signal.key) : null
        const tone = signal.level === "alert" ? INK.bad : signal.level === "caution" ? INK.warn : INK.text
        if (mark) {
          this.ripple(mark.x, mark.y, tone, now + 520)
          flow.flash(mark.x, mark.y, tone, now + 520, 700)
        }
      }
      // The log answers a tool call that comes back: a flash at the end of its line, in the
      // equipment's colour, red when it failed.
      if (signal.type === "tool-end") {
        const mark = (this.logMarks ?? []).find((entry) => entry.key === signal.tool?.id)
        if (mark) flow.flash(mark.x1 - u(16), mark.y, signal.failed ? INK.bad : spriteHex(PORT_COLOR[signal.port]), now, 420)
      }
      if (signal.type === "alarm" && !signal.sid) {
        for (const rail of G.rails) flow.flash(rail.x, G.railBottom + u(20), LEVEL_COLOR[signal.level] === INK.soft ? INK.text : LEVEL_COLOR[signal.level], now, 900)
        continue
      }
      // The sector map answers too: the pane of the thread lights up in the model's colour when
      // one of its calls reports, cyan when a turn starts, green when it ends, amber when it
      // starts to wait on the operator, red when a tool call or the turn fails.
      const blip = signal.sid ? this.blipOf(signal.sid) : null
      if (blip) {
        const owner = scene.byId.get(signal.sid)
        const tone =
          signal.type === "tokens" && owner ? spriteHex(modelColor(owner.model, owner.provider))
          : signal.type === "tool-end" && signal.failed ? INK.bad
          : signal.type === "turn-end" ? (signal.failed ? INK.bad : INK.good)
          : signal.type === "turn-start" ? INK.live
          : signal.type === "wait" ? INK.warn
          : null
        if (tone) flow.flash(blip.x, blip.y, tone, now, signal.type === "turn-end" ? 900 : 420)
      }
      // the focused thread's call also travels its branch of REACH, to what it touches
      if (signal.type === "tool-start" || signal.type === "tool-end") this.reachReact(scene, signal, now, PACKET[signal.port] ?? "pulse")
      const g = G.rowOf?.get(signal.sid)
      if (!g) continue
      const session = g.row.session
      const hex = spriteHex(modelColor(session.model, session.provider))
      const tailKind = `tail|${hex}`
      if (signal.type === "call") {
        flow.pulse({ path: `in:${signal.sid}`, kind: `pulse|${hex}`, tailKind, tail: 6, speed: u(1300), flash: hex, now })
      } else if (signal.type === "tokens") {
        // what it wrote goes up to the instrument, what it cost runs back down the rail
        const count = clamp(Math.ceil(signal.tokens / 500), 1, 6)
        for (let index = 0; index < count; index += 1) flow.pulse({ path: `focus:${signal.sid}`, kind: `dot|${hex}`, tailKind: `mote|${hex}`, tail: 2, speed: u(1100), delay: index * 70, now })
        flow.pulse({ path: `spend:${signal.sid}`, kind: `dot|${INK.text}`, tailKind: `mote|${INK.text}`, tail: 3, speed: u(700), delay: 160, ease: "out", now })
      } else if (signal.type === "tool-start") {
        const tone = spriteHex(PORT_COLOR[signal.port])
        if (signal.port === "agent" && this.childOf(scene, signal.sid)) continue
        flow.flash(g.somaX, g.axonY, tone, now, 200) // the cell gathers itself, then lets go
        flow.pulse({ path: `out:${signal.sid}:${signal.port}`, kind: `${PACKET[signal.port] ?? "pulse"}|${tone}`, tailKind: `tail|${tone}`, tail: 6, speed: u(1300), delay: 90, flash: tone, now })
      } else if (signal.type === "tool-end") {
        const tone = signal.failed ? INK.bad : spriteHex(PORT_COLOR[signal.port])
        if (signal.port === "agent" && this.childOf(scene, signal.sid)) continue
        // the result comes back as the same sign; a failure comes back red and its equipment flashes
        flow.pulse({ path: `back:${signal.sid}:${signal.port}`, kind: `${PACKET[signal.port] ?? "pulse"}|${tone}`, tailKind: `tail|${tone}`, tail: 6, speed: u(1300), delay: 120, flash: tone, now })
        const box = signal.failed ? G.ports.get(signal.port) : null
        if (box) {
          flow.flash(box.x + G.boxW / 2, box.y, INK.bad, now, 520)
          flow.flash(box.x, box.y, INK.bad, now + 140, 420)
        }
      } else if (signal.type === "speak") {
        const count = clamp(Math.ceil(signal.chars / 320), 1, 5)
        for (let index = 0; index < count; index += 1) flow.pulse({ path: `out:${signal.sid}:you`, kind: `dot|${INK.text}`, tailKind: `mote|${INK.text}`, tail: 3, speed: u(1000), delay: index * 110, now })
      } else if (signal.type === "turn-start") {
        if (!g.row.parent) flow.pulse({ path: `back:${signal.sid}:you`, kind: `pulse|${INK.text}`, tailKind: `tail|${INK.text}`, tail: 6, speed: u(1200), flash: hex, now })
      } else if (signal.type === "turn-end") {
        flow.flash(g.somaX, g.axonY, signal.failed ? INK.bad : INK.good, now, 900)
      } else if (signal.type === "dispatch") {
        flow.pulse({ path: `kid:${signal.sid}`, kind: `pulse|${PORT_COLOR.agent}`, tailKind: `tail|${PORT_COLOR.agent}`, tail: 6, speed: u(600), flash: hex, now })
      } else if (signal.type === "report") {
        const tone = signal.failed ? INK.bad : INK.good
        flow.pulse({ path: `kidback:${signal.sid}`, kind: `pulse|${tone}`, tailKind: `tail|${tone}`, tail: 6, speed: u(600), flash: tone, now })
      } else if (signal.type === "wait") {
        flow.pulse({ path: `out:${signal.sid}:you`, kind: `pulse|${INK.warn}`, tailKind: `tail|${INK.warn}`, tail: 6, speed: u(800), flash: INK.warn, now })
      } else if (signal.type === "alarm") {
        const tone = signal.level === "alert" ? INK.bad : signal.level === "caution" ? INK.warn : INK.text
        flow.flash(g.somaX, g.axonY, tone, now, 1100)
        // The phase strip changed because of this thread: a ripple leaves its cell body, and a
        // moment later one arrives at the strip's lamp, so cause and effect are seen together.
        this.ripple(g.somaX, g.axonY, tone, now)
        if (this.lamp) this.ripple(this.lamp.x, this.lamp.y, tone, now + 260)
      }
      // a failed tool call ripples from its thread in red
      if (signal.type === "tool-end" && signal.failed) this.ripple(g.somaX, g.axonY, INK.bad, now)
    }
    // A line that is new in the log lights up where it begins, in its own tone.
    const logged = new Set()
    for (const mark of this.logMarks ?? []) {
      logged.add(mark.key)
      if (this.logKnown && !this.logKnown.has(mark.key) && now - mark.start < 10e3) flow.flash(mark.x, mark.y, spriteHex(mark.tone), now, 520)
    }
    if (scene.primed) this.logKnown = logged
    const streams = []
    this.reachStreams(scene, streams)
    for (const stream of scene.streams) {
      if (stream.type === "tool") streams.push({ key: stream.key, path: `syn:${stream.sid}:${stream.port}`, kind: `tail|${spriteHex(PORT_COLOR[stream.port])}`, speed: u(64), gap: u(34) })
      else if (stream.type === "kid") streams.push({ key: stream.key, path: `kid:${stream.sid}`, kind: `tail|${PORT_COLOR.agent}`, speed: u(40), gap: u(26) })
      else if (stream.type === "wait") streams.push({ key: stream.key, path: `syn:${stream.sid}:you`, kind: `tail|${INK.warn}`, speed: u(30), gap: u(46) })
    }
    // Wires with volume. A working thread's words ride its axon as a stream of motes, denser the
    // faster it writes (one every 180, 104, 66 or 44 px for under 15, 15 to 40, 40 to 80 and over
    // 80 tokens a second); the focused thread's stream also runs up into its flock. An account
    // that is being drawn on drains: motes sink through its reservoir, closer together the
    // further its burn is above an even pace.
    // The stream is made to be seen from across the room: solid motes, every fourth one a
    // glowing head, and the focused thread's feed into its flock all glowing heads. A working
    // thread whose rate is not known (no call of it reported in the last 45 s) still shows that
    // it works: a thin, faint stream, the sparsest there is.
    for (const g of G.rows) {
      if (!g.row || g.row.session.state !== "working") continue
      const rate = scene.rateOf(g.sid, now)
      const hex = spriteHex(modelColor(g.row.session.model, g.row.session.provider))
      if (!rate) {
        streams.push({ key: `tok:${g.sid}`, path: `axon:${g.sid}`, kind: `mote|${hex}`, speed: u(70), gap: u(240) })
        continue
      }
      const gap = u(rate >= 80 ? 44 : rate >= 40 ? 66 : rate >= 15 ? 104 : 180)
      streams.push({ key: `tok:${g.sid}`, path: `axon:${g.sid}`, kind: `tail|${hex}`, speed: u(110), gap })
      streams.push({ key: `tokh:${g.sid}`, path: `axon:${g.sid}`, kind: `dot|${hex}`, speed: u(110), gap: gap * 4 })
      if (g.sid === scene.focus.id) streams.push({ key: `feed:${g.sid}`, path: `focus:${g.sid}`, kind: `dot|${hex}`, speed: u(150), gap })
    }
    for (const rail of G.rails ?? []) {
      const account = scene.world.accounts.find((candidate) => candidate.name === rail.name)
      if (!account || account.left === null || account.left === undefined || account.left <= 0) continue
      if (!scene.world.sessions.some((session) => session.account === rail.name && session.state === "working")) continue
      const top = G.railBottom - Math.round((G.railBottom - G.railTop) * clamp(account.left / 100, 0, 1))
      flow.setPath(`drain:${rail.name}`, [[rail.x, top + u(6)], [rail.x, G.railBottom - u(2)]])
      const pace = account.pace ?? 1
      streams.push({ key: `drain:${rail.name}`, path: `drain:${rail.name}`, kind: `mote|${INK.text}`, speed: u(34), gap: u(pace >= 2 ? 22 : pace >= 1 ? 36 : 64) })
    }
    flow.setStreams(streams, now)
  }

  childOf(scene, sid) {
    return scene.threads.some((row) => row.parent?.session.id === sid && row.session.state === "working")
  }

  // ---------------------------------------------------------------- output

  // The frame as one opaque picture: the still layer and the sprites over the pane's own colour.
  flatten(background, sprites, atlas) {
    const canvas = createCanvas(this.W, this.H)
    const context = canvas.getContext("2d")
    context.fillStyle = background
    context.fillRect(0, 0, this.W, this.H)
    // as on screen: sprites behind the still layer, the still layer, sprites in front of it
    const stacked = sprites.map((sprite, order) => ({ sprite, order, z: sprite.top ? 99 : sprite.under ? (sprite.z ?? 0) - 50 : (sprite.z ?? 0) })).sort((a, b) => a.z - b.z || a.order - b.order)
    for (const { sprite } of stacked) if (sprite.under) atlas.draw(context, sprite.kind, sprite.x, sprite.y)
    context.drawImage(this.canvas, 0, 0)
    for (const { sprite } of stacked) if (!sprite.under && !sprite.top) atlas.draw(context, sprite.kind, sprite.x, sprite.y)
    if (this.card) context.drawImage(this.card.canvas, this.card.padX, this.card.padY, this.card.w, this.card.h, this.card.left, this.card.top, this.card.w, this.card.h)
    for (const { sprite } of stacked) if (sprite.top) atlas.draw(context, sprite.kind, sprite.x, sprite.y)
    return canvas
  }
}

// the sign a tool call travels as, by the equipment it goes to
const PACKET = { exec: "pkexec", read: "pkread", write: "pkwrite", web: "pkweb", agent: "pkagent", other: "pkother" }

Object.assign(Renderer.prototype, stage, circuit, hud, terrain, card, charts, reach)
