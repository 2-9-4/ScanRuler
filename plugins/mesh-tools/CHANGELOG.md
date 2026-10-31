<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Mesh Tools — changelog

What changed in the workspace up to version 0.8.7, newest first. From 0.9.0 on,
its changes are in the top-level CHANGELOG.md with the app's. Entries up to the
move into its plugin were in that file, under Unreleased.

## 0.8.1 to 0.8.7

- **Millimetres or inches** (2026-10-29, issue #16). With **Settings →
  Units** on inches every tool's fields, readouts, legends, the list of
  edits and the status lines are in inches; the reduced mesh, the piece and
  the edited copy can be exported as an STL in inches. A few messages built
  while a tool runs, which are also the agent's answers, still say
  millimetres. Every `mesh.*` answer stays in millimetres.

- **Export mesh: STL or 3MF** (2026-10-28). The reduced mesh, the piece and
  the edited copy go out through **Export mesh**, which asks for an STL or
  a 3MF; under the parts list they are **Export reduced mesh** and **Export
  piece mesh**. `mesh.export` takes `format: "3mf"`.

## 0.8.0 — 2026-10-26

- **Flip normals** (2026-10-25). A tool that turns triangles over so they
  face the other way: **Flip all**, for a part exported inside-out that
  the load left as it was wound (an open scan, a sheet), or **Flip marked**,
  the surface marked with a window, brush or lasso — amber — for patches
  of a scan that face in. Nothing moves and every vertex keeps its number;
  each flip is one step of the undo history, listed under Edited copy and
  kept in a saved project. Agents run it as `mesh.flip_normals`, with a
  region to flip only that, and `mesh.mark` marks for it
  (`for: "flip"`).

## 0.6.3 — 2026-10-21

- **Trim to scan gets through a scan with a gap at the break's edge**
  (2026-10-20). A spot the scanner missed where the fracture meets a skin,
  open to the break's rim, left the rim there on the scan's own ragged
  edge: carried out from it, the break wandered tens of millimetres
  through the body, the extension came out half a million triangles of
  slivers, and the cut never finished. Such a gap is now shut across its
  mouth and closed like a hole inside the break (`ExtendReport.bays`), and
  the rim goes on past it. On the case that showed it, a 2.6-million-
  triangle scan, the trim takes some 12 s.

## 0.6.1 — 2026-10-18

- **`mesh.show` says it changed the screen** (2026-10-18). It puts Mesh
  Tools on screen, so a `view.render` after it pictures the workspace's
  parts and not the view of the workspace before — which broke the
  pictures of an agent's helpers working in another workspace. Its
  description says so, and its answer gives `workspace` and, when it took
  the screen from another workspace, `back` (that workspace) with a note on
  how `workspace.set` puts it back.

## 0.6.0 — 2026-10-14

- **The section view cuts the workspace's marks too** (2026-10-13). The
  reduced mesh, the piece Trim to scan made, the islands, the rims, a cut's
  preview and the solids on offer are cut with the scan by the app's
  section view, and the reduced mesh and the piece are closed where they
  are closed (`MeshScene.dressSection`). The cut tool's own preview stands
  in front of the section view while it is open.
- **The view bar's Scan key** (2026-10-13). With no tool in hand it is the
  scan's eye in the parts list; with one, what is on the stage is the
  tool's, and the key is greyed out saying so. The workspace's view keys
  and the copy's **Deviation** stand at the side of the bar's one row.

## 0.5.3 — 2026-10-13

- **README** (2026-10-11): a Licences section for meshoptimizer and
  Manifold, and a roadmap without the hole filling and smoothing that
  ship.

## 0.5.0 — 2026-10-09

- **An agent can clean a scan up in the workspace** (2026-10-09). Through
  scanruler-mcp an AI agent runs the workspace's tools as commands under
  `mesh.`: every edit — remove islands, delete, cut, fill holes, smooth,
  shrink / expand, boolean, shell — the reduction and Trim to scan, taking
  the copy into use or throwing it away, the three STL exports, and what
  the panel shows while a tool is in hand: the islands and holes at a size,
  what a cut would close, the parts list. Surface the panel marks by hand
  is named as a box, a ball or a list of vertices, narrowed by the way it
  faces, or the marking on the part — which `mesh.mark` lays down for the
  agent to look at, and the person to put right, before the edit. Each
  command is the panel's code path, one step of the undo history under the
  agent's name, refused where the panel's button would be and while the
  workspace is at work, and answers with the mesh after it: triangles,
  bounds, closed or not, the volume it encloses. The workspace's verbs moved
  out of its React hook into a session of their own, which the panel and
  the commands share. Tests: `meshCommands` (a cube cleaned up, cut,
  expanded and hollowed and every step undone; a body trimmed to a block, a
  peg taken out, the block reduced; the refusals); the browser check
  `e2e-agent-mesh` through a real MCP client, in `npm run e2e:ci`.

## 0.4.6 — 2026-10-06

- **A parts list in Mesh Tools** (2026-10-04). With no tool in hand the
  panel lists what is in the viewport under Parts, each with an eye, as
  Reverse engineer lists its bodies: the scan — or the edited copy in its
  place — the reduced mesh and the piece Trim to scan cut, once made, and
  the bodies other workspaces lend, drawn see-through as Boolean offers
  them. The piece used to go with its tool, leaving only the scan to see; it
  now stays in view over the scan ghosted, to be hidden, shown alone or
  beside the body it was cut of, and exported from the list, as the reduced
  mesh can be. The scan and the reduced mesh lie on one surface and are
  shown one at a time. A tool in hand shows what it works on, as before;
  the eyes are a way of looking, not steps of the history. Tests:
  `meshStore` (the scan or the reduced mesh, one at a time, the scan back
  when the reduction goes, a fresh piece shown); `e2e-mesh-trim` (the piece
  in view with the tool put away, each eye).

- **Trim to scan** (2026-10-04). A tool for mending a broken part: scan
  what is left, model the missing piece in Reverse engineer — to the part's
  nominal shape, a few millimetres too long at the break — and cut it here
  with the scanned fracture, to print and glue in. Click the body on the
  part; the break is found where the scan lies deeper in the body than a
  depth (0.3 mm, under Advanced) — the part's own skins dip in only by the
  scatter and by how much larger the model is — and marked in teal, to be
  put right with the marking tools or marked by hand; Find again marks it
  afresh. **Offset from break** sets the mating face back from the fracture
  (0 to start: on it); Keep the other side turns round which side is kept.
  The break is carried on past the body at its edges, made a thin sheet,
  and the body cut with it in Manifold, so the body's own faces are never
  cut by anything but the break and a model a little larger than the part
  shows only a small step at the joint — not the flaps a body minus the
  scan leaves. The piece is shown over the scan ghosted, its mating face in
  teal; **Gap** colours that face by how far it is from the part, and the
  panel reads it at the median and over 90 % of it. Its own Export STL, in
  the aligned pose. The settings are steps of the history and kept in the
  project; the piece is made again with a click. Tests: `breakSurface` (a
  sheet through a box: the square the depth in from its walls, a marking
  narrowing it, specks, two patches), `extendRim` (the rim carried out in
  its own plane, a hole closed, two patches), `trimToScan` (a rough broken
  ring — the piece closed, its skins the body's, its mating face the offset
  off the fracture, nothing past the break; the rejected body minus the
  scan kept as a negative test; a box cut by a flat sheet to the cubic
  millimetre; the failures in words), `meshStore`, `meshProject`;
  `e2e-mesh-trim`.

- **Deleting part of the scan no longer turns the rest inside out**
  (2026-10-04). After a delete, what was left could come back drawn in the
  back-face colour all over. The top of a round wall with its inner face,
  kept on its own, was one such case. The copy is kept as a PLY and read
  back after every edit, and the reading guessed afresh which way the
  surface faces. For a strip that is open on every side and curves round
  its own inside, that guess comes out wrong. The copy's PLY now says its
  winding is settled, so it is read back as written: after an edit, a step
  back, a restart of the worker, taking it into use, and reopening a
  project. A copy kept before this change is still guessed at. Tests:
  `pieces` (the top and inner face of a round wall, kept by a delete and
  read back wound as the wall was).

- **No dimples in a thickened scan expanded** (2026-10-04). A scan
  thickened into a solid and then expanded came out pitted all over the
  second skin. The skin was left with triangles turned over — a spike of
  the scan copied in as a pit, scatter tilting the move a tenth of a
  millimetre aside — and the expansion, reading a turned triangle's normal
  the wrong way round, left its corners behind. A moved surface is now
  mended: a point nearer the scan than the distance because a spike stood
  proud of it is taken out to the distance, its neighbours with it; a
  triangle turned over or worn to a sliver on the moved surface is closed
  up, two points merged into one — across a strip beside an edge, not
  along it — and the rest eased and put back at the distance; and a move
  reads the normals over about as far as it goes, ignores slivers, and
  ignores a face turned against the rest round a point. The status line
  counts the points merged and eased. Tests: `meshOffset` (a scan-like
  bracket, at 0.3 mm and at 0.15 mm with twice the scatter, thickened 2 mm
  with next to no fold in its second skin and expanded 0.5 mm with no point
  left behind; an open box's strips closed into exact inner edges, merged
  rather than left as slivers).

- **Shrink / expand** (2026-10-04). A tool that moves the surface along its
  normal by a distance — out to expand, in to shrink — not a scale: a ball
  expanded by 0.5 mm is a millimetre larger across, and a bore in the part
  a millimetre narrower. For the thickness a scanning spray laid on, a
  clearance on a mating face, a print that came out a little fat. Even
  thickness, as a CAD offset: each point moves so every face around it ends
  the distance out — on a sharp edge further, square to neither face, so
  the edge stays sharp; no point more than three times the distance. The
  faces' normals are averaged first, edges never crossed, over about as
  far as the move goes, so a scan's scatter does not crumple the moved
  surface. **Whole part**, or a **Marked region** (violet) moved as a step:
  where the face beside it runs along the move — marked up to a machined
  edge — that face is stretched or shortened with it, evenly over a band,
  and the edge stays sharp; elsewhere the region is split from the surface
  and joined to it by a wall. A strip beside an edge the move turns into is
  taken back out to the distance from the surface, onto the moved edge;
  folds left over — a bump tighter than the distance — are eased. Every
  point keeps its number, so **Deviation** reads the move. About half a
  second on a 1.3-million-triangle scan. Saved with the project, and each
  setting a step of the undo history. Tests: `meshOffset` (a box's faces
  the distance out, corners √3 times it, its volume 11³ from 10³; a ball's
  radius; a noisy scan with nothing turned over; a bump shrunk past its own
  curvature eased; a face marked up to its edges pushed out and in, a push
  deeper than the side's triangles included; a patch in the middle of a
  face stepped with a wall, its rim's numbers where the rim stayed),
  `meshStore`, `meshProject`; `e2e-mesh-shell`.

- **Shell / hollow** (2026-10-04). A closed part is **hollowed**: its outside
  left as scanned, every vertex where it was, and an inner wall the
  thickness in from it sealing a cavity. The wall is built from the part's
  distance field — inside read column by column, a distance transform, the
  exact distance in a band round the wall, marching tetrahedra on Kuhn's
  six — not by moving the scan in, so it never folds and never comes nearer
  the outside than the thickness, and where the part is thinner than twice
  the wall it stays solid; it is reduced to within a sixteenth of a grid
  cell with meshoptimizer. A ball 100 mm across hollowed with a 2 mm wall
  comes out within 0.2 % of the cavity's volume, in about five seconds on a
  1.3-million-triangle scan. An open surface is **thickened** into a solid —
  a second skin **Inward** (to start), **Outward** or to **Both sides**, the
  strip beside an edge closed up into it as Shrink / expand does, and a wall
  round every rim. A part closed but for holes Fill holes would fill is asked
  to have them filled first (**Fill holes first**), or thickened as it is.
  The wall starts at a 125th of the part's diagonal. Tests: `meshOffset` (a
  ball and a box hollowed, the cavity its volume and the wall the thickness;
  a part too thin left solid; a mesh with holes refused; a sheet thickened
  three ways into a closed slab; an open box thickened into a cup, and with
  a wall four triangles thick its strips closed up into exact inner edges,
  the search built only when something folds), `meshStore`, `meshProject`;
  `e2e-mesh-shell`.

## 0.4.5 — 2026-10-03

- **The Boolean opens with nothing in hand** (2026-10-02). Opened again
  after an operation it held the solids the last one had used up, and a
  lone solid was taken into hand by itself; it now opens with none, and
  **Select all** and **Unselect all** over the list take every solid in or
  out at once. Tests: `meshStore`; `e2e-mesh-boolean`.

- **The reduction map follows the colour map** (2026-10-02). The map of a
  reduction's or a copy's deviation, and its scale, are painted in whichever
  ramp ⚙ Settings → Colour map has chosen, the caps past the tolerance that
  map's own.

- **Boolean with several solids at once** (2026-10-02). A click on a solid
  on the part puts it in hand and a click on it again takes it out, and the
  panel lists every solid on offer with a box to tick; all those in hand go
  as one, their union, in one edit — every bore of a flange taken out at
  once, a body and a fitted cylinder together, the part trimmed to what
  either of two boxes holds. A solid in hand that misses the mesh, would
  seal a hollow in it or adds nothing to it is refused by name, solids that
  overlap named together — read off how much of each piece of the union's
  surface the result holds, from the one boolean. Tests: `meshBoolean` (two
  bores in one edit; a solid given twice taken once; what the mesh shares
  with either of two solids; the one that misses, seals a hollow or adds
  nothing named, and two overlapping named together).

- **Boolean with a fitted cylinder, cone or sphere as it is**
  (2026-10-02). Every cylinder, cone and sphere shown in 3D Measure is on
  offer beside the bodies modelled in Reverse engineer — as it is drawn
  there, at its Assumed Ø and out as far as it was extended — with no body
  to make of it first. A bore is cut out with the cylinder fitted to its
  wall, extended down past its floor and up out through the surface. A
  hidden element is not offered: one extracted as a body is hidden, and on
  offer as that body. Tests: `measuredSolids` (each kind closed, outward,
  of its volume; a bore cut with a fitted cylinder; only those shown, as
  drawn; a new version when the shape changes).

- **The edited copy follows Sharp edges** (2026-10-02). It was split for
  shading once, as it was made; it is split again when the setting or its
  angle changes, as the scan is, its marking kept.

- **Boolean: the solid is clicked on the part, and the tool goes away
  when it is done** (2026-10-02). Every solid on offer is drawn on the part
  while the tool is in hand — the one in hand in the operation's colour, one
  under the cursor a shade lighter, the rest slate — and a click on one
  takes it; the panel's list does the same, and a lone solid is in hand from
  the start. The button reads **Perform operation**, and once the boolean
  lands the tool is put away.

- **Escape puts the tool in hand away** (2026-10-02), as does a click on
  its key again: the panel then shows the keys alone. Not while a tool is
  at work, and a marking or a question asked first still backs out a step
  at a time.

- **Boolean: a solid taken out of the scan, added to it, or what the two
  share kept** (2026-10-02). A seventh tool edits the copy of the scan with a
  solid body modelled in Reverse engineer: **Subtract**, **Add** or
  **Intersect**. Made for the bore a scanner could not see to the bottom
  of, which the scanning software closed part way down: fit a cylinder to
  the wall the scan shows, extract it as a body, make it a touch wider and
  longer with Move face, and take it out here — the bore comes out clean to
  its floor. While the tool is in hand the solid is drawn on the part,
  red, green or blue for what will happen to it, see-through and faintly
  through the scan, and the panel says whether the mesh is closed, which a
  boolean needs. The boolean is Manifold's (Apache-2.0, `manifold-3d`
  3.2.1 — the last release without the CAD tooling, and its LGPL image
  library, among its dependencies), loaded in the worker on first use;
  a 1.3-million-triangle mesh takes about three seconds. The scan's
  vertices that are left keep their places and their numbers, carried
  through Manifold as vertex properties and trusted only where the position
  came back exact, so a marked surface survives the edit; the surface the
  solid brings has none and is grey in the Deviation view. A solid that
  never meets the surface is refused by name — wholly inside it would seal
  a hollow, not open a hole. Tests: `meshBoolean` (a blind bore, a boss, the
  common part, closed and of the right volume, the block's vertices
  carried through; an open mesh, a solid sealed inside and one that misses
  refused), `meshStore`, `meshProject`; `e2e-mesh-boolean` models the
  cylinder, grows it, takes it out of a block, exports and undoes.

- **Export STL for the edited copy** (2026-10-02). The Edited copy section
  saves the copy as it stands, as `name-edited.stl` — `-aligned` when the
  part was moved — in the pose the scan is shown in, without taking it into
  use first.

- **The imprint credits the workspace's libraries** (2026-10-02):
  meshoptimizer (MIT) and Manifold (Apache-2.0).

## 0.4.4 — 2026-09-28

- **Mesh Tools: edits on a copy, taken into use when you say so**
  (2026-09-25). Remove islands, Delete marked, Cut, Fill holes and Smooth
  now edit a copy of the scan instead of the scan itself. The first edit
  makes it; Mesh Tools shows it in the scan's place, while every other
  workspace goes on measuring the scan as it was — nothing is fitted again
  while you work. The panel's **Edited copy** section lists the edits on it
  and its triangles beside the scan's: **Use for analysis** makes the copy
  the scan every workspace measures (elements fitted again, maps measured
  again, marked surfaces carried across by the edits' composed vertex
  numbering), **Discard** throws it away, and **Deviation** — a key in the
  view bar, there whatever the tool — colours the copy by its signed
  distance from the scan in use, with a colour
  bar, the reading under the pointer, and surface an edit added — fills,
  caps — shown grey. Every edit, Use for analysis and Discard are steps of
  the undo history; a saved project keeps the copy (`edited.ply`, its
  numbering, the edits waiting on it); Reduce mesh reduces the copy when
  there is one. The worker holds the copy beside the scan and moves it with
  every alignment; the viewport trades the two in the scan's place, the
  scan's element tints and maps kept out of sight. Tests: `regionColors`
  (trading states), `meshEdits` (composed maps, the deviation summary),
  `meshStore`, `project` (the copy saved and read back);
  `e2e:mesh-edits` and `e2e-mesh` walk the copy through use, undo, and a
  saved project. Reduce mesh's view key for how far the reduction strays is
  **Accuracy** now, beside the copy's Deviation.

- **Mesh Tools: smoothing a marked region** (2026-09-25). Smooth takes
  **Whole part** or **Marked region**: the second marks the surface to smooth
  with the window, brush and lasso every marking uses, in blue, and smooths it
  alone — each point by less the nearer it is to the region's edge, nothing at
  the edge, so the patch runs into the scan around it without a step; the
  fits still read the scan on both sides. The list says the edit was
  regional. Tests:
  `meshEdits` (a band of a noisy sheet smoothed, nothing outside it moved,
  the edge row barely); `e2e:mesh-edits` smooths a window-marked region.

- **Mesh Tools: delete marked, cut, fill holes, smooth** (2026-09-25). Four
  more tools that edit the scan, each on its own key beside Remove islands
  and each, like it, one step of the undo history that every workspace then
  measures, kept in a saved project with the list of edits.

  **Delete marked** takes surface marked by hand with the window, brush or
  lasso every other marking uses — a clamp, a fixture, a patch of the
  table. A triangle goes when all three corners are marked, the triangles
  shown in orange; it asks first (Enter / Esc), and Escape stands a marking
  gesture down without losing the marking.

  **Cut** takes one side of a plane off: across the XY, YZ or XZ plane — the
  datum's after an alignment, so Z 0.5 is half a millimetre above the face
  the part was set on — or across an element with a direction, from the
  part's middle until an offset is typed, keeping either side. While the
  tool is in hand the part is shown cut, the side that goes taken away and
  the cut closed with the cap the cut itself will make — worked out by the
  worker on the scan as it stands, not a stencil trick that on an open scan
  closes whatever the eye looks through — with the stretches that will stay
  open drawn grey and the panel saying which it is. **Close flat** caps every loop where the plane goes all the way round the
  part — a ring across a bore, faces nested by depth — so a closed part
  stays closed. A hole in the wall right at the cut is bridged across the
  plane when the gap is short against the rim, so the face still closes and
  Fill holes closes the rest; a rim with no short way round is left open and
  counted. Triangles are clipped at the plane with the crossing points
  shared along each edge, so the rim is joined up.

  **Fill holes** finds every open rim, marks those smaller across than a
  size (a twentieth of the part to start; measured by the rim's longest
  span, so a round hole reads its diameter) in orange with a ring and the
  larger ones faint, and closes them after Liepa (2003): the least-bending
  triangulation across the rim by dynamic programming (long rims are laid
  flat and ear-clipped past 500 edges), refined to the scan's density with
  Delaunay flips,
  and faired — **Curved** by a least-squares bi-Laplacian that reaches one
  ring onto the scan and carries its slope across, **Flat** by a membrane.
  The scan's own vertices are not moved. A click on a hole's ring fills that
  hole alone; the ring under the pointer is drawn larger.

  **Smooth** moves every point onto a quadric fitted to the scan around it
  (moving least squares) over a patch the size of the bumps to take out — 2
  mm on a hand-sized part to start, never under a few of the mesh's edges —
  along its normal only and never further than a limit of where the scanner
  put it. Smoothing triangle by triangle (Taubin λ|μ) barely touched a dense
  scan, whose bumps are many triangles across; a quadric takes out what is
  smaller than the patch and keeps what is larger — a noisy ball keeps its
  radius to a micrometre. With **Keep sharp edges** each side of an edge is
  fitted on its own and the strip along the edge is left as scanned. A 1.4
  million triangle scan smooths in about six seconds. The result says how
  far the surface moved, at most and RMS.

  Reverse engineer's sketch slice now leaves the clip plane alone while no
  sketch is sliced, so the cut preview can use it. Tests: `meshEdits`
  (rims, cut, cap and its preview on a box and a tube, curved and flat fills
  on a ball and a face, one hole of two filled, smoothing: ripples under and
  over the size, a ball's radius, a ridge kept and rounded, the limit),
  `meshStore`, `project`; `npm run e2e:mesh-edits` on a generated noisy box
  with two holes, one filled by a click on its ring.

- **Mesh Tools: remove islands, and reduce a scan for CAD**
  (2026-09-25). A new workspace for tools that work on the mesh itself,
  picked from a row of tool keys; two so far.

  **Remove islands** takes the specks a scanner leaves floating off the
  scan: every piece joined to nothing else and smaller across than a size
  you set (a hundredth of the part to start). The panel counts the pieces
  and says how much room the size has either side, and the islands are
  marked on the part — tinted orange and each in a ring a fixed size on
  screen, the ring showing faintly through the part for one behind it or
  inside it. Nothing is deleted until you say so: **Remove** asks first,
  with how many islands and triangles go, and **Delete** (Enter) or **Keep
  them** (Esc) answers; a new size takes the question back. Deleting them
  changes the scan for every workspace and is one step of the undo history. The edited scan is kept as
  a PLY in the frame the original was opened in — indexed, so its vertices
  keep their numbers — and loaded in place of the old one under everything
  measured on it: hand-marked surfaces, a deviation map's scope and Reverse
  engineer surface regions are renumbered onto it, elements are fitted
  again, sections cut again and maps and a reduction measured again. Undo
  loads the scan from before the edit the same way. A saved project keeps
  the edited scan under the name it was opened as, with the list of edits.

  **Reduce mesh** makes a light mesh to model over in CAD — a few thousand
  triangles instead of millions — held within a tolerance of the scan and
  exported in the pose the part was aligned to. The reduction is quadric
  edge collapse by meshoptimizer (MIT, loaded on first use), with each
  collapsed vertex moved to its best-fit position. The tolerance is
  measured, not trusted: every result is measured both ways, scan to
  reduced mesh and back, and the scan points where it strays are pinned
  and the scan reduced again until 99.9 % of each side holds — on the
  reference scans two to three times fewer triangles than tightening the
  error target for the whole part. A triangle limit, 50,000 to start,
  reduces further when the tolerance needs more, and the result says how
  far it then strays. The view bar shows the reduced mesh with its edges,
  the scan painted with its deviation from it, or the scan alone; a turn
  begun on the reduced mesh pivots on it. The scan itself is left as it
  is. Settings are saved with the project and undone like any other.

  Tests: `pieces`, `reduce`, `meshStore`, `project`; `npm run e2e:mesh`,
  which also checks that no, and Esc, leave the scan as it is.
