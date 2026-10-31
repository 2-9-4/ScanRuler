// SPDX-License-Identifier: AGPL-3.0-only
// The plane a sketch or a feature goes on, as a select: the coordinate
// planes, the sections, the measured planes and the planes the features
// made, the one under the pointer shown on the part.

import { useStore } from '../../../src/state/store'
import { RefPicker } from '../../../src/ui/RefPicker'
import { type PlaneRef } from '../core/features'
import { coordinatePlaneOffers, worldPlaneKey } from '../core/resolve'
import { useReverse } from '../state/reStore'

/** The planes a sketch can lie on, or an extrusion reach to. */
function planeOptions(): { key: string; label: string; ref: PlaneRef; group: string }[] {
  const store = useStore.getState()
  const out: { key: string; label: string; ref: PlaneRef; group: string }[] = []
  for (const sec of store.sections) out.push({ key: `section:${sec.id}`, label: sec.name, ref: { kind: 'section', id: sec.id }, group: 'Sections' })
  for (const el of store.elements) {
    if (el.fit?.kind === 'plane') out.push({ key: `plane:${el.id}`, label: el.name, ref: { kind: 'plane', id: el.id }, group: 'Planes' })
  }
  // The coordinate planes: through the part's centre while it sits where
  // the scanner left it — at the origin they would miss it — and at zero,
  // the part's own, once it is aligned or there is no scan.
  const hasScan = store.fileName !== null
  for (const o of coordinatePlaneOffers({ centre: hasScan ? store.modelCenter : null, atZero: !hasScan || store.appliedAlignment !== null })) out.push({ key: o.key, label: o.label, ref: o.ref, group: 'Coordinate planes' })
  return out
}

function planeKey(ref: PlaneRef): string {
  return ref.kind === 'world' ? worldPlaneKey(ref.axis, ref.offset) : ref.kind === 'fitted' ? 'fitted' : ref.kind === 'bodyFace' ? 'bodyFace' : ref.kind === 'radial' ? 'radial' : `${ref.kind}:${ref.id}`
}

/** The plane picker: a list whose hovered option shows on the part — the
 *  plane as a sheet through the scan with its name — so "Plane 2" is a
 *  place, not a label. The chosen plane stays shown while the box is open. */
export function PlaneSelect({ value, testId, placeholder, onChange }: { value: PlaneRef | null; testId: string; placeholder: string; onChange: (ref: PlaneRef) => void }) {
  const options = planeOptions()
  const re = useReverse
  const hint = (key: string | null) => {
    const o = key ? options.find((x) => x.key === key) : undefined
    const fallback = value ? options.find((x) => x.key === planeKey(value)) : undefined
    const show = o ?? fallback
    re.getState().setHint(show ? { kind: 'plane', ref: show.ref, name: show.label } : null)
  }
  return (
    <RefPicker
      value={value ? planeKey(value) : null}
      options={options.map((o) => ({ key: o.key, label: o.label, group: o.group }))}
      placeholder={placeholder}
      testId={testId}
      onChange={(key) => {
        const o = options.find((x) => x.key === key)
        if (o) {
          onChange(o.ref)
          // The chosen plane stays shown while its box is open — unless the
          // choice opened a sketch on it, whose own plane the viewport shows
          // from here on; this list is gone by then and cannot clear it.
          if (!re.getState().sketchDraft) re.getState().setHint({ kind: 'plane', ref: o.ref, name: o.label })
        }
      }}
      onHover={hint}
    />
  )
}
