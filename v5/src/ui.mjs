// The controller: turns key and mouse events into what the operator meant. It owns the interface
// state the renderer reads (pointer, hover, inspection card, pin, help, monitor, zoom) and keeps
// a short log of the events it received in v5/input.json, so input can be checked without
// seeing the screen.
//
// The only thing it ever does outside this program is ask herdr to focus a pane, and only when
// the operator pressed or clicked for exactly that.

import { execFile } from "node:child_process"
import fs from "node:fs"
import { REGION_ORDER, REGION_WORD } from "./explain.mjs"
import { shortTarget } from "./hud.mjs"
import { inside } from "./theme.mjs"
import { WINDOWS } from "./terrain.mjs"
import { clockOf } from "./util.mjs"

const INSPECTABLE = new Set(["thread", "fold", "clock", "project", "port", "account", "blip", "tab", "tool", "step", "alert", "pane", "dot", "flock", "lean", "ridge", "terrain", "charge"])
const DWELL_MS = 140 // how long the pointer rests on something before its card opens
const GONE_MS = 8000 // no mouse report for this long: the pointer is taken to have left the pane
const MODE = { 0: "not known", 1: "on", 2: "off", 3: "always on", 4: "always off" }

export class Controller {
  constructor({ renderer, terminal, scene, actions, logFile }) {
    this.renderer = renderer
    this.terminal = terminal
    this.getScene = scene
    this.actions = actions
    this.logFile = logFile
    this.ui = { pointer: null, hover: null, hoverAt: 0, card: null, pinned: null, help: false, explain: false, walk: null, monitor: false, zoom: false, window: WINDOWS[1], tailScroll: 0, tip: "", flashes: [], info: {}, stamp: 0, activeUntil: 0 }
    this.counts = { keys: 0, moves: 0, clicks: 0, wheels: 0 }
    this.events = []
    this.dirty = false // the scene has to be rebuilt (a fold, a filter)
    this.stampAt = 0
    this.wrote = 0
  }

  get scene() {
    return this.getScene()
  }

  handle(event, now) {
    this.ui.activeUntil = now + 1500
    let did = ""
    if (event.type === "key") {
      this.counts.keys += 1
      did = this.key(event.key, now) ?? ""
    } else did = this.mouse(event, now) ?? ""
    this.record(event, did, now)
  }

  // Runs every frame: what is under the pointer may have moved, appeared or gone.
  refresh(now) {
    const ui = this.ui
    if (ui.flashes.length) ui.flashes = ui.flashes.filter((flash) => now - flash.at < 260)
    if (ui.pointer && now - ui.pointer.at > GONE_MS) {
      ui.pointer = null
      ui.hover = null
      ui.card = null
      ui.tip = ""
    }
    if (ui.walk && !ui.pointer) {
      // the keyboard is on a mark: stay on it, and follow it when it is a dot in flight
      const target = ui.walk.target
      const flock = this.renderer.flock
      if (target.kind === "dot" && flock.level[target.index]) {
        target.rect.x = flock.sx[target.index] - target.rect.w / 2
        target.rect.y = flock.sy[target.index] - target.rect.h / 2
      }
      ui.hover = target
      return
    }
    if (!ui.pointer || !this.scene.world) return
    const target = this.renderer.hitTest(ui.pointer.x, ui.pointer.y, this.scene, now)
    const same = target && ui.hover && target.kind === ui.hover.kind && target.id === ui.hover.id
    if (!same) {
      ui.hover = target
      ui.hoverAt = now
      ui.card = null
      ui.tip = target?.tip ?? this.tipFor(target)
    } else ui.hover.rect = target.rect
    if (ui.hover && !ui.card && INSPECTABLE.has(ui.hover.kind) && now - ui.hoverAt >= DWELL_MS) ui.card = { target: { ...ui.hover }, anchor: { x: ui.pointer.x, y: ui.pointer.y } }
  }

  tipFor(target) {
    if (!target) return ""
    return (
      {
        thread: "click: focus  ·  middle click: go to its pane",
        fold: "click: fold or open its subagents",
        project: "click: fold or open this project",
        port: "click: pin this card",
        account: "click: pin this card",
        blip: "click: focus its thread  ·  middle click: go to the pane",
        tool: "click: pin this call",
        step: "click: pin this call",
        alert: "click: focus the flagged thread",
        tail: "wheel: scroll the live tail",
        clock: "the turn clock: a bar under the ring is a model call, a pillar on it a tool call",
        dot: "one dot of the flock  ·  click: pin it",
        charge: "the charge at the tip: tokens gather here until they are one dot  ·  click: pin it",
        flock: "the flock: this turn's output  ·  click: pin its card",
        lean: "the axis: how far the body is tipped is how far the turn is past its usual length",
        ridge: "a point on a thread's ridge  ·  click: focus the thread, or pin the point",
        terrain: "the time terrain  ·  w: change the window",
      }[target.kind] ?? ""
    )
  }

  mouse(event, now) {
    const ui = this.ui
    const scene = this.scene
    ui.pointer = { x: event.x, y: event.y, at: now }
    ui.walk = null
    if (event.kind === "move" || event.kind === "drag") {
      this.counts.moves += 1
      this.refresh(now)
      return ""
    }
    if (!scene.world) return ""
    if (event.kind === "wheel") {
      this.counts.wheels += 1
      const G = this.renderer.G
      if (ui.help) return "help is open"
      if (inside(G.stage, event.x, event.y) && !G.wide ? true : inside(G.tail, event.x, event.y)) {
        ui.tailScroll = Math.max(0, ui.tailScroll - event.dy * 3)
        return `live tail scrolled to ${ui.tailScroll} lines back`
      }
      if (inside(G.circuit, event.x, event.y)) {
        this.renderer.scroll = Math.max(0, this.renderer.scroll + event.dy)
        return `threads scrolled to row ${this.renderer.scroll}`
      }
      return "nothing scrolls here"
    }
    if (event.kind !== "down") return ""
    this.counts.clicks += 1
    ui.flashes.push({ x: event.x, y: event.y, at: now })
    const target = this.renderer.hitTest(event.x, event.y, scene, now)
    return this.click(target, event, now)
  }

  click(target, event, now) {
    const ui = this.ui
    const scene = this.scene
    if (ui.help) {
      ui.help = false
      return "closed help"
    }
    if (!target) {
      if (ui.pinned) {
        ui.pinned = null
        return "let go of the pinned card"
      }
      return "nothing here"
    }
    const jump = event.button === "middle" || event.alt || event.ctrl
    switch (target.kind) {
      case "overlay":
        return "inside the card"
      case "action":
        return this.action(target.id, now)
      case "key":
        return this.key(target.id, now)
      case "thread":
        if (jump) return this.goto(this.paneOf(target.id))
        scene.lock(target.id, now)
        return `focused ${shortTarget(target, scene)}`
      case "fold":
      case "project":
        scene.toggle(target.id)
        this.dirty = true
        return `${scene.collapsed.has(target.id) ? "folded" : "opened"} ${target.kind === "project" ? "the project" : "the subtree"}`
      case "pane":
        return this.goto(target.id)
      case "blip": {
        if (jump) return this.goto(target.id)
        const pane = scene.paneOf.get(target.id)
        if (pane?.sessionId && scene.lock(pane.sessionId, now)) return "focused the thread on that pane"
        return this.pin(target)
      }
      case "answer": {
        const pane = this.paneOf(target.id)
        if (pane) return this.goto(pane)
        scene.lock(target.id, now)
        return "focused the caller"
      }
      case "alert": {
        const alert = scene.alerts.find((entry) => entry.key === target.id)
        if (alert?.sid && scene.lock(alert.sid, now)) return "focused the flagged thread"
        return this.pin(target)
      }
      case "ridge":
        if (target.sid !== scene.focus.id && scene.lock(target.sid, now)) return "focused the thread of that ridge"
        return this.pin(target)
      case "dot":
      case "charge":
      case "flock":
      case "lean":
      case "terrain":
      case "port":
      case "account":
      case "tool":
      case "step":
      case "tab":
      case "clock":
        return this.pin(target)
      default:
        return `nothing to do on ${target.kind}`
    }
  }

  // The keyboard's way to every mark: step through the inspectable things of one region, or
  // change region. The mark gets the pointer's brackets and its card, as if hovered.
  walk(step, regionStep, now) {
    const ui = this.ui
    const groups = this.renderer.walkTargets(this.scene)
    const names = REGION_ORDER.filter((name) => groups.get(name)?.length)
    if (!names.length) return "nothing to walk yet"
    let region = ui.walk && names.includes(ui.walk.region) ? ui.walk.region : names[0]
    let index = 0
    if (regionStep && ui.walk) region = names[(names.indexOf(region) + regionStep + names.length) % names.length]
    const list = groups.get(region)
    if (ui.walk && !regionStep && ui.walk.region === region) index = (ui.walk.index + step + list.length) % list.length
    const target = { ...list[index], rect: { ...list[index].rect } }
    ui.walk = { region, index, target }
    ui.pointer = null
    ui.hover = target
    ui.hoverAt = now
    ui.card = { target, anchor: { x: target.rect.x, y: target.rect.y } }
    ui.tip = `walking ${REGION_WORD[region]}: ${index + 1} of ${list.length}  ·  [ ] step  ·  { } region  ·  enter acts  ·  esc leaves`
    return `walk ${region} ${index + 1}/${list.length}: ${shortTarget(target, this.scene)}`
  }

  pin(target) {
    const ui = this.ui
    if (ui.pinned && ui.pinned.target.kind === target.kind && ui.pinned.target.id === target.id) {
      ui.pinned = null
      return "let go of the pinned card"
    }
    ui.pinned = { target: { ...target }, anchor: ui.pointer ? { x: ui.pointer.x, y: ui.pointer.y } : { x: target.rect.x, y: target.rect.y } }
    return `pinned ${target.kind} ${String(target.id).slice(0, 24)}`
  }

  paneOf(sid) {
    const scene = this.scene
    const session = scene.byId.get(sid)
    return session?.pane || scene.byId.get(session?.rootId)?.pane || ""
  }

  // The one outward action: ask herdr to bring a pane to the front. Nothing is typed into it.
  goto(paneId) {
    if (!paneId) return "this thread has no pane to go to"
    if (this.scene.world?.mode === "DEMO") return `demo: would go to pane ${paneId}`
    if (process.env.HERDR_ENV !== "1") return "not inside herdr: no pane to go to"
    execFile("herdr", ["agent", "focus", paneId], { timeout: 4000 }, () => {})
    return `went to pane ${paneId}`
  }

  action(id, now) {
    const ui = this.ui
    const scene = this.scene
    if (id === "follow") {
      scene.follow()
      return "following the action"
    }
    if (id === "lock") {
      scene.lock(scene.focus.id, now)
      return "holding this thread"
    }
    if (id === "filter") {
      scene.cycleFilter()
      this.renderer.scroll = 0
      this.dirty = true
      return `listing ${scene.filter}`
    }
    if (id.startsWith("window:")) {
      ui.window = Number(id.slice(7))
      return `terrain shows the last ${Math.round(ui.window / 60e3)} min`
    }
    if (id === "next-flag") return scene.nextAlert(1, now) ? "focused the next flagged thread" : "nothing is flagged"
    if (id === "unpin") {
      ui.pinned = null
      return "let go of the pinned card"
    }
    if (id === "close-help") {
      ui.help = false
      return "closed help"
    }
    return ""
  }

  key(key, now) {
    const ui = this.ui
    const scene = this.scene
    if (key === "q" || key === "ctrl-c") return this.actions.quit()
    if (key === "?") {
      ui.help = !ui.help
      return ui.help ? "opened help" : "closed help"
    }
    if (key === "escape") {
      if (ui.help) ui.help = false
      else if (ui.walk) {
        ui.walk = null
        ui.hover = null
        ui.card = null
        ui.tip = ""
      } else if (ui.explain) ui.explain = false
      else if (ui.pinned) ui.pinned = null
      else if (ui.tailScroll) ui.tailScroll = 0
      else return "nothing to close"
      return "closed"
    }
    if (ui.help) {
      ui.help = false
      return "closed help"
    }
    if (key === "d") return this.actions.demo()
    if (key === "p") return this.actions.transport()
    if (key === "s") return this.actions.snapshot()
    if (key === "i") {
      ui.monitor = !ui.monitor
      return ui.monitor ? "input monitor on" : "input monitor off"
    }
    if (key === "e") {
      ui.explain = !ui.explain
      return ui.explain ? "explaining every kind of mark in place" : "explanations off"
    }
    if (!scene.world) return ""
    if (key === "]" || key === "[") return this.walk(key === "]" ? 1 : -1, 0, now)
    if (key === "}" || key === "{") return this.walk(0, key === "}" ? 1 : -1, now)
    if (key === "enter" && ui.walk) return this.click(ui.walk.target, { button: "left" }, now)
    if (key === "w") return this.action(`window:${WINDOWS[(WINDOWS.indexOf(ui.window) + 1) % WINDOWS.length]}`, now)
    if (key === "z") {
      ui.zoom = !ui.zoom
      return ui.zoom ? "stage zoomed" : "stage at its usual size"
    }
    if (!scene.world) return ""
    if (key === "j" || key === "down") return this.moved(scene.moveFocus(1, now))
    if (key === "k" || key === "up") return this.moved(scene.moveFocus(-1, now))
    if (key === "h" || key === "left" || key === "l" || key === "right") {
      scene.step(key === "h" || key === "left" ? -1 : 1, now)
      this.dirty = true
      return this.moved()
    }
    if (key === "g" || key === "home") return this.moved(scene.focusIndex(0, now))
    if (key === "G" || key === "end") return this.moved(scene.focusIndex(scene.threads.length - 1, now))
    if (key >= "1" && key <= "9" && key.length === 1) return this.moved(scene.focusIndex(Number(key) - 1, now))
    if (key === "enter") return this.goto(this.paneOf(scene.focus.id))
    if (key === "tab" || key === "backtab") return scene.nextAlert(key === "tab" ? 1 : -1, now) ? "focused the next flagged thread" : "nothing is flagged"
    if (key === "c") {
      const call = scene.calls.find((alert) => !alert.muted)
      if (!call) return "no calls"
      const pane = this.paneOf(call.sid)
      if (pane) return this.goto(pane)
      scene.lock(call.sid, now)
      return "focused the caller"
    }
    if (key === "x") {
      const session = scene.focused?.session
      if (!session?.alerts.length) return "the focused thread is not flagged"
      for (const alert of session.alerts) scene.mute(alert.key)
      this.dirty = true
      return "muted or unmuted its flags"
    }
    if (key === "space") {
      const g = this.renderer.G.rowOf.get(scene.focus.id)
      if (!g) return "the focused thread is off screen"
      return this.pin({ kind: "thread", id: g.sid, rect: { x: this.renderer.G.railsRight, y: g.y, w: this.renderer.G.termX - this.renderer.G.railsRight, h: g.h } })
    }
    if (key === "a") {
      scene.follow()
      return "following the action"
    }
    if (key === "f") return this.action("filter", now)
    if (key === "pageup" || key === "pagedown") {
      ui.tailScroll = Math.max(0, ui.tailScroll + (key === "pageup" ? 6 : -6))
      return `live tail ${ui.tailScroll} lines back`
    }
    return `no binding for ${JSON.stringify(key)}`
  }

  moved() {
    const scene = this.scene
    this.ui.tailScroll = 0
    return `focus on ${scene.focused ? String(scene.focused.index + 1).padStart(2, "0") : "nothing"}`
  }

  // What the input monitor shows, and the log on disk.
  record(event, did, now) {
    const ui = this.ui
    const scene = this.scene
    const modes = this.terminal?.mouseModes ?? {}
    const info = ui.info
    info.modes = `any-event ${MODE[modes[1003]] ?? "not asked"}  ·  sgr ${MODE[modes[1006]] ?? "not asked"}  ·  pixels ${MODE[modes[1016]] ?? "not asked"}`
    const stamp = `${clockOf(now)}.${String(now % 1000).padStart(3, "0")}`
    const entry = { at: stamp, type: event.type }
    if (event.type === "key") {
      info.key = `${JSON.stringify(event.key)}  at ${stamp}`
      entry.key = event.key
    } else {
      info.mouse = `${event.kind}${event.button ? ` ${event.button}` : ""}${event.kind === "wheel" ? (event.dy < 0 ? " up" : " down") : ""}${event.alt ? " +alt" : ""}${event.ctrl ? " +ctrl" : ""}${event.shift ? " +shift" : ""}  at ${stamp}`
      info.at = `x ${event.x}  y ${event.y} px  ·  column ${event.col}  row ${event.row}`
      const target = event.kind === "move" || event.kind === "drag" ? ui.hover : this.renderer.hitTest(event.x, event.y, scene, now)
      info.hit = scene.world ? shortTarget(target, scene) : "nothing yet"
      Object.assign(entry, { kind: event.kind, button: event.button, x: event.x, y: event.y, col: event.col, row: event.row, hit: info.hit })
    }
    if (did) info.did = did
    entry.did = did
    info.seen = `${this.counts.keys} keys  ·  ${this.counts.moves} moves  ·  ${this.counts.clicks} clicks  ·  ${this.counts.wheels} wheel`
    const last = this.events[this.events.length - 1]
    if (entry.kind === "move" && last?.kind === "move") this.events[this.events.length - 1] = entry
    else this.events.push(entry)
    if (this.events.length > 80) this.events.splice(0, this.events.length - 80)
    if (now - this.stampAt > 90) {
      this.stampAt = now
      ui.stamp += 1
    }
    this.changed = true
  }

  // Called now and then by the loop: writes the log when something came in.
  flush(now) {
    if (!this.changed || !this.logFile || now - this.wrote < 400) return
    this.changed = false
    this.wrote = now
    try {
      fs.writeFileSync(this.logFile, JSON.stringify({ modes: this.terminal?.mouseModes ?? {}, pixels: this.terminal?.input.pixels ?? false, counts: this.counts, did: this.ui.info.did ?? "", events: this.events }, null, 1))
    } catch {}
  }
}
