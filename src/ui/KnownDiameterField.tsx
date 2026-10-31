// SPDX-License-Identifier: AGPL-3.0-only
// The diameter a sphere is known to be — a gauge ball's, a ballbar's — for
// the fit to hold. Empty until one is typed: holding a diameter that is not
// the ball's would move the centre with it, so nothing is suggested. Under
// it, once the fit holds one, the diameter the same points give when it is
// free and how far holding it moved the centre — the check that the scan
// and the number agree.

import { useRef } from 'react'
import { InfoDot } from './InfoDot'
import { useStore } from '../state/store'
import { useLength, type BoundLength } from '../app/useUnits'
import { useFieldUnits } from './NumberField'

export function KnownDiameterField({ busy, onChange }: { busy: boolean; onChange: (mm: number | undefined) => void }) {
  const known = useStore((s) => s.draft?.settings.knownDiameter)
  const fit = useStore((s) => s.draft?.fit)
  const ref = useRef<HTMLInputElement>(null)
  // Held in millimetres, typed in the display units.
  const len = useLength()
  const u = useFieldUnits('length', undefined)
  const shown = known === undefined ? '' : u.text(known)
  const held = fit?.kind === 'sphere' ? fit.held : undefined

  const commit = (text: string) => {
    if (text.trim() === '') {
      if (known !== undefined) onChange(undefined)
      return
    }
    // Text left as it was shown commits nothing: in inches it is rounded.
    if (text === shown) return
    const v = u.read(Number(text))
    if (Number.isFinite(v) && v > 0 && v !== known) onChange(v)
  }

  return (
    <>
      <label className="field">
        <span>
          Known Ø
          <InfoDot title="Known Ø">
            <p>
              The ball's diameter as it is <b>known</b> — a precision sphere, a gauge ball, the balls
              of a ballbar. The fit then holds this diameter and places only the centre.
            </p>
            <p>
              On a ball scanned only partly, the free fit's diameter and the centre's position
              along the scanned cap trade off against each other: a surface that reads a few µm off
              towards the edge of the cap moves both by several times that. Holding the true
              diameter takes that freedom away, so centre distances come out right.
            </p>
            <p>
              The other way round: a scan that reads uniformly large or small (spray, a scanner
              offset) moves a held centre by about that much towards the scanned side. The
              diameter the points give when it is free is shown below — it should be close to the
              known one.
            </p>
            <p>Leave it empty for a free fit. It belongs to this sphere alone.</p>
          </InfoDot>
        </span>
        <span className="unitfield">
          <input
            ref={ref}
            type="number"
            data-test="known-diameter"
            step={u.step(0.001)}
            min={u.min(0.001)}
            placeholder="free"
            disabled={busy}
            defaultValue={shown}
            key={shown}
            onBlur={(e) => {
              commit(e.target.value)
              e.target.value = shown
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') ref.current?.blur()
            }}
          />
          <i>{u.word}</i>
        </span>
      </label>
      {held && known !== undefined && (
        <p className="dro-note" data-test="known-diameter-free">
          Free fit Ø {len.fmt(held.freeDiameter, 4)} ({fine(held.freeDiameter - known, len, true)}) · centre moved{' '}
          {fine(held.shift, len, false)} by holding it
        </p>
      )}
    </>
  )
}

/** A small length: in micrometres beside millimetres, in inches to five
 *  decimals beside inches — no metric figure on an inch screen. */
function fine(mm: number, len: BoundLength, signed: boolean): string {
  const sign = signed ? (mm < 0 ? '−' : '+') : ''
  if (len.units === 'in') return `${sign}${len.fmt(Math.abs(mm), 4)}`
  return `${sign}${(Math.abs(mm) * 1000).toFixed(1)} µm`
}
