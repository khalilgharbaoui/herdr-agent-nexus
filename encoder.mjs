// Encoder worker. It owns the terminal's output while Agent Nexus runs.
//
// The main thread cuts each frame into a grid of tiles (whole terminal cells) and sends here
// only the tiles whose pixels changed. Each one is deflated and sent as its own image under one
// of two alternating ids: the new image is placed first and the old one deleted after, and the
// whole frame goes out inside one synchronized-output bracket (DEC mode 2026), so the terminal
// never shows a half-updated or empty tile. A tile with nothing in it has no image at all.
// What a frame costs follows what moved in it.

import fs from "node:fs"
import { parentPort } from "node:worker_threads"
import zlib from "node:zlib"

const ESC = "\x1b"
const ID_BASE = 7300
const sleeper = new Int32Array(new SharedArrayBuffer(4))

function writeAll(buffer) {
  let offset = 0
  while (offset < buffer.length) {
    try {
      offset += fs.writeSync(1, buffer, offset, buffer.length - offset)
    } catch (error) {
      if (error.code !== "EAGAIN") throw error
      Atomics.wait(sleeper, 0, 0, 1)
    }
  }
}

let flips = new Uint8Array(0)
let shown = new Uint8Array(0) // 1 while a tile has an image on screen

parentPort.on("message", (message) => {
  const started = performance.now()
  const { tiles, total, cellWidth, cellHeight, tileCols, tileRows, across } = message
  const parts = []
  if (message.reset || flips.length !== total) {
    flips = new Uint8Array(total)
    shown = new Uint8Array(total)
    parts.push(`${ESC}[2J${ESC}_Ga=d,d=A,q=2${ESC}\\`)
  }
  let bytes = 0
  for (const tile of tiles) {
    const id = ID_BASE + tile.index * 2 + flips[tile.index]
    const old = ID_BASE + tile.index * 2 + (1 - flips[tile.index])
    if (tile.length) {
      const base64 = zlib.deflateSync(Buffer.from(message.pixels, tile.offset, tile.length), { level: 1 }).toString("base64")
      const keys = `a=T,f=32,o=z,s=${tile.width},v=${tile.height},i=${id},p=1,c=${Math.round(tile.width / cellWidth)},r=${Math.round(tile.height / cellHeight)},C=1,q=2`
      parts.push(`${ESC}[${Math.floor(tile.index / across) * tileRows + 1};${(tile.index % across) * tileCols + 1}H`)
      for (let offset = 0; offset < base64.length; offset += 4096) {
        const chunk = base64.slice(offset, offset + 4096)
        const more = offset + 4096 < base64.length ? 1 : 0
        parts.push(offset === 0 ? `${ESC}_G${keys},m=${more};${chunk}${ESC}\\` : `${ESC}_Gm=${more};${chunk}${ESC}\\`)
      }
      if (shown[tile.index]) parts.push(`${ESC}_Ga=d,d=I,i=${old},q=2${ESC}\\`)
      flips[tile.index] ^= 1
      shown[tile.index] = 1
      bytes += base64.length
    } else if (shown[tile.index]) {
      parts.push(`${ESC}_Ga=d,d=I,i=${old},q=2${ESC}\\`)
      shown[tile.index] = 0
    }
  }
  const encoded = performance.now()
  if (parts.length) writeAll(Buffer.from(`${ESC}[?2026h${parts.join("")}${ESC}[?2026l`, "latin1"))
  parentPort.postMessage({ bytes, tiles: tiles.length, of: total, encodeMs: encoded - started, writeMs: performance.now() - encoded })
})
