#!/usr/bin/env node
// Agent Nexus v2: a flight recorder for every opencode session, subagent and herdr agent on
// this machine. Drawn with Skia at the terminal's native pixel size on a transparent ground
// and shown through the Kitty graphics protocol.
//
//   node --no-warnings nexus.mjs                 live, in the current terminal
//   node --no-warnings nexus.mjs --demo          simulated data
//   node --no-warnings nexus.mjs --frames 3 --size 1590x2460 [--demo]   headless PNGs in shots/
//
// Keys: q quit, d live/demo, s snapshot. SIGUSR1 writes shots/latest.png.
// It reads opencode's database, the plugin's state files and herdr, and writes nothing
// outside this folder.

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { DemoSource } from "./src/demo.mjs"
import { Renderer } from "./src/draw.mjs"
import { LiveSource } from "./src/live.mjs"
import { Scene } from "./src/model.mjs"
import { Terminal } from "./src/terminal.mjs"

const HERE = path.dirname(new URL(import.meta.url).pathname)
const SHOTS = path.join(HERE, "shots")
const argument = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`)
  return index > 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}
const OPTIONS = {
  demo: process.argv.includes("--demo"),
  frames: Number(argument("frames", 0)),
  size: argument("size", "1590x2460"),
  cell: Number(argument("cell", 30)),
  fps: Number(argument("fps", 30)),
  background: argument("bg", "#15191e"), // the pane's own background, so snapshots look like the screen
  db: argument("db", path.join(os.homedir(), ".local/share/opencode/opencode.db")),
  state: argument("state", path.join(os.homedir(), ".local/state/opencode-claude-code-plugin")),
  hours: Number(argument("hours", 24)),
  historyMs: 16 * 60e3,
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function makeSource(demo) {
  const source = demo ? new DemoSource(OPTIONS) : new LiveSource(OPTIONS)
  await source.open()
  return source
}

function snapshot(renderer, name) {
  fs.mkdirSync(SHOTS, { recursive: true })
  const file = path.join(SHOTS, name)
  fs.writeFileSync(file, renderer.flatten(OPTIONS.background).toBuffer("image/png"))
  return file
}

function ingest(source, scene, renderer, now) {
  scene.capacity = renderer.L.capacity
  scene.windowMs = renderer.L.windowMs
  scene.ingest(source.poll(now), now)
}

async function runHeadless() {
  const [width, height] = OPTIONS.size.split("x").map(Number)
  const renderer = new Renderer()
  renderer.resize(width, height, OPTIONS.cell)
  const source = await makeSource(OPTIONS.demo)
  const scene = new Scene()
  if (!OPTIONS.demo) await sleep(1300) // herdr answers asynchronously
  ingest(source, scene, renderer, Date.now())
  for (let frame = 0; frame < OPTIONS.frames; frame += 1) {
    await sleep(frame === 0 ? 600 : 1100)
    const now = Date.now()
    ingest(source, scene, renderer, now)
    const started = performance.now()
    renderer.draw(scene, now, { line: `${width}×${height} px · headless`, line2: "" })
    const drawMs = performance.now() - started
    const file = snapshot(renderer, `frame-${frame}${OPTIONS.demo ? "-demo" : ""}${width > height ? "-wide" : ""}.png`)
    console.log(`${file}  draw ${drawMs.toFixed(1)} ms  lanes ${scene.lanes.length}`)
  }
  source.close()
}

async function runTerminal() {
  const terminal = new Terminal()
  const kitty = await terminal.open()
  if (!kitty) {
    await terminal.close()
    console.error("This terminal did not answer the Kitty graphics query, so there is nothing to draw on.")
    process.exit(1)
  }
  const pidFile = path.join(HERE, "nexus.pid")
  fs.writeFileSync(pidFile, String(process.pid))
  const renderer = new Renderer()
  renderer.resize(terminal.width, terminal.height, terminal.cell.height)
  let demo = OPTIONS.demo
  let source = await makeSource(demo)
  let scene = new Scene()
  let error = null
  let quitting = false
  let wantShot = null
  let lastPoll = 0
  let waiting = false
  const total = { sent: 0, late: 0, draw: 0, read: 0, bytes: 0, tiles: 0, of: 0, encode: 0, write: 0, done: 0 }
  let mark = { ...total, at: performance.now() }
  let peak = 0
  const meta = { line: "", line2: "" }

  const quit = async () => {
    if (quitting) return
    quitting = true
    try {
      source.close()
    } catch {}
    await terminal.close()
    try {
      fs.unlinkSync(pidFile)
    } catch {}
    process.exit(0)
  }

  const frame = () => {
    if (quitting || terminal.busy) return
    waiting = false
    const started = performance.now()
    const now = Date.now()
    try {
      if (now - lastPoll >= 500) {
        lastPoll = now
        ingest(source, scene, renderer, now)
      }
      renderer.draw(scene, now, meta)
      error = null
    } catch (caught) {
      error = String(caught?.stack ?? caught).slice(0, 600)
    }
    const drawn = performance.now()
    const pixels = renderer.canvas.data()
    total.draw += drawn - started
    total.read += performance.now() - drawn
    if (terminal.send(pixels)) total.sent += 1
    if (wantShot) {
      try {
        snapshot(renderer, wantShot)
      } catch {}
      wantShot = null
    }
  }

  terminal.onFrameDone = (result) => {
    total.done += 1
    total.bytes += result.bytes
    total.tiles += result.tiles
    total.of += result.of
    total.encode += result.encodeMs
    total.write += result.writeMs
    peak = Math.max(peak, result.encodeMs + result.writeMs)
    if (waiting) frame()
  }

  const frameMs = 1000 / OPTIONS.fps
  let next = performance.now()
  const tick = () => {
    if (quitting) return
    if (terminal.busy) {
      waiting = true
      total.late += 1
    } else frame()
    next += frameMs
    const now = performance.now()
    if (next < now - frameMs) next = now
    const wait = next - now
    if (wait > 1) setTimeout(tick, wait)
    else setImmediate(tick)
  }

  const report = setInterval(() => {
    const now = performance.now()
    const seconds = (now - mark.at) / 1000
    const frames = Math.max(1, total.done - mark.done)
    const sent = Math.max(1, total.sent - mark.sent)
    const stats = {
      fps: Number(((total.done - mark.done) / seconds).toFixed(1)),
      size: `${terminal.width}x${terminal.height}`,
      cols: terminal.cols,
      rows: terminal.rows,
      cell: terminal.cell,
      kb: Math.round((total.bytes - mark.bytes) / frames / 1024),
      tiles: `${((total.tiles - mark.tiles) / frames).toFixed(1)}/${Math.round((total.of - mark.of) / frames)}`,
      drawMs: Number(((total.draw - mark.draw) / sent).toFixed(1)),
      readMs: Number(((total.read - mark.read) / sent).toFixed(1)),
      encodeMs: Number(((total.encode - mark.encode) / frames).toFixed(1)),
      writeMs: Number(((total.write - mark.write) / frames).toFixed(1)),
      late: total.late - mark.late,
      peakMs: Number(peak.toFixed(0)),
      lanes: scene.lanes.length,
      mode: demo ? "DEMO" : "LIVE",
      rssMb: Math.round(process.memoryUsage().rss / 1048576),
      error: error ?? terminal.error ?? null,
    }
    mark = { ...total, at: now }
    peak = 0
    meta.line = `${terminal.width}×${terminal.height} px native · ${stats.fps.toFixed(0)} fps · ${stats.kb} kB a frame`
    meta.line2 = `draw ${stats.drawMs.toFixed(1)} · encode ${stats.encodeMs.toFixed(1)} · write ${stats.writeMs.toFixed(1)} ms · ${stats.tiles} tiles`
    try {
      fs.writeFileSync(path.join(HERE, "stats.json"), JSON.stringify(stats))
    } catch {}
  }, 2000)
  report.unref()

  terminal.on("resize", () => renderer.resize(terminal.width, terminal.height, terminal.cell.height))
  terminal.on("key", async (key) => {
    if (key === "q" || key === "\x03") quit()
    else if (key === "s") wantShot = `live-${Date.now()}.png`
    else if (key === "d") {
      demo = !demo
      try {
        source.close()
      } catch {}
      scene = new Scene()
      source = await makeSource(demo)
      lastPoll = 0
    }
  })
  process.on("SIGUSR1", () => {
    wantShot = "latest.png"
  })
  process.on("SIGINT", quit)
  process.on("SIGTERM", quit)
  process.on("SIGHUP", quit)
  tick()
}

if (OPTIONS.frames > 0) await runHeadless()
else await runTerminal()
