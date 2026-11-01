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
