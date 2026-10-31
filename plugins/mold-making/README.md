<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Mold Making workspace

Native ScanRuler workspace for manufacturing mold tooling from imported STL, OBJ, PLY, 3MF and CAD STEP/STP solids. Target import, project persistence, the mesh worker, Manifold booleans, mesh offsets, and STL/3MF export use existing ScanRuler infrastructure.

## Workflows

- **Direct-print rigid molds:** The default makes **two full-height, separate manifold pieces** divided at an adjustable plane (X, Y or Z; plane fraction 0.1–0.9). Four pieces use an additional perpendicular plane. The original target cavity is subtracted BEFORE splitting, so geometry above the parting plane is retained. Only the explicitly selected one-piece setting is a truncated open impression.
- **Silicone containment boxes:** rectangular or **cylindrical**, with printed base, wall thickness, silicone space, and **interior box-wall draft** (0–12°). Supports one, two or four components using the same split logic. A master must be held in place and sealed before pouring silicone.
- **Thin conformal negative shells:** offset outer cavity shells; two/four-piece splitting now preserves the *full model height* by default. Normal-based offset is still experimental for tight details. No registration pins yet on thin shells.
- **Mating features:** default 3 mm male pins and clearance-fit female pockets, located in the solid base below the cavity. Dimensions and radial clearance configurable. Pins are rejected rather than silently omitted when the base is too thin or the mold is too narrow. Z-first four-way pinned splitting is not supported; use X or Y or turn the keys off.
- **Opaque preview:** each STL is a separate closed geometry component. The viewport shows a solid (not translucent) rendering; the exploded gap can be adjusted to zero to assemble the virtual halves.
- **Export:** a **separate STL for each part** or a **single 3MF with separately positioned parts** on a printable plate. Never concatenate coincident mating planes into one STL. Materials/triangles and per-part warnings are shown before exporting.

## Fidelity and draft notes

Default cavity clearance is **0 mm**, so the imported facets and thin detail are not silently modified by a smoothing offset. **Positive clearance grows the master cutter, which enlarges the negative cavity and decreases the mold's printed material volume**. It is not a clearance offset inward into the final casting. You can opt in to positive cavity clearance, but **the existing normal-based mesh offset can still remove gaps narrower than twice the selected offset**. Generation now refuses an offset that merges mesh vertices, decreases the positive cutter's volume, or breaks through the mold exterior. Local folds that require geometry relaxation are explicitly warned; robust solid morphological dilation is still open under #30.

Four-piece molds are now partitioned completely **before** their registration features are added, so a second split does not shear pins installed on the first seam. Extremely skinny but nonzero-area triangles on parting faces are accepted; exactly zero-area faces still fail with a triangle index. Independently printable components must still be contiguous solids. See #32 for regression coverage on production models. Thin conformal shells currently require a normal offset for their wall thickness and have the same limitation. A watertight outward-wound target is required; Mesh Tools can repair imperfect scans.

The **box draft** angle only applies to the containment box's *inner walls*. **Proper part-surface draft and undercut removal for rigid molds are not implemented yet**. Parting by itself does not make every shape demoldable; it may require additional/manual splits, vents/sprues and draft. Pins and splits do not act as liquid seals. A castable fully-enclosed direct mold normally needs a sprue and vents, which remain on the roadmap.

## Local verification

```sh
npm ci
npm run build
npm test
node scripts/check-plugin-boundary.mjs
npm run dev
```

Open the local build (not scanruler.com), select **Mold Making**, and import [cube-10mm.stl](fixtures/cube-10mm.stl). Generate a two-part direct mold with **0 clearance**; both STL files should be closed solids and cover the full 10 mm target height. Generate four parts and inspect each. Enable keys and compare male/female mating faces. Then change to a circular silicone box, set 2° draft and 2 parts, and inspect the bottom, open top and matching split. Open the 3MF in a slicer and check that all its parts are spaced apart. Repeat with a watertight STEP part and a model with slender features.

There are committed regression tests for these cases, **but they are not a substitute for a locally executed build and physical slicer/print QA**.

## Known limitations

Arbitrary rotated/curved multi-plane parting, model-aware keys, sprues/vents, clamps, channels, draft on the casting surface, extraction/undercut analysis, self-sealing master mounts, and high-fidelity detail-preserving conformal offset are still open issues. Production mold release and material compatibility are user responsibilities.

Full feature tracking: [docs/mold-making-issues.md](../../docs/mold-making-issues.md). In particular, #6, #7, #8, #10, #11, #12, #13, #14, and #25.
