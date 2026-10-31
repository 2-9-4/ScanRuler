// SPDX-License-Identifier: AGPL-3.0-only
// The sketches of the Reverse engineer workspace drawn on the part: every
// committed sketch's pieces as fat lines stood up in its plane, and — while
// an extrude or a revolve is being set up — the closed regions of the
// sketches as faces to click, the way a CAD extrude asks for its profiles
// in the viewport. Drawn ahead of the depth buffer: a sketch on a plane
// through the middle of the scan lies inside it, and a sketch nobody can
// see is a sketch nobody can pick from.

import * as THREE from 'three'
import { Line2 } from 'three/addons/lines/Line2.js'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import type { Vec2 } from '../../../src/core/flat/types'
import type { SectionFrame } from '../../../src/core/section/frame'
import type { Vec3 } from '../../../src/core/types'
import { SECTION_LINE_DEFAULT } from '../../../src/viewer/lineWidths'
import { pinLabel } from '../../../src/viewer/overlays'
import { frameMatrix, onFramePlane, planeSheet } from '../../../src/viewer/frameBasis'
import { LineWidthRegistry } from '../../../src/viewer/lineWidthRegistry'
import { distToSegment2 } from '../../../src/core/flat/vec2'

/** One sketch as the overlay draws it: its pieces sampled into polylines
 *  in the part's coordinates, and its closed regions on the sheet. */
export interface SketchOverlayItem {
  id: number
  color: string
  frame: SectionFrame
  strokes: { entity: number; kind: 'line' | 'arc' | 'circle' | 'spline' | 'point'; construction: boolean; points: number[] }[]
  regions: { key: string; outer: Vec2[]; holes: Vec2[][] }[]
}

export interface SketchRegionHit {
  sketchId: number
  key: string
  /** How far along the pick ray the face was met — to tell whether the
   *  scan stands in front of it. */
  distance?: number
}

export interface SketchLineHit {
  sketchId: number
  entity: number
}

/** How far, in pixels, a click may miss a sketch line and still take it. */
const LINE_REACH_PX = 8

const REGION_OPACITY = 0.16
const REGION_HOVER_OPACITY = 0.32
const REGION_PICKED_OPACITY = 0.5
const REGION_PICKED_HOVER_OPACITY = 0.62
const PICKED_COLOR = '#3cb371'

export interface SketchOverlayContext {
  partGroup: THREE.Group
  raycaster: THREE.Raycaster
  camera: () => THREE.Camera
  canvas: HTMLElement
  setPickRay(clientX: number, clientY: number): void
  /** Half the scan's bounding-box diagonal and its centre — what a hinted
   *  plane's sheet is sized and placed by. */
  modelRadius(): number
  modelCenter(): Vec3
  invalidate(): void
}

export class SketchOverlay {
  private group = new THREE.Group()
  private cleanup: (() => void)[] = []
  private items: readonly SketchOverlayItem[] = []
  private regionMeshes: { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial; sketchId: number; key: string; color: string }[] = []
  private lines: { sketchId: number; entity: number; a: THREE.Vector3; b: THREE.Vector3 }[] = []
  private fatLines = new LineWidthRegistry(SECTION_LINE_DEFAULT)
  private profilePick = false
  private picked = new Set<string>()
  private linePick = false
  private through = true
  private hoveredRegion: SketchRegionHit | null = null
  private hoveredLine: SketchLineHit | null = null
  private hoverLine: { line: Line2; geo: LineGeometry; mat: LineMaterial; letGo: () => void } | null = null
  /** The plane or axis a picker is hovering: drawn through the part with its
   *  name, so "Plane 2" in a list is a sheet on the scan. */
  private hintGroup = new THREE.Group()
  private hintCleanup: (() => void)[] = []
  private unitPlane = new THREE.PlaneGeometry(1, 1)

  constructor(private ctx: SketchOverlayContext) {
    ctx.partGroup.add(this.group)
    ctx.partGroup.add(this.hintGroup)
  }

  private clearHint(): void {
    for (const fn of this.hintCleanup) fn()
    this.hintCleanup = []
    this.hintGroup.clear()
    this.ctx.invalidate()
  }

  /**
   * Show a plane through the part — a square sheet wide enough to cross it,
   * centred where the part's centre falls on the plane, with its name — or
   * take it away with null. What a picker's hovered option points at.
   */
  setPlaneHint(frame: SectionFrame | null, color: string, name: string, fill = 0.18): void {
    this.clearHint()
    if (!frame) return
    const centre = onFramePlane(frame, this.ctx.modelCenter())
    const half = this.ctx.modelRadius() * 1.15
    const sheetMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: fill, depthWrite: false, side: THREE.DoubleSide })
    const sheet = planeSheet(this.unitPlane, sheetMat, frame, centre, half)
    sheet.renderOrder = 4
    this.hintGroup.add(sheet)
    // A border ahead of the depth buffer, so the plane reads even where the
    // part hides its sheet.
    const u = new THREE.Vector3(...frame.basisU).multiplyScalar(half)
    const v = new THREE.Vector3(...frame.basisV).multiplyScalar(half)
    const corners = [
      centre.clone().sub(u).sub(v),
      centre.clone().add(u).sub(v),
      centre.clone().add(u).add(v),
      centre.clone().sub(u).add(v),
      centre.clone().sub(u).sub(v),
    ]
    const geo = new LineGeometry()
    geo.setPositions(corners.flatMap((p) => [p.x, p.y, p.z]))
    const mat = new LineMaterial({ color: new THREE.Color(color).getHex(), linewidth: SECTION_LINE_DEFAULT * this.fatLines.scale, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, worldUnits: false })
    const letGo = this.fatLines.track(mat, SECTION_LINE_DEFAULT)
    const border = new Line2(geo, mat)
    border.computeLineDistances()
    border.renderOrder = 6
    this.hintGroup.add(border)
    const label = pinLabel('element-label', name, '', color)
    label.position.copy(centre)
    this.hintGroup.add(label)
    this.hintCleanup.push(() => {
      letGo()
      sheetMat.dispose()
      geo.dispose()
      mat.dispose()
      label.element.remove()
    })
    this.ctx.invalidate()
  }

  /** Show an axis through the part — a line across the whole of it with
   *  its name — or take it away with null. */
  setAxisHint(axis: { origin: Vec3; dir: Vec3 } | null, color: string, name: string): void {
    this.clearHint()
    if (!axis) return
    const o = new THREE.Vector3(...axis.origin)
    const d = new THREE.Vector3(...axis.dir).normalize()
    // Through the part's whole extent, from where the centre projects onto
    // the axis, so an axis element at the part's edge still crosses it.
    const c = new THREE.Vector3(...this.ctx.modelCenter())
    const foot = o.clone().addScaledVector(d, c.clone().sub(o).dot(d))
    const reach = this.ctx.modelRadius() * 1.3
    const a = foot.clone().addScaledVector(d, -reach)
    const b = foot.clone().addScaledVector(d, reach)
    const geo = new LineGeometry()
    geo.setPositions([a.x, a.y, a.z, b.x, b.y, b.z])
    const mat = new LineMaterial({ color: new THREE.Color(color).getHex(), linewidth: (SECTION_LINE_DEFAULT + 1) * this.fatLines.scale, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, worldUnits: false })
    const letGo = this.fatLines.track(mat, SECTION_LINE_DEFAULT + 1)
    const line = new Line2(geo, mat)
    line.computeLineDistances()
    line.renderOrder = 6
    this.hintGroup.add(line)
    const label = pinLabel('element-label', name, '', color)
    label.position.copy(foot)
    this.hintGroup.add(label)
    this.hintCleanup.push(() => {
      letGo()
      geo.dispose()
      mat.dispose()
      label.element.remove()
    })
    this.ctx.invalidate()
  }

  /** The canvas size, for the fat-line materials — every tick, a no-op
   *  unless it changed. */
  setResolution(width: number, height: number): void {
    if (this.fatLines.setResolution(width, height)) this.ctx.invalidate()
  }

  /** Follows the section line width: a sketch is a section's kin. The
   *  hints and the hover line are tracked as the pieces are, so one on
   *  screen follows the setting too. */
  setLineWidth(px: number): void {
    if (this.fatLines.setLineWidth(px)) this.ctx.invalidate()
  }

  /** Put the sketches away or bring them back, whatever each one's eye
   *  says — a picture's show: { sketches: false }, which changes no
   *  sketch. Put away, nothing of them takes a click. */
  setShown(on: boolean): void {
    if (this.group.visible === on) return
    this.group.visible = on
    if (!on) this.setHoveredLine(null)
    this.ctx.invalidate()
  }

  shown(): boolean {
    return this.group.visible
  }

  /** The sketches, rebuilt wholesale — a sketch is a few dozen pieces. */
  setSketches(items: readonly SketchOverlayItem[]): void {
    this.items = items
    this.rebuild()
  }

  /** Arm the regions as click targets, with the ones already picked lit,
   *  or (off) hide them. The keys are `${sketchId}:${regionKey}`.
   *  `through` says a region is picked through the part, as a feature
   *  asking for its profiles wants (a mid-plane sketch lies inside the
   *  scan); off, the owner takes only a region the scan does not hide, so
   *  a click on the part's face stays a click on the face. */
  setProfilePick(on: boolean, picked: ReadonlySet<string>, through = true): void {
    this.profilePick = on
    this.through = through
    this.picked = new Set(picked)
    for (const r of this.regionMeshes) r.mesh.visible = on
    this.applyRegionLook()
  }

  /** Whether an armed region is picked through the part. */
  picksThrough(): boolean {
    return this.through
  }

  /** Arm the sketch lines as click targets — what a revolve's axis is
   *  picked from. */
  setLinePick(on: boolean): void {
    this.linePick = on
    if (!on) this.setHoveredLine(null)
  }

  /** Whether anything here is waiting for a click. */
  picking(): boolean {
    return this.profilePick || this.linePick
  }

  /** Whether a region or a line is lit under the cursor. */
  hovered(): boolean {
    return this.hoveredRegion !== null || this.hoveredLine !== null
  }

  private rebuild(): void {
    this.setHoveredLine(null)
    for (const fn of this.cleanup) fn()
    this.cleanup = []
    this.group.clear()
    this.regionMeshes = []
    this.lines = []
    this.hoveredRegion = null
    this.ctx.invalidate()
    for (const item of this.items) {
      const placement = frameMatrix(item.frame)
      // The pieces: solid for geometry, dashed for construction, all ahead
      // of the depth buffer so a sketch inside the scan still shows.
      const solid = this.lineMaterial(item.color, false)
      const dashed = this.lineMaterial(item.color, true)
      for (const s of item.strokes) {
        if (s.points.length < 6) continue
        const geo = new LineGeometry()
        geo.setPositions(s.points)
        const line = new Line2(geo, s.construction ? dashed : solid)
        line.computeLineDistances()
        line.renderOrder = 5
        this.group.add(line)
        this.cleanup.push(() => geo.dispose())
        if (s.kind === 'line') {
          this.lines.push({
            sketchId: item.id,
            entity: s.entity,
            a: new THREE.Vector3(s.points[0], s.points[1], s.points[2]),
            b: new THREE.Vector3(s.points[3], s.points[4], s.points[5]),
          })
        }
      }
      // The regions as faces on the sheet, triangulated with their holes and
      // stood up in the frame. Hidden until an extrude or a revolve asks.
      for (const r of item.regions) {
        if (r.outer.length < 3) continue
        const shape = new THREE.Shape(r.outer.map(([x, y]) => new THREE.Vector2(x, y)))
        for (const h of r.holes) {
          if (h.length >= 3) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))))
        }
        const geo = new THREE.ShapeGeometry(shape)
        const material = new THREE.MeshBasicMaterial({
          color: item.color,
          transparent: true,
          opacity: REGION_OPACITY,
          side: THREE.DoubleSide,
          depthTest: false,
          depthWrite: false,
        })
        const mesh = new THREE.Mesh(geo, material)
        mesh.matrixAutoUpdate = false
        mesh.matrix.copy(placement)
        mesh.renderOrder = 4
        mesh.visible = this.profilePick
        mesh.userData.sketchId = item.id
        mesh.userData.regionKey = r.key
        this.group.add(mesh)
        this.regionMeshes.push({ mesh, material, sketchId: item.id, key: r.key, color: item.color })
        this.cleanup.push(() => {
          geo.dispose()
          material.dispose()
        })
      }
    }
    this.applyRegionLook()
  }

  private lineMaterial(color: string, dashed: boolean): LineMaterial {
    const width = SECTION_LINE_DEFAULT
    const mat = new LineMaterial({
      color: new THREE.Color(color).getHex(),
      linewidth: width * this.fatLines.scale,
      transparent: true,
      opacity: dashed ? 0.7 : 0.95,
      depthTest: false,
      depthWrite: false,
      worldUnits: false,
      dashed,
      dashSize: 3,
      gapSize: 2,
      dashScale: 1,
    })
    if (dashed) mat.defines.USE_DASH = ''
    const letGo = this.fatLines.track(mat, width)
    this.cleanup.push(() => {
      letGo()
      mat.dispose()
    })
    return mat
  }

  private applyRegionLook(): void {
    for (const r of this.regionMeshes) {
      const picked = this.picked.has(`${r.sketchId}:${r.key}`)
      const hovered = this.hoveredRegion?.sketchId === r.sketchId && this.hoveredRegion.key === r.key
      r.material.color.set(picked ? PICKED_COLOR : r.color)
      r.material.opacity = picked
        ? hovered
          ? REGION_PICKED_HOVER_OPACITY
          : REGION_PICKED_OPACITY
        : hovered
          ? REGION_HOVER_OPACITY
          : REGION_OPACITY
    }
    this.ctx.invalidate()
  }

  /** The region under a client point, if the regions are armed. Depth is
   *  not consulted: the faces are drawn through the part and are picked
   *  through it. */
  regionAt(clientX: number, clientY: number): SketchRegionHit | null {
    if (!this.profilePick || this.regionMeshes.length === 0 || !this.group.visible) return null
    this.ctx.setPickRay(clientX, clientY)
    this.group.updateWorldMatrix(true, true)
    const hits = this.ctx.raycaster.intersectObjects(
      this.regionMeshes.map((r) => r.mesh),
      false,
    )
    const hit = hits[0]
    if (!hit) return null
    return { sketchId: hit.object.userData.sketchId as number, key: hit.object.userData.regionKey as string, distance: hit.distance }
  }

  /** The sketch line under a client point, within a few pixels on screen,
   *  if the lines are armed. A screen test rather than a ray one: a line
   *  has no thickness for a ray to hit. */
  lineAt(clientX: number, clientY: number): SketchLineHit | null {
    if (!this.linePick || this.lines.length === 0 || !this.group.visible) return null
    const rect = this.ctx.canvas.getBoundingClientRect()
    const camera = this.ctx.camera()
    this.ctx.partGroup.updateWorldMatrix(true, false)
    const m = this.ctx.partGroup.matrixWorld
    const toScreen = (p: THREE.Vector3): [number, number] => {
      const v = p.clone().applyMatrix4(m).project(camera)
      return [rect.left + ((v.x + 1) / 2) * rect.width, rect.top + ((1 - v.y) / 2) * rect.height]
    }
    let best: SketchLineHit | null = null
    let bestD = LINE_REACH_PX
    for (const l of this.lines) {
      const a = toScreen(l.a)
      const b = toScreen(l.b)
      const d = distToSegment2([clientX, clientY], a, b)
      if (d < bestD) {
        bestD = d
        best = { sketchId: l.sketchId, entity: l.entity }
      }
    }
    return best
  }

  /** Light what is under the cursor. Returns whether anything changed, so
   *  the owner knows to set the cursor. */
  setHovered(region: SketchRegionHit | null, line: SketchLineHit | null): boolean {
    let changed = false
    if ((region?.sketchId ?? -1) !== (this.hoveredRegion?.sketchId ?? -1) || region?.key !== this.hoveredRegion?.key) {
      this.hoveredRegion = region
      this.applyRegionLook()
      changed = true
    }
    if ((line?.sketchId ?? -1) !== (this.hoveredLine?.sketchId ?? -1) || line?.entity !== this.hoveredLine?.entity) {
      this.setHoveredLine(line)
      changed = true
    }
    return changed
  }

  /** The hovered line is drawn again in white over itself, rather than each
   *  line owning a material of its own for the one time it lights. */
  private setHoveredLine(line: SketchLineHit | null): void {
    this.hoveredLine = line
    if (this.hoverLine) {
      this.group.remove(this.hoverLine.line)
      this.hoverLine.letGo()
      this.hoverLine.geo.dispose()
      this.hoverLine.mat.dispose()
      this.hoverLine = null
    }
    if (line) {
      const l = this.lines.find((x) => x.sketchId === line.sketchId && x.entity === line.entity)
      if (l) {
        const geo = new LineGeometry()
        geo.setPositions([l.a.x, l.a.y, l.a.z, l.b.x, l.b.y, l.b.z])
        const mat = new LineMaterial({
          color: 0xffffff,
          linewidth: (SECTION_LINE_DEFAULT + 2) * this.fatLines.scale,
          transparent: true,
          opacity: 0.95,
          depthTest: false,
          depthWrite: false,
          worldUnits: false,
        })
        const letGo = this.fatLines.track(mat, SECTION_LINE_DEFAULT + 2)
        const hl = new Line2(geo, mat)
        hl.computeLineDistances()
        hl.renderOrder = 6
        this.group.add(hl)
        this.hoverLine = { line: hl, geo, mat, letGo }
      }
    }
    this.ctx.invalidate()
  }

  dispose(): void {
    this.setSketches([])
    this.clearHint()
    this.unitPlane.dispose()
    this.ctx.partGroup.remove(this.group)
    this.ctx.partGroup.remove(this.hintGroup)
  }
}
