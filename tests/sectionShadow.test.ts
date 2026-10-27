// SPDX-License-Identifier: AGPL-3.0-only
// The shadow of a mesh on a plane: its widest outline seen along the normal,
// the exact silhouette refined whatever the raster's cell, and the contour
// the section keeps read as lines and arcs that never come inside the part.
import { describe, expect, it } from 'vitest'
import { buildMeshGraph } from '../src/core/geometry/buildGraph'
import { shadowMesh, shadowOutline, shiftShadow, type ShadowPiece, type ShadowShape } from '../src/core/section/shadow'
import { sliceMesh } from '../src/core/section/slice'
import { sectionFrameAlong, type SectionFrame } from '../src/core/section/frame'
import type { Pt } from '../src/core/geometry/outline'
import type { Vec3 } from '../src/core/types'
import { boxMesh, cylinderMesh } from './helpers'

const quiet = () => {}

function welded(soup: Float32Array) {
  const g = buildMeshGraph({ kind: 'soup', positions: soup }, quiet)
  return { positions: g.positions, indices: g.indices }
}

/** The plane z = 0 seen from +Z: u = X, v = Y. */
const XY: SectionFrame = { origin: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] }

/** A closed mesh of filled voxels, each face wound outward — boxes, plates
 *  with holes, blocks with notches. */
function voxels(dims: [number, number, number], h: number, filled: (i: number, j: number, k: number) => boolean, at: Vec3 = [0, 0, 0]): Float32Array {
  const [nx, ny, nz] = dims
  const on = (i: number, j: number, k: number) => i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz && filled(i, j, k)
  const tris: number[] = []
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      for (let k = 0; k < nz; k++) {
        if (!on(i, j, k)) continue
        const cell = [i, j, k]
        for (let a = 0; a < 3; a++) {
          for (const s of [1, -1]) {
            const nb = [...cell]
            nb[a] += s
            if (on(nb[0], nb[1], nb[2])) continue
            const b = (a + 1) % 3
            const c = (a + 2) % 3
            const corner = (db: number, dc: number): number[] => {
              const p = [...cell]
              p[a] += s > 0 ? 1 : 0
              p[b] += db
              p[c] += dc
              return [at[0] + p[0] * h, at[1] + p[1] * h, at[2] + p[2] * h]
            }
            const q = s > 0 ? [corner(0, 0), corner(1, 0), corner(1, 1), corner(0, 1)] : [corner(0, 0), corner(0, 1), corner(1, 1), corner(1, 0)]
            tris.push(...q[0], ...q[1], ...q[2], ...q[0], ...q[2], ...q[3])
          }
        }
      }
    }
  }
  return Float32Array.from(tris)
}

/** A rigid turn of every vertex: about Y by a, then about X by b (degrees). */
function turned(positions: Float32Array, a: number, b: number): Float32Array {
  const ca = Math.cos((a * Math.PI) / 180), sa = Math.sin((a * Math.PI) / 180)
  const cb = Math.cos((b * Math.PI) / 180), sb = Math.sin((b * Math.PI) / 180)
  const out = new Float32Array(positions.length)
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2]
    const x1 = ca * x + sa * z
    const z1 = -sa * x + ca * z
    out[i] = x1
    out[i + 1] = cb * y - sb * z1
    out[i + 2] = sb * y + cb * z1
  }
  return out
}

/** The convex hull of points, counter-clockwise. */
function hull(pts: Pt[]): Pt[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: Pt[] = []
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 1e-12) lower.pop()
    lower.push(q)
  }
  const upper: Pt[] = []
  for (const q of p.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 1e-12) upper.pop()
    upper.push(q)
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

const segDist = (p: Pt, a: Pt, b: Pt): number => {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const l2 = dx * dx + dy * dy
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
}

const polyDist = (p: Pt, poly: readonly Pt[]) => {
  let d = Infinity
  for (let i = 0; i < poly.length; i++) d = Math.min(d, segDist(p, poly[i], poly[(i + 1) % poly.length]))
  return d
}

const insidePoly = (q: Pt, p: readonly Pt[]) => {
  let x = false
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if (p[i][1] > q[1] !== p[j][1] > q[1] && q[0] < ((p[j][0] - p[i][0]) * (q[1] - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) x = !x
  }
  return x
}

/** The kept contour as points along every piece, densely. */
function along(sh: ShadowShape, step = 0.01): Pt[] {
  const out: Pt[] = []
  for (const l of sh.loops) {
    for (const p of l.pieces) {
      if (p.kind === 'line') {
        const k = Math.max(1, Math.ceil(Math.hypot(p.to[0] - p.from[0], p.to[1] - p.from[1]) / step))
        for (let j = 0; j <= k; j++) out.push([p.from[0] + ((p.to[0] - p.from[0]) * j) / k, p.from[1] + ((p.to[1] - p.from[1]) * j) / k])
      } else {
        const sweep = p.kind === 'circle' ? 2 * Math.PI : p.sweep
        const a0 = p.kind === 'circle' ? 0 : Math.atan2(p.from[1] - p.center[1], p.from[0] - p.center[0])
        const k = Math.max(2, Math.ceil((Math.abs(sweep) * p.radius) / step))
        for (let j = 0; j <= k; j++) {
          const t = a0 + (sweep * j) / k
          out.push([p.center[0] + p.radius * Math.cos(t), p.center[1] + p.radius * Math.sin(t)])
        }
      }
    }
  }
  return out
}

/** Every chain of the cut on the XY sheet, as [u, v]. */
function chainsUV(cut: { points: Float32Array; offsets: Uint32Array }): Pt[][] {
  const out: Pt[][] = []
  for (let c = 0; c + 1 < cut.offsets.length; c++) {
    const chain: Pt[] = []
    for (let i = cut.offsets[c]; i < cut.offsets[c + 1]; i++) chain.push([cut.points[i * 3], cut.points[i * 3 + 1]])
    out.push(chain)
  }
  return out
}

const area = (p: readonly Pt[]) => {
  let s = 0
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += p[j][0] * p[i][1] - p[i][0] * p[j][1]
  return s / 2
}

describe('the shadow of a mesh on a plane', () => {
  // A cube turned off every axis: seen along Z its outline is the hexagon
  // round the projected corners.
  const cube = turned(boxMesh(20, 4), 30, 20)
  const mesh = welded(cube)
  const corners: Pt[] = []
  for (const sx of [-10, 10]) for (const sy of [-10, 10]) for (const sz of [-10, 10]) {
    const t = turned(Float32Array.from([sx, sy, sz]), 30, 20)
    corners.push([t[0], t[1]])
  }
  const hexagon = hull(corners)

  it('is the hexagon of a turned box, refined onto its exact sides', () => {
    expect(hexagon.length).toBe(6)
    const out = shadowOutline(mesh.positions, mesh.indices, XY, { tolerance: 0.1 })
    expect(out.exact.length).toBe(1)
    expect(out.exact[0].hole).toBe(false)
    for (const p of out.exact[0].points) expect(polyDist(p, hexagon)).toBeLessThan(1e-4)
    // Every corner of the hexagon is reached, to the cell.
    for (const c of hexagon) expect(Math.min(...out.exact[0].points.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1])))).toBeLessThan(0.1)
    // The contour kept: six lines meeting at corners just outside the true
    // ones.
    const [loop] = out.shape.loops
    expect(loop.pieces.every((p) => p.kind === 'line')).toBe(true)
    expect(loop.pieces.length).toBe(6)
    for (const c of hexagon) {
      const near = Math.min(...loop.pieces.map((p) => (p.kind === 'line' ? Math.hypot(p.from[0] - c[0], p.from[1] - c[1]) : Infinity)))
      expect(near).toBeLessThan(0.25)
    }
  })

  it('is never inside the part: between play and play + 2·tolerance outside', () => {
    for (const [play, tolerance] of [[0, 0.1], [0.5, 0.1], [0.05, 0.02], [-0.3, 0.1]]) {
      const out = shadowOutline(mesh.positions, mesh.indices, XY, { tolerance, play })
      const sh = out.shape
      expect(sh.margin.min).toBeGreaterThanOrEqual(play - 1e-6)
      // Checked here independently of the kernel: against the true hexagon.
      for (const p of along(sh)) {
        const d = polyDist(p, hexagon) * (insidePoly(p, hexagon) ? -1 : 1)
        expect(d).toBeGreaterThanOrEqual(play - 1e-4)
        expect(d).toBeLessThanOrEqual(play + 2 * tolerance + 1e-4)
      }
    }
  })

  it('gives a cylinder seen along its axis one round loop, and across it a rectangle', () => {
    const cyl = welded(cylinderMesh(10, 30, 720, 4).positions)
    const out = shadowOutline(cyl.positions, cyl.indices, XY, { tolerance: 0.1 })
    expect(out.exact.length).toBe(1)
    // The 720-gon's flats lie within r(1 − cos(π/720)) of the circle.
    for (const p of out.exact[0].points) {
      const r = Math.hypot(p[0], p[1])
      expect(r).toBeLessThan(10 + 1e-4)
      expect(r).toBeGreaterThan(10 * Math.cos(Math.PI / 720) - 1e-4)
    }
    const [loop] = out.shape.loops
    expect(loop.pieces.length).toBe(1)
    const circle = loop.pieces[0]
    expect(circle.kind).toBe('circle')
    if (circle.kind === 'circle') {
      expect(Math.hypot(circle.center[0], circle.center[1])).toBeLessThan(1e-3)
      expect(circle.radius).toBeGreaterThanOrEqual(10)
      expect(circle.radius).toBeLessThanOrEqual(10.2)
    }
    // Across: the cylinder seen from the side, onto the XZ plane.
    const side: SectionFrame = { origin: [0, 0, 0], normal: [0, -1, 0], basisU: [1, 0, 0], basisV: [0, 0, 1] }
    const across = shadowOutline(cyl.positions, cyl.indices, side, { tolerance: 0.1 })
    expect(across.exact.length).toBe(1)
    const rect: Pt[] = [[-10, -15], [10, -15], [10, 15], [-10, 15]]
    for (const p of across.exact[0].points) expect(polyDist(p, rect)).toBeLessThan(1e-4)
    expect(across.shape.loops[0].pieces.filter((p) => p.kind === 'line').length).toBe(4)
    expect(across.shape.area).toBeGreaterThan(600)
    expect(across.shape.area).toBeLessThan(20.4 * 30.4)
  })

  it('marks the hole of a plate with a through hole, and runs it the other way', () => {
    // 20 × 20 × 2 with a 6 × 6 hole in the middle.
    const plate = welded(voxels([20, 20, 2], 1, (i, j) => !(i >= 7 && i < 13 && j >= 7 && j < 13)))
    const sh = shadowMesh(plate.positions, plate.indices, XY, { tolerance: 0.1 }).shadow
    expect(sh.loops.length).toBe(2)
    const outer = sh.loops.find((l) => !l.hole)!
    const hole = sh.loops.find((l) => l.hole)!
    expect(outer).toBeDefined()
    expect(hole).toBeDefined()
    const signed = (pieces: ShadowPiece[]) => area(along({ ...sh, loops: [{ hole: false, pieces }] }))
    expect(signed(outer.pieces)).toBeGreaterThan(0)
    expect(signed(hole.pieces)).toBeLessThan(0)
    // 400 less 36, give or take the band.
    expect(sh.area).toBeGreaterThan(400 - 36)
    expect(sh.area).toBeLessThan(20.4 * 20.4 - 5.6 * 5.6)
  })

  it('gives two boxes apart two loops', () => {
    const two = welded(voxels([20, 5, 5], 1, (i) => i < 6 || i >= 14))
    const sh = shadowMesh(two.positions, two.indices, XY).shadow
    expect(sh.loops.length).toBe(2)
    expect(sh.loops.every((l) => !l.hole)).toBe(true)
  })

  it('gives an open sheet seen edge-on nothing', () => {
    // A square in the XZ plane, seen along Z.
    const sheet = { positions: Float32Array.from([0, 0, 0, 10, 0, 0, 10, 0, 10, 0, 0, 10]), indices: Uint32Array.from([0, 1, 2, 0, 2, 3]) }
    const cut = shadowMesh(sheet.positions, sheet.indices, XY)
    expect(cut.offsets.length).toBe(1)
    expect(cut.shadow.loops.length).toBe(0)
  })

  it('is the full extent of a block notched top, front and bottom, where every cut is smaller', () => {
    // 40 × 30 × 20 mm, voxels of 1 mm: a groove along X on top, a pocket in
    // the front face (y = 0) between z 5 and 15, a groove along Y underneath.
    const notched = (i: number, j: number, k: number) => {
      if (k >= 16 && j >= 10 && j < 20) return false
      if (j < 4 && k >= 5 && k < 15 && i >= 10 && i < 30) return false
      if (k < 4 && i >= 15 && i < 25) return false
      return true
    }
    const block = welded(voxels([40, 30, 20], 1, notched))
    const sh = shadowMesh(block.positions, block.indices, XY, { tolerance: 0.1 }).shadow
    expect(sh.loops.length).toBe(1)
    expect(sh.area).toBeGreaterThanOrEqual(1200)
    expect(sh.area).toBeLessThan(40.4 * 30.4)
    // The part stands from z 0 to 20, whatever plane the shadow lies on.
    expect(sh.extent.min).toBeCloseTo(0, 5)
    expect(sh.extent.max).toBeCloseTo(20, 5)
    for (const z of [2, 6, 10, 14, 18]) {
      const cut = sliceMesh(block.positions, block.indices, [0, 0, z], [0, 0, 1])
      const cutArea = chainsUV(cut).reduce((s, c) => s + area(c), 0)
      expect(Math.abs(cutArea)).toBeLessThan(1200 - 1)
    }
  })

  it('draws closed loops with the outward direction at every point', () => {
    const plate = welded(voxels([20, 20, 2], 1, (i, j) => !(i >= 7 && i < 13 && j >= 7 && j < 13)))
    const cut = shadowMesh(plate.positions, plate.indices, XY)
    const chains = chainsUV(cut)
    expect(chains.length).toBe(2)
    for (let c = 0; c < chains.length; c++) {
      const ch = chains[c]
      expect(ch[0]).toEqual(ch[ch.length - 1])
      for (let k = 0; k < ch.length - 1; k++) {
        const i = cut.offsets[c] + k
        const n: Pt = [cut.normals![i * 3], cut.normals![i * 3 + 1]]
        expect(Math.hypot(n[0], n[1])).toBeCloseTo(1, 5)
        // A step along the normal leaves the material: out of the plate, or
        // into the hole.
        const out: Pt = [ch[k][0] + n[0] * 0.3, ch[k][1] + n[1] * 0.3]
        const inPlate = out[0] > 0 && out[0] < 20 && out[1] > 0 && out[1] < 20 && !(out[0] > 7 && out[0] < 13 && out[1] > 7 && out[1] < 13)
        expect(inPlate).toBe(false)
      }
    }
  })

  it('refines onto the true silhouette however coarse the cell', () => {
    for (const tolerance of [0.04, 0.1, 0.5, 1]) {
      const out = shadowOutline(mesh.positions, mesh.indices, XY, { tolerance })
      for (const p of out.exact[0].points) expect(polyDist(p, hexagon)).toBeLessThan(1e-4)
    }
    // A cell widened for a big part refines just as well.
    const wide = shadowOutline(mesh.positions, mesh.indices, XY, { tolerance: 0.1, maxCells: 20_000 })
    expect(wide.shape.widened).toBe(true)
    expect(wide.shape.cell).toBeGreaterThan(0.05)
    for (const p of wide.exact[0].points) expect(polyDist(p, hexagon)).toBeLessThan(1e-4)
  })

  it('slides along its normal without being taken again', () => {
    const at = (offset: number) => sectionFrameAlong({ origin: [0, 0, 0], dir: [0, 0, 1], basisU: [1, 0, 0] }, offset)!
    const cut = shadowMesh(mesh.positions, mesh.indices, at(0))
    const moved = shiftShadow(cut, at(7))!
    expect(moved).not.toBeNull()
    expect(moved.points[2]).toBeCloseTo(cut.points[2] + 7, 5)
    expect(moved.shadow!.extent.min).toBeCloseTo(cut.shadow.extent.min - 7, 9)
    // Turned, it has to be taken again.
    const tilted: SectionFrame = { origin: [0, 0, 0], normal: [0, Math.SQRT1_2, Math.SQRT1_2], basisU: [1, 0, 0], basisV: [0, Math.SQRT1_2, -Math.SQRT1_2] }
    expect(shiftShadow(cut, tilted)).toBeNull()
  })
})

describe('a shadow as a section', () => {
  const plate = welded(voxels([20, 30, 4], 1, () => true))
  const side = shadowMesh(plate.positions, plate.indices, XY, { tolerance: 0.1, play: 0.5 })

  it('goes out to DXF and SVG as lines and arcs, not a polyline', async () => {
    const { buildFlatDxf } = await import('../src/core/flat/dxf')
    const { buildFlatSvg } = await import('../src/core/flat/svg')
    const { shadowFlatFits } = await import('../src/core/section/shadow')
    const { projectCut } = await import('../src/core/section/slice')
    const fits = shadowFlatFits(side.shadow)
    expect(fits.filter((f) => f.kind === 'line').length).toBe(4)
    expect(fits.filter((f) => f.kind === 'arc').length).toBe(4)
    const input = {
      bounds: { min: [-5, -5] as [number, number], max: [25, 35] as [number, number] },
      chains: projectCut(side, XY),
      chainUnit: { x: 1, y: 1 },
      edgePieces: fits,
      elements: [],
      alignDir: null,
      turns: 0,
      mirror: false,
      unit: 'mm' as const,
      title: 'ScanRuler 2D measurement — Section 1: part.stl shadow onto XY plane, +0.000 mm',
      scaleNote: 'Scale: millimetres of the 3D scan (a section, not an image)',
    }
    const dxf = buildFlatDxf({ ...input, origin: null, edgeTolerance: 0.01 })
    const lines = dxf.split('\n')
    const count = (type: string) => lines.filter((v, k) => k % 2 === 1 && v === type && lines[k - 1].trim() === '0').length
    expect(count('LWPOLYLINE')).toBe(0)
    expect(count('LINE')).toBe(4)
    expect(count('ARC')).toBe(4)
    // Each arc a quarter turn about a corner, at the offset's radius.
    for (const f of fits) if (f.kind === 'arc') {
      expect(f.sweep).toBeCloseTo(Math.PI / 2, 2)
      expect(f.radius).toBeGreaterThan(0.5)
      expect(f.radius).toBeLessThan(0.75)
    }
    const svg = buildFlatSvg(input)
    expect(svg).not.toContain('<polyline')
    expect((svg.match(/<path d="M [^"]* A /g) ?? []).length).toBe(4)
  })

  it('says it is a shadow in its row and keys its cut by what it was read with', async () => {
    const { describeCut, frameKey } = await import('../src/core/section/frame')
    const { sectionKeyOf } = await import('../src/state/sectionModel')
    expect(describeCut('Plane 1', 3, 0, 'shadow')).toBe('shadow onto Plane 1, +3.000 mm')
    expect(describeCut('Plane 1', -2, 0)).toBe('along Plane 1, −2.000 mm')
    // A cut's key is the frame's, as it always was.
    expect(sectionKeyOf(XY, {})).toBe(frameKey(XY))
    expect(sectionKeyOf(XY, { kind: 'cut' })).toBe(frameKey(XY))
    const a = sectionKeyOf(XY, { kind: 'shadow' })
    expect(a).not.toBe(frameKey(XY))
    expect(sectionKeyOf(XY, { kind: 'shadow', play: 0.2 })).not.toBe(a)
    expect(sectionKeyOf(XY, { kind: 'shadow', tolerance: 0.05 })).not.toBe(a)
    // Extruding changes nothing about the outline.
    expect(sectionKeyOf(XY, { kind: 'shadow', extrude: true })).toBe(a)
  })

  it('is made, saved and loaded with its kind; a cut saves as it always did', async () => {
    const { useStore } = await import('../src/state/store')
    const { sectionKeyOf } = await import('../src/state/sectionModel')
    const { sectionFromJson, sectionToJson } = await import('../src/core/project/manifest')
    useStore.setState(useStore.getInitialState(), true)
    useStore.getState().beginLoad('part.stl')
    useStore.getState().finishLoad(100, 50, 20, [10, 15, 2])
    const make = (kind: 'cut' | 'shadow') => {
      useStore.getState().startSection()
      useStore.getState().setSectionDraftRef('z')
      useStore.getState().setSectionDraftKind(kind)
      if (kind === 'shadow') useStore.getState().setSectionDraftShadow({ play: 0.25 })
      const d = useStore.getState().sectionDraft!
      expect(d.status).toBe('slicing')
      useStore.getState().resolveSectionDraft(sectionKeyOf(d.frame!, d), kind === 'shadow' ? side : { points: side.points, offsets: side.offsets })
      return useStore.getState().commitSection()!
    }
    const shadowId = make('shadow')
    const cutId = make('cut')
    const [shadow, cut] = [shadowId, cutId].map((id) => useStore.getState().sections.find((x) => x.id === id)!)
    expect(shadow.kind).toBe('shadow')
    expect(shadow.play).toBe(0.25)
    expect(shadow.cutKey).toBe(sectionKeyOf(shadow.frame, shadow))
    const sj = JSON.parse(JSON.stringify(sectionToJson(shadow)))
    expect(sj.kind).toBe('shadow')
    expect(sj.play).toBe(0.25)
    const back = sectionFromJson(sj)
    expect(sectionKeyOf(back.frame, back)).toBe(shadow.cutKey)
    const cj = JSON.parse(JSON.stringify(sectionToJson(cut)))
    expect(Object.keys(cj)).not.toContain('kind')
    expect(Object.keys(cj)).not.toContain('play')
    expect(Object.keys(cj)).not.toContain('tolerance')
    // Re-opened and saved, a shadow stays one; turned into a cut it loses
    // the shadow's settings.
    useStore.getState().editSection(shadowId)
    expect(useStore.getState().sectionDraft!.kind).toBe('shadow')
    expect(useStore.getState().sectionDraft!.status).toBe('ready')
    useStore.getState().setSectionDraftKind('cut')
    const d = useStore.getState().sectionDraft!
    useStore.getState().resolveSectionDraft(sectionKeyOf(d.frame!, d), { points: side.points, offsets: side.offsets })
    useStore.getState().commitSection()
    const now = useStore.getState().sections.find((x) => x.id === shadowId)!
    expect(now.kind).toBeUndefined()
    expect(now.play).toBeUndefined()
  })
})

describe('an extruded shadow as a STEP solid', () => {
  const STAMP = '2026-10-27T12:00:00'

  /** A rounded rectangle w × h with corners of radius r about the origin,
   *  counter-clockwise: four lines and four quarter arcs. */
  function roundedRect(w: number, h: number, r: number): ShadowPiece[] {
    const x = w / 2, y = h / 2
    const arc = (c: Pt, a0: number): ShadowPiece => ({
      kind: 'arc',
      from: [c[0] + r * Math.cos(a0), c[1] + r * Math.sin(a0)],
      to: [c[0] + r * Math.cos(a0 + Math.PI / 2), c[1] + r * Math.sin(a0 + Math.PI / 2)],
      center: c,
      radius: r,
      sweep: Math.PI / 2,
    })
    return [
      { kind: 'line', from: [-x + r, -y], to: [x - r, -y] },
      arc([x - r, -y + r], -Math.PI / 2),
      { kind: 'line', from: [x, -y + r], to: [x, y - r] },
      arc([x - r, y - r], 0),
      { kind: 'line', from: [x - r, y], to: [-x + r, y] },
      arc([-x + r, y - r], Math.PI / 2),
      { kind: 'line', from: [-x, y - r], to: [-x, -y + r] },
      arc([-x + r, -y + r], Math.PI),
    ]
  }

  /** A loop run the other way: a hole. */
  const reversed = (pieces: ShadowPiece[]): ShadowPiece[] =>
    pieces
      .slice()
      .reverse()
      .map((p) => (p.kind === 'line' ? { kind: 'line', from: p.to, to: p.from } : p.kind === 'arc' ? { ...p, from: p.to, to: p.from, sweep: -p.sweep } : p))

  const frame: SectionFrame = { origin: [5, -3, 2], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] }

  async function build(prisms: import('../src/core/stepBrep').PrismInput[], style: 'solids' | 'surfaces' = 'solids') {
    const { buildStepFile } = await import('../src/core/exportStep')
    return buildStepFile([], 'part.stl', STAMP, style, [{ name: 'Section 1', elements: [], prisms }])
  }

  async function readBack(text: string) {
    const { parseSTEP } = await import('../src/core/parsers/step')
    const { stepBuffer } = await import('./stepFixtures')
    return parseSTEP(stepBuffer(text))
  }

  function bounds(positions: Float32Array) {
    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < positions.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], positions[i + k])
        max[k] = Math.max(max[k], positions[i + k])
      }
    }
    return { min, max }
  }

  it('makes a rounded rectangle eight side faces and two caps, read back closed', async () => {
    const { openEdgeCount } = await import('./helpers')
    const text = await build([{ frame, outer: roundedRect(30, 20, 3), holes: [], from: -1, to: 9 }])
    expect((text.match(/ADVANCED_FACE\(/g) ?? []).length).toBe(10)
    expect((text.match(/CYLINDRICAL_SURFACE\(/g) ?? []).length).toBe(4)
    expect((text.match(/MANIFOLD_SOLID_BREP\('Section 1'/g) ?? []).length).toBe(1)
    const { mesh, info } = await readBack(text)
    expect(info.warning).toBeNull()
    expect(info.unsound).toBe(false)
    expect(openEdgeCount(mesh.indices!)).toBe(0)
    const { min, max } = bounds(mesh.positions)
    expect(min[0]).toBeCloseTo(5 - 15, 4)
    expect(max[0]).toBeCloseTo(5 + 15, 4)
    expect(min[1]).toBeCloseTo(-3 - 10, 4)
    expect(max[1]).toBeCloseTo(-3 + 10, 4)
    expect(min[2]).toBeCloseTo(2 - 1, 4)
    expect(max[2]).toBeCloseTo(2 + 9, 4)
  })

  it('bores the holes through: a rounded one, a round one', async () => {
    const { openEdgeCount } = await import('./helpers')
    const holes = [
      reversed(roundedRect(6, 4, 1).map((p) => shift(p, [-6, 0]))),
      [{ kind: 'circle', center: [7, 0], radius: 2.5 } as ShadowPiece],
    ]
    const text = await build([{ frame, outer: roundedRect(30, 20, 3), holes, from: 0, to: 5 }])
    // 8 + 8 + 1 side faces and the two caps.
    expect((text.match(/ADVANCED_FACE\(/g) ?? []).length).toBe(19)
    expect((text.match(/FACE_BOUND\(/g) ?? []).length).toBeGreaterThanOrEqual(4)
    const { mesh, info } = await readBack(text)
    expect(info.warning).toBeNull()
    expect(info.unsound).toBe(false)
    expect(openEdgeCount(mesh.indices!)).toBe(0)
    // The volume, by the divergence theorem over the read-back triangles:
    // the block less the two holes.
    let vol = 0
    const p = mesh.positions
    const idx = mesh.indices!
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3
      vol += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6
    }
    const rr = (w: number, h: number, r: number) => w * h - (4 - Math.PI) * r * r
    const want = 5 * (rr(30, 20, 3) - rr(6, 4, 1) - Math.PI * 2.5 * 2.5)
    expect(Math.abs(vol - want) / want).toBeLessThan(0.01)
  })

  it('stands a kernel shadow through the part’s thickness, a block per outer loop', async () => {
    const { sectionPrisms } = await import('../src/app/exports')
    const { openEdgeCount } = await import('./helpers')
    // A plate with a hole beside a lone box: two loops and a hole.
    const parts = welded(voxels([30, 20, 4], 1, (i, j, k) => (i < 20 ? !(i >= 7 && i < 13 && j >= 7 && j < 13) : i >= 24 && j < 6 && k < 2)))
    const cut = shadowMesh(parts.positions, parts.indices, XY, { tolerance: 0.1, play: 0.3 })
    expect(cut.shadow.loops.length).toBe(3)
    const prisms = sectionPrisms({ id: 1, name: 'Section 1', color: '#000', visible: true, frame: XY, ref: 'z', offset: 0, kind: 'shadow', extrude: true, cut })
    expect(prisms.length).toBe(2)
    expect(prisms.reduce((n, p) => n + p.holes.length, 0)).toBe(1)
    for (const p of prisms) {
      expect(p.from).toBeCloseTo(0, 5)
      expect(p.to).toBeCloseTo(4, 5)
    }
    const text = await build(prisms)
    expect((text.match(/MANIFOLD_SOLID_BREP\('Section 1 \(\d\)'/g) ?? []).length).toBe(2)
    const { mesh, info } = await readBack(text)
    expect(info.warning).toBeNull()
    expect(info.unsound).toBe(false)
    expect(openEdgeCount(mesh.indices!)).toBe(0)
    // Not extruded, or not a shadow: no block.
    expect(sectionPrisms({ id: 1, name: 'S', color: '#000', visible: true, frame: XY, ref: 'z', offset: 0, kind: 'shadow', extrude: false, cut })).toEqual([])
    // A shadow is extruded unless told otherwise.
    expect(sectionPrisms({ id: 1, name: 'S', color: '#000', visible: true, frame: XY, ref: 'z', offset: 0, kind: 'shadow', cut }).length).toBe(2)
    expect(sectionPrisms({ id: 1, name: 'S', color: '#000', visible: true, frame: XY, ref: 'z', offset: 0, extrude: true, cut })).toEqual([])
  })

  it('leaves the block out of the construction-surfaces form', async () => {
    const text = await build([{ frame, outer: roundedRect(30, 20, 3), holes: [], from: 0, to: 5 }], 'surfaces')
    expect(text).not.toContain('MANIFOLD_SOLID_BREP')
  })
})

function shift(p: ShadowPiece, d: Pt): ShadowPiece {
  const m = (q: Pt): Pt => [q[0] + d[0], q[1] + d[1]]
  if (p.kind === 'line') return { kind: 'line', from: m(p.from), to: m(p.to) }
  if (p.kind === 'arc') return { ...p, from: m(p.from), to: m(p.to), center: m(p.center) }
  return { ...p, center: m(p.center) }
}

describe('the band on a toothed outline', () => {
  /** A prism 5 mm high on a wavy outline about the origin — r = 20 + 1.5·
   *  sin(12θ), teeth and roots a lines-and-arcs reading finds hard —
   *  fanned from the centre at each end. */
  function gearPrism(n = 1440): { positions: Float32Array; indices: Uint32Array } {
    const pos: number[] = [0, 0, 0, 0, 0, 5]
    for (let i = 0; i < n; i++) {
      const t = (i / n) * 2 * Math.PI
      const r = 20 + 1.5 * Math.sin(12 * t)
      pos.push(r * Math.cos(t), r * Math.sin(t), 0, r * Math.cos(t), r * Math.sin(t), 5)
    }
    const idx: number[] = []
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      const b0 = 2 + i * 2, b1 = 2 + j * 2
      idx.push(0, b1, b0, 1, b0 + 1, b1 + 1, b0, b1, b1 + 1, b0, b1 + 1, b0 + 1)
    }
    return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) }
  }

  it('keeps every piece between play and play + 2·tolerance outside, whatever the reading made of it', () => {
    const gear = gearPrism()
    const n = 1440
    const outline: Pt[] = Array.from({ length: n }, (_, i) => {
      const t = (i / n) * 2 * Math.PI
      const r = 20 + 1.5 * Math.sin(12 * t)
      return [r * Math.cos(t), r * Math.sin(t)]
    })
    for (const [play, tolerance] of [[0, 0.1], [0.5, 0.1], [0.2, 0.05]]) {
      const sh = shadowMesh(gear.positions, gear.indices, XY, { tolerance, play }).shadow
      expect(sh.loops.length).toBe(1)
      expect(sh.margin.min).toBeGreaterThanOrEqual(play - 1e-6)
      expect(sh.margin.max).toBeLessThanOrEqual(play + 2 * tolerance + 1e-6)
      for (const p of along(sh, 0.02)) {
        const d = polyDist(p, outline) * (insidePoly(p, outline) ? -1 : 1)
        expect(d).toBeGreaterThanOrEqual(play - 1e-3)
        expect(d).toBeLessThanOrEqual(play + 2 * tolerance + 1e-3)
      }
    }
  })
})

describe('rounding the corners below an angle', () => {
  /** A prism 5 mm high on a regular n-gon of circumradius r. */
  function polygonPrism(n: number, r: number): { positions: Float32Array; indices: Uint32Array; outline: Pt[] } {
    const outline: Pt[] = Array.from({ length: n }, (_, i) => [r * Math.cos((i / n) * 2 * Math.PI), r * Math.sin((i / n) * 2 * Math.PI)])
    const pos: number[] = [0, 0, 0, 0, 0, 5]
    for (const [x, y] of outline) pos.push(x, y, 0, x, y, 5)
    const idx: number[] = []
    for (let i = 0; i < n; i++) {
      const b0 = 2 + i * 2, b1 = 2 + ((i + 1) % n) * 2
      idx.push(0, b1, b0, 1, b0 + 1, b1 + 1, b0, b1, b1 + 1, b0, b1 + 1, b0 + 1)
    }
    return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx), outline }
  }

  /** The direction a piece runs in at its start, or at its end. */
  const tangent = (p: ShadowPiece, end: boolean): Pt => {
    if (p.kind === 'line') {
      const l = Math.hypot(p.to[0] - p.from[0], p.to[1] - p.from[1])
      return [(p.to[0] - p.from[0]) / l, (p.to[1] - p.from[1]) / l]
    }
    if (p.kind === 'circle') return [0, 0]
    const q = end ? p.to : p.from
    const s = Math.sign(p.sweep)
    return [(-(q[1] - p.center[1]) / p.radius) * s, ((q[0] - p.center[0]) / p.radius) * s]
  }
  /** How far each loop turns where one piece meets the next, degrees. */
  const kinks = (pieces: ShadowPiece[]) =>
    pieces.map((p, k) => {
      const a = tangent(p, true)
      const b = tangent(pieces[(k + 1) % pieces.length], false)
      return (Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1]))) * 180) / Math.PI
    })

  it('rounds a faceted curve smooth below the angle, and keeps it faceted at 0', () => {
    const prism = polygonPrism(24, 20)
    const sharp = shadowMesh(prism.positions, prism.indices, XY, { tolerance: 0.1, smoothDeg: 0 }).shadow
    expect(sharp.smoothDeg).toBe(0)
    expect(sharp.loops[0].pieces.every((p) => p.kind === 'line')).toBe(true)
    expect(Math.max(...kinks(sharp.loops[0].pieces))).toBeGreaterThan(14)

    const smooth = shadowMesh(prism.positions, prism.indices, XY, { tolerance: 0.1 }).shadow
    expect(smooth.smoothDeg).toBe(30)
    const pieces = smooth.loops[0].pieces
    expect(pieces.filter((p) => p.kind === 'arc').length).toBe(24)
    // Every line meets the next piece without a kink.
    expect(Math.max(...kinks(pieces))).toBeLessThan(0.01)
    // And the outline still lies in the band outside the part.
    expect(smooth.margin.min).toBeGreaterThanOrEqual(-1e-6)
    expect(smooth.margin.max).toBeLessThanOrEqual(0.2 + 1e-6)
    for (const p of along(smooth, 0.02)) {
      const d = polyDist(p, prism.outline) * (insidePoly(p, prism.outline) ? -1 : 1)
      expect(d).toBeGreaterThanOrEqual(-1e-3)
      expect(d).toBeLessThanOrEqual(0.2 + 1e-3)
    }
  })

  it('keeps a corner turning more than the angle sharp', () => {
    // An octagon turns 45° at each corner.
    const prism = polygonPrism(8, 20)
    const at30 = shadowMesh(prism.positions, prism.indices, XY, { tolerance: 0.1, smoothDeg: 30 }).shadow
    expect(at30.loops[0].pieces.every((p) => p.kind === 'line')).toBe(true)
    expect(at30.loops[0].pieces.length).toBe(8)
    const at50 = shadowMesh(prism.positions, prism.indices, XY, { tolerance: 0.1, smoothDeg: 50 }).shadow
    expect(at50.loops[0].pieces.filter((p) => p.kind === 'arc').length).toBe(8)
    expect(Math.max(...kinks(at50.loops[0].pieces))).toBeLessThan(0.01)
    expect(at50.margin.min).toBeGreaterThanOrEqual(-1e-6)
    expect(at50.margin.max).toBeLessThanOrEqual(0.2 + 1e-6)
  })

  it('starts a shadow with a millimetre of play, a tenth of tolerance, 30° and extruded', async () => {
    const { shadowParams, specFields } = await import('../src/state/sectionModel')
    expect(shadowParams({ kind: 'shadow' })).toEqual({ play: 1, tolerance: 0.1, smoothDeg: 30, extrude: true })
    // A shadow turned flat or given no play keeps saying so.
    expect(specFields({ kind: 'shadow', play: 0, extrude: false })).toEqual({ kind: 'shadow', play: 0, extrude: false })
    expect(shadowParams(specFields({ kind: 'shadow', play: 0, extrude: false }))).toMatchObject({ play: 0, extrude: false })
  })

  it('takes the shadow again when the angle changes', async () => {
    const { sectionKeyOf } = await import('../src/state/sectionModel')
    expect(sectionKeyOf(XY, { kind: 'shadow' })).toBe(sectionKeyOf(XY, { kind: 'shadow', smoothDeg: 30 }))
    expect(sectionKeyOf(XY, { kind: 'shadow', smoothDeg: 10 })).not.toBe(sectionKeyOf(XY, { kind: 'shadow' }))
  })
})
