// REACH: what the focused thread's turn has touched, and when.
//
// Everything else on the stage says how the turn works (how long, how many calls, which
// equipment). This says on what: every file the turn read or wrote, every program it ran, every
// host it fetched, every agent it dispatched, as a tree that grows off the thread's own wire.
// Files hang under the folder they are in; the other kinds under their equipment. To the right
// of each name runs the turn's time, the same scale for every row, with one bar per call on that
// target: where it starts is when the call started, its length how long it took, its colour the
// equipment, red when it failed, hollow while it runs.
//
// What moves: a call that starts sends its packet from the wire along the branch to its target,
// motes run along that branch for as long as the call is out, and the result comes back the same
// way (red when it failed). The cyan line is now. A name is bright for 20 s after its last
// touch, softer for five minutes, dim after that.
//
// What is read: the tool's name and the first field of its input that opencode's store has for
// it (the path, the command, the pattern, the address). A program is the first word of its
// command after any leading `cd` and variable assignments, with the subcommand for git, npm and
// the like. Nothing is guessed from a command's text beyond that.

import { portOf } from "./model.mjs"
import { NICE_SPANS, PORT_COLOR, bare, clean, homed, spriteHex } from "./theme.mjs"
import { FAMILY, INK, agoOf, clockOf, rgba, spanOf, toolMeta } from "./util.mjs"

const FILE_KINDS = new Set(["read", "write", "search"])
const SUBCOMMANDS = new Set(["git", "npm", "npx", "pnpm", "yarn", "bun", "gh", "docker", "cargo", "bundle", "herdr", "kubectl", "brew"])
const GROUP_WORD = { "port:exec": ["SHELL", "programs run"], "port:search": ["SEARCH", "patterns looked for"], "port:web": ["WEB", "hosts fetched"], "port:agent": ["AGENTS", "dispatches"], "port:you": ["YOU", "questions put to you"], "port:other": ["OTHER", "todo, skills, mcp"], "port:read": ["READ", "no path recorded"], "port:write": ["WRITE", "no path recorded"] }
const GROUP_PORT = { "port:exec": "exec", "port:search": "read", "port:web": "web", "port:agent": "agent", "port:you": "you", "port:other": "other", "port:read": "read", "port:write": "write" }
const BRIGHT_MS = 20e3
const SOFT_MS = 300e3

// A stretch of the time axis in the fewest letters: 15s, 5m, 7m30, 1h, 1h30.
const tickWord = (ms) => {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return seconds % 60 ? `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}` : `${seconds / 60}m`
  const minutes = Math.round(seconds / 60)
  return minutes % 60 ? `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}` : `${minutes / 60}h`
}

const looksLikePath = (label) => label.length > 0 && !/[*?[\](){}|\\^$+\s]/.test(label) && (label.includes("/") || /\.[A-Za-z0-9]{1,8}$/.test(label))

// The program a command starts with: "cd v5 && FOO=1 node tools/x.mjs" is node, "git commit -m" is
// "git commit", "./tools/restart.sh" is restart.sh.
export function programOf(command) {
  let rest = String(command ?? "").trim()
  for (let guard = 0; guard < 12; guard += 1) {
    const skip = /^cd\s+("[^"]*"|'[^']*'|\S+)\s*(&&|;)\s*/.exec(rest) ?? /^[A-Za-z_][A-Za-z0-9_]*=("[^"]*"|'[^']*'|\S*)(\s+|$)/.exec(rest) ?? /^(&&|\|\||;|[({])\s*/.exec(rest)
    if (!skip) break
    rest = rest.slice(skip[0].length)
  }
  const words = rest.split(/\s+/)
  const program = (words[0] ?? "").split("/").pop().replace(/^["'`]+|["'`;)]+$/g, "")
  if (!program) return "shell"
  if (SUBCOMMANDS.has(program) && /^[a-z][a-z-]*$/.test(words[1] ?? "")) return `${program} ${words[1]}`
  return program.slice(0, 40)
}

export const hostOf = (address) => String(address ?? "").replace(/^[a-z]+:\/\//i, "").split(/[/?#]/)[0]

function targetOf(tool, directory) {
  const meta = toolMeta(tool.name)
  const label = clean(tool.label)
  if (FILE_KINDS.has(meta.kind) && looksLikePath(label)) {
    let full = label.replace(/^\.\//, "")
    if (!full.startsWith("/") && !full.startsWith("~") && directory) full = `${directory.replace(/\/+$/, "")}/${full}`
    full = full.replace(/\/+$/, "") || "/"
    const at = full.lastIndexOf("/")
    const name = full.slice(at + 1)
    // a search is given a file or a folder to look in: an extension makes it a file
    const file = meta.kind !== "search" || /\.[A-Za-z0-9]{1,8}$/.test(name)
    const dir = at > 0 ? full.slice(0, at) : at === 0 ? "/" : "."
    return { group: `dir:${dir}`, dir, name: file ? name : `${name}/`, full, what: file ? "file" : "folder" }
  }
  if (meta.kind === "search") return { group: "port:search", name: label || bare(tool.name).toLowerCase(), full: label, what: "pattern" }
  if (meta.kind === "exec") return { group: "port:exec", name: programOf(label), full: label, what: "program" }
  if (meta.kind === "web") return { group: "port:web", name: hostOf(label) || "web", full: label, what: "host" }
  if (meta.kind === "agent") return { group: "port:agent", name: label || "subagent", full: label, what: "dispatch" }
  if (meta.kind === "ask") return { group: "port:you", name: "question", full: label, what: "question" }
  const port = portOf(tool.name)
  return { group: `port:${port in PORT_COLOR ? port : "other"}`, name: bare(tool.name).toLowerCase() || "tool", full: label, what: "tool" }
}

// The folder every one of these folders is in, as path segments.
function commonSegments(list) {
  if (!list.length) return []
  let parts = list[0]
  for (const other of list.slice(1)) {
    let same = 0
    while (same < parts.length && same < other.length && parts[same] === other[same]) same += 1
    parts = parts.slice(0, same)
  }
  return parts
}

// The root the folders are named from: the folder they are all in. When that is too shallow to
// say anything (the disk, the home folder: one stray temporary file is enough), the branch with
// the most calls is followed down until the folders in it share a real one; the rest are
// shown in full, as outside it. A path may begin with "/" or with "~" (the home folder).
function rootOf(folders) {
  let inside = folders.map((group) => ({ parts: group.dir.split("/"), calls: group.calls }))
  let common = commonSegments(inside.map((entry) => entry.parts))
  const depth = (parts) => parts.filter(Boolean).length + (parts[0] === "~" ? 1 : 0)
  const absolute = folders.every((group) => group.dir.startsWith("/") || group.dir.startsWith("~"))
  for (let guard = 0; absolute && inside.length > 1 && depth(common) < 3 && guard < 8; guard += 1) {
    const weight = new Map()
    for (const entry of inside) {
      const head = entry.parts[common.length]
      if (head !== undefined) weight.set(head, (weight.get(head) ?? 0) + entry.calls)
    }
    if (!weight.size) break
    const best = [...weight].sort((a, b) => b[1] - a[1])[0][0]
    const at = common.length
    inside = inside.filter((entry) => entry.parts[at] === best)
    common = commonSegments(inside.map((entry) => entry.parts))
  }
  return common.join("/") || (common.length ? "/" : "")
}

// What the turn touched: groups (a folder, or a kind of equipment) in the order they were first
// touched, each with its targets in the order they were first touched.
export function reachOf(session, turn, now) {
  const groups = new Map()
  let calls = 0
  for (const step of session.steps) {
    if (step.start < turn.start - 500 || step.start > turn.end) continue
    for (const tool of step.tools) {
      const target = targetOf(tool, session.directory)
      calls += 1
      let group = groups.get(target.group)
      if (!group) {
        group = { key: target.group, dir: target.dir ?? null, port: GROUP_PORT[target.group] ?? null, leaves: new Map(), first: tool.start, last: 0, calls: 0 }
        groups.set(target.group, group)
      }
      let leaf = group.leaves.get(target.name)
      if (!leaf) {
        leaf = { key: `${target.group}|${target.name}`, name: target.name, full: target.full, what: target.what, group, calls: [], first: tool.start, last: 0, running: 0, failed: 0, ms: 0, kinds: new Map() }
        group.leaves.set(target.name, leaf)
      }
      const port = portOf(tool.name)
      leaf.calls.push({ tool, step, port })
      leaf.full = target.full || leaf.full
      leaf.last = Math.max(leaf.last, tool.end ?? now)
      leaf.ms += Math.max(0, (tool.end ?? now) - tool.start)
      if (tool.end === null && turn.live) leaf.running += 1
      if (tool.status === "error") leaf.failed += 1
      const word = bare(tool.name).toLowerCase()
      leaf.kinds.set(word, (leaf.kinds.get(word) ?? 0) + 1)
      group.last = Math.max(group.last, leaf.last)
      group.calls += 1
    }
  }
  const folders = [...groups.values()].filter((group) => group.dir !== null)
  const root = rootOf(folders)
  for (const group of folders) {
    if (group.dir === root) group.label = "./"
    else if (root && root !== "/" && group.dir.startsWith(`${root}/`)) group.label = `${group.dir.slice(root.length + 1)}/`
    else if (!root && !group.dir.startsWith("/") && !group.dir.startsWith("~")) group.label = `${group.dir}/`
    else {
      // not under the root: named in full, and said to be outside
      group.label = `${homed(group.dir)}/`
      group.outside = true
    }
  }
  // folders read as a tree: the root's own files first, then its folders by path, then what
  // is outside it; the equipment groups follow in the order they were first used
  folders.sort((a, b) => Number(a.outside ?? false) - Number(b.outside ?? false) || Number(b.label === "./") - Number(a.label === "./") || a.label.localeCompare(b.label))
  const list = [...folders, ...[...groups.values()].filter((group) => group.dir === null)]
  const leaves = list.flatMap((group) => [...group.leaves.values()])
  return {
    root,
    groups: list,
    calls,
    files: leaves.filter((leaf) => leaf.what === "file" || leaf.what === "folder").length,
    folders: folders.length,
    programs: groups.get("port:exec")?.leaves.size ?? 0,
    targets: leaves.length,
  }
}

export const reach = {
  // The span the timeline shows: the first round span the turn still fits in, so the scale
  // stands still until the turn outgrows it.
  reachSpan(turn) {
    const elapsed = Math.max(1, turn.end - turn.start)
    return NICE_SPANS.find((span) => span >= elapsed * 1.04) ?? elapsed * 1.2
  },

  reachColumns() {
    const G = this.G
    const box = G.reach
    const x0 = G.trunkX + this.u(34)
    const x1 = box.x + box.w - this.u(20)
    const tx1 = x1 - this.u(56)
    const tx0 = Math.min(tx1 - this.u(120), x0 + Math.round((x1 - x0) * 0.44))
    return { x0, x1, tx0, tx1 }
  },

  signReach(scene, ui, now) {
    const session = scene.focused?.session
    if (!session || !this.G.reach) return "none"
    const turn = this.turnWindow(session, now)
    if (!turn) return `${session.id}|no turn`
    let tools = 0
    let ended = 0
    let failed = 0
    let newest = 0
    let running = 0
    for (const step of session.steps) {
      if (step.start < turn.start - 500 || step.start > turn.end) continue
      for (const tool of step.tools) {
        tools += 1
        if (tool.end !== null) ended += 1
        else if (turn.live) running += 1
        if (tool.status === "error") failed += 1
        newest = Math.max(newest, tool.end ?? now)
      }
    }
    const span = this.reachSpan(turn)
    const { tx0, tx1 } = this.reachColumns()
    // now moves in whole seconds and is painted again when it has moved two pixels; the words
    // at the right ("20s", "3m") change every ten seconds under a minute, every minute after
    const second = Math.floor(now / 1000) * 1000
    const head = turn.live ? Math.floor((((second - turn.start) / span) * (tx1 - tx0)) / 2) : -1
    const age = now - newest
    const clock = !turn.live ? 0 : running || age < 60e3 ? Math.floor(now / 10e3) : Math.floor(now / 60e3)
    const labels = ["thread", "turn", "live", "calls", "ended", "failed", "scale", "now line", "ages", "wire", "scrub"]
    const parts = [session.id, turn.start, turn.live, tools, ended, failed, span, head, clock, this.G.trunkX, this.scrubAt(ui) ?? ""]
    this.signed = { labels, parts }
    return parts.join("|")
  },

  // A path cut at its head, so its end (the part that tells one path from another) stays.
  fitTail(c, value, maxWidth, style) {
    const key = `tail|${style.size}|${style.family ?? ""}|${Math.round(maxWidth)}|${value}`
    let result = this.fits.get(key)
    if (result !== undefined) return result
    result = value
    if (maxWidth <= 0) result = ""
    else if (this.width(c, value, style) > maxWidth) {
      let low = 0
      let high = value.length
      while (low < high) {
        const middle = (low + high + 1) >> 1
        if (this.width(c, `…${value.slice(value.length - middle)}`, style) <= maxWidth) low = middle
        else high = middle - 1
      }
      result = low > 0 ? `…${value.slice(value.length - low)}` : ""
    }
    this.fits.set(key, result)
    return result
  },

  drawReach(c, scene, ui, now) {
    const G = this.G
    const u = (value) => this.u(value)
    const box = G.reach
    const flow = this.flow
    for (const key of this.reachPaths ?? []) flow.paths.delete(key)
    this.reachPaths = []
    this.reachLeaves = new Map() // tool id -> { key, x, y }: where its target stands
    this.reachMark = null
    const session = scene.focused?.session
    if (!session || !box) return
    const turn = this.turnWindow(session, now)
    const { x0, x1, tx0, tx1 } = this.reachColumns()
    const headY = box.y + u(20)
    const labelStyle = { size: 11.5, family: FAMILY.label, weight: "600", color: INK.dim, spacing: 2.6 }
    const small = { size: 11.5, color: INK.faint }
    const fade = turn?.live ? 1 : 0.6
    const data = turn ? reachOf(session, turn, now) : null
    const labelW = this.width(c, "REACH", labelStyle)
    this.text(c, "REACH", x0, headY, labelStyle)
    const what = "A tree off the thread's own wire: every file this turn read or wrote under the folder it is in, and every program, search, host and agent under its equipment. Right of each name runs the turn's time with one bar per call on it."
    if (!data || !data.calls) {
      this.text(c, turn ? "nothing touched yet: this turn has made no tool call" : "n/a: no turn to show", x0 + labelW + u(14), headY, { size: 12.5, color: INK.faint })
      this.note("reach", { x: x0 - u(4), y: headY - u(14), w: x1 - x0 + u(8), h: u(20) }, "REACH", "what this turn touched, and when", [["WHAT", what], ["NOW", turn ? "no tool call in this turn yet" : "this thread has no turn on record"]])
      return
    }
    const word = turn.live ? "this turn" : "the last turn"
    // (at a held moment: the turn of then, as far as it had come)
    const phrase = scene.then ? (turn.live ? "what the turn had touched by then" : "what the turn before then touched") : `what ${word} touched`
    const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
    const summary = [data.files ? `${count(data.files, "file")} in ${count(data.folders, "folder")}` : "", data.programs ? count(data.programs, "program") : "", data.targets - data.files - data.programs > 0 ? count(data.targets - data.files - data.programs, data.files || data.programs ? "other target" : "target") : ""].filter(Boolean).join("  ·  ")
    const summaryW = this.width(c, summary, { size: 11.5 })
    this.text(c, this.fitWords(c, phrase, x1 - summaryW - u(18) - (x0 + labelW + u(14)), { size: 12.5 }), x0 + labelW + u(14), headY, { size: 12.5, color: rgba(INK.dim, fade) })
    this.text(c, summary, x1, headY, { size: 11.5, color: INK.faint, align: "right" })
    this.note("reach", { x: x0 - u(4), y: headY - u(14), w: x1 - x0 + u(8), h: u(20) }, "REACH", `${phrase}, and when`, [["WHAT", what], ["COUNT", `${summary.replaceAll("  ·  ", ", ")}; ${count(data.targets, "target")} in all`], ["FROM", "the name of each tool call and the first field of its input in opencode's record: the path, the command, the pattern or the address"], ["PROGRAM", "the first word of a command after any leading cd and variable assignments, with the subcommand for git, npm and the like"]])

    // the turn's time across the top: the same scale for every row
    const span = this.reachSpan(turn)
    const tw = tx1 - tx0
    const axisY = box.y + u(50)
    const xOf = (at) => tx0 + (Math.max(0, Math.min(span, at - turn.start)) / span) * tw
    const rootStyle = { size: 11.5, color: rgba(INK.dim, fade) }
    if (data.root) {
      const shown = this.fitTail(c, `in ${homed(data.root)}`, tx0 - x0 - u(14), rootStyle)
      this.text(c, shown, x0, axisY, rootStyle)
      this.note("reach-root", { x: x0 - u(4), y: axisY - u(14), w: tx0 - x0 - u(6), h: u(20) }, "REACH · ROOT", homed(data.root), [["WHAT", "the folder every file this turn touched is in; the folders below are named from here"], ["FULL", data.root]])
    }
    this.line(c, tx0, axisY, tx1, axisY, INK.faint, 1)
    for (let index = 0; index <= 4; index += 1) {
      const x = Math.round(tx0 + (tw * index) / 4)
      this.line(c, x, axisY - (index % 4 === 0 ? u(6) : u(3)), x, axisY + u(3), INK.faint, 1)
      const tick = index === 0 ? clockOf(turn.start).slice(0, 5) : `+${tickWord((span * index) / 4)}`
      this.text(c, tick, x, axisY - u(9), { size: 10.5, color: INK.faint, align: index === 0 ? "left" : index === 4 ? "right" : "center" })
    }
    this.note("reach-axis", { x: tx0 - u(4), y: axisY - u(22), w: tw + u(8), h: u(28) }, "REACH · TIME", `${clockOf(turn.start)} to +${tickWord(span)}`, [["WHAT", "the turn's time, left to right: it began at the left end, and the cyan line is now. One scale for every row below"], ["SCALE", `${tickWord(span)} across: the first round span the turn still fits in, so it stands still until the turn outgrows it`], ["TURN", turn.live ? `began ${clockOf(turn.start)}, ${agoOf(now - turn.start)} ago` : `ran ${spanOf(turn.end - turn.start)}, to ${clockOf(turn.end)}`]])

    // which rows fit: when there are too many, the targets touched longest ago give way
    const rowH = u(21)
    const top = axisY + u(24)
    const room = Math.max(0, Math.floor((box.y + box.h - u(10) - top) / rowH) + 1)
    let groups = data.groups.map((group) => ({ group, leaves: [...group.leaves.values()] }))
    const total = groups.reduce((sum, entry) => sum + 1 + entry.leaves.length, 0)
    let hidden = []
    if (total > room) {
      // every group keeps its place: each shows as many of its targets as all can show alike
      // (the ones touched most recently), and when even one each does not fit, the groups
      // touched longest ago give way
      const byRecency = (list) => [...list].sort((a, b) => b.last - a.last)
      let shown = byRecency(groups.map((entry) => entry.group))
      while (shown.length > 1 && shown.length * 2 + 1 > room) shown.pop()
      const rowsAt = (cap) => shown.reduce((sum, group) => sum + 1 + Math.min(cap, group.leaves.size), 0) + 1
      // (stops at the largest group: when the groups that are left fit whole, a higher cap adds
      // no row, and this loop once ran for ever on a small room with a few small groups)
      const most = shown.reduce((size, group) => Math.max(size, group.leaves.size), 1)
      let cap = 1
      while (cap < most && rowsAt(cap + 1) <= room) cap += 1
      const kept = new Set()
      for (const group of shown) for (const leaf of byRecency(group.leaves.values()).slice(0, cap)) kept.add(leaf)
      // rows still free go to the targets touched most recently, whatever their group
      let free = room - rowsAt(cap)
      for (const leaf of byRecency(shown.flatMap((group) => [...group.leaves.values()]))) {
        if (free <= 0) break
        if (kept.has(leaf)) continue
        kept.add(leaf)
        free -= 1
      }
      hidden = byRecency(groups.flatMap((entry) => entry.leaves).filter((leaf) => !kept.has(leaf)))
      groups = groups.map((entry) => ({ group: entry.group, leaves: entry.leaves.filter((leaf) => kept.has(leaf)) })).filter((entry) => entry.leaves.length)
    }
    if (!groups.length) return

    // the tree: a branch leaves the wire at the first row and runs down a stem; every group
    // hangs on that stem, every target on its group's own
    const busX = G.trunkX
    const stem = x0 + u(5)
    const groupX = x0 + u(20)
    const inner = x0 + u(26)
    const leafX = x0 + u(42)
    const wire = rgba(INK.faint, 0.9)
    const rows = []
    let y = top
    for (const entry of groups) {
      const groupY = y
      y += rowH
      const leaves = entry.leaves.map((leaf) => {
        const row = { leaf, y }
        y += rowH
        return row
      })
      rows.push({ ...entry, y: groupY, rows: leaves })
    }
    const firstY = rows[0].y - u(4)
    const lastGroupY = rows[rows.length - 1].y - u(4)
    this.line(c, busX, firstY, stem, firstY, wire, 1)
    this.dot(c, busX, firstY, u(2.6), rgba(INK.soft, fade))
    if (lastGroupY > firstY) this.line(c, stem, firstY, stem, lastGroupY, wire, 1)
    // the grid of the timeline, behind the bars
    const bottom = y - rowH + u(4)
    for (let index = 1; index < 4; index += 1) {
      const x = Math.round(tx0 + (tw * index) / 4)
      this.line(c, x, axisY + u(3), x, bottom, rgba(INK.faint, 0.35), 1)
    }
    this.reachMark = { x: busX, y: firstY, tx0, tx1, axisY, bottom }
    // the branch itself: where the thread's wire reaches out
    this.note("reach-branch", { x: busX - u(5), y: firstY - u(7), w: stem + u(3) - (busX - u(5)), h: lastGroupY - firstY + u(14) }, "REACH · BRANCH", "from the thread's wire to what it touches", [["WHAT", "the branch leaves the focused thread's wire here and runs down to every folder and kind of equipment this turn has reached"], ["MOVES", "a call's packet leaves the wire along it when the call starts, motes run along it for as long as the call is out, and the result comes back the same way, red when it failed"], ["NOW", session.phase.tools.length ? `${count(session.phase.tools.length, "call")} out` : "no call out"]])

    const nameStyle = { size: 12.5 }
    for (const entry of rows) {
      const group = entry.group
      const gy = entry.y - u(4)
      const tone = group.port ? PORT_COLOR[group.port] : INK.soft
      this.line(c, stem, gy, groupX - u(5), gy, wire, 1)
      const [title, sub] = group.dir !== null ? [group.label, ""] : (GROUP_WORD[group.key] ?? ["OTHER", ""])
      let endX
      if (group.dir !== null) {
        const shown = this.fitTail(c, title, tx0 - groupX - u(60), { size: 12.5, family: FAMILY.monoMedium })
        this.text(c, shown, groupX, entry.y, { size: 12.5, family: FAMILY.monoMedium, color: rgba(group.outside ? INK.dim : INK.soft, fade) })
        endX = groupX + this.width(c, shown, { size: 12.5, family: FAMILY.monoMedium })
      } else {
        c.fillStyle = rgba(tone, fade)
        c.fillRect(groupX, entry.y - u(11), u(2), u(12))
        this.text(c, title, groupX + u(8), entry.y, { size: 11.5, family: FAMILY.label, weight: "600", color: rgba(INK.soft, fade), spacing: 2.2 })
        endX = groupX + u(8) + this.width(c, title, { size: 11.5, family: FAMILY.label, weight: "600", spacing: 2.2 })
      }
      const tally = `${group.leaves.size}${hidden.some((leaf) => leaf.group === group) ? ` (${entry.rows.length} shown)` : ""}  ·  ${count(group.calls, "call")}`
      this.text(c, this.fit(c, tally, tx0 - endX - u(20), small), endX + u(10), entry.y, small)
      const folderLines = group.dir !== null
        ? [["WHAT", group.outside ? "a folder this turn touched files in. It is outside the root the other folders share, so it is named in full" : "a folder this turn touched files in, named from the root above"], ["FULL", group.dir], ["TOUCHED", `${count(group.leaves.size, "target")}, ${count(group.calls, "call")}`], ["FIRST", clockOf(group.first)], ["LAST", `${clockOf(group.last)}, ${agoOf(now - group.last)} ago`]]
        : [["WHAT", `${sub}: what this turn reached through this equipment that is not a file`], ["TOUCHED", `${count(group.leaves.size, "target")}, ${count(group.calls, "call")}`], ["FIRST", clockOf(group.first)], ["LAST", `${clockOf(group.last)}, ${agoOf(now - group.last)} ago`]]
      this.note(`reach-group:${group.key}`, { x: stem + u(3), y: entry.y - u(16), w: x1 + u(4) - stem - u(3), h: rowH }, group.dir !== null ? "REACH · FOLDER" : "REACH · EQUIPMENT", group.dir !== null ? homed(group.dir) : title, folderLines)
      if (entry.rows.length) this.line(c, inner, gy + u(8), inner, entry.rows[entry.rows.length - 1].y - u(4), wire, 1)

      for (const row of entry.rows) {
        const leaf = row.leaf
        const ly = row.y - u(4)
        const age = now - leaf.last
        const live = leaf.running > 0
        const ink = live || (turn.live && age < BRIGHT_MS) ? INK.text : turn.live && age < SOFT_MS ? INK.soft : INK.dim
        this.line(c, inner, ly, leafX - u(5), ly, wire, 1)
        // the node where the branch ends: filled in the colour of the last call's equipment
        const lastCall = leaf.calls[leaf.calls.length - 1]
        const nodeTone = leaf.failed && lastCall.tool.status === "error" ? INK.bad : PORT_COLOR[lastCall.port]
        if (live) {
          c.strokeStyle = nodeTone
          c.lineWidth = 1.5
          c.beginPath()
          c.arc(leafX - u(2), ly, u(3), 0, Math.PI * 2)
          c.stroke()
        } else this.dot(c, leafX - u(2), ly, u(2.4), rgba(nodeTone, (ink === INK.dim ? 0.55 : 0.95) * fade))
        const nameRoom = tx0 - (leafX + u(6)) - u(12)
        const shown = leaf.what === "file" || leaf.what === "folder" ? this.fitTail(c, leaf.name, nameRoom, nameStyle) : this.fit(c, leaf.name, nameRoom, nameStyle)
        this.text(c, shown, leafX + u(6), row.y, { size: 12.5, color: rgba(ink, fade) })
        const mix = [...leaf.kinds].map(([name, n]) => `${n} ${name}`).join(", ")
        const lines = [[leaf.what === "program" ? "LAST COMMAND" : leaf.what === "dispatch" ? "TASK" : leaf.what === "file" || leaf.what === "folder" ? "PATH" : "FULL", leaf.full || "not recorded"], ["CALLS", `${leaf.calls.length}: ${mix}${leaf.failed ? `, ${leaf.failed} failed` : ""}`], ["TIME", `${spanOf(leaf.ms)} together`], ["FIRST", clockOf(leaf.first)], ["LAST", live ? `running now, ${count(leaf.running, "call")}` : `${clockOf(leaf.last)}, ${agoOf(age)} ago`]]
        if (leaf.what === "program") lines.push(["NAMED", "the first word of the command after any leading cd and assignments"])
        this.note(`reach:${leaf.key}`, { x: inner + u(3), y: row.y - u(16), w: x1 + u(4) - inner - u(3), h: rowH }, `REACH · ${leaf.what.toUpperCase()}`, leaf.name, lines, leaf.failed ? INK.bad : undefined)

        // one bar per call on the turn's time
        const barH = u(9)
        const barY = ly - Math.round(barH / 2)
        this.line(c, tx0, ly, tx1, ly, rgba(INK.faint, 0.3), 1)
        for (const call of leaf.calls) {
          const tool = call.tool
          const open = tool.end === null && turn.live
          const from = xOf(tool.start)
          const to = Math.max(from + u(3), xOf(tool.end ?? now))
          const colour = tool.status === "error" ? INK.bad : PORT_COLOR[call.port]
          if (open) {
            c.strokeStyle = colour
            c.lineWidth = 1.5
            c.strokeRect(Math.round(from) + 0.5, barY + 0.5, Math.max(u(3), Math.round(to - from)), barH - 1)
          } else {
            c.fillStyle = rgba(colour, (tool.status === "error" ? 1 : 0.85) * fade)
            c.fillRect(Math.round(from), barY, Math.max(u(3), Math.round(to - from)), barH)
          }
          this.hit("tool", tool.id, { x: Math.round(from) - u(3), y: barY - u(4), w: Math.max(u(9), Math.round(to - from) + u(6)), h: barH + u(8) }, { sid: session.id, tool, step: call.step })
          this.reachLeaves.set(tool.id, { key: leaf.key, x: leafX - u(2), y: ly })
        }
        const right = live ? "running" : turn.live ? (age < 10e3 ? "now" : age < 60e3 ? `${Math.floor(age / 10e3) * 10}s` : agoOf(age)) : clockOf(leaf.last).slice(0, 5)
        this.text(c, right, x1, row.y, { size: 11.5, family: FAMILY.monoMedium, color: live ? INK.live : rgba(ink === INK.text ? INK.soft : ink, fade), align: "right" })

        // the way a call travels: off the wire, down the stems, out to the target
        const path = [[busX, firstY], [stem, firstY], [stem, gy], [inner, gy], [inner, ly], [leafX - u(2), ly]]
        flow.setPath(`reach:${leaf.key}`, path)
        flow.join(`reachback:${leaf.key}`, [`reach:${leaf.key}`], true)
        this.reachPaths.push(`reach:${leaf.key}`, `reachback:${leaf.key}`)
      }
    }

    if (hidden.length) {
      const oldest = hidden[0].last
      const text = `+ ${count(hidden.length, "more target")}, last touched ${turn.live ? `${agoOf(now - oldest)} ago or longer` : `by ${clockOf(oldest).slice(0, 5)}`}`
      this.text(c, text, groupX, y, { size: 11.5, color: INK.faint })
      this.note("reach-more", { x: groupX - u(4), y: y - u(16), w: tx0 - groupX, h: rowH }, "REACH · NOT SHOWN", count(hidden.length, "target"), [["WHY", "the rows that fit show the targets touched most recently; these were touched longer ago"], ["WHICH", hidden.slice(0, 14).map((leaf) => leaf.name).join(", ") + (hidden.length > 14 ? ` and ${hidden.length - 14} more` : "")]])
    }

    // A moment held on the terrain: REACH is drawn as of that moment (what the turn of then
    // had touched by then, a call that was out then still out), and the white line of the
    // moment stands where the cyan line of now would (paint draws it at full strength).
    const held = scene.then ?? null
    if (held !== null) {
      if (held >= turn.start && held <= turn.start + span) this.heldLines.push({ x: Math.round(xOf(held)), y0: axisY - u(6), y1: bottom })
    } else if (turn.live) {
      // now: the cyan line through every row
      const second = Math.floor(now / 1000) * 1000
      const x = Math.round(xOf(second))
      this.line(c, x, axisY - u(6), x, bottom, rgba(INK.live, 0.7), 1)
    }
  },

  // What a call of the focused thread does here: its packet leaves the wire for its target when
  // it starts and the result comes back when it ends; a failure flashes red at the target.
  reachReact(scene, signal, now, packet) {
    if (signal.sid !== scene.focus.id || !signal.tool) return
    const at = this.reachLeaves?.get(signal.tool.id)
    if (!at) return
    const u = (value) => this.u(value)
    const flow = this.flow
    const tone = signal.failed ? INK.bad : spriteHex(PORT_COLOR[signal.port])
    if (signal.type === "tool-start") flow.pulse({ path: `reach:${at.key}`, kind: `${packet}|${tone}`, tailKind: `tail|${tone}`, tail: 4, speed: u(900), delay: 60, flash: tone, now })
    else {
      flow.pulse({ path: `reachback:${at.key}`, kind: `${packet}|${tone}`, tailKind: `tail|${tone}`, tail: 4, speed: u(900), delay: 60, now })
      flow.flash(at.x, at.y, tone, now, signal.failed ? 700 : 360)
    }
  },

  // Motes along the branch of every call that is still out.
  reachStreams(scene, streams) {
    const session = scene.focused?.session
    if (!session || !this.reachLeaves?.size) return
    for (const tool of session.phase.tools) {
      const at = this.reachLeaves.get(tool.id)
      if (at) streams.push({ key: `reach:${tool.id}`, path: `reach:${at.key}`, kind: `tail|${spriteHex(PORT_COLOR[portOf(tool.name)])}`, speed: this.u(64), gap: this.u(30) })
    }
  },
}
