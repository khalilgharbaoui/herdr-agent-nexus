#!/usr/bin/env node
// Memory of the running v5 over time, one line per sample.
//   node v5/tools/mem-watch.mjs [seconds between samples = 30] [samples = 22] [pid = v5/nexus.pid]
// Per sample: the physical footprint as macOS counts it (`footprint`), split into what the
// allocator holds in large blocks (pixel buffers, file buffers), in small blocks, and what V8
// holds for every isolate (the main thread and the two workers), next to what the program says
// about itself in stats.json (threads working, sprite pages, its own heaps).
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const every = Number(process.argv[2] ?? 30) * 1000
const samples = Number(process.argv[3] ?? 22)
const pid = process.argv[4] ?? fs.readFileSync(path.join(HERE, "..", "nexus.pid"), "utf8").trim()

const mb = (text) => {
  const match = /^([\d.]+) (B|KB|MB|GB)$/.exec(text.trim())
  if (!match) return 0
  return Number(match[1]) * { B: 1 / 1048576, KB: 1 / 1024, MB: 1, GB: 1024 }[match[2]]
}

function footprint() {
  const out = execFileSync("footprint", [pid], { encoding: "utf8" })
  const row = (name) => {
    const match = new RegExp(`^\\s*([\\d.]+ (?:B|KB|MB|GB))\\s+.*\\s${name}\\s*$`, "m").exec(out)
    return match ? mb(match[1]) : 0
  }
  const total = /phys_footprint: ([\d.]+ (?:B|KB|MB|GB))/.exec(out)
  return { total: total ? mb(total[1]) : 0, large: row("Malloc Large"), small: row("Malloc Small"), v8: row("App-Specific Tag 16"), pages: row("page table") }
}

const stats = () => {
  try {
    return JSON.parse(fs.readFileSync(path.join(HERE, "..", "stats.json"), "utf8"))
  } catch {
    return {}
  }
}

const pad = (value, width) => String(value).padStart(width)
console.log("time      footprint  large  small    v8  pgtbl | working  pages  cpu%   kB/s | heap main/enc/cache  ext  transcripts")
for (let index = 0; index < samples; index += 1) {
  const f = footprint()
  const s = stats()
  const heaps = s.heaps ? `${s.heaps.main ?? "?"}/${s.heaps.encoder ?? "?"}/${s.heaps.cache ?? "?"}` : `${s.heapMb ?? "?"}/?/?`
  console.log(
    `${new Date().toTimeString().slice(0, 8)}  ${pad(f.total.toFixed(0), 6)} MB ${pad(f.large.toFixed(0), 6)} ${pad(f.small.toFixed(0), 6)} ${pad(f.v8.toFixed(0), 5)} ${pad(f.pages.toFixed(0), 6)} | ${pad(`${s.working ?? "?"}/${s.threads ?? "?"}`, 7)} ${pad(s.graphics?.pages ?? "?", 6)} ${pad(s.cpuPercent ?? "?", 5)} ${pad(s.kbPerSecond ?? "?", 6)} | ${pad(heaps, 19)} ${pad(s.externalMb ?? "?", 4)}  ${s.cacheWorker?.files ?? "?"}`,
  )
  if (index < samples - 1) await new Promise((resolve) => setTimeout(resolve, every))
}
