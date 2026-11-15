// The moving layer. Paths are polylines the renderer lays out (rail to cell body, axon, synapse,
// parent to child). Three things travel on them:
//   pulses   one event each: a model call, a tool call leaving, its result coming back. They ease
//            out of where they start and into where they land, and their tail stretches with speed
//   streams  dots that keep running along a path for as long as something is in flight
//   flashes  a short glow where a pulse arrived
// Every frame it lists the sprites to show as { key, kind, x, y }. Nothing here is random and
// nothing moves without an event or a state behind it.

const TAIL_LAG_MS = 15

const EASE = {
  linear: (t) => t,
  out: (t) => 1 - (1 - t) ** 3,
  inout: (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
}

export class Flow {
  constructor() {
    this.paths = new Map()
    this.pulses = []
    this.flashes = []
    this.streams = new Map()
    this.streamTick = 0
    this.serial = 0
  }

  clearPaths() {
    this.paths.clear()
  }

  setPath(key, points) {
    const lengths = [0]
    for (let index = 1; index < points.length; index += 1) {
      lengths.push(lengths[index - 1] + Math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1]))
    }
    this.paths.set(key, { points, lengths, total: lengths[lengths.length - 1] })
  }

  // A path made of others end to end. `reverse` walks the result backwards.
  join(key, parts, reverse = false) {
    const points = []
    for (const part of parts) {
      const path = this.paths.get(part)
      if (!path) return false
      for (const point of path.points) {
        const last = points[points.length - 1]
        if (!last || last[0] !== point[0] || last[1] !== point[1]) points.push(point)
      }
    }
    if (points.length < 2) return false
    this.setPath(key, reverse ? points.reverse() : points)
    return true
  }

  at(path, distance) {
    const { points, lengths, total } = path
    if (distance <= 0) return points[0]
    if (distance >= total) return points[points.length - 1]
    let low = 0
    let high = lengths.length - 1
    while (high - low > 1) {
      const middle = (low + high) >> 1
      if (lengths[middle] <= distance) low = middle
      else high = middle
    }
    const span = lengths[high] - lengths[low] || 1
    const amount = (distance - lengths[low]) / span
    return [points[low][0] + (points[high][0] - points[low][0]) * amount, points[low][1] + (points[high][1] - points[low][1]) * amount]
  }

  // One pulse along a path. `speed` is its average speed in pixels a second, `delay` in ms,
  // `tail` the number of segments that follow it.
  pulse({ path, kind, speed = 1400, delay = 0, tail = 0, tailKind = null, flash = null, then = null, ease = "inout", now }) {
    const route = this.paths.get(path)
    if (!route || this.pulses.length > 260) return
    this.serial += 1
    this.pulses.push({ id: this.serial, path, kind, start: now + delay, duration: Math.max(200, (route.total / speed) * 1000), tail, tailKind, flash, then, ease })
  }

  flash(x, y, hex, now, ms = 520) {
    this.serial += 1
    this.flashes.push({ id: this.serial, x, y, hex, start: now, ms })
  }

  // What is in flight right now: [{ key, path, kind, speed, gap }]. A stream that is new grows
  // out from the start of its path, one that is gone simply stops.
  setStreams(list, now) {
    const next = new Map()
    for (const stream of list) {
      if (!this.paths.has(stream.path)) continue
      const known = this.streams.get(stream.key)
      next.set(stream.key, { ...stream, born: known?.born ?? now })
    }
    this.streams = next
  }

  // Writes this frame's sprites into `out` and drops what has finished.
  frame(now, out) {
    const alive = []
    for (const pulse of this.pulses) {
      const path = this.paths.get(pulse.path)
      if (!path) continue
      const age = now - pulse.start
      if (age < 0) {
        alive.push(pulse)
        continue
      }
      if (age >= pulse.duration + pulse.tail * TAIL_LAG_MS) {
        if (pulse.flash) {
          const end = path.points[path.points.length - 1]
          this.flash(end[0], end[1], pulse.flash, now)
        }
        if (pulse.then) pulse.then(now)
        continue
      }
      alive.push(pulse)
      const ease = EASE[pulse.ease] ?? EASE.inout
      if (age <= pulse.duration) {
        const [x, y] = this.at(path, path.total * ease(age / pulse.duration))
        out.push({ key: `p${pulse.id}`, kind: pulse.kind, x, y })
      }
      for (let segment = 1; segment <= pulse.tail; segment += 1) {
        const t = (age - segment * TAIL_LAG_MS) / pulse.duration
        if (t < 0 || t > 1) continue
        const [x, y] = this.at(path, path.total * ease(t))
        out.push({ key: `p${pulse.id}.${segment}`, kind: pulse.tailKind ?? pulse.kind, x, y })
      }
    }
    this.pulses = alive

    for (const stream of this.streams.values()) {
      const path = this.paths.get(stream.path)
      if (!path) continue
      const reach = Math.min(path.total, ((now - stream.born) / 1000) * stream.speed * 4)
      // every other mote of a stream is moved on every other frame, so a stream costs half the
      // placements; a mote that waits stands where it stood a frame ago
      const stale = this.streamedAt ?? now
      for (let index = 0; ; index += 1) {
        const at = (index + this.streamTick) & 1 ? stale : now
        const distance = (((at / 1000) * stream.speed) % stream.gap) + index * stream.gap
        if (distance >= reach) break
        const [x, y] = this.at(path, distance)
        out.push({ key: `s:${stream.key}:${index}`, kind: stream.kind, x, y })
      }
    }
    this.streamedAt = now
    this.streamTick = (this.streamTick + 1) & 1

    const glowing = []
    for (const flash of this.flashes) {
      const age = now - flash.start
      if (age >= flash.ms) continue
      glowing.push(flash)
      out.push({ key: `f${flash.id}`, kind: `${age < flash.ms * 0.45 ? "glow" : "glow2"}|${flash.hex}`, x: flash.x, y: flash.y })
    }
    this.flashes = glowing
  }

  get busy() {
    return this.pulses.length > 0 || this.streams.size > 0 || this.flashes.length > 0
  }
}
