// The body's view: how a point of the core's own space lands on the screen.
//
// The core is a body in space, not a dial. Its ring plane is the world's XY plane and its axis
// is Z (north is up). The eye looks down on the plane from the near side: `pitch` is how far
// the plane is tipped away from face on, `roll` turns the whole picture so the right side rides
// higher. A little perspective makes the near side larger than the far side.
//
//   x  to the right along the ring plane
//   y  away from the eye along the ring plane (the far side of a ring is +y)
//   z  up the axis (the north pole of the globe is +z)
//
// Angles on a ring run clockwise as seen on screen, from the far point: a = 0 is the far point,
// a quarter turn is the right end, half a turn is the near point.

import { PORTS } from "./model.mjs"
import { TAU } from "./util.mjs"

export const ROLL = (12 * Math.PI) / 180
const FOCAL = 4.2 // the eye's distance, in ring radii of the largest ring

export function makeView(core, pitch) {
  return { cx: core.cx, cy: core.cy, cp: Math.cos(pitch), sp: Math.sin(pitch), cr: Math.cos(ROLL), sr: Math.sin(ROLL), F: FOCAL * core.Rm, pitch }
}

// World to screen. out = [X, Y, depth toward the eye, scale].
export function project(view, x, y, z, out) {
  const depth = -y * view.sp + z * view.cp
  const up = y * view.cp + z * view.sp
  const scale = view.F / (view.F - depth)
  const px = x * scale
  const py = up * scale
  out[0] = view.cx + px * view.cr - py * view.sr
  out[1] = view.cy - (px * view.sr + py * view.cr)
  out[2] = depth
  out[3] = scale
  return out
}

// A point of a ring of radius R at angle a (clockwise from the far point), lifted by z.
export function ringPoint(view, radius, angle, z, out) {
  return project(view, Math.sin(angle) * radius, Math.cos(angle) * radius, z, out)
}

// Screen to the ring plane (z = 0). out = [x, y].
export function toPlane(view, X, Y, out) {
  const dx = X - view.cx
  const dy = view.cy - Y
  const px = dx * view.cr + dy * view.sr
  const py = -dx * view.sr + dy * view.cr
  const y = (py * view.F) / (view.cp * view.F - py * view.sp)
  out[0] = (px * (view.F + y * view.sp)) / view.F
  out[1] = y
  return out
}

// The angle on a ring (clockwise from the far point, 0 to a full turn) and the radius of the
// plane point under a screen point.
export function ringAngle(view, X, Y) {
  const spot = toPlane(view, X, Y, [0, 0])
  return { angle: (Math.atan2(spot[0], spot[1]) + TAU) % TAU, radius: Math.hypot(spot[0], spot[1]) }
}

// Orbit lanes: one per kind of equipment, each in its own plane around the globe. `tilt` is the
// lane's inclination to the ring plane, `node` where it crosses that plane.
const LANE_TILT = [38, 62, 78, 50, 70, 30, 86]
export const LANES = new Map(PORTS.map((port, index) => [port.id, { tilt: (LANE_TILT[index % LANE_TILT.length] * Math.PI) / 180, node: (index * Math.PI) / PORTS.length + 0.3, index }]))

// A point of a lane of radius R at angle t along it, in world space. out = [x, y, z].
export function lanePoint(lane, radius, t, out) {
  const x1 = Math.cos(t) * radius
  const y1 = Math.sin(t) * radius * Math.cos(lane.tilt)
  const cn = Math.cos(lane.node)
  const sn = Math.sin(lane.node)
  out[0] = x1 * cn - y1 * sn
  out[1] = x1 * sn + y1 * cn
  out[2] = Math.sin(t) * radius * Math.sin(lane.tilt)
  return out
}

// How long one lap of a lane takes: the equipment's usual time for a call, so a call that is
// still circling after one lap is slower than usual. Never faster than a lap in 1.5 s, never
// slower than one in a minute.
export function lapOf(port) {
  const usual = port?.p50 > 0 ? port.p50 : 8000
  return Math.min(60e3, Math.max(1500, usual))
}
