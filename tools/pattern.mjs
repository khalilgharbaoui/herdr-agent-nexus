// Sends test patterns in phases so tools/watch.mjs can see what herdr forwards to the outer terminal.
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
function frame(w, h, seed) {
  const pixels = Buffer.alloc(w * h * 4)
  for (let y = seed % 37; y < h; y += 37) for (let x = 0; x < w; x += 1) pixels.set([80, 200, 255, 255], (y * w + x) * 4)
  return deflateSync(pixels, { level: 1 }).toString("base64")
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const phases = []
const t0 = performance.now()
const mark = (name) => phases.push({ name, at: Math.round(performance.now() - t0) })
writeAll(`${ESC}[?1049h${ESC}[?25l${ESC}[2J${ESC}[H`)
const W = cols * cw, H = rows * ch
await wait(1500)
mark("A full frame, alternating ids, 20 frames")
for (let n = 0; n < 20; n += 1) {
  const id = 7000 + (n % 2)
  writeAll(`${ESC}[?2026h${ESC}[H${chunked(`a=T,f=32,o=z,s=${W},v=${H},i=${id},p=1,c=${cols},r=${rows},C=1,q=2`, frame(W, H, n))}${ESC}_Ga=d,d=I,i=${id === 7000 ? 7001 : 7000},q=2${ESC}\\${ESC}[?2026l`)
  await wait(50)
}
await wait(1500)
writeAll(`${ESC}_Ga=d,d=A,q=2${ESC}\\`)
await wait(1000)
mark("B place 20 tiles once")
const tw = 30 * cw, th = 8 * ch
let count = 0
const spots = []
for (let row = 0; row + 8 <= rows && count < 20; row += 8) for (let col = 0; col + 30 <= cols && count < 20; col += 30) { spots.push([row, col]); count += 1 }
{
  const parts = [`${ESC}[?2026h`]
  spots.forEach(([row, col], index) => parts.push(`${ESC}[${row + 1};${col + 1}H${chunked(`a=T,f=32,o=z,s=${tw},v=${th},i=${8000 + index},p=1,c=30,r=8,C=1,q=2`, frame(tw, th, index))}`))
  parts.push(`${ESC}[?2026l`)
  writeAll(parts.join(""))
}
await wait(2000)
mark("C update one tile, same id, 20 times")
for (let n = 0; n < 20; n += 1) {
  const [row, col] = spots[3]
  writeAll(`${ESC}[?2026h${ESC}[${row + 1};${col + 1}H${chunked(`a=T,f=32,o=z,s=${tw},v=${th},i=8003,p=1,c=30,r=8,C=1,q=2`, frame(tw, th, n + 100))}${ESC}[?2026l`)
  await wait(50)
}
await wait(2000)
mark("D update one tile, alternating ids, 20 times")
for (let n = 0; n < 20; n += 1) {
  const [row, col] = spots[5]
  const id = n % 2 ? 8005 : 8105
  writeAll(`${ESC}[?2026h${ESC}[${row + 1};${col + 1}H${chunked(`a=T,f=32,o=z,s=${tw},v=${th},i=${id},p=1,c=30,r=8,C=1,q=2`, frame(tw, th, n + 200))}${ESC}_Ga=d,d=I,i=${n % 2 ? 8105 : 8005},q=2${ESC}\\${ESC}[?2026l`)
  await wait(50)
}
await wait(2000)
mark("E end")
writeAll(`${ESC}_Ga=d,d=A,q=2${ESC}\\${ESC}[?25h${ESC}[?1049l`)
fs.writeFileSync("scratch/pattern.json", JSON.stringify({ cols, rows, tile: [tw, th], phases }))
process.exit(0)
