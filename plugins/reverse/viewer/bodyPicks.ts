// SPDX-License-Identifier: AGPL-3.0-only
// Faces and edges of the bodies built in the Reverse engineer workspace as
// things to click, the way a CAD program takes a fillet's edges or a shell's
// open face on the part. A body's mesh comes from the kernel face by face,
// each triangle carrying its face's hash, so a ray into the mesh names a
// face; the edges come as polylines with the same hashes and are picked on
// screen, within a few pixels, since a line has no thickness for a ray.
// The face under the cursor lights, the picked ones stay lit, and the bodies
// that are not in play are dimmed by the owner so a click cannot land on one.
//
// The edges are drawn all the time, the way a CAD viewport draws a body:
// thin dark lines over the shading, tested against the depth buffer so the
// far side's edges stay behind the body instead of shining through it (the
// body's faces are pushed a hair back by a polygon offset so a line on a
// face wins). An edge hidden behind a solid body cannot be picked either —
// what cannot be seen is not what the hand meant.
//
// The lines drawn are not the kernel's sampled polylines but the outlines
// of the faces' own triangles (core/edgeLines): a polyline sampled apart
// from the faces dips under a round face between the points they share —
// a fillet's rim drawn as dashes — while a line on the triangles' sides is
// on the surface all along, and the offset is all it needs. The polylines
// are what an edge is picked by.
//
// A round face's seam and the cut a boolean left across one surface are
// outlines too, and no edge of the part's shape: neither is drawn nor
// picked, as in any CAD program. The tangent edges are drawn as the
// operator sets — as the sharp ones, fainter, or not at all, when they
// cannot be picked either (core/edgeLines).

import * as THREE from 'three'
import { Line2 } from 'three/addons/lines/Line2.js'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import type { MeshBVHOptions } from 'three-mesh-bvh'
import { edgeShares, restSegments, type EdgeShares, type OneSurface, type TangentEdges } from '../core/edgeLines'
import { silhouetteSegments } from '../core/silhouette'
import { onOneSurface } from '../core/topo'
import type { EdgeInfo, FaceInfo } from '../core/build'
import { SECTION_LINE_DEFAULT } from '../../../src/viewer/lineWidths'
import { distToSegment2 } from '../../../src/core/flat/vec2'

/** What is armed: the faces or the edges an editor asks for, or — with no
 *  editor open — everything there is to select: faces, edges and corners. */
export type BodyPickMode = 'faces' | 'edges' | 'all'

export interface BodyTopology {
  faces: FaceInfo[]
  edges: EdgeInfo[]
}

export interface BodyFaceHit {
  bodyId: number
  face: FaceInfo
  /** The edges bounding the face — its outline. */
  edges: EdgeInfo[]
  /** How far along the pick ray the face was met — to weigh it against the
   *  scan under the same cursor. */
  distance: number
}

export interface BodyEdgeHit {
  bodyId: number
  edge: EdgeInfo
}

/** A corner of a body: where its edges end. */
export interface BodyVertexHit {
  bodyId: number
  point: [number, number, number]
}

/** One of the things under a client point a click could take — what the
 *  arrow keys step through. */
export type BodyCandidate = { kind: 'vertex'; hit: BodyVertexHit } | { kind: 'edge'; hit: BodyEdgeHit } | { kind: 'face'; hit: BodyFaceHit }

/** What a window dragged over the bodies takes. */
export interface BodyWindowHit {
  faces: Omit<BodyFaceHit, 'distance'>[]
  edges: BodyEdgeHit[]
}

/** How far, in pixels, a click may miss an edge and still take it. */
const EDGE_REACH_PX = 8
/** And a corner: it is a smaller thing than an edge and wins over the edges
 *  that end in it, so it reaches a little further. */
const VERTEX_REACH_PX = 10
/** A lit corner's size on screen. */
const VERTEX_LIT_PX = 11
const HOVER_COLOR = '#ffffff'
const PICKED_COLOR = '#3cb371'
/** A body's edges at rest: near black, as CAD draws them. */
const EDGE_COLOR = '#0c0f13'
/** Their width in pixels — a hair, against the fat lines of a pick — and a
 *  little more while edges are what is being asked for. */
const EDGE_WIDTH_PX = 1.1
const EDGE_WIDTH_ARMED_PX = 1.6
/** How strongly the edges at rest are drawn, and the tangent ones when they
 *  are set to be dimmed. */
const EDGE_OPACITY = 0.85
const TANGENT_DIMMED_OPACITY = 0.3
/** The width of a lit edge: hovered, picked. */
const EDGE_LIT_PX = 3
/** A lit edge that a tangent chain carries the feature along to. */
const CHAIN_COLOR = '#8fd6ae'
/** The open edges of a trim that did not close: an alarm, not a pick. */
const OPEN_COLOR = '#e0564f'
/** A whole body lit from its row in the body list: a see-through fill
 *  over everything — a part inside another shows where it is — and its
 *  edges where they are in sight. */
const LIT_BODY_COLOR = '#3a9be8'
const LIT_BODY_OPACITY = 0.26

export interface BodyPicksContext {
  partGroup: THREE.Group
  raycaster: THREE.Raycaster
  camera: () => THREE.Camera
  canvas: HTMLElement
  setPickRay(clientX: number, clientY: number): void
  /** Dim the bodies not in play, or none. */
  setDimmed(ids: ReadonlySet<number>): void
  /** Whether the bodies are drawn solid — then what lies behind one is
   *  hidden, and is not picked. */
  bodiesSolid(): boolean
  /** The part's size, which how far the camera moves before the
   *  silhouettes are made again goes by. */
  modelRadius(): number
  invalidate(): void
}

interface Entry {
  id: number
  mesh: THREE.Mesh
  topology: BodyTopology
  faceByHash: Map<number, FaceInfo>
  /** The triangles of each face: start and count, from the mesh's
   *  per-triangle face hashes — the kernel meshes face by face, so a face's
   *  triangles are one run. */
  ranges: Map<number, [number, number]>
  faceHash: Int32Array
  /** Whether two of its faces, by hash, lie on one surface. */
  oneSurface: OneSurface
  /** The edges drawn at rest and the edges' shares, worked out once for the
   *  mesh. */
  lines: BodyLines
  /** The body's corners: the ends of its edges, each once. */
  vertices: [number, number, number][]
  /** The triangles of the faces that are not flat — the ones with a
   *  silhouette to draw (core/re/silhouette). */
  round: [number, number][]
}

/** A body's lines: its faces' outlines as segments, the sharp edges and
 *  the tangent ones apart — what is drawn at rest — and each edge's share
 *  of them with how its faces meet, worked out the first time an edge is
 *  picked or lit. */
interface BodyLines {
  rest: { sharp: Float32Array; tangent: Float32Array }
  shares: EdgeShares | null
}

/** The lines of each mesh, by its positions: the bodies are drawn anew
 *  whenever one is shown, hidden or recoloured, with the meshes of the last
 *  build, and a mesh's lines are the same each time. */
const linesByMesh = new WeakMap<object, BodyLines>()

/** The ends of the edges, each place once — a closed edge's two ends are
 *  one seam point, kept: a full circle's start is a place like any other. */
function cornersOf(edges: readonly EdgeInfo[]): [number, number, number][] {
  const seen = new Set<string>()
  const out: [number, number, number][] = []
  for (const e of edges) {
    for (const p of e.ends) {
      const k = `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)},${Math.round(p[2] * 1000)}`
      if (seen.has(k)) continue
      seen.add(k)
      out.push([p[0], p[1], p[2]])
    }
  }
  return out
}

/** A body's mesh, with its BVH: built the first time a ray is cast at it,
 *  not with the mesh — the bodies are drawn anew whenever one is shown,
 *  hidden or recoloured, and most of those are never cast at. Without one
 *  every triangle is tested: 2.7 ms a ray on an 86 000-triangle body,
 *  against 0.01 ms with it, where a hover casts up to ten a frame.
 *  Indirect, so the triangles keep their order: a tree of the ordinary
 *  kind sorts the index buffer, and a body's triangles are named by their
 *  place in it — the face each lies on, the runs the silhouettes walk. */
export function withBoundsTree(mesh: THREE.Mesh): THREE.Mesh {
  const geometry = mesh.geometry as THREE.BufferGeometry
  // The package reads `indirect`; its typings (0.8.3) leave it out.
  if (!geometry.boundsTree) geometry.computeBoundsTree({ indirect: true } as MeshBVHOptions)
  return mesh
}

const vertexKey = (bodyId: number, p: readonly number[]) => `${bodyId}:${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)},${Math.round(p[2] * 1000)}`

const key = (bodyId: number, hash: number) => `${bodyId}:${hash}`

export class BodyPicks {
  private group = new THREE.Group()
  private entries = new Map<number, Entry>()
  private mode: BodyPickMode | null = null
  private inPlay: ReadonlySet<number> | null = null
  private pickedFaces = new Set<string>()
  private pickedEdges = new Set<string>()
  /** Edges a feature reaches along a tangent chain from the picked ones. */
  private chainEdges = new Set<string>()
  /** Bodies a preview stands in for: their edges at rest are put away. */
  private replaced: ReadonlySet<number> = new Set()
  /** The edges of the preview that stands in for them, what they are drawn
   *  from, and the map that carries them with the ghost. */
  private previewLines: { line: LineSegments2; geo: LineSegmentsGeometry }[] = []
  private previewRest: { sharp: Float32Array; tangent: Float32Array } | null = null
  private previewMatrix: readonly number[] | null = null
  private tangentEdges: TangentEdges = 'visible'
  private hoveredFace: BodyFaceHit | null = null
  private hoveredEdge: BodyEdgeHit | null = null
  private hoveredVertex: BodyVertexHit | null = null
  private pickedVertices: BodyVertexHit[] = []
  private vertexLights: { points: THREE.Points; geo: THREE.BufferGeometry; mat: THREE.PointsMaterial }[] = []
  private faceLights: { key: string; mesh: THREE.Mesh; geo: THREE.BufferGeometry; mat: THREE.MeshBasicMaterial }[] = []
  /** The edges at rest: a line of segments for each body's sharp edges and
   *  one for its tangent edges, the latter in the fainter material while
   *  they are dimmed. */
  /** Each body's edges at rest, one block per body and kind (`id:sharp`,
   *  `id:tangent`) — kept while the body's lines and their material stay,
   *  shown or hidden with the body, so a body's eye uploads nothing. */
  private edgeBlocks = new Map<string, { line: LineSegments2; geo: LineSegmentsGeometry; segments: Float32Array; material: LineMaterial }>()
  private edgeMaterial: LineMaterial | null = null
  private dimmedMaterial: LineMaterial | null = null
  /** The round faces' outlines from where the camera stands, drawn as the
   *  edges are, and the view they were made for: a direction (the
   *  orthographic camera) or an eye, in the part's frame. Made again when
   *  the camera has turned or the bodies changed. */
  private silhouettes = new Map<number, { line: LineSegments2 | null; geo: LineSegmentsGeometry | null; mesh: THREE.Mesh; stamp: number }>()
  private silhouetteView: { ortho: boolean; v: THREE.Vector3 } | null = null
  /** Counts the camera's turns: a body's silhouette made at another count
   *  is made again before it is shown. */
  private silhouetteStamp = 0
  /** The bodies changed since the silhouettes were looked at. */
  private silhouetteDirty = false
  private openLines: { line: Line2; geo: LineGeometry }[] = []
  private openMaterial: LineMaterial | null = null
  private edgeLights: { key: string; line: LineSegments2; geo: LineSegmentsGeometry; mat: LineMaterial }[] = []
  /** Whole bodies lit, by id — see setLit — and what draws them. */
  private litBodies: readonly number[] = []
  private bodyLights: { object: THREE.Mesh | LineSegments2; geo: THREE.BufferGeometry; mat: THREE.Material }[] = []
  private resolution = new THREE.Vector2(1, 1)
  private clipping: THREE.Plane[] | null = null
  private lineScale = 1

  constructor(private ctx: BodyPicksContext) {
    ctx.partGroup.add(this.group)
  }

  /** The bodies as drawn, with their topology and their meshes' face hashes. */
  setBodies(items: readonly { id: number; mesh: THREE.Mesh; faceHash?: Int32Array; topology?: BodyTopology }[]): void {
    // A body drawn from the same mesh, topology and hashes as before keeps
    // what was worked out for it.
    const before = this.entries
    this.entries = new Map()
    let changed = before.size !== items.length
    for (const item of items) {
      if (!item.topology || !item.faceHash) continue
      const kept = before.get(item.id)
      if (kept && kept.mesh === item.mesh && kept.topology === item.topology && kept.faceHash === item.faceHash) {
        this.entries.set(item.id, kept)
        continue
      }
      changed = true
      const ranges = new Map<number, [number, number]>()
      const h = item.faceHash
      for (let t = 0; t < h.length; ) {
        let end = t + 1
        while (end < h.length && h[end] === h[t]) end++
        const run = ranges.get(h[t])
        // A face split across runs is joined into one range only when the
        // runs touch; the kernel keeps them together, so this is the rule.
        if (run && run[0] + run[1] === t) run[1] += end - t
        else if (!run) ranges.set(h[t], [t, end - t])
        t = end
      }
      const round = item.topology.faces.filter((f) => f.fingerprint.kind !== 'plane').flatMap((f) => (ranges.has(f.hash) ? [ranges.get(f.hash)!] : []))
      const faceByHash = new Map(item.topology.faces.map((f) => [f.hash, f]))
      const oneSurface: OneSurface = (a, b) => {
        const fa = faceByHash.get(a)
        const fb = faceByHash.get(b)
        return fa !== undefined && fb !== undefined && onOneSurface(fa.fingerprint, fb.fingerprint)
      }
      const geometry = item.mesh.geometry as THREE.BufferGeometry
      const position = geometry.getAttribute('position')
      const normal = geometry.getAttribute('normal')
      const index = geometry.getIndex()
      let lines = position ? linesByMesh.get(position.array) : undefined
      if (!lines) {
        const empty = new Float32Array(0)
        lines = { rest: position && normal && index ? restSegments(position.array, normal.array, index.array, item.faceHash, oneSurface) : { sharp: empty, tangent: empty }, shares: null }
        if (position) linesByMesh.set(position.array, lines)
      }
      this.entries.set(item.id, { id: item.id, mesh: item.mesh, topology: item.topology, faceByHash, ranges, faceHash: item.faceHash, oneSurface, lines, vertices: cornersOf(item.topology.edges), round })
    }
    if (changed) {
      this.hoveredFace = null
      this.hoveredEdge = null
      this.hoveredVertex = null
    }
    this.rebuild()
  }

  /** Arm the faces or the edges of the bodies in play (null: all of them)
   *  as click targets, or (null mode) stand down. */
  setMode(mode: BodyPickMode | null, inPlay: readonly number[] | null): void {
    this.mode = mode
    this.inPlay = inPlay ? new Set(inPlay) : null
    this.hoveredFace = null
    this.hoveredEdge = null
    this.hoveredVertex = null
    const dimmed = new Set<number>()
    if (mode && this.inPlay) for (const id of this.entries.keys()) if (!this.inPlay.has(id)) dimmed.add(id)
    this.ctx.setDimmed(dimmed)
    this.rebuild()
  }

  /** Draw these polylines as the open edges of a trimmed set that did not
   *  close — fat lines in the alarm colour, ahead of the depth buffer,
   *  whatever the pick mode. */
  setOpenEdges(polylines: readonly Float32Array[]): void {
    for (const l of this.openLines) {
      this.group.remove(l.line)
      l.geo.dispose()
    }
    this.openLines = []
    this.openMaterial?.dispose()
    this.openMaterial = null
    if (polylines.length === 0) {
      this.ctx.invalidate()
      return
    }
    this.openMaterial = new LineMaterial({ color: new THREE.Color(OPEN_COLOR).getHex(), linewidth: (SECTION_LINE_DEFAULT + 2) * this.lineScale, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, worldUnits: false })
    this.openMaterial.resolution.copy(this.resolution)
    for (const p of polylines) {
      if (p.length < 6) continue
      const geo = new LineGeometry()
      geo.setPositions(Array.from(p))
      const line = new Line2(geo, this.openMaterial)
      line.computeLineDistances()
      line.renderOrder = 7
      this.group.add(line)
      this.openLines.push({ line, geo })
    }
    this.ctx.invalidate()
  }

  /** Light the faces and edges a feature has picked, and — fainter — the
   *  edges its tangent chains run on along. */
  setPicked(faces: readonly { bodyId: number; hash: number }[], edges: readonly { bodyId: number; hash: number }[], chain: readonly { bodyId: number; hash: number }[] = [], vertices: readonly BodyVertexHit[] = []): void {
    this.pickedVertices = [...vertices]
    this.pickedFaces = new Set(faces.map((f) => key(f.bodyId, f.hash)))
    this.pickedEdges = new Set(edges.map((e) => key(e.bodyId, e.hash)))
    this.chainEdges = new Set(chain.map((e) => key(e.bodyId, e.hash)).filter((k) => !this.pickedEdges.has(k)))
    this.rebuildLights()
  }

  /** Light whole bodies — those whose rows the pointer is on in the body
   *  list — whatever is armed, and whether or not their eyes are open: a
   *  hidden body's row shows where it would stand. None with an empty list.
   *  Kept through a rebuild of the bodies. */
  setLit(ids: readonly number[]): void {
    if (ids.length === this.litBodies.length && ids.every((id, i) => id === this.litBodies[i])) return
    this.litBodies = [...ids]
    this.rebuildBodyLights()
    this.ctx.invalidate()
  }

  /** The bodies lit by setLit. */
  lit(): readonly number[] {
    return this.litBodies
  }

  /** The bodies a preview stands in for, and the preview's own edges — the
   *  outlines of its mesh's faces, drawn as a body's are, though with no
   *  faces to tell a split by: the replaced bodies' edges at rest are put
   *  away, the preview's drawn in their place, so the viewport shows the
   *  body as the feature would leave it. */
  setPreviewEdges(replaced: readonly number[], mesh: { positions: Float32Array; normals: Float32Array; indices: Uint32Array; faceHash?: Int32Array } | null): void {
    this.replaced = new Set(replaced)
    this.previewRest = mesh ? restSegments(mesh.positions, mesh.normals, mesh.indices, mesh.faceHash ?? null) : null
    this.previewMatrix = null
    this.rebuild()
  }

  /** The preview's edges carried by the same map as its ghost — see
   *  reScene setBodyPreviewStretch — or put back where they were drawn with
   *  null. Lines drawn afresh by a new preview start where they were drawn. */
  setPreviewMatrix(matrix: readonly number[] | null): void {
    this.previewMatrix = matrix
    for (const { line } of this.previewLines) this.placePreviewLine(line)
    this.ctx.invalidate()
  }

  private placePreviewLine(line: LineSegments2): void {
    if (this.previewMatrix) {
      line.matrixAutoUpdate = false
      line.matrix.fromArray(this.previewMatrix)
    } else {
      line.matrixAutoUpdate = true
      line.updateMatrix()
    }
    line.matrixWorldNeedsUpdate = true
  }

  /** How the tangent edges are drawn — see TangentEdges. Left out, they
   *  cannot be picked either. */
  setTangentEdges(mode: TangentEdges): void {
    if (mode === this.tangentEdges) return
    this.tangentEdges = mode
    if (this.hoveredEdge && !this.shows(this.hoveredEdge.bodyId, this.hoveredEdge.edge)) this.hoveredEdge = null
    this.rebuild()
  }

  picking(): boolean {
    return this.mode !== null && this.entries.size > 0
  }

  /** A body's face as drawn, by its hash — the faces beside an edge a
   *  patch network's curve runs along. */
  faceOf(bodyId: number, hash: number): FaceInfo | null {
    return this.entries.get(bodyId)?.faceByHash.get(hash) ?? null
  }

  pickMode(): BodyPickMode | null {
    return this.mode
  }

  hovered(): boolean {
    return this.hoveredFace !== null || this.hoveredEdge !== null || this.hoveredVertex !== null
  }

  private playing(id: number): boolean {
    const e = this.entries.get(id)
    return e !== undefined && e.mesh.visible && (this.inPlay === null || this.inPlay.has(id))
  }

  /** A body's edges' shares of its outlines and how their faces meet. */
  private shares(entry: Entry): EdgeShares {
    if (!entry.lines.shares) {
      const geometry = entry.mesh.geometry as THREE.BufferGeometry
      const position = geometry.getAttribute('position')
      const normal = geometry.getAttribute('normal')
      const index = geometry.getIndex()
      entry.lines.shares = position && index ? edgeShares(position.array, normal?.array ?? null, index.array, entry.faceHash, entry.topology.edges, entry.oneSurface) : { segments: new Map(), joins: new Map() }
    }
    return entry.lines.shares
  }

  /** Whether an edge is drawn, and so there to pick: not a seam nor a
   *  split, nor a tangent edge while those are left out. */
  private shows(bodyId: number, edge: EdgeInfo): boolean {
    const entry = this.entries.get(bodyId)
    const join = entry ? this.shares(entry).joins.get(edge.hash) : undefined
    return join === undefined || join === 'sharp' || (join === 'tangent' && this.tangentEdges !== 'removed')
  }

  /** The face under a client point, if faces are armed. */
  faceAt(clientX: number, clientY: number): BodyFaceHit | null {
    return this.facesAlong(clientX, clientY, true)[0] ?? null
  }

  /** The faces the pick ray through a client point meets, if faces are
   *  armed — the nearest first, each face once however often the ray
   *  passes through it; with `first`, only the nearest. */
  private facesAlong(clientX: number, clientY: number, first = false): BodyFaceHit[] {
    if (this.mode !== 'faces' && this.mode !== 'all') return []
    const meshes: THREE.Mesh[] = []
    for (const e of this.entries.values()) if (this.playing(e.id)) meshes.push(e.mesh)
    if (meshes.length === 0) return []
    this.ctx.setPickRay(clientX, clientY)
    this.ctx.partGroup.updateWorldMatrix(true, true)
    const hits = this.cast(meshes, !first)
    const out: BodyFaceHit[] = []
    const seen = new Set<string>()
    for (const hit of hits) {
      if (hit.faceIndex === undefined || hit.faceIndex === null) continue
      const entry = [...this.entries.values()].find((e) => e.mesh === hit.object)
      if (!entry) continue
      const hash = this.hashOfTriangle(entry, hit.faceIndex)
      const face = hash === null ? undefined : entry.faceByHash.get(hash)
      if (!face || seen.has(key(entry.id, face.hash))) continue
      seen.add(key(entry.id, face.hash))
      out.push({ bodyId: entry.id, face, edges: entry.topology.edges.filter((e) => e.faces.includes(face.hash)), distance: hit.distance })
      if (first) break
    }
    return out
  }

  private hashOfTriangle(entry: Entry, triangle: number): number | null {
    for (const [hash, [start, count]] of entry.ranges) if (triangle >= start && triangle < start + count) return hash
    return null
  }

  /** The edge under a client point, within a few pixels on screen, if edges
   *  are armed. */
  edgeAt(clientX: number, clientY: number): BodyEdgeHit | null {
    if (this.mode !== 'edges' && this.mode !== 'all') return null
    const toScreen = this.screenProjection()
    const near = this.edgesNear(clientX, clientY, toScreen)
    if (!this.ctx.bodiesSolid()) return near[0]?.hit ?? null
    for (const n of near.slice(0, 8)) if (!this.hidden(n.at, toScreen)) return n.hit
    return null
  }

  /** Every edge within reach of a client point, with the point on it
   *  nearest the cursor — the nearest first. */
  private edgesNear(clientX: number, clientY: number, toScreen: (x: number, y: number, z: number) => [number, number]): { hit: BodyEdgeHit; d: number; at: THREE.Vector3 }[] {
    const near: { hit: BodyEdgeHit; d: number; at: THREE.Vector3 }[] = []
    for (const e of this.entries.values()) {
      if (!this.playing(e.id)) continue
      for (const edge of e.topology.edges) {
        const p = edge.polyline
        if (p.length < 6 || !this.shows(e.id, edge)) continue
        let bestD = EDGE_REACH_PX
        let at: THREE.Vector3 | null = null
        let a = toScreen(p[0], p[1], p[2])
        for (let i = 3; i + 2 < p.length; i += 3) {
          const b = toScreen(p[i], p[i + 1], p[i + 2])
          const d = distToSegment2([clientX, clientY], a, b)
          if (d < bestD) {
            bestD = d
            const t = segmentParameter(clientX, clientY, a, b)
            at = new THREE.Vector3(p[i - 3] + (p[i] - p[i - 3]) * t, p[i - 2] + (p[i + 1] - p[i - 2]) * t, p[i - 1] + (p[i + 2] - p[i - 1]) * t)
          }
          a = b
        }
        if (at) near.push({ hit: { bodyId: e.id, edge }, d: bestD, at })
      }
    }
    return near.sort((x, y) => x.d - y.d)
  }

  /** A point of the part, in its coordinates, as client pixels. */
  private screenProjection(): (x: number, y: number, z: number) => [number, number] {
    const rect = this.ctx.canvas.getBoundingClientRect()
    const camera = this.ctx.camera()
    this.ctx.partGroup.updateWorldMatrix(true, false)
    const m = this.ctx.partGroup.matrixWorld
    const v = new THREE.Vector3()
    return (x, y, z) => {
      v.set(x, y, z).applyMatrix4(m).project(camera)
      return [rect.left + ((v.x + 1) / 2) * rect.width, rect.top + ((1 - v.y) / 2) * rect.height]
    }
  }

  /** A point of the bodies under a client point, whatever is armed — for an
   *  editor that asks for a place on the part rather than a face or an
   *  edge: the corner within reach, else where the pick ray first meets a
   *  visible body, with how far along the ray that is (0 for a corner,
   *  which is taken ahead of any surface). In the part's coordinates. */
  pointAt(clientX: number, clientY: number): { point: [number, number, number]; distance: number; corner: boolean } | null {
    const corner = this.cornerAt(clientX, clientY)
    if (corner) return { point: corner.point, distance: 0, corner: true }
    const meshes: THREE.Mesh[] = []
    for (const e of this.entries.values()) if (e.mesh.visible) meshes.push(e.mesh)
    if (meshes.length === 0) return null
    this.ctx.setPickRay(clientX, clientY)
    this.ctx.partGroup.updateWorldMatrix(true, true)
    const hit = this.cast(meshes)[0]
    if (!hit) return null
    const p = this.ctx.partGroup.worldToLocal(hit.point.clone())
    return { point: [p.x, p.y, p.z], distance: hit.distance, corner: false }
  }

  /** The corner under a client point, within reach on screen, with nothing
   *  armed but the selection — a corner is read, never asked for. */
  vertexAt(clientX: number, clientY: number): BodyVertexHit | null {
    if (this.mode !== 'all') return null
    return this.cornerAt(clientX, clientY)
  }

  private cornerAt(clientX: number, clientY: number): BodyVertexHit | null {
    const toScreen = this.screenProjection()
    const near = this.cornersNear(clientX, clientY, toScreen)
    if (!this.ctx.bodiesSolid()) return near[0]?.hit ?? null
    for (const n of near.slice(0, 8)) if (!this.hidden(new THREE.Vector3(...n.hit.point), toScreen)) return n.hit
    return null
  }

  /** Every corner within reach of a client point — the nearest first. */
  private cornersNear(clientX: number, clientY: number, toScreen: (x: number, y: number, z: number) => [number, number]): { hit: BodyVertexHit; d: number }[] {
    const near: { hit: BodyVertexHit; d: number }[] = []
    for (const e of this.entries.values()) {
      if (!this.playing(e.id)) continue
      for (const p of e.vertices) {
        const s = toScreen(p[0], p[1], p[2])
        const d = Math.hypot(s[0] - clientX, s[1] - clientY)
        if (d <= VERTEX_REACH_PX) near.push({ hit: { bodyId: e.id, point: p }, d })
      }
    }
    return near.sort((x, y) => x.d - y.d)
  }

  /**
   * Everything of what is armed under a client point, in the order the
   * arrow keys step through it: the corners within reach, then the edges,
   * then the faces the pick ray meets — of each, what can be seen before
   * what lies behind a body, and the faces from the front back. The first
   * of it that can be seen is what a click takes unasked; the rest is what
   * the arrow keys reach — the far side of a body, a body behind another.
   */
  candidatesAt(clientX: number, clientY: number): BodyCandidate[] {
    const out: BodyCandidate[] = []
    if (this.mode === null) return out
    const toScreen = this.screenProjection()
    const solid = this.ctx.bodiesSolid()
    /** The nearest few within reach, those in sight first. */
    const seenFirst = <T>(near: T[], at: (n: T) => THREE.Vector3): T[] => {
      const few = near.slice(0, 8)
      if (!solid) return few
      const hidden = few.map((n) => this.hidden(at(n), toScreen))
      return [...few.filter((_, i) => !hidden[i]), ...few.filter((_, i) => hidden[i])]
    }
    if (this.mode === 'all') {
      for (const n of seenFirst(this.cornersNear(clientX, clientY, toScreen), (n) => new THREE.Vector3(...n.hit.point))) out.push({ kind: 'vertex', hit: n.hit })
    }
    if (this.mode === 'edges' || this.mode === 'all') {
      for (const n of seenFirst(this.edgesNear(clientX, clientY, toScreen), (n) => n.at)) out.push({ kind: 'edge', hit: n.hit })
    }
    for (const hit of this.facesAlong(clientX, clientY)) out.push({ kind: 'face', hit })
    return out
  }

  /** Whether a candidate is what is lit under the cursor now. */
  isHovered(c: BodyCandidate): boolean {
    if (c.kind === 'vertex') return this.hoveredVertex !== null && vertexKey(c.hit.bodyId, c.hit.point) === vertexKey(this.hoveredVertex.bodyId, this.hoveredVertex.point)
    if (c.kind === 'edge') return this.hoveredEdge !== null && key(c.hit.bodyId, c.hit.edge.hash) === key(this.hoveredEdge.bodyId, this.hoveredEdge.edge.hash)
    return this.hoveredFace !== null && key(c.hit.bodyId, c.hit.face.hash) === key(this.hoveredFace.bodyId, this.hoveredFace.face.hash)
  }

  /**
   * What a window dragged on screen takes, of what is armed: dragged to the
   * right, the faces and edges lying wholly inside it; dragged to the left,
   * those it touches as well — the way AutoCAD and Fusion tell a window from
   * a crossing. What lies behind the body is taken with the rest, as their
   * window selection takes it: the far edges of a box are what a fillet all
   * round it wants.
   */
  itemsInWindow(x0: number, y0: number, x1: number, y1: number): BodyWindowHit {
    const out: BodyWindowHit = { faces: [], edges: [] }
    if (this.mode === null) return out
    const crossing = x1 < x0
    const left = Math.min(x0, x1)
    const right = Math.max(x0, x1)
    const top = Math.min(y0, y1)
    const bottom = Math.max(y0, y1)
    const inside = (p: [number, number]) => p[0] >= left && p[0] <= right && p[1] >= top && p[1] <= bottom
    const toScreen = this.screenProjection()
    const wantEdges = this.mode === 'edges' || this.mode === 'all'
    const wantFaces = this.mode === 'faces' || this.mode === 'all'
    for (const e of this.entries.values()) {
      if (!this.playing(e.id)) continue
      if (wantEdges) {
        for (const edge of e.topology.edges) {
          const p = edge.polyline
          if (p.length < 6 || !this.shows(e.id, edge)) continue
          const pts: [number, number][] = []
          for (let i = 0; i + 2 < p.length; i += 3) pts.push(toScreen(p[i], p[i + 1], p[i + 2]))
          const all = pts.every(inside)
          let take = all
          if (!take && crossing) {
            take = pts.some(inside)
            for (let i = 1; !take && i < pts.length; i++) take = segmentMeetsBox(pts[i - 1], pts[i], left, top, right, bottom)
          }
          if (take) out.edges.push({ bodyId: e.id, edge })
        }
      }
      if (wantFaces) {
        const geometry = e.mesh.geometry as THREE.BufferGeometry
        const position = geometry.getAttribute('position')
        const index = geometry.getIndex()
        if (!position || !index) continue
        for (const face of e.topology.faces) {
          const range = e.ranges.get(face.hash)
          if (!range) continue
          let all = true
          let any = false
          for (let t = range[0] * 3; t < (range[0] + range[1]) * 3; t++) {
            const v = index.getX(t)
            const hit = inside(toScreen(position.getX(v), position.getY(v), position.getZ(v)))
            if (hit) any = true
            else all = false
            if (crossing ? any : !all) break
          }
          if (crossing ? any : all) out.faces.push({ bodyId: e.id, face, edges: e.topology.edges.filter((x) => x.faces.includes(face.hash)) })
        }
      }
    }
    return out
  }

  /** Whether a point on a body (the part's coordinates) lies behind a body
   *  as the camera sees it: a ray through the point's place on screen meets
   *  a body's face clearly nearer than the point. */
  /** Where the pick ray, aimed already, meets these meshes — the nearest
   *  first: with `all`, every surface it passes through, as stepping to the
   *  faces behind wants; else the first it meets on each mesh, which is all
   *  a pick or a test of what hides a point needs and what a BVH answers
   *  without walking the rest of the ray. */
  private cast(meshes: readonly THREE.Mesh[], all = false): THREE.Intersection[] {
    for (const mesh of meshes) withBoundsTree(mesh)
    const raycaster = this.ctx.raycaster as THREE.Raycaster & { firstHitOnly?: boolean }
    const was = raycaster.firstHitOnly
    raycaster.firstHitOnly = !all
    try {
      return raycaster.intersectObjects(meshes as THREE.Mesh[], false)
    } finally {
      raycaster.firstHitOnly = was
    }
  }

  private hidden(at: THREE.Vector3, toScreen: (x: number, y: number, z: number) => [number, number]): boolean {
    const meshes: THREE.Mesh[] = []
    for (const e of this.entries.values()) if (e.mesh.visible) meshes.push(e.mesh)
    if (meshes.length === 0) return false
    const [sx, sy] = toScreen(at.x, at.y, at.z)
    this.ctx.setPickRay(sx, sy)
    const world = at.clone().applyMatrix4(this.ctx.partGroup.matrixWorld)
    const reach = world.distanceTo(this.ctx.raycaster.ray.origin)
    const first = this.cast(meshes)[0]
    // An edge lies on the faces it bounds, so its own faces are met at its
    // own distance, give or take the tessellation's chord.
    return first !== undefined && first.distance < reach - Math.max(0.3, reach * 2e-3)
  }

  /** Light what is under the cursor. Returns whether anything changed. */
  setHovered(face: BodyFaceHit | null, edge: BodyEdgeHit | null, vertex: BodyVertexHit | null = null): boolean {
    const faceKey = face ? key(face.bodyId, face.face.hash) : null
    const wasFace = this.hoveredFace ? key(this.hoveredFace.bodyId, this.hoveredFace.face.hash) : null
    const edgeKey = edge ? key(edge.bodyId, edge.edge.hash) : null
    const wasEdge = this.hoveredEdge ? key(this.hoveredEdge.bodyId, this.hoveredEdge.edge.hash) : null
    const vertexK = vertex ? vertexKey(vertex.bodyId, vertex.point) : null
    const wasVertex = this.hoveredVertex ? vertexKey(this.hoveredVertex.bodyId, this.hoveredVertex.point) : null
    if (faceKey === wasFace && edgeKey === wasEdge && vertexK === wasVertex) return false
    this.hoveredFace = face
    this.hoveredEdge = edge
    this.hoveredVertex = vertex
    this.rebuildLights()
    return true
  }

  /** Cut the edges where the part is cut open — see the scene's
   *  setSlicePlane. The planes are let out a hair, so the edges lying in
   *  the cut itself are kept. */
  setClipping(planes: readonly THREE.Plane[] | null): void {
    this.clipping = planes ? planes.map((p) => new THREE.Plane(p.normal.clone(), p.constant + 0.02)) : null
    for (const m of [this.edgeMaterial, this.dimmedMaterial]) {
      if (!m) continue
      m.clippingPlanes = this.clipping
      m.needsUpdate = true
    }
    this.rebuildLights()
    this.rebuildBodyLights()
  }

  setResolution(width: number, height: number): void {
    if (this.resolution.x === width && this.resolution.y === height) return
    this.resolution.set(width, height)
    if (this.edgeMaterial) this.edgeMaterial.resolution.copy(this.resolution)
    if (this.dimmedMaterial) this.dimmedMaterial.resolution.copy(this.resolution)
    if (this.openMaterial) this.openMaterial.resolution.copy(this.resolution)
    for (const l of this.edgeLights) l.mat.resolution.copy(this.resolution)
    for (const l of this.bodyLights) if (l.mat instanceof LineMaterial) l.mat.resolution.copy(this.resolution)
    this.ctx.invalidate()
  }

  setLineWidth(px: number): void {
    const scale = px / SECTION_LINE_DEFAULT
    if (scale === this.lineScale) return
    this.lineScale = scale
    this.sizeRestLines()
    for (const l of this.edgeLights) l.mat.linewidth = EDGE_LIT_PX * scale
    for (const l of this.bodyLights) if (l.mat instanceof LineMaterial) l.mat.linewidth = EDGE_WIDTH_ARMED_PX * scale
    this.ctx.invalidate()
  }

  /** Once a tick: the silhouettes follow the camera. A camera that has
   *  not turned (or, in perspective, moved) since they were made costs a
   *  comparison. */
  updateView(): void {
    if (!this.edgeMaterial) return
    const camera = this.ctx.camera()
    const ortho = (camera as THREE.OrthographicCamera).isOrthographicCamera === true
    this.ctx.partGroup.updateWorldMatrix(true, false)
    const toPart = new THREE.Matrix4().copy(this.ctx.partGroup.matrixWorld).invert()
    const v = ortho ? camera.getWorldDirection(new THREE.Vector3()).transformDirection(toPart) : camera.getWorldPosition(new THREE.Vector3()).applyMatrix4(toPart)
    const last = this.silhouetteView
    // A fifth of a degree of turn, or a thousandth of the part of travel.
    const turned = !(last && last.ortho === ortho && (ortho ? last.v.dot(v) > 0.999994 : last.v.distanceTo(v) < this.ctx.modelRadius() * 1e-3))
    if (!turned && !this.silhouetteDirty) return
    if (turned) {
      this.silhouetteView = { ortho, v }
      this.silhouetteStamp++
    }
    this.silhouetteDirty = false
    const view = this.silhouetteView!
    let changed = false
    const drop = (id: number) => {
      const s = this.silhouettes.get(id)
      if (!s) return
      if (s.line) this.group.remove(s.line)
      s.geo?.dispose()
      this.silhouettes.delete(id)
      changed = true
    }
    for (const [id, s] of this.silhouettes) if (this.entries.get(id)?.mesh !== s.mesh) drop(id)
    // Each body's own, made for the camera as it stands when it is shown;
    // a body hidden keeps its own, hidden with it.
    for (const e of this.entries.values()) {
      const shown = e.mesh.visible && !this.replaced.has(e.id) && e.round.length > 0
      let s = this.silhouettes.get(e.id)
      if (shown && s?.stamp !== this.silhouetteStamp) {
        drop(e.id)
        const geo = e.mesh.geometry as THREE.BufferGeometry
        const position = geo.getAttribute('position')
        const normal = geo.getAttribute('normal')
        const index = geo.getIndex()
        if (!position || !normal || !index) continue
        const segments = silhouetteSegments(position.array, normal.array, index.array, e.round, view.ortho ? { dir: [view.v.x, view.v.y, view.v.z] } : { eye: [view.v.x, view.v.y, view.v.z] })
        s = { line: null, geo: null, mesh: e.mesh, stamp: this.silhouetteStamp }
        if (segments.length > 0) {
          s.geo = new LineSegmentsGeometry()
          s.geo.setPositions(segments)
          s.line = new LineSegments2(s.geo, this.edgeMaterial)
          s.line.renderOrder = 5
          this.group.add(s.line)
        }
        this.silhouettes.set(e.id, s)
        changed = true
      }
      if (s?.line && s.line.visible !== shown) {
        s.line.visible = shown
        changed = true
      }
    }
    if (changed) this.ctx.invalidate()
  }

  /** The edges at rest as wide as the line width and what is armed say. */
  private sizeRestLines(): void {
    const width = (this.mode === 'edges' || this.mode === 'all' ? EDGE_WIDTH_ARMED_PX : EDGE_WIDTH_PX) * this.lineScale
    if (this.edgeMaterial) this.edgeMaterial.linewidth = width
    if (this.dimmedMaterial) this.dimmedMaterial.linewidth = width
  }

  /** The edges of every body on show, thin and behind what hides them —
   *  all but those of a body a preview stands in for, whose edges the
   *  preview's stand in for — then the lights. */
  private rebuild(): void {
    // The silhouettes are of these bodies as they now are: looked over at
    // the next tick.
    this.silhouetteDirty = true
    for (const l of this.previewLines) {
      this.group.remove(l.line)
      l.geo.dispose()
    }
    this.previewLines = []
    const material = (opacity: number) => {
      const m = new LineMaterial({ color: new THREE.Color(EDGE_COLOR).getHex(), linewidth: EDGE_WIDTH_PX * this.lineScale, transparent: true, opacity, depthTest: true, depthWrite: false, worldUnits: false })
      m.resolution.copy(this.resolution)
      m.clippingPlanes = this.clipping
      return m
    }
    this.edgeMaterial ??= material(EDGE_OPACITY)
    this.dimmedMaterial ??= material(TANGENT_DIMMED_OPACITY)
    this.sizeRestLines()
    const tangentMaterial = this.tangentEdges === 'visible' ? this.edgeMaterial : this.tangentEdges === 'dimmed' ? this.dimmedMaterial : null
    const draw = (segments: Float32Array, m: LineMaterial | null, into: { line: LineSegments2; geo: LineSegmentsGeometry }[]) => {
      if (!m || segments.length < 6) return
      const geo = new LineSegmentsGeometry()
      geo.setPositions(segments)
      const line = new LineSegments2(geo, m)
      line.renderOrder = 5
      this.group.add(line)
      into.push({ line, geo })
    }
    // Each body's block kept while its lines and their material stay.
    const wanted = new Set<string>()
    for (const e of this.entries.values()) {
      const shown = e.mesh.visible && !this.replaced.has(e.id)
      for (const [kind, segments, m] of [['sharp', e.lines.rest.sharp, this.edgeMaterial], ['tangent', e.lines.rest.tangent, tangentMaterial]] as const) {
        if (!m || segments.length < 6) continue
        const key = `${e.id}:${kind}`
        wanted.add(key)
        let block = this.edgeBlocks.get(key)
        if (block && (block.segments !== segments || block.material !== m)) {
          this.group.remove(block.line)
          block.geo.dispose()
          block = undefined
        }
        if (!block) {
          const geo = new LineSegmentsGeometry()
          geo.setPositions(segments)
          const line = new LineSegments2(geo, m)
          line.renderOrder = 5
          this.group.add(line)
          this.edgeBlocks.set(key, (block = { line, geo, segments, material: m }))
        }
        block.line.visible = shown
      }
    }
    for (const [key, block] of this.edgeBlocks) {
      if (wanted.has(key)) continue
      this.group.remove(block.line)
      block.geo.dispose()
      this.edgeBlocks.delete(key)
    }
    if (this.previewRest) {
      draw(this.previewRest.sharp, this.edgeMaterial, this.previewLines)
      draw(this.previewRest.tangent, tangentMaterial, this.previewLines)
      for (const { line } of this.previewLines) this.placePreviewLine(line)
    }
    this.rebuildLights()
    this.rebuildBodyLights()
  }

  /** The whole bodies lit (setLit): each its own triangles in a flat
   *  see-through fill drawn over everything, and its edges over its own
   *  faces — a body a preview stands in for is not drawn, nor lit. */
  private rebuildBodyLights(): void {
    for (const l of this.bodyLights) {
      this.group.remove(l.object)
      l.geo.dispose()
      l.mat.dispose()
    }
    this.bodyLights = []
    for (const id of this.litBodies) {
      const entry = this.entries.get(id)
      if (!entry || this.replaced.has(id)) continue
      const source = entry.mesh.geometry as THREE.BufferGeometry
      const index = source.getIndex()
      if (!index) continue
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', source.getAttribute('position'))
      geo.setIndex(index)
      const mat = new THREE.MeshBasicMaterial({ color: LIT_BODY_COLOR, transparent: true, opacity: LIT_BODY_OPACITY, side: THREE.DoubleSide, depthTest: false, depthWrite: false })
      mat.clippingPlanes = this.clipping
      const mesh = new THREE.Mesh(geo, mat)
      mesh.renderOrder = 4
      this.group.add(mesh)
      this.bodyLights.push({ object: mesh, geo, mat })
      const { sharp, tangent } = entry.lines.rest
      const edges = this.tangentEdges === 'removed' || tangent.length === 0 ? sharp : joinSegments(sharp, tangent)
      if (edges.length < 6) continue
      const lineGeo = new LineSegmentsGeometry()
      lineGeo.setPositions(edges)
      const lineMat = new LineMaterial({ color: new THREE.Color(LIT_BODY_COLOR).getHex(), linewidth: EDGE_WIDTH_ARMED_PX * this.lineScale, transparent: true, opacity: 0.95, depthTest: true, depthWrite: false, worldUnits: false })
      lineMat.resolution.copy(this.resolution)
      lineMat.clippingPlanes = this.clipping
      const line = new LineSegments2(lineGeo, lineMat)
      line.renderOrder = 6
      this.group.add(line)
      this.bodyLights.push({ object: line, geo: lineGeo, mat: lineMat })
    }
  }

  /** An edge's share of its body's face outlines, as segments. */
  private edgeLine(entry: Entry, hash: number): Float32Array | undefined {
    return this.shares(entry).segments.get(hash)
  }

  /** The lit faces and edges: the hovered one and the picked ones, each a
   *  small mesh over the body's own triangles or a fat line over the edge. */
  private rebuildLights(): void {
    for (const l of this.faceLights) {
      this.group.remove(l.mesh)
      l.geo.dispose()
      l.mat.dispose()
    }
    this.faceLights = []
    for (const l of this.edgeLights) {
      this.group.remove(l.line)
      l.geo.dispose()
      l.mat.dispose()
    }
    this.edgeLights = []
    for (const l of this.vertexLights) {
      this.group.remove(l.points)
      l.geo.dispose()
      l.mat.dispose()
    }
    this.vertexLights = []
    if (this.mode !== null) {
      // The corners picked, and the one under the cursor: dots of a fixed
      // size on screen, over everything — a corner is always on the outside.
      const dots: { p: readonly number[]; hover: boolean }[] = this.pickedVertices.map((v) => ({ p: v.point, hover: false }))
      if (this.hoveredVertex && !this.pickedVertices.some((v) => vertexKey(v.bodyId, v.point) === vertexKey(this.hoveredVertex!.bodyId, this.hoveredVertex!.point))) dots.push({ p: this.hoveredVertex.point, hover: true })
      for (const d of dots) {
        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.Float32BufferAttribute([d.p[0], d.p[1], d.p[2]], 3))
        const mat = new THREE.PointsMaterial({ color: d.hover ? HOVER_COLOR : PICKED_COLOR, size: VERTEX_LIT_PX, sizeAttenuation: false, depthTest: false, depthWrite: false, transparent: true, opacity: 0.95 })
        const points = new THREE.Points(geo, mat)
        points.renderOrder = 8
        this.group.add(points)
        this.vertexLights.push({ points, geo, mat })
      }
      const faces = new Map<string, { bodyId: number; hash: number; hover: boolean }>()
      for (const k of this.pickedFaces) {
        const [b, h] = k.split(':').map(Number)
        faces.set(k, { bodyId: b, hash: h, hover: false })
      }
      if (this.hoveredFace) {
        const k = key(this.hoveredFace.bodyId, this.hoveredFace.face.hash)
        faces.set(k, { bodyId: this.hoveredFace.bodyId, hash: this.hoveredFace.face.hash, hover: !this.pickedFaces.has(k) })
      }
      for (const [k, f] of faces) {
        const entry = this.entries.get(f.bodyId)
        const range = entry?.ranges.get(f.hash)
        if (!entry || !range) continue
        const source = entry.mesh.geometry as THREE.BufferGeometry
        const index = source.getIndex()
        if (!index) continue
        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', source.getAttribute('position'))
        geo.setIndex(new THREE.BufferAttribute((index.array as Uint32Array).subarray(range[0] * 3, (range[0] + range[1]) * 3), 1))
        const mat = new THREE.MeshBasicMaterial({ color: f.hover ? HOVER_COLOR : PICKED_COLOR, transparent: true, opacity: f.hover ? 0.35 : 0.5, side: THREE.DoubleSide, depthTest: false, depthWrite: false })
        const mesh = new THREE.Mesh(geo, mat)
        mesh.renderOrder = 4
        this.group.add(mesh)
        this.faceLights.push({ key: k, mesh, geo, mat })
      }
      const edges = new Map<string, { bodyId: number; hash: number; hover: boolean; chain?: boolean }>()
      for (const k of this.chainEdges) {
        const [b, h] = k.split(':').map(Number)
        edges.set(k, { bodyId: b, hash: h, hover: false, chain: true })
      }
      for (const k of this.pickedEdges) {
        const [b, h] = k.split(':').map(Number)
        edges.set(k, { bodyId: b, hash: h, hover: false })
      }
      if (this.hoveredEdge) {
        const k = key(this.hoveredEdge.bodyId, this.hoveredEdge.edge.hash)
        if (!this.pickedEdges.has(k)) edges.set(k, { bodyId: this.hoveredEdge.bodyId, hash: this.hoveredEdge.edge.hash, hover: true })
      }
      for (const [k, e] of edges) {
        const entry = this.entries.get(e.bodyId)
        const segments = entry ? this.edgeLine(entry, e.hash) : undefined
        if (!segments || segments.length < 6) continue
        const geo = new LineSegmentsGeometry()
        geo.setPositions(segments)
        // A lit edge is on top of the body it belongs to but behind the
        // rest of it: the far side's picks do not shine through.
        // The edge under the cursor is drawn over everything, as the lit
        // face and corner are: the arrow keys reach edges behind the body.
        const mat = new LineMaterial({ color: new THREE.Color(e.hover ? HOVER_COLOR : e.chain ? CHAIN_COLOR : PICKED_COLOR).getHex(), linewidth: EDGE_LIT_PX * this.lineScale, transparent: true, opacity: 0.95, depthTest: !e.hover, depthWrite: false, worldUnits: false })
        mat.resolution.copy(this.resolution)
        mat.clippingPlanes = this.clipping
        const line = new LineSegments2(geo, mat)
        line.renderOrder = 6
        this.group.add(line)
        this.edgeLights.push({ key: k, line, geo, mat })
      }
    }
    this.ctx.invalidate()
  }

  dispose(): void {
    this.entries.clear()
    this.litBodies = []
    this.rebuildBodyLights()
    this.mode = null
    this.setOpenEdges([])
    this.setPreviewEdges([], null)
    for (const s of this.silhouettes.values()) {
      if (s.line) this.group.remove(s.line)
      s.geo?.dispose()
    }
    this.silhouettes.clear()
    for (const block of this.edgeBlocks.values()) {
      this.group.remove(block.line)
      block.geo.dispose()
    }
    this.edgeBlocks.clear()
    this.edgeMaterial?.dispose()
    this.edgeMaterial = null
    this.dimmedMaterial?.dispose()
    this.dimmedMaterial = null
    this.ctx.partGroup.remove(this.group)
  }
}

/** Two runs of segments as one. */
function joinSegments(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length + b.length)
  out.set(a)
  out.set(b, a.length)
  return out
}

/** Whether a segment on screen meets a box: an end inside it, or a
 *  crossing of one of its sides. */
function segmentMeetsBox(a: [number, number], b: [number, number], left: number, top: number, right: number, bottom: number): boolean {
  const inside = (p: [number, number]) => p[0] >= left && p[0] <= right && p[1] >= top && p[1] <= bottom
  if (inside(a) || inside(b)) return true
  const corners: [number, number][] = [
    [left, top],
    [right, top],
    [right, bottom],
    [left, bottom],
  ]
  const side = (p: [number, number], q: [number, number], r: [number, number]) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  for (let i = 0; i < 4; i++) {
    const c = corners[i]
    const d = corners[(i + 1) % 4]
    if (side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0) return true
  }
  return false
}

/** Where along a → b the point's foot lies, 0 to 1. */
function segmentParameter(x: number, y: number, a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const l2 = dx * dx + dy * dy
  return l2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)) : 0
}
