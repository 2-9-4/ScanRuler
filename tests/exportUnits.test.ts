// SPDX-License-Identifier: AGPL-3.0-only
// The exports in the display units: an STL can be written in inches, every
// vertex divided by 25.4 after the pose, and a millimetre sheet's DXF in
// inches when those are the display units — declared so, five decimals.
// Millimetres, the default, are written exactly as they always were.
import { describe, expect, it } from 'vitest'
import { buildMeshFile } from '../src/core/exportMesh'
import { buildBinaryStl } from '../src/core/exportStl'
import { rigidFromAxisAngle } from '../src/core/deviation/rigid'
import { buildFlatDxf, type FlatDxfInput } from '../src/core/flat/dxf'
import { drawingFileUnit } from '../src/core/flat/drawing'
import { fitCirclePoints, flatPoint } from '../src/core/flat/fit'
import type { EdgeChains } from '../src/core/flat/edges'

/** One triangle, its first corner at (25.4, 50.8, -12.7) mm. */
const TRIANGLE = new Float32Array([25.4, 50.8, -12.7, 76.2, 0, 0, 0, 101.6, 0])

/** The first vertex of the first triangle of a binary STL. */
function firstVertex(bytes: Uint8Array): [number, number, number] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const at = 80 + 4 + 12
  return [view.getFloat32(at, true), view.getFloat32(at + 4, true), view.getFloat32(at + 8, true)]
}

describe('STL in inches', () => {
  it('divides every vertex by 25.4', () => {
    const file = buildMeshFile('stl-in', [{ name: 'a', positions: TRIANGLE, indices: null }], null, 'x')!
    expect(file.extension).toBe('stl')
    expect(file.triangles).toBe(1)
    const [x, y, z] = firstVertex(file.bytes)
    expect(x).toBeCloseTo(1, 6)
    expect(y).toBeCloseTo(2, 6)
    expect(z).toBeCloseTo(-0.5, 6)
  })

  it('applies the pose in millimetres before dividing', () => {
    // A quarter turn about z and a 25.4 mm move along x: (25.4, 50.8, -12.7)
    // turns to (-50.8, 25.4, -12.7) and moves to (-25.4, 25.4, -12.7) mm.
    const pose = rigidFromAxisAngle([0, 0, 1], Math.PI / 2)
    pose.t = Float64Array.from([25.4, 0, 0])
    const file = buildMeshFile('stl-in', [{ name: 'a', positions: TRIANGLE, indices: null }], pose, 'x')!
    const [x, y, z] = firstVertex(file.bytes)
    expect(x).toBeCloseTo(-1, 5)
    expect(y).toBeCloseTo(1, 5)
    expect(z).toBeCloseTo(-0.5, 5)
    // The mesh handed in is left as it was.
    expect(TRIANGLE[0]).toBeCloseTo(25.4, 5)
  })

  it('leaves the STL in millimetres as it was written before', () => {
    const file = buildMeshFile('stl', [{ name: 'a', positions: TRIANGLE, indices: null }], null, 'x')!
    expect(file.bytes).toEqual(new Uint8Array(buildBinaryStl(TRIANGLE, null, null, 'x')))
    expect(firstVertex(file.bytes)[0]).toBeCloseTo(25.4, 5)
  })
})

const chains: EdgeChains = {
  points: new Float32Array([0, 0, 254, 0, 254, 254]),
  offsets: new Uint32Array([0, 3]),
}

/** A millimetre sheet 254 × 127 mm at 10 px/mm with a Ø 25.4 circle at
 *  (50.8, 25.4) and a point at (12.7, 0). */
function input(over: Partial<FlatDxfInput> = {}): FlatDxfInput {
  return {
    bounds: { min: [0, 0], max: [254, 127] },
    chains,
    chainUnit: { x: 0.1, y: 0.1 },
    elements: [
      { fit: fitCirclePoints([[63.5, 25.4], [50.8, 38.1], [38.1, 25.4]]), color: '#112233', name: 'Circle 1', value: 'Ø 1.0000 in' },
      { fit: flatPoint([12.7, 0]), color: '#445566', name: 'Point 1', value: 'X 0.5000 · Y 0.0000 in' },
    ],
    alignDir: null,
    turns: 0,
    mirror: false,
    unit: 'mm',
    title: 'ScanRuler 2D measurement',
    scaleNote: 'Scale: CALIBRATED',
    origin: null,
    edgeTolerance: 0,
    ...over,
  }
}

/** The file as code/value pairs. */
function groups(dxf: string): [number, string][] {
  const lines = dxf.split('\n')
  const out: [number, string][] = []
  for (let i = 0; i + 1 < lines.length; i += 2) out.push([Number(lines[i]), lines[i + 1]])
  return out
}

/** A header variable's first value. */
function headerVar(dxf: string, name: string): string | undefined {
  const gs = groups(dxf)
  const i = gs.findIndex(([c, v]) => c === 9 && v === name)
  return i >= 0 ? gs[i + 1][1] : undefined
}

/** The groups of the first entity of a type. */
function entity(dxf: string, type: string): [number, string][] {
  const gs = groups(dxf)
  const start = gs.findIndex(([c, v]) => c === 0 && v === type)
  const end = gs.findIndex(([c], i) => i > start && c === 0)
  return gs.slice(start + 1, end)
}
const val = (g: [number, string][], code: number) => g.find(([c]) => c === code)?.[1]

describe('DXF in inches', () => {
  it('declares inches and writes every coordinate in them, to five decimals', () => {
    const dxf = buildFlatDxf(input({ units: 'in' }))
    expect(headerVar(dxf, '$INSUNITS')).toBe('1')
    expect(headerVar(dxf, '$MEASUREMENT')).toBe('0')
    expect(headerVar(dxf, '$LUPREC')).toBe('5')
    expect(headerVar(dxf, '$EXTMAX')).toBe('10')
    expect(dxf).toContain('One unit is one inch')
    const circle = entity(dxf, 'CIRCLE')
    expect(Number(val(circle, 10))).toBeCloseTo(2, 5)
    expect(Number(val(circle, 20))).toBeCloseTo(1, 5)
    expect(Number(val(circle, 40))).toBeCloseTo(0.5, 5)
    expect(val(entity(dxf, 'POINT'), 10)).toBe('0.5')
    // The chain's pixels go out as inches too: 254 px at 10 px/mm is 1 in.
    const poly = entity(dxf, 'LWPOLYLINE').filter(([c]) => c === 10).map(([, v]) => v)
    expect(poly).toEqual(['0', '1', '1'])
    // Five decimals: 1 mm is 0.03937 in.
    const small = buildFlatDxf(input({ units: 'in', elements: [{ fit: flatPoint([1, 0]), color: '#000000', name: 'P', value: '' }] }))
    expect(val(entity(small, 'POINT'), 10)).toBe('0.03937')
  })

  it('says the thinning tolerance in inches', () => {
    const dxf = buildFlatDxf(input({ units: 'in', edgeTolerance: 0.254 }))
    expect(dxf).toContain('thinned to 0.01 in')
  })

  it('writes millimetres exactly as before without inches asked for', () => {
    const before = buildFlatDxf(input())
    expect(buildFlatDxf(input({ units: 'mm' }))).toBe(before)
    expect(headerVar(before, '$INSUNITS')).toBe('4')
    expect(headerVar(before, '$MEASUREMENT')).toBe('1')
    expect(headerVar(before, '$LUPREC')).toBe('4')
    expect(Number(val(entity(before, 'CIRCLE'), 40))).toBeCloseTo(12.7, 4)
  })

  it('keeps a sheet in pixels in pixels whatever the display units', () => {
    const px = input({ unit: 'px', chainUnit: { x: 1, y: 1 } })
    expect(buildFlatDxf({ ...px, units: 'in' })).toBe(buildFlatDxf(px))
    expect(headerVar(buildFlatDxf({ ...px, units: 'in' }), '$INSUNITS')).toBe('0')
    expect(drawingFileUnit('px', 'in')).toBe('px')
    expect(drawingFileUnit('mm', 'in')).toBe('in')
    expect(drawingFileUnit('mm')).toBe('mm')
  })
})
