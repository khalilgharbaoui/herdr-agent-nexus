// The terminal side: raw input, size and cell queries, and the two layers that go to the screen.
//
//   tiles    the still layer, cut into tiles of whole cells. A tile is sent only when its pixels
//            changed, under the other of two image ids, so it is never missing in between.
//   sprites  the moving layer. One atlas image is uploaded once; each sprite is a placement of a
//            window of it, and moving a sprite is one placement command of about 70 bytes.
//
// The diffing happens here on the main thread, the compressing and writing in the encoder worker.

import fs from "node:fs"
import path from "node:path"
import { Worker } from "node:worker_threads"
import { Input } from "./input.mjs"

// Which event-driven mark a sprite is, or "" when it is not one. A packet is the sign of a tool
// call on its synapse, a flash answers something that just happened, a ripple runs from a cell
// body, the phase lamp or a line.
const RED = "#ff4d5e"
function eventOf(sprite) {
  const [shape, hex] = String(sprite.kind).split("|")
  if (shape.startsWith("pk")) return hex === RED ? "packetsFailed" : "packets"
  if (sprite.key.startsWith("rp:")) return hex === RED ? "ripplesRed" : "ripples"
  if (/^f\d+$/.test(sprite.key)) return hex === RED ? "flashesRed" : "flashes"
  return ""
}

const ESC = "\x1b"
const TILE_COLS = 16
const PAYLOAD_SIZES = [32 << 10, 64 << 10, 128 << 10, 256 << 10, 512 << 10, 1 << 20] // see diffTiles
const TILE_ROWS = 3
const MAX_SPRITES = 960
const PAGE_BASE = 7200 // image ids of the sprite pages start here
const PROBE_SLOT = 999 // the placement that asks whether a page is still there
const PROBE_MS = 2000
// What the terminal's image store holds for one pane. Under herdr 0.9.5 it is 64 MiB (measured
// with tools/gfx-probe.mjs); past it the oldest image is dropped without a word. Ghostty on its
// own keeps 320 MB.
export const STORE_LIMIT = process.env.HERDR_ENV === "1" ? 64 * 1024 * 1024 : 320e6

const HERE = path.dirname(new URL(import.meta.url).pathname)

export class Terminal {
  constructor() {
    this.cell = { width: 15, height: 30 }
    this.inbox = ""
    this.listeners = { resize: [] }
    this.input = new Input()
    this.mouseModes = {}
    this.inflight = 0
    this.shadow = null
    this.reset = true
    this.onFrameDone = () => {}
    this.slots = new Map() // sprite key -> { slot, col, row, sx, sy }
    this.free = []
    for (let slot = MAX_SPRITES; slot >= 1; slot -= 1) this.free.push(slot)
    this.dropped = 0
    this.atlas = null
    this.probedAt = 0
    this.movedBy = {} // placements sent since the last report, by kind of mark
    this.eventsPlaced = {} // event-driven marks placed since the start, by kind
    this.tileBytes = new Map() // tile index -> bytes of pixels the terminal holds for it
    this.tilesHeld = 0
    this.cardBytes = 0
    this.gfx = { tail: "", answers: 0, uploads: 0, lost: [], refused: 0, last: "", lastAt: 0 }
  }

  write(text) {
    fs.writeSync(1, text)
  }

  on(event, listener) {
    this.listeners[event].push(listener)
  }

  // Sends a query followed by a device-attributes request and resolves with everything the
  // terminal said before the device-attributes answer.
  ask(sequence, timeout = 1500) {
    return new Promise((resolve) => {
      this.inbox = ""
      const started = Date.now()
      this.write(`${sequence}${ESC}[c`)
      const check = () => {
        const match = /\x1b\[\?[\d;]*c/.exec(this.inbox)
        if (match || Date.now() - started > timeout) {
          const reply = match ? this.inbox.slice(0, match.index) : this.inbox
          this.inbox = ""
          resolve(reply)
        } else setTimeout(check, 4)
      }
      check()
    })
  }

  async open() {
    process.stdin.setRawMode?.(true)
    process.stdin.resume()
    process.stdin.on("data", (chunk) => this.receive(chunk.toString("latin1")))
    const graphics = await this.ask(`${ESC}_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA${ESC}\\`)
    this.kitty = /_Gi=31;OK/.test(graphics)
    await this.measure()
    this.write(`${ESC}[?1049h${ESC}[?25l${ESC}[2J${ESC}[H`)
    // mouse: any-event tracking (hover), SGR reports, pixel positions; then ask what was taken
    this.write(`${ESC}[?1003h${ESC}[?1006h${ESC}[?1016h`)
    const modes = await this.ask(`${ESC}[?1000$p${ESC}[?1002$p${ESC}[?1003$p${ESC}[?1006$p${ESC}[?1016$p`, 800)
    for (const match of modes.matchAll(/\x1b\[\?(\d+);(\d)\$y/g)) this.mouseModes[match[1]] = Number(match[2])
    this.input.pixels = this.mouseModes[1016] === 1 || this.mouseModes[1016] === 3
    this.input.cell = this.cell
    this.input.origin = process.env.HERDR_ENV === "1" ? 1 : 0
    // the encoder makes short-lived strings and buffers only: a small young generation is enough
    this.worker = new Worker(path.join(HERE, "encoder.mjs"), { resourceLimits: { maxYoungGenerationSizeMb: 8 } })
    this.worker.on("message", (result) => {
      this.inflight = Math.max(0, this.inflight - 1)
      if (result.wiped) this.reset = true // the worker cleared the screen on its own: send everything again
      this.onFrameDone(result)
    })
    this.worker.on("error", (error) => {
      this.error = String(error?.message ?? error)
      this.inflight = 0
    })
    process.stdout.on("resize", () => {
      this.measure().then(() => {
        this.reset = true
        for (const listener of this.listeners.resize) listener()
      })
    })
    return this.kitty
  }

  async measure() {
    const reply = await this.ask(`${ESC}[16t${ESC}[14t`, 600)
    const cell = /\x1b\[6;(\d+);(\d+)t/.exec(reply)
    const area = /\x1b\[4;(\d+);(\d+)t/.exec(reply)
    const cols = process.stdout.columns || 100
    const rows = process.stdout.rows || 40
    if (cell) this.cell = { height: Number(cell[1]), width: Number(cell[2]) }
    else if (area) this.cell = { height: Math.round(Number(area[1]) / rows), width: Math.round(Number(area[2]) / cols) }
    this.cols = cols
    this.rows = rows
    this.width = cols * this.cell.width
    this.height = rows * this.cell.height
    this.input.cell = this.cell
  }

  receive(text) {
    this.inbox += text
    if (this.inbox.length > 65536) this.inbox = this.inbox.slice(-4096)
    if (text.includes("\x1b_G") || this.gfx.tail) this.answers(text)
    this.input.feed(text)
  }

  // What the terminal says about the sprite pages: an upload is answered with OK or an error,
  // and so is the heartbeat placement of every page. ENOENT means the terminal dropped the page
  // (its store was full): it goes up again with the next frame.
  answers(text) {
    const gfx = this.gfx
    const all = gfx.tail + text
    const pattern = /\x1b_G([^;\x1b]*);([^\x1b]*)\x1b\\/g
    let end = 0
    for (let match = pattern.exec(all); match; match = pattern.exec(all)) {
      end = match.index + match[0].length
      const id = Number(/(?:^|,)i=(\d+)/.exec(match[1])?.[1] ?? -1)
      const page = this.atlas?.byId.get(id - PAGE_BASE)
      if (!page) continue
      gfx.answers += 1
      gfx.last = match[2]
      gfx.lastAt = Date.now()
      if (match[2] === "OK") {
        page.held = true
        continue
      }
      if (!page.sent) continue // already known, the new upload is on its way
      page.held = false
      page.sent = false
      if (/^ENOENT/.test(match[2])) gfx.lost.push(Date.now())
      else gfx.refused += 1
      // its placements went with it: every sprite on that page is placed again
      for (const [key, entry] of this.slots) {
        if (entry.page !== page) continue
        this.free.push(entry.slot)
        this.slots.delete(key)
      }
    }
    const open = all.lastIndexOf("\x1b_G")
    gfx.tail = open >= end && all.length - open < 256 ? all.slice(open) : ""
  }

  // Bytes of pixels the terminal holds for this pane right now, as far as this side knows.
  get storeBytes() {
    let pages = 0
    if (this.atlas) for (const page of this.atlas.pages.values()) if (page.sent) pages += page.bytes
    return this.tilesHeld + pages + this.cardBytes
  }

  // True when the terminal keeps losing or refusing the sprite pages: the caller should paint
  // the moving layer into the tiles instead.
  get spritesFailing() {
    const now = Date.now()
    this.gfx.lost = this.gfx.lost.filter((at) => now - at < 60e3)
    return this.gfx.lost.length >= 3 || this.gfx.refused >= 3
  }

  get graphics() {
    const gfx = this.gfx
    const state = this.atlas?.state ?? { pages: 0, sent: 0, held: 0, lost: 0, mb: 0 }
    return {
      ...state,
      verdict: !state.sent ? "nothing up" : state.held === state.sent ? "held" : gfx.answers ? "partly held" : "no answer yet",
      answers: gfx.answers,
      lostLastMinute: gfx.lost.length,
      refusedUploads: gfx.refused,
      lastAnswer: gfx.last,
      answeredAgoMs: gfx.lastAt ? Date.now() - gfx.lastAt : null,
      storeMb: Number((this.storeBytes / 1e6).toFixed(1)),
      storeLimitMb: Number((STORE_LIMIT / 1e6).toFixed(1)),
    }
  }

  // Rows of the frame per tile row.
  get bandHeight() {
    return TILE_ROWS * this.cell.height
  }

  get bandCount() {
    return Math.ceil(this.height / this.bandHeight)
  }

  // Finds the tiles that differ from what the terminal is showing. `marks` flags the tile rows
  // worth reading back (one per tile row); null means none, and a reset reads all of them.
  // `spans` narrows a row to the columns that were painted (x0, x1 per row), so a small region
  // costs a small read.
  diffTiles(context, marks, spans) {
    const { width, height } = this
    const tileWidth = TILE_COLS * this.cell.width
    const bandHeight = this.bandHeight
    const across = Math.ceil(width / tileWidth)
    const down = this.bandCount
    const stride = width * 4
    let all = false
    if (!this.shadow || this.shadow.length !== stride * height || this.reset) {
      this.shadow = Buffer.alloc(stride * height) // what the terminal shows: nothing yet
      all = true
    }
    const shadow = this.shadow
    const dirty = []
    let need = 0
    if (all || marks) {
      for (let band = 0; band < down; band += 1) {
        if (!all && !marks[band]) continue
        const top = band * bandHeight
        const rows = Math.min(bandHeight, height - top)
        let first = 0
        let end = across
        if (!all && spans) {
          if (spans[band * 2 + 1] <= spans[band * 2]) continue
          first = Math.min(across - 1, Math.max(0, Math.floor(spans[band * 2] / tileWidth)))
          end = Math.min(across, Math.max(first + 1, Math.ceil(spans[band * 2 + 1] / tileWidth)))
        }
        const x0 = first * tileWidth
        const span = Math.min(width, end * tileWidth) - x0
        const local = span * 4
        const image = context.getImageData(x0, top, span, rows).data
        this.readBytes = (this.readBytes ?? 0) + span * rows * 4
        const bytes = Buffer.from(image.buffer, image.byteOffset, image.length)
        let changed = false
        for (let column = first; column < end; column += 1) {
          const left = column * tileWidth - x0
          const wide = Math.min(tileWidth, width - column * tileWidth)
          let same = true
          for (let row = 0; row < rows && same; row += 1) {
            const at = row * local + left * 4
            const was = (top + row) * stride + (x0 + left) * 4
            same = bytes.compare(shadow, was, was + wide * 4, at, at + wide * 4) === 0
          }
          if (same) continue
          changed = true
          dirty.push({ index: band * across + column, width: wide, height: rows, offset: need, length: wide * rows * 4, bytes, left, local })
          need += wide * rows * 4
        }
        if (changed) for (let row = 0; row < rows; row += 1) shadow.set(bytes.subarray(row * local, (row + 1) * local), (top + row) * stride + x0 * 4)
      }
    }
    // The pixels travel in buffers of a few fixed sizes: one of 32 KB to 1 MB when that holds
    // them all, otherwise as many of 1 MB as it takes. A freed block of a size that comes again
    // is handed out again by the allocator; one buffer of exactly `need` bytes was a new size
    // at every large repaint (2 to 13 MB), and sixteen such dead blocks stayed in its cache.
    const chunks = []
    let target = null
    let words = null
    let used = 0
    let room = 0
    for (const tile of dirty) {
      if (tile.length > room - used) {
        let size = PAYLOAD_SIZES[PAYLOAD_SIZES.length - 1]
        if (!chunks.length) for (const candidate of PAYLOAD_SIZES) if (candidate >= need) {
          size = candidate
          break
        }
        const chunk = new ArrayBuffer(Math.max(size, tile.length))
        chunks.push(chunk)
        target = new Uint8Array(chunk)
        words = new Uint32Array(chunk)
        used = 0
        room = chunk.byteLength
      }
      tile.chunk = chunks.length - 1
      tile.offset = used
      used += tile.length
      for (let row = 0; row < tile.height; row += 1) {
        const at = row * tile.local + tile.left * 4
        target.set(tile.bytes.subarray(at, at + tile.width * 4), tile.offset + row * tile.width * 4)
      }
      let any = 0
      for (let index = tile.offset >> 2, end = (tile.offset + tile.length) >> 2; index < end; index += 1) any |= words[index]
      if (!any) tile.length = 0
      tile.bytes = undefined
      this.tilesHeld += tile.length - (this.tileBytes.get(tile.index) ?? 0)
      this.tileBytes.set(tile.index, tile.length)
    }
    return { chunks, dirty, across, down }
  }

  // Compares the sprites wanted this frame with the placements on screen and returns what has
  // to be placed (new or moved) and what has to go.
  diffSprites(sprites, atlas) {
    const places = []
    const deletes = []
    const wanted = (this.wanted ??= new Set()) // kept between frames: a few hundred keys, every frame
    wanted.clear()
    const pages = new Set()
    atlas.now = Date.now()
    this.atlas = atlas
    for (const sprite of sprites) {
      if (wanted.has(sprite.key)) continue
      const spot = atlas.locate(sprite.kind, sprite.x, sprite.y, this.cols, this.rows)
      if (!spot) continue
      let entry = this.slots.get(sprite.key)
      if (!entry) {
        const slot = this.free.pop()
        if (!slot) {
          this.dropped += 1
          continue
        }
        // which kind of mark it is: the key up to its first digit or colon names it
        entry = { slot, page: spot.page, col: -1, row: -1, sx: -1, sy: -1, z: 0, family: /^[a-z-]+/i.exec(sprite.key)?.[0] ?? "other" }
        this.slots.set(sprite.key, entry)
        // A mark that only an event brings (a packet, a flash, a ripple) is counted when it is
        // first placed: with the pages held by the terminal, that is the pane's own account of
        // having shown it, which a snapshot cannot give.
        const event = eventOf(sprite)
        if (event) this.eventsPlaced[event] = (this.eventsPlaced[event] ?? 0) + 1
      }
      wanted.add(sprite.key)
      if (!spot.page.sent) pages.add(spot.page)
      if (entry.page !== spot.page) {
        // the sprite changed to a shape on another page: its old placement goes
        if (entry.page.sent) deletes.push(PAGE_BASE + entry.page.id, entry.slot)
        entry.page = spot.page
        entry.col = -1
      }
      // Three layers: sprites behind the still layer (z 1 to 15), the still layer itself (z 20, see
      // the encoder), sprites in front of it (z 21 to 59) and what must never be covered (z 60).
      // Within a layer a nearer dot is drawn over a farther one.
      const z = sprite.top ? 60 : sprite.under ? 1 + Math.min(14, sprite.z ?? 0) : 21 + Math.min(29, sprite.z ?? 0)
      if (entry.col === spot.col && entry.row === spot.row && entry.sx === spot.sx && entry.sy === spot.sy && entry.z === z) continue
      entry.z = z
      entry.col = spot.col
      entry.row = spot.row
      entry.sx = spot.sx
      entry.sy = spot.sy
      places.push(entry.slot, spot.col, spot.row, spot.sx, spot.sy, spot.w, spot.h, z, PAGE_BASE + spot.page.id)
      this.movedBy[entry.family] = (this.movedBy[entry.family] ?? 0) + 1
    }
    for (const [key, entry] of this.slots) {
      if (wanted.has(key)) continue
      if (entry.page.sent) deletes.push(PAGE_BASE + entry.page.id, entry.slot)
      this.free.push(entry.slot)
      this.slots.delete(key)
    }
    return { places, deletes, pages }
  }

  // One frame: the tiles that changed and the sprites that moved, handed to the worker as one
  // message so they reach the screen inside one synchronized update.
  // Returns "busy" when two frames are already on their way, "still" when nothing changed.
  // `card` is the inspection card as its own image: { key, left, top, w, h, padX, padY, winW,
  // winH, width, height, pixels() }, or null when none is open.
  send(context, marks, sprites, atlas, spans = null, card = null) {
    if (this.inflight >= 2 || !this.worker) return "busy"
    const reset = this.reset
    if (reset) {
      // the terminal was cleared: every placement is gone and every sprite page with it
      this.slots.clear()
      this.free = []
      for (let slot = MAX_SPRITES; slot >= 1; slot -= 1) this.free.push(slot)
      atlas.forget()
      this.tileBytes.clear()
      this.tilesHeld = 0
      this.cardBytes = 0
      this.cardShown = null
    }
    let cardMessage = null
    const transfer = []
    if (card) {
      // herdr hands the host a whole-cell box, so the card is placed like a sprite: a window of
      // whole cells slid over a padded image
      const left = Math.min(Math.max(0, card.left), this.width - card.winW)
      const top = Math.min(Math.max(0, card.top), this.height - card.winH)
      const col = Math.floor(left / this.cell.width)
      const row = Math.floor(top / this.cell.height)
      const place = { col, row, sx: card.padX - (left - col * this.cell.width), sy: card.padY - (top - row * this.cell.height), w: card.winW, h: card.winH }
      const was = this.cardShown
      const fresh = !was || was.key !== card.key
      if (fresh || was.col !== place.col || was.row !== place.row || was.sx !== place.sx || was.sy !== place.sy) {
        cardMessage = { place, width: card.width, height: card.height }
        if (fresh) {
          const pixels = card.pixels()
          cardMessage.pixels = pixels.buffer.slice(pixels.byteOffset, pixels.byteOffset + pixels.length)
          transfer.push(cardMessage.pixels)
          this.cardBytes = card.width * card.height * 4
        }
      }
      this.cardShown = { key: card.key, ...place }
    } else if (this.cardShown) {
      cardMessage = { remove: true }
      this.cardShown = null
      this.cardBytes = 0
    }
    const { chunks, dirty, across, down } = this.diffTiles(context, marks, spans)
    const { places, deletes, pages } = this.diffSprites(sprites, atlas)
    // pages that were dropped to make room leave the terminal too, and their placements with them
    const dropPages = atlas.retired.map((id) => PAGE_BASE + id)
    atlas.retired = []
    if (this.sabotage) {
      // a test (SIGUSR2): one page is deleted on the terminal behind this side's back, as the
      // terminal does when its store is full. The heartbeat has to notice and send it again.
      this.sabotage = false
      const page = [...atlas.pages.values()].find((entry) => entry.sent && entry.held)
      if (page) dropPages.push(PAGE_BASE + page.id)
    }
    // the heartbeat: every sprite page is asked whether it is still there
    const now = Date.now()
    const probes = []
    if (now - this.probedAt > PROBE_MS) {
      this.probedAt = now
      for (const page of atlas.pages.values()) if (page.sent && now - page.sentAt > 300) probes.push(PAGE_BASE + page.id)
    }
    if (!reset && !dirty.length && !places.length && !deletes.length && !cardMessage && !dropPages.length && !probes.length) return "still"
    // A page goes up right before the first placement of it, after the tiles: an image without a
    // placement is the first one the terminal drops when its store is full.
    const uploads = []
    for (const page of pages) {
      const pixels = atlas.pixels(page)
      uploads.push({ id: PAGE_BASE + page.id, width: page.width, height: page.height, pixels })
      transfer.push(pixels)
      page.sent = true
      page.sentAt = now
      page.held = null
      this.gfx.uploads += 1
    }
    this.inflight += 1
    for (const chunk of chunks) transfer.push(chunk)
    this.worker.postMessage(
      { chunks, tiles: dirty, total: across * down, across, cellWidth: this.cell.width, cellHeight: this.cell.height, tileCols: TILE_COLS, tileRows: TILE_ROWS, reset, pages: uploads, dropPages, probes, probeSlot: PROBE_SLOT, places, deletes, card: cardMessage },
      transfer,
    )
    this.reset = false
    return "sent"
  }

  get spriteCount() {
    return this.slots.size
  }

  async close() {
    try {
      await this.worker?.terminate()
    } catch {}
    try {
      this.write(`${ESC}[?2026l${ESC}[?1016l${ESC}[?1006l${ESC}[?1003l${ESC}_Ga=d,d=A,q=2${ESC}\\${ESC}[?25h${ESC}[?1049l`)
      process.stdin.setRawMode?.(false)
      process.stdin.pause()
    } catch {}
  }
}
