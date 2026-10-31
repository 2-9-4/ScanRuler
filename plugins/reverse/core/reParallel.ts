// SPDX-License-Identifier: AGPL-3.0-only
// A build shared out between kernels. Before the kernel's worker builds the
// list, the steps are grouped by the bodies they work on (buildGroups.ts);
// where two or more groups have work worth sharing, helper kernels
// (reHelper.ts) build some of them while this one builds the rest
// (Builder.buildPart), and the parts are offered to the build of the whole
// list, which takes their steps over. A knurled screw cap — the base and
// its knurl, the cap and its knurl — builds in about the time of its
// slower half.
//
// A group stays with the kernel that built it, so built again it is taken
// over there from what that kernel kept. A group goes to a helper only as
// new work — no step of it built here before — and a group that reads the
// scan stays here, where the scan is. A helper that fails leaves its group
// to this kernel, whose build plays what it could not take over.

import type { Builder } from './build'
import { groupSteps } from './buildGroups'
import { stepKeys } from './buildTypes'
import type { BuildStep } from './features'
import type { KernelEvent } from './reEvents'
import type { HelperResponse, PartRequest } from './reHelper'
import type { Sketch } from './sketch'

/** The helper kernels, numbered from 1; the worker of each made on its
 *  first request. */
export interface HelperPool {
  readonly size: number
  /** The work, ms, a build's second largest group has to be worth for the
   *  build to be shared out; SHARE_MIN_MS when not given. */
  readonly minMs?: number
  request(helper: number, msg: { type: 'init' } | Omit<PartRequest, 'requestId'>, transfer: Transferable[]): Promise<HelperResponse>
  /** Hears what each helper's kernel is at while it builds (reEvents.ts) —
   *  set by the service the pool works for. */
  onEvent?: ((helper: number, event: KernelEvent) => void) | null
}

/** The work a group has to be worth, ms, for the build to be shared out —
 *  the second largest: below it a helper's start and the bodies carried
 *  back cost about what they save. */
const SHARE_MIN_MS = 800
/** The same before any helper has started: its worker and its kernel take
 *  about a second the first time, so the work has to be worth more. */
const SHARE_COLD_MS = 3000

/** What a step of no known time is taken to cost, ms: one of these kinds
 *  — a boolean, a round, a coil — and the rest. */
const HEAVY_MS = 1000
const LIGHT_MS = 20
const HEAVY = new Set<BuildStep['kind']>(['boolean', 'pattern', 'thread', 'fillet', 'chamfer', 'shell', 'split', 'trim', 'loft', 'sweep', 'import', 'draft', 'offsetBody', 'thicken', 'mirror', 'moveFace', 'deleteFace', 'surface'])

function estimate(step: BuildStep, known: number | undefined): number {
  if (known !== undefined) return known
  if (HEAVY.has(step.kind)) return HEAVY_MS
  if ((step.kind === 'extrude' || step.kind === 'revolve' || step.kind === 'extract' || step.kind === 'loft' || step.kind === 'sweep') && step.op !== 'new') return HEAVY_MS
  if (step.kind === 'revolve' && step.pitch !== 0) return HEAVY_MS
  return LIGHT_MS
}

/** The sharing out for one builder; `pool` the helpers it may use. */
export function createParallel(builder: Builder, pool: HelperPool) {
  /** Where each group is built, by its first step's id: 0 here, n the
   *  n-th helper. */
  const where = new Map<string, number>()
  /** The STEP files each helper has been handed, by key. */
  const filesSent = new Map<number, Set<string>>()
  /** The helpers whose kernels are up. */
  const started = new Set<number>()

  /** The groups of `steps` worth sharing out built — here and on the
   *  helpers — and offered to the build of the whole list, which follows.
   *  Nothing when there is nothing worth sharing. */
  async function prebuild(steps: readonly BuildStep[], sketches: readonly [number, Sketch][]): Promise<void> {
    if (pool.size === 0) return
    const byId = new Map(sketches)
    const sketchOf = (id: number) => byId.get(id)
    const keys = stepKeys(steps, sketchOf)
    const { groups, dirty } = groupSteps(
      steps,
      sketchOf,
      keys.map((k) => !builder.knows(k)),
    )
    const work = groups
      .map((g) => ({
        group: g,
        key: String(steps[g.steps[0]].id),
        cost: g.steps.reduce((sum, i) => sum + (dirty[i] ? estimate(steps[i], builder.playMs.get(keys[i])) : 0), 0),
        fresh: g.steps.every((i) => !builder.knows(keys[i])),
      }))
      .filter((w) => w.cost > 0)
    const movable = work.filter((w) => !w.group.scan).sort((a, b) => b.cost - a.cost)
    const worth = pool.minMs ?? (started.size > 0 ? SHARE_MIN_MS : SHARE_COLD_MS)
    if (movable.length < 2 || movable[1].cost < worth) return

    // Each group to the kernel that built it; new work to the least loaded,
    // the largest first.
    const load = new Array<number>(pool.size + 1).fill(0)
    const to = new Map<(typeof work)[number], number>()
    for (const w of work) {
      const at = w.group.scan ? 0 : where.get(w.key)
      if (at === undefined) continue
      to.set(w, at)
      load[at] += w.cost
    }
    for (const w of [...work].sort((a, b) => b.cost - a.cost)) {
      if (to.has(w)) continue
      // A group of little work stays here: a helper's start costs more.
      const at = w.fresh && !w.group.scan && w.cost >= worth ? load.indexOf(Math.min(...load)) : 0
      to.set(w, at)
      load[at] += w.cost
      where.set(w.key, at)
    }
    if (![...to.values()].some((at) => at > 0)) return

    // The helpers up — their workers made, their kernels loaded — before
    // this kernel starts on its own share: blocked in it, this worker could
    // not start theirs, and they would wait for it to finish. A helper that
    // does not come up leaves its groups here.
    const helpers = [...new Set([...to.values()].filter((at) => at > 0))]
    const up = await Promise.all(helpers.map((h) => pool.request(h, { type: 'init' }, []).then((r) => r.type === 'init-ok', () => false)))
    helpers.forEach((h, i) => {
      if (up[i]) {
        started.add(h)
        return
      }
      started.delete(h)
      for (const [w, at] of to) if (at === h) to.set(w, 0)
      for (const [key, at] of where) if (at === h) where.delete(key)
    })

    const asks: Promise<{ helper: number; response: HelperResponse | null }>[] = []
    for (const [w, helper] of to) {
      if (helper === 0) continue
      const own = w.group.steps.map((i) => steps[i])
      const sent = filesSent.get(helper) ?? new Set<string>()
      filesSent.set(helper, sent)
      const stepFiles: [string, string][] = []
      for (const s of own) {
        if (s.kind !== 'import' || sent.has(s.file)) continue
        const text = builder.stepFile(s.file)
        if (text === undefined) continue
        sent.add(s.file)
        stepFiles.push([s.file, text])
      }
      const msg: Omit<PartRequest, 'requestId'> = {
        type: 'part',
        group: w.key,
        keep: [...where].filter(([, at]) => at === helper).map(([key]) => key),
        steps: own,
        sketches: [...sketches],
        ...(stepFiles.length > 0 ? { stepFiles } : {}),
        have: builder.heldTokens(`helper ${helper}`),
      }
      asks.push(
        pool.request(helper, msg, []).then(
          (response) => ({ helper, response }),
          () => ({ helper, response: null }),
        ),
      )
    }
    // This kernel's own share, while the helpers build theirs.
    const mine = [...to].flatMap(([w, at]) => (at === 0 ? w.group.steps : [])).sort((a, b) => a - b)
    if (mine.length > 0) builder.buildPart(mine.map((i) => steps[i]), sketchOf)
    for (const { helper, response } of await Promise.all(asks)) {
      let ok = false
      if (response?.type === 'part-ok' && response.part) {
        try {
          builder.offer(response.part, `helper ${helper}`)
          ok = true
        } catch {
          // A part that cannot be read in: its steps are played here.
        }
      }
      if (!ok) {
        // The helper's groups come back here, to be built — and kept — by
        // this kernel from now on.
        for (const [key, at] of where) if (at === helper) where.delete(key)
        started.delete(helper)
        filesSent.delete(helper)
      }
    }
  }

  return { prebuild }
}
