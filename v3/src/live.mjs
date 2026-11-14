// Live data: opencode's database, the Claude Code plugin's state files and herdr.
// Everything here is read-only.

import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { accountOf, clamp, contextLimit, quantile, sessionTag } from "./util.mjs"

// One row per message. An assistant row is one step (one model call) and lists its content
// items in order: reasoning, text and tool calls. `tail` is how many characters of a reasoning
// or text item to bring along (its end), 0 for none.
const TOOL_LABEL = `substr(coalesce(
         json_extract(j.value, '$.state.input.description'),
         json_extract(j.value, '$.state.input.command'),
         json_extract(j.value, '$.state.input.filePath'),
         json_extract(j.value, '$.state.input.path'),
         json_extract(j.value, '$.state.input.pattern'),
         json_extract(j.value, '$.state.input.url'),
         json_extract(j.value, '$.state.input.query'),
         json_extract(j.value, '$.state.input.agent'), ''), 1, 220)`
const columnsFor = (tail) => `
  m.seq as seq, m.type as type, m.time_created as created,
  json_extract(m.data, '$.time.streamed') as streamed,
  json_extract(m.data, '$.time.completed') as completed,
  json_extract(m.data, '$.finish') as finish,
  json_extract(m.data, '$.outcome') as outcome,
  json_extract(m.data, '$.tokens.output') as tout,
  coalesce(json_extract(m.data, '$.tokens.input'), 0) + coalesce(json_extract(m.data, '$.tokens.cache.read'), 0)
    + coalesce(json_extract(m.data, '$.tokens.cache.write'), 0) as tctx,
  ${tail ? "substr(json_extract(m.data, '$.text'), 1, 600)" : "null"} as utext,
  (select json_group_array(json_array(
       json_extract(j.value, '$.type'),
       json_extract(j.value, '$.id'),
       json_extract(j.value, '$.name'),
       json_extract(j.value, '$.state.status'),
       case when json_extract(j.value, '$.type') = 'tool' then ${TOOL_LABEL}
            else ${tail ? `substr(json_extract(j.value, '$.text'), -${tail})` : "''"} end,
       json_extract(j.value, '$.time.created'),
       json_extract(j.value, '$.time.completed'),
       coalesce(length(json_extract(j.value, '$.text')), 0) + coalesce(length(json_extract(j.value, '$.state.input')), 0)))
     from json_each(m.data, '$.content') j) as items`

const TAIL_CHARS = 1600
const SUBAGENT_PREFIX = /^You are a subagent spawned by another session\.\s*/

function readWindow(window, now, span) {
  if (!window || typeof window !== "object") return null
  let resetsAt = Number(window.resetsAt) || 0
  if (resetsAt && resetsAt < 1e12) resetsAt *= 1000
  if (resetsAt && resetsAt < now) return { used: 0, status: "allowed", resetsAt: 0, span }
  const utilization = typeof window.utilization === "number" ? window.utilization : null
  const used = utilization === null ? null : clamp(utilization <= 1.5 ? utilization * 100 : utilization, 0, 100)
  return { used, status: window.status ?? "", resetsAt, span }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch {
    return null
  }
}

// Paths lose the home prefix and commands their leading "cd somewhere &&".
function tidy(label) {
  return String(label ?? "")
    .replace(/\s+/g, " ")
    .replace(/^cd \S+ && /, "")
    .replace(/\/Users\/[^/ ]+\//g, "~/")
    .trim()
}

function parseList(text) {
  try {
    return JSON.parse(text ?? "[]") ?? []
  } catch {
    return []
  }
}

export class LiveSource {
  constructor(options) {
    this.options = options
    this.mode = "LIVE"
    this.herdr = { bySession: new Map(), panes: [] }
    this.paneSince = new Map()
    this.accounts = []
    this.progress = new Map()
    this.spawns = {}
    this.expect = new Map()
    this.tracks = new Map()
    this.cost24h = { cost: 0, sessions: 0 }
    this.costAt = 0
  }

  async open() {
    const { DatabaseSync } = await import("node:sqlite")
    this.db = new DatabaseSync(this.options.db, { readOnly: true })
    const columns =
      "id, parent_id, title, agent, model, cost, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, time_created, time_updated, time_busy, time_idle, idle_outcome, time_compacting, directory"
    this.recentQuery = this.db.prepare(
      `select ${columns} from session_v2 where time_archived is null and (time_updated > ? or time_busy > coalesce(time_idle, 0)) order by time_updated desc limit 200`,
    )
    this.byIdQuery = this.db.prepare(`select ${columns} from session_v2 where id = ? and time_archived is null`)
    const kinds = "m.type in ('assistant', 'user', 'idle')"
    // history carries no text, the newest few messages carry the end of theirs
    this.historyQuery = this.db.prepare(
      `select ${columnsFor(0)} from session_message m where m.session_id = ? and m.time_created > ? and ${kinds} order by m.time_created desc limit 1500`,
    )
    this.tailQuery = this.db.prepare(`select ${columnsFor(TAIL_CHARS)} from session_message m where m.session_id = ? and ${kinds} order by m.seq desc limit 7`)
    this.contextQuery = this.db.prepare(`
      select coalesce(json_extract(m.data, '$.tokens.input'), 0) + coalesce(json_extract(m.data, '$.tokens.cache.read'), 0)
           + coalesce(json_extract(m.data, '$.tokens.cache.write'), 0) as tctx
        from session_message m where m.session_id = ? and m.type = 'assistant' order by m.seq desc limit 60`)
    this.costQuery = this.db.prepare("select coalesce(sum(cost), 0) as cost, count(*) as sessions from session_v2 where time_updated > ?")
    this.pollHerdr()
    this.readFiles()
    this.readHistory()
    this.timers = [
      setInterval(() => this.pollHerdr(), 2500),
      setInterval(() => this.readFiles(), 900),
      setInterval(() => this.readHistory(), 30e3),
    ]
    for (const timer of this.timers) timer.unref()
  }

  close() {
    for (const timer of this.timers ?? []) clearInterval(timer)
    try {
      this.db?.close()
    } catch {}
  }

  pollHerdr() {
    if (process.env.HERDR_ENV !== "1") return
    execFile("herdr", ["agent", "list"], { timeout: 4000, maxBuffer: 8 << 20 }, (error, stdout) => {
      if (error) return
      try {
        const agents = JSON.parse(stdout).result?.agents ?? []
        const now = Date.now()
        const bySession = new Map()
        const panes = []
        const seen = new Set()
        for (const agent of agents) {
          const sessionId = agent.agent_session?.value
          const status = agent.agent_status ?? "unknown"
          const known = this.paneSince.get(agent.pane_id)
          if (!known || known.status !== status) this.paneSince.set(agent.pane_id, { status, since: known ? now : 0 })
          seen.add(agent.pane_id)
          const pane = {
            id: agent.pane_id,
            workspace: agent.workspace_id ?? String(agent.pane_id).split(":")[0],
            status,
            kind: agent.agent ?? "agent",
            title: String(agent.terminal_title_stripped ?? "").replace(/^OC \| /, ""),
            sessionId: typeof sessionId === "string" && sessionId.startsWith("ses_") ? sessionId : null,
            since: this.paneSince.get(agent.pane_id).since,
          }
          if (pane.sessionId) bySession.set(pane.sessionId, pane)
          panes.push(pane)
        }
        for (const id of this.paneSince.keys()) if (!seen.has(id)) this.paneSince.delete(id)
        this.herdr = { bySession, panes }
      } catch {}
    })
  }

  readFiles() {
    const now = Date.now()
    const usage = readJson(path.join(this.options.state, "account-usage.json"))
    if (usage) {
      const names = new Set([...Object.keys(usage.accounts ?? {}), ...Object.keys(usage.known ?? {})])
      this.accounts = [...names].sort().map((name) => ({
        name,
        tier: usage.known?.[name]?.tier ?? "",
        five: readWindow(usage.accounts?.[name]?.five_hour, now, 5 * 3600e3),
        seven: readWindow(usage.accounts?.[name]?.seven_day, now, 7 * 86400e3),
      }))
    }
    const progress = readJson(path.join(this.options.state, "turn-progress.json"))
    if (progress) this.progress = new Map(Object.entries(progress.turns ?? {}))
    const spawns = readJson(path.join(this.options.state, "session-spawns.json"))
    if (spawns) this.spawns = spawns.sessions ?? {}
  }

  // How long turns of each agent/model pair usually take, from the plugin's own record.
  readHistory() {
    const history = readJson(path.join(this.options.state, "turn-history.json"))
    if (!history) return
    const expect = new Map()
    for (const [key, samples] of Object.entries(history.turns ?? {})) {
      if (!Array.isArray(samples)) continue
      const sorted = samples
        .filter((sample) => !sample.failed && sample.ms > 0)
        .map((sample) => sample.ms)
        .sort((a, b) => a - b)
      if (sorted.length >= 3) expect.set(key, { p25: quantile(sorted, 0.25), p50: quantile(sorted, 0.5), p75: quantile(sorted, 0.75), n: sorted.length })
    }
    this.expect = expect
  }

  toSession(row, now) {
    let model = {}
    try {
      model = JSON.parse(row.model ?? "{}") ?? {}
    } catch {}
    const pane = this.herdr.bySession.get(row.id)
    const spawn = this.spawns[row.id] ?? this.spawns[sessionTag(row.id)]
    const modelId = String(spawn?.model ?? model.id ?? "")
    const busy = (row.time_busy ?? 0) > (row.time_idle ?? 0)
    const progress = this.progress.get(sessionTag(row.id))
    const bare = modelId.split("@")[0]
    return {
      id: row.id,
      parentId: row.parent_id ?? null,
      title: String(row.title ?? "untitled").replace(/\s+/g, " ").trim(),
      agent: spawn?.agent ?? row.agent ?? "",
      model: bare,
      provider: model.providerID ?? "",
      effort: spawn?.effort ?? model.variant ?? "",
      account: spawn?.account ?? accountOf(String(model.id ?? ""), model.providerID ?? ""),
      busy,
      blocked: pane?.status === "blocked",
      outcome: row.idle_outcome ?? "",
      compacting: (row.time_compacting ?? 0) > (row.time_idle ?? 0) && busy,
      cost: row.cost ?? 0,
      tokens: {
        input: row.tokens_input ?? 0,
        output: row.tokens_output ?? 0,
        reasoning: row.tokens_reasoning ?? 0,
        cacheRead: row.tokens_cache_read ?? 0,
        cacheWrite: row.tokens_cache_write ?? 0,
      },
      created: row.time_created ?? 0,
      updated: row.time_updated ?? 0,
      busySince: row.time_busy ?? 0,
      idleSince: row.time_idle ?? 0,
      context: { used: 0, limit: contextLimit(bare) },
      turn: busy ? { start: row.time_busy, out: progress && progress.turn >= row.time_busy - 5000 ? progress.out : 0 } : null,
      lastOut: progress?.out ?? 0,
      tail: [],
      prompt: "",
      expect: this.expect.get(`${spawn?.agent ?? row.agent ?? "main"}/${bare}`) ?? null,
      pane: pane?.id ?? "",
      paneStatus: pane?.status ?? "",
      directory: row.directory ?? "",
      steps: [],
      marks: [],
    }
  }

  merge(track, rows, limit) {
    const plausible = (tokens) => tokens > 0 && (!limit || tokens <= limit * 1.05)
    for (const row of rows) {
      if (row.type !== "assistant") {
        const known = track.marks.get(row.seq)
        const text = row.utext ? String(row.utext).replace(SUBAGENT_PREFIX, "").replace(/\s+/g, " ").trim() : (known?.text ?? "")
        track.marks.set(row.seq, { at: row.created, kind: row.type, outcome: row.outcome ?? "", text })
        continue
      }
      // a child session can report a whole turn's sum here; only a figure that fits the window is a reading
      if (plausible(row.tctx)) track.context = row.tctx
      const known = track.steps.get(row.seq)
      const tools = []
      const reasoning = []
      const items = []
      let chars = 0
      let index = 0
      for (const [type, id, name, status, text, created, completed, length] of parseList(row.items)) {
        chars += length ?? 0
        const key = `${row.seq}:${index}`
        index += 1
        if (type === "tool") {
          if (!id) continue
          const tool = {
            id,
            name: String(name ?? "tool"),
            label: tidy(text),
            status: status ?? "completed",
            start: created ?? row.streamed ?? row.created,
            end: status === "running" || status === "pending" ? null : (completed ?? row.completed ?? null),
          }
          tools.push(tool)
          items.push({ key, kind: "tool", tool, at: tool.start })
        } else if (type === "reasoning" || type === "text") {
          if (type === "reasoning" && created) reasoning.push([created, completed ?? null])
          // a history row carries no text: keep what an earlier tail read brought
          const before = known?.items.find((item) => item.key === key)
          const body = text ? String(text) : (before?.text ?? "")
          items.push({ key, kind: type === "reasoning" ? "think" : "say", text: body, length: length ?? body.length, at: created ?? row.streamed ?? row.created, end: completed ?? null })
        }
      }
      track.steps.set(row.seq, {
        seq: row.seq,
        start: row.created,
        streamed: row.streamed ?? null,
        end: row.completed ?? null,
        finish: row.finish ?? "",
        out: row.tout ?? 0,
        chars,
        reasoning,
        tools,
        items,
      })
    }
  }

  timeline(session, now) {
    let track = this.tracks.get(session.id)
    // A running turn is kept whole (up to six hours of it), so the turn clock can show every
    // call it made. Everything else is kept for the usual quarter hour.
    const horizon = Math.min(now - this.options.historyMs, session.busy && session.busySince ? Math.max(now - 6 * 3600e3, session.busySince - 2000) : Infinity)
    if (!track) {
      track = { steps: new Map(), marks: new Map(), context: 0, refreshed: 0, wasBusy: false }
      this.tracks.set(session.id, track)
      // newest first so a very long turn keeps its recent end, merged oldest first
      this.merge(track, this.historyQuery.all(session.id, horizon).reverse(), session.context.limit)
      this.merge(track, this.tailQuery.all(session.id).reverse(), session.context.limit)
      if (!track.context) {
        for (const row of this.contextQuery.all(session.id)) {
          if (row.tctx > 0 && (!session.context.limit || row.tctx <= session.context.limit * 1.05)) {
            track.context = row.tctx
            break
          }
        }
      }
    } else if (session.busy || track.wasBusy || session.updated > track.refreshed - 3000) {
      this.merge(track, this.tailQuery.all(session.id).reverse(), session.context.limit)
    }
    track.refreshed = now
    track.wasBusy = session.busy
    track.touched = now
    for (const [seq, step] of track.steps) if ((step.end ?? now) < horizon) track.steps.delete(seq)
    for (const [seq, mark] of track.marks) if (mark.at < horizon) track.marks.delete(seq)
    session.steps = [...track.steps.values()].sort((a, b) => a.seq - b.seq)
    // A step that is not the newest can no longer be running: opencode closed it without a
    // completion time (an interrupted turn, a crash). Close it where the next one began.
    for (let index = 0; index < session.steps.length; index += 1) {
      const step = session.steps[index]
      const next = session.steps[index + 1]
      const closeAt = next ? next.start : session.busy ? null : session.idleSince || session.updated
      if (step.end === null && closeAt) step.end = Math.max(step.start, closeAt)
      if (step.streamed === null && step.end !== null) step.streamed = step.tools.length ? Math.min(step.end, step.tools[0].start) : step.end
      for (const tool of step.tools) if (tool.end === null && step.end !== null) tool.end = step.end
    }
    session.marks = [...track.marks.values()].sort((a, b) => a.at - b.at)
    session.context.used = track.context
    // the live tail: what the newest steps thought, said and ran, oldest first
    const tail = []
    for (const step of session.steps.slice(-5)) for (const item of step.items) if (item.kind === "tool" || item.text) tail.push(item)
    session.tail = tail.slice(-14)
    let prompt = ""
    for (const mark of session.marks) if (mark.kind === "user" && mark.text) prompt = mark.text
    session.prompt = prompt
  }

  poll(now) {
    const rows = this.recentQuery.all(now - this.options.hours * 3600e3)
    const byId = new Map(rows.map((row) => [row.id, row]))
    for (const sessionId of this.herdr.bySession.keys()) {
      if (byId.has(sessionId)) continue
      const row = this.byIdQuery.get(sessionId)
      if (row) byId.set(sessionId, row)
    }
    for (let pass = 0; pass < 3; pass += 1) {
      for (const row of [...byId.values()]) {
        if (!row.parent_id || byId.has(row.parent_id)) continue
        const parent = this.byIdQuery.get(row.parent_id)
        if (parent) byId.set(parent.id, parent)
      }
    }
    const sessions = [...byId.values()].map((row) => this.toSession(row, now))
    for (const session of sessions) {
      if (session.busy || session.blocked || now - session.updated < this.options.historyMs) this.timeline(session, now)
    }
    for (const [id, track] of this.tracks) if (now - track.touched > 60e3) this.tracks.delete(id)
    if (now - this.costAt > 10e3) {
      this.cost24h = this.costQuery.get(now - 86400e3)
      this.costAt = now
    }
    return { mode: this.mode, now, sessions, panes: this.herdr.panes, accounts: this.accounts, cost24h: this.cost24h }
  }
}
