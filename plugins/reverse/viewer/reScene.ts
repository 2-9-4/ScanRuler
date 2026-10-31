// SPDX-License-Identifier: AGPL-3.0-only
// The Reverse engineer workspace in the 3D viewport: the sketches drawn on
// the part and their regions and lines as click targets, the bodies built on
// the scan and their faces, edges and corners as picks, a selection window
// over them, a place on the part asked for, and the ghost of a feature being
// set up — as layers of the SceneManager (src/viewer/sceneLayers.ts): the
// sketches, which stand in front of the measured elements and cover what
// lies behind them, the bodies, which come after, and the coordinate planes
// at the origin, last.

import * as THREE from 'three'
import type { SectionFrame, WorldAxis } from '../../../src/core/section/frame'
import type { Vec3 } from '../../../src/core/types'
import type { SceneManager } from '../../../src/viewer/SceneManager'
import { LAYER_ORDER, type SceneLayer, type SceneLayerHost } from '../../../src/viewer/sceneLayers'
import { CAP_SLOT, CapSet, cutColor, type CapPart } from '../../../src/viewer/sliceCap'
import { hatch } from '../../../src/viewer/hatch'
import { applyFinish } from '../../../src/viewer/viewThemes'
import type { TangentEdges } from '../core/edgeLines'
import { SketchOverlay, type SketchLineHit, type SketchOverlayItem, type SketchRegionHit } from './sketchOverlay'
import { CoordinatePlanes } from './coordinatePlanes'
import { type VaryingEdgeEnds, VaryingEnds } from './varyingEnds'
import type { DisplayUnits } from '../../../src/core/units'
import { BodyPicks, withBoundsTree, type BodyCandidate, type BodyEdgeHit, type BodyFaceHit, type BodyPickMode, type BodyTopology, type BodyVertexHit, type BodyWindowHit } from './bodyPicks'

/** Half the diagonal of the blank stage a model is begun on with no scan,
 *  millimetres: a part the size of a hand. */
const SCANLESS_RADIUS = 50

/** How far the cursor may stray from where the arrow keys were pressed and
 *  still hold what they stepped to, px — a hand on the mouse is not still. */
const STEP_HOLD_PX = 4
const nearSpot = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y) <= STEP_HOLD_PX

/** The red what two bodies share is drawn in — a trim's open edges' red:
 *  something on the part to see to — hatched, as a body may be red. */
const OVERLAP_COLOR = 0xe0564f

export class ReScene {
  private host: SceneLayerHost
  /** The bodies built, in the scan's frame — they were modelled on the scan
   *  where it stands, so they ride in its group and move with it under a
   *  best fit. Translucent over the scan by default; solid once the scan is
   *  put away. */
  private bodyGroup = new THREE.Group()
  readonly bodyMeshes = new Map<number, THREE.Mesh>()
  /** The mesh each body's block was made from — see setBodies. */
  private bodySources = new WeakMap<THREE.Mesh, object>()
  private bodiesSolid = false
  private bodiesFaint = false
  /** The ghost of a feature being set up — see setBodyPreview. */
  bodyPreview: THREE.Mesh | null = null
  /** The sketches drawn on the part, and their regions as click targets. */
  readonly sketches: SketchOverlay
  readonly bodyPicks: BodyPicks
  /** The coordinate planes at the origin, while they are shown. */
  readonly planes: CoordinatePlanes
  /** The Start and End of a varying round's edges, named on the part. */
  private varyingEnds: VaryingEnds
  private planePick = false
  /** The bodies dimmed while a pick is on for the others. */
  private dimmedBodies = new Set<number>()
  /** Bodies a feature's preview stands in for — see setBodyPreview. */
  private replacedBodies = new Set<number>()
  /** What two solid bodies share where they run into each other — see
   *  setOverlaps. */
  private overlaps: { a: number; b: number; mesh: THREE.Mesh }[] = []
  /** The section view's planes while it cuts the part — or the sketch's,
   *  while capSketchSlice asks — and the caps that close the solid bodies
   *  there — see recap. */
  private sectionPlanes: THREE.Plane[] | null = null
  private caps = new CapSet()
  /** The cut as the viewport last told it, and whether the sketch's own
   *  slice closes the bodies as the section view does. */
  private cut: { planes: THREE.Plane[] | null; section: boolean } = { planes: null, section: false }
  private sketchCapped = false
  private partPointPick = false
  /** A step the arrow keys took through what lies under the cursor on the
   *  bodies: where, everything there, and which of it is in hand — lit
   *  alone, and what the next click takes, until the cursor moves off. */
  private stepped: { at: { x: number; y: number }; items: BodyCandidate[]; index: number } | null = null
  private bodyWindow: { x0: number; y0: number; box: HTMLDivElement; pointerId: number } | null = null
  private removeLayers: (() => void)[] = []

  /** A click on a sketch's region while an extrude or a revolve is asking
   *  for its profiles, or on a sketch's line while a revolve is asking for
   *  its axis. */
  onSketchRegionPick: ((hit: SketchRegionHit, clientX: number, clientY: number) => void) | null = null
  onSketchLinePick: ((hit: SketchLineHit, clientX: number, clientY: number) => void) | null = null
  /** A click on a face or an edge of a body while those are armed — see
   *  setBodyPickMode. */
  onBodyFacePick: ((hit: BodyFaceHit, clientX: number, clientY: number, additive: boolean) => void) | null = null
  onBodyEdgePick: ((hit: BodyEdgeHit, clientX: number, clientY: number, additive: boolean) => void) | null = null
  /** A click on the part while a place on it is asked for — see
   *  setPartPointPick — in the part's coordinates. */
  onPartPointPick: ((point: Vec3, clientX: number, clientY: number) => void) | null = null
  /** A click on a corner of a body, with nothing armed but the selection. */
  onBodyVertexPick: ((hit: BodyVertexHit, clientX: number, clientY: number, additive: boolean) => void) | null = null
  /** A window dragged over the bodies with Shift held — see beginBodyWindow
   *  — and what of the armed faces and edges it took. */
  onBodyWindowPick: ((hit: BodyWindowHit, clientX: number, clientY: number) => void) | null = null
  /** A click that survived the drag threshold and landed on nothing that
   *  could be picked — the bare scan, or empty space. The selection goes
   *  away on it, as CAD has it; a drag of the camera leaves the selection
   *  alone. Not raised with Ctrl held: that click meant to add. */
  onClickAway: ((clientX: number, clientY: number) => void) | null = null
  /** A click on a coordinate plane while they are click targets — see
   *  setCoordinatePlanePick. */
  onCoordinatePlanePick: ((axis: WorldAxis, clientX: number, clientY: number) => void) | null = null
  /** The body the pointer has come onto — a face, an edge or a corner of
   *  it lit under the cursor — or null as it leaves the last; raised once a
   *  change, for the body list to light the body's row. */
  onBodyHover: ((bodyId: number | null) => void) | null = null
  private hoveredBody: number | null = null

  constructor(scene: SceneManager) {
    const host = scene.layerHost()
    this.host = host
    host.partGroup.add(this.bodyGroup)
    this.sketches = new SketchOverlay({
      partGroup: host.partGroup,
      raycaster: host.raycaster,
      camera: () => host.camera(),
      canvas: host.canvas,
      setPickRay: (x, y) => host.setPickRay(x, y),
      modelRadius: () => host.modelRadius(),
      modelCenter: () => host.modelCenter(),
      invalidate: () => host.invalidate(),
    })
    this.bodyPicks = new BodyPicks({
      partGroup: host.partGroup,
      raycaster: host.raycaster,
      camera: () => host.camera(),
      canvas: host.canvas,
      setPickRay: (x, y) => host.setPickRay(x, y),
      setDimmed: (ids) => {
        this.dimmedBodies = new Set(ids)
        for (const [id, mesh] of this.bodyMeshes) this.dressBody(mesh.material as THREE.MeshStandardMaterial, id)
        this.showOverlaps()
        this.recap()
      },
      bodiesSolid: () => this.bodiesSolid && !this.bodiesFaint,
      modelRadius: () => host.modelRadius(),
      invalidate: () => host.invalidate(),
    })
    this.varyingEnds = new VaryingEnds({ partGroup: host.partGroup, camera: () => host.camera(), invalidate: () => host.invalidate() })
    this.planes = new CoordinatePlanes({
      partGroup: host.partGroup,
      raycaster: host.raycaster,
      setPickRay: (x, y) => host.setPickRay(x, y),
      modelRadius: () => host.modelRadius(),
      invalidate: () => host.invalidate(),
    })
    this.removeLayers.push(scene.addLayer(this.sketchLayer()), scene.addLayer(this.bodyLayer()), scene.addLayer(this.planesLayer()))
  }

  // ---- the layers ------------------------------------------------------------

  /** A sketch's regions and lines, while a feature is asking for them: drawn
   *  through the part, so picked through it, ahead of everything behind
   *  them — and lit under the cursor unless a grip has it. */
  private sketchLayer(): SceneLayer {
    return {
      order: 20,
      covers: true,
      click: (x, y) => {
        if (!this.sketches.picking()) return false
        const region = this.regionUnder(x, y)
        if (region) {
          this.onSketchRegionPick?.(region, x, y)
          return true
        }
        const line = this.sketches.lineAt(x, y)
        if (line) {
          this.onSketchLinePick?.(line, x, y)
          return true
        }
        return false
      },
      hover: (at, covered) => {
        if (!this.sketches.picking()) return false
        const p = covered ? null : at
        const region = p ? this.regionUnder(p.x, p.y) : null
        const line = p && !region ? this.sketches.lineAt(p.x, p.y) : null
        if (this.sketches.setHovered(region, line)) this.host.setCursor(region || line ? 'pointer' : '')
        return this.sketches.hovered()
      },
      tick: (w, h) => this.sketches.setResolution(w, h),
      lineWidthChanged: (px) => this.sketches.setLineWidth(px),
      dispose: () => this.sketches.dispose(),
    }
  }

  /** A place on the part while an editor asks for one — a corner of a body
   *  within reach, else whichever of the bodies and the scan the ray meets
   *  first — then a body's face or edge while those are armed: after the
   *  measured elements, before the coordinate planes. An edge is picked on
   *  screen and takes the click within its reach; a face takes it when it is
   *  at least as near as the scan under the same cursor — a body lies on the
   *  scan it was built from, so the two are at the same depth on a face that
   *  fits, and the body is what was asked for — or wherever the scan is drawn
   *  see-through (scanWallAt). */
  private bodyLayer(): SceneLayer {
    return {
      order: LAYER_ORDER.elements + 10,
      // Shift and a left drag over the bodies is a selection window — no
      // navigation scheme turns the camera with it.
      pointerDown: (e) =>
        e.button === 0 && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && e.pointerType !== 'touch' && this.bodyPicks.picking()
          ? this.beginBodyWindow(e)
          : false,
      click: (x, y, additive) => {
        // What the arrow keys stepped to is what was asked for.
        const stepped = this.steppedAt({ x, y })
        this.stepped = null
        if (stepped && this.bodyPicks.picking()) {
          if (stepped.kind === 'vertex') this.onBodyVertexPick?.(stepped.hit, x, y, additive)
          else if (stepped.kind === 'edge') this.onBodyEdgePick?.(stepped.hit, x, y, additive)
          else this.onBodyFacePick?.(stepped.hit, x, y, additive)
          return true
        }
        if (this.partPointPick) {
          const point = this.partPointAt(x, y)
          if (point) {
            this.onPartPointPick?.(point, x, y)
            return true
          }
        }
        const item = this.bodyItemAt(x, y)
        if (item?.kind === 'vertex') this.onBodyVertexPick?.(item.hit, x, y, additive)
        else if (item?.kind === 'edge') this.onBodyEdgePick?.(item.hit, x, y, additive)
        else if (item) this.onBodyFacePick?.(item.hit, x, y, additive)
        return item !== null
      },
      clickedAway: (x, y) => this.onClickAway?.(x, y),
      // A body's face or edge on offer lights under the cursor — behind a lit
      // grip or a lit sketch region, which are on top.
      // The body under it is told to the body list, whose row lights.
      hover: (at, covered) => {
        if (!this.bodyPicks.picking()) {
          this.setHoveredBody(null)
          return false
        }
        const stepped = this.steppedAt(at)
        if (stepped) {
          this.bodyPicks.setHovered(stepped.kind === 'face' ? stepped.hit : null, stepped.kind === 'edge' ? stepped.hit : null, stepped.kind === 'vertex' ? stepped.hit : null)
          this.host.setCursor('pointer')
          this.setHoveredBody(stepped.hit.bodyId)
          return true
        }
        const p = covered ? null : at
        const vertex = p ? this.bodyPicks.vertexAt(p.x, p.y) : null
        const edge = p && !vertex ? this.bodyPicks.edgeAt(p.x, p.y) : null
        let face = p && !vertex && !edge ? this.bodyPicks.faceAt(p.x, p.y) : null
        if (face && face.distance > this.scanWallAt(p!.x, p!.y)) face = null
        if (this.bodyPicks.setHovered(face, edge, vertex)) this.host.setCursor(face || edge || vertex ? 'pointer' : '')
        this.setHoveredBody((vertex ?? edge ?? face)?.bodyId ?? null)
        return Boolean(face || edge || vertex)
      },
      // The arrow keys over the bodies: from what a click would take — or,
      // where something before the bodies would, from their first — on to
      // the next thing under the cursor and round again: the corners, the
      // edges, then the faces from the front back.
      cycle: (at, step, behind) => {
        if (!this.bodyPicks.picking()) return false
        const held = this.stepped && nearSpot(this.stepped.at, at) ? this.stepped : null
        if (held) {
          held.index = (held.index + step + held.items.length) % held.items.length
          return true
        }
        const items = this.bodyPicks.candidatesAt(at.x, at.y)
        const lit = behind ? -1 : items.findIndex((c) => this.bodyPicks.isHovered(c))
        // Nothing to step to: nothing there, or only what is lit already.
        if (items.length === 0 || (items.length === 1 && lit === 0)) return false
        const index = lit < 0 ? (step > 0 ? 0 : items.length - 1) : (lit + step + items.length) % items.length
        this.stepped = { at: { x: at.x, y: at.y }, items, index }
        return true
      },
      cycling: (at) => this.steppedAt(at) !== null,
      tick: (w, h) => {
        this.bodyPicks.setResolution(w, h)
        // The round faces' outlines turn with the camera; a no-op unless it has.
        this.bodyPicks.updateView()
        this.varyingEnds.followView()
      },
      themeChanged: (theme) => {
        if (this.bodyPreview) applyFinish(this.bodyPreview.material as THREE.MeshStandardMaterial, theme)
        // The caps are lit in the scheme's finish.
        this.recap()
      },
      clippingChanged: (planes, section) => {
        const dress = (mesh: THREE.Mesh | null) => {
          if (!mesh) return
          const material = mesh.material as THREE.Material
          material.clippingPlanes = planes
          material.needsUpdate = true
        }
        dress(this.bodyPreview)
        for (const mesh of this.bodyMeshes.values()) dress(mesh)
        for (const o of this.overlaps) dress(o.mesh)
        this.bodyPicks.setClipping(planes)
        // The section view closes what is solid; a sketch's slice is the
        // sketch's own, and closes it while capSketchSlice says.
        this.cut = { planes, section }
        this.sectionPlanes = section || this.sketchCapped ? planes : null
        this.recap()
      },
      // An orbit pivots on the bodies as much as on the scan: with the scan
      // put away, or a body in front of it, a turn about the scan's surface
      // behind reads as a pivot stuck in one place. A body a preview stands
      // in for is out of sight, and the preview pivots in its place.
      // The bodies with their BVH, as the picks have them; the preview is
      // cast at once a turn, and a tree for it would cost more than that.
      navTargets: () => {
        const targets: THREE.Object3D[] = []
        for (const [id, mesh] of this.bodyMeshes) if (mesh.visible && !this.replacedBodies.has(id)) targets.push(withBoundsTree(mesh))
        if (this.bodyPreview && this.replacedBodies.size > 0) targets.push(this.bodyPreview)
        return targets
      },
      // No scan: the bodies modelled on the blank stage are the part.
      frameBox: () => {
        const box = new THREE.Box3()
        for (const mesh of this.bodyMeshes.values()) {
          const b = (mesh.geometry as THREE.BufferGeometry).boundingBox
          if (b && mesh.visible) box.union(b)
        }
        return box.isEmpty() ? null : box
      },
      dispose: () => {
        this.setBodies([])
        this.setBodyPreview(null, '#ffffff')
        this.setOverlaps([])
        this.caps.dispose()
        this.bodyPicks.dispose()
        this.varyingEnds.dispose()
        this.host.partGroup.remove(this.bodyGroup)
      },
    }
  }

  /** The coordinate planes, while they are click targets: last of all, a
   *  plane taking a click only where nothing else would — not on a body,
   *  which comes first, nor behind the scan where it is drawn solid. */
  private planesLayer(): SceneLayer {
    return {
      order: LAYER_ORDER.worldPlanes + 5,
      click: (x, y) => {
        const axis = this.planeUnder(x, y)
        if (!axis) return false
        this.onCoordinatePlanePick?.(axis, x, y)
        return true
      },
      // Not under a lit face, edge or corner of a body: the body takes that
      // click, its layer coming first.
      hover: (at, covered) => {
        const axis = at && !covered && !this.bodyPicks.hovered() ? this.planeUnder(at.x, at.y) : null
        if (this.planes.setHovered(axis)) this.host.setCursor(axis ? 'pointer' : '')
        return axis !== null
      },
      dispose: () => this.planes.dispose(),
    }
  }

  private planeUnder(clientX: number, clientY: number): WorldAxis | null {
    if (!this.planePick) return null
    const hit = this.planes.hitAt(clientX, clientY)
    return hit && hit.distance <= this.scanWallAt(clientX, clientY) ? hit.axis : null
  }

  /** What of the bodies a click at a client point takes, as the bodies'
   *  layer takes it: a corner — the smallest thing there is, ahead of the
   *  edges that end in it, as an edge is ahead of the faces it bounds — an
   *  edge, or a face at least as near as the scan; null for none, or with
   *  nothing of the bodies armed. */
  bodyItemAt(clientX: number, clientY: number): BodyCandidate | null {
    if (!this.bodyPicks.picking()) return null
    const vertex = this.bodyPicks.vertexAt(clientX, clientY)
    if (vertex) return { kind: 'vertex', hit: vertex }
    const edge = this.bodyPicks.edgeAt(clientX, clientY)
    if (edge) return { kind: 'edge', hit: edge }
    const face = this.bodyPicks.faceAt(clientX, clientY)
    return face && face.distance <= this.scanWallAt(clientX, clientY) ? { kind: 'face', hit: face } : null
  }

  private setHoveredBody(id: number | null): void {
    if (id === this.hoveredBody) return
    this.hoveredBody = id
    this.onBodyHover?.(id)
  }

  /** What the arrow keys stepped to, while the cursor is still where they
   *  were pressed; moved off, the step is let go. */
  private steppedAt(at: { x: number; y: number } | null): BodyCandidate | null {
    if (this.stepped && (!at || !nearSpot(this.stepped.at, at))) this.stepped = null
    return this.stepped ? this.stepped.items[this.stepped.index] : null
  }

  /** Take the layers out of the viewport. */
  dispose(): void {
    this.setSketchImage(null)
    this.removeLayers.forEach((remove) => remove())
    this.removeLayers = []
  }

  /** The picture under the sketch being drawn, laid on its plane — its
   *  corners in the part's coordinates, bottom-left round — seen through the
   *  sheet the sketch is drawn on; null takes it away. The picture is
   *  decoded once and kept while it is the same. */
  private image: { src: string; mesh: THREE.Mesh; texture: THREE.Texture } | null = null
  setSketchImage(image: { src: string; corners: readonly Vec3[]; opacity: number } | null): void {
    if (this.image && (!image || image.src !== this.image.src)) {
      this.host.partGroup.remove(this.image.mesh)
      this.image.mesh.geometry.dispose()
      ;(this.image.mesh.material as THREE.Material).dispose()
      this.image.texture.dispose()
      this.image = null
    }
    if (!image) {
      this.host.invalidate()
      return
    }
    if (!this.image) {
      const texture = new THREE.TextureLoader().load(image.src, () => this.host.invalidate())
      texture.colorSpace = THREE.SRGBColorSpace
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3))
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2))
      geometry.setIndex([0, 1, 2, 0, 2, 3])
      // Over the part — the cut face at the plane it lies in included, which
      // it would fight for depth — and under the sheet the sketch is drawn
      // on; it takes no depth, so nothing behind it is hidden from a click.
      const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, depthTest: false, depthWrite: false, toneMapped: false })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.renderOrder = 4
      mesh.raycast = () => {}
      this.host.partGroup.add(mesh)
      this.image = { src: image.src, mesh, texture }
    }
    const position = this.image.mesh.geometry.getAttribute('position') as THREE.BufferAttribute
    image.corners.forEach((c, i) => position.setXYZ(i, c[0], c[1], c[2]))
    position.needsUpdate = true
    this.image.mesh.geometry.computeBoundingSphere()
    ;(this.image.mesh.material as THREE.MeshBasicMaterial).opacity = image.opacity
    this.host.invalidate()
  }

  /** How far along the pick ray a body's face may lie and still be picked
   *  past the scan: the scan's own depth, give or take its noise, where it
   *  is drawn solid. Drawn see-through — a veil over the bodies modelled on
   *  it — it hides nothing, so it keeps nothing from a click: a cylinder
   *  sitting in a bore of the scan is picked through the bore's wall. */
  private scanWallAt(clientX: number, clientY: number): number {
    if (this.host.scanOpacity() < 1) return Infinity
    return (this.host.scanDistanceAt(clientX, clientY) ?? Infinity) + this.slack()
  }

  /** A sketch on a face lies within the scan's noise of the surface. */
  private slack(): number {
    return Math.max(0.5, this.host.modelRadius() * 0.01)
  }

  /**
   * A selection window over the bodies: a box dragged with Shift held takes
   * every armed face and edge in it — dragged to the right those wholly
   * inside (a solid box), dragged to the left those it touches too (a dashed
   * one), as CAD tells the two apart. A press that does not move is left to
   * be the click it was.
   */
  private beginBodyWindow(e: PointerEvent): boolean {
    const el = this.host.canvas
    const container = this.host.container
    const box = document.createElement('div')
    box.className = 'bodywindow'
    box.style.display = 'none'
    container.appendChild(box)
    this.bodyWindow = { x0: e.clientX, y0: e.clientY, box, pointerId: e.pointerId }
    const place = (x: number, y: number) => {
      const w = this.bodyWindow
      if (!w) return
      const r = container.getBoundingClientRect()
      const moved = Math.abs(x - w.x0) + Math.abs(y - w.y0) > 6
      box.style.display = moved ? 'block' : 'none'
      box.classList.toggle('crossing', x < w.x0)
      box.style.left = `${Math.min(x, w.x0) - r.left}px`
      box.style.top = `${Math.min(y, w.y0) - r.top}px`
      box.style.width = `${Math.abs(x - w.x0)}px`
      box.style.height = `${Math.abs(y - w.y0)}px`
    }
    const move = (ev: PointerEvent) => {
      if (ev.pointerId === this.bodyWindow?.pointerId) place(ev.clientX, ev.clientY)
    }
    const end = (ev: PointerEvent) => {
      const w = this.bodyWindow
      if (!w || ev.pointerId !== w.pointerId) return
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', end)
      el.removeEventListener('pointercancel', end)
      try {
        el.releasePointerCapture(w.pointerId)
      } catch {
        // The capture was already gone with the pointer.
      }
      box.remove()
      this.bodyWindow = null
      if (ev.type === 'pointercancel') return
      const moved = Math.abs(ev.clientX - w.x0) + Math.abs(ev.clientY - w.y0) > 6
      // A Shift+click that did not move is a click that adds, like Ctrl's.
      if (!moved) this.host.click(ev.clientX, ev.clientY, true)
      else this.onBodyWindowPick?.(this.bodyPicks.itemsInWindow(w.x0, w.y0, ev.clientX, ev.clientY), ev.clientX, ev.clientY)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', end)
    el.addEventListener('pointercancel', end)
    try {
      el.setPointerCapture(e.pointerId)
    } catch {
      // No capture: the drag still works while it stays over the canvas.
    }
    return true
  }

  private partPointAt(clientX: number, clientY: number): Vec3 | null {
    const body = this.bodyPicks.pointAt(clientX, clientY)
    if (body?.corner) return body.point
    const scanAt = this.host.scanDistanceAt(clientX, clientY)
    if (body && (scanAt === null || body.distance <= scanAt)) return body.point
    return this.host.pickScan(clientX, clientY)?.point ?? null
  }

  /** The sketch region under a client point: any, while a feature editor
   *  asks for its profiles through the part; otherwise only one the scan
   *  does not stand in front of, so a click on the part's face is a click
   *  on the face and not on a sketch lying inside the part behind it. */
  private regionUnder(clientX: number, clientY: number): SketchRegionHit | null {
    const region = this.sketches.regionAt(clientX, clientY)
    if (!region || this.sketches.picksThrough() || region.distance === undefined) return region
    const scan = this.host.scanDistanceAt(clientX, clientY)
    // A region that far behind the scan is still on the face, not inside
    // the part.
    return scan === null || region.distance <= scan + this.slack() ? region : null
  }

  // ---- what the workspace sets ---------------------------------------------------

  /** Show a plane through the part with its name — what a picker's hovered
   *  option stands for — or take it away with null. `fill` is the sheet's
   *  opacity: a picker's hint is plain to see, the sketch plane under a
   *  sketch being drawn only just there — the sketch itself says where the
   *  plane is. */
  setPlaneHint(frame: SectionFrame | null, color: string, name: string, fill?: number): void {
    this.sketches.setPlaneHint(frame, color, name, fill)
  }

  /** Show an axis through the part with its name, or take it away. */
  setAxisHint(axis: { origin: Vec3; dir: Vec3 } | null, color: string, name: string): void {
    this.sketches.setAxisHint(axis, color, name)
  }

  /** Whether the committed sketches are on the stage at all — see
   *  SketchOverlay.setShown. */
  setSketchesShown(on: boolean): void {
    this.sketches.setShown(on)
    this.host.requestHover()
  }

  sketchesShown(): boolean {
    return this.sketches.shown()
  }

  /** The committed sketches, drawn on the part in their planes. */
  setSketches(items: readonly SketchOverlayItem[]): void {
    this.sketches.setSketches(items)
    this.host.requestHover()
  }

  /** Arm the sketches' regions as click targets — an extrude or a revolve
   *  asking for its profiles — with the picked ones lit; off hides them.
   *  Keys are `${sketchId}:${regionKey}`. */
  setSketchProfilePick(on: boolean, picked: ReadonlySet<string>, through = true): void {
    this.sketches.setProfilePick(on, picked, through)
    this.host.requestHover()
  }

  /** Arm the sketches' lines as click targets — a revolve asking for its
   *  axis. */
  setSketchLinePick(on: boolean): void {
    this.sketches.setLinePick(on)
    this.host.requestHover()
  }

  /**
   * The ghost of a feature being set up. A tool body — what an extrude or
   * a revolve would add or take — is drawn see-through in the scan's frame,
   * in the body's colour for a new body or a join and in red for a cut, the
   * cut's through the body it is inside of (`through`), the way a CAD
   * extrude shows what it is about to take away. A feature that works on a
   * body — a fillet, a shell, a draft — hands back the whole body as it
   * would leave it, and that is drawn solid in the body's place (`replaces`
   * names the bodies it stands in for, which are put out of sight though
   * still there to pick edges and faces on), with its own edges: the round
   * is seen as the round it will be, not as a shade inside a see-through
   * block. Null takes it away.
   */
  setBodyPreview(
    mesh: { positions: Float32Array; normals: Float32Array; indices: Uint32Array; faceHash?: Int32Array } | null,
    color: string,
    options: { through?: boolean; replaces?: readonly number[]; edges?: boolean } = {},
  ): void {
    const replaces = mesh ? (options.replaces ?? []) : []
    this.replacedBodies = new Set(replaces)
    for (const [id, body] of this.bodyMeshes) (body.material as THREE.Material).visible = !this.replacedBodies.has(id)
    this.showOverlaps()
    this.bodyPicks.setPreviewEdges(replaces, mesh && options.edges ? mesh : null)
    // The ghost's material is kept from one preview to the next, its
    // geometry alone made again: let go, it took its shader program with
    // it whenever no body wore one like it, and the next preview compiled
    // the program again — every answer of a drag, a tenth of a second each.
    const kept = this.bodyPreview
    if (kept) {
      kept.geometry.dispose()
      this.bodyGroup.remove(kept)
      this.bodyPreview = null
      if (!mesh) (kept.material as THREE.Material).dispose()
    }
    if (mesh) {
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3))
      geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3))
      geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1))
      geometry.computeBoundingBox()
      geometry.computeBoundingSphere()
      const solid = replaces.length > 0
      const material = kept ? (kept.material as THREE.MeshStandardMaterial) : new THREE.MeshStandardMaterial({
        side: THREE.DoubleSide,
        // Behind its own edges, as the bodies are.
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      })
      material.color.set(color)
      // Solid or see-through is another program: asked for again.
      if (material.transparent === solid) {
        material.transparent = !solid
        material.needsUpdate = true
      }
      material.opacity = solid ? 1 : 0.45
      material.depthWrite = solid
      material.depthTest = !options.through
      applyFinish(material, this.host.theme())
      material.clippingPlanes = this.host.clipPlanes()
      const ghost = new THREE.Mesh(geometry, material)
      ghost.renderOrder = 3
      this.bodyGroup.add(ghost)
      this.bodyPreview = ghost
    }
    this.recap()
    this.host.invalidate()
  }

  /** The ghost carried by an affine map (column-major 4 × 4) until the next
   *  one is set: a straight extrude stretched under a grip's drag, frame by
   *  frame, while the kernel builds the true one — see core/preview
   *  prismStretch — or bodies carried by a Move. Its edges go with it. Null
   *  puts it back as it was built. */
  setBodyPreviewStretch(matrix: readonly number[] | null): void {
    const ghost = this.bodyPreview
    if (!ghost) return
    this.bodyPicks.setPreviewMatrix(matrix)
    if (matrix) {
      ghost.matrixAutoUpdate = false
      ghost.matrix.fromArray(matrix)
    } else {
      ghost.matrixAutoUpdate = true
      ghost.updateMatrix()
    }
    ghost.matrixWorldNeedsUpdate = true
    this.host.invalidate()
  }

  /**
   * The bodies built, one block of GPU geometry each, keyed by the mesh it
   * was made from: a build hands back a body it left as it was as the very
   * mesh it was, so only the bodies a build made or changed are made again
   * — a body's eye or colour changed uploads nothing. Drawn in the scan's
   * frame, translucent by default so the scan shows through the body
   * modelled on it; see setBodiesSolid.
   */
  setBodies(items: readonly { id: number; mesh: { positions: Float32Array; normals: Float32Array; indices: Uint32Array; faceHash?: Int32Array }; visible: boolean; color: string; topology?: BodyTopology }[]): void {
    this.stepped = null
    const wanted = new Map(items.map((item) => [item.id, item]))
    let reshaped = false
    for (const [id, mesh] of this.bodyMeshes) {
      if (this.bodySources.get(mesh) === wanted.get(id)?.mesh) continue
      ;(mesh.geometry as THREE.BufferGeometry).dispose()
      ;(mesh.material as THREE.Material).dispose()
      this.bodyGroup.remove(mesh)
      this.bodyMeshes.delete(id)
      reshaped = true
    }
    const picks: { id: number; mesh: THREE.Mesh; faceHash?: Int32Array; topology?: BodyTopology }[] = []
    for (const item of items) {
      let mesh = this.bodyMeshes.get(item.id)
      if (mesh) {
        const material = mesh.material as THREE.MeshStandardMaterial
        if (material.color.getHexString() !== new THREE.Color(item.color).getHexString()) material.color.set(item.color)
      } else {
        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.BufferAttribute(item.mesh.positions, 3))
        geometry.setAttribute('normal', new THREE.BufferAttribute(item.mesh.normals, 3))
        geometry.setIndex(new THREE.BufferAttribute(item.mesh.indices, 1))
        geometry.computeBoundingBox()
        geometry.computeBoundingSphere()
        // Pushed a hair back, so the edges drawn on the faces win the depth
        // test against them and lose it against everything in front.
        const material = new THREE.MeshStandardMaterial({ color: item.color, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })
        applyFinish(material, this.host.theme())
        this.dressBody(material, item.id)
        material.visible = !this.replacedBodies.has(item.id)
        material.clippingPlanes = this.host.clipPlanes()
        mesh = new THREE.Mesh(geometry, material)
        mesh.renderOrder = 2
        this.bodyGroup.add(mesh)
        this.bodyMeshes.set(item.id, mesh)
        this.bodySources.set(mesh, item.mesh)
        reshaped = true
      }
      mesh.visible = item.visible
      picks.push({ id: item.id, mesh, faceHash: item.mesh.faceHash, topology: item.topology })
    }
    this.bodyPicks.setBodies(picks)
    this.showOverlaps()
    this.recap()
    if (reshaped) {
      if (!this.host.hasScan()) this.sizeToBodies()
      // What is under the cursor is found again on the bodies as they now are.
      this.host.requestHover()
    }
    this.host.invalidate()
  }

  /**
   * What two solid bodies share where they run into each other, drawn red
   * and hatched over both: there a face of each lies where the other's
   * does, and the two would fight for the same pixels — the red lies on
   * their own facets and is drawn a hair nearer, so it wins, and says why. Inside,
   * it shows through a see-through body and on the section view's cut.
   * Shown while both bodies are, not while a feature's preview stands in
   * for either or a pick has one dimmed. Replaced wholesale, as the bodies
   * are.
   */
  setOverlaps(items: readonly { a: number; b: number; mesh: { positions: Float32Array; normals: Float32Array; indices: Uint32Array } }[]): void {
    for (const o of this.overlaps) {
      o.mesh.geometry.dispose()
      ;(o.mesh.material as THREE.Material).dispose()
      this.bodyGroup.remove(o.mesh)
    }
    this.overlaps = items.map((item) => {
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(item.mesh.positions, 3))
      geometry.setAttribute('normal', new THREE.BufferAttribute(item.mesh.normals, 3))
      geometry.setIndex(new THREE.BufferAttribute(item.mesh.indices, 1))
      geometry.computeBoundingBox()
      geometry.computeBoundingSphere()
      // Ahead of the bodies' faces, where it lies on their facets, as theirs
      // are pushed back behind their edges. Matt, not in the scheme's
      // finish: a glossy face seen square on lights up white, red and all.
      const material = new THREE.MeshStandardMaterial({ color: OVERLAP_COLOR, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })
      hatch(material)
      material.clippingPlanes = this.host.clipPlanes()
      const mesh = new THREE.Mesh(geometry, material)
      mesh.renderOrder = 2
      // A click goes to the bodies under it.
      mesh.raycast = () => {}
      this.bodyGroup.add(mesh)
      return { a: item.a, b: item.b, mesh }
    })
    this.showOverlaps()
    this.recap()
    this.host.invalidate()
  }

  /** The overlaps of the bodies on show — see setOverlaps. */
  private showOverlaps(): void {
    const shown = (id: number) => {
      const body = this.bodyMeshes.get(id)
      return body !== undefined && body.visible && !this.replacedBodies.has(id) && !this.dimmedBodies.has(id)
    }
    for (const o of this.overlaps) o.mesh.visible = !this.bodiesFaint && shown(o.a) && shown(o.b)
  }

  /** Open an empty stage for modelling with no scan: a working size of a
   *  hand's width, so the coordinate planes, the sketch sheet and every
   *  overlay sized by the part have something to be sized by. */
  startScanless(): void {
    if (this.host.hasScan()) return
    const r = SCANLESS_RADIUS / Math.sqrt(3)
    this.host.sizeStage(SCANLESS_RADIUS, new THREE.Box3(new THREE.Vector3(-r, -r, -r), new THREE.Vector3(r, r, r)))
  }

  /** With no scan, the bodies are the part: the size hand-made things are
   *  drawn at follows them, and once they outgrow what the camera last
   *  framed it flies out to take them in, looking from where it looks —
   *  should they reach off the screen. It is left alone otherwise, as the
   *  operator put it. */
  private sizeToBodies(): void {
    const box = new THREE.Box3()
    for (const mesh of this.bodyMeshes.values()) {
      const b = (mesh.geometry as THREE.BufferGeometry).boundingBox
      if (b) box.union(b)
    }
    if (box.isEmpty()) return
    const radius = Math.max(box.min.distanceTo(box.max) / 2, SCANLESS_RADIUS * 0.2)
    const sphere = box.getBoundingSphere(new THREE.Sphere())
    const framed = this.host.framedSphere()
    // With room round them: the next feature usually grows the part, and a
    // view filled to its edges would be outgrown by it at once.
    const outgrown = sphere.center.distanceTo(framed.center) + sphere.radius > framed.radius
    this.host.sizeStage(radius)
    if (outgrown) this.host.takeIn(box, box.clone().expandByScalar(sphere.radius * 0.6))
  }

  private dressBody(material: THREE.MeshStandardMaterial, id: number): void {
    // A body not in play for a pick is faint, whatever the others are.
    if (this.dimmedBodies.has(id)) {
      material.transparent = true
      material.opacity = 0.15
      material.depthWrite = false
    } else if (this.bodiesFaint) {
      material.transparent = true
      material.opacity = 0.18
      material.depthWrite = false
    } else if (this.bodiesSolid) {
      material.transparent = false
      material.opacity = 1
      material.depthWrite = true
    } else {
      material.transparent = true
      material.opacity = 0.55
      material.depthWrite = false
    }
    material.needsUpdate = true
  }

  /** Close the solid bodies — and a feature's solid preview standing in for
   *  one — where the section view cuts them, each in a cut colour of its
   *  own, apart from the scan's: a cut face reads as cut material, and two
   *  bodies cut side by side as two. A see-through body is cut and left
   *  open, as the scan is. */
  private recap(): void {
    const parts: CapPart[] = []
    const part = (mesh: THREE.Mesh) => {
      const slot = CAP_SLOT.layers + parts.length
      parts.push({ mesh, slot, color: cutColor(slot) })
    }
    for (const mesh of this.bodyMeshes.values()) part(mesh)
    if (this.bodyPreview) part(this.bodyPreview)
    // What two bodies share is cut red, over both their cut faces.
    for (const o of this.overlaps) parts.push({ mesh: o.mesh, slot: CAP_SLOT.layers + parts.length, color: OVERLAP_COLOR, over: true, hatch: true })
    this.caps.update(this.sectionPlanes, parts, this.host.theme())
  }

  /** The bodies all but put away — a tint and their edges — while the scan
   *  under them is what is being clicked: a face snapped onto the scan
   *  asks for the scan's face, which a solid body lies right on top of. */
  setBodiesFaint(faint: boolean): void {
    if (this.bodiesFaint === faint) return
    this.bodiesFaint = faint
    for (const [id, mesh] of this.bodyMeshes) this.dressBody(mesh.material as THREE.MeshStandardMaterial, id)
    this.showOverlaps()
    this.recap()
    this.host.invalidate()
  }

  /** Whether the bodies are drawn solid — the Bodies key's menu says. */
  setBodiesSolid(solid: boolean): void {
    if (this.bodiesSolid === solid) return
    this.bodiesSolid = solid
    for (const [id, mesh] of this.bodyMeshes) this.dressBody(mesh.material as THREE.MeshStandardMaterial, id)
    this.recap()
    this.host.invalidate()
  }

  /** How the bodies' tangent edges are drawn — see bodyPicks. */
  /** Whether the slice a sketch cuts the part open with closes the solid
   *  bodies where it cuts them, as the section view does — so the section
   *  being drawn on reads as solid, not as the bodies' insides. */
  capSketchSlice(on: boolean): void {
    if (this.sketchCapped === on) return
    this.sketchCapped = on
    this.sectionPlanes = this.cut.section || on ? this.cut.planes : null
    this.recap()
  }

  setTangentEdges(mode: TangentEdges): void {
    this.stepped = null
    this.bodyPicks.setTangentEdges(mode)
    this.host.requestHover()
  }

  /** Arm the faces or the edges of the bodies in play (null: every body)
   *  as click targets, the others dimmed; null stands down. */
  setBodyPickMode(mode: BodyPickMode | null, inPlay: readonly number[] | null): void {
    this.stepped = null
    this.bodyPicks.setMode(mode, inPlay)
    this.host.requestHover()
    this.host.invalidate()
  }

  /** The open edges of a trim that did not close, drawn on the part; an
   *  empty list takes them off. */
  setOpenEdges(polylines: readonly Float32Array[]): void {
    this.bodyPicks.setOpenEdges(polylines)
    this.host.invalidate()
  }

  /** Light whole bodies, by id — those whose rows the pointer is on in the
   *  body list; none with an empty list. See BodyPicks.setLit. */
  setLitBodies(ids: readonly number[]): void {
    this.bodyPicks.setLit(ids)
  }

  /** Name the Start and the End of the edges a fillet rounds at a varying
   *  radius — none with an empty list — with the radius there in `units`. */
  setVaryingEnds(edges: readonly VaryingEdgeEnds[], units: DisplayUnits = 'mm'): void {
    this.varyingEnds.set(edges, units)
  }

  /** Light the faces and edges a feature has picked. */
  setBodyPicks(faces: readonly { bodyId: number; hash: number }[], edges: readonly { bodyId: number; hash: number }[], chain: readonly { bodyId: number; hash: number }[] = [], vertices: readonly BodyVertexHit[] = []): void {
    this.bodyPicks.setPicked(faces, edges, chain, vertices)
  }

  setBodyVisible(id: number, visible: boolean): void {
    const mesh = this.bodyMeshes.get(id)
    if (mesh) mesh.visible = visible
    this.showOverlaps()
    this.host.invalidate()
  }

  /** Whether any body is on screen — for framing. */
  bodiesBox(): THREE.Box3 | null {
    const box = new THREE.Box3()
    for (const mesh of this.bodyMeshes.values()) {
      if (mesh.visible && mesh.geometry.boundingBox) box.union(mesh.geometry.boundingBox)
    }
    return box.isEmpty() ? null : box
  }

  /** Whether a click on the part — the scan or a body, a body's corner ahead
   *  of both — is reported as a point through onPartPointPick: an extrude's
   *  end put through a place on the part. A sketch region under the cursor
   *  still takes its click first. */
  setPartPointPick(on: boolean): void {
    if (this.partPointPick === on) return
    this.partPointPick = on
    this.host.requestHover()
    this.host.invalidate()
  }

  /** The coordinate planes drawn at the origin — none with an empty list —
   *  at the stage's size; asked again when that changes. */
  setCoordinatePlanes(axes: readonly WorldAxis[]): void {
    this.planes.setShown(axes)
    this.host.requestHover()
  }

  /** Whether a click on a coordinate plane is reported through
   *  onCoordinatePlanePick, and the one selected, lit. */
  setCoordinatePlanePick(on: boolean, selected: WorldAxis | null): void {
    this.planes.setSelected(selected)
    if (this.planePick === on) return
    this.planePick = on
    if (!on && this.planes.setHovered(null)) this.host.setCursor('')
    this.host.requestHover()
  }
}

const scenes = new WeakMap<SceneManager, ReScene>()

/** The workspace's part of a viewport — made on first use, one per viewport. */
export function reSceneOf(scene: SceneManager): ReScene {
  let re = scenes.get(scene)
  if (!re) {
    re = new ReScene(scene)
    scenes.set(scene, re)
  }
  return re
}
