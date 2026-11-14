// The scene: which sessions become rows and in what order, what just happened (signals for the
// moving layer), what is in flight right now (streams), who is in focus, and the header numbers.

import { toolMeta } from "./util.mjs"

const STALL_AFTER = 5 * 60e3
const QUIET_ROWS = 8
const RATE_WINDOW = 5 * 60e3

// What a model acts on. Every tool call goes to exactly one of these.
export const PORTS = [
  { id: "you", label: "YOU", note: "answers and questions" },
  { id: "exec", label: "SHELL", note: "commands" },
  { id: "read", label: "READ", note: "files and search" },
  { id: "write", label: "WRITE", note: "edits" },
  { id: "web", label: "WEB", note: "fetch and search" },
  { id: "agent", label: "AGENTS", note: "dispatches" },
  { id: "other", label: "OTHER", note: "todo, skills, mcp" },
]
const PORT_OF_KIND = { exec: "exec", read: "read", search: "read", write: "write", web: "web", agent: "agent", ask: "you", meta: "other", other: "other" }
export const portOf = (name) => PORT_OF_KIND[toolMeta(name).kind] ?? "other"

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

// What a working session is doing this moment.
export function phaseOf(session) {
  if (session.state !== "working") return { key: session.state, tools: [] }
  const newest = session.steps[session.steps.length - 1]
  const running = newest ? newest.tools.filter((tool) => tool.end === null) : []
  if (running.length) return { key: "tool", tools: running, since: Math.min(...running.map((tool) => tool.start)) }
  if (newest && newest.end === null) {
    const heard = newest.items.some((item) => item.kind !== "tool" && item.end !== null)
    return { key: heard ? "writing" : "thinking", tools: [], since: newest.start }
  }
  return { key: "calling", tools: [], since: newest?.end ?? session.busySince }
}

export class Scene {
  constructor() {
    this.world = null
    this.rows = []
    this.hidden = 0
    this.capacity = 12
    this.windowMs = 8 * 60e3
    this.rank = new Map()
    this.serial = 0
    this.signals = []
    this.streams = []
    this.log = []
    this.seen = new Map()
    this.heat = new Map()
    this.rate = new Map()
    this.outSamples = []
    this.counts = { working: 0, waiting: 0, idle: 0, stalled: 0, panes: 0 }
    this.waiting = []
    this.ports = new Map(PORTS.map((port) => [port.id, { ...port, inflight: 0, count: 0, errors: 0, p50: 0, last: 0 }]))
    this.focus = { id: null, auto: true, since: 0 }
    this.primed = false
    this.byId = new Map()
  }

  signal(entry) {
    this.signals.push(entry)
    if (entry.sid) this.heat.set(entry.sid, entry.at)
    if (this.signals.length > 400) this.signals.splice(0, this.signals.length - 400)
  }

  takeSignals() {
    const signals = this.signals
    this.signals = []
    return signals
  }

  note(entry) {
    this.log.unshift(entry)
    if (this.log.length > 40) this.log.length = 40
  }

  ingest(world, now) {
    this.world = world
    const byId = new Map(world.sessions.map((session) => [session.id, session]))
    this.byId = byId
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
      session.phase = phaseOf(session)
    }
    this.derive(world, byId, now)
    this.choose(world, byId, now)
    this.flows(byId)
    this.summarise(world, now)
    this.direct(now)
    this.primed = true
  }

  // Compares each session with how it looked at the last poll and turns the differences into
  // signals. Nothing is signalled on the first poll: what is already running shows as a stream.
  derive(world, byId, now) {
    for (const session of world.sessions) {
      const before = this.seen.get(session.id)
      const sid = session.id
      const steps = new Set()
      const landed = new Set()
      const tools = new Map()
      const said = new Map()
      for (const step of session.steps) {
        steps.add(step.seq)
        if (step.streamed !== null || step.end !== null || step.items.length) landed.add(step.seq)
        for (const tool of step.tools) tools.set(tool.id, tool.end === null ? "running" : tool.status)
        for (const item of step.items) if (item.kind === "say") said.set(item.key, item.length)
      }
      const out = session.turn?.out ?? 0
      if (this.primed && before) {
        for (const step of session.steps) {
          if (!before.steps.has(step.seq) && step.start > now - 30e3) this.signal({ type: "call", sid, at: now })
          if (landed.has(step.seq) && !before.landed.has(step.seq)) this.signal({ type: "land", sid, at: now, seq: step.seq })
          for (const tool of step.tools) {
            const was = before.tools.get(tool.id)
            const is = tools.get(tool.id)
            const port = portOf(tool.name)
            if (!was) {
              this.signal({ type: "tool-start", sid, at: now, port, tool })
              this.note({ key: tool.id, at: tool.start, sid, name: tool.name, detail: tool.label, span: tool.end === null ? null : tool.end - tool.start, tone: tool.end === null ? "run" : tool.status === "error" ? "bad" : "plain" })
              if (is !== "running") this.signal({ type: "tool-end", sid, at: now, port, tool, failed: is === "error" })
            } else if (was === "running" && is !== "running") {
              this.signal({ type: "tool-end", sid, at: now, port, tool, failed: is === "error" })
              const entry = this.log.find((candidate) => candidate.key === tool.id)
              if (entry) {
                entry.span = tool.end - tool.start
                entry.tone = is === "error" ? "bad" : "plain"
              }
            }
          }
          for (const item of step.items) {
            if (item.kind !== "say") continue
            const had = before.said.get(item.key) ?? 0
            if (item.length > had) this.signal({ type: "speak", sid, at: now, chars: item.length - had })
          }
        }
        if (session.busy && !before.busy) {
          this.signal({ type: "turn-start", sid, at: now })
          this.note({ key: `${sid}:turn:${session.busySince}`, at: now, sid, name: "turn", detail: session.prompt || session.title, span: null, tone: "plain" })
        }
        if (!session.busy && before.busy) {
          const failed = session.outcome === "failed"
          this.signal({ type: "turn-end", sid, at: now, failed })
          this.note({ key: `${sid}:end:${now}`, at: now, sid, name: failed ? "failed" : session.outcome === "interrupted" ? "interrupted" : "done", detail: session.title, span: before.turnStart ? now - before.turnStart : null, tone: failed ? "bad" : "ok" })
          if (session.parentId && byId.has(session.parentId)) this.signal({ type: "report", sid, at: now, parent: session.parentId, failed })
        }
        if (session.blocked && !before.blocked) {
          this.signal({ type: "wait", sid, at: now })
          this.note({ key: `${sid}:wait:${now}`, at: now, sid, name: "waiting", detail: session.title, span: null, tone: "warn" })
        }
        const gained = out > before.out ? out - before.out : 0
        if (gained > 0) {
          this.outSamples.push({ at: now, tokens: gained })
          const since = Math.max(1000, now - Math.max(before.outAt || 0, session.turn?.start ?? 0))
          this.rate.set(sid, { value: (gained / since) * 1000, at: now })
          this.signal({ type: "tokens", sid, at: now, tokens: gained })
        }
      } else if (this.primed && !before && session.parentId && byId.has(session.parentId) && now - session.created < 30e3) {
        this.signal({ type: "dispatch", sid, at: now, parent: session.parentId })
        this.note({ key: `${sid}:spawn`, at: session.created, sid, name: "dispatch", detail: session.title, span: null, tone: "plain" })
      }
      const gainedNow = before && out > before.out
      this.seen.set(sid, { busy: session.busy, blocked: session.blocked, steps, landed, tools, said, out, outAt: gainedNow || !before ? now : before.outAt, turnStart: session.turn?.start ?? 0 })
    }
    for (const id of this.seen.keys()) {
      if (byId.has(id)) continue
      this.seen.delete(id)
      this.heat.delete(id)
      this.rate.delete(id)
    }
    this.outSamples = this.outSamples.filter((sample) => now - sample.at < RATE_WINDOW)
  }

  // Output tokens a second for one session, from the last model call that reported any.
  rateOf(sid, now) {
    const rate = this.rate.get(sid)
    if (!rate || now - rate.at > 45e3) return 0
    return rate.value
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
    const quiet = Math.min(QUIET_ROWS, this.capacity)
    if (chosen.size < quiet) {
      const recent = world.sessions
        .filter((session) => !session.parentId && !chosen.has(session.id))
        .sort((a, b) => (b.pane ? 1 : 0) - (a.pane ? 1 : 0) || b.updated - a.updated)
      for (const session of recent) {
        if (chosen.size >= quiet) break
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
    // A root keeps the place it was first given, so rows do not jump around while you watch.
    for (const root of [...roots].sort((a, b) => score(b) - score(a) || b.last - a.last)) {
      if (!this.rank.has(root.id)) this.rank.set(root.id, (this.serial += 1))
    }
    for (const id of this.rank.keys()) if (!chosen.has(id)) this.rank.delete(id)
    roots.sort((a, b) => this.rank.get(a.id) - this.rank.get(b.id))
    const rows = []
    const walk = (session, depth, parentRow) => {
      const row = { session, depth, index: rows.length, parent: parentRow }
      rows.push(row)
      for (const child of (kids.get(session.id) ?? []).sort((a, b) => a.created - b.created)) walk(child, depth + 1, row)
    }
    for (const root of roots) walk(root, 0, null)
    this.rows = rows
  }

  // What is in flight right now, read from state so it is right from the first frame.
  flows(byId) {
    const rowOf = new Map(this.rows.map((row) => [row.session.id, row]))
    const streams = []
    for (const row of this.rows) {
      const session = row.session
      if (session.state === "waiting") streams.push({ key: `wait:${session.id}`, type: "wait", sid: session.id, port: "you" })
      if (session.state !== "working") continue
      if (row.parent) streams.push({ key: `kid:${session.id}`, type: "kid", sid: session.id, parent: row.parent.session.id })
      for (const tool of session.phase.tools) {
        const port = portOf(tool.name)
        // a dispatch whose child has a row of its own is drawn as the link to that row
        if (port === "agent" && this.rows.some((other) => other.parent === row && other.session.state === "working")) continue
        streams.push({ key: `tool:${tool.id}`, type: "tool", sid: session.id, port, tool })
      }
    }
    this.streams = streams
    this.rowOf = rowOf
  }

  summarise(world, now) {
    const rowOf = this.rowOf
    let working = 0
    let stalled = 0
    for (const session of world.sessions) {
      if (session.state === "working") working += 1
      if (session.state === "stalled") stalled += 1
    }
    const waiting = []
    let idle = 0
    for (const pane of world.panes) {
      pane.row = pane.sessionId && rowOf.has(pane.sessionId) ? rowOf.get(pane.sessionId).index : -1
      if (pane.status === "blocked") waiting.push(pane)
      else if (pane.status !== "working") idle += 1
    }
    waiting.sort((a, b) => (a.since || now) - (b.since || now))
    this.waiting = waiting
    this.counts = { working, waiting: waiting.length, idle, stalled, panes: world.panes.length }
    for (const port of this.ports.values()) {
      port.inflight = 0
      port.count = 0
      port.errors = 0
      port.spans = []
      port.used = new Map()
    }
    for (const session of world.sessions) {
      for (const step of session.steps) {
        for (const tool of step.tools) {
          if ((tool.end ?? now) < now - this.windowMs) continue
          const port = this.ports.get(portOf(tool.name))
          port.count += 1
          port.last = Math.max(port.last, tool.end ?? now)
          if (tool.status === "error") port.errors += 1
          if (tool.end === null && session.state === "working") port.inflight += 1
          else if (tool.end !== null) port.spans.push(Math.max(1, tool.end - tool.start))
          port.used.set(session.id, Math.max(port.used.get(session.id) ?? 0, tool.end ?? now))
        }
        for (const item of step.items) {
          if (item.kind !== "say" || item.at < now - this.windowMs) continue
          const you = this.ports.get("you")
          you.used.set(session.id, Math.max(you.used.get(session.id) ?? 0, item.at))
        }
      }
    }
    for (const port of this.ports.values()) {
      port.spans.sort((a, b) => a - b)
      port.p50 = port.spans.length ? port.spans[Math.floor(port.spans.length / 2)] : 0
    }
    this.ports.get("you").inflight = waiting.length
    // output tokens a minute, averaged over the last five (or over the time watched, when shorter)
    this.since ??= now
    const watched = Math.max(30e3, Math.min(RATE_WINDOW, now - this.since))
    this.outPerMinute = (this.outSamples.reduce((sum, sample) => sum + sample.tokens, 0) / watched) * 60e3
  }

  // Focus follows the action unless the keyboard took it: the working thread that last did
  // something, with enough dwell that it does not flap between two busy threads.
  direct(now) {
    const rows = this.rows
    if (!rows.length) {
      this.focus.id = null
      return
    }
    const current = rows.find((row) => row.session.id === this.focus.id)?.session
    if (!current) this.focus.id = null
    if (!this.focus.auto && this.focus.id) return
    const score = (session) => (session.state === "working" ? 2e13 : session.state === "waiting" ? 1e13 : 0) + Math.max(this.heat.get(session.id) ?? 0, session.last)
    let best = rows[0].session
    for (const row of rows) if (score(row.session) > score(best)) best = row.session
    if (!this.focus.id) this.setFocus(best.id, now)
    else if (best.id !== this.focus.id) {
      const idle = current.state !== "working"
      const dwell = now - this.focus.since
      if ((idle && best.state === "working") || (idle && dwell > 4000) || (dwell > 9000 && score(best) - score(current) > 5000)) this.setFocus(best.id, now)
    }
  }

  setFocus(id, now) {
    if (this.focus.id === id) return
    this.focus.id = id
    this.focus.since = now
  }

  moveFocus(delta, now) {
    if (!this.rows.length) return
    const at = Math.max(0, this.rows.findIndex((row) => row.session.id === this.focus.id))
    const next = (at + delta + this.rows.length) % this.rows.length
    this.focus.auto = false
    this.setFocus(this.rows[next].session.id, now)
  }

  focusIndex(index, now) {
    if (index < 0 || index >= this.rows.length) return
    this.focus.auto = false
    this.setFocus(this.rows[index].session.id, now)
  }

  follow() {
    this.focus.auto = true
  }

  get focused() {
    return this.rows.find((row) => row.session.id === this.focus.id) ?? null
  }
}
