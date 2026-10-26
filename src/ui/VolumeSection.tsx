// SPDX-License-Identifier: AGPL-3.0-only
// The volume error — the deviation as volumes — panel-side: the button that
// measures it under the
// alignment in hand, the totals — material the reference has and the part has
// not, material the part has and the reference has not, and what the scan
// does not say — and the regions largest first. A row lights its region in
// the viewport while the pointer is on it; a click frames it.

import type { Vec3 } from '../core/types'
import type { VolumeKind } from '../core/deviation/volume'
import { useDeviation } from '../state/deviationStore'
import { useStore } from '../state/store'
import { VOLUME_COLORS } from '../viewer/volumeLayer'
import { InfoDot } from './InfoDot'

/** Rows in the list; the rest are counted under it. */
const LISTED = 15

const KIND_NAMES: Record<VolumeKind, string> = { excess: 'Excess', missing: 'Missing', unsure: 'Unsure' }

function mm3(v: number): string {
  return v >= 1000 ? `${(v / 1000).toFixed(2)} cm³` : `${v.toFixed(v >= 100 ? 0 : 1)} mm³`
}

export function VolumeSection({
  className,
  onMeasure,
  onFrame,
}: {
  className: string
  onMeasure: () => void
  /** Frame a box in the viewport, in the reference's frame. */
  onFrame: (min: Vec3, max: Vec3) => void
}) {
  const volume = useDeviation((s) => s.volume)
  const status = useDeviation((s) => s.volumeStatus)
  const message = useDeviation((s) => s.volumeMessage)
  const tolerance = useDeviation((s) => s.tolerance)
  const show = useDeviation((s) => s.showVolume)
  const setShow = useDeviation((s) => s.setShowVolume)
  const hover = useDeviation((s) => s.volumeHover)
  const setHover = useDeviation((s) => s.setVolumeHover)
  const running = status === 'running'
  const progress = useStore((s) => s.progress)
  const kept = volume ? volume.regions.filter((r) => r.kind !== 'unsure' || r.volume >= volume.cell ** 3 * 64) : []

  return (
    <div className={className} data-test="volume-section">
      <div className="sec-head">
        Volume error
        <InfoDot title="Volume error">
          <p>
            The scan and the reference compared as solids rather than surfaces: on a grid of small
            cells, each cell inside one and not the other is an error, and touching cells make a
            region. <b>Excess</b> is material the reference has and the part has not, <b>missing</b>{' '}
            the other way round — a boss not modelled, a pocket not cut, wherever it is, behind a wall
            or inside a cavity too.
          </p>
          <p>
            Where the scan has a hole, the reference stands in for it. What the scan still does not
            say is <b>unsure</b>, never called an error. Within the tolerance of the scan's surface a
            difference is the scan's noise and not counted, and nothing thinner than about two cells
            is seen: the surface map stays the tool for fine offsets.
          </p>
        </InfoDot>
      </div>
      <button className="primary block" data-test="volume-measure" disabled={running} onClick={onMeasure}>
        {running ? (
          <>
            <span className="spinner" /> Finding volume errors…{progress !== null ? ` ${Math.round(progress * 100)} %` : ''}
          </>
        ) : volume ? (
          'Find volume errors again'
        ) : (
          'Find volume errors'
        )}
      </button>
      {message && <p className="alarmtext">{message}</p>}
      {!volume && !running && !message && (
        <p className="hint">
          Material the model has too much of or lacks — a boss not modelled, a pocket not cut — as volumes. Takes some seconds on a large scan; uses the tolerance ±{tolerance} mm.
        </p>
      )}
      {volume && (
        <>
          {volume.tolerance !== tolerance && <p className="hint">Measured at ±{volume.tolerance} mm; the tolerance is ±{tolerance} mm now.</p>}
          {(['excess', 'missing', 'unsure'] as const).map((k) => (
            <div className="kv" key={k} data-test={`volume-total-${k}`}>
              <span className="dot" style={{ background: VOLUME_COLORS[k] }} />
              <span className="name">{KIND_NAMES[k]}</span>
              <b>
                {mm3(volume.totals[k].volume)} · {volume.totals[k].share.toFixed(2)} %
              </b>
            </div>
          ))}
          <p className="hint">
            Cells {volume.cell.toFixed(2)} mm — sees {volume.smallestSeen.toFixed(2)} mm and thicker. Of the
            reference's {mm3(volume.modelVolume)}, in {(volume.timings.total / 1000).toFixed(1)} s.
          </p>
          <label className="checkrow">
            <input type="checkbox" data-test="volume-show" checked={show} onChange={(e) => setShow(e.target.checked)} />
            <span>Show the regions</span>
          </label>
          {kept.length === 0 ? (
            <p className="hint">No region bigger than a few cells.</p>
          ) : (
            <div onPointerLeave={() => setHover(null)}>
              {kept.slice(0, LISTED).map((r) => {
                const index = volume.regions.indexOf(r)
                return (
                  <div
                    className={'kv' + (hover === index ? ' sel' : '')}
                    key={index}
                    data-test="volume-region"
                    style={{ cursor: 'pointer' }}
                    title={`${KIND_NAMES[r.kind]}: ${mm3(r.volume)}, up to ${r.maxDepth.toFixed(2)} mm from the scan, about ${r.thickness.toFixed(2)} mm thick — ${r.thickness < 3 * volume.cell ? 'a layer: a face standing off' : 'a lump: material there or not'}. Click to frame it.`}
                    onPointerEnter={() => setHover(index)}
                    onClick={() => onFrame(r.box.min, r.box.max)}
                  >
                    <span className="dot" style={{ background: VOLUME_COLORS[r.kind] }} />
                    <span className="name">
                      {KIND_NAMES[r.kind]} · {r.maxDepth.toFixed(1)} mm deep
                    </span>
                    <b>{mm3(r.volume)}</b>
                  </div>
                )
              })}
              {kept.length > LISTED && <p className="hint">and {kept.length - LISTED} smaller.</p>}
            </div>
          )}
        </>
      )}
    </div>
  )
}
