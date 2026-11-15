// How long each thread's prompt cache lives, read off the main thread.
//
// Claude Code writes every model call of a session into a transcript with its usage: how many
// tokens it read from the cache, how many it wrote, and under which lifetime it wrote them
// (cache_creation.ephemeral_5m_input_tokens and ephemeral_1h_input_tokens). So the lifetime of
// a thread's cache can be measured, not guessed: it is the lifetime its newest writing call
// wrote under. The question is which transcript belongs to which opencode thread. Two answers:
//
//   record  the Claude Code plugin keeps, per opencode session, which Claude session answered
//           it (claude-sessions.json in its state folder). It writes that when a turn ends, so
//           a thread in its first turn, and most subagents, have no record yet.
//   timing  a block of thinking or of reply ends at the same moment in both places: opencode
//           stamps the end of the block, Claude Code stamps the record it writes for it, and
//           the two are a few milliseconds apart (measured: 0 to 2 ms). Of the transcripts
//           written in the thread's own project folder lately, the one that has a record
//           within a quarter of a second of two or more of the thread's last block ends is
//           its transcript; the runner-up must match at most half as many. A thread that only
//           calls tools has no such blocks; its tool calls then count, loosely (a call
//           reaches opencode up to some seconds after its record is written), and it takes
//           three of them and six in ten.
//
// Everything here is read-only, and only usage numbers and timestamps are taken from a
// transcript, never its text. This runs in a worker because the plugin's file is several
// megabytes and is rewritten at the end of every turn; parsing it must not hold up a frame.

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { parentPort } from "node:worker_threads"

const FIRST_READ = 4 << 20 // how much of the end of a transcript the first read takes
const READ_CAP = 8 << 20 // further behind than this, a read starts near the end again
const FIVE_MIN = 300e3
const HOUR = 3600e3
const NEAR = 250 // one block's end stamped twice on one machine: this close is the same block
const TOOL_EARLY = 8000 // a tool call's record is written up to this long before the call reaches opencode
const TOOL_LATE = 1500 // or this long after opencode first saw it begin (a tool the CLI runs itself)
const BEHIND = 120e3 // a transcript whose newest call is older than the thread's by this much is not its current one
const LISTING_MS = 15e3

const store = { mtime: 0, size: 0, readAt: 0, bySession: new Map(), configDirs: new Set() }
const files = new Map() // transcript path -> { size, mtime, ino, offset, partial, calls, stamps }
const listings = new Map() // project folder -> { at, files: [{ file, mtime }] }

function readStore(state) {
  const file = path.join(state, "claude-sessions.json")
  let stat
  try {
    stat = fs.statSync(file)
  } catch {
    return
  }
  if (stat.mtimeMs === store.mtime && stat.size === store.size) return
  const now = Date.now()
  if (store.bySession.size && now - store.readAt < 12e3) return
  store.readAt = now
  let data
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"))
  } catch {
    return
  }
  store.mtime = stat.mtimeMs
  store.size = stat.size
  const bySession = new Map()
  const configDirs = new Set()
  for (const [key, record] of Object.entries(data.sessions ?? {})) {
    if (!record?.claudeSessionId) continue
    if (record.configDir) configDirs.add(record.configDir)
    const parts = key.split("::")
    const sid = parts.find((part) => part.startsWith("ses_"))
    if (!sid) continue
    const list = bySession.get(sid) ?? []
    list.push({ cwd: parts[0], claude: record.claudeSessionId, configDir: record.configDir || "", updatedAt: record.updatedAt ?? 0 })
    bySession.set(sid, list)
  }
  // one opencode session can have several Claude sessions (one per agent or model): newest first
  for (const list of bySession.values()) list.sort((a, b) => b.updatedAt - a.updatedAt)
  store.bySession = bySession
  store.configDirs = configDirs
}

const defaultConfigDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude")

const encoded = new Map()
// Claude Code names a project's folder from the real path of its directory, every character
// that is not a letter or a digit turned into a dash.
function encodeCwd(cwd) {
  let name = encoded.get(cwd)
  if (name) return name
  let real = cwd
  try {
    real = fs.realpathSync.native(cwd)
  } catch {}
  name = real.replace(/[^a-zA-Z0-9]/g, "-")
  encoded.set(cwd, name)
  return name
}

const transcriptOf = (record) => path.join(record.configDir || defaultConfigDir(), "projects", encodeCwd(record.cwd), `${record.claude}.jsonl`)

// A transcript is read forwards from where the last read ended: it only ever grows, and one
// record of it can be hundreds of kilobytes (a tool result with a picture in it), so its end
// is not a fixed number of bytes away. The first read takes the last four megabytes.
//   calls   every model call seen, oldest first: when its first and its last record were
//           written, and what it read from and wrote to the cache
//   stamps  when every record of a block was written, oldest first
function readMore(file, stat, entry) {
  let from = entry.offset
  let skip = false
  if (stat.size - from > READ_CAP) {
    // too far behind (or the first read): start near the end, on the first whole line
    from = Math.max(0, stat.size - FIRST_READ)
    skip = from > 0
    entry.partial = null
    entry.calls = []
    entry.stamps = []
  }
  const length = stat.size - from
  if (length <= 0) return
  const buffer = Buffer.alloc(length)
  const fd = fs.openSync(file, "r")
  try {
    fs.readSync(fd, buffer, 0, length, from)
  } finally {
    fs.closeSync(fd)
  }
  const whole = entry.partial ? Buffer.concat([entry.partial, buffer]) : buffer
  const end = whole.lastIndexOf(10)
  // a record still being written stays for the next read
  entry.partial = end < whole.length - 1 ? whole.subarray(end + 1) : null
  entry.offset = stat.size
  if (end < 0) return
  const lines = whole.toString("utf8", 0, end).split("\n")
  if (skip) lines.shift() // cut in the middle of a record
  let call = entry.calls[entry.calls.length - 1] ?? null
  for (const line of lines) {
    if (!line || !line.includes('"usage"') || !line.includes('"assistant"')) continue
    let record
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    const usage = record?.message?.usage
    if (record.type !== "assistant" || !usage || record.message.model === "<synthetic>") continue
    const at = Date.parse(record.timestamp)
    if (!Number.isFinite(at)) continue
    entry.stamps.push(at)
    if (!call || record.message.id !== call.id) {
      call = { id: record.message.id, first: at, at }
      entry.calls.push(call)
    }
    // one record per content block: the first is nearest to when the request went out, the
    // newest is the call's end and carries its final usage
    call.at = Math.max(call.at, at)
    call.read = usage.cache_read_input_tokens ?? 0
    call.write = usage.cache_creation_input_tokens ?? 0
    call.five = usage.cache_creation?.ephemeral_5m_input_tokens ?? 0
    call.hour = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0
  }
  if (entry.calls.length > 120) entry.calls.splice(0, entry.calls.length - 120)
  if (entry.stamps.length > 800) entry.stamps.splice(0, entry.stamps.length - 800)
}

function transcript(file) {
  let stat
  try {
    stat = fs.statSync(file)
  } catch {
    return null
  }
  let entry = files.get(file)
  if (entry && entry.size === stat.size && entry.mtime === stat.mtimeMs) return entry
  // a file that shrank or was replaced is read afresh
  if (!entry || stat.size < entry.offset || entry.ino !== stat.ino) entry = { ino: stat.ino, offset: -Infinity, partial: null, calls: [], stamps: [] }
  try {
    readMore(file, stat, entry)
  } catch {}
  entry.size = stat.size
  entry.mtime = stat.mtimeMs
  files.delete(file)
  files.set(file, entry)
  if (files.size > 200) files.delete(files.keys().next().value)
  return entry
}

// The newest call that touched the cache, and the lifetime the newest writing call wrote under.
function summary(calls) {
  let call = null
  let wrote = null
  for (let index = (calls?.length ?? 0) - 1; index >= 0; index -= 1) {
    const entry = calls[index]
    if (!call && (entry.read || entry.write)) call = entry // a call that neither read nor wrote the cache does not keep it warm
    if (!wrote && (entry.five || entry.hour)) wrote = entry
    if (call && wrote) break
  }
  if (!call) return null
  return {
    at: call.at,
    first: call.first,
    read: call.read,
    write: call.write,
    five: wrote?.five ?? 0,
    hour: wrote?.hour ?? 0,
    // what cools first when a call wrote under both lifetimes
    lifetime: wrote ? (wrote.five ? FIVE_MIN : HOUR) : null,
  }
}

// The transcripts of a project folder that were written to since `since`, in every account's
// own Claude folder.
function recentIn(cwd, since) {
  const out = []
  const dirs = new Set([defaultConfigDir(), ...store.configDirs])
  for (const configDir of dirs) {
    const folder = path.join(configDir, "projects", encodeCwd(cwd))
    let listing = listings.get(folder)
    const now = Date.now()
    if (!listing || now - listing.at > LISTING_MS) {
      listing = { at: now, files: [] }
      try {
        for (const name of fs.readdirSync(folder)) {
          if (!name.endsWith(".jsonl")) continue
          const file = path.join(folder, name)
          try {
            listing.files.push({ file, mtime: fs.statSync(file).mtimeMs })
          } catch {}
        }
      } catch {}
      listings.set(folder, listing)
      if (listings.size > 200) listings.delete(listings.keys().next().value)
    }
    for (const entry of listing.files) if (entry.mtime >= since) out.push(entry.file)
  }
  return out
}

// How many of the moments a transcript has a record for: one written between `early` before
// and `late` after the moment. `stamps` is sorted.
function matches(stamps, moments, early, late) {
  let count = 0
  for (const moment of moments) {
    let low = 0
    let high = stamps.length
    while (low < high) {
      const middle = (low + high) >> 1
      if (stamps[middle] < moment - early) low = middle + 1
      else high = middle
    }
    if (low < stamps.length && stamps[low] <= moment + late) count += 1
  }
  return count
}

// The best transcript for a list of moments, and how many the runner-up matched.
function bestOf(candidates, moments, early, late) {
  let best = null
  let second = 0
  for (const entry of candidates) {
    const count = matches(entry.stamps, moments, early, late)
    if (!best || count > best.count) {
      second = best ? best.count : 0
      best = { count, entry }
    } else if (count > second) second = count
  }
  return best && second * 2 <= best.count ? best : null
}

function byTiming(thread) {
  const blocks = (thread.blocks ?? []).slice(-12)
  const tools = (thread.tools ?? []).slice(-12)
  if (blocks.length < 2 && tools.length < 3) return { call: null, why: "too little" }
  const oldest = Math.min(blocks[0] ?? Infinity, tools[0] ?? Infinity)
  const candidates = []
  for (const file of recentIn(thread.cwd, oldest - 30e3)) {
    const entry = transcript(file)
    if (entry?.stamps.length) candidates.push(entry)
  }
  let found = null
  const exact = blocks.length >= 2 ? bestOf(candidates, blocks, NEAR, NEAR) : null
  if (exact && exact.count >= 2) found = { entry: exact.entry, by: "blocks", matched: exact.count, of: blocks.length }
  else {
    const loose = tools.length >= 3 ? bestOf(candidates, tools, TOOL_EARLY, TOOL_LATE) : null
    if (loose && loose.count >= 3 && loose.count >= tools.length * 0.6) found = { entry: loose.entry, by: "tools", matched: loose.count, of: tools.length }
  }
  if (!found) return { call: null, why: "no match" }
  const call = summary(found.entry.calls)
  return { call: call ? { ...call, how: "timing", by: found.by, matched: found.matched, of: found.of } : null, why: call ? "" : "no cache" }
}

function seenFor(thread) {
  let recorded = null
  for (const record of (store.bySession.get(thread.id) ?? []).slice(0, 3)) {
    const call = summary(transcript(transcriptOf(record))?.calls)
    if (call && (!recorded || call.at > recorded.at)) recorded = call
  }
  if (recorded && recorded.at >= (thread.ended ?? 0) - BEHIND) return { ...recorded, how: "record" }
  // no record, or the record is of an earlier Claude session of this thread: ask the clock
  const timed = byTiming(thread)
  if (timed.call) return timed.call
  if (recorded) return { ...recorded, how: "record" }
  return { none: timed.why }
}

parentPort.on("message", ({ state, threads }) => {
  const entries = []
  try {
    readStore(state)
    for (const thread of threads ?? []) entries.push([thread.id, seenFor(thread)])
  } catch {}
  parentPort.postMessage({ entries })
})
