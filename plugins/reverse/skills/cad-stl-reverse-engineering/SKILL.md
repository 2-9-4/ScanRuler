---
name: cad-stl-reverse-engineering
description: "Rebuild the exact CAD model and a STEP in ScanRuler from an STL that was exported from CAD software: a model downloaded from Printables, Thingiverse or GrabCAD, an old STL whose source file is lost, a part exported from an assembly, a print-in-place assembly, a threaded cap or bottle neck. Use it whenever someone wants the original design back from such an STL ('recreate the CAD from this STL', 'convert this STL to STEP exactly', 'make this STL editable / parametric again', 'get the design dimensions out of this STL'), and also when they just say 'reverse engineer this STL' and the mesh turns out to be a clean CAD tessellation: vertices exactly on the surfaces, flat faces made of long slivers with no interior vertices, few distinct heights. Catches STLs that were scaled after export and parts left at an angle. If the mesh is a real 3D scan (noisy, bowed faces, rounded edges), use scan-reverse-engineering instead."
---

<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# CAD-exported STL → exact CAD (ScanRuler)

**Read, don't fit.** A CAD export is not a measurement: every vertex lies on the true surface
(float32, ~1e-5 mm; on a face's edges sometimes up to ~5e-3 mm where the exporter held the edge
loosely). Faces are found by which surface their vertices lie on, profiles are read from the faces
themselves, and the model is checked against the mesh by volume, not by eye.

The scripts do the reading and write the features; you choose, look at what they drew, and fix
what they flag. Each script runs in seconds (segmentation of a 10k-triangle part: 5–60 s). On the
parts this was developed on the first automatic pass came within 0.03–3 % of the STL (volume of the
difference over the part's volume) — plates, brackets, gears, turned parts; harder parts (internal
cavities, several build directions) need the trims of §4.

| | 3D scan | CAD-exported STL |
|---|---|---|
| Vertices | noisy samples near the surface | on the surface |
| Numbers | fit, then snap within a tolerance | read exactly, then recognise the design value |
| Done when | deviation within T | `compare.py` difference ≲ 1 %, no cluster you cannot explain |
| Frame | aligned to datums | kept: the STEP lands on the STL (turned back with one moveBody if needed) |

## 0. Set up

- Work folder next to the STL: `<part>_work/`, scripts copied from this skill's `scripts/` (or run
  them from here). Python 3 with numpy, scipy, matplotlib. Keep paths short on Windows (260 chars).
- ScanRuler: `scanruler_status` (or `scanruler_open`), `session_state`. Open the STL with
  `scan_open` so the person sees it; the scripts read the STL file itself.
- Never modify the original STL. Deliver `<part>_CAD.step`, `<part>_CAD.scanruler`, a short report.

## 1. Analyze — is it a CAD export, and how is it built?

```
python scripts/analyze.py part.stl            # -> data/faces.pkl (+ faces.json, V/F/piece.npy)
```
Read from it:
- **CAD or scan.** Planes with residual ~1e-6 and cylinders/cones with exact round radii mean CAD.
  Thousands of "freeform" faces, bowed planes (residual > 1e-3), rings that fit no circle mean a
  scan, or a remeshed/decimated CAD export: hand over to `scan-reverse-engineering` and say why.
- **Its last line recommends how to build it**: `frame.py first`, `revolve.py --axis … --at …`,
  or `slabs.py --axis …`. Follow it unless you see a reason not to.
- **Frame.** If the faces are *not* square to the world axes (a part exported in its assembly
  position, tilted on a bed): `python scripts/frame.py part.stl` writes `data/local.stl`, the mesh in
  its own frame, and the `moveBody` that turns the result back. Run everything below on
  `data/local.stl` (analyze again) and add that moveBody as the last feature.
- **Per axis: caps + walls %.** The axis with the most area in caps square to it and walls along
  it is the main build axis (a plate: its thickness axis; a bracket: often its extrusion axis, not Z).
- **Axes.** Cylinders and cones grouped by axis line: holes (concave) with their chamfers and
  counterbores, bosses, and which round faces share the main axis.
- **Turned?** If most of the area is coaxial round faces and planes square to that axis (a spacer,
  bushing, knob, pulley, collet), build the body as one revolve (§2b), not slabs.
- Pieces: each connected piece becomes its own body.

## 2. Main body

### 2a. Prismatic parts: slabs along the main axis

```
python scripts/slabs.py --axis z --plot slabs_z.png    # -> data/slabs_z.json (steps)
```
Every plane square to the axis is a level; between two levels is a slab, cut at the height its other
faces disturb least. Each wall face along the axis becomes its exact curve (plane → line, cylinder →
arc with its fitted centre and radius, a tangent chain → lines and arcs read once for all slabs, a
spline wall → one spline through its vertices), corners at exact crossings. Faces of other
directions in the cut (a cross hole, a chamfer or round on an edge, a slot) are **healed**: the wall
runs on past a hole, a blend's own wall comes back, and only where that fails are the cut's points
kept (`UNHEALED`). Equal slabs merge into one extrude.

**Look at the plot** (grey = the cut, blue = the profile, red = unhealed) and the text:
- `material area: cut A, healed B <-- CHECK THE PLOT`: healing changed the area by > 10 %. Legitimate
  when a hole of another axis was filled (it is cut again in §3); wrong when blue leaves the grey.
- `note: … takes the profile of …`: a thin slab inside a chamfer band took a neighbour's profile.
- `!! could not close a loop` / red pieces: a face the reading could not place.
Fixes: `--at=lo:h` cuts slab `lo` at height h; `--borrow=lo:lo2` gives slab `lo` the profile of the
slab starting at `lo2` (the `=` is needed for negative numbers). Borrowing a *larger* profile and
then trimming along another axis (§4) is how a slab whose shape belongs to another axis is done:
an R4 round along X under a Z-built block has no Z wall to heal to.

### 2b. Turned parts: one revolve

```
python scripts/revolve.py --plot revolve.png          # axis found, or --axis z --at x0,y0
```
The section through the axis, read from the coaxial faces (end faces and shoulders, diameters,
chamfer cones, tori as arcs, spheres), half on one side, closed along the axis where solid. A
turned face no primitive fits (a screw head's spline dome with its rim round, merged into one face)
is read from its own vertices — each lies on the meridian — so it comes back as the arcs, lines or
spline it is, not as chords of the cut. Faces that are not coaxial (flats, cross holes) are healed
out; they come back in §3–4. A **socket on the axis** (hex, Torx, a slot across a head) is filled in
the revolve and cut as an extrude of its own outline, read square to the axis halfway down: the
script says `pocket on the axis … filled, and cut as "Turned body socket"`. The body is named
"Turned body" (use that as BODY below).

## 3. Holes along other axes

```
python scripts/holes.py --main z                       # -> data/holes.json
```
Each concave cylinder/cone group on an axis other than the main one is an exact revolve cut: counterbores,
entry chamfers, drill points, ends open (run on just past the entry ring) or floored. `--all` also
does holes along the main axis (slabs cut those as circles already, but not their chamfers or
counterbores). A hole at an angle (a set screw 4° off X) is drawn about the nearest world axis as a
body of its own, turned onto its axis with `moveBody` and cut from `--body` (default the first slab).
Fits under 0.15 mm radius are blends, not holes, and are left out.

## 4. Build, compare, trim and fill

Run the generated steps without pasting them: `scanruler_batch { "file": "<abs>/data/slabs_z.json" }`
(then `holes.json`, trims, blends). The scripts ask for terse answers (`detail: "none"`); read the
batch's `failed` list. The first slab names the body: `Z slab 0` (or `Turned body`).

Then measure:
```
reverse_export_stl { chord: 0.005, path: "<abs>/model.stl" }
python scripts/compare.py part.stl model.stl --faces data/faces.pkl --plot cmp.png \
       --suggest data/suggest.json --main z --body "Z slab 0"
```
`compare.py` voxelises both meshes (rays along all three axes, 0.1–0.2 mm grid; crossings counted
with their sense, so a mesh of several solids touching along faces — a bearing's rings and shields —
reads right): extra and missing volume, the difference as % of the part, and the clusters of difference with their box and the mesh
faces beside them. `--plot` draws mesh (grey) and model (red) sections through the largest
clusters — read it; it shows at a glance whether a cluster is a missing hole, a chamfer, a slab read
wrong or a feature of another direction.

A cluster made by walls along another axis (a pocket or slot from the side, an internal cavity, a
nose chamfered along X on a Z-built part) is fixed **along that axis**:
```
python scripts/slabs.py --axis x --from=21.4 --to=32 --box=0,-14.5,18.5,-4.1 --trim "Z slab 0" --out data/trim_0.json
python scripts/slabs.py --axis y ... --fill "Z slab 0" --out data/fill_0.json
```
`--trim BODY`: in the box (sheet coordinates of that axis: z→(X,Y), x→(Y,Z), y→(Z,X)) and the range,
everything outside that axis's profile is cut away. `--fill BODY`: what the profile has in the box
is joined on. `--suggest` proposes these from the clusters (axis voted by the walls round each
cluster); try them one at a time, keep a trim or fill only if `compare.py` says the difference fell.
Order of the features: main body, fills, trims, holes, blends. A trim can only remove; if the main
body lacks material there, fix the slab first (§2a) — usually `--borrow` a larger profile.

A **turned feature on a part built otherwise** (a groove round a gear hub, an undercut, a turned
recess) is the rotational counterpart:
```
python scripts/revolve.py --axis y --at 0,0 --name Groove --trim "Y slab 0" --box=4,4.5,6.2,12 --out data/rtrim.json
```
`--box=r0,t0,r1,t1` is a ring (radius from the axis, place along it); what of the ring lies outside
the part's turned profile there is cut. Equally, a turned part's non-turned features (a hex socket,
flats) are slab trims along the axis after the revolve.

## 5. Blends: chamfers and rounds on the remaining edges

```
python scripts/blends.py --main z --body "Z slab 0"    # -> data/blends.json
```
Every chamfer (plane/cone) and round (cylinder/torus) between two wider faces is read as the edge
it replaced and its size (setbacks from the sharp edge, the radius), grouped by size into one
chamfer or fillet feature each. Edges are picked by a point on them (`where: { through: { at } }`,
`optional: true`), and the features run with `skipFailing: true`: what the kernel cannot do is left
out, and the feature's `result.note` says where. Walls along the main axis are left out (their
blends are in the slab profiles); faces it could not read are listed as `unread`. Rebuild, compare.
Typical leftovers: a chain that meets a neighbour at a shallow crease (the kernel's limit), a
chamfer on a slab edge that differs from the design's edge.

## 6. Validate and deliver

1. `compare.py`: the difference as % of the part, and every cluster over ~1 mm³ either fixed or
   explained (a B-spline face approximated, a blend the kernel would not do). Report the number.
2. `reverse_body_check`: closed, valid, one solid per piece; list tiny faces it reports.
3. `reverse_export_step { verify: true }` → `<part>_CAD.step`; `project_save` → `<part>_CAD.scanruler`.
4. Optional, if the person wants the design numbers: `reverse_parameter_add` with the recognised
   values (radii, levels, chamfer sizes) and rename features after what they make.
5. Report: files; input (triangles, pieces, frame, scale); how the model was built (main body by
   slabs/revolve along which axis, holes, trims/fills, blends); validation numbers; what is
   approximate (spline/freeform faces read at one height, blends left out) and why.

Say plainly what kind of model it is: an exact *geometric* rebuild — every face where the STL has it
— built as stacked extrudes, cuts and blends, not the designer's own feature tree. If the person
needs a fully parametric tree (a sketch per design step, dimensions driving it), offer to restructure
the slabs that matter.

## Special cases

- **Scaled after export** (a slicer's non-uniform scale, inch↔mm): 45° chamfers read as other
  angles in one direction, heights are round only after dividing. The rebuild is exact either way;
  report the factor (`k = 13/15`: cone slopes 15:13, heights ×13/15) and the design values ÷ k.
- **Threads and coils**: faces that fit no cone yet unroll exactly — `helix.py` reads pitch, hand and
  profile; build a coil revolve and trim it (references/worked-example-lid.md). Standard 60° ISO/UNC
  threads: the `thread` feature.
- **Outlines that change with height** (beads, drafted lips): a drafted extrude both ways from the
  apex (references/worked-example-lid.md).
- **Freeform faces** (B-spline surfaces that are not prismatic, like a curved channel): slabs keep
  their cut as polyline (UNHEALED); the difference is at the level of their variation over the slab.
  Say so; a loft between sections (`reverse_feature_add { kind: "loft" }`) can do better.
- **Gears**: the teeth are walls along the gear axis; slabs read involute flanks as short lines and
  arcs (difference ~0.1 %).

## Older exact-reading tools

Still in `scripts/`, for checking a number or a case the pipeline does not cover: `profile.py`
(plan profile at one height), `rz.py` and `centers.py` (rings about an axis, exact centres),
`helix.py` (threads), `build_plan.py` (hand-edited sketches), `two_way.py` (two-way distances),
`slice.py`/`vslice.py` (pictures). `references/worked-example.md` (a Z-scaled clamp) and
`references/worked-example-lid.md` (threads, a bead) show them in use.

## ScanRuler quirks that cost time

- The kernel cannot chamfer or round across a shallow crease (two faces a degree apart) — those
  chains are what `skipFailing` leaves out.
- `reverse_export_stl` at a fine chord can leave faces meshed apart along an edge (T-junctions):
  `compare.py` says so; its voxel difference is unaffected, the mesh volume is only rough.
- Edge and face indices are positional; the scripts pick by place (`through`, `box`) instead.
- A slab extrude that fails "Joining left no closed solid" is two slabs whose walls nearly coincide
  but not quite: look at both slabs in the plot; borrow one's profile for the other.
