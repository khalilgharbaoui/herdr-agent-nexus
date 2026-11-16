// The inspection card and its leader line.
//
// The card is its own image, not part of the still layer: the terminal places it like a sprite,
// so it can follow the mark it belongs to frame by frame for the price of one placement. A
// dotted leader ties the mark to the card, with a ring on the mark when the mark is small, so
// it is always clear which dot, tick or moon the card is about. Hover and pin use the same
// card and the same leader; a pinned one is cyan.

import { createCanvas } from "@napi-rs/canvas"
import { inside, shortWords, wrap } from "./theme.mjs"
import { INK, clamp } from "./util.mjs"

const FOLLOW = 20 // how eagerly the card closes the distance to its place, per second

export const card = {
  // Where a mark is right now, when it is one that moves: a dot of the flock, a moon, a tick
  // drifting along an axon. Null for a mark that stands still (its rect is its place), and
  // undefined when the mark is gone.
  spotOf(target, scene, now) {
    const G = this.G
    if (target.kind === "dot") {
      const flock = this.flock
      if (target.id !== `${flock.sid}:${flock.turn}:${target.index}` || !flock.level[target.index]) return undefined
      return { x: flock.sx[target.index], y: flock.sy[target.index] }
    }
    if (target.moon) return (this.moons ?? []).find((moon) => moon.sid === target.id) ?? undefined
    if (target.kind === "scrub") {
      // the scrubbed moment steps left with the terrain: its mark is on the front ridge
      const front = this.terrainGeo?.ridges.find((ridge) => ridge.depth === 0)
      return (front && this.ridgeSpot(front, target.at)) ?? undefined
    }
    if (target.sat) return (this.flock.sats ?? []).find((sat) => sat.id === target.id) ?? undefined
    if (target.moving && (target.kind === "tool" || target.kind === "step")) {
      const g = G.rowOf.get(target.sid)
      const at = target.tool ? target.tool.start : (target.step?.streamed ?? target.step?.items[0]?.at ?? null)
      if (!g || at === null) return undefined
      const x = g.somaX + g.r + this.u(4) + ((now - at) / 1000) * G.speed
      return x <= G.termX ? { x, y: g.axonY } : undefined
    }
    return null
  },

  // A value marked "wrap" that is too long for one line goes on at the next, cut at words, eight
  // lines at most: the card says in full what the screen had to shorten.
  wrapCard(content) {
    if (!content) return null
    const perLine = Math.max(16, Math.floor((this.u(500) - this.u(168)) / this.width(this.base, "M", { size: 13.5 })))
    const lines = []
    for (const line of content.lines) {
      const value = String(line[1])
      if (line[3] !== "wrap" || value.length <= perLine) {
        lines.push(line)
        continue
      }
      const parts = wrap(value, perLine)
      const shown = parts.slice(0, 8)
      if (parts.length > 8) shown[7] = shortWords(parts.slice(7).join(" "), perLine - 1)
      shown.forEach((part, index) => lines.push([index ? "" : line[0], part, line[2]]))
    }
    return { ...content, lines }
  },
  // Brings the card up to date: what it says, where its mark is, where it stands. Called once
  // a frame, before the sprites are listed.
  layCard(scene, ui, now) {
    const u = (value) => this.u(value)
    const subject = ui.help ? null : (ui.pinned ?? ui.card)
    const content = subject ? this.wrapCard(this.inspect(subject.target, scene, now)) : null
    if (!content) {
      this.card = null
      this.cardAt = null
      this.lead = null
      return
    }
    const target = subject.target
    const pinned = Boolean(ui.pinned)
    // a moving mark carries its target along
    const spot = this.spotOf(target, scene, now)
    if (spot) {
      target.rect.x = spot.x - target.rect.w / 2
      target.rect.y = spot.y - target.rect.h / 2
    }
    const rect = target.rect
    // the point of the mark the leader ends on
    const g = (target.kind === "thread" || target.kind === "fold") && !target.moon ? this.G.rowOf.get(target.id) : null
    const onRow = g && inside(rect, g.somaX, g.axonY)
    const small = rect.w <= u(34) && rect.h <= u(34)
    const mark = spot ? { x: spot.x, y: spot.y, tiny: true } : onRow ? { x: g.somaX, y: g.axonY, tiny: true, reach: g.r + u(7) } : small ? { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2, tiny: true } : null
    const w = u(500)
    const h = u(74) + content.lines.length * u(25) + (content.foot ? u(28) : 0)
    const want = this.placeCard(rect, onRow ? { x: g.somaX + u(40), y: g.axonY } : subject.anchor, w, h, mark)
    // the card closes on its place quickly and smoothly, as if on a short rod
    const id = `${target.kind}|${target.id}`
    if (!this.cardAt || this.cardAt.id !== id) this.cardAt = { id, x: want.x, y: want.y }
    else {
      const k = 1 - Math.exp(-FOLLOW * this.dt)
      this.cardAt.x += (want.x - this.cardAt.x) * k
      this.cardAt.y += (want.y - this.cardAt.y) * k
      if (Math.abs(want.x - this.cardAt.x) < 0.6) this.cardAt.x = want.x
      if (Math.abs(want.y - this.cardAt.y) < 0.6) this.cardAt.y = want.y
    }
    const left = Math.round(this.cardAt.x)
    const top = Math.round(this.cardAt.y)
    // the card's own picture, repainted only when what it says changed
    const key = `${pinned}|${w}x${h}|${JSON.stringify(content)}`
    const cw = this.cell.width
    const ch = this.cell.height
    const padX = cw - 1
    const padY = ch - 1
    const winW = Math.ceil((w + padX) / cw) * cw
    const winH = Math.ceil((h + padY) / ch) * ch
    if (!this.cardCanvas || this.cardCanvas.width !== padX + winW || this.cardCanvas.height !== padY + winH) {
      this.cardCanvas = createCanvas(padX + winW, padY + winH)
      this.cardKey = ""
    }
    if (key !== this.cardKey) {
      this.cardKey = key
      const c = this.cardCanvas.getContext("2d")
      c.clearRect(0, 0, this.cardCanvas.width, this.cardCanvas.height)
      const sink = this.sink
      this.sink = []
      this.drawCard(c, { x: padX, y: padY, w, h }, content, pinned)
      this.cardHits = this.sink
      this.sink = sink
    }
    const canvas = this.cardCanvas
    this.card = {
      key, left, top, w, h, padX, padY, winW, winH, width: canvas.width, height: canvas.height, canvas,
      pixels: () => {
        const image = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data
        return Buffer.from(image.buffer, image.byteOffset, image.length)
      },
    }
    // the leader: from the mark to the nearest side of the card
    let from
    let to
    const hex = pinned ? INK.live : INK.text
    const cx = mark ? mark.x : clamp(left + w / 2, rect.x, rect.x + rect.w)
    const cy = mark ? mark.y : clamp(top + h / 2, rect.y, rect.y + rect.h)
    if (left >= cx) to = { x: left, y: clamp(cy - u(20), top + u(14), top + Math.min(h - u(14), u(40))) }
    else if (left + w <= cx) to = { x: left + w, y: clamp(cy - u(20), top + u(14), top + Math.min(h - u(14), u(40))) }
    else if (top >= cy) to = { x: clamp(cx + u(30), left + u(14), left + w - u(14)), y: top }
    else to = { x: clamp(cx + u(30), left + u(14), left + w - u(14)), y: top + h }
    if (mark) from = { x: mark.x, y: mark.y }
    else from = { x: clamp(to.x, rect.x, rect.x + rect.w), y: clamp(to.y, rect.y, rect.y + rect.h) }
    this.lead = { from, to, tiny: Boolean(mark?.tiny), reach: mark?.reach ?? u(10), hex }
  },

  // Where the card wants to stand: beside a small mark with room for the leader, under a wide
  // target near its cell body, always inside the screen.
  placeCard(rect, anchor, w, h, mark) {
    const u = (value) => this.u(value)
    const M = this.G.M
    const top = this.G.header.h + u(6)
    const bottom = this.H - u(44)
    let x
    let y
    if (rect.w > u(520)) {
      // a wide target (a thread, a project): under it, or over it when there is no room
      x = clamp((anchor?.x ?? rect.x) + u(26), M, this.W - w - M)
      y = rect.y + rect.h + u(14)
      if (y + h > bottom) y = rect.y - h - u(14)
    } else {
      const gap = mark ? u(72) : u(30)
      const cx = mark ? mark.x : rect.x + rect.w / 2
      const half = mark ? 0 : rect.w / 2
      x = cx + half + gap
      if (x + w > this.W - M) x = cx - half - gap - w
      if (x < M) x = clamp((anchor?.x ?? rect.x) - w / 2, M, this.W - w - M)
      y = (mark ? mark.y : rect.y + rect.h / 2) - u(76)
    }
    return { x: Math.round(x), y: Math.round(clamp(y, top, Math.max(top, bottom - h))), w, h }
  },

  // What of the card is under a point: one of its own controls, or the card itself.
  cardHit(x, y) {
    const card = this.card
    if (!card || x < card.left || y < card.top || x >= card.left + card.w || y >= card.top + card.h) return null
    const lx = x - card.left + card.padX
    const ly = y - card.top + card.padY
    for (const target of this.cardHits ?? []) {
      if (inside(target.rect, lx, ly)) return { ...target, rect: { x: target.rect.x + card.left - card.padX, y: target.rect.y + card.top - card.padY, w: target.rect.w, h: target.rect.h } }
    }
    return { kind: "overlay", id: "over:card", rect: { x: card.left, y: card.top, w: card.w, h: card.h } }
  },

  // The leader as sprites: a ring on a small mark, a dotted line, a node where it meets the card.
  leadSprites(out) {
    const lead = this.lead
    if (!lead || !this.card) return
    const u = (value) => this.u(value)
    const dx = lead.to.x - lead.from.x
    const dy = lead.to.y - lead.from.y
    const length = Math.hypot(dx, dy)
    if (lead.tiny) out.push({ key: "lead-ring", kind: `${lead.reach > u(12) ? "ring2" : "ring"}|${lead.hex}`, x: lead.from.x, y: lead.from.y, top: true })
    out.push({ key: "lead-end", kind: `pip|${lead.hex}`, x: lead.to.x, y: lead.to.y, top: true })
    if (length < 1) return
    const start = lead.tiny ? Math.min(length, lead.reach + u(3)) : 0
    const gap = u(7)
    let index = 0
    for (let at = start; at < length - u(5) && index < 90; at += gap, index += 1) out.push({ key: `lead${index}`, kind: `lead|${lead.hex}`, x: lead.from.x + (dx * at) / length, y: lead.from.y + (dy * at) / length, top: true })
  },
}
