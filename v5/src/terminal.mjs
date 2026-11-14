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

const ESC = "\x1b"
const TILE_COLS = 16
const TILE_ROWS = 3
const MAX_SPRITES = 960

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
    this.atlasSent = false
    this.dropped = 0
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
    this.worker = new Worker(path.join(HERE, "encoder.mjs"))
    this.worker.on("message", (result) => {
      this.inflight = Math.max(0, this.inflight - 1)
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
    this.input.feed(text)
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
  diffTiles(context, marks) {
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
        const from = top * stride
        const image = context.getImageData(0, top, width, rows).data
        const bytes = Buffer.from(image.buffer, image.byteOffset, image.length)
        if (bytes.compare(shadow, from, from + bytes.length) === 0) continue
        for (let column = 0; column < across; column += 1) {
          const left = column * tileWidth
          const wide = Math.min(tileWidth, width - left)
          let same = true
          for (let row = 0; row < rows && same; row += 1) {
            const at = row * stride + left * 4
            same = bytes.compare(shadow, from + at, from + at + wide * 4, at, at + wide * 4) === 0
          }
          if (same) continue
          dirty.push({ index: band * across + column, width: wide, height: rows, offset: need, length: wide * rows * 4, bytes, left })
          need += wide * rows * 4
        }
        shadow.set(bytes, from)
      }
    }
    const payload = new ArrayBuffer(need)
    const target = new Uint8Array(payload)
    const words = new Uint32Array(payload)
    for (const tile of dirty) {
      for (let row = 0; row < tile.height; row += 1) {
        const at = row * stride + tile.left * 4
        target.set(tile.bytes.subarray(at, at + tile.width * 4), tile.offset + row * tile.width * 4)
      }
      let any = 0
      for (let index = tile.offset >> 2, end = (tile.offset + tile.length) >> 2; index < end; index += 1) any |= words[index]
      if (!any) tile.length = 0
      tile.bytes = undefined
    }
    return { payload, dirty, across, down }
  }

  // Compares the sprites wanted this frame with the placements on screen and returns what has
  // to be placed (new or moved) and what has to go.
  diffSprites(sprites, atlas) {
    const places = []
    const deletes = []
    const wanted = new Set()
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
        entry = { slot, col: -1, row: -1, sx: -1, sy: -1, z: 0 }
        this.slots.set(sprite.key, entry)
      }
      wanted.add(sprite.key)
      const z = sprite.top ? 9 : 1 + (sprite.z ?? 0) // the flock stacks by depth: a nearer dot is drawn over a farther one
      if (entry.col === spot.col && entry.row === spot.row && entry.sx === spot.sx && entry.sy === spot.sy && entry.z === z) continue
      entry.z = z
      entry.col = spot.col
      entry.row = spot.row
      entry.sx = spot.sx
      entry.sy = spot.sy
      places.push(entry.slot, spot.col, spot.row, spot.sx, spot.sy, spot.w, spot.h, z)
    }
    for (const [key, entry] of this.slots) {
      if (wanted.has(key)) continue
      deletes.push(entry.slot)
      this.free.push(entry.slot)
      this.slots.delete(key)
    }
    return { places, deletes }
  }

  // One frame: the tiles that changed and the sprites that moved, handed to the worker as one
  // message so they reach the screen inside one synchronized update.
  // Returns "busy" when two frames are already on their way, "still" when nothing changed.
  send(context, marks, sprites, atlas) {
    if (this.inflight >= 2 || !this.worker) return "busy"
    const reset = this.reset
    if (reset) {
      // the terminal was cleared: every placement is gone and the atlas with it
      this.slots.clear()
      this.free = []
      for (let slot = MAX_SPRITES; slot >= 1; slot -= 1) this.free.push(slot)
      this.atlasSent = false
    }
    const { payload, dirty, across, down } = this.diffTiles(context, marks)
    const { places, deletes } = this.diffSprites(sprites, atlas)
    const needAtlas = !this.atlasSent && (places.length > 0 || reset)
    if (!reset && !dirty.length && !places.length && !deletes.length) return "still"
    let atlasMessage = null
    if (needAtlas) {
      const pixels = atlas.pixels()
      atlasMessage = { pixels: pixels.buffer.slice(pixels.byteOffset, pixels.byteOffset + pixels.length), width: atlas.width, height: atlas.height }
      this.atlasSent = true
    }
    this.inflight += 1
    const transfer = [payload]
    if (atlasMessage) transfer.push(atlasMessage.pixels)
    this.worker.postMessage(
      { pixels: payload, tiles: dirty, total: across * down, across, cellWidth: this.cell.width, cellHeight: this.cell.height, tileCols: TILE_COLS, tileRows: TILE_ROWS, reset, atlas: atlasMessage, places, deletes },
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
