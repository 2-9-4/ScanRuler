<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Mold Making workspace

**Current tooling modes are Direct-print mold and Silicone mold box.** The experimental thin negative shell mode was removed; previously saved shell recipes migrate to Direct, preserving their other settings. New mold runs show a progress bar with sampling updates. Fast preview sampling now caps the SDF at 80,000 cells; use Balanced or Fine for detail-sensitive final printing. Extra disconnected Boolean islands are exported separately rather than silently discarded or blocking the entire assembly; inspect their size and shape before printing.

Native ScanRuler workspace for manufacturing mold tooling from imported STL, OBJ, PLY, 3MF and CAD STEP/STP solids. Target import, project persistence, the mesh worker, Manifold booleans, mesh offsets, and STL/3MF export use existing ScanRuler infrastructure.

## Workflows

- **Direct-print rigid molds:** The default makes **two full-height, separate manifold pieces** divided at an adjustable plane (X, Y or Z; plane fraction 0.1–0.9). Four pieces use an additional perpendicular plane. The original target cavity is subtracted BEFORE splitting, so geometry above the parting plane is retained. Only the explicitly selected one-piece setting is a truncated open impression.
- **Silicone containment boxes:** rectangular or **cylindrical**, with printed base, wall thickness, silicone space, and **interior box-wall draft** (0–12°). Supports one, two or four components using the same split logic. A master must be held in place and sealed before pouring silicone. Box registration is on external wall bosses rather than the single bottom plate, keeping upper walls aligned.
- **Mating features:** choose **tapered printed keys** (default), straight printed pins, or **paired blind clearance sockets for purchased metal dowels** (no printed pins). Registration diameter, depth and radial clearance are configurable. Default automatic placement distributes **two widely spaced keys per seam**, reducing the count when smaller split interfaces cannot safely accommodate them. Alternatively, manual placement exposes editable key positions as percentages of the shared seam span, with add/remove controls and a draggable seam editor (click to add, drag to move, double-click/Delete to remove). Coordinates are applied to every applicable split interface, not yet independently per interface; direct dragging in the viewport remains planned under #12. Direct-print mold keys are placed in the solid backing below the cavity. Silicone buckets instead add solid **exterior wall bosses** at the ends of each parting seam, at two different heights by default, then form printed pins or blind dowel sockets in those bosses. Manual key percentages on silicone buckets adjust boss **heights**, not the old bottom-of-box seam positions. Four-part buckets assign bosses to each quadrant's exterior edge. Too-thin or narrow seams are rejected rather than silently omitted. Four-part Z-first keyed splitting is not supported.
- **Opaque preview:** each STL is a separate closed geometry component. The viewport shows a solid (not translucent) rendering; the exploded gap can be adjusted to zero to assemble the virtual halves.
- **Export:** a **separate STL for each part** or a **single 3MF with separately positioned parts** on a printable plate. Never concatenate coincident mating planes into one STL. Materials/triangles and per-part warnings are shown before exporting.

## Fidelity and draft notes

Default cavity clearance is **0 mm**, retaining the source facets exactly. Positive clearance now uses a **sampled spherical Minkowski dilation**: the solid's signed Euclidean distance is evaluated against its original triangles (using an accelerated triangle BVH) and fed to Manifold 3.2.1's `levelSet` mesher at a negative iso-level. This rounds sharp corners instead of moving individual vertices along averaged normals, and is used for the direct mold cutter. The reported grid spacing and refinement tolerance are important: this is **not an exact analytic CAD offset** and may lose sub-grid features. To avoid excessive browser memory usage and slow sampling, **Balanced** (default) caps sampling at approximately **850,000 cells** (previously 8 million); **Fast** targets 80,000 cells for previews, while **Fine** allows up to 6 million for higher detail. The actual grid spacing depends on model dimensions and is printed in generated warnings. Each setting also scales the level-set refinement tolerance. Models exceeding the chosen budget and maximum grid spacing fail explicitly rather than silently returning the old jagged normal-offset geometry. The synchronous Manifold level-set callback reports approximate progress from the mesh Web Worker, and uses previous-face BVH bounds to accelerate nearby distance queries. It is not parallelized, and multithreading would require a separate SDF sampling/data-flow design rather than simply spawning more UI workers. The source is never modified. OpenCascade's B-rep offset algorithm is not used here because the mold worker receives a tessellated mesh even when the source originally came from STEP. Native Manifold Minkowski sums arrived after the project's pinned Manifold 3.2.1, and the newer implementation is still computationally expensive for very dense, nonconvex inputs. High-fidelity preservation for extremely small features still needs a production CAD/SDF offset implementation. 


Generated CSG/level-set mold parts are checked separately from the imported master. If Manifold's mesh export creates a zero-area triangle (even when the master is valid and source repair is enabled), the export stage first tries a topology-preserving vertex adjustment of at most 0.001 mm, then native Manifold simplification at 0.00001 and 0.0001 mm. It accepts only a closed, positive-volume mesh with material-volume change below a strict tolerance; otherwise the output is rejected with an output-specific error. The source-repair toggle does not control this generated-mesh cleanup.

Four-piece molds are now partitioned completely **before** their registration features are added, so a second split does not shear pins installed on the first seam. Extremely skinny but nonzero-area triangles on parting faces are accepted. Mold Making now offers **Repair small mesh defects** (enabled by default): it works only on a temporary target copy, preserves closed source topology by lifting collapsed triangle vertices by at most **0.001 mm** (no dropped faces), and, on open targets, also attempts the same connectivity-preserving lift before any face removal; only if lifting is impossible does it remove **exactly zero-area triangles** and join **exactly coincident** vertices if that improves watertightness, and tries Mesh Tools' flat then curved hole-filling algorithms and validates the patched triangles for zero area to patch only complete boundary loops smaller than the **Max repair hole size (mm)** control (default 2 mm). A full report of what changed appears in generated warnings; **the scan, imported file, and STEP reference are not altered**. Larger rims, broken edge chains, nonmanifold edges and failed patches still block generation for **direct-print molds**; the **silicone containment box only uses the model's bounding coordinates** and requires no manifold/watertight target or repair pass. Do not increase the hole limit blindly: any patch is a guess at missing source material. For deliberate edits, use **Mesh Tools → Fill holes → Use for analysis**, or repair the mesh externally. When a split produces multiple disconnected solids, each substantial island is preserved as a separate named exportable component, with explicit loose-part warnings. Only microscopic Boolean dust is discarded under a strict volume budget. Manually inspect detached components before printing; they are not guaranteed usable mold features. The Mold Making panel wraps tool-choice button labels, long setting names and errors within the panel width. See #32 for regression coverage on production models.

The **box draft** angle only applies to the containment box's *inner walls*. **Proper part-surface draft and undercut removal for rigid molds are not implemented yet**. Parting by itself does not make every shape demoldable; it may require additional/manual splits, vents/sprues and draft. Pins and splits do not act as liquid seals. A castable fully-enclosed direct mold normally needs a sprue and vents, which remain on the roadmap.

## Local verification

```sh
npm ci
npm run build
npm test
node scripts/check-plugin-boundary.mjs
npm run dev
```

Open the local build (not scanruler.com), select **Mold Making**, and import [cube-10mm.stl](fixtures/cube-10mm.stl). Generate a two-part direct mold with **0 clearance**; both STL files should be closed solids and cover the full 10 mm target height. Generate four parts and inspect each. Compare tapered and straight printed pins, then select metal dowel sockets and verify that both halves have holes (not pins). Try manual key fractions 25% and 75%, and verify the cavity is unchanged. For the four-piece test, check that each interface has registration without keys cutting across the other split. Then change to a circular silicone box, set 2° draft and 2 parts, and inspect the bottom, open top and matching split. Open the 3MF in a slicer and check that all its parts are spaced apart. Repeat with a watertight STEP part and a model with slender features.

There are committed regression tests for these cases, **but they are not a substitute for a locally executed build and physical slicer/print QA**.

## Known limitations

Arbitrary rotated/curved multi-plane parting, 3D-draggable/per-seam registration, model-aware keys, sprues/vents, clamps, channels, draft on the casting surface, extraction/undercut analysis, self-sealing master mounts, and high-fidelity detail-preserving spherical offset are still open issues. Production mold release and material compatibility are user responsibilities.

Full feature tracking: [docs/mold-making-issues.md](../../docs/mold-making-issues.md). In particular, #6, #7, #8, #10, #11, #12, #13, #14, and #25.


**Direct mold mating features use the complete 2D parting plane**, not the lowest backing Z level. On an X seam the editable coordinates are Y/Z; Y seams use X/Z; Z seams use X/Y. Automatic placement searches up to four safe locations around the part's conservative projected bounding rectangle, at both top and bottom and along both lateral edges when room permits. Pins and sockets that would overlap the projected casting envelope are rejected before any Boolean. The direct mold panel includes a genuine 2D parting-plane editor with draggable pins, arrow-key adjustments and per-axis numeric coordinates; after the first successful generation it displays a dimensionally accurate projected target rectangle based on source geometry and current margins. Four-part seams repeat normalized positions across their individual seam spans. The silicone-box exterior boss editor remains a separate height/end editor.

**Disconnected output artifacts are not equivalent to malformed imported sources.** Manifold may report a positive-volume detached component whose Float32 exported mesh has negligible or negative signed volume. Export checking now uses an origin-relative volume calculation to avoid catastrophic cancellation on small parts far from the coordinate origin; fully valid detached islands are exported separately, reversible-winding islands are corrected and revalidated, and truly invalid detached pieces are omitted with a highlighted warning of the kernel-reported volume. Main mold pieces remain strictly validated, and no invalid island is included in printable export. If significant detached material was omitted, review all cavities and mating features before manufacturing.



### Spherical clearance integrity

The signed-distance field uses angle-weighted vertex pseudonormals and
two-face edge pseudonormals to classify interior/exterior points at sharp
features. Using a single nearest triangle normal at those locations can
invert the distance sign, produce disconnected SDF islands, and corrupt molds
even with Fine sampling. Increasing resolution alone does **not** fix a
wrong sign. The offset generator now rejects a result that contains more
connected components than the source (a true outward dilation cannot split
source components).

Output meshes with nontrivial disconnected solids, or excluded invalid
Boolean fragments, are explicitly **preview-only**. Exporting their STL or
3MF is blocked rather than implying the largest resulting piece is a valid
mold. Tiny numerical dust below the existing strict budget may still be
filtered. If the tool remains preview-only, inspect the model and provide a
reproduction mesh; do not print the fragmented output.

## Contour registration and preview (2026-10)

The default **two-piece direct mold** now uses a continuous V-profile
tongue-and-groove. It follows a convex rough silhouette projected into the
parting plane with rounded corners rather than placing isolated pins in block
corners. This is deliberately an **outer approximation** of the target's
projected geometry; small concavities are not followed, so the registration
does not enter the cast cavity. The ridge is backed by solid material and the
socket includes radial fit clearance. Multiple user-sized exterior ears on each
mating half permit applying external clamps (no automatic holes or clamp
hardware specification). The minimum necessary backing is now automatically calculated from the
seam dimensions, so zero extra margins are valid.

This contour method is implemented for **two-part direct molds**,
including X/Y/Z splits. Two-part **silicone containment boxes** also have a
V-seam: a **capped U-profile** follows the two outer sidewalls and solid base
for an X/Y split, leaving the top pour opening unobstructed; a horizontal Z
split uses a **closed ring** supported by the printed walls. Round boxes
follow a circular wall profile. **Four-part molds now use four separate open
V-ridge/groove pairs**: each is trimmed back from the perpendicular
parting plane to avoid crossing another seam, with clamp ears on the
appropriate exterior quadrant. For threefold radial tooling, all three
120-degree radial interfaces support a vertical, capped V-profile,
printed pins, or matching blind metal-dowel sockets.

The V seam has its own **width, height, offset/spacing from the target or
outer walls, and groove fit clearance**. These dimensions do not depend on
the pin diameter or pin fit. The male V-ridge now has a **flattened tip**
(24% of its half-width) for easier insertion, while the corresponding
female groove remains open and clearance-fit. Exterior clamp ears are
united into each mold half **before** cutting the female groove, so a tab
cannot accidentally refill a nearby socket. Clamping tabs have independent
**count per outside edge, width along that edge, projection from the
mold exterior, and thickness per half**. Increasing their count/width
may increase the generated backing to fit distinct tabs.

**Dimension fields called "extra" default to zero**. The generator first
calculates the minimum solid wall/backing necessary for the selected cavity
clearance, registration feature, and tab layout, then adds the user's extra
side/base/wall material. Entering zero does not turn off necessary
structural walls. Silicone space remains an explicit physical distance.
Old saved project dimensions named sideMargin/baseThickness/wallThickness are
still accepted and now represent additional material, so legacy projects
with positive values can generate larger molds than previously.

The default 3D result view is the **assembled mold with the original
source model visible and a section plane perpendicular to the primary
parting plane**. Toggle to an exploded preview in the mold panel; only
the separate mold pieces are included in STL/3MF export. The assembled preview opens the application’s native section-view store,
including its existing interactive plane gizmo and ViewBar controls. The
mold meshes use ScanRuler's native `CapSet` to close the sectioned faces
with the same stencil caps as other scene layers, rather than just clipping
open surface shells. Exploded preview moves two parts along the chosen split
axis, four parts diagonally along both split axes, and threefold sectors
radially along their 120-degree sector bisectors. The previous section-view state is restored on exit.

**Threefold** splits use three vertical 120-degree radial sectors around the
target's XY bounds center, with a cylindrical outside for direct mold
tooling. This is a threefold **mold layout**; it does not duplicate or
symmetrize an asymmetric input model. Check radial demoldability. The
threefold layout supports registration, but does not currently generate
external clamp ears.

**Voxelization:** positive clearance already uses a sampled signed
distance field (a voxel-like scalar grid) before a Manifold isosurface.
The primary cavity and all split, key and box Booleans remain
surface/Manifold operations. Coarse voxel Booleans may accelerate
operations but introduce quantization and higher memory usage; this
change does not replace the exact split planes or final export geometry
with raw occupied voxels.

## Mold hardware and downstream editing

Clamping ears can now be placed on the **top and bottom exterior edges**
of X/Y parting faces as well as the previously supported side edges. These
are optional and have their own count, hidden until enabled. Threefold
radial tooling receives clamping ears along all three 120-degree interfaces,
distributed along Z; it uses the same ear dimensions/count as other layouts.
Threefold V registration now returns inward from the outer rim toward the
projected cavity contour (with a fixed safety clearance) rather than using
only a short ridge at the outside.

The tab hardware settings are optional and conditional: enabling **through
bolt holes** drills a clearance bore through both registered ears, with
independently specified diameter; enabling **captured nuts** adds a
six-sided recess to the outside of the negative half using an
across-flats dimension and pocket depth. The generator automatically grows
ear thickness, width and projection as required by the requested hardware.
These are modeled holes, not supplied nuts/bolts, and must be checked
against the actual fastener dimensions and torque requirements.

Four-part rectangular tooling now has small vertical **exterior corner
chamfers**, cut before the four-way split. This gives each outside corner
a planar printing/fixturing land without beveling the cavity corners.
Existing legacy one-piece impression projects remain loadable, but new
one-sided impressions are no longer offered as a creation choice.

The Mold Making result opens as an **exploded model**, with the original
source shown inside. A separation slider is overlaid on the 3D viewport
and can return to zero gap. The assembled button still uses ScanRuler's
native section view. Individual generated mold parts are offered through
`src/app/solids.ts`, where Mesh Tools' Boolean panel can select them as
operands while the original scan remains in place.

For freeform mesh edits, **Edit copy** imports a selected mold part as
a scan into Mesh Tools. **CAD reference** opens the selected part as the
scan in Reverse engineer so sketches and modeled bodies can be built over
it. Both explicit import actions **replace the previous scan**; the
Boolean-solid handoff does not. This is a triangulated reference, not a
parametric reconstruction of a molded part.
