// A thread's prompt cache as the screen shows it.
//
// The provider keeps what a thread has sent so far for a set time after the thread's last
// model call (five minutes or an hour, chosen per request). While it is kept, the next call
// reads it back cheaply; once it has gone cold, the next call pays to write all of it again.
// `session.cache` (see live.mjs) says when it was last touched, how long it lives from then,
// and whether that lifetime was measured from the thread's own transcript or is assumed.

import { clockOf, mix } from "./util.mjs"

export const CACHE_HOT = "#ff9166" // just touched
export const CACHE_COOL = "#5d7fa6" // about to go cold

// Where a cache stands at `now`: what is left of its lifetime, as time and as a share, and the
// colour of that warmth.
export function cacheState(cache, now) {
  if (!cache || !cache.lifetime || cache.empty) return null
  const age = Math.max(0, now - cache.at)
  const left = Math.max(0, cache.lifetime - age)
  const share = left / cache.lifetime
  return { age, left, share, cold: left <= 0, coldAt: cache.at + cache.lifetime, color: mix(CACHE_COOL, CACHE_HOT, share ** 0.8) }
}

// How finely the time left is shown: a minute while there are more than ten, then ten seconds,
// then every second of the last two minutes. A region signs itself with this, so it is painted
// again only when the figure it shows changes.
export const cacheQuantum = (left) => (left > 600e3 ? 60e3 : left > 120e3 ? 10e3 : 1000)

const pad2 = (value) => String(value).padStart(2, "0")
// "1h", "52m", "4m10", "45s": the time left, rounded up to its quantum.
export function leftWord(left) {
  const quantum = cacheQuantum(left)
  const seconds = Math.round((Math.ceil(left / quantum) * quantum) / 1000)
  if (seconds >= 3600) return seconds % 3600 === 0 ? `${seconds / 3600}h` : `${Math.floor(seconds / 3600)}h${pad2(Math.floor((seconds % 3600) / 60))}`
  if (seconds > 600) return `${Math.round(seconds / 60)}m`
  if (seconds >= 60) return seconds % 60 === 0 ? `${seconds / 60}m` : `${Math.floor(seconds / 60)}m${pad2(seconds % 60)}`
  return `${seconds}s`
}

export const lifeWord = (lifetime) => (lifetime >= 3600e3 ? `${Math.round(lifetime / 3600e3)} h` : `${Math.round(lifetime / 60e3)} min`)

// The short reading beside a thread: "cache 52m", "cache ~52m" when its lifetime is assumed,
// "cache cold 12m" for the first hour after it went cold, nothing after that.
export function cacheWord(cache, state, now) {
  if (!state) return ""
  if (!state.cold) return `cache ${cache.measured ? "" : "~"}${leftWord(state.left)}`
  const since = now - state.coldAt
  if (since > 3600e3) return ""
  return `cache cold ${cache.measured ? "" : "~"}${since < 60e3 ? "now" : `${Math.floor(since / 60e3)}m`}`
}

// What the row and the gauge sign themselves with.
export function cacheSign(cache, now) {
  const state = cacheState(cache, now)
  if (!state) return "none"
  if (state.cold) return `cold|${Math.min(61, Math.floor((now - state.coldAt) / 60e3))}`
  return `${cache.measured ? "m" : "a"}|${cache.lifetime}|${Math.ceil(state.left / cacheQuantum(state.left))}|${cacheQuantum(state.left)}`
}

export const cacheTimes = (cache, state) => ({ touched: clockOf(cache.at), cold: clockOf(state.coldAt) })
