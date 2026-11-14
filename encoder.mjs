// Encoder worker. It owns the terminal's output while Agent Nexus runs.
//
// The frame is cut into horizontal bands of whole cell rows. A band whose pixels did not
// change since the last frame is not sent at all. A band that changed is converted from
// Skia's premultiplied alpha to the straight alpha the Kitty protocol expects, deflated, and
// sent as its own image under one of two alternating ids: the new image is placed first and
// the old one deleted after, and the whole frame goes out inside one synchronized-output
// bracket (DEC mode 2026), so the terminal never shows a half-updated or empty band.

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

// UNPRE[alpha << 8 | channel] = channel * 255 / alpha
const UNPRE = new Uint8Array(65536)
for (let alpha = 1; alpha < 256; alpha += 1) {
  for (let channel = 0; channel < 256; channel += 1) UNPRE[(alpha << 8) | channel] = Math.min(255, Math.round((channel * 255) / alpha))
}

function straighten(source, target, count) {
  for (let index = 0; index < count; index += 1) {
    const pixel = source[index]
    const alpha = pixel >>> 24
    if (alpha === 255 || pixel === 0) {
      target[index] = pixel
      continue
    }
    if (alpha === 0) {
      target[index] = 0
      continue
    }
    const base = alpha << 8
    target[index] = ((alpha << 24) | (UNPRE[base | ((pixel >>> 16) & 255)] << 16) | (UNPRE[base | ((pixel >>> 8) & 255)] << 8) | UNPRE[base | (pixel & 255)]) >>> 0
  }
}

let buffers = [] // two SharedArrayBuffers the main thread fills in turn
let geometry = ""
let flips = new Uint8Array(0)
let scratch = new Uint32Array(0)
let havePrevious = false

parentPort.on("message", (message) => {
  if (message.buffers) {
    buffers = message.buffers.map((shared) => ({ bytes: Buffer.from(shared), words: new Uint32Array(shared) }))
    havePrevious = false
    return
  }
  const started = performance.now()
  const { index, width, height, cols, cellHeight, bandRows } = message
  const current = buffers[index]
  const previous = buffers[1 - index]
  const bandHeight = bandRows * cellHeight
  const bandCount = Math.ceil(height / bandHeight)
  const key = `${width}x${height}x${bandHeight}x${cols}`
  const parts = []
  let fresh = message.reset || !havePrevious || key !== geometry
  if (fresh) {
    geometry = key
    flips = new Uint8Array(bandCount)
    if (scratch.length < width * bandHeight) scratch = new Uint32Array(width * bandHeight)
    parts.push(`${ESC}[2J${ESC}_Ga=d,d=A,q=2${ESC}\\`)
  }
  let sent = 0
  let bytes = 0
  const stride = width * 4
  for (let band = 0; band < bandCount; band += 1) {
    const top = band * bandHeight
    const rows = Math.min(bandHeight, height - top)
    const from = top * stride
    const to = from + rows * stride
    if (!fresh && current.bytes.compare(previous.bytes, from, to, from, to) === 0) continue
    const count = width * rows
    straighten(current.words.subarray(top * width, top * width + count), scratch, count)
    const packed = zlib.deflateSync(Buffer.from(scratch.buffer, 0, count * 4), { level: 1 })
    const base64 = packed.toString("base64")
    const id = ID_BASE + band * 2 + flips[band]
    const old = ID_BASE + band * 2 + (1 - flips[band])
    flips[band] ^= 1
    const keys = `a=T,f=32,o=z,s=${width},v=${rows},i=${id},p=1,c=${cols},r=${Math.round(rows / cellHeight)},C=1,q=2`
    parts.push(`${ESC}[${band * bandRows + 1};1H`)
    for (let offset = 0; offset < base64.length; offset += 4096) {
      const chunk = base64.slice(offset, offset + 4096)
      const more = offset + 4096 < base64.length ? 1 : 0
      parts.push(offset === 0 ? `${ESC}_G${keys},m=${more};${chunk}${ESC}\\` : `${ESC}_Gm=${more};${chunk}${ESC}\\`)
    }
    parts.push(`${ESC}_Ga=d,d=I,i=${old},q=2${ESC}\\`)
    sent += 1
    bytes += base64.length
  }
  const encoded = performance.now()
  if (parts.length) writeAll(Buffer.from(`${ESC}[?2026h${parts.join("")}${ESC}[?2026l`, "latin1"))
  havePrevious = true
  parentPort.postMessage({ bytes, bands: sent, of: bandCount, encodeMs: encoded - started, writeMs: performance.now() - encoded })
})
