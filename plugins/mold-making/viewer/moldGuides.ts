// SPDX-License-Identifier: AGPL-3.0-only
// Read-only pre-generation parting-plane guides and draggable casting
// channel handles. Attached to the SAME coordinate frame as the source.
// Deliberately not part of any manifold/printable mold geometry.
import * as THREE from 'three'
import type {SceneManager} from '../../../src/viewer/SceneManager'
import type {SceneLayer,SceneLayerHost} from '../../../src/viewer/sceneLayers'
import type {MoldSettings,MoldSource} from '../core/settings'
import type {Limits} from '../core/geometry'
import {masterMountMesh} from '../core/masterMount'

type MeshData={positions:Float32Array;indices:Uint32Array}
type XY=[number,number]
type XYZ=[number,number,number]
type Handle={kind:'pour'|'vent';index:number;mesh:THREE.Mesh}
const axisIndex=(a:'x'|'y'|'z')=>a==='x'?0:a==='y'?1:2
/** Stable read-only cut layout so previews match the actual two-/three-/fourfold splitter. */
export function cutGuideSegments(b:Limits,s:MoldSettings,frame:Limits=b):XYZ[][]{
  const cx=(b.min[0]+b.max[0])/2,cy=(b.min[1]+b.max[1])/2
  const z0=frame.min[2]-0.5,z1=frame.max[2]+0.5
  if(s.parts===3){
    const reach=Math.hypot(frame.max[0]-cx,frame.max[1]-cy)+0.5
    return [0,120,240].map(deg=>{
      const a=deg*Math.PI/180,x=cx+reach*Math.cos(a),y=cy+reach*Math.sin(a)
      return [[cx,cy,z0],[x,y,z0],[x,y,z1],[cx,cy,z1]] as XYZ[]
    })
  }
  const planes:{axis:'x'|'y'|'z';at:number}[]=[]
  if(s.parts===1)planes.push({axis:'z',at:(b.min[2]+b.max[2])/2})
  else{
    const axis=s.splitAxis,k=axisIndex(axis)
    planes.push({axis,at:b.min[k]+(b.max[k]-b.min[k])*s.splitPosition})
    if(s.parts===4){
      const other=axis==='x'?'y':'x',j=axisIndex(other)
      planes.push({axis:other,at:(b.min[j]+b.max[j])/2})
    }
  }
  return planes.map(({axis,at})=>{
    if(axis==='x')return [[at,frame.min[1]-0.5,z0],[at,frame.max[1]+0.5,z0],
      [at,frame.max[1]+0.5,z1],[at,frame.min[1]-0.5,z1]] as XYZ[]
    if(axis==='y')return [[frame.min[0]-0.5,at,z0],[frame.max[0]+0.5,at,z0],
      [frame.max[0]+0.5,at,z1],[frame.min[0]-0.5,at,z1]] as XYZ[]
    return [[frame.min[0]-0.5,frame.min[1]-0.5,at],[frame.max[0]+0.5,frame.min[1]-0.5,at],
      [frame.max[0]+0.5,frame.max[1]+0.5,at],[frame.min[0]-0.5,frame.max[1]+0.5,at]] as XYZ[]
  })
}

export class MoldGuides {
  private host:SceneLayerHost
  private group=new THREE.Group()
  private sourceMesh:THREE.Mesh|null=null
  private handles:Handle[]=[]
  private bounds:Limits|null=null
  private outerBounds:Limits|null=null
  private settings:MoldSettings|null=null
  private active=true
  private showPlanes=true
  private showHandles=true
  private planeObjects:THREE.Object3D[]=[]
  private pickBase=false
  private dragging:{handle:Handle;pointerId:number;z:number;final:XY|null}|null=null
  private remove:()=>void
  constructor(scene:SceneManager,
    private onMove:(kind:'pour'|'vent',index:number,point:XY)=>void,
    private onMount:(point:XYZ,normal:XYZ)=>void){
    this.host=scene.layerHost()
    const layer:SceneLayer={
      order:14,
      pointerDown:e=>this.pointerDown(e),
      clippingChanged:()=>this.host.invalidate(),
      dispose:()=>this.clear(),
    }
    this.remove=scene.addLayer(layer)
    this.host.canvas.addEventListener('pointermove',this.pointerMove)
    this.host.canvas.addEventListener('pointerup',this.pointerUp)
    this.host.canvas.addEventListener('pointercancel',this.pointerUp)
  }
  setVisible(on:boolean){this.active=on;this.group.visible=on;this.host.invalidate()}
  setOptions(planes:boolean,handles:boolean){
    this.showPlanes=planes;this.showHandles=handles;this.updateObjects()
  }
  setPickBase(pick:boolean){this.pickBase=pick;this.host.invalidate()}
  set(source:MoldSource,bounds:Limits,settings:MoldSettings,mesh?:MeshData,
    outerBounds:Limits=bounds):void{
    this.clear()
    this.bounds=bounds
    this.outerBounds=outerBounds
    this.settings=settings
    if(source==='reference')this.host.scene.add(this.group)
    else this.host.partGroup.add(this.group)
    this.group.visible=this.active
    if(mesh?.indices.length){
      const geo=new THREE.BufferGeometry()
      geo.setAttribute('position',new THREE.BufferAttribute(mesh.positions,3))
      geo.setIndex(new THREE.BufferAttribute(mesh.indices,1))
      geo.computeVertexNormals()
      this.sourceMesh=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({
        transparent:true,opacity:0,colorWrite:false,depthWrite:false,side:THREE.DoubleSide,
      }))
      this.group.add(this.sourceMesh)
    }
    this.updateObjects()
  }
  updateSettings(settings:MoldSettings):void{
    this.settings=settings
    if(this.bounds)this.updateObjects()
  }
  private updateObjects(){
    for(const item of this.planeObjects){
      item.parent?.remove(item)
      if(item instanceof THREE.LineSegments||item instanceof THREE.Mesh){
        item.geometry.dispose()
        ;(item.material as THREE.Material).dispose()
      }
    }
    this.planeObjects=[]
    for(const handle of this.handles){
      this.group.remove(handle.mesh);handle.mesh.geometry.dispose()
      ;(handle.mesh.material as THREE.Material).dispose()
    }
    this.handles=[]
    if(!this.bounds||!this.settings)return
    const b=this.bounds,s=this.settings
    if(this.showPlanes)for(const corners of cutGuideSegments(b,s,this.outerBounds??b)){
      const vertices=Float32Array.from(corners.flat())
      const geo=new THREE.BufferGeometry()
      geo.setAttribute('position',new THREE.BufferAttribute(vertices,3))
      geo.setIndex([0,1,2,0,2,3])
      const face=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({
        color:0x46bafa,transparent:true,opacity:0.13,side:THREE.DoubleSide,
        depthWrite:false,depthTest:false,
      }))
      face.renderOrder=4;this.group.add(face);this.planeObjects.push(face)
      const lineGeo=new THREE.BufferGeometry().setFromPoints(
        [0,1,1,2,2,3,3,0].map(i=>new THREE.Vector3(...corners[i])))
      const line=new THREE.LineSegments(lineGeo,new THREE.LineBasicMaterial({
        color:0x3caaff,transparent:true,opacity:0.85,depthTest:false,
      }))
      line.renderOrder=5;this.group.add(line);this.planeObjects.push(line)
    }
    const pointToModel=(pt:XY):XYZ=>[
      b.min[0]+pt[0]*(b.max[0]-b.min[0]),
      b.min[1]+pt[1]*(b.max[1]-b.min[1]),
      b.max[2]+Math.max(2,(b.max[2]-b.min[2])*0.08),
    ]
    const createHandle=(kind:'pour'|'vent',index:number,pt:XY)=>{
      const radius=Math.max(0.65,(kind==='pour'?s.pourDiameter:s.ventDiameter)/2)
      const mesh=new THREE.Mesh(new THREE.SphereGeometry(radius,16,10),
        new THREE.MeshBasicMaterial({color:kind==='pour'?0xfaa34e:0x80ebca,
          depthTest:false,transparent:true,opacity:0.95}))
      mesh.position.set(...pointToModel(pt))
      mesh.renderOrder=6
      this.group.add(mesh);this.handles.push({kind,index,mesh})
    }
    if(this.showHandles){
      if(s.pourEnabled)createHandle('pour',0,s.pourPoint)
      if(s.ventsEnabled)s.ventPoints.forEach((pt,i)=>createHandle('vent',i,pt))
    }
    if(s.mountEnabled&&s.mountPoint){
      try{
        const support=masterMountMesh(b,s)
        if(support){
          const geometry=new THREE.BufferGeometry()
          geometry.setAttribute('position',new THREE.BufferAttribute(support.positions,3))
          geometry.setIndex(new THREE.BufferAttribute(support.indices,1))
          geometry.computeVertexNormals()
          const model=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({
            color:0x9a65e9,transparent:true,opacity:0.7,side:THREE.DoubleSide,depthWrite:false,
          }))
          model.renderOrder=2
          this.group.add(model);this.planeObjects.push(model)
        }
      }catch{/* Invalid mounting point is reported by the generation preflight. */}
    }
    if(s.mountPoint){
      const marker=new THREE.Mesh(new THREE.SphereGeometry(Math.max(.8,s.mountPadDiameter/4),16,10),
        new THREE.MeshBasicMaterial({color:0xb977ff,transparent:true,opacity:.9,depthTest:false}))
      marker.position.set(...s.mountPoint);marker.renderOrder=6
      this.group.add(marker);this.planeObjects.push(marker)
    }
    this.host.invalidate()
  }
  private pointerDown(e:PointerEvent):boolean{
    if(!this.active||!this.bounds||!this.settings||e.button!==0)return false
    this.host.setPickRay(e.clientX,e.clientY)
    if(this.pickBase&&this.sourceMesh){
      const hit=this.host.raycaster.intersectObject(this.sourceMesh,false)[0]
      if(!hit?.face)return false
      const local=this.group.worldToLocal(hit.point.clone())
      const n=hit.face.normal.clone().normalize()
      this.pickBase=false
      this.onMount([local.x,local.y,local.z],[n.x,n.y,n.z])
      this.host.invalidate()
      return true
    }
    if(!this.showHandles)return false
    const hits=this.host.raycaster.intersectObjects(this.handles.map(h=>h.mesh),false)
    if(!hits.length)return false
    const handle=this.handles.find(h=>h.mesh===hits[0].object)
    if(!handle)return false
    this.dragging={handle,pointerId:e.pointerId,z:handle.mesh.position.z,final:null}
    this.host.claimDrag(true)
    this.host.canvas.setPointerCapture(e.pointerId)
    return true
  }
  private pointerMove=(e:PointerEvent)=>{
    const drag=this.dragging,b=this.bounds
    if(!drag||drag.pointerId!==e.pointerId||!b)return
    this.host.setPickRay(e.clientX,e.clientY)
    this.group.updateWorldMatrix(true,false)
    const planePoint=new THREE.Vector3(0,0,drag.z).applyMatrix4(this.group.matrixWorld)
    const planeNormal=new THREE.Vector3(0,0,1).transformDirection(this.group.matrixWorld)
    const plane=new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal,planePoint)
    const world=new THREE.Vector3()
    if(!this.host.raycaster.ray.intersectPlane(plane,world))return
    const pos=this.group.worldToLocal(world)
    const fx=(pos.x-b.min[0])/(b.max[0]-b.min[0])
    const fy=(pos.y-b.min[1])/(b.max[1]-b.min[1])
    if(!Number.isFinite(fx)||!Number.isFinite(fy))return
    const xy:XY=[Math.max(.01,Math.min(.99,fx)),Math.max(.01,Math.min(.99,fy))]
    drag.handle.mesh.position.x=b.min[0]+xy[0]*(b.max[0]-b.min[0])
    drag.handle.mesh.position.y=b.min[1]+xy[1]*(b.max[1]-b.min[1])
    drag.final=xy
    this.host.invalidate()
  }
  private pointerUp=(e:PointerEvent)=>{
    if(!this.dragging||this.dragging.pointerId!==e.pointerId)return
    if(this.dragging.final)
      this.onMove(this.dragging.handle.kind,this.dragging.handle.index,this.dragging.final)
    this.dragging=null
    this.host.claimDrag(false)
    if(this.host.canvas.hasPointerCapture(e.pointerId))
      this.host.canvas.releasePointerCapture(e.pointerId)
  }
  clear(){
    this.dragging=null
    this.group.parent?.remove(this.group)
    for(const obj of this.planeObjects){
      if(obj instanceof THREE.Mesh||obj instanceof THREE.LineSegments){
        obj.geometry.dispose();(obj.material as THREE.Material).dispose()
      }
    }
    for(const h of this.handles){h.mesh.geometry.dispose();(h.mesh.material as THREE.Material).dispose()}
    this.planeObjects=[];this.handles=[]
    if(this.sourceMesh){
      this.sourceMesh.geometry.dispose()
      ;(this.sourceMesh.material as THREE.Material).dispose()
      this.sourceMesh=null
    }
    this.group.clear()
    this.bounds=null;this.outerBounds=null;this.settings=null
    this.host.invalidate()
  }
  dispose(){
    this.remove()
    this.host.canvas.removeEventListener('pointermove',this.pointerMove)
    this.host.canvas.removeEventListener('pointerup',this.pointerUp)
    this.host.canvas.removeEventListener('pointercancel',this.pointerUp)
  }
}
