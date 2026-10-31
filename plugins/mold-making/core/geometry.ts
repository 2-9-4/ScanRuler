// SPDX-License-Identifier: AGPL-3.0-only
// Mold geometry. All coordinates and parameters are millimetres.
// Reuse the robust Manifold boolean and normal-based offset implementations
// from Mesh Tools rather than implementing a second geometry kernel.
import type { ManifoldToplevel } from 'manifold-3d'
import type { SolidMesh } from '../../../src/app/solids'
import { extentOf } from '../../../src/core/geometry/bounds'
import { booleanMesh, closedness, type Triangles } from '../../mesh-tools/core/boolean'
import { offsetMesh } from '../../mesh-tools/core/offset'
import { signedVolume } from '../../mesh-tools/core/hollow'
import { parseMoldSettings, type MoldSettings } from './settings'

export type Limits = { min: [number, number, number]; max: [number, number, number] }
export interface MoldBuild {
  positions: Float32Array
  indices: Uint32Array
  kind: MoldSettings['mode']
  /** Geometry isn't guaranteed to release from an undercut target. */
  warnings: string[]
  volumeMm3: number
  /** Where one-sided impressions stop. */
  openingZ: number | null
}
const EPS = 1e-6

/** Outward-wound, watertight rectangular solid with shared vertices. */
export function boxSolid(limits: Limits): Triangles {
  const { min: a, max: b } = limits
  for (let k = 0; k < 3; k++) {
    if (!Number.isFinite(a[k]) || !Number.isFinite(b[k]) || b[k] - a[k] <= EPS) {
      throw new Error('Mold block needs finite, nonzero dimensions on every axis.')
    }
  }
  const positions = new Float32Array([
    a[0], a[1], a[2], b[0], a[1], a[2], b[0], b[1], a[2], a[0], b[1], a[2],
    a[0], a[1], b[2], b[0], a[1], b[2], b[0], b[1], b[2], a[0], b[1], b[2],
  ])
  return { positions, indices: new Uint32Array([
    0,2,1, 0,3,2, // bottom
    4,5,6, 4,6,7, // top
    0,1,5, 0,5,4, // front
    1,2,6, 1,6,5, // right
    2,3,7, 2,7,6, // back
    3,0,4, 3,4,7, // left
  ]) }
}

export interface MoldPlan {
  outer: Limits
  /** Subtracting an inner *box* generates a pour-around-master silicone box. */
  innerBox: Limits | null
  /** Z of a flat opening for a one-sided negative mold. */
  openingZ: number | null
}

export function planMold(target: Triangles, settings: MoldSettings): MoldPlan {
  parseMoldSettings(settings)
  if (!target.positions.length || !target.indices.length || target.indices.length % 3 !== 0) {
    throw new Error('Choose a solid target with triangles.')
  }
  const { min, max } = extentOf(target.positions)
  const [dx,dy,dz] = max.map((x,i)=>x-min[i])
  if (![dx,dy,dz].every((v)=>Number.isFinite(v) && v>EPS)) {
    throw new Error('Target needs nonzero 3D extent.')
  }
  if (settings.mode === 'silicone-box') {
    const p = settings.siliconeThickness
    const w = settings.wallThickness
    return {
      outer: {
        min: [min[0]-p-w, min[1]-p-w, min[2]-settings.baseThickness],
        max: [max[0]+p+w, max[1]+p+w, max[2]+p+w],
      },
      innerBox: {
        min: [min[0]-p, min[1]-p, min[2]],
        max: [max[0]+p, max[1]+p, max[2]+p+w+2],
      },
      openingZ: null,
    }
  }
  // Both one-sided routes cut at mid-height: everything above the opening
  // is intentionally not represented. Full-surface molds need a split.
  const z = min[2] + dz/2
  if (settings.mode === 'direct') {
    if (settings.sideMargin <= settings.clearance + EPS) {
      throw new Error('Outer margin must exceed the clearance to keep material around the cavity.')
    }
    return {
      outer: {
        min: [min[0]-settings.sideMargin, min[1]-settings.sideMargin, min[2]-settings.baseThickness],
        max: [max[0]+settings.sideMargin, max[1]+settings.sideMargin, z],
      },
      innerBox: null,
      openingZ: z,
    }
  }
  // A clipping volume for a conformal negative shell; the outer surface
  // comes from the *offset* target, not this rectangular clipping volume.
  const m = settings.clearance + settings.wallThickness + 4
  return {
    outer: {
      min: [min[0]-m, min[1]-m, min[2]-m],
      max: [max[0]+m, max[1]+m, z],
    },
    innerBox: null,
    openingZ: z,
  }
}

function checked(mesh: Triangles, what: string): Triangles & { vertexCount: number } {
  const vertexCount = mesh.positions.length / 3
  const edges = closedness(mesh.indices, vertexCount)
  if (edges.open || edges.bad) throw new Error(
    `${what} is not watertight (${edges.open} open, ${edges.bad} nonmanifold edges). Repair the target in Mesh Tools first.`,
  )
  const volume = signedVolume(mesh.positions, mesh.indices)
  if (!(volume > 0)) throw new Error(`${what} has no positive enclosed volume. Check face orientation in Mesh Tools.`)
  return { ...mesh, vertexCount }
}

function grow(mesh: Triangles, distance: number, onProgress?: (text: string) => void) {
  if (distance === 0) return checked(mesh, 'Target')
  const r = offsetMesh(mesh.positions, mesh.indices, mesh.positions.length/3, { distance }, onProgress)
  return checked({positions:r.positions,indices:r.indices}, 'Offset target')
}

export function buildMold(
  wasm: ManifoldToplevel,
  targetMesh: SolidMesh,
  settings: MoldSettings,
  onProgress?: (text: string) => void,
): MoldBuild {
  const target = checked(targetMesh, 'Target')
  const plan = planMold(target, settings)
  const make = (box: Limits) => {
    const b = boxSolid(box)
    return { ...b, vertexCount: b.positions.length/3 }
  }
  let result: Triangles
  const warnings: string[] = []
  if (settings.mode === 'silicone-box') {
    onProgress?.('Cutting open the silicone containment box…')
    const box = booleanMesh(wasm, make(plan.outer), [boxSolid(plan.innerBox!)], 'subtract')
    result = { positions: box.positions, indices: box.indices }
    warnings.push('The master must be physically attached or supported inside the box. No support keys, seals, or vent channels are generated yet.')
  } else if (settings.mode === 'direct') {
    onProgress?.('Applying cavity clearance…')
    const cutter = grow(target, settings.clearance, onProgress)
    onProgress?.('Subtracting the target from the impression block…')
    const negative = booleanMesh(wasm, make(plan.outer), [cutter], 'subtract')
    result = { positions: negative.positions, indices: negative.indices }
    warnings.push('Single-sided impression only: the upper half of the target is NOT reproduced. This is not a complete two-part mold; check undercuts and release before casting.')
  } else {
    onProgress?.('Offsetting the conformal shell exterior…')
    const outside = grow(target, settings.clearance + settings.wallThickness, onProgress)
    onProgress?.('Opening the shell at its parting plane…')
    const opened = booleanMesh(wasm, outside, [boxSolid(plan.outer)], 'intersect')
    const inside = grow(target, settings.clearance, onProgress)
    onProgress?.('Cutting the negative cavity inside the offset shell…')
    const negative = booleanMesh(wasm,
      { positions: opened.positions, indices: opened.indices, vertexCount: opened.positions.length/3 },
      [inside], 'subtract')
    result = { positions: negative.positions, indices: negative.indices }
    warnings.push('Thin one-sided conformal shell: upper geometry is intentionally omitted; plan a demolding or sacrificial removal method and verify thin walls.')
  }
  const safe = checked(result, 'Generated mold')
  const volumeMm3 = signedVolume(safe.positions, safe.indices)
  return {
    positions: safe.positions,
    indices: safe.indices,
    kind: settings.mode,
    warnings,
    volumeMm3,
    openingZ: plan.openingZ,
  }
}
