// SPDX-License-Identifier: AGPL-3.0-only
// Read-only tooling and silicone quantities, with independent material
// assumptions. UI-only changes never regenerate or mutate a mold.
import type {ChangeEvent} from 'react'
import type {MoldBuild} from '../core/geometry'
import type {MoldMode} from '../core/settings'
import {siliconeBatchByWeight,siliconeMixVolume,volumeMassCost} from '../core/materialEstimate'

export interface MoldMaterialInputs {
  printDensity:number
  printCostKg:number
  siliconeDensity:number
  siliconeCostKg:number
  castingDensity:number
  castingCostKg:number
  mixRatioA:number
  mixRatioB:number
  mixOveragePercent:number
}
export const DEFAULT_MOLD_MATERIAL_INPUTS:Readonly<MoldMaterialInputs>=Object.freeze({
  printDensity:1.24,printCostKg:25,
  siliconeDensity:1.1,siliconeCostKg:35,
  castingDensity:1.1,castingCostKg:25,
  mixRatioA:1,mixRatioB:1,mixOveragePercent:10,
})

const volume=(v:number)=>`${(v/1000).toFixed(2)} cm³`
const mass=(g:number)=>`${g.toFixed(1)} g`
const money=(cost:number)=>`$${cost.toFixed(2)}`
const validDensity=(v:number)=>Number.isFinite(v)&&v>0
const validCost=(v:number)=>Number.isFinite(v)&&v>=0

export function MoldMaterialEstimate({
  generated,mode,clearance,inputs,onInputChange,
}:{
  generated:MoldBuild
  mode:MoldMode
  clearance:number
  inputs:MoldMaterialInputs
  onInputChange:(key:keyof MoldMaterialInputs,value:number)=>void
}){
  const mix=siliconeMixVolume(mode,clearance,generated.materialEstimate)
  const netAvailable=mix!==null&&mix.basis!=='gross-silicone'
  const densityKey=mode==='direct'?'castingDensity':'siliconeDensity'
  const priceKey=mode==='direct'?'castingCostKg':'siliconeCostKg'
  const density=inputs[densityKey],price=inputs[priceKey]
  const validProduct=validDensity(density)&&validCost(price)
  const validRatio=Number.isFinite(inputs.mixRatioA)&&inputs.mixRatioA>0&&
    Number.isFinite(inputs.mixRatioB)&&inputs.mixRatioB>0&&
    Number.isFinite(inputs.mixRatioA+inputs.mixRatioB)
  const validOverage=Number.isFinite(inputs.mixOveragePercent)&&
    inputs.mixOveragePercent>=0&&inputs.mixOveragePercent<=100
  const batch=mix!==null&&mix.basis!=='gross-silicone'&&
    validProduct&&validRatio&&validOverage
    ?siliconeBatchByWeight(mix.volumeMm3,density,
      inputs.mixRatioA,inputs.mixRatioB,inputs.mixOveragePercent):null
  const validPrint=validDensity(inputs.printDensity)&&validCost(inputs.printCostKg)
  const print=validPrint
    ?volumeMassCost(generated.volumeMm3,inputs.printDensity,inputs.printCostKg)
    :null
  const edit=(key:keyof MoldMaterialInputs)=>(e:ChangeEvent<HTMLInputElement>)=>{
    onInputChange(key,Number(e.target.value))
  }
  return <details data-test="mold-material-estimate"
    open={mode==='silicone-box'||(mode==='direct'&&clearance>0)}>
    <summary>Material quantities, silicone mixing &amp; cost</summary>
    <p className="hint">Two different materials are counted here: liquid silicone filling the space around the original master, and solid material used to print the tooling. Their quantities are not added together. All volumes are in cm³ (1 cm³ = 1 mL).</p>

    <div className="sec-head">1. Silicone volume — master remains inside</div>
    {mix?<>
      <div className="kv" data-test="mold-silicone-tool-volume"
        title={mode==='direct'
          ?'Full expanded cavity formed by subtracting the positive clearance cutter; this includes the space originally occupied by the master.'
          :'Interior containment-box capacity up to its rim, before inserting the master.'}>
        <span className="name">Tool internal volume {mode==='direct'?'(expanded cavity)':'(to rim)'}</span>
        <b>{volume(mix.toolInternalVolumeMm3)}</b>
      </div>
      <div className="kv" data-test="mold-silicone-master-volume"
        title="Volume displaced by the original source part while it remains inside the mold.">
        <span className="name">− Original master volume</span>
        <b>{mix.partVolumeMm3===null?'Unknown':volume(mix.partVolumeMm3)}</b>
      </div>
      {mix.supportDisplacementMm3>0&&<div className="kv" data-test="mold-silicone-support-volume"
        title="Only the portion of a mounting post inside the pourable container, not its external foot or the portion embedded in the printed floor.">
        <span className="name">− Internal mounting-post volume</span>
        <b>{volume(mix.supportDisplacementMm3)}</b>
      </div>}
      {netAvailable?
        <div data-test={mode==='silicone-box'?'mold-silicone-net':undefined}>
          <div className="kv" data-test="mold-silicone-mix-volume"
            title="The volume of liquid silicone required with the original part still inside the tooling, before overage.">
            <span className="name">= Silicone to pour (before overage)</span>
            <b>{volume(mix.volumeMm3)}</b>
          </div>
        </div>:
        <div className="kv" data-test="mold-silicone-mix-volume">
          <span className="name">= Silicone to pour</span>
          <b>Cannot determine</b>
        </div>}
      {mode==='silicone-box'&&netAvailable&&
        <p className="hint">This is the estimated net silicone fill with the master installed and the box filled to its rim.</p>}
      {mix.basis==='gross-silicone'&&<p className="hint mold-warning" role="status">
        The input master is not a measurable closed solid. The internal capacity above is only a gross upper bound, not a usable silicone quantity. No mixing weights are calculated until the part volume is known.
      </p>}
      {mode==='direct'&&<p className="hint">The expanded cavity also contains the original part's volume. Only the clearance gap needs silicone while the master is installed; after removing the master, the full cavity would be available for a separate casting. The requested clearance is a distance, not the liquid volume.</p>}
      {mode==='silicone-box'&&<p className="hint">The box estimate assumes fill to its rim. Actual fill height, trapped air and unmodeled channels may change the required amount.</p>}
    </>:mode==='direct'&&clearance<=0?
      <p className="hint">Cavity clearance is 0 mm, so no silicone gap has been specified around the original master. Set a positive clearance and generate the mold to calculate a mix.</p>:
      <p className="hint mold-warning" role="status">Net silicone volume is unavailable: check the source model's closed-volume measurement and mold geometry.</p>}

    {mix&&<div data-test="mold-silicone-mix-settings">
      <div className="sec-head">2. Silicone product &amp; mixing</div>
      <p className="hint">Density converts the net volume above to grams. The A:B ratio must be the product manufacturer's ratio <strong>by weight</strong>, not by volume. The initial 1:1 value is only an example.</p>
      <label className="kv"><span className="name">Mixed silicone density (g/cm³)</span>
        <input type="number" min={0.01} step={0.01} data-test="mold-silicone-mix-density"
          value={density} onChange={edit(densityKey)}/></label>
      <label className="kv"><span className="name">Silicone price ($/kg of mixed material)</span>
        <input type="number" min={0} step={1}
          value={price} onChange={edit(priceKey)}/></label>
      <label className="kv"><span className="name">Part A weight ratio</span>
        <input type="number" min={0.01} step={1} data-test="mold-silicone-ratio-a"
          value={inputs.mixRatioA} onChange={edit('mixRatioA')}/></label>
      <label className="kv"><span className="name">Part B weight ratio</span>
        <input type="number" min={0.01} step={1} data-test="mold-silicone-ratio-b"
          value={inputs.mixRatioB} onChange={edit('mixRatioB')}/></label>
      <label className="kv"><span className="name">Extra for mixing losses / overpour (%)</span>
        <input type="number" min={0} max={100} step={1} data-test="mold-silicone-overage"
          value={inputs.mixOveragePercent} onChange={edit('mixOveragePercent')}/></label>
      {batch?<div data-test="mold-silicone-mix-plan">
        <div className="kv" data-test={mode==='direct'?'mold-casting-estimate':'mold-silicone-estimate'}>
          <span className="name">Base silicone mass (volume × density)</span>
          <b>{mass(batch.requiredGrams)}</b>
        </div>
        <div className="kv"><span className="name">+ Mixing allowance</span>
          <b>{mass(batch.overageGrams)}</b>
        </div>
        <div className="kv"><span className="name">= Total batch to prepare</span>
          <b>{mass(batch.batchGrams)}</b>
        </div>
        <div className="kv"><span className="name">Weigh Part A</span>
          <b>{mass(batch.partAGrams)}</b>
        </div>
        <div className="kv"><span className="name">Weigh Part B</span>
          <b>{mass(batch.partBGrams)}</b>
        </div>
        <div className="kv"><span className="name">Estimated batch cost</span>
          <b>{money(batch.batchGrams*price/1000)}</b>
        </div>
      </div>:!netAvailable?
        <p className="hint">Mixing weights are unavailable until the master volume can be measured. The gross box capacity is not a valid substitute.</p>:
        <p className="hint mold-warning" role="alert">
          Enter a positive density and A:B weight ratios, a nonnegative price, and a mixing allowance from 0% to 100%.
        </p>}
    </div>}

    <details data-test="mold-printed-tooling-estimate">
      <summary>3. Printed tooling — separate material</summary>
      <p className="hint">This is the sum of generated solid tooling parts (including separately printed fixtures), not the silicone inside them. The mass assumes fully solid printed material. Slicer infill, supports, purge and failed prints are excluded.</p>
      <div className="kv" data-test="mold-tooling-volume">
        <span className="name">Printed solid volume</span>
        <b>{volume(generated.volumeMm3)}</b>
      </div>
      <label className="kv"><span className="name">Printed material density (g/cm³)</span>
        <input type="number" min={0.01} step={0.01}
          value={inputs.printDensity} onChange={edit('printDensity')}/></label>
      <label className="kv"><span className="name">Printed material price ($/kg)</span>
        <input type="number" min={0} step={1}
          value={inputs.printCostKg} onChange={edit('printCostKg')}/></label>
      {print?<div data-test="mold-print-estimate">
        <div className="kv"><span className="name">Estimated fully solid mass</span>
          <b>{mass(print.grams)}</b></div>
        <div className="kv"><span className="name">Estimated tooling cost</span>
          <b>{money(print.cost)}</b></div>
      </div>:<p className="hint mold-warning" role="alert">Enter a positive printed-material density and a nonnegative price.</p>}
    </details>
    <p className="hint">These are planning estimates, not measured pours. Verify the actual fill line and product data sheet; overage only covers the allowance you enter. Changing calculator inputs never modifies mold geometry.</p>
  </details>
}
