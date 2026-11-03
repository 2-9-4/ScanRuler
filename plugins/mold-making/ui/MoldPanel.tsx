// SPDX-License-Identifier: AGPL-3.0-only
// Explicit tooling choices and per-part export; no hidden mid-height cut.
import { useEffect,useState } from 'react'
import {MoldMaterialEstimate,DEFAULT_MOLD_MATERIAL_INPUTS} from './MoldMaterialEstimate'
import {MoldPartList} from './MoldPartList'
import { SCAN_ACCEPT,REFERENCE_ACCEPT,REFERENCE_FORMATS } from '../../../src/core/formats'
import { ModelSlot } from '../../../src/ui/ModelSlot'
import { useStore } from '../../../src/state/store'
import { useDeviation } from '../../../src/state/deviationStore'
import { MOLD_MODES,MOLD_MODE_LABELS,type MoldDimension,type PartCount,type SplitAxis,type BoxShape, type KeyStyle, type KeyPlacement, type OffsetQuality } from '../core/settings'
import { moldSettings, useMold } from '../state/moldStore'
import { moldMaterial, type MoldBuild, type Limits } from '../core/geometry'
import { KeyPositionEditor } from './KeyPositionEditor'
import { PlaneKeyEditor } from './PlaneKeyEditor'
import type { MoldPreviewMode } from '../viewer/moldPreview'

const FIELDS:readonly {key:MoldDimension;label:string;help:string}[]=[
  {key:'clearance',label:'Cavity clearance (+ enlarges)',help:'Positive means a spherical dilation of the target solid, enlarging the casting cavity. A signed-distance field is sampled to generate a closed offset; small features may be lost at the chosen grid resolution.'},
  {key:'sideMargin',label:'Extra side material (mm)',help:'Additional solid material beyond the automatically calculated necessary side margin; zero is valid.'},
  {key:'baseThickness',label:'Extra base / top material (mm)',help:'Additional material beyond the automatically calculated structural backing. Zero is valid.'},
  {key:'wallThickness',label:'Extra silicone-box wall (mm)',help:'Added to the minimum safe printed wall; zero is valid.'},
  {key:'siliconeThickness',label:'Silicone space',help:'Distance between master and containment walls'},
  {key:'splitPosition',label:'Split location (0–1)',help:'Fraction of model bounds along selected X/Y/Z axis'},
  {key:'boxDraftDeg',label:'Interior wall draft (°)',help:'Silicone containment-box wall taper; does not change the master cavity'},
  {key:'previewGap',label:'Exploded view gap',help:'Spacing between parts in the viewport. Zero shows assembled geometry.'},
]
const PIN_FIELDS:readonly {key:MoldDimension;label:string;help:string}[]=[
  {key:'keyDiameter',label:'Pin / dowel diameter (mm)',help:'Printed pin diameter, or the nominal size of a separate steel dowel.'},
  {key:'keyDepth',label:'Pin engagement / socket depth (mm)',help:'Length of the printed pin or the dowel socket.'},
  {key:'keyClearance',label:'Pin / socket radial fit clearance (mm)',help:'Extra socket radius, separate from the V-seam groove clearance.'},
]
const V_FIELDS:readonly {key:MoldDimension;label:string;help:string}[]=[
  {key:'vSeamWidth',label:'V-ridge base width (mm)',help:'Full width of the triangular ridge, measured along the parting face.'},
  {key:'vSeamHeight',label:'V-ridge height (mm)',help:'How far the ridge projects into the matching half.'},
  {key:'vSeamSpacing',label:'V-seam spacing from surface (mm)',help:'On direct molds, distance from the expanded cavity outline to the ridge inner side; on silicone boxes, additional inset from the outer wall.'},
  {key:'vSeamClearance',label:'V-groove fit clearance (mm)',help:'Extra width/depth for the female V-groove, independent of pin/dowel clearance.'},
]
const TAB_FIELDS:readonly {key:MoldDimension;label:string;help:string}[]=[
  {key:'clampTabCount',label:'Side / radial tabs per edge',help:'Number of clamping ears along each exterior seam. For threefold molds these sit on the radial parting faces.'},
  {key:'clampTabWidth',label:'Tab width / height (mm)',help:'Size of each tab along its distributing edge.'},
  {key:'clampTabProjection',label:'Tab outside projection (mm)',help:'Distance tabs extend beyond the mold boundary for a clamp to grip.'},
  {key:'clampTabThickness',label:'Tab thickness per half (mm)',help:'Thickness of each tab in the mold opening direction.'},
]
const EXTRA_TAB_FIELDS:readonly {key:MoldDimension;label:string;help:string}[]=[
  {key:'topBottomTabCount',label:'Tabs along each top/bottom edge',help:'Number of paired ears on the top and bottom exterior edges (X/Y parting planes).'},
]
const BOLT_FIELDS:readonly {key:MoldDimension;label:string;help:string}[]=[
  {key:'tabBoltDiameter',label:'Through-hole diameter (mm)',help:'Diameter of the unthreaded bolt clearance hole through both mating clamp ears.'},
]
const NUT_FIELDS:readonly {key:MoldDimension;label:string;help:string}[]=[
  {key:'tabNutAcrossFlats',label:'Captured hex across flats (mm)',help:'Width between parallel flats of the nut, including fit allowance.'},
  {key:'tabNutDepth',label:'Captured nut pocket depth (mm)',help:'Recess depth from the outside face of the negative mold half.'},
]
export function MoldPanel({onOpenScan,onOpenReference,onGenerate,onCenterMount,onExport,onBoolean,onEditPart,visibleParts,onPartVisibilityChange,masterVisible,onMasterVisibilityChange,generated,targetBounds,previewMode,onPreviewModeChange,generating,error}:{
  onOpenScan:(file:File)=>void
  onOpenReference:(file:File)=>void
  onGenerate:()=>void
  onCenterMount:()=>void
  onExport:(format:'stl'|'3mf',index?:number)=>void
  onBoolean:()=>void
  onEditPart:(index:number,workspace:'mesh'|'reverse')=>void
  visibleParts:readonly boolean[]
  onPartVisibilityChange:(visible:boolean[])=>void
  masterVisible:boolean
  onMasterVisibilityChange:(visible:boolean)=>void
  generated:MoldBuild|null
  targetBounds:Limits|null
  previewMode:MoldPreviewMode
  onPreviewModeChange:(mode:MoldPreviewMode)=>void
  generating:boolean
  error:string|null
}) {
  const [tab,setTab]=useState<'setup'|'parting'|'casting'|'review'>('setup')
  // Once geometry finishes generating, open its inspection results.
  useEffect(()=>{if(generated)setTab('review')},[generated])
  // Keep calculator assumptions across mold regeneration. They must not
  // become geometry settings or invalidate a built mold.
  const [materialInputs,setMaterialInputs]=useState({...DEFAULT_MOLD_MATERIAL_INPUTS})
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
  const vSeamWidth=useMold(s=>s.vSeamWidth),vSeamHeight=useMold(s=>s.vSeamHeight)
  const vSeamSpacing=useMold(s=>s.vSeamSpacing),vSeamClearance=useMold(s=>s.vSeamClearance)
  const clampTabCount=useMold(s=>s.clampTabCount),clampTabWidth=useMold(s=>s.clampTabWidth)
  const clampTabProjection=useMold(s=>s.clampTabProjection),clampTabThickness=useMold(s=>s.clampTabThickness)
  const topBottomTabs=useMold(s=>s.topBottomTabs),topBottomTabCount=useMold(s=>s.topBottomTabCount)
  const tabBoltHoles=useMold(s=>s.tabBoltHoles),tabBoltDiameter=useMold(s=>s.tabBoltDiameter)
  const tabCapturedNuts=useMold(s=>s.tabCapturedNuts)
  const tabNutAcrossFlats=useMold(s=>s.tabNutAcrossFlats),tabNutDepth=useMold(s=>s.tabNutDepth)
  const boxDraftDeg=useMold(s=>s.boxDraftDeg)
  const minimumDraftDeg=useMold(s=>s.minimumDraftDeg)
  const mountHeight=useMold(s=>s.mountHeight)
  const mountPadDiameter=useMold(s=>s.mountPadDiameter)
  const mountStemDiameter=useMold(s=>s.mountStemDiameter)
  const mountFootDiameter=useMold(s=>s.mountFootDiameter)
  const previewGap=useMold(s=>s.previewGap)
  const interfaceLabels=useMold(s=>s.interfaceLabels)
  const setInterfaceLabels=useMold(s=>s.setInterfaceLabels)
  const mountEnabled=useMold(s=>s.mountEnabled)
  const mountPoint=useMold(s=>s.mountPoint)
  const mountNormal=useMold(s=>s.mountNormal)
  const pourEnabled=useMold(s=>s.pourEnabled),ventsEnabled=useMold(s=>s.ventsEnabled)
  const pourPoint=useMold(s=>s.pourPoint),ventPoints=useMold(s=>s.ventPoints)
  const pourDiameter=useMold(s=>s.pourDiameter)
  const pourFunnelDiameter=useMold(s=>s.pourFunnelDiameter)
  const pourFunnelDepth=useMold(s=>s.pourFunnelDepth)
  const ventDiameter=useMold(s=>s.ventDiameter)
  const values:Record<MoldDimension,number>={clearance,repairHoleSize,sideMargin,baseThickness,wallThickness,siliconeThickness,splitPosition,
    keyDiameter,keyDepth,keyClearance,vSeamWidth,vSeamHeight,vSeamSpacing,vSeamClearance,
    clampTabCount,clampTabWidth,clampTabProjection,clampTabThickness,
    topBottomTabCount,tabBoltDiameter,tabNutAcrossFlats,tabNutDepth,boxDraftDeg,previewGap,
    pourDiameter,pourFunnelDiameter,pourFunnelDepth,ventDiameter,minimumDraftDeg,
    mountHeight,mountPadDiameter,mountStemDiameter,mountFootDiameter}
  const setSource=useMold(s=>s.setSource),setMode=useMold(s=>s.setMode)
  const setParts=useMold(s=>s.setParts),setSplitAxis=useMold(s=>s.setSplitAxis)
  const setBoxShape=useMold(s=>s.setBoxShape),setKeys=useMold(s=>s.setKeys)
  const setKeyStyle=useMold(s=>s.setKeyStyle),setKeyPlacement=useMold(s=>s.setKeyPlacement)
  const setTopBottomTabs=useMold(s=>s.setTopBottomTabs)
  const setTabBoltHoles=useMold(s=>s.setTabBoltHoles)
  const setTabCapturedNuts=useMold(s=>s.setTabCapturedNuts)
  const setKeyPositions=useMold(s=>s.setKeyPositions)
  const setKeyPoints=useMold(s=>s.setKeyPoints)
  const setDimension=useMold(s=>s.setDimension)
  const setRepairTarget=useMold(s=>s.setRepairTarget)
  const setOffsetQuality=useMold(s=>s.setOffsetQuality)
  const setPourEnabled=useMold(s=>s.setPourEnabled)
  const setVentsEnabled=useMold(s=>s.setVentsEnabled)
  const setMountEnabled=useMold(s=>s.setMountEnabled)
  const setPourPoint=useMold(s=>s.setPourPoint)
  const setVentPoints=useMold(s=>s.setVentPoints)
  const active=source==='scan'?scanName:refName
  const multi=parts>1
  const usesV=keys&&multi&&keyStyle==='v-seam'
  const usesPins=keys&&multi&&!usesV
  const material=moldMaterial(moldSettings(),targetBounds?targetBounds.max[2]-targetBounds.min[2]:undefined,
    targetBounds?Math.min(targetBounds.max[0]-targetBounds.min[0],targetBounds.max[1]-targetBounds.min[1]):undefined)
  const fieldInput=({key,label,help}:{key:MoldDimension;label:string;help:string})=><label key={key} className="kv" title={help}>
    <span className="name">{label}</span>
    <input type="number" data-test={`mold-${key}`} min={key==='splitPosition'?0.1:0}
      max={key==='splitPosition'?0.9:key==='boxDraftDeg'?12:key==='minimumDraftDeg'?30:(key==='clampTabCount'||key==='topBottomTabCount')?12:100000}
      step={key==='splitPosition'?0.05:(key==='clampTabCount'||key==='topBottomTabCount')?1:0.1} value={values[key]}
      onChange={e=>{if(e.target.value!=='')setDimension(key,Number(e.target.value))}}/>
  </label>
  const fields=FIELDS.filter(({key})=>{
    if(key==='previewGap')return false // An in-viewport slider controls the layout.
    if(key==='splitPosition')return false // Belongs with split axis, not outer dimensions.
    if(key==='boxDraftDeg')return mode==='silicone-box'
    if(mode==='direct')return ['clearance','sideMargin','baseThickness'].includes(key)
    if(mode==='silicone-box')return ['siliconeThickness','wallThickness','baseThickness'].includes(key)
    return false
  })
  return <aside className="panel" data-test="mold-making-panel">
    <nav className="kindrow featurekeys" role="tablist" aria-label="Mold Making workflow">
      {([
        ['setup','Model & size'],['parting','Split & keys'],
        ['casting','Pour & mount'],['review','Inspect & export'],
      ] as const).map(([value,label])=><button type="button" key={value}
        id={`mold-tab-${value}`} data-test={`mold-tab-${value}`}
        role="tab" aria-selected={tab===value}
        aria-controls={`mold-tab-panel-${value}`}
        className={tab===value?'on':undefined}
        onClick={()=>setTab(value)}>{label}</button>)}
    </nav>
    <p className="hint">Configure the model, prepare its joints and casting features, then generate and inspect the parts. Settings remain saved when switching tabs.</p>
    <div className="kv">
      <span className="name">{generated?'Mold generated — inspect the result or adjust settings':'Ready to generate tooling when the source is loaded'}</span>
      <button type="button" data-test="mold-generate" disabled={busy||generating||!active}
        onClick={onGenerate}>{generating?'Generating…':'Generate tooling'}</button>
    </div>
    {generating&&<div className="mold-progress" role="status" aria-live="off">
      <div className="mold-progress-label">{workStatus||'Preparing mold geometry…'}
        {workProgress!==null&&<b>{Math.round(workProgress*100)}%</b>}
      </div>
      <progress data-test="mold-generation-progress" max={1}
        {...(workProgress!==null?{value:Math.max(0,Math.min(1,workProgress))}:{})}/>
      <p className="hint">Approximate progress; mesh Boolean and export stages may take additional time.</p>
    </div>}
    {error&&<p className="hint" role="alert" data-test="mold-error">{error}</p>}
    <div role="tabpanel" id="mold-tab-panel-setup" aria-labelledby="mold-tab-setup"
      hidden={tab!=='setup'} style={{display:tab==='setup'?'block':'none'}}>
    <div className="group">
      <div className="sec-head">Source model</div>
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
      <div className="sec-head">Tooling method</div>
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
      <div className="sec-head">Tool dimensions (mm)</div>
      {mode!=='silicone-box'&&clearance>0&&<label className="kv">
        <span className="name">Spherical offset detail</span>
        <select data-test="mold-offset-quality" value={offsetQuality}
          onChange={e=>setOffsetQuality(e.target.value as OffsetQuality)}>
          <option value="fast">Fast — coarse preview</option>
          <option value="balanced">Balanced — default</option>
          <option value="fine">Fine — slower, more detail</option>
        </select>
      </label>}
      {mode!=='silicone-box'&&clearance>0&&<p className="hint">
        {offsetQuality==='fast'
          ?'Fast previews use a coarse distance-field grid. Small features may disappear; switch to Fine before exporting detailed tooling.'
          :offsetQuality==='balanced'
          ?'Balanced mode limits the distance-field workload. Grid spacing is shown in the generated warnings; use Fine for small surface detail.'
          :'Fine retains smaller features but can take substantially longer and use much more memory.'}
      </p>}
      {fields.map(fieldInput)}
      <p className="hint">Automatically required solid material: {mode==='direct'
        ?`${material.side.toFixed(2)} mm at sides, ${material.base.toFixed(2)} mm above/below the model`
        :`${material.wall.toFixed(2)} mm walls, ${material.base.toFixed(2)} mm base`}.
        Extra margins add material on top of these calculated requirements and may be zero.</p>
    </div>
    </div>
    <div role="tabpanel" id="mold-tab-panel-parting" aria-labelledby="mold-tab-parting"
      hidden={tab!=='parting'} style={{display:tab==='parting'?'block':'none'}}>
    <div className="group">
      <div className="sec-head">Parting &amp; registration</div>
      <label className="kv"><span className="name">Split into</span>
        <select data-test="mold-part-count" value={parts}
          onChange={e=>setParts(Number(e.target.value) as PartCount)}>
          {parts===1&&<option value={1}>Legacy one-sided impression (convert to 2+)</option>}
          <option value={2}>2 parts — two mating halves</option>
          <option value={3}>3 parts — 120° radial sectors around Z</option>
          <option value={4}>4 parts — quartered mold</option>
        </select></label>
      {multi&&<>
        <label className="kv"><span className="name">Engrave matching interface numbers on outer mold faces</span>
          <input type="checkbox" data-test="mold-interface-labels"
            checked={interfaceLabels}
            onChange={e=>setInterfaceLabels(e.target.checked)}/></label>
        <p className="hint">A small number is engraved on each side of each mating seam, near that seam on the outside wall. Three-part sector 1 has separate 1 and 3 labels by its two mating edges; each neighboring sector receives the matching number. Engraving never touches the casting surface.</p>
        {parts===3&&<p className="hint">Threefold has three 120° radial mating planes. The V-seam and printed/dowel registration are supported on all three interfaces; clamp ears are available on the radial mating interfaces.</p>}
        {parts!==3&&<label className="kv"><span className="name">Primary parting axis</span>
          <select data-test="mold-split-axis" value={splitAxis}
            onChange={e=>setSplitAxis(e.target.value as SplitAxis)}>
            <option value="x">X (left/right)</option>
            <option value="y">Y (front/back)</option>
            <option value="z">Z (top/bottom)</option>
          </select></label>}
        {parts===4&&<p className="hint">The second split is perpendicular: X→Y, Y→X, or Z→X.</p>}
        {parts!==3&&multi&&fieldInput({key:'splitPosition',
          label:'Primary split-plane fraction',
          help:'Fraction of the available mold span along the chosen primary split axis (0.1 to 0.9).'})}
        <label className="kv"><span className="name">Alignment features</span>
          <input data-test="mold-keys" type="checkbox" checked={keys}
            onChange={e=>setKeys(e.target.checked)}/></label>
        {keys&&<>
          <label className="kv"><span className="name">Mating feature shape</span>
            <select data-test="mold-key-style" value={keyStyle}
              onChange={e=>setKeyStyle(e.target.value as KeyStyle)}>
              <option value="v-seam">Contour V-seam + exterior clamp tabs</option>
              <option value="tapered-key">Tapered printed keys</option>
              <option value="printed-pin">Straight printed pins</option>
              <option value="metal-dowel">Matching holes for metal dowels</option>
            </select></label>
          {keyStyle==='metal-dowel'&&<p className="hint">Both halves receive blind holes. Insert separately purchased metal dowels during assembly. Diameter is the nominal hardware diameter.</p>}
          {keyStyle==='v-seam'&&<p className="hint">{parts===3
            ?mode==='direct'
              ?'Three radial C-shaped V-seams follow the model silhouette above, outside and below; the ends clear the common center hub.'
              :'Three radial L-shaped V-seams follow the solid cylindrical sidewall and the bottom plate, leaving the pouring rim open and the central hub clear.'
            :parts===4
            ?'Open V-profiles follow each quarter interface and stop short of crossing parting planes. Exterior clamp ears are restricted to the relevant quadrant.'
            :mode==='direct'
            ?'The contour V-seam follows a coarse outline of the target, with exterior clamping ears and a flattened ridge tip for assembly.'
            :'Silicone boxes follow the solid walls and floor; the opening stays unobstructed.'}</p>}
          {usesV&&<div className="mold-feature-section">
            <div className="sec-head">V-seam · profile and spacing</div>
            {V_FIELDS.map(fieldInput)}
          </div>}
          {(usesV||parts===3)&&<div className="mold-feature-section">
            <div className="sec-head">Clamping tabs · exterior ears</div>
            {TAB_FIELDS.map(fieldInput)}
            {(parts!==3&&(parts===4||splitAxis!=='z'))&&<><label className="kv"><span className="name">Add top and bottom clamp tabs</span>
              <input type="checkbox" data-test="mold-top-bottom-tabs" checked={topBottomTabs}
                onChange={e=>setTopBottomTabs(e.target.checked)}/></label>
              {topBottomTabs&&EXTRA_TAB_FIELDS.map(fieldInput)}</>}
            {(clampTabCount>0||(parts!==3&&topBottomTabs&&topBottomTabCount>0))&&<>
              <label className="kv"><span className="name">Drill through-bolt holes in tabs</span>
                <input type="checkbox" data-test="mold-tab-bolts" checked={tabBoltHoles}
                  onChange={e=>setTabBoltHoles(e.target.checked)}/></label>
              {tabBoltHoles&&<>
                {BOLT_FIELDS.map(fieldInput)}
                <label className="kv"><span className="name">Captured hex nuts</span>
                  <input type="checkbox" data-test="mold-captured-nuts" checked={tabCapturedNuts}
                    onChange={e=>setTabCapturedNuts(e.target.checked)}/></label>
                {tabCapturedNuts&&NUT_FIELDS.map(fieldInput)}
              </>}
            </>}
            <p className="hint">Tab dimensions grow automatically to preserve solid walls around enabled fasteners. Hex pockets open on the negative half's exterior face.</p>
          </div>}
          {usesPins&&<div className="mold-feature-section">
            <div className="sec-head">Pins and dowels · size and placement</div>
            {PIN_FIELDS.map(fieldInput)}
          {parts!==3&&<><label className="kv"><span className="name">Key positions</span>
            <select data-test="mold-key-placement" value={keyPlacement}
              onChange={e=>setKeyPlacement(e.target.value as KeyPlacement)}>
              <option value="auto">Automatically distribute</option>
              <option value="manual">{mode==='silicone-box'?'Edit heights on exterior wall':'Edit positions along seam'}</option>
            </select></label>
          {mode==='direct'?
            <PlaneKeyEditor points={keyPoints} axis={splitAxis}
              manual={keyPlacement==='manual'} onChange={setKeyPoints}
              onManual={()=>setKeyPlacement('manual')} bounds={targetBounds}
              sideMargin={material.side} baseThickness={material.base}
              diameter={keyDiameter} clearance={keyClearance} cavityClearance={clearance}/>
            :<KeyPositionEditor
              positions={keyPositions}
              manual={keyPlacement==='manual'}
              onChange={next=>setKeyPositions(next)}
              onManual={()=>setKeyPlacement('manual')}
              diameter={keyDiameter}
              vertical
            />}</>}
          {parts===3&&<p className="hint">The radial seam uses two automatically spaced registration heights per interface. Manual pin positions are not yet editable in radial mode.</p>}
          </div>}
        </>}
      </>}
    </div>
    </div>
    <div role="tabpanel" id="mold-tab-panel-casting" aria-labelledby="mold-tab-casting"
      hidden={tab!=='casting'} style={{display:tab==='casting'?'block':'none'}}>
    {(mode==='direct'&&parts>1||pourEnabled||ventsEnabled)&&<div className="group" data-test="mold-casting-channels">
      <div className="sec-head">Pouring &amp; venting (optional)</div>
      {(mode!=='direct'||parts===1)&&<p className="hint mold-warning" role="alert">
        Channels require a multipart direct mold. Disable pour/vents here before generating a silicone box or single-sided impression.
      </p>}
      <p className="hint">Optional straight vertical channels from the top exterior into the casting cavity. XY fractions refer to the master bounding box, not the printed mold. Each must hit the real master surface and avoid a parting seam; invalid placement blocks generation. Channels are cut before splitting.</p>
      <label className="kv"><span className="name">Add vertical pour sprue</span>
        <input type="checkbox" data-test="mold-pour-enabled" checked={pourEnabled}
          onChange={e=>setPourEnabled(e.target.checked)}/></label>
      {pourEnabled&&<>
        {fieldInput({key:'pourDiameter',label:'Pour bore diameter (mm)',help:'Diameter of the vertical channel that enters the casting cavity.'})}
        {fieldInput({key:'pourFunnelDiameter',label:'Pour funnel mouth diameter (mm)',help:'Diameter at the top surface. Must not be smaller than the bore.'})}
        {fieldInput({key:'pourFunnelDepth',label:'Pour funnel depth (mm)',help:'Depth of the conical mouth below the top surface. Must fit the roof.'})}
        <div className="kv"><span className="name">Pour XY position (fraction 0–1)</span>
          <span>
            <input aria-label="Pour X" data-test="mold-pour-x" type="number" min={0.01} max={0.99} step={0.05}
              value={pourPoint[0]} onChange={e=>setPourPoint([Number(e.target.value),pourPoint[1]])}/>
            <input aria-label="Pour Y" data-test="mold-pour-y" type="number" min={0.01} max={0.99} step={0.05}
              value={pourPoint[1]} onChange={e=>setPourPoint([pourPoint[0],Number(e.target.value)])}/>
          </span>
        </div>
      </>}
      <label className="kv"><span className="name">Add vertical air vents</span>
        <input type="checkbox" data-test="mold-vents-enabled" checked={ventsEnabled}
          onChange={e=>setVentsEnabled(e.target.checked)}/></label>
      {ventsEnabled&&<>
        {fieldInput({key:'ventDiameter',label:'Air vent bore diameter (mm)',help:'Each vent must reach the actual casting cavity without cutting a parting seam.'})}
        {ventPoints.map(([x,y],i)=><div className="kv" key={i}>
          <span className="name">Air vent {i+1} XY (fraction 0–1)</span>
          <span>
            <input aria-label={`Vent ${i+1} X`} data-test={`mold-vent-${i}-x`} type="number" min={0.01} max={0.99} step={0.05}
              value={x} onChange={e=>setVentPoints(ventPoints.map((p,j)=>j===i?([Number(e.target.value),y] as [number,number]):p))}/>
            <input aria-label={`Vent ${i+1} Y`} data-test={`mold-vent-${i}-y`} type="number" min={0.01} max={0.99} step={0.05}
              value={y} onChange={e=>setVentPoints(ventPoints.map((p,j)=>j===i?([x,Number(e.target.value)] as [number,number]):p))}/>
            {ventPoints.length>1&&<button type="button"
              onClick={()=>setVentPoints(ventPoints.filter((_,j)=>j!==i))}>Remove</button>}
          </span>
        </div>)}
        {ventPoints.length<8&&<button type="button"
          onClick={()=>setVentPoints([...ventPoints,[0.3,0.7] as [number,number]])}>Add vent</button>}
      </>}
      <p className="hint">Both currently use the same straight vertical bore routing. A pour sprue is sized for material entry and can add a funnel; a vent is normally narrower and intended for air escape, but is not automatically placed at an air trap. Horizontal gates, automatic high-point detection, risers, and silicone master-mount channels remain roadmap items. Check filling, venting and parting seals before manufacture.</p>
    </div>}
    <div className="group" data-test="mold-master-mount">
      <div className="sec-head">Master suspension / glue-on base</div>
      <button type="button" data-test="mold-center-mount-panel"
        disabled={!active} onClick={onCenterMount}>Center mounting post on model</button>
      <p className="hint">Select a downward-facing surface of the master in the 3D viewport. The separate printable post enters from outside through a hexagonal hole in the mold base; the upper pad aligns to the selected surface and the larger exterior hexagonal shoulder sets insertion depth and rotation.</p>
      {mountPoint?<p className="hint">
        Contact: ({mountPoint.map(v=>v.toFixed(2)).join(', ')}) mm;
        surface direction: ({mountNormal.map(v=>v.toFixed(2)).join(', ')}).
      </p>:<p className="hint">No contact face selected. Use “Pick glue-on support face” in the 3D viewport first.</p>}
      <label className="kv"><span className="name">Include printed suspension pedestal</span>
        <input type="checkbox" data-test="mold-mount-enabled"
          checked={mountEnabled} disabled={!mountPoint||parts===1||(mode==='direct'&&clearance<=0)}
          onChange={e=>setMountEnabled(e.target.checked)}/></label>
      {parts===1&&<p className="hint mold-warning">A captured post with two locating shoulders requires multipart tooling to assemble around it.</p>}
      {mode==='direct'&&clearance<=0&&<p className="hint mold-warning">
        Set a positive cavity clearance to enable a removable glue-on post in a rigid mold.
      </p>}
      {mountEnabled&&<>
        {mode==='silicone-box'&&fieldInput({key:'mountHeight',label:'Clearance below model (mm)',help:'Moves the inside bottom of a silicone containment box downward; the hexagonal post passes through its base.'})}
        {fieldInput({key:'mountPadDiameter',label:'Glue pad diameter (mm)',help:'Contact pad follows the selected face normal. Verify the entire pad stays on the intended feature.'})}
        {fieldInput({key:'mountStemDiameter',label:'Support stem diameter (mm)',help:'Cylindrical vertical connection between foot and contact pad.'})}
        {fieldInput({key:'mountFootDiameter',label:'Exterior stop diameter (mm)',help:'Hexagonal shoulder remains outside the mold base and prevents the post from sliding through.'})}
        <p className="hint">The post has a 0.25 mm nominal radial fit and a 1.2 mm-deep exterior hex counterbore. For rigid molds, the glue-pad underside also seats in a relieved head pocket; for silicone buckets, a separate inner-floor flange serves as that stop. The opposing shoulders limit Z travel to approximately 0.15 mm each way. The entire post envelope is cleared after V-groove registration, including positive ridges. Assemble split tooling around the already-glued post, test-fit, and seal the penetration before casting.</p>
      </>}
    </div>
    </div>
    <div role="tabpanel" id="mold-tab-panel-review" aria-labelledby="mold-tab-review"
      hidden={tab!=='review'} style={{display:tab==='review'?'block':'none'}}>
    <div className="group">
      <div className="sec-head">Inspect generated tooling</div>
      {mode!=='silicone-box'&&<p className="hint">Positive clearance enlarges the cavity by a spherical distance-field offset, rounding sharp corners rather than pushing vertices along their normals. Very small features may be lost at the reported sampling resolution; inspect the resulting cavity. Zero clearance is exact.</p>}
      <p className="hint">
        {mode==='silicone-box'?'Printable containment box; you still must mount and seal the master. Draft applies to the box interior only.':
          parts===1?'Only one-piece molds cut the target at mid-height. Choose 2 or 4 to capture the whole model.':
          'Multi-part tooling captures the full target. Verify demolding, orientation, clearance and casting undercuts before printing.'}
      </p>

      {!generated&&<p className="hint">No generated mold to inspect yet. Use Generate tooling above; results will open here automatically.</p>}
      {generated&&<div data-test="mold-result">
        <div className="kindrow featurekeys" role="radiogroup" aria-label="Mold preview mode">
          <button type="button" role="radio" aria-checked={previewMode==='section'} className={previewMode==='section'?'on':undefined}
            onClick={()=>onPreviewModeChange('section')}>Assembled</button>
          <button type="button" role="radio" aria-checked={previewMode==='exploded'} className={previewMode==='exploded'?'on':undefined}
            onClick={()=>onPreviewModeChange('exploded')}>Exploded</button>
        </div>
        <p className="hint">Exploded view shows the original model between the tooling sections. Use the separation slider on the 3D viewport to expand or contract the parts; Assembled switches to the app's built-in Section view.</p>
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
        {generated.draftAnalysis&&<details data-test="mold-draft-results" open>
          <summary>Source-mesh draft and possible undercuts</summary>
          <p className="hint">Use the 3D viewport toolbar to toggle the source overlay, choose a region, and inspect local draft angles by hovering the model. These area totals use the draft threshold saved when tooling was generated.</p>
          <p className="hint">Screened {generated.draftAnalysis.assessedTriangles.toLocaleString('en-US')} source triangles across {generated.draftAnalysis.regions.length} tooling region(s). {generated.draftAnalysis.layout==='threefold'
            ?'Three 120° radial sectors withdraw along their outward bisectors.'
            :generated.draftAnalysis.layout==='four-part'
            ?'Four quadrants withdraw diagonally along both parting axes.'
            :generated.draftAnalysis.layout==='impression'
            ?'The lower half of the target is screened relative to −Z withdrawal.'
            :`Two opposing halves withdraw along ±${generated.draftAnalysis.axis.toUpperCase()}, split at ${generated.draftAnalysis.splitAtMm.toFixed(2)} mm.`}
            {' '}Faces crossing parting planes are clipped. Target positive draft: {generated.draftAnalysis.minimumDraftDeg}°.</p>
          <div className="kv"><span className="name">Potential reverse-facing (undercut) surface</span>
            <b>{generated.draftAnalysis.reverseFacingMm2.toFixed(1)} mm² ({(100*generated.draftAnalysis.reverseFacingMm2/Math.max(1e-9,generated.draftAnalysis.totalAreaMm2)).toFixed(1)}%)</b></div>
          <div className="kv"><span className="name">Additional insufficient-draft area</span>
            <b>{generated.draftAnalysis.lowDraftMm2.toFixed(1)} mm² ({(100*generated.draftAnalysis.lowDraftMm2/Math.max(1e-9,generated.draftAnalysis.totalAreaMm2)).toFixed(1)}%)</b></div>
          {generated.draftAnalysis.regions.map((region,i)=>
            <div className="kv" key={i}>
              <span className="name">{region.label} · reverse / low draft</span>
              <b>{region.reverseFacingMm2.toFixed(1)} / {region.lowDraftMm2.toFixed(1)} mm²</b>
            </div>)}
          <p className="hint">A reverse-facing triangle may signal a trapped undercut. Low draft includes near-parallel walls. This normal-based screening does not prove collision-free withdrawal, does not detect every obstruction, and does not alter or block the printable mold. Check material flexibility, release path, parting seams and mechanical clearance.</p>
        </details>}
        <MoldMaterialEstimate generated={generated} mode={mode} clearance={clearance}
          inputs={materialInputs}
          onInputChange={(key,value)=>setMaterialInputs(prev=>({...prev,[key]:value}))}/>
        <MoldPartList parts={generated.parts} printable={generated.printable}
          visible={visibleParts} onVisibilityChange={onPartVisibilityChange}
          masterVisible={masterVisible} onMasterVisibilityChange={onMasterVisibilityChange}
          onExportPart={i=>onExport('stl',i)} onEditPart={onEditPart}/>
        <button type="button" disabled={!generated.printable} data-test="mold-export-3mf"
          onClick={()=>onExport('3mf')}>Export all parts · 3MF</button>
        <button type="button" disabled={!generated.printable} data-test="mold-to-boolean"
          onClick={onBoolean}>Use mold parts in Mesh Tools Boolean</button>
        <p className="hint">Generated mold parts are available as independent Boolean operands in Mesh Tools. “Reference in CAD” opens a view-only assembled overlay in Reverse Engineering, retaining the original model and all other mold parts. Only “Edit copy” replaces the active scan; save your project before doing that.</p>
        {generated.warnings.map((w,i)=><p key={i} className="hint">{w}</p>)}
      </div>}
    </div>
    </div>
  </aside>
}
