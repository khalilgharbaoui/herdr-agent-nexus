#!/usr/bin/env node
// What the data side costs in memory on its own, with no picture and no terminal:
// the live source polled as the program polls it, with or without the transcript worker.
//   node --no-warnings v5/tools/mem-source.mjs [seconds = 120] [--no-worker] [--scene]
// One line every 10 s: this process's physical footprint (macOS `footprint`), split as
// tools/mem-watch.mjs splits it, and the heaps V8 reports for the main thread and the worker.
import { execFileSync } from "node:child_process"
import os from "node:os"
import path from "node:path"
import { LiveSource } from "../src/live.mjs"
import { Scene } from "../src/model.mjs"

const seconds = Number(process.argv[2] ?? 120)
const options = {
  db: path.join(os.homedir(), ".local/share/opencode/opencode.db"),
  state: path.join(os.homedir(), ".local/state/opencode-claude-code-plugin"),
  hours: 24,
  historyMs: 31 * 60e3,
}
const source = new LiveSource(options)
await source.open()
if (process.argv.includes("--no-worker")) {
  source.cacheWorker?.terminate()
  source.cacheWorker = null
}
const scene = process.argv.includes("--scene") ? new Scene() : null

const mb = (text) => {
  const match = /^([\d.]+) (B|KB|MB|GB)$/.exec(text.trim())
  return match ? Number(match[1]) * { B: 1 / 1048576, KB: 1 / 1024, MB: 1, GB: 1024 }[match[2]] : 0
}
function footprint() {
  const out = execFileSync("footprint", [String(process.pid)], { encoding: "utf8" })
  const row = (name) => {
    const match = new RegExp(`^\\s*([\\d.]+ (?:B|KB|MB|GB))\\s+.*\\s${name}\\s*$`, "m").exec(out)
    return match ? mb(match[1]) : 0
  }
  const total = /phys_footprint: ([\d.]+ (?:B|KB|MB|GB))/.exec(out)
  return { total: total ? mb(total[1]) : 0, large: row("Malloc Large"), small: row("Malloc Small"), v8: row("App-Specific Tag 16") }
}

const started = Date.now()
let polls = 0
let working = 0
const poll = setInterval(() => {
  const world = source.poll(Date.now())
  polls += 1
  working = (world?.sessions ?? world?.threads ?? []).filter?.((thread) => thread.working ?? thread.state === "working").length ?? 0
  if (scene) scene.ingest(world, Date.now())
}, 250)
console.log("  t   footprint  large  small    v8 | main used/total  worker used/total  ext | polls threads")
const report = async () => {
  const f = footprint()
  const m = process.memoryUsage()
  let w = null
  try {
    w = source.cacheWorker ? await source.cacheWorker.getHeapStatistics() : null
  } catch {}
  const n = (bytes) => (bytes / 1048576).toFixed(0)
  console.log(
    `${String(Math.round((Date.now() - started) / 1000)).padStart(3)}s  ${f.total.toFixed(0).padStart(6)} MB ${f.large.toFixed(0).padStart(6)} ${f.small.toFixed(0).padStart(6)} ${f.v8.toFixed(0).padStart(5)} | ${`${n(m.heapUsed)}/${n(m.heapTotal)}`.padStart(15)}  ${(w ? `${n(w.used_heap_size)}/${n(w.total_heap_size)}` : "none").padStart(17)}  ${n(m.external).padStart(3)} | ${polls} ${source.cacheThreads?.length ?? 0}`,
  )
}
const timer = setInterval(report, 10e3)
setTimeout(async () => {
  await report()
  clearInterval(timer)
  clearInterval(poll)
  source.close()
  process.exit(0)
}, seconds * 1000)
