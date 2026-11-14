#!/usr/bin/env node
// Asks the terminal what it does with images, instead of trusting a snapshot.
//
// Run it in the pane itself (it owns the screen for about half a minute):
//   node v5/tools/gfx-probe.mjs [--fill]
// It uploads the real sprite atlas at several sizes, as one zlib stream and as the strip stream
// the encoder builds, each with replies on (q=0), then places every image again to see whether
// an earlier one was evicted. With --fill it goes on uploading until the first image is gone,
// which finds the store's limit. The answers go to v5/probe-gfx.json.

import fs from "node:fs"
import path from "node:path"
import zlib from "node:zlib"
import { Atlas } from "../src/sprites.mjs"

const ESC = "\x1b"
const HERE = path.dirname(new URL(import.meta.url).pathname)
const OUT = path.join(HERE, "..", "probe-gfx.json")
const FILL = process.argv.includes("--fill")
const LIMIT = process.argv.includes("--limit") // only measure the store's limit, in 2 MB steps

let inbox = ""
process.stdin.setRawMode?.(true)
process.stdin.resume()
process.stdin.on("data", (chunk) => {
  inbox += chunk.toString("latin1")
})
const write = (text) => fs.writeSync(1, text)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function reply(id, timeout = 9000) {
  const started = Date.now()
  const pattern = new RegExp(`\\x1b_Gi=${id}(?:,[^;]*)?;([^\\x1b]*)\\x1b\\\\`)
  for (;;) {
    const match = pattern.exec(inbox)
    if (match) {
      inbox = inbox.slice(match.index + match[0].length)
      return { said: match[1], ms: Date.now() - started }
    }
    if (Date.now() - started > timeout) return { said: "no reply", ms: timeout }
    await sleep(5)
  }
}

function single(pixels) {
  return zlib.deflateSync(pixels, { level: 1 })
}

// exactly what src/encoder.mjs does with the strips it is handed
function strips(pixels, stride, rows = 256) {
  const parts = [Buffer.from([0x78, 0x01])]
  let a = 1
  let b = 0
  for (let top = 0; top < pixels.length; top += stride * rows) {
    const raw = pixels.subarray(top, Math.min(pixels.length, top + stride * rows))
    for (let at = 0; at < raw.length; ) {
      const end = Math.min(raw.length, at + 5552)
      for (; at < end; at += 1) {
        a += raw[at]
        b += a
      }
      a %= 65521
      b %= 65521
    }
    parts.push(zlib.deflateRawSync(raw, { level: 6, finishFlush: zlib.constants.Z_SYNC_FLUSH }))
  }
  const sum = Buffer.alloc(4)
  sum.writeUInt32BE(((b << 16) | a) >>> 0)
  parts.push(zlib.deflateRawSync(Buffer.alloc(0)), sum)
  return Buffer.concat(parts)
}

function upload(id, width, height, stream) {
  const base64 = stream.toString("base64")
  const parts = []
  for (let offset = 0; offset < base64.length; offset += 4096) {
    const chunk = base64.slice(offset, offset + 4096)
    const more = offset + 4096 < base64.length ? 1 : 0
    parts.push(offset === 0 ? `${ESC}_Ga=t,f=32,o=z,s=${width},v=${height},i=${id},m=${more};${chunk}${ESC}\\` : `${ESC}_Gm=${more};${chunk}${ESC}\\`)
  }
  write(parts.join(""))
  return base64.length
}

const place = (id) => write(`${ESC}[2;2H${ESC}_Ga=p,i=${id},p=1,x=0,y=0,w=15,h=30,C=1${ESC}\\`)

const atlas = new Atlas(15, 30)
const whole = atlas.pixels()
const stride = atlas.width * 4
const cut = (rows) => whole.subarray(0, stride * Math.min(rows, atlas.height))
const results = { at: new Date().toISOString(), atlas: `${atlas.width}x${atlas.height}`, tests: [], held: [], fill: [] }
const save = () => fs.writeFileSync(OUT, JSON.stringify(results, null, 1))

write(`${ESC}[?1049h${ESC}[?25l${ESC}[2J${ESC}[H`)
try {
  const query = (write(`${ESC}_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA${ESC}\\`), await reply(31, 2000))
  results.query = query.said
  const sizes = LIMIT ? [] : [711, 2761, atlas.height].filter((rows, index, list) => rows <= atlas.height && list.indexOf(rows) === index)
  let id = 9000
  for (const rows of sizes) {
    for (const [name, build] of [["single", () => single(cut(rows))], ["strips", () => strips(cut(rows), stride)]]) {
      id += 1
      const stream = build()
      const sane = zlib.inflateSync(stream).length === stride * rows
      const sent = upload(id, atlas.width, rows, stream)
      const answer = await reply(id)
      place(id)
      const placed = await reply(id, 3000)
      results.tests.push({ id, encoding: name, pixels: `${atlas.width}x${rows}`, rawMb: Number(((stride * rows) / 1e6).toFixed(1)), wireKb: Math.round(sent / 1024), nodeInflates: sane, upload: answer.said, uploadMs: answer.ms, place: placed.said })
      save()
    }
  }
  // is every image still there, now that all of them went up?
  for (const test of results.tests) {
    place(test.id)
    results.held.push({ id: test.id, place: (await reply(test.id, 3000)).said })
  }
  save()
  if (LIMIT) {
    // 2 MB images, each placed (so it counts as in use), until the first one is gone; then the
    // same with images that are never placed, to see whether an unused one goes first
    const side = { width: 1000, height: 500 }
    const stream = single(Buffer.alloc(side.width * side.height * 4, 1))
    const run = async (name, base, used) => {
      const out = { name, steps: 0, firstGoneAfterMb: null }
      for (let round = 0; round < 110; round += 1) {
        upload(base + round, side.width, side.height, stream)
        const answer = await reply(base + round)
        if (answer.said !== "OK") {
          out.refused = answer.said
          break
        }
        if (used) {
          place(base + round)
          await reply(base + round, 3000)
        }
        out.steps = round + 1
        write(`${ESC}[2;2H${ESC}_Ga=p,i=${base},p=2,x=0,y=0,w=15,h=30,C=1${ESC}\\`)
        const kept = await reply(base, 3000)
        if (kept.said !== "OK") {
          out.firstGoneAfterMb = (round + 1) * 2
          out.said = kept.said
          break
        }
      }
      results.fill.push(out)
      save()
    }
    await run("every image placed", 9100, true)
    write(`${ESC}_Ga=d,d=A,q=2${ESC}\\`)
    await sleep(200)
    await run("only the first image placed", 9300, false)
  }
  if (FILL) {
    const first = results.tests.find((test) => test.upload === "OK")
    const stream = single(whole)
    let total = results.tests.reduce((sum, test) => sum + (test.upload === "OK" ? test.rawMb : 0), 0)
    for (let round = 0; round < 12 && first; round += 1) {
      id += 1
      upload(id, atlas.width, atlas.height, stream)
      const answer = await reply(id)
      total += answer.said === "OK" ? (stride * atlas.height) / 1e6 : 0
      place(first.id)
      const kept = await reply(first.id, 3000)
      results.fill.push({ id, upload: answer.said, heldMbAfter: Math.round(total), firstImage: kept.said })
      save()
      if (kept.said !== "OK" || answer.said !== "OK") break
    }
  }
} catch (error) {
  results.error = String(error?.stack ?? error)
} finally {
  save()
  write(`${ESC}_Ga=d,d=A,q=2${ESC}\\${ESC}[?25h${ESC}[?1049l`)
  process.stdin.setRawMode?.(false)
  process.stdin.pause()
}
console.log(`wrote ${OUT}`)
process.exit(0)
