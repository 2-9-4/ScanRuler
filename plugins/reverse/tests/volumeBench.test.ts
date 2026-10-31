// SPDX-License-Identifier: AGPL-3.0-only
// Benchmark (temporary): the deviation as volumes (core/deviation/volume)
// on the projects named in VOL_BENCH (paths to .scanruler files,
// ';'-separated). Each project is run
// as it is, without the no-scan patch, with planted errors, and as a scan
// opened up (its bottom and three discs cut away) with and without the
// patch. The tables go to stdout and to VOL_BENCH_OUT when set.
//
// A project with a reference and an alignment is read as it is; one without
// (or with VOL_BODIES=1) has its Reverse engineer bodies built and meshed as
// the comparison does, in the scan's frame.

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { strFromU8, unzipSync } from 'fflate'
import { beforeAll, describe, it } from 'vitest'
import { parsePLY } from '../../../src/core/parsers/ply'
import { parseSTL } from '../../../src/core/parsers/stl'
import { buildMeshGraph } from '../../../src/core/geometry/buildGraph'
import { identityRigid, rigidApply, rigidApplyToPoints, rigidInvert, type Rigid } from '../../../src/core/deviation/rigid'
import { rigidFromJson } from '../../../src/core/project/manifest'
import { emptyHit, NominalSurface } from '../../../src/core/deviation/surface'
import { type ReferenceSamples, DEFAULT_REFERENCE_FACING_DEG, meshArea, readReference, sampleSpacing, subdivideForMap, wantedSpacing } from '../../../src/core/deviation/onReference'
import { defaultCell, DEFAULT_VOLUME_BETA, noScanPatchOf, volumeDeviation, MIN_REGION_CELLS, type VolumeDeviation, type VolumeMesh, type VolumeRegion } from '../../../src/core/deviation/volume'
import { WindingTree } from '../../../src/core/deviation/winding'
import { volumeOut, VOLUME_REGIONS } from '../../../src/commands/volumeAnswer'
import { rimLoops, type RimLoop } from '../../../src/core/geometry/openEdges'
import type { Vec3 } from '../../../src/core/types'
import { Builder } from '../core/build'
import { ReKernel } from '../core/kernel'
import { resolveFeatures } from '../core/resolve'
import { findRegions } from '../core/regions'
import type { SketchFeature } from '../core/features'
import { COMPARE_CHORD_MM } from '../core/compare'
import { applyReversePart, type ReversePart } from '../app/projectSection'
import { useReverse } from '../state/reStore'
import reversePlugin from '../plugin'

const files = (process.env.VOL_BENCH ?? '').split(';').filter(Boolean)
const outFile = process.env.VOL_BENCH_OUT
/** The trees' β and the cell, when not the defaults. */
const beta = process.env.VOL_BETA ? Number(process.env.VOL_BETA) : undefined
const cell = process.env.VOL_CELL ? Number(process.env.VOL_CELL) : undefined
/** The worker's reach for the map on the reference, × the scan's diagonal. */
const REFERENCE_REACH = 0.1

beforeAll(() => {
  reversePlugin.install?.()
  if (outFile) writeFileSync(outFile, '')
})

function say(line = ''): void {
  console.log(line)
  if (outFile) appendFileSync(outFile, line + '\n')
}

interface Labelled {
  /** Per reference triangle, what it lies on: a body and a face. */
  label?: (triangle: number) => string
}

interface Project extends Labelled {
  name: string
  scan: VolumeMesh & { diag: number }
  reference: VolumeMesh
  toReference: Rigid
  tolerance: number
  source: string
  loadMs: number
}

/** A box, a shell of twelve triangles wound outward (inward with `inward`). */
function boxShell(min: Vec3, max: Vec3, inward = false): VolumeMesh {
  const c = (i: number): number[] => [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]]
  const positions = Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7].flatMap(c))
  // Each face counter-clockwise from outside.
  const quads = [[0, 4, 6, 2], [1, 3, 7, 5], [0, 1, 5, 4], [2, 6, 7, 3], [0, 2, 3, 1], [4, 5, 7, 6]]
  const indices: number[] = []
  for (const [a, b, cc, d] of quads) {
    if (inward) indices.push(a, cc, b, a, d, cc)
    else indices.push(a, b, cc, a, cc, d)
  }
  return { positions, indices: Uint32Array.from(indices) }
}

/** A cylinder along `axis` (0 x, 1 y, 2 z) from `a` to `b` along it, capped,
 *  wound outward (inward with `inward`). */
function cylinderShell(centre: Vec3, axis: number, a: number, b: number, radius: number, inward: boolean, segments = 64): VolumeMesh {
  const u = (axis + 1) % 3, v = (axis + 2) % 3
  const positions: number[] = []
  const indices: number[] = []
  const at = (s: number, along: number) => {
    const p = [0, 0, 0]
    p[axis] = along
    if (s >= 0) {
      const t = (2 * Math.PI * s) / segments
      p[u] = centre[u] + radius * Math.cos(t)
      p[v] = centre[v] + radius * Math.sin(t)
    } else {
      p[u] = centre[u]
      p[v] = centre[v]
    }
    positions.push(p[0], p[1], p[2])
    return positions.length / 3 - 1
  }
  const lo = at(-1, a), hi = at(-1, b)
  const ring0: number[] = [], ring1: number[] = []
  for (let s = 0; s < segments; s++) {
    ring0.push(at(s, a))
    ring1.push(at(s, b))
  }
  const tri = (x: number, y: number, z: number) => (inward ? indices.push(x, z, y) : indices.push(x, y, z))
  for (let s = 0; s < segments; s++) {
    const n = (s + 1) % segments
    tri(ring0[s], ring0[n], ring1[n])
    tri(ring0[s], ring1[n], ring1[s])
    tri(lo, ring0[n], ring0[s])
    tri(hi, ring1[s], ring1[n])
  }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) }
}

function join(...meshes: VolumeMesh[]): VolumeMesh {
  let vertices = 0, corners = 0
  for (const m of meshes) {
    vertices += m.positions.length
    corners += m.indices.length
  }
  const positions = new Float32Array(vertices)
  const indices = new Uint32Array(corners)
  let v = 0, c = 0
  for (const m of meshes) {
    positions.set(m.positions, v)
    for (let i = 0; i < m.indices.length; i++) indices[c + i] = m.indices[i] + v / 3
    v += m.positions.length
    c += m.indices.length
  }
  return { positions, indices }
}

/** The mesh without the triangles `drop` names. */
function without(m: VolumeMesh, drop: (t: number) => boolean): VolumeMesh {
  const kept: number[] = []
  for (let t = 0; t < m.indices.length / 3; t++) if (!drop(t)) kept.push(m.indices[t * 3], m.indices[t * 3 + 1], m.indices[t * 3 + 2])
  return { positions: m.positions, indices: Uint32Array.from(kept) }
}

function random(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

async function load(file: string): Promise<Project> {
  const t0 = performance.now()
  const zip = unzipSync(readFileSync(file))
  const manifest = JSON.parse(strFromU8(zip['project.json']))
  const scanMember = manifest.scan.member as string
  const bytes = zip[scanMember]
  const parsed = scanMember.endsWith('.ply') ? parsePLY(bytes.slice().buffer) : parseSTL(bytes.slice().buffer)
  const graph = buildMeshGraph(parsed)
  // The applied alignment is not baked into the saved scan: it goes on as
  // the project opens (app/useProject), and the reference and the bodies
  // stand in the frame it makes.
  if (manifest.scan.appliedAlignment) rigidApplyToPoints(rigidFromJson(manifest.scan.appliedAlignment), graph.positions)
  const scan = { positions: graph.positions, indices: graph.indices, diag: graph.bboxDiag }
  const dev = manifest.deviation
  const tolerance = Number(process.env.VOL_T ?? dev?.tolerance ?? 0.1)
  const name = file.split(/[\\/]/).pop()!
  const refMember = dev?.reference?.member as string | undefined
  if (refMember && dev.align && process.env.VOL_BODIES !== '1') {
    if (!refMember.endsWith('.stl')) throw new Error(`${name}: reference ${refMember} not read by the bench`)
    const ref = buildMeshGraph(parseSTL(zip[refMember].slice().buffer))
    return { name, scan, reference: { positions: ref.positions, indices: ref.indices }, toReference: rigidFromJson(dev.align.transform), tolerance, source: `reference ${dev.reference.fileName}`, loadMs: performance.now() - t0 }
  }
  if (!manifest.reverse) throw new Error(`${name}: neither an aligned reference nor bodies`)
  // The bodies, built as reBench does and meshed as the comparison does.
  applyReversePart(manifest.reverse as ReversePart)
  const re = useReverse.getState()
  const steps = resolveFeatures(re.features, { sections: [], elements: [], modelCenter: [0, 0, 0] }, (f) => findRegions(f.sketch))
  const sketches = new Map(re.features.filter((f): f is SketchFeature => f.kind === 'sketch').map((f) => [f.id, f.sketch]))
  const builder = new Builder(await ReKernel.load())
  const out = builder.build(steps, (id) => sketches.get(id), true)
  const hidden = new Set(re.hiddenBodies)
  const bodies = out.bodies.filter((b) => !b.surface && !hidden.has(b.id))
  const meshes = builder.meshes(bodies.map((b) => b.id), COMPARE_CHORD_MM)
  builder.dispose()
  const reference = join(...meshes)
  // Which body and face each triangle lies on.
  const owner: string[] = []
  meshes.forEach((m, i) => {
    const b = bodies[i]
    for (let t = 0; t < m.indices.length / 3; t++) {
      const hash = m.faceHash?.[t]
      const face = b.topology.faces.findIndex((f) => f.hash === hash)
      owner.push(`${b.name} face ${face >= 0 ? face : '?'}${face >= 0 ? ` (${(b.topology.faces[face].fingerprint as { kind?: string }).kind ?? '?'})` : ''}`)
    }
  })
  const failed = out.results.filter((r) => r.status === 'failed').length
  return {
    name,
    scan,
    reference,
    toReference: identityRigid(),
    tolerance,
    source: `${bodies.length} bodies built (${failed} steps failed), meshed at ${COMPARE_CHORD_MM} mm`,
    loadMs: performance.now() - t0,
    label: (t) => owner[t] ?? '?',
  }
}

/** The reference triangles no scan stands behind, as the worker's map on
 *  the reference finds them: cut finer, read against the scan, and what
 *  was read as no scan kept (noScanPatchOf). */
function noScanPatch(reference: VolumeMesh, scan: NominalSurface, diag: number, toReference: Rigid, tolerance: number): { map: { samples: ReferenceSamples; values: Float32Array }; ms: number; area: number; share: number; spacing: number } {
  const t0 = performance.now()
  // The map for the patch alone need not be as fine as the user's: two
  // cells apart (VOL_MAP=fine reads at the map's own spacing).
  const area = meshArea(reference.positions, reference.indices)
  const box = [0, 1, 2].map((k) => {
    let lo = Infinity, hi = -Infinity
    for (let v = k; v < reference.positions.length; v += 3) {
      lo = Math.min(lo, reference.positions[v])
      hi = Math.max(hi, reference.positions[v])
    }
    return hi - lo
  })
  const wanted = process.env.VOL_MAP === 'fine' ? wantedSpacing(tolerance) : Math.max(wantedSpacing(tolerance), 2 * (cell ?? defaultCell(tolerance, Math.max(...box))))
  const spacing = sampleSpacing(area, wanted)
  const samples = subdivideForMap(reference.positions, reference.indices, null, spacing)
  const values = readReference(scan, samples, { toScan: rigidInvert(toReference), reach: diag * REFERENCE_REACH, facingDeg: DEFAULT_REFERENCE_FACING_DEG })
  const bare = noScanPatchOf(reference, samples, values)
  const offered = meshArea(bare.positions, bare.indices)
  return { map: { samples, values }, ms: performance.now() - t0, area: offered, share: offered / meshArea(samples.positions, samples.indices), spacing }
}

interface Plant {
  what: string
  kind: 'excess' | 'missing'
  box: { min: Vec3; max: Vec3 }
  /** Its volume the run should find, mm³: in the box and on the wrong
   *  side of the reference — and that farther than T from the scan's
   *  surface. */
  expected: number
  expectedRaw: number
}

/** Volume of the points in `box` that `keep` takes, by sampling. */
function sampleVolume(box: { min: Vec3; max: Vec3 }, keep: (x: number, y: number, z: number) => boolean, n = 40000): number {
  const rnd = random(99)
  let k = 0
  for (let i = 0; i < n; i++) {
    const x = box.min[0] + rnd() * (box.max[0] - box.min[0])
    const y = box.min[1] + rnd() * (box.max[1] - box.min[1])
    const z = box.min[2] + rnd() * (box.max[2] - box.min[2])
    if (keep(x, y, z)) k++
  }
  return ((box.max[0] - box.min[0]) * (box.max[1] - box.min[1]) * (box.max[2] - box.min[2]) * k) / n
}

/** Where the planted errors go: on flat stretches of the reference facing
 *  along an axis that the scan stands on — an error where nothing was
 *  scanned cannot be told, and is no test — apart from each other. */
function placePlants(p: Project, refTree: WindingTree, seed: number, avoid: { min: Vec3; max: Vec3 }[], floor: number, scanned: (x: number, y: number, z: number) => boolean): { missing: { box: { min: Vec3; max: Vec3 } }; excess: { box: { min: Vec3; max: Vec3 } }; hole: { centre: Vec3; axis: number; a: number; b: number; radius: number } } {
  const { positions: P, indices: I } = p.reference
  const inside = (x: number, y: number, z: number) => refTree.at(x, y, z) > 0.5
  const rnd = random(seed)
  // Candidates: triangle centroids, by area, facing within 8° of an axis.
  const tris: { c: Vec3; axis: number; dir: number; area: number }[] = []
  for (let t = 0; t < I.length / 3; t++) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3
    const u = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]]
    const v = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]]
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    const len = Math.hypot(n[0], n[1], n[2])
    if (len === 0) continue
    const axis = [0, 1, 2].reduce((m, k) => (Math.abs(n[k]) > Math.abs(n[m]) ? k : m), 0)
    if (Math.abs(n[axis]) / len < Math.cos((8 * Math.PI) / 180)) continue
    tris.push({ c: [0, 1, 2].map((k) => (P[a + k] + P[b + k] + P[c + k]) / 3) as Vec3, axis, dir: Math.sign(n[axis]), area: len / 2 })
  }
  const total = tris.reduce((s, x) => s + x.area, 0)
  const pick = () => {
    let r = rnd() * total
    for (const t of tris) if ((r -= t.area) <= 0) return t
    return tris[tris.length - 1]
  }
  const taken: Vec3[] = []
  // Apart from each other, from what the run as is found, and above the
  // floor the open-scan stress cuts away.
  // Clear of those by 12 mm, or where nothing is, by less.
  let clearance = 12
  const clear = (c: Vec3, b: { min: Vec3; max: Vec3 }) => Math.hypot(...([0, 1, 2].map((k) => Math.max(b.min[k] - c[k], 0, c[k] - b.max[k])) as Vec3)) > clearance
  let spread = 30
  let above = 10
  const apart = (c: Vec3) => taken.every((q) => Math.hypot(c[0] - q[0], c[1] - q[1], c[2] - q[2]) > spread) && (clearance < 0 || avoid.every((b) => clear(c, b))) && c[2] > floor + above
  // A box w × d across the face, sunk `sink` into it and standing `up` off it:
  // its foot `sink` in must be material all over.
  const boxAt = (t: (typeof tris)[number], w: number, d: number, sink: number, up: number) => {
    const u = (t.axis + 1) % 3, v = (t.axis + 2) % 3
    const min = [0, 0, 0] as Vec3, max = [0, 0, 0] as Vec3
    min[u] = t.c[u] - w / 2
    max[u] = t.c[u] + w / 2
    min[v] = t.c[v] - d / 2
    max[v] = t.c[v] + d / 2
    const s = t.c[t.axis]
    min[t.axis] = t.dir > 0 ? s - sink : s - up
    max[t.axis] = t.dir > 0 ? s + up : s + sink
    const foot = s - t.dir * sink * 0.5
    for (let i = 0; i <= 4; i++) {
      for (let j = 0; j <= 4; j++) {
        const q = [0, 0, 0]
        q[t.axis] = s
        q[u] = min[u] + (i / 4) * w
        q[v] = min[v] + (j / 4) * d
        if (!scanned(q[0], q[1], q[2])) return null
      }
    }
    for (let i = 0; i <= 4; i++) {
      for (let j = 0; j <= 4; j++) {
        const q = [0, 0, 0]
        q[t.axis] = foot
        q[u] = min[u] + (i / 4) * w
        q[v] = min[v] + (j / 4) * d
        if (!inside(q[0], q[1], q[2])) return null
      }
    }
    // Nothing of the part above it: the box stands in air.
    for (let i = 0; i <= 4; i++) {
      for (let j = 0; j <= 4; j++) {
        const q = [0, 0, 0]
        q[u] = min[u] + (i / 4) * w
        q[v] = min[v] + (j / 4) * d
        for (let k = 1; k <= 4; k++) {
          q[t.axis] = s + t.dir * ((k / 4) * (up + 1))
          if (inside(q[0], q[1], q[2])) return null
        }
      }
    }
    return { min, max }
  }
  // Tried at full size clear of the regions by 12 mm, then 6, then 3, then
  // smaller, for a thin part.
  // Clearance, scale, spread between plants, height above the floor.
  const tiers = [[12, 1, 30, 10], [6, 1, 30, 10], [3, 1, 30, 10], [3, 0.7, 30, 10], [3, 0.5, 30, 10], [-1, 0.7, 20, 2], [-1, 0.5, 15, 2]]
  const find = <T,>(name: string, make: (t: (typeof tris)[number], scale: number) => T | null): T => {
    for (let tries = 0; tries < tiers.length * 8000; tries++) {
      const [c, scale, sp, ab] = tiers[Math.floor(tries / 8000)]
      clearance = c
      spread = sp
      above = ab
      const t = pick()
      if (!apart(t.c)) continue
      const made = make(t, scale)
      if (made) {
        taken.push(t.c)
        return made
      }
    }
    throw new Error(`no place for the planted ${name}`)
  }
  const missing = find('missing box', (t, k) => {
    const box = boxAt(t, 15 * k, 10 * k, 1, 7 * k)
    return box && { box }
  })
  const excess = find('excess box', (t, k) => {
    const box = boxAt(t, 10 * k, 8 * k, 1, 5 * k)
    return box && { box }
  })
  // The hole: into the material from a face along its axis, through it and
  // out, or 10 mm deep; 6 mm across, all of it in material round its foot.
  const hole = find('hole', (t, k) => {
    const u = (t.axis + 1) % 3, v = (t.axis + 2) % 3
    const s = t.c[t.axis]
    if (!scanned(t.c[0], t.c[1], t.c[2])) return null
    let depth = 0
    for (let k = 1; k <= 100; k++) {
      const q = [...t.c]
      q[t.axis] = s - t.dir * k * 0.1
      if (!inside(q[0], q[1], q[2])) break
      depth = k * 0.1
    }
    if (depth < 1) return null
    for (let r = 0; r < 8; r++) {
      const q = [...t.c]
      q[u] += (3 * k + 1.5) * Math.cos((r * Math.PI) / 4)
      q[v] += (3 * k + 1.5) * Math.sin((r * Math.PI) / 4)
      q[t.axis] = s - t.dir * Math.min(depth, 1) * 0.5
      if (!inside(q[0], q[1], q[2])) return null
    }
    const through = depth < 10
    const end = s - t.dir * (through ? depth + 2 : 10)
    const start = s + t.dir * 2
    return { centre: t.c, axis: t.axis, a: Math.min(start, end), b: Math.max(start, end), radius: 3 * k }
  })
  return { missing, excess, hole }
}

interface Case {
  label: string
  scan: VolumeMesh
  reference: VolumeMesh
  patch: boolean
  /** Which of the patch is taken (see volumeDeviation); 'rims' by default. */
  patchRule?: 'rims' | 'open' | 'all'
  /** The scan's open rims walked round, kept between runs on the same scan
   *  as the worker keeps them. */
  rims?: RimLoop[]
  plants: Plant[]
  /** The run as is, its volumes counted in the plants' boxes: what was
   *  there before they were planted. */
  before?: Record<'excess' | 'missing' | 'unsure', number>[]
  /** The scan as it stands, its surface built — kept between runs on the
   *  same scan. */
  surface?: NominalSurface
  tree?: WindingTree
}

function fmt(v: number, d = 1): string {
  return Number.isFinite(v) ? v.toFixed(d) : String(v)
}

function dims(b: { min: Vec3; max: Vec3 }): string {
  return [0, 1, 2].map((k) => fmt(b.max[k] - b.min[k], 1)).join(' × ')
}

function v3(v: Vec3): string {
  return `(${v.map((x) => x.toFixed(1)).join(', ')})`
}

function report(p: Project, c: Case, r: VolumeDeviation, patchInfo: { ms: number; area: number; share: number; spacing: number } | null, memory: number): void {
  say(`\n--- ${p.name} — ${c.label}`)
  const t = r.timings
  say(`cell ${fmt(r.cell, 3)} mm (sees ${fmt(r.smallestSeen, 2)} mm and thicker), grid ${r.grid.dims.join(' × ')} = ${(r.grid.dims[0] * r.grid.dims[1] * r.grid.dims[2] / 1e6).toFixed(2)}M cells, scan sign ${r.scanSign}`)
  say(`queries coarse ${r.queries.coarse}, fine ${r.queries.fine}`)
  say(`ms: tree ${fmt(t.tree, 0)}, surface ${fmt(t.surface, 0)}, model ${fmt(t.model, 0)}, patch offered ${fmt(t.offered, 0)}, coarse w ${fmt(t.coarse, 0)}, patch kept + its tree + its coarse w ${fmt(t.patch, 0)}, fine w ${fmt(t.fine, 0)}, band ${fmt(t.band, 0)}, components ${fmt(t.components, 0)}, depth ${fmt(t.depth, 0)} — total ${fmt(t.total, 0)}${patchInfo ? `; the patch (outside: a map ${patchInfo.spacing} mm apart) ${fmt(patchInfo.ms, 0)}` : ''}`)
  say(`memory: grids and trees ${fmt(r.bytes / 2 ** 20, 0)} MB; heap+external grew ${fmt(memory / 2 ** 20, 0)} MB over the run; process peak so far ${fmt(peak() / 2 ** 20, 0)} MB`)
  if (c.patch) say(`patch: ${patchInfo ? `the map reads ${fmt(patchInfo.area, 0)} mm² = ${fmt(patchInfo.share * 100, 1)} % of the reference as no scan; ` : 'no map; '}offered with the reference far from the scan ${fmt(r.patch.offeredArea, 0)} mm²; ${c.patchRule === 'all' ? 'all kept' : `kept where the scan has a hole (${r.patch.rimsOpen} of ${r.patch.rimsProbed} rim probes open; patch cells ${r.patch.cells}, on its border ${r.patch.border}, of them along open rims ${r.patch.borderAlongRims}, kept ${r.patch.keptCells})`}: ${r.patch.kept} of ${r.patch.offered} triangles, ${fmt(r.patch.area, 0)} mm²`)
  say(`model ${fmt(r.modelVolume, 0)} mm³; excess ${fmt(r.totals.excess.volume, 1)} mm³ (${fmt(r.totals.excess.share, 2)} %), missing ${fmt(r.totals.missing.volume, 1)} mm³ (${fmt(r.totals.missing.share, 2)} %), unsure ${fmt(r.totals.unsure.volume, 1)} mm³ (${fmt(r.totals.unsure.share, 2)} %); specks under ${MIN_REGION_CELLS} cells ${fmt(r.specks, 1)} mm³; ${r.regions.length} regions`)
  const planted = new Set<VolumeRegion>()
  c.plants.forEach((pl, i) => {
    const g = r.cell
    const hits = r.regions.filter(
      (x) => x.kind === pl.kind && [0, 1, 2].every((k) => x.box.min[k] <= pl.box.max[k] + g && x.box.max[k] >= pl.box.min[k] - g) && [0, 1, 2].every((k) => x.deepest[k] >= pl.box.min[k] - g && x.deepest[k] <= pl.box.max[k] + g),
    )
    for (const h of hits) planted.add(h)
    const inBox = r.counted[i][pl.kind] - (c.before?.[i][pl.kind] ?? 0)
    const other = (['excess', 'missing', 'unsure'] as const).filter((k) => k !== pl.kind).map((k) => `${k} ${fmt(r.counted[i][k] - (c.before?.[i][k] ?? 0), 1)}`).join(', ')
    say(`planted ${pl.what}: expected ${fmt(pl.expected, 1)} mm³ (${fmt(pl.expectedRaw, 1)} before the band); in its box ${fmt(inBox, 1)} mm³ more ${pl.kind} than as is = ${fmt((100 * inBox) / pl.expected, 0)} % (and ${other}); the regions it is in hold ${fmt(hits.reduce((s, x) => s + x.volume, 0), 1)} mm³`)
  })
  const bar = Math.max(50, 0.002 * r.modelVolume)
  const stray = r.regions.filter((x) => x.kind !== 'unsure' && !planted.has(x) && x.volume > bar)
  say(`not planted, over max(50 mm³, 0.2 %) = ${fmt(bar, 0)} mm³: ${stray.length}${stray.length ? ` (${stray.map((x) => `${x.kind} ${fmt(x.volume, 0)}`).join(', ')})` : ''}`)
  say(`  kind     volume mm³  maxDepth  thick   evid  conf  deepest                     box`)
  for (const x of r.regions.slice(0, 8)) {
    say(
      `  ${x.kind.padEnd(8)} ${fmt(x.volume, 1).padStart(10)} ${fmt(x.maxDepth, 2).padStart(9)} ${fmt(x.thickness, 2).padStart(6)} ${fmt(x.evidence, 2).padStart(6)} ${fmt(x.confidence, 2).padStart(5)}  ${v3(x.deepest).padEnd(26)}  ${v3(x.box.min)}–${v3(x.box.max)}${planted.has(x) ? '  [planted]' : ''}${p.label && x.referenceTriangle >= 0 ? `  on ${p.label(x.referenceTriangle)}` : ''}`,
    )
  }
}

/** The most the process has held so far, bytes (Node's maxRSS is in kB). */
function peak(): number {
  return process.resourceUsage().maxRSS * 1024
}

function heap(): number {
  const m = process.memoryUsage()
  return m.heapUsed + m.external + m.arrayBuffers
}

function run(p: Project, c: Case): VolumeDeviation {
  const before = heap()
  const surface = c.surface ?? new NominalSurface(c.scan.positions, c.scan.indices)
  c.surface = surface
  if (!c.rims) {
    const t0 = performance.now()
    c.rims = rimLoops(c.scan.indices)
    say(`(the scan's rims walked round: ${c.rims.length} loops in ${fmt(performance.now() - t0, 0)} ms — the worker keeps them)`)
  }
  let patchInfo: { ms: number; area: number; share: number; spacing: number } | null = null
  let map: { samples: ReferenceSamples; values: Float32Array } | undefined
  if (c.patch && process.env.VOL_MAP !== 'none') {
    const made = noScanPatch(c.reference, surface, p.scan.diag, p.toReference, p.tolerance)
    map = made.map
    patchInfo = made
  }
  const r = volumeDeviation({ reference: c.reference, scan: c.scan, toReference: p.toReference, referenceMap: map, farPatch: c.patch, patchRule: c.patchRule, scanRims: c.rims, count: c.plants.map((x) => x.box), tolerance: p.tolerance, scanSurface: surface, scanTree: c.tree, beta, cell })
  report(p, c, r, patchInfo, heap() - before)
  // What deviation.volume answers with its defaults, for the guide's
  // reply-cost table.
  const answer = JSON.stringify(volumeOut(r, p.tolerance, VOLUME_REGIONS))
  say(`deviation.volume answer, defaults: ${answer.length} bytes ≈ ${Math.round(answer.length / 4)} tokens`)
  return r
}

describe.skipIf(files.length === 0)('volume deviation bench', () => {
  for (const file of files) {
    it(file, async () => {
      const p = await load(file)
      const tris = p.scan.indices.length / 3
      say(`\n=== ${p.name}: scan ${tris} triangles, reference ${p.reference.indices.length / 3} triangles (${p.source}), T = ${p.tolerance} mm, loaded in ${fmt(p.loadMs / 1000, 1)} s`)
      const t0 = performance.now()
      const surface = new NominalSurface(p.scan.positions, p.scan.indices)
      const surfaceMs = performance.now() - t0
      const t1 = performance.now()
      const tree = new WindingTree(p.scan.positions, p.scan.indices, { beta: beta ?? DEFAULT_VOLUME_BETA })
      const treeMs = performance.now() - t1
      say(`scan surface (the worker keeps it) ${fmt(surfaceMs, 0)} ms; scan winding tree ${fmt(treeMs, 0)} ms, ${fmt(tree.bytes / 2 ** 20, 0)} MB`)
      const only = process.env.VOL_RUNS?.split(',')

      const want = (k: string) => !only || only.includes(k)
      const asIs = run(p, { label: '1. as is, with the patch where the scan has a hole', scan: p.scan, reference: p.reference, patch: true, plants: [], surface, tree })
      if (want('nopatch')) run(p, { label: '2. no patch', scan: p.scan, reference: p.reference, patch: false, plants: [], surface, tree })
      if (only && only.every((k) => k === 'asis' || k === 'nopatch')) return

      // Planted errors, away from what the run as is found.
      const refTree = new WindingTree(p.reference.positions, p.reference.indices)
      const inRef = (x: number, y: number, z: number) => refTree.at(x, y, z) > 0.5
      const scanP = p.scan
      const zs = new Float64Array(3)
      let zmin = Infinity, zmax = -Infinity
      for (let v = 0; v < scanP.positions.length; v += 3) {
        rigidApply(p.toReference, scanP.positions[v], scanP.positions[v + 1], scanP.positions[v + 2], zs)
        zmin = Math.min(zmin, zs[2])
        zmax = Math.max(zmax, zs[2])
      }
      const floor = zmin + 0.05 * (zmax - zmin)
      const avoid = asIs.regions.filter((x) => x.volume > 10).map((x) => x.box)
      const onScan = emptyHit()
      const sq = new Float64Array(3)
      const toScanFrame = rigidInvert(p.toReference)
      const scanned = (x: number, y: number, z: number) => {
        rigidApply(toScanFrame, x, y, z, sq)
        return surface.closest(sq[0], sq[1], sq[2], onScan, 0.5) && onScan.distance <= 0.5
      }
      const where = placePlants(p, refTree, 1, avoid, floor, scanned)
      const toScan = rigidInvert(p.toReference)
      const inScanFrame = (m: VolumeMesh): VolumeMesh => {
        const positions = m.positions.slice()
        rigidApplyToPoints(toScan, positions)
        return { positions, indices: m.indices }
      }
      const T = p.tolerance
      const fromFaces = (box: { min: Vec3; max: Vec3 }, x: number, y: number, z: number) =>
        Math.min(x - box.min[0], box.max[0] - x, y - box.min[1], box.max[1] - y, z - box.min[2], box.max[2] - z)
      const sp = new Float64Array(3)
      const hit = emptyHit()
      const missingBox = where.missing.box
      const excessBox = where.excess.box
      const hole = where.hole
      const radius = hole.radius
      const inHole = (q: ArrayLike<number>) => {
        const u = (hole.axis + 1) % 3, v = (hole.axis + 2) % 3
        return q[hole.axis] >= hole.a && q[hole.axis] <= hole.b && Math.hypot(q[u] - hole.centre[u], q[v] - hole.centre[v]) <= radius
      }
      const holeBox = (() => {
        const min = [...hole.centre] as Vec3, max = [...hole.centre] as Vec3
        for (let k = 0; k < 3; k++) {
          if (k === hole.axis) {
            min[k] = hole.a
            max[k] = hole.b
          } else {
            min[k] -= radius
            max[k] += radius
          }
        }
        return { min, max }
      })()
      const plants: Plant[] = [
        {
          what: `missing: a ${dims(missingBox)} box on the scan at ${v3(missingBox.min)}`,
          kind: 'missing',
          box: missingBox,
          expectedRaw: sampleVolume(missingBox, (x, y, z) => !inRef(x, y, z)),
          expected: sampleVolume(missingBox, (x, y, z) => !inRef(x, y, z) && fromFaces(missingBox, x, y, z) > T),
        },
        {
          what: `excess: a ${dims(excessBox)} box on the reference at ${v3(excessBox.min)}`,
          kind: 'excess',
          box: excessBox,
          expectedRaw: sampleVolume(excessBox, (x, y, z) => !inRef(x, y, z)),
          // Outside the reference and farther than T from the scan.
          expected: sampleVolume(excessBox, (x, y, z) => {
            if (inRef(x, y, z)) return false
            rigidApply(toScan, x, y, z, sp)
            return !(surface.closest(sp[0], sp[1], sp[2], hit, T) && hit.distance <= T)
          }, 20000),
        },
        {
          what: `excess: a Ø${fmt(2 * radius, 1)} hole the part has and the reference not, axis ${'xyz'[hole.axis]} through ${v3(hole.centre)}`,
          kind: 'excess',
          box: holeBox,
          expectedRaw: sampleVolume(holeBox, (x, y, z) => inHole([x, y, z]) && inRef(x, y, z)),
          expected: sampleVolume(holeBox, (x, y, z) => {
            if (!inHole([x, y, z]) || !inRef(x, y, z)) return false
            const u = (hole.axis + 1) % 3, v = (hole.axis + 2) % 3
            const q = [x, y, z]
            return radius - Math.hypot(q[u] - hole.centre[u], q[v] - hole.centre[v]) > T
          }),
        },
      ]
      // The scan with the box joined on and the hole cut: the triangles in
      // the hole dropped, its wall added wound inward.
      const cut = without(scanP, (t) => {
        const q = new Float64Array(3)
        const c = [0, 1, 2].map((k) => (scanP.positions[scanP.indices[t * 3] * 3 + k] + scanP.positions[scanP.indices[t * 3 + 1] * 3 + k] + scanP.positions[scanP.indices[t * 3 + 2] * 3 + k]) / 3)
        rigidApply(p.toReference, c[0], c[1], c[2], q)
        return inHole(q)
      })
      const plantedScan = join(cut, inScanFrame(boxShell(missingBox.min, missingBox.max)), inScanFrame(cylinderShell(hole.centre, hole.axis, hole.a, hole.b, radius, true)))
      const plantedRef = join(p.reference, boxShell(excessBox.min, excessBox.max))
      // What the run as is had in the plants' boxes, with the patch as it
      // takes it and with none.
      const counts = (patch: boolean) =>
        volumeDeviation({ reference: p.reference, scan: p.scan, toReference: p.toReference, referenceMap: patch && process.env.VOL_MAP !== 'none' ? noScanPatch(p.reference, surface, p.scan.diag, p.toReference, T).map : undefined, farPatch: patch, scanRims: rimLoops(p.scan.indices), tolerance: T, scanSurface: surface, scanTree: tree, beta, cell, count: plants.map((x) => x.box) }).counted
      const before = counts(true)
      const beforeBare = want('opennopatch') ? counts(false) : undefined
      say(`
as is, in the plants' boxes: ${before.map((b, i) => `${plants[i].kind} ${fmt(b[plants[i].kind], 1)} mm³`).join('; ')}`)
      const plantedCase: Case = { label: '3. planted errors, with the patch where the scan has a hole', scan: plantedScan, reference: plantedRef, patch: true, plants, before }
      if (want('planted')) run(p, plantedCase)
      if (want('plantedall')) run(p, { ...plantedCase, label: "3b. planted errors, with all the patch (the plan's first rule)", patchRule: 'all', surface: plantedCase.surface, rims: plantedCase.rims })

      // The scan opened up: its bottom 5 % of height in the reference's
      // frame and three discs 10 mm across cut away, away from the plants.
      const rnd = random(5)
      const plantCentres = [missingBox, excessBox, holeBox].map((b) => [0, 1, 2].map((k) => (b.min[k] + b.max[k]) / 2))
      const discs: number[][] = []
      // Clear of the plants and of each other; on a small part, less so.
      for (let tries = 0; discs.length < 3 && tries < 200000; tries++) {
        const loose = tries < 100000 ? 1 : 0.5
        const v = Math.floor(rnd() * (scanP.positions.length / 3)) * 3
        rigidApply(p.toReference, scanP.positions[v], scanP.positions[v + 1], scanP.positions[v + 2], zs)
        const c = [zs[0], zs[1], zs[2]]
        if (c[2] < floor + 5 * loose) continue
        if (plantCentres.some((q) => Math.hypot(c[0] - q[0], c[1] - q[1], c[2] - q[2]) < 20 * loose)) continue
        if (discs.some((q) => Math.hypot(c[0] - q[0], c[1] - q[1], c[2] - q[2]) < 15 * loose)) continue
        discs.push(c)
      }
      const q = new Float64Array(3)
      const opened = without(cut, (t) => {
        const c = [0, 1, 2].map((k) => (cut.positions[cut.indices[t * 3] * 3 + k] + cut.positions[cut.indices[t * 3 + 1] * 3 + k] + cut.positions[cut.indices[t * 3 + 2] * 3 + k]) / 3)
        rigidApply(p.toReference, c[0], c[1], c[2], q)
        return q[2] < floor || discs.some((d) => Math.hypot(q[0] - d[0], q[1] - d[1], q[2] - d[2]) < 5)
      })
      say(`\nopen-scan stress: below z ${fmt(floor, 1)} and discs at ${discs.map((d) => v3(d as Vec3)).join(', ')} cut away: ${opened.indices.length / 3} of ${cut.indices.length / 3} triangles left`)
      const openScan = join(opened, inScanFrame(boxShell(missingBox.min, missingBox.max)), inScanFrame(cylinderShell(hole.centre, hole.axis, hole.a, hole.b, radius, true)))
      const openCase: Case = { label: '4. scan opened up + planted, with the patch where the scan has a hole', scan: openScan, reference: plantedRef, patch: true, plants, before }
      if (want('open')) run(p, openCase)
      if (want('openall')) run(p, { ...openCase, label: "4b. scan opened up + planted, with all the patch (the plan's first rule)", patchRule: 'all', surface: openCase.surface, rims: openCase.rims })
      if (want('opennopatch')) run(p, { ...openCase, label: '5. scan opened up + planted, no patch', patch: false, before: beforeBare, surface: openCase.surface, rims: openCase.rims })
    }, 3_600_000)
  }
})
