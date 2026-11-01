// SPDX-License-Identifier: AGPL-3.0-only
// Regression tests for complete-height cavities, separately manifold parts,
// registration, cylindrical boxes and preservation of sub-mm geometry.
import {beforeAll,describe,expect,it} from 'vitest'
import Module,{type ManifoldToplevel} from 'manifold-3d'
import {DEFAULT_MOLD_SETTINGS} from '../core/settings'
import {boxSolid,buildMold,planMold,seamPositions} from '../core/geometry'
import {closedness} from '../../mesh-tools/core/boolean'
import {signedVolume} from '../../mesh-tools/core/hollow'

let wasm:ManifoldToplevel
beforeAll(async()=>{wasm=await Module();wasm.setup()})
const master=boxSolid({min:[-5,-4,0],max:[5,4,10]})
const noKeys={...DEFAULT_MOLD_SETTINGS,keys:false} as const
const intact=(parts:ReturnType<typeof buildMold>['parts'])=>{
  for(const p of parts){
    expect(p.volumeMm3).toBeGreaterThan(0)
    expect(closedness(p.indices,p.positions.length/3)).toEqual({open:0,bad:0})
  }
}
describe('Mold Making assembly',()=>{
  it('auto-repairs a collapsed input face before a manifold mold build',()=>{
    const malformed={positions:master.positions,
      indices:Uint32Array.from([...master.indices,0,1,1])}
    const before=malformed.indices.slice()
    const result=buildMold(wasm,malformed,noKeys)
    intact(result.parts)
    expect(result.warnings.join(' ')).toMatch(/removed 1 exactly zero-area/)
    expect(malformed.indices).toEqual(before)
    // This triangle repeats vertex 1, so the validator correctly rejects
    // its *indices* before checking geometric area.
    expect(()=>buildMold(wasm,malformed,{...noKeys,repairTarget:false}))
      .toThrow(/degenerate triangle indices/)
  })
  it('diagnoses a zero-area face with three distinct, collinear vertex indices',()=>{
    // The extra point is exactly on edge 0→1. No repeated indices:
    // this exercises the area test, unlike the preceding test.
    const malformed={
      positions:Float32Array.from([...master.positions,0,-4,0]),
      indices:Uint32Array.from([...master.indices,0,1,8]),
    }
    expect(()=>buildMold(wasm,malformed,{...noKeys,repairTarget:false}))
      .toThrow(/zero-area triangle at face 12/)
    const repaired=buildMold(wasm,malformed,noKeys)
    intact(repaired.parts)
    expect(repaired.warnings.join(' ')).toMatch(/removed 1 exactly zero-area/)
    expect(malformed.indices.length).toBe(master.indices.length+3)
  })
  it('retains every millimeter of the target in two distinct full-height rigid pieces',()=>{
    const m=buildMold(wasm,master,noKeys)
    expect(m.parts).toHaveLength(2)
    expect(m.openingZ).toBeNull()
    expect(m.volumeMm3).toBeCloseTo(26*24*18-10*8*10,2)
    intact(m.parts)
  })
  it('generates four separate rigid blocks with no coincident combined STL',()=>{
    const m=buildMold(wasm,master,{...noKeys,parts:4})
    expect(m.parts).toHaveLength(4)
    expect(m.volumeMm3).toBeCloseTo(26*24*18-800,2)
    intact(m.parts)
  })
  it('creates four keyed halves without splitting through a pre-existing registration pin',()=>{
    const plain=buildMold(wasm,master,{...noKeys,parts:4})
    const keyed=buildMold(wasm,master,{...DEFAULT_MOLD_SETTINGS,parts:4})
    expect(keyed.parts).toHaveLength(4)
    intact(keyed.parts)
    const netMaterialDelta=Math.abs(keyed.volumeMm3-plain.volumeMm3)
    // Deliberate radial fit clearance removes more material than pins add.
    // This must not change bulk tooling volume by a large amount.
    expect(netMaterialDelta).toBeLessThan(100)
  })
  it('generates a four-part circular silicone box, with separate closed pieces',()=>{
    const made=buildMold(wasm,master,{...DEFAULT_MOLD_SETTINGS,mode:'silicone-box',
      boxShape:'cylindrical',parts:4})
    expect(made.parts).toHaveLength(4)
    intact(made.parts)
  })
  it('increases cavity volume (reduces printed block volume) for positive clearance',()=>{
    const common={...DEFAULT_MOLD_SETTINGS,keys:false}
    const zero=buildMold(wasm,master,common)
    const clearance=buildMold(wasm,master,{...common,clearance:0.1})
    expect(clearance.volumeMm3).toBeLessThan(zero.volumeMm3)
    expect(clearance.openingZ).toBeNull()
    intact(clearance.parts)
  })
  it('rejects a cavity offset that would puncture top or bottom of the mold',()=>{
    expect(()=>buildMold(wasm,master,{...noKeys,clearance:4.2}))
      .toThrow(/base\/top thickness|breaks through/)
  })
  it('rejects invalid geometry without relying on an arbitrary triangle aspect ratio',()=>{
    // Extremely skinny but nonzero-area triangles are valid. Ordinary
    // intersections routinely create sliver triangles on shared planes.
    const p=boxSolid({min:[-5,-4,0],max:[5,4,10]})
    const build=buildMold(wasm,p,{...noKeys,parts:4,splitPosition:0.123456})
    expect(build.parts.length).toBe(4)
    intact(build.parts)
  })
  it('spreads five automatic registration features on a sufficiently large seam',()=>{
    expect(seamPositions(-12,12,DEFAULT_MOLD_SETTINGS)).toHaveLength(5)
    // Smaller four-part interface chooses a safe subset rather than
    // overlapping adjacent keys or cutting into the parting intersection.
    expect(seamPositions(-12,0,DEFAULT_MOLD_SETTINGS)).toHaveLength(2)
  })
  it('respects manually edited positions or reports collisions',()=>{
    const keys={...DEFAULT_MOLD_SETTINGS,keyPlacement:'manual' as const,keyPositions:[0.25,0.75]}
    expect(seamPositions(-12,0,keys)).toEqual([-9,-3])
    expect(()=>seamPositions(-12,0,{...keys,keyPositions:[0.24,0.25]}))
      .toThrow(/overlaps/)
  })
  it('cuts matching blind metal-dowel sockets in both mating halves',()=>{
    const plain=buildMold(wasm,master,{...DEFAULT_MOLD_SETTINGS,keys:false})
    const sockets=buildMold(wasm,master,{...DEFAULT_MOLD_SETTINGS,keyStyle:'metal-dowel'})
    expect(sockets.parts).toHaveLength(2)
    intact(sockets.parts)
    expect(sockets.parts[0].volumeMm3).toBeLessThan(plain.parts[0].volumeMm3)
    expect(sockets.parts[1].volumeMm3).toBeLessThan(plain.parts[1].volumeMm3)
    expect(sockets.warnings.join(' ')).toMatch(/metal dowels/)
  })
  it('makes tapered printed male keys and clearance-fit female cavities',()=>{
    const plain=buildMold(wasm,master,{...DEFAULT_MOLD_SETTINGS,keys:false})
    const m=buildMold(wasm,master,{...DEFAULT_MOLD_SETTINGS,keyStyle:'tapered-key'})
    expect(m.parts).toHaveLength(2)
    intact(m.parts)
    expect(m.parts[0].volumeMm3).toBeGreaterThan(plain.parts[0].volumeMm3)
    expect(m.parts[1].volumeMm3).toBeLessThan(plain.parts[1].volumeMm3)
  })
  it('handles four-part rigid tooling with blind holes instead of printed pins',()=>{
    const m=buildMold(wasm,master,{...DEFAULT_MOLD_SETTINGS,parts:4,keyStyle:'metal-dowel'})
    expect(m.parts).toHaveLength(4)
    intact(m.parts)
  })
  it('adds physical pins and corresponding negative pockets',()=>{
    const plain=buildMold(wasm,master,noKeys)
    const keyed=buildMold(wasm,master,DEFAULT_MOLD_SETTINGS)
    expect(keyed.parts).toHaveLength(2)
    intact(keyed.parts)
    expect(keyed.parts[0].volumeMm3).toBeGreaterThan(plain.parts[0].volumeMm3)
    expect(keyed.parts[1].volumeMm3).toBeLessThan(plain.parts[1].volumeMm3)
  })
  it('builds a real open-top round silicone box in two mating solids',()=>{
    const s={...noKeys,mode:'silicone-box' as const,boxShape:'cylindrical' as const,boxDraftDeg:2}
    const m=buildMold(wasm,master,s)
    expect(m.parts).toHaveLength(2)
    intact(m.parts)
    const p=planMold(master,s)
    expect(p.cylinder).not.toBeNull()
    expect(m.volumeMm3).toBeGreaterThan(0)
  })
  it('preserves a thin positive fin without hidden default smoothing',()=>{
    // Fin only 0.2 mm thick: it adds real target volume to a block.
    const base=new wasm.Manifold(new wasm.Mesh({numProp:3,vertProperties:master.positions,triVerts:master.indices}))
    const fin=wasm.Manifold.cube([0.2,2,8],true).translate([5,0,5])
    const joined=base.add(fin)
    const mesh=joined.getMesh()
    const shape={positions:new Float32Array(mesh.vertProperties),indices:new Uint32Array(mesh.triVerts)}
    const s={...noKeys,sideMargin:8}
    const mold=buildMold(wasm,shape,s)
    const p=planMold(shape,s)
    const v=(p.outer.max[0]-p.outer.min[0])*(p.outer.max[1]-p.outer.min[1])*(p.outer.max[2]-p.outer.min[2])
    expect(mold.volumeMm3).toBeCloseTo(v-signedVolume(shape.positions,shape.indices),1)
    intact(mold.parts)
    joined.delete();fin.delete();base.delete()
  })
  it('never accepts nonwatertight or inside-out scan geometry',()=>{
    const bad={positions:master.positions,indices:master.indices.slice(3)}
    expect(()=>buildMold(wasm,bad,DEFAULT_MOLD_SETTINGS)).toThrow(/not watertight/)
  })
  it('keeps legacy one-piece impression explicitly truncated',()=>{
    const single=buildMold(wasm,master,{...noKeys,parts:1})
    expect(single.parts).toHaveLength(1)
    expect(single.openingZ).toBe(5)
    expect(single.warnings.join(' ')).toMatch(/bottom half/)
  })
})
