// SPDX-License-Identifier: AGPL-3.0-only
// Generate mold geometry in ScanRuler's existing mesh worker. For a STEP
// reference, the browser stages it using ScanRuler's STEP loader and passes
// the staged id here without replacing the working scan.
import type { WorkerPlugin } from '../../src/core/workerPluginApi'
import { loadManifold } from '../mesh-tools/core/manifold'
import { parseMoldSettings } from './core/settings'
import { buildMold } from './core/geometry'

const plugin: WorkerPlugin = {
  id: 'mold-making',
  async handle(op, payload, ctx) {
    if (op !== 'generate') throw new Error(`Unknown mold-making operation: ${op}`)
    if (!payload || typeof payload !== 'object') throw new Error('Missing mold settings.')
    const p = payload as Record<string, unknown>
    const settings = parseMoldSettings(p.settings)
    const source = p.source === 'scan'
      ? ctx.scan()
      : p.source === 'staged' && Number.isSafeInteger(p.stagedId)
        ? ctx.takeStaged(p.stagedId as number)
        : null
    if (!source) throw new Error('Load a target before generating a mold.')
    ctx.progress('Loading the existing mesh Boolean engine…',0.02)
    const wasm = await loadManifold()
    let lastFraction=0.03
    const report=(status:string,fraction?:number)=>{
      if(fraction!==undefined)lastFraction=Math.max(lastFraction,Math.min(0.99,fraction))
      ctx.progress(status,lastFraction)
    }
    const made = buildMold(wasm, source, settings, report)
    ctx.progress('Mold geometry ready.',1)
    return {
      result: made,
      transfer: [made.positions.buffer, made.indices.buffer],
    }
  },
}
export default plugin
