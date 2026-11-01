// SPDX-License-Identifier: AGPL-3.0-only
// Explicit tooling choices and per-part export; no hidden mid-height cut.
import { SCAN_ACCEPT,REFERENCE_ACCEPT,REFERENCE_FORMATS } from '../../../src/core/formats'
import { ModelSlot } from '../../../src/ui/ModelSlot'
import { useStore } from '../../../src/state/store'
import { useDeviation } from '../../../src/state/deviationStore'
import { MOLD_MODES,MOLD_MODE_LABELS,type MoldDimension,type PartCount,type SplitAxis,type BoxShape, type KeyStyle, type KeyPlacement, type OffsetQuality } from '../core/settings'
import { useMold } from '../state/moldStore'
import type { MoldBuild, Limits } from '../core/geometry'
import { KeyPositionEditor } from './KeyPositionEditor'
import { PlaneKeyEditor } from './PlaneKeyEditor'
import type { MoldPreviewMode } from '../viewer/moldPreview'

const FIELDS:readonly {key:MoldDimension;label:string;help:string}[]=[
  {key:'clearance',label:'Cavity clearance (+ enlarges)',help:'Positive means a spherical dilation of the target solid, enlarging the casting cavity. A signed-distance field is sampled to generate a closed offset; small features may be lost at the chosen grid resolution.'},
  {key:'sideMargin',label:'Outer margin',help:'Material beyond the target in X and Y, millimetres'},
  {key:'baseThickness',label:'Base / top material',help:'Solid material outside the target bounds'},
  {key:'wallThickness',label:'Printed wall',help:'Wall thickness of the silicone box'},
  {key:'siliconeThickness',label:'Silicone space',help:'Distance between master and containment walls'},
  {key:'splitPosition',label:'Split location (0–1)',help:'Fraction of model bounds along selected X/Y/Z axis'},
  {key:'keyDiameter',label:'Registration diameter',help:'Printed key base or nominal diameter of a separately inserted metal dowel'},
  {key:'keyDepth',label:'Registration depth',help:'Printed pin engagement or blind hole depth in each half for a separate metal dowel'},
  {key:'keyClearance',label:'Radial fit clearance',help:'Added radius to the female printed-key pocket or both metal-dowel holes'},
  {key:'boxDraftDeg',label:'Interior wall draft (°)',help:'Silicone containment-box wall taper; does not change the master cavity'},
  {key:'previewGap',label:'Exploded view gap',help:'Spacing between parts in the viewport. Zero shows assembled geometry.'},
]
export function MoldPanel({onOpenScan,onOpenReference,onGenerate,onExport,generated,targetBounds,previewMode,onPreviewModeChange,generating,error}:{
  onOpenScan:(file:File)=>void
  onOpenReference:(file:File)=>void
  onGenerate:()=>void
  onExport:(format:'stl'|'3mf',index?:number)=>void
  generated:MoldBuild|null
  targetBounds:Limits|null
  previewMode:MoldPreviewMode
  onPreviewModeChange:(mode:MoldPreviewMode)=>void
  generating:boolean
  error:string|null
}) {
  const scanName=useStore(s=>s.fileName)
  const tris=useStore(s=>s.triangleCount)
  const refName=useDeviation(s=>s.nominalName)
  const busy=useStore(s=>s.busy)
  const workProgress=useStore(s=>s.progress)
  const workStatus=useStore(s=>s.statusText)
  const source=useMold(s=>s.source),mode=useMold(s=>s.mode)
  const parts=useMold(s=>s.parts),splitAxis=useMold(s=>s.splitAxis)
  const boxShape=useMold(s=>s.boxShape),keys=useMold(s=>s.keys)
  const keyStyle=useMold(s=>s.keyStyle),keyPlacement=useMold(s=>s.keyPlacement)
  const keyPositions=useMold(s=>s.keyPositions)
  const keyPoints=useMold(s=>s.keyPoints)
  const offsetQuality=useMold(s=>s.offsetQuality)
  const repairTarget=useMold(s=>s.repairTarget)
  const repairHoleSize=useMold(s=>s.repairHoleSize)
  const clearance=useMold(s=>s.clearance)
  const sideMargin=useMold(s=>s.sideMargin)
  const baseThickness=useMold(s=>s.baseThickness)
  const wallThickness=useMold(s=>s.wallThickness)
  const siliconeThickness=useMold(s=>s.siliconeThickness)
  const splitPosition=useMold(s=>s.splitPosition)
  const keyDiameter=useMold(s=>s.keyDiameter)
  const keyDepth=useMold(s=>s.keyDepth)
  const keyClearance=useMold(s=>s.keyClearance)
  const boxDraftDeg=useMold(s=>s.boxDraftDeg)
  const previewGap=useMold(s=>s.previewGap)
  const values={clearance,repairHoleSize,sideMargin,baseThickness,wallThickness,siliconeThickness,splitPosition,
    keyDiameter,keyDepth,keyClearance,boxDraftDeg,previewGap}
  const setSource=useMold(s=>s.setSource),setMode=useMold(s=>s.setMode)
  const setParts=useMold(s=>s.setParts),setSplitAxis=useMold(s=>s.setSplitAxis)
  const setBoxShape=useMold(s=>s.setBoxShape),setKeys=useMold(s=>s.setKeys)
  const setKeyStyle=useMold(s=>s.setKeyStyle),setKeyPlacement=useMold(s=>s.setKeyPlacement)
  const setKeyPositions=useMold(s=>s.setKeyPositions)
  const setKeyPoints=useMold(s=>s.setKeyPoints)
  const setDimension=useMold(s=>s.setDimension)
  const setRepairTarget=useMold(s=>s.setRepairTarget)
  const setOffsetQuality=useMold(s=>s.setOffsetQuality)
  const active=source==='scan'?scanName:refName
  const multi=parts>1
  const fields=FIELDS.filter(({key})=>{
    if(key==='previewGap')return true
    if(key==='splitPosition')return multi
    if(['keyDiameter','keyDepth','keyClearance'].includes(key))return multi&&keys
    if(key==='boxDraftDeg')return mode==='silicone-box'
    if(mode==='direct')return ['clearance','sideMargin','baseThickness'].includes(key)
    if(mode==='silicone-box')return ['siliconeThickness','wallThickness','baseThickness'].includes(key)
    return false
  })
  return <aside className="panel" data-test="mold-making-panel">
    <div className="group">
      <div className="sec-head">1. Target</div>
      <p className="hint">{mode==='silicone-box'?'Containment boxes need only the target bounding dimensions; open or nonmanifold meshes are allowed.':'Direct molds require a watertight target; use a valid solid or repair the scan first.'} The original model is never modified.</p>
      <div className="kindrow featurekeys" role="radiogroup" aria-label="Target source">
        <button type="button" role="radio" aria-checked={source==='scan'} className={source==='scan'?'on':undefined}
          onClick={()=>setSource('scan')}>Scan / model</button>
        <button type="button" role="radio" aria-checked={source==='reference'} className={source==='reference'?'on':undefined}
          onClick={()=>setSource('reference')}>Reference STEP / mesh</button>
      </div>
      {source==='scan'?
        <ModelSlot role="Target" name={scanName} detail={`${tris.toLocaleString('en-US')} triangles`}
          dotColor="#8b9099" busy={busy} accept={SCAN_ACCEPT}
          formats={REFERENCE_FORMATS} onOpen={onOpenScan}/>:
        <ModelSlot role="Target reference" name={refName} detail="CAD or mesh reference"
          dotColor="#8b9099" busy={busy} accept={REFERENCE_ACCEPT}
          formats={REFERENCE_FORMATS} onOpen={onOpenReference}/>}
      {mode==='silicone-box'?(
        <p className="hint">Only the target bounds are used to size this container. Mesh topology, hole repair and cavity offsets do not affect the box.</p>
      ):(
        <>
        <label className="kv"><span className="name">Repair small mesh defects</span>
          <input type="checkbox" data-test="mold-repair-target"
            checked={repairTarget} onChange={e=>setRepairTarget(e.target.checked)}/>
        </label>
        {repairTarget&&<label className="kv" title="Only complete holes smaller than this across are patched. Large or ambiguous missing areas cause an error, not an automatic edit.">
          <span className="name">Max repair hole size (mm)</span>
          <input type="number" min={0.001} step={0.1} data-test="mold-repair-hole-size"
            value={repairHoleSize}
            onChange={e=>{if(e.target.value!=='')setDimension('repairHoleSize',Number(e.target.value))}}/>
        </label>}
        <p className="hint">Before generating, remove exactly zero-area faces, weld identical duplicate vertices and fill small closed holes on a temporary copy. The original scan/STEP remains unchanged. Repairs appear in output warnings; inspect them before printing.</p>
        </>
      )}
    </div>
    <div className="group">
      <div className="sec-head">2. Mold type</div>
      <div className="kindrow featurekeys mold-type-choices" role="radiogroup" aria-label="Tooling method">
        {MOLD_MODES.map(x=><button key={x} type="button" role="radio" aria-checked={mode===x}
          className={mode===x?'on':undefined} onClick={()=>setMode(x)}>{MOLD_MODE_LABELS[x]}</button>)}
      </div>
      {mode==='silicone-box'&&parts===3&&<p className="hint">Threefold forces a cylindrical containment box for rotationally spaced 120° sectors.</p>}
      {mode==='silicone-box'&&parts!==3&&
        <label className="kv"><span className="name">Box outline</span>
          <select data-test="mold-box-shape" value={boxShape}
            onChange={e=>setBoxShape(e.target.value as BoxShape)}>
            <option value="rectangular">Rectangular</option>
            <option value="cylindrical">Cylindrical</option>
          </select></label>}
    </div>
    <div className="group">
      <div className="sec-head">3. Parting and registration</div>
      <label className="kv"><span className="name">Split into</span>
        <select data-test="mold-part-count" value={parts}
          onChange={e=>setParts(Number(e.target.value) as PartCount)}>
          <option value={1}>1 part — one-sided impression</option>
          <option value={2}>2 parts — two mating halves</option>
          <option value={3}>3 parts — 120° radial sectors around Z</option>
          <option value={4}>4 parts — quartered mold</option>
        </select></label>
      {multi&&<>
        {parts===3&&<p className="hint">Threefold uses three vertical radial parting planes through the XY center, each spaced 120°. Registration features are currently unavailable for radial sectors.</p>}
        {parts!==3&&<label className="kv"><span className="name">Primary parting axis</span>
          <select data-test="mold-split-axis" value={splitAxis}
            onChange={e=>setSplitAxis(e.target.value as SplitAxis)}>
            <option value="x">X (left/right)</option>
            <option value="y">Y (front/back)</option>
            <option value="z">Z (top/bottom)</option>
          </select></label>}
        {parts===4&&<p className="hint">The second split is perpendicular: X→Y, Y→X, or Z→X.</p>}
        <label className="kv"><span className="name">Alignment features</span>
          <input data-test="mold-keys" type="checkbox" disabled={parts===3} checked={keys&&parts!==3}
            onChange={e=>setKeys(e.target.checked)}/></label>
        {keys&&parts!==3&&<>
          <label className="kv"><span className="name">Mating feature shape</span>
            <select data-test="mold-key-style" value={keyStyle}
              onChange={e=>setKeyStyle(e.target.value as KeyStyle)}>
              <option value="v-seam">Contour V-seam + exterior clamp tabs</option>
              <option value="tapered-key">Tapered printed keys</option>
              <option value="printed-pin">Straight printed pins</option>
              <option value="metal-dowel">Matching holes for metal dowels</option>
            </select></label>
          {keyStyle==='metal-dowel'&&<p className="hint">Both halves receive blind holes. Insert separately purchased metal dowels during assembly. Diameter is the nominal hardware diameter.</p>}
          {keyStyle==='v-seam'&&<p className="hint">{mode==='direct'&&parts===2
            ?'A continuous triangular tongue-and-groove follows a coarse projected outline of the target, inset from the outer mold edges. Paired ears extend outside the mold for external clamps; pin positions do not apply.'
            :mode==='direct'
            ?'Continuous contour seams currently require two mold parts. Four-part direct molds use the earlier discrete pins instead.'
            :'Continuous contour seams currently require a two-part direct mold. Silicone boxes retain their external wall-boss registration.'}</p>}
          {keyStyle!=='v-seam'&&<label className="kv"><span className="name">Key positions</span>
            <select data-test="mold-key-placement" value={keyPlacement}
              onChange={e=>setKeyPlacement(e.target.value as KeyPlacement)}>
              <option value="auto">Automatically distribute</option>
              <option value="manual">{mode==='silicone-box'?'Edit heights on exterior wall':'Edit positions along seam'}</option>
            </select></label>}
          {keyStyle!=='v-seam'&&(mode==='direct'?
            <PlaneKeyEditor points={keyPoints} axis={splitAxis}
              manual={keyPlacement==='manual'} onChange={setKeyPoints}
              onManual={()=>setKeyPlacement('manual')} bounds={targetBounds}
              sideMargin={sideMargin} baseThickness={baseThickness}
              diameter={keyDiameter} clearance={keyClearance} cavityClearance={clearance}/>
            :<KeyPositionEditor
              positions={keyPositions}
              manual={keyPlacement==='manual'}
              onChange={next=>setKeyPositions(next)}
              onManual={()=>setKeyPlacement('manual')}
              diameter={keyDiameter}
              vertical
            />)}
        </>}
      </>}
    </div>
    <div className="group">
      <div className="sec-head">4. Dimensions (mm)</div>
      {mode!=='silicone-box'&&<label className="kv">
        <span className="name">Spherical offset detail</span>
        <select data-test="mold-offset-quality" value={offsetQuality}
          onChange={e=>setOffsetQuality(e.target.value as OffsetQuality)}>
          <option value="fast">Fast — coarse preview</option>
          <option value="balanced">Balanced — default</option>
          <option value="fine">Fine — slower, more detail</option>
        </select>
      </label>}
      {mode!=='silicone-box'&&<p className="hint">
        {offsetQuality==='fast'
          ?'Fast previews use a coarse distance-field grid. Small features may disappear; switch to Fine before exporting detailed tooling.'
          :offsetQuality==='balanced'
          ?'Balanced mode limits the distance-field workload. Grid spacing is shown in the generated warnings; use Fine for small surface detail.'
          :'Fine retains smaller features but can take substantially longer and use much more memory.'}
      </p>}
      {fields.map(f=><label key={f.key} className="kv" title={f.help}>
        <span className="name">{f.label}</span>
        <input type="number" data-test={`mold-${f.key}`}
          min={f.key==='splitPosition'?0.1:0}
          max={f.key==='splitPosition'?0.9:f.key==='boxDraftDeg'?12:100000}
          step={f.key==='splitPosition'?0.05:0.1} value={values[f.key]}
          onChange={e=>{if(e.target.value!=='')setDimension(f.key,Number(e.target.value))}}/>
      </label>)}
    </div>
    <div className="group">
      <div className="sec-head">5. Generate, inspect &amp; export</div>
      {mode!=='silicone-box'&&<p className="hint">Positive clearance enlarges the cavity by a spherical distance-field offset, rounding sharp corners rather than pushing vertices along their normals. Very small features may be lost at the reported sampling resolution; inspect the resulting cavity. Zero clearance is exact.</p>}
      <p className="hint">
        {mode==='silicone-box'?'Printable containment box; you still must mount and seal the master. Draft applies to the box interior only.':
          parts===1?'Only one-piece molds cut the target at mid-height. Choose 2 or 4 to capture the whole model.':
          'Two/four-part tooling captures the full target. Verify removal, orientation, thin clearances and casting undercuts before printing.'}
      </p>
      <button type="button" data-test="mold-generate" disabled={busy||generating||!active}
        onClick={onGenerate}>{generating?'Generating…':'Generate tooling'}</button>
      {generating&&<div className="mold-progress" role="status" aria-live="off">
        <div className="mold-progress-label">{workStatus||'Preparing mold geometry…'}
          {workProgress!==null&&<b>{Math.round(workProgress*100)}%</b>}
        </div>
        <progress data-test="mold-generation-progress" max={1}
          {...(workProgress!==null?{value:Math.max(0,Math.min(1,workProgress))}:{})}/>
        <p className="hint">Approximate progress; mesh Boolean and export stages may take additional time.</p>
      </div>}
      {error&&<p className="hint" role="alert" data-test="mold-error">{error}</p>}
      {generated&&<div data-test="mold-result">
        <div className="kindrow featurekeys" role="radiogroup" aria-label="Mold preview mode">
          <button type="button" role="radio" aria-checked={previewMode==='section'} className={previewMode==='section'?'on':undefined}
            onClick={()=>onPreviewModeChange('section')}>Assembled + cross-section</button>
          <button type="button" role="radio" aria-checked={previewMode==='exploded'} className={previewMode==='exploded'?'on':undefined}
            onClick={()=>onPreviewModeChange('exploded')}>Exploded</button>
        </div>
        <div className="kv"><span className="name">{generated.printable?'Exportable solids':'Preview-only solids'}</span><b>{generated.parts.length}</b></div>
        {!generated.printable&&<p className="hint mold-warning" role="alert">
          NOT PRINTABLE: fragmented geometry was detected. Export is disabled. These parts are provided only to inspect the failure.
        </p>}
        {generated.parts.some(p=>p.name.includes('detached'))&&<p className="hint mold-warning" role="alert">
          Detached solids were found and preserved as separate files. Review the loose pieces in the slicer; they are not guaranteed to belong in the mold.
        </p>}
        {generated.warnings.some(w=>w.includes('excluded an invalid detached artifact'))&&
          <p className="hint mold-warning" role="alert">
            Invalid detached Boolean fragments were excluded from export. The main mold remains available, but check its cavity and mating features carefully before printing.
          </p>}
        <div className="kv"><span className="name">Total material</span><b>{(generated.volumeMm3/1000).toFixed(1)} cm³</b></div>
        {generated.parts.map((p,i)=><div key={i} className="kv">
          <span className="name">{p.name} · {Math.round(p.indices.length/3).toLocaleString('en-US')} faces</span>
          <button type="button" disabled={!generated.printable} data-test={`mold-export-part-${i+1}`}
            onClick={()=>onExport('stl',i)}>STL</button>
        </div>)}
        <button type="button" disabled={!generated.printable} data-test="mold-export-3mf" onClick={()=>onExport('3mf')}>Export all parts · 3MF</button>
        {generated.warnings.map((w,i)=><p key={i} className="hint">{w}</p>)}
      </div>}
    </div>
  </aside>
}
