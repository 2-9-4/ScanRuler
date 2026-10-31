// SPDX-License-Identifier: AGPL-3.0-only
// A patch network's cells and their map onto the square (PN5, PN7): a 2 × 2
// network on a sheet reads into four four-sided cells and nothing else
// closed; a curve taken out opens a cell, named where; a strip round 270°
// of a cylinder — one cell that folds back over itself — maps one-to-one,
// as a saddle does; a scan hole inside a cell is closed by a fan; a cell
// of two sides and one of seven are refused by name.

import { describe, expect, it } from 'vitest'
import { ScanPaths } from '../../../src/core/geometry/scanPath'
import type { Vec3 } from '../../../src/core/types'
import { traceNetwork } from '../core/network'
import { readCells } from '../core/networkCells'
import { cellMesh, mapCell } from '../core/networkMap'
import { gridNetwork, gridScan, network } from './networkMeshes'

function cellsOf(scan: ScanPaths, f: ReturnType<typeof gridNetwork>) {
  const t = traceNetwork(scan, f.nodes, f.curves)
  return { traced: t, cells: readCells(scan, t.nodes, t.curves, f.cells.map((c) => c.seed)) }
}

function mapped(scan: ScanPaths, traced: ReturnType<typeof traceNetwork>, cell: ReturnType<typeof readCells>['cells'][number]) {
  if (cell.status !== 'ok') throw new Error(cell.message)
  const at = new Map(traced.nodes.map((n) => [n.id, n.at]))
  const mesh = cellMesh(scan, cell.triangles, cell.holes, cell.corners.map((c) => at.get(c)!))
  if (typeof mesh === 'string') throw new Error(mesh)
  return mapCell(mesh)
}

describe('patch network cells', () => {
  const sheet = (u: number, v: number): Vec3 => [100 * u, 80 * v, 3 * Math.sin(2 * u) * Math.cos(v)]
  const scanOf = (m: { positions: Float32Array; indices: Uint32Array }) => new ScanPaths(m.positions, m.indices)

  it('reads a 2 × 2 network on a sheet into four four-sided cells', () => {
    const scan = scanOf(gridScan(120, 96, sheet))
    const f = gridNetwork(1, 2, 2, sheet, 1, [0.15, 0.85, 0.15, 0.85])
    const { cells } = cellsOf(scan, f)
    expect(cells.cells.map((c) => c.status)).toEqual(['ok', 'ok', 'ok', 'ok'])
    for (const c of cells.cells) if (c.status === 'ok') expect(c.sides.length).toBe(4)
    // Each cell its own share of the sheet, about a quarter of the
    // network's 70 × 56 mm.
    const counts = cells.cells.map((c) => (c.status === 'ok' ? c.triangles.length : 0))
    for (const n of counts) expect(n / counts[0]).toBeCloseTo(1, 1)
    // Nothing else is closed: the outside runs off to the sheet's rim.
    expect(cells.unfilled).toEqual([])
  })

  it('offers the cells no seed fills, and names where a cell is open', () => {
    const scan = scanOf(gridScan(120, 96, sheet))
    const f = gridNetwork(1, 2, 2, sheet, 0, [0.15, 0.85, 0.15, 0.85])
    const two = { ...f, cells: f.cells.slice(0, 2) }
    expect(cellsOf(scan, two).cells.unfilled.length).toBe(2)
    // The first row's left curve taken away: the first cell opens.
    const open = { ...f, curves: f.curves.filter((c) => !(c.from === 1 && c.to === 4)) }
    const reading = cellsOf(scan, open).cells.cells[0]
    expect(reading.status).toBe('refused')
    if (reading.status === 'refused') expect(reading.message).toMatch(/^not closed — open at \(/)
  })

  it('maps a strip round 270° of a cylinder one-to-one', () => {
    const r = 20
    // The scan: the whole cylinder, 40 mm tall; the cell: 270° of it,
    // 30 mm tall, its arcs drawn through grips a quarter turn apart.
    const scan = scanOf(gridScan(180, 40, (u, v) => [r * Math.cos(2 * Math.PI * u), r * Math.sin(2 * Math.PI * u), 40 * v], { wrap: true, noise: 0.01 }))
    const on = (deg: number, z: number): Vec3 => [r * Math.cos((deg * Math.PI) / 180), r * Math.sin((deg * Math.PI) / 180), z]
    const f = network(
      2,
      { 1: on(0, 5), 2: on(270, 5), 3: on(270, 35), 4: on(0, 35) },
      [
        { from: 1, to: 2, via: [on(90, 5), on(180, 5)] },
        { from: 2, to: 3 },
        { from: 3, to: 4, via: [on(180, 35), on(90, 35)] },
        { from: 4, to: 1 },
      ],
      [on(135, 20)],
    )
    const { traced, cells } = cellsOf(scan, f)
    const cell = cells.cells[0]
    expect(cell.status).toBe('ok')
    const map = mapped(scan, traced, cell)
    expect(typeof map).not.toBe('string')
    if (typeof map === 'string') return
    // The map runs round the cylinder with the angle one way and up it the
    // other — which way round the square depends on the corner it starts
    // at, so each of the square's eight symmetries is tried.
    const { mesh, uv } = map
    const symmetries: ((a: number, b: number) => [number, number])[] = [
      (a, b) => [a, b], (a, b) => [1 - a, b], (a, b) => [a, 1 - b], (a, b) => [1 - a, 1 - b],
      (a, b) => [b, a], (a, b) => [1 - b, a], (a, b) => [b, 1 - a], (a, b) => [1 - b, 1 - a],
    ]
    const worst = symmetries.map((s) => {
      let w = 0
      for (let i = 0; i < mesh.scanVertex.length; i++) {
        const [x, y, z] = [mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2]]
        let deg = (Math.atan2(y, x) * 180) / Math.PI
        if (deg < -45) deg += 360
        const [a, b] = s(uv[i * 2], uv[i * 2 + 1])
        w = Math.max(w, Math.abs(a - deg / 270), Math.abs(b - (z - 5) / 30))
      }
      return w
    })
    // The boundary's vertices lie up to a grid row — 1 mm of the 30 —
    // outside the curves; the rest within a hundredth.
    expect(Math.min(...worst)).toBeLessThan(0.04)
  })

  it('maps a saddle, and closes a scan hole inside a cell with a fan', () => {
    const saddle = (u: number, v: number): Vec3 => [60 * u - 30, 60 * v - 30, ((60 * u - 30) ** 2 - (60 * v - 30) ** 2) / 60]
    const scan = scanOf(gridScan(90, 90, saddle, { hole: (u, v) => Math.hypot(u - 0.5, v - 0.5) < 0.08 }))
    const f = gridNetwork(3, 1, 1, saddle, 1, [0.2, 0.8, 0.2, 0.8])
    f.cells = [{ seed: saddle(0.3, 0.3) }]
    const { traced, cells } = cellsOf(scan, f)
    const cell = cells.cells[0]
    expect(cell.status).toBe('ok')
    if (cell.status !== 'ok') return
    expect(cell.holes.length).toBe(1)
    const map = mapped(scan, traced, cell)
    expect(typeof map).not.toBe('string')
    if (typeof map === 'string') return
    // The fan's middle is mapped inside, near the square's middle.
    const middle = map.mesh.scanVertex.findIndex((v) => v === -1)
    expect(middle).toBeGreaterThan(0)
    expect(map.uv[middle * 2]).toBeCloseTo(0.5, 1)
    expect(map.uv[middle * 2 + 1]).toBeCloseTo(0.5, 1)
  })

  it('refuses a cell of two sides and one of seven by name', () => {
    const scan = scanOf(gridScan(100, 100, (u, v) => [100 * u, 100 * v, 0]))
    // Two curves from one node to another, bowed apart: a lens.
    const lens = network(4, { 1: [30, 50, 0], 2: [70, 50, 0] }, [{ from: 1, to: 2, via: [[50, 65, 0]] }, { from: 2, to: 1, via: [[50, 35, 0]] }], [[50, 50, 0]])
    const two = cellsOf(scan, lens).cells.cells[0]
    expect(two.status === 'refused' && two.message).toBe('two sides')
    // A heptagon.
    const corners: Record<number, Vec3> = {}
    for (let k = 0; k < 7; k++) corners[k + 1] = [50 + 30 * Math.cos((2 * Math.PI * k) / 7), 50 + 30 * Math.sin((2 * Math.PI * k) / 7), 0]
    const seven = network(5, corners, Array.from({ length: 7 }, (_, k) => ({ from: k + 1, to: ((k + 1) % 7) + 1 })), [[50, 50, 0]])
    const reading = cellsOf(scan, seven).cells.cells[0]
    expect(reading.status === 'refused' && reading.message).toBe('7 sides — split it with a curve')
  })
})
