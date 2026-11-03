// SPDX-License-Identifier: AGPL-3.0-only
// Additive, read-only material calculations. No changes to generated solids.
import type {MoldPlan} from './geometry'

/** Gross fill capacity up to the rim of a silicone containment box.
 * Does not subtract the mounted master; callers must do so only when a
 * trustworthy closed, positive-volume mesh is available. Units: mm³.
 */
export function siliconeBoxCapacityMm3(plan:MoldPlan,draftDeg:number):number|null{
  if(!plan.innerBox)return null
  const h=plan.outer.max[2]-plan.innerBox.min[2]
  if(!(h>0))return null
  const tangent=Math.tan(draftDeg*Math.PI/180)
  const slope=tangent*h
  if(plan.cylinder){
    const r=plan.cylinder.innerR
    return Math.PI*h*(r*r+r*slope+slope*slope/3)
  }
  const inner=plan.innerBox
  const x=inner.max[0]-inner.min[0],y=inner.max[1]-inner.min[1]
  // Both inner wall pairs widen equally in X/Y as height increases.
  return h*(x*y+(x+y)*slope+4*slope*slope/3)
}

/** Nominal grams and cost for a fully solid amount of material; slicer infill,
 * supports, purge, overpour, shrinkage and waste are deliberately excluded.
 */
export function volumeMassCost(
  volumeMm3:number,densityGcm3:number,costPerKg:number,
):{cm3:number;grams:number;cost:number}{
  if(![volumeMm3,densityGcm3,costPerKg].every(Number.isFinite)||
    volumeMm3<0||densityGcm3<=0||costPerKg<0)
    throw new Error('Material estimate requires a finite nonnegative volume/cost and positive density.')
  const cm3=volumeMm3/1000,grams=cm3*densityGcm3
  return {cm3,grams,cost:grams*costPerKg/1000}
}

/** Plan a two-component silicone batch using the product's MIX RATIO BY WEIGHT.
 * Density is the mixed-product density, never Part A or Part B density.
 * Overage applies to the total mixed mass and preserves the A:B ratio.
 * Does not modify the geometry or pretend to account for trapped air.
 */
export function siliconeBatchByWeight(
  siliconeVolumeMm3:number,mixedDensityGcm3:number,
  partARatio:number,partBRatio:number,overagePercent:number,
):{
  requiredGrams:number;batchGrams:number;partAGrams:number
  partBGrams:number;overageGrams:number
}{
  if(![siliconeVolumeMm3,mixedDensityGcm3,partARatio,partBRatio,overagePercent]
      .every(Number.isFinite)||
      siliconeVolumeMm3<0||mixedDensityGcm3<=0||
      partARatio<=0||partBRatio<=0||overagePercent<0||overagePercent>100)
    throw new Error('Silicone batch requires nonnegative volume, positive mixed density and A:B weight ratios, and 0–100% overage.')
  const totalRatio=partARatio+partBRatio
  if(!Number.isFinite(totalRatio)||totalRatio<=0)
    throw new Error('Silicone A:B weight ratio is too large.')
  const requiredGrams=siliconeVolumeMm3/1000*mixedDensityGcm3
  const batchGrams=requiredGrams*(1+overagePercent/100)
  if(!Number.isFinite(batchGrams))
    throw new Error('Silicone batch mass is too large.')
  const partAGrams=batchGrams*(partARatio/totalRatio)
  const partBGrams=batchGrams-partAGrams
  return {requiredGrams,batchGrams,partAGrams,partBGrams,
    overageGrams:batchGrams-requiredGrams}
}

/** Silicone quantity when the source master REMAINS inside the mold.
 * The mold interior's total volume is not the silicone volume: the
 * physical master displaces its own volume, in either tooling mode.
 * Silicone boxes also lose pour volume to any installed support.
 *
 * If an open scan prevents measuring master displacement, only a
 * clearly identified gross upper bound is available, never a net amount.
 */
export type SiliconeMixVolumeBasis='direct-clearance-gap'|'net-silicone'|'gross-silicone'
export interface SiliconeMixVolume {
  volumeMm3:number
  basis:SiliconeMixVolumeBasis
  toolInternalVolumeMm3:number
  partVolumeMm3:number|null
  supportDisplacementMm3:number
}
export function siliconeMixVolume(
  mode:'direct'|'silicone-box',
  cavityClearanceMm:number,
  estimates:{
    nominalCastingCavityMm3:number|null
    masterDisplacementMm3:number|null
    netSiliconeMm3:number|null
    grossSiliconeCapacityMm3:number|null
    supportDisplacementMm3?:number
  },
):SiliconeMixVolume|null{
  const usable=(v:number|null|undefined):v is number=>
    v!==null&&v!==undefined&&Number.isFinite(v)&&v>=0
  const part=estimates.masterDisplacementMm3
  if(mode==='direct'){
    const cavity=estimates.nominalCastingCavityMm3
    if(!(cavityClearanceMm>0)||!usable(cavity)||!usable(part)||
       cavity+1e-3<part)return null
    return {
      volumeMm3:Math.max(0,cavity-part),
      basis:'direct-clearance-gap',
      toolInternalVolumeMm3:cavity,
      partVolumeMm3:part,
      supportDisplacementMm3:0,
    }
  }
  const gross=estimates.grossSiliconeCapacityMm3
  const support=usable(estimates.supportDisplacementMm3)
    ?estimates.supportDisplacementMm3:0
  if(usable(gross)&&usable(part)){
    // Derive from the actual volumes in the same way as the direct
    // clearance gap; a precomputed net field must never change that
    // definition. Any in-container fixture also displaces silicone.
    if(gross+1e-3<part+support)return null
    return {
      volumeMm3:Math.max(0,gross-part-support),
      basis:'net-silicone',
      toolInternalVolumeMm3:gross,
      partVolumeMm3:part,
      supportDisplacementMm3:support,
    }
  }
  if(usable(gross))
    return {
      volumeMm3:gross,
      basis:'gross-silicone',
      toolInternalVolumeMm3:gross,
      partVolumeMm3:null,
      supportDisplacementMm3:support,
    }
  return null
}
