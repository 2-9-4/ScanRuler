// SPDX-License-Identifier: AGPL-3.0-only
import {describe,expect,it} from 'vitest'
import {boxSolid,planMold} from '../core/geometry'
import {planVerticalChannels,topSurfaceAt} from '../core/pourChannels'
import {DEFAULT_MOLD_SETTINGS,parseMoldSettings} from '../core/settings'

const cube=boxSolid({min:[-5,-5,0],max:[5,5,10]})
const bounds={min:[-5,-5,0],max:[5,5,10]} as const
const target={min:[...bounds.min] as [number,number,number],max:[...bounds.max] as [number,number,number]}

describe('Opt-in direct-mold sprues, funnels and vents (MOLD-012)',()=>{
  it('finds the actual top triangle at an XY point instead of assuming a target bound',()=>{
    expect(topSurfaceAt(cube,0,0)).toBeCloseTo(10)
    expect(topSurfaceAt(cube,4,4)).toBeCloseTo(10)
    expect(topSurfaceAt(cube,7,0)).toBeNull()
    // Two closed islands have a spanning bounding box but no master at X=0.
    const left=boxSolid({min:[-8,-2,0],max:[-4,2,10]})
    const right=boxSolid({min:[4,-2,0],max:[8,2,10]})
    const combined={positions:Float32Array.from([...left.positions,...right.positions]),
      indices:Uint32Array.from([...left.indices,...right.indices.map(i=>i+8)])}
    expect(topSurfaceAt(combined,0,0)).toBeNull()
  })
  it('keeps channels disabled in new and migrated recipes',()=>{
    expect(DEFAULT_MOLD_SETTINGS.pourEnabled).toBe(false)
    expect(DEFAULT_MOLD_SETTINGS.ventsEnabled).toBe(false)
    const old=Object.fromEntries(Object.entries(DEFAULT_MOLD_SETTINGS).filter(
      ([key])=>!['pourEnabled','ventsEnabled','pourPoint','ventPoints',
        'pourDiameter','pourFunnelDiameter','pourFunnelDepth','ventDiameter'].includes(key)))
    expect(parseMoldSettings(old).pourEnabled).toBe(false)
    expect(parseMoldSettings(old).ventPoints).toEqual([[0.75,0.75]])
    expect(()=>parseMoldSettings({...DEFAULT_MOLD_SETTINGS,
      pourEnabled:true,mode:'silicone-box'})).toThrow(/multipart direct/)
    expect(()=>parseMoldSettings({...DEFAULT_MOLD_SETTINGS,
      ventsEnabled:true,parts:1})).toThrow(/multipart direct/)
  })
  it('checks real cavity contact, exterior margins and split collisions',()=>{
    const s={...DEFAULT_MOLD_SETTINGS,pourEnabled:true,ventsEnabled:true}
    const plan=planMold(cube,s)
    const channels=planVerticalChannels(cube,target,plan.outer,s,plan.radialOuter)
    expect(channels.map(p=>p.kind)).toEqual(['pour','vent'])
    expect(channels[0].bottomZ).toBeLessThan(10)
    expect(channels[0].topZ).toBeGreaterThan(plan.outer.max[2])
    expect(channels[0].funnelDiameter).toBeGreaterThan(channels[0].diameter)
    expect(()=>planVerticalChannels(cube,target,plan.outer,
      {...s,pourPoint:[0.5,0.5]},plan.radialOuter)).toThrow(/parting plane/)
    expect(()=>planVerticalChannels(cube,target,plan.outer,
      {...s,ventPoints:[[0.15,0.25]]},plan.radialOuter)).toThrow(/overlap/)
    expect(()=>planVerticalChannels(cube,target,plan.outer,
      {...s,pourPoint:[0.01,0.01],pourFunnelDiameter:100},plan.radialOuter)).toThrow(/side wall/)
  })
  it('distinguishes a radial seam ray from its opposite extension',()=>{
    const s={...DEFAULT_MOLD_SETTINGS,parts:3 as const,pourEnabled:true,
      pourPoint:[0.05,0.5] as [number,number]}
    const plan=planMold(cube,s)
    // X<0 lies *behind* the +X seam ray. Testing an infinite line would
    // incorrectly reject this point because its Y coordinate is zero.
    const channels=planVerticalChannels(cube,target,plan.outer,s,plan.radialOuter)
    expect(channels).toHaveLength(1)
    expect(channels[0].x).toBeCloseTo(-4.5)
    expect(channels[0].y).toBeCloseTo(0)
    // The positive +X ray remains a parting interface and must be rejected.
    expect(()=>planVerticalChannels(cube,target,plan.outer,
      {...s,pourPoint:[0.95,0.5]},plan.radialOuter))
      .toThrow(/radial parting interface/)
    // Even behind a ray the hub itself must retain clearance.
    expect(()=>planVerticalChannels(cube,target,plan.outer,
      {...s,pourPoint:[0.4,0.5]},plan.radialOuter))
      .toThrow(/radial parting interface/)
  })
  it('rejects a threefold radial seam collision before any tool body is cut',()=>{
    const s={...DEFAULT_MOLD_SETTINGS,parts:3 as const,pourEnabled:true,
      pourPoint:[0.75,0.5] as [number,number]}
    const plan=planMold(cube,s)
    expect(()=>planVerticalChannels(cube,target,plan.outer,s,plan.radialOuter))
      .toThrow(/radial parting interface/)
  })
})
