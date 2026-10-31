<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Mold Making workspace

Native ScanRuler plugin to turn a scanned part or STEP model into a printable mold component. Generated geometry is not a modified scan; it is a separate preview/export.

## First geometry slice

- Use **Scan / model** to import STL, OBJ, PLY, 3MF, STEP/STP directly. Alternatively choose **Reference** to reuse a separately loaded CAD or mesh reference. Both use ScanRuler's existing parsers and unit conversions.
- **Direct-print mold**: creates an open one-sided negative cavity in a box. It intentionally captures only the portion of a target below its midplane; this is **not** a full two-part mold.
- **Silicone mold box**: creates a sealed-bottom, open-top container around a master, with user-set silicone space, base and printable wall thickness. The physical master still needs support/attachment; automatic fixtures are not implemented.
- **Thin negative shell**: offsets the source geometry for a conformal negative cavity, clips it at the midplane, hollows the internal target volume. This is a *one-sided* shell, not yet general undercut/extraction tooling; complex concavities may fail the offset safety checks.
- Preview the generated part, read material volume and warnings, export **STL (mm)** or **3MF**. Both export precisely the inspected mesh, not an unrelated CAD body.
- Save recipe settings in `.scanruler`; source assets are already saved by core ScanRuler. Regenerate output after reopening.
- Generation runs off the main thread via ScanRuler's mesh worker and reuses Mesh Tools' Manifold Booleans and offset code. Refuse nonwatertight or inward-wound inputs/outputs. A STEP file is tessellated through the existing STEP importer, and all operations from there are mesh-based.

## Local smoke test

From the fork:

```sh
npm ci
npm run build
npm test
node scripts/check-plugin-boundary.mjs
npm run dev
```

Open the local Vite URL (not scanruler.com), select **Mold Making**, and import [cube-10mm.stl](fixtures/cube-10mm.stl) as **Scan / model**. With **Direct-print mold**, set **Casting clearance** to **0 mm**, generate, and export an STL; verify a solid, single-sided square cavity in a slicer. Change to **Silicone mold box**, generate and verify the bottom and open walls. Switch to **Thin negative shell**, use a small printed wall and generate again; offset failures must be reported, not exported. Repeat the flow with a known watertight STEP solid, and with a nonwatertight mesh to verify that generation refuses the invalid source.

These are manual smoke checks, not claims that CI or a local build has already succeeded.

## Known limitations before production use

Molds are currently **single-sided**, and have no parting/key system, sprues, venting, smart sealing, undercut detection, demold simulation, or print minimum-wall guarantee. Do not interpret a successful Boolean as a proof of casting manufacturability. Test on small sacrificial prints, check mesh inspection in a slicer, and account for silicone inhibition and printer tolerances.

The roadmap and issue links are in [docs/mold-making-issues.md](../../docs/mold-making-issues.md). Track the generation and validation milestones through #5, #6, #7, #8, #9, and #25.
