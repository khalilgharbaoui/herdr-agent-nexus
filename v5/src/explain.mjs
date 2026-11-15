// Two ways to learn the screen from the screen.
//
//   explain (e)   a tag beside one example of every kind of mark, saying what it stands for and
//                 what its motion means. Each tag touches a ring that sits on the mark itself.
//   walk ([ ])    every inspectable thing of a region as a list the keyboard can step through,
//                 down to a single dot of the flock or one tool call on the clock.

import { flockUnit } from "./flock.mjs"
import { PANEL, wrap } from "./theme.mjs"
import { FAMILY, INK, compactOf } from "./util.mjs"

export const REGION_ORDER = ["flock", "clock", "stage", "terrain", "circuit", "ports", "rails", "header", "footer"]
export const REGION_WORD = { flock: "the flock", clock: "the turn clock", stage: "the focus stage", terrain: "the time terrain", circuit: "the threads", ports: "the equipment", rails: "the accounts", header: "the header", footer: "comms, sector map and log" }

export const explain = {
  // [title, text, anchor x, anchor y, which corner of the tag touches the anchor]
  explainList(scene) {
    const G = this.G
    const u = (value) => this.u(value)
    const core = G.core
    const T = G.terrain
    const session = scene.focused?.session
    const unit = session && this.flock.sid === session.id ? this.flock.unit : session ? flockUnit(session.turn?.out ?? session.lastOut ?? 0) : 100
    const tip = this.tipOf()
    const list = [
      ["CHARGE", `Tokens gather where the thread's wire ends. Eight sockets make one dot (${compactOf(unit)} tokens): the fuller the charge, the tighter and faster its motes circle. A full charge fires the dot to the rings.`, tip.x + u(30), tip.y - u(26), "bl"],
      ["TURN CLOCK", "The arc is how long this turn has run. A full circle is 1.25 times what such a turn usually takes; the grey band is the usual range.", core.cx + core.RA * 0.42, core.cy - core.RA * 0.9, "bl"],
      ["PILLAR", "One tool call, standing on the turn clock at the moment it started. Taller when it took longer. Its colour is the equipment it used, red when it failed.", core.cx + core.RA + u(14), core.cy - u(70), "tl"],
      ["BAR", "One model call, hanging under the turn clock. Longer when it wrote more.", core.cx - core.RA + u(16), core.cy - u(60), "tr"],
      ["CONTEXT RING", "How full the context window is. Amber past 80%, red past 92%.", core.cx - core.RB * 0.72, core.cy + core.RB * 0.7, "tr"],
      ["GLOBE", `One dot is ${compactOf(unit)} tokens of this turn's output: the south pole its first, the north pole its newest. A murmuration while the model reasons, rings while it writes, a locked lattice while a tool runs. White is reply, the model's colour reasoning, an equipment colour tool input.`, core.cx + core.RB * 0.62, core.cy + core.RB * 0.5, "tl"],
      ["ORBIT AND SIPHON", "Dots released at the tip circle the rings while their model call is open: its output is an estimate until the call reports. Then they spiral into the globe one after another. The ring system tips further back the longer the turn runs past its usual length.", core.cx - u(30), core.cy + core.RB * 0.93, "tr"],
      ["MOON", "A subagent of this thread on the outer circle. It circles as fast as it writes and sits still when it rests. Click it to focus it.", core.cx - core.Rm * 0.72, core.cy - core.Rm * 0.69, "tl"],
    ]
    if (T) {
      list.push(["RIDGE", "One thread's tokens a second over the window, the focused thread in front. The dot at the right edge is its newest reading; motes above it count the seconds before a call's first word.", T.x + T.w * 0.45, T.y + u(96), "tl"])
      list.push(["MARKS ON A RIDGE", "Diamond: a tool call. Red and taller: it failed. Flag: an alert was raised. Ring: the subagent was dispatched.", T.x + T.w * 0.3, T.y + T.h - u(24), "bl"])
    }
    const rail = G.rails?.[0]
    if (rail) list.push(["RAIL", "An account. The level is what is left of its five hour window, the triangle is where an even pace would stand.", rail.x, G.railTop + u(90), "tl"])
    const rows = G.rows.filter((g) => g.row)
    if (rows[0]) list.push(["CELL", "A thread. The ring is its model, the dot inside grows with its context. A resting cell breathes slower the longer it rests. A circling comet means it is generating.", rows[0].somaX, rows[0].axonY, "tl"])
    if (rows[1]) list.push(["AXON", "Bars (model calls) and diamonds (tool calls) drift right at 12 px a second, so the line is the last minutes. Pulses run in from the rail when a call starts, out to the equipment when a tool starts and back with the result.", (rows[1].somaX + G.termX) / 2, rows[1].axonY, "tl"])
    const port = G.ports.get("exec")
    if (port) list.push(["EQUIPMENT", "What the models act with. The count is calls in the last 8 minutes, the line under it their usual latency, a lamp per call in flight.", port.x, port.y, "tr"])
    list.push(["PHASE", "Normal, caution or alert, with the one reason. It rises at once and cools down through caution.", G.M + u(120), u(96), "tl"])
    const F = G.footer
    list.push(["COMMS", "Flags and calls, oldest first. A thread that waits on you rings here.", F.x + G.M + u(60), F.y + u(60), "bl"])
    list.push(["SECTOR MAP", "Every herdr pane as a blip, by workspace and tab: working, calling, unread.", F.x + F.w * 0.42, F.y + u(60), "bl"])
    return list
  },

  explainTags(scene, now) {
    const u = (value) => this.u(value)
    const overlays = []
    const anchors = []
    const perLine = 44
    const w = u(336)
    this.explainList(scene).forEach(([title, text, ax, ay, corner], index) => {
      const lines = wrap(text, perLine)
      const h = u(34) + lines.length * u(17)
      const gap = u(11)
      const x = corner.endsWith("l") ? ax + gap : ax - gap - w
      const y = corner.startsWith("t") ? ay + gap : ay - gap - h
      const rect = { x: Math.round(Math.max(4, Math.min(this.W - w - 4, x))), y: Math.round(Math.max(4, Math.min(this.H - h - 4, y))), w, h }
      anchors.push({ x: ax, y: ay })
      overlays.push({
        name: `over:explain:${index}`,
        rect,
        signature: `${title}|${text}`,
        draw: (c) => {
          c.fillStyle = PANEL
          c.fillRect(rect.x, rect.y, rect.w, rect.h)
          c.strokeStyle = INK.faint
          c.lineWidth = 1
          c.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1)
          // the corner that touches the mark
          c.fillStyle = INK.live
          const cx = corner.endsWith("l") ? rect.x : rect.x + rect.w
          const cy = corner.startsWith("t") ? rect.y : rect.y + rect.h
          const sx = corner.endsWith("l") ? 1 : -1
          const sy = corner.startsWith("t") ? 1 : -1
          c.beginPath()
          c.moveTo(cx, cy)
          c.lineTo(cx + sx * u(12), cy)
          c.lineTo(cx, cy + sy * u(12))
          c.closePath()
          c.fill()
          this.text(c, title, rect.x + u(16), rect.y + u(21), { size: 11.5, family: FAMILY.label, weight: "600", color: INK.live, spacing: 2.4 })
          lines.forEach((line, row) => this.text(c, line, rect.x + u(16), rect.y + u(40) + row * u(17), { size: 11.5, color: INK.soft }))
        },
      })
    })
    this.explainAnchors = anchors
    return overlays
  },

  // Everything that can be inspected, grouped by region and put in reading order.
  walkTargets(scene) {
    const groups = new Map(REGION_ORDER.map((name) => [name, []]))
    const add = (region, target) => groups.get(region)?.push(target)
    for (const [name, list] of this.hits) {
      if (name.startsWith("over:")) continue
      const region = name === "layout" || name === "top" || name === "rest" || name.startsWith("row:") || name.startsWith("proj:") ? "circuit" : name === "comms" || name === "log" || name === "hints" ? "footer" : name
      for (const target of list) {
        if (target.kind === "terrain" || target.kind === "tail" || target.kind === "clock" || target.kind === "key") continue
        if (target.kind === "port") add("ports", target)
        else if (target.kind === "account") add("rails", target)
        else if (name === "stage" && (target.kind === "tool" || target.kind === "alert" || target.kind === "thread")) add("terrain", target)
        else if (target.kind === "flock" && target.rect.w > this.u(300)) continue
        else add(region, target)
      }
    }
    const flock = this.flock
    const r = this.u(8)
    if (scene.focused && flock.sid === scene.focus.id) for (let index = 0; index < flock.count; index += 1) if (flock.level[index]) add("flock", { kind: "dot", id: `${flock.sid}:${flock.turn}:${index}`, sid: flock.sid, index, moving: true, rect: { x: flock.sx[index] - r, y: flock.sy[index] - r, w: r * 2, h: r * 2 } })
    const core = this.G.core
    if (this.clock) {
      const marks = [...this.clock.steps.map((entry) => ({ ...entry, radius: core.RA - this.u(14) })), ...this.clock.tools.map((entry) => ({ ...entry, radius: core.RA + this.u(18) }))].sort((a, b) => a.angle - b.angle)
      for (const entry of marks) {
        const x = core.cx + Math.cos(entry.angle - Math.PI / 2) * entry.radius
        const y = core.cy + Math.sin(entry.angle - Math.PI / 2) * entry.radius
        add("clock", { kind: entry.tool ? "tool" : "step", id: entry.tool ? entry.tool.id : `${this.clock.sid}:${entry.step.seq}`, sid: this.clock.sid, tool: entry.tool, step: entry.step, rect: { x: x - this.u(9), y: y - this.u(9), w: this.u(18), h: this.u(18) } })
      }
    }
    for (const [name, list] of groups) {
      if (name === "flock" || name === "clock") continue
      list.sort((a, b) => Math.round(a.rect.y / this.u(24)) - Math.round(b.rect.y / this.u(24)) || a.rect.x - b.rect.x)
    }
    return groups
  },
}
