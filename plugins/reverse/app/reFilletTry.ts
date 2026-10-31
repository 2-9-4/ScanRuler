// SPDX-License-Identifier: AGPL-3.0-only
// reverse.body.fillet_try: a round or a chamfer of the part tried at a list
// of sizes on the body as it stood before it, nothing after it rebuilt and
// nothing kept. A radius changed through the feature costs a build of all
// that follows the round — 9 to 86 s a try on a fan — and a search by hand
// stops early for it, at a "kernel limit" that a size above it passes.

import { invalid } from '../../../src/commands/core/common'
import { arr, num, obj } from '../../../src/commands/schema'
import { errorMessage } from '../../../src/commands/types'
import { type Command, CommandError } from '../../../src/plugins/api'
import { FILLET_TRY_MS } from '../core/build'
import type { FilletTry } from '../core/buildTypes'
import { featureNamed, re, ready, type Ref } from './reCommandCore'
import { featureRef } from './reSchemas'

/** How many sizes a try takes at once. */
export const FILLET_TRY_SIZES = 8

/** A try as an answer gives it. */
function tryOut(t: FilletTry) {
  if (!t.tried) return { size: t.size, tried: false }
  return { size: t.size, builds: t.builds, closed: t.closed, valid: t.valid, faces: t.faces, ms: Math.round(t.ms ?? 0), ...(t.message ? { message: t.message } : {}), ...(t.note ? { note: t.note } : {}) }
}

const listed = (sizes: readonly number[]) => sizes.join(', ')

export const filletTry: Command<{ feature: Ref; radii: number[] }> = {
  name: 'fillet_try',
  title: 'Try a round at other sizes',
  description:
    'A fillet or a chamfer tried at a list of sizes on the body as it stood before it: nothing after it is rebuilt, nothing is kept, the feature and the bodies stay as they are. Each answers { size, builds, closed, valid, faces, ms }, with the kernel’s message where it refused, and largest is the largest size that builds. Faster than reverse.feature.update by the time of all that comes after the feature, so read several sizes at once — above the one that failed as well as below: a round can build larger than one that fails. It says nothing of the features after it: set the size chosen with reverse.feature.update, which builds them. radii: distances, for a chamfer; one by two distances keeps their proportion. Not for a round at a varying radius.',
  input: obj(
    {
      feature: { ...featureRef(), description: 'The fillet or chamfer, by name or id. It must have run in the last build; it may have failed there.' },
      // units-ok: an agent's input, in millimetres always.
      radii: arr(num(undefined, { exclusiveMinimum: 0 }), `The sizes to try, mm, in that order; ${FILLET_TRY_SIZES} at most.`, { minItems: 1, maxItems: FILLET_TRY_SIZES }),
    },
    ['feature', 'radii'],
  ),
  readOnly: true,
  long: true,
  timeoutMs: FILLET_TRY_MS + 120_000,
  askForLess: 'fewer sizes (radii)',
  run: async ({ feature, radii }) => {
    const s = await ready()
    const f = featureNamed(feature)
    if (f.kind !== 'fillet' && f.kind !== 'chamfer') invalid(`${f.name} is a ${f.kind}: only a fillet or a chamfer is tried at other sizes.`)
    if (f.suppressed) throw new CommandError('invalid_state', `${f.name} is suppressed: the last build did not run it.`)
    if (!re().features.includes(f)) throw new CommandError('invalid_state', `${f.name} is below the rollback bar — the part is not built up to it.`)
    const client = s.client()
    if (!client) throw new CommandError('unavailable', 'The CAD kernel is not running.')
    const { tries, crashed } = await client.filletTry(f.id, [...new Set(radii)]).catch((e) => {
      throw new CommandError('failed', `${f.name}: ${errorMessage(e)}`)
    })
    const built = tries.filter((t) => t.builds).map((t) => t.size)
    const failed = tries.filter((t) => t.tried && !t.builds).map((t) => t.size)
    const untried = tries.filter((t) => !t.tried).map((t) => t.size)
    const largest = built.length > 0 ? Math.max(...built) : null
    const said = [
      built.length > 0 ? `Builds at ${listed(built)}.` : 'Builds at none tried.',
      failed.length > 0 ? `Fails at ${listed(failed)}.` : '',
      crashed !== undefined ? `The CAD kernel crashed on the last tried (${crashed}) and was started again — build the part again for what it held.` : untried.length > 0 ? `Not tried, out of time: ${listed(untried)}.` : '',
      'Nothing was kept; what comes after the feature was not built.',
    ]
    return {
      feature: { id: f.id, name: f.name },
      tries: tries.map(tryOut),
      largest,
      status: said.filter((x) => x !== '').join(' '),
    }
  },
}
