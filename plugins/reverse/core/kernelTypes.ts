// SPDX-License-Identifier: AGPL-3.0-only
// What the kernel hands out and takes in, as types: a shape's handle, the
// loops a profile is made of, a mesh with its faces and edges, a face's
// history through an operation, and a STEP file's parts.

import type { Vec3 } from '../../../src/core/types'
import type { MeshFault } from './kernelMesh'
import type { EdgeKind, FaceKind } from './topo'

/** A handle into the kernel's shape arena. Opaque here; the kernel's own
 *  branded number underneath. */
export type Shape = number & { readonly __shape: never }

/** One piece of a profile loop, in the part's coordinates. An arc is given
 *  by three points on it rather than by centre and angles, because that is
 *  the one description no two kernels read differently. A spline is a
 *  clamped cubic B-spline — its poles, distinct knots and their
 *  multiplicities — the form a kernel and a STEP file both take as it is.
 *  `entity` is the sketch piece it was lifted from, when it was — what an
 *  answer names a join by; the kernel reads past it. */
export type LoopPiece = (
  | { kind: 'line'; a: Vec3; b: Vec3 }
  | { kind: 'arc'; a: Vec3; m: Vec3; b: Vec3 }
  | { kind: 'circle'; center: Vec3; normal: Vec3; radius: number }
  | { kind: 'spline'; poles: Vec3[]; knots: number[]; mults: number[] }
) & { entity?: number }

/** A closed region to make a face of: an outer loop and the loops of any
 *  holes in it, every loop closed end to start. */
export interface Profile {
  outer: LoopPiece[]
  holes: LoopPiece[][]
}

export interface KernelMesh {
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
  /** The hash of the face each triangle lies on — the name a viewport pick
   *  resolves to a face by; see `faces`. Present on a body's mesh. */
  faceHash?: Int32Array
  /** The faces the mesher did not draw whole with the others (kernelMesh.ts);
   *  absent where it drew them all. */
  faults?: MeshFault[]
}

/** A face of a shape as the kernel reads it: its session hash (the name
 *  the kernel's history and its mesh speak) and the geometry a fingerprint
 *  is made of. */
export interface RawFace {
  hash: number
  kind: FaceKind
  centroid: Vec3
  dir: Vec3
  area: number
  radius?: number
  /** A point on a cylinder's or a cone's axis, a sphere's centre. */
  center?: Vec3
  /** For a cylinder, a cone or a torus: whether the face goes the whole way
   *  round its axis — a boss's or a bore's wall does, a fillet's quarter
   *  turn does not. */
  fullTurn?: boolean
}

export interface RawEdge {
  hash: number
  kind: EdgeKind
  mid: Vec3
  dir: Vec3
  length: number
  radius?: number
  /** The faces on either side, by hash. */
  faceHashes: number[]
  /** The edge sampled for drawing, XYZ interleaved. */
  polyline: Float32Array
  /** The edge's two ends and the unit tangent at each, pointing along the
   *  edge away from its start — what a tangent chain is walked by. */
  ends: [Vec3, Vec3]
  endTangents: [Vec3, Vec3]
}

/** What an operation did to the faces it was given: each old face's hash
 *  mapped to the hashes of the faces it became. A face left alone keeps
 *  its hash and is not listed; a face the operation made from nothing is
 *  in neither. */
export type FaceHistory = Map<number, number[]>

export interface Tracked {
  shape: Shape
  history: FaceHistory
  /** Something the operation did that was not asked for in so many words —
   *  a shell that left its inner corners sharp — for the feature's row. */
  note?: string
}

export interface KernelBounds {
  min: Vec3
  max: Vec3
}

/** What OcctKernel.init takes for the wasm: a URL string, or the bytes. Left
 *  out, the package finds the binary next to its own module — which is how
 *  Node and the tests load it. */
export type WasmSource = string | URL | ArrayBuffer | Uint8Array | undefined

/** How a body is written into a STEP file: under its name, in its colour
 *  (#rrggbb). */
export interface StepLabel {
  name: string
  color?: string
}

/** A part of a STEP file as readStepParts hands it over: its shape — the
 *  caller's to release — and the name the file gives it, where it gives
 *  one. */
export interface StepPart {
  shape: Shape
  name?: string
}
