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

// the focus stage is painted in parts; the keyboard walks them as one region
const STAGE_PARTS = new Set(["core", "flockline", "plinth", "cache", "under", "reach", "head", "charts", "tail"])

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
      ["CONTEXT RING", "The context window, closing: the ring is shut at the bar on its far side when the window is full. Solid is what the thread last reported, the head its end. Dashed is what the calls since have probably added, and each tick ahead is one more call at the thread's recent pace: estimates. The notches are 80% and 92%, where it turns amber and red.", core.cx - core.RB * 0.72, core.cy + core.RB * 0.7, "tr"],
      ["GLOBE", `One dot is ${compactOf(unit)} tokens of this turn's output: the south pole its first, the north pole its newest. A murmuration while the model reasons, rings while it writes, a locked lattice while a tool runs. White is reply, the model's colour reasoning, an equipment colour tool input.`, core.cx + core.RB * 0.62, core.cy + core.RB * 0.5, "tl"],
      ["ORBIT AND SIPHON", "Dots released at the tip circle the rings while their model call is open: its output is an estimate until the call reports. Then they spiral into the globe one after another. The ring system tips further back the longer the turn runs past its usual length.", core.cx - u(30), core.cy + core.RB * 0.93, "tr"],
      ["MOON", "A subagent of this thread on the outer circle. It circles as fast as it writes and sits still when it rests. Click it to focus it.", core.cx - core.Rm * 0.72, core.cy - core.Rm * 0.69, "tl"],
    ]
    if (this.cacheHead) list.push(["PROMPT CACHE", "What the thread has sent is kept by the provider for a set time after its last model call. The axis runs from that call to the moment it goes cold; the bright stretch is what is left, and the head is now. Its colour is its warmth: rose when just touched, cooling through orchid to a cold blue, grey when cold. Dashed and marked ASSUMED when the lifetime could not be measured from the thread's own transcript. The arc round every cell body is the same cache.", this.cacheHead.x, this.cacheHead.y, "tl"])
    if (this.reachMark) list.push(["REACH", "What this turn touched, as a tree off the thread's wire: files under their folder, programs, searches, hosts and agents under their equipment. Each bar is one call on the turn's time: where it starts is when, its length how long, red when it failed, hollow while it runs. A packet runs out along the branch when a call starts and back with the result. The cyan line is now.", this.reachMark.tx0, this.reachMark.axisY, "tl"])
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

  // Where the tags go. A tag stands beside its mark, with a wedge on its edge at the point
  // nearest the mark. It may stand on any of the four sides and slide along that side, so of the
  // twenty places tried the one is taken that covers no other tag and no other mark (the wanted
  // corner first). A place is kept from frame to frame while its mark stays near where it was,
  // so tags do not jump when a mark creeps.
  explainPlaces(items, w) {
    const u = (value) => this.u(value)
    const gap = u(11)
    const key = `${this.W}x${this.H}`
    if (this.explainKept?.key !== key) this.explainKept = { key, map: new Map() }
    const kept = this.explainKept.map
    const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
    const candidates = (item) => {
      const { ax, ay, h, corner } = item
      const list = []
      const sides = corner === "tl" ? ["r", "b", "l", "t"] : corner === "tr" ? ["l", "b", "r", "t"] : corner === "bl" ? ["r", "t", "l", "b"] : ["l", "t", "r", "b"]
      // along a side: the wanted corner first, then the tag slid past the mark in quarters
      const slides = corner.startsWith("t") ? [0, 0.25, 0.5, 0.75, 1] : [1, 0.75, 0.5, 0.25, 0]
      const across = corner.endsWith("l") ? [0, 0.25, 0.5, 0.75, 1] : [1, 0.75, 0.5, 0.25, 0]
      for (const side of sides) {
        for (let index = 0; index < 5; index += 1) {
          let x
          let y
          if (side === "r" || side === "l") {
            x = side === "r" ? ax + gap : ax - gap - w
            y = ay - slides[index] * h + (slides[index] === 0 ? gap : slides[index] === 1 ? -gap : 0)
          } else {
            y = side === "b" ? ay + gap : ay - gap - h
            x = ax - across[index] * w + (across[index] === 0 ? gap : across[index] === 1 ? -gap : 0)
          }
          list.push({ x: Math.round(Math.max(4, Math.min(this.W - w - 4, x))), y: Math.round(Math.max(4, Math.min(this.H - h - 4, y))), w, h })
        }
      }
      return list
    }
    const costOf = (item, rect, order, others) => {
      let cost = order * 40
      for (const other of others) if (other) cost += overlap({ x: rect.x - u(6), y: rect.y - u(6), w: rect.w + u(12), h: rect.h + u(12) }, other) * 4
      for (const other of items) {
        const insideIt = other.ax > rect.x - u(8) && other.ax < rect.x + rect.w + u(8) && other.ay > rect.y - u(8) && other.ay < rect.y + rect.h + u(8)
        if (insideIt) cost += other === item ? 1e9 : 3e4
      }
      // pushed off its mark by the edge of the screen
      const dx = Math.max(rect.x - item.ax, 0, item.ax - (rect.x + rect.w))
      const dy = Math.max(rect.y - item.ay, 0, item.ay - (rect.y + rect.h))
      return cost + Math.max(0, Math.hypot(dx, dy) - gap * 1.5) * 400
    }
    const choose = (item, others) => {
      let best = null
      let bestCost = Infinity
      candidates(item).forEach((rect, order) => {
        const cost = costOf(item, rect, order, others)
        if (cost < bestCost) {
          bestCost = cost
          best = rect
        }
      })
      return best
    }
    const placed = items.map(() => null)
    const fresh = []
    items.forEach((item, index) => {
      const before = kept.get(item.title)
      if (before && before.h === item.h && Math.hypot(item.ax - before.ax, item.ay - before.ay) < u(30)) placed[index] = { x: Math.round(Math.max(4, Math.min(this.W - w - 4, item.ax + before.dx))), y: Math.round(Math.max(4, Math.min(this.H - item.h - 4, item.ay + before.dy))), w, h: item.h }
      else fresh.push(index)
    })
    // the new ones one after another, then twice more each against all the others, so an early
    // choice gives way to a later one that had nowhere else to go
    for (const index of fresh) placed[index] = choose(items[index], placed)
    for (let round = 0; round < 2; round += 1) for (const index of fresh) placed[index] = choose(items[index], placed.map((rect, other) => (other === index ? null : rect)))
    for (const index of fresh) kept.set(items[index].title, { ax: items[index].ax, ay: items[index].ay, h: items[index].h, dx: placed[index].x - items[index].ax, dy: placed[index].y - items[index].ay })
    return placed
  },

  explainTags(scene, now) {
    const u = (value) => this.u(value)
    const overlays = []
    const anchors = []
    const perLine = 44
    const w = u(336)
    const items = this.explainList(scene).map(([title, text, ax, ay, corner]) => {
      const lines = wrap(text, perLine)
      return { title, text, ax, ay, corner, lines, h: u(34) + lines.length * u(17) }
    })
    const places = this.explainPlaces(items, w)
    items.forEach(({ title, text, ax, ay, lines }, index) => {
      const rect = places[index]
      anchors.push({ x: ax, y: ay })
      // the wedge: on the tag's edge, at the point nearest the mark
      const mx = Math.max(rect.x, Math.min(rect.x + rect.w, ax))
      const my = Math.max(rect.y, Math.min(rect.y + rect.h, ay))
      overlays.push({
        name: `over:explain:${index}`,
        rect,
        signature: `${title}|${text}|${Math.round(mx - rect.x)}|${Math.round(my - rect.y)}`,
        draw: (c) => {
          c.fillStyle = PANEL
          c.fillRect(rect.x, rect.y, rect.w, rect.h)
          c.strokeStyle = INK.faint
          c.lineWidth = 1
          c.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1)
          c.fillStyle = INK.live
          const arm = u(12)
          const onLeft = mx <= rect.x
          const onRight = mx >= rect.x + rect.w
          const onTop = my <= rect.y
          const onBottom = my >= rect.y + rect.h
          c.beginPath()
          if ((onLeft || onRight) && (onTop || onBottom)) {
            // at a corner: the corner itself
            const sx = onLeft ? 1 : -1
            const sy = onTop ? 1 : -1
            c.moveTo(mx, my)
            c.lineTo(mx + sx * arm, my)
            c.lineTo(mx, my + sy * arm)
          } else if (onLeft || onRight) {
            const sx = onLeft ? 1 : -1
            const cy = Math.max(rect.y + arm * 0.6, Math.min(rect.y + rect.h - arm * 0.6, my))
            c.moveTo(mx, cy - arm * 0.6)
            c.lineTo(mx + sx * arm * 0.75, cy)
            c.lineTo(mx, cy + arm * 0.6)
          } else {
            const sy = onTop ? 1 : -1
            const cx = Math.max(rect.x + arm * 0.6, Math.min(rect.x + rect.w - arm * 0.6, mx))
            c.moveTo(cx - arm * 0.6, my)
            c.lineTo(cx, my + sy * arm * 0.75)
            c.lineTo(cx + arm * 0.6, my)
          }
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
      const region = name === "layout" || name === "top" || name === "rest" || name === "wires" || name.startsWith("row:") || name.startsWith("proj:") ? "circuit" : name === "comms" || name === "log" || name === "hints" ? "footer" : STAGE_PARTS.has(name) ? "stage" : name
      // a wire is a row of targets with one card: the keyboard stops on it once, at its middle
      const walked = name === "wires" ? [...Map.groupBy(list, (target) => target.id).values()].map((same) => same[same.length >> 1]) : list
      for (const target of walked) {
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
