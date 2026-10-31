<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Worked example: "Lid_rev5.stl" (turned bodies, custom threads, spout and bead)

A two-piece screw lid exported from CAD, rebuilt as an exact 2-body STEP with 26 features. It was the
skill's first test on a part other than the clamp. Read it for threads and for outlines that change
with height; the numbers are this part's, not rules.

## Input and inventory
- 12258 vertices, 24512 triangles, closed, 2 pieces → 2 bodies: a threaded **neck** with a teardrop
  spout and a V-bead, and a ribbed **cap** with an internal thread.
- No scaling: heights 0, 2, 10, 14.5, 18, 21.5, 22, 34.5, 35; cones 45°, 50°, 60° exactly (k = 1).
  The load.py scale hints for the bead's R0.4 tip round (three |nz| classes with 840 triangles each)
  were facet strips, not cones; load.py now flags that pattern.
- Placement: as a slicer left it (bbox centre 90, 90), kept.
- No mirror symmetry about the mid-planes. Both pieces are turned parts, each about its own axis:
  neck (68.508176, 109.117898), cap (109.257381, 73.195081), from segment.py centres refined with
  centers.py (residuals 9e-6 and 1e-5).

## Exact reads
- Neck outside (rz.py): R20.5 wall, a 50° flange from z 18 to 22 (R22 at 19.78763 … 21.5), top chamfer
  0.5 × 45° to R20 at z 35. Bore R17.5 with a 1 × 30° bottom chamfer (ring R18.077349 at z 0).
- Spout outline: a plain slice at z 9 gave 261 lines and no arcs (the wall's top and bottom rings are
  out of step). `profile.py --plane z --at 0 --edges` read it exactly: the R20.5 circle, two R20 arcs
  centred 20 mm either side of the axis and tangent to it, an R0.25 tip.
- Bead: every vertex ring was the spout outline offset by d (same centres, radii ± d); d linear in z
  → a 50° drafted extrusion both ways from the apex at z 5, apex offset 2.608376, half-height
  3.108544 (kept as measured: no round value explained it), tip round R0.4.
- Threads (`helix.py`): single start, right hand, pitch 4.000000 (residual 6e-6).
  - Neck: 90° V tooth (45° flanks), sharp crest R22, 1 mm root flat at R20.5. Top run-out along a 50°
    cone (r 22 → 20.5 while h rises 1.5·tan 50°); bottom starts buried in the flange.
  - Cap: the same V as a groove, offset 0.2 mm square to the flanks (root R22.282843 = 22 + 0.2·√2),
    crest flat at R20.8 (the bore).
- Cap: R25.3 outside, 2 × 45° outer chamfers, floor 2, rim z 14.5, 15 grip grooves R2 on R25.3 at
  24° spacing (first at +X). The grooves read R1.99994 (res 3.6e-4) over the whole face because
  the face includes intersection-curve vertices; on the wall band alone R2.000000 (res 6e-6).

## Designer's tree (build order)
1. **Neck profile / Neck**: revolve of the outside (R20.5, the 50° flange, top chamfer), solid.
2. **Spout outline / Spout**: the z 0 outline (`"edges": true`) extruded 0 → 10, joined.
3. **Bead apex outline**: the same outline grown by the apex offset (`"grow"`), sketched at z 5.
   **Bead upper / Bead lower**: extruded ±3.108544 with draft 40° (= 90° − 50°), each landing back
   on the outline; joined.
4. **Bead tip round**: R0.4 on the four apex edges.
5. **Bore profile / Bore**: revolve cut, after the bead (the drafted bead filled the bore).
6. **Neck thread tooth / coil**: the tooth with flanks run on into the wall (r 20.2 < root 20.5),
   coiled with pitch 4 for 1350°, starting at θ 90° (the x-plane's +Y side) with the crest at
   z 20.5, buried in the flange. **Neck thread envelope**: a revolved ring whose top is the 50°
   run-out cone. **Trim neck thread** (boolean intersect), **Join neck thread**.
7. **Cap profile / Cap**: revolve: the cup with chamfers, floor and R20.8 bore.
8. **Grip grooves / cut**: 15 × R2 circles on R25.3, cut through.
9. **Cap thread groove / coil**: the offset groove, run on into the bore void, coiled with pitch 4
   for 1800°. **Cap thread envelope** clips it to z ≥ 2. **Trim cap thread**, **Cut cap thread**.

## Validation reached
| check | result |
|---|---|
| `reverse_body_compare` range 0.02 | 12258/12258 within, max +0.0154 / −0.0148, far 0 |
| Deviation workspace, no best fit | RMS 0.0012, 100 % within ±0.02, 0 hotspots, far 0 |
| two_way.py | max 0.0100 both ways; RMS 0.0014 / 0.0017 |
| Volume | neck −0.010 % (bore and internal faces: the mesh holds more there), cap +0.0002 % |
| Body check | 2 valid closed solids, audit clean |
| STEP re-import | **unsound: true**: one of the 15 cap chamfer-cone faces could not be meshed, and the spout top had open edges. Both are zero-angle cusps in the design (the R2 grooves touch the R23.3 chamfer foot; the R20 arcs run tangent into R20.5). Reported as a reader limitation; the user was asked to confirm the STEP in their CAD. |

## What it taught the skill
- Threads need their own reading (`helix.py`) and their own build (coil, envelope, intersect, join or
  cut); the `thread` feature only does 60° standard profiles.
- When a slice gives no arcs on a round outline, read the outline from the mesh edges (`--edges`).
- Volume can come out below the mesh on a correct model with large concave faces.
- Save the project before the STEP check, which replaces the deviation reference.
- Name sketches and features apart: "Neck thread envelope" was both, and a name lookup was ambiguous.
