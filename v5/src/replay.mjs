// A held moment, replayed. A drag along the terrain holds one moment of its window (see
// terrain.mjs). While it is held the stage does not show the focused thread as it is now but as
// it stood then: the turn clock with the calls made by then, the context ring where the context
// stood, the flock with the output written by then and in the formation of what was open, the
// prompt cache, THIS TURN, REACH, the three charts, the live text and the subagent moons, and
// the wires streaming at each thread's rate of that moment. All of it is drawn as the past: the
// still layer at about half strength, every moving mark in one grey, and a THEN tag with the
// time. Letting the moment go (escape) brings the present back: the flock of then flies off and
// the flock of now gathers.
//
// Two times on one screen. A held moment is the past on the whole stage, and nowhere else: the
// circuit's rows, the accounts, the equipment, comms, the sector map, the log and the header
// stay the present, and each says so with a NOW chip beside its label for as long as the
// moment is held. A card follows its mark: one opened on the stage reads the moment (its
// kicker begins THEN and its first line says as of when), one opened elsewhere says NOW.
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
      } else {
        // a block of thinking or of reply that had not ended by then: how much of it stood at
        // that moment is not kept (only its final words are), so it is named, not quoted
        const ended = item.end !== null && item.end !== undefined && item.end <= at
        items.push(ended ? item : { ...item, end: null, text: "", length: 0, pending: true })
      }
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
  // where the context stood: the newest reading by then, and whether that reading was taken
  // at its own call (from the transcript) or is the figure of a turn's end
  let context = 0
  let contextFrom
  for (const step of steps) {
    if (step.ctx > 0) {
      context = step.ctx
      contextFrom = step.ctxFrom === "transcript" ? "transcript" : undefined
    }
  }
  // the live text as it stood: what the newest calls by then had thought, said and run
  const tail = []
  for (const step of steps.slice(-5)) for (const item of step.items) if (item.kind === "tool" || item.text || item.pending) tail.push(item)
  // the message that started the turn of then
  let prompt = ""
  for (const mark of marks) if (mark.kind === "user" && mark.text) prompt = mark.text
  // The prompt cache then: touched when the newest model call by then went out. Its lifetime is
  // the one known now (measured from the transcript's newest writing call, or assumed): what
  // it was at that moment is not kept apart. With no call kept from before the moment, when it
  // was last touched is not known.
  let cache = session.cache
  if (cache && cache.lifetime && !cache.empty) {
    const touched = steps.length ? steps[steps.length - 1].start : 0
    cache = touched ? { ...cache, at: touched, tokens: context || 0, then: true } : { ...cache, lifetime: 0, unkept: true, then: true }
  }
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
    context: { used: context, limit: session.context.limit, from: contextFrom },
    tail: tail.slice(-14),
    prompt,
    cache,
    // not kept for a past moment: opencode records one running total of each, and the flags
    // of then were raised from a state that is gone
    cost: 0,
    tokens: null,
    lastTurn: null,
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
    // every thread as it stood then, cut from its own record the first time it is asked for
    const sessions = new Map([[session.id, session]])
    const byId = {
      get: (sid) => {
        let view = sessions.get(sid)
        if (!view) {
          const real = scene.byId.get(sid)
          if (!real) return undefined
          view = sessionAt(real, at)
          sessions.set(sid, view)
        }
        return view
      },
      has: (sid) => scene.byId.has(sid),
    }
    // (the scene's own `focused` is a getter: the stand-in's is set over it, on the stand-in only)
    Object.defineProperty(then, "focused", { value: { ...focus, session } })
    Object.defineProperty(then, "byId", { value: byId })
    Object.defineProperty(then, "rateOf", { value: (sid) => (sid === session.id ? rate : this.thenRate(sid, at)) })
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

  // Where the NOW chip of the part being painted goes: called by the part where it draws its
  // section label, with the place right after what stands on that line.
  nowHere(x, y, align = "left") {
    this.nowSpot = { x, y, align }
  },

  // The chip that names the present on a part that a held moment does not replay. While a
  // moment is held the screen shows two times: the stage is then (dimmed, grey, under its THEN
  // tag) and every other part is now, and says so here.
  nowChip(c, region, at) {
    const u = (value) => this.u(value)
    const spot = this.nowSpot
    const circuit = region.name === "top"
    const word = circuit ? "NOW  ·  GREY MOTES: THEN" : "NOW"
    const w = this.chip(c, word, spot.x, spot.y, { color: INK.live, align: spot.align })
    const then = new Date(at).toTimeString().slice(0, 8)
    this.note(`now:${region.name}`, { x: spot.align === "right" ? spot.x - w : spot.x, y: spot.y - u(16), w, h: u(22) }, "NOW", "this part shows the present", [
      ["WHY", `a moment is held on the terrain (${then}). The stage above shows the focused thread as it stood then; this part is not replayed and shows now`, undefined, "wrap"],
      ...(circuit ? [["GREY MOTES", "the motes on the wires are the one thing here that is then: each thread's stream at its rate of the held moment, in grey. The rows, their figures and their timers are now", undefined, "wrap"]] : []),
      ["BACK", "escape lets the moment go, and every part is now again"],
    ], INK.live)
  },

  // The tag that names the past on a part of the stage: "THEN 08:12:30".
  thenTag(c, rect, at, corner) {
    const u = (value) => this.u(value)
    // a moment before anything this program keeps of the thread: the stage is empty because
    // nothing is known of it, not because the thread did nothing, and the tag says so
    const bare = !(this.thenKept?.session.steps.length > 0)
    const word = `THEN  ${new Date(at).toTimeString().slice(0, 8)}${bare ? "  ·  NOTHING KEPT OF IT" : ""}`
    const right = corner === "right"
    const x = right ? rect.x + rect.w - u(18) : rect.x + this.G.M
    const y = rect.y + (corner === "top" ? u(26) : rect.h - u(14))
    const w = this.chip(c, word, x, y, { color: INK.text, solid: true, align: right ? "right" : "left", size: 12 })
    this.note("then", { x: right ? x - w : x, y: y - u(17), w, h: u(22) }, "THEN", `the stage shows ${new Date(at).toTimeString().slice(0, 8)}, not now`, [
      ["WHAT", "a moment held on the terrain. The turn clock, the context ring, the flock and the wires show the focused thread as it stood then: the calls made by then, what was open, where its context was, how fast it wrote"],
      ["MARKED", "the still parts at half strength, every moving mark in one grey, and this tag"],
      ["FROM", "the thread's own record of its calls, cut at that moment. A call that reported no count is read from its text (an estimate); the rate is the terrain's slice"],
      ["BACK", "escape lets the moment go: the flock of then flies off and the flock of now gathers"],
      ...(bare ? [["NOTHING KEPT", "this moment lies before the calls this program keeps of the thread (the terrain's widest window, or the turn that runs now): the empty stage means not known, not idle", INK.warn]] : []),
    ])
  },
}
