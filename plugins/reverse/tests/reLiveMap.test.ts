// SPDX-License-Identifier: AGPL-3.0-only
// The Reverse engineer workspace's live map: the scan's vertices near a
// body, their signed distance to it, and the colours they wear. The body
// here is a tessellated box standing in for a ghost, the scan a handful of
// points placed where the answer is known.
import { describe, expect, it } from 'vitest'
import { colormapById, rampColor } from '../../../src/core/field/colormap'
import { NominalSurface } from '../../../src/core/deviation/surface'
import { rigidFromAxisAngle } from '../../../src/core/deviation/rigid'
import type { KernelMesh } from '../core/kernel'
import {
  LIVE_MAP_REACH,
  liveMap,
  liveMapReach,
  liveMapScale,
  FAR_INSIDE_RGB,
  paintedSparse,
  paintSparse,
  sparseSummary,
  surfaceOfMeshes,
  verticesNearBox,
} from '../core/liveMap'
import { boxMesh } from '../../../tests/helpers'

const SIZE = 20

/** A closed box as a kernel mesh: the helper's welded triangles. */
function boxKernelMesh(size = SIZE, at: [number, number, number] = [0, 0, 0]): KernelMesh {
  const tris = boxMesh(size, 4)
  const positions = new Float32Array(tris.length)
  for (let i = 0; i < tris.length; i += 3) {
    positions[i] = tris[i] + at[0]
    positions[i + 1] = tris[i + 1] + at[1]
    positions[i + 2] = tris[i + 2] + at[2]
  }
  const indices = new Uint32Array(positions.length / 3)
  for (let i = 0; i < indices.length; i++) indices[i] = i
  return { positions, indices, normals: new Float32Array(positions.length) }
}

/** A scan of a few points, each with a known distance to the box. */
const SCAN: { at: [number, number, number]; expect: number | null }[] = [
  { at: [0, 0, 10], expect: 0 }, // on the top face
  { at: [3, -2, 10.05], expect: 0.05 }, // a hair above it
  { at: [-4, 1, 9.93], expect: -0.07 }, // a hair inside
  { at: [10.5, 0, 0], expect: 0.5 }, // off the +X face, past the range, within reach
  { at: [0, 0, 8], expect: -2 }, // deep inside, past the reach at 0.1 mm
  { at: [0, 0, 40], expect: null }, // far away: not read at all
  { at: [-30, 30, 0], expect: null },
]

function scanPositions(): Float32Array {
  const out = new Float32Array(SCAN.length * 3)
  SCAN.forEach((s, i) => out.set(s.at, i * 3))
  return out
}

describe('the live map', () => {
  it('reads the vertices within reach of the body and no others, signed outward', () => {
    const surface = surfaceOfMeshes([boxKernelMesh()])!
    const range = 0.1
    const field = liveMap(surface, scanPositions(), null, range)
    const reach = liveMapReach(range)
    expect(reach).toBeCloseTo(LIVE_MAP_REACH * range, 9)
    const read = new Map<number, number>()
    for (let i = 0; i < field.subset.length; i++) read.set(field.subset[i], field.values[i])
    SCAN.forEach((s, v) => {
      if (s.expect === null || Math.abs(s.expect) > reach) expect(read.has(v), `vertex ${v} at ${s.at}`).toBe(false)
      else expect(read.get(v), `vertex ${v} at ${s.at}`).toBeCloseTo(s.expect, 6)
    })
    // The subset comes out ascending, the way the compositor walks it.
    for (let i = 1; i < field.subset.length; i++) expect(field.subset[i]).toBeGreaterThan(field.subset[i - 1])
  })

  it('widens its reach with the range', () => {
    const surface = surfaceOfMeshes([boxKernelMesh()])!
    const wide = liveMap(surface, scanPositions(), null, 0.5)
    // Five millimetres of reach now takes the vertex 2 mm inside as well.
    expect([...wide.subset]).toContain(4)
    const values = new Map<number, number>()
    for (let i = 0; i < wide.subset.length; i++) values.set(wide.subset[i], wide.values[i])
    expect(values.get(4)).toBeCloseTo(-2, 6)
  })

  it('sieves by the box before asking the tree', () => {
    const near = verticesNearBox(scanPositions(), null, [-10, -10, -10], [10, 10, 10], 1)
    expect([...near]).toEqual([0, 1, 2, 3, 4])
  })

  it('reads a scan through a transform, as the alignment would carry it', () => {
    // The scan turned a quarter round Z: the point off the +X face lands off
    // the +Y face of the box, still 0.5 mm outside it.
    const turn = rigidFromAxisAngle([0, 0, 1], Math.PI / 2)
    const surface = surfaceOfMeshes([boxKernelMesh()])!
    const field = liveMap(surface, scanPositions(), turn, 0.1)
    const values = new Map<number, number>()
    for (let i = 0; i < field.subset.length; i++) values.set(field.subset[i], field.values[i])
    expect(values.get(3)).toBeCloseTo(0.5, 6)
    expect(values.get(0)).toBeCloseTo(0, 6)
  })

  it('reads several bodies as one part', () => {
    const two = surfaceOfMeshes([boxKernelMesh(), boxKernelMesh(SIZE, [40, 0, 0])])!
    const positions = new Float32Array([0, 0, 10.02, 40, 0, 9.98, 20, 0, 0])
    const field = liveMap(two, positions, null, 0.1)
    expect([...field.subset]).toEqual([0, 1])
    expect(field.values[0]).toBeCloseTo(0.02, 6)
    expect(field.values[1]).toBeCloseTo(-0.02, 6)
    expect(surfaceOfMeshes([])).toBeNull()
    expect(two).toBeInstanceOf(NominalSurface)
  })

  it('paints the ramp within the range, the caps past it, nothing as unmeasured', () => {
    const surface = surfaceOfMeshes([boxKernelMesh()])!
    const range = 0.1
    const field = liveMap(surface, scanPositions(), null, range)
    const jet = colormapById('jet')
    const rgb = paintSparse(field, liveMapScale(range), jet)
    expect(rgb.length).toBe(field.subset.length * 3)
    const green: [number, number, number] = [0, 0, 0]
    rampColor(jet, 0.5, green)
    const colorOf = (v: number): [number, number, number] => {
      const i = field.subset.indexOf(v)
      return [rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]]
    }
    expect(colorOf(0)).toEqual(green)
    expect(colorOf(3)).toEqual([...jet.over])
    // A hair inside reads on the blue side of the ramp, not the cap.
    const inside = colorOf(2)
    expect(inside).not.toEqual([...jet.under])
    expect(inside[2]).toBeGreaterThan(inside[0])
    const summary = sparseSummary(field, range)
    expect(summary).toEqual({ points: 4, within: 3, farInside: 0 })
  })

  it('names the vertices deep inside the bodies, and paints them apart', () => {
    const surface = surfaceOfMeshes([boxKernelMesh()])!
    const range = 0.1
    // Against a ghost nothing deep inside is named; against the bodies the
    // vertex 2 mm in — past the 1 mm reach — is, and no other: the far
    // ones are outside the box, the near ones in the field.
    expect(liveMap(surface, scanPositions(), null, range).farInside).toBeUndefined()
    const field = liveMap(surface, scanPositions(), null, range, true)
    expect([...field.farInside!]).toEqual([4])
    expect([...field.subset]).not.toContain(4)
    expect(sparseSummary(field, range)).toEqual({ points: 4, within: 3, farInside: 1 })
    const painted = paintedSparse(field, liveMapScale(range), colormapById('jet'))
    expect(painted.subset.length).toBe(5)
    expect(painted.rgb.length).toBe(15)
    const i = painted.subset.indexOf(4)
    expect([painted.rgb[i * 3], painted.rgb[i * 3 + 1], painted.rgb[i * 3 + 2]]).toEqual([...FAR_INSIDE_RGB])
    // With a reach that takes the vertex in, it is read, not deep.
    const wide = liveMap(surface, scanPositions(), null, 0.5, true)
    expect([...wide.farInside!]).toEqual([])
    expect([...wide.subset]).toContain(4)
  })
})
