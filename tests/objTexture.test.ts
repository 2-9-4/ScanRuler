// SPDX-License-Identifier: AGPL-3.0-only
// A textured scan's colours, read onto its vertices, and a CAD part opened
// in a scan's place, cut finely enough to be worked on as one.

import { describe, expect, it } from 'vitest'
import { parseOBJ } from '../src/core/parsers/obj'
import { parseMtl, sampleTexture, type TextureImage } from '../src/core/parsers/objTexture'
import { parseSTEP } from '../src/core/parsers/step'
import { buildMeshGraph } from '../src/core/geometry/buildGraph'
import { cubeStep, stepBuffer } from './stepFixtures'

const encode = (text: string) => new TextEncoder().encode(text).buffer

/** A 2×2 image: red and green on the top row, blue and white below. */
function quad(name = 'tex.png'): TextureImage {
  const px = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255]]
  const rgba = new Uint8Array(16)
  px.forEach((c, i) => rgba.set([...c, 255], i * 4))
  return { name, width: 2, height: 2, rgba }
}

/** Two triangles over the unit square, each corner sampling the middle of
 *  the image's pixel it sits on — v up, so the top row is v = 0.75. */
const SQUARE = `mtllib part.mtl
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
vt 0.25 0.25
vt 0.75 0.25
vt 0.75 0.75
vt 0.25 0.75
usemtl skin
f 1/1 2/2 3/3
f 1/1 3/3 4/4
`
const MTL = 'newmtl skin\nKd 1 1 1\nmap_Kd C:\\scanner\\out\\TEX.png\n'

const rgbOf = (colors: Uint8Array, v: number) => Array.from(colors.subarray(v * 3, v * 3 + 3))

describe('textured OBJ', () => {
  it('colours each vertex from the image its material names', () => {
    const mesh = parseOBJ(encode(SQUARE), undefined, { materials: [{ name: 'part.mtl', text: MTL }], images: [quad()] })
    expect(mesh.texture).toEqual({ kind: 'applied', images: ['tex.png'] })
    // (0.25, 0.25) is the bottom-left pixel, blue; (0.75, 0.75) top-right, green.
    expect(rgbOf(mesh.colors!, 0)).toEqual([0, 0, 255])
    expect(rgbOf(mesh.colors!, 1)).toEqual([255, 255, 255])
    expect(rgbOf(mesh.colors!, 2)).toEqual([0, 255, 0])
    expect(rgbOf(mesh.colors!, 3)).toEqual([255, 0, 0])
  })

  it('takes a single image given for every material, without its library', () => {
    const mesh = parseOBJ(encode(SQUARE), undefined, { materials: [], images: [quad('anything.jpg')] })
    expect(mesh.texture).toEqual({ kind: 'applied', images: ['anything.jpg'] })
    expect(rgbOf(mesh.colors!, 2)).toEqual([0, 255, 0])
  })

  it('names the files it still wants, and keeps the geometry either way', () => {
    const alone = parseOBJ(encode(SQUARE))
    expect(alone.colors).toBeUndefined()
    expect(alone.texture).toEqual({ kind: 'missing', files: ['part.mtl'] })
    expect(alone.indices).toEqual(new Uint32Array([0, 1, 2, 0, 2, 3]))

    const noImage = parseOBJ(encode(SQUARE), undefined, { materials: [{ name: 'part.mtl', text: MTL }], images: [] })
    expect(noImage.texture).toEqual({ kind: 'missing', files: ['TEX.png'] })
  })

  it('says nothing for an OBJ with no texture', () => {
    const plain = parseOBJ(encode('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n'))
    expect(plain.texture).toBeUndefined()
    expect(plain.colors).toBeUndefined()
  })

  it('reads map_Kd past its options, and keeps a name with spaces', () => {
    const maps = parseMtl('newmtl a\nmap_Kd -s 1 1 1 -o 0 0 0 -bm 0.5 my texture.png\nnewmtl b\nKd 1 0 0\n')
    expect(maps.get('a')).toBe('my texture.png')
    expect(maps.has('b')).toBe(false)
  })

  it('blends between pixels and repeats past the edge', () => {
    const out = new Uint8Array(3)
    // Halfway between red and green along the top row.
    sampleTexture(quad(), 0.5, 0.75, out, 0)
    expect(Array.from(out)).toEqual([128, 128, 0])
    sampleTexture(quad(), 1.25, 0.25, out, 0)
    expect(Array.from(out)).toEqual([0, 0, 255])
  })
})

describe('STEP opened as the scan', () => {
  it('is cut into a grid fine enough to work on, and stays a cube', () => {
    const asReference = parseSTEP(stepBuffer(cubeStep(20)))
    const asScan = parseSTEP(stepBuffer(cubeStep(20)), undefined, true)
    const triangles = asScan.mesh.indices!.length / 3
    expect(triangles).toBeGreaterThan(50 * asReference.mesh.indices!.length / 3)
    expect(triangles).toBeLessThan(1_000_000)
    // Every vertex lies on the cube's surface, and the graph builds on it.
    const p = asScan.mesh.positions
    for (let i = 0; i < p.length; i += 3) {
      const onFace = [p[i], p[i + 1], p[i + 2]].some((c) => Math.abs(c) < 1e-4 || Math.abs(c - 20) < 1e-4)
      expect(onFace).toBe(true)
    }
    expect(buildMeshGraph(asScan.mesh).vertexCount).toBe(p.length / 3)
  })
})
