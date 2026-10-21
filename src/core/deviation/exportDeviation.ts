// SPDX-License-Identifier: AGPL-3.0-only
// The deviation as data: every reading of a map — a scan vertex, or a
// sample cut on the reference — with its place and its signed distance, as
// a file another program reads. PLY and NPY are binary, so the 700 000
// vertices of a large scan come to megabytes rather than tens of them; CSV
// is for a spreadsheet or a quick look.
//
// One convention throughout: the distance is the reading as the map holds
// it, NaN where it has none (a vertex the facing limit left out, reference
// with no scan behind it). A reading past the search distance is kept: the
// map draws it bare and the statistics leave it out, so the PLY marks it
// (measured 0), and in the others |d| ≤ the search distance tells it.

export type DeviationFormat = 'ply' | 'csv' | 'npy'

export interface DeviationReadings {
  /** x, y, z per reading, mm. */
  positions: Float32Array
  /** The signed distance per reading, mm; NaN for none. */
  values: Float32Array
  /** The map's search distance, mm. */
  searchDistance: number
  /** What the readings are, for the PLY's comment. */
  what: string
}

/** Whether a reading counts in the statistics: a number within the search
 *  distance. */
export const isMeasured = (v: number, searchDistance: number): boolean => Math.abs(v) <= searchDistance

/** The readings as a file's bytes. */
export function deviationFileBytes(r: DeviationReadings, format: DeviationFormat): Uint8Array {
  if (format === 'ply') return plyBytes(r)
  if (format === 'npy') return npyBytes(r)
  return csvBytes(r)
}

/** Binary little-endian PLY: a vertex per reading with float x, y, z,
 *  float deviation and uchar measured. */
function plyBytes({ positions, values, searchDistance, what }: DeviationReadings): Uint8Array {
  const n = values.length
  const header =
    'ply\n' +
    'format binary_little_endian 1.0\n' +
    `comment ScanRuler deviation: ${what}, mm\n` +
    'comment deviation is NaN where there is no reading\n' +
    `comment measured is 1 within the search distance (${searchDistance} mm), as the statistics count\n` +
    `element vertex ${n}\n` +
    'property float x\n' +
    'property float y\n' +
    'property float z\n' +
    'property float deviation\n' +
    'property uchar measured\n' +
    'end_header\n'
  const head = new TextEncoder().encode(header)
  const stride = 17
  const out = new Uint8Array(head.length + n * stride)
  out.set(head, 0)
  const view = new DataView(out.buffer, head.length)
  for (let i = 0; i < n; i++) {
    const o = i * stride
    view.setFloat32(o, positions[3 * i], true)
    view.setFloat32(o + 4, positions[3 * i + 1], true)
    view.setFloat32(o + 8, positions[3 * i + 2], true)
    view.setFloat32(o + 12, values[i], true)
    view.setUint8(o + 16, isMeasured(values[i], searchDistance) ? 1 : 0)
  }
  return out
}

/** NumPy's .npy, version 1.0: an N × 4 little-endian float32 array, rows
 *  x, y, z, d — numpy.load reads it as it is. */
function npyBytes({ positions, values }: DeviationReadings): Uint8Array {
  const n = values.length
  let dict = `{'descr': '<f4', 'fortran_order': False, 'shape': (${n}, 4), }`
  // The magic, version and length take 10 bytes; the header is padded with
  // spaces to a multiple of 64 and ends in a newline.
  const total = Math.ceil((10 + dict.length + 1) / 64) * 64
  dict = dict.padEnd(total - 10 - 1, ' ') + '\n'
  const out = new Uint8Array(total + n * 16)
  out.set([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0], 0)
  new DataView(out.buffer).setUint16(8, dict.length, true)
  out.set(new TextEncoder().encode(dict), 10)
  const view = new DataView(out.buffer, total)
  for (let i = 0; i < n; i++) {
    view.setFloat32(16 * i, positions[3 * i], true)
    view.setFloat32(16 * i + 4, positions[3 * i + 1], true)
    view.setFloat32(16 * i + 8, positions[3 * i + 2], true)
    view.setFloat32(16 * i + 12, values[i], true)
  }
  return out
}

/** Text: a header line x,y,z,d, then a reading a line — places to a ten-
 *  thousandth of a millimetre, the distance to a hundred-thousandth, "nan"
 *  where there is none. */
function csvBytes({ positions, values }: DeviationReadings): Uint8Array {
  const parts: Uint8Array[] = []
  const enc = new TextEncoder()
  let lines: string[] = ['x,y,z,d']
  const flush = () => {
    parts.push(enc.encode(lines.join('\n') + '\n'))
    lines = []
  }
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    lines.push(`${positions[3 * i].toFixed(4)},${positions[3 * i + 1].toFixed(4)},${positions[3 * i + 2].toFixed(4)},${Number.isNaN(v) ? 'nan' : v.toFixed(5)}`)
    if (lines.length >= 50_000) flush()
  }
  if (lines.length) flush()
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}
