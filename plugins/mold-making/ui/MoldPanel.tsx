// SPDX-License-Identifier: AGPL-3.0-only
// Targets and modes are real ScanRuler project inputs. Geometry generation is
// deliberately not shown as available until the worker, preview and QA exist.
import { SCAN_ACCEPT, REFERENCE_ACCEPT, REFERENCE_FORMATS } from '../../../src/core/formats'
import { ModelSlot } from '../../../src/ui/ModelSlot'
import { useStore } from '../../../src/state/store'
import { useDeviation } from '../../../src/state/deviationStore'
import { MOLD_MODE_LABELS, MOLD_MODES, type MoldDimension } from '../core/settings'
import { useMold } from '../state/moldStore'

const DIMENSIONS: readonly { key: MoldDimension; name: string; detail: string }[] = [
  { key: 'clearance', name: 'Casting clearance', detail: 'Offset between the finished casting and target' },
  { key: 'sideMargin', name: 'Outer margin', detail: 'Clearance outside the target to the tooling wall' },
  { key: 'baseThickness', name: 'Base thickness', detail: 'Solid backing under the cavity' },
  { key: 'wallThickness', name: 'Printed wall', detail: 'Tooling wall thickness, including thin shells' },
  { key: 'siliconeThickness', name: 'Silicone jacket', detail: 'Space around the master to pour silicone' },
]

export function MoldPanel({ onOpenScan, onOpenReference }: {
  onOpenScan: (file: File) => void
  onOpenReference: (file: File) => void
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
          mode === 'direct' ? d.key !== 'siliconeThickness' :
          mode === 'silicone-box' ? d.key !== 'clearance' :
          d.key !== 'siliconeThickness'
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
        <p className="hint" data-test="mold-foundation-status">
          {activeName
            ? `${activeName} is selected. Geometry generation, part preview, print validation and STL export are not implemented in this foundation step.`
            : 'Choose a target above. Geometry generation follows after the geometry worker and export checks are implemented.'}
        </p>
        <button type="button" disabled title="Generation is not available in the workspace foundation">Generate mold (not yet available)</button>
      </div>
    </aside>
  )
}
