// SPDX-License-Identifier: AGPL-3.0-only
// The sketch overlay's fat lines follow the line-width setting and the canvas
// size — the pieces, and also what is drawn once and taken away again: the
// hinted plane's border, the hinted axis, the hovered line.

import * as THREE from 'three'
import { Line2 } from 'three/addons/lines/Line2.js'
import type { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { describe, expect, it, vi } from 'vitest'
import type { SectionFrame } from '../../../src/core/section/frame'
import { SECTION_LINE_DEFAULT } from '../../../src/viewer/lineWidths'
import { SketchOverlay } from '../viewer/sketchOverlay'

// The label is a DOM element, and these tests have no DOM.
vi.mock('../../../src/viewer/overlays', () => ({
  pinLabel: () => Object.assign(new THREE.Object3D(), { element: { remove() {} } }),
}))

const XY: SectionFrame = { origin: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] }

function overlay(): { overlay: SketchOverlay; part: THREE.Group } {
  const part = new THREE.Group()
  const camera = new THREE.PerspectiveCamera()
  const o = new SketchOverlay({
    partGroup: part,
    raycaster: new THREE.Raycaster(),
    camera: () => camera,
    canvas: {} as HTMLElement,
    setPickRay: () => {},
    modelRadius: () => 10,
    modelCenter: () => [0, 0, 0],
    invalidate: () => {},
  })
  return { overlay: o, part }
}

/** Every fat line's material under the part, by colour. */
function fatLines(part: THREE.Group): Map<number, LineMaterial> {
  const out = new Map<number, LineMaterial>()
  part.traverse((o) => {
    if (o instanceof Line2) out.set((o.material as LineMaterial).color.getHex(), o.material as LineMaterial)
  })
  return out
}

describe('the sketch overlay', () => {
  it('sizes a hint on screen to a new line width and a new canvas', () => {
    const { overlay: o, part } = overlay()
    o.setResolution(800, 600)
    o.setPlaneHint(XY, '#ff0000', 'Plane 1')
    const border = fatLines(part).get(0xff0000)!
    expect(border.linewidth).toBeCloseTo(SECTION_LINE_DEFAULT, 9)

    o.setLineWidth(SECTION_LINE_DEFAULT * 2)
    o.setResolution(1024, 768)
    expect(border.linewidth).toBeCloseTo(SECTION_LINE_DEFAULT * 2, 9)
    expect(border.resolution.toArray()).toEqual([1024, 768])

    o.setAxisHint({ origin: [0, 0, 0], dir: [0, 0, 1] }, '#00ff00', 'Axis 1')
    const axis = fatLines(part).get(0x00ff00)!
    o.setLineWidth(SECTION_LINE_DEFAULT)
    o.setResolution(640, 480)
    expect(axis.linewidth).toBeCloseTo(SECTION_LINE_DEFAULT + 1, 9)
    expect(axis.resolution.toArray()).toEqual([640, 480])
    // The plane's hint went when the axis's came, and was let go with it.
    expect(border.linewidth).toBeCloseTo(SECTION_LINE_DEFAULT * 2, 9)
    o.dispose()
  })

  it('sizes the hovered line to a new line width, and lets it go when the hover moves off', () => {
    const { overlay: o, part } = overlay()
    o.setResolution(800, 600)
    o.setSketches([
      { id: 1, color: '#0000ff', frame: XY, strokes: [{ entity: 7, kind: 'line', construction: false, points: [0, 0, 0, 5, 0, 0] }], regions: [] },
    ])
    o.setLinePick(true)
    o.setHovered(null, { sketchId: 1, entity: 7 })
    const hover = fatLines(part).get(0xffffff)!
    expect(hover.linewidth).toBeCloseTo(SECTION_LINE_DEFAULT + 2, 9)

    o.setLineWidth(SECTION_LINE_DEFAULT * 2)
    expect(hover.linewidth).toBeCloseTo((SECTION_LINE_DEFAULT + 2) * 2, 9)
    o.setResolution(1024, 768)
    expect(hover.resolution.toArray()).toEqual([1024, 768])

    o.setHovered(null, null)
    expect(fatLines(part).has(0xffffff)).toBe(false)
    o.setLineWidth(SECTION_LINE_DEFAULT)
    expect(hover.linewidth).toBeCloseTo((SECTION_LINE_DEFAULT + 2) * 2, 9)
    o.dispose()
  })
})
