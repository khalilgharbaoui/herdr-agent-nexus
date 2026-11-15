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
// megabytes and is rewritten at the end of every turn; reading it must not hold up a frame.
//
// Memory. Both kinds of file pass through one buffer of a quarter of a megabyte that is
// allocated once (CHUNK). Nothing is read whole: the plugin's record (9 MB, most of it digests)
// is walked byte by byte for the four fields wanted, and a transcript is taken line by line.
// Read whole, each first pass left 4 to 9 MB blocks behind that the allocator kept, and a
// parsed copy of the record in this thread's heap: 110 MB for a job that keeps a few
// kilobytes per thread (measured with tools/mem-source.mjs).

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { parentPort } from "node:worker_threads"

const FIRST_READ = 4 << 20 // how much of the end of a transcript the first read takes
const READ_CAP = 8 << 20 // further behind than this, a read starts near the end again
const CHUNK = 256 << 10 // every file is read through one buffer of this size
const LINE_CAP = 2 << 20 // a record longer than this is passed over (a tool result with pictures in it)
const LISTING_AGE = 70 * 60e3 // a transcript untouched for longer than any cache lives is not a thread's current one
const FILES_KEPT = 120
const FIVE_MIN = 300e3
const HOUR = 3600e3
const NEAR = 250 // one block's end stamped twice on one machine: this close is the same block
const TOOL_EARLY = 8000 // a tool call's record is written up to this long before the call reaches opencode
const TOOL_LATE = 1500 // or this long after opencode first saw it begin (a tool the CLI runs itself)
const BEHIND = 120e3 // a transcript whose newest call is older than the thread's by this much is not its current one
const LISTING_MS = 15e3

const chunk = Buffer.allocUnsafeSlow(CHUNK)
const USAGE = Buffer.from('"usage"')
const ASSISTANT = Buffer.from('"assistant"')
const store = { mtime: 0, size: 0, readAt: 0, bySession: new Map(), configDirs: new Set() }
const files = new Map() // transcript path -> { size, mtime, ino, offset, calls, stamps }
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
  const bySession = new Map()
  const configDirs = new Set()
  try {
    scanStore(file, (key, record) => {
      if (!record.claudeSessionId) return
      if (record.configDir) configDirs.add(record.configDir)
      const parts = key.split("::")
      const sid = parts.find((part) => part.startsWith("ses_"))
      if (!sid) return
      const list = bySession.get(sid) ?? []
      list.push({ cwd: parts[0], claude: record.claudeSessionId, configDir: record.configDir || "", updatedAt: Number(record.updatedAt) || 0 })
      bySession.set(sid, list)
    })
  } catch {
    return
  }
  store.mtime = stat.mtimeMs
  store.size = stat.size
  // one opencode session can have several Claude sessions (one per agent or model): newest first
  for (const list of bySession.values()) list.sort((a, b) => b.updatedAt - a.updatedAt)
  store.bySession = bySession
  store.configDirs = configDirs
}
// The plugin's record is { version, sessions: { key: { claudeSessionId, configDir, updatedAt,
// chain: [...], shape: [...], ... } } }, and nearly all of its bytes are the two lists of
// digests. This walks the bytes once and hands over, per session, its key and those three
// fields. A string is skipped with the buffer's own search for its closing quote, so the
// digests cost no work here; only a key, or the value of a wanted field, is ever decoded.
const WANTED = new Set(["claudeSessionId", "configDir", "updatedAt"])
function scanStore(file, onRecord) {
  const fd = fs.openSync(file, "r")
  try {
    const kinds = [] // 123 for an object, 91 for a list, one per open bracket
    let inString = false
    let pendingSlash = false // the chunk ended on an odd run of backslashes inside a string
    let keep = null // the pieces of the string being kept, when it is one that matters
    let role = "" // what the open string is: a session's key, a field's name, a wanted value
    let expectKey = false
    let sessions = false // inside the "sessions" object
    let topKey = ""
    let key = ""
    let field = ""
    let record = null
    let number = ""
    let position = 0
    const endString = () => {
      const text = keep ? Buffer.concat(keep).toString("utf8") : ""
      keep = null
      let value = text
      if (text.includes("\\")) {
        try {
          value = JSON.parse(`"${text}"`)
        } catch {}
      }
      if (role === "top") topKey = value
      else if (role === "key") {
        key = value
        record = {}
      } else if (role === "field") field = value
      else if (role === "value" && record) record[field] = value
      role = ""
    }
    for (;;) {
      const got = fs.readSync(fd, chunk, 0, CHUNK, position)
      if (got <= 0) break
      position += got
      let index = 0
      while (index < got) {
        if (inString) {
          // to the closing quote: the next quote that an even run of backslashes stands before
          let quote = index
          let found = -1
          let slash = pendingSlash
          pendingSlash = false
          for (;;) {
            quote = chunk.indexOf(34, quote)
            if (quote < 0 || quote >= got) break
            let run = 0
            for (let back = quote - 1; back >= index && chunk[back] === 92; back -= 1) run += 1
            const odd = quote - run === index ? (run % 2 === 1) !== slash : run % 2 === 1
            if (!odd) {
              found = quote
              break
            }
            quote += 1
          }
          const end = found < 0 ? got : found
          if (keep) keep.push(Buffer.from(chunk.subarray(index, end)))
          if (found < 0) {
            let run = 0
            for (let back = got - 1; back >= index && chunk[back] === 92; back -= 1) run += 1
            pendingSlash = got - run === index ? (run % 2 === 1) !== slash : run % 2 === 1
            index = got
            break
          }
          inString = false
          endString()
          index = found + 1
          continue
        }
        const byte = chunk[index]
        index += 1
        const depth = kinds.length
        if (byte === 34) {
          inString = true
          role = ""
          if (expectKey && depth === 1) role = "top"
          else if (expectKey && depth === 2 && sessions) role = "key"
          else if (expectKey && depth === 3 && sessions) role = "field"
          else if (!expectKey && depth === 3 && sessions && WANTED.has(field)) role = "value"
          keep = role ? [] : null
          expectKey = false
        } else if (byte === 123 || byte === 91) {
          if (depth === 1 && byte === 123 && topKey === "sessions") sessions = true
          kinds.push(byte)
          expectKey = byte === 123
        } else if (byte === 125 || byte === 93) {
          if (number && record) record[field] = number
          number = ""
          kinds.pop()
          if (sessions && kinds.length === 2 && record) {
            onRecord(key, record)
            record = null
          }
          if (kinds.length === 1) sessions = false
          expectKey = false
        } else if (byte === 44) {
          if (number && record) record[field] = number
          number = ""
          expectKey = kinds[depth - 1] === 123
        } else if (byte === 58) expectKey = false
        else if (sessions && depth === 3 && field === "updatedAt" && ((byte >= 48 && byte <= 57) || byte === 46)) number += String.fromCharCode(byte)
      }
    }
  } finally {
    fs.closeSync(fd)
  }
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

// The whole lines of a file between two positions, one at a time, through the one buffer.
// `onLine` gets a view that holds only until it returns. A line cut by the end of the buffer
// is read again from its own start, so no copy of it is made; only a line longer than the
// whole buffer is pieced together, and one longer than LINE_CAP is passed over. Returns the
// position after the last whole line: a record still being written is read again next time,
// from the file, so nothing of it is kept here.
function eachLine(file, from, to, skipFirst, onLine) {
  const fd = fs.openSync(file, "r")
  let position = from
  let after = from
  let carry = null // the pieces of a line that runs over the end of a chunk
  let carried = 0
  let passing = skipFirst // inside a line that is passed over
  try {
    while (position < to) {
      const got = fs.readSync(fd, chunk, 0, Math.min(CHUNK, to - position), position)
      if (got <= 0) break
      const last = position + got >= to
      let advance = got
      let start = 0
      while (start < got) {
        const end = chunk.indexOf(10, start)
        if (end < 0 || end >= got) {
          if (last) break // still being written: next time
          if (start > 0 && !carry) advance = start
          else if (!passing) {
            if (carried + got - start > LINE_CAP) {
              passing = true
              carry = null
              carried = 0
            } else {
              ;(carry ??= []).push(Buffer.from(chunk.subarray(start, got)))
              carried += got - start
            }
          }
          break
        }
        if (passing) passing = false
        else if (carry) {
          carry.push(chunk.subarray(start, end))
          onLine(Buffer.concat(carry))
        } else if (end > start) onLine(chunk.subarray(start, end))
        carry = null
        carried = 0
        start = end + 1
        after = position + start
      }
      if (last) break
      position += advance
    }
  } finally {
    fs.closeSync(fd)
  }
  return after
}

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
    entry.calls = []
    entry.stamps = []
  }
  if (stat.size - from <= 0) return
  let call = entry.calls[entry.calls.length - 1] ?? null
  entry.offset = eachLine(file, from, stat.size, skip, (line) => {
    if (!line.includes(USAGE) || !line.includes(ASSISTANT)) return
    let record
    try {
      record = JSON.parse(line.toString("utf8"))
    } catch {
      return
    }
    const usage = record?.message?.usage
    if (record.type !== "assistant" || !usage || record.message.model === "<synthetic>") return
    const at = Date.parse(record.timestamp)
    if (!Number.isFinite(at)) return
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
    // the context this call was given: what it read from the cache, wrote to it and sent fresh
    call.ctx = (usage.input_tokens ?? 0) + call.read + call.write
  })
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
  if (!entry || stat.size < entry.offset || entry.ino !== stat.ino) entry = { ino: stat.ino, offset: -Infinity, calls: [], stamps: [] }
  try {
    readMore(file, stat, entry)
  } catch {}
  entry.size = stat.size
  entry.mtime = stat.mtimeMs
  files.delete(file)
  files.set(file, entry)
  if (files.size > FILES_KEPT) files.delete(files.keys().next().value)
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
    // the context at each of the last calls: [when the call began, when it ended, its context]
    trail: calls.slice(-40).map((entry) => [entry.first, entry.at, entry.ctx]),
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
            const mtime = fs.statSync(file).mtimeMs
            if (mtime >= now - LISTING_AGE) listing.files.push({ file, mtime })
          } catch {}
        }
      } catch {}
      listings.set(folder, listing)
      if (listings.size > 60) listings.delete(listings.keys().next().value)
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
  // what this thread keeps, for stats.json: transcripts followed, and the calls and block
  // stamps held for them
  let calls = 0
  let stamps = 0
  for (const entry of files.values()) {
    calls += entry.calls.length
    stamps += entry.stamps.length
  }
  parentPort.postMessage({ entries, kept: { files: files.size, calls, stamps, sessions: store.bySession.size, listings: listings.size, heapMb: Number((process.memoryUsage().heapUsed / 1048576).toFixed(1)) } })
})
