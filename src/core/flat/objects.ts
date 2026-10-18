// SPDX-License-Identifier: AGPL-3.0-only
// The parts lying on a flatbed scan, found and measured: a grey threshold
// parts material from background, the material falls apart into connected
// objects, and each object gets the numbers that tell one part from another —
// area, holes, extents, centroid, principal axis, caliper widths — and the
// outline a profile is read off. Fourteen inserts on the glass come back as
// fourteen objects, in the order a person reads the sheet.
//
// Everything works on runs rather than pixels. A 1200 dpi scan of a sheet is
// over a hundred megapixels: the image is read once, row by row, into runs of
// material and runs of background, and from then on time and memory go with
// the number of runs — a few per part per row — not with the pixels. Runs in
// neighbouring rows are joined by union–find, material with 8-connectivity
// and background with 4: the pairing under which a closed curve of material
// always shuts in its own background and the two never cross, so a hole is
// simply a background region that cannot reach the image's edge. No label
// image is ever made, not even to answer "which object is here": at that size
// it would be half a gigabyte, and the kept runs, row by row, answer the same
// question by binary search.
//
// Union–find always hangs the later run under the earlier, so the root of
// every set is its first run in raster order — the object's lowest row, its
// leftmost pixel there. That pixel has nothing of the object below or left of
// it, which is exactly where Moore-neighbour tracing wants to start; the
// outline is traced on the grey image itself, 8-connected like the labelling,
// and stopped by Jacob's criterion.
//
// Pixels follow the edge detector's convention: pixel (col, row) covers
// [col, col+1) × [row, row+1), its centre at the half-coordinates, and row 0
// is the bottom of the sheet. All geometry is taken after scaling to document
// units, never in pixels, so a scan whose pixels are not square still
// measures true.

import type { Vec2 } from './types'

export interface FlatObjectOptions {
  /** Grey level 0–255 parting material from background: material lies at or
   *  below it when the parts are dark, above it when they are light. Otsu's
   *  threshold over the whole image when omitted. */
  threshold?: number
  /** Whether the parts are darker than the background. Decided from the
   *  image's border when omitted: the border is background, so whichever
   *  side of the threshold most border pixels fall on is the background's. */
  dark?: boolean
  /** The smallest object kept, document units² of material. */
  minArea: number
  /** The smallest hole counted, document units². Defaults to `minArea`: a
   *  speck of glare inside a part is held to the same bar as a speck of dust
   *  beside it. Pass 0 to count every enclosed background pixel. */
  minHoleArea?: number
  /** Document units per pixel along X and Y. */
  scale: { x: number; y: number }
}

export interface FlatObject {
  /** Material area, document units² — holes excluded. */
  area: number
  /** Enclosed holes: background regions that do not reach the image's edge
   *  and are at least `minHoleArea`. */
  holes: number
  /** The pixels' extents, corner to corner, in document units. */
  box: { min: Vec2; max: Vec2 }
  /** The mean of the material pixels' centres. */
  centroid: Vec2
  /** The principal (major) axis from the second central moments of the
   *  material, radians from +X, in (-π/2, π/2]. Meaningless for a shape as
   *  round one way as the other. */
  axisAngle: number
  /** Caliper widths of the outline — the convex hull of its pixels' corners:
   *  the largest and the smallest, each with the direction it is measured
   *  along, radians from +X in (-π/2, π/2]. */
  feret: { max: number; maxAngle: number; min: number; minAngle: number }
  /** The diameter of the circle of the same area. */
  equivalentDiameter: number
  /** The outer contour, x,y flattened, at pixel centres in document units:
   *  counter-clockwise from the lowest-left pixel, closed without repeating
   *  the first point. A pixel where the outline pinches through itself
   *  appears once per pass. What a profile is taken on. */
  outline: Float64Array
}

export interface FlatObjects {
  threshold: number
  dark: boolean
  /** In reading order as the sheet is shown, y up: rows from the top of the
   *  image down, left to right within a row. Objects share a row when their
   *  centroids lie within half the median object height of the row's mean. */
  objects: FlatObject[]
  /** The object whose material covers the pixel holding the document point,
   *  as an index into `objects`, or -1 — background, a hole, a dropped speck,
   *  or off the image. */
  objectAt(x: number, y: number): number
}

/** Runs are stored in tables that start this long and double. */
const INITIAL_RUNS = 4096
/** Neighbour directions, counter-clockwise from east with y up: E, NE, N,
 *  NW, W, SW, S, SE. */
const DX = [1, 1, 0, -1, -1, -1, 0, 1]
const DY = [0, 1, 1, 1, 0, -1, -1, -1]
const WEST = 4

/** Runs of one class, in raster order, and the union–find forest over them. */
class Runs {
  start = new Int32Array(INITIAL_RUNS)
  end = new Int32Array(INITIAL_RUNS)
  parent = new Int32Array(INITIAL_RUNS)
  /** For a background run, the material run just left of it in its row, or
   *  -1 at the image's edge; unused for material. */
  left = new Int32Array(INITIAL_RUNS)
  count = 0
  /** Row r's runs are [rowFirst[r], rowFirst[r + 1]). */
  readonly rowFirst: Int32Array

  constructor(height: number) {
    this.rowFirst = new Int32Array(height + 1)
  }

  push(start: number, end: number, left: number): void {
    if (this.count === this.start.length) this.grow()
    const i = this.count++
    this.start[i] = start
    this.end[i] = end
    this.parent[i] = i
    this.left[i] = left
  }

  private grow(): void {
    const capacity = this.start.length * 2
    const grown = (a: Int32Array) => {
      const b = new Int32Array(capacity)
      b.set(a)
      return b
    }
    this.start = grown(this.start)
    this.end = grown(this.end)
    this.parent = grown(this.parent)
    this.left = grown(this.left)
  }

  find(i: number): number {
    const p = this.parent
    while (p[i] !== i) {
      p[i] = p[p[i]]
      i = p[i]
    }
    return i
  }

  /** The later root goes under the earlier, which keeps every root the
   *  first run of its set. */
  union(a: number, b: number): void {
    a = this.find(a)
    b = this.find(b)
    if (a < b) this.parent[b] = a
    else if (b < a) this.parent[a] = b
  }

  /** Join the runs of `row` — the latest pushed — to the runs of the row
   *  below that touch them: overlapping for 4-connectivity (`reach` 0), or
   *  meeting at a corner too for 8 (`reach` 1). */
  link(row: number, reach: number): void {
    let i = this.rowFirst[row - 1]
    const iEnd = this.rowFirst[row]
    let j = iEnd
    const jEnd = this.count
    while (i < iEnd && j < jEnd) {
      if (this.end[i] + reach < this.start[j]) i++
      else if (this.end[j] + reach < this.start[i]) j++
      else {
        this.union(i, j)
        if (this.end[i] < this.end[j]) i++
        else j++
      }
    }
  }
}

/** Otsu's threshold: the grey level that best parts the image's histogram
 *  into two classes, by their between-class variance. Material of one class
 *  lies at or below it. Where a range of levels does equally well — an empty
 *  stretch of the histogram between the classes — the middle of the range,
 *  not its first level. An image of a single grey returns that grey. */
export function otsuThreshold(gray: Uint8Array): number {
  const hist = new Uint32Array(256)
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++
  let total = 0
  let sumAll = 0
  for (let v = 0; v < 256; v++) {
    total += hist[v]
    sumAll += v * hist[v]
  }
  let w0 = 0
  let sum0 = 0
  let best = -1
  let first = -1
  let last = -1
  for (let t = 0; t < 255; t++) {
    w0 += hist[t]
    sum0 += t * hist[t]
    const w1 = total - w0
    if (w0 === 0 || w1 === 0) continue
    const d = sum0 / w0 - (sumAll - sum0) / w1
    const between = w0 * w1 * d * d
    if (between > best * (1 + 1e-12)) {
      best = between
      first = last = t
    } else if (between >= best * (1 - 1e-12) && t === last + 1) {
      last = t
    }
  }
  if (first < 0) {
    for (let v = 0; v < 256; v++) if (hist[v] > 0) return v
    return 0
  }
  return Math.floor((first + last) / 2)
}

/** Whether the parts are dark: the border is background, and the
 *  background is whichever side of the threshold most of it falls on. */
function partsAreDark(gray: Uint8Array, width: number, height: number, threshold: number): boolean {
  let darkCount = 0
  let total = 0
  const tally = (i: number) => {
    total++
    if (gray[i] <= threshold) darkCount++
  }
  for (let col = 0; col < width; col++) {
    tally(col)
    if (height > 1) tally((height - 1) * width + col)
  }
  for (let row = 1; row < height - 1; row++) {
    tally(row * width)
    if (width > 1) tally(row * width + width - 1)
  }
  return darkCount * 2 <= total
}

/** Read the image into runs of material and runs of background, each joined
 *  to the row below as it is read. */
function scanRuns(gray: Uint8Array, width: number, height: number, lut: Uint8Array): { fg: Runs; bg: Runs } {
  const fg = new Runs(height)
  const bg = new Runs(height)
  for (let row = 0; row < height; row++) {
    fg.rowFirst[row] = fg.count
    bg.rowFirst[row] = bg.count
    const base = row * width
    const rowEnd = base + width
    let i = base
    while (i < rowEnd) {
      const s = i
      while (i < rowEnd && lut[gray[i]] === 0) i++
      if (i > s) bg.push(s - base, i - 1 - base, s > base ? fg.count - 1 : -1)
      if (i === rowEnd) break
      const f = i
      while (i < rowEnd && lut[gray[i]] === 1) i++
      fg.push(f - base, i - 1 - base, -1)
    }
    if (row > 0) {
      fg.link(row, 1)
      bg.link(row, 0)
    }
  }
  fg.rowFirst[height] = fg.count
  bg.rowFirst[height] = bg.count
  return { fg, bg }
}

/** The outer contour by Moore-neighbour tracing from the object's lowest-left
 *  pixel, at pixel centres scaled to document units. */
function traceOutline(
  gray: Uint8Array,
  width: number,
  height: number,
  lut: Uint8Array,
  col0: number,
  row0: number,
  pixels: number,
  sx: number,
  sy: number,
): Float64Array {
  const inside = (c: number, r: number) =>
    c >= 0 && r >= 0 && c < width && r < height && lut[gray[r * width + c]] === 1
  // The first material neighbour sweeping counter-clockwise from `from`,
  // which is always a known background neighbour.
  const next = (c: number, r: number, from: number) => {
    for (let t = 0; t < 8; t++) {
      const d = (from + t) & 7
      if (inside(c + DX[d], r + DY[d])) return d
    }
    return -1
  }
  const out: number[] = [(col0 + 0.5) * sx, (row0 + 0.5) * sy]
  // Nothing of the object lies below or left of its lowest-left pixel, so
  // the sweep may start due west.
  const k0 = next(col0, row0, WEST)
  if (k0 < 0) return Float64Array.from(out)
  let c = col0
  let r = row0
  let k = k0
  // Each outline pixel is passed at most four times; the cap guards against
  // a tracing that never closes, it is not how one ends.
  const cap = 8 * pixels + 16
  for (let step = 0; step < cap; step++) {
    c += DX[k]
    r += DY[k]
    // The neighbour swept just before the one moved to was background; seen
    // from the new pixel it lies one step back round the ring.
    k = next(c, r, k & 1 ? (k + 5) & 7 : (k + 6) & 7)
    // Jacob's criterion: leaving the start the way it was first left closes
    // the outline — a mere return to the start pixel does not, when the
    // outline pinches through it.
    if (c === col0 && r === row0 && k === k0) break
    out.push((c + 0.5) * sx, (r + 0.5) * sy)
  }
  return Float64Array.from(out)
}

/** The convex hull of flattened x,y points, counter-clockwise, collinear
 *  points dropped (Andrew's monotone chain). */
function convexHull(points: ArrayLike<number>): Float64Array {
  const n = points.length >> 1
  const order = Array.from({ length: n }, (_, i) => i)
  order.sort((a, b) => points[2 * a] - points[2 * b] || points[2 * a + 1] - points[2 * b + 1])
  const hull: number[] = []
  const cross = (o: number, a: number, b: number) =>
    (points[2 * a] - points[2 * o]) * (points[2 * b + 1] - points[2 * o + 1]) -
    (points[2 * a + 1] - points[2 * o + 1]) * (points[2 * b] - points[2 * o])
  const chain = (indices: number[]) => {
    const stack: number[] = []
    for (const i of indices) {
      while (stack.length >= 2 && cross(stack[stack.length - 2], stack[stack.length - 1], i) <= 0) stack.pop()
      stack.push(i)
    }
    stack.pop()
    return stack
  }
  const lower = chain(order)
  const upper = chain(order.slice().reverse())
  const all = n <= 1 ? order : lower.concat(upper)
  for (const i of all) hull.push(points[2 * i], points[2 * i + 1])
  return Float64Array.from(hull)
}

/** An angle folded into (-π/2, π/2] — a direction, not a heading. */
function axial(angle: number): number {
  while (angle > Math.PI / 2) angle -= Math.PI
  while (angle <= -Math.PI / 2) angle += Math.PI
  return angle
}

/** The caliper widths of the outline's pixels as squares: the hull of their
 *  corners is the hull of their centres grown by one pixel's corners, so the
 *  centres are hulled first and only the hull's vertices are cornered. Then
 *  rotating calipers: the smallest width is square to a hull edge, and the
 *  largest joins an antipodal pair. */
function feretOf(outline: Float64Array, sx: number, sy: number): FlatObject['feret'] {
  const centres = convexHull(outline)
  const corners: number[] = []
  const hx = sx / 2
  const hy = sy / 2
  for (let i = 0; i < centres.length; i += 2) {
    const x = centres[i]
    const y = centres[i + 1]
    corners.push(x - hx, y - hy, x + hx, y - hy, x + hx, y + hy, x - hx, y + hy)
  }
  const hull = convexHull(corners)
  const h = hull.length >> 1
  const X = (i: number) => hull[2 * (i % h)]
  const Y = (i: number) => hull[2 * (i % h) + 1]
  let min = Infinity
  let minAngle = 0
  let max = 0
  let maxAngle = 0
  const pair = (a: number, b: number) => {
    const dx = X(b) - X(a)
    const dy = Y(b) - Y(a)
    const d = Math.hypot(dx, dy)
    if (d > max) {
      max = d
      maxAngle = Math.atan2(dy, dx)
    }
  }
  let j = 1
  for (let i = 0; i < h; i++) {
    const ex = X(i + 1) - X(i)
    const ey = Y(i + 1) - Y(i)
    const reach = (k: number) => ex * (Y(k) - Y(i)) - ey * (X(k) - X(i))
    while (reach(j + 1) > reach(j)) j = (j + 1) % h
    const width = reach(j) / Math.hypot(ex, ey)
    if (width < min) {
      min = width
      minAngle = Math.atan2(ex, -ey)
    }
    // A vertex as far as j, past it, means an edge parallel to this one;
    // its far end pairs too.
    pair(i, j)
    pair(i + 1, j)
    pair(i, j + 1)
    pair(i + 1, j + 1)
  }
  return { max, maxAngle: axial(maxAngle), min, minAngle: axial(minAngle) }
}

/** Indices in reading order, y up: rows from the top down, left to right
 *  within a row. A row gathers objects whose centroids lie within half the
 *  median object height of its running mean — loose enough for a row laid
 *  a little askew, tight enough that two rows of parts stay two. */
function readingOrder(centroids: Vec2[], heights: number[]): number[] {
  const n = centroids.length
  if (n === 0) return []
  const sortedHeights = heights.slice().sort((a, b) => a - b)
  const tolerance = 0.5 * sortedHeights[n >> 1]
  const byHeight = Array.from({ length: n }, (_, i) => i).sort((a, b) => centroids[b][1] - centroids[a][1])
  const order: number[] = []
  let row: number[] = []
  let sum = 0
  const flush = () => {
    row.sort((a, b) => centroids[a][0] - centroids[b][0])
    order.push(...row)
  }
  for (const i of byHeight) {
    const y = centroids[i][1]
    if (row.length > 0 && sum / row.length - y > tolerance) {
      flush()
      row = []
      sum = 0
    }
    row.push(i)
    sum += y
  }
  flush()
  return order
}

/**
 * The objects on a grayscale scan: material parted from background by a
 * threshold, split into 8-connected objects, those under `minArea` dropped,
 * the rest measured in document units and returned in reading order. `gray`
 * is `width × height`, row-major, row 0 the bottom of the image.
 */
export function findObjects(
  gray: Uint8Array,
  width: number,
  height: number,
  options: FlatObjectOptions,
): FlatObjects {
  if (gray.length < width * height) throw new RangeError('The image is smaller than its width × height.')
  const sx = options.scale.x
  const sy = options.scale.y
  if (!(sx > 0 && sy > 0)) throw new RangeError('The scale has to be positive along both axes.')
  const pixelArea = sx * sy
  const threshold = options.threshold ?? otsuThreshold(gray)
  const dark = options.dark ?? partsAreDark(gray, width, height, threshold)
  const minHoleArea = options.minHoleArea ?? options.minArea
  const lut = new Uint8Array(256)
  for (let v = 0; v < 256; v++) lut[v] = (dark ? v <= threshold : v > threshold) ? 1 : 0

  const { fg, bg } = scanRuns(gray, width, height, lut)

  // Material components, numbered by their first run. A root is always met
  // before the runs under it, so one pass numbers them all.
  const comp = new Int32Array(fg.count)
  const roots: number[] = []
  const rootRows: number[] = []
  const pixels: number[] = []
  for (let row = 0; row < height; row++) {
    for (let i = fg.rowFirst[row]; i < fg.rowFirst[row + 1]; i++) {
      const r = fg.find(i)
      let c: number
      if (r === i) {
        c = roots.length
        roots.push(i)
        rootRows.push(row)
        pixels.push(0)
      } else {
        c = comp[r]
      }
      comp[i] = c
      pixels[c] += fg.end[i] - fg.start[i] + 1
    }
  }
  const keepOf = new Int32Array(roots.length).fill(-1)
  const kept: number[] = []
  for (let c = 0; c < roots.length; c++) {
    if (pixels[c] * pixelArea >= options.minArea) {
      keepOf[c] = kept.length
      kept.push(c)
    }
  }
  const K = kept.length

  // Moments about each object's first pixel rather than the image origin:
  // sums of squares out at fourteen thousand pixels would leave the central
  // moments to float64 cancellation.
  const su = new Float64Array(K)
  const sv = new Float64Array(K)
  const suu = new Float64Array(K)
  const svv = new Float64Array(K)
  const suv = new Float64Array(K)
  const minCol = new Int32Array(K).fill(width)
  const maxCol = new Int32Array(K).fill(-1)
  const minRow = new Int32Array(K).fill(height)
  const maxRow = new Int32Array(K).fill(-1)
  let keptRuns = 0
  for (let row = 0; row < height; row++) {
    for (let i = fg.rowFirst[row]; i < fg.rowFirst[row + 1]; i++) {
      const k = keepOf[comp[i]]
      if (k < 0) continue
      keptRuns++
      const root = roots[kept[k]]
      const a = fg.start[i] - fg.start[root]
      const b = fg.end[i] - fg.start[root]
      const v = row - rootRows[kept[k]]
      const n = b - a + 1
      const sumU = ((a + b) * n) / 2
      su[k] += sumU
      suu[k] += (b * (b + 1) * (2 * b + 1) - (a - 1) * a * (2 * a - 1)) / 6
      sv[k] += n * v
      svv[k] += n * v * v
      suv[k] += v * sumU
      if (fg.start[i] < minCol[k]) minCol[k] = fg.start[i]
      if (fg.end[i] > maxCol[k]) maxCol[k] = fg.end[i]
      if (row < minRow[k]) minRow[k] = row
      maxRow[k] = row
    }
  }

  // Background components, and which of them are holes: those the image's
  // edge cannot reach. The first run of a hole lies on its lowest row, where
  // nothing standing inside the hole can reach down to, so the material just
  // left of it is the object the hole is in.
  const holes = new Int32Array(K)
  {
    const bgComp = new Int32Array(bg.count)
    const bgPixels: number[] = []
    const bgOpen: boolean[] = []
    const bgLeft: number[] = []
    for (let row = 0; row < height; row++) {
      const edgeRow = row === 0 || row === height - 1
      for (let i = bg.rowFirst[row]; i < bg.rowFirst[row + 1]; i++) {
        const r = bg.find(i)
        let c: number
        if (r === i) {
          c = bgPixels.length
          bgPixels.push(0)
          bgOpen.push(false)
          bgLeft.push(bg.left[i])
        } else {
          c = bgComp[r]
        }
        bgComp[i] = c
        bgPixels[c] += bg.end[i] - bg.start[i] + 1
        if (edgeRow || bg.start[i] === 0 || bg.end[i] === width - 1) bgOpen[c] = true
      }
    }
    for (let c = 0; c < bgPixels.length; c++) {
      if (bgOpen[c] || bgLeft[c] < 0 || bgPixels[c] * pixelArea < minHoleArea) continue
      const k = keepOf[comp[bgLeft[c]]]
      if (k >= 0) holes[k]++
    }
  }

  const centroids: Vec2[] = []
  const heights: number[] = []
  for (let k = 0; k < K; k++) {
    const c = kept[k]
    const root = roots[c]
    const n = pixels[c]
    centroids.push([sx * (fg.start[root] + 0.5 + su[k] / n), sy * (rootRows[c] + 0.5 + sv[k] / n)])
    heights.push(sy * (maxRow[k] - minRow[k] + 1))
  }
  const order = readingOrder(centroids, heights)
  const finalOf = new Int32Array(K)
  order.forEach((k, at) => (finalOf[k] = at))

  const objects: FlatObject[] = order.map((k) => {
    const c = kept[k]
    const n = pixels[c]
    const area = n * pixelArea
    const mu = su[k] / n
    const mv = sv[k] / n
    // Each pixel is the square it covers, not a point at its centre — a
    // twelfth of its side squared on its own axis.
    const m20 = sx * sx * (suu[k] / n - mu * mu + 1 / 12)
    const m02 = sy * sy * (svv[k] / n - mv * mv + 1 / 12)
    const m11 = sx * sy * (suv[k] / n - mu * mv)
    const outline = traceOutline(gray, width, height, lut, fg.start[roots[c]], rootRows[c], n, sx, sy)
    return {
      area,
      holes: holes[k],
      box: {
        min: [minCol[k] * sx, minRow[k] * sy] as Vec2,
        max: [(maxCol[k] + 1) * sx, (maxRow[k] + 1) * sy] as Vec2,
      },
      centroid: centroids[k],
      axisAngle: axial(0.5 * Math.atan2(2 * m11, m20 - m02)),
      feret: feretOf(outline, sx, sy),
      equivalentDiameter: Math.sqrt((4 * area) / Math.PI),
      outline,
    }
  })

  // The kept runs, row by row, with the object each belongs to: enough to
  // answer objectAt by binary search within a row.
  const runStart = new Int32Array(keptRuns)
  const runEnd = new Int32Array(keptRuns)
  const runObject = new Int32Array(keptRuns)
  const runRowFirst = new Int32Array(height + 1)
  let m = 0
  for (let row = 0; row < height; row++) {
    runRowFirst[row] = m
    for (let i = fg.rowFirst[row]; i < fg.rowFirst[row + 1]; i++) {
      const k = keepOf[comp[i]]
      if (k < 0) continue
      runStart[m] = fg.start[i]
      runEnd[m] = fg.end[i]
      runObject[m] = finalOf[k]
      m++
    }
  }
  runRowFirst[height] = m

  const objectAt = (x: number, y: number): number => {
    const col = Math.floor(x / sx)
    const row = Math.floor(y / sy)
    if (!(col >= 0 && col < width && row >= 0 && row < height)) return -1
    // The last run starting at or before the column, if it reaches it.
    let lo = runRowFirst[row]
    let hi = runRowFirst[row + 1] - 1
    let found = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (runStart[mid] <= col) {
        found = mid
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    return found >= 0 && runEnd[found] >= col ? runObject[found] : -1
  }

  return { threshold, dark, objects, objectAt }
}
