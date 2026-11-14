// The flock: the focused turn's output as a swarm of dots in three dimensions.
//
// One dot stands for so many output tokens (the unit is printed on screen). Every dot knows which
// model call wrote it, which part of that call it is (reasoning, reply, tool input) and when.
// What the swarm does is read from the thread, never from a timer of its own:
//
//   the model is generating     the dots fly as a flock (separation, alignment, cohesion) around
//                               the clock, as fast as the tokens stream
//   nothing heard for a while   the flock slows, and after 150 s of silence locks into a lattice
//   a tool runs                 the flock locks into the lattice and turns one notch a second;
//                               the dots that were the call's input wait at the tip of its spoke
//   the result comes back       the squad returns; a failure scatters the whole flock
//   the turn ends               the flock forms up and rests, breathing slower the longer it rests
//   the context window fills    the inner wall moves out and packs the flock against the rim
//
// Depth is real: the flock lives on a disc that leans back from the screen (further the longer
// the turn runs past its usual length), newer output rides above the disc and older output sinks
// under it, and a dot's size, brightness and stacking follow how near it is.

import { portOf, wroteOf } from "./model.mjs"
import { GOLDEN, PORT_COLOR, spriteHex } from "./theme.mjs"
import { INK, TAU, clamp, modelColor } from "./util.mjs"

export const FLOCK_CAP = 300 // dots; past this one dot stands for more tokens
export const FLOCK_UNITS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000]
const LEVELS = 6
const FOCAL = 620 // perspective: the eye is this many pixels in front of the screen (at scale 1)
const smooth = (value, low, high) => {
  const t = clamp((value - low) / (high - low), 0, 1)
  return t * t * (3 - 2 * t)
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
    this.sx = new Float32Array(n)
    this.sy = new Float32Array(n)
    this.level = new Uint8Array(n)
    this.meta = []
    this.count = 0
    this.sid = null
    this.turn = -1
    this.lock = 1
    this.pace = 1
    this.tilt = 0.35
    this.yaw = 0
    this.pitch = 0
    this.notch = 0
    this.notchAt = 0
    this.slow = 1
    this.scatterAt = 0
    this.failed = new Map() // tool id -> when it came back failed
    this.squads = new Map() // tool id -> { tool, angle }
    this.held = -1
    this.state = "rest"
    this.unit = 100
    this.out = 0
    this.speed = 0
    this.fill = 0
    this.mix = { think: 0, say: 0, tool: 0, unknown: 0 }
    this.metaKey = ""
    this.seed = 1
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

  // The resting place of dot i: a seed head on the disc, the newest output outermost and raised.
  lattice(index, count, rIn, r1, zSpan, turnBy, out) {
    const radius = Math.sqrt(rIn * rIn + ((r1 * r1 - rIn * rIn) * (index + 0.5)) / FLOCK_CAP)
    const angle = index * GOLDEN + turnBy
    out[0] = Math.cos(angle) * radius
    out[1] = Math.sin(angle) * radius
    out[2] = zSpan * (((index + 0.5) / Math.max(1, count)) * 2 - 1)
  }

  // A point of the flat screen as a point of the leaning disc (z = 0), so a squad can wait
  // exactly at the tip of its spoke.
  toDisc(X, Y, focal, out) {
    const ct = Math.cos(this.tilt)
    const st = Math.sin(this.tilt)
    const y = (Y * focal) / (focal * ct + Y * st)
    out[0] = (X * (focal - y * st)) / focal
    out[1] = y
    out[2] = 0
  }

  // One step of the swarm. `input` carries the thread and the instrument's geometry.
  step(input) {
    const { session, turn, now, core, S, rate, entry, clock, pointer, focusSince } = input
    const dt = Math.min(0.05, input.dt)
    const u = (value) => value * S
    const out = session.turn?.out ?? session.lastOut ?? 0
    const unit = flockUnit(out)
    const count = Math.min(FLOCK_CAP, Math.floor(out / unit))
    const turnKey = session.turn?.start ?? 0
    const fresh = session.id !== this.sid || turnKey !== this.turn
    const fill = session.context.limit && session.context.used ? clamp(session.context.used / session.context.limit, 0, 1) : 0
    const r1 = core.r1
    const rIn = core.r0 + (core.r1 - core.r0) * 0.72 * fill
    const zSpan = u(20)
    const focal = FOCAL * S
    const spot = [0, 0, 0]
    this.fill = fill
    this.unit = unit
    this.out = out
    this.assign(session, turn, out, unit, count, now)

    // the lean: 20 degrees, and up to 38 as the turn runs to twice its usual length
    const over = session.turn && session.expect ? clamp((now - session.turn.start) / session.expect.p50 - 1, 0, 1) : 0
    const tiltWant = ((20 + 18 * over) * Math.PI) / 180
    // the view follows the pointer a little, so near and far dots shift against each other
    let yawWant = 0
    let pitchWant = 0
    let near = false
    if (pointer) {
      const dx = (pointer.x - core.cx) / core.frame
      const dy = (pointer.y - core.cy) / core.frame
      if (Math.abs(dx) <= 1.15 && Math.abs(dy) <= 1.15) {
        yawWant = clamp(dx, -1, 1) * 0.2
        pitchWant = clamp(dy, -1, 1) * -0.12
        near = Math.hypot(pointer.x - core.cx, pointer.y - core.cy) < core.RB
      }
    }
    if (fresh) {
      this.sid = session.id
      this.turn = turnKey
      this.count = 0
      this.squads.clear()
      this.failed.clear()
      this.squad.fill(null)
      this.held = -1
      this.lock = 1
      this.tilt = tiltWant
      this.yaw = 0.55 // the body swings into view when the focus moves
      this.notch = 0
    }
    const ease = (rate) => 1 - Math.exp(-rate * dt)
    this.tilt += (tiltWant - this.tilt) * ease(1.2)
    this.yaw += (yawWant - this.yaw) * ease(now - focusSince < 700 ? 4 : 7)
    this.pitch += (pitchWant - this.pitch) * ease(7)
    this.slow += ((near ? 0.2 : 1) - this.slow) * ease(6) // slower under the pointer, so a dot can be picked

    // dots that joined or left since the last frame
    if (count > this.count) {
      const added = count - this.count
      const stagger = fresh ? 0 : clamp(2400 / added, 24, 380)
      for (let index = this.count; index < count; index += 1) {
        if (fresh) {
          // a change of focus: the new thread's flock gathers from all around and forms up
          const angle = this.random() * TAU
          const far = core.frame * (1.1 + this.random() * 0.5)
          spot[0] = Math.cos(angle) * far
          spot[1] = Math.sin(angle) * far
          spot[2] = (this.random() - 0.5) * u(160)
          this.wake[index] = now + this.random() * 260
        } else {
          this.toDisc(entry.x - core.cx + (this.random() - 0.5) * u(10), entry.y - core.cy, focal, spot)
          this.wake[index] = now + (index - this.count) * stagger
        }
        this.x[index] = spot[0]
        this.y[index] = spot[1]
        this.z[index] = spot[2]
        this.vx[index] = fresh ? 0 : u(40)
        this.vy[index] = fresh ? 0 : -u(170)
        this.vz[index] = 0
        this.squad[index] = null
      }
    }
    this.count = count

    // squads: the dots of a running tool call wait at the tip of its spoke
    const working = session.state === "working"
    const running = new Map()
    if (working) for (const tool of session.phase.tools) running.set(tool.id, tool)
    for (const [id, squad] of this.squads) {
      if (running.has(id)) continue
      this.squads.delete(id)
      for (let index = 0; index < count; index += 1) if (this.squad[index] === id) this.squad[index] = null
      if (squad.tool.status === "error") {
        this.failed.set(id, now)
        this.scatterAt = now
        for (let index = 0; index < count; index += 1) {
          const angle = this.random() * TAU
          const kick = u(120 + this.random() * 160)
          this.vx[index] += Math.cos(angle) * kick
          this.vy[index] += Math.sin(angle) * kick
          this.vz[index] += (this.random() - 0.5) * u(120)
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
      for (const index of members.slice(0, 12)) this.squad[index] = id
      this.squads.set(id, { tool, members: members.length })
    }
    for (const [id, at] of this.failed) if (now - at > 2600) this.failed.delete(id)

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
    // a tool runs: the lattice turns one notch a second, like an escapement, for as long as it waits
    if (working && phase === "tool") {
      const beat = Math.floor((now - (session.phase.since ?? now)) / 1000)
      if (beat !== this.notchAt) {
        this.notchAt = beat
        this.notchWant = (this.notchWant ?? this.notch) + TAU / 60
      }
    } else this.notchAt = -1
    if (this.notchWant !== undefined) this.notch += (this.notchWant - this.notch) * ease(16)
    // at rest the formation breathes, slower the longer it has rested, and lies still after 45 minutes
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
    this.simulate({ count, now, dt: dt * this.slow, lock, rIn, r1, zSpan, windSpeed, jitter, breath, focal, core, turn, S, scattering, scale: input.scale })
  }

  simulate({ count, now, dt, lock, rIn, r1, zSpan, windSpeed, jitter, breath, focal, core, turn, S, scattering, scale }) {
    const { x, y, z, vx, vy, vz, ax, ay, az, wake, squad } = this
    const u = (value) => value * S
    const free = 1 - lock
    const R2 = u(46) ** 2
    const RS = u(18)
    const RS2 = RS * RS
    const spot = [0, 0, 0]
    // where each squad waits: just past the tip of its tool's spoke, which grows while it runs
    const holds = new Map()
    if (turn && scale) {
      const longest = Math.log10(600e3)
      for (const [id, entry] of this.squads) {
        const tool = entry.tool
        const span = Math.max(1, (tool.end ?? now) - tool.start)
        const radius = core.RA + u(7) + u(5) + (Math.min(longest, Math.log10(span)) / longest) * u(30) + u(10)
        const angle = clamp((tool.start - turn.start) / scale, 0, 0.999) * TAU - Math.PI / 2
        this.toDisc(Math.cos(angle) * radius, Math.sin(angle) * radius, focal, spot)
        holds.set(id, [spot[0], spot[1]])
      }
    }
    const inner = rIn + u(6)
    const outer = r1 - u(4)
    // where the body of the flock is on its way round: the mean bearing of the free dots
    let meanX = 0
    let meanY = 0
    for (let i = 0; i < count; i += 1) {
      if (wake[i] > now || squad[i]) continue
      const rho = Math.hypot(x[i], y[i]) || 1
      meanX += x[i] / rho
      meanY += y[i] / rho
    }
    const meanLength = Math.hypot(meanX, meanY) || 1
    meanX /= meanLength
    meanY /= meanLength
    const cruise = Math.max(windSpeed * 2, u(64)) + (scattering ? u(300) : 0)
    for (let i = 0; i < count; i += 1) {
      if (wake[i] > now) continue
      let fx = 0
      let fy = 0
      let fz = 0
      const px = x[i]
      const py = y[i]
      const pz = z[i]
      const hold = squad[i] ? holds.get(squad[i]) : null
      if (hold) {
        // out with a tool call: a small orbit lane around the spoke's tip
        const angle = now / 420 + i * 2.1
        fx = (hold[0] + Math.cos(angle) * u(8) - px) * 46 - vx[i] * 13
        fy = (hold[1] + Math.sin(angle) * u(8) - py) * 46 - vy[i] * 13
        fz = -pz * 30 - vz[i] * 10
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
            const dz = (z[j] - pz) * 0.35 // the disc is seen nearly face on: dots keep apart across it, not along the eye
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
          const rho = Math.hypot(px, py) || 1
          const nx = px / rho
          const ny = py / rho
          // the stream: around the clock, clockwise, at the speed the tokens set. Newer output
          // flies a little faster than older, so the head of the flock is the newest and the
          // tail the oldest, and the body holds together on its way round.
          const along = vx[i] * -ny + vy[i] * nx
          const want = windSpeed * (0.84 + (0.32 * (i + 0.5)) / count)
          const gather = u(64) * (nx * meanY - ny * meanX)
          fx += -ny * ((want - along) * 2.1 + gather)
          fy += nx * ((want - along) * 2.1 + gather)
          // the lanes: the context wall inside, the rim outside; a faster dot swings wider
          const across = vx[i] * nx + vy[i] * ny
          let push = -across * 1.4 + (along * along) / rho
          if (rho < inner) push += (inner - rho) * 26
          else if (rho > outer) push -= (rho - outer) * 26
          fx += nx * push
          fy += ny * push
          // newer output rides above the disc, older sinks under it
          fz += (zSpan * (((i + 0.5) / count) * 2 - 1) - pz) * 3 - vz[i] * 1.1
          if (jitter) {
            fx += (this.random() - 0.5) * jitter * 16
            fy += (this.random() - 0.5) * jitter * 16
            fz += (this.random() - 0.5) * jitter * 8
          }
          fx *= free
          fy *= free
          fz *= free
        }
        if (lock > 0.02) {
          this.lattice(i, count, rIn, r1, zSpan, this.notch, spot)
          fx += ((spot[0] * breath - px) * 34 - vx[i] * 11) * lock
          fy += ((spot[1] * breath - py) * 34 - vy[i] * 11) * lock
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
        const most = Math.hypot(x[i], y[i]) > r1 + u(12) ? u(460) : cruise
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

  // Projects every dot to the screen and lists it as a sprite: nearer is larger, brighter and on top.
  emit(out, { core, S, session, now }) {
    const u = (value) => value * S
    const focal = FOCAL * S
    const ct = Math.cos(this.tilt)
    const st = Math.sin(this.tilt)
    const ca = Math.cos(this.yaw)
    const sa = Math.sin(this.yaw)
    const cb = Math.cos(this.pitch)
    const sb = Math.sin(this.pitch)
    const depth = core.r1 * st + u(22)
    const own = spriteHex(modelColor(session.model, session.provider))
    const resting = session.state !== "working"
    const keepX = u(100)
    const keepY = u(62)
    for (let i = 0; i < this.count; i += 1) {
      if (this.wake[i] > now) {
        this.level[i] = 0
        continue
      }
      const y1 = this.y[i] * ct - this.z[i] * st
      const z1 = this.y[i] * st + this.z[i] * ct
      const x2 = this.x[i] * ca + z1 * sa
      const z2 = -this.x[i] * sa + z1 * ca
      const y3 = y1 * cb - z2 * sb
      const z3 = y1 * sb + z2 * cb
      const scale = focal / (focal - z3)
      let dx = x2 * scale
      let dy = y3 * scale
      // the timer in the middle stays clear: a dot that would cross it rides its edge
      const within = (dx / keepX) ** 2 + (dy / keepY) ** 2
      if (within < 1) {
        const k = 1 / Math.sqrt(Math.max(within, 1e-4))
        dx *= k
        dy *= k
      }
      let level = 1 + Math.floor(clamp((z3 + depth) / (2 * depth), 0, 0.999) * LEVELS)
      if (resting) level = Math.max(1, level - 2)
      const meta = this.meta[i]
      const failed = meta?.tool && this.failed.has(meta.tool.id)
      const hex = failed ? INK.bad : meta?.kind === "say" ? INK.text : meta?.kind === "tool" && meta.tool ? spriteHex(PORT_COLOR[portOf(meta.tool.name)]) : own
      this.sx[i] = core.cx + dx
      this.sy[i] = core.cy + dy
      this.level[i] = level
      out.push({ key: `fl${i}`, kind: `f${level}|${hex}`, x: this.sx[i], y: this.sy[i], z: level })
    }
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
    return this.lock < 0.995 || this.squads.size > 0
  }
}
