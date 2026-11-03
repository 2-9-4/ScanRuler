// SPDX-License-Identifier: AGPL-3.0-only
import {describe,expect,it} from 'vitest'
import {boxSolid,planMold,buildMold} from '../core/geometry'
import {
  siliconeBoxCapacityMm3,volumeMassCost,siliconeBatchByWeight,siliconeMixVolume,
} from '../core/materialEstimate'
import {DEFAULT_MOLD_SETTINGS} from '../core/settings'
import Module from 'manifold-3d'

const target=boxSolid({min:[-5,-4,0],max:[5,4,10]})
describe('Mold material calculator (MOLD-014)',()=>{
  it('integrates the exact rectangular drafted box cross-section up to the fill rim',()=>{
    const s={...DEFAULT_MOLD_SETTINGS,mode:'silicone-box' as const,
      boxShape:'rectangular' as const,parts:1 as const,keys:false,boxDraftDeg:0}
    const plan=planMold(target,s)
    const h=plan.outer.max[2]-plan.innerBox!.min[2]
    const w=plan.innerBox!.max[0]-plan.innerBox!.min[0]
    const d=plan.innerBox!.max[1]-plan.innerBox!.min[1]
    expect(siliconeBoxCapacityMm3(plan,0)).toBeCloseTo(w*d*h,4)
    const drafted=siliconeBoxCapacityMm3(plan,3)!
    expect(drafted).toBeGreaterThan(w*d*h)
  })
  it('integrates cylindrical drafted fill capacity and reports no direct-mode capacity',()=>{
    const s={...DEFAULT_MOLD_SETTINGS,mode:'silicone-box' as const,
      boxShape:'cylindrical' as const,parts:3 as const,keys:false,boxDraftDeg:0}
    const plan=planMold(target,s)
    const h=plan.outer.max[2]-plan.innerBox!.min[2]
    expect(siliconeBoxCapacityMm3(plan,0)).toBeCloseTo(
      Math.PI*plan.cylinder!.innerR**2*h,4)
    expect(siliconeBoxCapacityMm3(plan,3)!).toBeGreaterThan(siliconeBoxCapacityMm3(plan,0)!)
    expect(siliconeBoxCapacityMm3(planMold(target,{...DEFAULT_MOLD_SETTINGS}),0)).toBeNull()
  })
  it('converts volume to mass and cost, and rejects unsafe assumptions',()=>{
    expect(volumeMassCost(1_000_000,1.2,30)).toEqual({cm3:1000,grams:1200,cost:36})
    expect(()=>volumeMassCost(100,-1,20)).toThrow(/positive density/)
    expect(()=>volumeMassCost(100,1,-20)).toThrow(/nonnegative/)
  })
  it('allocates mixed silicone batch mass by the specified A:B weight ratio',()=>{
    const equal=siliconeBatchByWeight(200_000,1.1,1,1,10)
    expect(equal.requiredGrams).toBeCloseTo(220)
    expect(equal.batchGrams).toBeCloseTo(242)
    expect(equal.partAGrams).toBeCloseTo(121)
    expect(equal.partBGrams).toBeCloseTo(121)
    expect(equal.overageGrams).toBeCloseTo(22)
    const unequal=siliconeBatchByWeight(300_000,1.1,100,10,10)
    expect(unequal.requiredGrams).toBeCloseTo(330)
    expect(unequal.batchGrams).toBeCloseTo(363)
    expect(unequal.partAGrams).toBeCloseTo(330)
    expect(unequal.partBGrams).toBeCloseTo(33)
    expect(unequal.partAGrams+unequal.partBGrams).toBeCloseTo(unequal.batchGrams)
    expect(siliconeBatchByWeight(0,1,1,1,0).batchGrams).toBe(0)
  })
  it('rejects invalid silicone weight ratios, density and overage assumptions',()=>{
    expect(()=>siliconeBatchByWeight(1000,1.1,0,1,10)).toThrow(/positive/)
    expect(()=>siliconeBatchByWeight(1000,1.1,1,-1,10)).toThrow(/positive/)
    expect(()=>siliconeBatchByWeight(1000,-1,1,1,10)).toThrow(/positive/)
    expect(()=>siliconeBatchByWeight(-1000,1.1,1,1,10)).toThrow(/nonnegative/)
    expect(()=>siliconeBatchByWeight(1000,1.1,1,1,-1)).toThrow(/0–100%/)
    expect(()=>siliconeBatchByWeight(1000,1.1,1,1,101)).toThrow(/0–100%/)
    expect(()=>siliconeBatchByWeight(1000,1.1,Infinity,1,10)).toThrow(/weight/)
  })
  it('shows mixing quantities for positive-clearance rigid cavity but not zero-clearance tooling',()=>{
    const estimates={
      nominalCastingCavityMm3:123_000,
      netSiliconeMm3:null,
      grossSiliconeCapacityMm3:null,
    }
    expect(siliconeMixVolume('direct',0,estimates)).toBeNull()
    expect(siliconeMixVolume('direct',-0.1,estimates)).toBeNull()
    expect(siliconeMixVolume('direct',0.25,estimates))
      .toEqual({basis:'direct-cavity',volumeMm3:123_000})
    const selection=siliconeMixVolume('direct',0.25,estimates)!
    const batch=siliconeBatchByWeight(selection.volumeMm3,1.15,10,1,8)
    expect(batch.requiredGrams).toBeCloseTo(141.45)
    expect(batch.partAGrams+batch.partBGrams).toBeCloseTo(batch.batchGrams)
    expect(siliconeMixVolume('direct',0.25,{...estimates,nominalCastingCavityMm3:null}))
      .toBeNull()
  })
  it('uses net silicone volume first and explicitly falls back to gross capacity',()=>{
    const estimates={
      nominalCastingCavityMm3:500_000,
      netSiliconeMm3:250_000,
      grossSiliconeCapacityMm3:300_000,
    }
    expect(siliconeMixVolume('silicone-box',0,estimates))
      .toEqual({basis:'net-silicone',volumeMm3:250_000})
    expect(siliconeMixVolume('silicone-box',0,{...estimates,netSiliconeMm3:null}))
      .toEqual({basis:'gross-silicone',volumeMm3:300_000})
    expect(siliconeMixVolume('silicone-box',0,{
      ...estimates,netSiliconeMm3:null,grossSiliconeCapacityMm3:null,
    })).toBeNull()
    expect(siliconeMixVolume('silicone-box',0,{
      ...estimates,netSiliconeMm3:Number.NaN,
    })).toEqual({basis:'gross-silicone',volumeMm3:300_000})
  })
  it('subtracts a valid master but not a source with open mesh topology',async()=>{
    const wasm=await Module();wasm.setup()
    const settings={...DEFAULT_MOLD_SETTINGS,mode:'silicone-box' as const,
      keys:false,parts:1 as const}
    const solid=buildMold(wasm,target,settings)
    expect(solid.materialEstimate.grossSiliconeCapacityMm3).toBeGreaterThan(800)
    expect(solid.materialEstimate.masterDisplacementMm3).toBeCloseTo(800)
    expect(solid.materialEstimate.netSiliconeMm3).toBeCloseTo(
      solid.materialEstimate.grossSiliconeCapacityMm3!-800,4)
    const open={positions:target.positions,indices:new Uint32Array(0)}
    const made=buildMold(wasm,open,settings)
    expect(made.materialEstimate.grossSiliconeCapacityMm3).toBeGreaterThan(800)
    expect(made.materialEstimate.masterDisplacementMm3).toBeNull()
    expect(made.materialEstimate.netSiliconeMm3).toBeNull()
    // Containment geometry must remain buildable even when a reference
    // scan has completely invalid face indices: bounds alone suffice.
    const malformed=buildMold(wasm,{positions:target.positions,
      indices:Uint32Array.of(0,999,2)},settings)
    expect(malformed.printable).toBe(true)
    expect(malformed.materialEstimate.masterDisplacementMm3).toBeNull()
    expect(malformed.materialEstimate.netSiliconeMm3).toBeNull()
    const rigid=buildMold(wasm,target,{...DEFAULT_MOLD_SETTINGS,keys:false})
    expect(rigid.materialEstimate.nominalCastingCavityMm3).toBeCloseTo(800,2)
    expect(rigid.materialEstimate.grossSiliconeCapacityMm3).toBeNull()
  })
})
