// The terminal side: raw input, size and cell queries, and the encoder worker.

import fs from "node:fs"
import path from "node:path"
import { Worker } from "node:worker_threads"

const ESC = "\x1b"
const HERE = path.dirname(path.dirname(new URL(import.meta.url).pathname))

export class Terminal {
  constructor() {
    this.cell = { width: 15, height: 30 }
    this.pixels = null
    this.inbox = ""
    this.listeners = { key: [], resize: [] }
    this.busy = false
    this.flip = 0
    this.shared = null
    this.sharedBytes = 0
    this.reset = true
    this.last = { bytes: 0, bands: 0, of: 0, encodeMs: 0, writeMs: 0 }
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

  // Hands one frame (premultiplied RGBA, width x height) to the worker. Returns false while
  // the previous frame is still being written.
  send(pixels) {
    if (this.busy || !this.worker) return false
    if (this.sharedBytes !== pixels.length) {
      this.shared = [new SharedArrayBuffer(pixels.length), new SharedArrayBuffer(pixels.length)]
      this.views = this.shared.map((buffer) => new Uint8Array(buffer))
      this.sharedBytes = pixels.length
      this.worker.postMessage({ buffers: this.shared })
      this.reset = true
    }
    this.views[this.flip].set(pixels)
    this.busy = true
    this.worker.postMessage({
      index: this.flip,
      width: this.width,
      height: this.height,
      cols: this.cols,
      cellHeight: this.cell.height,
      bandRows: 3,
      reset: this.reset,
    })
    this.flip = 1 - this.flip
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
