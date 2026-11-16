#!/usr/bin/env node
// Checks the interactions v5 added, so a change cannot silently break them.
//   node --no-warnings v5/tools/check.mjs [--size 1365x2460] [--shots]
// The demo runs on a clock of its own (33 ms a step, as fast as the machine goes) and the
// input is the same events a mouse and a keyboard send. Every place it points at is taken from
// the picture's own geometry and targets, so the checks hold at any size. It checks:
//   reach        REACH is drawn for the focused thread, its head and a target open their cards,
//                and a bar is the tool call's own target
//   resting row  a resting row says what its last turn was, and that reading opens its card
//   scrub        a drag along the terrain holds a moment: on the terrain, the charts and REACH
//   replay       while it is held the whole stage is of that moment (every target on it carries
//                the moment, the thread shown has no call from after it, the moving marks of
//                the core are grey) and every other part carries a NOW chip
//   cards        a card opened during the hold reads the moment (a line of THIS TURN, a dot of
//                the flock, a moon when there is one), one opened on a part that is not
//                replayed says NOW, a pinned card leaves the moment held, and escape lets go
//                of the card first and of the moment second
//   resize       a change of size lays the picture out again, twice, with nothing left over
// It runs itself as a child with a time limit, so a loop that never ends is reported as a hang
// instead of hanging the caller. Exit code 0: every check passed.
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const LIMIT_MS = 150e3

if (!process.argv.includes("--child")) {
  const run = spawnSync(process.execPath, ["--no-warnings", fileURLToPath(import.meta.url), ...process.argv.slice(2), "--child"], { stdio: "inherit", timeout: LIMIT_MS })
  if (run.error?.code === "ETIMEDOUT" || run.signal) {
    console.log(`FAIL  hang: the checks did not finish in ${LIMIT_MS / 1000} s (a loop that never ends?)`)
    process.exit(3)
  }
  process.exit(run.status ?? 1)
}

const { DemoSource } = await import("../src/demo.mjs")
const { Renderer } = await import("../src/draw.mjs")
const { Flow } = await import("../src/flow.mjs")
const { Scene } = await import("../src/model.mjs")
const { Atlas } = await import("../src/sprites.mjs")
const { Controller } = await import("../src/ui.mjs")
const { THEN_INK } = await import("../src/replay.mjs")

const argument = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`)
  return index > 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}
const [W, H] = argument("size", "1365x2460").split("x").map(Number)
const shots = process.argv.includes("--shots")
const cell = { width: 15, height: 30 }
const source = new DemoSource({ demo: true, hours: 24, historyMs: 31 * 60e3 })
await source.open()
const flow = new Flow()
const renderer = new Renderer(flow)
renderer.bandHeight = cell.height * 3
renderer.resize(W, H, cell)
const atlas = new Atlas(cell.width, cell.height)
const scene = new Scene()
const controller = new Controller({ renderer, terminal: { mouseModes: {}, input: { pixels: true } }, scene: () => scene, actions: {}, logFile: null })
const ui = controller.ui

let now = Date.now()
let lastPoll = 0
let sprites = []
const step = (count = 1) => {
  for (let index = 0; index < count; index += 1) {
    now += 33
    if (now - lastPoll >= 250) {
      lastPoll = now
      scene.ingest(source.poll(now), now)
    }
    if (!scene.world) continue
    controller.refresh(now)
    renderer.update(scene, ui, now, { line: "check" })
    sprites = []
    renderer.react(scene, scene.takeSignals(), now)
    flow.frame(now, sprites)
    renderer.sprites(scene, ui, now, sprites)
  }
}
const at = (x, y) => ({ x: Math.round(x), y: Math.round(y), col: Math.floor(x / cell.width), row: Math.floor(y / cell.height) })
const mouse = (kind, x, y, button = "left") => controller.handle({ type: "mouse", kind, button: kind === "move" ? null : button, ...at(x, y) }, now)
const key = (name) => controller.handle({ type: "key", key: name }, now)
const middle = (rect) => [rect.x + rect.w / 2, rect.y + rect.h / 2]
const save = (name) => {
  if (!shots) return
  fs.mkdirSync(path.join(HERE, "..", "shots"), { recursive: true })
  fs.writeFileSync(path.join(HERE, "..", "shots", name), renderer.flatten("#15191e", sprites, atlas).toBuffer("image/png"))
}
const targets = (region) => renderer.hits.get(region) ?? []
const everyTarget = () => [...renderer.hits.values()].flat()
// the pointer rests on a place until its card is open (the dwell is 140 ms)
const hover = (x, y) => {
  mouse("move", x, y)
  step(8)
  return renderer.cardContent
}
const clock = (time) => new Date(time).toTimeString().slice(0, 8)

const results = []
const check = (name, ok, detail = "") => {
  results.push(ok)
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${detail ? `: ${detail}` : ""}`)
}

// ---------------------------------------------------------------- a thread worth looking at
// run the demo until a thread is in the middle of a turn that has made tool calls and has a
// resting sibling on screen, and hold the focus on it
let sid = null
for (let tick = 0; tick < 4000 && !sid; tick += 1) {
  step()
  if (!scene.world) continue
  const busy = scene.threads.filter((row) => row.session.state === "working" && row.session.turn && row.session.steps.reduce((sum, entry) => sum + entry.tools.length, 0) >= 3 && now - row.session.turn.start > 40e3)
  // one with a subagent first, so the moons are checked too
  const pick = busy.find((row) => scene.threads.some((other) => other.parent?.session.id === row.session.id)) ?? busy[0]
  if (pick && tick > 60) sid = pick.session.id
}
check("demo", Boolean(sid), sid ? `thread ${sid} is in a turn with tool calls` : "no working thread with tool calls came up")
if (!sid) process.exit(1)
scene.lock(sid, now)
step(40)
save("check-0-now.png")

// ---------------------------------------------------------------- REACH
{
  const list = targets("reach")
  const head = list.find((target) => target.kind === "note" && target.id === "reach")
  check("reach: drawn", Boolean(renderer.G.reach && head), renderer.G.reach ? `${list.length} targets` : "the layout gave REACH no room")
  if (head) {
    const card = hover(...middle(head.rect))
    check("reach: the head opens its card", card?.kicker === "REACH", card ? `${card.kicker}: ${card.title}` : "no card")
    const leaf = list.find((target) => target.kind === "note" && target.id.startsWith("reach:"))
    if (leaf) {
      const leafCard = hover(leaf.rect.x + 30, leaf.rect.y + leaf.rect.h / 2)
      check("reach: a target opens its card", Boolean(leafCard?.kicker.startsWith("REACH · ")), leafCard ? `${leafCard.kicker}: ${leafCard.title}` : "no card")
    } else check("reach: a target opens its card", false, "no target row is drawn")
    const bar = list.find((target) => target.kind === "tool")
    if (bar) {
      const barCard = hover(...middle(bar.rect))
      check("reach: a bar is its tool call", ui.hover?.kind === "tool" && Boolean(barCard), barCard ? `${barCard.kicker}: ${barCard.title}` : `hover is ${ui.hover?.kind ?? "nothing"}`)
    } else check("reach: a bar is its tool call", false, "no bar is drawn")
  }
}

// ---------------------------------------------------------------- a resting row
{
  const last = everyTarget().find((target) => target.kind === "note" && String(target.id).startsWith("last:"))
  if (last) {
    const card = hover(...middle(last.rect))
    const names = (card?.lines ?? []).map((line) => line[0]).filter(Boolean)
    check("resting row: its last turn opens its card", card?.kicker === "LAST TURN" && names.includes("RAN"), card ? `${card.kicker}: ${card.title}  (${names.join(", ")})` : "no card")
  } else check("resting row: its last turn opens its card", false, "no resting row with a last turn is on screen")
}

// ---------------------------------------------------------------- scrubbing and the replay
let held = null
{
  mouse("move", 5, 5)
  step(3)
  const geo = renderer.terrainGeo
  const front = geo?.ridges.find((ridge) => ridge.depth === 0)
  check("scrub: the terrain has a front ridge", Boolean(front && front.sid === sid), front ? `thread ${front.sid}` : "no ridge")
  if (front) {
    const y = front.base - 3
    const from = front.left + (front.right - front.left) * 0.86
    const to = front.left + (front.right - front.left) * 0.62
    mouse("down", from, y)
    step(2)
    mouse("drag", (from + to) / 2, y)
    step(2)
    mouse("drag", to, y)
    step(2)
    mouse("up", to, y)
    step(12)
    held = ui.hold?.target.at ?? null
    const want = renderer.terrainTimeAt(to, y)
    check("scrub: a drag holds a moment", held !== null && Math.abs(held - want) <= geo.slice, held !== null ? `${clock(held)}, ${Math.round((now - held) / 1000)} s ago` : "nothing is held")
    check("scrub: the focus did not move", scene.focus.id === sid)
    check("scrub: the moment's own card shows while the pointer rests on the terrain", renderer.cardContent?.kicker === "SCRUB", renderer.cardContent ? renderer.cardContent.kicker : "no card")
    const marks = sprites.filter((sprite) => String(sprite.key).startsWith("scrub:"))
    check("scrub: a mark on every ridge", marks.length === geo.ridges.filter((ridge) => renderer.ridgeSpot(ridge, held)).length && marks.length > 0, `${marks.length} marks`)
  }
}
if (held !== null) {
  save("check-1-held.png")
  const then = renderer.thenKept
  check("replay: the stage is read as of the moment", then?.at === held && then.session.then === held)
  const late = then ? then.session.steps.filter((entry) => entry.start > held).length + then.session.steps.flatMap((entry) => entry.tools).filter((tool) => tool.start > held || (tool.end !== null && tool.end > held)).length : -1
  check("replay: the thread shown has nothing from after the moment", late === 0, `${then?.session.steps.length ?? 0} calls kept, ${late} from later`)
  const stage = ["core", "flockline", "plinth", "cache", "under", "reach", "head", "charts", "tail"].filter((name) => renderer.regions.some((region) => region.name === name))
  const unstamped = stage.filter((name) => targets(name).some((target) => target.then !== held))
  check("replay: every target of the stage carries the moment", unstamped.length === 0, unstamped.length ? `not: ${unstamped.join(", ")}` : stage.join(", "))
  const parts = ["header", "rails", "top", "ports", "comms", "footer", "log"]
  const bare = parts.filter((name) => !targets(name).some((target) => target.kind === "note" && target.id === `now:${name}`))
  check("replay: every part that is not replayed carries a NOW chip", bare.length === 0, bare.length ? `not: ${bare.join(", ")}` : parts.join(", "))
  const box = renderer.G.coreBox
  const coloured = sprites.filter((sprite) => sprite.key && /^(fl|sat|moon|core|ring-head)/.test(String(sprite.key)) && sprite.x >= box.x && sprite.x < box.x + box.w && sprite.y >= box.y && sprite.y < box.y + box.h && !String(sprite.kind).endsWith(`|${THEN_INK}`))
  check("replay: the moving marks of the core are grey", coloured.length === 0, coloured.length ? `${coloured.length} in colour, the first: ${coloured[0].key} ${coloured[0].kind}` : "")
  const lines = renderer.heldLines
  check("replay: REACH, the charts and the live text are of the moment", ["reach", "charts", "tail"].every((name) => !renderer.regions.some((region) => region.name === name) || renderer.regions.find((region) => region.name === name).last?.startsWith(`then ${held}|`)))

  // a card opened during the hold reads the moment
  const line = targets("under").find((target) => target.kind === "note")
  if (line) {
    const card = hover(...middle(line.rect))
    check("cards: a line of THIS TURN reads the moment", Boolean(card?.kicker.startsWith(`THEN ${clock(held)}`)) && card.lines[0][0] === "AS OF", card ? card.kicker : "no card")
  } else check("cards: a line of THIS TURN reads the moment", false, "THIS TURN has no line")
  // a dot of the flock: aim at it until the pointer is on it (it flies)
  const flock = renderer.flock
  let onDot = false
  for (let attempt = 0; attempt < 90 && !onDot; attempt += 1) {
    let index = -1
    // (one that is in the globe: a dot out with a tool call flies behind its satellite, which is the target there)
    for (let dot = flock.count - 1; dot >= 0 && index < 0; dot -= 1) if (flock.level[dot] && !flock.squad[dot] && flock.stage[dot] === 3 && !flock.under[dot]) index = dot
    if (index < 0) break
    mouse("move", flock.sx[index], flock.sy[index])
    step(1)
    // the dot is held under the pointer; a satellite that passes over it takes the pointer, so
    // the card is read as soon as it is the dot's
    for (let wait = 0; wait < 8 && ui.hover?.kind === "dot" && !onDot; wait += 1) {
      step(1)
      onDot = Boolean(renderer.cardContent?.kicker.endsWith("OUTPUT DOT"))
    }
  }
  if (onDot) {
    const card = renderer.cardContent
    const thread = card?.lines.find((entry) => entry[0] === "THREAD")
    check("cards: a dot of the flock of then reads the moment", Boolean(card?.kicker.startsWith(`THEN ${clock(held)}`)) && card.kicker.endsWith("OUTPUT DOT") && Boolean(thread), card ? `${card.kicker}: ${card.title}` : "no card")
    // pinning it leaves the moment held; escape lets the card go first, the moment second
    mouse("down", ui.pointer.x, ui.pointer.y)
    mouse("up", ui.pointer.x, ui.pointer.y)
    step(3)
    check("cards: a pinned card leaves the moment held", Boolean(ui.pinned) && ui.hold?.target.at === held && renderer.thenKept?.at === held, ui.pinned ? `pinned ${ui.pinned.target.kind}` : "nothing is pinned")
    key("escape")
    step(3)
    check("cards: escape lets go of the card first", !ui.pinned && ui.hold?.target.at === held)
  } else check("cards: a dot of the flock of then reads the moment", false, flock.count ? "the pointer never came to rest on a dot" : "the flock of then has no dot")
  const moon = (renderer.moons ?? [])[0]
  if (moon) {
    const card = hover(moon.x, moon.y)
    check("cards: a moon reads its subagent as of the moment", Boolean(card?.kicker.startsWith(`THEN ${clock(held)}`)), card ? `${card.kicker}: ${card.title}` : "no card")
  } else console.log("note  cards: no subagent of this thread had been dispatched by the moment, so no moon to check")
  // (an equipment box the moment's own card does not stand over)
  mouse("move", 5, 5)
  step(3)
  const shown = renderer.card
  const port = targets("layout").find((target) => target.kind === "port" && !(shown && target.rect.x < shown.left + shown.w && target.rect.x + target.rect.w > shown.left && target.rect.y < shown.top + shown.h && target.rect.y + target.rect.h > shown.top))
  if (port) {
    const card = hover(...middle(port.rect))
    check("cards: a part that is not replayed says NOW", Boolean(card?.kicker.startsWith("NOW  ·  ")), card ? card.kicker : "no card")
  }
  const chip = targets("top").find((target) => target.id === "now:top")
  if (chip) {
    const card = hover(...middle(chip.rect))
    check("cards: the NOW chip says why", card?.kicker === "NOW", card ? `${card.kicker}: ${card.title}` : "no card")
  }
  mouse("move", 5, 5)
  step(3)
  key("escape")
  step(12)
  save("check-2-released.png")
  check("cards: the next escape lets the moment go", !ui.hold && !renderer.thenKept)
  const left = everyTarget().filter((target) => target.then !== undefined || String(target.id).startsWith("now:"))
  check("replay: nothing of the moment is left on screen", left.length === 0, left.length ? `${left.length} targets, the first: ${left[0].kind} ${left[0].id}` : "")
}

// ---------------------------------------------------------------- a resize
{
  const before = { W: renderer.W, H: renderer.H, regions: renderer.regions.length }
  let fault = ""
  try {
    for (const [w, h] of [[W + 720, H], [W - 240, H - 300], [W, H]]) {
      renderer.resize(Math.round(w / cell.width) * cell.width, Math.round(h / cell.height) * cell.height, cell)
      step(20)
      if (!renderer.regions.length || !everyTarget().length) fault = `nothing was laid out at ${w}×${h}`
    }
  } catch (error) {
    fault = String(error?.stack ?? error).split("\n").slice(0, 2).join(" ")
  }
  check("resize: the picture is laid out again at three sizes", !fault && renderer.W === before.W && renderer.H === before.H && renderer.regions.length > 0, fault || `${before.regions} regions before, ${renderer.regions.length} after`)
  save("check-3-resized.png")
}

source.close?.()
const failed = results.filter((ok) => !ok).length
console.log(failed ? `${failed} of ${results.length} checks failed` : `all ${results.length} checks passed`)
process.exit(failed ? 1 : 0)
