// SPDX-License-Identifier: AGPL-3.0-only
// The same ScanRuler worker handles STEP (tessellated by the existing parser)
// and scan meshes. Preview and exported bytes refer to exactly the same
// worker result, discarded as soon as its source or parameters change.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PluginHost, PluginRuntime } from '../../../src/plugins/api'
import { useShell } from '../../../src/state/shellStore'
import { useStore } from '../../../src/state/store'
import { useDeviation } from '../../../src/state/deviationStore'
import { onScan } from '../../../src/app/scanEvents'
import { buildMeshFile, type MeshFormat } from '../../../src/core/exportMesh'
import { exportStem, saveBuilt } from '../../../src/app/exports'
import { fileSafe } from '../../../src/core/project/manifest'
import { moldSettings, useMold } from '../state/moldStore'
import type { MoldBuild } from '../core/geometry'
import { MoldPreview } from '../viewer/moldPreview'
import { MoldPanel } from '../ui/MoldPanel'

const NO_CREASE = { mode: 'off' as const, angleDeg: 30 }

export function useMoldPlugin(host: PluginHost): PluginRuntime {
  const inWorkspace = useShell((s) => s.workspace === 'mold-making')
  const source = useMold((s) => s.source)
  const referenceName = useDeviation((s) => s.nominalName)
  const scanName = useStore((s) => s.fileName)
  const [generated, setGenerated] = useState<MoldBuild | null>(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const preview = useRef<MoldPreview | null>(null)
  const generation = useRef(0)
  const generatedVersion = useRef<number | null>(null)
  const busy = useRef(false)

  const invalidate = useCallback(() => {
    generation.current++
    setGenerated(null)
    generatedVersion.current = null
    setError(null)
    preview.current?.clear()
  }, [])

  useEffect(() => {
    const offMold = useMold.subscribe((s, prev) => {
      if (s.source !== prev.source || s.mode !== prev.mode ||
        s.clearance !== prev.clearance || s.sideMargin !== prev.sideMargin ||
        s.baseThickness !== prev.baseThickness || s.wallThickness !== prev.wallThickness ||
        s.siliconeThickness !== prev.siliconeThickness) invalidate()
    })
    const offScan = onScan({ loaded: invalidate, swapped: invalidate })
    return () => { offMold(); offScan() }
  }, [invalidate])
  useEffect(() => invalidate(), [scanName, referenceName, invalidate])
  useEffect(() => () => { preview.current?.dispose(); preview.current = null }, [])
  useEffect(() => { preview.current?.setVisible(inWorkspace) }, [inWorkspace, generated])
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
      preview.current?.set(made, settings.source)
      generatedVersion.current = selectedVersion
      setGenerated(made)
      host.sceneRef.current?.frameAll()
      useStore.getState().setStatus('Generated a watertight mold component. Review the release and casting warnings before printing.')
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

  const exportPart = (format: Extract<MeshFormat, 'stl' | '3mf'>) => {
    if (!generated || generating) return
    const client = host.clientRef.current
    if (!client || generatedVersion.current !== (source === 'scan' ? client.scanVersion : client.nominalVersion)) {
      invalidate()
      setError('Target geometry changed. Regenerate the mold before exporting.')
      return
    }
    const made = buildMeshFile(format, [{
      name: 'Mold component',
      positions: generated.positions,
      indices: generated.indices,
    }], null, 'ScanRuler Mold Making')
    if (!made) { setError('There are no printable triangles to export.'); return }
    const master = source === 'reference' ? (referenceName ?? 'mold') : exportStem('mold')
    const stem = fileSafe(master.replace(/\.[^.]+$/, '')) || 'mold'
    saveBuilt({
      name: `${stem}-${generated.kind}.${made.extension}`,
      mimeType: made.mimeType,
      bytes: made.bytes,
      status: `Exported ${generated.kind} tooling with ${made.triangles} triangles; review mold warnings before printing.`,
    })
  }

  return {
    startPane: source === 'reference' && referenceName ? null : {
      title: 'Mold Making',
      blurb: 'Import STEP directly or a scanned STL, OBJ, PLY or 3MF. Make a single-sided rigid negative, a silicone casting box, or a thin conformal negative shell with printable STL/3MF output.',
    },
    hideScan: !!generated && source === 'scan' && inWorkspace,
    canSave: !!referenceName && source === 'reference',
    panel: inWorkspace ? (
      <MoldPanel
        onOpenScan={(file) => void host.openScan(file)}
        onOpenReference={(file) => void host.openReference(file)}
        onGenerate={() => void runGenerate()}
        onExport={exportPart}
        generated={generated}
        generating={generating}
        error={error}
      />
    ) : null,
  }
}
