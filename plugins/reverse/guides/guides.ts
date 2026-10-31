// SPDX-License-Identifier: AGPL-3.0-only
// The workspace's guides, as guide.read serves them to an agent: modelling
// a part (with or without a scan), what a scan adds to that, and the
// reference both send an agent to a section at a time. Each file is loaded
// when first read, so the page carries none of it until an agent asks.

import { registerGuide } from '../../../src/plugins/api'

export function registerReverseGuides(): void {
  registerGuide({
    id: 'model',
    title: 'Modelling a part in the Reverse engineer',
    when: 'designing or editing a solid part feature by feature — sketches, extrudes, revolves, lofts, booleans, rounds, parameters, STEP — from given numbers, a drawing or a description, with or without a scan; how the session, notes, batches and jobs work for a modeller, the kernel’s habits and the checks before a handover',
    text: () => import('./model.md?raw').then((m) => m.default),
  })
  registerGuide({
    id: 'scan-to-cad',
    title: 'Scan → CAD reverse engineering',
    when: 'reverse engineering a 3D scan (STL, PLY, OBJ, 3MF) into a parametric CAD solid and STEP: reading the scan, its tolerance and datums, measuring it for the model, building from it by the part’s archetype, validating against it both ways, the report',
    with: ['model'],
    text: () => import('./scan-to-cad.md?raw').then((m) => m.default),
  })
  registerGuide({
    id: 'model-reference',
    title: 'Modelling and scan reverse engineering — reference',
    when: 'every tool’s shape with an example, the feature kinds with their fields, constraints and picks, plane frames, what answers cost, what refusals mean — a section at a time, as the model and scan-to-cad guides send you',
    text: () => import('./model-reference.md?raw').then((m) => m.default),
  })
}
