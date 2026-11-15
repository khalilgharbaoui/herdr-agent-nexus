// What the cache worker finds for every thread that could still have a warm prompt cache:
// whether its lifetime is measured (and how its transcript was found) or assumed, and why.
//   node --no-warnings v5/tools/cache-probe.mjs [seconds to wait, default 8]
import os from "node:os"
import path from "node:path"
import { LiveSource } from "../src/live.mjs"

const wait = Number(process.argv[2] ?? 8) * 1000
const source = new LiveSource({
  db: path.join(os.homedir(), ".local/share/opencode/opencode.db"),
  state: path.join(os.homedir(), ".local/state/opencode-claude-code-plugin"),
  hours: 24,
  historyMs: 31 * 60e3,
})
await source.open()
source.poll(Date.now())
source.askCache()
const started = Date.now()
while (Date.now() - started < wait) {
  await new Promise((resolve) => setTimeout(resolve, 1000))
  source.poll(Date.now())
}
const now = Date.now()
const world = source.poll(now)
const span = (ms) => (ms < 90e3 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60e3)}m`)
let measured = 0
let assumed = 0
for (const session of world.sessions) {
  const cache = session.cache
  if (!cache) continue
  if (cache.measured) measured += 1
  else assumed += 1
  const left = cache.lifetime - (now - cache.at)
  console.log(
    [
      session.id.slice(-6),
      (session.parentId ? "  sub " : "main ") + session.title.slice(0, 34).padEnd(34),
      session.busy ? "busy" : "rest",
      cache.measured ? `measured by ${cache.how}${cache.how === "timing" ? ` ${cache.matched}/${cache.of} ${cache.by}` : ""}` : "assumed",
      `lives ${span(cache.lifetime)}`,
      `touched ${span(now - cache.at)} ago`,
      left > 0 ? `${span(left)} left` : "cold",
      cache.measured ? `5m ${cache.five} 1h ${cache.hour} read ${cache.read}` : cache.why,
    ].join("  "),
  )
}
console.log(`${measured} measured, ${assumed} assumed`)
source.close()
