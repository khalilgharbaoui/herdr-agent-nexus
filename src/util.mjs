// Shared helpers: colour, type, formatting, small maths.

import { GlobalFonts } from "@napi-rs/canvas"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

export const TAU = Math.PI * 2
export const clamp = (value, low, high) => Math.max(low, Math.min(high, value))
export const approach = (value, target, rate, dt) => value + (target - value) * (1 - Math.exp(-rate * dt))
export const lerp = (from, to, amount) => from + (to - from) * amount

// ------------------------------------------------------------------ type

const FONT_DIR = path.join(os.homedir(), "Library/Fonts")
for (const [file, alias] of [
  ["FiraCodeNerdFontMono-Regular.ttf", "Nexus Mono"],
  ["FiraCodeNerdFontMono-Medium.ttf", "Nexus Mono Medium"],
  ["FiraCodeNerdFontMono-Bold.ttf", "Nexus Mono Bold"],
  ["FiraCodeNerdFontMono-Light.ttf", "Nexus Mono Light"],
]) {
  try {
    if (fs.existsSync(path.join(FONT_DIR, file))) GlobalFonts.registerFromPath(path.join(FONT_DIR, file), alias)
  } catch {}
}

export const FAMILY = {
  display: '"DIN Condensed", "Avenir Next Condensed", sans-serif',
  label: '"Avenir Next Condensed", "Avenir Next", sans-serif',
  mono: '"Nexus Mono", Menlo, monospace',
  monoMedium: '"Nexus Mono Medium", "Nexus Mono", Menlo, monospace',
  monoBold: '"Nexus Mono Bold", "Nexus Mono", Menlo, monospace',
  monoLight: '"Nexus Mono Light", "Nexus Mono", Menlo, monospace',
}
export const fontOf = (size, family, weight = "") => `${weight ? `${weight} ` : ""}${Math.max(6, size).toFixed(1)}px ${family}`

// ------------------------------------------------------------------ colour

export const INK = {
  text: "#e9f1fa", // primary type
  soft: "#a8b9cd", // secondary type
  dim: "#7f93ab", // tertiary type, labels
  faint: "#435469", // rules and ticks
  ghost: "#27323f", // the quietest rules
  live: "#4fe3ff", // one meaning: happening now
  warn: "#ffb224", // one meaning: waiting for you
  bad: "#ff4d5e", // one meaning: failed
  good: "#3ddc97", // finished clean
}

export const hexToRgb = (hex) => {
  const value = Number.parseInt(hex.slice(1), 16)
  return [value >> 16, (value >> 8) & 255, value & 255]
}
const rgbaCache = new Map()
export function rgba(hex, alpha) {
  const a = Math.round(clamp(alpha, 0, 1) * 100)
  const key = hex + a
  let value = rgbaCache.get(key)
  if (!value) {
    const [r, g, b] = hexToRgb(hex)
    value = `rgba(${r},${g},${b},${(a / 100).toFixed(2)})`
    rgbaCache.set(key, value)
  }
  return value
}
export const mix = (from, to, amount) => {
  const a = hexToRgb(from)
  const b = hexToRgb(to)
  const channel = (index) => Math.round(a[index] + (b[index] - a[index]) * amount)
  return `#${((1 << 24) | (channel(0) << 16) | (channel(1) << 8) | channel(2)).toString(16).slice(1)}`
}

export function modelColor(model = "", provider = "") {
  const name = model.toLowerCase()
  if (provider === "local" || /qwen|llama|mlx|gemma|bonsai|mistral|deepseek|hermes/.test(name)) return "#ff8a3d"
  if (/opus/.test(name)) return "#a78bff"
  if (/sonnet/.test(name)) return "#4aa8ff"
  if (/haiku/.test(name)) return "#2ee6c0"
  if (/fable/.test(name)) return "#ffc247"
  if (/mythos/.test(name)) return "#ff62d0"
  if (/gpt|codex|o\d/.test(name)) return "#8be36a"
  if (/gemini/.test(name)) return "#6f9bff"
  return "#9fb4ff"
}
export function shortModel(model = "") {
  if (!model) return "model?"
  let name = model.split("@")[0].split("/").pop()
  name = name.replace(/^claude-/, "").replace(/-(\d+)-(\d+)(?=$|-)/, " $1.$2").replace(/-fast$/, " fast")
  return name.length > 18 ? `${name.slice(0, 17)}…` : name
}
export function accountOf(model = "", provider = "") {
  const marker = model.split("@")[1]
  if (marker) return marker
  if (provider.startsWith("claude-code-")) return provider.slice("claude-code-".length)
  return provider === "claude-code" ? "default" : provider
}
// The context window each model is run with (the plugin's own catalog: the 4.5 and 4.6
// generations are 200k, later Claude models 1M). Unknown models have no limit to draw against.
export function contextLimit(model = "") {
  const name = model.split("@")[0].toLowerCase()
  if (!/claude|opus|sonnet|haiku|fable|mythos/.test(name)) return 0
  if (/\[1m\]/.test(name)) return 1e6
  if (/-4-[0-9]|-3-/.test(name)) return 200e3
  return 1e6
}

// Tool families. Colour says what kind of work it is, never which tool.
const TOOL_FAMILY = {
  exec: { color: "#7fd6ff", icon: "" },
  read: { color: "#8497b0", icon: "" },
  search: { color: "#8497b0", icon: "" },
  write: { color: "#ffd166", icon: "" },
  web: { color: "#7ed6a5", icon: "" },
  agent: { color: "#ff62d0", icon: "\u{f06a9}" },
  meta: { color: "#5fd4c4", icon: "" },
  ask: { color: "#ffb224", icon: "" },
  other: { color: "#9fb4ff", icon: "" },
}
const TOOL_KIND = {
  shell: "exec",
  bash: "exec",
  execute: "exec",
  read: "read",
  list: "read",
  grep: "search",
  glob: "search",
  toolsearch: "search",
  edit: "write",
  write: "write",
  patch: "write",
  multiedit: "write",
  webfetch: "web",
  websearch: "web",
  subagent: "agent",
  task: "agent",
  task_batch: "agent",
  todowrite: "meta",
  skill: "meta",
  question: "ask",
}
export function toolMeta(name = "") {
  const bare = name.replace(/^mcp__.+?__/, "").toLowerCase()
  const kind = TOOL_KIND[bare] ?? "other"
  return { kind, ...TOOL_FAMILY[kind] }
}

// ------------------------------------------------------------------ text

const pad2 = (value) => String(value).padStart(2, "0")
export const clockOf = (ms) => {
  const date = new Date(ms)
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}
export const hourMinuteOf = (ms) => {
  const date = new Date(ms)
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}
export const dateOf = (ms) => {
  const date = new Date(ms)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]
export const dayOf = (ms) => {
  const date = new Date(ms)
  return `${DAYS[date.getDay()]} ${pad2(date.getDate())} ${MONTHS[date.getMonth()]}`
}
export const agoOf = (ms) => {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h${pad2(Math.floor((seconds % 3600) / 60))}`
  return `${Math.floor(seconds / 86400)}d`
}
// m:ss under an hour, h:mm:ss over it
export const timerOf = (ms) => {
  const whole = Math.max(0, Math.floor(ms / 1000))
  if (whole < 3600) return `${Math.floor(whole / 60)}:${pad2(whole % 60)}`
  return `${Math.floor(whole / 3600)}:${pad2(Math.floor((whole % 3600) / 60))}:${pad2(whole % 60)}`
}
export const spanOf = (ms) => {
  if (ms < 950) return `${Math.max(1, Math.round(ms))}ms`
  if (ms < 9950) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 60e3) return `${Math.round(ms / 1000)}s`
  if (ms < 3600e3) return `${Math.floor(ms / 60e3)}m${pad2(Math.round((ms % 60e3) / 1000) % 60)}`
  return `${Math.floor(ms / 3600e3)}h${pad2(Math.floor((ms % 3600e3) / 60e3))}`
}
export const compactOf = (value) => {
  if (value >= 9.95e5) return `${(value / 1e6).toFixed(value >= 9.95e6 ? 1 : 2)}M`
  if (value >= 1e4) return `${Math.round(value / 1e3)}k`
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`
  return `${Math.round(value)}`
}
export const moneyOf = (value) => (value >= 100 ? `$${Math.round(value).toLocaleString("en-US")}` : `$${value.toFixed(2)}`)

export function hashUnit(text) {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash / 4294967296
}
// The plugin's own sessionTag (src/turn-history.ts): FNV-1a over the id, eight hex digits.
export function sessionTag(id) {
  let hash = 0x811c9dc5
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, "0")
}
export function mulberry32(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}
export function quantile(sorted, q) {
  if (!sorted.length) return 0
  const position = (sorted.length - 1) * q
  const low = Math.floor(position)
  const high = Math.ceil(position)
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low)
}
