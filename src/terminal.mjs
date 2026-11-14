// The terminal side: raw input, size and cell queries, and the encoder worker.

import fs from "node:fs"
import path from "node:path"
import { Worker } from "node:worker_threads"

const ESC = "\x1b"
const TILE_COLS = 16
const TILE_ROWS = 3

const HERE = path.dirname(path.dirname(new URL(import.meta.url).pathname))

export class Terminal {
  constructor() {
    this.cell = { width: 15, height: 30 }
    this.pixels = null
    this.inbox = ""
    this.listeners = { key: [], resize: [] }
    this.inflight = 0
    this.shadow = null
    this.reset = true
    this.last = { bytes: 0, tiles: 0, of: 0, encodeMs: 0, writeMs: 0 }
    this.onFrameDone = () => {}
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
    this.worker = new Worker(path.join(HERE, "encoder.mjs"))
    this.worker.on("message", (result) => {
      this.inflight = Math.max(0, this.inflight - 1)
      this.last = result
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
  }

  receive(text) {
    this.inbox += text
    // terminal replies are not keys
    const keys = text.replace(/\x1b\[[\d;?]*[a-zA-Z]/g, "").replace(/\x1b_G[^\x1b]*\x1b\\/g, "").replace(/\x1bP[^\x1b]*\x1b\\/g, "")
    for (const key of keys) for (const listener of this.listeners.key) listener(key)
  }

  // Rows of the frame per tile row.
  get bandHeight() {
    return TILE_ROWS * this.cell.height
  }

  get bandCount() {
    return Math.ceil(this.height / this.bandHeight)
  }

  // Reads the canvas back (straight alpha), finds the tiles that differ from what the terminal
  // is showing, and hands those to the worker. `marks` limits the read to the tile rows where
  // something moved (one flag per tile row); without it the whole frame is read.
  // Returns false when two frames are already on their way.
  send(context, marks) {
    if (this.inflight >= 2 || !this.worker) return false
    const { width, height } = this
    const tileWidth = TILE_COLS * this.cell.width
    const bandHeight = this.bandHeight
    const across = Math.ceil(width / tileWidth)
    const down = this.bandCount
    const stride = width * 4
    if (!this.shadow || this.shadow.length !== stride * height || this.reset) {
      this.shadow = Buffer.alloc(stride * height) // what the terminal shows: nothing yet
      marks = null
    }
    const shadow = this.shadow
    const dirty = []
    let need = 0
    for (let band = 0; band < down; band += 1) {
      if (marks && !marks[band]) continue
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
    this.inflight += 1
    this.worker.postMessage(
      { pixels: payload, tiles: dirty, total: across * down, across, cellWidth: this.cell.width, cellHeight: this.cell.height, tileCols: TILE_COLS, tileRows: TILE_ROWS, reset: this.reset },
      [payload],
    )
    this.reset = false
    return true
  }

  async close() {
    try {
      await this.worker?.terminate()
    } catch {}
    try {
      this.write(`${ESC}[?2026l${ESC}_Ga=d,d=A,q=2${ESC}\\${ESC}[?25h${ESC}[?1049l`)
      process.stdin.setRawMode?.(false)
      process.stdin.pause()
    } catch {}
  }
}
