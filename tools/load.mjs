// Sustained load phases, to read the CPU cost of each transport shape from outside.
import fs from "node:fs"
import { deflateSync } from "node:zlib"
const ESC = "\x1b"
const cols = process.stdout.columns, rows = process.stdout.rows
const cw = 15, ch = 30
const sleeper = new Int32Array(new SharedArrayBuffer(4))
function writeAll(text) {
  const buffer = Buffer.from(text, "latin1")
  let offset = 0
  while (offset < buffer.length) {
    try { offset += fs.writeSync(1, buffer, offset, buffer.length - offset) } catch (error) { if (error.code !== "EAGAIN") throw error; Atomics.wait(sleeper, 0, 0, 1) }
  }
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
function frames(w, h) {
  const list = []
  for (let seed = 0; seed < 8; seed += 1) {
    const pixels = Buffer.alloc(w * h * 4)
    for (let y = (seed * 5) % 37; y < h; y += 37) for (let x = 0; x < w; x += 1) pixels.set([80, 200, 255, 255], (y * w + x) * 4)
    list.push(deflateSync(pixels, { level: 1 }).toString("base64"))
  }
  return list
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const phases = []
const t0 = Date.now()
const mark = (name) => phases.push({ name, at: Date.now() })
writeAll(`${ESC}[?1049h${ESC}[?25l${ESC}[2J${ESC}[H`)
const W = cols * cw, H = rows * ch
const SECONDS = 7
const run = async (name, step) => {
  mark(name)
  const end = Date.now() + SECONDS * 1000
  let n = 0
  while (Date.now() < end) { const s = performance.now(); step(n); n += 1; await wait(Math.max(1, 33 - (performance.now() - s))) }
  phases[phases.length - 1].frames = n
  await wait(2500)
}
await wait(2500)
mark("idle")
await wait(SECONDS * 1000)
{
  const set = frames(W, H)
  await run("full frame 30fps alternating ids", (n) => {
    const id = 7000 + (n % 2)
    writeAll(`${ESC}[?2026h${ESC}[H${chunked(`a=T,f=32,o=z,s=${W},v=${H},i=${id},p=1,c=${cols},r=${rows},C=1,q=2`, set[n % 8])}${ESC}_Ga=d,d=I,i=${id === 7000 ? 7001 : 7000},q=2${ESC}\\${ESC}[?2026l`)
  })
  writeAll(`${ESC}_Ga=d,d=A,q=2${ESC}\\`)
}
const tw = 30 * cw, th = 8 * ch
const spots = []
for (let row = 0; row + 8 <= rows; row += 8) for (let col = 0; col + 30 <= cols; col += 30) spots.push([row, col])
const set = frames(tw, th)
{
  const parts = [`${ESC}[?2026h`]
  spots.forEach(([row, col], index) => parts.push(`${ESC}[${row + 1};${col + 1}H${chunked(`a=T,f=32,o=z,s=${tw},v=${th},i=${8000 + index},p=1,c=30,r=8,C=1,q=2`, set[index % 8])}`))
  parts.push(`${ESC}[?2026l`)
  writeAll(parts.join(""))
}
await wait(2500)
mark(`static: ${spots.length} tiles placed, no updates`)
await wait(SECONDS * 1000)
await run("one tile 30fps same id", (n) => {
  const [row, col] = spots[3]
  writeAll(`${ESC}[?2026h${ESC}[${row + 1};${col + 1}H${chunked(`a=T,f=32,o=z,s=${tw},v=${th},i=8003,p=1,c=30,r=8,C=1,q=2`, set[n % 8])}${ESC}[?2026l`)
})
await run("six tiles 30fps same ids", (n) => {
  const parts = [`${ESC}[?2026h`]
  for (let k = 0; k < 6; k += 1) { const [row, col] = spots[k * 3]; parts.push(`${ESC}[${row + 1};${col + 1}H${chunked(`a=T,f=32,o=z,s=${tw},v=${th},i=${8000 + k * 3},p=1,c=30,r=8,C=1,q=2`, set[(n + k) % 8])}`) }
  parts.push(`${ESC}[?2026l`)
  writeAll(parts.join(""))
})
await run(`all ${spots.length} tiles 30fps same ids`, (n) => {
  const parts = [`${ESC}[?2026h`]
  spots.forEach(([row, col], index) => parts.push(`${ESC}[${row + 1};${col + 1}H${chunked(`a=T,f=32,o=z,s=${tw},v=${th},i=${8000 + index},p=1,c=30,r=8,C=1,q=2`, set[(n + index) % 8])}`))
  parts.push(`${ESC}[?2026l`)
  writeAll(parts.join(""))
})
mark("end")
writeAll(`${ESC}_Ga=d,d=A,q=2${ESC}\\${ESC}[?25h${ESC}[?1049l`)
fs.writeFileSync("scratch/load.json", JSON.stringify({ cols, rows, tile: [tw, th], tiles: spots.length, phases }))
process.exit(0)
