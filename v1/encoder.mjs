// Agent Nexus frame encoder: runs in a worker so the main thread can draw the next frame
// while this one is compressed and written. Frames arrive in order and are written in order.
//
// Each frame: RGBA pixels -> RGB with the lowest bit of every channel dropped (a 2/255 step
// nobody can see, and a third fewer bytes after deflate) -> zlib -> base64 -> Kitty graphics
// escapes -> written straight to the terminal's file descriptor.

import fs from "node:fs"
import { parentPort } from "node:worker_threads"
import { deflateSync } from "node:zlib"

const ESC = "\x1b"
const sleeper = new Int32Array(new SharedArrayBuffer(4))

function writeAll(buffer) {
  let offset = 0
  while (offset < buffer.length) {
    try {
      offset += fs.writeSync(1, buffer, offset, buffer.length - offset)
    } catch (error) {
      if (error.code !== "EAGAIN") throw error
      Atomics.wait(sleeper, 0, 0, 2)
    }
  }
}

parentPort.on("message", (frame) => {
  const started = performance.now()
  const rgba = new Uint8Array(frame.pixels)
  const rgb = Buffer.allocUnsafe(frame.width * frame.height * 3)
  for (let source = 0, target = 0; source < rgba.length; source += 4, target += 3) {
    rgb[target] = rgba[source] & 0xfe
    rgb[target + 1] = rgba[source + 1] & 0xfe
    rgb[target + 2] = rgba[source + 2] & 0xfe
  }
  const base64 = deflateSync(rgb, { level: 1 }).toString("base64")
  const encoded = performance.now()
  const keys = `f=24,o=z,s=${frame.width},v=${frame.height}`
  const parts = [`${ESC}[H`]
  for (let offset = 0; offset < base64.length; offset += 4096) {
    const chunk = base64.slice(offset, offset + 4096)
    const more = offset + 4096 < base64.length ? 1 : 0
    parts.push(
      offset === 0
        ? `${ESC}_Ga=T,${keys},i=${frame.id},p=1,c=${frame.cols},r=${frame.rows},C=1,q=2,m=${more};${chunk}${ESC}\\`
        : `${ESC}_Gm=${more};${chunk}${ESC}\\`,
    )
  }
  parts.push(`${ESC}_Ga=d,d=I,i=${frame.old},q=2${ESC}\\`)
  writeAll(Buffer.from(parts.join(""), "latin1"))
  parentPort.postMessage({ bytes: base64.length, encodeMs: encoded - started, writeMs: performance.now() - encoded })
})
