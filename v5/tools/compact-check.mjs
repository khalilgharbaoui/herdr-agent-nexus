#!/usr/bin/env node
// Provokes a compaction in the demo and says what the screen did with it.
//   node --no-warnings v5/tools/compact-check.mjs
// The demo runs on a clock of its own here (a tenth of a second a step, as fast as the machine
// goes), with the focus held on the thread that starts close to a full window. When that
// thread's context falls, it prints the reading before and after, the log line, how the head of
// the context ring ran (from where to where, in how many milliseconds) and whether the ripple
// was placed where it landed, and it writes a frame from before and one from after.
import path from "node:path"
import { fileURLToPath } from "node:url"
import fs from "node:fs"
import { DemoSource } from "../src/demo.mjs"
import { Renderer } from "../src/draw.mjs"
import { Flow } from "../src/flow.mjs"
import { Scene } from "../src/model.mjs"
import { Atlas } from "../src/sprites.mjs"
import { Controller } from "../src/ui.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const cell = { width: 15, height: 30 }
const source = new DemoSource({ demo: true, hours: 24, historyMs: 31 * 60e3 })
await source.open()
const flow = new Flow()
const renderer = new Renderer(flow)
renderer.bandHeight = cell.height * 3
renderer.resize(1365, 4200, cell)
const atlas = new Atlas(cell.width, cell.height)
const scene = new Scene()
const controller = new Controller({ renderer, terminal: { mouseModes: {}, input: { pixels: true } }, scene: () => scene, actions: {}, logFile: null })
const save = (name, sprites) => fs.writeFileSync(path.join(HERE, "..", "shots", name), renderer.flatten("#12161c", sprites, atlas).toBuffer("image/png"))

let now = Date.now()
let lastPoll = 0
let sid = null
let before = null
let fell = null
let ripples = 0
let settled = 0
const ripple = renderer.ripple.bind(renderer)
renderer.ripple = (x, y, tone, at) => {
  if (fell) ripples += 1
  return ripple(x, y, tone, at)
}
const track = []
for (let tick = 0; tick < 12000; tick += 1) {
  now += 100
  if (now - lastPoll >= 250) {
    lastPoll = now
    scene.ingest(source.poll(now), now)
  }
  if (!scene.world) continue
  if (!sid) {
    // the thread nearest a full window
    const fullest = [...scene.threads].filter((row) => row.session.context.limit).sort((a, b) => b.session.context.used / b.session.context.limit - a.session.context.used / a.session.context.limit)[0]
    if (!fullest) continue
    sid = fullest.session.id
  }
  if (scene.focus.id !== sid) scene.lock(sid, now)
  controller.refresh(now)
  renderer.update(scene, controller.ui, now, { line: "compact-check" })
  const sprites = []
  renderer.react(scene, scene.takeSignals(), now)
  flow.frame(now, sprites)
  renderer.sprites(scene, controller.ui, now, sprites)
  const session = scene.byId.get(sid)
  const used = session?.context.used ?? 0
  if (!fell && before && before.used - used > 5000) fell = { at: now, from: before.used, to: used, limit: session.context.limit }
  if (!fell) {
    // the frame from before: taken once, two seconds after the thread came into focus
    if (!before) settled = now + 2000
    if (settled && now >= settled) {
      save("compact-before.png", sprites)
      settled = 0
    }
    before = { used, sprites }
  }
  else {
    const head = sprites.find((sprite) => sprite.key === "ctx-head")
    if (head) track.push({ ms: now - fell.at, x: Math.round(head.x), y: Math.round(head.y) })
    if (now - fell.at >= 1500) {
      save("compact-after.png", sprites)
      break
    }
  }
}
if (!fell) console.log("no compaction in twenty minutes of the demo's clock")
else {
  const share = (value) => `${((value / fell.limit) * 100).toFixed(0)}%`
  console.log(`thread ${sid}: context fell from ${Math.round(fell.from / 1000)}k (${share(fell.from)}) to ${Math.round(fell.to / 1000)}k (${share(fell.to)}) of ${Math.round(fell.limit / 1000)}k`)
  const line = scene.log.find((entry) => entry.name === "compacted" && entry.sid === sid)
  console.log(`log: ${line ? `${line.name}  ${line.detail}` : "no line"}`)
  const moving = track.filter((entry, index) => index === 0 || entry.x !== track[index - 1].x || entry.y !== track[index - 1].y)
  const last = moving[moving.length - 1]
  console.log(`head of the context ring: ${moving.length} places, from (${track[0].x}, ${track[0].y}) to (${last.x}, ${last.y}), at rest ${last.ms} ms after the reading`)
  console.log(`ripples placed after the fall: ${ripples}`)
  console.log("frames: v5/shots/compact-before.png, v5/shots/compact-after.png")
}
source.close?.()
