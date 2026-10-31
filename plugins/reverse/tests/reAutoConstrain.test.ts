// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { COINCIDENCE_MM, constrainCylinder, constrainPlane, fitCylinderFree, relationWords, type ConstrainRef } from '../core/autoConstrain'
import type { Vec3 } from '../../../src/core/types'
import { cross, dot, normalize } from '../../../src/core/vec'
import { gaussian } from '../../../tests/helpers'

function mulberry(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rad = (deg: number) => (deg * Math.PI) / 180
const angleDeg = (a: Vec3, b: Vec3) => (Math.acos(Math.min(1, Math.abs(dot(a, b)))) * 180) / Math.PI

/** A 40 × 30 mm patch of a plane through `origin` with the given normal,
 *  with scatter along the normal. */
function planePatch(origin: Vec3, normal: Vec3, noise = 0.02, seed = 3): Float32Array {
  const rand = mulberry(seed)
  const n = normalize(normal)!
  const u = normalize(cross(n, Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]))!
  const v = cross(n, u)
  const out: number[] = []
  for (let i = 0; i <= 40; i++) {
    for (let j = 0; j <= 30; j++) {
      const a = i - 20, b = j - 15, e = gaussian(rand) * noise
      out.push(origin[0] + a * u[0] + b * v[0] + e * n[0], origin[1] + a * u[1] + b * v[1] + e * n[1], origin[2] + a * u[2] + b * v[2] + e * n[2])
    }
  }
  return new Float32Array(out)
}

/** A patch of a cylinder: `span` degrees round, 30 mm long. */
function cylinderPatch(origin: Vec3, axis: Vec3, radius: number, span = 120, noise = 0.02, seed = 5): Float32Array {
  const rand = mulberry(seed)
  const d = normalize(axis)!
  const u = normalize(cross(d, Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]))!
  const v = cross(d, u)
  const out: number[] = []
  for (let i = 0; i <= 60; i++) {
    for (let j = 0; j <= 30; j++) {
      const a = rad((i / 60) * span), t = j - 15, r = radius + gaussian(rand) * noise
      out.push(
        origin[0] + t * d[0] + r * (Math.cos(a) * u[0] + Math.sin(a) * v[0]),
        origin[1] + t * d[1] + r * (Math.cos(a) * u[1] + Math.sin(a) * v[1]),
        origin[2] + t * d[2] + r * (Math.cos(a) * u[2] + Math.sin(a) * v[2]),
      )
    }
  }
  return new Float32Array(out)
}

const XY: ConstrainRef = { key: 'datum:xy', kind: 'plane', name: 'XY plane', origin: [0, 0, 0], normal: [0, 0, 1] }
const YZ: ConstrainRef = { key: 'datum:yz', kind: 'plane', name: 'YZ plane', origin: [0, 0, 0], normal: [1, 0, 0] }
const ZX: ConstrainRef = { key: 'datum:zx', kind: 'plane', name: 'ZX plane', origin: [0, 0, 0], normal: [0, 1, 0] }
const DATUMS = [XY, YZ, ZX]

describe('Auto Constrain: a plane', () => {
  it('a top face 0.3° off level is made level, at the points’ mean height', () => {
    const tilted: Vec3 = [Math.sin(rad(0.3)), 0, Math.cos(rad(0.3))]
    const fit = constrainPlane(planePatch([5, 5, 12], tilted), DATUMS, { mode: 'auto' })!
    expect(fit.normal).toEqual([0, 0, 1])
    expect(fit.origin[2]).toBeCloseTo(12, 2)
    expect(fit.relations).toHaveLength(1)
    expect(fit.relations[0]).toMatchObject({ relation: 'along', ref: 'datum:xy' })
    expect(fit.relations[0].tiltDeg).toBeCloseTo(0.3, 1)
    // Holding it costs what the tilt was over the patch, and no more.
    expect(fit.rms).toBeGreaterThan(fit.rmsFree)
    expect(fit.rms).toBeLessThan(0.1)
  })

  it('keeps the way the free normal faced', () => {
    const fit = constrainPlane(planePatch([0, 0, -8], [0.002, 0, -1]), DATUMS, { mode: 'auto' })!
    // The eigenvector's sign is arbitrary; whichever it was, the held normal
    // is the datum's or its opposite, never something between.
    expect(Math.abs(fit.normal[2])).toBe(1)
  })

  it('a face 2° off is left as fitted', () => {
    // Tilted towards neither axis: leaning along X alone it would still be
    // square to the ZX plane, and rightly held so.
    const tilted: Vec3 = [Math.sin(rad(2)) * Math.cos(rad(40)), Math.sin(rad(2)) * Math.sin(rad(40)), Math.cos(rad(2))]
    const fit = constrainPlane(planePatch([0, 0, 12], tilted), DATUMS, { mode: 'auto' })!
    expect(fit.relations).toEqual([])
    expect(angleDeg(fit.normal, tilted)).toBeLessThan(0.05)
    expect(fit.rms).toBe(fit.rmsFree)
  })

  it('within a millimetre of a parallel reference plane it is that plane', () => {
    const floor: ConstrainRef = { key: 'element:4', kind: 'plane', name: 'Plane 4', origin: [0, 0, 12.4], normal: [0, 0, 1] }
    const fit = constrainPlane(planePatch([60, 0, 12], [0.003, 0, 1]), [floor], { mode: 'auto' })!
    expect(fit.relations[0]).toMatchObject({ relation: 'on', ref: 'element:4' })
    expect(fit.relations[0].shiftMm).toBeCloseTo(0.4, 1)
    expect(fit.origin[2]).toBeCloseTo(12.4, 6)
    // Further than that it is parallel only.
    const apart = constrainPlane(planePatch([60, 0, 12 - COINCIDENCE_MM - 0.5], [0.003, 0, 1]), [floor], { mode: 'auto' })!
    expect(apart.relations[0].relation).toBe('along')
  })

  it('of two references as near as each other the first names the relation, and a coincident one among them is still found', () => {
    // A step measured in Measure, level like the XY plane and 12.3 mm up.
    const step: ConstrainRef = { key: 'element:9', kind: 'plane', name: 'Plane 9', origin: [0, 0, 12.3], normal: [0, 0, 1] }
    const far = constrainPlane(planePatch([0, 0, 40], [0.002, 0, 1]), [XY, step], { mode: 'auto' })!
    expect(far.relations[0]).toMatchObject({ relation: 'along', ref: 'datum:xy' })
    // Beside the step it is on the step, though the XY plane gave the direction.
    const beside = constrainPlane(planePatch([0, 0, 12], [0.002, 0, 1]), [XY, step], { mode: 'auto' })!
    expect(beside.relations[0]).toMatchObject({ relation: 'on', ref: 'element:9' })
    expect(beside.origin[2]).toBeCloseTo(12.3, 6)
  })

  it('a wall square to the floor within the tolerance is made square, its turn about the floor’s normal left to the points', () => {
    // A wall turned 25° about Z and leaning 0.35° out of upright.
    const lean = rad(0.35)
    const upright: Vec3 = [Math.cos(rad(25)), Math.sin(rad(25)), 0]
    const leaning: Vec3 = [upright[0] * Math.cos(lean), upright[1] * Math.cos(lean), Math.sin(lean)]
    const fit = constrainPlane(planePatch([10, 10, 5], leaning), [XY], { mode: 'auto' })!
    expect(fit.relations).toHaveLength(1)
    expect(fit.relations[0]).toMatchObject({ relation: 'across', ref: 'datum:xy' })
    expect(Math.abs(fit.normal[2])).toBeLessThan(1e-9)
    expect(angleDeg(fit.normal, upright)).toBeLessThan(0.05)
  })

  it('square to two references nothing is left to fit: it is their cross product', () => {
    const almostY = normalize([Math.sin(rad(0.4)), 1, Math.sin(rad(0.3))])!
    // Square to XY within 0.3° and to YZ within 0.4°, and those two leave
    // only Y — with no plane among the references to be parallel to.
    const fit = constrainPlane(planePatch([0, 20, 0], almostY), [XY, YZ], { mode: 'auto' })!
    expect(fit.relations.map((r) => r.ref).sort()).toEqual(['datum:xy', 'datum:yz'])
    expect(angleDeg(fit.normal, [0, 1, 0])).toBeLessThan(1e-6)
  })

  it('a forced relation holds however far off the fit was, and free forbids them all', () => {
    const tilted: Vec3 = [Math.sin(rad(4)), 0, Math.cos(rad(4))]
    const points = planePatch([0, 0, 12], tilted)
    const forced = constrainPlane(points, DATUMS, { mode: 'force', relation: 'along', ref: 'datum:xy' })!
    expect(forced.normal).toEqual([0, 0, 1])
    expect(forced.relations[0].tiltDeg).toBeCloseTo(4, 1)
    const on = constrainPlane(points, DATUMS, { mode: 'force', relation: 'on', ref: 'datum:xy' })!
    expect(on.origin[2]).toBeCloseTo(0, 9)
    const level = constrainPlane(planePatch([0, 0, 12], [0.001, 0, 1]), DATUMS, { mode: 'free' })!
    expect(level.relations).toEqual([])
    expect(level.normal[2]).not.toBe(1)
  })

  it('has no plane through a line of points', () => {
    const line = new Float32Array(30)
    for (let i = 0; i < 10; i++) line[i * 3] = i
    expect(constrainPlane(line, DATUMS, { mode: 'auto' })).toBeNull()
  })
})

describe('Auto Constrain: a cylinder', () => {
  it('finds a third of a cylinder from its points alone', () => {
    const axis = normalize([0.3, -0.2, 1])!
    const c = fitCylinderFree(cylinderPatch([4, 5, 6], axis, 8))!
    expect(c.r).toBeCloseTo(8, 1)
    expect(angleDeg([c.ax, c.ay, c.az], axis)).toBeLessThan(0.2)
  })

  it('a bore 0.3° off upright is made upright and fitted again on that axis', () => {
    const axis: Vec3 = [Math.sin(rad(0.3)), 0, Math.cos(rad(0.3))]
    const fit = constrainCylinder(cylinderPatch([10, -4, 0], axis, 6, 200), DATUMS, { mode: 'auto' })!
    expect(angleDeg(fit.axis, [0, 0, 1])).toBe(0)
    expect(fit.radius).toBeCloseTo(6, 1)
    expect(fit.origin[0]).toBeCloseTo(10, 1)
    expect(fit.origin[1]).toBeCloseTo(-4, 1)
    expect(fit.relations[0]).toMatchObject({ relation: 'along', ref: 'datum:xy', refKind: 'plane' })
    expect(relationWords('cylinder', 'along', 'plane')).toBe('Perpendicular to')
  })

  it('within a millimetre of a parallel reference axis it takes that axis', () => {
    const bore: ConstrainRef = { key: 'surface:3', kind: 'axis', name: 'Surface 3', origin: [10.3, -4.2, 40], dir: [0, 0, 1] }
    const fit = constrainCylinder(cylinderPatch([10, -4, 0], [0.002, 0, 1], 9, 240), [bore], { mode: 'auto' })!
    expect(fit.relations[0]).toMatchObject({ relation: 'on', ref: 'surface:3' })
    expect(fit.relations[0].shiftMm!).toBeCloseTo(Math.hypot(0.3, 0.2), 1)
    expect(fit.origin[0]).toBeCloseTo(10.3, 6)
    expect(fit.origin[1]).toBeCloseTo(-4.2, 6)
    // The radius is the points' mean distance from the axis they were moved
    // to: over two thirds of a turn that is the true radius and a share of
    // the 0.36 mm the axis moved, not the true radius again.
    expect(Math.abs(fit.radius - 9)).toBeLessThan(0.36)
    expect(fit.rms).toBeGreaterThan(fit.rmsFree)
  })

  it('an axis lying 0.4° out of a plane is laid into it', () => {
    const axis = normalize([Math.cos(rad(30)), Math.sin(rad(30)), Math.sin(rad(0.4))])!
    const fit = constrainCylinder(cylinderPatch([0, 0, 10], axis, 5, 180), [XY], { mode: 'auto' })!
    expect(fit.relations[0]).toMatchObject({ relation: 'across', ref: 'datum:xy' })
    expect(Math.abs(fit.axis[2])).toBeLessThan(1e-9)
    expect(relationWords('cylinder', 'across', 'plane')).toBe('Parallel to')
  })
})
