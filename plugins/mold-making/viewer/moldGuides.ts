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
/** Try bounding-box center first, then a compact radial search over the
 * underside so a centered cavity/hole does not make auto-centering fail. */
export function mountCenterCandidates(bounds:Limits):XY[]{
  const cx=(bounds.min[0]+bounds.max[0])/2
  const cy=(bounds.min[1]+bounds.max[1])/2
  const sx=bounds.max[0]-bounds.min[0],sy=bounds.max[1]-bounds.min[1]
  const candidates:XY[]=[[cx,cy]]
  for(const fraction of [0.05,0.12,0.22]){
    for(let i=0;i<8;i++){
      const t=2*Math.PI*i/8
      candidates.push([cx+sx*fraction*Math.cos(t),cy+sy*fraction*Math.sin(t)])
    }
  }
  return candidates
}
type Handle={kind:'pour'|'vent';index:number;mesh:THREE.Mesh;pick:THREE.Mesh;label:THREE.Sprite;leader:THREE.Line}
const axisIndex=(a:'x'|'y'|'z')=>a==='x'?0:a==='y'?1:2
/** Stable read-only cut layout so previews match the actual two-/three-/fourfold splitter. */
export function cutGuideSegments(b:Limits,s:MoldSettings,frame:Limits=b):XYZ[][]{
  const cx=(b.min[0]+b.max[0])/2,cy=(b.min[1]+b.max[1])/2
  const z0=frame.min[2]-0.5,z1=frame.max[2]+0.5
  if(s.parts===3){
    const reach=Math.max(frame.max[0]-cx,frame.max[1]-cy)+0.5
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
  private handleDecorations:THREE.Object3D[]=[]
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
      handle.pick.parent?.remove(handle.pick)
      handle.pick.geometry.dispose();(handle.pick.material as THREE.Material).dispose()
    }
    this.handles=[]
    for(const obj of this.handleDecorations){
      obj.parent?.remove(obj)
      if(obj instanceof THREE.Mesh||obj instanceof THREE.Sprite){
        if(obj instanceof THREE.Mesh)obj.geometry.dispose()
        const mat=obj.material as THREE.SpriteMaterial|THREE.MeshBasicMaterial
        if(mat.map)mat.map.dispose()
        mat.dispose()
      }else if(obj instanceof THREE.Line){
        obj.geometry.dispose()
        ;(obj.material as THREE.Material).dispose()
      }
    }
    this.handleDecorations=[]
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
    const pointToModel=(pt:XY):XYZ=>{
      const x=b.min[0]+pt[0]*(b.max[0]-b.min[0])
      const y=b.min[1]+pt[1]*(b.max[1]-b.min[1])
      return [x,y,this.surfaceHeight(x,y)??b.max[2]]
    }
    const createHandle=(kind:'pour'|'vent',index:number,pt:XY)=>{
      const diameter=kind==='pour'?s.pourDiameter:s.ventDiameter
      const radius=Math.max(0.65,diameter/2)
      const x=b.min[0]+pt[0]*(b.max[0]-b.min[0])
      const y=b.min[1]+pt[1]*(b.max[1]-b.min[1])
      const hasSurface=this.surfaceHeight(x,y)!==null
      const color=!hasSurface?0xff4055:kind==='pour'?0xff982b:0x3fd9d1
      // A visible annulus centered on the target's actual top surface,
      // showing the requested hole diameter, not a ball floating above it.
      const mesh=new THREE.Mesh(new THREE.TorusGeometry(radius,Math.max(.12,radius*.12),8,40),
        new THREE.MeshBasicMaterial({color,depthTest:false,depthWrite:false,
          transparent:true,opacity:1,side:THREE.DoubleSide}))
      const xyz=pointToModel(pt)
      mesh.position.set(xyz[0],xyz[1],xyz[2]+0.15)
      mesh.renderOrder=7
      this.group.add(mesh)
      // Broad transparent hit disk makes the narrow circle easy to grab
      // without replacing the visible hole marker with a floating sphere.
      const pick=new THREE.Mesh(new THREE.CircleGeometry(radius*1.35,32),
        new THREE.MeshBasicMaterial({colorWrite:false,depthWrite:false,
          transparent:true,opacity:0,side:THREE.DoubleSide}))
      pick.position.copy(mesh.position)
      this.group.add(pick)
      this.handles.push({kind,index,mesh,pick,
        label:null as unknown as THREE.Sprite,leader:null as unknown as THREE.Line})
      const canvas=document.createElement('canvas')
      canvas.width=384;canvas.height=88
      const ctx=canvas.getContext('2d')
      if(ctx){
        ctx.fillStyle='rgba(16,22,30,0.9)'
        ctx.roundRect(2,4,380,78,15);ctx.fill()
        ctx.strokeStyle=kind==='pour'?'#ff982b':'#3fd9d1'
        ctx.lineWidth=4;ctx.stroke()
        ctx.fillStyle='#ffffff';ctx.font='bold 32px sans-serif'
        ctx.textAlign='center';ctx.textBaseline='middle'
        ctx.fillText(!hasSurface?`${kind==='pour'?'SPRUE':'VENT '+(index+1)} — NO SURFACE`:
          kind==='pour'?`SPRUE Ø${diameter}mm`:`VENT ${index+1} Ø${diameter}mm`,192,44)
      }
      const texture=new THREE.CanvasTexture(canvas)
      const sprite=new THREE.Sprite(new THREE.SpriteMaterial({
        map:texture,depthTest:false,depthWrite:false,transparent:true,
      }))
      const h=Math.max(2.4,Math.min(5,(b.max[2]-b.min[2])*.12))
      sprite.scale.set(h*384/88,h,1)
      sprite.position.set(xyz[0],xyz[1],xyz[2]+h*1.25)
      sprite.renderOrder=8
      this.group.add(sprite);this.handleDecorations.push(sprite)
      // Thin leader joins the label to the actual surface opening.
      const points=[new THREE.Vector3(xyz[0],xyz[1],xyz[2]+0.2),
        new THREE.Vector3(xyz[0],xyz[1],xyz[2]+h*.9)]
      const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({color,depthTest:false}))
      line.renderOrder=7
      this.group.add(line);this.handleDecorations.push(line)
      this.handles[this.handles.length-1].label=sprite
      this.handles[this.handles.length-1].leader=line
    }
    if(this.showHandles){
      if(s.pourEnabled)createHandle('pour',0,s.pourPoint)
      if(s.ventsEnabled)s.ventPoints.forEach((pt,i)=>createHandle('vent',i,pt))
    }
    if(s.mountEnabled&&s.mountPoint){
      try{
        const support=masterMountMesh(b,s,this.outerBounds??b)
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
  /** Find the frontmost intersection in the vertical bore direction. A
   *  marker is not valid until an actual source triangle is underneath. */
  private surfaceHeight(x:number,y:number):number|null{
    if(!this.sourceMesh||!this.bounds)return null
    this.group.updateWorldMatrix(true,false)
    const top=this.bounds.max[2]+Math.max(5,this.bounds.max[2]-this.bounds.min[2])
    const origin=new THREE.Vector3(x,y,top).applyMatrix4(this.group.matrixWorld)
    const direction=new THREE.Vector3(0,0,-1).transformDirection(this.group.matrixWorld)
    const ray=new THREE.Raycaster(origin,direction,0,Infinity)
    const hit=ray.intersectObject(this.sourceMesh,false)[0]
    if(!hit)return null
    return this.group.worldToLocal(hit.point.clone()).z
  }
  /** Place a mount at the XY center and the first downward-facing
   * surface hit from below. No manual camera orbit or face click required. */
  centerMount():boolean{
    if(!this.active||!this.bounds||!this.sourceMesh)return false
    const b=this.bounds
    this.group.updateWorldMatrix(true,false)
    const depth=Math.max(5,b.max[2]-b.min[2])
    const direction=new THREE.Vector3(0,0,1).transformDirection(this.group.matrixWorld)
    for(const [x,y] of mountCenterCandidates(b)){
      const origin=new THREE.Vector3(x,y,b.min[2]-depth).applyMatrix4(this.group.matrixWorld)
      const ray=new THREE.Raycaster(origin,direction,0,Infinity)
      const hits=ray.intersectObject(this.sourceMesh,false)
      const hit=hits.find(h=>h.face&&h.face.normal.z<=-0.5)
      if(!hit?.face)continue
      const point=this.group.worldToLocal(hit.point.clone())
      const normal=hit.face.normal.clone().normalize()
      this.pickBase=false
      this.onMount([point.x,point.y,point.z],[normal.x,normal.y,normal.z])
      this.host.invalidate()
      return true
    }
    return false
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
    const hits=this.host.raycaster.intersectObjects(this.handles.map(h=>h.pick),false)
    if(!hits.length)return false
    const handle=this.handles.find(h=>h.pick===hits[0].object)
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
    const z=this.surfaceHeight(drag.handle.mesh.position.x,drag.handle.mesh.position.y)
    if(z===null){drag.final=null;return}
    drag.handle.mesh.position.z=z+0.15
    drag.handle.pick.position.copy(drag.handle.mesh.position)
    const label=drag.handle.label,leader=drag.handle.leader
    const h=label.position.z-leader.geometry.getAttribute('position').getZ(0)
    label.position.set(drag.handle.mesh.position.x,drag.handle.mesh.position.y,z+h)
    leader.geometry.setFromPoints([
      new THREE.Vector3(drag.handle.mesh.position.x,drag.handle.mesh.position.y,z+0.2),
      new THREE.Vector3(drag.handle.mesh.position.x,drag.handle.mesh.position.y,z+h*0.7),
    ])
    drag.final=xy
    this.host.invalidate()
  }
  private pointerUp=(e:PointerEvent)=>{
    if(!this.dragging||this.dragging.pointerId!==e.pointerId)return
    if(this.dragging.final)
      this.onMove(this.dragging.handle.kind,this.dragging.handle.index,this.dragging.final)
    else this.updateObjects() // Revert a drag to an XY location with no source surface.
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
    for(const h of this.handles){
      h.mesh.geometry.dispose();(h.mesh.material as THREE.Material).dispose()
      h.pick.geometry.dispose();(h.pick.material as THREE.Material).dispose()
    }
    for(const obj of this.handleDecorations){
      if(obj instanceof THREE.Mesh||obj instanceof THREE.Sprite){
        if(obj instanceof THREE.Mesh)obj.geometry.dispose()
        const material=obj.material as THREE.SpriteMaterial|THREE.MeshBasicMaterial
        material.map?.dispose();material.dispose()
      }else if(obj instanceof THREE.Line){
        obj.geometry.dispose();(obj.material as THREE.Material).dispose()
      }
    }
    this.planeObjects=[];this.handles=[];this.handleDecorations=[]
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
