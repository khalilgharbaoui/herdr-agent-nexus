#!/usr/bin/env node
// What the picture costs, and what it is spent on, averaged over a stretch of reports.
//   node v5/tools/cost-watch.mjs [seconds = 60] [folder with stats.json = v5]
// Reads stats.json every two seconds (the program writes it that often) and prints, at the end,
// the median and the highest of: per cent of a core, kB/s (tiles and sprites apart), threads
// working; and the averages of what the bytes go to: tiles a second by the region whose
// repaint changed them, sprite placements a frame by kind of mark, repaints a second by region.
// With a second copy on a stand-in terminal (tools/resize-check.py --fresh --run <folder>) it
// measures a change without touching the pane the operator looks at.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const seconds = Number(process.argv[2] ?? 60)
const folder = process.argv[3] ?? path.join(HERE, "..")
const file = path.join(folder, "stats.json")
const samples = []
let last = ""
const until = Date.now() + seconds * 1000
while (Date.now() < until) {
  try {
    const text = fs.readFileSync(file, "utf8")
    if (text !== last) {
      last = text
      samples.push(JSON.parse(text))
    }
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 1000))
}
if (!samples.length) {
  console.log(`no report in ${file}`)
  process.exit(1)
}
const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)]
const line = (name, list, unit = "") => console.log(`${name.padEnd(22)} median ${String(median(list)).padStart(6)}${unit}   lowest ${Math.min(...list)}${unit}   highest ${Math.max(...list)}${unit}`)
const first = samples[0]
console.log(`${samples.length} reports over ${seconds} s  ·  ${first.size} px, ${first.cols} columns  ·  ${first.transport}, ${first.graphics?.verdict ?? "?"}  ·  ${first.mode}`)
line("working of listed", samples.map((s) => s.working), ` of ${median(samples.map((s) => s.threads))}`)
line("per cent of a core", samples.map((s) => s.cpuPercent), "%")
line("kB/s", samples.map((s) => s.kbPerSecond))
line("  tiles kB/s", samples.map((s) => s.tileKbPerSecond))
line("  sprites kB/s", samples.map((s) => s.spriteKbPerSecond))
line("read back MB/s", samples.map((s) => s.readbackMbPerSecond))
const mean = (key) => {
  const sum = {}
  for (const sample of samples) for (const [name, value] of Object.entries(sample[key] ?? {})) sum[name] = (sum[name] ?? 0) + value
  return Object.entries(sum).map(([name, value]) => [name, value / samples.length]).sort((a, b) => b[1] - a[1])
}
const fold = (list) => {
  // rows and project lines are many regions of one kind: counted together
  const out = {}
  for (const [name, value] of list) {
    const kind = name.startsWith("row:") ? "rows (all)" : name.startsWith("proj:") ? "projects (all)" : name
    out[kind] = (out[kind] ?? 0) + value
  }
  return Object.entries(out).sort((a, b) => b[1] - a[1])
}
const show = (title, list, digits = 1) => console.log(`${title}\n  ${list.filter(([, value]) => value >= 0.05).map(([name, value]) => `${name} ${value.toFixed(digits)}`).join("  ·  ") || "nothing"}`)
show("tiles a second, by the region that changed them", mean("tilesPerSecondBy"))
show("repaints a second, by region", fold(mean("repaintsPerSecond")))
show("sprite placements a frame, by kind", mean("movedPerFrameBy"))
show("repaint causes a second", mean("repaintCauses"))
