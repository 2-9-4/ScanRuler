// SPDX-License-Identifier: AGPL-3.0-only
// The volume error: the scan and the reference part compared as solids —
// material the reference has and the part has not, and the other way round,
// as regions with their volume and depth (core/deviation/volume) — what the
// Deviation workspace's Volume error section measures.

import type { Vec3 } from '../../core/types'
import { useDeviation } from '../../state/deviationStore'
import { commandHost } from '../host'
import { requireScan } from '../refs'
import { arr, enumOf, int, num, obj, vec3 } from '../schema'
import { CommandError, type Command } from '../types'
import { lastError, showWorkspace } from './common'
import { MAX_REGIONS, VOLUME_REGIONS, volumeOut } from '../volumeAnswer'

const boxSchema = obj({ min: vec3('The lowest corner, mm.'), max: vec3('The highest corner, mm.') }, ['min', 'max'], 'Only this box is looked at, in the frame the reference is measured in.')

const volumeCommand: Command<{ tolerance?: number; cell?: number; regions?: number; within?: { min: Vec3; max: Vec3 }; kinds?: ('excess' | 'missing' | 'unsure')[] }> = {
  name: 'volume',
  title: 'Volume error',
  description:
    'The scan and the reference part compared as solids, on a grid of small cells: each cell inside one and not the other is an error, touching cells a region. Read it before the surface patches — it tells how much material is wrong and where, which the nearest-point map cannot. excess is material the reference has and the part has not (a boss modelled where there is air, a hole not cut), missing material the part has and the reference has not (a boss not modelled, a pocket cut where the part is solid), wherever it is: behind a wall, inside a cavity, past the search distance. Where the scan has a hole the reference stands in for it; what the scan still does not say is unsure, never an error. Within the tolerance of the scan’s surface a difference is noise; nothing thinner than smallestSeen (two cells) is seen — the surface map stays the tool for fine offsets. Answers totals (mm³ and share of the reference’s volume, %) and the regions largest first, each with its kind, volume (mm³), maxDepth (mm from the scan’s surface), thickness (volume over the area it shares with a surface), shape — layer (a face standing off, about thickness thick) or lump (material there or not) —, centroid, deepest point and box in the reference’s frame (what view.render { frame } takes in the Deviation workspace), evidence (the share of its scan side that is real scan rather than reference standing in) and confidence. Needs the scan aligned to the reference (deviation.align). Shows the regions in the Deviation workspace, the colour plot put away. About 15 s on a 1.5M-triangle scan; within a box, less. Changes nothing kept.',
  input: obj({
    tolerance: num('± mm; the map’s tolerance (deviation.settings) by default.', { exclusiveMinimum: 0 }),
    cell: num('The cell, mm; by default half the tolerance or a 250th of the reference’s longest side, the larger — and coarser if the grid would pass 16M cells.', { exclusiveMinimum: 0 }),
    regions: int(`How many regions to name; ${VOLUME_REGIONS} by default, ${MAX_REGIONS} at most.`, { minimum: 1, maximum: MAX_REGIONS }),
    within: boxSchema,
    kinds: arr(enumOf(['excess', 'missing', 'unsure'], 'A kind of region.'), 'Only regions of these kinds named; all by default. The totals are of all.'),
  }),
  readOnly: true,
  long: true,
  timeoutMs: 600_000,
  run: async ({ tolerance, cell, regions = VOLUME_REGIONS, within, kinds }, ctx) => {
    requireScan()
    if (!useDeviation.getState().nominalName) throw new CommandError('invalid_state', 'No reference part is open — open one with deviation.open_reference.')
    showWorkspace('deviation')
    if (useDeviation.getState().source !== 'reference') useDeviation.getState().setSource('reference')
    const d = useDeviation.getState()
    if (!d.align) throw new CommandError('invalid_state', 'The scan is not aligned to the reference — run deviation.align first.')
    if (d.volumeStatus === 'running') throw new CommandError('busy', 'The volume error is being measured already.')
    if (within) for (let k = 0; k < 3; k++) if (!(within.min[k] < within.max[k])) throw new CommandError('invalid_input', 'within: min must lie below max on every axis.')
    const tol = tolerance ?? d.tolerance
    ctx.progress('Finding volume errors…')
    await commandHost().session.deviation.runVolume({ tolerance: tol, ...(cell !== undefined ? { cell } : {}), ...(within ? { within } : {}) })
    const after = useDeviation.getState()
    if (after.volumeStatus !== 'ready' || !after.volume) throw new CommandError('failed', after.volumeMessage ?? lastError('The volume error could not be measured.'))
    return volumeOut(after.volume, tol, regions, kinds)
  },
}

export const volumeCommands = [volumeCommand]
