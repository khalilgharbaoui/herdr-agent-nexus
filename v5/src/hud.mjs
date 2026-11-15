// The head-up parts: the header with the phase, the footer (comms, sector map, log, key hints),
// and the two overlays (the inspection card and the help sheet).

import { cacheState, leftWord, lifeWord } from "./cache.mjs"
import { explain } from "./explain.mjs"
import { CHARGE_SOCKETS, FLOCK_CAP, KIND_WORD, LEVELS, ORBIT_CAP } from "./flock.mjs"
import { portOf } from "./model.mjs"
import { LEVEL_COLOR, LOG_USUAL_AT, PANEL, PORT_COLOR, bare, clean, homed, shortWords, wrap } from "./theme.mjs"
import { FAMILY, INK, agoOf, clamp, clockOf, compactOf, dayOf, hourMinuteOf, modelColor, moneyOf, shortModel, spanOf, timerOf } from "./util.mjs"

export const KEYMAP = [
  ["j  k  ↑  ↓", "move the focus through the threads"],
  ["←  →  h  l", "fold or open a subtree; step out or in"],
  ["1 … 9", "focus thread 01 to 09"],
  ["g  G", "first thread, last thread"],
  ["enter", "go to the focused thread's pane in herdr"],
  ["tab  shift+tab", "next or previous thing that needs you"],
  ["c", "answer the oldest call: go to its pane"],
  ["x", "mute or unmute the focused thread's flags"],
  ["space", "pin or unpin the focused thread's card"],
  ["a", "follow the action again"],
  ["f", "list: active, all open, needs you"],
  ["z", "zoom the focus stage"],
  ["w", "time terrain: last 1, 5 or 30 minutes"],
  ["e", "explain: label what every kind of mark means, in place"],
  ["[  ]", "walk every inspectable mark of a region, one by one"],
  ["{  }", "walk: previous or next region"],
  ["pgup  pgdn", "scroll the live tail"],
  ["i", "input monitor: last event, what it hit"],
  ["d", "live data or the simulation"],
  ["p", "moving layer: sprites or painted tiles"],
  ["s", "save a snapshot to v5/shots"],
  ["?  esc", "this sheet, and closing things"],
  ["q", "quit"],
]
export const MOUSEMAP = [
  ["hover", "brackets what is under the pointer and opens its inspection card"],
  ["click a thread", "focus it; click the folded ring or the caret to open or fold it"],
  ["click a pane id", "go to that pane in herdr (also middle click on a thread)"],
  ["click a project", "fold or open it"],
  ["click equipment, a rail, a mark", "pin its card; click it again or press esc to let go"],
  ["hover or click a dot of the flock", "which output it is, when, how many tokens; the flock slows under the pointer"],
  ["click a ridge of the terrain", "focus that thread; on the focused ridge, pin the point"],
  ["click a blip on the map", "focus its thread; middle click goes to the pane"],
  ["click a call or a flag", "focus that thread; ANSWER goes to its pane"],
  ["click a key hint", "does what the key does"],
  ["wheel", "scrolls the threads, or the live tail when over it"],
]
const HINTS = [["?", "help"], ["j k", "move"], ["← →", "fold"], ["enter", "go to pane"], ["tab", "next flag"], ["c", "answer"], ["x", "mute"], ["space", "pin"], ["f", "filter"], ["a", "follow"], ["z", "zoom"], ["w", "window"], ["e", "explain"], ["[ ]", "walk"], ["i", "input"], ["d", "demo"], ["q", "quit"]]
const HINT_KEY = { "?": "?", "j k": "j", "← →": "right", enter: "enter", tab: "tab", c: "c", x: "x", space: "space", f: "f", a: "a", z: "z", w: "w", e: "e", "[ ]": "]", i: "i", d: "d", q: "q" }

export const hud = {
  // ---------------------------------------------------------------- header

  signHeader(scene, ui, now, meta) {
    const world = scene.world
    const phase = scene.phase
    const first = scene.alerts.find((alert) => !alert.muted)
    return [Math.floor(now / 1000), world?.mode, phase.level, phase.alerts, phase.cautions, phase.notices, phase.cooling ? Math.ceil((phase.coolUntil - now) / 1000) : "", first?.key, first?.text, scene.counts.working, scene.counts.waiting, scene.counts.panes, scene.counts.stalled, Math.round(world?.cost24h?.cost ?? 0), Math.round((scene.outPerMinute ?? 0) / 50), meta?.line].join("|")
  },

  drawHeader(c, scene, ui, now, meta) {
    const { M } = this.G
    const u = (value) => this.u(value)
    const W = this.W
    const demo = scene.world?.mode === "DEMO"
    let x = this.run(c, M, u(50), [
      ["AGENT NEXUS", { size: 22, family: FAMILY.label, weight: "600", color: INK.text, spacing: 7 }],
      ["  5", { size: 22, family: FAMILY.label, weight: "600", color: INK.dim, spacing: 2 }],
    ])
    x += u(24)
    this.dot(c, x + u(4), u(43), u(4), demo ? INK.warn : INK.live)
    this.label(c, demo ? "DEMO  ·  SIMULATED DATA" : "LIVE", x + u(16), u(48.5), demo ? INK.warn : INK.live, "left", 13)
    this.note("mode", { x: M, y: u(26), w: x + u(demo ? 250 : 70) - M, h: u(34) }, "SOURCE", demo ? "DEMO: simulated data" : "LIVE: this machine, now", demo
      ? [["WHAT", "threads, calls and accounts are made up by this program, to show every mark at work. Nothing here is real."], ["KEY", "d switches to live data"]]
      : [["THREADS", "opencode's own database: every session and subagent of the last 24 hours, read four times a second"], ["ACCOUNTS", "the Claude Code plugin's state files: usage windows, turn history, which model a thread really runs as"], ["PANES", "herdr, every 2.5 s: which pane holds which thread, and its state"], ["WRITES", "nothing outside its own folder: every source is read-only"], ["KEY", "d switches to simulated data"]], demo ? INK.warn : INK.live)
    const clock = clockOf(now)
    this.text(c, clock, W - M, u(56), { size: 38, family: FAMILY.monoLight, color: INK.text, align: "right" })
    const clockWidth = this.width(c, clock, { size: 38, family: FAMILY.monoLight })
    this.label(c, dayOf(now), W - M - clockWidth - u(20), u(54), INK.dim, "right", 13)
    this.note("clock-now", { x: W - M - clockWidth - u(120), y: u(22), w: clockWidth + u(120), h: u(42) }, "NOW", `${dayOf(now)}  ${clock}`, [["WHAT", "this machine's clock. Every \"ago\", every countdown and the right edge of every time axis on screen is measured against it."], ["READ", "four times a second with the threads; the moving layer runs at up to 30 frames a second"]])

    // the phase: three lamps, one lit. Alert while something needs you, caution while it cools.
    const phase = scene.phase
    const lampY = u(72)
    const lampH = u(34)
    const lampW = u(140)
    x = M
    this.lamp = null
    for (const [id, name] of [["normal", "NORMAL"], ["caution", "CAUTION"], ["alert", "ALERT"]]) {
      const tone = LEVEL_COLOR[id]
      const lit = phase.level === id
      const style = { size: 14, family: FAMILY.label, weight: "600", spacing: 3.4, align: "center" }
      if (lit && id === "normal") {
        c.fillStyle = "rgba(79,227,255,0.07)"
        c.fillRect(x, lampY, lampW, lampH)
        c.strokeStyle = tone
        c.lineWidth = 1.5
        c.strokeRect(x + 0.75, lampY + 0.75, lampW - 1.5, lampH - 1.5)
        this.dot(c, x + u(18), lampY + lampH / 2, u(3.5), tone)
        this.lamp = { x: x + u(18), y: lampY + lampH / 2 }
        this.text(c, name, x + lampW / 2 + u(8), lampY + u(23), { ...style, color: tone })
      } else if (lit) {
        c.fillStyle = tone
        c.fillRect(x, lampY, lampW, lampH)
        this.text(c, name, x + lampW / 2 + u(2), lampY + u(23), { ...style, color: PANEL })
      } else {
        c.strokeStyle = INK.ghost
        c.lineWidth = 1
        c.strokeRect(x + 0.5, lampY + 0.5, lampW - 1, lampH - 1)
        this.text(c, name, x + lampW / 2 + u(2), lampY + u(23), { ...style, color: INK.faint })
      }
      if (id === "caution" && phase.cooling) {
        // the cool down after an alert: the bar drains, then the phase drops to normal
        const share = clamp((phase.coolUntil - now) / 90e3, 0, 1)
        c.fillStyle = INK.warn
        c.fillRect(x, lampY + lampH + u(4), Math.round(lampW * share), u(3))
      }
      x += lampW + u(8)
    }
    this.hit("action", "next-flag", { x: M, y: lampY, w: x - M, h: lampH }, { tip: "click to focus the next thing that needs you" })
    const live = scene.alerts.filter((alert) => !alert.muted)
    const say = (alert) => {
      if (!alert) return ""
      const row = alert.sid ? scene.rowOf.get(alert.sid) : null
      return alert.sid ? `${row ? `${String(row.index + 1).padStart(2, "0")} ` : ""}${clean(alert.title).slice(0, 34)} ${alert.text}` : `${alert.text}${alert.detail ? `  ·  ${alert.detail}` : ""}`
    }
    let headline
    let tone = INK.live
    let detail = ""
    if (phase.level === "alert") {
      headline = `${phase.alerts} NEED${phase.alerts === 1 ? "S" : ""} YOU`
      tone = INK.bad
      detail = say(live.find((alert) => alert.level === "alert"))
    } else if (phase.level === "caution") {
      tone = INK.warn
      headline = phase.cooling ? `COOLING DOWN  ${timerOf(phase.coolUntil - now)}` : `${phase.cautions} TO WATCH`
      detail = phase.cooling ? "the alert cleared" : say(live.find((alert) => alert.level === "caution"))
    } else {
      headline = scene.counts.working ? `${scene.counts.working} WORKING` : "ALL QUIET"
      detail = phase.notices ? `${phase.notices} notice${phase.notices === 1 ? "" : "s"}: ${say(live.find((alert) => alert.level === "notice"))}` : "nothing needs you"
    }
    const mx = this.run(c, x + u(14), lampY + u(23), [[headline, { size: 15, family: FAMILY.label, weight: "600", color: tone, spacing: 2.8 }]]) + u(18)
    const detailStyle = { size: 14.5, color: phase.level === "normal" ? INK.dim : INK.text }
    this.text(c, this.fit(c, detail, W - M - mx, detailStyle), mx, lampY + u(23), detailStyle)
    // the headline and the flag it names: the flag itself when there is one, so a click goes to its thread
    const named = phase.level === "normal" ? live.find((alert) => alert.level === "notice") : phase.cooling ? null : live.find((alert) => alert.level === phase.level)
    const headRect = { x: x + u(8), y: lampY, w: W - M - x - u(8), h: lampH }
    if (named) this.hit("alert", named.key, headRect, { alert: named, sid: named.sid })
    else this.note("phase-line", headRect, "PHASE", headline, [["NOW", detail || "nothing needs you"], ["NORMAL", "no flag that needs you or wants watching"], ["CAUTION", "a flag to watch (amber), or the 90 s after an alert cleared: the bar under the lamp drains"], ["ALERT", "a thread waits on you, or failed: the count is how many"]], tone)


    // one line of counts
    const counts = scene.counts
    const number = (value, color = INK.text) => [String(value), { size: 15, family: FAMILY.monoMedium, color }]
    const word = (value) => [value, { size: 14, color: INK.dim }]
    // each count is a target of its own: what is counted, exactly
    const tally = [
      ["working", number(counts.working, counts.working ? INK.live : INK.soft), " working", "threads with a turn running now: thinking, writing, calling the model or running a tool"],
      ["calls", number(counts.waiting, counts.waiting ? INK.warn : INK.soft), ` call${counts.waiting === 1 ? "" : "s"}`, "threads that wait on you: a question, a permission, a form. Each is a call in COMMS"],
    ]
    if (counts.stalled) tally.push(["silent", number(counts.stalled), " silent", "threads with a turn running that have written nothing for longer than such a step usually takes"])
    tally.push(["listed", number(counts.threads), " listed", "threads in the circuit: every session and subagent of the last 24 hours that is not archived, folded ones included"])
    tally.push(["panes", number(counts.panes), " panes", "herdr panes on this machine, with or without an agent in them: the sector map shows each"])
    tally.push(["cost", number(moneyOf(scene.world?.cost24h?.cost ?? 0)), " in 24 h", `what opencode recorded as cost over the last 24 hours, in ${scene.world?.cost24h?.sessions ?? 0} sessions. On a subscription this is the list price of the tokens, not a bill`])
    tally.push(["rate", number(compactOf(scene.outPerMinute ?? 0)), " tok out/min", "output tokens of every listed thread over the last minute, counted when a model call reports"])
    let tx = M
    for (const [id, figure, name, what] of tally) {
      const end = this.run(c, tx, u(134), [figure, word(name)])
      this.note(`count-${id}`, { x: tx - u(3), y: u(116), w: end - tx + u(6), h: u(26) }, "COUNT", `${figure[0]}${name}`, [["COUNTS", what]])
      tx = end + this.width(c, "    ", { size: 14 })
    }
    if (meta?.line) {
      this.text(c, meta.line, W - M, u(134), { size: 12.5, color: INK.dim, align: "right" })
      const metaWidth = this.width(c, meta.line, { size: 12.5 })
      this.note("meta", { x: W - M - metaWidth - u(4), y: u(116), w: metaWidth + u(8), h: u(26) }, "THIS PROGRAM", meta.line, [["SIZE", "the pane in pixels, drawn at the terminal's own resolution"], ["FPS", "times a second the picture is brought up to date: 30 while anything moves, 10 when all is still"], ["SPRITES", "moving marks placed this frame, and whether the terminal still holds their images (it is asked every 2 s)"], ["KB/S", "what is written to the terminal"], ["CPU", "this program's share of one core, the encoder included"], ["MORE", "v5/stats.json, rewritten every 2 s"]])
    }
    this.line(c, M, u(146), W - M, u(146), INK.ghost)
  },

  // ---------------------------------------------------------------- footer

  // The footer in four parts, each repainted for its own reasons: comms, the sector map, the
  // log and the strip of key hints.
  footerCols() {
    const G = this.G
    const u = (value) => this.u(value)
    const F = G.footer
    const M = G.M
    const gap = u(34)
    const inner = F.w - 2 * M - 2 * gap
    const widths = [Math.round(inner * 0.34), Math.round(inner * 0.36), 0]
    widths[2] = inner - widths[0] - widths[1]
    const x1 = F.x + M
    const x2 = x1 + widths[0] + gap
    const x3 = x2 + widths[1] + gap
    const half = Math.round(gap / 2)
    const hintsH = u(40)
    const bodyH = F.h - hintsH
    return {
      F, M, widths, x1, x2, x3, top: F.y + u(34), h: F.h - u(84),
      comms: { x: F.x, y: F.y, w: x2 - half - F.x, h: bodyH },
      map: { x: x2 - half, y: F.y, w: x3 - x2, h: bodyH },
      log: { x: x3 - half, y: F.y, w: F.x + F.w - (x3 - half), h: bodyH },
      hints: { x: F.x, y: F.y + bodyH, w: F.w, h: hintsH },
    }
  },

  signComms(scene, now) {
    const parts = [Math.floor(now / (scene.calls.length ? 1000 : 10e3))]
    for (const alert of scene.alerts) parts.push(alert.key, alert.level, alert.muted, alert.text)
    return parts.join("|")
  },

  signMap(scene) {
    const parts = [scene.focus.id, scene.world?.self]
    for (const pane of scene.world?.panes ?? []) parts.push(`${pane.id}${pane.status[0]}${pane.row}${pane.focused ? "f" : ""}`)
    return parts.join("|")
  },

  // A running call counts in whole seconds; otherwise a line only changes when it hazes over.
  signLog(scene, ui, now) {
    if (ui.monitor) return `monitor|${ui.stamp}`
    const cols = this.footerCols()
    const shown = scene.log.slice(0, Math.floor(cols.h / this.u(25)))
    const running = shown.some((entry) => entry.span === null && entry.tone === "run")
    const parts = [Math.floor(now / (running ? 1000 : 5000)), scene.log.length]
    for (const entry of shown) parts.push(entry.key, entry.span, entry.tone, scene.rowOf?.get(entry.sid)?.index)
    return parts.join("|")
  },

  footerLine(c) {
    const { F, M } = this.footerCols()
    this.line(c, F.x + M, F.y, F.x + F.w - M, F.y, INK.ghost)
  },

  drawCommsRegion(c, scene, now) {
    const cols = this.footerCols()
    this.footerLine(c)
    this.drawComms(c, scene, now, cols.x1, cols.top, cols.widths[0], cols.h)
  },

  drawMapRegion(c, scene) {
    const cols = this.footerCols()
    this.footerLine(c)
    this.drawMap(c, scene, cols.x2, cols.top, cols.widths[1], cols.h)
  },

  drawLogRegion(c, scene, ui, now) {
    const cols = this.footerCols()
    this.footerLine(c)
    if (ui.monitor) {
      this.logMarks = []
      this.drawMonitor(c, ui, cols.x3, cols.top, cols.widths[2])
    } else this.drawLog(c, scene, now, cols.x3, cols.top, cols.widths[2], cols.h)
  },

  // the key hints: every one is also a button
  drawHints(c, ui) {
    const { F, M } = this.footerCols()
    const u = (value) => this.u(value)
    const y = F.y + F.h - u(18)
    let x = F.x + M
    for (const [key, name] of HINTS) {
      const start = x
      x = this.run(c, x, y, [[key, { size: 12, family: FAMILY.monoMedium, color: INK.soft }], [` ${name}`, { size: 12, color: INK.faint }]])
      this.hit("key", HINT_KEY[key], { x: start - u(4), y: y - u(15), w: x - start + u(8), h: u(22) }, { tip: `${name} (${key})` })
      x += u(20)
    }
    if (ui.tip) this.text(c, this.fit(c, ui.tip, F.x + F.w - M - x - u(10), { size: 12 }), F.x + F.w - M, y, { size: 12, color: INK.live, align: "right" })
  },

  // Left column. A thread that needs the operator rings here as a call: which pane it is on, how
  // long it has waited, what it asked, and the way to answer. Under it, everything else flagged.
  // Every line knows where its marker stands (commsMarks), so the moving layer can answer on it:
  // a flag that is raised ripples here last, after its thread and the phase lamp.
  drawComms(c, scene, now, x, top, w, h) {
    const u = (value) => this.u(value)
    const calls = scene.calls.filter((alert) => !alert.muted)
    const others = scene.alerts.filter((alert) => !calls.includes(alert))
    this.codec = null
    this.commsMarks = new Map()
    let y = top
    this.run(c, x, y, [
      ["COMMS", { size: 12.5, family: FAMILY.label, weight: "600", color: calls.length ? INK.warn : INK.dim, spacing: 2.6 }],
      [calls.length ? `   ${calls.length} call${calls.length === 1 ? "" : "s"}` : "   no calls", { size: 13, color: calls.length ? INK.warn : INK.faint }],
    ])
    y += u(16)
    if (calls.length) {
      const call = calls[0]
      const session = scene.byId.get(call.sid)
      const row = scene.rowOf.get(call.sid)
      const pane = session?.pane || scene.byId.get(session?.rootId)?.pane || ""
      const box = { x, y, w, h: u(150) }
      c.fillStyle = "rgba(255,178,36,0.06)"
      c.fillRect(box.x, box.y, box.w, box.h)
      this.brackets(c, box, INK.warn, 12, 2)
      // the channel: the pane the call is on
      this.label(c, "CHANNEL", box.x + u(18), box.y + u(30), INK.warn, "left", 11)
      this.text(c, pane || "no pane", box.x + u(18), box.y + u(78), { size: 44, family: FAMILY.display, color: INK.warn })
      this.text(c, `waiting ${agoOf(now - call.since)}`, box.x + u(18), box.y + u(102), { size: 13, color: INK.soft })
      this.codec = { x: box.x + u(24), y: box.y + box.h - u(14) }
      this.commsMarks.set(call.key, { x: box.x + u(6), y: box.y + u(6), level: call.level, call: true })
      // who is calling, and what it asked
      const tx = box.x + u(200)
      const tw = box.w - u(200) - u(16)
      const titleStyle = { size: 20, family: FAMILY.label, weight: "600", color: INK.text }
      this.text(c, this.fitWords(c, `${row ? `${String(row.index + 1).padStart(2, "0")}  ` : ""}${call.title}`, tw, titleStyle), tx, box.y + u(34), titleStyle)
      const charW = this.width(c, "M", { size: 13.5 })
      const asked = wrap(call.detail || "it asked you something", Math.max(12, Math.floor(tw / charW)))
      asked.slice(-3).forEach((line, index) => this.text(c, line, tx, box.y + u(60) + index * u(21), { size: 13.5, color: INK.soft }))
      const bw = this.chip(c, pane ? "ENTER  ANSWER IN PANE" : "ENTER  FOCUS", tx, box.y + box.h - u(16), { color: INK.warn, solid: true })
      this.hit("answer", call.sid, { x: tx, y: box.y + box.h - u(32), w: bw, h: u(22) }, { tip: pane ? `click to go to pane ${pane} and answer` : "click to focus this thread" })
      this.hit("alert", call.key, box, { alert: call, sid: call.sid })
      if (calls.length > 1) this.text(c, `+${calls.length - 1} more`, tx + bw + u(14), box.y + box.h - u(16), { size: 12.5, color: INK.warn })
      y += box.h + u(12)
    } else y += u(10)
    // everything else that is flagged
    const lineH = u(25)
    const room = Math.floor((top + h - y) / lineH)
    if (!others.length && !calls.length) this.text(c, "nothing is flagged", x, y + u(16), { size: 14, color: INK.faint })
    others.slice(0, Math.max(0, room)).forEach((alert, index) => {
      const lineY = y + (index + 1) * lineH - u(6)
      const tone = alert.muted ? INK.faint : alert.level === "alert" ? INK.bad : alert.level === "caution" ? INK.warn : INK.dim
      if (alert.level === "alert") {
        c.fillStyle = tone
        c.fillRect(x, lineY - u(10), u(9), u(9))
      } else {
        c.strokeStyle = tone
        c.lineWidth = 1.5
        c.strokeRect(x + 1, lineY - u(9), u(7), u(7))
      }
      this.commsMarks.set(alert.key, { x: x + u(4.5), y: lineY - u(5.5), level: alert.level, muted: alert.muted })
      const row = alert.sid ? scene.rowOf.get(alert.sid) : null
      const lead = alert.sid ? `${row ? String(row.index + 1).padStart(2, "0") : "··"}  ` : "    "
      this.text(c, lead, x + u(18), lineY, { size: 13, color: INK.faint })
      const leadW = this.width(c, lead, { size: 13 })
      const since = alert.muted ? "muted" : alert.kind === "context" || alert.kind === "account" ? "" : agoOf(now - alert.since)
      const sinceW = since ? this.width(c, since, { size: 12.5 }) + u(12) : 0
      const style = { size: 13.5, color: alert.muted ? INK.faint : alert.level === "notice" ? INK.soft : INK.text }
      // a line never stops inside a word; its card says it in full
      const body = alert.sid ? `${shortWords(alert.title, 26)}: ${alert.text}` : `${alert.text}${alert.detail ? `, ${alert.detail}` : ""}`
      this.text(c, this.fitWords(c, body, w - u(18) - leadW - sinceW, style), x + u(18) + leadW, lineY, style)
      if (since) this.text(c, since, x + w, lineY, { size: 12.5, color: INK.dim, align: "right" })
      this.hit("alert", alert.key, { x, y: lineY - u(18), w, h: lineH }, { alert, sid: alert.sid })
    })
    if (others.length > room && room > 0) this.text(c, `+${others.length - room} more`, x + w, top, { size: 12, color: INK.dim, align: "right" })
  },

  // Middle column: every herdr pane as a blip, grouped by workspace (the sector) and tab.
  drawMap(c, scene, x, top, w, h) {
    const u = (value) => this.u(value)
    const world = scene.world
    const panes = world?.panes ?? []
    this.run(c, x, top, [
      ["SECTOR MAP", { size: 12.5, family: FAMILY.label, weight: "600", color: INK.dim, spacing: 2.6 }],
      [`   ${panes.length} panes`, { size: 13, color: INK.soft }],
    ])
    // legend
    let lx = x + w
    for (const [name, tone, solid] of [["unread", INK.good, false], ["call", INK.warn, true], ["working", INK.live, true]]) {
      const tw = this.width(c, name, { size: 11.5 })
      this.text(c, name, lx - tw, top, { size: 11.5, color: INK.faint })
      lx -= tw + u(16)
      if (solid) {
        c.fillStyle = tone
        c.fillRect(lx, top - u(9), u(9), u(9))
      } else {
        c.strokeStyle = tone
        c.lineWidth = 1
        c.strokeRect(lx + 0.5, top - u(8.5), u(8), u(8))
      }
      lx -= u(14)
    }
    const side = u(14)
    const pad = u(5)
    const lineH = side + pad * 2 + u(8)
    const labelW = Math.min(u(170), Math.round(w * 0.3))
    const byTab = new Map()
    for (const pane of panes) {
      const key = pane.tab || `${pane.workspace}:?`
      byTab.set(key, [...(byTab.get(key) ?? []), pane])
    }
    const workspaces = (world?.workspaces?.length ? [...world.workspaces].sort((a, b) => a.number - b.number) : [...new Set(panes.map((pane) => pane.workspace))].map((id) => ({ id, label: id, mark: "" })))
    let y = top + u(18)
    for (const workspace of workspaces) {
      if (y + lineH > top + h + u(6)) break
      const tabs = [...byTab.entries()].filter(([, list]) => list[0].workspace === workspace.id)
      if (!tabs.length) continue
      const base = y + pad + side - u(2)
      if (workspace.mark) {
        c.fillStyle = workspace.mark
        c.fillRect(x, base - u(9), u(4), u(11))
      }
      const style = { size: 12.5, color: workspace.focused ? INK.text : INK.soft }
      this.text(c, this.fit(c, workspace.label || workspace.id, labelW - u(16), style), x + u(11), base, style)
      let tx = x + labelW
      for (const [tabId, list] of tabs) {
        const cellW = list.length * (side + u(4)) - u(4) + pad * 2
        if (tx + cellW > x + w) {
          tx = x + labelW
          y += lineH
          if (y + lineH > top + h + u(6)) break
        }
        const tab = scene.tabOf.get(tabId)
        const active = workspace.activeTab === tabId
        c.strokeStyle = active && workspace.focused ? INK.soft : active ? INK.faint : INK.ghost
        c.lineWidth = 1
        c.strokeRect(tx + 0.5, y + 0.5, cellW - 1, side + pad * 2 - 1)
        this.hit("tab", tabId, { x: tx, y, w: cellW, h: side + pad * 2 }, { label: tab?.label ?? "", workspace: workspace.label })
        list.forEach((pane, index) => {
          const px = tx + pad + index * (side + u(4))
          const py = y + pad
          if (pane.status === "working" || pane.status === "blocked") {
            c.fillStyle = pane.status === "working" ? INK.live : INK.warn
            c.fillRect(px, py, side, side)
          } else if (pane.status === "shell") {
            this.dot(c, px + side / 2, py + side / 2, u(1.6), INK.faint)
          } else {
            c.strokeStyle = pane.status === "done" ? INK.good : pane.row >= 0 ? INK.dim : INK.faint
            c.lineWidth = 1
            c.strokeRect(px + 0.5, py + 0.5, side - 1, side - 1)
            if (pane.status === "done") this.dot(c, px + side / 2, py + side / 2, u(2.2), INK.good)
          }
          if (pane.sessionId && pane.sessionId === scene.focus.id) {
            c.strokeStyle = INK.text
            c.lineWidth = 1
            c.strokeRect(px - 2.5, py - 2.5, side + 4, side + 4)
          }
          if (pane.id === world.self) {
            // this pane: you are here
            this.line(c, px + side / 2, py - u(3), px + side / 2, py + side + u(3), INK.live)
            this.line(c, px - u(3), py + side / 2, px + side + u(3), py + side / 2, INK.live)
          }
          this.hit("blip", pane.id, { x: px - u(2), y: py - u(2), w: side + u(4), h: side + u(4) }, { pane })
        })
        tx += cellW + u(6)
      }
      y += lineH
    }
  },

  // Right column: the last things that happened, anywhere. What is new is bright and hazes
  // over as it ages. A tool call that still runs counts its seconds, and under its line runs a
  // track: the tick stands at that equipment's usual time, the moving layer runs a head along
  // it (logMarks says where). Every line is a target: its card is the call's own.
  drawLog(c, scene, now, x, top, w, h) {
    const u = (value) => this.u(value)
    this.label(c, "LOG", x, top)
    const lineH = u(25)
    const marks = []
    scene.log.slice(0, Math.floor(h / lineH)).forEach((entry, index) => {
      const lineY = top + (index + 1) * lineH + u(2)
      const row = scene.rowOf?.get(entry.sid)
      const running = entry.span === null && entry.tone === "run"
      const age = now - entry.at
      const tone = entry.tone === "bad" ? INK.bad : entry.tone === "warn" ? INK.warn : entry.tone === "ok" ? INK.good : entry.tone === "run" ? INK.live : INK.soft
      const lead = `${clockOf(entry.at)}  ${row ? String(row.index + 1).padStart(2, "0") : "··"}  `
      this.text(c, lead, x, lineY, { size: 13, color: INK.faint })
      const leadW = this.width(c, lead, { size: 13 })
      const name = `${bare(entry.name)}  `
      this.text(c, name, x + leadW, lineY, { size: 13, family: FAMILY.monoMedium, color: tone })
      const nameW = this.width(c, name, { size: 13, family: FAMILY.monoMedium })
      const span = running ? spanOf(Math.max(1000, Math.floor(age / 1000) * 1000)) : entry.span === null ? "" : spanOf(entry.span)
      const spanW = span ? this.width(c, span, { size: 13 }) + u(12) : 0
      const style = { size: 13, color: running || age < 20e3 ? INK.soft : age < 300e3 ? INK.dim : INK.faint }
      const tx = x + leadW + nameW
      this.text(c, this.fitWords(c, clean(entry.detail), w - leadW - nameW - spanW, style), tx, lineY, style)
      if (span) this.text(c, span, x + w, lineY, { size: 13, color: running ? INK.live : INK.dim, align: "right" })
      let track = null
      const usual = running && entry.port ? (scene.ports.get(entry.port)?.p50 ?? 0) : 0
      if (usual > 0 && x + w - spanW - tx > u(80)) {
        track = { x0: tx, x1: x + w - spanW, y: lineY + u(6), usual }
        this.line(c, track.x0, track.y, track.x1, track.y, INK.ghost)
        const tick = Math.round(track.x0 + (track.x1 - track.x0) * LOG_USUAL_AT)
        this.line(c, tick, track.y - u(3), tick, track.y + u(3), INK.dim)
      }
      marks.push({ key: entry.key, sid: entry.sid, x: x + leadW + u(4), y: lineY - u(5), x1: x + w, tone, start: entry.at, track })
      this.hit("log", entry.key, { x, y: lineY - u(18), w, h: lineH }, { entry, sid: entry.sid })
    })
    this.logMarks = marks
    if (!scene.log.length) this.text(c, "nothing has happened since this started", x, top + lineH, { size: 13, color: INK.faint })
  },

  // The input monitor, in place of the log: what the terminal last sent and what it landed on.
  drawMonitor(c, ui, x, top, w) {
    const u = (value) => this.u(value)
    this.label(c, "INPUT MONITOR", x, top, INK.live)
    this.text(c, "i closes", x + w, top, { size: 11.5, color: INK.faint, align: "right" })
    const info = ui.info ?? {}
    const lines = [
      ["modes", info.modes ?? "not asked"],
      ["key", info.key ?? "none yet"],
      ["mouse", info.mouse ?? "none yet"],
      ["at", info.at ?? "n/a"],
      ["hit", info.hit ?? "nothing"],
      ["did", info.did ?? "n/a"],
      ["seen", info.seen ?? "n/a"],
    ]
    lines.forEach(([name, value], index) => {
      const y = top + (index + 1) * u(25) + u(2)
      this.text(c, name, x, y, { size: 12.5, color: INK.dim })
      const style = { size: 13, color: INK.text }
      this.text(c, this.fit(c, String(value), w - u(64), style), x + u(64), y, style)
    })
  },

  // ---------------------------------------------------------------- overlays

  // The opaque panels that sit over the ground this frame: the inspection card and the help sheet.
  overlaysFor(scene, ui, now) {
    const u = (value) => this.u(value)
    const list = []
    // (the inspection card is not one of these: it is its own image, see card.mjs)
    if (ui.explain && !ui.help) for (const tag of this.explainTags(scene, now)) list.push(tag)
    if (ui.help) {
      const w = Math.min(this.W - u(80), u(1180))
      const h = Math.min(this.H - u(120), u(96) + (KEYMAP.length + 3) * u(29))
      const rect = { x: Math.round((this.W - w) / 2), y: Math.round(Math.max(u(60), (this.H - h) / 2 - u(60))), w, h }
      list.push({ name: "over:help", rect, signature: "help", draw: (c) => this.drawHelp(c, rect) })
    }
    return list
  },


  drawCard(c, rect, content, pinned) {
    const u = (value) => this.u(value)
    const tone = content.tone ?? INK.live
    c.fillStyle = PANEL
    c.fillRect(rect.x, rect.y, rect.w, rect.h)
    c.strokeStyle = INK.faint
    c.lineWidth = 1
    c.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1)
    this.brackets(c, rect, tone, 12, 2)
    c.fillStyle = tone
    c.fillRect(rect.x, rect.y, u(4), u(52))
    const x = rect.x + u(20)
    this.label(c, content.kicker, x, rect.y + u(25), tone, "left", 11.5)
    if (pinned) {
      const w = this.chip(c, "PINNED  ·  ESC", rect.x + rect.w - u(14), rect.y + u(25), { color: INK.live, align: "right" })
      this.hit("action", "unpin", { x: rect.x + rect.w - u(14) - w, y: rect.y + u(8), w, h: u(24) }, { tip: "click to let go of this card" })
    } else if (content.pin) this.text(c, "click to pin", rect.x + rect.w - u(16), rect.y + u(25), { size: 11.5, color: INK.faint, align: "right" })
    const titleStyle = { size: 21, family: FAMILY.label, weight: "600", color: INK.text }
    this.text(c, this.fit(c, content.title, rect.w - u(40), titleStyle), x, rect.y + u(52), titleStyle)
    content.lines.forEach(([name, value, color], index) => {
      const y = rect.y + u(84) + index * u(25)
      this.text(c, name, x, y, { size: 11, family: FAMILY.label, weight: "600", color: INK.dim, spacing: 2 })
      const style = { size: 13.5, color: color ?? INK.text }
      this.text(c, this.fit(c, String(value), rect.w - u(150) - u(18), style), rect.x + u(150), y, style)
    })
    if (content.foot) this.text(c, this.fit(c, content.foot, rect.w - u(40), { size: 11.5 }), x, rect.y + rect.h - u(14), { size: 11.5, color: INK.faint })
  },

  drawHelp(c, rect) {
    const u = (value) => this.u(value)
    c.fillStyle = PANEL
    c.fillRect(rect.x, rect.y, rect.w, rect.h)
    c.strokeStyle = INK.faint
    c.lineWidth = 1
    c.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1)
    this.brackets(c, rect, INK.live, 16, 2)
    const x = rect.x + u(36)
    this.run(c, x, rect.y + u(50), [
      ["CONTROLS", { size: 20, family: FAMILY.label, weight: "600", color: INK.text, spacing: 6 }],
      ["     every key hint at the bottom of the screen is also a button", { size: 13.5, color: INK.dim }],
    ])
    this.text(c, "esc or ? closes", rect.x + rect.w - u(36), rect.y + u(50), { size: 13, color: INK.faint, align: "right" })
    const half = Math.round(rect.w * 0.5)
    const lineH = u(29)
    const rows = Math.floor((rect.h - u(120)) / lineH)
    this.label(c, "KEYS", x, rect.y + u(92), INK.live)
    KEYMAP.slice(0, rows).forEach(([key, what], index) => {
      const y = rect.y + u(92) + (index + 1) * lineH
      this.text(c, key, x, y, { size: 14, family: FAMILY.monoMedium, color: INK.text })
      const style = { size: 14, color: INK.soft }
      this.text(c, this.fit(c, what, half - u(230), style), x + u(180), y, style)
    })
    const mx = rect.x + half + u(20)
    this.label(c, "MOUSE", mx, rect.y + u(92), INK.live)
    MOUSEMAP.forEach(([key, what], index) => {
      const y = rect.y + u(92) + (index + 1) * lineH * 2 - lineH
      this.text(c, key, mx, y, { size: 14, family: FAMILY.monoMedium, color: INK.text })
      const style = { size: 13.5, color: INK.soft }
      this.text(c, this.fit(c, what, rect.x + rect.w - u(36) - mx, style), mx, y + u(22), style)
    })
    this.hit("action", "close-help", rect)
  },

  // ---------------------------------------------------------------- inspection

  // The precise data behind whatever is under the pointer or pinned: a kicker, a title, lines of
  // name and value, a foot that says what a click does. Null when there is nothing to say.
  inspect(target, scene, now) {
    const index = (sid) => {
      const row = scene.rowOf.get(sid)
      return row ? String(row.index + 1).padStart(2, "0") : "··"
    }
    const threadOf = (sid) => {
      const session = scene.byId.get(sid)
      return session ? `${index(sid)}  ${clean(session.title)}` : "not listed"
    }
    if (target.kind === "thread" || target.kind === "fold" || target.kind === "clock") {
      const session = scene.byId.get(target.id)
      if (!session) return null
      const row = scene.rowOf.get(session.id)
      const pane = session.pane || scene.byId.get(session.rootId)?.pane || ""
      const { used, limit } = session.context
      const lines = []
      const state = session.state === "working" ? `working: ${session.phase.key === "tool" ? `running ${bare(session.phase.tools[0].name)}` : session.phase.key}` : session.state === "waiting" ? `waiting on you for ${agoOf(now - (session.idleSince || session.updated))}` : session.state === "stalled" ? `marked busy, silent ${agoOf(now - session.last)}` : `${session.state === "failed" ? "last turn failed" : "resting"} for ${agoOf(now - (session.idleSince || session.updated))}`
      lines.push(["STATE", state, session.state === "working" ? INK.live : session.state === "waiting" ? INK.warn : session.state === "failed" ? INK.bad : INK.soft])
      lines.push(["MODEL", `${session.model || "unknown"}${session.effort ? `  ·  ${session.effort}` : ""}`, modelColor(session.model, session.provider)])
      lines.push(["AGENT", `${session.agent || "main"}  ·  account ${session.account || "unknown"}`])
      lines.push(["PROJECT", homed(session.project) || "none"])
      lines.push(["HERDR", scene.whereOf(pane) || (session.parentId ? "no pane of its own" : "not open in a pane")])
      if (session.turn) lines.push(["TURN", `${timerOf(now - session.turn.start)}${session.expect ? `  ·  usually ${spanOf(session.expect.p50)} (${session.expect.n} turns)` : "  ·  no usual yet"}`])
      const out = session.turn?.out ?? session.lastOut ?? 0
      lines.push(["OUTPUT", `${out ? `${compactOf(out)} tok ${session.turn ? "this turn" : "last turn"}` : "not reported"}${session.tokens?.output ? `  ·  ${compactOf(session.tokens.output)} in all` : ""}`])
      lines.push(["CONTEXT", limit && used ? `${compactOf(used)} of ${compactOf(limit)} tok  (${Math.round((used / limit) * 100)}%)` : "not reported", limit && used / limit >= 0.8 ? INK.warn : undefined])
      if (session.tokens?.cacheRead) lines.push(["CACHE", `${compactOf(session.tokens.cacheRead)} read  ·  ${compactOf(session.tokens.cacheWrite)} written`])
      const heat = cacheState(session.cache, now)
      if (heat) lines.push(["CACHE LIFE", heat.cold ? `cold since ${clockOf(heat.coldAt)}` : `${session.cache.measured ? "" : "about "}${leftWord(heat.left)} left of ${session.cache.measured ? `${lifeWord(session.cache.lifetime)}, measured` : `an assumed ${lifeWord(session.cache.lifetime)}`}`, heat.cold ? INK.dim : heat.color])
      lines.push(["COST", session.cost ? moneyOf(session.cost) : session.parentId ? "not reported for subagents" : "not reported"])
      if (session.kids) lines.push(["SUBAGENTS", `${session.kids}${row?.closed ? "  (folded)" : ""}`])
      for (const alert of session.alerts) lines.push([alert.muted ? "MUTED" : "FLAG", `${alert.text}${alert.detail && alert.kind !== "call" ? `  ·  ${clean(alert.detail).slice(0, 60)}` : ""}`, alert.muted ? INK.faint : LEVEL_COLOR[alert.level]])
      lines.push(["SESSION", session.id, INK.dim])
      return { tone: modelColor(session.model, session.provider), kicker: `${session.parentId ? "SUBAGENT" : "THREAD"} ${index(session.id)}`, title: session.title, lines, pin: true, foot: `click: focus${pane ? "  ·  middle click: go to pane" : ""}  ·  space: pin` }
    }
    if (target.kind === "dot") {
      const flock = this.flock
      const meta = flock.sid === target.sid ? flock.meta[target.index] : null
      const session = scene.byId.get(target.sid)
      if (!meta || !session) return null
      const out = flock.squad[target.index] ? flock.squads.get(flock.squad[target.index]) : null
      const tone = meta.kind === "say" ? INK.text : meta.kind === "tool" && meta.tool ? PORT_COLOR[portOf(meta.tool.name)] : modelColor(session.model, session.provider)
      return {
        tone,
        kicker: "OUTPUT DOT",
        title: `dot ${target.index + 1} of ${flock.count}  ·  ${KIND_WORD[meta.kind]}`,
        lines: [
          ["THREAD", threadOf(target.sid)],
          meta.pending
            ? ["STANDS FOR", `about ${compactOf(flock.unit)} tok the open call has probably written: an estimate from the thread's last measured rate (${flock.callRate >= 10 ? Math.round(flock.callRate) : flock.callRate.toFixed(1)} tok/s), replaced when the call reports`, INK.soft]
            : ["STANDS FOR", `${compactOf(meta.to - meta.from)} tok: ${compactOf(meta.from)} to ${compactOf(meta.to)} of the turn's ${compactOf(flock.out)}`],
          ["PART", `${KIND_WORD[meta.kind]}${meta.tool ? ` for ${bare(meta.tool.name)}` : ""}`, tone],
          ["MODEL CALL", meta.seq === null ? "not known: the call has not reported yet" : `call ${meta.seq}`],
          ["WRITTEN", meta.seq === null ? "n/a" : `${clockOf(meta.at)}  ·  ${agoOf(now - meta.at)} ago`],
          ["ON THE GLOBE", `${Math.round(((target.index + 0.5) / Math.max(1, flock.count)) * 180 - 90)}° latitude: the south pole is the turn's first output, the north pole its newest`],
          ["DEPTH", `layer ${flock.level[target.index]} of ${LEVELS}: nearer is larger and brighter${flock.under[target.index] ? ", behind the rings" : ", in front of the rings"}`],
          ["DOING", out ? `out with ${bare(out.tool.name)}, in line behind its satellite` : flock.stage[target.index] === 1 ? (meta.pending ? "in orbit round the rings: its call is still open" : "in orbit round the rings: its call has reported, it goes into the globe next") : flock.stage[target.index] === 2 ? "spiralling from the orbit into the globe" : flock.formation, out ? PORT_COLOR[portOf(out.tool.name)] : flock.stage[target.index] === 3 ? undefined : INK.live],
        ],
        pin: true,
        foot: "the split inside a call is by the length of its reasoning, reply and tool input",
      }
    }
    if (target.kind === "cache") {
      const session = scene.byId.get(target.id)
      if (!session) return null
      const cache = session.cache
      const state = cacheState(cache, now)
      if (!state) return { tone: INK.soft, kicker: "PROMPT CACHE", title: threadOf(session.id), lines: [cache?.empty ? ["STATE", "nothing cached: this thread has made no model call yet"] : ["LIFETIME", "n/a: this thread's model is not served through Claude Code, so nothing this program reads says how long its cache lives", undefined, "wrap"]], pin: true, foot: "" }
      const lines = [["STATE", state.cold ? `cold since ${clockOf(state.coldAt)}, ${agoOf(now - state.coldAt)} ago` : `warm: ${cache.measured ? "" : "about "}${leftWord(state.left)} left`, state.cold ? INK.dim : state.color]]
      if (cache.measured) {
        lines.push(["LIFETIME", `${lifeWord(cache.lifetime)}, measured`])
        lines.push(["MEASURED FROM", `the thread's own Claude Code transcript: its newest call that wrote to the cache wrote ${compactOf(cache.hour)} tok under the 1 h lifetime and ${compactOf(cache.five)} under the 5 min one${cache.hour && cache.five ? "; the 5 min part goes cold first, so that is the lifetime shown" : ""}`, undefined, "wrap"])
        lines.push(["TRANSCRIPT", cache.how === "timing" ? `found by timing: ${cache.matched} of the thread's last ${cache.of} ${cache.by === "tools" ? "tool calls have a record in it at the moment they were made" : "blocks of thinking and reply end within a quarter of a second of a record in it"}` : "found by the plugin's own record of which Claude session answers this thread", undefined, "wrap"])
      } else {
        lines.push(["LIFETIME", `${lifeWord(cache.lifetime)}, ASSUMED, not measured`, INK.soft])
        lines.push(["WHY ASSUMED", `${cache.why}. One hour is what a Claude Code session on a subscription uses`, undefined, "wrap"])
      }
      lines.push(["LAST TOUCHED", `${clockOf(cache.at)}, ${agoOf(now - cache.at)} ago: its newest model call went out then`, undefined, "wrap"])
      lines.push(["GOES COLD", state.cold ? `went cold at ${clockOf(state.coldAt)}` : `at ${clockOf(state.coldAt)}, unless a call goes out first`, undefined, "wrap"])
      lines.push(["HOLDS", cache.measured ? `${compactOf(cache.read)} tok read back by the last call, ${compactOf(cache.wrote)} tok written by it` : cache.tokens ? `about ${compactOf(cache.tokens)} tok: the thread's context` : "not known", undefined, "wrap"])
      lines.push(["WHEN COLD", "the next call writes all of it again instead of reading it back: a write costs 1.25 times the input price for five minutes and twice for an hour, a read a tenth", INK.dim, "wrap"])
      return { tone: state.cold ? INK.dim : state.color, kicker: "PROMPT CACHE", title: threadOf(session.id), lines, pin: true, foot: "the arc round its cell body is the same cache" }
    }
    if (target.kind === "context") {
      const session = scene.byId.get(target.id)
      if (!session) return null
      const { used, limit } = session.context
      const pace = this.contextPace(session)
      const fill = limit && used ? used / limit : 0
      const tone = fill >= 0.92 ? INK.bad : fill >= 0.8 ? INK.warn : INK.soft
      const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`
      if (!pace) return { tone, kicker: "CONTEXT RING", title: threadOf(session.id), lines: [["CONTEXT", "not reported yet: the ring stays open and empty until a model call reports its context", undefined, "wrap"]], pin: true, foot: "" }
      const lines = [[pace.exact ? "MEASURED" : "REPORTED", `${compactOf(used)} of ${compactOf(limit)} tok (${Math.round(fill * 100)}%): the solid arc, and the head at its end. ${pace.exact ? "Read from the thread's transcript at its newest model call" : "As the thread reported it when a turn ended"}`, fill >= 0.8 ? tone : undefined, "wrap"], ["LEFT", `${compactOf(pace.left)} tok: the gap between the head and the bar on the far side, where the ring closes`, undefined, "wrap"]]
      if (pace.perCall) {
        lines.push(["PACE", `about ${compactOf(Math.round(pace.perCall))} tok a model call: the median of its last ${plural(pace.n, "stretch").replace("stretchs", "stretches")} between two readings`, undefined, "wrap"])
        lines.push(["SINCE", pace.since ? `${plural(pace.since, "call")} since the last reading, so about ${compactOf(Math.round(pace.estimate))} tok more: the dashed stretch, an estimate until the next reading` : "no call since the last reading: nothing is estimated", pace.since ? INK.soft : INK.dim, "wrap"])
        lines.push(["CLOSES", `in about ${plural(pace.calls, "more call")} at this pace, an estimate. Each tick ahead of the head is one call, sixteen at most`, undefined, "wrap"])
      } else lines.push(["PACE", "not known yet: it takes two readings of the context, with a model call between them, to tell", INK.dim, "wrap"])
      lines.push(["NOTCHES", "80% and 92% of the window, where the ring turns amber and red", INK.dim, "wrap"])
      return { tone, kicker: "CONTEXT RING", title: threadOf(session.id), lines, pin: true, foot: "a compaction opens the ring again" }
    }
    if (target.kind === "charge") {
      const flock = this.flock
      const session = scene.byId.get(target.id)
      if (!session || flock.sid !== session.id) return null
      const lit = Math.floor(flock.charge * CHARGE_SOCKETS + 1e-6)
      const lines = [
        ["HOLDS", `${Math.round(flock.charge * flock.unit)} of ${compactOf(flock.unit)} tok toward the next dot`, session.state === "working" ? INK.live : INK.soft],
        ["SOCKETS", `${lit} of ${CHARGE_SOCKETS} lit  ·  one socket is ${Math.round((flock.unit / CHARGE_SOCKETS) * 10) / 10} tok`],
        ["FIRES AT", `${compactOf(flock.unit)} tok: one dot goes into the body`],
        ["REPORTED", `${compactOf(flock.out)} tok ${session.turn ? "this turn" : "last turn"}, counted when a model call ends`],
        ["OPEN CALL", flock.openSince ? (flock.callRate > 0 ? `about ${compactOf(Math.round(flock.estimate))} tok so far: ${Math.round((now - flock.openSince) / 1000)} s at ${flock.callRate >= 10 ? Math.round(flock.callRate) : flock.callRate.toFixed(1)} tok/s, the thread's last measured rate. An estimate until the call reports${flock.orbitFull ? `. The orbit holds ${ORBIT_CAP} dots: the rest waits here, charged` : ""}` : "open, its rate is not known yet: nothing is estimated") : "no model call is open", flock.openSince && flock.callRate > 0 ? INK.live : INK.soft],
        ["FIRED", `${flock.count} dot${flock.count === 1 ? "" : "s"} so far`],
        ["ENERGY", flock.arrive > 0.3 ? `motes circle at ${Math.round(24 - 14 * flock.charge)} px, ${(1.6 + 8.4 * flock.charge ** 2).toFixed(1)} rad/s; the corona beats ${(1.3 + 5.7 * flock.charge ** 2).toFixed(1)} times a second` : "still: no tokens are arriving"],
      ]
      return { tone: modelColor(session.model, session.provider), kicker: "CHARGE AT THE TIP", title: threadOf(session.id), lines, pin: true, foot: "tokens gather here; eight sockets make one dot, and a full charge fires it into the globe" }
    }
    if (target.kind === "flock" || target.kind === "lean") {
      const flock = this.flock
      const session = scene.byId.get(target.id)
      if (!session || flock.sid !== session.id) return null
      const rate = scene.rateOf(session.id, now)
      const squads = [...flock.squads.values()].map((squad) => bare(squad.tool.name))
      const lean = Math.round((flock.pitch * 180) / Math.PI)
      const lines = [
        ["SIZE", flock.out ? `${flock.count} dots × ${compactOf(flock.unit)} tok = ${compactOf(flock.out)} tok ${session.turn ? "this turn" : "last turn"}` : "no output reported"],
        ["MADE OF", `${flock.mix.think} reasoning  ·  ${flock.mix.say} reply  ·  ${flock.mix.tool} tool input${flock.mix.unknown ? `  ·  ${flock.mix.unknown} not split yet` : ""}`],
        ["FORMATION", flock.state, session.state === "working" ? INK.live : INK.soft],
        ["SPEED", session.state === "working" ? `${Math.round(flock.speed)} px/s round the globe${rate ? `, from ${rate >= 10 ? Math.round(rate) : rate.toFixed(1)} tok/s` : ", no rate reported"}` : "at rest"],
        ["GLOBE", flock.fill ? `context ${Math.round(flock.fill * 100)}% full: the globe is ${Math.round(((0.66 + 0.26 * flock.fill) / 0.92) * 100)}% of the way to the context ring` : "context not reported: the globe stays at its smallest"],
        ["VIEW", `tipped ${lean}°${session.expect && session.turn ? `  ·  the turn is at ×${((now - session.turn.start) / session.expect.p50).toFixed(1)} its usual length` : ""}  ·  54° on pace, 66° at twice the usual length`],
        ["SATELLITES", squads.length ? `${squads.join(", ")}: one lap of a lane is that equipment's usual time` : "none in flight"],
        ["CAP", `${FLOCK_CAP} dots; past that one dot stands for more tokens`],
      ]
      return { tone: modelColor(session.model, session.provider), kicker: target.kind === "lean" ? "THE VIEW" : "FLOCK", title: threadOf(session.id), lines, pin: true, foot: "white reply, the model's colour reasoning, an equipment colour tool input" }
    }
    if (target.kind === "ridge") {
      const session = scene.byId.get(target.sid)
      if (!session) return null
      return {
        tone: modelColor(session.model, session.provider),
        kicker: "RIDGE POINT",
        title: `${target.value >= 10 ? Math.round(target.value) : target.value.toFixed(1)} tok/s at ${clockOf(target.at)}`,
        lines: [["THREAD", threadOf(target.sid)], ["WHEN", `${clockOf(target.at)}  ·  ${agoOf(now - target.at)} ago`], ["OUTPUT", `${target.value.toFixed(1)} tok/s, averaged over ${spanOf(target.slice)}`], ["WINDOW", `the last ${spanOf(target.span)}`], ["HOW", "a call's tokens are spread evenly over the time it took"], ["NOTE", "estimated from text length where a call reports no tokens", INK.dim]],
        pin: true,
        foot: target.sid === scene.focus.id ? "click: pin this point  ·  w: change the window" : "click: focus this thread  ·  w: change the window",
      }
    }
    if (target.kind === "terrain") {
      const geo = this.terrainGeo
      if (!geo) return null
      return { tone: INK.soft, kicker: "TIME TERRAIN", title: `the last ${spanOf(geo.span)}`, lines: [["RIDGES", `${geo.ridges.length} threads, the focused one in front`], ["HEIGHT", `tokens a second; full height is ${geo.top} tok/s`], ["STEP", `one slice is ${spanOf(geo.slice)}`], ["MARKS", "diamond: tool call  ·  red: failed  ·  flag: alert  ·  ring: dispatched"], ["HEAD", "the dot at now is the newest reading of a working thread"], ["CHARGE", "one mote per 5 s a call runs before its first word"]], foot: "w or the buttons: 1, 5 or 30 minutes" }
    }
    if (target.kind === "project") {
      const project = scene.projects.find((entry) => entry.key === target.id)
      if (!project) return null
      const tally = project.tally
      return {
        tone: INK.soft,
        kicker: "PROJECT",
        title: project.name,
        lines: [["PATH", homed(project.dir) || "none"], ["THREADS", `${tally.threads} listed  ·  ${tally.working} working`], ["FLAGGED", tally.flags ? `${tally.flags} to watch` : "nothing"], ["ACCOUNTS", [...project.accounts].filter(Boolean).join(", ") || "unknown"], ["COST", `${moneyOf(tally.cost)} across the listed threads`]],
        foot: "click: fold or open this project",
      }
    }
    if (target.kind === "port") {
      const port = scene.ports.get(target.id)
      const lines = [["CALLS", `${port.count} in the last ${Math.round(scene.windowMs / 60e3)} min`], ["IN FLIGHT", port.id === "you" ? `${port.inflight} thread${port.inflight === 1 ? "" : "s"} waiting on you` : String(port.inflight), port.inflight ? INK.live : undefined]]
      if (port.p50) lines.push(["USUALLY", `${spanOf(port.p50)}  ·  19 in 20 within ${spanOf(port.p95)}`])
      lines.push(["FAILED", port.errors ? `${port.errors} of ${port.count}` : "none", port.errors ? INK.bad : undefined])
      for (const entry of port.recent.slice(0, 4)) lines.push([clockOf(entry.tool.start), `${index(entry.sid)}  ${bare(entry.tool.name)}  ${clean(entry.tool.label)}`, entry.tool.status === "error" ? INK.bad : entry.tool.end === null ? INK.live : INK.soft])
      return { tone: PORT_COLOR[port.id], kicker: "EQUIPMENT", title: `${port.label}: ${port.note}`, lines, pin: true, foot: "what the models acted on, from every listed thread" }
    }
    if (target.kind === "account") {
      const account = scene.world.accounts.find((entry) => entry.name === target.id)
      if (!account) return null
      const five = account.five
      const seven = account.seven
      const lines = []
      if (five && five.used !== null) {
        lines.push(["FIVE HOURS", `${Math.round(five.used)}% used  ·  ${Math.round(account.left)}% left`, account.left <= 6 ? INK.bad : account.left <= 15 ? INK.warn : undefined])
        lines.push(["RESETS", five.resetsAt ? `${hourMinuteOf(five.resetsAt)}, in ${spanOf(five.resetsAt - now)}` : "no reset time reported"])
        lines.push(["PACE", account.pace ? `×${account.pace.toFixed(1)} of an even pace` : "not enough of the window used to say"])
        lines.push(["RUNS DRY", account.dryAt ? `${hourMinuteOf(account.dryAt)} at this pace, ${spanOf(five.resetsAt - account.dryAt)} before the reset` : "not before the reset at this pace", account.dryAt ? INK.warn : undefined])
      } else lines.push(["FIVE HOURS", "no reading yet"])
      if (seven && seven.used !== null) lines.push(["SEVEN DAYS", `${Math.round(seven.used)}% used${seven.resetsAt ? `  ·  resets ${dayOf(seven.resetsAt)} ${hourMinuteOf(seven.resetsAt)}` : ""}`])
      const users = scene.world.sessions.filter((session) => session.account === account.name && session.state === "working")
      lines.push(["WORKING ON IT", users.length ? users.map((session) => index(session.id)).join(", ") : "no thread right now", users.length ? INK.live : undefined])
      return { tone: INK.soft, kicker: "ACCOUNT", title: `${account.name}${account.tier ? `  ·  ${account.tier}` : ""}`, lines, pin: true, foot: "the rail is what is left of the five hour window; the triangle is an even pace" }
    }
    if (target.kind === "blip" || target.kind === "pane") {
      const pane = scene.paneOf.get(target.id)
      if (!pane) return null
      const session = pane.sessionId ? scene.byId.get(pane.sessionId) : null
      const lines = [["WHERE", scene.whereOf(pane.id)], ["HOLDS", pane.kind === "shell" ? "a shell, no agent" : pane.kind], ["STATE", `${pane.status === "blocked" ? "waiting on you" : pane.status === "done" ? "finished, not read yet" : pane.status}${pane.since ? ` for ${agoOf(now - pane.since)}` : ""}`, pane.status === "blocked" ? INK.warn : pane.status === "working" ? INK.live : pane.status === "done" ? INK.good : undefined]]
      if (pane.label) lines.push(["LABEL", pane.label])
      if (pane.cwd) lines.push(["FOLDER", homed(pane.cwd)])
      lines.push(["THREAD", session ? threadOf(session.id) : pane.sessionId ? "a session older than a day" : "none"])
      if (pane.id === scene.world.self) lines.push(["NOTE", "this is the pane Agent Nexus runs in", INK.live])
      return { tone: pane.status === "blocked" ? INK.warn : pane.status === "working" ? INK.live : INK.soft, kicker: "PANE", title: pane.title || pane.label || pane.id, lines, foot: target.kind === "pane" ? "click: go to this pane in herdr" : `click: ${session && scene.rowOf.has(session.id) ? "focus its thread" : "pin this card"}  ·  middle click: go to the pane` }
    }
    if (target.kind === "tab") {
      const tab = scene.tabOf.get(target.id)
      const panes = scene.world.panes.filter((pane) => pane.tab === target.id)
      return { tone: INK.soft, kicker: "TAB", title: tab?.label || target.id, lines: [["SECTOR", target.workspace || tab?.workspace || ""], ["TAB", target.id], ["PANES", panes.map((pane) => `${pane.id} ${pane.status}`).join("  ·  ")]], foot: "" }
    }
    if (target.kind === "tool") {
      const tool = target.tool
      const running = tool.end === null
      return {
        tone: tool.status === "error" ? INK.bad : PORT_COLOR[portOf(tool.name)],
        kicker: "TOOL CALL",
        title: `${bare(tool.name)}  ${clean(tool.label)}`,
        lines: [["THREAD", threadOf(target.sid)], ["TOOL", bare(tool.name)], ["TARGET", clean(tool.label) || "not recorded", undefined, "wrap"], ["STARTED", `${clockOf(tool.start)}  ·  ${agoOf(now - tool.start)} ago`], ["TOOK", running ? `running for ${spanOf(now - tool.start)}` : spanOf(Math.max(1, tool.end - tool.start)), running ? INK.live : undefined], ["RESULT", running ? "not back yet" : tool.status === "error" ? "failed" : "came back", tool.status === "error" ? INK.bad : undefined], ["GOES TO", scene.ports.get(portOf(tool.name)).label]],
        pin: true,
        foot: "a pillar on the clock, a diamond on the axon and a line of the log are the same call",
      }
    }
    if (target.kind === "step") {
      const step = target.step
      return {
        tone: INK.live,
        kicker: "MODEL CALL",
        title: `call ${step.seq} of ${threadOf(target.sid)}`,
        lines: [["STARTED", `${clockOf(step.start)}  ·  ${agoOf(now - step.start)} ago`], ["FIRST WORDS", step.streamed ? `after ${spanOf(Math.max(1, step.streamed - step.start))}` : "none yet"], ["LASTED", step.end ? spanOf(Math.max(1, step.end - step.start)) : `running for ${spanOf(now - step.start)}`, step.end ? undefined : INK.live], ["WROTE", step.out ? `${compactOf(step.out)} tok` : step.chars ? `about ${compactOf(step.chars / 3.6)} tok (from ${compactOf(step.chars)} characters)` : "not reported yet"], ["THOUGHT", step.reasoning.length ? `${step.reasoning.length} block${step.reasoning.length === 1 ? "" : "s"}` : "no thinking recorded"], ["TOOLS", step.tools.length ? step.tools.map((tool) => bare(tool.name)).join(", ") : "none"], ["ENDED WITH", step.finish || (step.end ? "not recorded" : "still running")]],
        pin: true,
        foot: "a bar inside the ring and a tick on the axon are the same call",
      }
    }
    if (target.kind === "note") {
      const card = target.card
      if (!card) return null
      return { tone: card.tone ?? INK.soft, kicker: card.kicker, title: card.title, lines: card.lines.map(([name, value, tone]) => [name, value, tone, "wrap"]), pin: true, foot: "click: pin this card" }
    }
    if (target.kind === "log") {
      const entry = scene.log.find((candidate) => candidate.key === target.id) ?? target.entry
      if (!entry) return null
      const session = scene.byId.get(entry.sid)
      // a tool call's line is the same call as its pillar and its diamond: the same card
      if (entry.port && session) for (const step of session.steps) for (const tool of step.tools) if (tool.id === entry.key) return this.inspect({ kind: "tool", id: tool.id, sid: entry.sid, tool }, scene, now)
      const what = { turn: "a turn began", done: "the turn ended", failed: "the turn failed", interrupted: "the turn was interrupted", call: "it began to wait on you", dispatch: "a subagent was dispatched" }[entry.name] ?? bare(entry.name)
      const tone = entry.tone === "bad" ? INK.bad : entry.tone === "warn" ? INK.warn : entry.tone === "ok" ? INK.good : entry.tone === "run" ? INK.live : INK.soft
      const lines = [["WHAT", what, tone], ["THREAD", threadOf(entry.sid)], ["WHEN", `${clockOf(entry.at)}  ·  ${agoOf(now - entry.at)} ago`]]
      if (entry.span !== null) lines.push(["TOOK", spanOf(Math.max(1, entry.span))])
      lines.push(["TEXT", clean(entry.detail) || "n/a", undefined, "wrap"])
      return { tone, kicker: "LOG", title: `${bare(entry.name)}  ·  ${clockOf(entry.at)}`, lines, pin: true, foot: "click: focus this thread, or pin this line when it is in focus" }
    }    if (target.kind === "alert") {
      const alert = scene.alerts.find((entry) => entry.key === target.id) ?? target.alert
      if (!alert) return null
      return { tone: LEVEL_COLOR[alert.level], kicker: alert.kind === "call" ? "CALL" : alert.level.toUpperCase(), title: alert.sid ? threadOf(alert.sid) : alert.text, lines: [["WHAT", alert.text, undefined, "wrap"], ["DETAIL", clean(alert.detail) || "n/a", undefined, "wrap"], ["SINCE", alert.kind === "context" || alert.kind === "account" ? "now" : `${clockOf(alert.since)}  ·  ${agoOf(now - alert.since)} ago`], ["LEVEL", alert.muted ? `${alert.level}, muted` : alert.level]], foot: alert.sid ? "click: focus this thread  ·  x: mute or unmute" : "an account flag clears when the window resets" }
    }
    return null
  },
}

Object.assign(hud, explain)

export const shortTarget = (target, scene) => {
  if (!target) return "nothing"
  const session = target.sid ? scene.byId.get(target.sid) : (target.kind === "thread" || target.kind === "fold" || target.kind === "clock" || target.kind === "answer") ? scene.byId.get(target.id) : null
  return `${target.kind} ${String(target.id).slice(0, 26)}${session ? `  (${shortModel(session.model)}, ${clean(session.title).slice(0, 22)})` : ""}`
}
