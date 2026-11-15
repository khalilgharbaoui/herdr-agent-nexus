#!/usr/bin/env node
// Which ink on the still layer answers to the pointer, cell by cell.
//   node --no-warnings v5/tools/coverage.mjs [--demo] [--size 1260x2460]
// Draws one frame, then asks the hit test at five points of every cell that has ink in it.
// The map: "." nothing drawn, "#" ink with a target under it, "X" ink that no target covers.
// Moving sprites (dots, motes, packets) are not on the still layer and are not looked at here.
import os from "node:os"
import path from "node:path"
import { DemoSource } from "../src/demo.mjs"
import { Renderer } from "../src/draw.mjs"
import { Flow } from "../src/flow.mjs"
import { LiveSource } from "../src/live.mjs"
import { Scene } from "../src/model.mjs"
import { Controller } from "../src/ui.mjs"

const argument = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`)
  return index > 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}
const demo = process.argv.includes("--demo")
const [width, height] = argument("size", "1260x2460").split("x").map(Number)
const cell = { width: 15, height: 30 }
const options = { demo, db: path.join(os.homedir(), ".local/share/opencode/opencode.db"), state: path.join(os.homedir(), ".local/state/opencode-claude-code-plugin"), hours: 24, historyMs: 31 * 60e3 }
const source = demo ? new DemoSource(options) : new LiveSource(options)
await source.open()
const flow = new Flow()
const renderer = new Renderer(flow)
renderer.bandHeight = cell.height * 3
renderer.resize(width, height, cell)
const scene = new Scene()
const controller = new Controller({ renderer, terminal: { mouseModes: { 1003: 1, 1006: 1, 1016: 1 }, input: { pixels: true } }, scene: () => scene, actions: {}, logFile: null })
const meta = { line: `${width}×${height} px  ·  coverage` }
const until = Date.now() + (demo ? 2600 : 3200)
let now = Date.now()
while (Date.now() < until) {
  now = Date.now()
  scene.ingest(source.poll(now), now)
  controller.refresh(now)
  if (scene.world) {
    renderer.update(scene, controller.ui, now, meta)
    renderer.react(scene, scene.takeSignals(), now)
    const sprites = []
    flow.frame(now, sprites)
    renderer.sprites(scene, controller.ui, now, sprites)
  }
  await new Promise((resolve) => setTimeout(resolve, 60))
}
const pixels = renderer.base.getImageData(0, 0, width, height).data
const cols = Math.floor(width / cell.width)
const rows = Math.floor(height / cell.height)
const kinds = new Map()
let inked = 0
let bare = 0
const lines = []
for (let row = 0; row < rows; row += 1) {
  let line = ""
  for (let col = 0; col < cols; col += 1) {
    // ink: a pixel of the cell that is clearly brighter than the faintest rules
    let ink = 0
    let sumX = 0
    let sumY = 0
    for (let y = row * cell.height; y < (row + 1) * cell.height; y += 2) {
      for (let x = col * cell.width; x < (col + 1) * cell.width; x += 2) {
        const at = (y * width + x) * 4
        if (pixels[at + 3] > 60 && pixels[at] + pixels[at + 1] + pixels[at + 2] > 250) {
          ink += 1
          sumX += x
          sumY += y
        }
      }
    }
    if (ink < 3) {
      line += "."
      continue
    }
    inked += 1
    const cx = sumX / ink
    const cy = sumY / ink
    let target = null
    for (const [dx, dy] of [[0, 0], [-4, 0], [4, 0], [0, -6], [0, 6]]) {
      target = renderer.hitTest(cx + dx, cy + dy, scene, now)
      if (target && target.kind !== "overlay") break
      target = null
    }
    if (target) {
      kinds.set(target.kind, (kinds.get(target.kind) ?? 0) + 1)
      line += "#"
    } else {
      bare += 1
      line += "X"
    }
  }
  lines.push(`${String(row).padStart(2)} ${line}`)
}
console.log(lines.join("\n"))
console.log(`\n${inked} cells with ink, ${bare} of them with no target (${((bare / inked) * 100).toFixed(1)}%)`)
console.log([...kinds.entries()].sort((a, b) => b[1] - a[1]).map(([kind, count]) => `${kind} ${count}`).join("  "))
source.close()
process.exit(0)
