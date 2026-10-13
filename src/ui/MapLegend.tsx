// SPDX-License-Identifier: AGPL-3.0-only
// The scale beside a map, read the way an inspection report reads it: the ramp
// itself, the values it stands for, and — on request — how much of the part
// actually sits at each of them.
//
// One instrument for every map the tool paints. Deviation and wall thickness
// differ only in what they hand it: the scale, how a number is written, and
// which figures belong under it.

import { useEffect, useRef, useState } from 'react'
import { colormapById, cssRgb, legendGradient, scaleCaps, type FieldScale } from '../core/field/colormap'
import type { FieldHistogram } from '../core/field/stats'
import { usePrefs } from '../state/prefsStore'

const TICKS = 9

/** One figure under the ramp. `wide` gives it the full width, for a pair of
 *  numbers that would not otherwise fit. */
export interface LegendStat {
  label: string
  value: string
  wide?: boolean
}

/** What the two ends of a signed scale mean, in words. The numbers alone say
 *  "+0.4" and "−0.4" and leave everyone to guess which way that is — so the
 *  scale spells it out, at the end it belongs to. */
export interface LegendEnds {
  high: string
  low: string
}

export function MapLegend({
  id,
  scale,
  unit,
  format,
  histogram,
  stats,
  showHistogram,
  zeroAt,
  ends,
  onLimit,
}: {
  /** Names this legend's test hooks — one map's legend per workspace. */
  id: string
  scale: FieldScale
  unit: string
  format: (v: number) => string
  histogram: FieldHistogram | null
  stats: LegendStat[] | null
  showHistogram: boolean
  /** Value to call out on the scale — the nominal a map is read against, where
   *  it has one. */
  zeroAt?: number
  /** What each end of the ramp means. Omit on an unsigned map, where a large
   *  reading and a small one need no explaining. */
  ends?: LegendEnds
  /** Makes the two end figures of the scale editable: a click on either
   *  opens it for typing, and the number entered is handed back with the
   *  end it was typed at. Whether the other end follows is the caller's —
   *  a deviation map keeps its scale symmetric about zero. Omit on a scale
   *  the user does not set. */
  onLimit?: (end: 'high' | 'low', value: number) => void
}) {
  // Drawn in the same ramp as the map it stands beside — the one chosen in
  // the settings.
  const map = colormapById(usePrefs((s) => s.colormap))
  const caps = scaleCaps(scale, map)
  const ticks = Array.from({ length: TICKS }, (_, i) => {
    const fraction = i / (TICKS - 1)
    return { value: scale.low + (scale.high - scale.low) * fraction, fraction }
  })

  return (
    <div className="devlegend" data-test={`${id}-legend`}>
      <div className="devlegend-unit">{unit}</div>
      {ends && (
        <div className="devlegend-end high" data-test={`${id}-end-high`}>
          <b>+</b> {ends.high}
        </div>
      )}
      <div className="devlegend-body">
        {showHistogram && histogram && (
          // Shares the ramp's vertical axis, so a bar sits at exactly the
          // height of the colour it is counting.
          <div className="devhist" data-test={`${id}-histogram`}>
            {Array.from(histogram.bins)
              .map((count, i) => ({ count, i }))
              .reverse()
              .map(({ count, i }) => (
                <div className="devhist-row" key={i}>
                  <span
                    style={{
                      width: histogram.peak ? `${(count / histogram.peak) * 100}%` : 0,
                    }}
                  />
                </div>
              ))}
          </div>
        )}
        <div className="devramp">
          <div
            className="devramp-cap"
            style={{ background: cssRgb(caps.high) }}
            title="Beyond the top of the scale"
          />
          <div
            className="devramp-bar"
            style={{ background: legendGradient(map, scale.bands, scale.reversed) }}
          />
          <div
            className="devramp-cap"
            style={{ background: cssRgb(caps.low) }}
            title="Beyond the bottom of the scale"
          />
        </div>
        <div className="devticks">
          {ticks.map((t, i) => {
            const end = onLimit && (i === TICKS - 1 ? 'high' : i === 0 ? 'low' : null)
            return end ? (
              <LimitTick key={t.fraction} id={id} end={end} value={t.value} fraction={t.fraction} format={format} onCommit={(v) => onLimit(end, v)} />
            ) : (
              <span
                key={t.fraction}
                className={
                  zeroAt !== undefined && Math.abs(t.value - zeroAt) < 1e-9 ? 'zero' : undefined
                }
                style={{ bottom: `${t.fraction * 100}%` }}
              >
                {format(t.value)}
              </span>
            )
          })}
        </div>
      </div>
      {ends && (
        <div className="devlegend-end low" data-test={`${id}-end-low`}>
          <b>−</b> {ends.low}
        </div>
      )}

      {stats && (
        <div className="devstats" data-test={`${id}-stats`}>
          {stats.map((s) => (
            <div key={s.label} className={s.wide ? 'wide' : undefined}>
              <span>{s.label}</span>
              <b>{s.value}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** An end of the scale the user can set: the figure as a key until it is
 *  clicked, then a box holding the magnitude to retype. Enter or leaving the
 *  box commits a usable number; Escape, or anything that is not one, keeps
 *  the scale as it was. The sign is the end's own — "0.5" typed at the
 *  bottom means −0.5 there — so the box shows and takes the size alone. */
function LimitTick({
  id,
  end,
  value,
  fraction,
  format,
  onCommit,
}: {
  id: string
  end: 'high' | 'low'
  value: number
  fraction: number
  format: (v: number) => string
  onCommit: (magnitude: number) => void
}) {
  const [editing, setEditing] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  // Closing the box takes the focus with it, and the blur that follows must
  // not commit what Escape threw away or Enter already took.
  const closed = useRef(false)
  useEffect(() => {
    if (editing) {
      closed.current = false
      ref.current?.select()
    }
  }, [editing])
  const close = (commit: boolean) => {
    if (closed.current) return
    closed.current = true
    const v = Math.abs(Number(ref.current?.value))
    setEditing(false)
    if (commit && Number.isFinite(v) && v > 0 && v !== Math.abs(value)) onCommit(v)
  }
  return editing ? (
    <input
      ref={ref}
      className="devtick-input"
      data-test={`${id}-limit-${end}-input`}
      type="number"
      step="any"
      min={0}
      defaultValue={Math.abs(value)}
      style={{ bottom: `${fraction * 100}%` }}
      autoFocus
      onBlur={() => close(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') close(true)
        else if (e.key === 'Escape') close(false)
      }}
    />
  ) : (
    <button
      type="button"
      className="devtick-edit"
      data-test={`${id}-limit-${end}`}
      style={{ bottom: `${fraction * 100}%` }}
      title="Click to set the range of the scale"
      onClick={() => setEditing(true)}
    >
      {format(value)}
    </button>
  )
}
