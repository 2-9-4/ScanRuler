// SPDX-License-Identifier: AGPL-3.0-only
// The section view: where its plane is laid and which half it takes away,
// and what a ray may still meet once the part is cut — nothing on the half
// cut away, and nothing behind the cap that closes a closed part.
import * as THREE from 'three'
import { beforeEach, describe, expect, it } from 'vitest'
import { rigidFromAxisAngle } from '../src/core/deviation/rigid'
import { sectionViewFrames, useSectionView } from '../src/state/sectionViewStore'
import { useStore } from '../src/state/store'
import { keptHits } from '../src/viewer/clipRaycast'

/** A hit at height z on a ray straight down from z = 10, or up from −10. */
const hit = (z: number, from: number, faceIndex = 0) =>
  ({ point: new THREE.Vector3(0, 0, z), distance: Math.abs(from - z), faceIndex, object: null }) as unknown as THREE.Intersection

describe('keptHits', () => {
  // Keeps z ≤ 0: the half above the plane is cut away.
  const planes = [new THREE.Plane(new THREE.Vector3(0, 0, -1), 0)]
  const down = new THREE.Ray(new THREE.Vector3(0, 0, 10), new THREE.Vector3(0, 0, -1))
  const up = new THREE.Ray(new THREE.Vector3(0, 0, -10), new THREE.Vector3(0, 0, 1))
  // A box from z = −5 to 5: its top on the half cut away, its bottom kept.
  const fromAbove = [hit(-5, 10), hit(5, 10)]

  it('drops the hits on the half cut away, nearest first', () => {
    expect(keptHits(fromAbove, planes, down, null).map((h) => h.point.z)).toEqual([-5])
  })

  it('hides what lies behind the cap of a closed part', () => {
    // The ray enters the box through its top, cut away, so it crosses the
    // plane inside the solid: the cap is there, and the bottom behind it.
    expect(keptHits(fromAbove, planes, down, new Uint8Array([1]))).toEqual([])
  })

  it('leaves an open part open to the ray', () => {
    expect(keptHits(fromAbove, planes, down, new Uint8Array([0])).map((h) => h.point.z)).toEqual([-5])
  })

  it('keeps what stands in front of the cap', () => {
    // From below, the kept bottom is met before the plane is.
    const fromBelow = [hit(5, -10), hit(-5, -10)]
    expect(keptHits(fromBelow, planes, up, new Uint8Array([1])).map((h) => h.point.z)).toEqual([-5])
  })
})

describe('the section view', () => {
  const centre: [number, number, number] = [1, 2, 3]
  beforeEach(() => {
    useStore.setState({ elements: [] })
    useSectionView.setState({ on: false, ref: 'z', axis: null, refDir: null, offset: 0, flipped: false, centre: [0, 0, 0] })
  })

  it('opens square to the view through the middle, the half toward the camera taken away', () => {
    // Looking down −Z from above: the XY plane, at the centre's Z.
    useSectionView.getState().open([0.1, -0.2, -0.97], centre)
    const s = useSectionView.getState()
    expect(s.on).toBe(true)
    expect(s.ref).toBe('z')
    expect(s.offset).toBeCloseTo(3)
    const frames = sectionViewFrames(s)!
    expect(frames.cut.origin).toEqual([1, 2, 3])
    // The half above — toward the camera — goes: the cut's normal points up.
    expect(frames.cut.normal).toEqual([0, 0, 1])
  })

  it('flips to the half away from the camera, the gizmo staying as it was', () => {
    useSectionView.getState().open([0, 0, 1], centre)
    // Looking up +Z from below: the half below goes.
    expect(sectionViewFrames(useSectionView.getState())!.cut.normal).toEqual([-0, -0, -1])
    useSectionView.getState().flip()
    const frames = sectionViewFrames(useSectionView.getState())!
    expect(frames.cut.normal).toEqual([0, 0, 1])
    expect(frames.gizmo.normal).toEqual([0, 0, 1])
  })

  it('keeps its offset when the same plane is chosen again, as squaring up does', () => {
    const view = useSectionView.getState()
    view.open([0, 0, -1], centre)
    view.setOffset(7)
    view.setAxis({ origin: [0, 0, 0], dir: [0, 0.1, 1] })
    view.setRef('z')
    const s = useSectionView.getState()
    expect(s.offset).toBe(7)
    expect(s.axis!.dir).toEqual([0, 0, 1])
    // Another plane goes through the middle.
    view.setRef('x')
    expect(useSectionView.getState().offset).toBeCloseTo(1)
  })

  it('moves with the scan under a datum alignment', () => {
    const view = useSectionView.getState()
    view.open([0, 0, -1], centre)
    view.move(rigidFromAxisAngle([1, 0, 0], Math.PI / 2))
    const frames = sectionViewFrames(useSectionView.getState())!
    expect(frames.gizmo.normal[1]).toBeCloseTo(-1)
    expect(frames.gizmo.normal[2]).toBeCloseTo(0)
  })
})
