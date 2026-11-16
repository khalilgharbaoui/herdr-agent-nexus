#!/usr/bin/env node
// What the running v5 costs, report by report: one line per stats.json (written every 2 s).
//   node v5/tools/burst-watch.mjs [seconds = 60] [region = core]
// Per line: CPU, kB/s, input events a second, how often the region was painted again, and the
// named parts of its signature that changed (stats.json, repaintCauses). The last lines are the
// median, the highest value and how many reports were over the class (11% of a core, 670 kB/s).
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FILE = path.join(HERE, "..", "stats.json")
const seconds = Number(process.argv[2] ?? 60)
const region = process.argv[3] ?? "core"
const rows = []
let seen = 0

const median = (list) => {
  const sorted = [...list].sort((a, b) => a - b)
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0
}

function sample() {
  let stat
  try {
    stat = fs.statSync(FILE)
  } catch {
    return
  }
  if (stat.mtimeMs === seen) return
  seen = stat.mtimeMs
  let stats
  try {
    stats = JSON.parse(fs.readFileSync(FILE, "utf8"))
  } catch {
    return
  }
  const paints = stats.repaintsPerSecond?.[region] ?? 0
  const causes = Object.entries(stats.repaintCauses ?? {})
    .filter(([name]) => name.startsWith(`${region}: `))
    .map(([name, rate]) => `${name.slice(region.length + 2)} ${rate}`)
    .join(", ")
  rows.push({ cpu: stats.cpuPercent, kb: stats.kbPerSecond, paints, input: stats.inputPerSecond })
  console.log(`${new Date().toTimeString().slice(0, 8)}  cpu ${String(stats.cpuPercent).padStart(5)}%  ${String(Math.round(stats.kbPerSecond)).padStart(5)} kB/s  input ${String(stats.inputPerSecond).padStart(5)}/s  working ${stats.working}  ${region} ${String(paints).padStart(4)}/s  ${causes}`)
}

console.log(`${seconds} s of reports, region "${region}"`)
const timer = setInterval(sample, 250)
setTimeout(() => {
  clearInterval(timer)
  if (!rows.length) return console.log("no reports: is v5 running?")
  const line = (name, pick, unit) => `${name} median ${median(rows.map(pick))}${unit}, highest ${Math.max(...rows.map(pick))}${unit}`
  console.log(line("cpu", (row) => row.cpu, "%"))
  console.log(line("sent", (row) => Math.round(row.kb), " kB/s"))
  console.log(line(region, (row) => row.paints, "/s"))
  console.log(`${rows.filter((row) => row.cpu > 11 || row.kb > 670).length} of ${rows.length} reports over the class (11% of a core or 670 kB/s)`)
}, seconds * 1000)
