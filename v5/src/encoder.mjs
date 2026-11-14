// Encoder worker. It owns the terminal's output while Agent Nexus runs.
//
// A frame arrives as the tiles whose pixels changed plus the sprite placements that moved, and
// leaves as one write inside one synchronized-output bracket (DEC mode 2026), so the terminal
// never shows half of it.
//
// A changed tile is deflated and sent as its own image under the other of two ids: the new image
// is placed first and the old one deleted after, so a tile is never empty in between. A tile
// with nothing in it has no image at all. The sprite atlas is a handful of small pages, each
// uploaded when a sprite first needs it and never displayed whole: a sprite is a placement of a
// window of its page, and moving it is one short command. A page upload and the heartbeat
// placement of every page ask the terminal for an answer (no q key), which the main thread
// reads: that is how a page the terminal dropped is noticed and sent again.

import fs from "node:fs"
import { parentPort } from "node:worker_threads"
import zlib from "node:zlib"

const ESC = "\x1b"
const ID_BASE = 7300
const TILE_Z = 20 // the still layer sits between the sprites behind it (z under 20) and those in front
const CARD_ID = 7100 // the inspection card: its own image (two ids, flipped on every new content)
const CARD_Z = 55 // over every sprite except the ones that must never be covered
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

function chunked(parts, keys, base64) {
  for (let offset = 0; offset < base64.length; offset += 4096) {
    const chunk = base64.slice(offset, offset + 4096)
    const more = offset + 4096 < base64.length ? 1 : 0
    parts.push(offset === 0 ? `${ESC}_G${keys},m=${more};${chunk}${ESC}\\` : `${ESC}_Gm=${more};${chunk}${ESC}\\`)
  }
}

let flips = new Uint8Array(0)
let shown = new Uint8Array(0) // 1 while a tile has an image on screen
let cardFlip = 0
let cardShown = false

parentPort.on("message", (message) => {
  const started = performance.now()
  const { tiles, total, cellWidth, cellHeight, tileCols, tileRows, across, places, deletes } = message
  const parts = []
  const wiped = !message.reset && flips.length !== total
  if (message.reset || flips.length !== total) {
    flips = new Uint8Array(total)
    shown = new Uint8Array(total)
    parts.push(`${ESC}[2J${ESC}_Ga=d,d=A,q=2${ESC}\\`)
    cardShown = false
  }
  let tileBytes = 0
  let spriteBytes = 0
  for (const tile of tiles) {
    const id = ID_BASE + tile.index * 2 + flips[tile.index]
    const old = ID_BASE + tile.index * 2 + (1 - flips[tile.index])
    if (tile.length) {
      const base64 = zlib.deflateSync(Buffer.from(message.pixels, tile.offset, tile.length), { level: 1 }).toString("base64")
      parts.push(`${ESC}[${Math.floor(tile.index / across) * tileRows + 1};${(tile.index % across) * tileCols + 1}H`)
      chunked(parts, `a=T,f=32,o=z,s=${tile.width},v=${tile.height},i=${id},p=1,c=${Math.round(tile.width / cellWidth)},r=${Math.round(tile.height / cellHeight)},z=${TILE_Z},C=1,q=2`, base64)
      if (shown[tile.index]) parts.push(`${ESC}_Ga=d,d=I,i=${old},q=2${ESC}\\`)
      flips[tile.index] ^= 1
      shown[tile.index] = 1
      tileBytes += base64.length
    } else if (shown[tile.index]) {
      parts.push(`${ESC}_Ga=d,d=I,i=${old},q=2${ESC}\\`)
      shown[tile.index] = 0
    }
  }
  const before = parts.length
  // sprite pages: after the tiles and right before their placements, with the answer wanted
  for (const id of message.dropPages ?? []) parts.push(`${ESC}_Ga=d,d=I,i=${id},q=2${ESC}\\`)
  for (const page of message.pages ?? []) {
    chunked(parts, `a=t,f=32,o=z,s=${page.width},v=${page.height},i=${page.id}`, zlib.deflateSync(Buffer.from(page.pixels), { level: 6 }).toString("base64"))
  }
  for (let at = 0; at < deletes.length; at += 2) parts.push(`${ESC}_Ga=d,d=i,i=${deletes[at]},p=${deletes[at + 1]},q=2${ESC}\\`)
  for (let at = 0; at < places.length; at += 9) {
    parts.push(
      `${ESC}[${places[at + 2] + 1};${places[at + 1] + 1}H${ESC}_Ga=p,i=${places[at + 8]},p=${places[at]},x=${places[at + 3]},y=${places[at + 4]},w=${places[at + 5]},h=${places[at + 6]},z=${places[at + 7]},C=1,q=2${ESC}\\`,
    )
  }
  // the heartbeat: one clear cell of every page, placed in the corner, answered with OK or ENOENT
  for (const id of message.probes ?? []) {
    parts.push(`${ESC}[1;1H${ESC}_Ga=p,i=${id},p=${message.probeSlot},x=0,y=0,w=${cellWidth},h=${cellHeight},z=1,C=1${ESC}\\`)
  }
  // The inspection card rides on its own image, so following a moving mark is one placement.
  // New content goes up under the other id and is placed before the old one is deleted.
  const card = message.card
  if (card?.remove) {
    if (cardShown) parts.push(`${ESC}_Ga=d,d=I,i=${CARD_ID + cardFlip},q=2${ESC}\\`)
    cardShown = false
  } else if (card) {
    const old = CARD_ID + cardFlip
    if (card.pixels) {
      cardFlip ^= 1
      chunked(parts, `a=t,f=32,o=z,s=${card.width},v=${card.height},i=${CARD_ID + cardFlip},q=2`, zlib.deflateSync(Buffer.from(card.pixels), { level: 1 }).toString("base64"))
    }
    const place = card.place
    parts.push(`${ESC}[${place.row + 1};${place.col + 1}H${ESC}_Ga=p,i=${CARD_ID + cardFlip},p=1,x=${place.sx},y=${place.sy},w=${place.w},h=${place.h},z=${CARD_Z},C=1,q=2${ESC}\\`)
    if (card.pixels && cardShown) parts.push(`${ESC}_Ga=d,d=I,i=${old},q=2${ESC}\\`)
    cardShown = true
  }
  for (let index = before; index < parts.length; index += 1) spriteBytes += parts[index].length
  const encoded = performance.now()
  if (parts.length) writeAll(Buffer.from(`${ESC}[?2026h${parts.join("")}${ESC}[?2026l`, "latin1"))
  parentPort.postMessage({
    bytes: tileBytes + spriteBytes,
    tileBytes,
    spriteBytes,
    tiles: tiles.length,
    of: total,
    moved: places.length / 9,
    wiped,
    encodeMs: encoded - started,
    writeMs: performance.now() - encoded,
  })
})
