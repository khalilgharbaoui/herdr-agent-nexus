// The scene: the hierarchy (account, project, thread, subagents), what just happened (signals for
// the moving layer), what is in flight (streams), what needs the operator (alerts and the phase),
// who is in focus, and the numbers the header shows.

import { agoOf, clockOf, hourMinuteOf, spanOf, toolMeta } from "./util.mjs"

const STALL_AFTER = 5 * 60e3
const QUIET_ROWS = 8
const RATE_WINDOW = 5 * 60e3
const COOL_MS = 90e3 // how long the phase stays at caution after the last alert cleared
const MAX_ROWS = 140

// What a model acts on. Every tool call goes to exactly one of these.
export const PORTS = [
  { id: "you", label: "YOU", note: "answers and questions", icon: "\uf007" },
  { id: "exec", label: "SHELL", note: "commands", icon: "\uf120" },
  { id: "read", label: "READ", note: "files and search", icon: "\uf15c" },
  { id: "write", label: "WRITE", note: "edits", icon: "\uf040" },
  { id: "web", label: "WEB", note: "fetch and search", icon: "\uf0ac" },
  { id: "agent", label: "AGENTS", note: "dispatches", icon: "\uf0c0" },
  { id: "other", label: "OTHER", note: "todo, skills, mcp", icon: "\uf013" },
]
const PORT_OF_KIND = { exec: "exec", read: "read", search: "read", write: "write", web: "web", agent: "agent", ask: "you", meta: "other", other: "other" }
export const portOf = (name) => PORT_OF_KIND[toolMeta(name).kind] ?? "other"
export const FILTERS = ["active", "all", "needs"]
export const FILTER_NAME = { active: "ACTIVE", all: "ALL OPEN", needs: "NEEDS YOU" }
const LEVEL_RANK = { alert: 3, caution: 2, notice: 1 }

export function lastActivity(session) {
  let last = Math.max(session.busySince || 0, session.idleSince || 0)
  for (const step of session.steps) {
    last = Math.max(last, step.end ?? step.streamed ?? step.start)
    for (const tool of step.tools) last = Math.max(last, tool.end ?? tool.start)
  }
  return last
}

// What one model call wrote, in tokens. A provider that reports nothing for a call that ended in
// tool calls, or reports the whole turn's sum on the last call, is read from the length of what
// the call wrote instead (3.6 characters to a token), so the figure is an estimate there.
export function wroteOf(step) {
  const guess = step.chars / 3.6
  if (!step.out) return guess
  if (step.chars && step.out > guess * 3 + 200) return guess
  return step.out
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

const projectName = (directory) => {
  const parts = String(directory || "").split("/").filter(Boolean)
  return parts.length ? parts[parts.length - 1] : "no project"
}

export class Scene {
  constructor() {
    this.world = null
    this.rows = []
    this.threads = []
    this.projects = []
    this.rank = new Map()
    this.projectRank = new Map()
    this.serial = 0
    this.signals = []
    this.streams = []
    this.log = []
    this.seen = new Map()
    this.heat = new Map()
    this.rate = new Map()
    this.outSamples = []
    this.counts = { working: 0, waiting: 0, idle: 0, stalled: 0, panes: 0, threads: 0 }
    this.ports = new Map(PORTS.map((port) => [port.id, { ...port, inflight: 0, count: 0, errors: 0, p50: 0, p95: 0, last: 0, recent: [], used: new Map() }]))
    this.focus = { id: null, auto: true, since: 0 }
    this.primed = false
    this.byId = new Map()
    this.rowOf = new Map()
    this.collapsed = new Set()
    this.filter = "active"
    this.alerts = []
    this.calls = []
    this.muted = new Map()
    this.known = new Set()
    this.phase = { level: "normal", since: 0, coolUntil: 0 }
    this.windowMs = 8 * 60e3
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
    if (this.log.length > 60) this.log.length = 60
  }

  ingest(world, now) {
    this.world = world
    const byId = new Map(world.sessions.map((session) => [session.id, session]))
    this.byId = byId
    const kids = new Map()
    for (const session of world.sessions) {
      let cursor = session
      let depth = 0
      while (cursor.parentId && byId.has(cursor.parentId) && depth < 6) {
        cursor = byId.get(cursor.parentId)
        depth += 1
      }
      session.depth = depth
      session.rootId = cursor.id
      session.project = cursor.directory || session.directory || ""
      session.state = stateOf(session, now)
      session.last = lastActivity(session)
      session.phase = phaseOf(session)
      session.alerts = []
      if (session.parentId && byId.has(session.parentId)) kids.set(session.parentId, (kids.get(session.parentId) ?? 0) + 1)
    }
    for (const session of world.sessions) session.kids = kids.get(session.id) ?? 0
    this.places(world)
    this.derive(world, byId, now)
    this.assess(world, now)
    this.choose(world, byId, now)
    this.flows()
    this.summarise(world, now)
    this.direct(now)
    this.primed = true
  }

  // Where things live in herdr: workspace and tab by id, and each account's pace.
  places(world) {
    this.workspaceOf = new Map((world.workspaces ?? []).map((entry) => [entry.id, entry]))
    this.tabOf = new Map((world.tabs ?? []).map((entry) => [entry.id, entry]))
    this.paneOf = new Map((world.panes ?? []).map((entry) => [entry.id, entry]))
    const now = world.now
    for (const account of world.accounts ?? []) {
      const five = account.five
      account.left = five && five.used !== null ? Math.max(0, 100 - five.used) : null
      account.pace = null
      account.dryAt = 0
      if (five && five.used !== null && five.resetsAt && five.span) {
        const elapsed = five.span - (five.resetsAt - now)
        if (elapsed > 60e3 && five.used > 0) {
          account.pace = five.used / 100 / (elapsed / five.span)
          const dryAt = now + ((100 - five.used) / five.used) * elapsed
          if (dryAt < five.resetsAt) account.dryAt = dryAt
        }
      }
    }
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
          this.note({ key: `${sid}:wait:${now}`, at: now, sid, name: "call", detail: session.title, span: null, tone: "warn" })
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

  // What the operator should notice. Every entry says what, how bad, since when, and for whom.
  //   alert    needs you now      caution   watch it      notice   worth a look
  assess(world, now) {
    const alerts = []
    const add = (session, kind, level, text, detail, since) => {
      const entry = { key: `${kind}:${session.id}`, sid: session.id, kind, level, text, detail, since: since || now, title: session.title }
      alerts.push(entry)
      session.alerts.push(entry)
    }
    const billing = new Map()
    for (const session of world.sessions) {
      const shown = session.pane || session.busy || now - session.updated < this.windowMs
      if (!shown) continue
      if (session.state === "working") billing.set(session.account, (billing.get(session.account) ?? 0) + 1)
      if (session.state === "waiting") {
        let asked = ""
        for (const item of session.tail ?? []) if (item.kind === "say" && item.text) asked = item.text
        session.question = asked.replace(/\s+/g, " ").trim()
        add(session, "call", "alert", "is asking you something", session.question, session.idleSince || session.updated)
      }
      if (session.state === "stalled") {
        const silent = now - session.last
        add(session, "stall", silent < 2 * 3600e3 ? "caution" : "notice", `marked busy, silent for ${agoOf(silent)}`, "nothing has moved; the turn may have died", session.last)
      }
      // a streak of failed tool calls at the end of the newest turn
      let streak = 0
      let first = 0
      const tools = []
      for (const step of session.steps) for (const tool of step.tools) if (tool.end !== null) tools.push(tool)
      for (let index = tools.length - 1; index >= 0 && tools[index].status === "error"; index -= 1) {
        streak += 1
        first = tools[index].start
      }
      session.failStreak = streak
      if (streak >= 3 && now - tools[tools.length - 1].end < this.windowMs) {
        add(session, "streak", session.state === "working" ? "alert" : "notice", `${streak} tool calls failed in a row`, tools[tools.length - 1].label, first)
      }
      const { used, limit } = session.context
      if (limit && used) {
        const fill = used / limit
        if (fill >= 0.8) add(session, "context", session.state !== "working" ? "notice" : fill >= 0.92 ? "alert" : "caution", `context window ${Math.round(fill * 100)}% full`, `${Math.round(used / 1000)}k of ${Math.round(limit / 1000)}k tokens`, now)
      }
      if (session.state === "working" && session.turn && session.expect) {
        const elapsed = now - session.turn.start
        const usual = session.expect
        if (elapsed > Math.max(usual.p75 * 1.5, usual.p50 * 2)) {
          add(session, "long", "caution", `turn at ×${(elapsed / usual.p50).toFixed(1)} its usual length`, `usually ${spanOf(usual.p50)}, 3 in 4 end by ${spanOf(usual.p75)}`, session.turn.start + usual.p75)
        }
      }
      if (session.unread) add(session, "unread", "notice", "finished, not read yet", session.title, session.idleSince || session.updated)
      if (session.state === "failed" && now - (session.idleSince || session.updated) < 30 * 60e3) add(session, "failed", "caution", "last turn failed", session.title, session.idleSince || session.updated)
    }
    for (const account of world.accounts ?? []) {
      if (account.left === null) continue
      const five = account.five
      const reset = five.resetsAt ? `resets ${hourMinuteOf(five.resetsAt)}` : ""
      const users = billing.get(account.name) ?? 0
      const entry = { key: `account:${account.name}`, sid: null, account: account.name, kind: "account", since: now, title: account.name }
      if (account.left <= 0.5 || five.status === "rejected") alerts.push({ ...entry, level: users ? "alert" : "notice", text: `account ${account.name} is out`, detail: `${reset}${users ? `, ${users} working thread${users === 1 ? "" : "s"} on it` : ""}` })
      else if (account.left <= 6) alerts.push({ ...entry, level: users ? "alert" : "caution", text: `account ${account.name}: ${Math.round(account.left)}% left`, detail: `of the five hour window, ${reset}` })
      else if (account.left <= 15) alerts.push({ ...entry, level: "caution", text: `account ${account.name}: ${Math.round(account.left)}% left`, detail: `of the five hour window, ${reset}` })
      else if (account.dryAt && users) alerts.push({ ...entry, level: "notice", text: `account ${account.name} runs dry ${hourMinuteOf(account.dryAt)}`, detail: `at this pace, ${spanOf(five.resetsAt - account.dryAt)} before it resets` })
    }
    for (const alert of alerts) {
      alert.muted = this.muted.get(alert.key) === alert.level
      if (!this.known.has(alert.key) && this.primed && !alert.muted) this.signal({ type: "alarm", sid: alert.sid, at: now, level: alert.level })
    }
    this.known = new Set(alerts.map((alert) => alert.key))
    for (const key of this.muted.keys()) if (!this.known.has(key)) this.muted.delete(key)
    alerts.sort((a, b) => Number(a.muted) - Number(b.muted) || LEVEL_RANK[b.level] - LEVEL_RANK[a.level] || a.since - b.since)
    this.alerts = alerts
    this.calls = alerts.filter((alert) => alert.kind === "call")
    // the phase: alert while something needs you, then caution while it cools, then normal
    const live = alerts.filter((alert) => !alert.muted)
    const phase = this.phase
    const before = phase.level
    if (live.some((alert) => alert.level === "alert")) phase.level = "alert"
    else {
      if (before === "alert") phase.coolUntil = now + COOL_MS
      phase.level = live.some((alert) => alert.level === "caution") || phase.coolUntil > now ? "caution" : "normal"
    }
    phase.cooling = phase.level === "caution" && phase.coolUntil > now && !live.some((alert) => alert.level === "caution")
    phase.alerts = live.filter((alert) => alert.level === "alert").length
    phase.cautions = live.filter((alert) => alert.level === "caution").length
    phase.notices = live.filter((alert) => alert.level === "notice").length
    if (phase.level !== before) {
      phase.since = now
      if (this.primed) this.signal({ type: "phase", at: now, level: phase.level, from: before })
    }
  }

  mute(key) {
    const alert = this.alerts.find((candidate) => candidate.key === key)
    if (!alert) return
    if (this.muted.get(key) === alert.level) this.muted.delete(key)
    else this.muted.set(key, alert.level)
  }

  // Which sessions are listed, grouped by project, in an order that does not jump around.
  choose(world, byId, now) {
    const score = (session) => {
      if (session.state === "working") return 4
      if (session.state === "waiting") return 3
      if (session.last > now - this.windowMs) return 2
      if (session.state === "stalled") return 1
      return 0
    }
    const chosen = new Set()
    const take = (session) => {
      let cursor = session
      while (cursor && !chosen.has(cursor.id) && chosen.size < MAX_ROWS) {
        chosen.add(cursor.id)
        cursor = cursor.parentId ? byId.get(cursor.parentId) : null
      }
    }
    const candidates = world.sessions.filter((session) => score(session) > 0).sort((a, b) => score(b) - score(a) || b.last - a.last)
    if (this.filter === "needs") {
      for (const session of world.sessions) if (session.alerts.some((alert) => !alert.muted)) take(session)
    } else {
      for (const session of candidates) take(session)
      if (this.filter === "all") for (const session of world.sessions) if (session.pane) take(session)
      // a quiet hour still shows the threads you were last in: open panes first, then the newest
      if (chosen.size < QUIET_ROWS) {
        const recent = world.sessions
          .filter((session) => !session.parentId && !chosen.has(session.id))
          .sort((a, b) => (b.pane ? 1 : 0) - (a.pane ? 1 : 0) || b.updated - a.updated)
        for (const session of recent) {
          if (chosen.size >= QUIET_ROWS) break
          chosen.add(session.id)
        }
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
    // a root and a project keep the place they were first given
    for (const root of [...roots].sort((a, b) => score(b) - score(a) || b.last - a.last)) {
      if (!this.rank.has(root.id)) this.rank.set(root.id, (this.serial += 1))
      if (!this.projectRank.has(root.project)) this.projectRank.set(root.project, (this.serial += 1))
    }
    for (const id of this.rank.keys()) if (!chosen.has(id)) this.rank.delete(id)
    roots.sort((a, b) => this.projectRank.get(a.project) - this.projectRank.get(b.project) || this.rank.get(a.id) - this.rank.get(b.id))
    const rows = []
    const threads = []
    const projects = []
    let project = null
    const count = (session, tally) => {
      tally.threads += 1
      tally.cost += session.cost
      if (session.state === "working") tally.working += 1
      if (session.alerts.some((alert) => !alert.muted && alert.level !== "notice")) tally.flags += 1
      for (const child of kids.get(session.id) ?? []) count(child, tally)
    }
    const walk = (session, depth, parent) => {
      const children = (kids.get(session.id) ?? []).sort((a, b) => a.created - b.created)
      const closed = this.collapsed.has(session.id) && children.length > 0
      const row = { type: "thread", key: session.id, session, depth, parent, index: threads.length, kids: children.length, closed, project }
      if (closed) {
        row.tally = { threads: 0, cost: 0, working: 0, flags: 0 }
        for (const child of children) count(child, row.tally)
      }
      rows.push(row)
      threads.push(row)
      if (!closed) for (const child of children) walk(child, depth + 1, row)
    }
    for (const root of roots) {
      if (!project || project.dir !== root.project) {
        const key = `project:${root.project}`
        project = { type: "project", key, dir: root.project, name: projectName(root.project), closed: this.collapsed.has(key), tally: { threads: 0, cost: 0, working: 0, flags: 0 }, accounts: new Set() }
        projects.push(project)
        rows.push(project)
      }
      count(root, project.tally)
      project.accounts.add(root.account)
      if (!project.closed) walk(root, 0, null)
    }
    this.rows = rows
    this.threads = threads
    this.projects = projects
    this.rowOf = new Map(threads.map((row) => [row.session.id, row]))
  }

  // What is in flight right now, read from state so it is right from the first frame.
  flows() {
    const streams = []
    for (const row of this.threads) {
      const session = row.session
      if (session.state === "waiting") streams.push({ key: `wait:${session.id}`, type: "wait", sid: session.id, port: "you" })
      if (session.state !== "working") continue
      if (row.parent) streams.push({ key: `kid:${session.id}`, type: "kid", sid: session.id, parent: row.parent.session.id })
      for (const tool of session.phase.tools) {
        const port = portOf(tool.name)
        // a dispatch whose child has a row of its own is drawn as the link to that row
        if (port === "agent" && this.threads.some((other) => other.parent === row && other.session.state === "working")) continue
        streams.push({ key: `tool:${tool.id}`, type: "tool", sid: session.id, port, tool })
      }
    }
    this.streams = streams
  }

  summarise(world, now) {
    let working = 0
    let stalled = 0
    for (const session of world.sessions) {
      if (session.state === "working") working += 1
      if (session.state === "stalled") stalled += 1
    }
    let waiting = 0
    let idle = 0
    for (const pane of world.panes) {
      pane.row = pane.sessionId && this.rowOf.has(pane.sessionId) ? this.rowOf.get(pane.sessionId).index : -1
      if (pane.status === "blocked") waiting += 1
      else if (pane.status !== "working") idle += 1
    }
    this.counts = { working, waiting: Math.max(waiting, this.calls.length), idle, stalled, panes: world.panes.length, threads: this.threads.length }
    for (const port of this.ports.values()) {
      port.inflight = 0
      port.count = 0
      port.errors = 0
      port.spans = []
      port.recent = []
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
          port.recent.push({ tool, sid: session.id })
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
      port.p95 = port.spans.length ? port.spans[Math.min(port.spans.length - 1, Math.floor(port.spans.length * 0.95))] : 0
      port.recent.sort((a, b) => b.tool.start - a.tool.start)
      port.recent.length = Math.min(port.recent.length, 6)
    }
    this.ports.get("you").inflight = this.calls.length
    // output tokens a minute, averaged over the last five (or over the time watched, when shorter)
    this.since ??= now
    const watched = Math.max(30e3, Math.min(RATE_WINDOW, now - this.since))
    this.outPerMinute = (this.outSamples.reduce((sum, sample) => sum + sample.tokens, 0) / watched) * 60e3
  }

  // Focus follows the action unless the operator took it: the working thread that last did
  // something, with enough dwell that it does not flap between two busy threads.
  direct(now) {
    const rows = this.threads
    if (!rows.length) {
      this.focus.id = null
      return
    }
    const current = this.rowOf.get(this.focus.id)?.session
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
    this.focus.from = this.focus.id
    this.focus.id = id
    this.focus.since = now
  }

  lock(id, now) {
    if (!this.rowOf.has(id)) return false
    this.focus.auto = false
    this.setFocus(id, now)
    return true
  }

  moveFocus(delta, now) {
    const rows = this.threads
    if (!rows.length) return
    const at = Math.max(0, rows.findIndex((row) => row.session.id === this.focus.id))
    this.lock(rows[Math.max(0, Math.min(rows.length - 1, at + delta))].session.id, now)
  }

  focusIndex(index, now) {
    if (index < 0 || index >= this.threads.length) return
    this.lock(this.threads[index].session.id, now)
  }

  follow() {
    this.focus.auto = true
  }

  // Opens or closes a subtree (a thread with subagents) or a project.
  toggle(key, open) {
    const want = open ?? this.collapsed.has(key)
    if (want) this.collapsed.delete(key)
    else this.collapsed.add(key)
  }

  // Left: close the focused subtree, or step out to the parent. Right: open it, or step in.
  step(direction, now) {
    const row = this.focused
    if (!row) return
    if (direction < 0) {
      if (row.kids && !row.closed) this.collapsed.add(row.key)
      else if (row.parent) this.lock(row.parent.session.id, now)
    } else if (row.kids) {
      if (row.closed) this.collapsed.delete(row.key)
      else {
        const child = this.threads.find((other) => other.parent === row)
        if (child) this.lock(child.session.id, now)
      }
    }
  }

  // The next thing that needs the operator, after the one in focus.
  nextAlert(direction, now) {
    const targets = [...new Set(this.alerts.filter((alert) => alert.sid && !alert.muted && this.rowOf.has(alert.sid)).map((alert) => alert.sid))]
    if (!targets.length) return null
    const at = targets.indexOf(this.focus.id)
    const next = targets[(at + direction + targets.length) % targets.length]
    this.lock(next, now)
    return next
  }

  cycleFilter() {
    this.filter = FILTERS[(FILTERS.indexOf(this.filter) + 1) % FILTERS.length]
  }

  get focused() {
    return this.rowOf.get(this.focus.id) ?? null
  }

  // "Private Secondary › IaC PRs › wE:p6" for a pane id.
  whereOf(paneId) {
    const pane = this.paneOf?.get(paneId)
    if (!pane) return ""
    const workspace = this.workspaceOf.get(pane.workspace)
    const tab = this.tabOf.get(pane.tab)
    return [workspace?.label || pane.workspace, tab?.label || pane.tab, pane.id].filter(Boolean).join("  ›  ")
  }
}

export { clockOf }
