// Who allocates, for a set time after the start: `NEXUS_ALLOC=120 node v5/nexus.mjs` samples
// every allocation of the main thread for 120 s (collected ones included, so churn shows, not
// only what stays) and writes v5/alloc.json: megabytes a second by function, heaviest first.
// A measuring aid: it costs a little while it runs and nothing when the variable is not set.
import fs from "node:fs"
import inspector from "node:inspector"

export function profileAllocations(seconds, file) {
  const session = new inspector.Session()
  session.connect()
  const started = Date.now()
  session.post("HeapProfiler.startSampling", { samplingInterval: 16384, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true }, () => {})
  const timer = setTimeout(() => {
    session.post("HeapProfiler.stopSampling", (error, result) => {
      if (error || !result?.profile) return
      const took = (Date.now() - started) / 1000
      const by = new Map()
      let total = 0
      const walk = (node, path) => {
        const frame = node.callFrame
        const name = `${frame.functionName || "(anonymous)"} ${frame.url.split("/").slice(-2).join("/")}:${frame.lineNumber + 1}`
        const next = path.length < 4 ? [...path, name] : path
        if (node.selfSize) {
          total += node.selfSize
          const entry = by.get(name) ?? { bytes: 0, via: new Map() }
          entry.bytes += node.selfSize
          const caller = path[path.length - 1] ?? ""
          entry.via.set(caller, (entry.via.get(caller) ?? 0) + node.selfSize)
          by.set(name, entry)
        }
        for (const child of node.children ?? []) walk(child, [...path.slice(-3), name])
      }
      walk(result.profile.head, [])
      const rate = (bytes) => Number((bytes / 1048576 / took).toFixed(3))
      const top = [...by.entries()]
        .sort((a, b) => b[1].bytes - a[1].bytes)
        .slice(0, 45)
        .map(([name, entry]) => ({ mbPerSecond: rate(entry.bytes), at: name, from: [...entry.via.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([caller, bytes]) => `${caller} (${rate(bytes)})`) }))
      try {
        fs.writeFileSync(file, JSON.stringify({ seconds: Math.round(took), mbPerSecond: rate(total), top }, null, 1))
      } catch {}
      session.disconnect()
    })
  }, seconds * 1000)
  timer.unref()
}
