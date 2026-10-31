// SPDX-License-Identifier: AGPL-3.0-only
// Regression fixtures assert the result is a closed, correctly dimensioned
// printable solid; not just that the Boolean returned without throwing.
import { beforeAll, describe, expect, it } from 'vitest'
import Module, { type ManifoldToplevel } from 'manifold-3d'
import { DEFAULT_MOLD_SETTINGS } from '../core/settings'
import { boxSolid, buildMold } from '../core/geometry'
import { closedness } from '../../mesh-tools/core/boolean'

let wasm: ManifoldToplevel
beforeAll(async () => { wasm = await Module(); wasm.setup() })
const master = boxSolid({ min: [-5,-4,0], max: [5,4,10] })

describe('Mold Making printable solids', () => {
  it('makes a closed, correctly cut single-sided direct impression', () => {
    const result = buildMold(wasm, master, { ...DEFAULT_MOLD_SETTINGS, clearance: 0 })
    expect(result.openingZ).toBe(5)
    expect(result.volumeMm3).toBeCloseTo(5216, 1)
    expect(closedness(result.indices, result.positions.length/3)).toEqual({open:0,bad:0})
    expect(result.warnings.join(' ')).toMatch(/upper half/)
  })
  it('makes a sealed-bottom, open-top box for a physical silicone master', () => {
    const result = buildMold(wasm, master, { ...DEFAULT_MOLD_SETTINGS, mode: 'silicone-box' })
    expect(result.volumeMm3).toBeCloseTo(16880, 1)
    expect(closedness(result.indices, result.positions.length/3)).toEqual({open:0,bad:0})
    expect(result.warnings.join(' ')).toMatch(/physically attached/)
  })
  it('refuses to silently generate a mold from an open scan', () => {
    const broken = {positions:master.positions,indices:master.indices.slice(3)}
    expect(() => buildMold(wasm, broken, DEFAULT_MOLD_SETTINGS)).toThrow(/not watertight/)
  })
})
