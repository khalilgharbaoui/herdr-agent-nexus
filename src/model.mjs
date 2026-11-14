// The scene: which sessions become lanes and in what order, what changed since the last poll
// (the event log and the pulses), and the numbers the header shows.

const STALL_AFTER = 5 * 60e3
const QUIET_LANES = 8
const RATE_WINDOW = 5 * 60e3

export function lastActivity(session) {
  let last = Math.max(session.busySince || 0, session.idleSince || 0)
  for (const step of session.steps) {
    last = Math.max(last, step.end ?? step.streamed ?? step.start)
    for (const tool of step.tools) last = Math.max(last, tool.end ?? tool.start)
  }
  return last
}

export function stateOf(session, now) {
  if (session.blocked) return "waiting"
  if (session.busy) {
    const newest = session.steps[session.steps.length - 1]
    const open = newest && (newest.end === null || newest.tools.some((tool) => tool.end === null))
    if (open || session.paneStatus === "working" || now - lastActivity(session) < STALL_AFTER) return "working"
    return "stalled"
  }
  return session.outcome === "failed" ? "failed" : "idle"
}

export class Scene {
  constructor() {
    this.world = null
    this.lanes = []
    this.hidden = 0
    this.capacity = 14
    this.windowMs = 8 * 60e3
    this.rank = new Map()
    this.serial = 0
    this.log = []
    this.pulses = []
    this.seen = new Map()
    this.outSamples = []
    this.counts = { working: 0, waiting: 0, idle: 0, stalled: 0, panes: 0 }
    this.waiting = []
    this.tools = []
    this.primed = false
  }

  ingest(world, now) {
    this.world = world
    const byId = new Map(world.sessions.map((session) => [session.id, session]))
    for (const session of world.sessions) {
      let cursor = session
      let depth = 0
      while (cursor.parentId && byId.has(cursor.parentId) && depth < 6) {
        cursor = byId.get(cursor.parentId)
        depth += 1
      }
      session.depth = depth
      session.rootId = cursor.id
      session.state = stateOf(session, now)
      session.last = lastActivity(session)
    }
    this.derive(world, byId, now)
    this.choose(world, byId, now)
    this.summarise(world, now)
    this.primed = true
  }

  note(entry) {
    this.log.unshift(entry)
    if (this.log.length > 80) this.log.length = 80
  }

  derive(world, byId, now) {
    if (!this.primed) {
      const seeds = []
      for (const session of world.sessions) {
        for (const step of session.steps) {
          for (const tool of step.tools) seeds.push({ key: tool.id, at: tool.start, sessionId: session.id, kind: "tool", name: tool.name, detail: tool.label, span: tool.end === null ? null : tool.end - tool.start, tone: tool.end === null ? "run" : tool.status === "error" ? "bad" : "plain", born: 0 })
        }
        for (const mark of session.marks) {
          if (mark.kind === "idle") seeds.push({ key: `${session.id}:${mark.at}`, at: mark.at, sessionId: session.id, kind: "end", name: mark.outcome === "failed" ? "failed" : mark.outcome === "interrupted" ? "interrupted" : "done", detail: session.title, span: null, tone: mark.outcome === "failed" ? "bad" : "ok", born: 0 })
        }
      }
      seeds.sort((a, b) => b.at - a.at)
      this.log = seeds.slice(0, 40)
    }
    const logged = new Map(this.log.map((entry) => [entry.key, entry]))
    for (const session of world.sessions) {
      const before = this.seen.get(session.id)
      const tools = new Map()
      for (const step of session.steps) {
        for (const tool of step.tools) {
          tools.set(tool.id, tool.status)
          const entry = logged.get(tool.id)
          if (entry) {
            if (entry.span === null && tool.end !== null) {
              entry.span = tool.end - tool.start
              entry.tone = tool.status === "error" ? "bad" : "plain"
              entry.settled = now
            }
          } else if (before && this.primed && !before.tools.has(tool.id)) {
            this.note({ key: tool.id, at: tool.start, sessionId: session.id, kind: "tool", name: tool.name, detail: tool.label, span: tool.end === null ? null : tool.end - tool.start, tone: tool.end === null ? "run" : tool.status === "error" ? "bad" : "plain", born: now })
          }
        }
      }
      const out = session.turn?.out ?? 0
      const steps = session.steps.length ? session.steps[session.steps.length - 1].seq : 0
      if (this.primed) {
        if (!before && session.parentId && now - session.created < 20e3) {
          this.note({ key: `${session.id}:spawn`, at: session.created, sessionId: session.id, kind: "spawn", name: "dispatch", detail: session.title, span: null, tone: "plain", born: now })
          this.pulses.push({ kind: "fork", sessionId: session.id, born: now })
        }
        if (before) {
          if (session.busy && !before.busy) this.note({ key: `${session.id}:turn:${session.busySince}`, at: now, sessionId: session.id, kind: "turn", name: "turn", detail: session.title, span: null, tone: "plain", born: now })
          if (!session.busy && before.busy) {
            const bad = session.outcome === "failed"
            this.note({ key: `${session.id}:end:${now}`, at: now, sessionId: session.id, kind: "end", name: bad ? "failed" : session.outcome === "interrupted" ? "interrupted" : "done", detail: session.title, span: before.turnStart ? now - before.turnStart : null, tone: bad ? "bad" : "ok", born: now })
            if (session.parentId) this.pulses.push({ kind: "join", sessionId: session.id, born: now })
          }
          if (session.blocked && !before.blocked) this.note({ key: `${session.id}:wait:${now}`, at: now, sessionId: session.id, kind: "wait", name: "waiting", detail: session.title, span: null, tone: "warn", born: now })
          const gained = out > before.out ? out - before.out : 0
          if (gained > 0) this.outSamples.push({ at: now, tokens: gained })
          if (session.busy && (gained > 0 || steps !== before.steps)) this.pulses.push({ kind: "rail", sessionId: session.id, account: session.account, born: now, weight: gained })
        }
      }
      this.seen.set(session.id, { busy: session.busy, blocked: session.blocked, tools, out, steps, turnStart: session.turn?.start ?? 0 })
    }
    for (const id of this.seen.keys()) if (!byId.has(id)) this.seen.delete(id)
    this.pulses = this.pulses.filter((pulse) => now - pulse.born < 2600)
    this.outSamples = this.outSamples.filter((sample) => now - sample.at < RATE_WINDOW)
  }

  choose(world, byId, now) {
    const score = (session) => {
      if (session.state === "working") return 4
      if (session.state === "waiting") return 3
      if (session.last > now - this.windowMs) return 2
      if (session.state === "stalled") return 1
      return 0
    }
    let candidates = world.sessions.filter((session) => score(session) > 0)
    if (!candidates.length) candidates = world.sessions.filter((session) => !session.parentId).sort((a, b) => b.updated - a.updated).slice(0, 5)
    candidates.sort((a, b) => score(b) - score(a) || b.last - a.last)
    const chosen = new Set()
    for (const session of candidates) {
      const chain = []
      let cursor = session
      while (cursor && !chosen.has(cursor.id)) {
        chain.push(cursor.id)
        cursor = cursor.parentId ? byId.get(cursor.parentId) : null
      }
      if (chosen.size + chain.length > this.capacity) continue
      for (const id of chain) chosen.add(id)
    }
    this.hidden = candidates.filter((session) => !chosen.has(session.id)).length
    // A quiet hour still shows the threads you were last in: open panes first, then the newest.
    if (chosen.size < Math.min(QUIET_LANES, this.capacity)) {
      const recent = world.sessions
        .filter((session) => !session.parentId && !chosen.has(session.id))
        .sort((a, b) => (b.pane ? 1 : 0) - (a.pane ? 1 : 0) || b.updated - a.updated)
      for (const session of recent) {
        if (chosen.size >= Math.min(QUIET_LANES, this.capacity)) break
        chosen.add(session.id)
      }
    }
    const roots = []
    const kids = new Map()
    for (const id of chosen) {
      const session = byId.get(id)
      if (session.parentId && chosen.has(session.parentId)) {
        const list = kids.get(session.parentId) ?? []
        list.push(session)
        kids.set(session.parentId, list)
      } else roots.push(session)
    }
    // A root keeps the place it was first given, so lanes do not jump around while you watch.
    for (const root of [...roots].sort((a, b) => score(b) - score(a) || b.last - a.last)) {
      if (!this.rank.has(root.id)) this.rank.set(root.id, (this.serial += 1))
    }
    for (const id of this.rank.keys()) if (!chosen.has(id)) this.rank.delete(id)
    roots.sort((a, b) => this.rank.get(a.id) - this.rank.get(b.id))
    const lanes = []
    const walk = (session, depth, parentLane) => {
      const lane = { session, depth, index: lanes.length, parent: parentLane }
      lanes.push(lane)
      for (const child of (kids.get(session.id) ?? []).sort((a, b) => a.created - b.created)) walk(child, depth + 1, lane)
    }
    for (const root of roots) walk(root, 0, null)
    this.lanes = lanes
  }

  summarise(world, now) {
    const laneOf = new Map(this.lanes.map((lane) => [lane.session.id, lane.index]))
    let working = 0
    let stalled = 0
    for (const session of world.sessions) {
      if (session.state === "working") working += 1
      if (session.state === "stalled") stalled += 1
    }
    const waiting = []
    let idle = 0
    for (const pane of world.panes) {
      pane.lane = pane.sessionId && laneOf.has(pane.sessionId) ? laneOf.get(pane.sessionId) : -1
      if (pane.status === "blocked") waiting.push(pane)
      else if (pane.status !== "working") idle += 1
    }
    waiting.sort((a, b) => (a.since || now) - (b.since || now))
    this.waiting = waiting
    this.counts = { working, waiting: waiting.length, idle, stalled, panes: world.panes.length }
    const stats = new Map()
    for (const session of world.sessions) {
      for (const step of session.steps) {
        for (const tool of step.tools) {
          if ((tool.end ?? now) < now - this.windowMs) continue
          const name = tool.name.replace(/^mcp__.+?__/, "")
          const entry = stats.get(name) ?? { name, count: 0, errors: 0, running: 0, spans: [] }
          entry.count += 1
          if (tool.status === "error") entry.errors += 1
          if (tool.end === null) {
            entry.running += 1
            entry.spans.push({ ms: now - tool.start, live: true })
          } else entry.spans.push({ ms: Math.max(1, tool.end - tool.start), bad: tool.status === "error" })
          stats.set(name, entry)
        }
      }
    }
    this.tools = [...stats.values()].sort((a, b) => b.count - a.count)
    // output tokens a minute, averaged over the last five (or over the time watched, when shorter)
    this.since ??= now
    const watched = Math.max(30e3, Math.min(RATE_WINDOW, now - this.since))
    this.outPerMinute = (this.outSamples.reduce((sum, sample) => sum + sample.tokens, 0) / watched) * 60e3
  }
}
