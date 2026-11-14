// Watches herdr's temp graphics directory and records every file it sees (name, size, when).
import fs from "node:fs"
import path from "node:path"
const root = "/tmp/herdr-kitty-files-501"
const seconds = Number(process.argv[2] ?? 12)
const seen = new Map()
const started = performance.now()
const scan = (dir) => {
  let names = []
  try { names = fs.readdirSync(dir) } catch { return }
  for (const name of names) {
    const full = path.join(dir, name)
    let stat
    try { stat = fs.statSync(full) } catch { continue }
    if (stat.isDirectory()) { scan(full); continue }
    const entry = seen.get(full)
    if (!entry) seen.set(full, { at: Math.round(performance.now() - started), size: stat.size })
    else if (stat.size > entry.size) entry.size = stat.size
  }
}
while (performance.now() - started < seconds * 1000) {
  scan(root)
  await new Promise((resolve) => setImmediate(resolve))
}
const list = [...seen.entries()].map(([file, entry]) => ({ file: path.basename(file).slice(0, 40), ...entry })).sort((a, b) => a.at - b.at)
fs.writeFileSync(process.argv[3] ?? "scratch/watch.json", JSON.stringify({ count: list.length, list }, null, 0))
