// The flock: the focused turn's output as a globe of dots in three dimensions.
//
// One dot stands for so many output tokens (the unit is printed on screen). Every dot knows which
// model call wrote it, which part of that call it is (reasoning, reply, tool input) and when.
// The dots live on a globe inside the core's ring system: the turn's first output sits at the
// south pole, the newest at the north pole, so the globe carries the turn as strata.
// What the swarm does is read from the thread, never from a timer of its own:
//
//   tokens arrive               they gather at the tip of the thread's wire; one dot's worth
//                               fires a dot into the globe, where it settles at the north pole
//   the model is generating     the dots lift off and fly as a flock (separation, alignment,
//                               cohesion) round the globe, as fast as the tokens stream
//   nothing heard for a while   the flock slows, and after 150 s of silence locks into a lattice
//   a tool runs                 the globe locks and turns one notch a second; the dots that were
//                               the call's input leave as a satellite on that equipment's lane
//   the result comes back       the satellite's dots return; a failure scatters the whole flock
//   the turn ends               the globe forms up and rests, breathing slower the longer it rests
//   the context window fills    the globe swells toward the context ring
//   the focus moves             the old flock disperses, the new one gathers from all around
//
// Depth is real. The eye looks down on the ring plane (see body.mjs): a dot's size, brightness
// and stacking follow how near it is, a dot south of the ring plane is drawn behind the rings
// and one north of it in front, and a dot that flies leaves a short streak the way it is going.

import { LANES, lanePoint, lapOf, makeView, project, toPlane } from "./body.mjs"
import { portOf, wroteOf } from "./model.mjs"
import { STREAK_DIRS, streakOf } from "./sprites.mjs"
import { GOLDEN, PORT_COLOR, spriteHex } from "./theme.mjs"
import { INK, TAU, clamp, modelColor } from "./util.mjs"

export const FLOCK_CAP = 300 // dots; past this one dot stands for more tokens
export const FLOCK_UNITS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000]
export const LEVELS = 7 // depth layers of a dot: 1 is the farthest
export const STREAK_FROM = 3 // from this depth layer on a flying dot shows its streak
export const CHARGE_SOCKETS = 8 // the charge at the tip fills this many sockets, then fires one dot
const GHOST_MS = 700
const smooth = (value, low, high) => {
  const t = clamp((value - low) / (high - low), 0, 1)
  return t * t * (3 - 2 * t)
}
const phaseOf = (id) => {
  let sum = 0
  for (let index = 0; index < id.length; index += 1) sum = (sum * 31 + id.charCodeAt(index)) % 6283
  return sum / 1000
}

export const flockUnit = (out) => FLOCK_UNITS.find((unit) => out / unit <= FLOCK_CAP) ?? 50000
export const KIND_WORD = { think: "reasoning", say: "reply", tool: "tool input", unknown: "not split yet" }

export class Flock {
  constructor() {
    const n = FLOCK_CAP
    this.x = new Float32Array(n)
    this.y = new Float32Array(n)
    this.z = new Float32Array(n)
    this.vx = new Float32Array(n)
    this.vy = new Float32Array(n)
    this.vz = new Float32Array(n)
    this.ax = new Float32Array(n)
    this.ay = new Float32Array(n)
    this.az = new Float32Array(n)
    this.wake = new Float64Array(n) // a new dot is on its way in until this time
    this.squad = new Array(n).fill(null) // the tool call a dot is out with
    this.rank = new Uint8Array(n) // its place in the squad's line
    this.sx = new Float32Array(n)
    this.sy = new Float32Array(n)
    this.level = new Uint8Array(n)
    this.kind = new Array(n).fill("")
    this.under = new Uint8Array(n)
    this.meta = []
    this.count = 0
    this.sid = null
    this.turn = -1
    this.lock = 1
    this.pace = 1
    this.pitch = (56 * Math.PI) / 180
    this.rs = 0
    this.spin = 0
    this.parX = 0
    this.parY = 0
    this.view = null
    this.notch = 0
    this.notchAt = 0
    this.slow = 1
    this.scatterAt = 0
    this.failed = new Map() // tool id -> when it came back failed
    this.squads = new Map() // tool id -> { tool, members, port, phase }
    this.sats = [] // satellites on screen this frame: { id, tool, port, x, y }
    this.sparks = [] // where a satellite's result landed: { at, x, y, z, hex }
    this.ghosts = null // the flock that was here before the focus moved
    this.held = -1
    this.state = "rest"
    this.unit = 100
    this.out = 0
    this.speed = 0
    this.fill = 0
    this.mix = { think: 0, say: 0, tool: 0, unknown: 0 }
    this.metaKey = ""
    this.seed = 1
    this.shown = 0 // tokens that have been taken in at the tip so far
    this.charge = 0 // how far the tip is charged toward the next dot, 0 to 1
    this.firedAt = 0
    this.tip = null
    this.frame = 0
  }

  random() {
    // mulberry32: jitter must not make two runs of the same data look different in kind
    let t = (this.seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  // Which model call and which part of it each dot stands for. The turn's steps are laid end to
  // end by the tokens they wrote, and dot i is the stretch from i units to i + 1 units.
  assign(session, turn, out, unit, count, now) {
    const key = `${session.id}|${turn?.start ?? 0}|${count}|${unit}|${session.steps.length}|${session.steps[session.steps.length - 1]?.end ?? "open"}|${session.steps[session.steps.length - 1]?.items.length ?? 0}`
    if (key === this.metaKey) return
    this.metaKey = key
    const segments = []
    let total = 0
    for (const step of session.steps) {
      if (!turn || step.start < turn.start - 500 || step.start > turn.end) continue
      const wrote = wroteOf(step)
      if (wrote <= 0) continue
      const chars = step.items.reduce((sum, item) => sum + (item.length ?? 0), 0)
      if (!chars) {
        segments.push({ share: wrote, kind: "unknown", step, tool: null, at: step.streamed ?? step.start, end: step.end ?? now })
        total += wrote
        continue
      }
      for (const item of step.items) {
        const length = item.length ?? 0
        if (!length) continue
        const share = (wrote * length) / chars
        segments.push({ share, kind: item.kind === "tool" ? "tool" : item.kind, step, tool: item.tool ?? null, at: item.at ?? step.start, end: item.end ?? item.tool?.start ?? step.end ?? now })
        total += share
      }
    }
    const meta = []
    const mix = { think: 0, say: 0, tool: 0, unknown: 0 }
    let at = 0
    let passed = 0
    for (let index = 0; index < count; index += 1) {
      const from = index * unit
      let entry = { kind: "unknown", seq: null, step: null, tool: null, at: turn?.start ?? 0, from, to: Math.min(out, from + unit) }
      if (total > 0) {
        const want = ((index + 0.5) / count) * total
        while (at < segments.length - 1 && passed + segments[at].share < want) passed += segments[at++].share
        const segment = segments[at]
        const within = clamp((want - passed) / Math.max(1e-6, segment.share), 0, 1)
        entry = { kind: segment.kind, seq: segment.step.seq, step: segment.step, tool: segment.tool, at: Math.round(segment.at + (Math.max(segment.at, segment.end) - segment.at) * within), from, to: Math.min(out, from + unit) }
      }
      mix[entry.kind] += 1
      meta.push(entry)
    }
    this.meta = meta
    this.mix = mix
  }

  // The resting place of dot i on the globe: a spiral from the south pole (the turn's first
  // output) to the north pole (its newest), evenly spread, turned by `turnBy` about the axis.
  lattice(index, count, radius, turnBy, out) {
    const t = (index + 0.5) / Math.max(1, count)
    const z = radius * 0.985 * (2 * t - 1)
    const rho = Math.sqrt(Math.max(0, radius * radius - z * z))
    const angle = index * GOLDEN + turnBy
    out[0] = Math.sin(angle) * rho
    out[1] = Math.cos(angle) * rho
    out[2] = z
  }

  // Where a running call's satellite is on its lane right now, in world space.
  satAt(squad, now, lag, out) {
    const lane = LANES.get(squad.port) ?? LANES.get("other")
    const turns = (now - squad.tool.start) / squad.lap
    return lanePoint(lane, this.rs + this.laneGap, turns * TAU + squad.phase - lag, out)
  }

  // One step of the swarm. `input` carries the thread and the instrument's geometry.
  step(input) {
    const { session, turn, now, core, S, rate, entry, pointer, ports } = input
    const dt = Math.min(0.05, input.dt)
    const u = (value) => value * S
    const out = session.turn?.out ?? session.lastOut ?? 0
    const unit = flockUnit(out)
    const turnKey = session.turn?.start ?? 0
    const fresh = session.id !== this.sid || turnKey !== this.turn
    const fill = session.context.limit && session.context.used ? clamp(session.context.used / session.context.limit, 0, 1) : 0
    const ease = (rate) => 1 - Math.exp(-rate * dt)
    this.frame += 1
    this.laneGap = u(26)

    // the view: 54 degrees off face on, and up to 66 as the turn runs to twice its usual length
    const over = session.turn && session.expect ? clamp((now - session.turn.start) / session.expect.p50 - 1, 0, 1) : 0
    const pitchWant = ((54 + 12 * over) * Math.PI) / 180
    // the globe swells with the context window: it reaches the context ring when the window is full
    const rsWant = core.RB * (0.66 + 0.26 * fill)
    // near and far shift against each other under the pointer
    let parXWant = 0
    let parYWant = 0
    let near = false
    if (pointer) {
      const dx = (pointer.x - core.cx) / core.Rm
      const dy = (pointer.y - core.cy) / core.Rm
      if (Math.abs(dx) <= 1.15 && Math.abs(dy) <= 0.9) {
        parXWant = clamp(dx, -1, 1) * -0.07
        parYWant = clamp(dy, -1, 1) * -0.05
        near = Math.hypot(pointer.x - core.cx, pointer.y - core.cy) < core.RB
      }
    }
    if (fresh) {
      // the flock that was here leaves: its dots fly outward and fade
      if (this.count && this.sid) {
        const ghosts = { at: now, n: 0, x: [], y: [], kind: [], level: [] }
        for (let index = 0; index < this.count; index += 1) {
          if (!this.level[index]) continue
          ghosts.x.push(this.sx[index])
          ghosts.y.push(this.sy[index])
          ghosts.kind.push(this.kind[index].split("|")[1] ?? INK.text)
          ghosts.level.push(this.level[index])
          ghosts.n += 1
        }
        this.ghosts = ghosts.n ? ghosts : null
      }
      this.sid = session.id
      this.turn = turnKey
      this.count = 0
      this.squads.clear()
      this.failed.clear()
      this.sparks = []
      this.squad.fill(null)
      this.held = -1
      this.lock = 1
      this.pitch = pitchWant - 0.3 // the body tips into view when the focus moves
      this.rs = rsWant
      this.spin = 1.1
      this.notch = 0
      this.notchWant = undefined
    }
    this.pitch += (pitchWant - this.pitch) * ease(fresh ? 0 : 2.2)
    this.rs += (rsWant - this.rs) * ease(1.5)
    this.spin *= Math.exp(-3 * dt)
    this.parX += (parXWant - this.parX) * ease(7)
    this.parY += (parYWant - this.parY) * ease(7)
    this.slow += ((near ? 0.2 : 1) - this.slow) * ease(6) // slower under the pointer, so a dot can be picked
    const view = makeView(core, this.pitch)
    this.view = view
    this.fill = fill

    // The charge at the tip. What the thread writes rises up its wire and gathers where the
    // wire ends: the charge grows with every token that arrived, and each time it holds one
    // dot's worth of tokens it fires that dot into the body. A dot takes at least 0.4 s to
    // charge, and a backlog (a call that reports all it wrote at its end) clears in 2.4 s.
    if (fresh || unit !== this.unit || out < this.shown) this.shown = out
    else if (out > this.shown) this.shown = Math.min(out, this.shown + Math.max(unit / 0.4, (out - this.shown) / 2.4) * dt)
    const count = Math.min(FLOCK_CAP, Math.floor(this.shown / unit + 1e-9))
    this.charge = clamp(this.shown / unit - Math.floor(this.shown / unit + 1e-9), 0, 1)
    this.tip = entry
    this.unit = unit
    this.out = out
    this.assign(session, turn, out, unit, count, now)

    // dots that joined since the last frame
    const spot = [0, 0, 0]
    if (count > this.count) {
      if (!fresh) this.firedAt = now
      const from = toPlane(view, entry.x, entry.y, [0, 0])
      for (let index = this.count; index < count; index += 1) {
        if (fresh) {
          // a change of focus: the new thread's flock gathers from all around and forms up
          const angle = this.random() * TAU
          const lift = (this.random() - 0.5) * 1.6
          const far = core.Rm * (1.5 + this.random() * 0.7)
          spot[0] = Math.cos(angle) * Math.cos(lift) * far
          spot[1] = Math.sin(angle) * Math.cos(lift) * far
          spot[2] = Math.sin(lift) * far
          this.wake[index] = now + this.random() * 260
          this.vx[index] = 0
          this.vy[index] = 0
          this.vz[index] = 0
        } else {
          // fired from the tip toward the north pole: the charge reached one dot's worth
          spot[0] = from[0] + (this.random() - 0.5) * u(6)
          spot[1] = from[1]
          spot[2] = 0
          const dx = -spot[0]
          const dy = -spot[1]
          const dz = this.rs
          const length = Math.hypot(dx, dy, dz) || 1
          this.vx[index] = (dx / length) * u(520)
          this.vy[index] = (dy / length) * u(520)
          this.vz[index] = (dz / length) * u(520)
          this.wake[index] = now + (index - this.count) * 60
        }
        this.x[index] = spot[0]
        this.y[index] = spot[1]
        this.z[index] = spot[2]
        this.squad[index] = null
      }
    }
    this.count = count

    // squads: the dots of a running tool call leave the globe as a satellite on its lane
    const working = session.state === "working"
    const running = new Map()
    if (working) for (const tool of session.phase.tools) running.set(tool.id, tool)
    for (const [id, squad] of this.squads) {
      if (running.has(id)) continue
      this.squads.delete(id)
      for (let index = 0; index < count; index += 1) if (this.squad[index] === id) this.squad[index] = null
      const failed = squad.tool.status === "error"
      const at = this.satAt(squad, now, 0, [0, 0, 0])
      this.sparks.push({ at: now, x: at[0], y: at[1], z: at[2], hex: failed ? INK.bad : spriteHex(PORT_COLOR[squad.port]) })
      if (failed) {
        this.failed.set(id, now)
        this.scatterAt = now
        for (let index = 0; index < count; index += 1) {
          const angle = this.random() * TAU
          const lift = (this.random() - 0.5) * 2
          const kick = u(140 + this.random() * 180)
          this.vx[index] += Math.cos(angle) * Math.cos(lift) * kick
          this.vy[index] += Math.sin(angle) * Math.cos(lift) * kick
          this.vz[index] += Math.sin(lift) * kick
        }
      }
    }
    for (const [id, tool] of running) {
      if (this.squads.has(id) || !count) continue
      const members = []
      for (let index = 0; index < count; index += 1) if (this.meta[index]?.tool?.id === id) members.push(index)
      if (!members.length) {
        // its input is smaller than one dot: the newest free dot of that call goes, or the newest of all
        for (let index = count - 1; index >= 0 && !members.length; index -= 1) if (!this.squad[index] && this.meta[index]?.step?.tools.some((entry) => entry.id === id)) members.push(index)
        for (let index = count - 1; index >= 0 && !members.length; index -= 1) if (!this.squad[index]) members.push(index)
      }
      members.slice(0, 12).forEach((index, place) => {
        this.squad[index] = id
        this.rank[index] = place
      })
      const port = portOf(tool.name)
      this.squads.set(id, { tool, members: members.length, port, phase: phaseOf(id), lap: lapOf(ports?.get(port)) })
    }
    for (const [id, at] of this.failed) if (now - at > 2600) this.failed.delete(id)
    this.sparks = this.sparks.filter((spark) => now - spark.at < 520)

    // how free the flock is: 0 flying, 1 locked into the lattice
    const silent = (now - (session.last || now)) / 1000
    const phase = session.phase.key
    let lockWant = 1
    let paceWant = 1
    if (working && phase !== "tool") {
      lockWant = smooth(silent, 90, 150)
      paceWant = 1 - 0.78 * smooth(silent, 6, 90)
    }
    this.lock += (lockWant - this.lock) * ease(lockWant > this.lock ? 2.2 : 3.2)
    this.pace += (paceWant - this.pace) * ease(1.5)
    const scattering = now - this.scatterAt < 1400
    const lock = scattering ? Math.min(this.lock, 0.15) : this.lock
    // a tool runs: the globe turns one notch a second, like an escapement, for as long as it waits
    if (working && phase === "tool") {
      const beat = Math.floor((now - (session.phase.since ?? now)) / 1000)
      if (beat !== this.notchAt) {
        this.notchAt = beat
        this.notchWant = (this.notchWant ?? this.notch) + TAU / 60
      }
    } else this.notchAt = -1
    if (this.notchWant !== undefined) this.notch += (this.notchWant - this.notch) * ease(16)
    // at rest the globe breathes, slower the longer it has rested, and lies still after 45 minutes
    let breath = 1
    if (!working) {
      const rest = now - (session.idleSince || session.updated || now)
      if (rest < 45 * 60e3 && session.state !== "stalled") breath = 1 + 0.014 * Math.sin((now / (5000 + Math.min(9000, rest / 200))) * TAU)
    }
    const windSpeed = (u(20) + u(1.5) * Math.min(rate, 90)) * this.pace
    this.speed = windSpeed
    const fails = session.failStreak ?? 0
    const jitter = u(26) * Math.min(3, fails) + (scattering ? u(220) : 0)
    this.state = !working ? (session.state === "waiting" ? "formed up, waiting on you" : session.state === "stalled" ? "locked, silent" : session.state === "failed" ? "formed up, the turn failed" : "formed up, at rest") : scattering ? "scattered by a failed call" : phase === "tool" ? "locked, stepping while a tool runs" : this.lock > 0.6 ? "locked, nothing heard" : this.pace < 0.75 ? "slowing, nothing heard" : "flying"
    this.simulate({ count, now, dt: dt * this.slow, lock, windSpeed, jitter, breath, S, scattering })
  }

  simulate({ count, now, dt, lock, windSpeed, jitter, breath, S, scattering }) {
    const { x, y, z, vx, vy, vz, ax, ay, az, wake, squad } = this
    const u = (value) => value * S
    const free = 1 - lock
    const rs = this.rs
    const R2 = u(46) ** 2
    const RS = u(20)
    const RS2 = RS * RS
    const spot = [0, 0, 0]
    const turnBy = this.notch + this.spin
    const inner = rs * 0.82
    const outer = rs * 1.14
    const cruise = Math.max(windSpeed * 2, u(64)) + (scattering ? u(300) : 0)
    for (let i = 0; i < count; i += 1) {
      if (wake[i] > now) continue
      let fx = 0
      let fy = 0
      let fz = 0
      const px = x[i]
      const py = y[i]
      const pz = z[i]
      const mine = squad[i] ? this.squads.get(squad[i]) : null
      if (mine) {
        // out with a tool call: in line behind its satellite, on that equipment's lane
        this.satAt(mine, now, (this.rank[i] + 1) * 0.085, spot)
        fx = (spot[0] - px) * 46 - vx[i] * 13
        fy = (spot[1] - py) * 46 - vy[i] * 13
        fz = (spot[2] - pz) * 46 - vz[i] * 13
      } else {
        if (free > 0.02) {
          let sumX = 0
          let sumY = 0
          let sumZ = 0
          let velX = 0
          let velY = 0
          let velZ = 0
          let apartX = 0
          let apartY = 0
          let apartZ = 0
          let seen = 0
          for (let j = 0; j < count; j += 1) {
            if (j === i || wake[j] > now || squad[j]) continue
            const dx = x[j] - px
            const dy = y[j] - py
            const dz = z[j] - pz
            const d2 = dx * dx + dy * dy + dz * dz
            if (d2 >= R2) continue
            seen += 1
            sumX += dx
            sumY += dy
            sumZ += dz
            velX += vx[j]
            velY += vy[j]
            velZ += vz[j]
            if (d2 < RS2 && d2 > 0.0001) {
              const d = Math.sqrt(d2)
              const push = (1 - d / RS) / d
              apartX -= dx * push
              apartY -= dy * push
              apartZ -= dz * push
            }
          }
          if (seen) {
            fx += (sumX / seen) * 0.8 + (velX / seen - vx[i]) * 2 // cohesion, alignment
            fy += (sumY / seen) * 0.8 + (velY / seen - vy[i]) * 2
            fz += (sumZ / seen) * 0.8 + (velZ / seen - vz[i]) * 2
          }
          fx += apartX * u(430) // separation
          fy += apartY * u(430)
          fz += apartZ * u(430)
          const r = Math.hypot(px, py, pz) || 1
          const nx = px / r
          const ny = py / r
          const nz = pz / r
          const rho = Math.hypot(px, py) || 1
          // the stream: round the axis, clockwise as the eye sees it, at the speed the tokens
          // set. Slower toward the poles, and newer output a little faster than older, so the
          // strata shear into streams.
          const tx = py / rho
          const ty = -px / rho
          const along = vx[i] * tx + vy[i] * ty
          const want = windSpeed * (0.84 + (0.32 * (i + 0.5)) / count) * Math.min(1, rho / rs + 0.25)
          fx += tx * (want - along) * 2.1
          fy += ty * (want - along) * 2.1
          // the skin: the flock keeps to a band from 0.82 to 1.14 of the globe's radius
          const across = vx[i] * nx + vy[i] * ny + vz[i] * nz
          let push = -across * 1.6
          if (r < inner) push += (inner - r) * 26
          else if (r > outer) push -= (r - outer) * (r > outer * 1.5 ? 9 : 26)
          fx += nx * push
          fy += ny * push
          fz += nz * push
          // strata: newer output keeps north, older south
          fz += (rs * 0.9 * (((i + 0.5) / count) * 2 - 1) - pz) * 1.4 - vz[i] * 0.6
          if (jitter) {
            fx += (this.random() - 0.5) * jitter * 16
            fy += (this.random() - 0.5) * jitter * 16
            fz += (this.random() - 0.5) * jitter * 16
          }
          fx *= free
          fy *= free
          fz *= free
        }
        if (lock > 0.02) {
          this.lattice(i, count, rs * breath, turnBy, spot)
          fx += ((spot[0] - px) * 34 - vx[i] * 11) * lock
          fy += ((spot[1] - py) * 34 - vy[i] * 11) * lock
          fz += ((spot[2] - pz) * 34 - vz[i] * 11) * lock
        }
      }
      ax[i] = fx
      ay[i] = fy
      az[i] = fz
    }
    for (let i = 0; i < count; i += 1) {
      if (wake[i] > now) continue
      vx[i] += ax[i] * dt
      vy[i] += ay[i] * dt
      vz[i] += az[i] * dt
      if (!squad[i] && free > 0.5) {
        const speed = Math.hypot(vx[i], vy[i], vz[i])
        const most = Math.hypot(x[i], y[i], z[i]) > outer + u(12) ? u(560) : cruise
        if (speed > most) {
          const k = most / speed
          vx[i] *= k
          vy[i] *= k
          vz[i] *= k
        }
      }
      x[i] += vx[i] * dt
      y[i] += vy[i] * dt
      z[i] += vz[i] * dt
    }
  }

  // Projects every dot to the screen and lists it as a sprite: nearer is larger, brighter and on
  // top; south of the ring plane goes behind the still layer, north of it in front.
  emit(out, { core, S, session, now, dt }) {
    const view = this.view
    if (!view) return
    const u = (value) => value * S
    const own = spriteHex(modelColor(session.model, session.provider))
    const resting = session.state !== "working"
    const span = this.rs * 1.2 + u(12)
    const pr = [0, 0, 0, 0]
    const perSecond = dt > 0 ? 1 / dt : 0
    const odd = this.frame & 1
    for (let i = 0; i < this.count; i += 1) {
      if (this.wake[i] > now) {
        this.level[i] = 0
        continue
      }
      project(view, this.x[i], this.y[i], this.z[i], pr)
      const X = pr[0] + pr[2] * this.parX
      const Y = pr[1] + pr[2] * this.parY
      let level = 1 + Math.floor(clamp((pr[2] + span) / (2 * span), 0, 0.999) * LEVELS)
      if (resting) level = Math.max(1, level - 2)
      const under = this.z[i] < 0 ? 1 : 0
      // a far dot is small and slow on screen: it is brought up to date every other frame
      if (level <= 2 && ((i ^ odd) & 1) && this.level[i] === level && this.under[i] === under && !this.squad[i]) {
        out.push({ key: `fl${i}`, kind: this.kind[i], x: this.sx[i], y: this.sy[i], z: level, under: under === 1 })
        continue
      }
      const meta = this.meta[i]
      const failed = meta?.tool && this.failed.has(meta.tool.id)
      const hex = failed ? INK.bad : meta?.kind === "say" ? INK.text : meta?.kind === "tool" && meta.tool ? spriteHex(PORT_COLOR[portOf(meta.tool.name)]) : own
      // a dot in flight leaves a streak the way it is going
      let kind = `f${level}|${hex}`
      if (level >= STREAK_FROM && perSecond && this.level[i]) {
        const mx = (X - this.sx[i]) * perSecond
        const my = (Y - this.sy[i]) * perSecond
        const speed = Math.hypot(mx, my)
        if (speed > u(46) && speed < u(2400)) {
          const way = ((Math.round(Math.atan2(my, mx) / (TAU / STREAK_DIRS)) % STREAK_DIRS) + STREAK_DIRS) % STREAK_DIRS
          kind = `${streakOf(level, way)}|${hex}`
        }
      }
      this.sx[i] = X
      this.sy[i] = Y
      this.level[i] = level
      this.kind[i] = kind
      this.under[i] = under
      out.push({ key: `fl${i}`, kind, x: X, y: Y, z: level, under: under === 1 })
    }
    // satellites: one per running tool call, on its equipment's lane
    this.sats = []
    for (const [id, squad] of this.squads) {
      const at = this.satAt(squad, now, 0, [0, 0, 0])
      project(view, at[0], at[1], at[2], pr)
      const X = pr[0] + pr[2] * this.parX
      const Y = pr[1] + pr[2] * this.parY
      out.push({ key: `sat:${id}`, kind: `sat|${spriteHex(PORT_COLOR[squad.port])}`, x: X, y: Y, z: LEVELS + 1, under: at[2] < 0 })
      this.sats.push({ id, tool: squad.tool, port: squad.port, x: X, y: Y })
    }
    // where a satellite's result landed: a flash in the equipment's colour, red when it failed
    for (const spark of this.sparks) {
      project(view, spark.x, spark.y, spark.z, pr)
      out.push({ key: `spk${spark.at}`, kind: `${now - spark.at < 220 ? "glow" : "glow2"}|${spark.hex}`, x: pr[0] + pr[2] * this.parX, y: pr[1] + pr[2] * this.parY, z: LEVELS + 2 })
    }
    // the flock that was here before the focus moved: it flies outward and fades
    const ghosts = this.ghosts
    if (ghosts) {
      const age = (now - ghosts.at) / GHOST_MS
      if (age >= 1) this.ghosts = null
      else {
        const e = age * age
        for (let g = 0; g < ghosts.n; g += 1) {
          const level = Math.max(1, ghosts.level[g] - Math.floor(age * 6))
          out.push({ key: `gh${g}`, kind: `f${level}|${ghosts.kind[g]}`, x: core.cx + (ghosts.x[g] - core.cx) * (1 + 2.4 * e), y: core.cy + (ghosts.y[g] - core.cy) * (1 + 2.4 * e), z: 0, under: true })
        }
      }
    }
    this.emitCharge(out, own, u, now)
  }

  // The charge where the thread's wire ends: eight sockets round the tip, lit one by one as
  // tokens arrive (a socket is an eighth of a dot), a glow that grows with them, and a flash
  // each time the charge is full and a dot is fired into the body.
  emitCharge(out, hex, u, now) {
    const tip = this.tip
    if (!tip || !this.out) return
    const lit = Math.floor(this.charge * CHARGE_SOCKETS + 1e-6)
    for (let socket = 0; socket < CHARGE_SOCKETS; socket += 1) {
      const angle = -Math.PI / 2 + (socket / CHARGE_SOCKETS) * TAU
      out.push({ key: `ch${socket}`, kind: `${socket < lit ? "f7" : "f3"}|${hex}`, x: tip.x + Math.cos(angle) * u(19), y: tip.y + Math.sin(angle) * u(19), z: 6 })
    }
    const glow = this.charge > 0.66 ? 3 : this.charge > 0.33 ? 2 : this.charge > 0.04 ? 1 : 0
    if (glow) out.push({ key: "ch-glow", kind: `breath${glow}|${hex}`, x: tip.x, y: tip.y, z: 5 })
    if (now - this.firedAt < 240) out.push({ key: "ch-fire", kind: `${now - this.firedAt < 110 ? "glow" : "glow2"}|${INK.text}`, x: tip.x, y: tip.y, z: 7 })
  }

  // The dot under a point: the nearest to the eye first, then the closest. A dot that was under
  // the pointer a moment ago keeps it while it stays close, so a flying dot can be read.
  hit(px, py, reach) {
    const near = (index, range) => index >= 0 && index < this.count && this.level[index] > 0 && (this.sx[index] - px) ** 2 + (this.sy[index] - py) ** 2 <= range * range
    if (near(this.held, reach * 2)) return this.held
    let best = -1
    let bestLevel = 0
    let bestGap = Infinity
    for (let i = 0; i < this.count; i += 1) {
      if (!this.level[i]) continue
      const gap = (this.sx[i] - px) ** 2 + (this.sy[i] - py) ** 2
      if (gap > reach * reach) continue
      if (this.level[i] > bestLevel || (this.level[i] === bestLevel && gap < bestGap)) {
        best = i
        bestLevel = this.level[i]
        bestGap = gap
      }
    }
    return best
  }

  // True while anything in the flock is still moving on its own.
  get moving() {
    return this.lock < 0.995 || this.squads.size > 0 || this.spin > 0.01 || this.ghosts !== null || this.sparks.length > 0 || this.shown < this.out
  }
}
