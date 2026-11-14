// The terminal side: raw input, size and cell queries, and the encoder worker.

import fs from "node:fs"
import path from "node:path"
import { Worker } from "node:worker_threads"

const ESC = "\x1b"
const TILE_COLS = 16
const TILE_ROWS = 3

// UNPRE[alpha << 8 | channel] = channel * 255 / alpha
const UNPRE = new Uint8Array(65536)
for (let alpha = 1; alpha < 256; alpha += 1) {
  for (let channel = 0; channel < 256; channel += 1) UNPRE[(alpha << 8) | channel] = Math.min(255, Math.round((channel * 255) / alpha))
}

// Copies one tile out of the frame as straight-alpha pixels. Returns false when it is empty.
function lift(words, width, left, top, tileWidth, rows, target, out) {
  let any = 0
  for (let row = 0; row < rows; row += 1) {
    let index = (top + row) * width + left
    for (const end = index + tileWidth; index < end; index += 1) {
      const pixel = words[index]
      const alpha = pixel >>> 24
      if (alpha === 255) target[out] = pixel
      else if (alpha !== 0) {
        const base = alpha << 8
        target[out] = ((alpha << 24) | (UNPRE[base | ((pixel >>> 16) & 255)] << 16) | (UNPRE[base | ((pixel >>> 8) & 255)] << 8) | UNPRE[base | (pixel & 255)]) >>> 0
      }
      any |= alpha
      out += 1
    }
  }
  return any !== 0
}

const HERE = path.dirname(path.dirname(new URL(import.meta.url).pathname))

export class Terminal {
  constructor() {
    this.cell = { width: 15, height: 30 }
    this.pixels = null
    this.inbox = ""
    this.listeners = { key: [], resize: [] }
    this.busy = false
    this.previous = null
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
      this.busy = false
      this.last = result
      this.onFrameDone(result)
    })
    this.worker.on("error", (error) => {
      this.error = String(error?.message ?? error)
      this.busy = false
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

  // Takes one frame (premultiplied RGBA, width x height), finds the tiles that differ from
  // the frame before, converts those to straight alpha and hands them to the worker.
  // Returns false while the previous frame is still being written.
  send(pixels) {
    if (this.busy || !this.worker) return false
    const { width, height } = this
    const tileWidth = TILE_COLS * this.cell.width
    const tileHeight = TILE_ROWS * this.cell.height
    const across = Math.ceil(width / tileWidth)
    const down = Math.ceil(height / tileHeight)
    const previous = this.previous && this.previous.length === pixels.length && !this.reset ? this.previous : null
    const words = new Uint32Array(pixels.buffer, pixels.byteOffset, pixels.length >> 2)
    const stride = width * 4
    const dirty = []
    let need = 0
    for (let band = 0; band < down; band += 1) {
      const top = band * tileHeight
      const rows = Math.min(tileHeight, height - top)
      const from = top * stride
      if (previous && pixels.compare(previous, from, from + rows * stride, from, from + rows * stride) === 0) continue
      for (let column = 0; column < across; column += 1) {
        const left = column * tileWidth
        const wide = Math.min(tileWidth, width - left)
        if (previous) {
          let same = true
          for (let row = 0; row < rows && same; row += 1) {
            const at = from + row * stride + left * 4
            same = pixels.compare(previous, at, at + wide * 4, at, at + wide * 4) === 0
          }
          if (same) continue
        }
        dirty.push({ index: band * across + column, left, top, width: wide, height: rows, offset: need, length: wide * rows * 4 })
        need += wide * rows * 4
      }
    }
    const payload = new ArrayBuffer(need)
    const target = new Uint32Array(payload)
    for (const tile of dirty) {
      if (!lift(words, width, tile.left, tile.top, tile.width, tile.height, target, tile.offset >> 2)) tile.length = 0
    }
    this.previous = pixels
    this.busy = true
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
