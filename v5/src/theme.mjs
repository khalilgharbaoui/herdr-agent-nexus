// Shared constants and small helpers for the drawing files.

import { SPRITE_COLORS } from "./sprites.mjs"
import { INK } from "./util.mjs"

export const PORT_COLOR = { you: INK.text, exec: "#7fd6ff", read: "#8497b0", write: "#ffd166", web: "#7ed6a5", agent: "#ff62d0", other: "#5fd4c4" }
export const LEVEL_COLOR = { alert: INK.bad, caution: INK.warn, notice: INK.soft, normal: INK.live }
export const PANEL = "#090d12" // the one opaque material: cards and overlays, a shade under the terminal's own dark
export const NICE_SPANS = [60e3, 120e3, 300e3, 600e3, 1200e3, 1800e3, 3600e3, 7200e3, 4 * 3600e3, 8 * 3600e3, 24 * 3600e3]
export const GOLDEN = 2.399963229728653
// where on a running log line's track the equipment's usual time stands (the rest is overtime)
export const LOG_USUAL_AT = 0.6
export const STATE_WORD = { thinking: "THINKING", writing: "WRITING", calling: "CALLING THE MODEL", tool: "RUNNING", waiting: "WAITING ON YOU", idle: "RESTING", stalled: "SILENT", failed: "FAILED" }

export const spriteHex = (hex) => (SPRITE_COLORS.includes(hex) ? hex : INK.text)
export const clean = (text) => String(text ?? "").replace(/\s+/g, " ").trim()
export const bare = (name) => String(name ?? "").replace(/^mcp__.+?__/, "")
export const inside = (rect, x, y) => x >= rect.x && y >= rect.y && x < rect.x + rect.w && y < rect.y + rect.h
export const intersects = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
export const homed = (path) => String(path ?? "").replace(/^\/Users\/[^/]+/, "~")
// A line shortened to so many characters: cut at the end of a word, never inside one, and the
// cut is said with an ellipsis. A single word longer than the room is cut where the room ends.
export const shortWords = (text, max) => {
  const value = clean(text)
  if (value.length <= max) return value
  const cut = value.slice(0, max + 1)
  const at = cut.lastIndexOf(" ")
  return `${(at >= max * 0.5 ? cut.slice(0, at) : value.slice(0, max)).replace(/[\s,;:.·-]+$/, "")}…`
}

export function wrap(text, width) {
  const lines = []
  let rest = text
  while (rest.length > width) {
    let cut = rest.lastIndexOf(" ", width)
    if (cut < width * 0.6) cut = width
    lines.push(rest.slice(0, cut))
    rest = rest.slice(cut).trimStart()
  }
  if (rest.length) lines.push(rest)
  return lines
}
