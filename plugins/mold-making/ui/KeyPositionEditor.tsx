// SPDX-License-Identifier: AGPL-3.0-only
// A schematic, accessible seam-position editor: drag pins or click the track
// to place a pin. Does not pretend to know the loaded model's local geometry.
import { useRef, type PointerEvent } from 'react'

interface Props {
  positions:number[]
  manual:boolean
  onChange:(positions:number[])=>void
  onManual:()=>void
  vertical:boolean
  diameter:number
}
const X0=24,X1=376,Y=42
const fraction=(clientX:number,el:SVGSVGElement)=>{
  const r=el.getBoundingClientRect()
  return Math.max(0.01,Math.min(0.99,(clientX-r.left-r.width*X0/400)/(r.width*(X1-X0)/400)))
}
const snapped=(x:number)=>Math.round(x*1000)/1000
const sorted=(x:number[])=>[...x].sort((a,b)=>a-b)
export function KeyPositionEditor({positions,manual,onChange,onManual,vertical,diameter}:Props){
  const drag=useRef<number|null>(null)
  const svg=useRef<SVGSVGElement|null>(null)
  const items=manual?positions:[0.22,0.78]
  const commit=(index:number,where:number)=>{
    const next=positions.slice()
    // Avoid duplicates and obvious overlaps in the schematic. The worker
    // checks physical spacing against actual model bounds before generating.
    const f=snapped(where)
    if(next.some((x,i)=>i!==index&&Math.abs(x-f)<0.025))return
    next[index]=f
    onChange(next)
  }
  const begin=(e:PointerEvent<SVGCircleElement>,index:number)=>{
    e.stopPropagation()
    if(!manual){onManual();return}
    drag.current=index
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const move=(e:PointerEvent<SVGCircleElement>)=>{
    if(drag.current===null||!svg.current)return
    commit(drag.current,fraction(e.clientX,svg.current))
  }
  const add=(e:PointerEvent<SVGSVGElement>)=>{
    if(!manual){onManual();return}
    if(positions.length>=12||!svg.current)return
    const f=snapped(fraction(e.clientX,svg.current))
    if(positions.some(x=>Math.abs(x-f)<0.025))return
    onChange(sorted([...positions,f]))
  }
  return <div className="mold-key-editor">
    <div className="mold-key-editor-title">{vertical?'Registration heights on wall':'Registration locations along seam'} · schematic</div>
    <svg ref={svg} viewBox="0 0 400 88" preserveAspectRatio="xMidYMid meet"
      role="group" aria-label="Alignment pin position editor"
      onPointerDown={add}>
      <rect x={X0} y="26" width={X1-X0} height="32" rx="5" fill="var(--well)" stroke="var(--line)"/>
      <line x1={X0} y1={Y} x2={X1} y2={Y} stroke="var(--line-strong)" strokeWidth="2"/>
      {[0,0.25,0.5,0.75,1].map(t=><g key={t}>
        <path d={`M ${X0+(X1-X0)*t} 60 v 4`} stroke="var(--dim)"/>
        <text x={X0+(X1-X0)*t} y="77" fill="var(--dim)" textAnchor="middle" fontSize="10">{Math.round(t*100)}%</text>
      </g>)}
      {items.map((v,i)=><circle key={manual?i:`auto-${i}`}
        cx={X0+(X1-X0)*v} cy={Y} r={Math.min(12,Math.max(7,diameter*2))}
        fill="var(--accent)" stroke="var(--panel)" strokeWidth="2"
        style={{cursor:manual?'ew-resize':'pointer',touchAction:'none'}}
        role="slider" tabIndex={0} aria-label={`Pin ${i+1}`} aria-valuemin={1}
        aria-valuemax={99} aria-valuenow={Math.round(v*100)}
        onPointerDown={e=>begin(e,i)}
        onPointerMove={move}
        onPointerUp={()=>{drag.current=null}}
        onPointerCancel={()=>{drag.current=null}}
        onDoubleClick={e=>{e.stopPropagation();if(manual&&positions.length>1)onChange(positions.filter((_,k)=>k!==i))}}
        onKeyDown={e=>{
          if(e.key==='ArrowLeft'||e.key==='ArrowRight'){
            e.preventDefault()
            if(!manual){onManual();return}
            commit(i,v+(e.key==='ArrowRight'?0.01:-0.01))
          }else if((e.key==='Delete'||e.key==='Backspace')&&manual&&positions.length>1){
            e.preventDefault();onChange(positions.filter((_,k)=>k!==i))
          }
        }}>
        <title>{manual?'Drag or use arrow keys to position; double-click/Delete to remove':'Automatic pin — switch to manual to edit'} · {Math.round(v*100)}%</title>
      </circle>)}
    </svg>
    <p className="hint">{manual
      ?'Click the strip to add, drag pins to move, double-click or press Delete to remove. Use arrow keys for 1% adjustments. Positions are checked for physical clearance when generating.'
      :'Auto places two separated keys per seam when space permits. Select manual to edit the positions.'}</p>
    {manual&&<div className="mold-key-chips">
      {sorted(positions).map((v,i)=><button type="button" key={i}
        title="Remove this registration pin" onClick={()=>onChange(positions.filter(x=>x!==v))}
        disabled={positions.length<=1}>{Math.round(v*100)}% ×</button>)}
    </div>}
  </div>
}
