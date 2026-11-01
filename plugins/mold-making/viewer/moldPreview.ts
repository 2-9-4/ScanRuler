// SPDX-License-Identifier: AGPL-3.0-only
// OPAQUE solid parts, separate draw calls and separate geometry buffers.
// Never draw overlapping semi-transparent front/back faces: those look
// ghosted, show z-fighting and falsely suggest an invalid surface.
import * as THREE from 'three'
import type { SceneManager } from '../../../src/viewer/SceneManager'
import type { SceneLayer } from '../../../src/viewer/sceneLayers'
import { CapSet, CAP_SLOT, cutColor } from '../../../src/viewer/sliceCap'
import type { MoldBuild } from '../core/geometry'
import type { MoldSource, PartCount, SplitAxis } from '../core/settings'

export type MoldPreviewMode = 'section' | 'exploded'

/** Parting-aware exploded offsets in assembled/model coordinates. This is
 * independent of the THREE scene graph so quadrant/radial layout can be
 * regression tested without WebGL.
 */
export function explodedMoldOffsets(
  boxes:readonly THREE.Box3[],parts:PartCount,splitAxis:SplitAxis,gap:number,
):THREE.Vector3[] {
  if(!boxes.length||!(gap>0))return boxes.map(()=>new THREE.Vector3())
  const total=new THREE.Box3()
  for(const box of boxes)total.union(box)
  const origin=total.getCenter(new THREE.Vector3())
  const size=total.getSize(new THREE.Vector3())
  const travel=gap+Math.max(size.x,size.y,size.z)*0.18
  return boxes.map((box,i)=>{
    if(parts===3){
      const a=(i+0.5)*2*Math.PI/3
      return new THREE.Vector3(Math.cos(a),Math.sin(a),0).multiplyScalar(travel)
    }
    const c=box.getCenter(new THREE.Vector3())
    const first=splitAxis==='x'?0:splitAxis==='y'?1:2
    const second=splitAxis==='x'?1:0
    const direction=new THREE.Vector3()
    const sign=(axis:number)=>{
      const a=c.getComponent(axis),o=origin.getComponent(axis)
      direction.setComponent(axis,a>=o?1:-1)
    }
    sign(first)
    if(parts===4)sign(second)
    return direction.normalize().multiplyScalar(travel)
  })
}

export class MoldPreview {
  private host: ReturnType<SceneManager['layerHost']>
  private readonly caps=new CapSet()
  private activeSection:THREE.Plane[]|null=null
  private group = new THREE.Group()
  private meshes:THREE.Mesh[]=[]
  private parts:THREE.Group[]=[]
  private remove:()=>void
  private source:MoldSource='scan'
  private priorNominal:boolean|null=null
  private priorScan:boolean|null=null
  private viewMode:MoldPreviewMode='section'
  private bounds:MoldBuild['targetBounds']|null=null
  private explodeGap=3
  private partCount:PartCount=2
  private splitAxis:SplitAxis='x'
  constructor(private scene:SceneManager,private changed:()=>void) {
    this.host=scene.layerHost()
    const layer:SceneLayer={
      order:80,
      clippingChanged:(planes,section)=>{
        for(const mesh of this.meshes){
          const m=mesh.material as THREE.MeshStandardMaterial
          m.clippingPlanes=planes??[]
          m.needsUpdate=true
        }
        this.activeSection=section?planes:null
        this.refreshCaps()
      },
      themeChanged:()=>this.refreshCaps(),
      partMoved:()=>this.changed(),
      scanReplaced:()=>{if(this.source==='scan')this.changed()},
      frameBox:()=>this.group.visible&&this.meshes.length?new THREE.Box3().setFromObject(this.group):null,
      dispose:()=>this.clear(),
    }
    this.group.name='Mold Making — print components'
    this.remove=scene.addLayer(layer)
  }
  private refreshCaps():void {
    this.caps.update(this.group.visible?this.activeSection:null,
      this.meshes.map((mesh,i)=>({
        mesh,slot:CAP_SLOT.layers+i,color:cutColor(CAP_SLOT.layers+i),
      })),this.host.theme())
  }
  set(build:MoldBuild,source:MoldSource,gap:number,mode:MoldPreviewMode='section',
    parts:PartCount=2,splitAxis:SplitAxis='x'):void {
    this.clear()
    this.source=source
    this.bounds=build.targetBounds
    this.explodeGap=gap
    this.viewMode=mode
    this.partCount=parts
    this.splitAxis=splitAxis
    this.group.visible=true
    if(source==='reference'){
      this.priorNominal=this.scene.nominalShown()
      this.host.scene.add(this.group)
    }else{
      this.priorScan=this.scene.scanShown()
      this.host.partGroup.add(this.group)
    }
    // MeshNormalMaterial/transparency was NOT intentional here. Real opaque
    // finish and correct depth writing make the part surface visible.
    for(const p of build.parts){
      const geo=new THREE.BufferGeometry()
      geo.setAttribute('position',new THREE.BufferAttribute(p.positions,3))
      geo.setIndex(new THREE.BufferAttribute(p.indices,1))
      geo.computeVertexNormals()
      geo.computeBoundingBox()
      const material=new THREE.MeshStandardMaterial({
        color:0x57a99d,roughness:0.68,metalness:0,flatShading:true,
        transparent:false,opacity:1,depthWrite:true,side:THREE.FrontSide,
        clippingPlanes:this.host.clipPlanes()??[],
      })
      const mesh=new THREE.Mesh(geo,material)
      mesh.name=p.name
      this.meshes.push(mesh)
      const part=new THREE.Group()
      part.name=p.name
      part.add(mesh)
      this.parts.push(part)
      this.group.add(part)
    }
    this.setMode(mode)
    this.refreshCaps()
  }
  setMode(mode:MoldPreviewMode):void {
    this.viewMode=mode
    const active=mode==='section'
    // Keep the original master visible within the separated mold components.
    // Unlike the prior mode, exploding the mold must never hide the model.
    if(this.source==='reference')this.scene.setNominalVisible(true)
    else this.scene.setScanVisible(true)
    this.setGap(active?0:this.explodeGap)
  }
  setGap(gap:number):void {
    if(!Number.isFinite(gap)||gap<0)return
    if(gap>0||this.viewMode==='exploded')this.explodeGap=gap
    const displayed=this.viewMode==='section'?0:gap
    const bounds=this.meshes.map(m=>m.geometry.boundingBox??new THREE.Box3())
    const offsets=explodedMoldOffsets(bounds,this.partCount,this.splitAxis,displayed)
    this.parts.forEach((p,i)=>p.position.copy(offsets[i]))
    this.host.invalidate()
  }
  setVisible(visible:boolean):void {
    this.group.visible=visible
    if(!visible&&this.bounds){
      // A section view belongs to the mold workspace, not to whichever
      // workspace is opened next.
      if(this.source==='reference'&&this.priorNominal!==null)
        this.scene.setNominalVisible(this.priorNominal)
      else if(this.source==='scan'&&this.priorScan!==null)
        this.scene.setScanVisible(this.priorScan)
    }else if(this.bounds)this.setMode(this.viewMode)
    this.refreshCaps()
    this.host.invalidate()
  }
  clear():void {
    this.caps.update(null,[],this.host.theme())
    this.activeSection=null
    this.bounds=null
    this.group.parent?.remove(this.group)
    for(const mesh of this.meshes){
      mesh.geometry.dispose()
      if(Array.isArray(mesh.material))mesh.material.forEach(x=>x.dispose())
      else mesh.material.dispose()
    }
    this.meshes=[]
    this.parts=[]
    this.group.clear()
    if(this.priorScan!==null){
      this.scene.setScanVisible(this.priorScan)
      this.priorScan=null
    }
    if(this.priorNominal!==null){
      this.scene.setNominalVisible(this.priorNominal)
      this.priorNominal=null
    }
    this.host.invalidate()
  }
  dispose():void{this.remove();this.caps.dispose()}
}
