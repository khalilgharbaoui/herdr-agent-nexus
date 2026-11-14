// Renders the awkward cases headless so a change cannot break them unseen:
// nothing at all, everything idle, a tiny pane, far more busy threads than fit, long titles.
import fs from "node:fs"
import path from "node:path"
import { Renderer } from "../src/draw.mjs"
import { Scene } from "../src/model.mjs"

const HERE = path.dirname(path.dirname(new URL(import.meta.url).pathname))
const now = Date.now()
const session = (index, extra = {}) => ({
  id: `ses_edge${index}`, parentId: null, title: `Thread ${index}`, agent: "build", model: "claude-opus-5-5", provider: "claude-code", effort: "high", account: "default",
  busy: false, blocked: false, outcome: "succeeded", compacting: false, cost: 1.5, tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
  created: now - 86400e3, updated: now - 3600e3 * index, busySince: 0, idleSince: now - 3600e3 * index, context: { used: 200e3, limit: 1e6 }, turn: null, expect: null,
  pane: "", paneStatus: "", directory: "", steps: [], marks: [], ...extra,
})
const busy = (index) => session(index, {
  title: index % 3 ? `Thread ${index}` : "A very long title that goes on and on about migrating every reporting query to the read replica without downtime",
  busy: true, busySince: now - 40e3 * index, updated: now, idleSince: 0, turn: { start: now - 40e3 * index, out: 1200 * index }, expect: { p25: 60e3, p50: 200e3, p75: 600e3, n: 9 },
  parentId: index > 30 ? "ses_edge1" : null,
  steps: [{ seq: 1, start: now - 30e3, streamed: now - 12e3, end: null, finish: "", out: 0, chars: 900, reasoning: [[now - 30e3, now - 20e3]], tools: [{ id: `t${index}`, name: index % 2 ? "shell" : "mcp__opencode_proxy__task_batch", label: "npm test -- --runInBand", status: "running", start: now - 12e3, end: null }] }],
  marks: [{ at: now - 40e3 * index, kind: "user", outcome: "" }],
})
const world = (sessions, panes = [], accounts = []) => ({ mode: "LIVE", now, sessions, panes, accounts, cost24h: { cost: 0, sessions: 0 } })
const accounts = [{ name: "default", tier: "Max 5x", five: { used: 96, status: "allowed", resetsAt: now + 3600e3, span: 5 * 3600e3 }, seven: { used: null, status: "", resetsAt: 0, span: 7 * 86400e3 } }, { name: "appical", tier: "", five: null, seven: { used: 0, status: "allowed", resetsAt: 0, span: 7 * 86400e3 } }]
const panes = Array.from({ length: 64 }, (_, index) => ({ id: `w${index % 11}:p${index}`, workspace: `w${index % 11}`, status: ["idle", "working", "blocked", "done", "unknown"][index % 5], kind: "opencode", title: "A pane with quite a long terminal title that has to be cut somewhere sensible", sessionId: index < 40 ? `ses_edge${index}` : null, since: now - index * 9000 }))
const cases = [
  ["empty", 1590, 2460, world([])],
  ["idle", 1590, 2460, world([1, 2, 3].map((index) => session(index)), panes.slice(0, 5), accounts)],
  ["tiny", 780, 600, world([1, 2, 3, 4, 5, 6].map(busy), panes.slice(0, 12), accounts)],
  ["crowd", 1590, 2460, world(Array.from({ length: 60 }, (_, index) => busy(index + 1)), panes, accounts)],
  ["short", 3540, 900, world(Array.from({ length: 9 }, (_, index) => busy(index + 1)), panes, accounts)],
]
for (const [name, width, height, data] of cases) {
  const renderer = new Renderer()
  renderer.resize(width, height, 30)
  const scene = new Scene()
  scene.capacity = renderer.L.capacity
  scene.windowMs = renderer.L.windowMs
  scene.ingest(data, now)
  scene.ingest(data, now + 500)
  renderer.draw(scene, now + 600, { line: "edge case", line2: "" })
  fs.mkdirSync(path.join(HERE, "shots"), { recursive: true })
  fs.writeFileSync(path.join(HERE, "shots", `edge-${name}.png`), renderer.flatten("#15191e").toBuffer("image/png"))
  console.log(name.padEnd(6), `${width}x${height}`, "lanes", scene.lanes.length, "hidden", scene.hidden, "capacity", renderer.L.capacity)
}
