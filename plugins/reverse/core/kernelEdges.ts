// SPDX-License-Identifier: AGPL-3.0-only
// The edges of a shape that do not join two faces the way a closed solid's
// do — what "closed" means to a STEP reader, which the kernel's own check
// and a volume do not test: an edge with one face (a hole in the skin), an
// edge with three or more (two pieces of skin running into one edge), an
// edge lying inside its one face (a line where another face only touched
// it, a boolean's leftover of a tangent contact), and an edge whose two
// faces face opposite ways (a knife edge: the body is no thick there). A
// periodic face's seam has that one face on both sides and is none of
// these; nor is a degenerate edge (a sphere's pole, a cone's apex). Then
// the edges a hair long between two faces, which a STEP reader may drop
// from one face only and so read back as a hole in the skin.
// The part of ReKernel's verifyStep and of the body check (kernel.ts) that
// is more than one call to the kernel.

import type { Vec3 } from '../../../src/core/types'
import { cross, dot, len, normalize, scale, sub } from '../../../src/core/vec'
import { parseHistory, vec, xyz } from './kernelMath'
import { HASH_BOUND } from './kernelOps'
import type { Shape } from './kernelTypes'
import type { OcctLike } from './occtTypes'

/** What is odd about an edge: see the head of this file. */
export type OddKind = 'free' | 'inside' | 'nonManifold' | 'knife'

export interface OddEdge {
  hash: number
  kind: OddKind
  /** The edge's middle, mm. */
  at: Vec3
  length: number
  /** The faces beside it, by hash, each once. */
  faces: number[]
}

/** Under this an edge has no length — a pole, an apex — where the kernel
 *  takes it for degenerate (degenerateOnes); one it draws is a hair, and
 *  is looked at as any edge is. */
const NO_LENGTH_MM = 1e-7
/** Under this an edge between two faces is short enough for a STEP reader
 *  to drop from one of them (shortEdges). */
export const SHORT_EDGE_MM = 1e-4
/** Under this an edge the kernel takes for degenerate (degenerateOnes) is a
 *  pole, whatever else its length says. A round that runs out at a corner
 *  leaves a patch with a side closed to a point, marked so and not drawn,
 *  but the point of it is evaluated from the face and need not be quite
 *  one: 1.1e-7 to 1.6e-5 mm at the flange's 17 corners, the same in the body
 *  and read back. The STEP writer leaves such an edge out and the reader
 *  puts it back; that file's edges each go round two faces. A tenth of a
 *  micrometre is a hundredth of what the file's check holds it to its body
 *  by. An edge the kernel draws is looked at whatever its length; one it
 *  does not draw and longer than this too — that is no point. Nor is one
 *  read back where the body has none, however short: the reader marks the
 *  edge it closes a real gap with the same way (the rumble pak's nose, the
 *  mirror holder's raw body, 5e-6 mm long). */
const POLE_MM = 1e-4
/** A pole read back within this of a pole of the body is that one, mm. */
const SAME_POLE_MM = 1e-3

/** The poles among a shape's edges: how many, the longest, where. */
export interface Poles {
  count: number
  longest: number
  at: Vec3[]
}
/** Two outward normals within this many degrees of opposite meet at a
 *  knife edge. */
const KNIFE_DEG = 5
/** Two points of a surface this close are one: a periodic face's two ends
 *  meet there. */
const SAME_POINT_MM = 1e-5

/** Whether the edge through `mid` is a seam of the face: the face closes
 *  on itself across one of its parameters (its two ends meet), and the
 *  edge lies on that end. */
function onSeam(occt: OcctLike, face: number, mid: Vec3): boolean {
  const b = occt.uvBounds(face)
  const { u, v } = occt.uvFromPoint(face, xyz(mid))
  const near = (x: number, lo: number, hi: number) => {
    const tol = 1e-6 * Math.max(1, Math.abs(hi - lo))
    return Math.abs(x - lo) <= tol || Math.abs(x - hi) <= tol
  }
  const same = (a: Vec3, c: Vec3) => len(sub(a, c)) <= SAME_POINT_MM
  const at = (uu: number, vv: number) => vec(occt.pointOnSurface(face, uu, vv))
  if (near(u, b.uMin, b.uMax) && same(at(b.uMin, v), at(b.uMax, v))) return true
  if (near(v, b.vMin, b.vMax) && same(at(u, b.vMin), at(u, b.vMax))) return true
  return false
}

/** Whether the face lies on both sides of the edge at its middle — an
 *  edge inside the face, not on its rim: points a hair off the edge
 *  either way across it, on the surface, are both in the face. */
function faceBothSides(occt: OcctLike, face: number, edge: number, mid: Vec3, length: number): boolean {
  const { first, last } = occt.curveParameters(edge)
  const t = normalize(vec(occt.curveTangent(edge, (first + last) / 2)))
  const uv = occt.uvFromPoint(face, xyz(mid))
  const n = normalize(vec(occt.surfaceNormal(face, uv.u, uv.v)))
  if (!t || !n) return false
  const across = normalize(cross(n, t))
  if (!across) return false
  const step = Math.min(1e-2, Math.max(1e-4, length * 1e-3))
  return [1, -1].every((sign) => {
    const p = sub(mid, scale(across, -sign * step))
    const at = occt.uvFromPoint(face, xyz(p))
    return occt.classifyPointOnFace(face, at.u, at.v) === 'in'
  })
}

/** The edges of a shape the kernel takes for degenerate — a sphere's
 *  pole, a cone's apex, a corner's point an edge of 1e-16 mm — by hash.
 *  occt-wasm does not answer BRep_Tool::Degenerated; its wireframe leaves
 *  those edges out, so an edge it does not draw stands for one. */
function degenerateOnes(occt: OcctLike, shape: Shape): (hash: number) => boolean {
  let drawn: Set<number> | null = null
  return (hash) => {
    if (!drawn) {
      drawn = new Set<number>()
      try {
        const g = occt.wireframe(shape, 1).edgeGroups
        for (let i = 0; i + 2 < g.length; i += 3) if (g[i + 1] > 0) drawn.add(g[i + 2])
      } catch {
        // Nothing drawn: every edge taken for degenerate, as before.
      }
    }
    return !drawn.has(hash)
  }
}

/**
 * The odd edges of a shape (see the head of this file), with how many of
 * each kind there are. `knife` looks at every edge with two faces too —
 * a normal at each side, so it costs more — and `limit` caps the list,
 * the counts counting all. `poles`: the edges left out as poles (POLE_MM)
 * that have a measurable length. `polesAt`, on a part read back: only where
 * the body has one of its own (readBackPoles) — the reader closes a real gap
 * with an edge it marks so too.
 */
export function oddEdges(occt: OcctLike, shape: Shape, { knife = false, limit = Infinity, polesAt }: { knife?: boolean; limit?: number; polesAt?: readonly Vec3[] } = {}): { edges: OddEdge[]; counts: Record<OddKind, number>; poles: Poles } {
  const counts: Record<OddKind, number> = { free: 0, inside: 0, nonManifold: 0, knife: 0 }
  const edges: OddEdge[] = []
  const poles: Poles = { count: 0, longest: 0, at: [] }
  if (occt.isNull(shape)) return { edges, counts, poles }
  const facesOf = parseHistory(occt.edgeToFaceMap(shape, HASH_BOUND))
  const faceHandles = occt.getSubShapes(shape, 'face')
  const edgeHandles = occt.getSubShapes(shape, 'edge')
  try {
    const faceAt = new Map<number, number>()
    for (const h of faceHandles) {
      const hash = occt.hashCode(h, HASH_BOUND)
      if (!faceAt.has(hash)) faceAt.set(hash, h)
    }
    const knifeCos = Math.cos((KNIFE_DEG * Math.PI) / 180)
    const degenerate = degenerateOnes(occt, shape)
    for (const e of edgeHandles) {
      const hash = occt.hashCode(e, HASH_BOUND)
      const faces = [...new Set(facesOf.get(hash) ?? [])]
      if (faces.length === 2 && !knife) continue
      const length = occt.curveLength(e)
      // No length: a pole or an apex — unless the kernel draws it, an
      // edge a hair long a reader may keep with one face.
      if (!(length > NO_LENGTH_MM) && (faces.length === 2 || degenerate(hash))) continue
      const { first, last } = occt.curveParameters(e)
      const mid = vec(occt.curvePointAtParam(e, (first + last) / 2))
      if (faces.length < 2 && length < POLE_MM && degenerate(hash) && (!polesAt || polesAt.some((p) => len(sub(p, mid)) <= SAME_POLE_MM))) {
        poles.count++
        poles.longest = Math.max(poles.longest, length)
        poles.at.push(mid)
        continue
      }
      let kind: OddKind | null = null
      if (faces.length >= 3) kind = 'nonManifold'
      else if (faces.length === 0) kind = 'free'
      else if (faces.length === 1) {
        const face = faceAt.get(faces[0])
        if (face === undefined) kind = 'free'
        else if (!onSeam(occt, face, mid)) kind = faceBothSides(occt, face, e, mid, length) ? 'inside' : 'free'
      } else {
        const normals = faces.map((f) => {
          const face = faceAt.get(f)
          if (face === undefined) return null
          const { u, v } = occt.uvFromPoint(face, xyz(mid))
          return normalize(vec(occt.surfaceNormal(face, u, v)))
        })
        if (normals[0] && normals[1] && dot(normals[0], normals[1]) < -knifeCos) kind = 'knife'
      }
      if (kind === null) continue
      counts[kind]++
      if (edges.length < limit) edges.push({ hash, kind, at: mid, length, faces })
    }
  } finally {
    for (const h of faceHandles) occt.release(h)
    for (const h of edgeHandles) occt.release(h)
  }
  return { edges, counts, poles }
}

/** Points along an edge its distance off a face is read at. */
const OFF_SAMPLES = 8

/** How far an edge lies off a face it bounds, mm: its own curve read at a
 *  few points against the surface. */
function edgeOffFace(occt: OcctLike, edge: number, face: number): { off: number; at: Vec3 } {
  const { first, last } = occt.curveParameters(edge)
  let off = 0
  let at: Vec3 = [0, 0, 0]
  for (let i = 1; i < OFF_SAMPLES; i++) {
    const p = vec(occt.curvePointAtParam(edge, first + ((last - first) * i) / OFF_SAMPLES))
    const { u, v } = occt.uvFromPoint(face, xyz(p))
    const d = len(sub(p, vec(occt.pointOnSurface(face, u, v))))
    if (d > off) [off, at] = [d, p]
  }
  return { off, at }
}

/** How far the worst of a face's edges lies off its surface, mm. */
export function faceEdgesOff(occt: OcctLike, face: number): number {
  const edges = occt.getSubShapes(face, 'edge')
  try {
    return Math.max(0, ...edges.map((e) => edgeOffFace(occt, e, face).off))
  } finally {
    for (const e of edges) occt.release(e)
  }
}

/** The edges of a shape lying farther than `overMm` off a face they bound —
 *  how many, the farthest and where. The kernel's check passes them on the
 *  tolerance each carries; a file carries no tolerances. */
export function strayEdges(occt: OcctLike, shape: Shape, overMm: number): { count: number; off: number; at: Vec3 | null } {
  const out: { count: number; off: number; at: Vec3 | null } = { count: 0, off: 0, at: null }
  if (occt.isNull(shape)) return out
  const faces = occt.getSubShapes(shape, 'face')
  const seen = new Set<number>()
  try {
    for (const face of faces) {
      const edges = occt.getSubShapes(face, 'edge')
      try {
        for (const e of edges) {
          const { off, at } = edgeOffFace(occt, e, face)
          if (!(off > overMm)) continue
          const hash = occt.hashCode(e, HASH_BOUND)
          if (!seen.has(hash)) out.count++
          seen.add(hash)
          if (off > out.off) [out.off, out.at] = [off, at]
        }
      } finally {
        for (const e of edges) occt.release(e)
      }
    }
  } finally {
    for (const f of faces) occt.release(f)
  }
  return out
}

/** An edge between two faces a hair long (shortEdges). */
export interface ShortEdge {
  hash: number
  /** The edge's middle, mm. */
  at: Vec3
  length: number
  /** The two faces beside it, by hash. */
  faces: number[]
}

/**
 * The edges of a shape between two faces shorter than `underMm` that the
 * kernel does not take for degenerate — what a round leaves where it runs
 * out at a corner, a hair long, inside the tolerance of its vertices. The
 * body is closed and valid with it; a STEP reader may drop it from one
 * face only and read back a hole in the skin. A degenerate edge (a pole,
 * a corner's point of 1e-16 mm) round-trips and is left out. `limit`
 * caps the list, the count counting all.
 */
export function shortEdges(occt: OcctLike, shape: Shape, { underMm = SHORT_EDGE_MM, limit = Infinity }: { underMm?: number; limit?: number } = {}): { edges: ShortEdge[]; count: number } {
  const edges: ShortEdge[] = []
  let count = 0
  if (occt.isNull(shape)) return { edges, count }
  const edgeHandles = occt.getSubShapes(shape, 'edge')
  try {
    const short = edgeHandles.filter((e) => occt.curveLength(e) < underMm)
    if (short.length === 0) return { edges, count }
    const facesOf = parseHistory(occt.edgeToFaceMap(shape, HASH_BOUND))
    const degenerate = degenerateOnes(occt, shape)
    const seen = new Set<number>()
    for (const e of short) {
      const hash = occt.hashCode(e, HASH_BOUND)
      if (seen.has(hash)) continue
      seen.add(hash)
      const faces = [...new Set(facesOf.get(hash) ?? [])]
      if (faces.length !== 2 || degenerate(hash)) continue
      count++
      if (edges.length >= limit) continue
      const { first, last } = occt.curveParameters(e)
      edges.push({ hash, at: vec(occt.curvePointAtParam(e, (first + last) / 2)), length: occt.curveLength(e), faces })
    }
  } finally {
    for (const h of edgeHandles) occt.release(h)
  }
  return { edges: edges.sort((a, b) => a.length - b.length), count }
}

/** How many edges, nearest a point by a few points along each, are
 *  measured to it exactly (nearestEdges). */
const NEAREST_CANDIDATES = 24

/** For each point, the edge of the shape nearest it: its hash, its faces
 *  (by hash, each once) and how far off it lies. Null where the shape has
 *  no edge. The edges are first ranked by five points along each, and the
 *  nearest few measured exactly — a body of thousands of edges is not
 *  measured whole for every point. */
export function nearestEdges(occt: OcctLike, shape: Shape, points: readonly Vec3[]): ({ hash: number; faces: number[]; distance: number } | null)[] {
  if (points.length === 0) return []
  const facesOf = parseHistory(occt.edgeToFaceMap(shape, HASH_BOUND))
  const edgeHandles = occt.getSubShapes(shape, 'edge')
  try {
    const samples = edgeHandles.map((e) => {
      const { first, last } = occt.curveParameters(e)
      return [0, 0.25, 0.5, 0.75, 1].map((t) => vec(occt.curvePointAtParam(e, first + (last - first) * t)))
    })
    return points.map((p) => {
      const ranked = samples
        .map((pts, i) => ({ i, d: Math.min(...pts.map((q) => len(sub(q, p)))) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, NEAREST_CANDIDATES)
      const v = occt.makeVertex(p[0], p[1], p[2])
      try {
        let best: { hash: number; faces: number[]; distance: number } | null = null
        for (const { i } of ranked) {
          const e = edgeHandles[i]
          const d = occt.distanceBetween(v, e)
          if (best && d >= best.distance) continue
          const hash = occt.hashCode(e, HASH_BOUND)
          best = { hash, faces: [...new Set(facesOf.get(hash) ?? [])], distance: d }
        }
        return best
      } finally {
        occt.release(v)
      }
    })
  } finally {
    for (const h of edgeHandles) occt.release(h)
  }
}

/** For each point, the face of the shape nearest it, by hash, and how far
 *  off it lies. */
export function nearestFaces(occt: OcctLike, shape: Shape, points: readonly Vec3[]): ({ hash: number; distance: number } | null)[] {
  if (points.length === 0) return []
  const faceHandles = occt.getSubShapes(shape, 'face')
  try {
    return points.map((p) => {
      const v = occt.makeVertex(p[0], p[1], p[2])
      try {
        let best: { hash: number; distance: number } | null = null
        for (const f of faceHandles) {
          const d = occt.distanceBetween(v, f)
          if (!best || d < best.distance) best = { hash: occt.hashCode(f, HASH_BOUND), distance: d }
        }
        return best
      } finally {
        occt.release(v)
      }
    })
  } finally {
    for (const h of faceHandles) occt.release(h)
  }
}

/** Every shell of a shape, solid or not, with how many faces it has and
 *  the middle of its box — the most faces first. */
export function shellSpots(occt: OcctLike, shape: Shape): { faces: number; at: Vec3 }[] {
  if (occt.isNull(shape)) return []
  const shells = occt.getSubShapes(shape, 'shell')
  try {
    return shells
      .map((s) => {
        const b = occt.getBoundingBox(s)
        return { faces: occt.subShapeCount(s, 'face'), at: [(b.xmin + b.xmax) / 2, (b.ymin + b.ymax) / 2, (b.zmin + b.zmax) / 2] as Vec3 }
      })
      .sort((a, b) => b.faces - a.faces)
  } finally {
    for (const s of shells) occt.release(s)
  }
}

/**
 * The faces of a shape narrower than `widthMm` — twice the area over the
 * perimeter, a strip's width — that are not in `own` (by hash): each with
 * its area, width and centroid, the narrowest first. A boolean of two
 * bodies whose walls lie a hair apart leaves strips of them, far thinner
 * than anything the part has, which block a round on the edges beside
 * them. An edge counts once to each face beside it, a seam once. Each
 * face asked is walked round on its own — the whole shape's edge-to-face
 * map costs a second on a knurled body of thousands of faces, and a
 * boolean asks only of the faces it made.
 */
export function narrowFaces(occt: OcctLike, shape: Shape, widthMm: number, own: ReadonlySet<number> = new Set()): { hash: number; area: number; width: number; centroid: Vec3 }[] {
  if (occt.isNull(shape)) return []
  const out: { hash: number; area: number; width: number; centroid: Vec3 }[] = []
  const faceHandles = occt.getSubShapes(shape, 'face')
  try {
    const seen = new Set<number>()
    for (const f of faceHandles) {
      const hash = occt.hashCode(f, HASH_BOUND)
      if (seen.has(hash) || own.has(hash)) continue
      seen.add(hash)
      let p = 0
      const edges = occt.getSubShapes(f, 'edge')
      try {
        for (const e of edges) p += occt.curveLength(e)
      } finally {
        for (const e of edges) occt.release(e)
      }
      if (!(p > 0)) continue
      const area = occt.getSurfaceArea(f)
      const width = (2 * area) / p
      if (width < widthMm) out.push({ hash, area, width, centroid: vec(occt.getSurfaceCenterOfMass(f)) })
    }
  } finally {
    for (const h of faceHandles) occt.release(h)
  }
  return out.sort((a, b) => a.width - b.width)
}
