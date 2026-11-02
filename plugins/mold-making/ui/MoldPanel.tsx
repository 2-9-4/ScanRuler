// SPDX-License-Identifier: AGPL-3.0-only
// Explicit tooling choices and per-part export; no hidden mid-height cut.
import { useState } from 'react'
import { volumeMassCost } from '../core/materialEstimate'
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
export function MoldPanel({onOpenScan,onOpenReference,onGenerate,onExport,onBoolean,onEditPart,generated,targetBounds,previewMode,onPreviewModeChange,generating,error}:{
  onOpenScan:(file:File)=>void
  onOpenReference:(file:File)=>void
  onGenerate:()=>void
  onExport:(format:'stl'|'3mf',index?:number)=>void
  onBoolean:()=>void
  onEditPart:(index:number,workspace:'mesh'|'reverse')=>void
  generated:MoldBuild|null
  targetBounds:Limits|null
  previewMode:MoldPreviewMode
  onPreviewModeChange:(mode:MoldPreviewMode)=>void
  generating:boolean
  error:string|null
}) {
  // Estimate inputs are local to the readout: changing them never
  // regenerates, reshapes or invalidates a working mold.
  const [printDensity,setPrintDensity]=useState(1.24)
  const [printCostKg,setPrintCostKg]=useState(25)
  const [siliconeDensity,setSiliconeDensity]=useState(1.1)
  const [siliconeCostKg,setSiliconeCostKg]=useState(35)
  const [castingDensity,setCastingDensity]=useState(1.1)
  const [castingCostKg,setCastingCostKg]=useState(25)
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
  const previewGap=useMold(s=>s.previewGap)
  const analyzeDraft=useMold(s=>s.analyzeDraft)
  const minimumDraftDeg=useMold(s=>s.minimumDraftDeg)
  const pourEnabled=useMold(s=>s.pourEnabled),ventsEnabled=useMold(s=>s.ventsEnabled)
  const pourPoint=useMold(s=>s.pourPoint),ventPoints=useMold(s=>s.ventPoints)
  const pourDiameter=useMold(s=>s.pourDiameter)
  const pourFunnelDiameter=useMold(s=>s.pourFunnelDiameter)
  const pourFunnelDepth=useMold(s=>s.pourFunnelDepth)
  const ventDiameter=useMold(s=>s.ventDiameter)
  const values={clearance,repairHoleSize,sideMargin,baseThickness,wallThickness,siliconeThickness,splitPosition,
    keyDiameter,keyDepth,keyClearance,vSeamWidth,vSeamHeight,vSeamSpacing,vSeamClearance,
    clampTabCount,clampTabWidth,clampTabProjection,clampTabThickness,
    topBottomTabCount,tabBoltDiameter,tabNutAcrossFlats,tabNutDepth,boxDraftDeg,previewGap,
    pourDiameter,pourFunnelDiameter,pourFunnelDepth,ventDiameter,minimumDraftDeg}
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
  const setAnalyzeDraft=useMold(s=>s.setAnalyzeDraft)
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
    if(key==='splitPosition')return multi
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
          {parts===1&&<option value={1}>Legacy one-sided impression (convert to 2+)</option>}
          <option value={2}>2 parts — two mating halves</option>
          <option value={3}>3 parts — 120° radial sectors around Z</option>
          <option value={4}>4 parts — quartered mold</option>
        </select></label>
      {multi&&<>
        {parts===3&&<p className="hint">Threefold has three 120° radial mating planes. The V-seam and printed/dowel registration are supported on all three interfaces; clamp ears are available on the radial mating interfaces.</p>}
        {parts!==3&&<label className="kv"><span className="name">Primary parting axis</span>
          <select data-test="mold-split-axis" value={splitAxis}
            onChange={e=>setSplitAxis(e.target.value as SplitAxis)}>
            <option value="x">X (left/right)</option>
            <option value="y">Y (front/back)</option>
            <option value="z">Z (top/bottom)</option>
          </select></label>}
        {parts===4&&<p className="hint">The second split is perpendicular: X→Y, Y→X, or Z→X.</p>}
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
      {fields.map(fieldInput)}
      <p className="hint">Automatically required solid material: {mode==='direct'
        ?`${material.side.toFixed(2)} mm at sides, ${material.base.toFixed(2)} mm above/below the model`
        :`${material.wall.toFixed(2)} mm walls, ${material.base.toFixed(2)} mm base`}.
        Extra margins add material on top of these calculated requirements and may be zero.</p>
    </div>
    {(mode==='direct'&&parts===2||analyzeDraft)&&<div className="group" data-test="mold-draft-controls">
      <div className="sec-head">5. Release and draft screening (optional)</div>
      {(mode!=='direct'||parts!==2)&&<p className="hint mold-warning" role="alert">
        Draft screening currently supports only two-piece direct molds. Disable it before generating other mold types.
      </p>}
      <label className="kv"><span className="name">Screen for possible undercuts and low draft</span>
        <input type="checkbox" data-test="mold-analyze-draft" checked={analyzeDraft}
          onChange={e=>setAnalyzeDraft(e.target.checked)}/></label>
      {analyzeDraft&&<>
        {fieldInput({key:'minimumDraftDeg',label:'Minimum positive draft angle (°)',
          help:'Mark surfaces below this angle as insufficient draft. Negative-facing surfaces indicate potential undercuts.'})}
        <p className="hint">Uses the two parting halves along the selected axis and split position. Measures the original source triangles, not the clearance-expanded casting cavity. This is a diagnostic only; no draft is added, no release direction is changed and the tooling stays identical.</p>
      </>}
    </div>}
    {(mode==='direct'&&parts>1||pourEnabled||ventsEnabled)&&<div className="group" data-test="mold-casting-channels">
      <div className="sec-head">5. Pouring and venting (optional)</div>
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
    <div className="group">
      <div className="sec-head">6. Generate, inspect &amp; export</div>
      {mode!=='silicone-box'&&<p className="hint">Positive clearance enlarges the cavity by a spherical distance-field offset, rounding sharp corners rather than pushing vertices along their normals. Very small features may be lost at the reported sampling resolution; inspect the resulting cavity. Zero clearance is exact.</p>}
      <p className="hint">
        {mode==='silicone-box'?'Printable containment box; you still must mount and seal the master. Draft applies to the box interior only.':
          parts===1?'Only one-piece molds cut the target at mid-height. Choose 2 or 4 to capture the whole model.':
          'Multi-part tooling captures the full target. Verify demolding, orientation, clearance and casting undercuts before printing.'}
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
          <p className="hint">Screened {generated.draftAnalysis.assessedTriangles.toLocaleString('en-US')} source triangles for two opposing release directions along {generated.draftAnalysis.axis.toUpperCase()}, split at {generated.draftAnalysis.splitAtMm.toFixed(2)} mm. Faces crossing the plane are split for the area calculations. Target positive draft: {generated.draftAnalysis.minimumDraftDeg}°.</p>
          <div className="kv"><span className="name">Potential reverse-facing (undercut) surface</span>
            <b>{generated.draftAnalysis.reverseFacingMm2.toFixed(1)} mm² ({(100*generated.draftAnalysis.reverseFacingMm2/Math.max(1e-9,generated.draftAnalysis.totalAreaMm2)).toFixed(1)}%)</b></div>
          <div className="kv"><span className="name">Additional insufficient-draft area</span>
            <b>{generated.draftAnalysis.lowDraftMm2.toFixed(1)} mm² ({(100*generated.draftAnalysis.lowDraftMm2/Math.max(1e-9,generated.draftAnalysis.totalAreaMm2)).toFixed(1)}%)</b></div>
          {(['negative','positive'] as const).map(side=>{
            const d=generated.draftAnalysis![side]
            return <div className="kv" key={side}>
              <span className="name">{side==='negative'?'-':'+'}{generated.draftAnalysis!.axis.toUpperCase()} half · reverse / low draft</span>
              <b>{d.reverseFacingMm2.toFixed(1)} / {d.lowDraftMm2.toFixed(1)} mm²</b>
            </div>
          })}
          <p className="hint">A reverse-facing triangle may signal a trapped undercut. Low draft includes near-parallel walls. This normal-based screening does not prove collision-free withdrawal, does not detect every obstruction, and does not alter or block the printable mold. Check material flexibility, release path, parting seams and mechanical clearance.</p>
        </details>}
        <div className="kv"><span className="name">Total material</span><b>{(generated.volumeMm3/1000).toFixed(1)} cm³</b></div>
        <details data-test="mold-material-estimate">
          <summary>Material quantity &amp; cost estimates</summary>
          <p className="hint">Informational estimates only. Tooling volume assumes fully solid printed material; slicer infill, supports, failed prints, resin loss and purge are excluded. Adjust local material assumptions below.</p>
          <label className="kv"><span className="name">Printed material density (g/cm³)</span>
            <input type="number" min={0.01} step={0.01} value={printDensity}
              onChange={e=>setPrintDensity(Number(e.target.value))}/></label>
          <label className="kv"><span className="name">Printed material price ($/kg)</span>
            <input type="number" min={0} step={1} value={printCostKg}
              onChange={e=>setPrintCostKg(Number(e.target.value))}/></label>
          {printDensity>0&&printCostKg>=0&&(()=>{
            const estimate=volumeMassCost(generated.volumeMm3,printDensity,printCostKg)
            return <div className="kv" data-test="mold-print-estimate">
              <span className="name">Fully-solid tooling · estimated mass/cost</span>
              <b>{estimate.grams.toFixed(1)} g / ${estimate.cost.toFixed(2)}</b>
            </div>
          })()}
          {generated.materialEstimate?.nominalCastingCavityMm3!==null&&
            generated.materialEstimate?.nominalCastingCavityMm3!==undefined&&<>
              <div className="kv"><span className="name">Nominal casting void</span>
                <b>{(generated.materialEstimate.nominalCastingCavityMm3/1000).toFixed(2)} cm³</b></div>
              <label className="kv"><span className="name">Cast material density (g/cm³)</span>
                <input type="number" min={0.01} step={0.01} value={castingDensity}
                  onChange={e=>setCastingDensity(Number(e.target.value))}/></label>
              <label className="kv"><span className="name">Cast material price ($/kg)</span>
                <input type="number" min={0} step={1} value={castingCostKg}
                  onChange={e=>setCastingCostKg(Number(e.target.value))}/></label>
              {castingDensity>0&&castingCostKg>=0&&(()=>{
                const v=generated.materialEstimate.nominalCastingCavityMm3!
                const estimate=volumeMassCost(v,castingDensity,castingCostKg)
                return <div className="kv" data-test="mold-casting-estimate">
                  <span className="name">Nominal casting mass/cost</span>
                  <b>{estimate.grams.toFixed(1)} g / ${estimate.cost.toFixed(2)}</b>
                </div>
              })()}
              <p className="hint">Nominal casting volume follows the actual solid cavity cutter, including intentional clearance; it excludes sprue, vent and overpour material, shrinkage, and waste.</p>
            </>}
          {generated.materialEstimate?.grossSiliconeCapacityMm3!==null&&
            generated.materialEstimate?.grossSiliconeCapacityMm3!==undefined&&<>
              <div className="kv"><span className="name">Silicone box capacity to rim (gross)</span>
                <b>{(generated.materialEstimate.grossSiliconeCapacityMm3/1000).toFixed(1)} cm³</b></div>
              {generated.materialEstimate.netSiliconeMm3!==null&&
                <div className="kv" data-test="mold-silicone-net">
                  <span className="name">Estimated silicone after master displacement</span>
                  <b>{(generated.materialEstimate.netSiliconeMm3!/1000).toFixed(1)} cm³</b>
                </div>}
              {generated.materialEstimate.netSiliconeMm3===null&&
                <p className="hint">Net silicone quantity unavailable: the source is open, not outward-wound or lacks valid solid volume. Gross capacity is an upper bound before the master is inserted.</p>}
              <label className="kv"><span className="name">Silicone density (g/cm³)</span>
                <input type="number" min={0.01} step={0.01} value={siliconeDensity}
                  onChange={e=>setSiliconeDensity(Number(e.target.value))}/></label>
              <label className="kv"><span className="name">Silicone price ($/kg)</span>
                <input type="number" min={0} step={1} value={siliconeCostKg}
                  onChange={e=>setSiliconeCostKg(Number(e.target.value))}/></label>
              {siliconeDensity>0&&siliconeCostKg>=0&&(()=>{
                const v=generated.materialEstimate.netSiliconeMm3??
                  generated.materialEstimate.grossSiliconeCapacityMm3!
                const estimate=volumeMassCost(v,siliconeDensity,siliconeCostKg)
                return <div className="kv" data-test="mold-silicone-estimate">
                  <span className="name">{generated.materialEstimate.netSiliconeMm3===null?'Gross upper-bound':'Net estimate'} · silicone mass/cost</span>
                  <b>{estimate.grams.toFixed(1)} g / ${estimate.cost.toFixed(2)}</b>
                </div>
              })()}
              <p className="hint">Capacity assumes fill to the top rim; actual fill level, funnels, air pockets, master supports, overpour and process waste are not included. Master displacement is subtracted only for a closed, positively oriented mesh.</p>
            </>}
        </details>
        {generated.parts.map((p,i)=><div key={i} className="kv">
          <span className="name">{p.name} · {Math.round(p.indices.length/3).toLocaleString('en-US')} faces</span>
          <button type="button" disabled={!generated.printable} data-test={`mold-export-part-${i+1}`}
            onClick={()=>onExport('stl',i)}>STL</button>
        </div>)}
        <button type="button" disabled={!generated.printable} data-test="mold-export-3mf" onClick={()=>onExport('3mf')}>Export all parts · 3MF</button>
        <div className="sec-head">Continue editing</div>
        <button type="button" disabled={!generated.printable} data-test="mold-to-boolean"
          onClick={onBoolean}>Use mold parts in Mesh Tools Boolean</button>
        <p className="hint">Mold parts are shared with Mesh Tools as independent solid operands. The original loaded scan stays unchanged.</p>
        {generated.parts.map((p,i)=><div key={'edit-'+i} className="kv">
          <span className="name">{p.name}</span>
          <button type="button" disabled={!generated.printable}
            data-test={`mold-edit-mesh-${i}`} onClick={()=>onEditPart(i,'mesh')}>Edit copy</button>
          <button type="button" disabled={!generated.printable}
            data-test={`mold-edit-cad-${i}`} onClick={()=>onEditPart(i,'reverse')}>CAD reference</button>
        </div>)}
        <p className="hint">Edit copy / CAD reference loads the selected exported mold part as a new scan, replacing the current scan. Save the current project first if you need it.</p>
        {generated.warnings.map((w,i)=><p key={i} className="hint">{w}</p>)}
      </div>}
    </div>
  </aside>
}
