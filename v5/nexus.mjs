#!/usr/bin/env node
// Agent Nexus v5: every opencode session, subagent and herdr agent on this machine as a living
// circuit you can point at. Each thread is a neuron: quota runs in from its account, its own
// words ride on the axon, every tool call is a pulse out to the equipment it acts with and a
// pulse back. Threads are grouped by project, a phase strip says whether anything needs you, a
// call rings in the comms panel when a thread is waiting on you, and everything on screen
// answers to the pointer and the keyboard.
//
//   node --no-warnings v5/nexus.mjs                 live, in the current terminal
//   node --no-warnings v5/nexus.mjs --demo          simulated data (--demo-working 9: never fewer than nine threads at work)
//   node --no-warnings v5/nexus.mjs --frames 2 --size 1890x2460 [--demo] [--poke "move:900,1300;key:?"]
//
// Press ? for the keys and what the mouse does. SIGUSR1 writes v5/shots/latest.png. It reads
// opencode's database, the plugin's state files and herdr, writes nothing outside this folder,
// and the only thing it ever asks of herdr is to bring a pane to the front when you say so.

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import v8 from "node:v8"
import { createCanvas } from "@napi-rs/canvas"
import { profileAllocations } from "./src/allocations.mjs"
import { DemoSource } from "./src/demo.mjs"
import { Renderer } from "./src/draw.mjs"
import { Flow } from "./src/flow.mjs"
import { LiveSource } from "./src/live.mjs"
import { Scene } from "./src/model.mjs"
import { Atlas } from "./src/sprites.mjs"
import { STORE_LIMIT, Terminal } from "./src/terminal.mjs"
import { Controller } from "./src/ui.mjs"

const HERE = path.dirname(new URL(import.meta.url).pathname)
// Where this run writes what it says about itself (nexus.pid, stats.json, input.json, shots).
// A second copy beside the one in the pane (tools/resize-check.py) is given its own folder,
// so it does not write over the first one's files.
const RUN = process.env.NEXUS_RUN || HERE
const SHOTS = path.join(RUN, "shots")
const argument = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`)
  return index > 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}
const OPTIONS = {
  demo: process.argv.includes("--demo") || process.argv.includes("--demo-quiet"),
  quiet: process.argv.includes("--demo-quiet"), // simulated data with nobody working: what a still machine costs
  working: Number(argument("demo-working", process.env.NEXUS_DEMO_WORKING ?? 0)), // simulated data with never fewer than this many threads at work: what many working threads cost
  frames: Number(argument("frames", 0)),
  size: argument("size", "1890x2460"),
  cell: argument("cell", "15x30"),
  fps: Number(argument("fps", 30)),
  background: argument("bg", "#15191e"), // the pane's own background, so snapshots look like the screen
  db: argument("db", path.join(os.homedir(), ".local/share/opencode/opencode.db")),
  state: argument("state", path.join(os.homedir(), ".local/state/opencode-claude-code-plugin")),
  hours: Number(argument("hours", 24)),
  historyMs: 31 * 60e3, // the terrain's widest window is half an hour
  painted: process.argv.includes("--painted"), // moving parts painted into the tiles instead of sprites
  poke: argument("poke", ""), // headless only: a script of input events, to look at hover, click and key handling
  name: argument("name", ""),
  every: Number(argument("every", 1500)), // headless: milliseconds of real time between saved frames
}
const POLL_MS = 250
const QUIET_FPS = 10
const PAINTED_FPS = 15 // the painted transport sends whole tiles for every move: half the frames, half the cost

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
function step(source, scene, flow, renderer, controller, now, state, meta) {
  if (now - state.lastPoll >= POLL_MS) {
    const started = performance.now()
    state.lastPoll = now
    scene.ingest(source.poll(now), now)
    state.pollMs = performance.now() - started
    state.polls += 1
    controller.dirty = false
  } else if (controller.dirty && scene.world) {
    // a fold or a filter: the same data, listed again
    scene.ingest(scene.world, now)
    controller.dirty = false
  }
  controller.refresh(now)
  const changed = scene.world ? renderer.update(scene, controller.ui, now, meta) : false
  const sprites = []
  if (scene.world) {
    renderer.react(scene, scene.takeSignals(), now)
    flow.frame(now, sprites)
    renderer.sprites(scene, controller.ui, now, sprites)
  }
  return { changed, sprites }
}

// "move:900,1300;click:900,1300;key:?;wait:300" as input events.
function parsePoke(script, cell) {
  const events = []
  for (const part of script.split(";").map((entry) => entry.trim()).filter(Boolean)) {
    const [verb, rest = ""] = part.split(":")
    const numbers = rest.split(",").map(Number)
    const at = { x: numbers[0], y: numbers[1], col: Math.floor(numbers[0] / cell.width), row: Math.floor(numbers[1] / cell.height) }
    if (verb === "key") events.push({ type: "key", key: rest })
    else if (verb === "wait") events.push({ wait: numbers[0] })
    else if (verb === "move") events.push({ type: "mouse", kind: "move", button: null, ...at })
    else if (verb === "click" || verb === "middle") events.push({ type: "mouse", kind: "down", button: verb === "click" ? "left" : "middle", ...at }, { type: "mouse", kind: "up", button: verb === "click" ? "left" : "middle", ...at })
    else if (verb === "wheel") events.push({ type: "mouse", kind: "wheel", button: null, dy: numbers[2] ?? 1, dx: 0, ...at })
    else if (verb === "down" || verb === "drag" || verb === "up") events.push({ type: "mouse", kind: verb, button: "left", ...at })
  }
  return events
}

async function runHeadless() {
  const [width, height] = OPTIONS.size.split("x").map(Number)
  const [cellWidth, cellHeight] = OPTIONS.cell.split("x").map(Number)
  const cell = { width: cellWidth, height: cellHeight }
  const flow = new Flow()
  const renderer = new Renderer(flow)
  renderer.bandHeight = cellHeight * 3
  renderer.resize(width, height, cell)
  const atlas = new Atlas(cellWidth, cellHeight)
  const source = await makeSource(OPTIONS.demo)
  const scene = new Scene()
  const state = { lastPoll: 0, pollMs: 0, polls: 0 }
  const meta = { line: `${width}×${height} px  ·  headless` }
  const said = []
  const controller = new Controller({
    renderer,
    terminal: { mouseModes: { 1003: 1, 1006: 1, 1016: 1 }, input: { pixels: true } },
    scene: () => scene,
    actions: { quit: () => "quit", demo: () => "demo", transport: () => "transport", snapshot: () => "snapshot" },
    logFile: null,
  })
  const pokes = parsePoke(OPTIONS.poke, cell)
  if (!OPTIONS.demo) await sleep(1300) // herdr answers asynchronously
  for (let frame = 0; frame < OPTIONS.frames; frame += 1) {
    // run in real time for a moment so pulses are caught in flight, as on the screen
    let result = null
    let worst = 0
    const until = Date.now() + (frame === 0 ? 2600 : OPTIONS.every)
    let pokeAt = Date.now() + 1200
    while (Date.now() < until || (frame === 0 && pokes.length)) {
      const now = Date.now()
      if (frame === 0 && pokes.length && now >= pokeAt) {
        const event = pokes.shift()
        if (event.wait) pokeAt = now + event.wait
        else {
          controller.handle(event, now)
          said.push(`${event.type === "key" ? `key ${event.key}` : `${event.kind} ${event.x},${event.y}`}: ${controller.ui.info.did ?? ""} | hit ${controller.ui.info.hit ?? ""}`)
          pokeAt = now + 260
        }
      }
      const started = performance.now()
      result = step(source, scene, flow, renderer, controller, now, state, meta)
      worst = Math.max(worst, performance.now() - started)
      await sleep(30)
    }
    const name = OPTIONS.name ? `${OPTIONS.name}${OPTIONS.frames > 1 ? `-${frame}` : ""}.png` : `frame-${frame}${OPTIONS.demo ? "-demo" : ""}${width > height ? "-wide" : ""}.png`
    const file = saveShot(renderer, result.sprites, atlas, name)
    console.log(`${file}  worst step ${worst.toFixed(1)} ms  poll ${state.pollMs.toFixed(1)} ms  rows ${scene.rows.length}  sprites ${result.sprites.length}  phase ${scene.phase.level}  atlas ${atlas.state.pages} pages ${atlas.state.mb} MB  rss ${Math.round(process.memoryUsage().rss / 1048576)} MB  flock: ${renderer.flock.state}  ·  ${renderer.flock.stage.subarray(0, renderer.flock.count).reduce((sum, stage) => sum + (stage === 2 ? 1 : 0), 0)} siphoning`)
  }
  for (const line of said) console.log(`  ${line}`)
  source.close()
}

// A frame makes a few hundred short-lived objects and some pixel buffers. A small young
// generation collects them often, so dead ones do not pile up between collections, and it is
// small in itself: V8 holds two halves of it, 32 MB at its default of 16 MB a half. The size
// is fixed when the process starts (set later with v8.setFlagsFromString it changes nothing
// for this thread: measured, 34 MB held either way), so when it was not given on the command
// line this process is replaced by the same command with it. Nothing is left behind: execve
// keeps the pid, the terminal and the environment.
const SEMI_SPACE_MB = Number(process.env.NEXUS_SEMI) || 4
function withSmallYoungGeneration() {
  if (process.execArgv.some((flag) => flag.startsWith("--max-semi-space-size")) || process.env.NEXUS_REEXEC || typeof process.execve !== "function") return
  try {
    process.execve(process.execPath, [process.execPath, ...process.execArgv, `--max-semi-space-size=${SEMI_SPACE_MB}`, "--expose-gc", ...process.argv.slice(1)], { ...process.env, NEXUS_REEXEC: "1", MallocLargeCache: process.env.MallocLargeCache ?? "0" })
  } catch {}
}

async function runTerminal() {
  withSmallYoungGeneration()
  if (Number(process.env.NEXUS_ALLOC) > 0) profileAllocations(Number(process.env.NEXUS_ALLOC), path.join(RUN, "alloc.json"))
  const terminal = new Terminal()
  const kitty = await terminal.open()
  if (!kitty) {
    await terminal.close()
    console.error("This terminal did not answer the Kitty graphics query, so there is nothing to draw on.")
    process.exit(1)
  }
  const pidFile = path.join(RUN, "nexus.pid")
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
  let fallback = null // why the moving layer is painted when nobody asked for that
  let fallbackAt = 0
  let error = null
  let quitting = false
  let wantShot = null
  let waiting = false
  let readAll = true
  let composite = null
  let lastSpriteBands = null
  let lastSprites = []
  let lastFrameAt = 0
  let queued = false
  const state = { lastPoll: 0, pollMs: 0, polls: 0 }
  const total = { ticks: 0, sent: 0, still: 0, late: 0, step: 0, send: 0, bytes: 0, tileBytes: 0, spriteBytes: 0, tiles: 0, moved: 0, encode: 0, write: 0, done: 0, sprites: 0, poll: 0, polls: 0 }
  let mark = { ...total, at: performance.now(), cpu: process.cpuUsage(), input: 0 }
  let peak = 0
  const meta = { line: "" }
  // what V8 holds for each thread, in megabytes: the picture, the encoder, the transcript reader
  const heaps = { main: 0, encoder: null, cache: null, mainSpaces: {} }
  const readHeaps = () => {
    heaps.main = Math.round(process.memoryUsage().heapTotal / 1048576)
    // the main thread's heap by space, held and in use: "new" is the young generation
    heaps.mainSpaces = Object.fromEntries(
      v8
        .getHeapSpaceStatistics()
        .filter((space) => space.physical_space_size > 1 << 20)
        .map((space) => [space.space_name.replace(/_space$/, ""), `${Math.round(space.space_used_size / 1048576)}/${Math.round(space.physical_space_size / 1048576)}`]),
    )
    const ask = (worker, name) => {
      if (!worker?.getHeapStatistics) {
        heaps[name] = null
        return
      }
      worker
        .getHeapStatistics()
        .then((statistics) => {
          heaps[name] = Math.round(statistics.total_heap_size / 1048576)
        })
        .catch(() => {})
    }
    ask(terminal.worker, "encoder")
    ask(source.cacheWorker, "cache")
  }

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

  const controller = new Controller({
    renderer,
    terminal,
    scene: () => scene,
    logFile: path.join(RUN, "input.json"),
    actions: {
      quit: () => {
        quit()
        return "quit"
      },
      snapshot: () => {
        wantShot = `live-${Date.now()}.png`
        return "saved a snapshot to v5/shots"
      },
      transport: () => {
        painted = !painted
        fallback = null
        terminal.gfx.lost = []
        terminal.gfx.refused = 0
        if (painted) atlas.clear() // no sprite page stays on the terminal while it is not used
        else composite = null // and the painted layer's own canvas goes when sprites are back
        readAll = true
        lastSpriteBands = null
        return painted ? "moving layer painted into tiles" : "moving layer as sprites"
      },
      demo: () => {
        demo = !demo
        const old = source
        scene = new Scene()
        state.lastPoll = Infinity // hold polling until the new source is open
        makeSource(demo).then((next) => {
          source = next
          state.lastPoll = 0
          try {
            old.close()
          } catch {}
        })
        return demo ? "showing the simulation" : "showing live data"
      },
    },
  })

  // The fallback: the moving parts painted into a copy of the still layer, sent as ordinary tiles.
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
    }
    // the same three layers as the sprite transport: behind the still layer, the still layer, in front
    context.save()
    context.beginPath()
    for (let band = 0; band < bands.length; band += 1) if (bands[band]) context.rect(0, band * bandHeight, terminal.width, bandHeight)
    context.clip()
    for (const sprite of sprites) if (sprite.under) atlas.draw(context, sprite.kind, sprite.x, sprite.y)
    context.drawImage(renderer.canvas, 0, 0)
    context.restore()
    for (const sprite of sprites) if (!sprite.under) atlas.draw(context, sprite.kind, sprite.x, sprite.y)
    lastSpriteBands = now
    return { context, bands }
  }

  const frame = () => {
    if (quitting || terminal.inflight >= 2 || terminal.resizing) return
    waiting = false
    const started = performance.now()
    lastFrameAt = started
    const now = Date.now()
    total.ticks += 1
    try {
      const polls = state.polls
      const { changed, sprites } = step(source, scene, flow, renderer, controller, now, state, meta)
      if (state.polls !== polls) {
        total.poll += state.pollMs
        total.polls += 1
      }
      lastSprites = sprites
      total.sprites += sprites.length
      error = null
      const stepped = performance.now()
      total.step += stepped - started
      // The terminal answers for every sprite page. When it keeps dropping or refusing them, or
      // the tiles leave no room for them in its image store, the moving layer is painted into
      // the tiles instead, and the header says so.
      if (!painted) {
        const why = terminal.spritesFailing ? "the terminal keeps dropping the sprite images" : terminal.tilesHeld + atlas.budget + 6e6 > STORE_LIMIT ? "this pane leaves no room for sprite images" : null
        if (why) {
          painted = true
          fallback = why
          fallbackAt = now
          atlas.clear()
          readAll = true
          lastSpriteBands = null
        }
      } else if (fallback && now - fallbackAt > 60e3 && terminal.tilesHeld + atlas.budget + 6e6 <= STORE_LIMIT) {
        // a minute later, and with room in the store: sprites get another try
        painted = false
        fallback = null
        composite = null
        terminal.gfx.lost = []
        terminal.gfx.refused = 0
        atlas.clear()
        readAll = true
        lastSpriteBands = null
      }
      let outcome
      if (painted) {
        const { context, bands } = paintSprites(sprites, changed ? renderer.marks : null)
        outcome = terminal.send(context, bands, [], atlas, null, renderer.card)
      } else {
        terminal.lastDirty = null
        outcome = terminal.send(renderer.base, readAll ? new Uint8Array(terminal.bandCount).fill(1) : changed ? renderer.marks : null, sprites, atlas, readAll ? null : renderer.spans, renderer.card)
        if (!readAll && changed) renderer.attribute(terminal.lastDirty)
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
      error = String(caught?.stack ?? caught).slice(0, 900)
      readAll = true
    }
    controller.flush(now)
    if (wantShot) {
      try {
        saveShot(renderer, lastSprites, atlas, wantShot)
      } catch {}
      wantShot = null
      collectSoon() // the snapshot's own canvas is as large as the pane
    }
  }

  // Buffers as large as the pane that were just let go (the layers of the size before a resize,
  // a snapshot's canvas) are only freed when V8 collects their owners, and with a heap this
  // small and this steady that can be many minutes away. So it is asked to, once, a moment
  // after. (--expose-gc is given with the young generation's size; without it this does nothing.)
  let collecting = null
  const collectSoon = () => {
    if (typeof globalThis.gc !== "function") return
    clearTimeout(collecting)
    collecting = setTimeout(() => globalThis.gc(), 1200)
    collecting.unref()
  }

  let deflate = null
  terminal.onFrameDone = (result) => {
    deflate = result.deflate ?? deflate
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

  // Input is answered at once: a frame right after the event instead of at the next tick.
  terminal.input.on((event) => {
    controller.handle(event, Date.now())
    if (queued || quitting) return
    queued = true
    const wait = Math.max(0, 12 - (performance.now() - lastFrameAt))
    setTimeout(() => {
      queued = false
      frame()
    }, wait)
  })

  // 30 frames a second while anything is working, moving or being pointed at, a slow tick otherwise
  let next = performance.now()
  const tick = () => {
    if (quitting) return
    if (terminal.inflight >= 2) {
      waiting = true
      total.late += 1
    } else if (performance.now() - lastFrameAt > 8) frame()
    const phase = scene.phase
    const lively = scene.counts.working > 0 || scene.calls.length > 0 || flow.busy || wantShot || Date.now() < controller.ui.activeUntil || phase.level === "alert" || phase.cooling
    const frameMs = 1000 / (lively ? (painted ? Math.min(OPTIONS.fps, PAINTED_FPS) : OPTIONS.fps) : QUIET_FPS)
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
    const input = controller.counts.keys + controller.counts.moves + controller.counts.clicks + controller.counts.wheels
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
      stepMs: Number(((total.step - mark.step) / ticks).toFixed(2)), // data, input, repaint of what changed, sprite list
      sendMs: Number(((total.send - mark.send) / ticks).toFixed(2)), // read back and diff
      encodeMs: Number(((total.encode - mark.encode) / frames).toFixed(2)),
      writeMs: Number(((total.write - mark.write) / frames).toFixed(2)),
      pollMs: Number(((total.poll - mark.poll) / polls).toFixed(2)),
      peakMs: Number(peak.toFixed(1)),
      late: total.late - mark.late,
      cpuPercent: Number((((cpu.user + cpu.system) / 1e6 / seconds) * 100).toFixed(1)),
      rssMb: Math.round(process.memoryUsage().rss / 1048576),
      heapMb: Math.round(process.memoryUsage().heapUsed / 1048576),
      externalMb: Math.round(process.memoryUsage().external / 1048576),
      buffersMb: Math.round(process.memoryUsage().arrayBuffers / 1048576),
      heaps, // V8's heap per thread as of the last report (rssMb is the whole process; tools/mem-watch.mjs splits it further)
      cacheWorker: source.cacheKept ?? null, // what the transcript reader keeps: transcripts followed, calls and block stamps held, its own heap in use
      deflate, // how the encoder compresses: "one stream, kept" or, when its check failed, "a stream per image"
      readbackMbPerSecond: Number((((terminal.readBytes ?? 0) - (mark.read ?? 0)) / 1e6 / seconds).toFixed(1)), // pixels read back from the canvas to find what changed
      readbacksPerSecond: Number((((terminal.reads ?? 0) - (mark.reads ?? 0)) / seconds).toFixed(0)), // how many reads that took (one buffer each)
      resizes: terminal.resizes ?? 0, // sizes this run has settled on since it started
      movedPerFrameBy: Object.fromEntries(Object.entries(terminal.movedBy).map(([name, count]) => [name, Number((count / frames).toFixed(1))]).filter(([, rate]) => rate >= 1).sort((a, b) => b[1] - a[1])), // sprite placements a frame, by kind of mark
      repaintsPerSecond: Object.fromEntries(Object.entries(renderer.repaints ?? {}).map(([name, count]) => [name, Number((count / seconds).toFixed(1))]).filter(([, rate]) => rate >= 0.2).sort((a, b) => b[1] - a[1])), // which regions of the still layer were painted again, and how often
      tilesPerSecondBy: Object.fromEntries(Object.entries(renderer.tilesBy ?? {}).map(([name, count]) => [name, Number((count / seconds).toFixed(1))]).filter(([, rate]) => rate >= 0.1).sort((a, b) => b[1] - a[1])), // tiles that went out, by the region whose repaint changed them: what the still layer's bytes are spent on
      repaintCauses: Object.fromEntries(Object.entries(renderer.causes ?? {}).map(([name, count]) => [name, Number((count / seconds).toFixed(1))]).filter(([, rate]) => rate >= 0.5).sort((a, b) => b[1] - a[1])), // for the regions that name the parts of their signature: which part changed, times a second
      threads: scene.threads.length,
      working: scene.counts.working,
      phase: scene.phase.level,
      flags: scene.alerts.length,
      transport: painted ? "painted" : "sprites",
      fallback,
      graphics: terminal.graphics, // what the terminal itself answered about the sprite pages, and its image store
      droppedSprites: terminal.dropped,
      eventsPlaced: painted ? null : terminal.eventsPlaced, // event-driven marks placed on the terminal since the start: packets, flashes, ripples (red: a failure)
      mode: demo ? "DEMO" : "LIVE",
      mouseModes: terminal.mouseModes,
      pixelMouse: terminal.input.pixels,
      inputPerSecond: Number(((input - mark.input) / seconds).toFixed(1)),
      input: controller.counts,
      overlays: renderer.overlays.map((overlay) => overlay.name),
      load: os.loadavg()[0].toFixed(1),
      error: error ?? terminal.error ?? null,
    }
    mark = { ...total, at: now, cpu: process.cpuUsage(), input, read: terminal.readBytes ?? 0, reads: terminal.reads ?? 0 }
    readHeaps()
    renderer.repaints = {}
    renderer.causes = {}
    renderer.tilesBy = {}
    terminal.movedBy = {}
    peak = 0
    const verdict = painted ? (fallback ? `painted: ${fallback}` : "painted") : `sprites ${stats.graphics.verdict === "held" ? "held by the terminal" : stats.graphics.verdict}`
    meta.line = `${terminal.width}×${terminal.height} native  ·  ${stats.fps.toFixed(0)} fps  ·  ${stats.sprites} ${verdict}  ·  ${stats.kbPerSecond.toFixed(0)} kB/s  ·  cpu ${stats.cpuPercent.toFixed(0)}%`
    try {
      fs.writeFileSync(path.join(RUN, "stats.json"), JSON.stringify(stats))
    } catch {}
  }, 2000)
  report.unref()

  terminal.on("resize", () => {
    // the pages depend on the cell size only: a resize that keeps it keeps them
    if (atlas.cw !== terminal.cell.width || atlas.ch !== terminal.cell.height) atlas = new Atlas(terminal.cell.width, terminal.cell.height)
    renderer.bandHeight = terminal.bandHeight
    renderer.resize(terminal.width, terminal.height, terminal.cell)
    if (composite && (composite.width !== terminal.width || composite.height !== terminal.height)) composite = null
    readAll = true
    collectSoon()
  })
  process.on("SIGUSR1", () => {
    wantShot = "latest.png"
  })
  process.on("SIGUSR2", () => {
    terminal.sabotage = true // see Terminal.send: proves the heartbeat against the real terminal
  })
  process.on("SIGINT", quit)
  process.on("SIGTERM", quit)
  process.on("SIGHUP", quit)
  tick()
}

if (OPTIONS.frames > 0) await runHeadless()
else await runTerminal()
