#!/usr/bin/env node
// Transport probe: asks the terminal what it supports and times a few frame shapes.
// Run it inside the pane that will show Agent Nexus. Results go to ./probe.json.

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { deflateSync } from "node:zlib"

const HERE = path.dirname(path.dirname(new URL(import.meta.url).pathname))
const ESC = "\x1b"
const out = { started: new Date().toISOString(), cols: process.stdout.columns, rows: process.stdout.rows, tests: {} }

process.stdin.setRawMode(true)
process.stdin.resume()
let inbox = ""
process.stdin.on("data", (chunk) => {
  inbox += chunk.toString("latin1")
})

function writeAll(text) {
  const buffer = Buffer.from(text, "latin1")
  let offset = 0
  while (offset < buffer.length) {
    try {
      offset += fs.writeSync(1, buffer, offset, buffer.length - offset)
    } catch (error) {
      if (error.code !== "EAGAIN") throw error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1)
    }
  }
}

// Send something, then a device-attributes request, and wait for the DA answer: everything
// before it is the terminal's reply to what was sent.
async function ask(sequence, timeout = 3000) {
  inbox = ""
  const started = performance.now()
  writeAll(`${sequence}${ESC}[c`)
  while (performance.now() - started < timeout) {
    if (/\x1b\[\?[\d;]*c/.test(inbox)) break
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  const ms = performance.now() - started
  const reply = inbox.replace(/\x1b\[\?[\d;]*c/, "")
  return { ms: Number(ms.toFixed(1)), reply: reply.replace(/\x1b/g, "ESC") }
}

function chunked(keys, base64) {
  const parts = []
  for (let offset = 0; offset < base64.length; offset += 4096) {
    const chunk = base64.slice(offset, offset + 4096)
    const more = offset + 4096 < base64.length ? 1 : 0
    parts.push(offset === 0 ? `${ESC}_G${keys},m=${more};${chunk}${ESC}\\` : `${ESC}_Gm=${more};${chunk}${ESC}\\`)
  }
  return parts.join("")
}

function image(width, height, fill) {
  const pixels = Buffer.alloc(width * height * 4)
  fill(pixels, width, height)
  return pixels
}
const sparse = (pixels, width, height) => {
  // hairlines and a few blocks on a transparent ground, like the real thing
  for (let y = 0; y < height; y += 40) for (let x = 0; x < width; x += 1) pixels.set([80, 200, 255, 255], (y * width + x) * 4)
  for (let block = 0; block < 60; block += 1) {
    const bx = (block * 131) % (width - 60)
    const by = (block * 71) % (height - 20)
    for (let y = by; y < by + 12; y += 1) for (let x = bx; x < bx + 50; x += 1) pixels.set([255, 180, 40, 255], (y * width + x) * 4)
  }
}
const noise = (pixels) => {
  let state = 12345
  for (let index = 0; index < pixels.length; index += 1) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0
    pixels[index] = state >>> 24
  }
}

writeAll(`${ESC}[?1049h${ESC}[?25l${ESC}[2J${ESC}[H`)

try {
  out.tests.sync2026 = await ask(`${ESC}[?2026$p`)
  out.tests.cellSize = await ask(`${ESC}[16t${ESC}[14t${ESC}[18t`)

  const tiny = deflateSync(Buffer.from([255, 0, 0, 128, 0, 255, 0, 0, 0, 0, 255, 255, 255, 255, 255, 255])).toString("base64")
  out.tests.rgbaZlib = await ask(`${ESC}[H${ESC}_Ga=T,f=32,o=z,s=2,v=2,i=901,p=1,c=1,r=1,C=1,q=0;${tiny}${ESC}\\`)
  out.tests.zIndexBelow = await ask(`${ESC}[H${ESC}_Ga=T,f=32,o=z,s=2,v=2,i=902,p=1,c=1,r=1,C=1,z=-1,q=0;${tiny}${ESC}\\`)
  out.tests.placeAgain = await ask(`${ESC}[3;3H${ESC}_Ga=p,i=901,p=2,c=1,r=1,C=1,q=0${ESC}\\`)
  out.tests.animationFrame = await ask(`${ESC}_Ga=f,i=901,f=32,o=z,s=2,v=2,x=0,y=0,q=0;${tiny}${ESC}\\`)
  out.tests.sourceRect = await ask(`${ESC}[5;5H${ESC}_Ga=p,i=901,p=3,x=0,y=0,w=1,h=1,c=1,r=1,C=1,q=0${ESC}\\`)

  const file = path.join(os.tmpdir(), `tty-graphics-protocol-nexus-${process.pid}.rgba`)
  fs.writeFileSync(file, Buffer.alloc(4 * 4 * 4, 200))
  out.tests.tempFile = await ask(`${ESC}[H${ESC}_Ga=T,t=t,f=32,s=4,v=4,i=903,p=1,c=1,r=1,C=1,q=0;${Buffer.from(file).toString("base64")}${ESC}\\`)
  out.tests.tempFileRemoved = !fs.existsSync(file)
  const plain = path.join(HERE, "scratch", `probe-${process.pid}.rgba`)
  fs.mkdirSync(path.dirname(plain), { recursive: true })
  fs.writeFileSync(plain, Buffer.alloc(4 * 4 * 4, 200))
  out.tests.plainFile = await ask(`${ESC}[H${ESC}_Ga=T,t=f,f=32,s=4,v=4,i=904,p=1,c=1,r=1,C=1,q=0;${Buffer.from(plain).toString("base64")}${ESC}\\`)
  fs.rmSync(plain, { force: true })
  fs.rmSync(file, { force: true })

  // timings: how long until the terminal has consumed a frame of each shape
  const cols = process.stdout.columns
  const rows = process.stdout.rows
  const cell = out.tests.cellSize.reply.match(/\[6;(\d+);(\d+)t/)
  const cw = cell ? Number(cell[2]) : 15
  const ch = cell ? Number(cell[1]) : 30
  const W = cols * cw
  const H = rows * ch
  out.native = { W, H, cw, ch }
  const shapes = {
    fullSparse: { w: W, h: H, c: cols, r: rows, fill: sparse },
    fullNoise: { w: W, h: H, c: cols, r: rows, fill: noise },
    halfSparse: { w: W, h: Math.round(H / 2 / ch) * ch, c: cols, r: Math.round(rows / 2), fill: sparse },
    tileNoise: { w: 16 * cw, h: 4 * ch, c: 16, r: 4, fill: noise },
  }
  for (const [name, shape] of Object.entries(shapes)) {
    const pixels = image(shape.w, shape.h, shape.fill)
    const t0 = performance.now()
    const base64 = deflateSync(pixels, { level: 1 }).toString("base64")
    const encodeMs = performance.now() - t0
    const samples = []
    let reply = ""
    for (let round = 0; round < 6; round += 1) {
      const id = 910 + (round % 2)
      const result = await ask(
        `${ESC}[?2026h${ESC}[H${chunked(`a=T,f=32,o=z,s=${shape.w},v=${shape.h},i=${id},p=1,c=${shape.c},r=${shape.r},C=1,q=${round === 0 ? 0 : 2}`, base64)}${ESC}_Ga=d,d=I,i=${id === 910 ? 911 : 910},q=2${ESC}\\${ESC}[?2026l`,
        8000,
      )
      samples.push(result.ms)
      if (round === 0) reply = result.reply
    }
    out.tests[`frame_${name}`] = { px: shape.w * shape.h, kb: Math.round(base64.length / 1024), encodeMs: Number(encodeMs.toFixed(1)), ms: samples, reply }
  }

  // many small tiles in one synchronized batch, each its own image
  {
    const tw = 16 * cw
    const th = 4 * ch
    const pixels = image(tw, th, noise)
    const base64 = deflateSync(pixels, { level: 1 }).toString("base64")
    const samples = []
    for (let round = 0; round < 6; round += 1) {
      const parts = [`${ESC}[?2026h`]
      let count = 0
      for (let row = 0; row + 4 <= rows && count < 60; row += 4) {
        for (let col = 0; col + 16 <= cols && count < 60; col += 16) {
          parts.push(`${ESC}[${row + 1};${col + 1}H${chunked(`a=T,f=32,o=z,s=${tw},v=${th},i=${1000 + count},p=1,c=16,r=4,C=1,q=2`, base64)}`)
          count += 1
        }
      }
      parts.push(`${ESC}[?2026l`)
      const result = await ask(parts.join(""), 8000)
      samples.push(result.ms)
      out.tests.tiles60 = { count, kbEach: Math.round(base64.length / 1024), ms: samples }
    }
  }
} catch (error) {
  out.error = String(error?.stack ?? error)
}

writeAll(`${ESC}_Ga=d,d=A,q=2${ESC}\\${ESC}[?25h${ESC}[?1049l`)
process.stdin.setRawMode(false)
out.finished = new Date().toISOString()
fs.writeFileSync(path.join(HERE, "probe.json"), JSON.stringify(out, null, 1))
process.exit(0)
