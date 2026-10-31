// SPDX-License-Identifier: AGPL-3.0-only
// The way an extrude sweeps its profile, in the Extrude box: along the
// sketch plane's normal, as it starts — or askew, along a measured line or
// axis, a coordinate axis, or three numbers typed: an oblique prism whose
// ends stay parallel to the plane, a leaning boss on a level sketch. An axis
// chosen is read once and kept as a direction, turned to the plane's front;
// the field says how far it leans off the normal.

import { useState } from 'react'
import type { Vec3 } from '../../../src/core/types'
import { dot, normalize } from '../../../src/core/vec'
import { useStore } from '../../../src/state/store'
import { InfoDot } from '../../../src/ui/InfoDot'
import { MIN_SWEEP_RAD } from '../core/features'
import { resolveAxis } from '../core/resolve'
import { ExprInput } from './ExprInput'

const WORLD: { key: string; label: string; dir: Vec3 }[] = [
  { key: 'world:x', label: 'X axis', dir: [1, 0, 0] },
  { key: 'world:y', label: 'Y axis', dir: [0, 1, 0] },
  { key: 'world:z', label: 'Z axis', dir: [0, 0, 1] },
]

const same = (a: Vec3, b: Vec3) => Math.abs(Math.abs(dot(a, b)) - 1) < 1e-9

export function DirectionField({ direction, normal, onChange }: { direction: Vec3 | undefined; normal: Vec3 | null; onChange: (d: Vec3 | undefined) => void }) {
  const elements = useStore((s) => s.elements)
  const [typing, setTyping] = useState(false)
  const axes = elements.flatMap((e) => {
    const axis = e.fit && (e.fit.kind === 'line' || e.fit.kind === 'cylinder' || e.fit.kind === 'cone') ? resolveAxis({ kind: 'element', id: e.id }, undefined, { sections: [], elements, modelCenter: [0, 0, 0] }) : null
    return axis ? [{ key: `element:${e.id}`, label: e.name, dir: axis.dir }] : []
  })
  const offers = [...axes, ...WORLD]
  /** A direction turned to the side of the plane the normal points to, so
   *  To stays in front of the sketch. */
  const facing = (d: Vec3): Vec3 => (normal && dot(d, normal) < 0 ? [-d[0], -d[1], -d[2]] : d)
  const chosen = direction ? (offers.find((o) => same(o.dir, direction))?.key ?? 'typed') : typing ? 'typed' : 'normal'
  const lean = direction && normal ? (Math.acos(Math.min(1, Math.abs(dot(direction, normal)))) * 180) / Math.PI : 0
  const along = (d: Vec3 | null) => normal && d && Math.abs(dot(d, normal)) >= Math.sin(MIN_SWEEP_RAD)
  const shown = direction ?? normal ?? [0, 0, 1]
  const typed = (i: number, v: number) => {
    const next = normalize(shown.map((c, k) => (k === i ? v : c)) as Vec3)
    if (next && along(next)) onChange(facing(next))
  }
  return (
    <>
      <label className="field">
        <span>
          Direction
          <InfoDot title="The way the profile is swept">
            <p>
              Along the sketch plane's normal, as an extrude starts — or askew of it: along a measured line or axis, a coordinate axis, or three numbers typed. The ends stay in planes parallel to the sketch's, the distances count along the direction and a taper leans the sides about it — a leaning boss on a level sketch, with no tilted sketch plane to make.
            </p>
            <p>An axis is read once and kept as a direction, turned to the plane's front; one lying in the sketch plane sweeps nothing and is not offered.</p>
          </InfoDot>
        </span>
        <select
          data-test="extrude-direction"
          value={chosen}
          onChange={(e) => {
            const key = e.target.value
            setTyping(key === 'typed')
            if (key === 'normal') onChange(undefined)
            else if (key !== 'typed') {
              const o = offers.find((x) => x.key === key)
              if (o) onChange(facing(o.dir))
            }
          }}
        >
          <option value="normal">The sketch plane's normal</option>
          {offers.map((o) => (
            <option key={o.key} value={o.key} disabled={!along(o.dir)}>
              {o.label}
            </option>
          ))}
          <option value="typed">Typed…</option>
        </select>
      </label>
      {chosen === 'typed' && (
        <div className="field" data-test="extrude-direction-typed">
          <span>{lean > 0 ? `${Math.round(lean * 10) / 10}° off the normal` : 'x, y, z'}</span>
          <span className="re-xyz">
            {[0, 1, 2].map((i) => (
              <ExprInput key={i} value={Math.round(shown[i] * 1e4) / 1e4} kind="number" unit="" places={4} testId={`extrude-direction-${'xyz'[i]}`} onCommit={(v) => typed(i, v)} />
            ))}
          </span>
        </div>
      )}
      {chosen !== 'typed' && direction && (
        <p className="hint" data-test="extrude-direction-lean">
          {Math.round(lean * 10) / 10}° off the sketch plane's normal.
        </p>
      )}
    </>
  )
}
