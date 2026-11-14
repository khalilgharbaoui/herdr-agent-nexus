#!/usr/bin/env node
// Transport probe for v3: what does this terminal (herdr inside Ghostty) do with placements,
// source rectangles, z layers and animation frames, and what does moving sprites cost?
// Run it inside the pane that will show Agent Nexus. Results go to v3/probe.json.

import fs from "node:fs"
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

const sleeper = new Int32Array(new SharedArrayBuffer(4))
function writeAll(text) {
  const buffer = Buffer.from(text, "latin1")
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

// Send something, then a device-attributes request: everything before the DA answer is the reply.
async function ask(sequence, timeout = 4000) {
  inbox = ""
  const started = performance.now()
  writeAll(`${sequence}${ESC}[c`)
  while (performance.now() - started < timeout) {
    if (/\x1b\[\?[\d;]*c/.test(inbox)) break
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  const ms = performance.now() - started
  return { ms: Number(ms.toFixed(1)), reply: inbox.replace(/\x1b\[\?[\d;]*c/, "").replace(/\x1b/g, "ESC") }
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

const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)]
const summary = (list) => ({ median: median(list), min: Math.min(...list), max: Math.max(...list) })

writeAll(`${ESC}[?1049h${ESC}[?25l${ESC}[2J${ESC}[H`)

try {
  const cellReply = await ask(`${ESC}[16t${ESC}[14t`)
  const cell = cellReply.reply.match(/\[6;(\d+);(\d+)t/)
  const cw = cell ? Number(cell[2]) : 15
  const ch = cell ? Number(cell[1]) : 30
  const cols = process.stdout.columns
  const rows = process.stdout.rows
  out.native = { cw, ch, W: cols * cw, H: rows * ch }

  // feature queries (kitty 0.50): terminals without them answer without the e key, or not at all
  out.tests.featureT = await ask(`${ESC}_Ga=q,i=31,e=T,U=1,C=1,z=1${ESC}\\`)
  out.tests.featureP = await ask(`${ESC}_Ga=q,i=32,e=p,x=1,y=1,w=1,h=1,X=1,Y=1,z=1${ESC}\\`)
  out.tests.featureF = await ask(`${ESC}_Ga=q,i=33,e=f,r=1,X=1${ESC}\\`)
  out.tests.featureA = await ask(`${ESC}_Ga=q,i=34,e=a,s=3${ESC}\\`)

  // an atlas of padded dots: 16 tiles of 44x89, a dot at (14,29) in each
  const tileW = 44
  const tileH = 89
  const atlasW = tileW * 16
  const atlasH = tileH
  const atlas = Buffer.alloc(atlasW * atlasH * 4)
  for (let tile = 0; tile < 16; tile += 1) {
    for (let y = 0; y < 12; y += 1) {
      for (let x = 0; x < 12; x += 1) {
        const distance = Math.hypot(x - 5.5, y - 5.5)
        if (distance > 6) continue
        const at = ((29 + y) * atlasW + tile * tileW + 14 + x) * 4
        atlas[at] = 80 + tile * 10
        atlas[at + 1] = 227
        atlas[at + 2] = 255
        atlas[at + 3] = Math.round(255 * Math.min(1, 6 - distance))
      }
    }
  }
  const atlasData = deflateSync(atlas, { level: 6 }).toString("base64")
  out.tests.atlasKb = Number((atlasData.length / 1024).toFixed(1))
  // transmit only (a=t): stored, not displayed
  out.tests.atlasUpload = await ask(chunked(`a=t,f=32,o=z,s=${atlasW},v=${atlasH},i=6001,q=0`, atlasData))

  // one sprite window: 30x60 source pixels at a chosen pixel position, no cell offsets
  const place = (id, px, py, tile, quiet = 2, z = 1) => {
    const col = Math.floor(px / cw)
    const row = Math.floor(py / ch)
    const dx = px - col * cw
    const dy = py - row * ch
    return `${ESC}[${row + 1};${col + 1}H${ESC}_Ga=p,i=6001,p=${id},x=${tile * tileW + 14 - dx},y=${29 - dy},w=30,h=60,z=${z},C=1,q=${quiet}${ESC}\\`
  }
  out.tests.placeWindow = await ask(place(1, 200, 200, 0, 0))
  out.tests.moveSame = await ask(place(1, 207, 213, 1, 0))
  out.tests.placeOutOfBounds = await ask(`${ESC}[5;5H${ESC}_Ga=p,i=6001,p=2,x=${atlasW - 10},y=0,w=30,h=60,z=1,C=1,q=0${ESC}\\`)
  out.tests.placeUnknownImage = await ask(`${ESC}[5;5H${ESC}_Ga=p,i=6999,p=1,C=1,q=0${ESC}\\`)
  // delete one placement, the image must survive for the next placement
  writeAll(`${ESC}_Ga=d,d=i,i=6001,p=1,q=2${ESC}\\${ESC}_Ga=d,d=i,i=6001,p=2,q=2${ESC}\\`)
  out.tests.placeAfterDelete = await ask(place(3, 300, 300, 2, 0))
  writeAll(`${ESC}_Ga=d,d=i,i=6001,p=3,q=2${ESC}\\`)

  // a tile under the sprites (z=0) so both layers exist at once
  const tile = Buffer.alloc(240 * 90 * 4)
  for (let x = 0; x < 240; x += 1) for (let y = 40; y < 42; y += 1) tile.set([255, 180, 40, 255], (y * 240 + x) * 4)
  const tileData = deflateSync(tile, { level: 1 }).toString("base64")
  out.tests.tileUnder = await ask(`${ESC}[7;10H${chunked(`a=T,f=32,o=z,s=240,v=90,i=6100,p=1,c=16,r=3,z=0,C=1,q=0`, tileData)}`)
  out.tests.spriteOver = await ask(place(4, 200, 215, 3, 0, 1))

  // how long until the terminal has consumed a frame that moves N sprites
  const W = cols * cw
  const H = rows * ch
  for (const count of [50, 150, 300, 600]) {
    const samples = []
    let bytes = 0
    for (let frame = 0; frame < 45; frame += 1) {
      const parts = [`${ESC}[?2026h`]
      for (let index = 0; index < count; index += 1) {
        const px = Math.round(60 + ((index * 97 + frame * 5) % (W - 160)))
        const py = Math.round(120 + ((index * 61 + frame * 3) % (H - 300)))
        parts.push(place(100 + index, px, py, index % 16))
      }
      parts.push(`${ESC}[?2026l`)
      const text = parts.join("")
      bytes = text.length
      const result = await ask(text, 8000)
      samples.push(result.ms)
    }
    out.tests[`move${count}`] = { bytesPerFrame: bytes, ms: summary(samples.slice(5)) }
  }
  // the same without waiting for an answer each frame: 60 frames back to back, then one question
  {
    const started = performance.now()
    for (let frame = 0; frame < 60; frame += 1) {
      const parts = [`${ESC}[?2026h`]
      for (let index = 0; index < 300; index += 1) {
        const px = Math.round(60 + ((index * 97 + frame * 7) % (W - 160)))
        const py = Math.round(120 + ((index * 61 + frame * 4) % (H - 300)))
        parts.push(place(100 + index, px, py, index % 16))
      }
      parts.push(`${ESC}[?2026l`)
      writeAll(parts.join(""))
    }
    const answer = await ask("", 20000)
    out.tests.burst300x60 = { totalMs: Number((performance.now() - started).toFixed(1)), lastAnswerMs: answer.ms }
  }
  // clear the sprites one by one, as the real thing does
  {
    const parts = [`${ESC}[?2026h`]
    for (let index = 0; index < 600; index += 1) parts.push(`${ESC}_Ga=d,d=i,i=6001,p=${100 + index},q=2${ESC}\\`)
    parts.push(`${ESC}[?2026l`)
    out.tests.delete600 = await ask(parts.join(""), 8000)
  }
  out.tests.placeAfterMassDelete = await ask(place(5, 400, 400, 5, 0))

  // animation frames: accepted or not, and does asking it to play answer anything
  const tiny = deflateSync(Buffer.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255])).toString("base64")
  out.tests.animBase = await ask(`${ESC}[2;2H${ESC}_Ga=T,f=32,o=z,s=2,v=2,i=6200,p=1,c=1,r=1,C=1,q=0;${tiny}${ESC}\\`)
  out.tests.animFrame = await ask(`${ESC}_Ga=f,i=6200,f=32,o=z,s=2,v=2,z=100,q=0;${tiny}${ESC}\\`)
  out.tests.animPlay = await ask(`${ESC}_Ga=a,i=6200,s=3,v=1,q=0${ESC}\\`)
  out.tests.animSetFrame = await ask(`${ESC}_Ga=a,i=6200,c=2,q=0${ESC}\\`)

  // mouse reporting: does switching it on get refused or echoed (no click can be made from here)
  out.tests.mouseMode = await ask(`${ESC}[?1000h${ESC}[?1006h${ESC}[?1000$p`)
  writeAll(`${ESC}[?1006l${ESC}[?1000l`)
} catch (error) {
  out.error = String(error?.stack ?? error)
}

writeAll(`${ESC}_Ga=d,d=A,q=2${ESC}\\${ESC}[?25h${ESC}[?1049l`)
process.stdin.setRawMode(false)
out.finished = new Date().toISOString()
fs.writeFileSync(path.join(HERE, "probe.json"), JSON.stringify(out, null, 1))
process.exit(0)
