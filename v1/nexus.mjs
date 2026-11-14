#!/usr/bin/env node
// Agent Nexus: a live, animated map of every opencode session, subagent and herdr agent
// on this machine, drawn with Skia and shown through the Kitty graphics protocol.
//
//   node --no-warnings nexus.mjs                live, in the current terminal
//   node --no-warnings nexus.mjs --demo         simulated activity
//   node --no-warnings nexus.mjs --frames 4 --size 1180x1680 [--demo]   headless PNGs into ./shots
//
// Keys: q quit, d switch live/demo, s snapshot. SIGUSR1 also writes a snapshot.
// Reads opencode's database read-only and the plugin's state files; writes nothing outside this folder.

import { createCanvas, GlobalFonts } from "@napi-rs/canvas"
import { execFile } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Worker } from "node:worker_threads"
import { deflateSync } from "node:zlib"

const HERE = path.dirname(new URL(import.meta.url).pathname)
const argv = process.argv.slice(2)
const hasFlag = (name) => argv.includes(`--${name}`)
const optionValue = (name, fallback) => {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : fallback
}
const OPTIONS = {
  demo: hasFlag("demo"),
  fps: Number(optionValue("fps", 30)),
  scale: optionValue("scale", "auto"),
  pixels: Number(optionValue("pixels", 1.5e6)),
  frames: Number(optionValue("frames", 0)),
  size: optionValue("size", "1180x1680"),
  hours: Number(optionValue("hours", 6)),
  maxRoots: Number(optionValue("roots", 9)),
  db: optionValue("db", path.join(os.homedir(), ".local/share/opencode/opencode.db")),
  state: path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local/state"), "opencode-claude-code-plugin"),
  shots: path.join(HERE, "shots"),
}

// ------------------------------------------------------------------ type and colour

const FONT_DIR = path.join(os.homedir(), "Library/Fonts")
for (const [file, alias] of [
  ["FiraCodeNerdFontMono-Regular.ttf", "Nexus Mono"],
  ["FiraCodeNerdFontMono-Bold.ttf", "Nexus Mono Bold"],
]) {
  try {
    if (fs.existsSync(path.join(FONT_DIR, file))) GlobalFonts.registerFromPath(path.join(FONT_DIR, file), alias)
  } catch {}
}
const FAMILY = {
  display: '"DIN Condensed", "Avenir Next Condensed", sans-serif',
  label: '"Avenir Next Condensed", "Avenir Next", sans-serif',
  mono: '"Nexus Mono", Menlo, monospace',
  monoBold: '"Nexus Mono Bold", "Nexus Mono", Menlo, monospace',
}
const fontOf = (size, family, weight = "") => `${weight ? `${weight} ` : ""}${Math.max(5, size).toFixed(1)}px ${family}`

const PALETTE = {
  void: "#01030a",
  deep: "#05122a",
  cyan: "#3fe0ff",
  ice: "#d6f1ff",
  text: "#e8f4ff",
  soft: "#a9bed8",
  dim: "#6f86a6",
  faint: "#2b3c55",
  amber: "#ffb000",
  red: "#ff4d5e",
  green: "#3cf2a0",
  violet: "#a98bff",
  magenta: "#ff5bd6",
}
const TILT = 0.76

const clamp = (value, low, high) => Math.max(low, Math.min(high, value))
const approach = (value, target, rate, dt) => value + (target - value) * (1 - Math.exp(-rate * dt))
const TAU = Math.PI * 2
const hexToRgb = (hex) => {
  const value = Number.parseInt(hex.slice(1), 16)
  return [value >> 16, (value >> 8) & 255, value & 255]
}
const rgba = (hex, alpha) => {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r},${g},${b},${clamp(alpha, 0, 1).toFixed(3)})`
}
const mix = (from, to, amount) => {
  const a = hexToRgb(from)
  const b = hexToRgb(to)
  const channel = (index) => Math.round(a[index] + (b[index] - a[index]) * amount)
  return `#${((1 << 24) | (channel(0) << 16) | (channel(1) << 8) | channel(2)).toString(16).slice(1)}`
}
function hashUnit(text) {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash / 4294967296
}
// The plugin's own sessionTag (src/turn-history.ts): FNV-1a over the id, eight hex digits.
function sessionTag(id) {
  let hash = 0x811c9dc5
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, "0")
}
function mulberry32(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

const pad2 = (value) => String(value).padStart(2, "0")
const clockOf = (ms) => {
  const date = new Date(ms)
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}
const agoOf = (ms) => {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h${pad2(Math.floor((seconds % 3600) / 60))}`
  return `${Math.floor(seconds / 86400)}d`
}
const durationOf = (seconds) => {
  const whole = Math.max(0, Math.floor(seconds))
  if (whole < 60) return `${whole}s`
  if (whole < 3600) return `${Math.floor(whole / 60)}m${pad2(whole % 60)}`
  return `${Math.floor(whole / 3600)}h${pad2(Math.floor((whole % 3600) / 60))}`
}
const compactOf = (value) => {
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`
  if (value >= 1e4) return `${Math.round(value / 1e3)}k`
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`
  return `${Math.round(value)}`
}
const moneyOf = (value) => (value >= 1000 ? `$${Math.round(value)}` : `$${value.toFixed(2)}`)

function modelColor(model = "", provider = "") {
  const name = model.toLowerCase()
  if (provider === "local" || /qwen|llama|mlx|gemma|bonsai|mistral|deepseek/.test(name)) return "#ff8a3d"
  if (/opus/.test(name)) return "#b18cff"
  if (/sonnet/.test(name)) return "#3fb8ff"
  if (/haiku/.test(name)) return "#2ef0c4"
  if (/fable/.test(name)) return "#ffc247"
  if (/mythos/.test(name)) return "#ff5bd6"
  if (/gpt|codex|o\d/.test(name)) return "#7cff6b"
  if (/gemini/.test(name)) return "#4f8bff"
  return "#9fb4ff"
}
function shortModel(model = "") {
  if (!model) return "model?"
  let name = model.split("@")[0].split("/").pop()
  name = name.replace(/^claude-/, "").replace(/-(\d+)-(\d+)(?=$|-)/, " $1.$2").replace(/-fast$/, " fast")
  return name.length > 18 ? `${name.slice(0, 17)}…` : name
}
function accountOf(model = "", provider = "") {
  const marker = model.split("@")[1]
  if (marker) return marker
  if (provider.startsWith("claude-code-")) return provider.slice("claude-code-".length)
  return provider === "claude-code" ? "default" : provider
}

const TOOL_META = {
  shell: ["", "#3fe0ff"],
  bash: ["", "#3fe0ff"],
  read: ["", "#8fd3ff"],
  edit: ["", "#ffd166"],
  write: ["", "#ffd166"],
  patch: ["", "#ffd166"],
  webfetch: ["", "#7cff6b"],
  websearch: ["", "#7cff6b"],
  grep: ["", "#c3a6ff"],
  glob: ["", "#c3a6ff"],
  list: ["", "#c3a6ff"],
  subagent: ["\u{f06a9}", "#ff5bd6"],
  task: ["\u{f06a9}", "#ff5bd6"],
  task_batch: ["\u{f06a9}", "#ff5bd6"],
  todowrite: ["", "#2ef0c4"],
  question: ["", "#ffb000"],
  execute: ["", "#3fe0ff"],
  skill: ["", "#ffc247"],
}
const toolMeta = (name = "") => TOOL_META[name] ?? TOOL_META[name.replace(/^mcp__[^_]+__/, "")] ?? ["", "#9fb4ff"]

// ------------------------------------------------------------------ glow sprites

const spriteCache = new Map()
function radialPixels(size, stops) {
  // A radial falloff written pixel by pixel, because Skia dithers its gradients and the
  // dither noise is what makes a frame expensive to compress.
  const canvas = createCanvas(size, size)
  const context = canvas.getContext("2d")
  const image = context.createImageData(size, size)
  const half = size / 2
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const distance = Math.hypot(x + 0.5 - half, y + 0.5 - half) / half
      const [r, g, b, a] = sampleStops(stops, distance)
      const offset = (y * size + x) * 4
      image.data[offset] = r
      image.data[offset + 1] = g
      image.data[offset + 2] = b
      image.data[offset + 3] = Math.round(a * 255)
    }
  }
  context.putImageData(image, 0, 0)
  return canvas
}

function sampleStops(stops, position) {
  if (position <= stops[0][0]) return stops[0][1]
  for (let index = 1; index < stops.length; index += 1) {
    const [at, color] = stops[index]
    if (position <= at) {
      const [previousAt, previous] = stops[index - 1]
      const k = (position - previousAt) / (at - previousAt || 1)
      const smooth = k * k * (3 - 2 * k)
      return previous.map((value, channel) => (channel < 3 ? Math.round(value + (color[channel] - value) * smooth) : value + (color[channel] - value) * smooth))
    }
  }
  return stops[stops.length - 1][1]
}

function glowSprite(hex) {
  let sprite = spriteCache.get(hex)
  if (sprite) return sprite
  const [r, g, b] = hexToRgb(hex)
  const [lr, lg, lb] = hexToRgb(mix(hex, "#ffffff", 0.45))
  sprite = radialPixels(96, [
    [0, [255, 255, 255, 1]],
    [0.09, [lr, lg, lb, 0.95]],
    [0.26, [r, g, b, 0.5]],
    [0.55, [r, g, b, 0.13]],
    [1, [r, g, b, 0]],
  ])
  spriteCache.set(hex, sprite)
  return sprite
}
const stripCache = new Map()
// A vertical gradient as a 1-pixel-wide computed strip, stretched by drawImage: smooth, never dithered.
function verticalStrip(key, stops) {
  let strip = stripCache.get(key)
  if (strip) return strip
  strip = createCanvas(1, 128)
  const context = strip.getContext("2d")
  const image = context.createImageData(1, 128)
  for (let y = 0; y < 128; y += 1) {
    const [r, g, b, a] = sampleStops(stops, y / 127)
    image.data.set([r, g, b, Math.round(a * 255)], y * 4)
  }
  context.putImageData(image, 0, 0)
  stripCache.set(key, strip)
  return strip
}

function glow(context, hex, x, y, radius, alpha) {
  if (alpha <= 0.004 || radius <= 0.5) return
  context.globalAlpha = Math.min(1, alpha)
  context.drawImage(glowSprite(hex), x - radius, y - radius, radius * 2, radius * 2)
}

// ------------------------------------------------------------------ live data

function readWindow(window, now) {
  if (!window || typeof window !== "object") return null
  let resetsAt = Number(window.resetsAt) || 0
  if (resetsAt && resetsAt < 1e12) resetsAt *= 1000
  if (resetsAt && resetsAt < now) return { used: 0, status: "allowed", resetsAt: 0 }
  const utilization = typeof window.utilization === "number" ? window.utilization : null
  const used = utilization === null ? null : clamp(utilization <= 1.5 ? utilization * 100 : utilization, 0, 100)
  return { used, status: window.status ?? "", resetsAt }
}

function usageFromStore(store, now) {
  const names = new Set([...Object.keys(store.accounts ?? {}), ...Object.keys(store.known ?? {})])
  return [...names].map((account) => ({
    account,
    tier: store.known?.[account]?.tier ?? "",
    five: readWindow(store.accounts?.[account]?.five_hour, now),
    seven: readWindow(store.accounts?.[account]?.seven_day, now),
  }))
}

function selectSessions(sessions, maxRoots, now) {
  const byId = new Map(sessions.map((session) => [session.id, session]))
  for (const session of sessions) {
    let cursor = session
    let depth = 0
    while (cursor.parentId && byId.has(cursor.parentId) && depth < 5) {
      cursor = byId.get(cursor.parentId)
      depth += 1
    }
    session.depth = depth
    session.rootId = cursor.id
  }
  const liveRoots = new Set(sessions.filter((session) => session.busy || session.blocked).map((session) => session.rootId))
  const score = (session) =>
    (liveRoots.has(session.id) ? 8e15 : 0) + (session.pane ? 2e15 : 0) + (session.updated ?? 0)
  const roots = sessions.filter((session) => session.depth === 0).sort((a, b) => score(b) - score(a))
  const chosenRoots = roots.slice(0, maxRoots)
  const chosen = new Set(chosenRoots.map((session) => session.id))
  const kidsByRoot = new Map()
  for (const session of sessions) {
    if (session.depth === 0 || session.depth > 2 || !chosen.has(session.rootId)) continue
    if (!session.busy && !session.blocked && now - session.updated > 45 * 60e3) continue
    const list = kidsByRoot.get(session.rootId) ?? []
    list.push(session)
    kidsByRoot.set(session.rootId, list)
  }
  const list = [...chosenRoots]
  for (const kids of kidsByRoot.values()) {
    kids.sort((a, b) => (b.busy ? 1e15 : 0) + b.updated - ((a.busy ? 1e15 : 0) + a.updated))
    list.push(...kids.slice(0, 8))
  }
  const listed = new Set(list.map((session) => session.id))
  for (const session of list) if (session.parentId && !listed.has(session.parentId)) session.parentId = session.rootId
  return { list, hidden: Math.max(0, roots.length - chosenRoots.length) }
}

class LiveSource {
  constructor(options) {
    this.options = options
    this.mode = "LIVE"
    this.herdr = { bySession: new Map(), entries: [] }
    this.usage = []
    this.progress = new Map()
    this.cost24h = { cost: 0, sessions: 0 }
    this.costAt = 0
  }

  async open() {
    const { DatabaseSync } = await import("node:sqlite")
    this.db = new DatabaseSync(this.options.db, { readOnly: true })
    const columns =
      "id, parent_id, title, agent, model, cost, tokens_output, time_created, time_updated, time_busy, time_idle, idle_outcome"
    this.recentQuery = this.db.prepare(
      `select ${columns} from session_v2 where time_archived is null and (time_updated > ? or time_busy > coalesce(time_idle, 0)) order by time_updated desc limit 160`,
    )
    this.byIdQuery = this.db.prepare(`select ${columns} from session_v2 where id = ?`)
    this.activityQuery = this.db.prepare(`
      select m.seq as seq,
        (select coalesce(sum(length(json_extract(j.value, '$.text'))), 0)
           from json_each(m.data, '$.content') j
          where json_extract(j.value, '$.type') in ('text', 'reasoning')) as chars,
        (select json_group_array(json_array(
             json_extract(j.value, '$.id'),
             json_extract(j.value, '$.name'),
             json_extract(j.value, '$.state.status'),
             substr(coalesce(
               json_extract(j.value, '$.state.input.description'),
               json_extract(j.value, '$.state.input.command'),
               json_extract(j.value, '$.state.input.filePath'),
               json_extract(j.value, '$.state.input.path'),
               json_extract(j.value, '$.state.input.pattern'),
               json_extract(j.value, '$.state.input.url'),
               json_extract(j.value, '$.state.input.query'),
               json_extract(j.value, '$.state.input.agent'), ''), 1, 96)))
           from json_each(m.data, '$.content') j
          where json_extract(j.value, '$.type') = 'tool') as tools
      from session_message m
      where m.session_id = ? and m.type = 'assistant'
      order by m.seq desc limit 2`)
    this.costQuery = this.db.prepare(
      "select coalesce(sum(cost), 0) as cost, count(*) as sessions from session_v2 where time_updated > ?",
    )
    this.pollHerdr()
    this.readFiles()
    this.timers = [setInterval(() => this.pollHerdr(), 2500), setInterval(() => this.readFiles(), 900)]
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
        const bySession = new Map()
        const entries = []
        for (const agent of agents) {
          const sessionId = agent.agent_session?.value
          const entry = {
            pane: agent.pane_id,
            status: agent.agent_status ?? "unknown",
            kind: agent.agent ?? "agent",
            title: String(agent.terminal_title_stripped ?? "").replace(/^OC \| /, ""),
            sessionId: typeof sessionId === "string" && sessionId.startsWith("ses_") ? sessionId : null,
          }
          if (entry.sessionId) bySession.set(entry.sessionId, entry)
          entries.push(entry)
        }
        this.herdr = { bySession, entries }
      } catch {}
    })
  }

  readFiles() {
    const now = Date.now()
    try {
      this.usage = usageFromStore(JSON.parse(fs.readFileSync(path.join(this.options.state, "account-usage.json"), "utf8")), now)
    } catch {}
    try {
      const progress = JSON.parse(fs.readFileSync(path.join(this.options.state, "turn-progress.json"), "utf8"))
      this.progress = new Map(Object.entries(progress.turns ?? {}))
    } catch {}
  }

  toSession(row) {
    let model = {}
    try {
      model = JSON.parse(row.model ?? "{}") ?? {}
    } catch {}
    const pane = this.herdr.bySession.get(row.id)
    const progress = this.progress.get(sessionTag(row.id))
    return {
      id: row.id,
      parentId: row.parent_id ?? null,
      title: String(row.title ?? "untitled").replace(/\s+/g, " "),
      agent: row.agent ?? "",
      model: model.id ?? "",
      provider: model.providerID ?? "",
      variant: model.variant ?? "",
      cost: row.cost ?? 0,
      tokensOut: row.tokens_output ?? 0,
      created: row.time_created ?? 0,
      updated: row.time_updated ?? 0,
      busy: (row.time_busy ?? 0) > (row.time_idle ?? 0),
      blocked: pane?.status === "blocked",
      outcome: row.idle_outcome ?? "",
      pane: pane?.pane ?? "",
      tokenTurn: progress?.turn,
      tokenOut: progress?.out,
      steps: [],
      tools: [],
    }
  }

  activity(session) {
    const steps = []
    const tools = []
    for (const row of this.activityQuery.all(session.id)) {
      steps.push({ seq: row.seq, chars: row.chars ?? 0 })
      let list = []
      try {
        list = JSON.parse(row.tools ?? "[]")
      } catch {}
      for (const [id, name, status, label] of list) {
        if (!id) continue
        tools.push({ id, name: name ?? "tool", status: status ?? "completed", label: String(label ?? "").replace(/\s+/g, " ") })
      }
    }
    session.steps = steps
    session.tools = tools
  }

  poll(now) {
    const rows = this.recentQuery.all(now - this.options.hours * 3600e3)
    const byId = new Map(rows.map((row) => [row.id, row]))
    for (const sessionId of this.herdr.bySession.keys()) {
      if (byId.has(sessionId)) continue
      const row = this.byIdQuery.get(sessionId)
      if (row && !row.time_archived) byId.set(sessionId, row)
    }
    for (let pass = 0; pass < 2; pass += 1) {
      for (const row of [...byId.values()]) {
        if (!row.parent_id || byId.has(row.parent_id)) continue
        const parent = this.byIdQuery.get(row.parent_id)
        if (parent) byId.set(parent.id, parent)
      }
    }
    const selected = selectSessions(
      [...byId.values()].map((row) => this.toSession(row)),
      this.options.maxRoots,
      now,
    )
    for (const session of selected.list) {
      if (session.busy || now - session.updated < 120e3) this.activity(session)
    }
    if (now - this.costAt > 10e3) {
      this.cost24h = this.costQuery.get(now - 86400e3)
      this.costAt = now
    }
    const shown = new Set(selected.list.map((session) => session.id))
    const externals = this.herdr.entries.filter((entry) => !entry.sessionId || !shown.has(entry.sessionId))
    return {
      mode: this.mode,
      sessions: selected.list,
      hidden: selected.hidden,
      externals,
      usage: this.usage,
      cost24h: this.cost24h,
    }
  }
}

// ------------------------------------------------------------------ demo data

const DEMO_TOOLS = [
  ["shell", "npm test -- proxy-task"],
  ["read", "src/turn-controller.ts"],
  ["edit", "src/stream-parser.ts"],
  ["grep", "noteTurnOutput"],
  ["webfetch", "code.claude.com/docs/en/cli-reference"],
  ["shell", "git diff --stat"],
  ["glob", "test/*.test.ts"],
  ["subagent", "Review the diff for regressions"],
  ["todowrite", "4 items"],
  ["write", "docs/sidebar.md"],
  ["shell", "npm run build"],
  ["read", "AGENTS.md"],
]
const DEMO_AGENTS = [
  ["explore", "claude-haiku-5-5"],
  ["designer", "claude-fable-5-2@appical"],
  ["writer", "claude-sonnet-5-5"],
  ["reviewer", "claude-opus-5-5"],
  ["general", "claude-sonnet-5-5"],
]

class DemoSource {
  constructor() {
    this.mode = "DEMO"
    this.random = mulberry32(17)
    this.sessions = new Map()
    this.counter = 0
    this.last = 0
  }

  open() {}
  close() {}

  pick(list) {
    return list[Math.floor(this.random() * list.length) % list.length]
  }

  add(session) {
    this.sessions.set(session.id, { steps: [], tools: [], seq: 0, busyUntil: 0, ...session })
  }

  seed(now) {
    const roots = [
      ["Refactor checkout payment flow", "build", "claude-opus-5-5", "claude-code-default", "xhigh", true],
      ["Plan the impact dashboard", "plan", "claude-fable-5-2@appical", "claude-code-appical", "high", true],
      ["Fix flaky proxy deadline test", "build", "claude-sonnet-5-5", "claude-code-default", "medium", true],
      ["Draft launch notes for v0.74", "build", "claude-haiku-5-5@appical", "claude-code-appical", "low", false],
      ["Local model eval harness", "build", "qwen3.8-27b-coder", "local", "", false],
      ["Investigate Sidekiq retries", "plan", "claude-opus-5-5@appical", "claude-code-appical", "high", false],
      ["Sidebar progress estimate", "build", "claude-mythos-5-2", "claude-code-default", "max", true],
    ]
    roots.forEach(([title, agent, model, provider, variant, busy], index) => {
      this.add({
        id: `demo_root_${index}`,
        parentId: null,
        title,
        agent,
        model,
        provider,
        variant,
        cost: 2 + this.random() * 40,
        tokensOut: 0,
        created: now - (index + 1) * 900e3,
        updated: now - this.random() * 600e3,
        busy,
        blocked: false,
        outcome: "succeeded",
        pane: `w${index + 2}:p${index + 1}`,
        tokenTurn: now,
        tokenOut: 0,
      })
    })
    for (const parent of ["demo_root_0", "demo_root_0", "demo_root_1", "demo_root_6"]) this.spawnChild(now, parent)
  }

  spawnChild(now, parentId) {
    const parent = this.sessions.get(parentId)
    const [agent, model] = this.pick(DEMO_AGENTS)
    this.counter += 1
    this.add({
      id: `demo_child_${this.counter}`,
      parentId,
      title: `${agent} for ${parent.title.toLowerCase()}`,
      agent,
      model,
      provider: model.includes("@") ? "claude-code-appical" : "claude-code-default",
      variant: "",
      cost: 0,
      tokensOut: 0,
      created: now,
      updated: now,
      busy: true,
      blocked: false,
      outcome: "",
      pane: "",
      tokenTurn: now,
      tokenOut: 0,
      busyUntil: now + 14e3 + this.random() * 40e3,
    })
  }

  poll(now) {
    if (!this.last) {
      this.seed(now)
      this.last = now
    }
    const dt = clamp((now - this.last) / 1000, 0, 2)
    this.last = now
    const chance = (perSecond) => this.random() < perSecond * dt
    for (const session of [...this.sessions.values()]) {
      const isChild = Boolean(session.parentId)
      if (isChild && !session.busy && now - session.updated > 35e3) {
        this.sessions.delete(session.id)
        continue
      }
      if (session.blocked && now > session.blockedUntil) session.blocked = false
      if (session.busy) {
        session.updated = now
        if (isChild ? now > session.busyUntil : chance(1 / 45)) {
          session.busy = false
          session.outcome = this.random() < 0.06 ? "failed" : "succeeded"
        }
        if (chance(1 / 2.6)) {
          session.seq += 1
          const chars = Math.round(150 + this.random() * 2600)
          session.steps.push({ seq: session.seq, chars })
          session.tokenOut += Math.round(chars / 3.6)
          session.cost += chars / 90000
        }
        if (chance(1 / 2.1)) {
          const [name, label] = this.pick(DEMO_TOOLS)
          this.counter += 1
          session.tools.push({
            id: `tool_${this.counter}`,
            name,
            label,
            status: "running",
            endsAt: now + 400 + this.random() * (name === "subagent" ? 15000 : 5000),
            at: now,
          })
          if (name === "subagent" && !isChild) this.spawnChild(now, session.id)
        }
        if (!isChild && !session.blocked && chance(1 / 80)) {
          session.blocked = true
          session.blockedUntil = now + 7000
        }
      } else if (!isChild && chance(1 / 22)) {
        session.busy = true
        session.tokenTurn = now
        session.tokenOut = 0
        session.updated = now
      }
      for (const tool of session.tools) {
        if (tool.status === "running" && now > tool.endsAt) tool.status = this.random() < 0.08 ? "error" : "completed"
      }
      session.tools = session.tools.filter((tool) => tool.status === "running" || now - tool.at < 25e3)
      session.steps = session.steps.slice(-2)
    }
    const wave = (period, phase) => Math.sin(now / period + phase)
    return {
      mode: this.mode,
      sessions: [...this.sessions.values()].map((session) => ({
        ...session,
        steps: [...session.steps],
        tools: session.tools.map((tool) => ({ ...tool })),
      })),
      hidden: 3,
      externals: [
        { pane: "w3:p2", kind: "claude", status: wave(9000, 0) > 0 ? "working" : "idle", title: "claude: migrate the importer" },
        { pane: "w4:p1", kind: "codex", status: "idle", title: "codex: review" },
        { pane: "w5:p3", kind: "opencode", status: "done", title: "v1 session" },
        { pane: "w6:p2", kind: "claude", status: wave(13000, 2) > 0.6 ? "blocked" : "working", title: "claude: infra" },
      ],
      usage: [
        {
          account: "default",
          tier: "Max 20x",
          five: { used: 41 + 12 * wave(60000, 0), status: "allowed", resetsAt: now + 2.3 * 3600e3 },
          seven: { used: 58, status: "allowed", resetsAt: now + 3.2 * 86400e3 },
        },
        {
          account: "appical",
          tier: "Max 5x",
          five: { used: 78 + 6 * wave(45000, 1), status: "allowed_warning", resetsAt: now + 1.1 * 3600e3 },
          seven: { used: 63, status: "allowed", resetsAt: now + 4.6 * 86400e3 },
        },
      ],
      cost24h: { cost: 74.12 + (now % 600000) / 20000, sessions: 23 },
    }
  }
}

// ------------------------------------------------------------------ scene

const HISTORY = 240 // half-second samples: two minutes
const SERIES = 90

class Scene {
  constructor() {
    this.nodes = new Map()
    this.particles = []
    this.packets = []
    this.rings = []
    this.log = []
    this.seeded = false
    this.order = 0
    this.tokenEvents = []
    this.toolStarts = []
    this.charEvents = []
    this.snapshot = { mode: "LIVE", sessions: [], externals: [], usage: [], cost24h: { cost: 0, sessions: 0 }, hidden: 0 }
    this.series = {
      threads: new Float32Array(SERIES),
      subagents: new Float32Array(SERIES),
      tools: new Float32Array(SERIES),
      tokens: new Float32Array(SERIES),
      cost: new Float32Array(SERIES),
    }
    this.seriesAt = 0
    this.historyAt = 0
    this.coreFlash = 0
    this.sweep = 0
    this.pinged = new Map()
    this.wall = Date.now()
  }

  logEvent(t, entry) {
    this.log.unshift({ t, wall: this.wall, ...entry })
    if (this.log.length > 60) this.log.length = 60
  }

  ring(t, x, y, from, to, life, color, width = 1.5, follow = null) {
    this.rings.push({ born: t, x, y, from, to, life, color, width, follow })
    if (this.rings.length > 160) this.rings.shift()
  }

  stream(t, from, to, count, color, options = {}) {
    for (let index = 0; index < count; index += 1) {
      if (this.particles.length > 1100) break
      this.particles.push({
        from,
        to,
        color,
        born: t + (options.spread ?? 0.9) * (index / Math.max(1, count)) + Math.random() * 0.05,
        speed: (options.speed ?? 0.55) * (0.75 + Math.random() * 0.5),
        size: (options.size ?? 1) * (0.7 + Math.random() * 0.6),
        bend: (Math.random() - 0.5) * (options.jitter ?? 0.25),
        glyph: Math.random() < 0.2 ? Math.floor(Math.random() * 256).toString(16).padStart(2, "0").toUpperCase() : "",
        u: 0,
      })
    }
  }

  createNode(session, t) {
    return {
      id: session.id,
      kind: "session",
      order: this.order++,
      born: t,
      appear: 0,
      present: true,
      x: undefined,
      y: undefined,
      tx: 0,
      ty: 0,
      angle: 0,
      depthScale: 1,
      energy: 0,
      pulse: 0,
      activity: 0,
      history: new Float32Array(HISTORY),
      historySum: 0,
      tools: new Map(),
      steps: new Map(),
      slot: 0,
      busySince: session.busy ? t : 0,
      blockedSince: 0,
      failedAt: 0,
      tokenTurn: session.tokenTurn,
      tokenOut: session.tokenOut,
      lastTool: null,
    }
  }

  apply(snapshot, t, wall) {
    this.snapshot = snapshot
    this.wall = wall
    const seen = new Set()
    for (const session of snapshot.sessions) {
      seen.add(session.id)
      let node = this.nodes.get(session.id)
      const fresh = !node
      if (fresh) {
        node = this.createNode(session, t)
        this.nodes.set(session.id, node)
      }
      const was = { busy: node.busy, blocked: node.blocked, outcome: node.outcome }
      Object.assign(node, {
        parentId: session.parentId,
        rootId: session.rootId ?? session.id,
        depth: session.depth ?? (session.parentId ? 1 : 0),
        title: session.title,
        agent: session.agent,
        model: session.model,
        provider: session.provider,
        variant: session.variant,
        color: modelColor(session.model, session.provider),
        account: accountOf(session.model, session.provider),
        cost: session.cost,
        updated: session.updated,
        busy: session.busy,
        blocked: session.blocked,
        outcome: session.outcome,
        pane: session.pane,
        present: true,
      })
      const who = this.whoOf(node)
      if (fresh && this.seeded) {
        this.ring(t, 0, 0, 0, 70, 1.4, node.color, 2.4, node.id)
        if (node.parentId && this.nodes.has(node.parentId)) {
          this.stream(t, node.parentId, node.id, 26, PALETTE.magenta, { speed: 0.9, spread: 0.6, size: 1.3 })
          this.logEvent(t, { icon: "✦", color: PALETTE.magenta, who, text: `subagent spawned ← ${this.whoOf(this.nodes.get(node.parentId))}` })
        } else {
          this.logEvent(t, { icon: "✦", color: node.color, who, text: `thread online · ${node.title}` })
        }
      }
      if (this.seeded && !fresh) {
        if (node.busy && !was.busy) {
          node.busySince = t
          node.pulse = 1
          this.ring(t, 0, 0, 0, 46, 1.1, node.color, 2, node.id)
          this.stream(t, "core", node.id, 14, node.color, { speed: 1.1, spread: 0.5 })
          this.logEvent(t, { icon: "▶", color: node.color, who, text: "turn started" })
        }
        if (!node.busy && was.busy) {
          const failed = node.outcome === "failed"
          if (failed) node.failedAt = t
          this.ring(t, 0, 0, 0, failed ? 90 : 40, failed ? 1.6 : 1, failed ? PALETTE.red : PALETTE.green, failed ? 3 : 1.6, node.id)
          this.logEvent(t, {
            icon: failed ? "✖" : "■",
            color: failed ? PALETTE.red : PALETTE.green,
            who,
            text: failed ? "turn failed" : node.outcome === "interrupted" ? "interrupted" : "turn complete",
          })
        }
        if (node.blocked && !was.blocked) {
          node.blockedSince = t
          this.logEvent(t, { icon: "⚠", color: PALETTE.amber, who, text: "awaiting your input" })
        }
      }
      if (!node.busy) node.busySince = 0
      // steps: a finished step lands as one burst of text
      for (const step of session.steps ?? []) {
        const previous = node.steps.get(step.seq)
        if (previous === undefined) {
          node.steps.set(step.seq, step.chars)
          if (this.seeded && !fresh && step.chars > 0) this.onStep(node, step.chars, t)
        } else if (step.chars > previous) {
          node.steps.set(step.seq, step.chars)
          if (this.seeded) this.onStep(node, step.chars - previous, t)
        }
      }
      if (node.steps.size > 10) node.steps = new Map([...node.steps].slice(-6))
      // tool calls
      for (const tool of session.tools ?? []) {
        const known = node.tools.get(tool.id)
        const finished = tool.status === "completed" || tool.status === "error"
        if (!known) {
          const entry = { ...tool, start: t, endAt: 0, slot: node.slot++, ok: tool.status !== "error" }
          node.tools.set(tool.id, entry)
          if (this.seeded && !fresh) {
            this.onToolStart(node, entry, t)
            if (finished) entry.pendingEnd = t + 0.7
          } else if (finished) {
            entry.endAt = t - 30
          }
        } else if (known.status !== tool.status) {
          known.status = tool.status
          if (finished && !known.endAt && !known.pendingEnd) this.onToolEnd(node, known, t)
        }
      }
      // output tokens, per API call, from the plugin's turn-progress.json
      if (session.tokenOut !== undefined && session.tokenOut !== null) {
        let delta = 0
        if (node.tokenTurn === session.tokenTurn) delta = session.tokenOut - (node.tokenOut ?? 0)
        else if (this.seeded) delta = session.tokenOut
        node.tokenTurn = session.tokenTurn
        node.tokenOut = session.tokenOut
        if (delta > 0 && this.seeded) {
          this.tokenEvents.push([t, delta])
          this.stream(t, node.id, node.parentId && this.nodes.has(node.parentId) ? node.parentId : "core", clamp(Math.round(delta / 120), 2, 26), node.color, { speed: 0.7, spread: 1.4 })
        }
      }
    }
    for (const node of this.nodes.values()) {
      if (node.kind === "session" && !seen.has(node.id) && node.present) {
        node.present = false
        node.busy = false
      }
    }
    this.seeded = true
  }

  whoOf(node) {
    if (!node) return "?"
    return `${node.agent || "agent"}·${shortModel(node.model).split(" ")[0]}`
  }

  onStep(node, chars, t) {
    node.activity += chars
    node.pulse = Math.min(1, node.pulse + 0.6)
    this.charEvents.push([t, chars])
    const target = node.parentId && this.nodes.has(node.parentId) ? node.parentId : "core"
    this.stream(t, node.id, target, clamp(Math.round(chars / 140), 3, 34), node.color, { speed: 0.6, spread: 1.2 })
    if (target === "core") this.coreFlash = Math.min(1, this.coreFlash + 0.25)
  }

  onToolStart(node, tool, t) {
    const [icon, color] = toolMeta(tool.name)
    node.pulse = 1
    node.lastTool = tool
    this.toolStarts.push(t)
    this.packets.push({ kind: "out", node: node.id, tool: tool.id, born: t, speed: 1.6, color, trail: [] })
    this.logEvent(t, { icon, color, who: this.whoOf(node), text: tool.name, detail: tool.label, tool })
  }

  onToolEnd(node, tool, t) {
    tool.endAt = t
    tool.pendingEnd = 0
    tool.ok = tool.status !== "error"
    const color = tool.ok ? PALETTE.green : PALETTE.red
    this.packets.push({ kind: "back", node: node.id, tool: tool.id, born: t, speed: 1.4, color, trail: [] })
    if (!tool.ok) {
      this.ring(t, 0, 0, 0, 56, 1.2, PALETTE.red, 2.2, node.id)
      node.failedAt = t
    }
  }

  layout(geometry, t) {
    const { cx, cy, S } = geometry.orbit
    const sessions = [...this.nodes.values()].filter((node) => node.kind === "session")
    const roots = sessions.filter((node) => !node.parentId || !this.nodes.has(node.parentId)).sort((a, b) => a.order - b.order)
    const children = new Map()
    for (const node of sessions) {
      if (!node.parentId || !this.nodes.has(node.parentId)) continue
      const list = children.get(node.parentId) ?? []
      list.push(node)
      children.set(node.parentId, list)
    }
    const count = roots.length
    const rotation = t * 0.016
    const radius = S * (count <= 3 ? 0.26 : 0.305)
    roots.forEach((node, index) => {
      const angle = -Math.PI / 2 + (index / Math.max(1, count)) * TAU + rotation + 0.35
      node.angle = angle
      node.level = 0
      node.tx = cx + Math.cos(angle) * radius
      node.ty = cy + Math.sin(angle) * radius * TILT
      node.depthScale = 0.84 + 0.16 * ((Math.sin(angle) + 1) / 2)
    })
    const place = (parent, kids, level) => {
      kids.sort((a, b) => a.order - b.order)
      const orbit = S * (level === 1 ? 0.07 : 0.034)
      const speed = parent.busy ? 0.32 : 0.08
      kids.forEach((kid, index) => {
        const angle = parent.angle + (index / kids.length) * TAU + t * speed / level + level
        kid.angle = angle
        kid.level = level
        kid.orbit = orbit
        kid.tx = parent.tx + Math.cos(angle) * orbit
        kid.ty = parent.ty + Math.sin(angle) * orbit * TILT
        kid.depthScale = parent.depthScale * (0.92 + 0.08 * Math.sin(angle))
        const grand = children.get(kid.id)
        if (grand) place(kid, grand, level + 1)
      })
    }
    for (const root of roots) {
      const kids = children.get(root.id)
      root.moons = kids ? kids.length : 0
      if (kids) place(root, kids, 1)
    }
    this.roots = roots
    this.children = children
  }

  position(ref, geometry) {
    if (ref === "core") return { x: geometry.orbit.cx, y: geometry.orbit.cy }
    const node = this.nodes.get(ref)
    if (!node || node.x === undefined) return null
    return { x: node.x, y: node.y }
  }

  satellite(node, tool, geometry) {
    const { cx, cy, S } = geometry.orbit
    const running = [...node.tools.values()].filter((entry) => !entry.endAt || geometry.t - entry.endAt < 1.2)
    const index = Math.max(0, running.indexOf(tool))
    const count = Math.max(1, running.length)
    const inward = Math.atan2(cy - node.y, cx - node.x)
    const angle = inward + (index - (count - 1) / 2) * 0.42
    const distance = S * (node.level ? 0.045 : 0.075)
    return { x: node.x + Math.cos(angle) * distance, y: node.y + Math.sin(angle) * distance * 0.9 }
  }

  update(dt, t, geometry) {
    geometry.t = t
    this.layout(geometry, t)
    const decay = Math.exp((-dt * Math.LN2) / 5)
    let liveEnergy = 0
    for (const node of this.nodes.values()) {
      if (node.x === undefined) {
        const parent = node.parentId ? this.nodes.get(node.parentId) : null
        node.x = parent?.x ?? node.tx
        node.y = parent?.y ?? node.ty
      }
      node.x = approach(node.x, node.tx, 4, dt)
      node.y = approach(node.y, node.ty, 4, dt)
      node.appear = clamp(node.appear + (node.present ? dt / 0.9 : -dt / 1.4), 0, 1)
      node.activity *= decay
      const recent = Math.exp(-Math.max(0, this.wall - (node.updated ?? 0)) / 90e3)
      const target = node.blocked ? 0.75 : node.busy ? 0.55 + Math.min(0.45, node.activity / 2500) : 0.06 + 0.18 * recent
      node.energy = approach(node.energy, target, 2.5, dt)
      node.pulse *= Math.exp(-dt * 2.2)
      if (node.busy || node.blocked) liveEnergy += node.energy
      for (const tool of node.tools.values()) {
        if (tool.pendingEnd && t >= tool.pendingEnd) this.onToolEnd(node, tool, t)
        if (tool.endAt && t - tool.endAt > 4) node.tools.delete(tool.id)
      }
      if (node.busy && Math.random() < dt * (node.level ? 1.6 : 2.4)) {
        const target = node.parentId && this.nodes.has(node.parentId) ? node.parentId : "core"
        this.stream(t, node.id, target, 1, node.color, { speed: 0.45, spread: 0 })
      }
      if (node.busy && !node.level && Math.random() < dt * 0.9) this.stream(t, "core", node.id, 1, PALETTE.cyan, { speed: 0.5, spread: 0, size: 0.8 })
      if (!node.present && node.appear <= 0) this.nodes.delete(node.id)
    }
    this.liveEnergy = liveEnergy
    this.coreFlash *= Math.exp(-dt * 1.6)
    this.sweep = (t * 0.85) % TAU
    // radar pings
    for (const root of this.roots ?? []) {
      const delta = (((root.angle - this.sweep) % TAU) + TAU) % TAU
      if (delta < 0.06 && t - (this.pinged.get(root.id) ?? -9) > 2) {
        this.pinged.set(root.id, t)
        this.ring(t, 0, 0, 6, 34, 0.9, PALETTE.cyan, 1, root.id)
      }
    }
    for (const particle of this.particles) if (t >= particle.born) particle.u += dt * particle.speed
    this.particles = this.particles.filter((particle) => particle.u < 1)
    for (const packet of this.packets) packet.u = (t - packet.born) * packet.speed
    this.packets = this.packets.filter((packet) => packet.u < 1.25)
    this.rings = this.rings.filter((ring) => t - ring.born < ring.life)
    // two minutes of activity per node, sampled twice a second
    if (t - this.historyAt >= 0.5) {
      this.historyAt = t
      for (const node of this.nodes.values()) {
        node.history.copyWithin(0, 1)
        const value = node.activity + (node.busy ? 40 : 0)
        node.history[HISTORY - 1] = value
        let sum = 0
        for (let index = HISTORY - 60; index < HISTORY; index += 1) sum += node.history[index]
        node.historySum = sum
      }
    }
    if (t - this.seriesAt >= 1) {
      this.seriesAt = t
      const stats = this.stats(t)
      for (const [key, value] of Object.entries({
        threads: stats.threadsBusy,
        subagents: stats.subagentsBusy,
        tools: stats.toolsPerMinute,
        tokens: stats.tokensPerSecond,
        cost: stats.cost,
      })) {
        const series = this.series[key]
        series.copyWithin(0, 1)
        series[SERIES - 1] = value
      }
    }
    this.toolStarts = this.toolStarts.filter((at) => t - at < 60)
    this.tokenEvents = this.tokenEvents.filter(([at]) => t - at < 30)
    this.charEvents = this.charEvents.filter(([at]) => t - at < 30)
  }

  stats(t) {
    const sessions = [...this.nodes.values()].filter((node) => node.kind === "session" && node.present)
    const roots = sessions.filter((node) => !node.parentId || !this.nodes.has(node.parentId))
    const kids = sessions.filter((node) => node.parentId && this.nodes.has(node.parentId))
    const rootOf = (node) => {
      let cursor = node
      while (cursor.parentId && this.nodes.has(cursor.parentId)) cursor = this.nodes.get(cursor.parentId)
      return cursor.id
    }
    const liveRoots = new Set(sessions.filter((node) => node.busy || node.blocked).map(rootOf))
    const window = 15
    const tokens = this.tokenEvents.filter(([at]) => t - at < window).reduce((sum, [, value]) => sum + value, 0)
    const chars = this.charEvents.filter(([at]) => t - at < window).reduce((sum, [, value]) => sum + value, 0)
    const measured = this.tokenEvents.length > 0
    return {
      threads: roots.length,
      threadsBusy: roots.filter((node) => liveRoots.has(node.id)).length,
      subagents: kids.length,
      subagentsBusy: kids.filter((node) => node.busy).length,
      toolsPerMinute: this.toolStarts.length,
      tokensPerSecond: measured ? tokens / window : chars / 4 / window,
      tokensMeasured: measured,
      cost: this.snapshot.cost24h?.cost ?? 0,
      costSessions: this.snapshot.cost24h?.sessions ?? 0,
      blocked: sessions.filter((node) => node.blocked).length,
    }
  }
}

// ------------------------------------------------------------------ drawing helpers

function roundRect(context, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2))
  context.beginPath()
  context.moveTo(x + radius, y)
  context.lineTo(x + w - radius, y)
  context.quadraticCurveTo(x + w, y, x + w, y + radius)
  context.lineTo(x + w, y + h - radius)
  context.quadraticCurveTo(x + w, y + h, x + w - radius, y + h)
  context.lineTo(x + radius, y + h)
  context.quadraticCurveTo(x, y + h, x, y + h - radius)
  context.lineTo(x, y + radius)
  context.quadraticCurveTo(x, y, x + radius, y)
  context.closePath()
}

function setSpacing(context, px) {
  if ("letterSpacing" in context) context.letterSpacing = `${px.toFixed(1)}px`
}

function text(context, value, x, y, { size, family = FAMILY.label, weight = "", color = PALETTE.text, alpha = 1, align = "left", baseline = "alphabetic", spacing = 0 }) {
  context.font = fontOf(size, family, weight)
  context.textAlign = align
  context.textBaseline = baseline
  context.fillStyle = color
  context.globalAlpha = clamp(alpha, 0, 1)
  if (spacing) setSpacing(context, spacing)
  context.fillText(value, x, y)
  if (spacing) setSpacing(context, 0)
}

function fit(context, value, maxWidth) {
  if (context.measureText(value).width <= maxWidth) return value
  let low = 0
  let high = value.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (context.measureText(`${value.slice(0, middle)}…`).width <= maxWidth) low = middle
    else high = middle - 1
  }
  return `${value.slice(0, low).trimEnd()}…`
}

function quad(x0, y0, x1, y1, x2, y2, u) {
  const v = 1 - u
  return { x: v * v * x0 + 2 * v * u * x1 + u * u * x2, y: v * v * y0 + 2 * v * u * y1 + u * u * y2 }
}

function control(a, b, bend) {
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2
  const dx = b.x - a.x
  const dy = b.y - a.y
  return { x: mx - dy * bend, y: my + dx * bend }
}

function hexagon(context, x, y, r, rotation = 0) {
  context.beginPath()
  for (let index = 0; index < 6; index += 1) {
    const angle = rotation + (index / 6) * TAU
    const px = x + Math.cos(angle) * r
    const py = y + Math.sin(angle) * r
    if (index === 0) context.moveTo(px, py)
    else context.lineTo(px, py)
  }
  context.closePath()
}

// ------------------------------------------------------------------ renderer

function computeGeometry(W, H) {
  const u = Math.min(W, H * 0.78) / 1000
  const top = Math.round(78 * u)
  const portrait = H > W * 1.12
  let orbit
  let telemetry
  if (portrait) {
    const S = Math.min(W * 0.96, ((H - top) * 0.58) / 0.86)
    const orbitH = S * 0.86
    orbit = { x: 0, y: top, w: W, h: orbitH, cx: W / 2, cy: top + orbitH / 2 + 6 * u, S }
    telemetry = { x: 14 * u, y: top + orbitH + 6 * u, w: W - 28 * u, h: H - top - orbitH - 20 * u }
  } else {
    const S = Math.min(H - top - 12 * u, W * 0.58)
    orbit = { x: 0, y: top, w: S + 40 * u, h: H - top, cx: S / 2 + 24 * u, cy: top + (H - top) / 2, S }
    telemetry = { x: S + 56 * u, y: top + 6 * u, w: W - S - 70 * u, h: H - top - 20 * u }
  }
  return { W, H, u, top, portrait, orbit, telemetry, t: 0 }
}

class Renderer {
  constructor(W, H) {
    this.W = W
    this.H = H
    this.canvas = createCanvas(W, H)
    this.context = this.canvas.getContext("2d")
    this.geometry = computeGeometry(W, H)
    this.bloomQuarter = createCanvas(Math.max(1, Math.round(W / 4)), Math.max(1, Math.round(H / 4)))
    this.bloomEighth = createCanvas(Math.max(1, Math.round(W / 10)), Math.max(1, Math.round(H / 10)))
    const random = mulberry32(99)
    const { cx, cy, S } = this.geometry.orbit
    this.stars = Array.from({ length: Math.round((W * H) / 3800) }, () => ({
      radius: Math.sqrt(random()) * Math.hypot(W, H) * 0.75,
      angle: random() * TAU,
      size: random() < 0.08 ? 2 : 1,
      alpha: 0.25 + random() * 0.6,
      speed: 0.6 + random() * 2.6,
      phase: random() * TAU,
      layer: random() < 0.5 ? 1 : 0.45,
      tint: random() < 0.15 ? PALETTE.violet : random() < 0.3 ? PALETTE.cyan : "#ffffff",
    }))
    this.center = { cx, cy, S }
    this.background = this.makeBackground()
    this.overlay = this.makeOverlay()
  }

  makeBackground() {
    const { W, H } = this
    const { cx, cy, S } = this.geometry.orbit
    const u = this.geometry.u
    const canvas = createCanvas(W, H)
    const context = canvas.getContext("2d")
    const image = context.createImageData(W, H)
    const random = mulberry32(5)
    const blobs = Array.from({ length: 8 }, (_, index) => ({
      x: random() * W,
      y: random() * H,
      radius: (0.25 + random() * 0.45) * S,
      color: hexToRgb([PALETTE.violet, "#2a78d6", PALETTE.magenta, "#1baf7a"][index % 4]),
    }))
    const reach = Math.max(W, H) * 0.75
    const base = hexToRgb(PALETTE.void)
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const d = Math.hypot(x - cx, (y - cy) * 1.1) / reach
        const haze = Math.max(0, 1 - d) ** 2
        let r = base[0] + 16 * haze
        let g = base[1] + 46 * haze
        let b = base[2] + 96 * haze
        for (const blob of blobs) {
          const k = 1 - Math.hypot(x - blob.x, y - blob.y) / blob.radius
          if (k <= 0) continue
          const weight = k * k * 0.075
          r += blob.color[0] * weight
          g += blob.color[1] * weight
          b += blob.color[2] * weight
        }
        const offset = (y * W + x) * 4
        image.data[offset] = r
        image.data[offset + 1] = g
        image.data[offset + 2] = b
        image.data[offset + 3] = 255
      }
    }
    context.putImageData(image, 0, 0)
    // orbital grid
    context.save()
    context.translate(cx, cy)
    context.lineWidth = Math.max(1, 0.8 * u)
    for (let ring = 1; ring <= 9; ring += 1) {
      const radius = S * 0.054 * ring
      context.strokeStyle = rgba(PALETTE.cyan, ring % 3 === 0 ? 0.085 : 0.04)
      context.setLineDash(ring % 3 === 0 ? [] : [2 * u, 6 * u])
      context.beginPath()
      context.ellipse(0, 0, radius, radius * TILT, 0, 0, TAU)
      context.stroke()
    }
    context.setLineDash([])
    for (let spoke = 0; spoke < 24; spoke += 1) {
      const angle = (spoke / 24) * TAU
      context.strokeStyle = rgba(PALETTE.cyan, spoke % 6 === 0 ? 0.07 : 0.03)
      context.beginPath()
      context.moveTo(Math.cos(angle) * S * 0.11, Math.sin(angle) * S * 0.11 * TILT)
      context.lineTo(Math.cos(angle) * S * 0.49, Math.sin(angle) * S * 0.49 * TILT)
      context.stroke()
    }
    for (let tick = 0; tick < 120; tick += 1) {
      const angle = (tick / 120) * TAU
      const inner = S * (tick % 10 === 0 ? 0.475 : 0.483)
      const outer = S * 0.49
      context.strokeStyle = rgba(PALETTE.cyan, tick % 10 === 0 ? 0.3 : 0.12)
      context.beginPath()
      context.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner * TILT)
      context.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer * TILT)
      context.stroke()
    }
    context.restore()
    return canvas
  }

  makeOverlay() {
    const { W, H } = this
    const canvas = createCanvas(W, H)
    const context = canvas.getContext("2d")
    const image = context.createImageData(W, H)
    const inner = Math.min(W, H) * 0.35
    const outer = Math.hypot(W, H) * 0.62
    for (let y = 0; y < H; y += 1) {
      const scan = y % 3 === 0 ? 0.16 : 0
      for (let x = 0; x < W; x += 1) {
        const k = clamp((Math.hypot(x - W / 2, y - H / 2) - inner) / (outer - inner), 0, 1)
        const alpha = 1 - (1 - k * k * 0.62) * (1 - scan)
        image.data[(y * W + x) * 4 + 3] = Math.round(alpha * 255)
      }
    }
    context.putImageData(image, 0, 0)
    return canvas
  }

  draw(scene, t, info) {
    const context = this.context
    const geometry = this.geometry
    context.globalCompositeOperation = "source-over"
    context.globalAlpha = 1
    context.drawImage(this.background, 0, 0)
    this.drawStars(context, t)
    this.drawSweep(context, scene, t)
    this.drawTethers(context, scene, t)
    context.globalCompositeOperation = "lighter"
    this.drawParticles(context, scene, t)
    context.globalCompositeOperation = "source-over"
    this.drawCore(context, scene, t)
    this.drawOrbits(context, scene, t)
    this.drawNodes(context, scene, t, false)
    this.drawNodes(context, scene, t, true)
    this.drawRings(context, scene, t)
    this.drawPackets(context, scene, t)
    this.bloom()
    this.drawLabels(context, scene, t)
    this.drawTelemetry(context, scene, t)
    this.drawTopBar(context, scene, t, info)
    context.globalCompositeOperation = "source-over"
    context.globalAlpha = 1
    context.drawImage(this.overlay, 0, 0)
    geometry.t = t
  }

  drawStars(context, t) {
    const { cx, cy } = this.geometry.orbit
    context.globalCompositeOperation = "lighter"
    for (const star of this.stars) {
      const angle = star.angle + t * 0.004 * star.layer
      const x = cx + Math.cos(angle) * star.radius
      const y = cy + Math.sin(angle) * star.radius * 0.9
      if (x < 0 || y < 0 || x > this.W || y > this.H) continue
      context.globalAlpha = star.alpha * (0.55 + 0.45 * Math.sin(t * star.speed + star.phase))
      context.fillStyle = star.tint
      context.fillRect(x, y, star.size, star.size)
    }
    context.globalAlpha = 1
    context.globalCompositeOperation = "source-over"
  }

  sweepSprite() {
    if (this.wedge) return this.wedge
    const size = 256
    const canvas = createCanvas(size, size)
    const context = canvas.getContext("2d")
    const image = context.createImageData(size, size)
    const span = 1.9
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const dx = x + 0.5 - size / 2
        const dy = y + 0.5 - size / 2
        const distance = Math.hypot(dx, dy) / (size / 2)
        if (distance > 1 || distance < 0.2) continue
        const behind = (TAU - Math.atan2(dy, dx)) % TAU
        if (behind > span) continue
        const alpha = (1 - behind / span) ** 2.4 * 0.17 * Math.min(1, (1 - distance) * 6) * Math.min(1, (distance - 0.2) * 6)
        const offset = (y * size + x) * 4
        image.data.set([63, 224, 255, Math.round(alpha * 255)], offset)
      }
    }
    context.putImageData(image, 0, 0)
    this.wedge = canvas
    return canvas
  }

  drawSweep(context, scene, t) {
    const { cx, cy, S } = this.geometry.orbit
    const radius = S * 0.49
    context.save()
    context.translate(cx, cy)
    context.scale(1, TILT)
    context.rotate(scene.sweep)
    context.globalCompositeOperation = "lighter"
    context.globalAlpha = 1
    context.drawImage(this.sweepSprite(), -radius, -radius, radius * 2, radius * 2)
    context.strokeStyle = "rgba(120,235,255,0.35)"
    context.lineWidth = 1.2 * this.geometry.u
    context.beginPath()
    context.moveTo(radius * 0.2, 0)
    context.lineTo(radius, 0)
    context.stroke()
    context.restore()
    context.globalCompositeOperation = "source-over"
  }

  endpoints(scene, particle) {
    const from = scene.position(particle.from, this.geometry)
    const to = scene.position(particle.to, this.geometry)
    if (!from || !to) return null
    return { from, to }
  }

  drawTethers(context, scene, t) {
    const u = this.geometry.u
    const core = { x: this.geometry.orbit.cx, y: this.geometry.orbit.cy }
    for (const node of scene.nodes.values()) {
      if (node.kind !== "session" || node.x === undefined) continue
      const parent = node.parentId && scene.nodes.has(node.parentId) ? scene.nodes.get(node.parentId) : null
      const from = parent ? { x: parent.x, y: parent.y } : core
      const to = { x: node.x, y: node.y }
      const bend = parent ? 0.12 : 0.22
      const c = control(from, to, bend)
      const alpha = (0.1 + 0.5 * node.energy) * node.appear
      const gradient = context.createLinearGradient(from.x, from.y, to.x, to.y)
      gradient.addColorStop(0, rgba(parent ? parent.color : PALETTE.cyan, alpha * 0.8))
      gradient.addColorStop(1, rgba(node.color, alpha))
      context.strokeStyle = gradient
      context.lineWidth = (parent ? 1 : 1.2) * u + 1.8 * u * node.energy
      context.globalAlpha = 1
      context.beginPath()
      context.moveTo(from.x, from.y)
      context.quadraticCurveTo(c.x, c.y, to.x, to.y)
      context.stroke()
      if (node.busy) {
        context.setLineDash([3 * u, 11 * u])
        context.lineDashOffset = t * 46 * u
        context.strokeStyle = rgba(mix(node.color, "#ffffff", 0.4), 0.55 * node.appear)
        context.lineWidth = 1.6 * u
        context.stroke()
        context.setLineDash([])
      }
    }
  }

  drawParticles(context, scene, t) {
    const u = this.geometry.u
    for (const particle of scene.particles) {
      if (t < particle.born) continue
      const ends = this.endpoints(scene, particle)
      if (!ends) continue
      const bend = (particle.to === "core" || particle.from === "core" ? 0.22 : 0.12) + particle.bend
      const c = control(ends.from, ends.to, particle.from === "core" ? bend : particle.to === "core" ? -bend : bend)
      const head = quad(ends.from.x, ends.from.y, c.x, c.y, ends.to.x, ends.to.y, particle.u)
      const fade = Math.sin(Math.PI * clamp(particle.u, 0, 1))
      const size = 5.5 * u * particle.size
      for (let tail = 4; tail >= 1; tail -= 1) {
        const point = quad(ends.from.x, ends.from.y, c.x, c.y, ends.to.x, ends.to.y, Math.max(0, particle.u - tail * 0.018))
        glow(context, particle.color, point.x, point.y, size * (1 - tail * 0.17), 0.15 * fade)
      }
      glow(context, particle.color, head.x, head.y, size * 1.5, 0.62 * fade)
      if (particle.glyph) {
        context.font = fontOf(8.5 * u, FAMILY.mono)
        context.fillStyle = mix(particle.color, "#ffffff", 0.5)
        context.globalAlpha = 0.75 * fade
        context.fillText(particle.glyph, head.x + 5 * u, head.y - 4 * u)
      }
    }
    context.globalAlpha = 1
  }

  drawCore(context, scene, t) {
    const { cx, cy, S } = this.geometry.orbit
    const u = this.geometry.u
    const R = S * 0.072
    const energy = clamp((scene.liveEnergy ?? 0) / 2.5, 0, 1)
    const flash = scene.coreFlash
    context.globalCompositeOperation = "lighter"
    glow(context, "#2a8cff", cx, cy, R * (4.2 + energy * 1.5), 0.32 + 0.25 * energy)
    glow(context, PALETTE.cyan, cx, cy, R * (2.2 + flash), 0.45 + 0.3 * energy)
    // plasma swirl
    for (let index = 0; index < 7; index += 1) {
      const angle = t * (0.9 + index * 0.23) * (index % 2 ? -1 : 1) + index
      const orbit = R * (0.18 + 0.05 * index)
      const color = [PALETTE.cyan, PALETTE.violet, "#ffffff", PALETTE.magenta][index % 4]
      glow(context, color, cx + Math.cos(angle) * orbit, cy + Math.sin(angle) * orbit * 0.8, R * 0.9, 0.22 + 0.12 * energy)
    }
    context.globalCompositeOperation = "source-over"
    // sphere
    const radius = R * (0.62 + 0.04 * Math.sin(t * 2.1) + 0.1 * flash)
    const sphere = context.createRadialGradient(cx - radius * 0.35, cy - radius * 0.4, radius * 0.05, cx, cy, radius)
    sphere.addColorStop(0, "rgba(235,252,255,0.95)")
    sphere.addColorStop(0.35, rgba(PALETTE.cyan, 0.75))
    sphere.addColorStop(1, "rgba(10,40,110,0.25)")
    context.fillStyle = sphere
    context.globalAlpha = 1
    context.beginPath()
    context.arc(cx, cy, radius, 0, TAU)
    context.fill()
    // gyroscopic rings
    context.lineWidth = 1.4 * u
    for (let index = 0; index < 3; index += 1) {
      context.save()
      context.translate(cx, cy)
      context.rotate(t * (0.35 + index * 0.21) * (index % 2 ? -1 : 1) + index * 1.1)
      context.scale(1, 0.32 + index * 0.18)
      context.strokeStyle = rgba(index === 1 ? PALETTE.violet : PALETTE.cyan, 0.55)
      context.beginPath()
      context.arc(0, 0, R * (1.15 + index * 0.22), 0, TAU)
      context.stroke()
      context.restore()
      const bead = t * (1.3 + index * 0.4) + index * 2
      const tiltAngle = t * (0.35 + index * 0.21) * (index % 2 ? -1 : 1) + index * 1.1
      const bx = Math.cos(bead) * R * (1.15 + index * 0.22)
      const by = Math.sin(bead) * R * (1.15 + index * 0.22) * (0.32 + index * 0.18)
      context.globalCompositeOperation = "lighter"
      glow(context, "#ffffff", cx + bx * Math.cos(tiltAngle) - by * Math.sin(tiltAngle), cy + bx * Math.sin(tiltAngle) + by * Math.cos(tiltAngle), 7 * u, 0.9)
      context.globalCompositeOperation = "source-over"
    }
    // tick ring and arc segments
    context.save()
    context.translate(cx, cy)
    context.rotate(t * 0.12)
    for (let tick = 0; tick < 72; tick += 1) {
      const angle = (tick / 72) * TAU
      const long = tick % 6 === 0
      context.strokeStyle = rgba(PALETTE.cyan, long ? 0.6 : 0.22)
      context.lineWidth = (long ? 1.6 : 1) * u
      context.beginPath()
      context.moveTo(Math.cos(angle) * R * 1.9, Math.sin(angle) * R * 1.9)
      context.lineTo(Math.cos(angle) * R * (long ? 2.08 : 2.0), Math.sin(angle) * R * (long ? 2.08 : 2.0))
      context.stroke()
    }
    context.rotate(-t * 0.5)
    context.lineWidth = 3 * u
    context.strokeStyle = rgba(PALETTE.cyan, 0.5 + 0.4 * energy)
    for (let segment = 0; segment < 3; segment += 1) {
      context.beginPath()
      context.arc(0, 0, R * 1.68, (segment / 3) * TAU, (segment / 3) * TAU + 1.2 + 0.6 * energy)
      context.stroke()
    }
    context.restore()
    text(context, "OPENCODE", cx, cy + R * 2.5, { size: 11 * u, family: FAMILY.mono, color: PALETTE.cyan, alpha: 0.75, align: "center", spacing: 4 * u })
  }

  drawOrbits(context, scene, t) {
    const u = this.geometry.u
    for (const root of scene.roots ?? []) {
      if (root.x === undefined) continue
      const kids = scene.children?.get(root.id)
      if (kids?.length) {
        const orbit = kids[0].orbit ?? this.geometry.orbit.S * 0.07
        context.strokeStyle = rgba(root.color, 0.18 * root.appear)
        context.lineWidth = u
        context.setLineDash([2 * u, 4 * u])
        context.lineDashOffset = -t * 8 * u
        context.beginPath()
        context.ellipse(root.x, root.y, orbit, orbit * TILT, 0, 0, TAU)
        context.stroke()
        context.setLineDash([])
      }
      if (root.busy) {
        const r = this.nodeRadius(root) * 1.9
        const spin = t * 0.9 + root.order
        context.save()
        context.translate(root.x, root.y)
        context.rotate(0.5 + Math.sin(t * 0.3 + root.order) * 0.3)
        context.scale(1, 0.34)
        context.strokeStyle = rgba(mix(root.color, "#ffffff", 0.3), 0.5 * root.appear)
        context.lineWidth = 1.3 * u
        context.beginPath()
        context.arc(0, 0, r, 0, TAU)
        context.stroke()
        context.restore()
        const bx = Math.cos(spin) * r
        const by = Math.sin(spin) * r * 0.34
        const tilt = 0.5 + Math.sin(t * 0.3 + root.order) * 0.3
        context.globalCompositeOperation = "lighter"
        glow(context, "#ffffff", root.x + bx * Math.cos(tilt) - by * Math.sin(tilt), root.y + bx * Math.sin(tilt) + by * Math.cos(tilt), 6 * u, 0.9)
        context.globalCompositeOperation = "source-over"
        context.globalAlpha = 1
      }
    }
  }

  nodeRadius(node) {
    const S = this.geometry.orbit.S
    const base = node.level ? S * (node.level === 1 ? 0.016 : 0.011) : S * 0.027
    return base * node.depthScale * (0.6 + 0.4 * node.appear) * (1 + 0.12 * node.energy)
  }

  drawNodes(context, scene, t, front) {
    const u = this.geometry.u
    const nodes = [...scene.nodes.values()].filter((node) => node.kind === "session" && node.x !== undefined)
    nodes.sort((a, b) => a.y - b.y)
    for (const node of nodes) {
      const isFront = !node.level || Math.sin(node.angle) >= 0
      if (isFront !== front) continue
      const r = this.nodeRadius(node)
      const alpha = node.appear * (node.level && !isFront ? 0.6 : 1)
      const blink = node.blocked ? 0.5 + 0.5 * Math.sin(t * 7) : 0
      const color = node.blocked ? mix(node.color, PALETTE.amber, 0.7) : node.color
      context.globalCompositeOperation = "lighter"
      glow(context, color, node.x, node.y, r * (3.4 + 2.2 * node.energy + 1.6 * node.pulse + blink), (0.18 + 0.5 * node.energy + 0.3 * node.pulse) * alpha)
      context.globalCompositeOperation = "source-over"
      const sphere = context.createRadialGradient(node.x - r * 0.35, node.y - r * 0.4, r * 0.05, node.x, node.y, r)
      sphere.addColorStop(0, rgba(mix(color, "#ffffff", 0.75), alpha))
      sphere.addColorStop(0.45, rgba(color, alpha * (0.55 + 0.45 * node.energy)))
      sphere.addColorStop(1, rgba(mix(color, "#000000", 0.7), alpha * 0.9))
      context.fillStyle = sphere
      context.globalAlpha = 1
      context.beginPath()
      context.arc(node.x, node.y, r, 0, TAU)
      context.fill()
      context.strokeStyle = rgba(color, 0.85 * alpha)
      context.lineWidth = 1.2 * u
      context.stroke()
      if (node.busy) {
        context.lineWidth = 2 * u
        context.strokeStyle = rgba(mix(color, "#ffffff", 0.3), 0.9 * alpha)
        const spin = t * (node.level ? 2.6 : 1.8)
        for (let arc = 0; arc < 3; arc += 1) {
          context.beginPath()
          context.arc(node.x, node.y, r + 5 * u, spin + (arc / 3) * TAU, spin + (arc / 3) * TAU + 1.25)
          context.stroke()
        }
        if (!node.level) {
          context.setLineDash([2 * u, 5 * u])
          context.lineDashOffset = -t * 20 * u
          context.strokeStyle = rgba(color, 0.45 * alpha)
          context.lineWidth = 1 * u
          context.beginPath()
          context.arc(node.x, node.y, r + 11 * u, 0, TAU)
          context.stroke()
          context.setLineDash([])
        }
      }
      if (node.blocked) {
        const size = r + 14 * u + 3 * u * blink
        context.strokeStyle = rgba(PALETTE.amber, (0.5 + 0.5 * blink) * alpha)
        context.lineWidth = 2 * u
        context.beginPath()
        for (let corner = 0; corner < 3; corner += 1) {
          const angle = -Math.PI / 2 + (corner / 3) * TAU
          const px = node.x + Math.cos(angle) * size
          const py = node.y + Math.sin(angle) * size
          if (corner === 0) context.moveTo(px, py)
          else context.lineTo(px, py)
        }
        context.closePath()
        context.stroke()
      }
      if (node.failedAt && t - node.failedAt < 6) {
        const fade = 1 - (t - node.failedAt) / 6
        context.strokeStyle = rgba(PALETTE.red, fade * alpha)
        context.lineWidth = 2.4 * u
        context.setLineDash([4 * u, 3 * u])
        context.beginPath()
        context.arc(node.x, node.y, r + 8 * u, 0, TAU)
        context.stroke()
        context.setLineDash([])
      }
      this.drawSatellites(context, scene, node, t)
    }
  }

  drawSatellites(context, scene, node, t) {
    const u = this.geometry.u
    for (const tool of node.tools.values()) {
      if (tool.endAt && t - tool.endAt > 1.2) continue
      const point = scene.satellite(node, tool, this.geometry)
      const age = t - tool.start
      const grow = clamp(age / 0.35, 0, 1)
      const fade = tool.endAt ? clamp(1 - (t - tool.endAt) / 1.2, 0, 1) : 1
      const [icon, toolColor] = toolMeta(tool.name)
      const color = tool.endAt ? (tool.ok ? PALETTE.green : PALETTE.red) : toolColor
      const r = (node.level ? 7 : 10) * u * grow
      if (r <= 0.5) continue
      context.globalAlpha = 0.5 * fade
      context.strokeStyle = rgba(color, 0.5 * fade)
      context.lineWidth = u
      context.beginPath()
      context.moveTo(node.x, node.y)
      context.lineTo(point.x, point.y)
      context.stroke()
      context.globalCompositeOperation = "lighter"
      glow(context, color, point.x, point.y, r * 3, 0.35 * fade)
      context.globalCompositeOperation = "source-over"
      context.globalAlpha = 1
      hexagon(context, point.x, point.y, r, t * 0.8)
      context.fillStyle = rgba("#03101f", 0.85 * fade)
      context.fill()
      context.strokeStyle = rgba(color, 0.95 * fade)
      context.lineWidth = 1.4 * u
      context.stroke()
      if (!tool.endAt) {
        context.strokeStyle = rgba(color, 0.7)
        context.lineWidth = 1.2 * u
        context.beginPath()
        context.arc(point.x, point.y, r + 4 * u, t * 4, t * 4 + 2)
        context.stroke()
      }
      text(context, tool.endAt ? (tool.ok ? "" : "") : icon, point.x, point.y + 0.5 * u, {
        size: r * 1.05,
        family: FAMILY.mono,
        color,
        alpha: fade,
        align: "center",
        baseline: "middle",
      })
    }
  }

  drawRings(context, scene, t) {
    const u = this.geometry.u
    for (const ring of scene.rings) {
      const node = ring.follow ? scene.nodes.get(ring.follow) : null
      const x = node ? node.x : ring.x
      const y = node ? node.y : ring.y
      if (x === undefined) continue
      const k = clamp((t - ring.born) / ring.life, 0, 1)
      const radius = (ring.from + (ring.to - ring.from) * (1 - (1 - k) ** 3)) * u
      context.strokeStyle = rgba(ring.color, (1 - k) ** 1.6 * 0.9)
      context.lineWidth = ring.width * u * (1 - k * 0.5)
      context.globalAlpha = 1
      context.beginPath()
      context.ellipse(x, y, radius, radius * 0.85, 0, 0, TAU)
      context.stroke()
    }
  }

  drawPackets(context, scene, t) {
    const u = this.geometry.u
    context.globalCompositeOperation = "lighter"
    for (const packet of scene.packets) {
      const node = scene.nodes.get(packet.node)
      const tool = node?.tools.get(packet.tool)
      if (!node || !tool || node.x === undefined) continue
      const sat = scene.satellite(node, tool, this.geometry)
      const k = clamp(packet.u, 0, 1)
      const from = packet.kind === "out" ? node : sat
      const to = packet.kind === "out" ? sat : node
      for (let trail = 6; trail >= 0; trail -= 1) {
        const p = clamp(k - trail * 0.045, 0, 1)
        const x = from.x + (to.x - from.x) * p
        const y = from.y + (to.y - from.y) * p
        glow(context, packet.color, x, y, (7 - trail * 0.8) * u, (trail === 0 ? 0.95 : 0.3) * (1 - clamp(packet.u - 1, 0, 1) * 4))
      }
    }
    context.globalCompositeOperation = "source-over"
    context.globalAlpha = 1
  }

  bloom() {
    const quarter = this.bloomQuarter.getContext("2d")
    const tenth = this.bloomEighth.getContext("2d")
    quarter.globalCompositeOperation = "copy"
    quarter.imageSmoothingEnabled = true
    quarter.drawImage(this.canvas, 0, 0, this.bloomQuarter.width, this.bloomQuarter.height)
    tenth.globalCompositeOperation = "copy"
    tenth.imageSmoothingEnabled = true
    tenth.drawImage(this.bloomQuarter, 0, 0, this.bloomEighth.width, this.bloomEighth.height)
    const context = this.context
    context.globalCompositeOperation = "lighter"
    context.imageSmoothingEnabled = true
    context.globalAlpha = 0.13
    context.drawImage(this.bloomQuarter, 0, 0, this.W, this.H)
    context.globalAlpha = 0.3
    context.drawImage(this.bloomEighth, 0, 0, this.W, this.H)
    context.globalAlpha = 1
    context.globalCompositeOperation = "source-over"
  }

  stateLine(node, t) {
    if (node.blocked) return { text: "⚠ AWAITING YOUR INPUT", color: PALETTE.amber }
    const running = [...node.tools.values()].filter((tool) => !tool.endAt)
    if (node.busy) {
      const elapsed = node.busySince ? durationOf(t - node.busySince) : ""
      if (running.length) {
        const tool = running[running.length - 1]
        const [icon] = toolMeta(tool.name)
        return { text: `${icon} ${tool.name} ${tool.label ?? ""}`.trim(), color: toolMeta(tool.name)[1], prefix: elapsed }
      }
      return { text: `▶ WORKING ${elapsed}`, color: mix(node.color, "#ffffff", 0.35) }
    }
    if (node.outcome === "failed") return { text: `✖ FAILED · ${agoOf(this.wallNow - node.updated)} ago`, color: PALETTE.red }
    return { text: `IDLE ${agoOf(this.wallNow - node.updated)} · ${moneyOf(node.cost ?? 0)}`, color: PALETTE.dim }
  }

  drawLabels(context, scene, t) {
    const u = this.geometry.u
    const { cx, cy, S } = this.geometry.orbit
    this.wallNow = scene.wall
    const placed = []
    const overlaps = (box) => placed.some((other) => box.x < other.x + other.w && other.x < box.x + box.w && box.y < other.y + other.h && other.y < box.y + box.h)
    // the core, its caption and every node are no-go areas for labels
    const coreR = S * 0.072 * 2.15
    placed.push({ x: cx - coreR, y: cy - coreR * 0.9, w: coreR * 2, h: coreR * 1.9 + 16 * u })
    for (const node of scene.nodes.values()) {
      if (node.kind !== "session" || node.x === undefined || node.appear <= 0.02) continue
      const r = this.nodeRadius(node) + 5 * u
      placed.push({ x: node.x - r, y: node.y - r, w: r * 2, h: r * 2 })
    }
    const labelOrder = [...(scene.roots ?? [])].sort((a, b) => (b.busy || b.blocked ? 1 : 0) - (a.busy || a.blocked ? 1 : 0))
    for (const node of labelOrder) {
      if (node.x === undefined || node.appear <= 0.02) continue
      const r = this.nodeRadius(node)
      const dx = Math.cos(node.angle)
      const dy = Math.sin(node.angle)
      const reach = r + (node.moons ? S * 0.07 + 12 * u : 14 * u)
      const width = Math.min(S * 0.25, 250 * u)
      const lineHeight = 15 * u
      const height = 3 * lineHeight + 8 * u
      const plateW = width + 10 * u
      const guard = { x: node.x - reach, y: node.y - reach * TILT, w: reach * 2, h: reach * 2 * TILT }
      const fits = (box) => box.x >= 4 * u && box.x + box.w <= this.W - 4 * u
      // try beside the node on its outer side, then below or above it, then the inner side;
      // the first spot that stays on screen and clear of the node and of other labels wins
      const intersects = (one, two) => one.x < two.x + two.w && two.x < one.x + one.w && one.y < two.y + two.h && two.y < one.y + one.h
      const besideOuter = { box: { x: dx >= 0 ? node.x + reach : node.x - reach - plateW, y: node.y - height / 2, w: plateW, h: height }, align: dx >= 0 ? "left" : "right" }
      const besideInner = { box: { x: dx >= 0 ? node.x - reach - plateW : node.x + reach, y: node.y - height / 2, w: plateW, h: height }, align: dx >= 0 ? "right" : "left" }
      const centred = (below) => ({
        box: { x: clamp(node.x - plateW / 2, 4 * u, this.W - plateW - 4 * u), y: below ? node.y + reach * TILT + 2 * u : node.y - reach * TILT - height - 2 * u, w: plateW, h: height },
        align: "center",
      })
      const shifted = (candidate, by) => ({ box: { ...candidate.box, y: candidate.box.y + by }, align: candidate.align })
      const candidates = [
        ...(Math.abs(dx) < 0.35 ? [centred(dy >= 0), centred(dy < 0), besideOuter] : [besideOuter, centred(dy >= 0), centred(dy < 0)]),
        shifted(besideOuter, -height * 0.75),
        shifted(besideOuter, height * 0.75),
        besideInner,
        shifted(besideInner, -height * 0.75),
        shifted(besideInner, height * 0.75),
      ]
      const area = (one, two) => Math.max(0, Math.min(one.x + one.w, two.x + two.w) - Math.max(one.x, two.x)) * Math.max(0, Math.min(one.y + one.h, two.y + two.h) - Math.max(one.y, two.y))
      const cost = (candidate, index) => {
        const box = candidate.box
        const offscreen = !fits(box) || box.y < this.geometry.top || box.y + height > this.geometry.orbit.y + this.geometry.orbit.h
        return (offscreen ? 1e9 : 0) + (intersects(box, guard) ? 1e6 : 0) + placed.reduce((sum, other) => sum + area(box, other), 0) * 10 + index
      }
      const chosen = candidates.map((candidate, index) => ({ candidate, score: cost(candidate, index) })).sort((a, b) => a.score - b.score)[0].candidate
      let box = { ...chosen.box }
      const align = chosen.align
      box.y = clamp(box.y, this.geometry.top + 4 * u, this.geometry.orbit.y + this.geometry.orbit.h - height)
      placed.push(box)
      const alpha = node.appear * (node.busy || node.blocked ? 1 : 0.8)
      context.globalAlpha = alpha
      context.fillStyle = "rgba(3,10,22,0.62)"
      roundRect(context, box.x, box.y, box.w, box.h, 4 * u)
      context.fill()
      context.fillStyle = rgba(node.color, 0.9 * alpha)
      if (align === "right") context.fillRect(box.x + box.w - 2 * u, box.y + 3 * u, 2 * u, box.h - 6 * u)
      else if (align === "left") context.fillRect(box.x, box.y + 3 * u, 2 * u, box.h - 6 * u)
      else context.fillRect(box.x + 3 * u, box.y, box.w - 6 * u, 1.5 * u)
      const textX = align === "left" ? box.x + 8 * u : align === "right" ? box.x + box.w - 8 * u : box.x + box.w / 2
      const y = box.y
      context.font = fontOf(15.5 * u, FAMILY.label, "600")
      const title = fit(context, node.title ?? "", width - 6 * u)
      text(context, title, textX, y + lineHeight, { size: 15.5 * u, weight: "600", color: node.busy || node.blocked ? PALETTE.text : PALETTE.soft, alpha, align })
      const meta = [node.agent, `${shortModel(node.model)}${node.variant ? ` ${node.variant}` : ""}`, node.account && node.account !== "default" ? `@${node.account}` : "", node.pane]
        .filter(Boolean)
        .join(" · ")
      context.font = fontOf(11.5 * u, FAMILY.mono)
      text(context, fit(context, meta, width - 6 * u), textX, y + lineHeight * 2, { size: 11.5 * u, family: FAMILY.mono, color: node.color, alpha, align })
      const state = this.stateLine(node, t)
      context.font = fontOf(11.5 * u, FAMILY.mono)
      const stateText = state.prefix ? `${state.prefix} ${state.text}` : state.text
      text(context, fit(context, stateText, width - 6 * u), textX, y + lineHeight * 3, { size: 11.5 * u, family: FAMILY.mono, color: state.color, alpha, align })
    }
    // moons: one small line each, pointing away from the parent
    for (const node of scene.nodes.values()) {
      if (!node.level || node.x === undefined || node.appear <= 0.02) continue
      const parent = scene.nodes.get(node.parentId)
      if (!parent) continue
      const crowd = scene.children?.get(node.parentId)?.length ?? 1
      if (!node.busy && !node.blocked && crowd > 3) continue
      const dx = node.x - parent.x
      const dy = node.y - parent.y
      const length = Math.hypot(dx, dy) || 1
      const r = this.nodeRadius(node)
      const x = node.x + (dx / length) * (r + 6 * u)
      const y = node.y + (dy / length) * (r + 6 * u)
      const align = dx >= 0 ? "left" : "right"
      const label = `${node.agent || "subagent"} · ${shortModel(node.model)}`
      const running = [...node.tools.values()].filter((tool) => !tool.endAt)
      const sub = node.blocked ? "⚠ waiting" : running.length ? `${toolMeta(running.at(-1).name)[0]} ${running.at(-1).name}` : node.busy ? `▶ ${node.busySince ? durationOf(t - node.busySince) : ""}` : "done"
      const alpha = node.appear * (Math.sin(node.angle) >= 0 ? 1 : 0.65)
      context.font = fontOf(10.5 * u, FAMILY.mono)
      const width = Math.max(context.measureText(label).width, context.measureText(sub).width) + 8 * u
      const box = { x: align === "left" ? x - 3 * u : x - width + 3 * u, y: y - 11 * u, w: width, h: 26 * u }
      if (overlaps(box)) continue
      placed.push(box)
      context.globalAlpha = alpha
      context.fillStyle = "rgba(3,10,22,0.55)"
      roundRect(context, align === "left" ? x - 3 * u : x - width + 3 * u, y - 11 * u, width, 26 * u, 3 * u)
      context.fill()
      text(context, label, x, y, { size: 10.5 * u, family: FAMILY.mono, color: node.color, alpha, align })
      text(context, sub, x, y + 12 * u, { size: 10 * u, family: FAMILY.mono, color: node.busy ? PALETTE.soft : PALETTE.dim, alpha, align })
    }
    if (!(scene.roots ?? []).length) {
      text(context, "SCANNING FOR SESSIONS", cx, cy + S * 0.22, { size: 14 * u, family: FAMILY.mono, color: PALETTE.cyan, alpha: 0.5 + 0.4 * Math.sin(t * 3), align: "center", spacing: 4 * u })
    }
  }

  panel(context, x, y, w, h, title, accent = PALETTE.cyan, t = 0) {
    const u = this.geometry.u
    context.globalCompositeOperation = "source-over"
    context.globalAlpha = 1
    context.fillStyle = "rgba(5,14,30,0.66)"
    roundRect(context, x, y, w, h, 5 * u)
    context.fill()
    context.strokeStyle = rgba(accent, 0.2)
    context.lineWidth = Math.max(1, u)
    context.stroke()
    const c = 11 * u
    context.strokeStyle = rgba(accent, 0.85)
    context.lineWidth = 1.6 * u
    context.beginPath()
    context.moveTo(x, y + c)
    context.lineTo(x, y)
    context.lineTo(x + c, y)
    context.moveTo(x + w - c, y)
    context.lineTo(x + w, y)
    context.lineTo(x + w, y + c)
    context.moveTo(x + w, y + h - c)
    context.lineTo(x + w, y + h)
    context.lineTo(x + w - c, y + h)
    context.moveTo(x + c, y + h)
    context.lineTo(x, y + h)
    context.lineTo(x, y + h - c)
    context.stroke()
    if (title) {
      text(context, title.toUpperCase(), x + 12 * u, y + 17 * u, { size: 10.5 * u, family: FAMILY.mono, color: accent, alpha: 0.9, spacing: 2.2 * u })
      context.globalCompositeOperation = "lighter"
      glow(context, accent, x + w - 14 * u, y + 13 * u, 6 * u, 0.5 + 0.4 * Math.sin(t * 3 + x))
      context.globalCompositeOperation = "source-over"
      context.globalAlpha = 1
    }
  }

  spark(context, series, x, y, w, h, color) {
    let max = 0
    for (const value of series) max = Math.max(max, value)
    if (max <= 0) max = 1
    const step = w / (series.length - 1)
    context.beginPath()
    series.forEach((value, index) => {
      const px = x + index * step
      const py = y + h - (value / max) * h
      if (index === 0) context.moveTo(px, py)
      else context.lineTo(px, py)
    })
    context.strokeStyle = rgba(color, 0.9)
    context.lineWidth = 1.3 * this.geometry.u
    context.globalAlpha = 1
    context.stroke()
    context.lineTo(x + w, y + h)
    context.lineTo(x, y + h)
    context.closePath()
    context.save()
    context.clip()
    const [r, g, b] = hexToRgb(color)
    context.drawImage(verticalStrip(`spark${color}`, [[0, [r, g, b, 0.3]], [1, [r, g, b, 0]]]), x, y, w, h)
    context.restore()
  }

  drawTelemetry(context, scene, t) {
    const u = this.geometry.u
    const { x, y, w, h } = this.geometry.telemetry
    const stats = scene.stats(t)
    const gap = 10 * u
    // tiles
    const tiles = [
      { label: "ACTIVE THREADS", value: `${stats.threadsBusy}`, sub: `of ${stats.threads} shown${scene.snapshot.hidden ? ` · +${scene.snapshot.hidden}` : ""}`, color: PALETTE.cyan, series: scene.series.threads },
      { label: "SUBAGENTS LIVE", value: `${stats.subagentsBusy}`, sub: `${stats.subagents} in orbit`, color: PALETTE.magenta, series: scene.series.subagents },
      { label: "TOOL CALLS / MIN", value: `${stats.toolsPerMinute}`, sub: stats.blocked ? `${stats.blocked} awaiting you` : "last 60 s", color: stats.blocked ? PALETTE.amber : PALETTE.green, series: scene.series.tools },
      { label: stats.tokensMeasured ? "OUTPUT TOK / S" : "≈ OUTPUT TOK / S", value: compactOf(stats.tokensPerSecond), sub: stats.tokensMeasured ? "per API call, 15 s" : "from step text", color: PALETTE.violet, series: scene.series.tokens },
      { label: "COST · 24H", value: moneyOf(stats.cost), sub: `${stats.costSessions} sessions touched`, color: PALETTE.amber, series: scene.series.cost },
    ]
    const columns = w > 900 * u ? 5 : 3
    const rowsOfTiles = Math.ceil(tiles.length / columns)
    const tileW = (w - gap * (columns - 1)) / columns
    const tileH = 84 * u
    tiles.forEach((tile, index) => {
      const column = index % columns
      const row = Math.floor(index / columns)
      const tx = x + column * (tileW + gap)
      const ty = y + row * (tileH + gap)
      this.panel(context, tx, ty, tileW, tileH, "", tile.color, t)
      text(context, tile.label, tx + 11 * u, ty + 18 * u, { size: 9.5 * u, family: FAMILY.mono, color: tile.color, alpha: 0.9, spacing: 1.6 * u })
      text(context, tile.value, tx + 11 * u, ty + 54 * u, { size: 38 * u, family: FAMILY.display, color: PALETTE.text, alpha: 1 })
      context.font = fontOf(9.5 * u, FAMILY.mono)
      text(context, fit(context, tile.sub, tileW - 22 * u), tx + 11 * u, ty + 73 * u, { size: 9.5 * u, family: FAMILY.mono, color: PALETTE.dim })
      this.spark(context, tile.series, tx + tileW * 0.46, ty + 30 * u, tileW * 0.48, 30 * u, tile.color)
    })
    let cursor = y + rowsOfTiles * (tileH + gap)
    // stream scope
    const scopeH = Math.max(110 * u, (h - (cursor - y)) * 0.36)
    this.drawScope(context, scene, t, x, cursor, w, scopeH)
    cursor += scopeH + gap
    const restH = y + h - cursor
    if (restH < 60 * u) return
    const logW = w * 0.6
    this.drawLog(context, scene, t, x, cursor, logW - gap / 2, restH)
    this.drawAccounts(context, scene, t, x + logW + gap / 2, cursor, w - logW - gap / 2, restH)
  }

  drawScope(context, scene, t, x, y, w, h) {
    const u = this.geometry.u
    this.panel(context, x, y, w, h, "stream activity · last 2 min", PALETTE.cyan, t)
    const plotX = x + 12 * u
    const plotY = y + 28 * u
    const plotW = w - 150 * u
    const plotH = h - 40 * u
    context.strokeStyle = rgba(PALETTE.cyan, 0.08)
    context.lineWidth = u
    for (let line = 0; line <= 4; line += 1) {
      const ly = plotY + (line / 4) * plotH
      context.beginPath()
      context.moveTo(plotX, ly)
      context.lineTo(plotX + plotW, ly)
      context.stroke()
    }
    for (let second = 0; second <= 120; second += 30) {
      const lx = plotX + plotW - (second / 120) * plotW
      context.beginPath()
      context.moveTo(lx, plotY)
      context.lineTo(lx, plotY + plotH)
      context.stroke()
      text(context, second ? `-${second}s` : "now", lx, plotY + plotH + 11 * u, { size: 8.5 * u, family: FAMILY.mono, color: PALETTE.dim, align: "center" })
    }
    const nodes = [...scene.nodes.values()]
      .filter((node) => node.kind === "session")
      .sort((a, b) => b.historySum - a.historySum)
      .slice(0, 6)
      .filter((node) => node.historySum > 0)
    let max = 200
    for (const node of nodes) for (const value of node.history) max = Math.max(max, value)
    const step = plotW / (HISTORY - 1)
    const scale = (value) => plotY + plotH - Math.sqrt(value / max) * plotH * 0.95
    nodes.forEach((node, rank) => {
      let first = node.history.findIndex((value) => value > 0)
      if (first < 0) first = HISTORY - 1
      first = Math.max(0, first - 1)
      context.beginPath()
      for (let index = first; index < HISTORY; index += 1) {
        const px = plotX + index * step
        const py = scale(node.history[index])
        if (index === first) context.moveTo(px, py)
        else context.lineTo(px, py)
      }
      if (rank === 0) {
        context.save()
        context.lineTo(plotX + plotW, plotY + plotH)
        context.lineTo(plotX + first * step, plotY + plotH)
        context.closePath()
        context.clip()
        const [r, g, b] = hexToRgb(node.color)
        context.drawImage(verticalStrip(`scope${node.color}`, [[0, [r, g, b, 0.28]], [1, [r, g, b, 0]]]), plotX, plotY, plotW, plotH)
        context.restore()
        context.beginPath()
        for (let index = first; index < HISTORY; index += 1) {
          const px = plotX + index * step
          const py = scale(node.history[index])
          if (index === first) context.moveTo(px, py)
          else context.lineTo(px, py)
        }
      }
      context.globalCompositeOperation = "lighter"
      context.strokeStyle = rgba(node.color, 0.25)
      context.lineWidth = 5 * u
      context.stroke()
      context.strokeStyle = rgba(mix(node.color, "#ffffff", 0.25), 0.95)
      context.lineWidth = 1.5 * u
      context.stroke()
      context.globalCompositeOperation = "source-over"
      const endY = scale(node.history[HISTORY - 1])
      context.globalCompositeOperation = "lighter"
      glow(context, node.color, plotX + plotW, endY, 9 * u, 0.9)
      context.globalCompositeOperation = "source-over"
      const labelY = plotY + 12 * u + rank * ((plotH - 4 * u) / 6)
      context.font = fontOf(10 * u, FAMILY.mono)
      text(context, fit(context, `${node.agent || "?"}·${shortModel(node.model)}`, 128 * u), plotX + plotW + 14 * u, labelY, { size: 10 * u, family: FAMILY.mono, color: node.color })
    })
    if (!nodes.length) text(context, "no stream activity yet", plotX + plotW / 2, plotY + plotH / 2, { size: 11 * u, family: FAMILY.mono, color: PALETTE.dim, align: "center" })
    // the scan line
    const scanX = plotX + plotW - ((t * 30) % plotW)
    context.globalCompositeOperation = "lighter"
    const scan = context.createLinearGradient(scanX - 40 * u, 0, scanX, 0)
    scan.addColorStop(0, "rgba(63,224,255,0)")
    scan.addColorStop(1, "rgba(63,224,255,0.08)")
    context.fillStyle = scan
    context.globalAlpha = 1
    context.fillRect(scanX - 40 * u, plotY, 40 * u, plotH)
    context.globalCompositeOperation = "source-over"
  }

  drawLog(context, scene, t, x, y, w, h) {
    const u = this.geometry.u
    this.panel(context, x, y, w, h, "event stream", PALETTE.green, t)
    const lineHeight = 17 * u
    const rows = Math.floor((h - 30 * u) / lineHeight)
    scene.log.slice(0, rows).forEach((entry, index) => {
      const ly = y + 34 * u + index * lineHeight
      const age = t - entry.t
      const reveal = clamp(age / 0.45, 0, 1)
      const alpha = clamp(1 - index / (rows + 2), 0.25, 1)
      if (index === 0 && age < 1.5) {
        context.globalCompositeOperation = "lighter"
        context.fillStyle = rgba(entry.color, 0.12 * (1 - age / 1.5))
        context.globalAlpha = 1
        context.fillRect(x + 4 * u, ly - 12 * u, w - 8 * u, lineHeight)
        context.globalCompositeOperation = "source-over"
      }
      text(context, clockOf(entry.wall), x + 11 * u, ly, { size: 10 * u, family: FAMILY.mono, color: PALETTE.dim, alpha })
      let status = ""
      let statusColor = PALETTE.dim
      if (entry.tool) {
        if (!entry.tool.endAt && !entry.tool.pendingEnd) {
          status = "…"
          statusColor = PALETTE.cyan
        } else if (entry.tool.ok) {
          status = ""
          statusColor = PALETTE.green
        } else {
          status = ""
          statusColor = PALETTE.red
        }
      }
      text(context, entry.icon, x + 80 * u, ly, { size: 11 * u, family: FAMILY.mono, color: entry.color, alpha })
      context.font = fontOf(10.5 * u, FAMILY.mono)
      const who = fit(context, entry.who ?? "", 112 * u)
      text(context, who, x + 96 * u, ly, { size: 10.5 * u, family: FAMILY.mono, color: PALETTE.soft, alpha })
      const body = `${entry.text}${entry.detail ? `  ${entry.detail}` : ""}`
      const visible = body.slice(0, Math.ceil(body.length * reveal))
      context.font = fontOf(10.5 * u, FAMILY.mono)
      text(context, fit(context, visible, w - 250 * u), x + 214 * u, ly, { size: 10.5 * u, family: FAMILY.mono, color: index === 0 ? PALETTE.text : PALETTE.soft, alpha })
      if (status) text(context, status, x + w - 14 * u, ly, { size: 11 * u, family: FAMILY.mono, color: statusColor, alpha, align: "right" })
      if (index === 0 && reveal < 1) {
        context.font = fontOf(10.5 * u, FAMILY.mono)
        const cursorX = x + 214 * u + context.measureText(visible).width + 2 * u
        context.fillStyle = PALETTE.cyan
        context.globalAlpha = 1
        context.fillRect(cursorX, ly - 10 * u, 6 * u, 12 * u)
      }
    })
    if (!scene.log.length) text(context, "waiting for the first event…", x + 12 * u, y + 40 * u, { size: 10.5 * u, family: FAMILY.mono, color: PALETTE.dim })
  }

  drawAccounts(context, scene, t, x, y, w, h) {
    const u = this.geometry.u
    this.panel(context, x, y, w, h, "accounts · stations", PALETTE.violet, t)
    let cursor = y + 30 * u
    const usage = scene.snapshot.usage ?? []
    for (const account of usage.slice(0, 3)) {
      if (cursor + 58 * u > y + h) break
      const gx = x + 34 * u
      const gy = cursor + 26 * u
      const ring = (window, radius, width) => {
        context.strokeStyle = rgba(PALETTE.faint, 0.9)
        context.lineWidth = width
        context.beginPath()
        context.arc(gx, gy, radius, Math.PI * 0.75, Math.PI * 2.25)
        context.stroke()
        if (!window) return
        const used = window.used ?? 0
        const limited = /reject|limited/.test(window.status ?? "")
        const color = limited || used >= 90 ? PALETTE.red : used >= 75 ? PALETTE.amber : PALETTE.green
        context.strokeStyle = color
        context.globalCompositeOperation = "lighter"
        context.beginPath()
        context.arc(gx, gy, radius, Math.PI * 0.75, Math.PI * 0.75 + Math.PI * 1.5 * clamp((limited ? 100 : used) / 100, 0.001, 1))
        context.stroke()
        context.globalCompositeOperation = "source-over"
      }
      ring(account.five, 21 * u, 4 * u)
      ring(account.seven, 14 * u, 3 * u)
      const left = (window) => (!window ? "no reading" : window.used === null ? "ok" : `${Math.round(100 - window.used)}% left`)
      const resets = (window) => (window?.resetsAt ? ` ↻ ${new Date(window.resetsAt).toDateString() === new Date(scene.wall).toDateString() ? clockOf(window.resetsAt).slice(0, 5) : `${pad2(new Date(window.resetsAt).getMonth() + 1)}-${pad2(new Date(window.resetsAt).getDate())}`}` : "")
      text(context, `${account.account.toUpperCase()}${account.tier ? ` · ${account.tier}` : ""}`, x + 66 * u, cursor + 12 * u, { size: 11 * u, family: FAMILY.mono, color: PALETTE.text })
      context.font = fontOf(10 * u, FAMILY.mono)
      text(context, fit(context, `5h ${left(account.five)}${resets(account.five)}`, w - 74 * u), x + 66 * u, cursor + 27 * u, { size: 10 * u, family: FAMILY.mono, color: PALETTE.soft })
      text(context, fit(context, `7d ${left(account.seven)}${resets(account.seven)}`, w - 74 * u), x + 66 * u, cursor + 41 * u, { size: 10 * u, family: FAMILY.mono, color: PALETTE.dim })
      cursor += 58 * u
    }
    const externals = scene.snapshot.externals ?? []
    if (!externals.length || cursor + 24 * u > y + h) return
    cursor += 4 * u
    text(context, `HERDR STATIONS · ${externals.length}`, x + 12 * u, cursor + 8 * u, { size: 9.5 * u, family: FAMILY.mono, color: PALETTE.violet, alpha: 0.9, spacing: 1.5 * u })
    cursor += 16 * u
    const rowH = 15 * u
    const order = { blocked: 0, working: 1, done: 2, idle: 3 }
    const sorted = [...externals].sort((a, b) => (order[a.status] ?? 4) - (order[b.status] ?? 4))
    for (const entry of sorted) {
      if (cursor + rowH > y + h - 6 * u) break
      const color = entry.status === "working" ? PALETTE.cyan : entry.status === "blocked" ? PALETTE.amber : entry.status === "done" ? PALETTE.green : PALETTE.dim
      context.globalCompositeOperation = "lighter"
      glow(context, color, x + 17 * u, cursor + 4 * u, (entry.status === "working" ? 7 + 2 * Math.sin(t * 5 + cursor) : 5) * u, entry.status === "idle" ? 0.4 : 0.95)
      context.globalCompositeOperation = "source-over"
      context.font = fontOf(10 * u, FAMILY.mono)
      text(context, fit(context, `${entry.kind} ${entry.pane}  ${entry.title}`, w - 40 * u), x + 28 * u, cursor + 8 * u, { size: 10 * u, family: FAMILY.mono, color: entry.status === "idle" ? PALETTE.dim : PALETTE.soft })
      cursor += rowH
    }
  }

  drawTopBar(context, scene, t, info) {
    const u = this.geometry.u
    const top = this.geometry.top
    const W = this.W
    context.globalCompositeOperation = "source-over"
    context.globalAlpha = 1
    context.drawImage(verticalStrip("topbar", [[0, [2, 8, 20, 0.9]], [1, [2, 8, 20, 0.2]]]), 0, 0, W, top)
    // title with a soft glow
    context.save()
    context.shadowColor = "rgba(63,224,255,0.9)"
    context.shadowBlur = 14 * u
    text(context, "AGENT NEXUS", 22 * u, top * 0.62, { size: 38 * u, family: FAMILY.display, color: PALETTE.ice, spacing: 7 * u })
    context.restore()
    const mode = scene.snapshot.mode ?? "LIVE"
    const modeColor = mode === "LIVE" ? PALETTE.green : PALETTE.amber
    context.globalCompositeOperation = "lighter"
    glow(context, modeColor, 28 * u, top * 0.86, 7 * u, 0.6 + 0.4 * Math.sin(t * 4))
    context.globalCompositeOperation = "source-over"
    text(context, `${mode} · opencode sessions · subagents · herdr`, 40 * u, top * 0.9, { size: 10.5 * u, family: FAMILY.mono, color: PALETTE.dim, spacing: 1.2 * u })
    text(context, clockOf(scene.wall), W - 22 * u, top * 0.6, { size: 26 * u, family: FAMILY.monoBold, color: PALETTE.ice, align: "right" })
    text(context, info, W - 22 * u, top * 0.9, { size: 9.5 * u, family: FAMILY.mono, color: PALETTE.dim, align: "right" })
    // the rule under the bar, with a travelling highlight
    context.strokeStyle = rgba(PALETTE.cyan, 0.35)
    context.lineWidth = u
    context.beginPath()
    context.moveTo(0, top - 1)
    context.lineTo(W, top - 1)
    context.stroke()
    const runner = ((t * 0.18) % 1) * (W + 300 * u) - 150 * u
    const highlight = context.createLinearGradient(runner - 150 * u, 0, runner + 150 * u, 0)
    highlight.addColorStop(0, "rgba(63,224,255,0)")
    highlight.addColorStop(0.5, "rgba(190,245,255,0.9)")
    highlight.addColorStop(1, "rgba(63,224,255,0)")
    context.strokeStyle = highlight
    context.lineWidth = 2 * u
    context.beginPath()
    context.moveTo(Math.max(0, runner - 150 * u), top - 1)
    context.lineTo(Math.min(W, runner + 150 * u), top - 1)
    context.stroke()
  }
}

// ------------------------------------------------------------------ terminal transport

const ESC = "\x1b"

class KittyTerminal {
  constructor() {
    this.ids = [7101, 7102]
    this.flip = 0
    this.format = "zlib"
    this.cell = { width: 15, height: 30 }
    this.kitty = false
  }

  write(data) {
    return new Promise((resolve) => process.stdout.write(data, () => resolve()))
  }

  query(sequence, until, timeout) {
    return new Promise((resolve) => {
      let reply = ""
      const finish = () => {
        clearTimeout(timer)
        process.stdin.off("data", onData)
        resolve(reply)
      }
      const onData = (chunk) => {
        reply += chunk.toString("latin1")
        if (until.test(reply)) finish()
      }
      const timer = setTimeout(finish, timeout)
      process.stdin.on("data", onData)
      process.stdout.write(sequence)
    })
  }

  async setup() {
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdout.write(`${ESC}[?1049h${ESC}[?25l${ESC}[2J${ESC}[H`)
    const tiny = deflateSync(Buffer.from([0, 0, 0])).toString("base64")
    const reply = await this.query(`${ESC}_Gi=31,s=1,v=1,a=q,t=d,f=24,o=z;${tiny}${ESC}\\${ESC}[16t${ESC}[c`, /\x1b\[\?[\d;]*c/, 1500)
    this.kitty = /_Gi=31;OK/.test(reply)
    if (!this.kitty) {
      const png = createCanvas(1, 1).encodeSync("png").toString("base64")
      const second = await this.query(`${ESC}_Gi=32,a=q,t=d,f=100;${png}${ESC}\\${ESC}[c`, /\x1b\[\?[\d;]*c/, 1500)
      if (/_Gi=32;OK/.test(second)) {
        this.kitty = true
        this.format = "png"
      }
    }
    const cell = reply.match(/\x1b\[6;(\d+);(\d+)t/)
    if (cell) this.cell = { height: Number(cell[1]), width: Number(cell[2]) }
  }

  frame(canvas, cols, rows) {
    const id = this.ids[this.flip]
    const old = this.ids[1 - this.flip]
    this.flip ^= 1
    let body
    let keys
    if (this.format === "zlib") {
      let pixels = canvas.data()
      if (pixels.length !== canvas.width * canvas.height * 4) {
        pixels = Buffer.from(canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data.buffer)
      }
      body = deflateSync(pixels, { level: 1 })
      keys = `f=32,o=z,s=${canvas.width},v=${canvas.height}`
    } else {
      body = canvas.encodeSync("png")
      keys = "f=100"
    }
    const base64 = body.toString("base64")
    const parts = [`${ESC}[H`]
    for (let offset = 0; offset < base64.length; offset += 4096) {
      const chunk = base64.slice(offset, offset + 4096)
      const more = offset + 4096 < base64.length ? 1 : 0
      parts.push(
        offset === 0
          ? `${ESC}_Ga=T,${keys},i=${id},p=1,c=${cols},r=${rows},C=1,q=2,m=${more};${chunk}${ESC}\\`
          : `${ESC}_Gm=${more};${chunk}${ESC}\\`,
      )
    }
    parts.push(`${ESC}_Ga=d,d=I,i=${old},q=2${ESC}\\`)
    return { out: parts.join(""), bytes: base64.length }
  }

  restore() {
    try {
      process.stdout.write(`${ESC}_Ga=d,d=I,i=${this.ids[0]},q=2${ESC}\\${ESC}_Ga=d,d=I,i=${this.ids[1]},q=2${ESC}\\${ESC}[?25h${ESC}[?1049l`)
      process.stdin.setRawMode(false)
    } catch {}
  }
}

// ------------------------------------------------------------------ main

async function makeSource(demo) {
  if (demo) return new DemoSource()
  const source = new LiveSource(OPTIONS)
  await source.open()
  return source
}

function snapshotTo(renderer, label) {
  fs.mkdirSync(OPTIONS.shots, { recursive: true })
  const file = path.join(OPTIONS.shots, `${label}.png`)
  fs.writeFileSync(file, renderer.canvas.encodeSync("png"))
  return file
}

async function runHeadless() {
  const [W, H] = OPTIONS.size.split("x").map(Number)
  const source = await makeSource(OPTIONS.demo)
  const scene = new Scene()
  const renderer = new Renderer(W, H)
  const started = Date.now()
  let t = 0
  let lastPoll = -1
  const timings = []
  for (let frame = 0; frame < OPTIONS.frames; frame += 1) {
    for (let step = 0; step < 60; step += 1) {
      t += 1 / 30
      const wall = OPTIONS.demo ? started + t * 1000 : Date.now()
      if (t - lastPoll >= 0.7) {
        scene.apply(source.poll(wall), t, wall)
        lastPoll = t
      }
      scene.update(1 / 30, t, renderer.geometry)
    }
    const drawStart = performance.now()
    renderer.draw(scene, t, `HEADLESS · ${W}×${H}`)
    const drawEnd = performance.now()
    const pixels = renderer.canvas.data()
    const packed = deflateSync(pixels, { level: 1 })
    timings.push({ draw: drawEnd - drawStart, encode: performance.now() - drawEnd, kb: Math.round((packed.length * 4) / 3 / 1024) })
    console.log(snapshotTo(renderer, `frame-${frame}${OPTIONS.demo ? "-demo" : ""}`))
  }
  console.log(JSON.stringify(timings))
  source.close()
}

async function runTerminal() {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    console.error("Agent Nexus needs a terminal. For PNGs, use --frames N.")
    process.exit(1)
  }
  const terminal = new KittyTerminal()
  await terminal.setup()
  if (!terminal.kitty) {
    terminal.restore()
    console.error("This terminal did not answer the Kitty graphics protocol, so there is nothing to draw on.")
    process.exit(1)
  }
  let demo = OPTIONS.demo
  let source = await makeSource(demo)
  let scene = new Scene()
  let renderer
  let cols
  let rows
  let scale
  let reductions = 0
  const resize = () => {
    cols = process.stdout.columns
    rows = process.stdout.rows
    const nativeW = cols * terminal.cell.width
    const nativeH = rows * terminal.cell.height
    scale = OPTIONS.scale === "auto" ? Math.min(1, Math.sqrt(OPTIONS.pixels / (nativeW * nativeH))) : Number(OPTIONS.scale)
    scale *= 0.88 ** reductions
    renderer = new Renderer(Math.round(nativeW * scale), Math.round(nativeH * scale))
  }
  resize()
  process.stdout.on("resize", resize)
  let running = true
  const quit = () => {
    running = false
    encoderIdle?.()
  }
  const snapshot = () => {
    try {
      snapshotTo(renderer, `live-${Date.now()}`)
      snapshotTo(renderer, "latest")
    } catch {}
  }
  process.stdin.on("data", async (data) => {
    const key = data.toString()
    if (key === "q" || key === "\x03" || key === "\x1b") quit()
    if (key === "s") snapshot()
    if (key === "d") {
      demo = !demo
      source.close()
      source = await makeSource(demo)
      scene = new Scene()
    }
  })
  process.on("SIGUSR1", snapshot)
  process.on("SIGTERM", quit)
  process.on("SIGINT", quit)
  fs.writeFileSync(path.join(HERE, "nexus.pid"), String(process.pid))
  let encoder = null
  let inFlight = 0
  let encoderIdle = null
  let writeMs = 0
  if (terminal.format === "zlib") {
    encoder = new Worker(new URL("./encoder.mjs", import.meta.url))
    encoder.on("message", (result) => {
      inFlight -= 1
      kb = Math.round(result.bytes / 1024)
      encodeMs = encodeMs * 0.9 + result.encodeMs * 0.1
      writeMs = writeMs * 0.9 + result.writeMs * 0.1
      encoderIdle?.()
      encoderIdle = null
    })
    encoder.on("error", (error) => {
      scene.error = String(error?.message ?? error)
      encoder = null
      inFlight = 0
      encoderIdle?.()
    })
  }
  const clock0 = performance.now()
  let last = clock0
  let lastPoll = 0
  let frames = 0
  let windowStart = clock0
  let fps = 0
  let kb = 0
  let drawMs = 0
  let encodeMs = 0
  let statsAt = 0
  while (running) {
    const frameStart = performance.now()
    const dt = clamp((frameStart - last) / 1000, 0, 0.1)
    last = frameStart
    const t = (frameStart - clock0) / 1000
    const wall = Date.now()
    if (wall - lastPoll > 700) {
      try {
        scene.apply(source.poll(wall), t, wall)
      } catch (error) {
        scene.error = String(error?.message ?? error)
      }
      lastPoll = wall
    }
    scene.update(dt, t, renderer.geometry)
    const info = `${fps.toFixed(0)} FPS · ${renderer.W}×${renderer.H} · ${kb} KB/F · ${encoder ? "worker" : terminal.format}`
    renderer.draw(scene, t, info)
    const drawEnd = performance.now()
    drawMs = drawMs * 0.9 + (drawEnd - frameStart) * 0.1
    if (encoder) {
      while (inFlight >= 1 && running) await new Promise((resolve) => (encoderIdle = resolve))
      const id = terminal.ids[terminal.flip]
      const old = terminal.ids[1 - terminal.flip]
      terminal.flip ^= 1
      const pixels = new Uint8Array(renderer.canvas.data())
      inFlight += 1
      encoder.postMessage({ pixels: pixels.buffer, width: renderer.W, height: renderer.H, id, old, cols, rows }, [pixels.buffer])
    } else {
      const { out, bytes } = terminal.frame(renderer.canvas, cols, rows)
      encodeMs = encodeMs * 0.9 + (performance.now() - drawEnd) * 0.1
      await terminal.write(out)
      kb = Math.round(bytes / 1024)
    }
    frames += 1
    const now = performance.now()
    if (now - windowStart > 1000) {
      fps = (frames * 1000) / (now - windowStart)
      frames = 0
      windowStart = now
      if (OPTIONS.scale === "auto" && t > 5 && fps < 11 && reductions < 4) {
        reductions += 1
        resize()
      }
    }
    if (now - statsAt > 2000) {
      statsAt = now
      fs.writeFile(
        path.join(HERE, "stats.json"),
        JSON.stringify({ fps: Number(fps.toFixed(1)), size: `${renderer.W}x${renderer.H}`, cols, rows, cell: terminal.cell, kb, drawMs: Number(drawMs.toFixed(1)), encodeMs: Number(encodeMs.toFixed(1)), writeMs: Number(writeMs.toFixed(1)), worker: Boolean(encoder), format: terminal.format, nodes: scene.nodes.size, mode: scene.snapshot.mode, error: scene.error ?? null }),
        () => {},
      )
    }
    // Always give the event loop a turn: keys, signals and file writes wait on it.
    const wait = 1000 / OPTIONS.fps - (performance.now() - frameStart)
    await new Promise((resolve) => (wait > 1 ? setTimeout(resolve, wait) : setImmediate(resolve)))
  }
  while (inFlight > 0 && encoder) await new Promise((resolve) => (encoderIdle = resolve))
  await encoder?.terminate()
  terminal.restore()
  source.close()
  try {
    fs.unlinkSync(path.join(HERE, "nexus.pid"))
  } catch {}
  process.exit(0)
}

if (OPTIONS.frames > 0) await runHeadless()
else await runTerminal()
