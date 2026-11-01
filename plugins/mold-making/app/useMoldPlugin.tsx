// SPDX-License-Identifier: AGPL-3.0-only
// The same ScanRuler worker handles STEP (tessellated by the existing parser)
// and scan meshes. Preview and exported bytes refer to exactly the same
// worker result, discarded as soon as its source or parameters change.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PluginHost, PluginRuntime } from '../../../src/plugins/api'
import { useShell } from '../../../src/state/shellStore'
import { useSectionView } from '../../../src/state/sectionViewStore'
import { useStore } from '../../../src/state/store'
import { useDeviation } from '../../../src/state/deviationStore'
import { onScan } from '../../../src/app/scanEvents'
import { offerSolids } from '../../../src/app/solids'
import { buildMeshFile, type MeshFormat } from '../../../src/core/exportMesh'
import { exportStem, saveBuilt } from '../../../src/app/exports'
import { fileSafe } from '../../../src/core/project/manifest'
import { moldSettings, useMold } from '../state/moldStore'
import { MOLD_SETTING_KEYS } from '../core/settings'
import type { MoldBuild, Limits } from '../core/geometry'
import { MoldPreview, type MoldPreviewMode } from '../viewer/moldPreview'
import { MoldPanel } from '../ui/MoldPanel'

const NO_CREASE = { mode: 'off' as const, angleDeg: 30 }

export function useMoldPlugin(host: PluginHost): PluginRuntime {
  const inWorkspace = useShell((s) => s.workspace === 'mold-making')
  const source = useMold((s) => s.source)
  const referenceName = useDeviation((s) => s.nominalName)
  const scanName = useStore((s) => s.fileName)
  const [generated, setGenerated] = useState<MoldBuild | null>(null)
  const [targetBounds, setTargetBounds] = useState<Limits|null>(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewMode,setPreviewMode] = useState<MoldPreviewMode>('exploded')
  const previewGap = useMold(s=>s.previewGap)
  const preview = useRef<MoldPreview | null>(null)
  const priorSection=useRef<ReturnType<typeof useSectionView.getState>|null>(null)
  const generation = useRef(0)
  const generatedVersion = useRef<number | null>(null)
  const busy = useRef(false)

  const invalidate = useCallback(() => {
    if(priorSection.current){
      useSectionView.setState(priorSection.current)
      priorSection.current=null
    }
    generation.current++
    setGenerated(null)
    generatedVersion.current = null
    setError(null)
    preview.current?.clear()
  }, [])

  useEffect(() => {
    const offMold = useMold.subscribe((s, prev) => {
      if (MOLD_SETTING_KEYS.some(k => k !== 'previewGap' && s[k] !== prev[k])) invalidate()
      else if (s.previewGap !== prev.previewGap) preview.current?.setGap(s.previewGap)
    })
    const offScan = onScan({ loaded: invalidate, swapped: invalidate })
    return () => { offMold(); offScan() }
  }, [invalidate])
  useEffect(() => { setTargetBounds(null); invalidate() }, [scanName, referenceName, invalidate])
  useEffect(() => {
    offerSolids('mold-making',generated?.printable?generated.parts.map((part,i)=>({
      key:`mold-making:part-${i}`,name:part.name,source:'Mold Making',version:generation.current,
      mesh:async()=>({positions:part.positions.slice(),indices:part.indices.slice()}),
    })):[])
    return () => offerSolids('mold-making',[])
  },[generated])
  useEffect(() => () => {
    if(priorSection.current)useSectionView.setState(priorSection.current)
    priorSection.current=null
    preview.current?.dispose(); preview.current = null
  }, [])
  useEffect(() => {
    preview.current?.setVisible(inWorkspace)
    if(!inWorkspace){
      if(priorSection.current){
        useSectionView.setState(priorSection.current)
        priorSection.current=null
      }
      return
    }
    if(!generated)return
    if(!priorSection.current)priorSection.current=useSectionView.getState()
    if(previewMode==='exploded'){
      useSectionView.getState().close()
      return
    }
    // The native section-view store owns the plane, its interactive gizmo,
    // labels and the main ViewBar controls. Scene sync updates the viewport.
    const b=generated.targetBounds
    const centre:[number,number,number]=b.min.map((v,i)=>(v+b.max[i])/2) as [number,number,number]
    const sectionAxis=useMold.getState().splitAxis==='x'?'y':'x'
    const view=useSectionView.getState()
    view.open([0,0,-1],centre)
    view.setRef(sectionAxis,[0,0,-1])
    view.setOffset(centre[sectionAxis==='x'?0:1])
  },[inWorkspace,generated,previewMode])
  useEffect(() => useDeviation.subscribe((s,prev) => {
    if (s.nominalName !== prev.nominalName || s.nominalBusy !== prev.nominalBusy || s.nominalStep !== prev.nominalStep) invalidate()
  }), [invalidate])

  const runGenerate = async () => {
    if (busy.current) return
    const client = host.clientRef.current
    if (!client) { setError('The geometry worker is not ready.'); return }
    const settings = moldSettings()
    const target = settings.source === 'scan' ? host.sources.current.scan : host.sources.current.reference
    if (!target) { setError('Load the selected scan or STEP/reference target first.'); return }
    const selectedVersion = settings.source === 'scan' ? client.scanVersion : client.nominalVersion
    const ticket = ++generation.current
    busy.current = true
    setGenerating(true)
    setError(null)
    setGenerated(null)
    generatedVersion.current = null
    preview.current?.clear()
    let stagedId: number | null = null
    try {
      let sourceKind: 'scan' | 'staged' = 'scan'
      if (settings.source === 'reference') {
        // Staging is not committing: neither the displayed scan nor its
        // reference is replaced. The worker consumes this copy by id.
        const staged = await client.prepareScan(
          target.name, target.bytes.slice().buffer as ArrayBuffer,
          NO_CREASE, undefined, target.units,
        )
        stagedId = staged.id
        sourceKind = 'staged'
      }
      const made = await client.pluginCall<MoldBuild>('mold-making', 'generate', {
        settings, source: sourceKind, ...(stagedId !== null ? { stagedId } : {}),
      })
      const stillSame = selectedVersion === (settings.source === 'scan' ? client.scanVersion : client.nominalVersion)
      if (ticket !== generation.current || !stillSame) return
      // An unsupported or physically risky mold must never be presented as
      // a complete two-part production mold; warnings travel with exports.
      if (!preview.current && host.sceneRef.current) {
        preview.current = new MoldPreview(host.sceneRef.current, invalidate)
      }
      setPreviewMode('exploded')
      preview.current?.set(made, settings.source, settings.previewGap,'exploded',settings.parts,settings.splitAxis)
      generatedVersion.current = selectedVersion
      setGenerated(made)
      setTargetBounds(made.targetBounds)
      host.sceneRef.current?.frameAll()
      useStore.getState().setStatus(made.printable
        ?'Generated watertight mold parts. Review casting and release warnings before printing.'
        :'Mold generation produced fragmented or invalid tooling. Preview only; export disabled.')
    } catch (e) {
      if (ticket === generation.current) {
        setError(e instanceof Error ? e.message : String(e))
      }
    } finally {
      if (stagedId !== null) {
        try { await client.discardImport([stagedId]) } catch { /* Worker may have restarted. */ }
      }
      busy.current = false
      setGenerating(false)
    }
  }

  const changePreviewMode=(next:MoldPreviewMode)=>{
    setPreviewMode(next)
    preview.current?.setMode(next)
  }

  const useForBoolean=()=>{
    if(!generated?.printable)return
    useShell.getState().setWorkspace('mesh')
    useStore.getState().setStatus('Mold parts are available as separate Boolean operands under Mold Making. Open Mesh Tools → Boolean to select them.')
  }

  const editPart=async(index:number,workspace:'mesh'|'reverse')=>{
    const part=generated?.parts[index]
    if(!generated?.printable||!part)return
    try{
      // Use the existing scan-import pipeline, not a duplicate editable
      // mesh store: this is a deliberate "edit a copy" operation and will
      // replace the current scan. Boolean operands above do not.
      const built=buildMeshFile('stl',[{
        name:part.name,positions:part.positions,indices:part.indices,
      }],null,'ScanRuler Mold Making')
      if(!built)throw new Error('No triangles could be exported.')
      const file=new File([new Uint8Array(built.bytes)],`${fileSafe(part.name)||'mold-part'}.stl`,
        {type:built.mimeType})
      await host.openScan(file,'mm')
      useShell.getState().setWorkspace(workspace)
      useStore.getState().setStatus(`${part.name} loaded as a modeling scan in ${workspace==='mesh'?'Mesh Tools':'Reverse engineer'}. The former scan was replaced; mold STL remains independent.`)
    }catch(e){setError(e instanceof Error?e.message:String(e))}
  }

  const exportPart = (format: Extract<MeshFormat, 'stl' | '3mf'>, index?: number) => {
    if (!generated || generating) return
    if (!generated.printable) {
      setError('This mold contains detached or invalid generated solids. Export is disabled; the geometry must be fixed before printing.')
      return
    }
    const client = host.clientRef.current
    if (!client || generatedVersion.current !== (source === 'scan' ? client.scanVersion : client.nominalVersion)) {
      invalidate()
      setError('Target geometry changed. Regenerate the mold before exporting.')
      return
    }
    // STLs are ONE printable part each; joining parts with touching mating
    // faces creates a non-manifold STL. 3MF positions each part separately.
    const parts = generated.parts
    if (format === 'stl' && (index === undefined || !parts[index])) {
      setError('Select the STL of an individual mold component.')
      return
    }
    const chosen = format === 'stl' ? [parts[index!]] : parts
    let cursor = 0
    const printable = chosen.map(part => {
      const p = part.positions
      const min = [Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity]
      for (let i=0;i<p.length;i+=3) for(let axis=0;axis<3;axis++) {
        min[axis]=Math.min(min[axis],p[i+axis])
        max[axis]=Math.max(max[axis],p[i+axis])
      }
      const translated = new Float32Array(p.length)
      for (let i=0;i<p.length;i+=3) {
        translated[i]=p[i]-min[0]+cursor
        translated[i+1]=p[i+1]-min[1]
        translated[i+2]=p[i+2]-min[2]
      }
      cursor+=max[0]-min[0]+5
      return {name:part.name,positions:translated,indices:part.indices}
    })
    const made=buildMeshFile(format,printable,null,'ScanRuler Mold Making')
    if(!made){setError('There are no printable triangles to export.');return}
    const master=source==='reference' ? (referenceName??'mold') : exportStem('mold')
    const stem=fileSafe(master.replace(/\\.[^.]+$/,''))||'mold'
    const suffix=format==='stl' ? `-part-${index!+1}` : '-all-parts'
    saveBuilt({
      name:`${stem}-${generated.kind}${suffix}.${made.extension}`,
      mimeType:made.mimeType,bytes:made.bytes,
      status:`Exported ${printable.length} separate printable mold part(s), ${made.triangles} triangles.`,
    })
  }

  return {
    overlay:inWorkspace&&generated&&previewMode==='exploded'?(
      <div className="mold-explode-overlay" data-test="mold-explode-overlay"
        onPointerDown={e=>e.stopPropagation()} onWheel={e=>e.stopPropagation()}>
        <label htmlFor="mold-explode-slider">Mold separation</label>
        <input id="mold-explode-slider" type="range" data-test="mold-explode-slider"
          min={0} max={Math.max(60,...generated.targetBounds.max.map((v,i)=>
            (v-generated.targetBounds.min[i])*3))} step={0.5} value={previewGap}
          onChange={e=>useMold.getState().setDimension('previewGap',Number(e.target.value))}/>
        <output>{previewGap.toFixed(1)} mm</output>
      </div>
    ):null,
    startPane: source === 'reference' && referenceName ? null : {
      title: 'Mold Making',
      blurb: 'Import a STEP or scanned model, split direct molds into 2, 3 or 4 parts, or build rectangular/cylindrical silicone boxes with keys and drafted interior walls.',
    },
    hideScan: false,
    canSave: !!referenceName && source === 'reference',
    panel: inWorkspace ? (
      <MoldPanel
        onOpenScan={(file) => void host.openScan(file)}
        onOpenReference={(file) => void host.openReference(file)}
        onGenerate={() => void runGenerate()}
        onExport={exportPart}
        onBoolean={useForBoolean}
        onEditPart={(index,workspace)=>void editPart(index,workspace)}
        generated={generated}
        previewMode={previewMode}
        onPreviewModeChange={changePreviewMode}
        targetBounds={targetBounds}
        generating={generating}
        error={error}
      />
    ) : null,
  }
}
