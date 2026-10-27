// SPDX-License-Identifier: AGPL-3.0-only
// A textured OBJ's colours, baked onto its vertices. A scanner that captures
// colour writes three files: the OBJ with a texture coordinate at every face
// corner, a material library (MTL) naming the image each material wears,
// and the image. Each vertex takes the image's colour where its first
// textured corner points — the scan's own vertex grid is about as fine as a
// scanner's texture, so per-vertex colour loses little, and it keeps the
// render mesh the welded scan everything else indexes (a texture proper
// would split the mesh along every seam of the image's layout).

import type { TextureNote } from '../types'

/** An image that came with the OBJ, decoded: RGBA, four bytes per pixel,
 *  rows from the top. */
export interface TextureImage {
  name: string
  width: number
  height: number
  rgba: Uint8Array | Uint8ClampedArray
}

/** The files that came with an OBJ: its material libraries as text, its
 *  images decoded. */
export interface ObjCompanions {
  materials: { name: string; text: string }[]
  images: TextureImage[]
}

/** The colour of a vertex no textured corner reaches. */
const UNTEXTURED = 180

/** A path's last part, lower-cased — how a file named in an OBJ or MTL is
 *  matched to one given: the paths in them are the exporting machine's. */
export function baseName(path: string): string {
  return (path.split(/[\\/]/).pop() ?? path).trim().toLowerCase()
}

/** The options map_Kd may carry ahead of the file name, with how many
 *  values each takes at most (the -o/-s/-t ones take one to three). */
const MAP_OPTIONS: Record<string, number> = {
  '-blendu': 1, '-blendv': 1, '-cc': 1, '-clamp': 1, '-imfchan': 1, '-texres': 1,
  '-bm': 1, '-boost': 1, '-mm': 2, '-o': 3, '-s': 3, '-t': 3, '-type': 1,
}

/** Each material of a library and the image its diffuse colour is mapped
 *  from (map_Kd), by material name. A material without one is left out. */
export function parseMtl(text: string): Map<string, string> {
  const out = new Map<string, string>()
  let current: string | null = null
  for (const raw of text.split('\n')) {
    const line = raw.split('#', 1)[0].trim()
    if (line.startsWith('newmtl')) {
      current = line.slice(6).trim()
    } else if (current !== null && /^map_Kd\s/i.test(line)) {
      const tokens = line.split(/\s+/).slice(1)
      let i = 0
      while (i < tokens.length && tokens[i].startsWith('-') && tokens[i].toLowerCase() in MAP_OPTIONS) {
        const takes = MAP_OPTIONS[tokens[i].toLowerCase()]
        i++
        for (let k = 0; k < takes && i < tokens.length - 1 && /^(-?[\d.]+|on|off|[rgbmlz])$/i.test(tokens[i]); k++) i++
      }
      const file = tokens.slice(i).join(' ')
      if (file) out.set(current, file)
    }
  }
  return out
}

/** The library names an `mtllib` line gives — usually one, several when
 *  each ends in .mtl, else the whole rest of the line (a name with spaces). */
export function mtllibNames(rest: string): string[] {
  const tokens = rest.trim().split(/\s+/).filter(Boolean)
  if (tokens.length > 1 && tokens.every((t) => /\.mtl$/i.test(t))) return tokens
  return rest.trim() ? [rest.trim()] : []
}

/** Bilinear sample of `img` at texture coordinate (u, v) — v up, as OBJ
 *  has it, repeating outside 0…1 — into three bytes of `out` at `o`. */
export function sampleTexture(img: TextureImage, u: number, v: number, out: Uint8Array, o: number): void {
  const { width: w, height: h, rgba } = img
  const fu = u - Math.floor(u)
  const fv = v - Math.floor(v)
  const x = fu * w - 0.5
  const y = (1 - fv) * h - 0.5
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const tx = x - x0
  const ty = y - y0
  const xa = ((x0 % w) + w) % w
  const xb = (xa + 1) % w
  const ya = Math.min(Math.max(y0, 0), h - 1)
  const yb = Math.min(Math.max(y0 + 1, 0), h - 1)
  const p00 = (ya * w + xa) * 4
  const p10 = (ya * w + xb) * 4
  const p01 = (yb * w + xa) * 4
  const p11 = (yb * w + xb) * 4
  for (let c = 0; c < 3; c++) {
    const top = rgba[p00 + c] * (1 - tx) + rgba[p10 + c] * tx
    const bottom = rgba[p01 + c] * (1 - tx) + rgba[p11 + c] * tx
    out[o + c] = Math.round(top * (1 - ty) + bottom * ty)
  }
}

/** What an OBJ said about its texture, gathered while it was read. */
export interface ObjTextureRefs {
  /** Texture coordinates, u and v of each `vt` in turn. */
  uvs: ArrayLike<number>
  /** Per vertex, the `vt` its first textured corner names, -1 for none. */
  vertexUv: Int32Array
  /** Per vertex, the material that corner's face was in, -1 for none. */
  vertexMaterial: Int32Array
  /** The materials by the number vertexMaterial gives them. */
  materialNames: string[]
  /** The libraries the file names (mtllib). */
  libraries: string[]
}

/**
 * The colour each vertex takes from the images given, and what became of the
 * texture — or null when the file names none. An image is found by the name
 * its material's map_Kd gives it; when the libraries are missing, or name an
 * image that did not come, a single image given is taken for every material
 * (a scanner writes one). Without one, the files still wanted are named.
 */
export function bakeObjTexture(refs: ObjTextureRefs, given: ObjCompanions | undefined): { colors: Uint8Array | null; note: TextureNote } | null {
  if (refs.uvs.length === 0 || (refs.libraries.length === 0 && !given?.images.length)) return null
  const libraries = new Map((given?.materials ?? []).map((m) => [baseName(m.name), m.text]))
  const images = new Map((given?.images ?? []).map((img) => [baseName(img.name), img]))
  const missing = new Set<string>()
  const maps = new Map<string, string>()
  for (const lib of refs.libraries) {
    const text = libraries.get(baseName(lib))
    if (text === undefined) {
      missing.add(lib.split(/[\\/]/).pop()!)
      continue
    }
    for (const [name, file] of parseMtl(text)) if (!maps.has(name)) maps.set(name, file)
  }
  // Libraries given but not named in the file still say something.
  for (const [name, text] of libraries) {
    if (refs.libraries.some((l) => baseName(l) === name)) continue
    for (const [mat, file] of parseMtl(text)) if (!maps.has(mat)) maps.set(mat, file)
  }
  const only = given?.images.length === 1 ? given.images[0] : null
  const named = (file: string | undefined): TextureImage | null => (file ? images.get(baseName(file)) ?? null : null)
  // The image for each material, and for corners in no material at all.
  const byMaterial: (TextureImage | null)[] = refs.materialNames.map((m) => {
    const file = maps.get(m)
    const img = named(file) ?? only
    if (!img && file) missing.add(file.split(/[\\/]/).pop()!)
    return img
  })
  const loose = only ?? (maps.size === 1 ? named([...maps.values()][0]) : null)
  if (!byMaterial.some(Boolean) && !loose) {
    if (missing.size === 0) for (const f of maps.values()) missing.add(f.split(/[\\/]/).pop()!)
    return missing.size > 0 ? { colors: null, note: { kind: 'missing', files: [...missing] } } : null
  }

  const n = refs.vertexUv.length
  const colors = new Uint8Array(n * 3).fill(UNTEXTURED)
  const used = new Set<string>()
  for (let v = 0; v < n; v++) {
    const t = refs.vertexUv[v]
    if (t < 0) continue
    const m = refs.vertexMaterial[v]
    const img = m >= 0 ? byMaterial[m] : loose
    if (!img) continue
    used.add(img.name)
    sampleTexture(img, refs.uvs[t * 2], refs.uvs[t * 2 + 1], colors, v * 3)
  }
  return { colors, note: { kind: 'applied', images: [...used] } }
}
