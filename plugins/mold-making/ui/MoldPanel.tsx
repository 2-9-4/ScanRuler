// SPDX-License-Identifier: AGPL-3.0-only
// Native ScanRuler target, mold controls, generated-component QA and export.
import { SCAN_ACCEPT, REFERENCE_ACCEPT, REFERENCE_FORMATS } from '../../../src/core/formats'
import { ModelSlot } from '../../../src/ui/ModelSlot'
import { useStore } from '../../../src/state/store'
import { useDeviation } from '../../../src/state/deviationStore'
import { MOLD_MODE_LABELS, MOLD_MODES, type MoldDimension } from '../core/settings'
import { useMold } from '../state/moldStore'
import type { MoldBuild } from '../core/geometry'

const DIMENSIONS: readonly { key: MoldDimension; name: string; detail: string }[] = [
  { key: 'clearance', name: 'Casting clearance', detail: 'Offset between the finished casting and target' },
  { key: 'sideMargin', name: 'Outer margin', detail: 'Clearance outside the target to the tooling wall' },
  { key: 'baseThickness', name: 'Base thickness', detail: 'Solid backing under the cavity' },
  { key: 'wallThickness', name: 'Printed wall', detail: 'Tooling wall thickness, including thin shells' },
  { key: 'siliconeThickness', name: 'Silicone jacket', detail: 'Space around the master to pour silicone' },
]

export function MoldPanel({ onOpenScan, onOpenReference, onGenerate, onExport, generated, generating, error }: {
  onOpenScan: (file: File) => void
  onOpenReference: (file: File) => void
  onGenerate: () => void
  onExport: (format: 'stl' | '3mf') => void
  generated: MoldBuild | null
  generating: boolean
  error: string | null
}) {
  const scanName = useStore((s) => s.fileName)
  const scanTriangles = useStore((s) => s.triangleCount)
  const referenceName = useDeviation((s) => s.nominalName)
  const busy = useStore((s) => s.busy)
  const source = useMold((s) => s.source)
  const mode = useMold((s) => s.mode)
  const setSource = useMold((s) => s.setSource)
  const setMode = useMold((s) => s.setMode)
  const setDimension = useMold((s) => s.setDimension)
  // Zustand 5 selectors must return stable values, not a new array each render.
  const clearance = useMold((s) => s.clearance)
  const sideMargin = useMold((s) => s.sideMargin)
  const baseThickness = useMold((s) => s.baseThickness)
  const wallThickness = useMold((s) => s.wallThickness)
  const siliconeThickness = useMold((s) => s.siliconeThickness)
  const settings = { clearance, sideMargin, baseThickness, wallThickness, siliconeThickness }
  const activeName = source === 'scan' ? scanName : referenceName

  return (
    <aside className="panel" data-test="mold-making-panel">
      <div className="group">
        <div className="sec-head">1. Target</div>
        <p className="hint">Use a scan mesh or load STEP/STP directly. ScanRuler's existing imports handle units and tessellation; no CAD reconstruction is required.</p>
        <div className="kindrow featurekeys" role="radiogroup" aria-label="Mold target source">
          <button type="button" role="radio" aria-checked={source === 'scan'}
            className={source === 'scan' ? 'on' : undefined}
            data-test="mold-source-scan" onClick={() => setSource('scan')}>Scan / model</button>
          <button type="button" role="radio" aria-checked={source === 'reference'}
            className={source === 'reference' ? 'on' : undefined}
            data-test="mold-source-reference" onClick={() => setSource('reference')}>Reference</button>
        </div>
        {source === 'scan' ? (
          <ModelSlot role="Target" name={scanName}
            detail={`${scanTriangles.toLocaleString('en-US')} triangles · imported as working scan`}
            dotColor="#8b9099" busy={busy} accept={SCAN_ACCEPT}
            formats={REFERENCE_FORMATS} onOpen={onOpenScan} />
        ) : (
          <ModelSlot role="Target reference" name={referenceName} detail="CAD or mesh reference"
            dotColor="#8b9099" busy={busy} accept={REFERENCE_ACCEPT}
            formats={REFERENCE_FORMATS} onOpen={onOpenReference} />
        )}
        {source === 'reference' && (
          <p className="hint">Reference coordinates are distinct from the aligned scan. Generation must use the selected source's own geometry, not whichever happens to be visible.</p>
        )}
      </div>
      <div className="group">
        <div className="sec-head">2. Tooling method</div>
        <div className="kindrow featurekeys" role="radiogroup" aria-label="Mold production mode">
          {MOLD_MODES.map((choice) => (
            <button key={choice} type="button" role="radio" aria-checked={mode === choice}
              data-test={`mold-mode-${choice}`}
              className={mode === choice ? 'on' : undefined}
              onClick={() => setMode(choice)}>{MOLD_MODE_LABELS[choice]}</button>
          ))}
        </div>
        <p className="hint">
          {mode === 'direct'
            ? 'Print a rigid negative cavity directly. The mold must release from its target, or use multiple parts.'
            : mode === 'silicone-box'
              ? 'Print a containment box around the positive master; pour silicone into the surrounding space.'
              : 'Print a thin negative cavity shell for casting silicone tooling, with an opening and planned removal.'}
        </p>
      </div>
      <div className="group">
        <div className="sec-head">3. Dimensions · mm</div>
        {DIMENSIONS.filter((d) =>
          mode === 'direct' ? ['clearance', 'sideMargin', 'baseThickness'].includes(d.key) :
          mode === 'silicone-box' ? ['siliconeThickness', 'wallThickness', 'baseThickness'].includes(d.key) :
          ['clearance', 'wallThickness'].includes(d.key)
        ).map((d) => {
          const val = settings[d.key]
          return (
            <label key={d.key} className="kv" title={d.detail}>
              <span className="name">{d.name}</span>
              <input data-test={`mold-${d.key}`} type="number"
                min={d.key === 'clearance' || d.key === 'sideMargin' ? 0 : 0.01}
                max={100000} step={0.1} value={val}
                onChange={(e) => {
                  if (e.target.value === '') return
                  setDimension(d.key, Number(e.target.value))
                }} />
            </label>
          )
        })}
      </div>
      <div className="group">
        <div className="sec-head">4. Generate &amp; export</div>
        <p className="hint" data-test="mold-generation-note">
          {mode === 'silicone-box'
            ? 'Open-top casting box: place and support your physical master before pouring. Supports, sealing and keys are not automated yet.'
            : 'One-sided impression only: the cavity ends at the target midplane. It cannot reproduce the entire target. Under-cut and release validation are not yet available.'}
        </p>
        <button type="button" disabled={busy || generating || !activeName}
          data-test="mold-generate" onClick={onGenerate}>{generating ? 'Generating…' : 'Generate mold'}</button>
        {error && <p className="hint" role="alert" data-test="mold-error">{error}</p>}
        {generated && (
          <div data-test="mold-result">
            <div className="kv"><span className="name">Mold triangles</span><b>{(generated.indices.length/3).toLocaleString('en-US')}</b></div>
            <div className="kv"><span className="name">Printed material</span><b>{(generated.volumeMm3/1000).toFixed(1)} cm³</b></div>
            <p className="hint">Preview is the exported solid. Verify orientation, fit, supports, and releases in your slicer before printing.</p>
            {generated.warnings.map((warning, index) => <p className="hint" key={index}>{warning}</p>)}
            <div className="kindrow featurekeys">
              <button type="button" data-test="mold-export-stl" onClick={() => onExport('stl')}>Export STL · mm</button>
              <button type="button" data-test="mold-export-3mf" onClick={() => onExport('3mf')}>Export 3MF</button>
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
