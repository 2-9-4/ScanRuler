// SPDX-License-Identifier: AGPL-3.0-only
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe,expect,it} from 'vitest'
import type {MoldBuild} from '../core/geometry'
import type {MoldMode} from '../core/settings'
import {MoldMaterialEstimate,DEFAULT_MOLD_MATERIAL_INPUTS} from '../ui/MoldMaterialEstimate'

function markup(mode:MoldMode,clearance:number,estimate:MoldBuild['materialEstimate']){
  // Only the two material properties are read by this independent,
  // presentational widget. No WebGL scene or Manifold worker is needed.
  const generated={volumeMm3:80_000,materialEstimate:estimate} as MoldBuild
  return renderToStaticMarkup(createElement(MoldMaterialEstimate,{
    generated,mode,clearance,inputs:{...DEFAULT_MOLD_MATERIAL_INPUTS},
    onInputChange:()=>{},
  }))
}
const direct={
  nominalCastingCavityMm3:120_000,
  grossSiliconeCapacityMm3:null,
  masterDisplacementMm3:100_000,
  supportDisplacementMm3:0,
  netSiliconeMm3:null,
}
const box={
  nominalCastingCavityMm3:null,
  grossSiliconeCapacityMm3:300_000,
  masterDisplacementMm3:40_000,
  supportDisplacementMm3:10_000,
  netSiliconeMm3:250_000,
}
describe('Mold material estimate organization',()=>{
  it('shows each input once, one direct-mold net fill and one total A/B batch',()=>{
    const html=markup('direct',0.4,direct)
    expect(html).toContain('120.00 cm³')
    expect(html).toContain('100.00 cm³')
    expect(html).toContain('20.00 cm³')
    expect(html).toContain('22.0 g')
    expect(html).toContain('24.2 g')
    expect(html).toContain('12.1 g')
    expect(html.match(/data-test="mold-silicone-tool-volume"/g)).toHaveLength(1)
    expect(html.match(/data-test="mold-silicone-master-volume"/g)).toHaveLength(1)
    expect(html.match(/data-test="mold-silicone-mix-volume"/g)).toHaveLength(1)
    expect(html.match(/data-test="mold-silicone-mix-density"/g)).toHaveLength(1)
    expect(html.match(/data-test="mold-silicone-mix-plan"/g)).toHaveLength(1)
    expect(html).not.toContain('Nominal casting void')
    expect(html).not.toContain('Total material')
    expect(html).toContain('Printed tooling — separate material')
  })
  it('uses silicone inputs, not casting inputs, for the direct clearance gap',()=>{
    const generated={volumeMm3:80_000,materialEstimate:direct} as MoldBuild
    const html=renderToStaticMarkup(createElement(MoldMaterialEstimate,{
      generated,mode:'direct',clearance:0.4,
      inputs:{...DEFAULT_MOLD_MATERIAL_INPUTS,castingDensity:5,castingCostKg:500,siliconeDensity:1.5,siliconeCostKg:40},
      onInputChange:()=>{},
    }))
    expect(html).toContain('30.0 g')
    expect(html).toContain('33.0 g')
    expect(html).toContain('$1.32')
    expect(html).not.toContain('100.0 g')
  })
  it('explains zero clearance in the default display unit',()=>{
    const html=markup('direct',0,{...direct,nominalCastingCavityMm3:100_000})
    expect(html).toContain('Cavity clearance is 0 mm')
  })
  it('separates silicone box, original part and post displacement',()=>{
    const html=markup('silicone-box',0,box)
    expect(html).toContain('300.00 cm³')
    expect(html).toContain('40.00 cm³')
    expect(html).toContain('10.00 cm³')
    expect(html).toContain('250.00 cm³')
    expect(html.match(/data-test="mold-silicone-support-volume"/g)).toHaveLength(1)
    expect(html.match(/data-test="mold-silicone-mix-volume"/g)).toHaveLength(1)
    expect(html).toContain('estimated net silicone fill')
  })
  it('does not suggest a batch when an open master has unknown volume',()=>{
    const html=markup('silicone-box',0,{
      ...box,masterDisplacementMm3:null,netSiliconeMm3:null,
    })
    expect(html).toContain('Cannot determine')
    expect(html).toContain('gross upper bound')
    expect(html).not.toContain('data-test="mold-silicone-mix-plan"')
    expect(html).not.toContain('Estimated batch cost')
    expect(html).toContain('Printed solid volume')
  })
  it('keeps printed material separate at zero clearance without inventing a silicone gap',()=>{
    const html=markup('direct',0,{...direct,nominalCastingCavityMm3:100_000})
    expect(html).toContain('no silicone gap has been specified')
    expect(html).not.toContain('data-test="mold-silicone-mix-plan"')
    expect(html).toContain('data-test="mold-print-estimate"')
  })
})
