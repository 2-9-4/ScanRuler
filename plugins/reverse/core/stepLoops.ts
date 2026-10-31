// SPDX-License-Identifier: AGPL-3.0-only
// Which way each face's loops run in a STEP file, read as a reader that
// takes them at their word reads them — Parasolid's way (Onshape,
// SolidWorks), not OCCT's or meshstep's, which mend a loop that runs the
// wrong way. A face's loops, unrolled onto its surface's own (u, v), must
// go anticlockwise about the face's outward normal: their signed area
// there, times the face's sense, positive. A negative one names the rest
// of the surface instead — three quarters of a ring for a fillet's round.

import type { Vec3 } from '../../../src/core/types'
import { add, cross, dot, len, scale, sub } from '../../../src/core/vec'

interface Ref {
  ref: number
}
type Arg = number | string | boolean | null | Ref | Arg[]
interface Entity {
  type: string
  args: Arg[]
}

/** One face of the file, in its shell's order: its id, its surface's type,
 *  and whether its loops run the right way — null for a surface or an edge
 *  curve this reading does not unroll. */
export interface FaceLoops {
  id: number
  surface: string
  ok: boolean | null
}

/** What a reading of a file's loops comes to: how many faces were read,
 *  of how many, those whose loops run the wrong way, and the faces not
 *  read, counted by their surface's type as the file names it — a plane,
 *  a cylinder, a cone or a torus is read, unless an edge of it is a curve
 *  this reading does not follow; a B-spline, a sphere or a swept surface
 *  never is. */
export interface LoopSummary {
  read: number
  of: number
  wrong: { id: number; surface: string }[]
  unread: Record<string, number>
}

/** The faces' loops summed up — see LoopSummary. */
export function loopSummary(faces: readonly FaceLoops[]): LoopSummary {
  const unread: Record<string, number> = {}
  for (const f of faces) if (f.ok === null) unread[f.surface] = (unread[f.surface] ?? 0) + 1
  return { read: faces.filter((f) => f.ok !== null).length, of: faces.length, wrong: faces.filter((f) => f.ok === false).map((f) => ({ id: f.id, surface: f.surface })), unread }
}

/** Points sampled along each edge: enough that a loop's area is right to
 *  far better than a sign. */
const EDGE_SAMPLES = 64

class Unrollable extends Error {}

/** One entity's text as its type and its arguments. A complex entity —
 *  a B-spline, a unit — comes back with no arguments. */
function parse(s: string): Entity {
  let i = 0
  const skip = () => {
    while (s[i] === ' ') i++
  }
  const value = (): Arg => {
    skip()
    const c = s[i]
    if (c === '(') {
      i++
      const list: Arg[] = []
      skip()
      if (s[i] === ')') {
        i++
        return list
      }
      for (;;) {
        list.push(value())
        skip()
        if (s[i++] === ')') return list
      }
    }
    if (c === "'") {
      const end = s.indexOf("'", i + 1)
      const v = s.slice(i + 1, end)
      i = end + 1
      return v
    }
    if (c === '#') {
      const m = /^#(\d+)/.exec(s.slice(i))!
      i += m[0].length
      return { ref: Number(m[1]) }
    }
    if (c === '.' && /[A-Z_]/.test(s[i + 1])) {
      const end = s.indexOf('.', i + 1)
      const v = s.slice(i + 1, end)
      i = end + 1
      return v === 'T' ? true : v === 'F' ? false : v
    }
    if (c === '*' || c === '$') {
      i++
      return null
    }
    const m = /^[-+0-9.E]+/.exec(s.slice(i))!
    i += m[0].length
    return Number(m[0])
  }
  const head = /^([A-Z_0-9]+)\s*\(/.exec(s)
  if (!head) return { type: 'COMPLEX', args: [] }
  i = head[0].length - 1
  return { type: head[1], args: value() as Arg[] }
}

/** A non-rational B-spline: a point at a parameter, by de Boor, and the
 *  parameter of the sample nearest a point. */
function nonRational(degree: number, poles: Vec3[], mults: number[], knots: number[]) {
  const U = mults.flatMap((m, k) => Array<number>(m).fill(knots[k]))
  const t0 = U[degree]
  const t1 = U[U.length - degree - 1]
  const at = (t: number): Vec3 => {
    let k = degree
    while (k < poles.length - 1 && t >= U[k + 1]) k++
    const d = poles.slice(k - degree, k + 1).map((p) => [...p] as Vec3)
    for (let r = 1; r <= degree; r++) {
      for (let j = degree; j >= r; j--) {
        const i = k - degree + j
        const a = (t - U[i]) / (U[i + degree - r + 1] - U[i])
        d[j] = add(scale(d[j - 1], 1 - a), scale(d[j], a))
      }
    }
    return d[degree]
  }
  const nearest = (q: Vec3) => {
    let best = t0
    let gap = Infinity
    for (let s = 0; s <= 4000; s++) {
      const t = t0 + ((t1 - t0) * s) / 4000
      const g = len(sub(at(t), q))
      if (g < gap) [best, gap] = [t, g]
    }
    return best
  }
  return { at, nearest, t0, t1 }
}

/** Every face of every shell in a STEP file, and whether its loops run the
 *  right way round. */
export function faceLoops(step: string): FaceLoops[] {
  const text = new Map<number, string>()
  for (const m of step.replace(/\r/g, '').matchAll(/#(\d+)\s*=\s*([\s\S]*?);\s*\n/g)) text.set(Number(m[1]), m[2].replace(/\s+/g, ' '))
  const parsed = new Map<number, Entity>()
  const get = (r: Arg): Entity => {
    const id = (r as Ref).ref
    let e = parsed.get(id)
    if (!e) {
      e = parse(text.get(id) ?? '')
      parsed.set(id, e)
    }
    return e
  }
  /** An entity's type as the file names it — for a complex one, its most
   *  telling part: a rational B-spline surface's RATIONAL_B_SPLINE_SURFACE. */
  const typeOf = (r: Arg): string => {
    const e = get(r)
    if (e.type !== 'COMPLEX') return e.type
    const names = [...(text.get((r as Ref).ref) ?? '').matchAll(/([A-Z][A-Z_0-9]*)\s*\(/g)].map((m) => m[1])
    return names.find((n) => n.startsWith('RATIONAL_')) ?? names.find((n) => n.endsWith('_WITH_KNOTS')) ?? names.find((n) => n.endsWith('_SURFACE') && n !== 'BOUNDED_SURFACE') ?? 'COMPLEX'
  }
  const point = (r: Arg): Vec3 => get(r).args[1] as Vec3
  const direction = (r: Arg): Vec3 => {
    const d = get(r).args[1] as Vec3
    return scale(d, 1 / len(d))
  }
  /** An AXIS2_PLACEMENT_3D as an origin and a right-handed frame. */
  const frame = (r: Arg) => {
    const [, at, axis, ref] = get(r).args
    const z = direction(axis)
    const seed = ref ? direction(ref) : Math.abs(z[0]) < 0.9 ? ([1, 0, 0] as Vec3) : ([0, 1, 0] as Vec3)
    const along = sub(seed, scale(z, dot(seed, z)))
    const x = scale(along, 1 / len(along))
    return { o: point(at), x, y: cross(z, x), z }
  }

  /** An edge curve's points from its start vertex to its end. */
  const edgePoints = (r: Arg): Vec3[] => {
    const [, start, end, curveRef, sense] = get(r).args
    let curve = get(curveRef)
    if (curve.type === 'SURFACE_CURVE' || curve.type === 'SEAM_CURVE') curve = get(curve.args[1])
    const a = point(get(start).args[1])
    const b = point(get(end).args[1])
    let at: (t: number) => Vec3
    let t0: number
    let t1: number
    if (curve.type === 'LINE') {
      const p = point(curve.args[1])
      const [, dirRef, magnitude] = get(curve.args[2]).args
      const d = scale(direction(dirRef), magnitude as number)
      at = (t) => add(p, scale(d, t))
      t0 = dot(sub(a, p), d) / dot(d, d)
      t1 = dot(sub(b, p), d) / dot(d, d)
    } else if (curve.type === 'CIRCLE' || curve.type === 'ELLIPSE') {
      const f = frame(curve.args[1])
      const ra = curve.args[2] as number
      const rb = curve.type === 'ELLIPSE' ? (curve.args[3] as number) : ra
      at = (t) => add(f.o, add(scale(f.x, ra * Math.cos(t)), scale(f.y, rb * Math.sin(t))))
      const param = (q: Vec3) => Math.atan2(dot(sub(q, f.o), f.y) / rb, dot(sub(q, f.o), f.x) / ra)
      t0 = param(a)
      t1 = param(b)
      // A conic runs anticlockwise about its axis; the edge goes along it
      // or against it to its end — once round when it closes on itself.
      if (sense) while (t1 <= t0 + 1e-9) t1 += 2 * Math.PI
      else while (t1 >= t0 - 1e-9) t1 -= 2 * Math.PI
    } else if (curve.type === 'B_SPLINE_CURVE_WITH_KNOTS') {
      const [, degree, poleRefs, , , , mults, knots] = curve.args
      const spline = nonRational(degree as number, (poleRefs as Ref[]).map(point), mults as number[], knots as number[])
      at = spline.at
      if ((start as Ref).ref === (end as Ref).ref) [t0, t1] = sense ? [spline.t0, spline.t1] : [spline.t1, spline.t0]
      else [t0, t1] = [spline.nearest(a), spline.nearest(b)]
    } else {
      throw new Unrollable(curve.type)
    }
    return Array.from({ length: EDGE_SAMPLES + 1 }, (_, s) => at(t0 + ((t1 - t0) * s) / EDGE_SAMPLES))
  }

  /** A surface's own (u, v) at a point on it, the angles unwrapped later.
   *  Not a sphere's: a loop through its pole has no u there. */
  const unroller = (s: Entity): ((p: Vec3) => [number, number]) | null => {
    const f = s.type === 'PLANE' || /^(CYLINDRICAL|CONICAL|TOROIDAL)_SURFACE$/.test(s.type) ? frame(s.args[1]) : null
    if (!f) return null
    const local = (p: Vec3): Vec3 => {
      const d = sub(p, f.o)
      return [dot(d, f.x), dot(d, f.y), dot(d, f.z)]
    }
    switch (s.type) {
      case 'PLANE':
        return (p) => {
          const [x, y] = local(p)
          return [x, y]
        }
      case 'CYLINDRICAL_SURFACE':
      case 'CONICAL_SURFACE':
        return (p) => {
          const [x, y, z] = local(p)
          return [Math.atan2(y, x), z]
        }
      default: {
        const major = s.args[2] as number
        return (p) => {
          const [x, y, z] = local(p)
          return [Math.atan2(y, x), Math.atan2(z, Math.hypot(x, y) - major)]
        }
      }
    }
  }
  const unwrap = (previous: number | undefined, a: number) => {
    if (previous === undefined) return a
    while (a - previous > Math.PI) a -= 2 * Math.PI
    while (a - previous < -Math.PI) a += 2 * Math.PI
    return a
  }

  const out: FaceLoops[] = []
  for (const [id, raw] of text) {
    if (!/^(CLOSED|OPEN)_SHELL/.test(raw)) continue
    for (const faceRef of get({ ref: id }).args[1] as Ref[]) {
      const [, bounds, surfaceRef, sameSense] = get(faceRef).args
      const surface = get(surfaceRef)
      const uv = unroller(surface)
      const face = { id: faceRef.ref, surface: typeOf(surfaceRef) }
      if (!uv) {
        out.push({ ...face, ok: null })
        continue
      }
      const angularU = surface.type !== 'PLANE'
      const angularV = surface.type === 'TOROIDAL_SURFACE'
      try {
        let area = 0
        for (const boundRef of bounds as Ref[]) {
          const [, loopRef, boundSense] = get(boundRef).args
          let points: Vec3[] = []
          for (const edgeRef of get(loopRef).args[1] as Ref[]) {
            const [, , , edge, edgeSense] = get(edgeRef).args
            const p = edgePoints(edge)
            points.push(...(edgeSense ? p : p.reverse()))
          }
          if (!boundSense) points = points.reverse()
          let pu: number | undefined
          let pv: number | undefined
          const poly = points.map((p) => {
            let [u, v] = uv(p)
            if (angularU) u = unwrap(pu, u)
            if (angularV) v = unwrap(pv, v)
            pu = u
            pv = v
            return [u, v]
          })
          for (let k = 0; k < poly.length; k++) {
            const [x1, y1] = poly[k]
            const [x2, y2] = poly[(k + 1) % poly.length]
            area += (x1 * y2 - x2 * y1) / 2
          }
        }
        out.push({ ...face, ok: area * (sameSense ? 1 : -1) > 0 })
      } catch (e) {
        if (!(e instanceof Unrollable)) throw e
        out.push({ ...face, ok: null })
      }
    }
  }
  return out
}
