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

/** Select the material volume relevant to a two-part silicone mix.
 * Direct tooling is opt-in: only a positive cavity clearance enables
 * the calculator. For silicone containment, use the net fill when the
 * master has a trustworthy displacement estimate, otherwise explicitly
 * identify gross-to-rim capacity as an upper bound.
 */
export type SiliconeMixVolumeBasis='direct-cavity'|'net-silicone'|'gross-silicone'
export interface SiliconeMixVolume {
  volumeMm3:number
  basis:SiliconeMixVolumeBasis
}
export function siliconeMixVolume(
  mode:'direct'|'silicone-box',
  cavityClearanceMm:number,
  estimates:{
    nominalCastingCavityMm3:number|null
    netSiliconeMm3:number|null
    grossSiliconeCapacityMm3:number|null
  },
):SiliconeMixVolume|null{
  const usable=(v:number|null):v is number=>v!==null&&Number.isFinite(v)&&v>=0
  if(mode==='direct'){
    return cavityClearanceMm>0&&usable(estimates.nominalCastingCavityMm3)
      ?{volumeMm3:estimates.nominalCastingCavityMm3,basis:'direct-cavity'}
      :null
  }
  if(usable(estimates.netSiliconeMm3))
    return {volumeMm3:estimates.netSiliconeMm3,basis:'net-silicone'}
  if(usable(estimates.grossSiliconeCapacityMm3))
    return {volumeMm3:estimates.grossSiliconeCapacityMm3,basis:'gross-silicone'}
  return null
}
