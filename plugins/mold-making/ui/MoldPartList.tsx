// SPDX-License-Identifier: AGPL-3.0-only
// One place for visibility, export, and downstream editing of each part.
// Actions are display-only except the explicitly labeled export/import.
import type {MoldPart} from '../core/geometry'
import {isolateMoldPart,toggleMoldPart,visibleMoldParts} from './partVisibility'

export function MoldPartList({
  parts,printable,visible,onVisibilityChange,masterVisible,onMasterVisibilityChange,onExportPart,onEditPart,
}:{
  parts:readonly MoldPart[]
  printable:boolean
  visible:readonly boolean[]
  onVisibilityChange:(next:boolean[])=>void
  masterVisible:boolean
  onMasterVisibilityChange:(visible:boolean)=>void
  onExportPart:(index:number)=>void
  onEditPart:(index:number,workspace:'mesh'|'reverse')=>void
}){
  const shown=visibleMoldParts(visible,parts.length)
  return <div data-test="mold-parts-list">
    <div className="sec-head">Inspect and export individual parts</div>
    <p className="hint">Hide or isolate components for inspection; the original master has its own visibility control. Display options never change STL, 3MF, or mold geometry. Reference in CAD preserves the complete assembly and original model; Edit copy replaces the active scan.</p>
    <label className="kv"><span className="name">Show original master / source model</span>
      <input type="checkbox" data-test="mold-show-master"
        checked={masterVisible} onChange={e=>onMasterVisibilityChange(e.target.checked)}/>
    </label>
    <p className="hint">The draft heatmap is a separate diagnostic overlay controlled by the viewport toolbar; hiding the source model does not disable that overlay.</p>
    <div className="kv">
      <span className="name">{shown.filter(Boolean).length} of {parts.length} visible</span>
      <button type="button" data-test="mold-show-all-parts"
        disabled={shown.every(Boolean)}
        onClick={()=>onVisibilityChange(shown.map(()=>true))}>Show all parts</button>
    </div>
    {parts.map((part,i)=>{
      const isIsolated=shown.every((v,j)=>v===(i===j))
      return <div key={i} className="group" data-test={`mold-part-row-${i}`}>
        <div className="kv">
          <span className="name">{part.name} · {Math.round(part.indices.length/3).toLocaleString('en-US')} faces</span>
          <button type="button" data-test={`mold-part-visible-${i}`}
            aria-label={`${shown[i]?'Hide':'Show'} ${part.name} in viewport`}
            aria-pressed={shown[i]}
            onClick={()=>onVisibilityChange(toggleMoldPart(shown,parts.length,i))}>
            {shown[i]?'Hide':'Show'}
          </button>
          <button type="button" data-test={`mold-part-isolate-${i}`}
            aria-label={isIsolated?`Show all mold parts`:`Isolate ${part.name} in viewport`}
            aria-pressed={isIsolated}
            onClick={()=>onVisibilityChange(isolateMoldPart(shown,parts.length,i))}>
            {isIsolated?'Unisolate':'Isolate'}
          </button>
        </div>
        <div className="kv">
          <span className="name">Export or continue editing</span>
          <button type="button" disabled={!printable}
            data-test={`mold-export-part-${i+1}`}
            onClick={()=>onExportPart(i)}>STL</button>
          <button type="button" disabled={!printable}
            data-test={`mold-edit-mesh-${i}`}
            onClick={()=>onEditPart(i,'mesh')}>Edit copy</button>
          <button type="button" disabled={!printable}
            data-test={`mold-edit-cad-${i}`}
            title="Show all mold pieces and the original model in Reverse Engineering, with this part highlighted. View-only reference; does not import or replace the active scan."
            onClick={()=>onEditPart(i,'reverse')}>Reference in CAD</button>
        </div>
      </div>
    })}
  </div>
}
