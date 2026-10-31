// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { buildDeviationReport } from '../../../src/core/deviation/report'
import { computeDeviation } from '../../../src/core/deviation/deviation'
import { identityRigid } from '../../../src/core/deviation/rigid'
import { NominalSurface } from '../../../src/core/deviation/surface'
import { weldTriangleSoup } from '../../../src/core/geometry/weld'
import { parseSTL } from '../../../src/core/parsers/stl'
import { builtAlignment, COMPARE_CHORD_MM, COMPARE_REFERENCE_NAME, compareReferenceStl, mapChord, mergeMeshes, VIEW_MESH_MAP_SPACING, VIEW_MESH_MAP_TOLERANCE } from '../core/compare'
import { readReference, referenceCoverage, subdivideForMap } from '../../../src/core/deviation/onReference'
import { buildSamplePart, SAMPLE_DEPTH, SAMPLE_VOLUME } from '../../../src/core/geometry/samplePart'
import { symmetryAccepted, symmetryPlaneRef, SYMMETRY_LABEL } from '../core/symmetryPlane'
import { describePlaneRef } from '../core/resolve'

/** Twice the signed volume under a closed mesh's triangles, over six. */
function volumeOf(positions: Float32Array, indices: Uint32Array): number {
  let v = 0
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3
    v +=
      positions[a] * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1]) -
      positions[a + 1] * (positions[b] * positions[c + 2] - positions[b + 2] * positions[c]) +
      positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c])
  }
  return v / 6
}

/** Edges that do not bound exactly two triangles, once each way. */
function openEdges(indices: Uint32Array): number {
  const seen = new Map<string, number>()
  for (let t = 0; t < indices.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const key = `${indices[t + k]}>${indices[t + ((k + 1) % 3)]}`
      seen.set(key, (seen.get(key) ?? 0) + 1)
    }
  }
  let open = 0
  for (const [key, n] of seen) {
    const [a, b] = key.split('>')
    if (n !== 1 || seen.get(`${b}>${a}`) !== 1) open++
  }
  return open
}

describe('the sample part of the guided first project', () => {
  it('is a closed, outward-wound mesh of the L’s volume', () => {
    const flat = buildSamplePart(false)
    expect(openEdges(flat.indices)).toBe(0)
    expect(volumeOf(flat.positions, flat.indices)).toBeCloseTo(SAMPLE_VOLUME, 6)
  })

  it('lies askew in its frame, the volume unchanged', () => {
    const posed = buildSamplePart()
    expect(volumeOf(posed.positions, posed.indices)).toBeCloseTo(SAMPLE_VOLUME, 1)
    let zMin = Infinity, zMax = -Infinity
    for (let i = 2; i < posed.positions.length; i += 3) {
      zMin = Math.min(zMin, posed.positions[i])
      zMax = Math.max(zMax, posed.positions[i])
    }
    // Square to the frame its Z extent would be the depth exactly.
    expect(zMax - zMin).toBeGreaterThan(SAMPLE_DEPTH + 2)
  })
})

describe('compare in Deviation', () => {
  it('merges meshes with the indices moved along', () => {
    const a = { positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: Uint32Array.from([0, 1, 2]) }
    const b = { positions: Float32Array.from([0, 0, 5, 1, 0, 5, 0, 1, 5]), indices: Uint32Array.from([2, 1, 0]) }
    const m = mergeMeshes([a, b])
    expect(m.positions.length).toBe(18)
    expect(Array.from(m.indices)).toEqual([0, 1, 2, 5, 4, 3])
    expect(compareReferenceStl([])).toBeNull()
  })

  it('writes a reference the app’s own reader takes back, and the scan it was made of reads zero against it', () => {
    const part = buildSamplePart()
    const stl = compareReferenceStl([part])!
    expect(COMPARE_REFERENCE_NAME.endsWith('.stl')).toBe(true)
    // The reader's way in: a soup, welded on exact bit patterns — which is
    // what makes the reference closed and its sign trustworthy.
    const back = weldTriangleSoup(parseSTL(stl).positions)
    expect(back.indices.length).toBe(part.indices.length)
    expect(back.positions.length).toBe(part.positions.length)
    const surface = new NominalSurface(back.positions, back.indices)
    const values = computeDeviation(surface, part.positions, builtAlignment().transform)
    let worst = 0
    for (const v of values) worst = Math.max(worst, Math.abs(v))
    expect(worst).toBeLessThan(1e-4)
  })

  it('reports no best fit for a built reference', () => {
    const align = builtAlignment()
    expect(Array.from(align.transform.r)).toEqual(Array.from(identityRigid().r))
    const text = buildDeviationReport('scan.stl', COMPARE_REFERENCE_NAME, align, { min: 0, max: 0, mean: 0, rms: 0, sigma: 0, withinTolerance: 1, measured: 1, total: 1, tolerance: 0.1 } as never, 0.1, 1, 60)
    expect(text).toContain('Alignment: none')
    expect(text).not.toContain('fit RMS')
  })
})

describe('the symmetry plane a mirror starts on', () => {
  const found = { normal: [0, 0, 1] as [number, number, number], point: [1, 2, 3] as [number, number, number], rms: 0.02, matched: 3600, sampled: 4000, candidate: 0 }

  it('takes a tight mirror image over most of the samples', () => {
    expect(symmetryAccepted(found)).toBe(true)
    const ref = symmetryPlaneRef(found)
    expect(ref?.kind).toBe('fitted')
    if (ref?.kind !== 'fitted') return
    // The plane through the found point, its sheet zeroed under the origin
    // as a sketch's is.
    expect(ref.frame.origin.map((x) => x + 0)).toEqual([0, 0, 3])
    expect(ref.frame.normal).toEqual([0, 0, 1])
    expect(describePlaneRef(ref, { sections: [], elements: [] })).toBe(SYMMETRY_LABEL)
  })

  it('refuses a loose one, and one that mirrors half the part into thin air', () => {
    expect(symmetryPlaneRef({ ...found, rms: 0.4 })).toBeNull()
    expect(symmetryPlaneRef({ ...found, matched: 1500 })).toBeNull()
    expect(symmetryPlaneRef({ ...found, rms: Infinity, matched: 0 })).toBeNull()
  })
})

describe('the map on the bodies, from their viewport meshes', () => {
  /** A closed cylinder of radius r, 20 mm tall, its side in facets whose
   *  chord stands off the round by at most `chord`. */
  function cylinder(r: number, chord: number) {
    const n = Math.max(8, Math.ceil(Math.PI / Math.acos(1 - chord / r)))
    const positions: number[] = [0, 0, 0, 0, 0, 20]
    const indices: number[] = []
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n
      positions.push(r * Math.cos(a), r * Math.sin(a), 0, r * Math.cos(a), r * Math.sin(a), 20)
    }
    for (let i = 0; i < n; i++) {
      const b0 = 2 + 2 * i, t0 = b0 + 1, b1 = 2 + 2 * ((i + 1) % n), t1 = b1 + 1
      indices.push(b0, b1, t1, b0, t1, t0, 0, b1, b0, 1, t0, t1)
    }
    return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) }
  }

  it('serves maps from the tolerance its chord is a fifth of', () => {
    expect(VIEW_MESH_MAP_TOLERANCE).toBeCloseTo(0.25, 9)
    expect(VIEW_MESH_MAP_SPACING).toBeCloseTo(0.5, 9)
    expect(mapChord(0.25)).toBeCloseTo(0.05, 9)
    expect(mapChord(0.1)).toBeCloseTo(0.02, 9)
    expect(mapChord(0.02)).toBe(COMPARE_CHORD_MM)
  })

  it('reads the bodies against the scan as the fine mesh does, within the chord', () => {
    const scanMesh = cylinder(10.1, 0.002)
    const scan = new NominalSurface(scanMesh.positions, scanMesh.indices)
    const read = (chord: number) => {
      const m = cylinder(10, chord)
      const samples = subdivideForMap(m.positions, m.indices, null, VIEW_MESH_MAP_SPACING)
      const values = readReference(scan, samples, { toScan: identityRigid(), reach: 5, facingDeg: 60 })
      let sum = 0
      for (const v of values) sum += v
      return { readings: values.length, mean: sum / values.length, coverage: referenceCoverage(samples, values, 0.25) }
    }
    const fine = read(COMPARE_CHORD_MM)
    const coarse = read(mapChord(0.25))
    expect(coarse.readings).toBeLessThan(fine.readings)
    expect(Math.abs(coarse.mean - fine.mean)).toBeLessThan(mapChord(0.25))
    expect(coarse.coverage.withinTolerance / coarse.coverage.area).toBeCloseTo(fine.coverage.withinTolerance / fine.coverage.area, 2)
  })
})
