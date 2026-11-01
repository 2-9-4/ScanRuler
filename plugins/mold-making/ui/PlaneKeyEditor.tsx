// SPDX-License-Identifier: AGPL-3.0-only
// Planar mating-feature editor for direct molds. Both local seam coordinates
// are editable, not just a scalar position on the bottom-Z backing.
import {useRef,type PointerEvent} from 'react'
import type {Limits} from '../core/geometry'
import type {SplitAxis} from '../core/settings'

type Point=[number,number]
interface Props {
  points:Point[]
  axis:SplitAxis
  manual:boolean
  onChange:(points:Point[])=>void
  onManual:()=>void
  bounds:Limits|null
  sideMargin:number
  baseThickness:number
  diameter:number
  clearance:number
  cavityClearance:number
}
const LX=48,RX=432,TY=36,BY=322,W=480,H=370
const clamp=(v:number)=>Math.max(0.01,Math.min(0.99,v))
const round=(v:number)=>Math.round(clamp(v)*1000)/1000
const dist=(a:Point,b:Point)=>Math.hypot(a[0]-b[0],a[1]-b[1])
const coords=(clientX:number,clientY:number,el:SVGSVGElement):Point=>{
  const r=el.getBoundingClientRect()
  const x=(clientX-r.left)/r.width*W,y=(clientY-r.top)/r.height*H
  return [round((x-LX)/(RX-LX)),round((BY-y)/(BY-TY))]
}
export function PlaneKeyEditor({points,axis,manual,onChange,onManual,bounds,sideMargin,baseThickness,diameter,clearance,cavityClearance}:Props){
  const drag=useRef<number|null>(null)
  const canvas=useRef<SVGSVGElement|null>(null)
  const dimensions:readonly [number,number]=axis==='x'?[1,2]:axis==='y'?[0,2]:[0,1]
  const axisLabels:readonly [string,string]=axis==='x'?['Y','Z']:axis==='y'?['X','Z']:['X','Y']
  const ext=bounds?dimensions.map(i=>[bounds.min[i]-(i===2?baseThickness:sideMargin),bounds.max[i]+(i===2?baseThickness:sideMargin)] as Point):null
  const uv=(i:0|1,v:number)=>ext?ext[i][0]+v*(ext[i][1]-ext[i][0]):null
  const target=ext&&bounds?{
    l:(bounds.min[dimensions[0]]-ext[0][0])/(ext[0][1]-ext[0][0]),
    r:(bounds.max[dimensions[0]]-ext[0][0])/(ext[0][1]-ext[0][0]),
    b:(bounds.min[dimensions[1]]-ext[1][0])/(ext[1][1]-ext[1][0]),
    t:(bounds.max[dimensions[1]]-ext[1][0])/(ext[1][1]-ext[1][0]),
  }:null
  const pad=diameter/2+clearance+0.75
  const uInset=ext?Math.min(0.49,pad/(ext[0][1]-ext[0][0])):0.12
  const vInset=ext?Math.min(0.49,pad/(ext[1][1]-ext[1][0])):0.15
  const display=manual?points:[[uInset,vInset],[1-uInset,vInset],
    [uInset,1-vInset],[1-uInset,1-vInset]] as Point[]
  const replace=(index:number,p:Point)=>{
    const next=points.map(v=>[...v] as Point)
    if(next.some((v,i)=>i!==index&&dist(v,p)<0.025))return
    next[index]=p;onChange(next)
  }
  const handleDown=(e:PointerEvent<SVGSVGElement>)=>{
    if(!manual){onManual();return}
    if(drag.current!==null||points.length>=16)return
    if(!canvas.current)return
    const p=coords(e.clientX,e.clientY,canvas.current)
    if(points.some(v=>dist(v,p)<0.025))return
    onChange([...points,p])
  }
  const radius=Math.max(8,Math.min(15,diameter*2.2))
  const fmt=(v:number|null)=>v===null?'—':v.toFixed(2)
  const collision=(p:Point)=>{
    if(!target||!ext)return false
    const x=uv(0,p[0])!,y=uv(1,p[1])!
    const tx=[bounds!.min[dimensions[0]],bounds!.max[dimensions[0]]]
    const ty=[bounds!.min[dimensions[1]],bounds!.max[dimensions[1]]]
    const dx=Math.max(tx[0]-x,0,x-tx[1]),dy=Math.max(ty[0]-y,0,y-ty[1])
    const inset=diameter/2+clearance+0.75
    return Math.hypot(dx,dy)<=diameter/2+clearance+cavityClearance+0.5||
      x<ext[0][0]+inset||x>ext[0][1]-inset||
      y<ext[1][0]+inset||y>ext[1][1]-inset
  }
  return <div className="mold-plane-editor">
    <div className="mold-plane-head">Parting-plane editor · {axisLabels.join(' / ')} axes</div>
    <svg ref={canvas} viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Two-dimensional mating pin editor"
      preserveAspectRatio="xMidYMid meet"
      onPointerDown={handleDown}
      onPointerMove={e=>{if(drag.current!==null&&manual)canvas.current&&replace(drag.current,coords(e.clientX,e.clientY,canvas.current))}}
      onPointerUp={()=>{drag.current=null}} onPointerCancel={()=>{drag.current=null}}>
      <rect x={LX} y={TY} width={RX-LX} height={BY-TY} fill="var(--well)" stroke="var(--line-strong)" strokeWidth="2"/>
      {[0.25,0.5,0.75].map(v=><g key={v} opacity=".33">
        <line x1={LX+v*(RX-LX)} x2={LX+v*(RX-LX)} y1={TY} y2={BY} stroke="var(--line)"/>
        <line x1={LX} x2={RX} y1={BY-v*(BY-TY)} y2={BY-v*(BY-TY)} stroke="var(--line)"/>
      </g>)}
      {target?<g>
        <rect x={LX+target.l*(RX-LX)} y={BY-target.t*(BY-TY)}
          width={(target.r-target.l)*(RX-LX)} height={(target.t-target.b)*(BY-TY)}
          fill="var(--dim)" opacity=".22" stroke="var(--ink)" strokeDasharray="5 4"/>
        <text x={LX+(target.l+target.r)/2*(RX-LX)} y={BY-(target.b+target.t)/2*(BY-TY)}
          textAnchor="middle" fill="var(--ink)" fontSize="12">Target envelope</text>
      </g>:<text x={W/2} y={TY+18} textAnchor="middle" fill="var(--dim)" fontSize="11">
        Generate once to show the actual target envelope
      </text>}
      {display.map((p,i)=>{
        const bad=collision(p),x=LX+p[0]*(RX-LX),y=BY-p[1]*(BY-TY)
        return <g key={i}>
          <circle cx={x} cy={y} r={radius} fill={bad?'#c94b52':'var(--accent)'}
            stroke="var(--panel)" strokeWidth="2"
            tabIndex={0} role="slider"
            aria-label={`Key ${i+1}: ${axisLabels[0]} ${Math.round(100*p[0])}%, ${axisLabels[1]} ${Math.round(100*p[1])}%`}
            aria-valuemin={1} aria-valuemax={99} aria-valuenow={Math.round(p[0]*100)}
            style={{cursor:manual?'move':'pointer',touchAction:'none'}}
            onPointerDown={e=>{e.stopPropagation();if(!manual){onManual();return}drag.current=i;e.currentTarget.setPointerCapture(e.pointerId)}}
            onPointerMove={e=>{e.stopPropagation();if(drag.current===i&&manual)canvas.current&&replace(i,coords(e.clientX,e.clientY,canvas.current))}}
            onPointerUp={()=>{drag.current=null}}
            onPointerCancel={()=>{drag.current=null}}
            onKeyDown={e=>{
              if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){
                e.preventDefault()
                if(!manual){onManual();return}
                replace(i,[round(p[0]+(e.key==='ArrowLeft'?-0.01:e.key==='ArrowRight'?0.01:0)),
                  round(p[1]+(e.key==='ArrowDown'?-0.01:e.key==='ArrowUp'?0.01:0))])
              }else if((e.key==='Delete'||e.key==='Backspace')&&manual&&points.length>1){
                e.preventDefault();onChange(points.filter((_,j)=>j!==i))
              }
            }}
            onDoubleClick={e=>{e.stopPropagation();if(manual&&points.length>1)onChange(points.filter((_,j)=>j!==i))}}
          />
          <text x={x} y={y+4} textAnchor="middle" fill="#fff" fontSize="11" pointerEvents="none">{i+1}</text>
        </g>
      })}
      <text x={(LX+RX)/2} y={H-12} textAnchor="middle" fill="var(--ink)" fontSize="13">{axisLabels[0]} → {ext?`${fmt(ext[0][0])} to ${fmt(ext[0][1])} mm`:'seam width'}</text>
      <text x={18} y={(TY+BY)/2} textAnchor="middle" fill="var(--ink)" fontSize="13"
        transform={`rotate(-90,18,${(TY+BY)/2})`}>{axisLabels[1]} ↑</text>
    </svg>
    <p className="hint">{manual
      ?'Drag pins in both axes, click empty material to add, or use arrow keys. Red pins may collide with the target or mold perimeter. The generator validates real clearances.'
      :'Automatic registration spans both axes and avoids the projected target envelope. Select Manual to move pins.'}</p>
    {manual&&<div className="mold-plane-points">
      {points.map((p,i)=><div key={i} className="mold-plane-point">
        <strong>Pin {i+1}</strong>
        {([0,1] as const).map(k=><label key={k}>{axisLabels[k]} %
          <input type="number" step="1" min="1" max="99" value={Math.round(p[k]*100)}
            onChange={e=>{const n=Number(e.target.value);if(Number.isFinite(n))replace(i,[...p.slice(0,k),round(n/100),...p.slice(k+1)] as Point)}}/>
        </label>)}
        <span className="hint">{fmt(uv(0,p[0]))}, {fmt(uv(1,p[1]))} mm</span>
        <button type="button" disabled={points.length<=1} aria-label={`Remove pin ${i+1}`}
          onClick={()=>onChange(points.filter((_,j)=>j!==i))}>×</button>
      </div>)}
    </div>}
  </div>
}
