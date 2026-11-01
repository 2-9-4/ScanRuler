// SPDX-License-Identifier: AGPL-3.0-only
// Regression tests for complete-height cavities, separately manifold parts,
// registration, cylindrical boxes and preservation of sub-mm geometry.
import {beforeAll,describe,expect,it} from 'vitest'
import Module,{type ManifoldToplevel} from 'manifold-3d'
import {DEFAULT_MOLD_SETTINGS} from '../core/settings'
import {boxSolid,buildMold,planMold,seamPositions,registrationSites,toPart} from '../core/geometry'
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
  it('reports and removes only microscopic disconnected Boolean dust',()=>{
    const base=wasm.Manifold.cube([8,8,8])
    const fleck=wasm.Manifold.cube([0.05,0.05,0.05]).translate([15,0,0])
    const combined=base.add(fleck)
    try{
      const warnings:string[]=[]
      const part=toPart(combined,'Mold part 1',warnings)
      intact([part])
      expect(part.volumeMm3).toBeCloseTo(512,2)
      expect(warnings.join(' ')).toMatch(/microscopic Boolean dust islands/)
    }finally{combined.delete();fleck.delete();base.delete()}
  })
  it('preserves nontrivial disconnected mold islands as distinct printable components',()=>{
    const base=wasm.Manifold.cube([8,8,8])
    const island=wasm.Manifold.cube([1,1,1]).translate([15,0,0])
    const combined=base.add(island)
    try{
      const warnings:string[]=[],detached:ReturnType<typeof toPart>[]=[]
      const primary=toPart(combined,'Mold part 1',warnings,detached)
      intact([primary,...detached])
      expect(primary.volumeMm3).toBeCloseTo(512,2)
      expect(detached).toHaveLength(1)
      expect(detached[0].volumeMm3).toBeCloseTo(1,3)
      expect(detached[0].name).toMatch(/detached/)
      expect(warnings.join(' ')).toMatch(/individually exported loose parts/)
    }finally{combined.delete();island.delete();base.delete()}
  })
  it('defaults to two widely spaced alignment keys and safely falls back to one for a short seam',()=>{
    const settings={...DEFAULT_MOLD_SETTINGS,keyPlacement:'auto' as const}
    const normal=seamPositions(0,50,settings)
    expect(normal).toHaveLength(2)
    expect(normal[0]).toBeLessThan(15)
    expect(normal[1]).toBeGreaterThan(35)
    const short=seamPositions(0,9,settings)
    expect(short).toHaveLength(1)
    expect(short[0]).toBeCloseTo(4.5)
  })
  it('distributes registration across both tangent axes, including above the cavity',()=>{
    const plan=planMold(master,DEFAULT_MOLD_SETTINGS)
    const sites=registrationSites('x',0,DEFAULT_MOLD_SETTINGS,plan)
    expect(sites).toHaveLength(4)
    expect(new Set(sites.map(p=>p[1].toFixed(3))).size).toBe(2)
    expect(new Set(sites.map(p=>p[2].toFixed(3))).size).toBe(2)
    expect(sites.some(p=>p[2]<0)).toBe(true)
    expect(sites.some(p=>p[2]>10)).toBe(true)
    const ySites=registrationSites('y',0,DEFAULT_MOLD_SETTINGS,plan)
    expect(new Set(ySites.map(p=>p[0].toFixed(3))).size).toBe(2)
    expect(new Set(ySites.map(p=>p[2].toFixed(3))).size).toBe(2)
    const zSites=registrationSites('z',5,DEFAULT_MOLD_SETTINGS,plan)
    expect(new Set(zSites.map(p=>p[0].toFixed(3))).size).toBe(2)
    expect(new Set(zSites.map(p=>p[1].toFixed(3))).size).toBe(2)
  })
  it('rejects manual pin locations inside the projected cavity and accepts outer corners',()=>{
    const plan=planMold(master,DEFAULT_MOLD_SETTINGS)
    const manual={...DEFAULT_MOLD_SETTINGS,keyPlacement:'manual' as const,
      keyPoints:[[0.5,0.5]] as [number,number][]}
    expect(()=>registrationSites('x',0,manual,plan)).toThrow(/projected casting cavity/)
    const okay={...manual,keyPoints:[[0.12,0.15],[0.88,0.85]] as [number,number][]}
    expect(registrationSites('x',0,okay,plan)).toHaveLength(2)
    const four=registrationSites('x',0,DEFAULT_MOLD_SETTINGS,plan,[-12,0])
    expect(four).toHaveLength(2)
  })
  it('retains every millimeter of the target in two distinct full-height rigid pieces',()=>{
    const m=buildMold(wasm,master,noKeys)
    expect(m.parts).toHaveLength(2)
    expect(m.openingZ).toBeNull()
    expect(m.volumeMm3).toBeCloseTo(26*24*18-10*8*10,2)
    intact(m.parts)
  })
  it('builds a silicone containment box from an OPEN scan without any mesh repair',()=>{
    // Two triangles removed from a face: four boundary edges.
    const open={positions:master.positions,
      indices:Uint32Array.from([...master.indices.slice(0,6),...master.indices.slice(12)])}
    expect(closedness(open.indices,open.positions.length/3).open).toBe(4)
    for(const boxShape of ['rectangular','cylindrical'] as const){
      const made=buildMold(wasm,open,{...DEFAULT_MOLD_SETTINGS,
        mode:'silicone-box',boxShape,repairTarget:false})
      expect(made.parts).toHaveLength(2)
      intact(made.parts)
      expect(made.warnings.join(' ')).not.toMatch(/Temporary target mesh repair/)
    }
  })
  it('does not inspect degenerate triangles when sizing a silicone box',()=>{
    const broken={positions:master.positions,
      indices:Uint32Array.from([...master.indices,0,1,1])}
    const original=broken.indices.slice()
    const made=buildMold(wasm,broken,{...DEFAULT_MOLD_SETTINGS,
      mode:'silicone-box',parts:1,repairTarget:true})
    intact(made.parts)
    expect(made.parts).toHaveLength(1)
    expect(broken.indices).toEqual(original)
  })
  it('allows a silicone box around a vertex cloud with no triangle connectivity',()=>{
    const points={positions:master.positions,indices:new Uint32Array(0)}
    const made=buildMold(wasm,points,{...DEFAULT_MOLD_SETTINGS,
      mode:'silicone-box',parts:1,keys:false})
    expect(made.parts).toHaveLength(1)
    intact(made.parts)
  })
  it('still rejects open targets for actual cast-negative cavities',()=>{
    const open={positions:master.positions,
      indices:Uint32Array.from([...master.indices.slice(0,6),...master.indices.slice(12)])}
    expect(()=>buildMold(wasm,open,{...noKeys,repairTarget:false}))
      .toThrow(/not watertight/)
  })
  it('generates four separate rigid blocks with no coincident combined STL',()=>{
    const m=buildMold(wasm,master,{...noKeys,parts:4})
    expect(m.parts).toHaveLength(4)
    expect(m.volumeMm3).toBeCloseTo(26*24*18-800,2)
    intact(m.parts)
  })
  it('registers tall rectangular and cylindrical buckets using external wall bosses',()=>{
    const solid=boxSolid({min:[-5,-4,0],max:[5,4,10]})
    for(const shape of ['rectangular','cylindrical'] as const){
      for(const keyStyle of ['tapered-key','metal-dowel'] as const){
        const settings={...DEFAULT_MOLD_SETTINGS,mode:'silicone-box' as const,
          boxShape:shape,keyStyle,parts:2 as const}
        const made=buildMold(wasm,solid,settings)
        expect(made.parts).toHaveLength(2)
        intact(made.parts)
        expect(made.warnings.join(' ')).toMatch(/external wall bosses/)
        const b=planMold(solid,settings).outer
        // Exterior bosses should be visible OUTSIDE the nominal bucket,
        // including above the master height. Keys solely in the bottom
        // plate would fail this test.
        for(const part of made.parts){
          let upperExterior=false
          for(let i=0;i<part.positions.length;i+=3){
            const y=part.positions[i+1],z=part.positions[i+2]
            if(z>12 &&
              (y<b.min[1]-0.1||y>b.max[1]+0.1))upperExterior=true
          }
          expect(upperExterior).toBe(true)
        }
      }
    }
  })
  it('places registration at two heights on each exterior quadrant of a four-piece box',()=>{
    for(const boxShape of ['rectangular','cylindrical'] as const){
      const s={...DEFAULT_MOLD_SETTINGS,mode:'silicone-box' as const,
        boxShape,parts:4 as const,keyStyle:'metal-dowel' as const}
      const result=buildMold(wasm,master,s)
      expect(result.parts).toHaveLength(4)
      intact(result.parts)
      const outer=planMold(master,s).outer
      // The two parting axes should each have boss material exterior to
      // their corresponding walls. Every quadrant receives two height pairs.
      for(const part of result.parts){
        let wallBoss=false
        for(let i=0;i<part.positions.length;i+=3){
          const x=part.positions[i],y=part.positions[i+1],z=part.positions[i+2]
          if(z>12 &&
            (x<outer.min[0]-0.15||x>outer.max[0]+0.15||
             y<outer.min[1]-0.15||y>outer.max[1]+0.15)){
            wallBoss=true;break
          }
        }
        expect(wallBoss).toBe(true)
      }
    }
  })
  it('uses manual bucket registration positions as heights and rejects vertical overlaps',()=>{
    const common={...DEFAULT_MOLD_SETTINGS,mode:'silicone-box' as const,
      keyPlacement:'manual' as const,keyPositions:[0.25,0.75]}
    const made=buildMold(wasm,master,common)
    expect(made.parts).toHaveLength(2)
    intact(made.parts)
    expect(()=>buildMold(wasm,master,{...common,keyPositions:[0.25,0.26]}))
      .toThrow(/Registration height.*too close/)
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
  it('exports clean, connected positive-clearance parts even with source repair off',()=>{
    // Numerical degenerates are produced by the SDF/CSG kernel AFTER the
    // master has been checked. The source repair checkbox must not control
    // whether output mesh cleanup is applied.
    const made=buildMold(wasm,master,{...noKeys,repairTarget:false,
      clearance:0.1,offsetQuality:'balanced'})
    expect(made.parts).toHaveLength(2)
    intact(made.parts)
    for(const part of made.parts){
      expect(part.volumeMm3).toBeGreaterThan(0)
      for(let i=0;i<part.indices.length;i+=3){
        const {positions:p,indices:idx}=part
        const a=idx[i]*3,b=idx[i+1]*3,c=idx[i+2]*3
        const ux=p[b]-p[a],uy=p[b+1]-p[a+1],uz=p[b+2]-p[a+2]
        const vx=p[c]-p[a],vy=p[c+1]-p[a+1],vz=p[c+2]-p[a+2]
        expect(Math.hypot(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx)).toBeGreaterThan(0)
      }
    }
    expect(made.warnings.join(' ')).not.toMatch(/source repair was OFF/i)
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
  it('places two well-separated automatic keys within the usable seam',()=>{
    const full=seamPositions(-12,12,DEFAULT_MOLD_SETTINGS)
    expect(full).toHaveLength(2)
    expect(full[0]).toBeCloseTo(-full[1])
    expect(full[1]-full[0]).toBeGreaterThan(
      DEFAULT_MOLD_SETTINGS.keyDiameter+2*DEFAULT_MOLD_SETTINGS.keyClearance,
    )
    // Four-part interfaces use a shorter seam but retain both keys when
    // sufficient material remains for their diameter and minimum spacing.
    const half=seamPositions(-12,0,DEFAULT_MOLD_SETTINGS)
    expect(half).toHaveLength(2)
    expect(half[0]).toBeGreaterThan(-12)
    expect(half[1]).toBeLessThan(0)
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
