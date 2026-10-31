// SPDX-License-Identifier: AGPL-3.0-only
// What a step that leaves a body in pieces says, and what a cut by a plane
// that takes the whole body says: which piece kept the body's id and which
// are new, with where each lies — and, for a cut that leaves nothing, which
// side the body lies on and the pieces of it elsewhere that the cut could
// have meant. A feature after a split that names the body works on the
// piece that kept the id alone; one that names the wrong piece finds it
// out here rather than as "no closed solid".

import type { Vec3 } from '../../../src/core/types'
import type { KernelBounds } from './kernelTypes'

/** Two pieces within this share of the larger's volume are the same size:
 *  the id goes to the one nearest where the body stood (Builder.settle),
 *  not to whichever the kernel listed first. */
export const SPLIT_TIE = 0.01

/** A piece of a body as the words name it. */
export interface PieceSaid {
  id: number
  volume: number
  bounds: KernelBounds
}

const AXES = ['x', 'y', 'z'] as const
const r2 = (v: number) => Math.round(v * 100) / 100 + 0
const at2 = (p: Vec3) => `(${p.map(r2).join(', ')})`

/** The world axis a direction runs along, or −1. */
function axisOf(dir: Vec3): number {
  return dir.findIndex((v) => Math.abs(v) > 1 - 1e-9)
}

/** A box in words: "x 57.26…59.26, y -8.5…8.5, z 4…9.8". */
export function boxWords(b: KernelBounds): string {
  return AXES.map((a, i) => `${a} ${r2(b.min[i])}…${r2(b.max[i])}`).join(', ')
}

/** Where a plane is: "at z 9.8", or through a point square to a direction. */
export function planeWords(origin: Vec3, normal: Vec3): string {
  const i = axisOf(normal)
  return i >= 0 ? `at ${AXES[i]} ${r2(origin[i])}` : `through ${at2(origin)} square to ${at2(normal)}`
}

/** The side of a plane a direction points to: "x > -50". */
export function sideWords(origin: Vec3, dir: Vec3): string {
  const i = axisOf(dir)
  return i >= 0 ? `${AXES[i]} ${dir[i] > 0 ? '>' : '<'} ${r2(origin[i])}` : `the side ${at2(dir)} points to, from the plane through ${at2(origin)}`
}

/** How a box lies to a plane, along `away` (the side cut away): wholly
 *  on the side cut away, wholly on the side kept, or across. */
export function sideOfBox(b: KernelBounds, origin: Vec3, away: Vec3): 'away' | 'kept' | 'across' {
  let lo = Infinity
  let hi = -Infinity
  for (let c = 0; c < 8; c++) {
    const p: Vec3 = [c & 1 ? b.max[0] : b.min[0], c & 2 ? b.max[1] : b.min[1], c & 4 ? b.max[2] : b.min[2]]
    const d = (p[0] - origin[0]) * away[0] + (p[1] - origin[1]) * away[1] + (p[2] - origin[2]) * away[2]
    lo = Math.min(lo, d)
    hi = Math.max(hi, d)
  }
  return lo >= -1e-6 ? 'away' : hi <= 1e-6 ? 'kept' : 'across'
}

// units-ok: build message, also the agent's answer.
const pieceWords = (p: PieceSaid) => `${boxWords(p.bounds)}; ${Number(p.volume.toPrecision(5))} mm³`

/**
 * A step that left a body in pieces, in a sentence: `what` ("The cut at z
 * 9.8"), the body's name, the piece that kept the id, and the others —
 * each new (`fresh`) or a piece the body had before, given its id again.
 * Where a new piece is the same size as the one that kept the id, says the
 * id went by where the body stood.
 */
export function splitWords(what: string, name: string, kept: PieceSaid, others: readonly { piece: PieceSaid; fresh: boolean }[]): string {
  const n = others.length + 1
  const tie = others.some((o) => o.fresh && Math.abs(o.piece.volume - kept.volume) <= SPLIT_TIE * Math.max(o.piece.volume, kept.volume))
  const rest = others.map((o) => `${o.piece.id} ${o.fresh ? 'is new' : 'keeps its own'} (${pieceWords(o.piece)})`)
  return `${what} left ${name} as ${n === 2 ? 'two' : n} bodies: ${kept.id} keeps the id (${pieceWords(kept)}); ${rest.join('; ')}${tie ? ' — the two the same size within 1 %, so the id stays with the piece nearest where the body stood' : ''}. A feature naming ${kept.id} from here works on that piece alone (a Combine naming it takes them all).`
}

/**
 * A cut by a plane that leaves nothing of its body, in a sentence: the body
 * and where it lies, the side cut away, and — where the body has pieces
 * split off it (`family`, each with how it lies to the plane, and `since`,
 * the steps that split them) — each piece, and the ones the cut would take
 * something of: "cut 85, or keep +1".
 */
export function takesAllWords(name: string, body: PieceSaid, origin: Vec3, away: Vec3, keep: number, family: readonly { piece: PieceSaid; side: 'away' | 'kept' | 'across' }[], since: string): string {
  const flip = keep > 0 ? '-1' : '+1'
  const head = `The cut takes all of ${name} (body ${body.id}, ${boxWords(body.bounds)}): it lies wholly on the side cut away (${sideWords(origin, away)})`
  if (family.length === 0) return `${head} — keep ${flip} keeps all of it, or move the plane.`
  const i = axisOf(away)
  const where = (p: PieceSaid) => (i >= 0 ? `${AXES[i]} ${r2(p.bounds.min[i])}…${r2(p.bounds.max[i])}` : boxWords(p.bounds))
  const sideSaid = { away: 'wholly on the side cut away', kept: 'on the side kept', across: 'across the plane' }
  const all = [{ piece: body, side: 'away' as const }, ...family]
  const meant = family.filter((f) => f.side !== 'away').map((f) => f.piece.id)
  const n = all.length
  return `${head}. Since ${since} it is ${n === 2 ? 'two' : n} bodies: ${all.map((f) => `${f.piece.id} at ${where(f.piece)} (${sideSaid[f.side]})`).join(', ')} — ${meant.length > 0 ? `cut ${meant.join(' or ')}, or ` : ''}keep ${flip}.`
}
