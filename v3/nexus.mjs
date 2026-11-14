#!/usr/bin/env node
// Agent Nexus v3: every opencode session, subagent and herdr agent on this machine as a living
// circuit. Each thread is drawn as a neuron: quota runs in from its account, its own words ride
// on the axon, and every tool call is a pulse out to what it acts on and a pulse back.
// Drawn with Skia at the terminal's native pixel size on a transparent ground. The still layer
// goes out as tiles, everything that moves is a sprite placement (Kitty graphics protocol).
//
//   node --no-warnings v3/nexus.mjs                 live, in the current terminal
//   node --no-warnings v3/nexus.mjs --demo          simulated data
//   node --no-warnings v3/nexus.mjs --frames 3 --size 1890x2460 [--demo]   headless PNGs in v3/shots/
//
// Keys: j k or arrows move the focus, 1 to 9 pick a thread, a follows the action again,
// d live or demo, p sprites or painted particles, s snapshot, q quit.
// SIGUSR1 writes v3/shots/latest.png. It reads opencode's database, the plugin's state files and
// herdr, and writes nothing outside this folder.

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createCanvas } from "@napi-rs/canvas"
import { DemoSource } from "./src/demo.mjs"
import { Renderer } from "./src/draw.mjs"
import { Flow } from "./src/flow.mjs"
import { LiveSource } from "./src/live.mjs"
import { Scene } from "./src/model.mjs"
import { Atlas } from "./src/sprites.mjs"
import { Terminal } from "./src/terminal.mjs"

const HERE = path.dirname(new URL(import.meta.url).pathname)
const SHOTS = path.join(HERE, "shots")
const argument = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`)
  return index > 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}
const OPTIONS = {
  demo: process.argv.includes("--demo") || process.argv.includes("--demo-quiet"),
  quiet: process.argv.includes("--demo-quiet"), // simulated data with nobody working: what a still machine costs
  frames: Number(argument("frames", 0)),
  size: argument("size", "1890x2460"),
  cell: argument("cell", "15x30"),
  fps: Number(argument("fps", 30)),
  background: argument("bg", "#15191e"), // the pane's own background, so snapshots look like the screen
  db: argument("db", path.join(os.homedir(), ".local/share/opencode/opencode.db")),
  state: argument("state", path.join(os.homedir(), ".local/state/opencode-claude-code-plugin")),
  hours: Number(argument("hours", 24)),
  historyMs: 16 * 60e3,
  painted: process.argv.includes("--painted"), // particles painted into the tiles instead of sprites
}
const POLL_MS = 250
const QUIET_FPS = 10

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function makeSource(demo) {
  const source = demo ? new DemoSource(OPTIONS) : new LiveSource(OPTIONS)
  await source.open()
  return source
}

function saveShot(renderer, sprites, atlas, name) {
  fs.mkdirSync(SHOTS, { recursive: true })
  const file = path.join(SHOTS, name)
  fs.writeFileSync(file, renderer.flatten(OPTIONS.background, sprites, atlas).toBuffer("image/png"))
  return file
}

// One step of the picture: data in, signals to pulses, the still layer repainted where it
// changed, and the list of sprites for this instant.
function advance(source, scene, flow, renderer, now, state, meta) {
  if (now - state.lastPoll >= POLL_MS) {
    const started = performance.now()
    state.lastPoll = now
    scene.capacity = renderer.G.capacity
    scene.ingest(source.poll(now), now)
    state.pollMs = performance.now() - started
    state.polls += 1
  }
  const changed = scene.world ? renderer.update(scene, now, meta) : false
  const sprites = []
  if (scene.world) {
    renderer.react(scene, scene.takeSignals(), now)
    flow.frame(now, sprites)
    renderer.sprites(scene, now, sprites)
  }
  return { changed, sprites }
}

async function runHeadless() {
  const [width, height] = OPTIONS.size.split("x").map(Number)
  const [cellWidth, cellHeight] = OPTIONS.cell.split("x").map(Number)
  const flow = new Flow()
  const renderer = new Renderer(flow)
  renderer.bandHeight = cellHeight * 3
  renderer.resize(width, height, { width: cellWidth, height: cellHeight })
  const atlas = new Atlas(cellWidth, cellHeight)
  const source = await makeSource(OPTIONS.demo)
  const scene = new Scene()
  const state = { lastPoll: 0, pollMs: 0, polls: 0 }
  const meta = { line: `${width}×${height} px  ·  headless` }
  if (!OPTIONS.demo) await sleep(1300) // herdr answers asynchronously
  for (let frame = 0; frame < OPTIONS.frames; frame += 1) {
    // run in real time for a moment so pulses are caught in flight, as on the screen
    let result = null
    let drawMs = 0
    const until = Date.now() + (frame === 0 ? 2600 : 1500)
    while (Date.now() < until) {
      const started = performance.now()
      result = advance(source, scene, flow, renderer, Date.now(), state, meta)
      drawMs = Math.max(drawMs, performance.now() - started)
      await sleep(30)
    }
    const file = saveShot(renderer, result.sprites, atlas, `frame-${frame}${OPTIONS.demo ? "-demo" : ""}${width > height ? "-wide" : ""}.png`)
    console.log(`${file}  worst step ${drawMs.toFixed(1)} ms  poll ${state.pollMs.toFixed(1)} ms  rows ${scene.rows.length}  sprites ${result.sprites.length}`)
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
  const flow = new Flow()
  const renderer = new Renderer(flow)
  let atlas = new Atlas(terminal.cell.width, terminal.cell.height)
  renderer.bandHeight = terminal.bandHeight
  renderer.resize(terminal.width, terminal.height, terminal.cell)
  let demo = OPTIONS.demo
  let source = await makeSource(demo)
  let scene = new Scene()
  let painted = OPTIONS.painted
  let error = null
  let quitting = false
  let wantShot = null
  let waiting = false
  let readAll = true
  let composite = null
  let lastSpriteBands = null
  let lastSprites = []
  const state = { lastPoll: 0, pollMs: 0, polls: 0 }
  const total = { ticks: 0, sent: 0, still: 0, late: 0, step: 0, send: 0, bytes: 0, tileBytes: 0, spriteBytes: 0, tiles: 0, moved: 0, encode: 0, write: 0, done: 0, sprites: 0, poll: 0, polls: 0 }
  let mark = { ...total, at: performance.now(), cpu: process.cpuUsage() }
  let peak = 0
  const meta = { line: "" }

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

  // The fallback: particles painted into a copy of the still layer, sent as ordinary tiles.
  const paintSprites = (sprites, changedMarks) => {
    const bandHeight = terminal.bandHeight
    const bands = new Uint8Array(terminal.bandCount)
    const now = new Uint8Array(terminal.bandCount)
    for (const sprite of sprites) {
      const first = Math.max(0, Math.floor((sprite.y - 24) / bandHeight))
      const last = Math.min(bands.length - 1, Math.floor((sprite.y + 24) / bandHeight))
      for (let band = first; band <= last; band += 1) now[band] = 1
    }
    if (!composite || composite.width !== terminal.width || composite.height !== terminal.height) {
      composite = createCanvas(terminal.width, terminal.height)
      lastSpriteBands = null
    }
    const context = composite.getContext("2d")
    for (let band = 0; band < bands.length; band += 1) {
      bands[band] = now[band] || (lastSpriteBands ? lastSpriteBands[band] : 1) || (changedMarks ? changedMarks[band] : 0) || (readAll ? 1 : 0)
      if (!bands[band]) continue
      const top = band * bandHeight
      context.clearRect(0, top, terminal.width, bandHeight)
      context.drawImage(renderer.canvas, 0, top, terminal.width, bandHeight, 0, top, terminal.width, bandHeight)
    }
    for (const sprite of sprites) atlas.draw(context, sprite.kind, sprite.x, sprite.y)
    lastSpriteBands = now
    return { context, bands }
  }

  const frame = () => {
    if (quitting || terminal.inflight >= 2) return
    waiting = false
    const started = performance.now()
    const now = Date.now()
    total.ticks += 1
    try {
      const polls = state.polls
      const { changed, sprites } = advance(source, scene, flow, renderer, now, state, meta)
      if (state.polls !== polls) {
        total.poll += state.pollMs
        total.polls += 1
      }
      lastSprites = sprites
      total.sprites += sprites.length
      error = null
      const stepped = performance.now()
      total.step += stepped - started
      let outcome
      if (painted) {
        const { context, bands } = paintSprites(sprites, changed ? renderer.marks : null)
        outcome = terminal.send(context, bands, [], atlas)
      } else {
        outcome = terminal.send(renderer.base, readAll ? new Uint8Array(terminal.bandCount).fill(1) : changed ? renderer.marks : null, sprites, atlas)
      }
      if (outcome === "sent") {
        total.sent += 1
        readAll = false
      } else if (outcome === "still") {
        total.still += 1
        readAll = false
      } else readAll = true // the still layer moved on while the pipe was full: read everything next time
      total.send += performance.now() - stepped
    } catch (caught) {
      error = String(caught?.stack ?? caught).slice(0, 700)
      readAll = true
    }
    if (wantShot) {
      try {
        saveShot(renderer, lastSprites, atlas, wantShot)
      } catch {}
      wantShot = null
    }
  }

  terminal.onFrameDone = (result) => {
    total.done += 1
    total.bytes += result.bytes
    total.tileBytes += result.tileBytes
    total.spriteBytes += result.spriteBytes
    total.tiles += result.tiles
    total.moved += result.moved
    total.encode += result.encodeMs
    total.write += result.writeMs
    peak = Math.max(peak, result.encodeMs + result.writeMs)
    if (waiting) frame()
  }

  // 30 frames a second while anything is working or moving, a slow tick when the machine is quiet
  let next = performance.now()
  const tick = () => {
    if (quitting) return
    if (terminal.inflight >= 2) {
      waiting = true
      total.late += 1
    } else frame()
    const lively = scene.counts.working > 0 || scene.counts.waiting > 0 || flow.busy || wantShot
    const frameMs = 1000 / (lively ? OPTIONS.fps : QUIET_FPS)
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
    const cpu = process.cpuUsage(mark.cpu)
    const ticks = Math.max(1, total.ticks - mark.ticks)
    const frames = Math.max(1, total.done - mark.done)
    const polls = Math.max(1, total.polls - mark.polls)
    const stats = {
      fps: Number(((total.ticks - mark.ticks) / seconds).toFixed(1)), // times a second the picture was brought up to date
      sent: Number(((total.done - mark.done) / seconds).toFixed(1)), // frames a second that differed and went to the terminal
      size: `${terminal.width}x${terminal.height}`,
      cols: terminal.cols,
      rows: terminal.rows,
      cell: terminal.cell,
      kbPerSecond: Number(((total.bytes - mark.bytes) / 1024 / seconds).toFixed(1)),
      tileKbPerSecond: Number(((total.tileBytes - mark.tileBytes) / 1024 / seconds).toFixed(1)),
      spriteKbPerSecond: Number(((total.spriteBytes - mark.spriteBytes) / 1024 / seconds).toFixed(1)),
      tilesPerFrame: Number(((total.tiles - mark.tiles) / frames).toFixed(1)),
      sprites: Math.round((total.sprites - mark.sprites) / ticks),
      movedPerFrame: Number(((total.moved - mark.moved) / frames).toFixed(1)),
      stepMs: Number(((total.step - mark.step) / ticks).toFixed(2)), // data, repaint of what changed, sprite list
      sendMs: Number(((total.send - mark.send) / ticks).toFixed(2)), // read back and diff
      encodeMs: Number(((total.encode - mark.encode) / frames).toFixed(2)),
      writeMs: Number(((total.write - mark.write) / frames).toFixed(2)),
      pollMs: Number(((total.poll - mark.poll) / polls).toFixed(2)),
      peakMs: Number(peak.toFixed(1)),
      late: total.late - mark.late,
      cpuPercent: Number((((cpu.user + cpu.system) / 1e6 / seconds) * 100).toFixed(1)),
      rssMb: Math.round(process.memoryUsage().rss / 1048576),
      threads: scene.rows.length,
      working: scene.counts.working,
      transport: painted ? "painted" : "sprites",
      droppedSprites: terminal.dropped,
      mode: demo ? "DEMO" : "LIVE",
      load: os.loadavg()[0].toFixed(1),
      error: error ?? terminal.error ?? null,
    }
    mark = { ...total, at: now, cpu: process.cpuUsage() }
    peak = 0
    meta.line = `${terminal.width}×${terminal.height} native  ·  ${stats.fps.toFixed(0)} fps  ·  ${stats.sprites} ${painted ? "painted" : "sprites"}  ·  ${stats.kbPerSecond.toFixed(0)} kB/s  ·  cpu ${stats.cpuPercent.toFixed(0)}%`
    try {
      fs.writeFileSync(path.join(HERE, "stats.json"), JSON.stringify(stats))
    } catch {}
  }, 2000)
  report.unref()

  terminal.on("resize", () => {
    atlas = new Atlas(terminal.cell.width, terminal.cell.height)
    renderer.bandHeight = terminal.bandHeight
    renderer.resize(terminal.width, terminal.height, terminal.cell)
    readAll = true
  })
  terminal.on("key", async (key) => {
    const now = Date.now()
    if (key === "q" || key === "\x03") quit()
    else if (key === "s") wantShot = `live-${now}.png`
    else if (key === "j" || key === "down") scene.moveFocus(1, now)
    else if (key === "k" || key === "up") scene.moveFocus(-1, now)
    else if (key === "a" || key === "f") scene.follow()
    else if (key >= "1" && key <= "9") scene.focusIndex(Number(key) - 1, now)
    else if (key === "p") {
      painted = !painted
      readAll = true
      lastSpriteBands = null
    } else if (key === "d") {
      demo = !demo
      try {
        source.close()
      } catch {}
      scene = new Scene()
      source = await makeSource(demo)
      state.lastPoll = 0
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
