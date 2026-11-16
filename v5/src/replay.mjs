// A held moment, replayed. A drag along the terrain holds one moment of its window (see
// terrain.mjs). While it is held the stage does not show the focused thread as it is now but as
// it stood then: the turn clock with the calls made by then, the context ring where the context
// stood, the flock with the output written by then and in the formation of what was open, and
// the wires streaming at each thread's rate of that moment. All of it is drawn as the past: the
// still layer at about half strength, every moving mark in one grey, and a THEN tag with the
// time. Letting the moment go (escape) brings the present back: the flock of then flies off and
// the flock of now gathers.
//
// What is read: the thread's own steps, tool calls and marks, which this program keeps for the
// terrain's widest window (and for the whole of a running turn), cut at the held moment. What
// is estimated, as everywhere else: the output of a call that reported no count (from its text,
// 3.6 characters a token) and the rate (the terrain's slice at that moment).

import { lastActivity, phaseOf, portOf, stateOf, wroteOf } from "./model.mjs"
import { INK } from "./util.mjs"

export const THEN_INK = INK.dim // the one colour of every moving mark of a held moment

// The thread as it stood at `at`, in the shape the stage and the flock read.
export function sessionAt(session, at) {
  const steps = []
  for (const step of session.steps) {
    if (step.start > at) continue
    const open = step.end === null || step.end > at
    const tools = new Map()
    for (const tool of step.tools) {
      if (tool.start > at) continue
      tools.set(tool.id, tool.end === null || tool.end > at ? { ...tool, end: null, status: "running" } : tool)
    }
    const items = []
    for (const item of step.items) {
      if ((item.at ?? step.start) > at) continue
      if (item.kind === "tool") {
        const tool = tools.get(item.tool?.id)
        if (tool) items.push({ ...item, tool })
      } else items.push({ ...item, end: item.end !== null && item.end !== undefined && item.end <= at ? item.end : null })
    }
    steps.push({
      ...step,
      end: open ? null : step.end,
      streamed: step.streamed !== null && step.streamed <= at ? step.streamed : null,
      finish: open ? "" : step.finish,
      out: open ? 0 : step.out,
      tools: [...tools.values()],
      items,
      reasoning: step.reasoning.filter(([from]) => from <= at).map(([from, to]) => [from, to !== null && to <= at ? to : null]),
    })
  }
  // was a turn running then, and since when: the newest message of the user or end of a turn before it
  let busySince = 0
  let idleSince = 0
  let outcome = ""
  const marks = []
  for (const mark of session.marks) {
    if (mark.at > at) continue
    marks.push(mark)
    if (mark.kind === "user") {
      busySince = mark.at
      idleSince = 0
    } else if (mark.kind === "idle") {
      idleSince = mark.at
      outcome = mark.outcome ?? ""
    }
  }
  // a turn that runs now and began before the moment, with its first message older than what is kept
  if (!busySince && !idleSince && session.busy && session.busySince && session.busySince <= at) busySince = session.busySince
  // steps without a mark before them (a subagent's first turn): the turn began with the first
  if (!busySince && !idleSince && steps.length) busySince = steps[0].start
  const busy = busySince > 0 && !idleSince
  const own = steps.filter((step) => step.start >= (busySince || 0) - 2000)
  const wrote = Math.round(own.reduce((sum, step) => sum + (step.end === null ? 0 : wroteOf(step)), 0))
  let context = 0
  for (const step of steps) if (step.ctx > 0) context = step.ctx
  const view = {
    ...session,
    then: at,
    turnKey: `then:${busySince || idleSince || 0}`, // the flock of a held moment is its own flock
    steps,
    marks,
    busy,
    blocked: false,
    paneStatus: "",
    outcome: busy ? "" : outcome,
    busySince,
    idleSince: busy ? 0 : idleSince || steps[steps.length - 1]?.end || at,
    updated: at,
    turn: busy ? { start: busySince, out: wrote } : null,
    lastOut: wrote,
    context: { used: context, limit: session.context.limit },
    tail: [],
    alerts: [],
  }
  view.state = stateOf(view, at)
  view.last = lastActivity(view)
  view.phase = phaseOf(view)
  return view
}

// What a thread had open at `at`: a model call, and the equipment of every tool call that was out.
export function openAt(session, at) {
  const open = { call: false, ports: new Set() }
  for (const step of session.steps) {
    if (step.start > at) continue
    if (step.end === null || step.end > at) open.call = true
    for (const tool of step.tools) if (tool.start <= at && (tool.end === null || tool.end > at)) open.ports.add(portOf(tool.name))
  }
  return open
}

export const replay = {
  // The held moment as the stage reads it, or null when none is held: the time, the focused
  // thread as it stood then, its rate in that slice of the terrain, and a scene that hands
  // those out in place of the present.
  thenFor(scene, ui, now) {
    const at = this.scrubAt(ui)
    const focus = scene.focused
    if (at === null || !focus || ui.help) {
      this.thenKept = null
      return null
    }
    const kept = this.thenKept
    if (kept && kept.at === at && kept.world === scene.world && kept.sid === focus.session.id) return kept
    const session = sessionAt(focus.session, at)
    const ridge = this.terrainGeo?.ridges.find((entry) => entry.sid === focus.session.id)
    const rate = ridge ? (this.ridgeSpot(ridge, at)?.value ?? 0) : 0
    const then = Object.create(scene)
    // (the scene's own `focused` is a getter: the stand-in's is set over it, on the stand-in only)
    Object.defineProperty(then, "focused", { value: { ...focus, session } })
    Object.defineProperty(then, "rateOf", { value: (sid) => (sid === session.id ? rate : scene.rateOf(sid, now)) })
    Object.defineProperty(then, "then", { value: at })
    this.thenKept = { at, world: scene.world, sid: focus.session.id, session, rate, scene: then }
    return this.thenKept
  },

  // A thread's tokens a second at the held moment, from its ridge, and whether it had a model
  // call or a tool call open then.
  thenRate(sid, at) {
    const ridge = this.terrainGeo?.ridges.find((entry) => entry.sid === sid)
    return ridge ? (this.ridgeSpot(ridge, at)?.value ?? 0) : 0
  },

  // One grey for every moving mark of the past: the shape stays, the colour goes.
  thenKind(kind) {
    const cache = (this.thenKinds ??= new Map())
    let dim = cache.get(kind)
    if (!dim) {
      const bar = kind.indexOf("|")
      dim = bar < 0 ? kind : `${kind.slice(0, bar)}|${THEN_INK}`
      cache.set(kind, dim)
    }
    return dim
  },

  // The tag that names the past on a part of the stage: "THEN 08:12:30".
  thenTag(c, rect, at, corner) {
    const u = (value) => this.u(value)
    const word = `THEN  ${new Date(at).toTimeString().slice(0, 8)}`
    const right = corner === "right"
    const x = right ? rect.x + rect.w - u(18) : rect.x + this.G.M
    const y = rect.y + (corner === "top" ? u(26) : rect.h - u(14))
    const w = this.chip(c, word, x, y, { color: INK.text, solid: true, align: right ? "right" : "left", size: 12 })
    this.note("then", { x: right ? x - w : x, y: y - u(17), w, h: u(22) }, "THEN", `the stage shows ${new Date(at).toTimeString().slice(0, 8)}, not now`, [
      ["WHAT", "a moment held on the terrain. The turn clock, the context ring, the flock and the wires show the focused thread as it stood then: the calls made by then, what was open, where its context was, how fast it wrote"],
      ["MARKED", "the still parts at half strength, every moving mark in one grey, and this tag"],
      ["FROM", "the thread's own record of its calls, cut at that moment. A call that reported no count is read from its text (an estimate); the rate is the terrain's slice"],
      ["BACK", "escape lets the moment go: the flock of then flies off and the flock of now gathers"],
    ])
  },
}
