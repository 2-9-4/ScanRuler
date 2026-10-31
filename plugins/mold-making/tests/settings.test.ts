// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { DEFAULT_MOLD_SETTINGS, MOLD_MODES, parseMoldSettings, validMoldDimension } from '../core/settings'
import { moldSection } from '../app/projectSection'
import { useMold } from '../state/moldStore'

describe('Mold Making configuration', () => {
  it('defines distinct processes for direct rigid tooling, a silicone box and thin negative shell', () => {
    expect(new Set(MOLD_MODES).size).toBe(3)
  })
  it('preserves settings across a project section roundtrip', () => {
    const state = { ...DEFAULT_MOLD_SETTINGS, mode: 'thin-negative-shell' as const, wallThickness: 1.6 }
    const restore = moldSection.prepare(state, { manifest: {} as never, members: new Map() })
    restore()
    expect(moldSection.collect({ sources: {} as never, scanSaved: true, addMember() {} })).toEqual(state)
    useMold.setState({ ...DEFAULT_MOLD_SETTINGS })
  })
  it('rejects malformed project data and non-finite dimensions', () => {
    for (const bad of [null, {}, { ...DEFAULT_MOLD_SETTINGS, mode: 'unknown' },
      { ...DEFAULT_MOLD_SETTINGS, wallThickness: 0 },
      { ...DEFAULT_MOLD_SETTINGS, clearance: -1 },
      { ...DEFAULT_MOLD_SETTINGS, sideMargin: Infinity }]) {
      expect(() => parseMoldSettings(bad)).toThrow()
    }
    expect(validMoldDimension('clearance', 0)).toBe(true)
    expect(validMoldDimension('wallThickness', NaN)).toBe(false)
  })
  it('resets to defaults for older projects without mold settings', () => {
    useMold.getState().setMode('silicone-box')
    moldSection.prepare(undefined, { manifest: {} as never, members: new Map() })()
    expect(useMold.getState().mode).toBe('direct')
  })
})
