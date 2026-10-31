// SPDX-License-Identifier: AGPL-3.0-only
// The solids the Boolean is offered: the bodies other workspaces lend
// (src/app/solids), and beside them every cylinder, cone and sphere shown in
// 3D Measure, taken as it is drawn there — at its assumed Ø and out as far as
// it was extended — so a bore is cut out with the cylinder fitted in it
// without that cylinder being made a body first. A hidden element is not on
// offer: one taken out as a body in the Reverse engineer workspace is hidden
// there, and offered as that body.

import { drawnFit } from '../../../src/core/elements/assumed'
import { offeredSolids, useSolids, type OfferedSolid } from '../../../src/app/solids'
import { useStore, type Element } from '../../../src/state/store'
import { elementSolid } from '../core/primitiveMesh'

const SOLID_KINDS: ReadonlySet<string> = new Set(['cylinder', 'cone', 'sphere'])

/** A number that changes with the text: 32-bit FNV-1a. */
function hashOf(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** The measured elements that are solids, as solids on offer. */
export function elementSolids(elements: readonly Element[]): OfferedSolid[] {
  return elements.flatMap((e) => {
    if (!e.visible || !e.fit || !SOLID_KINDS.has(e.fit.kind)) return []
    const fit = drawnFit(e.fit, e.assumed, e.extend)
    return [
      {
        key: `element:${e.id}`,
        name: e.name,
        source: '3D Measure',
        version: hashOf(JSON.stringify(fit)),
        mesh: async (chord: number) => {
          const mesh = elementSolid(fit, chord)
          if (!mesh) throw new Error(`${e.name} has no volume to make a solid of.`)
          return mesh
        },
      },
    ]
  })
}

/** Every solid the Boolean is offered: the lent bodies first, then the
 *  measured ones. */
export function booleanSolids(
  bySource = useSolids.getState().bySource,
  elements: readonly Element[] = useStore.getState().elements,
): OfferedSolid[] {
  return [...offeredSolids(bySource), ...elementSolids(elements)]
}

/** Solids' names as a list in words: "Cylinder 1", "Cylinder 1 and
 *  Solid 2", "Cylinder 1, Cylinder 2 and Solid 2". */
export function namesOf(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** The measured solids on offer as one string, the same for as long as
 *  they are — for a hook to follow, where the element list itself changes
 *  with every element made, picked or renamed. */
export function elementSolidsKey(elements: readonly Element[]): string {
  return elementSolids(elements)
    .map((s) => `${s.key}:${s.version}:${s.name}`)
    .join('|')
}
