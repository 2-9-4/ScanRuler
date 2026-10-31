<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Reverse engineer — changelog

What changed in the workspace up to version 0.8.7, newest first. From 0.9.0 on,
its changes are in the top-level CHANGELOG.md with the app's. Entries up to the
move into its plugin were in that file, under Unreleased.

## 0.8.2 to 0.8.7

- **A failed round says what size it takes** (2026-10-31). On a body of alike
  chains, chains the time allowed did not reach read as 0 and threw away the
  size found on the first, so a patterned fan's rounds answered "not found:
  over budget" every time. One chain of each alike set is read now and the
  answer tried on them all together; a set that only rounds together is no
  longer blamed on the edge, and a round that built last time names what
  changed before it. A rim that answered "not found" now says "up to 0.82, both
  together".
- **`reverse.body.fillet_try`** (2026-10-31): up to 8 sizes on the body just
  before the round, nothing kept and nothing after it built. A fan's agent
  called R0.95 a kernel limit after a 9–86 s rebuild per try, where R1.2 builds.
- **The STEP check no longer fails a good freeform file** (2026-10-31). The
  kernel's volume of a B-spline body is off by up to percents, high or low, and
  a fan's file read `ok: false` for a 0.50 % it did not have. Where the two
  figures part by over 0.1 % the two meshes are held against each other. A body's
  volume in an answer takes the mesh's where they part by over 0.5 %, on freeform
  bodies only, so closed-spline prisms no longer read 3 % low. It stays up to
  0.5 % off: this fan reads 94290 against about 94040.
- **The STEP check is quick** (2026-10-31). It asks each point of the file of
  the same face first, where it asked the whole body: its gap took 79 s on the fan and
  takes 2.6 s. Export and verify on the fan 94 → 26 s, the pipe 21 → 1.1 s, the
  flange 36 → 10 s.
- **An edge 0.01–0.1 mm off its face is a note, not a failure** (2026-10-31).
  Over 0.1 mm it still fails the file. A clamp's four at 0.014 mm failed it.
- **A sweep can follow a route in 3D** (2026-10-31): `route: { points, bendRadius,
  radii? }` in place of a path sketch, so bends in several planes are one
  feature. A bend that does not fit its straights is refused, naming the point
  and the most it takes, as is one tighter than the profile's nearest wall, which
  the kernel builds and passes. The route moves with the part; the panel shows it,
  and edits only its bend radius.
- **`reverse.scan.tube_trace`** (2026-10-31) reads a tube's centreline off the
  scan, with a route for the sweep. It stops at a size jump over 15 %, so a bellows or
  flange is reported, never crossed. On an exhaust pipe R26.5 and R24.8, against
  26 and 25 by hand.
- **`reverse.sketch.edit { set }`** (2026-10-31) moves pieces in place, keeping
  ids and relations. A fit's piece ids now come at detail `none`.
- **Parameter answers give `usedBy`** (2026-10-31; it was `readBy`). The review
  and `compare_in_deviation` name parameters that drive nothing: 8 of a fan's 12.
- **`reverse.body.check` answers a pattern once** (2026-10-31): bodies and
  findings alike, with counts. 10.5 → 1.3 kB after a fan's blade pattern.
- **A review's trend leaves out inferred material** (2026-10-31), so modelling a
  bore the scan never saw no longer reads as worse.
- **occt-wasm stays at 5.7.1** (checked 2026-10-31 against 5.11.0). It reads the fan's
  volume right (94033, read-back 0.0012 % apart), but the fan's build goes 87 → 200 s
  and a closed-spline prism reads 3 % low.

- **Sketches alone no longer wait on the kernel** (2026-10-31). A list with no
  solid step lands at once. A first sketch on a triple clamp stood 306 s behind
  a kernel that did not answer, and was then told it had failed, though it was
  there. Why the kernel was silent is not known; a list with solids still waits
  as before.
- **An extrude to a face that falls short says by how much** (2026-10-31): the
  largest the profile runs past the face, in mm and as a share of its width,
  which is what a fitted surface's `expandPct` adds. The run tried 15, 45, 70,
  40, 30 and 60.
- **A save and an export say when the plan is open** (2026-10-31): how many
  regions and the target. A second revision of the clamp ended with all 13 open.
- **STEP export no longer hangs after a comparison** (2026-10-30). A check of
  the read-back meshed the body coarsely in place straight after a comparison's
  fine mesh, and OCCT went on for minutes: a 480-face flange never exported, in
  a shown tab as well. It meshes a copy now: over 300 s and let go became 28 s
  for export and verify. A mended file is checked once, not twice, so the export
  alone went from 28 s to 2.2 s. `reverse.export.step` and `.stl` run as jobs:
  they take `wait: false` and answer queued at the limit.
- **A face the mesher leaves bare is drawn on its own** (2026-10-30), found by
  its area, so viewers and compares get a whole mesh. The flange's two "excess
  lumps" of 62 and 49 mm³ stood on two such faces and are gone.
  `reverse.body.check`, `volume_compare` and `review` name each such face and
  how far its edge strays (`meshFaults`).
- **What the STEP check calls open** (2026-10-30). A read-back hair is a pole,
  not a free edge, only where the body has the same pole. An edge over 0.01 mm
  off its face and a file edge going round one face are now problems. The
  flange now reads `ok: false` for two edges up to 0.57 mm off, not for 17 hairs.
- **Sketches: kinks, ellipse, inset, fit against draft** (2026-10-30). A sketch's
  answer flags joins turning 0.2–5° (`kinks`), which stop a tangent chain's
  fillet, with the fix. Shape `ellipse` is a closed spline with its deviation
  from a true ellipse stated. `sketch.inset` works per closed chain, refusing by
  chain. `fit.draftDeg` moves fitted chains so an extrude with that taper lands
  on the wall cut at `fit.level`. An unknown field under a sketch or its fit is
  refused with the fields it has.
- **A fillet or chamfer on a feature's several solids** (2026-10-30). Naming a
  multi-solid feature, edges by query, goes on each solid hit, all or none, one
  undo step. `body: <its id>` with a query used to take the first solid
  silently. A fitted chamfer or round leaves seam edges out and says how many.
- **The plan: rounds in a profile, one region, inferred regions** (2026-10-30).
  `reverse.plan.replace` credits a failed round drawn as an arc in an extrude's
  or revolve's own sketch, within a fifth of its radius, and names the arc; it
  is owed again if the arc leaves. `reverse.plan.update { region, set }` changes
  one region. A region with `inferred: true` and a box reports the missing
  material inside it by name and amount under the review's `inferred`, unranked
  and not blocking the verdict.
- **The map on a picture in this workspace** (2026-10-30). `show: { map: true }`
  waits for the map where it used to answer "still being read" every time, and
  the worker keeps the last map while the bodies stand.

- **The fan's blade recipe, tall, round, then cut** (2026-10-30). The third
  run on the fan wheel, RMS 0.117 against 0.154 and 0.172, got there by
  breaking the guide's own recipe. The scan-to-cad guide now has a blade or
  rib that fades into a surface built tall, its roots rounded, then cut along
  the measured crest, its top rounds after that. The rule against cutting
  becomes one against moving a surface off the scan.
- **A failed feature replaced** (2026-10-30). `reverse.plan.replace` names
  the built feature that made a removed one needless, with the reason; the
  verdict lists it and no longer holds it against the run. A round takes a
  round or a chamfer, and it is owed again should the replacement go.
- **Failures told once** (2026-10-30). A failed round's list of places groups
  chains by what lies either side; a failure is in full in one answer, then
  by its first sentence; the verdict repeats first sentences, each name once,
  and nothing of a name built again. They were 13 k of each 20 k comparison.
- **What an answer warns of** (2026-10-30). A taper through the sketch plane
  (`draftBothWays`), two lines end to end in a sketch (`collinearPieces`), a
  piece an edit moved past T (`movedFar`, a piece trimmed along itself not
  counted). `nearSketches` says each pair at an offset once. A face of no
  area is placed by its edges, not at the origin; `reverse.body.describe` with
  a query only edges answer lists the edges; the STEP check's volume line
  says its share and limit. A failure's `middle` on a straight edge is its
  middle, not its end, and an open end's `nearest` is another open end, not
  a corner already joined.
- **The verdict takes more than the score** (2026-10-29). The plan's
  verdict read "met" on the fan wheel at 88.9 % within T with its blade
  roots removed after failing and all fourteen blades 0.5 mm off: the share
  within T is blind to thin features. It now needs, besides the share and
  the regions, nothing removed after failing with no feature of its name
  built since, and no feature-kind patch over T on the scan that no skipped
  region covers — the review holds its places' patches against it, the
  final comparison reads the scan's map. `next` names the worst three, with
  depth, place, maker and region, and the way out: model it, or put the
  place in the plan as a region skipped with its reason (a warp, lettering).
- **The building guide before the first feature** (2026-10-29). The first
  feature added with the model guide's §2 Building unread answers a warning
  naming the read, once a session, beside the plan gate. That section and
  the scan-to-cad guide's §3 Measuring are read when their moment comes,
  not in the first call (the app's `guide.read` lists them under `later`).
- **Guides, after the fan wheel's second run** (2026-10-29). The run ends
  when the verdict says met, not at the share; the rotationally patterned
  part's blade is compared on its own before the pattern, the dish's rim
  and hub rounds stay out of the profile so the root chain ends on sharp
  corners, a chain that meets a round loses those edges, and the blade is
  never shortened, cut or moved to make a round build. The tool
  descriptions are shorter: what each does, needs and answers, the how-to
  in model-reference's command shapes.
- **Shorter pick warnings** (2026-10-29). A feature whose picks were found
  again by where they lie said so once per pick — a pattern's fifteen
  circles filled the panel. One line now names the count, and the
  warnings for a `where` query that finds nothing, a loose match and a
  profile remade or lost by a sketch edit are a sentence each.
- **Threads in holes that come out of a curved wall** (2026-10-29). A
  thread in a bore a little wider than its minor diameter — M6 in the
  Ø5 tap drill — fills the bore in to the crests along the thread. Where the
  hole meets a curved or slanted surface, that fill ran out to the hole's
  furthest end all the way round, and thin rings and helical ribbons stood
  in the air past the mouth and into the bore beyond. The thread is now kept
  to the body with the hole closed up, so it ends on the wall's own
  surfaces. A boss under its thread with a slanted end is left as drawn,
  its crests on it, and said so; one too thin for any of the thread to cut
  is refused.
- **The design loop** (2026-10-29). `reverse.body.review` reads the
  volume error and the comparison with the scan together and merges them
  into places on the part, ranked by how much material is wrong there —
  missing, excess or off, with mm³, depth, area, the nearest face's maker
  and the plan's region. It answers a picture of the deviation map at ±T
  from the two to four views that see the places best, each place's number
  pinned on it (taken down after), how this review stands to the last and
  the first, the plan's target, and the place to work on next with a first
  step. An agent runs it after every feature group and works from it: the
  map leads the design instead of being written into the report at the
  end. 2.5 kB of text on a 1 M-vertex scan.
- **The plan for a part** (2026-10-29). `reverse.plan.set` holds the
  archetype, the region inventory and the target — by default 90 % of the
  scan within T on analytic parts, 85 % on castings and mouldings, 75 % on
  freeform shells — and `reverse.plan.tick` ticks a region off or skips it
  with a reason. It is saved with the project. The first feature added
  without a plan answers a warning, once. The comparison in Deviation
  answers the verdict against it — target met or not, regions open and
  skipped, features removed after failing, the reviews run — and, short of
  it, says "not done". Removing a feature whose last build failed is
  recorded and answered so it is said in the chat.
- **Leaner loop answers** (2026-10-29). `reverse.body.compare { detail:
  "score" }` keeps the figures, the five largest patches, the far reading
  as counts and the three worst features: 3.1 kB where the full answer is
  14.1 kB. `reverse.body.check` answers briefly by default — three lines a
  kind and the counts; `audit: "full"` is the old list — and with a
  tolerance leaves out near-parallel faces that move less than T/2 across
  their span.
- **Threads read on short holes** (2026-10-29). The thread read takes the
  pitch most windows a few turns long agree on, leaves out chamfer, rim and
  floor points, and no longer mistakes the profile's own shoulder for the
  pitch. Along a face it reads the face's coaxial run, and minor and major
  are read where the thread is. The radius profile comes only with
  `profile: true`. A set-screw hole 3 mm deep that read nothing reads M6×1.
- **Rounds read along the edge** (2026-10-29). The fillet read gives each
  station's place along the edge and a linear radius from end to end with
  its residual. A round edge given `radius: "fit"` takes that line as a
  variable radius where the radius runs along the edge, one radius where it
  is even, and refuses where it follows neither.
- **Where a sketch on a measured plane is** (2026-10-29). Such a sketch
  counts from the world origin's foot; its answer, the plane's description
  and the section outline now give the element's centre and box in the
  sketch's [u, v], and pieces drawn away from it warn `farFromElement`.
- **Round refusals name helper bodies** (2026-10-29). A failing round names
  each edge by where it is and the features either side, small faces beside
  it by their maker, and a face a cut's helper body left on the part as
  that helper's bounding face, with the cut that left it.
- **Surfaces kept to their region** (2026-10-29). Fit Surface says how far
  its margin stands off the scan past the region (`pastRegion`). A split by
  a fitted surface says how much of its cut lies off the scan outside the
  region (`offScan`), and Split `within` lets a fitted sheet cut only inside
  its region's outline — a band across a wall the part keeps. A sheet built
  on a helper kernel keeps its fit, and a sheet carried on to the body tries
  denser grids before it is called wild.
- **Extrude to a curved face or a body** (2026-10-29). To a face takes
  cylinders, cones and fitted surfaces and ends on the face itself; To a
  body ends on a solid's skin or a sheet. A face that does not cover the
  profile is refused, saying where. A wall bounded by a curved face is a
  sketch and one cut, with no helper block whose faces stay as seams.
- **An open fitted chain says where it is open** (2026-10-29):
  `open: { ends, gap, tryCloseGaps }`.

- **Millimetres or inches** (2026-10-29, issue #16). With **Settings →
  Units** on inches the workspace shows and takes lengths in inches: the
  feature boxes and their fields, the parameter table, the feature rows and
  readings, the selection chips and Clearance, sketch dimensions on the
  sheet and their fields, the Move face plan, the live map's legend, notes
  and the status lines. A plain number typed in inches is held in
  millimetres; in the parameter table it is kept as `n in`, and bare
  arithmetic as `(…) * 1 in`. An expression that names a parameter is read
  as it always was — its bare numbers in millimetres, so write `0.5 in`.
  New extrudes, hole depths and pattern spacings start at 0.5 in in inches.
  Still in millimetres in inches: the build's own errors and warnings and
  the step sentences after a history edit, which are also the agent's
  answers. Every `reverse.*` answer stays in millimetres.

- **Shadow sections as bodies and sketches** (2026-10-28). Extract takes
  a shadow section beside the measured elements: its outline, holes and
  all, stood up through the part's thickness as the block 3D Measure draws
  — the lines and arcs the shadow was read to, a side face each — and
  built again when the shadow is taken again. A sketch on a shadow section
  starts with the same pieces, ends held together and rounded corners
  tangent, rather than the drawn outline fitted again. Through the
  commands: `reverse.feature.add { kind: "extract", section }`; a sketch on
  one starts with its outline, and `project: false` leaves it out.

- **Bodies as 3MF** (2026-10-28). `reverse.export.stl` takes
  `format: "3mf"`: the bodies in one 3MF in millimetres, each an object of
  its own under its name.

## 0.8.1 — 2026-10-27

- **Patch network: another workspace closes the box** (2026-10-25). The
  box stayed open behind another workspace, and its curves, corners and
  grips could still be clicked and dragged there — its layer is drawn in
  the viewport every workspace shares. Leaving the workspace now closes
  it, as Cancel does.

## 0.8.0 — 2026-10-26

From an agent's run on a scooter lamp housing (2026-10-25), plan §22 —
sheets trimmed before they are thickened:

- **Split and Combine take a sheet** (2026-10-25, V1). A sheet took a
  pattern alone, so a thin shell's skin was thickened oversize and the
  slab cut by the outline afterwards: its ends ran along the cut, and the
  lamp's lip tip took three boxes to trim. Now a Combine on a sheet keeps
  it inside a solid tool (intersect) or outside (cut), or sews two sheets
  into one (join); the solid tool stays a body. A Split on a sheet cuts it by sheets or solids and
  keeps what lies on the scan, the largest or the smallest piece by area.
  The result is sewn into one sheet that Thicken takes, and its faces stay
  the surface's. Trimmed first, the wall's ends stand square to it: on a
  1.8 mm wall cut at 31°, its edges round to 1.73 and 1.88 mm against 1.27
  for the slab cut. Two sheets split by each other and joined thicken to
  one wall with no notch.
- **The split that never came back** (2026-10-25, V2). A `between` split
  whose two fitted skins stopped short of the body carried them on over
  the body's box corners. The kernel's surface through that grid swung out
  to 4 × 10¹¹ mm², and the split on it never returned: the run waited an
  hour and reloaded the tab. Skins are now carried on over the body
  itself, held to the area their grid should have, and refused when they
  swing wild. A `between` split refuses skins that meet inside the body,
  in about a second, saying where ("Flange face and Flange back meet at
  (46.90, −18.33, −32.31), inside Flange prism …"). Fragments are told
  apart by which side of each skin they lie on, so skins that cross are
  never kept whole.
- **Stop a build** (2026-10-25, V3). A build that never finished held the
  session for good: every change answered "busy" until the tab was
  reloaded. `reverse.build.stop` lets the CAD kernel and its helpers go,
  starts them again, hands over the scan, suppresses the feature whose step
  was running and builds the part without it. A wait does the same when
  one step has run 300 s ("Flange plate (step 12, Splitting) did not
  finish in 300 s: …"), and a project or a scan opened with `discard`
  stops a build first. A stop at the limit with no step running leaves the
  part unbuilt, saying where it hung, rather than building it into the
  same hang. While a build runs, the busy text names the step,
  its place, the kernel call and how long it has run. Steps that crashed
  the kernel are remembered across a restart.
- **Picks that survive an edit** (2026-10-25, V4). A `where` pick was
  turned into fingerprints when it was set, so a round, a chamfer and an
  extrude's region were lost at every outline edit. Rounds, chamfers,
  shells, drafts and moved or deleted faces given by `where` now keep the
  query and run it again at every build: an outline redrawn with more
  sides keeps its rounds, its fingerprints the fallback. Regions picked as
  `all`, `largest` (new) or by a point are taken again after every edit;
  keys whose pieces were all remade are found by place, warned. A pick
  that finds nothing lists the regions there are, not "no longer closed".
  A pick matched loosely warns; an edit whose body is gone because an
  earlier one in the call failed names that one.
- **A split keeps its faces' makers** (2026-10-25, V5). A split gave every
  face its sheet crossed to the split, so `madeBy` on the body it cut
  found nothing. The fragments' faces are traced to the faces they lie on;
  only the faces on the tools are the split's. A `madeBy` pick that finds
  nothing names the makers there are and the feature that took the faces
  over.
- **Move a feature; move a sketch** (2026-10-25, V6).
  `reverse.feature.move { features, after }` reorders the tree in one
  undo step, keeping ids, names and picks, and refuses a move that puts a
  feature before one it is built on. A sketch takes another plane by
  `feature.update { set: { plane } }`, its pieces keeping [u, v] and what
  uses it keeping it. Removing a feature refuses while a sketch lies on
  its body or projects from it.
- **The strays named** (2026-10-25, V7). A surface fit that ran away said
  "the region's normals turn up to 89°, 95 % within 28°" with
  `withinDeg: 28` given, and nothing of the points that made it run away.
  A refused and a robust fit now answer `strays` — a second sheet along
  the height direction, or far points — each with a box ready for
  `region.exclude`; on the lamp they are the cup's inside and the gutter,
  and the fit with them left out builds. A region read by `normal` says
  its normals are within the angle by construction.
- **Answers that work the first time** (2026-10-25, V9).
  `reverse.feature.schema` names its large shared parts by `$ref` with
  their size and answers one by `def` (a sketch's `plane` 12.2 k → 4.8 k).
  Piece ids are no longer required, and a new piece given an id a relation
  holds is renumbered (`renumbered`). Element fields — `extract.element`,
  revolve, pattern and hole axes, trim tools — take a name. A body made
  earlier in a held batch can be named. A join by default is said, with
  the body and its volume before and after (`op: "join (default)"`,
  `joined`). The sketch's frame is on its brief row.
- **Section outlines in world** (2026-10-25, V10).
  `reverse.section.outline` takes `chain: { at: [x, y, z] }`, and its
  frame gives the normal.
- **Cuts that land elsewhere; overlapping profiles** (2026-10-25, V11). A
  cut that also nicks another part of the body warns on its row ("Holes
  also cut at (20.35, −46.76, −68.83): 0.15 mm², 10.4 mm along the R2.25
  bore's axis — meant? …"). Picked regions that share edges go to the
  kernel as one profile — one face, no fuse, no seams — on an extrude or
  revolve without draft; drafted, each region still tapers on its own, as
  before.
- **Edges on curved faces** (2026-10-25, V12). A chamfer is read against
  a curved face's tangent, its reach held so the face's sag stays under
  0.05 mm: a C1 rim on a bore through an R40 drum reads C1.04. `coaxial`
  takes a bore's rim edges on a curved face.
- **Round refusals** (2026-10-25, V13). One that fails even at its floor
  says it is the edge, not the size: how far apart its faces stand along
  it and where they are closest to flat. "builds at …; fails at …" names
  the nearest size that builds and asks for the corner's other edges only
  when some are not in the fillet. Kernel call names are left out.
- **Regular teeth read** (2026-10-25, V14).
  `reverse.section.fit { periodic: true }` reads a Fresnel's rings or a
  rack: crest and trough envelopes, pitch, riser and depth, and the
  profile as a polyline ready for a sketch (`plane`). On the lamp's
  Fresnel it sits on the scan at rms 0.047, against 0.185 for the profile
  the run computed by hand.
- **The guides** (2026-10-25, V15). The thin shell's route is one skin
  fitted oversize, trimmed, then thickened; a skin that turns is two
  sheets trimmed to each other and joined, never two slabs; a network is
  laid past the part's edge and trimmed back. `where` and region picks as
  they are kept now, places in world coordinates, a split's `scan` before
  `largest`, teeth, the stop, and the model guide read on its own.

- **Patch network: four spans to start, a Tolerance, and T-junctions held
  tangent** (2026-10-25). Auto gave the Joy-Con's 5 mm patches 13–19
  spans a side — a span every few of the scan's scatters — and on so clean
  a scan the nets followed its noise. Now Auto starts every strip at 4
  spans and gives a strip more only where a patch on it misses the scan by
  more than the new **Tolerance** (0.01 mm) beyond the scan's noise — each
  patch's misfit, its residuals' RMS with their scatter read off small
  cells of it taken out — and only while that helps: a step of half as
  many again, a leap of twice that where the step did not, kept only where
  it brought a patch over the tolerance a fifth nearer. The Joy-Con stays
  at 4 × 4: a third of the ripple (0.017° against 0.051°), a sixth of the
  poles, 0.0055 mm RMS against 0.0040. Its seams now meet within 1.9° and
  its corners within 2.1°, against 0.8° and 1.2°: with four spans a side
  the tangency left to the poles beside a corner reaches a quarter of the
  way along each curve. A 270° strip of a cylinder grows round the bend
  alone, to 4 × 6 (was 10 × 20), 0.04 mm off the true cylinder; the
  scooter cover's patches beside its crest to 9 × 4, the rest 4 × 4. Each
  patch's misfit is in its row's tip and in reverse.network.read. A curve
  that is one patch's whole side and a piece of another's — a split cell's
  middle on its neighbour's side — is now held tangent by weight, pole by
  pole, as a body's face holds a patch: on a noisy sphere at 16 spans
  0.7° where it was 2.1°. The ghost meshes a patch at 48 samples a side
  at the fewest, so a coarse net does not look faceted.

- **Patch network: Smoothness smooths the curves too** (2026-10-25). On
  the Joy-Con the patches showed the scan's noise at any smoothness — 0,
  0.01 and 0.1 alike. Each patch is held to its curves, and the curves
  were fitted to their traces with only a whisper of fairing, so their
  noise ran across the patches in stripes along the net's rows that no
  smoothness touched: from 0.001 to 10 the patches' ripple stayed at
  0.16°. Now the smoothness fairs each curve as hard as the patches beside
  it, by their third derivative as it does theirs: at 0.001 the ripple is
  0.044°, a quarter, the patches as close to the scan (0.004 mm RMS); at
  0.1 it is 0.012°, 0.006 mm off. A sphere's and a cylinder's patches
  come out closer to the true shape than before up to 0.1 (0.021 mm
  against 0.040 at the most on the sphere). A T-junction's long side is
  fitted to its two curves as fitted, not to their traces, and lies on
  them within a micron (was up to 25 µm) — the Joy-Con's worst edge 3.6°,
  was 6.0°.

- **Patch network: no folds at the corners of a network drawn askew, and
  a saved network opens again** (2026-10-25). On a Joy-Con scan the seams
  were not tangent, the surface looked rough and its edges looped at some
  corners: ten patches of seventeen folded over themselves next to an
  inner corner, a point 2.7 mm off the scan where the rest sat within
  0.03 mm. The ties holding the patches tangent at the poles next to a
  corner close a loop round it, and on cells drawn askew they fight each
  other; held by a heavy weight, they won against the points and folded
  the patches. Now each corner's ties are tried and let go where a patch
  beside it turns more than 30° from the first fit, which no tie bends;
  such a corner is reported with its angle as a corner of three, five or
  six patches is. The Joy-Con's patches now sit 0.002–0.0065 mm RMS off
  the scan, the worst point 0.027 mm, the shared curves within 0.7° and
  the corners let go within 2.6°; a network drawn square — the scooter
  cover's — keeps every tie, tangent to thousandths of a degree. And a
  project with a network of patches in it could not be opened again
  ("Malformed project: network.cells IDs"): the cells, which have no id
  of their own, were checked for one like the nodes and the curves.

- **Patch network: quicker, and patches changed after they are made**
  (2026-10-25). On second use the network was too slow and a patch, once
  made, could not be found to change. Every edit read and fitted the whole
  network again, and its ghost made and sewed the kernel's faces — 1.1 s
  for six patches on the scooter cover, six for thirty — while under the
  cursor each move traced two sides across hundreds of thousands of
  triangles and compiled the dashed side's shader again. Now the ghost is
  the patches meshed as fitted (Create makes the faces), each edge's trace
  and each patch's map are kept from one edit to the next, the regions Fill
  all offers are looked for only round the network, and the fit's inner
  loops allocate nothing, its numbers the same to the bit: a patch closed on
  the scooter cover is fitted on screen a quarter of a second after the
  click, and an edit of thirty patches reads in 0.8 s instead of 4.2. The
  preview keeps its materials, a drag goes to the store once a frame, a
  patch just closed stays shaded until its fit lands, and the box's rows and
  the corners no longer blink while the next preview builds. The ghost of
  every feature keeps its material between previews: it compiled its shader
  again at each answer where no body wore one like it. A click of the
  middle button closes the patch being placed — the workspace's confirm,
  which closes the patch before it makes the network. A patch made is
  changed where it lies: a drag on an edge two patches share bends it, a
  point put in where it was pressed; a click on a patch picks it, its
  strips' spans in the box, and Delete or **Delete patch** takes it out with
  the edges no other patch has.

- **Patch network: placed patch by patch** (2026-10-25). Drawing a
  network curve by curve and then filling its regions was found hard to
  use on the first try: a loop drawn as one curve could not be closed on
  its own start (the start was no node until the curve ended), a point
  clicked in the middle of a curve could not be clicked again, and a loop
  with its corners as such points was one side, not four. The box now
  works as QuickSurface's freeform does: each click is a corner — on the
  scan, or on a corner, an edge or a point already there — the sides
  follow the scan and the patch shows shaded as it grows, and a click on
  the first corner, Enter or a double click closes it and fits it at
  once. An outer edge dragged across the scan makes the next patch beside
  it, its new corners landing on corners near them; Backspace takes the
  last corner back. The corners clicked are the patch's corners however
  little the boundary turns there (`cells[].corners`), and its seed is put
  in its middle — the point farthest from its sides, on the outer skin of
  a shell, not the inner wall nearer the loop's plane — and kept there
  when its corners move. A reopened network opens in Draw. The agent's
  commands are unchanged.

The patch network (2026-10-24 and 25):

- **Patch network** (2026-10-24, PN2–PN5, PN7–PN10). A freeform part — a
  moulded cover, a housing, a handle — is surfaced the way curve-network
  surfacing does it: curves drawn on the scan close round regions, each
  region filled is fitted with a B-spline patch, and neighbouring patches
  share the curve between them exactly and meet tangent across it, unless
  the curve is a crease. The patches together are one body: a sheet, or a
  solid where the network closes. Fit Surface fits one height field, so it
  cannot take a skin that wraps round past half a cylinder, nor several
  faces that meet tangent; a network does both. In the box, **Draw**: a
  click on the scan starts a curve and puts points on it, the curve
  following the scan between them; a click on a node, Enter or a double
  click ends it, and a curve ended on another splits that one with a node.
  Nodes and points are dragged along the scan; Shift-click puts a point
  in, Delete takes out what is under the cursor, C makes a curve a crease,
  and the wheel over a curve sets the span count of its strip — the row of
  patches it runs across, which share their nets' spans that way. **Fill**:
  a click in a closed region fills it, on a patch picks it, Ctrl-click
  empties it; **Fill all** fills every closed region, and one that cannot
  be filled says why where it lies (open, two sides, seven, a curve that
  crosses another with no node, the scan's rim through it). The patches
  are fitted together in one solve: the poles along a shared curve are the
  curve's, tangency across it is held exactly, Auto sizes each strip's net
  from its length and the scan's scatter (2 to 20 spans), Smoothness (0.001
  to start: it fairs the departure from the Coons surface of the patch's
  sides) and Leave out stray points as Fit Surface has them. The box reads the status
  — patches, open cells, the worst angle across a tangent curve and the
  worst gap between the kernel's faces — and a row per patch with its σ,
  worst point and net; the live map colours the scan against the patches
  while the box is open, with the curvature colouring on the scan meanwhile.
  The sheet is a surface body as a fitted surface's is, and goes into a
  STEP export as a skin; Thicken makes it a solid Out or In (both ways, the
  kernel's thickening of a sheet of several patches never came back, so it
  is refused). On the scooter cover of agent round 12, a 2 × 3 network drawn by
  clicks over its hump, its crest two creases: every tangent curve within
  0.003°, the faces 0.8 µm apart at worst, patches 0.006–0.014 mm RMS,
  the crest folded 8.6° and 13.3°, built in 1.4 s and read back from STEP
  as the sheet.
- **Cells of three, five and six sides** (2026-10-25, PN6). Such a region
  is split from a centre — a square in the view, dragged along the scan,
  Delete puts it back in the middle — by spokes to its sides' middles into
  four-sided patches, the spokes tangent across like any curve (0.004°) and
  the centre a corner of three, five or six patches held near tangent (a
  pentagon's 0.7°, read in the status line as the worst corner). A side
  shared with a four-sided neighbour is split there too, a T-junction whose
  gap (microns) and angle (about a degree) the readout gives.
- **Networks against bodies** (2026-10-25, PN11). In Draw, a built body's
  edge is a pick: the curve along it runs on the edge, its nodes on its
  ends, and the patch beside it meets the body on the edge (Contact) or is
  held tangent to one of the edge's two faces as well — a row in the box
  with the angle it comes out at. A patch held tangent to a cylinder body
  comes out within 0.001°; the network rebuilds after the body changes.
- **Suggest creases** (2026-10-25, PN12). The scan's sharp edges and folds
  — not its rounds — found and drawn dashed: a click takes one as a crease
  curve, Accept all takes them all, two that meet sharing a node. The
  normals are filtered so a scan's noise reads under a degree while a 90°
  edge keeps its 90°, a fold crossing the triangles slantwise is found by
  the angle across it a few edges out, and a round (a little turn on every
  edge, not a lot on one) is left out. A filleted box gives its rims and
  nothing on its rounds; a 30° fold on a noisy sheet is one curve.
- **Agents** (2026-10-25, PN13). `reverse.network.create` makes a network
  from curves given as points on the scan, joined where they land on each
  other, and fills it; `reverse.network.edit` adds, moves and takes out
  curves and points, makes creases, sets spans and sides, fills and
  empties, in one undo step; `reverse.network.read` gives the cells, the
  patches and the curves as the box reads them; and
  `reverse.network.suggest_creases` the creases as curves ready to add.
  The scan-to-cad guide's freeform route is now network first, Fit Surface
  for one gentle patch; the model reference has the fields.
- Thirty patches over a 300 × 200 mm panel scanned as half a million
  triangles are fitted and made a body in 8 s (PN14, `reNetworkBench`).
  `e2e-patch-network.mjs` draws, fills, checks and exports the scooter
  cover's network in the browser.

From an agent's run on the GoPro quick-release buckle (2026-10-24), plan
§21 — stacked sketches that line up:

- **Levels in one sketch** (2026-10-24, U1). A sketch's `fit` read only
  the cut at the sketch's own plane, so a part of several heights took a
  sketch a level, or pieces copied by hand from other cuts (which slid
  0.2–0.43 mm under later solves). `fit.level` cuts the scan that far
  along the sketch's normal and lays its outline on the same sheet, so
  every height's section goes into one sketch
  (`reverse.sketch.edit { add: { fit: { level } } }`); `fitted` names each
  chain's level. The panel's Fit all chains has a Level field.
- **Walls drawn once** (2026-10-24, U2). A fit never looked at what the
  sketch already held, so a wall through three levels was fitted three
  times, 0.0002–0.07 mm apart. Slice points within `fit.share` (0.1 mm by
  default; the guide says to give T) of a piece the sketch holds, running
  its way, now go to that piece: that wall is not fitted again, a fitted
  piece takes the new level's points and is refitted on both, and only the
  rest is fitted, its ends held on the pieces they reach. The answer gives
  `shared` (each piece's points and the run-out between levels),
  `junctions` and `corners` (a scan's round at a sharp sketch corner,
  dropped); a landing the sketch cannot solve with is let go and said so
  (`held: "free"`).
- **T-junctions that stay on their piece; merges said** (2026-10-24, U3).
  `pointOn` held an end on the infinite line through a piece, so a
  shortened carrier let the end slide past it, the junction came apart and
  two regions merged without a word. `pointOn.bounded` keeps the end
  within the piece (a fit's junctions are held so; old `pointOn`s solve as
  before). Sketch answers give `offPiece`; an edit whose picked region
  grew, or now takes in another extrude's, says so in `warnings`, and a
  row says when two features pick the same region.
- **Stacked on a face** (2026-10-24, U4). A sketch on a body's face made
  by a command now starts with the face's outline projected, as the
  panel's does (`project: false` leaves it out; `projected` lists it), and
  projections go in before the fit, so a pad's fit lands on the outline
  and only its own walls are new. The fit on a face still cuts 0.25 mm
  into the body unless `level` moves it.
- **Steps said at the join** (2026-10-24, U5). The steps showed only in a
  body check or in the person's notes. After every join — an extrude,
  revolve, loft, sweep or extract `join`, a Combine — the new feature's
  faces are compared with the other features' on the body: two walls or
  heights 0.0001–0.3 mm apart, a round drawn twice, a round whose foot or
  side lies just off another feature's face. Each goes on the row's
  `warning` with both pieces traced ("Wing's wall (x 10.98, line 2 of Plan
  wing) stands 0.07 mm off Upper's (x 10.91, line 2 of Plan upper): one
  wall drawn twice — fit … (fit.level), or project line 2 …"), and in the
  answer as `stepsBetween` (5, then `stepsBetweenFound`). A warning, not a
  refusal.
- **The audit's steps by feature** (2026-10-24, U6, and §20 T9). The step
  list kept the 12 thinnest, so hairlines pushed the 0.04–0.07 mm wall
  steps off it, and it looked at planes only. Steps are now one line a
  pair of features and form, with a count and the widest; those between
  features come first, and hairlines under 0.001 mm get a line of their
  own. Rounds drawn twice and rounds just off a face join the list, and
  flat steps count only where the faces meet. `reverse.body.check`
  answers `stepsBetweenFeatures` beside `valid` and `closed`, and with
  `tolerance` asks about each step under max(0.1, T/2) ("meant?").
- **Near misses between sketches** (2026-10-24, U7). A sketch's add and
  edit answer `nearSketches`: pieces 0.0001–0.3 mm off another sketch's on
  a parallel plane (lines within 0.5° overlapping by 30 %, arcs and circles
  by centre and radius), with the fix in one line (`nearSketchesFix`:
  project the other's piece, or fit this level into that sketch). It
  catches a second plan sketch as it is made.

From an agent's run on the Switch 2 Joy-Con's housing (2026-10-24), plan
§20:

- **Cuts that take a whole body; splits said** (2026-10-24, T1). A body
  cut into two equal pieces gave its id to whichever the kernel listed
  first, and a cut by a plane on the side where nothing of that piece lay
  replayed the boolean four ways and answered "left no closed solid". The
  id now stays with the piece nearest where the body stood when the pieces
  are the same size within 1 % (on cuts and Combines; pattern and mirror
  copies keep the kernel's order). A cut or Combine that leaves pieces says
  which kept the id and which are new, with boxes and volumes. A cut
  that takes all of a body says so, which side it lay on, and the pieces
  split off it that it could have meant ("cut 82, or keep -1").
- **Revolves to a pole that STEP keeps** (2026-10-24, T2). A dome's
  three-point arc ending on the axis with its centre a hair off it makes a
  surface of revolution, not a sphere. Turned from base to pole, it read
  back as no closed solid, and the plain check passed it. Before
  the face is made, ends within 0.1 µm of the axis are put on it, an arc
  ending there with its centre within 1 µm (or r/1000) is re-pointed to a
  sphere, other arcs and splines are turned to start at the pole, and an
  axis line a closing hair short of the axis is laid on it; the step's
  warning says what moved. `reverse.body.check`'s plain read-back flags a
  part that reads back as no closed or valid solid with no edge open, and
  the STEP round trip names the face farthest off what was read back.
- **Sketch pieces without ids** (2026-10-24, T3). `reverse.sketch.edit`
  takes added pieces without an `id` and answers the `ids` given; an id
  clash says when it was a relation in the same call that took the id.
- **Expressions on every number** (2026-10-24, T4). `cutPlane`, `mirror`,
  `loft` and `surface` took no `exprs`, so a cut at a shoulder stayed a
  number. Four now take them: a cut's and a mirror's `plane.offset`; a
  loft's station offsets (`sections.<k>.offset`) and inner wall (`inner`),
  written onto its stations, with the inner twins taken again when the
  wall changes; and a surface's region box (`region.box.min.x` …), the
  region read again on the scan when it moves. A kind with no numbers
  says so.
- **Schemas in parts** (2026-10-24, T6). `reverse.feature.schema` takes
  `field`, a dotted path (`sketch.constraints`, `plane`, `extent.toPlane`);
  a schema past 20 k characters (a sketch's, a loft's) answers its fields
  with their sizes instead of spilling to a file.
- **Accept by the fit's own sigma** (2026-10-24, T7). Accept's move limit
  was 3 × the chain's point-to-point scatter: 0.002 on a good scan, so the
  0.01 floor, while the pieces' rms was 0.016–0.018. Tangents within
  2 sigmas were refused for moving. The limit is now 3 sigmas of the pieces
  a relation touches (their residual, never under the scatter;
  `moves.limitMm`), a move is read off the piece's curve (a join sliding
  along the pieces is none), and when a whole kind is left `moved` a
  `note` says how far and the `maxMoveMm` that takes them.
- **Rounds read on short faces** (2026-10-24, T8). On keys standing
  1.7 mm above a housing the corner window ran down the key's side onto
  the housing and the read answered "no round within 3 mm". The window now
  ends where the scan runs onto another face, and the reach is held to 0.9
  of a face that ends within it. Retries go down to 0.25 × the reach; a
  null says why ("another face 1.7 mm off within the reach — reach ≤
  1.5"); a chamfer beats a round only on nearly as many points. The
  Joy-Con's D-pad keys read R1.12–1.27.
- **Refusals with their numbers** (2026-10-24, T9).
  `reverse.body.fillet_read` answers `places`, one verdict a place ("R0.8",
  "sharp", "step 0.8 mm on face 2", "no scan"). A station refused on an
  open run names its end gap, the `closeGaps` given, the gaps bridged and
  those still open, or that `within`/`skin`/`facing` split a closed chain.
  `fit.normal` sets a surface's height direction; a fit that runs away
  names the direction and how far the region's normals turn from it, and
  past 70° says to split the region or loft through stations.
- **The volume compare kept in view** (2026-10-24, T10).
  `reverse.body.compare` and `compare_in_deviation` answer `volume`: the
  last volume compare's totals and its two largest regions, or "volume not
  compared since step N (excess … / missing … then)".
- **The guides** (2026-10-24, T11, U8). Every open note taken in one pass;
  recesses read with a cut along them; the volume compare run during a
  round, with large deviations iterated on before the round ends; a dome's
  centre on the axis; a cut's pieces read before cutting again; a shell
  over a shoulder lofted through stations. Model §2c is rewritten as the
  two routes for stacked parts: levels fitted into one sketch, or a sketch
  on the face with its outline projected.

From an agent's run on the Rumble Pak modelled as one solid (2026-10-24),
plan §19:

- **Drafted extrudes over near-tangent joins** (2026-10-24, S1). A plan of
  lines and arcs placed by hand, its corners a few hundredths of a degree
  off tangent, would not extrude with draft past 20–30 mm ("not a closed
  solid", naming nothing): OCCT's draft meets the faces either side of
  such a join at a grazing angle and fails. Joins under 0.5° off tangent
  are now made tangent before the draft — an arc refitted at its radius
  tangent to both neighbours, two lines nearly in line made one — moving
  nothing over 0.05 mm, and the step's `warning` says what moved. A join
  it cannot mend is refused naming both pieces. The `draft` feature names
  such creases on its faces before it bisects the angle, instead of
  blaming a round or the body's width.
- **Lofts that fold are refused at the loft** (2026-10-24, S2). Two
  sections 3 mm apart that disagree made the smooth loft overshoot and
  cross itself; the kernel took it as valid, and the intersect after it
  came back empty as "The bodies do not overlap." A smooth loft is now cut
  across 40 times (about 7 ms) and refused where a cut crosses itself,
  naming the two sections; `reverse.body.check` answers `folds` on loft
  faces. An intersect says "do not overlap" only when the boxes are apart,
  and otherwise what it tried and the fold check on each body.
- **Round diagnoses both ways, in time** (2026-10-24, S3). The diagnosis
  of a failed round halved the radius as if a smaller one always built: it
  answered "up to 0.81 mm" while 1.4 built, and on the pak's nose it went
  on to 0.0375 mm and never answered. It now stops at max(0.1 mm, radius/8),
  tries sizes above the radius too and answers both sets ("builds at 1.4,
  1.43; fails at 1.3, 1.37 — not a size limit: the corner where the rounds
  meet"), and keeps to a deadline. After a kernel crash it no longer runs
  on the broken kernel, and the crash answer says which of its edges were
  not picked but run on tangent.
- **Free edges the STEP read-back makes, found and mended** (2026-10-24,
  S4). A round's B-spline edge can end a few µm off its corner; valid and
  closed in memory, the body read back from STEP with a one-face edge
  there — the pak's nose corner, found only by `roundTrip`. The plain
  `reverse.body.check` now writes the body as STEP and reads it back
  (`readBack`, a few tenths of a second, bodies up to 3000 faces) and
  answers `short` for edges under 1e-4 mm between two faces. The export
  mends such a corner — the curve's end moved onto its vertex — when a
  part reads back open by free edges under 0.01 mm, and keeps the mend
  only if the part then reads back closed and valid (`mended` says what
  moved).

- **compare_in_deviation takes the reading** (2026-10-24). `tolerance`,
  `range` and `maxDistance` set the Deviation workspace's reading before
  the comparison, as `deviation.settings` does, and stay so; `reading`
  answers the one it used (`maxDistanceAuto`: the automatic search
  distance). The run compared at the workspace's 0.1 while it worked at
  0.2, and spent a call on `deviation_settings`.
- **The fillet read's sharp edges in one row** (2026-10-24). An edge where
  no place reads a round was a row of its own, each with the long "no
  round within … (reach)" why; five broad queries came back mostly as
  those. They are gathered into `sharp: { edges, why }`, the why once;
  rows stay for rounds, rounds read at some places only, and edges not
  read.

- **reverse.body.volume_compare** (2026-10-23). The bodies against the scan
  as solids: the Deviation workspace's volume error run on the bodies, in
  the scan's frame, each region with the body face nearest its deepest
  point and the feature that made it. The scan-to-CAD guide runs it after
  each major step, before the patches — a lump of a few mm³ is a feature
  missing or extra.

From an agent's run on a wrapped water pump, its housing built three times
(2026-10-23), plan §18:

- **A pattern's name takes every copy** (2026-10-23). A boolean naming a
  pattern joined one copy and answered ok: the copies carry the pattern's
  ids, and the name went to the first. A feature that works on a body —
  pattern, mirror kept apart, cut, split — now names that body, so a
  boolean takes the original and every copy (`took` counts them), and
  anywhere else the refusal lists every piece.
- **Crashes that are crashes, and say why** (2026-10-23). A crash inside
  the kernel's fillet came wrapped as "null function or function signature
  mismatch", was taken for a refusal, and later steps ran on a kernel that
  may have been broken. Those words (and table index, divide by zero,
  integer overflow) now restart the kernel. After a restart the crashed
  round, shell or offset is diagnosed on the fresh kernel within 10 s — an
  offset by its faces one at a time, not offsetting the whole body again —
  and the crash's answer says what it found.
- **Stations checked where they are made** (2026-10-23). Stations fitted
  `like` a template came out folded or degenerate and lofted "ok". A
  station is now refused, naming the piece, for a piece under 0.05 mm, a
  line run back against the template, an arc bending the other way or
  under 5°, or a corner met more than twice the run's extent past it — also
  after the solve, which folded what the fit left whole. `like` fits get
  the `crossing` warning plain fits get; a piece shorter than touch is
  named, not "branches". An inset is refused where an arc's sweep jumps
  (97° → 200°) or the result closes several regions, naming the fold in
  the source. A loft or sweep whose section closes several regions is
  refused with their areas (it lofted the largest), and a loft is checked
  before the kernel for pieces under 0.05 mm and a section far larger than
  its neighbours. **Saved projects:** the water pump's outlet passage, with a
  0.0007 mm piece, built before and is now refused.
- **Failures that say what and where** (2026-10-23). A sketch a loft,
  sweep or extrude names further down the list or suppressed is said so,
  not "gone". A sweep's start refusal gives the path's start and way and a
  plane square to it. A join left open says it was tried exact, keeping
  splits and fuzzy at two values, and whether each body checks alone. A
  profile "no longer closed" names its open ends and gaps; sketch answers
  list `nearMiss` ends.
- **Freeform surfaces that stay by their points** (2026-10-23). A surface
  ran off hundreds of millimetres where its region had no points and took
  minutes to mesh. Cells far from every point are pulled weakly toward the
  region's plane, weighted so cells with points move under half the fit's
  scatter. A net that still leaves the points' heights by more than a
  quarter of its extent is refused, naming where the points run out. The
  kernel's surface is checked against the fit (it came back 2× the area,
  or 320 m tall, at three samples a span) and taken on a denser grid, and
  a surface meshing past 300 k triangles is refused before it meshes. The
  run's box now fits in 0.3 s.
- **Picks, chains and sketch updates** (2026-10-23). `{ where: {…} }`
  around a pick is taken as the query itself; the fingerprint branch is
  named in refusals. `fit.chains { at }` answers `pickedBy` (on, round,
  nearest), the area and how many closed chains lie round the point. A
  radial sketch turns in place with `set: { angleDeg }`, its features
  following; `update { sketch: { inset } }` takes an inset again from its
  source; `sketch.fit` in an update is refused, naming
  `reverse.sketch.edit`; a round on pieces with no slice points asks for a
  radius instead of guessing one.
- **Pictures that say why the bodies are off, and notes everywhere**
  (2026-10-23). A picture with no body shown answers `bodiesWhy` — the
  view bar's Bodies key, the eyes shut, or none built. Read-only commands
  answer the person's notes too.
- **Guides** (2026-10-23): how such parts are designed, before the plan;
  the volute archetype; patches by `kind`, a feature patch never dismissed
  as scatter; wrapped skins read from both ends; picks written as the query
  itself; refits by `reverse_sketch_edit`; the report rewritten from the
  last compare.

From an agent's run on the fridge bracket with the person's six notes, on
the guides (2026-10-23), plan §17:

- **STEP read-back that says where** (2026-10-23). A body that checked
  valid exported a STEP that did not read back whole, and finding the cause
  took ten test exports. Verify now lists `freeEdges` — where, and the faces
  and features beside them — and names the first in its problem line.
  `reverse.body.check { roundTrip: true }` writes and reads the body as STEP
  in memory, with no file (with `before`, a step's input); `roundTrip:
  "find"` names the first step whose body does not come back. The check
  counts free and non-manifold edges and warns of `contacts` — faces
  touching at a tangent (a boss's circle on a curved edge) or along a knife
  edge — with where and the feature, which the reader may drop.
- **Slivers on every join** (2026-10-23). Joins and combines of any faces
  run the sliver test (only freeform ones did) and replay fuzzy on one; a
  sliver that stays is named on the row. `body.check` lists `narrow` faces,
  under 0.01 mm wide, which `tiny` missed. Costs about 1 s over 14
  booleans on the knurled benchmark.
- **A feature's pieces join by its name** (2026-10-23). A boolean refused a
  `new` extrude that fell into several bodies ("name one"), though the
  build takes every piece; a feature's name as `body` or `tool` now takes
  them all. Elsewhere the refusal says so.
- **Ends snap everywhere** (2026-10-23). The 0.05 mm snap ran only in
  `sketch.edit`; it now runs in `feature.add` and `feature.update` too,
  joins new ends to each other and moves fixed pieces as well. A polyline
  whose last corner lies on its first closes there instead of adding a
  micro line.
- **Failures that name the feature and the way round** (2026-10-23). A
  shell's thin spot names the face and the feature that made it, with
  "shell before it, or cut an inner body". A round whose chain runs into a
  wall names that face and its feature, with "end it at a sharp corner,
  round it in the sketch, or round before it".
- **Section boxes in any frame** (2026-10-23). `section.fit { within }` that
  caught nothing answered an empty fit; it is refused with the cut's extent
  on the sheet, as `section.outline` is. Every `within` also takes
  `{ world: { min, max } }`, each schema names its frame, and the fit
  answers `bounds`. Plane fields take "XY", "YZ", "XZ"; the datum plane is
  the "XZ plane".
- **Batch names** (2026-10-23). `feature.add` and `feature.update` tell an
  agent's server where they name things, so a batch giving one name twice
  is refused before it runs.
- **Pictures of the workspace say which map** (2026-10-23): the bodies' live
  map, curvature, or why none.
- **`compare_in_deviation { ways: "scan" }`** (2026-10-23) skips the map on
  the bodies. At a tolerance of 0.25 mm or more the bodies are read through
  their view meshes; the bracket's two-way compare takes 1.5 s (2.1 s). The
  run's five minutes were not the comparison's own work — the job's
  progress will show where they go.
- **Guides:** broken parts read before modelling, slices under the
  smallest feature, hotspots at a pitch, one profile for a root, no point
  contacts, the STEP read back after structural changes, the shell and
  round failure rows, batch names, sections by their parts.

## 0.7.0 — 2026-10-23

- **The skill is served as guides** (2026-10-23). `guide.read` gives an
  agent the workspace's text for the build it drives, so it is never out of
  date. It is split by task. `model` covers building a part, with or
  without a scan, at about 6k tokens. `scan-to-cad` is what a scan adds,
  read after `model`. `model-reference` is read a section at a time. An
  agent that only measures, or only models, never loads the scan text.
  `skills/scan-reverse-engineering` is now a stub that points at the
  guides. The "written for build N" line and its test are gone: the guides
  are always the build's own.

From an agent's second run on the scooter handlebar cover (2026-10-23),
plan §16:

- **Rounds read wider** (2026-10-23). The fillet read searched only up to
  its reach, about 5 % of the part, and called a larger round a "sharp
  corner" — the cover's R19.6 shoulder. A round at the top of the search,
  or none, is now read again at twice and four times the reach; a reach
  given caps it, and an empty read says "no round within N mm". A fillet's
  or chamfer's `"fit"` takes `reach`.
- **A failed round blames itself** (2026-10-23). Fillets and chamfers are
  made on a copy of the body, so one the kernel gives up on cannot leave the
  body changed and the failure blamed on the step before.
  `reverse.body.check { before: feature }` checks a feature's input as the
  build kept it. A round's `picked` lists `adds`: the edges the kernel's
  tangent chain rounds too. The variable-round refusal says there is one
  radius law per tangent chain.
- **Shells that fail within their own time** (2026-10-23). A failing shell's
  diagnosis stops at twice the shell's own time (5 s at least): rounds no
  larger than the wall are named first, smallest first, before any shell is
  tried, and a halving cut short says "not bisected: over budget" with what
  it found. One edit on the cover had hung the build for five minutes. A
  shell built by booleans says which way built it and why the kernel's own
  shell gave up, and faces it made under 0.01 mm wide or 0.01 mm² are named.
- **Drafts read the face, at several angles** (2026-10-23). `angleDeg: "fit"`
  reads the scan inside each face's outline and fits again about the fitted
  plane, so a 9° wall against an upright face reads 9°, not about 5°; it
  answers `coverage` and warns when the scan spans under half the face.
  `groups: [{ faces, angleDeg }]` drafts more faces at their own angles in
  one feature, each fittable. A face the kernel already leaned along with a
  tangent neighbour is passed over and named; a failed draft names the
  tangent neighbours not picked.
- **Re-pointing a boolean further up** (2026-10-23). `reverse.feature.update`
  on a feature further up the list reads `body`, `tool`, `tools`, `sheet`,
  `target` and `bodies` as they stood when it was built, so a tool a later
  feature took in can be named — in one undo step. The same edit used to
  hang until the call timed out.
- **Pieces keep their ids** (2026-10-23). A Combine on a body in pieces gives
  each piece the id of the piece it came from, so an id from an earlier
  answer still finds it; ids an old project names still build the same.
- **`toNext` takes every region** (2026-10-23). Each region of the profile
  runs to its own next face and the pieces are joined: three circles are
  three bosses up to the inner skin. It kept the first region alone, without
  a word. A region nothing stops is refused by where it lies.
- **STEP volumes within reading** (2026-10-23). With the surfaces read back
  in place, a volume up to 0.1 % off — offset and B-spline faces are
  integrated numerically — is a `verify.notes` line, not a problem.
- **Hidden stays hidden** (2026-10-23). Bodies put out of view, a thickened
  sheet among them, stay out through a failed build, a feature edit and a
  rollback above them, and after a picture that showed them.
  `reverse.body.compare_in_deviation` names patches only by the bodies it
  compared, not a hidden sheet lying on the skin.
- **Sections and outlines** (2026-10-23). `section.render { plane: { sketch } }`
  cuts in a sketch's own frame. `reverse.section.outline { chain: { at } }`
  on an opening's rim gives the opening, not the wall around it, and takes
  `within` and `maxLength`.
- **Sketch edits** (2026-10-23). A shape added without an id starts after
  the relations' ids too, which share one run with the pieces. A new piece's
  end within 0.05 mm of where the sketch's ends meet is moved onto it
  (`snapped`). A name given in a number field that has an `exprs` slot is
  refused with `exprs: { … }` written out.
- **Guides** (2026-10-23). Covers and housings come with their interior,
  modelled without asking. Outlines the part shows are lines, arcs and
  splines, never polylines. Rounds larger than the wall go before the shell,
  smaller ones after. A round between primitives goes on their union before
  the trim. `boolean { keep: true }` clips several bodies with one form. A
  worked decomposition for a cover. Openings are sliced on every side;
  mirrored details are checked on both halves.

From an agent's run on a fan wheel, and two on freeform thin shells — a
scooter handlebar cover and a lamp housing (2026-10-22), plan §14 and §15:

- **A circular pattern's step is its span** (2026-10-22). `step` is the
  angle from the first copy to the last, as the sketch's pattern has it:
  90° in four puts copies at 0, 30, 60 and 90, and 360° still spreads them
  evenly round. It was the pitch times the count. A project saved before
  opens with its copies where they stood.
- **Thicken a sheet** (2026-10-22). A sheet or a fitted surface becomes a
  solid of a thickness: against its normal, along it, or half each way.
  It makes a new body, or joins a body named as `target`. A face that bends
  tighter than the thickness towards the side the solid grows is named,
  with the thickness it takes, before the kernel can fold it. The result
  says how thick the wall came out along the sheet's edge, and the sheet is
  put out of view.
- **Split between two skins** (2026-10-22). Split keeps `"between"`: the
  pieces with a face on every sheet, the wall between a fitted outer skin
  and a fitted inner one. Skins that stop short of the body are carried on
  to it.
- **Offsets and shells that say why they failed** (2026-10-22). A shell or
  a body offset that fails on a freeform face names the face — its index,
  its surface, the feature that made it — how far it offsets on its own,
  and where it curves tighter than the wall. With no thin spot found, the
  answer quotes the kernel instead of "thinner than two walls", and of the
  shell's three ways of hollowing, the failure gives the reason that says
  most. The largest size a failed round, draft, shell or offset takes is
  found to within 0.1 mm, not on a grid of 64ths.
- **Compare that knows which side** (2026-10-22). The comparison and the
  live map read each scan point by the way it faces: a point whose nearest
  surface faces away, the far skin of a thin wall, is read against the
  nearest surface within reach that faces it (`facingDeg`, 90° by default
  as in Deviation). `unfacing: "drop"` leaves out the points nothing faces,
  and `skin: "outer"` reads only the scan facing out of the model, so a
  shell not yet hollowed reads its outer skin at the hollow model's
  numbers. A sheet is read on its front only. Compare in Deviation takes
  sheets, and section pictures draw them as open lines.
- **Sections that keep to one skin** (2026-10-22). `reverse.section.fit`,
  `outline`, `stack` and a sketch's `fit` take `skin: "outer" | "inner"` and
  `facing { dir, withinDeg }`, so a shell's form is fitted on its outer skin
  alone, not pulled off by the ribs and the inner skin. Each run on that
  side is fitted as a chain of its own. The stack's `within` takes
  `clip: true`, and its circles are fitted and judged against each chain's
  own noise, so small noisy holes read as circles.
- **Loft stations from the scan** (2026-10-22). A sketch's fit takes
  `like`: the scan's run on the plane is fitted with the same lines and
  arcs, in the same order, as another sketch — the same ids, its relations
  copied, and the line it was closed with copied too. A sketch takes
  `inset { by, of? }`: a closed profile moved in by a wall, its arcs
  R − by, its base line kept. A loft takes `sections`, `fit.like` and
  `inner`: in one call it fits a station on each plane and lofts them, and
  with `inner` moves every station in by the wall and lofts those into a
  body of its own, the inside of a thin shell.
- **Surfaces from a query** (2026-10-22). A surface's region can be
  `{ box, normal, exclude, limit }` or `{ marked: true }`, read off the scan
  when the feature is added or edited. `fit.robust: true` leaves out points
  far off the first fit — a rib, a boss — and fits again; the answer gives
  the fit's worst points. A net over 20 × 20 is refused instead of being
  cut down without a word.
- **Many edits, one rebuild** (2026-10-22). `reverse.feature.update` takes
  `features: [{ feature, set }…]`: the edits are made in order, built once
  after the last, and are one undo step. Each edit answers what it picked
  and fitted. In a batch built at its end, every change but the last
  answers `build: "held"`. Nine station edits cost one build, not nine.
- **Sketches through an axis, and Z up on standing planes** (2026-10-22).
  A plane `{ kind: "radial", axis, angleDeg }` puts a sketch through an
  axis with u along the radius and v up the axis, the same at 52° as at
  232°. Planes take `up: "x" | "y" | "z"`: u is then up × normal, so a
  sketch on a standing plane has Z up whichever way its normal points.
  Sections and measured planes are taken by name as well as by id.
- **Pattern copies know what they copy** (2026-10-22). A face a pattern
  copied is made by the feature that made the face it copies, so
  `madeBy: "Blade"` finds the blade on every copy, and `describe` marks it
  `copy: { pattern, instance }`. `where.sides: { madeBy: [A, B] }` picks
  the edges between the faces of two features, such as the roots where
  patterned blades meet a dish.
- **The stack measured from an axis** (2026-10-22). `reverse.section.stack`
  takes `axis`, an element or a coordinate axis: each chain answers
  `fromAxis`, how far its centre lies from the axis and which way, at every
  offset and in every track, so a dish drifting off the bore's axis reads
  height by height in one call.
- **Rounds read on any edge** (2026-10-22). `reverse.body.fillet_read` and
  a fillet's `radius: "fit"` read rounds on edges that are neither a line
  nor a circle, such as a blade's root on a dish: the scan is cut square to
  the edge at seven places, each face's trace taken from the body as a line
  or a circle, and the round fitted between them.
- **A taper is checked edge by edge** (2026-10-22). A tapered extrude was
  refused where a round met a side at an angle: a fan blade with R0.9 tips,
  drafted 3°, at 7.8 mm though it closes only at about 27 mm. A taper is
  now refused only when a whole edge vanishes, folds over, or runs into an
  edge that is not its neighbour, and the refusal says which edge and
  where. A gap in the profile's outline is an error, not a straight line.
- **Accept keeps to neighbouring pieces** (2026-10-22). Tangent, equal
  radius and angle are offered only between pieces joined at an end or
  whose ends lie within a few scatters (equal radius also across one
  piece, and between circles). A relation that would move a piece more
  than `maxMoveMm` (3× the fit's scatter unless given) is left with why
  `"moved"`. An arc's move is measured at its ends and middle, not its
  centre. A sketch added with `accept` answers `moved` too.
- **A kernel crash in a round says where** (2026-10-22). A round or
  chamfer the kernel crashes on is no longer tried again on the broken
  kernel; its failure names the edges — how many, where, and the features
  either side. A step whose body already fails the kernel's check says so
  and names the step that last changed it.
- **Hiding a feature hides its bodies** (2026-10-22). `visible: false` on
  any feature but a sketch hides the bodies it made or works on, which
  takes them out of the export, the comparison and the pictures.
  `reverse.body.set` takes `visible`, and the bodies out of view are saved
  with the project.
- **Mirror as a body of its own** (2026-10-22). A mirror with join off
  leaves the copy as a new body beside its source. The source no longer
  vanishes, and a Combine between the two works. Projects saved before
  keep their shape.
- **A feature's comparison keeps to its size** (2026-10-22).
  `reverse.body.compare { feature }` names only as many patches, worst
  spots and face rows as `patches`, `spots` and `faces` ask for, all on the
  feature's faces, with `patchesFound` counting them all.
- **Answers that keep what was asked for** (2026-10-22). With
  `detail: "none"`, a change still answers `fitted`, `picked`, a sketch
  edit's `rounds`, `accept` and `moved`. `moved` is always there.
- **Fitted rounds that say when they read nothing** (2026-10-22). A
  sketch round answers `points` and what holds it (`held`: given, points or
  dimension). Under three points, or with a best fit at the end of the
  radii searched — the R0.02 of a corner whose pieces were taken out — it
  warns "radius not read" instead of answering the limit as a reading.
- **Smaller fixes** (2026-10-22):
  - Extrude, revolve, loft and sweep take `target`, the one body they join
    or cut; an edit keeps it.
  - Ids sent as text (`"185"`, `"3.0009765625"`) name the body, feature or
    parameter of that id where nothing has that name.
  - `where.sharp: true` keeps only edges between faces that meet at an
    angle, so a round's seams no longer match a radius; `picked` says when
    its edges make fewer tangent chains than they number.
  - offsetBody says its source still stands beside the new body.
  - A variable round takes its edge's whole tangent chain out of the plain
    edges, and says which picks it took.
  - A concave sphere face reads its centre where it is, no longer one
    diameter away.
  - A Combine of bodies cut by one freeform sheet that leaves strips under
    0.01 mm wide is played again fuzzy, and the strips go.
  - A failed feature keeps the body it was given, so `describe { before }`
    and picks by index work while it is put right.
  - STEP verify counts the faces whose loops it does not read, by surface
    type (`verify.loops.unread`): B-spline faces are unread, not wrong.
  - `reverse.section.fit` and `stack` take `maxLength` beside `minLength`.
  - Two lines are not tangent: the refusal says to use parallel or
    collinear, or `add.rounds` to blend the kink.
  - A body comparison on a body split into pieces no longer loses the face
    its patches lie on.

From rebuilding the parts of an extruder assembly from STLs exported out of
its STEP, with the STEP as the answer to check against:

- **Edges picked by a point on them** (2026-10-21). A query takes
  `through: { at, within }`: the edges whose curve passes within `within`
  mm (0.01 by default) of the point, anywhere along them, not by their
  middle. A chamfer or a round read off a mesh gives a point on the edge
  it stood on, but not where the model's edge has its middle. Lines and
  circles are measured exactly, other curves on their drawn polyline.
- **Optional picks** (2026-10-21). A query with `optional: true` may name
  nothing: it then adds nothing, and the answer's `picked` lists it as
  missed, instead of the whole change failing. If every pick of a round or
  chamfer misses, the change says so.
- **Rounds and chamfers that do what they can** (2026-10-21). With
  `skipFailing: true`, a round or chamfer the kernel cannot make in one go
  is made chain by chain. A tangent chain that does not take it is left
  out, and the result's note says how many and where.
- **A failed round, chamfer or shell says where** (2026-10-21). The
  answer's `failed` entry gives `at`, the middle of each edge or outline
  the panel draws red. An agent cannot see the red.
- **A body's mesh misses no face** (2026-10-21). OCCT's mesher sometimes
  leaves a face without triangles at a fine chord. This happens on faces
  whose edges are held loosely, as a STEP translator often leaves them.
  The exported STL then had a hole in it, and a comparison saw through it.
  A body is now meshed again at twice the chord, up to three times, until
  every face has triangles.
- **Regions keep a shallow bend** (2026-10-21). A sketch outline of
  straight sides round a curve (a mesh's cut kept as it was) bounds its
  region again. Before, a side ending end to end on a longer one at a few
  tenths of a degree was moved onto that line, parted from the side after
  it, and the outline bounded nothing.
- **A join that will not close tries a micron of fuzz** (2026-10-22). A
  boolean that leaves no closed solid was already played again with a
  fuzzy value of 0.1 µm. It is now played a third time at 1 µm. Two
  prisms stacked on one plane, each read from the mesh on its own, can
  meet in edges a fraction of a micron apart, and only the coarser value
  joins them. On the extruder's main body that closed a slab that had
  been left out.
- **The CAD-STL skill** (2026-10-21/22) is a pipeline of scripts, and
  there is a `scanruler_batch { file }` to run what they write:
  - `analyze.py` segments the mesh into exact faces and recommends a
    build. The builders are `slabs.py` (2.5D along an axis, with trims
    and fills along others), `revolve.py` (turned parts) and `frame.py`
    (tilted parts).
  - `holes.py` cuts holes, tilted ones too. `blends.py` reads chamfers and
    rounds as through-point picks.
  - `compare.py` checks the result as a voxel difference.
  - revolve.py now cuts sockets on the axis (hex, Torx) as extrudes, and
    reads spline domes from their vertices.
  - slabs.py reads an arc whose vertices stray by microns as one arc.

  On the extruder's parts, the median difference to the STL is 0.7 %
  over 22 parts. The worst are the main body (7 %), the gears (4–7 %)
  and a knurled insert (12 %). The spring is not built.

## 0.6.3 — 2026-10-21

- **Splines in the sketch** (2026-10-20). A Spline tool (S) draws a
  smooth curve through the points clicked. Click the last point again (or
  double-click it), or press Enter or Escape, to end it open. Click the
  first point to close it.
  - Every fit point is an anchor (`a` and `b` at the ends, `p1`, `p2`, …
    between). It can be dragged, joined, dimensioned to, or held on
    another piece. A point or a line's end can be held on the spline.
  - Joined at an end, a spline can be held tangent to a line, an arc or
    another spline. That end's direction is then solved for; elsewhere the
    ends are natural.
  - **Fit spline to slice**, with a spline selected, pulls the drawn curve
    onto the slice points along it. `fit: { spline: N }` fits a chain as
    one spline through N points, closed round a closed chain.
  - Regions find a spline's crossings on the curve itself. The kernel gets
    each stretch as one exact cubic B-spline with simple knots: a single
    smooth edge, on the drawn curve to nanometres, and a
    `B_SPLINE_CURVE_WITH_KNOTS` in the STEP. Splines also work in sheets,
    sweep paths, box selection, patterns and projection onto a parallel
    sketch.

From an agent's three passes on a faceted bike-computer housing
(2026-10-20), plan §13.

- **Compare names the right face** (2026-10-20). `reverse.body.compare`
  put a reading on another face, sometimes on another body, on any body
  with more than a few faces: a mirrored housing, or two bodies at once.
  Its search tree sorts the triangles, and a hit was looked up in the
  meshes' own order. Each triangle is now told by its vertex, so a patch's
  face and `madeBy` are describe's. `over`, `patchesFound` and the far
  reading's `found` are counted when `patches: 0` too.
- **Voids inside a solid** (2026-10-20). `reverse.body.check` counts each
  solid's shells and lists the cavities sealed inside, each with its volume
  and box, as a warning. Before, a banded body carried a 1.2 cm³ cavity
  through three STEPs, reading valid, closed, one solid. STEP verify holds
  the shells per solid against the file's. `audit: "brief"` gives one line
  per finding.
- **Fitted sketches that solve with `accept`** (2026-10-20).
  - The trials now solve with the part's planes, as the sketch is solved.
    A relation to a plane that the sketch's own relations contradict is
    left as a conflict. Before, it was taken and then the sketch would not
    solve ("coincident off by 0.001").
  - A candidate only part of which follows from those already taken is
    taken for the rest.
  - A fitted chain that crosses itself says so ("1 chain → N regions"),
    and `accept` is refused on it.
- **Rounded rectangles and exact tangents** (2026-10-20).
  - A rectangle rounds up to half its shorter side. At exactly half it is
    a slot (a circle when square).
  - `fixed: true` with a radius solves.
  - Tangent joins are held as an angle where the pieces meet, so rounds no
    longer leave kinks of a few hundredths of a degree on the built faces.
- **Edits on a feature whose body was taken in** (2026-10-20). A
  suppressed or failed feature whose body a later feature joined can be
  unsuppressed, renamed or given new numbers. Before, it was refused,
  "Solid n is gone". New picks by index on one that never built say to
  pick by fingerprint.
- **Offsets that say why not** (2026-10-20). A refused body offset names
  the cause and says how far it does offset. The cause is either an
  outside round no larger than the distance, or a thin spot (how thin, and
  behind which face). The guard by the box stays: the kernel's boxes are
  exact, a loft's too.
- **A split by a fitted surface reaches** (2026-10-20). A sheet that stops
  short of the body is carried on to the body's sides, a plane as itself
  and a freeform along its slope at its edge, so `expandPct` need not
  reach.
- **Section pictures and stacks** (2026-10-20).
  - A section picture draws every sketch in its plane, whatever it was
    drawn on, so `section.render { plane }` shows its sketch.
  - A sheet of several cuts no longer repeats one section's sketch on
    every tile.
  - A stack's tracks break where a chain opens or closes, or its box or
    area changes by more than about 30 %.
  - `section.fit { brief }` gives each piece as its kind, world ends,
    radius and rms.
  - `section.outline { simplifyDeg }` merges corners it barely turns at,
    so a chamfer along a cutter meets no near-tangent crease.
- **Pictures for a handover** (2026-10-20). `view.render { show: { notes:
  false, sketches: false } }` puts away the notes' pins and the sketches
  for that picture alone. No sketch changes and no undo step is added.
- **Comparable runs** (2026-10-20). Compare in Deviation keeps the search
  distance as set, answers `referenceSpacing`, and the reference it made
  goes when another scan is opened.
- **Smaller things** (2026-10-20).
  - `fillet_read` rows carry each edge's `mid`.
  - Sketch regions can be picked by a bare `[u, v]`.
  - A batch add that stops names the features it kept.
  - `feature.list` shows read and expression-driven numbers to 12 digits.
  - `reverse.plane.describe { point }` gives a world point's `[u, v]` in
    the sketch frame, and sketch shapes take world points with
    `world: true`.
- **Skill.** Each point is drawn from this run.
  - A region inventory with shaded views before any build.
  - Defaults and approach in the chat.
  - Someone else's session saved before opening.
  - A new file name for every picture.
  - Planes seed-grown before a freeform.
  - Maps in a face's frame.
  - Profiles read before a fix.
  - Two archetypes: the faceted housing and the moulded housing with keys.
  - Voids as a gate in banded builds.
  - Long batches queued.

## 0.6.2 — 2026-10-20

From two agents' runs on the same afternoon — a bowl and a derailleur
hanger (2026-10-19) — plan §12.

- **Outlines that bridge the scan's holes** (2026-10-19). `closeGaps` on
  `section.stack`, `section.fit` and a sketch's `fit` joins chain ends
  across small gaps, nearest first, and says how many and the widest. The
  new `reverse.section.outline` gives one chain as a ready-to-paste
  polyline in the sketch's own frame: thinned to a tolerance, optionally
  squared to the axes, with its largest deviation — in place of corners
  read off a picture. A sketch's `fit` takes `within` and
  `chains: "largest" | { at }`, and with `all` skips a chain too short to
  fit, saying why, instead of failing the whole fit.
- **Answers sized to the question** (2026-10-19). `section.stack` and
  `section.fit` take `minLength`, `closedOnly` and `maxChains` and say how
  many each left out; `section.fit` fits the 12 longest chains unless told
  otherwise. `body.compare` lists `byFeature` worst first, 8 of them
  (`features` for more, 0 for none), and patch vertices only with
  `patchVertices: true`. `body.describe` takes `exclude`:
  `{ madeBy: "Thread 1" }` drops a thread's faces.
- **Edges picked by intent** (2026-10-19). `where` takes `exclude` (another
  query or indices), `loop: "outer" | "inner"` with `faces: [i]` (a flat
  face's rim apart from its holes) and `coaxial { at, dir, within }` (a
  bore's wall, countersink and rims in one). A change answer's `picked`
  says what each index or query landed on, so a stale index shows.
- **Rounds and chamfers read on curved edges** (2026-10-19).
  `body.fillet_read` reads rounds on circle and arc edges between a flat
  face and a cylinder, cone or sphere — a boss's foot, a hole's mouth, an
  outline's corner, a bowl's rim — and on straight edges beside a cylinder;
  the corner is moved onto the scan's own faces where the model's stand
  off. `shape: "chamfer"` reads chamfers with both setbacks, and on a
  hole's mouth the countersink: included angle, diameter and depth, each
  with a sigma. `radius: "fit"` and `distance: "fit"` take these edges. A
  station no longer reads as the other shape when that shape fits its
  points markedly closer.
- **A revolve across its axis says so** (2026-10-19). A profile that
  crosses the axis failed as the kernel's "construction failed"; it now
  fails saying by how much and where (an arc 0.065 mm past a sphere's pole
  was the case). A profile that ends on the axis or runs along it always
  built.
- **Feature names are unique** (2026-10-19). Add, update and a sketch's
  rename refuse a name another feature has, naming it and suggesting
  another; a batch is checked before anything is added. A duplicate had
  stopped a batch half-way at the first lookup.
- **Thread sizes as designations** (2026-10-19). "M10x1", "M10×1",
  "M10 x 1", "1/4-20 UNC" — the designation `thread.read` suggests is now
  taken as it is; a pitch that disagrees with it is refused.
- **A feature's picture cuts across the feature** (2026-10-19).
  `body.compare { feature, picture }` cut through the middle of the
  feature's box, which missed a feature in two places. It now cuts through
  the feature's largest face, across its length (a round face through its
  axis); a feature in several places lists `places` and takes `at`.
- **Worker requests have time limits** (2026-10-19). A stage, check or
  other read the worker does not answer in 60 s (5 minutes for previews,
  compares and exports) fails naming the request, instead of holding the
  workspace.
- **The skill** (2026-10-19): `scan_qa` first; `section_render` the cheap
  way to read a shape, with offsets for several heights; coordinates from
  `reverse_section_outline`, never pixels; `closeGaps` on holey scans; a
  height map for floors and ceilings; fits told which side; repeats by
  `pattern` and `mirror`; extents to datum planes; picks by intent with
  `picked` checked; which RMS is quoted; close-ups of every feature before
  handover; a stale tool list.

- **Editing a feature twice no longer hangs the workspace** (2026-10-19).
  Since 0.6.1 a build keeps each body's faces and edges; the stage of a
  feature — the body as it stood before it, what an edit picks on — was
  that kept copy itself, and the worker hands an answer's buffers on, so
  the kept edges went empty. The next stage of the same feature could not
  be sent and was never answered: the edit, and every change after it,
  waited for good (seen editing a chamfer's edges twice). A build back to
  before the feature failed whole and left no bodies ("There is no body
  57"). The stage now goes out as a copy; the worker answers every request
  — one it cannot send, or whose handler threw, as an error — and a change
  after which the part did not build at all says so rather than answering
  with no bodies. A regression test sends the answers as the worker does.

From an agent's review of a battery case (2026-10-19) — plan §11.

- **A fitted sketch of a clean slice solves** (2026-10-19). Slice to sketch
  held its relations as weights against the slice points; on a clean cut —
  points a few microns off, every 0.02 mm — the points weighed as much as
  the relations, and tangencies between an R0.45 round and an R110 flank
  stayed 1.0–1.6 µm open, over the micron a solve must meet: the sketch was
  refused as not solving, with or without `accept`. A solve with fitted
  pieces now ends with a pass that keeps every piece where the data put it
  and closes the relations exactly. A regression test walks the case's
  side at three spacings and noises.
- **A section's picture draws its sketches where they are** (2026-10-19).
  A sketch on a section counts from the world origin's foot, the section's
  sheet from the part's centre; the picture drew the sketch's numbers
  straight onto the sheet, off by the centre. They now go through the
  world. `section.fit` answers `sketch.add` — a sketch's [u, v] is the
  sheet's plus it (its frame on a tilted section) — and says so; the
  skill's reference had the two frames as one.
- **An extrude's lean takes its expression as draftDeg** (2026-10-19).
  The only expression slot was the panel's taper, `taper = −draftDeg`, so
  an agent setting the lean by a parameter had to turn the sign by hand.
  `exprs.draftDeg` goes in with the field's sign and comes back so;
  `taper` still works, not both at once.
- **A body by the name of the feature that made it** (2026-10-19). Bodies
  are "Solid n" until named, and "Lid raw" — the extrude's name — was
  refused as no body. A body reference that names no body now takes the
  feature of that name for its body; one that made several pieces, or none
  that still stands, is refused saying so.
- **A failed round names a shallow crease** (2026-10-19). Two flat faces
  a few degrees apart where a chain ends — a drafted band on an upright
  end — are named with their angle and place in the failure, with the way
  out: one profile curve in their place, or a clear corner.
- **The skill** (2026-10-19): the defaults put to the person in one note
  before the first build (one body, steps under T as one surface, rounds
  all the way round, functional markings modelled, features on their
  design positions); the two sheet frames; one surface or a step, closed
  islands and cutout slices as one-call measurements; draft's sign;
  shallow creases; batches and measurements; pictures that say why they
  are grey.

From an agent's review of a moulded part (2026-10-19) — plan §10.

- **A Combine takes every piece of its body** (2026-10-19). A `new` feature
  that falls into several solids is a body and its pieces; a Combine took
  every piece of its tool but only the named one of its body, so an
  intersect with the outline trimmed one of two studs from one sketch and
  left the other standing through the wall. The body side now takes the
  family too, and a feature that falls into several solids says so in its
  row's warning.
- **No profile pick lost quietly** (2026-10-19). A sketch edit that cut a
  picked region in two now keeps both parts picked; a pick that names no
  region any more, or one another pick already names, stays on the feature
  and the build names it in the row's warning — before, it was dropped for
  good, and an extrude went on with one rail of two.
- **The notes in every change's answer** (2026-10-19). While any note is
  open, a change answers `notes: { open, answered?, new? }` — `new` the
  notes the agent has not read since it last listed them — so a note left
  while it works is read at its next step, not at the end.
- **Long shallow curves stay arcs; a chain as n arcs** (2026-10-19). The
  cut made a line of an arc that turned under 20°, however far it bowed:
  an R177 side over 40 mm, bowing 1.1 mm under 0.04 mm of noise, was a
  line. An arc that bows five noise tolerances is kept now. And
  `reverse.section.fit` and a sketch's `fit` take `arcs: n` — the chain as
  n arcs end to end, the breaks where they sit closest on the points (two
  tangent arcs of near radius come apart again) — and `section.fit` takes
  `within`, a box on the sheet, to fit one wall or curve.
- **A failed draft says why** (2026-10-19). Like a round and a shell: the
  faces tried one at a time — those that do not lean, with the largest
  angle each takes — or, each leaning alone, the faces together, outlined
  red, with the road round it.
- **Both maps from Compare in Deviation** (2026-10-19).
  `reverse.body.compare_in_deviation` answers `onReference` beside the
  scan's map: the bodies read against the scan — the share the scan stands
  behind, the patches where a body stands proud of the scan (material the
  part has not), the far reading by side, and the body surface no scan
  stands behind — each patch with the body face nearest it and the feature
  that made it.
- **The skill** (2026-10-19): read the notes the answers name, draft read
  early, missing data said once, shell before thin spots, steps drawn into
  the profile, helper bodies inside the wall, rounds planned and run on, a
  rebuilt piece in its neighbour's profile, hidden features sized for
  function, both maps read, pictures as sheets and deliverables not shown,
  and a checklist before every handover. Build line `page.commands: 115`.

## 0.6.1 — 2026-10-18

- **One feature checked in one call** (2026-10-18). `reverse.body.compare
  { feature, picture? }` reads the scan about the faces that feature made
  and nowhere else: the figures over those faces (read, within, mean, rms,
  the extremes, each face's row), the patches on them, the far reading in
  their box, and `numbers` — the feature's fittable number (a fillet's
  radius, an even chamfer's distance, a draft's angle, an extrude's end)
  beside the scan's reading of it now, with its sigma and how many sigmas
  apart. With `picture: true` the answer is also a PNG of a section across
  the feature — square to a round's edge, through a drafted face along its
  pull, else square to the longest side of its faces — framed on it, the
  bodies' cut and the scan red over tolerance. What took a compare, a
  describe and a render for every feature. A body rounded R1 where the scan
  is R2.5 reads 74 sigmas off, its patches all on the round and inside the
  body; fitted again, it reads clean.
- **"fit" in place of a number** (2026-10-18). A fillet's `radius`, an even
  chamfer's `distance` and a draft's `angleDeg` take `"fit"`, and an
  extrude's extent `{ kind: "toScan", from, near?, reverse? }`: ScanRuler
  fits the number to the scan as the feature is added or updated
  (`app/reFit.ts`) — each edge read across as `reverse.body.fillet_read`
  reads it (now for chamfers too: a straight cut in place of the round,
  `estimateChamfer`), each face's scan points fitted with a plane for the
  draft, the scan's face capping the region along the extrusion for its end
  — and answers `fitted` with the value, its sigma, the nominal (a draft's
  to the half degree) and how many sigmas off, and the points; edges or
  faces that read apart by more than two sigmas are refused, each one's
  reading listed. The feature stores the number as one typed, so a project
  holds nothing new; for the session the row says it was fitted (a "fit"
  tag with the reading as its tooltip, `fitted` in `reverse.feature.list`)
  until the number is set by hand or undone. `reverse.feature.refit
  { feature, fields? }` fits them again after something upstream moved.
  On a scanned block: R2.5 reads 2.486 ± 0.023, a 1.5 chamfer 1.483 ±
  0.007, a 2° draft 2.00°, the top 39.994 mm up.
- **A slice to a constrained profile in one call** (2026-10-18). A sketch's
  `fit` takes `accept: { sigmas, kinds? }`: every relation the fitted
  pieces come within that many sigmas of holding — as
  `reverse.sketch.candidates` lists them — is added, nearest the mark
  first, and the sketch solved after each; one the solve cannot meet with
  those before it is left as a conflict, one they already imply is left as
  implied (`core/accept.ts`). The answer's `accept` lists what was accepted,
  with the ids of the relations added — to take one out again with
  `remove: { constraints }` — and what was left, and why. On a scanned
  stadium plate, `accept: { sigmas: 2 }` takes the sides level, the ends
  equal, the profile symmetric and on the part's planes beside the
  tangencies the fit joins itself, and the sketch is fully defined on its
  points (rms 0.017 mm).
- **The bodies in a section's picture** (2026-10-18). The workspace fills
  `section.render`'s `bodies` layer: the visible bodies cut by the
  section's plane — the kernel's own plane section (`sectionPlane`), exact
  edges sampled at 5 µm and joined into loops, an outline per loop under
  the body's name — and the pieces of the sketches drawn on the section,
  dashed, each labelled by its id. A body rounded R1 where the scan is
  R2.5 shows that round's crescent in red and nothing else: 30 of 825
  points over 0.1 mm, all inside the body, up to 0.66 mm.
- **A corner round in a sketch, fitted to the scan in one call**
  (2026-10-18). `reverse.sketch.edit { add: { rounds: [{ a, b, radius? }] } }`
  puts an arc tangent to two pieces — two lines, a line and an arc, or two
  arcs — where they meet, cuts them back to it and holds it with
  coincidences and tangencies (`core/roundCorner.ts`). With `radius` the
  round is that radius, a dimension; without, it is the scan's: the slice
  points about the corner that the pieces carried — where the fit merged
  the round into them — or that a fitted arc between them had move onto the
  new arc, the solver fits it with the tangencies held, and the points are
  shared out again by what they now lie nearest until they stay. The
  answer gives each round's radius, its sigma (how well its points pin it
  with the round tangent to its pieces), the nominal and how many sigmas
  off, and its residual. Read off slice points with noise of 0.03 mm, an
  R2.9 corner the fit merged comes back 2.867 ± 0.021, an R3 blend from a
  line into an arc 3.007 ± 0.029, an R2.5 between two arcs 2.480 ± 0.026.
- **A change says what it made** (2026-10-18). A change's brief answer —
  `reverse.feature.add`, `.update` and the rest — gains `made`: per body
  the change touched, the faces and edges the feature made, by the index
  `reverse.body.describe` gives them as the body stands — a face's kind,
  normal or axis, centroid, radius and area; an edge's kind, length,
  middle, radius and the faces either side — at most 20 of each, with
  `of` counting them all when there are more. The next feature picks from
  it without describing the body again: an extrude's answer names its six
  faces and twelve edges, a round's its round faces. About 1–1.5 kB on an
  extrude or a fillet, against 10–41 kB for the describe it replaces;
  `detail: "none"` leaves it out.
- **Rounds read off the scan, a STEP file checked as it is written, and a
  plain bore no thread** (2026-10-18). `reverse.body.fillet_read { body,
  edges }` reads the round the scan has along each of a body's sharp edges
  — what a fillet there should be — as the fillet box reads it for the
  first edge picked, now at three places along the edge's middle: per edge
  the radius (the median), its sigma (the larger of the fit's and the
  spread along the edge), the nominal to the half millimetre and how many
  sigmas off, the residual and the points; "no round" where the scan is
  sharp; and the median and spread over the edges. The fit gained its
  sigma (how much the points on the round say about the radius), and the
  box and the command share one reading (`core/filletEstimate.ts`
  `readCornerCut`). On a scanned R2.5 edge it reads 2.504 ± 0.015 mm.
  `reverse.export.step { verify: true }` reads the file back and holds it
  against the bodies — parts, volume and faces either side, closed and
  valid, the gap at points of each both ways — and reads each face's loops
  as Onshape and SolidWorks do, which OCCT's own reader mends without a
  word: the round the writer once turned into a cove fails the check with
  its face named (the loop reader moved from the tests to
  `core/stepLoops.ts`). `reverse.thread.read` gives the teeth's height
  (`contrast`, the profile folded at the pitch) beside the wall's `noise`
  and says `thread: false` — no size suggested — when what repeats stands
  under three times the noise: a printed bore's layer lines, a scanner's
  stripes.
- **The skill sends the measuring to ScanRuler** (2026-10-18). The
  `scan-reverse-engineering` skill moved to `plugins/reverse/skills/` (out
  of `skills/`, so it needs no exclude of its own) and was rewritten so an
  agent measures through the commands instead of copying the scan out to
  fit it in Python: its first lines say "ScanRuler measures, you decide"
  and which build it was written for (`page.commands: 110`); measuring is a
  profile road — `reverse_section_fit` to read the pieces, a sketch with
  `fit` on the section, `reverse_sketch_candidates`, the relations the
  design means added with `reverse_sketch_edit`, and the solver's
  `solve.fit` and `moved` saying what each cost — and a table with one call
  for each other reading (draft, a blend across an edge, the mirror plane,
  a sloped face, model against scan). Python, the PLY export, the STL
  distances, the KD-tree mirror search and matplotlib are a short
  *Fallbacks* list at the end, each with the command that replaced it.
  Helpers read and never change the session or the view; one agent models.
  `reSkillNames.test.ts` also checks that the build line matches the
  commands registered and that Python is named only among the fallbacks.
- **A growth benchmark** (2026-10-18). `tests/reGrowth.test.ts`
  (`RE_GROWTH=<scale>`) generates an agent's script for 10 × scale bodies —
  each a sketch, an extrude, a round, a move, every fifth patterned — runs
  it through the workspace headless and times each command and the
  viewport's redraw after it, counting the buffers made anew. Against main
  at 120 bodies: the redraw 19 ms a command at the end and
  growing, now 0.3 ms flat; the buffers made 1,159 a command, now 15; the
  whole 420 commands 16.3 → 3.7 s.
- **The skill split, in the repository, and checked** (2026-10-18). The
  `scan-reverse-engineering` skill — one 55 kB file — is now
  `skills/scan-reverse-engineering/SKILL.md` (the workflow and judgement,
  a section on working with builds — steps recomputed and restored, batches
  that roll back, timings, jobs, warnings, a crashed step — and a table of
  red flags; 24 kB) and `reference.md` (every tool's input with an example,
  plane frames, the cost of each answer measured on the vacuum adapter with
  `scripts/measure-reply-cost.mjs`, and the errors with their fixes). Both local copies
  (the synced skills folder and Claude Desktop's) hold the new pair; not
  uploaded to the account. `reSkillNames.test.ts` checks every tool name in
  it against the commands with every plugin installed and the server's own.
  Measured answers: `feature_add` 91 B with `detail: "none"`, 531 B brief,
  684 B full; `feature_list` rows on 50 features 6.7 kB, whole 28 kB;
  `body_describe` 41 kB with edges, 11 kB without, 77 kB with fingerprints,
  1 kB with a `where` and `limit: 5`; `section_stack` at six heights 5 kB,
  41 kB with pieces; `feature_schema` for a sketch 35 kB; a batch costs 78 B
  a call, its timings 34 B a change.
- **Booleans held to their volume, a kernel that traps started again,
  picks found by place said so, and parts made up from seeds**
  (2026-10-18). A join never loses volume and never makes more than its
  parts together, a cut never gains, a Combine keeps the volume identity —
  the two bodies less what they share, within 0.2 % (`core/booleanGuard.ts`;
  what they share is worked out with another boolean where the Combine took
  under a second, past that the result is held to its bounds) — and a
  result that fails is played again the kernel's other ways and refused,
  saying why, when none passes. A result taken on a second try — a volume
  check failed, or no closed solid at first, for a join, a cut, a Combine,
  a pattern, a shell — carries a `warning` on its row, as does a pick found
  again by where it lies on a face or an edge another feature made than the
  one that made it when it was picked; the panel shows it under the row,
  and `feature.list` and a feature's `result` give it. A trap inside the
  kernel's WebAssembly — an `unreachable`, a memory access out of bounds —
  is seen wherever it happens (every OCCT call is watched, so a helper that
  tries again another way cannot hide it): the build stops, the worker lets
  the kernel go and starts a fresh one, and plays the build again on it
  with the step it trapped on put down as failed — "The CAD kernel crashed
  on this step (…) and was started again" — left out until it is changed.
  `reFuzz.test.ts` makes 16 parts from seeds through the commands — a base
  extruded or revolved; boxes and cylinders joined and cut on the body's own
  top face, holes, a round or a chamfer on an outer edge, a pattern, a
  shell early on — checks after every step that each body is one closed
  solid and the volume moved the way the feature moves it, and holds each
  seed's steps, outcomes, total volume and area (to 1e-6) and face and edge
  counts to `reFuzz.goldens.json`; `RE_FUZZ_BLESS="why"` writes them anew,
  and docs/development.md's occt-wasm steps say when. 108 steps, every check passed;
  the six that fail do so for their own reasons (a shell where earlier cuts
  left walls 0.1 mm thick, a cut that meets nothing). `reCommandHostile`
  sweeps the workspace's commands with junk on a part (tests/hostileKit.ts):
  3,585 calls, 67 answered, nothing found. Tests: `reBooleanGuard` (the rules on numbers; a fuse that
  comes back short once taken on the second try with a warning, short every
  time refused; a pick whose recorded maker is another feature warned),
  `reTrap` (a round that traps: the kernel loaded again, the plate built on
  the fresh one, the round failed saying so, not played again on the same
  list, played and built once changed).
- **Which steps a change played, and waits that hold in a hidden tab**
  (2026-10-18). A change's `steps` names the steps its builds played, each
  with its milliseconds (`played: [{ feature, ms }]`, from the builder's
  own play times; the client keeps the log), for a batch asked for its
  timings — scanruler-mcp leaves it out otherwise. The session's `settled`
  looks again on every change of the store, the timer as backstop, and a
  build stops counting as running before the store says it landed, so what
  waits on the store finds the session idle when it looks; the busy check
  names the store to the app's waits. `history.restore` waits for each
  undo's rebuild before the next. `e2e-agent-reverse`, in both modes, adds
  twenty fillets on a 20-sided prism in one batch with `wait: false`
  (answered at once, then all built), a batch refused at its third call
  (the two before undone, the features and parameters as they were), and a
  timed batch; in page mode the tab made hidden says so and still renders.
  Tests: `reCheckpoint` (three changes since a checkpoint taken back, the
  same restore again undoing nothing, refused once undone past; a change's
  steps played named with their milliseconds).
- **The workspace headless, for an agent's own server** (2026-10-18). The
  plugin's `headless()` starts the workspace's session over the kernel in
  the same thread (`core/reLocal.ts`, moved from the tests, which import it
  from there), so `scanruler-mcp --engine` models with no browser, no scan
  and no viewport. The commands that run so are marked headless in
  `app/reCommands.ts`: `feature.*` (list, add, schema, update, remove,
  suppress, clear, rollback), `sketch.edit`, `build`, `body.describe`,
  `body.check`, `export.step`, `export.stl`, `import.step`,
  `plane.describe`, `parameter.*` and `note.*`; the others — a scan's
  sections and fits, the comparison, pictures — answer `unavailable`. The
  in-thread kernel is imported only there, so the page never takes the
  builder onto its main thread. `e2e-agent-reverse --headless` models the
  pin through a headless server — parameter, sketch, revolve, M3 thread,
  check, l1 to 20 and back, STEP and STL written — checks that
  `view_render` and the comparison answer unavailable naming the page mode,
  and starts a second headless server beside it that shares nothing:
  every check passes.
- **Every build's states kept by the steps that led there, bounded by
  bytes** (2026-10-18). The builder kept two builds whole — the one
  standing and the one before — so a radius edited twice and set back,
  or the bar moved after two edits, played its steps again. Now it keeps
  the state after every step of every build in a tree of steps by their
  keys (exact strings, as before, no hash), and a build takes up from the
  longest run of its first steps the tree holds: the rollback bar moved
  anywhere is a state looked up, and a value set back to one built before
  plays nothing, however many edits came between. What the states hold is
  counted in bytes of the shapes' BREP (a body meshed carries its
  triangles in it — what the kernel holds for it), each shape once, and
  past 96 MB (`CACHE_BYTES`) the far ends of the branches not standing are
  let go, the oldest used first; a shape is released with the last state
  that holds it. The build standing is always kept, every step of it —
  which costs nothing, since its last state stages every body before each
  step anyway. A step is taken over from any node of the tree with its key
  whose reads still stand, the most recently used first. Each body's faces
  and edges are read once per chord, and its size once, by the body — a
  body is never changed — so a round's step, which looked at the body it
  is on twice, reads it once, and a body staged for editing is the body
  itself rather than a copy, read under the same entry. The changes that
  build — `feature.add`, `update`, `remove`, `rollback`, `parameter.set`
  and the rest — answer `steps: { recomputed, restored }`: how many steps
  their builds played and how many they took up from a state held.
  Measured on saved projects: an appended fillet on project
  (2) 6.65 → 3.47 s, an edit at its end 6.73 → 3.46 s — the round's body
  read once rather than twice, on a knurled cap where a reading is over a
  second; 272 → 208 ms on the vacuum adapter. Tests: `reBuildCache` (a radius edited three times and set back plays
  nothing, and the one before it too; the bar moved to every place and
  back plays nothing; a budget a byte under what is held lets the oldest
  used branch go and keeps the rest, a budget of nothing keeps the build
  standing alone; a round's step reads the faces and edges of its body
  once), `reBuildReuse` (the budget's release test in place of the two
  builds': each shape once, the plate the build standing holds kept, all
  of it released on dispose) and `reChangedBodies` (a parameter set and
  set back through the commands answers 2 steps recomputed, then none).
- **Only the bodies a build changed go to the page** (2026-10-18). Every
  build handed the page every body standing — each mesh, its normals, face
  hashes and every edge's polyline, cloned in the worker and posted — and
  the viewport made every body's geometry again, faces, edges and
  silhouettes, even when only a body's eye was switched. Now each body the
  kernel meshes gets a key of its own (`BuiltBody.key`, the builder's mark
  and a count, so a kernel started again never repeats one the page held);
  the client tells every build which keys it holds (`have`), and the worker
  hands over whole only the bodies the build made or changed, with every
  body standing in brief (`all`: name, volume, faces, triangles, box). A
  body the build left as it was comes back the very object the page held,
  mesh and all. Should an answer arrive between a build's request and its
  own — two builds asked at once — the client finds a body held at another
  key and asks for it again (`bodies`). The viewport keeps one block of GPU
  geometry per body, keyed by the mesh it was made from: only the blocks of
  the bodies a build changed are made again, and a body's eye or colour
  changes uploads nothing — its faces, its edges (one block per body and
  kind) and its silhouette (one per body, made again for every body only
  when the camera turns) are shown or hidden with it. Measured on saved
  projects, before → after, medians of alternating runs: on
  project (2) — three bodies, a fillet appended on one — the worker hands
  over 2.48 MB in place of 4.37 MB, the page uploads 1.09 MB of geometry in
  place of 2.24 MB and spends 22 ms on it in place of 35, and a body's eye
  uploads nothing (it was 0.75 and 1.83 MB); the times stay the kernel's.
  Tests: `reChangedBodies` (three blocks: a fillet on the middle
  one hands over that body alone and the others stay the same objects, a
  build of the same list hands over nothing, the fillet undone hands back
  the one body, a block removed nothing; two builds asked at once, the
  second asking again for the body held in between) and `reSceneBlocks`
  (a real build's three bodies in the layer: an eye off and on makes no
  buffer anew, a changed body makes its own and keeps the others').
- **An extrude typed straight in** (2026-10-14). The Extrude box opens
  with the keys in **To**, its number selected — type the distance, no
  click on the field first — and takes them back there once a profile is
  picked on the part, unless another field holds them. While nothing is
  typed into To, Escape still closes the box and Enter still creates the
  extrude at once; with a number typed, Enter takes it and the next Enter
  creates (`passKeys` on the field). Choosing **Cut** in Result turns the
  extrude the other way as Reverse direction does, and going back to Join
  or New body turns it back — a join reaches out of the part, a cut into
  it (`setExtrudeOp`; a command's `op` turns nothing, as it names its
  extent). The **Extrude** and **Revolve** keys in the sketch box now
  open with every region of the sketch picked, not only a sketch's one
  region — a click on a region lets it go; the panel's keys still pick
  only a lone region. Tests: `reStore` (both keys picking two regions, the
  panel's none; Cut turning a distance and a to-next over and back, a
  command's op not).
- **A thread on a face drawn any size** (2026-10-14). A hole is designed
  at the thread's nominal size — Ø5 for M5 — but Thread refused a bore as
  wide as the thread's root ("nothing to cut") and on a boss under it, and
  only cut the crests short on a bore wider than the minor diameter. Now the
  face is brought to the thread along it before the thread is cut: a bore
  wider than the thread's minor diameter is filled in to it and a boss
  under its major built up — a ring fused onto the face over the thread's
  span, ending on the crests so they are a piece of its cylinder, as a
  face drawn at them already gave (`fillRadius`) — and, as before, a
  narrower bore is bored out and a wider boss turned down. So a Ø5 hole
  takes M5, M4 or M6 and a Ø4 pin M5; a thread shorter than the face fills
  only its own length, the rest of the bore left as drawn. Where the fill
  ends inside a bore it stands clear of — an M4's in a Ø5 hole — the thread
  runs out past it as at a free end; where the thread's root is the bore —
  M5 in Ø5 — it stops at the fill's end, so the wall beyond is not cut,
  with an offset either. A bore drawn at a size's own diameter (to 0.01 mm)
  now takes that size when the face is clicked — a Ø5 hole M5, Ø14 M14 —
  and any other bore its tap drill's as before; a scan's bore is never
  that exact. The box's reading says what happens to the face (**the Ø5
  bore filled in to the minor**), and the row's note says it once a face
  was off by more than the thread's depth (`faceAgainstThread`). Tests:
  `reThread` (the fill's radius for bores and bosses, at the crests, past
  them, with an offset and past pointed crests; M5, M4 and M6 in a Ø5 bore
  to the volume the profile says; a short thread filling only its length,
  either end; the wall past a short thread whole under an offset; a filled
  bore countersunk; a Ø4 pin built up to M5 and a Ø12 boss to M16);
  `e2e-thread` (a Ø14 bore taken for M14 and filled in).
- **A full circle dimensioned by its diameter** (2026-10-14). The
  Dimension tool gives a full circle a **Ø** — a hole or a boss, as a
  drawing gives it — and an arc its radius as before: a new constraint,
  `diameter`, whose value is the diameter and which the solver holds the
  radius at half of. On the sheet it is a line through the centre with an
  arrow on the rim at each end (core `DimShape` `diameter`), dragged round
  as a radius's leader is; the panel's row reads **Ø circle n**. A round
  piece's number typed with its letter on the sheet — **Ø12** over an R,
  **R6** over a Ø — gives it that way, in one step, but only where the
  text is no expression as it stands, so a parameter named `d1` is still
  one; the row's **→ Ø** / **→ R** chip turns it over with the size held,
  an expression carried over as `2 * (…)` or `(…) / 2`
  (`setDimensionForm`). Existing radius dimensions on circles stay radii.
  A snap edit that changes a circle's size reads a diameter dimension as
  it does a radius. Commands take `{ kind: "diameter", entity, value }`.
  Tests: `reDraw` (a circle's pick is its diameter, an arc's its radius;
  a diameter in hand pairs with another piece), `reSketch` (the solver
  holds a circle at half its typed diameter), `reDimLayout` (drawn rim to
  rim, carried out to a number outside), `reParameterStore` (the form
  turned and back, its expression held, one step each).
- **A thread for 3D printing** (2026-10-14). The Thread feature's
  **Type** has **3D printing — 45° flanks** (`standard: "print45"`): a
  profile of its own, made to be printed with the axis upright. The flanks
  lean 45° from the radius — 90° between them, where the 60° form's lie 30°
  off level — so no face that looks down overhangs past 45° and it prints
  without supports; the crest and the root are flat, a fifth of the pitch
  each, upright when printed, with no round anywhere; it is 0.3 of the
  pitch deep, the tooth and the gap each half the pitch wide halfway down.
  It is what the printing community's 45° threads converge on (90°
  included, flat trapezoidal crest and root), with flats wide enough to
  stand a layer or two at usual pitches. Sizes are the ISO metric
  diameters from Ø3, each first at the pitch that cuts as deep as its ISO
  coarse thread — 1.8 times as coarse, rounded to a quarter of a
  millimetre under 3 mm and to a half above (Ø6×1.75, Ø8×2.25,
  Ø10×2.75, Ø12×3, Ø16×3.5, Ø20×4.5) — so the minor diameter is ISO's: the
  core as strong, and a bore at the tap drill's size taken for the same
  size; the ISO coarse pitch is the second, shallower choice. Designations
  read `Ø10×2.75 print`, and a typed size ends in `print` too, so a row
  always says which form it is. It mates only with itself. The tooth is
  drawn by one outline for both forms (`ThreadForm`: the flank's tangent
  and secant, the depth and the flats as shares of the pitch), which
  reproduces the 60° numbers exactly; `threadDepth`, `minorDiameter`,
  `pitchDiameter` and `maxThreadOffset` take the standard. The offset's
  limit is a quarter of the pitch times the flank's cosine — √2/8 of it
  here — and the printing crest never comes to a point short of it.
  `reverse.thread.read` sets a reading against these sizes too under
  `standard: "print45"` or `"any"` (a boss at an ISO pitch ties with the
  metric size, which is listed first, and takes it). Tests: `reThread`
  (the 60° outline point for point against the old closed form; the 45°
  outline's slope, flats and depth, bolt and nut complementary; the
  offset; the table pinned, every minor diameter within 0.16 mm of ISO's;
  a boss and a bore cut in the kernel to the volume the profile says; a
  build carrying the standard to the kernel).
- **Section, Full part or No part under a sketch** (2026-10-14). The view
  bar's **Model** and **Slice** keys are one choice of three: **No part**,
  the sheet on the bare stage; **Section**, the part cut open at the plane
  as before; **Full part**, nothing cut away. Under **Section** the solid
  bodies are now closed where they are cut, each in its own cut colour, as
  the section view closes them (`capSketchSlice`), rather than showing
  their insides; and a part modelled with no scan is cut — the slice cut
  only where the plane ran through the scan before.
- **The camera into a sketch and out, and after a build** (2026-10-14).
  The swing round to a sketch plane turned about the camera's old target,
  wherever orbits had left it along the line of sight, so the part swung
  out across the screen and back; when the scan's slice came in under way
  the swing jumped, and after it the view snapped. It now turns about a
  point at the part's own depth, bends towards a goal that moves, and the
  sheet flies to the slice's framing with the part under it; a sheet laid
  again over the same bounds leaves the view alone. Put away, the sketch
  hands the view back: the camera swings back to where it was when the
  sketch opened, the sketch's work now on the part. A new sketch on a
  stage with no scan opens over the bodies as they lie on the plane
  rather than round the origin. On a stage with no scan, a build that grew
  the bodies past the last framing made the camera jump to a fixed view
  from above with Y up — after a sketch, an extrude, an undo; it now flies
  out to take them in looking from where it looks, and only when they
  reach off the screen. The first view of such a stage is the iso view, Z
  up.

## 0.6.0 — 2026-10-14

- **A round or chamfer no longer runs on along a line the viewer hides, and
  a block joined flush to a cylinder joins** (2026-10-14).
  - **Hidden lines are not edges:** where a face lies on its neighbour's
    surface — a latch panel drawn on a flange's radius and started inside
    the flange — the two stay two faces, and the line between them, which
    the viewer neither draws nor picks, can run on in a straight line from
    a real edge. The tangent chain walked onto it: a chamfer on the panel's
    corner took the hidden line down into the flange too, lit so in the
    box and the preview. The walk now stops at edges between two faces of
    one surface (`topo.splitEdges`: planes whose outward normals agree,
    faces of one cylinder or sphere; cones are left as edges, their
    fingerprints not telling an angle), in the build, the diagnosis and
    the lit chain alike.
  - **Flush joins:** two faces lying on one cylinder broke the kernel one
    way or the other — exactly on it, its unifying left the shell open;
    a few nanometres apart (an arc drawn through ends typed to six
    decimals), its exact boolean did — and the step failed as "Joining
    left no closed solid". A step that leaves no closed solid is now
    played again, first with the faces on one surface left as cut
    (`kernelOps.keepingSplits`), then with fuzzy booleans of 0.1 µm
    (`kernelOps.fuzzyBooleans`); the first that closes stands. Steps that
    close the first time are never played again, so other builds are as
    they were (ten saved projects: the same bodies, the same times).
    Rounds and chamfers are not played again.
    Tests: `reFlushJoin` (a panel on a flange's radius, exact and a hair
    off: one closed solid either way, the same volume; a chamfer on its
    corner takes the one edge; `splitEdges` by surface kind).

- **A fillet at a varying radius in the panel, a chamfer by two distances
  or a distance and an angle, and Delete face** (2026-10-13).
  - **Variable radius:** the fillet box's **Radius** is Constant or
    Variable. Variable lists each edge clicked with a Start and an End
    radius — the next edge starting at the last one's — ⇄ swapping the two;
    on the part each end has a dot and a label by it, **Start** or **End**
    with the radius there (numbered as the box lists the edges when there
    are several), standing off past its end the way the edge runs on the
    screen as the view turns (`viewer/varyingEnds`). Switching carries the
    edges picked over while the other mode has none. It is the
    `{ edge, radius: [start, end] }` the commands had, which the box only
    kept until now; an edge reopened finds its start again.
  - **Chamfer types:** Equal distance as before, **Two distances** and
    **Distance and angle**, with **Flip**. The kernel's one such chamfer
    measures from each edge's first face in its own order, so each edge is
    asked for what puts the chamfer on the reference face — the face most
    of the edges share, a rim's top, or the other one flipped — worked out
    from the angle the faces meet at (`core/chamferSides`); edges asking
    alike go in one call, so a rim's corners meet as one chamfer.
    `{ mode, distance2, angleDeg, flip }` on the feature and the commands;
    a failed one is diagnosed as an even one is.
  - **Delete face:** a new feature, a key and a chip on a picked face —
    faces taken off a body and the faces round them run on over the gap
    (the kernel's defeaturing), each found again on its own surface after.
    A click takes the whole of what the face is part of (`core/faceGroup`):
    the faces it is split from, with **Tangent faces** the rounds that run
    on from a round — a fillet's chain, up to the flats — and the faces
    those close in, a blind hole's floor, a boss's top; a block rounded all
    round keeps its flats. `{ kind: "deleteFace", body, faces, whole? }`
    through the commands, `whole` taking each face as a click does.
    Tests: `reChamferDelete` (a two-distance rim 8 × 8 on top and 8 down
    each side, an angled one either way round, a round, a bore, a blind
    hole, a boss and all twenty rounds of a block deleted) and the browser
    check `e2e-reverse-round-delete` (the three boxes through the panel, the
    round clicked on the part and taken off again).

- **A feature's row suppresses it** (2026-10-13). The eye on a feature's
  row hid nothing — the body a feature makes is the body list's, and a
  feature's `visible` was read for sketches alone. Every feature but a
  sketch has a **suppress key** there now, a block: a click leaves the
  feature out of the build, as Suppress on the row's menu does, and the
  block struck through on a suppressed row — where a dash was — builds it
  again. A sketch keeps its eye; a feature hidden before shows as built.
- **Arrows held on the screen** (2026-10-13). The arrows on an extrude and
  its taper, a fillet's or chamfer's edge, a shell's opened face and a
  moved face were sized on the part — an eighth of the profile, never under
  a twentieth of the model — and buried a small feature they stood on, a
  2 mm boss under an arrow longer than the part. They are 44 px long at
  every zoom now (`core/preview` ARROW_PX), the viewer scaling them each
  frame (`PluginGrip.pixels`). The Move gizmo is held the same way, its
  rings 90 px and its arrows 30 px past them, where it was sized once to
  the framed view. The number field on an arrow stands off its tip the way
  the tip points on the screen, clear of it. A revolve's ring still runs
  through the body it turns.
- **Notes: a middle click keeps one, Delete all** (2026-10-13). In a note's
  box, or an answer's, a middle click anywhere — pressed and let go
  without moving, as NX takes it for OK — does what Enter does, the hand
  turning the part kept on the mouse; with nothing written it shuts the
  box. A middle drag still pans or turns the view. **Delete all** by the
  Note key takes every note off the part, the person's and the agent's
  questions, once asked — notes are no step of the undo history — and the
  numbers go on from where they were, so an agent still holding one cannot
  answer a new note by it.
- **A line put on an arc splits the region there** (2026-10-13). A line
  drawn across a band of projected arcs, its ends put on them with
  coincidences, bounded no region: the region graph sampled each arc to
  5° chords and found crossings and ends on those, and the chords run
  inside the arc — 28 µm on a 30 mm radius — so an end lying on the arc
  touched no chord and the line dangled. Drawn on past the arcs, the line
  crossed a chord a hair inside, the face lifted from the region took that
  corner off the arc, and the join came out with its sides on circles of
  28.7 mm where the edges were 29.6 and 30.9, three sliver faces stepping
  beside them. Crossings, tangent touches and ends lying on another piece
  are found on the exact lines and arcs now (`core/regions.ts`), the arcs
  split there and sampled between as before, so every corner lies on its
  arc and the join merges into the faces beside it. Pieces leaving a
  vertex are ordered by their tangents, turned the way each bends, not by
  their first chords: two arcs touching where they start — a tab's edge
  running into the rim — bound the crescent between them, not three
  slivers where their chords cross. A region's key no longer turns from
  0.00 to -0.00 with rounding about an axis. Every region pick in six
  saved projects comes back as before.
- **Bodies modelled apart built at the same time** (2026-10-13). The
  knurled screw cap opened in 139 s in the browser, its base and its cap
  built one after the other on the one kernel; it opens in 87 s now, and a
  change of its threads' pitch rebuilds in 23 s, not 34. Before a build the
  steps are grouped by the bodies they work on (`core/buildGroups.ts`):
  two groups never read or change a body the other made — a join or cut
  into whatever it meets reads every body, and puts them all in one.
  Where two groups each have work worth it (0.8 s, 3 s before a helper
  has started), up to two helper kernels, in workers of their own made by
  the kernel's worker (`core/reHelper.ts`, `reHelperWorker.ts`), build some
  of them while the main kernel builds the rest (`Builder.buildPart`), and
  the build of the whole list takes every step over from the parts
  (`core/reParallel.ts`) — checked by what each step read, so a guess that
  turns out wrong costs time and never the result. A helper's part comes
  back as binary BREP, its faces' makers by the faces' order, every object
  by a token so a body the main kernel already holds is named rather than
  sent again, and stays the very object it was (`core/buildTransfer.ts`):
  11.7 MB of the cap's bodies, written in 73 ms and read in 88. A group
  stays with the kernel that built it, so edited it is taken over there
  from what that kernel kept; a group goes to a helper only as new work,
  and one that reads the scan stays with the main kernel. The main worker
  waits for a helper's kernel to be up before it starts on its own share:
  busy in its own work, it could not start the helper's worker, and the
  first build came out no faster. A helper that fails leaves its group to
  the main kernel. The time each step took is kept by its key
  (`Builder.playMs`) and is what the groups are weighed by; a step not yet
  timed is weighed by its kind. A part as small as the carbon filter's
  stays on the one kernel. The cap is now as slow as its slower half — the
  base's knurl, whose steps each wait on the one before. `reParallel.test.ts`.
- **A project opened brings its own notes** (2026-10-13). Opening a project
  kept the notes in hand when it had none, or only older ones: a second
  project of the same part — its scan saved under the same name — opened
  over one with notes showed the first one's notes, and saving it then
  wrote them into it. A project's notes now take the place of those in
  hand, as its model does, and a project without notes has none
  (`app/notesSection.ts`). The time the notes last changed, which 0.5.3
  writes into the file, is no longer written or read.
- **Faster builds and rebuilds** (2026-10-13). A knurled screw cap of 46
  features — two threads, two knurls of 48 teeth each way — took 368 s to
  build on opening, and as long again after a change near its top; it
  builds in 138 s now, and changing its threads' pitch rebuilds in 33 s.
  The carbon filter housing, two 215 mm threads: 5.3 s to 3.6 s, and 1.6 s
  after its cap's round is changed. Measured in Node on the kernel in the
  test's thread; the outcome of every feature is the same as before.
  - **occt-wasm 5.0.0 → 5.7.1**, the same OCCT 8.0.1. The wrapper built
    every two-shape boolean twice — the operation's constructor builds it,
    and it was built again — which 5.5.1 fixed; it also tests the shapes'
    oriented boxes before their faces. Every join, cut and intersect,
    including a thread's, takes about half the time.
  - **Several solids fused at once** (`ReKernel.fuseAll`): a pattern's
    copies, the profiles of one extrude or revolve, a Combine's tool in
    pieces, the fragments a Split keeps were fused one after another, each
    fuse going over everything fused before it; in one operation each
    meeting is worked out once. The knurl's 48 teeth: 22 s to 3.7 s. Fused
    one after another after all where the one operation fails or comes
    out invalid.
  - **Steps a change did not reach are taken over** (`core/buildReads.ts`,
    `Builder.takeOver`). A build took up from a kept one only as far as
    the first step that changed, and played every step after it. The
    builder's state maps now note what each step reads of them while it
    plays; a later step whose key is a kept build's, and which finds every
    body, sketch and id it read there the very same objects now, has its
    outcome laid on the state instead of being played — the bodies it
    set, the ones it took away, its result. A tool body modelled on its
    own, a sketch on a plane, a pattern of either, are not built again
    when a thread above them changes; a step that read the whole of the
    bodies — a join or cut on whatever it meets — is played. Results the
    same as a build from nothing (`reBuildReuse.test.ts`).
  - **Overtaken builds skipped** (`core/reQueue.ts`). Every change made
    while a slow part was building asked for a build of its own, and the
    worker played them all, one after the other. It now takes its requests
    one at a time, and a build followed straight by another build — a
    preview by another preview — is answered as skipped, which the page
    had no use for anyway; a STEP file it brought goes on to the one that
    overtook it.
- **Overlapping bodies in red** (2026-10-13). Two solid bodies that run
  into each other — two blocks made as bodies of their own, their tops
  flush — fought over the faces they have in common, the two colours
  flickering in stripes as the view turned. What they share is drawn red
  over both now, hatched so it is not taken for a body's own red. It is
  worked out once a build lands, on the meshes the viewport draws — by
  Manifold, the mesh boolean, in the kernel's worker (`Builder.overlaps`,
  `core/overlapMesh.ts`): milliseconds a pair, where the kernel's own
  common took seconds on two threaded parts, and every build and preview
  would have waited behind it. Each pair is worked out once for the two
  bodies as they stand, in slices of 100 ms. What comes back lies on the
  bodies' own facets and is drawn a hair nearer the eye, so it wins where
  their faces lie on one another (`ReScene.setOverlaps`).
  It shows while both bodies do, inside see-through bodies, and on the
  section view's cut over both bodies' cut faces. Bodies that only touch
  share nothing; the scan is no body, and a body modelled in it is no
  overlap. **Overlaps** in the menu over the view bar's Bodies key turns
  it off — nothing is worked out then — for a part whose bodies overlap
  on purpose, a modifier volume for a slicer; it is saved with the project
  while off. `scripts/e2e-reverse-overlap.mjs`.
- **Bodies in the section view** (2026-10-13). The app's section view cuts
  the bodies and a feature's preview with the scan, as the sketch's slice
  did; a solid body is closed where it is cut, each in a cut colour of its
  own after the scan's, and a see-through one is left open as the scan is
  (`ReScene.recap`, core's `CapSet`). The sketch's slice stands in front of
  the section view while it cuts, and closes nothing of the bodies, as
  before.
- **The build on the stage** (2026-10-13). While the part was being built
  only the feature list's heading said so, and the viewport went on showing
  the last build's bodies — a change with nothing moving on the part read as
  one that did nothing. A build that takes more than a moment now puts
  **Building the part…** with a spinner at the top of the viewport, and a
  part with features opened before the kernel is up says **Loading the CAD
  kernel…** there; a quick build and the playback's steps show nothing
  (`ui/BuildChip.tsx`).
- **Scan, Bodies, Elements on the view bar** (2026-10-13). The workspace's
  seven keys and the app's four are one row now: **Scan**, **Bodies** and
  **Elements** — a click shows the part or puts it away — then
  **Deviation** at the side, then **Section**. The menu over the Scan key
  sets it **Transparent**, its mesh and its back faces, and holds
  **Curvature**, a way of looking at the scan alone (it and Deviation
  still put each other out); the one over Bodies sets them
  **Transparent** and the **Tangent edges** drawn,
  dimmed or off, as three keys instead of one stepping through them, with
  a picture of a rounded edge and its two tangent lines instead of a
  circle and its tangent. **Opaque** is gone: the scan and the bodies are
  each transparent or solid, so both transparent or both solid can be had
  as well — both solid shows where each stands proud of the other. As the
  workspace opens the scan is a veil over the bodies while one is shown,
  as before. A project saves the two (`scanSeeThrough`, absent while the
  scan follows the bodies, and `bodiesSeeThrough`) and reads an older
  one's `bodyOpaque` as them.

## 0.5.3 — 2026-10-13

- **Notes for the agent, pinned on the part** (2026-10-12). Saying where on
  a part something is to be done — this hole, these two edges, the boss the
  model lacks here — took words and coordinates. While the agent connection
  is switched on (Settings → Agents), the panel has **Notes for the agent**:
  the **Note** key and a click on a face, an edge or a corner of a body, or
  on the scan, pins a note there, and the box by the pin takes the
  sentence; with faces or edges selected, **Note** by the selection pins one
  on all of them. A note is a numbered amber pin in the viewport, with its
  text beside it, and the agent's pictures show the pins. The agent reads
  them with `reverse.note.list` — each pick found again on the bodies as
  they stand, a face or an edge by its index in `reverse.body.describe` and
  the feature that made it, a note on the scan with the body face nearest
  it — sees the open ones in `session.state`, and answers one with
  `reverse.note.resolve`: handled, with a line on what it did, shown under
  the note. Notes are saved with the project, move with the part's
  alignment, and are no steps of the undo history (`core/notes.ts`,
  `state/noteStore.ts`, `app/notesSection.ts`, `app/reNoteCommands.ts`,
  `app/useNotePins.ts`, `viewer/notePins.ts`, `ui/NoteList.tsx`).
- **The agent asks back, on the part** (2026-10-13). Where the agent is
  unsure of something that has a place — through or blind, which face is
  the datum, which of two sizes — it pins a question there with
  `reverse.note.add`: on faces or edges of a body, or at a point. The
  question is a blue pin, its row in the panel says **Click to answer**, and
  its box takes the answer, which the agent finds in `session.state` under
  `notes.answered` and closes once it has acted on it. The status line says
  when a question comes in.
- **Notes stay put while the agent works** (2026-10-13). They came and went:
  the agent's element fits and alignments put 3D Measure on screen, and the
  pins went with the workspace each time; and an agent opening the scan
  again took them away for good. The pins now stay on the part in every
  workspace the 3D view is in (they take clicks only in Reverse engineer),
  and notes belong to the scan they were pinned on, by its file name: the
  same scan opened again keeps them, another part's puts them aside until
  that part comes back, and a project saved before the notes last changed
  does not take the newer ones back.
- **A note placed over an element** (2026-10-13). With the elements shown, a
  click with the Note key on a plane or cylinder drawn over the part picked
  the element and offered its chips. While the key is in hand every click
  on the part now pins the note, on the body or the scan under it.
- **The deviation legend's range is set on the legend** (2026-10-12). The
  scale beside the viewport read ±0.1 mm — the range in the editor box —
  and could be changed only there, with a feature open. The figure at
  either end of the scale is now a key: a click opens it to retype, and
  the number entered is the range both ways, so 0.5 at the top or the
  bottom reads ±0.5 mm (`onLimit` on `MapLegend`, set in
  `app/useReversePlugin.tsx` to the remembered live-map range). Escape, or
  anything that is not a number, keeps the scale as it was. The box's
  **Range ±** field reads the same setting.
- **A project opened over a scan keeps its features** (2026-10-12). Opening
  a project while a scan of another name was on the stage — another
  project, say — brought its scan and elements back with an empty feature
  list and no bodies. The workspace started itself over on a new scan from
  an effect on the scan's file name, which ran only once the project had
  put its features in, and took them away again. It now starts over as
  the scan is put in place (`onScan`'s `loaded`, in
  `app/useReverseWorkspace.ts`), before the project's part is restored; a
  scan loaded under a model drawn with none still joins it.
- **Rounds no longer turn into coves in Onshape** (2026-10-12). A fillet
  along a circular edge — a ring's rim, a shoulder on a turned part — came
  out of **Export STEP** as a concave groove with a sharp lip in Onshape
  (and any CAD system on Parasolid), where ScanRuler showed a round. OCCT's
  writer puts such a round's loop the wrong way round when the torus it
  lies on is parametrised left-handed — which happens when the faces beside
  the fillet come to it reversed, as a revolve one way about its axis
  leaves them — so the face named the other three quarters of the tube.
  OCCT's own reader mends such a loop silently, which is why reading the
  file back here looked right. The file is now mended after the writer:
  each torus face's loops are unrolled onto the torus, and where they run
  clockwise about the face's outward normal their bounds are turned —
  nothing else in the file changes (`mendTorusLoops` in
  `core/kernelStep.ts`, run only for a body with a left-handed torus,
  6 ms on a 500 kB file). Files exported before this can be mended by
  exporting again.
- **No seams, no lines across one surface; tangent edges drawn, dimmed or
  left out** (2026-10-12). Every outline of a body's faces was drawn as an
  edge, and two of them are none: the seam where a round face closes on
  itself — a line down every boss and bore, all at one angle — and the
  line between two faces a join left on one surface, which the kernel
  merges back only when they agree to a ten-millionth of a millimetre (the
  halves of a cylinder 0.0000006 mm apart in radius stay two faces). Neither
  is drawn or picked now, as in Onshape and SolidWorks. How the faces meet
  along each outline is read off the mesh: the same face on both sides, a
  seam; the faces' normals agreeing within a quarter of a degree, tangent —
  or a line across one surface where the two faces' fingerprints are one
  plane, one cylinder or cone on one axis, or one sphere (`onOneSurface` in
  `core/topo.ts`, the sorting in `core/edgeLines.ts`). A feature's preview
  leaves out its seams too. The tangent edges — a round running into a
  flat — are drawn as the sharp ones by default; the view bar's **Tangent**
  key dims them, then leaves them out (and unpickable), then draws them
  again — for the session, as the view bar's other keys: every session
  starts with them drawn (`tangentEdges` in the store). On a body of
  23 000 triangles the sorting takes 7 ms, and the edges' shares for picks
  14 ms, once per build — the lines at rest are kept for the mesh, not
  worked out again each time a body is shown, hidden or recoloured.
- **Who made a face, through a join that merges faces** (2026-10-12). A
  join or a cut merges back the faces it split where they lie on one
  surface, and the face history was read before that: a face it merged,
  or built again round an edge it merged, was missing from the history
  and was taken for the operation's own. A second block joined flush against a
  first made all six faces the join's, the first block's far end too. The
  history now follows each face through the unifying (`unifyHistory` in
  `core/kernelOps.ts`, by a point inside the face), so the face keeps its
  maker, which a pick falls back on when a dimension moves it. A face
  merged from the body's and the tool's keeps the body's maker — the
  block's top stays the block's, for **Edit**, for `madeBy` and for a pick,
  whether or not something is joined flush with it — and is the step's
  own only when nothing the body had went into it.
- **Hints and the hovered sketch line follow the line width** (2026-10-12).
  The plane or axis a picker hovers, and the sketch line under the cursor,
  took the line-width setting and the canvas size as they were when drawn;
  they now change with them, as the sketch pieces do.
- **README** (2026-10-11): the browser checks list all of them, the kernel's
  download is given as 5 to 7 MB compressed, and what is still to come of
  the surface route says the Loft between sketches is there.

## 0.5.2 — 2026-10-11

- **The body list as an assembly's browser** (2026-10-11). Bodies sort
  into **components**: folders in the body list, one inside another, made
  by the label's Component key or a right click on a row, renamed by a
  double click, opened and closed by their fold, an eye for every body in
  them. A body or a component dragged onto a component goes into it,
  dropped on a row where that row is, on the strip under the list out to
  its head; a right click on a row offers the same moves, Hide others and
  a component of its own. Saved in the project (`bodyFolders`), one undo
  step each (`core/bodyFolders.ts`). The pointer on a body's row lights
  the body in the viewport — a see-through blue over everything, so a part
  inside another shows where it is, and its edges — a component's row
  every body in it; the cursor on a body in the viewport lights its row,
  or its closed component's (`BodyPicks.setLit`, `ReScene.onBodyHover`).
  A click on a body heads the readings by the click with the part it is
  on and its component, and **Hide**, **Hide others** — **Show all** once
  they are — and, for picks on several parts, **Make component**. The
  app's drop-a-file overlay no longer comes up for a drag that carries no
  file. **Several rows picked**: a click picks a row, Ctrl+click one more,
  Shift+click every row up to it (`listSelection`, `ListPick`); the
  bodies picked are lit in the viewport, dragged as one — a component's
  bodies go with it (`outermost`) — and the keys under the list move them
  (**Move** opens Move body on all of them; the panel's Move body key
  takes them too), make a component of them or hide the others; a right
  click on a picked row is for all of it, and Escape, a click on nothing
  or a plain click on the part lets them go. While a Move is open, a click
  on a row puts the body into it or takes it out — a component's row all
  of its bodies, Shift+click every row up to it — so a body under the
  gizmo, which takes a click on the part there, can still be added. Test:
  `reBodyFolders.test.ts`; browser check `e2e-reverse-body-tree.mjs` (in
  ci.json).
- **Import STEP** (2026-10-11). A STEP file comes in as bodies of its own —
  a bought-in part, a mating part, the CAD model to check the scan against:
  a body for every solid in the file, in the frame it was drawn in, named
  after its part where the file names it (a second of one name *Post (2)*).
  The Import box shows the file as a ghost first, and reads another file in
  its place when reopened. The file's text is kept by a digest of it — the
  store's `stepFiles`, the project's one archive member
  `reverse-steps.json`, the worker's copy handed over once — never in the
  feature, which every undo step and build request copies; the builder
  reads a file once and keeps its parts (`Builder.addStepFiles`,
  `ReKernel.readStepParts`). The kernel's reader hands over no colour of a
  part's faces, so the bodies wear the palette's. Agents:
  `reverse.import.step { path }`.
- **Move body** (2026-10-11). Bodies moved and turned, or copies of them
  (**Copy**): by a gizmo on the part — an arrow along X, Y and Z, a ring
  about each, in the axes' colours, the number on the grip — or by six
  numbers in the box, each a field the parameters may drive
  (`translate.x` … `rotate.z`). The turn is about X, then Y, then Z
  through the bodies' middle as picked, kept with the feature, the move
  after it (`core/move.ts`); the rings stand about the axes their own
  angles turn about, a gimbal's, so a ring dragged changes its one number.
  The ghost is the bodies' own meshes carried by the move's matrix, its
  edges with it — nothing built per frame — and the worker's preview,
  carried tessellation too, gives the live map the scan against the bodies
  where they are going. A move keeps every face, in order, so the faces
  keep their makers (`ReKernel.transformTracked`) and a feature picked on
  a moved body finds its pick when an earlier one changes; a copy's faces
  are the move's own. Chips on a face, an edge or a selection offer Move
  body. Agents: `reverse.feature.add { kind: "moveBody", bodies, translate,
  rotate, pivot?, copy? }`. The app's grips take a colour each and turn a
  ring by its shape rather than its name; the feature row takes a picture
  of the plugin's own. Tests: `tests/reImportMove.test.ts`,
  `tests/reCommandsImportMove.test.ts`; browser check
  `scripts/e2e-reverse-import-move.mjs` (in CI).

- **The scan the model has no surface for is told, not dropped**
  (2026-10-11). `reverse.body.compare` read the scan within reach of the
  bodies — ten ranges — and dropped the rest without a word, so a hole the
  model lacked, its wall 8 mm inside the solid, showed up as nothing but a
  lower share of the scan read, while every patch and face read clean. The
  answer now carries `far`: every vertex past the reach of every body,
  looked for again out to `far` mm (25 by default; 0 for none) and told
  by side — `inside`, the scan deeper in the bodies than the reach, where
  the bodies have material the part has not (a hole, a pocket or a slot
  not cut, a bore left blind); `outside`, the scan standing further off,
  where the part has what the bodies have not, or spray — each with its
  count and its patches (centre, box, area, extreme, the body and face
  nearest), the largest first, and the share of the scan both make. The
  live map against the bodies (the view bar's Deviation key) paints the
  vertices deep inside the bodies **violet** — no colour of the ramp, nor
  of the scan — and the legend counts them; the ghost's map does not, a
  ghost being one feature. `core/compareDetail.ts` (`FarReading`),
  `core/liveMap.ts` (`farInside`, `paintedSparse`). Tests: a body half as
  big again as the scan reads nothing within reach and its whole skin as
  one patch 10 mm inside; one half the size the same outside; `far: 0`
  gives none; past the far reach a vertex is outside with no body named;
  the live map names the vertex 2 mm in and paints it violet.
- **Compare in Deviation as a command** (2026-10-11).
  `reverse.body.compare_in_deviation { bodies? }` runs the panel's own
  action: the bodies to the Deviation workspace as its reference part,
  meshed to a 0.01 mm chord, the map measured at once in the scan's own
  frame with no best fit; the answer carries the map's statistics. The
  comparison to run after a build instead of exporting a STEP file,
  opening it with `deviation.open_reference` and best-fitting it — which
  hid the very offsets the comparison was for. The panel's React side
  lends the action to the commands (`installCompareInDeviation`,
  `app/reSession.ts`).
- **The bodies put away, the map staying** (2026-10-11). The view bar's
  new **Bodies** key, and `show: { bodies: false }` in `view.set` and
  `view.render`, put the bodies away as a whole and leave them in the
  model and in the map — the scan alone with the deviation map on it,
  which was not to be had: hiding every body took the bodies out of the
  map with them, and the map went bare. Each body's own eye still takes
  it out of the model and the map. `show: { map }` turns the bodies'
  deviation map on and off too. `bodiesHidden` in the store, drawing
  only; not saved. Shown again with every eye shut, the eyes open.
- **A cut that takes nothing out fails, saying so** (2026-10-11). A hole
  drilled beside the body, or a Combine whose tool stood clear of it or
  only touched its face, passed as ok and changed nothing — an extrude
  cut had refused that since the start ("The cut meets no body"). Both
  now fail: "The hole meets nothing of Extrude 1 — the cut took nothing
  out", the body as it was (`Builder.tookSomething`, by volume).
- **Sketches and planes listed to the last digit** (2026-10-11).
  `reverse.feature.list` and `reverse.plane.describe` are `exact`: the
  MCP server leaves their numbers unrounded (it shortens every other
  answer to six digits), because they are handed back — a sketch edited
  and returned, a plane's frame a sketch is laid on — and a coordinate a
  hair off leaves a face a hair off the face it was meant to share.

## 0.5.1 — 2026-10-10

- **Orbiting over bodies is smooth again** (2026-10-10). With nothing
  being edited the selection is armed, so every frame the cursor moved —
  an orbit's included — picked the bodies: a ray for the face under the
  cursor and one more for each edge or corner within reach to see whether
  it is hidden, each walking every triangle of every body (2.7 ms a ray on
  an 86 000-triangle body; on the browser test's 59 000-triangle disc a
  hover took up to 20 ms, and lit a face in 226 of 392 frames of a turn).
  The viewport now holds its hover back while a drag moves the view (see
  the app's changelog), and a body's mesh gets a BVH the first time a ray
  is cast at it — 0.003 ms a ray, built in about 25 ms — indirect, so its
  triangles keep the order the face hashes and the silhouettes go by
  (`withBoundsTree` in `viewer/bodyPicks.ts`). The orbit's pivot, picked
  on the bodies since 19b221e, is cast against the same trees; a preview
  is still tested triangle by triangle, being cast at once a turn. The
  faces behind, which the arrow keys step to, are still all found: the
  cast asks for every hit along the ray there and only the first
  elsewhere. Tests: `reBodyBvh` (300 rays through a rounded, bored block:
  every hit, and the first alone, as the plain raycast has them; the index
  buffer untouched), `e2e-reverse-cad`.

- **Rounds shade smooth** (2026-10-10). A fillet, a torus round or a
  chamfer about a curve was lit in a sawtooth along its length: the body's
  normals were the average of the facets about each node, which the
  kernel's uneven triangles along a round pulled up to 2° off on a fillet
  and 3° on a torus. They are now the surfaces' own, each face turned
  outward by its windings, the facets' average kept only where a surface
  has no normal of its own (a cone's tip, a sphere's pole) — within 0.02°
  on the same rounds (`surfaceNormals` in `core/kernel.ts`). The edges
  between a round and its flats no longer show a crease in the light
  either. Tests: `reKernel` (a bored, rounded block against its true
  normals).

- **Answers that cost an agent less** (2026-10-10). After an agent's
  session whose context grew from 127k to 395k tokens. On a scripted
  session — five parameters, three schemas, a sketch, an extrude, a
  describe, a round, three cuts stacked, a parameter set, the list, two
  fits and an alignment — the answers came to 114.8 kB, now 63.2 kB.
  - **Schemas with their shared parts once.** `reverse.feature.schema`
    hands a kind's schema out with each part it holds more than once — a
    plane, a face or an edge pick, the where query, a body, a point of a
    piece, the fields every piece and every relation has — given once
    under `$defs` and named by `$ref`: extrude 35.1 → 12.5 kB, sketch
    48.3 → 33.9 kB, draft 17.0 → 8.0 kB, fillet 11.2 → 6.7 kB. The command
    still holds its input to the whole shape (`withDefs` in
    `app/reSchemas.ts`).
  - **Parameters answer what changed.** `reverse.parameter.add`, `.set`
    and `.rename` answer the parameter and the others whose value followed
    it, not the whole table, which grew by 75 bytes a parameter on every
    call; `.remove` answers how many are left. `reverse.parameter.add
    { parameters: [...] }` adds several as one step, in order — a later one
    may read an earlier one — and none if one is refused.
  - **Less by default.** `reverse.section.stack` leaves each chain's lines
    and arcs out unless `pieces: true` (three cuts of a box 5.2 → 0.9 kB);
    `reverse.body.describe` leaves the fingerprints out unless
    `fingerprints: true` (a box 5.7 → 2.7 kB) — a pick by index needs none.
  - `reverse.feature.add` lists the items of `features` by their kind
    alone, the fields described once under `feature`; each is held to its
    kind when it runs, as before. Its definition 7.2 → 6.0 kB.
  Tests: `reCommands` (every kind's schema as handed out expands to its
  whole shape; parameters several at once), `reCommandsScan` (the stack
  and describe defaults).

- **Faster rebuilds, shorter answers, suppress, sweep, and the rest of the
  agent's third list** (2026-10-10). After an agent's third part, whose
  time went mostly into waiting for rebuilds and reading long answers.
  - **A build takes up where the last one left off.** The builder keeps
    its state after every step, for the build standing and the one before
    it, and a build whose first steps are a kept one's restores the state
    after them and plays only the rest: an appended feature costs its own
    step, an edit at the end the last step, the rollback bar moved up or
    down a look-up, and a body that came through unchanged is not meshed
    again. On a 43-feature tree with twelve rounds: an appended round
    1.39 s → 0.24 s, an edit of the last one 1.44 s → 0.24 s, removing it
    1.23 s → 0.03 s, the rollback bar moved down or back up (up to 1.32 s
    before) 0.03 s.
    Shapes are released once no kept build holds them (`core/build.ts`).
  - **Answers sized to the call.** `detail: "none"` on
    `reverse.feature.add` (with and without `after`), `.update`, `.remove`
    and `.sketch.edit`: the feature's id and status, the rollback bar and
    what failed, nothing else. `reverse.feature.list` answers rows by
    default (`detail: "full"` for every feature whole; one feature named
    is whole as before), and `reverse.feature.rollback` the bar and what
    failed — the rows and bodies with `detail: "full"`.
  - **Suppress.** A feature can be left out of the build and kept in the
    list, its picks and numbers as they were (`suppressed`, saved with the
    project): `reverse.feature.update { set: { suppressed } }`, and
    `reverse.feature.suppress { kinds: ["fillet", "chamfer"] }` for a draft
    of the part without its rounds — a look-up when they come last. In the
    panel a right click on a feature's row opens its menu: suppress it,
    every feature of its kind, or every round and chamfer; a suppressed row
    is greyed and struck through, a dash where the eye is.
  - **Edit below the rollback bar.** `reverse.feature.update` on a feature
    below the bar puts the bar just past it, edits it and puts the bar at
    the end, the rest built on the edit — one undo step, as an insert.
  - **Extrude along a direction.** `direction: [x, y, z]` on an extrude
    sweeps the profile askew of its plane — an oblique prism, a leaning
    boss on a level sketch — the extent counted along it and a taper
    leaning the sides about it; the Extrude box has a Direction field (the
    plane's normal, a measured line or axis, a coordinate axis, or typed).
  - **`reverse.plane.describe`** gives the frame a sketch on any plane takes
    — origin, normal, u and v, in numbers and in words — before a sketch is
    made.
  - **Edges by the faces either side:** `{ faces: [3, 7] }` in an edge
    query, the faces by their index in `reverse.body.describe`; one face
    for the edges round it.
  - **Ends that miss each other:** a sketch that closes no region names
    the ends of its outline that meet nothing, the end nearest each and the
    gap (`open`).
  - **Sweep:** a new feature, a sketch's largest region swept along another
    sketch's chain of lines and arcs — a bent bar, a handle, a rim that
    follows a curve — its section square to the path, refused with the
    angle when the profile's plane is not. A key and a box in the panel,
    `{ kind: "sweep", profile, path }` through the commands.
  - **A round at a varying radius:** `{ edge, radius: [start, end] }` among
    a fillet's edges rounds that edge from one radius at its first end to
    the other at its last, beside the edges at the fillet's own radius.
  - **`reverse.feature.clear`** takes every feature out in one undo step;
    **`within: { min, max }`** on `reverse.body.compare` reads one region of
    the scan — one side of a part against the other in two calls.

- **The commands say what they take** (2026-10-10). `reverse.feature.update`'s
  `set` names what each kind can change — a boolean's body and tool among
  them — and `reverse.feature.add`'s `feature` names every kind, draft,
  mirror and boolean included, not the eight usual ones. An agent had
  removed and re-added a boolean to re-point it, and cut a full extrusion
  in half rather than draft chosen faces, because neither was in the list
  it read.

- **The feature list played back** (2026-10-10). For showing how a part
  was built — a video, a post. **Play** in the feature list's heading puts
  the rollback bar at the top and moves it down a feature at a time, each
  step held once its build has landed (Hold, 0.5 to 5 s, remembered), until
  the part stands whole and the bar is back where it stood. The step's row
  is lit and kept in sight, the rows still to come read "to come", and a
  sketch is drawn at its step though the extrude that used it hid it — the
  profile shows, then the body made of it. A caption in the viewport's top
  left names the step: Step 4 / 6, the feature's picture and name, and what
  it did (on XY plane, New body · 8 mm, Join · 10 mm, R 2 mm); it can be
  switched off. **Skip sketches**, beside it, shows only the steps that
  change the geometry: a profile goes straight to the body made of it, the
  arrows step over the sketches as well, and the caption counts the steps
  shown (Step 1 / 3). The keys under the heading hold it, step it either way and
  stop it; Space, ← → and Escape do the same. A playback is neither an undo
  step nor a change to the file — the project saves the bar where it stood
  — the undo keys wait while it runs, and so do the agent's commands; an
  editor opened, a feature deleted, an undo or another project ends it
  where it stands. `app/playback.ts`, `ui/Playback.tsx`; the rows' readings
  moved to `ui/featureReading.ts` for the caption to share.

- **The orbit pivots on the bodies** (2026-10-10). A turn of the camera
  pivoted on the scan alone: with the scan put away, or a body drawn in
  front of it, the pivot stayed where the last turn over the scan had left
  it. It now pivots on whichever of the scan and the bodies is under the
  cursor, and on a feature's preview where it stands in for a body.

- **Design intent as evidence, the audit of a body, projection through the
  commands, faces by radius** (2026-10-10). After the agent's own list of
  what would make reverse engineering easier — and the question whether
  the app should decide what a measured 89.7° was meant to be. It should
  not: it hands over the evidence, and the agent, with the part in mind,
  decides.
  - `reverse.section.fit` carries each piece's evidence: `residual` (how
    it sits on its scan points — rms and the worst miss), `sigma` (the
    fit's own uncertainty, from the normal equations of its least squares:
    a line's direction and its place across itself, a round piece's radius
    and centre — tight on a long side, loose on a stub or a short arc) and
    `nominal` (a line's length and angle, a round piece's radius, each
    beside the round value a designer would have drawn, with how far off
    it is and in how many sigmas). With them each chain's `candidates`:
    every relation the pieces come within a wide net of — level, upright,
    parallel, perpendicular, in line, a round angle, equal, concentric,
    tangent, on a coordinate plane, mirror images across one — with how
    far off, the sigma of that figure and the ratio (under about two,
    within the scan's noise), nearest the mark first, each with the
    constraint ready to add; a pair an axis relation on both pieces says
    already is left out. `net` widens or narrows the net, `candidates:
    false` leaves them out. `core/intent.ts`.
  - `reverse.sketch.candidates` reads a sketch the same way — a fitted one
    with its points, a drawn one by the figures alone — leaving out the
    relations it holds. Taking one is `reverse.sketch.edit { add: {
    constraints } }`, and that answer says what it cost: `solve.fit`, how
    the fitted pieces sit on their points after the solve (on every
    sketch answer now), and `moved`, which pieces moved and how far.
  - `reverse.body.check` looks the topology over (`audit`, on by default)
    for what a scan's noise leaves in a sound body: `kinks` (two faces
    meeting at under `kinkDeg` but not flush — a round not tangent to its
    neighbour, a crease), `steps` (two flat faces facing one way within
    `stepMm` but not in one plane — the small steps the agent was asked to
    avoid), `nearParallel` and `nearAxis` (within `parallelDeg` of each
    other or of a coordinate axis, but off it) and `shortEdges`. Each
    names where, the figure, the faces and edges by index with the feature
    that made each face and — for an extrude's or a revolve's face — the
    sketch piece behind it (`trace`), and a `repair`: "line 2 of Sketch 1
    leans 0.29° — a vertical relation on it". `clean` and `warnings` sum
    it up; the thresholds are nets, not verdicts. `core/audit.ts`, read off
    the topology a build carries, no kernel call.
  - A sketch's `project` (in `reverse.feature.add` and
    `reverse.sketch.edit`): a body's edge (or every edge a query names),
    the outline of a body's face, or another sketch's pieces, brought in
    as the Project tool brings them — fixed where the part puts them,
    following their source on every rebuild — the ids after the fitted
    pieces, the answer listing them (`projected`) and counting what lay at
    a slant (`skipped`). A sketch on a body's face does not draw the
    face's outline by itself; `project: [{ body, face }]` does.
  - `reverse.body.describe`'s query — and so every pick by a query — takes
    `radius` or `diameter` within `sizeWithin`; `sort: "largest" |
    "smallest"` orders the faces by area and the edges by length, so with
    `limit` the mounting face or the longest edge is one call.
  - Tests: `reIntent` (a long side's direction known far better than a
    stub's, a full circle's radius better than a short arc's; the round
    figures; level, upright, parallel, perpendicular, in line, a chamfer's
    45°, tangent, concentric, equal, on a plane and mirrored, with what is
    held left out, the net and the cap), `reAudit` (a tilted top, walls
    off parallel, a 0.05 mm step, a kink at a boss, a short edge; the
    trace to a wall's line, a cap's end and a bore's circle),
    `reCommandsScan` (the box's section with its evidence and candidates;
    a leaning sketch read, the relation taken and its cost; a stepped
    body's step and short edges, a leaning wall traced to its line; a
    face's outline, an edge by a query and another sketch's piece
    projected; faces by radius and the largest first).

- **Patches, picks by a query, a feature inserted, a stack of slices and a
  thread read off the scan** (2026-10-10). After an agent's second part,
  what cost it the most calls:
  - `reverse.body.compare` gives `patches`: the scan over tolerance (± the
    range, or `tolerance`) gathered into connected regions (the app's
    `core/deviation/hotspots`), each kept to one face of one body — the
    face is part of what joins two vertices — the largest and farthest
    first, with its centre and box (what `view.render { frame }` and
    `scan.query { box }` take), area, count, mean, extreme and side, the
    point and scan vertex of the extreme, a few of its vertices, and the
    face with the feature that made it. `patchesFound` and `over` say how
    much there was in all. The worker gathers them with the readings, so
    the comparison runs once.
  - A face or an edge pick takes a query — the `where` of
    `reverse.body.describe` — in place of an index: `edges: [{ between:
    [[0, 0, 1]] }]` rounds every edge round the top, `faces: [{ kind:
    "plane", between: [[0, 1, 0]] }]` opens that side of a shell; a pick
    that wants one face (a hole's, a thread's) takes a query one face
    answers. The feature stores the fingerprints it found, as before, and
    the answer lists the edges taken; a query that names nothing is refused
    with what to look at. The pick's schema stays within the client's
    budget where it is listed whole (a sketch plane, a hole's face); the
    thread reader lists its face loosely and checks it when it runs.
  - `reverse.feature.add { after }` inserts a feature right after another:
    the bar put under it, the part built as it stood there — a pick by
    index names the body as it was — the feature added, the bar put back,
    the features below rebuilt on it. One undo step; the answer says
    `insertedAfter`, the bar, and the bodies as they stand at the end.
  - `reverse.section.stack`: the scan cut at several offsets of one plane
    in one call, no section kept — each cut's chains summed up (closed,
    centre on the sheet and in the world, area, box and size, a circle's
    centre and radius) and fitted to lines and arcs as `section.fit` fits
    them; `within` keeps the chains in a box, the one pocket; `tracks`
    follows each chain through the offsets by its centre and gives the
    trend — the centre's drift per mm as a tilt and the axis's direction,
    the width's and height's growth as a draft angle per side, a circle's
    radius per mm as a taper, and from four offsets the radius of a round
    the width fits, beside the straight line's rms.
  - `reverse.thread.read`: a thread read off the scan along a cylinder
    element, a round face of a body or an axis given — the scan's points
    in a band about the radius, their radius laid out along the axis in
    twelve sectors round it (at one height the radius runs through a whole
    tooth round the turn, so a profile over all angles would be flat), and
    in the sectors' summed autocorrelation the pitch as the first strong
    peak; the crests and the root as the 5th and 95th percentile of the
    radius (minor, major, depth); a bore or a boss from the normals; the
    hand from which helix the crests' and the root's phases agree on; the
    standard sizes nearest (a bore matched on its minor, a boss on its
    major) and the one near enough to suggest; along a face, the thread
    feature ready to add. `core/threadRead.ts`. A plain bore reads no
    pitch.
  - **A round that fails says what fails.** The diagnosis probed the
    picked edges one at a time — and the kernel rounds a tangent chain as
    one, an edge picked alone taking the edges tangent to it with it, so
    every probe rounded the whole chain and every edge was blamed ("none
    of the 17 edges round"). It probes the chains now, each once, says
    which chain and that the kernel rounds it as one, the largest size it
    takes, and names the faces beside it too small for the round — a
    sliver a boolean left, a wall shorter than the radius — with their area
    and where they are, the likely reason.
  - Tests: `reCommandsScan` (the narrowed box's sides as two patches, each
    on its face; edges and faces by a query, the refusals; a chamfer
    inserted after the extrude under a fillet, undone as one; a chain of
    three named, a sharp edge alone, a 1 mm² wall named beside an edge; a
    box sliced at three heights and a cone's taper read off five; an M6×1
    read in a block's bore along an axis and along the modelled hole's
    face, the thread added from the answer), `reThreadRead` (an M6×1 bore,
    a left-hand 1/4-20 boss, a plain cylinder, a tilted axis).

- **The comparison works, and says where** (2026-10-09).
  `reverse.body.compare` crashed on every scan of any size — "Maximum call
  stack size exceeded": its largest reading each way was taken by spreading
  the whole field into `Math.max`, which a few hundred thousand vertices
  overflow. It is read in a loop now, and the answer goes on to say where
  the scan lies off the bodies: `worst`, the spots the scan lies farthest
  from the bodies, each with where it is, the deviation, the body and the
  nearest face by its index, its kind and the feature that made it, no two
  within a reach of each other; `faces`, each face read against with how
  many vertices lay nearest it, how many within the range, their mean, RMS
  and extremes, the worst first; `byFeature`, the same gathered by the
  feature that made the faces. The kernel worker reads which face of which
  body each scan vertex lies nearest as it reads the distance
  (`core/compareDetail.ts`), so the grouping costs no second pass. Without
  a viewport the scan goes to the kernel from the mesh worker, so the
  comparison runs headless too. Tests: `reCommandsScan` (the scan's own box
  modelled reads zero everywhere; a box two millimetres narrower reads a
  millimetre outside its sides, the worst spots on them, the faces and the
  feature named).

- **The outline fitted for the agent** (2026-10-09). `reverse.section.fit`
  cuts a section's chains into the lines and arcs they are — as Fit all
  chains cuts them — without making a sketch: each piece with its ends,
  length and angle (and how far a line leans off the sheet's axes, a draft
  angle), an arc's centre, radius and sweep, each also in the world. A
  sketch takes `fit` beside its pieces: the scan's outline on its plane —
  a section's chains, or the scan cut at the plane, a hair inside a face —
  fitted first, its pieces from id 1 with their slice points behind them,
  what is drawn on top of it going on after; `reverse.sketch.edit` takes
  `fit` in `add` too. The answer's `fitted` lists each chain's pieces by id
  and kind. Tests: `reCommandsScan` (a section's ring as four lines of 40
  mm along the axes; a sketch fitted to the section extruded to the scan's
  own volume, a circle drawn on top of the fit, a sketch on a coordinate
  plane fitted to the scan cut there, the outline fitted onto a sketch that
  was there).

- **Editing above the bar, and on a body a later join took in**
  (2026-10-09). Editing a feature on a body that a later feature had
  taken into another failed with "There is no body 10": the body was
  looked up among the bodies as they stand at the end. The feature's own
  body is taken as it stood before the feature now — the build keeps it —
  so a feature further up the list is edited by index too, and
  `reverse.body.describe { before }` lists a body as it stood before a
  feature, which is what that feature's picks by index name. Tests:
  `reCommandsScan` (a chamfer on a body joined into another since, its
  distance changed and its edge moved by index; the body described as the
  chamfer saw it).

- **Edges by a query, and a round says which it took** (2026-10-09).
  `reverse.body.describe` takes `where`: a box, a point and a radius, a
  kind, the outward normals of the faces either side of an edge — one for
  the edges round the top, two for the one edge where an arm meets a plate
  — the feature that made it, a size; `limit` caps the lists and
  `fingerprints: false` leaves the fingerprints out, which makes the
  answer short. A fillet's and a chamfer's result lists the edges it took
  (`edges`: where each ran, how long, a circle's radius) — the ones picked
  and, with chain, the ones tangent to them. Tests: `reCommandsScan` (the
  four edges round a box's top, the one between the top and a side, by
  distance, in a box, by length, by maker; a round on one edge lists it,
  the chain round a sharp top is the one edge).

- **Where a shell does not fit** (2026-10-09). A shell that failed with
  no round to blame said only "somewhere the body is thinner than two
  walls". The body's thinnest places are probed now, down its mesh's
  normals to the far wall, and the message names them — "(x, y, z), 1.5 mm
  thick" — and marks them red on the part. Tests: `reCommandsScan` (a 1.5
  mm plate shelled to a 1 mm wall).

- **A body checked, and the bodies as STL** (2026-10-09).
  `reverse.body.check` looks a body over for what will trouble the next
  feature or the export: the kernel's own check, whether it is one closed
  solid, its volume and area, the faces under an area — the slivers a
  boolean leaves — by index with where they are and who made them, and
  the faces the mesher drew nothing for; `ok` and `problems` say it in
  words. `reverse.export.stl` writes the bodies as one binary STL to a
  chord, for printing or a mesh tool. Tests: `reCommandsScan` (a box
  passes; held to an area no face reaches, all six are listed; the box as
  twelve triangles of STL).

- **Slots, rounded rectangles, several features in one call, a short
  rollback** (2026-10-09). A sketch's shapes take a `slot` (two sides and
  a half-round at each end, tangent and equal) and a rectangle a `radius`
  (its corners rounded as the sketch's own Round rounds them, each round
  dimensioned). `reverse.feature.add` takes `features`, several in order,
  each built before the next so a later one may name what an earlier one
  made, the first refused stopping the rest and the answer saying which.
  `reverse.feature.rollback` answered with the whole feature list, every
  sketch's pieces included; it answers with the bar, the features' rows
  and the bodies by name. Tests: `reCommandsScan` (a slot's and a turned
  slot's area, a rounded rectangle's, a radius that does not fit refused;
  a sketch and its extrude in one call, a batch stopped at a sketch that
  is not there; the rollback's answer).

- **What a picture shows** (2026-10-09). While the workspace is on screen,
  `view.render` and `view.set` take `scan` through the view bar's own key
  — the bodies turn solid as the scan goes — and `bodies`, every body
  shown or put away: `{ scan: false }` pictures the bodies on their own.
  Tests: `reCommandsScan` (the toggles offered, the scan put away through
  the store).

- **Edit from a face, and no thread on a fillet** (2026-10-09). A face
  clicked on the part offers **Edit** with the name of the feature that
  made it — *Edit Fillet 2*, *Edit Extrude 1* — and opens it as its row's
  pencil does. A round face that stops short of a full turn — a fillet's, a
  boss cut in half — no longer offers Thread, Move face or Snap to scan,
  which all need the whole way round and failed on it; Hole stays, for a
  half-round notch. The kernel says whether a round face goes all the way
  round as it reads the face, and the Thread and Move face boxes refuse such
  a face when it is clicked, Move face saying why. Tests: `reTopo` (a bore
  and a fillet told apart, the fillet named its face's maker),
  `reFeatureDraft`, `reThread`.

## 0.5.0 — 2026-10-09

- **Answers sized to what changed, sketches the short way, and
  `sketch.edit`** (2026-10-09). A change through the commands answers with
  what it changed — the feature's row, a sketch's regions as a point inside
  each, and the bodies it made, changed or took away (`bodies: { count,
  changed, removed }`) — where it answered with the feature as stored and
  every body: a part of forty-eight bodies had grown every answer to 55 kB.
  `detail: "full"` gives the old answer. A sketch takes **shapes** —
  `rectangle` (two corners, or a centre and a size, turned if asked),
  `polygon` and `polyline` — drawn as the panel's tools draw them, their
  pieces taking ids in a run from the shape's own; **patterns** of its
  pieces; and **infers** what a drawing would have — a coincidence where
  ends meet, level and upright lines held so — on by default, so no
  coincidence needs writing out: a closed region never needed one, only the
  description said so. `reverse.sketch.edit` adds pieces, shapes, relations
  and patterns to a sketch, or takes them out by id, without the whole
  sketch handed back. The answers say where free ids start, and a refused
  id says why (pieces and relations share one run). The worked sketch
  example uses a rectangle shape; `body.set`, `body.clearance` and the
  offset body below are commands too. Tests: `reCommands` (a board of
  shapes and patterns, edited piece by piece; brief answers a third the
  size of full ones).

- **Body names and colours, in the STEP file** (2026-10-09). A body is named
  by a double click on its row — the name it has in a STEP file — and
  coloured by its dot, from swatches: a board's greens and blues, the metals,
  the plain colours; **Auto** takes it back. One undo step each, saved with
  the project, and `reverse.body.set` for an agent. **Export body STEP**
  writes each body as a part of its own under its name and in its colour,
  where it wrote one unnamed compound — CAD listed the parts as Solid 1 to
  48. The kernel takes a colour as linear RGB and writes it as sRGB; it is
  handed the colour converted, so the file holds the swatch's own. Tests:
  `reBodyTools` (the parts' names and colours as the file holds them),
  `reCommands` (named, coloured, exported, saved, undone).

- **Polygon, Equal, and the sketch Pattern** (2026-10-09). A **Polygon**
  tool: a regular polygon of the sides set under the keys, from its centre
  and a corner (inscribed) or the middle of a side (circumscribed, sized
  across flats as a hex nut is) — its corners on a construction circle, its
  sides equal, fully defined by the circle's centre and radius and one turn,
  with nothing held twice. (Every side tangent to the circle, the obvious
  way, is singular where it is met, and leaves a polygon of an even count of
  sides free to lean into alternating angles.) An **Equal** relation: two
  lines of one length, two round pieces of one radius. **Pattern** on the
  selected pieces: a row, a grid, or round a centre, drawn on the sheet as
  the copies would land; each copy keeps the relations and dimensions the
  pieces have among themselves, its dimensions reading the same
  expressions. The new keys' pictures are the workspace's own
  (`ui/reIcons.tsx`). Tests: `reSketchShapes` (Equal; polygons of 3, 5, 6
  and 8 sides fully defined both ways, none redundant; a grid and a round
  pattern; inferred joins).

- **A sketch plane at an offset, by an expression** (2026-10-09). The
  coordinate plane a sketch lies on is placed at a number or an expression
  over the parameters — the sketch follows the parameter — and a sketch on
  a body's face, a measured plane or a section stands off it by an offset,
  following the face when an earlier feature moves it. The sketch box has
  the field under the plane's name. Tests: `reCommands` (a lid on a
  parameter's plane, a boss off its face, both following the parameter),
  `reParameters`.

- **Patterns in a grid, Offset body, Clearance** (2026-10-09). A linear
  **Pattern** repeats its row along a second direction — a grid of
  standoffs, a field of keys. **Offset body** grows a body all round by a
  distance, or shrinks it, kept as it was beside the offset — a keep-out
  round a bought-in part, which Combine's Cut (tool kept) turns into the
  pocket that holds it with its clearance — or replaced by it; an offset
  the kernel breaks up is refused rather than built. **Clearance** in the
  chips of picks on two bodies, and `reverse.body.clearance`: how far apart
  two bodies stand at the closest, or the volume they share. Tests:
  `reBodyTools` (a grid; a box grown to its Minkowski volume and shrunk; a
  case with a part's pocket cut 0.5 mm clear; gaps and overlaps),
  `reCommands`.

- **Hole for a heat-set insert** (2026-10-09). A Hole drills into a flat
  face at its centre — a standoff's top — blind, into the body alone, as
  well as along a round face or an element. Its **Insert** list sizes it
  for CNC Kitchen's heat-set inserts, M2 to M8 and ¼"-20: the hole's
  diameter, a millimetre deeper than the insert is long, and the wall to
  leave round it. Tests: `reBodyTools`, `reCommands`.

- **A picture under the sketch** (2026-10-09). **Picture…** in the sketch
  box lays a photo of the part or a page of its drawing under the sketch,
  on the part's plane, to trace: brought to scale by two points on it a
  known length apart, moved by a point of it and where that belongs (the
  second click snaps), levelled by two points that should lie level, and
  faded. It is saved with the sketch, scaled down to 2,400 px, and shown
  while the sketch is drawn with the model shown. Tests: `reSketchImage`.

- **An agent can model in the workspace** (2026-10-09). The workspace's
  commands, under `reverse.`, for an AI agent connected through
  scanruler-mcp: the parameters (list, add, set, rename, remove); the
  feature list (list, add, update, remove, rollback) with every feature
  kind in the JSON the list stores — a sketch written out as pieces,
  relations and dimensions, the dimensions as expressions over the
  parameters; an extrude, a revolve or a coil; a thread by its size (ISO
  metric, UNC, UNF); and the rest; `build`, with every feature's result
  and why one failed; a body's faces and edges with their fingerprints
  (`body.describe`), what a pick names; the scan's deviation from the
  bodies (`body.compare`); and the bodies as STEP. `feature.add` lists a
  feature loosely — its kind, its fields open — and holds it to the kind's
  whole shape when it runs; `feature.schema` hands out that shape, kind by
  kind, with a worked example: listed in full, every kind and every sketch
  relation at once, the shape was 82 kB, and Claude Desktop would not take
  the tool. Each runs the panel's
  own code: the feature's box opened, filled and committed as one step of
  the undo history (*Agent: add thread*), the build awaited, the store read
  back; refused while the panel holds work, or the kernel loads or builds,
  and no box left open. The workspace's part of the session readout gives
  the kernel, the build, the parameters with their values, the features
  with their status and the bodies with their bounding boxes. Underneath,
  the kernel, the build and the body meshes moved out of the panel's hook
  into the workspace's session (`app/reSession.ts`), which the hook and the
  commands share; the kernel worker's work is a service of its own
  (`core/reService.ts`) that runs in a test's own thread too
  (`core/reLocal.ts`); the store takes a written sketch whole (`setSketch`);
  a thread face's reading (`threadFaceReading`) and the project file's
  feature check (`validateFeatureJson`) were lifted out for the commands to
  share. Tests: `reCommands` (an M3 pin through the commands: a parameter,
  the sketch dimensioned by it, the revolve, the thread; the parameter set
  to 20 and the part 8 mm longer; undone; the refusals, the edits, the
  rollback bar); the browser check `e2e-agent-reverse` (the same through a
  real MCP client and the server, with the panel's tree, a picture of the
  view and the STEP file, every tool's schema within the budget a client
  takes), now in `ci.json`.

- **Straight to modelling** (2026-10-09). With no scan loaded the workspace
  opens on the blank stage at once, as plain CAD — the front door and its
  *Model without a scan* key are gone; a scan is loaded from the panel's
  Scan slot or dropped on the stage, and joins the model as before. The
  **First project** guide with its sample part is removed from the panel.
  The sample bracket's end-to-end walk is now
  `scripts/e2e-reverse-sample.mjs`, loading the bracket through the Scan
  slot.

- **Parameters and expressions** (2026-10-08). A **Parameters** section at
  the head of the panel: named numbers for the whole model — a length, an
  angle, an integer or a plain number — each given as an expression that
  may read the others (`height = width / 2`). Every number field in the
  workspace takes an expression too: the boxes' fields, a sketch
  dimension's row and its number on the sheet, the field on a grip — with
  `+ - * / ^`, parentheses, the trigonometric functions in degrees, `sqrt
  abs min max floor ceil round pow`, `pi`, and units on a number (`1 in`,
  `2 cm`, `30 deg`). The expression stays in the field with the value it
  comes to beside it, and a parameter by name drives the number: change
  the parameter and every feature and sketch dimension that reads it
  follows, the sketches solved again and the features on them keeping
  their profiles, and the part is built again — one undo step for the
  parameter and the numbers together. Kinds are checked (a length and an
  angle cannot be added; a length times a length is an area no field
  wants; an integer must come out whole) and a field or a row that cannot
  read its text says why under it, the number standing. A plain number
  typed over a bound field, or its grip dragged, lets the parameter go;
  a rename is written through every expression; a parameter still read
  cannot be removed, the row naming its readers. The parameters are saved
  with the project, the expressions inside the features beside the numbers
  they last came to, so an older build still opens every number. A
  dimension driven by an expression wears an ƒ on the sheet, and a
  feature's row tooltip reads its expressions. Tests: `reExpression`,
  `reParameters`, `reParameterStore`, `reProjectFile`;
  `e2e-reverse-parameters`.

- **Thread: a modeled screw thread on a round face** (2026-10-08). A new
  feature on a body, as Fusion's Thread: click a round face — or take the
  **Thread** chip on one — and it is threaded, a bolt's thread on a boss
  and a nut's in a bore, the side read off the face. **ISO metric** (coarse
  and fine, M1 to M64), **UNC** and **UNF** sizes, the size the face carries
  taken as it is clicked — a boss's major diameter, a bore's tap drill —
  until one is chosen; or a **diameter** and **pitch** typed, cut whatever
  the tables say. **Right or left hand**; the whole face (**Full length**)
  or a **length** from a **start** in from either end. The profile is the
  standards' basic 60° one (ISO 68-1, ASME B1.1), flat at the crest and
  the root. **Offset** is a clearance for printing: every face of the
  thread — flanks, crest, root — moved into the material by it. Past about
  a tenth of the pitch the crest comes to a point, and from √3/8 of the
  pitch, where the tooth has nothing left at the pitch diameter, it is
  refused. A thread runs out past a free end and stops at a shoulder or a
  bore's floor; a boss wider than the thread is cut down to it and a bore
  narrower than its minor diameter bored out, the row saying so. **Chamfer
  the free ends** adds the 45° lead-in that is a pain to model after the
  fact: a cone across the thread at every end where it comes out of the
  body free — a bolt's tip, both mouths of a through bore, not a shoulder
  or a bore's floor — from a tenth of the pitch past the root out through
  the crests, cut before the thread so the thread runs into it. Built as
  a band round the face less the tooth screwed along it: the tooth is swept
  along a helix of one edge a turn, as booleans on one long helical face
  failed past a dozen turns, and on a left-handed one for some sections at
  any length (the revolve's **Coil** keeps its face a side; `screw` takes
  the turn-by-turn helix on request). Tests: `reThread`.

- **No edges showing through the top of a body** (2026-10-08). The edges
  were drawn a little nearer the camera than they lie (up to 0.2 mm), so
  a round's rim would not break into dashes, and that let the hidden edges
  just behind a rim show through it: the walls of a Torx recess left short
  ticks on the head's top face beside the opening. The edges are now drawn
  along the outlines of the faces' own triangles rather than the kernel's
  separate samples of them, which lie on the surface all along, and are
  not lifted at all; a preview standing in for a body is outlined the same
  way, and the worker no longer samples a preview's edges. A body's edges
  at rest are one draw rather than one per edge. Tests: `reEdgeLines`;
  `e2e-reverse-cad`.

- **A sketch closed with nothing changed does not rebuild the part**
  (2026-10-08). Opening a sketch (or any feature) rolls the part back to
  before it; Finish or Cancel with nothing done then rebuilt every
  feature. The worker now keeps the build before the one standing, shapes,
  meshes and all, and a build asked for again — the same steps and
  sketches — is handed back at once; Finish on an untouched sketch leaves
  the feature as it was, unsolved again and with no undo step. Opening the
  same sketch again, and undoing or redoing the last change, are instant
  too. The scan changing under the bodies drops what is kept. Tests:
  `reBuildReuse`, `reStore`.

- **A revolve with a pitch: coils and threads** (2026-10-08). The revolve
  box has a **Coil** switch: ticked, the profile climbs along the axis as
  it turns — a spring, a thread, a worm — and the angle runs on past 360°,
  for as many turns as asked. The box takes the **pitch** (how far each
  turn climbs), the **turns** and the **height** — any one of them typed
  sets the angle — a **Left-handed** switch, and **Reverse direction**,
  which climbs the other way along the axis (a negative pitch does the
  same); the ring about the axis winds on round and round. A coil starts
  with a pitch half again as long as the profile reaches along the axis,
  and three turns. It is a sweep along a helix with the section held to
  the axis — exact, one face per side of the section however many turns,
  a hole in the profile a hole the whole way along. A profile reaching as
  far along the axis as the pitch would run into its next turn, and one
  touching or crossing the axis has no helix to follow: both are refused,
  saying so. A thread is a groove's section drawn on a plane through the
  bar's axis, reaching a little past the bar, coiled with Result Cut. The
  feature is named Coil 1, 2…; Snap to scan moves a coil's faces on the
  body, none of them being a shoulder or a cylinder. A plain revolve still
  turns a full turn at most, however the angle is given. Tests: `reCoil`,
  `rePreview`, `reStore`; `e2e-coil-taper`.

- **An extrude's taper, as Fusion has it** (2026-10-08). The extrude
  box's Draft field is now **Taper**, with Fusion's sign: positive leans
  the sides out as the body goes away from the sketch, negative leans them
  in — a moulded boss's draft. An **arrow on the far edge** of the ghost
  drags it: pull it out and the sides lean out, its field reading the
  angle. The feature keeps a draft as before, positive leaning in, so a
  saved project's numbers stand — but the old draft leaned from the wrong
  end where the extent did not start at the sketch: it put the profile at
  the lower end of the extent, so an extrude reaching back from its sketch
  had the sketch's outline at its far end, a symmetric one or one reaching
  both ways leaned one way through the sketch plane, and one to a plane or
  a face leaned over the extrude's whole far reach and could close on the
  way. Now the sketch's outline is the section at the sketch plane — or at
  the end of the extent nearest it — an extent reaching both ways leans
  both ways from the plane, and an end on a plane or a face is reached by a
  prism just long enough, leaning all the way to it. Such an extrude saved
  with a draft is built the new way. A taper that would close the profile,
  or a hole or a notch of it, before the far end is refused, saying how far
  it gets — the kernel handed back a solid that crossed itself, an
  hourglass past a cone's tip, and called it valid. Tests: `reTaper`,
  `rePreview`, `reStore`; `e2e-coil-taper`.

## 0.4.6 — 2026-10-06

- **A projection follows the part** (2026-10-04). A piece projected into
  a sketch — the outline a sketch on a face opens with, an edge or a
  piece of another sketch brought in with Project — was taken once and
  left where it landed: the fridge bracket's ears, drawn on the floor of
  the shelled tray against its projected walls, stood a gap off the walls
  once the shell was made thinner. A projected piece now keeps what it
  was taken from — the edge by its fingerprint, the other sketch's piece
  by its id — and every build takes it again there, where the sketch
  stands in the list, before the features on the sketch are built: where
  it moved, the sketch is solved again and the pieces joined or
  dimensioned to it follow, the ears against the walls at any thickness.
  The sketch is kept as solved, with no undo step and no second build.
  An edge the build no longer finds leaves its piece where it was, and
  the sketch's row says so. A face's outline projected before this is
  given its edges by the first build that finds them where it lies — a
  part whose edges have moved off it since is put back first (Ctrl+Z, or
  the old value typed again), built once, and then changed; other
  projections made before this stay as they are until projected again. A
  sketch on a face is now placed — the face found again — once, where it
  stands in the list, rather than by each feature on it; the note when
  the face is lost is on the sketch's row. Tests: `reBuild`, `reProject`,
  `reTopo`, `reFeatures`, `reStore`; `e2e-sketch-project`.

- **An end snaps to a projected edge where the scan runs beside it**
  (2026-10-04). On a sketch on a face, the slice of the scan runs a hair
  off the face's projected outline, and a point of the slice was taken
  before the edge: an end put on the edge landed on the scan instead and
  was held to nothing. The body of a drawn or a projected piece now comes
  before the slice, and an end put on it is held on it, as on any piece;
  a piece fitted to the slice still lies among its own points, which come
  first beside it. Tests: `reSnap`; `e2e-sketch-project`.

- **A shell no longer breaks the body it fails on** (2026-10-04). The
  kernel's thick solid, failing, left the body it was given invalid, and
  the offset-and-cut it falls back to then failed on that body too; so
  did the diagnosis, which reported that no wall fitted even with nothing
  opened, and the body showed as not closed. The fridge bracket, rounded
  all over and opened at its bottom, its back and the 5 mm round between
  them, did not shell at 1 mm for it. Every attempt now works on a copy
  of the body. The thick solid also handed some bodies back untouched and
  called them shelled (the bracket with its back opened alone, at any
  wall up to 1.35 mm): a shell that weighs more than the closed hollow is
  now refused and made the long way instead. And an inward offset that
  breaks up (a face narrower than the wall, the strip of bottom under the
  bracket's plate past 1.37 mm) is caught rather than cut with; the shell
  fails, saying "or a face of it narrower than one" and the wall that
  fits. Tests: `reBuild`.

- **Bodies are drawn finer** (2026-10-03). The viewport meshes a body
  with at most about 9° between neighbouring facets, where it allowed
  20°: a 90° fillet is eleven strips instead of five, and no longer
  looks faceted close up. The chord tolerance, 0.05 % of the body's
  size, is capped at 0.05 mm instead of 0.1. A filleted 60 × 40 × 20 mm
  block comes out at about 8,400 triangles instead of 3,100, meshed in
  under 30 ms. The meshes for Compare in Deviation and for a boolean in
  Mesh Tools are made apart, at a 0.01 mm chord, and are unchanged.

- **The coordinate planes stand at the origin** (2026-10-03). The XY, XZ
  and YZ planes are drawn at the origin in their axes' colours, and listed
  at the head of the body list, each with an eye of its own. On a blank
  stage — Model without a scan — they are up from the start; over a scan
  they are put away until an eye brings them up. A click on one in the
  viewport selects it, named and lit, and its chips offer Sketch on it or
  Hide it. They stand behind the bodies, size with the stage and go away
  while a sketch is open. The eyes are not saved, as the bodies' are not.
  Tests: `reStore`; `e2e-reverse-blank`.

- **Move face is a feature in the list** (2026-10-03). A moved face —
  from the Move face key, its chip or Snap to scan — is a Move face row
  in the feature list. It used to change what made the face wherever it
  could, adding nothing: the extrude's distance, or the sketch line under
  a wall, so a wall pushed into a block drawn in the same sketch ran the
  two profiles into each other, and the overlap, a region no extrude had
  picked, came out as a hole through both. Changing what made the face is
  now a tick in the box, **Change what made it instead**, offered where
  the face traces back; a sketch edit that would run a profile into
  another, or open one, is not offered, and the box says why. Tests:
  `reFeatureDraft`, `reSnapEdit`, `reSnapDraft`; `e2e-reverse-cad`.

- **Combine can keep its tool** (2026-10-03). **Keep the tool body** in
  the Combine box leaves the tool standing beside the result, as it was,
  instead of going into it; the row reads "· kept". Tests:
  `reAutoBodies`, `reFeatureDraft`.

- **Combine takes a body made beside it by the same feature**
  (2026-10-03). Two profiles extruded together are two bodies, and
  combining the second into the first worked, but the first into the
  second failed with "The body this one is combined with has gone into it
  already": the tool was taken with every body its feature made, the
  body it went into among them. That body is now left out of the tool.
  Tests: `reAutoBodies`.

- **A box selects on the sketch sheet** (2026-10-03). With the Select tool
  a left-drag that starts on the bare sheet draws a selection box instead
  of panning, as CAD sketchers have it: dragged to the right a solid window
  that takes the pieces lying wholly inside it, to the left a dashed
  crossing box that takes every piece it touches — an arc counts by its
  curve, not its ends — with what it would take lit while it is dragged.
  Shift or Ctrl adds to the selection; a click on the bare sheet still
  clears it and a press on a piece still drags it. The right button pans;
  with a drawing tool in hand a left-drag pans as before. Tests:
  `reBoxSelect`, `reStore`; `e2e-sketch-box`.

- **A dimension is put down where it reads** (2026-10-03). A dimension the
  Dimension tool makes, or its key makes of the selection, is made at the
  value measured and its number follows the cursor, as Onshape and Fusion
  place one; a click puts it down there and opens the number on the sheet
  for typing, under the hand, instead of in its row in the panel. Enter
  puts it where the layout has it; Escape, another tool or Undo takes it
  back, never made. While a line's length or a radius follows the cursor a
  click on another piece, an end or a plane's line still makes it the
  distance or the angle between the two — only what it would pair with is
  lit — and a radius pairs now as a length does. Tests: `reDraw`,
  `reStore`; `e2e-reverse`, `e2e-sketch-dims`, `e2e-reverse-blank`.

- **The ways a shape is drawn are pictures on its key** (2026-10-03). The
  rectangle, the circle and the arc draw each of their ways with a picture
  of its own — the clicks it asks for in blue — in place of the row of
  words under the tools. Resting the cursor on the key opens the ways
  beneath it (tabbing to it does too, and a second press on a touch
  screen); the way picked takes the tool up and becomes the key's picture,
  remembered as before. A small corner mark says the key has more than one
  way.

## 0.4.5 — 2026-10-03

- **The arrow keys reach what lies behind** (2026-10-02). Over a spot where
  a click could take more than one thing — the face in front and the one
  behind it, an edge and the faces it bounds, a body behind another — the
  arrow keys step through them, Down and Right further back, Up and Left
  forward again, lighting each in turn, and the click takes the one lit,
  ahead of a sketch region or a measured element in front of it. The step
  holds while the cursor stays put. Test: `e2e-reverse-select` (the bottom
  face of a block through its top, and back).

- **A plane offers a sketch on it** (2026-10-02). A measured plane picked
  in the viewport has a **Sketch** chip beside Extract as body: the sketch
  opens on the plane as the panel's Sketch on list opens it. Test:
  `reStore` (a plane by reference, and one that is gone).

- **A Fix is a relation like the others** (2026-10-02). A piece fixed with
  the Fix key is listed with the relations, as Fix and the piece, and drawn
  with an anchor glyph when the relations are shown; its row or its glyph
  selects it, and × or Delete takes the Fix off. It used to show nowhere,
  and could only be taken off by finding the piece again. Test: `reStore`.

- **A shape defined but for its place moves whole** (2026-10-02). A
  rectangle with its width and height dimensioned, put nowhere yet, follows
  a corner or a side dragged by the hand exactly, every piece of it at once,
  instead of trailing a step behind while the solver eased the rest after
  the piece in the hand; by a side it moves any way, not only square to it,
  and dropped by a corner on another piece's end or the sheet's zero it is
  held there. A shape with a freedom left — a rectangle without its
  dimensions — is still resized by the drag. Tests: `reDraw`.

- **More ways to draw a rectangle, a circle and an arc** (2026-10-02).
  With one of them in hand a row under the tools offers its ways, each
  remembered: a rectangle from two corners, from its **centre** and a corner
  — the centre a point where construction diagonals cross, held where it was
  clicked — or by **3 points**, one side's ends and where the far side lies,
  at any angle; a circle from its centre, by the two ends of a diameter or
  through three points; an arc through three points or from its centre, its
  start and where it ends. The hint line says what each click is for.
  Tests: `reDraw`.

- **A dimension is done once it is made** (2026-10-02). A line's length
  made by the Dimension tool kept the line in hand after its number was
  typed, so the next click paired with it into a distance or an angle; a
  number typed, or taken as it stands with Enter, now puts the line down,
  and a pair made is the end of the dimension as before. Tests: `reDraw`.

- **A full round** (2026-10-02). Two edges rounded or chamfered at half
  the width of the face between them — a 5 mm wall at 2.5 mm, a bar's ends
  into a pill — failed, the kernel refusing to close the face up to
  nothing, and only 2.49999 mm went through. The round is made a hair under
  the size and the sliver of face it leaves is closed: a half round of one
  face for a fillet, a ridge for a chamfer. Tests: `reFeatures`.

- **The maps follow the colour map** (2026-10-02). The live map of a ghost
  or of the bodies, the curvature map and the scales beside them are painted
  in whichever ramp ⚙ Settings → Colour map has chosen — jet, as before, or
  one of the viridis maps, with that map's own caps past either end. Tests:
  `reLiveMap` paints through the map it is given.

- **A face is picked through the see-through scan** (2026-10-02). With a
  body shown the scan is drawn as a veil over it, but it still kept every
  face behind it from a click — a cylinder sitting in a bore could not be
  picked through the bore's wall. Drawn see-through, the scan now hides
  nothing from a pick; drawn solid, a face behind it is still out of reach.

- **Move face leaves no rings on a fitted cylinder** (2026-10-02). A round
  face's ends were read off its tessellation in floats, so on a tilted axis
  — every fitted cylinder's — the tube that resizes it stopped a few
  millionths short of the end faces: the join left a sliver of the old wall
  and a circle on each end, one more with every move. They are read off the
  surface now, in doubles. And an end moved out of a tilted cylinder left a
  seam round the wall where it had been: the prism is swept back from where
  the face goes to, which the kernel makes one with the wall. Test:
  `reMoveFaces` (a tilted cylinder three faces through six moves of its
  wall and ends).

- **Extract as body takes the assumed Ø** (2026-10-02). An element given an
  Assumed Ø in 3D Measure is a body that wide — the element as Measure draws
  and exports it — and is built again when its assumed Ø changes. Test:
  `reFeatures` (a pin extracted at its assumed Ø, extended).

- **Bodies are found from the part, not chosen** (2026-10-02). An extrude,
  a revolve, a loft or an extract **joins** what it meets, **cuts** it, or
  makes a **new body**, and the box asks for no body any more — as Fusion
  does. A join is made one with every solid body it touches: a body of its
  own where it touches none, and one body of all of them where it bridges
  several, under the oldest one's id, the others aliased to it so a later
  feature naming one finds what it went into. A cut goes through every
  solid body it meets — taking one it swallows whole — and fails, saying
  so, where it meets none. New body keeps the solid apart whatever it
  overlaps, and is where an extract starts: an element is taken as a tool
  more often than as a piece of the part. One body is one solid: whatever a
  step leaves in pieces — two profiles apart, a bar cut through at its
  waist, a pattern's copies standing apart, a cut by a plane through a U —
  is a body a piece, the largest keeping the body's id and the others
  taking the step's (and a fraction past the first, `islandId`), named and
  coloured in the body list in that order. Which body went into which piece
  of a join is read off the pieces — a point on each body's surface inside
  it — not off the faces, which the kernel's merging of faces on one
  surface names anew. The row of a join or a cut says which bodies it
  joined or cut. A feature saved with its `target` still joins or cuts that
  body alone, until it is saved again from its box. A Combine whose tool is
  a body a later step left in pieces takes every piece (`familyOf`): a plug
  patterned into four copies apart cuts all four windows, as it did while
  the copies were one body; naming one copy takes that copy alone. Every
  body a feature touched is kept as it stood, for editing it. Tests:
  `reAutoBodies` (a join meeting none, one, a face only, two apart; a
  bridge, and a feature on the bridged body; two profiles apart; a Combine
  with a patterned plug cutting every window, and with one copy; New body;
  the old target; a cut through a waist, once and twice; through several
  bodies and one swallowed; one meeting none), `reFeatures` (a pattern of
  copies apart is four bodies), `reStore` (no body to choose; the further
  bodies named in order); `e2e:reverse-history` reads the box's results,
  `e2e:reverse` a pattern of two cubes apart as two bodies.

- **Extract as body puts the element out of view** (2026-10-02). The body
  stands where the fitted element was, and the two drawn over each other
  made a click on either a guess: the element is hidden as the extract is
  made, in the same step of the undo history, as a used sketch is. Measure's
  eye brings it back; it keeps measuring. Test: `reFeatureDraft`.

- **What a sketch tool would take is lit under the cursor** (2026-10-02).
  The arrow and a relation in hand — Parallel, Perpendicular, Tangent and
  the rest — light the piece under the cursor; Dimension and Coincident the
  piece, the end or the coordinate plane's line; Fillet and Chamfer both
  lines of a corner and the corner — what the click would take, by the
  click's own rules (`sketchHoverAt`), in a tone lighter than the
  selection and heavier. Pointing at a relation's glyph or a dimension's
  number lights it, and the pieces and ends it holds. Test: `reStore`.

- **Move face takes several faces at once** (2026-10-02). CAD's offset of
  faces — Fusion's Offset Face, the Offset mode of SolidWorks' and
  Onshape's Move Face: pick one face or several, give one distance, and a
  flat face moves along its outward normal while a round face changes its
  radius by it. Picked together the faces move as a whole — a cylinder's
  wall and both its ends pushed out by 0.3 mm make it 0.6 mm wider and
  longer, its edges as sharp as they were — which is how a cylinder fitted
  to a bore the scanner could not see to the bottom of becomes the cutter
  Mesh Tools' Boolean takes out of the scan. The panel's key reads **Move
  face** (it read *Snap face*); a picked face offers **Move face** beside
  **Snap to scan**, several faces of one body **Move faces** beside Shell,
  and inside the box clicks add and let go of faces and a window adds many.
  Snap to scan is a switch in the box for a single face, the scan's clicks
  taken only while it is on. For one round face the box reads the diameter
  it will have, and the arrow sits on the rim, pulling the radius out.
  Faces that all trace to what made them — both ends of an extrude, its
  sketch's circle — are moved there in one edit (`planMoves`); if one does
  not, all are moved on the body as one Move face, whose row reads the
  distance and how many faces. In the kernel `offsetFacesTracked` moves
  them one after the other, finding each next face again by its surface,
  which moving another leaves where it was. A Move face saved with its one
  `face` opens as a move of that face. Tests: `reMoveFaces` (a cylinder
  grown and shrunk whole, in either order, a box on every side, two bores
  at once, a quarter-round refused), `reFeatures` (an extracted cylinder
  made longer and wider), `reSnapEdit` (both ends of an extrude as one
  edit, all on the body when one does not trace), `reFeatureDraft` (picks
  added, let go and windowed, the reading only for one face),
  `reProjectFile` (the old shape read); `e2e:reverse-cad` moves a top and a
  wall together.

- **The solid bodies are lent to the other workspaces** (2026-10-02).
  Every closed solid is offered through `src/app/solids.ts`, meshed when it
  is asked for — Mesh Tools' Boolean takes one out of the scan.

## 0.4.4 — 2026-09-28

- **Snap to scan offers the draft a leaning face asks for** (2026-09-23).
  A moulded wall modelled square and snapped onto the scan moved to where
  the scan's face crosses its middle and kept the body's direction, the
  box merely noting the tilt. Now the reading (`core/re/snapFace.ts`)
  tells a real lean from the fit's own scatter — the tilt must clear 0.2°
  and four times the angle the patch's σ, size and point count could
  produce — and where it does, the box offers **Draft it as well, by
  N°**: ticked, Create makes the move as before (the extrude's distance,
  the sketch's line, or a Move face on the body) and adds a **Draft**
  feature after it, hinged on the line across the face's middle where the
  scan's plane crosses it, so the face lies on the scan; the ghost shows
  the leaned face, and one Ctrl+Z takes the move and the draft back
  together. The offer is for flat faces; a round face's tilted axis is
  not a draft. Underneath, the kernel's draft only ever worked with the
  pull along Z — occt-wasm's `draft` takes its neutral plane square to Z
  through the origin whatever direction it is handed — so a Draft about
  any other plane failed with an empty message; `draftFaces` now turns
  the body onto Z and back. Tests: `reSnapFace`, `reSnapDraft`.

- **A shell the kernel gave up on is made by offset and cut** (2026-09-23).
  The fridge bracket — a bar with a block on its end, nine flat faces —
  would not shell with its front, the bar's top and the block's top opened
  together: each opened alone, and the box said so, but OCCT's thick solid
  fails on that body for any two faces opened on opposite sides of the
  step where the block meets the bar, and for many threes whose pairs all
  pass, at every tolerance and every wall from 0.5 to 3 mm. Now when the
  thick solid fails, and the body has no rounds too small for the wall to
  explain it, the kernel makes the shell itself: the body less its own
  inward offset is the closed hollow body, and the wall over each opened
  face — the face pushed in by the wall, less the walls of the closed
  faces beside it, which reach the opened face as a shell's walls do — is
  cut away. Every pair and every three of the bracket's faces opens now.
  One difference from the thick solid's shell: a wall meeting an opened
  face at an inside corner keeps its foot, a wall's thickness of the body
  under the corner, where the thick solid runs the opening on under the
  wall. Test: `reBuild` (a shell the thick solid gives up on).

- **A click on the part sets the extrude's end on its side of the plane**
  (2026-09-23). The From and To keys under the extrude's fields are gone: a
  point clicked in front of the sketch plane sets To, one behind it sets
  From, so a click on the part's top and one on its bottom make the body
  that spans them, in either order. To now stands above From in the box,
  the way the part lies. Tests: `reStore`; `e2e-reverse-history` drives
  the clicks.

- **Two outlines along one line no longer leave a sliver in the face beside
  them** (2026-09-23). A sketch with two rectangles whose bottoms sit on the
  same datum comes out of the solver with the bottoms a hair apart — twenty
  nanometres — and the one that ran on past the other's corner had that
  corner missing from it. The face beside took in a sliver a hair high and
  millimetres long along the shared stretch, and its extrude carried a face
  of nothing there. The region graph now makes an end lying on another
  piece — within the snap, clear of its ends — a vertex of that piece too,
  and two stretches over the same two vertices one edge. The same
  drawing, with the outline extruded and the lip joined onto it, had the
  joined body's front as two faces a hair out of plane with each other —
  the lip's bottom ran on past the outline's corner at its own height —
  which a pick read as "2 faces" and the shell refused. Two lines drawn
  along one line, each end of the shorter within the snap of the longer's
  line, are now taken to lie on it, and the front comes out one face.
  Tests: `reRegionsOverlap`, the saved bracket's own lines among them;
  `reBracketSeam` builds and shells the saved bracket.

- **The Reverse engineer lays no tint on the surfaces elements were fitted
  to** (2026-09-23). The elements stand as datums, in outline and body; the
  scan under them keeps its colour, so a ghost being settled onto a face is
  read against the scan and not against the colour the Measure workspace
  lays over that face.

- **A drag no longer leaves a relation reported as not met**
  (2026-09-23). Dragging a line held by a coincidence, or by a point-on
  to a coordinate plane, sometimes lit the relation's warning and the
  sketch's "1 relation not met" — the relation still there, the geometry
  a few microns off it. The hand's pull on a dragged point weighs a
  hundredth of a hard relation, so a pull that fights one bends it by a
  ten-thousandth of the drag: past ten millimetres that crosses the micron
  the report tolerates, and at sixty a corner's coincidences went with it.
  Now a solve with a hand on it ends with the hand let go: every piece
  wishes to stay where the pull left it and the relations close the last
  microns (`solveSketch`, a second `descend` over the blocks without the
  pull, at most six iterations, on the drag's quick steps as well as the
  settle when the hand lets go). Test in reSketch: the rectangle of the
  report dragged sixty millimetres off the plane bodily and by a corner,
  nothing unmet, the corner gone straight up as far as the plane lets it.

- **A failed round, chamfer or shell says where, red on the part**
  (2026-09-22). A fillet that the kernel refused said "Filleting: BRep_API:
  command not done" and nothing more; the operator was left guessing
  which of five edges, and at what radius, the kernel would have taken.
  Now a round, a chamfer or a shell that fails — or that leaves no closed
  solid — is diagnosed by trying its picks one at a time on the body as
  it stood (`Builder.diagnose`): the edges that do not round at the radius
  are drawn red on the part, in the same fat red as a trim's open edges,
  and the row says how many of them, that the others do, and the largest
  radius they take (found by halving, to two percent). Edges that each
  round alone but not together are all drawn, with the radius they take
  together and "or round them in two features". A shell whose wall does
  not fit the body even closed outlines the outside rounds no larger than
  the wall (`ReKernel.collapsingRounds`) and says the wall that fits;
  faces that cannot be opened at that wall are outlined, with the wall at
  which they open. The same diagnosis runs on the preview while the box
  is open (the worker answers `preview-failed` with the polylines;
  `PreviewFailure` in reClient.ts carries them; a preview that built but
  left no closed solid carries it as `failure`), so the red marks move as
  the radius is typed, and it is asked only after a failure — a kernel
  operation per pick and six more per failing pick. Tests in reBuild:
  the edge too big for its box and the radius it takes, two rounds that
  fit alone and not together, a wall thicker than half the body.

- **Every snap in the sketch holds what lands on it, as CAD infers
  coincidence** (2026-09-22). An end that snapped to another end, to the
  middle of a line or to an axis was held there; one that snapped to the
  body of a line or an arc, to a circle's centre or to the sheet's zero
  was put there and left loose, so a T drawn from the side of a line came
  apart under the next drag. Now the body of a piece holds the end by a
  point-on relation (`snap.ts` names the piece; `holdAt` in the store
  makes the relation, a line's or a curve's), a circle's centre is an
  anchor like an arc's end, and the zero holds by a point-on to each
  coordinate plane whose line crosses there — the origin point's
  coincidence in Fusion. A rectangle's corners and a circle's centre are
  held where they snapped too. The slice and the grid are still places
  only: they are not the sketch's own. A chain of lines runs on from a
  piece's body as it did from an axis, and arrives at the zero as at an
  end. Nothing is held twice: an end joined to a piece's end is not held
  on its body as well (`heldBy`), and a dropped end already held stays
  as it was. Tests in reSnap and reStore.

- **A sketch's zero is the part's origin, as every CAD sketcher has it**
  (2026-09-22). A sketch's sheet was laid out on the plane it lay on: a
  plane element gave its patch's centre as the zero and its patch's axes
  as X and Y, a body's face its centroid, a coordinate plane the scan's
  centre projected. So nothing on the sheet said where the part's zero
  was, the grid was anchored on an arbitrary point, and "horizontal" on a
  round or slanting patch was whatever the patch's bounding rectangle
  happened to lie along — which is what Fit options' "Align lines to the
  sheet's axes" aligned to. A survey of FreeCAD, Fusion, Onshape and
  SolidWorks found one rule they converged on, after complaints about
  exactly these things (Fusion's offset plane at the face's centre,
  FreeCAD's zero on a corner): the sketch origin is the part's origin
  projected square onto the sketch plane, and the sketch's X is a
  coordinate axis flattened into it. That is the rule now, for every
  plane a sketch is put on (`section/frame.ts sketchFrameOn`, the axis
  next round from the one the normal is nearest, as the coordinate planes
  already had it): a sketch on a face at z = 20 has the part's X and Y and
  its zero straight above the origin; the datum traces cross there; the
  grid is anchored there; a dot in the datum colour marks it when it lies
  on the sheet, and the tools snap to it (`snap.ts`, kind `origin`, after
  the ends of the pieces). Sketches already made keep their frames — a
  frame is stored with its sketch. The coordinate planes on offer follow
  the same thought: **the XY, XZ and YZ planes at zero** once the part is
  aligned or there is no scan (`features.ts coordinatePlaneOffers`), and,
  with a scan, the planes **through the centre** as before — a slice
  across the middle of the part is what a profile is fitted on, and the
  only offer while the part still sits where the scanner left it. And a
  **sketch on a body's face follows the face**, as a CAD sketch does: the
  sketch keeps the face by its fingerprint (`PlaneRef bodyFace`), the
  builder finds the face again on the body as it stands before each
  feature on the sketch and carries the lifted profiles — and a revolve's
  axis, when it is a line of the sketch — to where the face is now
  (`Builder.onSketchFace`, `features.ts frameMap`), the build handing the
  frame back so the sketch is kept there (`FeatureResult.sketchFrame`,
  `reStore.finishBuild`, no undo step, no rebuild); a face the fingerprint
  no longer finds leaves the sketch where it was and the row says so. An
  alignment applied afterwards carries the face's fingerprint with the
  sketch (`topo.ts transformFingerprint`), so it is found on the rebuilt
  body. Tests: section (the frame rule), reFeatures (where the zero is,
  the offers, a face carried into the steps, the frame map), reBuild (a
  boss sketched on a top face stands on it after the block is made
  taller, and stays with a note when the face is out of reach), reSnap,
  reStore, reTopo new; reCompare's symmetry plane updated.

- **Symmetric in the sketch mirrors about a coordinate plane** (2026-09-22).
  The third click of Symmetric looked for a piece of the sketch alone, so
  the part's coordinate planes — drawn on the sheet as the lines they cut
  it in, and dimensioned to since 2026-09-20 — could not be the mirror
  line. They can now: the click that lands on a plane's line where no piece
  is takes it (`Constraint.about` as `{ datum }`, `mirrorRelation.symmetricPairs`
  on a `DatumTrace`), the line lit under the cursor while the relation
  waits for it, the relation's row naming the plane; the solver reads the
  plane's line off the sketch's frame as it does for a dimension to the
  plane (`datums.traceLine`), so the relation follows the part under an
  alignment. Tests in reMirrorRelation and reStore.

- **A selection in Reverse engineer survives the camera** (2026-09-22).
  Faces, edges or corners gathered with Ctrl+click were lost to the orbit
  that meant to look at them: the chips put the selection away on any press
  outside the bar, and a press is how a turn, a pan and a zoom begin. The
  selection is now put away as CAD puts it away — by a click that lands on
  nothing selectable (the bare scan or empty space, without Ctrl held;
  `SceneManager.onClickAway`, raised by the click that survived the drag
  threshold and found no body item, element, sketch item or plane), by
  Escape, or by the feature or sketch it is turned into — and the camera
  leaves it alone. The chip bar stays where the last click put it.
  e2e-reverse-select orbits and zooms over two faces and clicks empty
  canvas after.

- **Extract as body takes the element as Measure extended it**
  (2026-09-21). A cylinder pulled out past the surface it was measured on,
  or a plane widened on an edge, is a body of that length and size — what
  the viewport draws and the STEP export of the elements writes — where it
  was the bare fit before (`core/re/features.ts`: `ResolveContext`'s
  elements carry `extend`, the extract's step is resolved through
  `applyExtension`). An element extended or refitted in Measure after its
  body was made has the body built again on the way back into Reverse
  engineer (`useReverse.ts`, `extractSources`). Tests: reFeatures — a pin
  extended 2 mm and 5 mm, a slab widened by 10 mm.

- **A hands-on round on the Reverse engineer workspace: an extrude to a
  clicked point, a ghost that follows the hand, the rollback bar, Symmetric
  that says what it wants, symmetry in the alignment — and two things that
  did not work** (2026-09-21, evening). **Extrude to a point on the part:**
  with the extent a Distance, a click on the scan, on a body or on a body's
  corner puts an end of the extrude at that point's height over the sketch
  plane (`core/re/preview.ts` `extentThroughPoint`, `reStore.extrudeToPoint`,
  `SceneManager.setPartPointPick`, `BodyPicks.pointAt`): To, unless the
  box's *A click on the part sets* keys or the grip last in hand say From.
  In front of the plane or behind it — a click behind it turns the extrude
  round, a click for each end makes one that reaches both ways, a Symmetric
  extent reaches the point with either half. Read off the point once and a
  number from then on, as a snapped face's offset is. **The ghost under a
  grip was stuttery** because the kernel was asked 40 ms after the *last*
  change: a steady drag changes the draft every few milliseconds, so the
  ghost stood still until the hand did. One request is out at a time now
  and the newest draft is asked for as the answer lands, every answer
  drawn; a straight extrude does not wait even for that — its ghost is the
  last prism the kernel built, stretched along the normal to the new From
  and To (`prismStretch`, `SceneManager.setBodyPreviewStretch`), every
  frame, the kernel's own taking over as it arrives. A grip's moves are
  made once a frame, not once a mouse event, and the volume and the
  deviation map are the last answer's to give, not every one's. **A solid
  is not joined to a surface:** with a sheet or a fitted surface the last
  body made, a new extrude defaulted to joining *it*, and failed with
  *Joining left no closed solid*. The default is the last **solid** body
  (a new body when there is none), the Body lists of Extrude, Revolve,
  Extract and Loft offer solids alone, Combine's tool likewise, and a
  feature that names a surface all the same — an old project's — is told
  so by name and the surface left as it was. **A rectangle could not be
  drawn far from the slice:** the sheet's clicks were taken on the card it
  is framed by, a rectangle a little larger than the slice, and a click
  past it was a click on nothing. A blank sheet is a plane now
  (`FlatScene.pick`); an image's sheet still ends where the image does.
  **Symmetric in the sketch** mirrored one end of each of two pieces across
  the sheet's Y axis, which nobody could have guessed or used. It takes
  three picks as CAD's does — the two pieces, then the line they mirror
  about — and the line under the tools says which is next
  (`core/re/mirrorRelation.ts`): lines held end for end, paired the way
  that mirrors them as they lie, circles by their centres, arcs by both;
  with two pieces selected the key takes the relation in hand for the
  mirror line. **The rollback bar** under the feature list, dragged: the
  features below it are set aside (`reStore.rolledBack`, out of `features`,
  so the build, the picks, the defaults and every commit work on the part
  as it stood there with no code of their own), what is made next goes in
  at the bar, **To end** builds the rest again on top. Not an undo step,
  travels with undo, waits while a box is open, saved with the project
  (`ReversePart.rolledTo`). **Use symmetry** in the Align part box
  (`core/alignSymmetry.ts`): the pose being set up — or Auto-align's, with
  none — settled on the scan's mirror plane or on a symmetry plane already
  measured: the nearest axis turned onto its normal, the rest squared up
  with the least change, the zero dropped onto it; it comes back as picked
  points like Auto-align's, the note saying which plane it became and by
  how much. Tests: reMirrorRelation, alignSymmetry new; rePreview, reStore,
  reFeatures, project extended (1057 passing, tsc and the build clean); new
  e2e scripts e2e-reverse-history (18 checks — the ghost's far face read on
  20 frames of a drag, the bar dragged with the mouse) and
  e2e-align-symmetry (11).

- **The surface route, part two without its curves: Plane and Cylinder
  with Auto Constrain, and the Curvature key** (2026-09-21, phase E's E1
  and E3; E2 — curves on the mesh, the four-sided patch — waits for its
  design interview). **Fit surface has a Shape**: Freeform as before, or a
  **Plane** or a **Cylinder** through the region — exact faces (a
  rectangle along the region's long way, an arc of the cylinder swept
  along its axis, the whole tube when what is left open would be a
  sliver), grown by Expand by. They are fitted with **Auto Constrain**
  (core/re/autoConstrain.ts): within 0.5° of parallel or square to a
  reference — the part's coordinate planes, the measured planes,
  cylinders and cones, the planes and cylinders fitted before it in the
  list — the fit is made again with that direction held (a plane through
  the centroid; square to one reference, the least-squares normal among
  the directions square to it; square to two, their cross product; a
  cylinder as the best circle about the held axis, found free from its
  points alone by starting the geometric fit from each of their three
  principal directions), and within 1 mm of a parallel plane or axis it is
  put on it. The box reports what was held, how far off the free fit was,
  and the σ before and after; **Hold to** forces a relation by name or
  forbids them all. The surfaces before a fit are the builder's to add as
  references — their fits are made there — and a Trim cuts with the whole
  plane or cylinder of such a surface, as with a measured element, not the
  drawn patch. A feature held by hand to an earlier surface depends on it.
  **Curvature** in the view bar (core/geometry/curvature.ts, the mesh
  worker's `curvature` request): the scan coloured by its mean curvature
  — the cotangent Laplacian over each vertex's mixed Voronoi area, signed
  by the outward normal, NaN on an open scan's rim, averaged over the
  neighbours four times, because a scan's scatter reads larger than a
  2 mm round at the size of one triangle and all but cancels over a patch
  — on the Deviation ramp about zero, at the curvature nine vertices in
  ten stay under (never under that of a round as large as the part), the
  legend giving the scale as a radius. Painted as the full map it is
  through the scene sync; one map at a time with the Deviation key, the
  ghost's live map taking the surface over while a feature is set up.
  **Fixed: an element lying on the scan could not always be clicked** —
  a fitted plane's shell is the scan's own face, the pick ray meets both
  at the same distance, and where the scan sorted first the bare scan
  ended the search; in Surface deviation the second of two planes could
  not be chosen on the part (what e2e-element-deviation had failed on
  since 2026-09-17). A shell within the scan's scatter behind a bare-scan
  hit now takes the click. Tests: curvature, reAutoConstrain new,
  reFeatures extended — a cylinder patch fitted as an exact cylindrical
  face with its axis held to Y, and a box scanned 0.3° askew whose six
  faces, fitted as planes, trim into a square box of the right volume
  (1025 passing, tsc clean); e2e-torus reads the curvature map on its
  fillet ring (12 checks), e2e-reverse-guide fits the L's end face as a
  plane, held, freed and forced (45), e2e-element-deviation passes again.

- **The two end-to-end parts the plan had asked for, and what writing them
  found** (2026-09-21). **e2e-fan-base** (14 checks): a box with a round
  boss generated on a 1 mm grid and turned a fifth of a degree, its eight
  faces fitted as seven planes and a cylinder, every one held to the
  part's planes, trimmed into a solid of the part's volume to a part in
  80 000, the boss's foot filleted, the export a closed solid with a
  cylinder and a torus in it rather than splines. **e2e-wheel-cap** (9):
  a disc with four windows modelled on the blank stage, exported and
  meshed as its own scan, then reversed by the cutter route — the disc
  revolved from its section, one window's outline a sheet, the sheet
  patterned four times round, the disc split with the fragments on the
  scan kept — to the same volume, every scan point within ±0.1 mm.
  What they found, fixed: **a sheet can be patterned** (the kernel's
  pattern asked for solids and "made nothing" of a sheet; its copies are
  now the compound of their faces, and the builder lets a pattern — and
  only a pattern — work on a sheet, previewed as *A sheet of 16 faces*);
  **lying on the scan is judged by area** (`Builder.onScanShare` counted
  sampled triangles, and a flat face is two triangles however large: a
  window's plug, four walls on the scan and a roof and floor off it, read
  0.67 on and stayed in — now about 1500 Halton points spread over the
  surface by area, as the README had said all along); **a trim's faces on
  one surface are one face** (`unifySameDomain` after the heal: the boss's
  wall came out as the halves either side of a plane that crossed it,
  which no Hole or Snap face takes for a cylinder going the whole way
  round), and a face is traced to the surface that made it by a point on
  it, not by its centroid — a whole cylinder's lies on its axis; **of two
  references as near as each other the first names the relation** (the
  part's planes before the elements before the earlier surfaces — *Parallel
  to XY plane*, not *to Surface 7*), a coincident one among the parallel
  ones still found; and **Export body STEP is there without a scan** — the
  panel showed the key only under a loaded scan, so a part modelled on the
  blank stage could not leave the tool (it is `model-body.step` then;
  Compare in Deviation still wants its scan). Tests: a patterned sheet
  splitting a box in three, the window's plug dropped by area, the
  tie-break and the coincident reference.

- **Two of the open ends of the CAD-side round** (2026-09-21). **A snap
  traced through a revolve** (core/re/snapEdit.ts): a face a revolve made
  is moved in its section, as an extrude's is in its sketch — a shoulder,
  flat and square to the axis, by the section's line under it (the wall
  move, shared as `moveLine`); a bore, a rim or a hub, a cylinder about
  the revolve's own axis, by the line that runs along the axis at its
  radius, away from the axis or towards it, the one beside the face when
  two steps share a radius. The flat ends of a part turn are the angle's
  and a cone comes of a line that leans: those stay moves on the body, and
  the box says so. A revolve may turn about a measured element, so the
  plan reads Measure's elements (`reStore.elementRefs`, kept by the
  workspace, so that what the store decides on Create is what the box
  showed). **Silhouette edges on round faces** (core/re/silhouette.ts,
  `BodyPicks.updateView`): a body is drawn by its edges, and a cylinder
  has none down its sides — a boss on a plate read as a disc. The line
  where a round face turns from facing the eye to facing away is drawn
  with the edges: found a triangle at a time as the zero of normal · view
  between the vertex normals, so it cuts across the triangles, smooth,
  instead of running along mesh edges in a zigzag; for the orthographic
  camera along its direction, for a perspective one from its eye; made
  again only when the camera has turned a fifth of a degree or the bodies
  changed. Not picked — it is not an edge. Tests: reSilhouette new (a
  cylinder's two sides, nothing down its axis or on a flat face, a ball's
  great circle and its circle of tangency from a near eye), reSnapEdit
  extended with a stepped ring's shoulder, rim, bore and hub, and a
  revolved ring moved through the kernel to the right volumes (1033
  passing in all, tsc and the build clean).

- **The sketch's dimensions as a drawing carries them, dragged where they
  read best — and Chamfer beside Fillet** (2026-09-20, from a picture of
  Onshape's). A dimension on the sheet is no longer a callout with a plate:
  it is extension lines off the two measured points, a dimension line with
  a filled arrowhead at each end, and the bare number written along the line
  in a gap left for it, without zeros carried behind (21, not 21.000); a
  radius is a leader with its arrow on the rim, from outside or from the
  centre; an angle is the arc the number says, between the two lines, with
  a line carried on to an arc end that lies beside it. Arrows turn in from
  outside on a stretch too short for them and the number. The layout is pure
  and in two steps (core/re/dimLayout.ts): `dimShape` reads the sketch in
  sheet millimetres, `dimStrokes` makes the lines and arrowheads for one
  zoom — arrows, gaps and overshoot are screen pixels, so
  FlatScene.setSketchDimensions makes the strokes again when the zoom moves
  and leaves the labels alone. **The number is dragged**: a press that moves
  is a drag (FlatScene.onDimensionMove → reStore.moveDimension), one that
  does not is the click that opens it for typing, as before. Where it was
  put is kept on the dimension (`Constraint.place`, off and along) against
  what it measures, so it follows the pieces; dragged past the line's end
  the dimension line is carried out to it, round a circle the leader turns,
  across an angle's vertex the arc goes with it. A drag is one undo step
  and solves nothing. A length not yet placed stands on the side away from
  the rest of the sketch. **Fillet and Chamfer are tools among the drawing
  tools** (the row of Line, Rectangle, Circle, Arc), no longer an edit among
  Delete and Fix. **Chamfer is new** (core/re/filletCorner.ts
  chamferLines): a corner clicked, or two lines, cut back with a straight
  piece across, held by two dimensions — each end's distance to the other
  line, which on a square corner both read the setback — placed outside the
  corner; typing over one makes an uneven chamfer; the next chamfer starts
  with the last setback; **Sharp corner** takes a chamfer out as it does a
  fillet. Tests: reDimLayout new (13); 1005 passing, tsc clean; new e2e
  script e2e-sketch-dims (16 checks), e2e-reverse-blank still passes.

- **Reverse engineer as plain CAD, picks that say what they are, a window
  selection — and the sketch's dimensions** (2026-09-20, after a hands-on
  list). **No scan is needed**: the front door's *Model without a scan*
  opens a blank stage (reStore.scanless, SceneManager.startScanless —
  sized for a part of 100 mm and following the bodies as they grow, the
  camera re-framed only when they outgrow it); every feature that does not
  read the scan is live, a sketch asks for no slice, the first-project guide
  and the alignment nudge stay away, the project saves and opens with
  features and no scan, and a scan loaded later joins the model instead of
  resetting it. **Faces, edges and corners are picked and read**
  (core/re/selectionInfo.ts, the chips' card): area and normal, radius and
  axis, length and ends, coordinates; **Ctrl+click adds** and two picks read
  what lies between them — distance with ΔX ΔY ΔZ, corner to edge, axis or
  face, parallel faces and edges, angles, the distance between two axes —
  more read their sums; several edges offer Fillet and Chamfer together,
  several faces Shell. Corners are a pick of their own (BodyPicks mode
  `all`, the ends of the edges, within 10 px, not through a solid body).
  **Shift+drag is a selection window** over the bodies
  (SceneManager.beginBodyWindow, BodyPicks.itemsInWindow): to the right
  what lies wholly inside, to the left what it touches, hidden edges too —
  into the selection or into the open Fillet, Chamfer, Shell or Draft
  (reStore.addDraftEdges/addDraftFaces). **A shell past rounds no larger
  than its wall** no longer fails: the kernel's thick solid gives up on a
  convex round whose inner radius would be nothing, so the adapter takes
  those rounds off (defeature), shells the sharp body, and cuts the result
  back to the body's own outside — round outside as modelled, sharp inside
  — refusing instead when anything of the outside would be lost, and the
  row says how many rounds it was (FeatureResult.note). **In the sketch**:
  one click on a line with the Dimension tool is its length, the field in
  focus; the line stays in hand and a second click on another piece, an end
  or a plane turns the length into the distance or angle between them, in
  one undo step; D with pieces selected dimensions those, as the button
  does. **The middle of a line is a snap** (a triangle mark, half the hand's
  reach) and an end drawn there is held to it by a coincidence on the
  line's centre anchor. **Dimensions to the part's coordinate planes**: the
  XY, YZ and ZX planes are drawn on the sheet as the named amber lines they
  cut it in (core/re/datums.ts — from the sketch's frame, never stored, so
  they are right after an alignment), picked by the Dimension tool like a
  piece, and held by the solver as a point's distance from the line
  (`distance` with `q: { datum }`). **Find symmetry plane** takes a
  coordinate plane as its seed (core/symmetry BASE_PLANE_SEEDS; through the
  part's centre where the plane misses the part). **Saving**: a crash on a
  larger project was reported and could not be reproduced (a 1.9 million
  triangle scan with a fitted sketch saves in the browser test); what could
  make a save hang or run out of memory is closed — the project worker's
  death or an unreadable answer now fails the save with a message instead
  of leaving the app behind its busy veil for ever, a message that does not
  clone leaves no request waiting, and a manifest past 2 MB is written
  compact rather than with every index of a marked surface on a line of
  its own. A dimension field left unchanged is no longer an undo step.
  Tests: reDatums, reSelectionInfo new; reDraw, reSnap, reFeatures,
  symmetry, project extended (992 passing, tsc and the build clean); new
  e2e scripts e2e-reverse-blank (20 checks), e2e-reverse-select (14),
  e2e-reverse-save; e2e-reverse, -cad, -guide, fit-chains, bracket and
  torus still pass.

- **Reverse engineer: the sketch in front, the part behind — and Fillet**
  (2026-09-19). While a sketch is drawn a veil of the stage's colour lies
  between the sheet and the 3D viewport, so the part, its cut face and the
  bodies fall back; the slice is a muted line drawn half see-through; the
  pieces are heavier and at full strength, and the dots on their ends are
  four pixels, not six (viewer/sketchPalette.ts, `.viewslot.sketch`).
  **Dimensions** are drawn in the sheet's strongest ink on a solid plate
  edged in the accent, as the bare number — no "L", no "d", a radius keeps
  its R — and are **typed over on the sheet**: a click on the label opens a
  field there, Enter takes the value (FlatScene.setFlatDimensions' `edit`,
  onDimensionEdit). A **relation's glyph shows its name** the moment the
  cursor is over it — Coincident, Tangent. **Fillet** (F, the key before
  Sharp corner) rounds a corner between two lines: click the corner point
  where they are joined, or one line and then the other; with two lines
  selected the key rounds those. The lines are cut back to the tangent
  points and the arc is held with two joins and two tangencies, its radius
  a dimension that comes out selected with its field in focus. The lines
  need not touch: ends standing off the corner give the first radius, and
  a short chord a fit left across the round is replaced by it; the next
  round starts with the last radius (core/re/filletCorner.ts). Tests:
  reFilletCorner — the geometry, the refusals that change nothing, a
  rectangle still one region, the tool's clicks in the store.

- **Reverse engineer: no seams on a body made from crossing outlines**
  (2026-09-19). Where two outlines of a sketch cross — a bar and a wall
  across its end — the region in the middle touches the outside of the
  sketch at its corners only, and was handed the sketch's whole outline as
  a hole. Its prism was broken, the join came back as two solids, and the
  merging of faces on one surface, which runs on a single solid, never
  ran: a line at the height of the sketch after extruding both ways, and
  lines down the wall where the regions met. A region's hole is now a loop
  of another connected part of the sketch, never of its own
  (core/re/regions.ts). **A face pulled out of its own outline** left the
  same line for another reason: the outline was projected into the new
  sketch from the edges' drawing, 32-bit floats, so the new walls stood a
  hundredth of a micron off the ones they continue — further than the
  kernel lets one plane lie from itself. A projected line or arc now lands
  where the edge's own ends and middle are (core/re/project.ts), in the
  Extrude and Sketch here chips and in the sketch's Project tool alike.
  Tests: reBuild builds the bar and the wall both ways to eleven faces and
  twenty-four edges, and pulls the top of a block lying askew to six.

- **Reverse engineer: the sketch, after a hands-on review** (2026-09-19).
  **A click selects, and stays selected** — the press that might have been
  a drag selected the piece and the click that followed took it off again;
  a drag now selects, and enters the history, with its first move.
  **Dimension** is the first key of the relations row and **D** on the
  keyboard: with nothing selected it is a tool — click a line for its
  length, an arc or a circle for its radius, a second piece or an end for
  what lies between the two (the distance between parallel lines, the
  angle between others, the distance from an end or a centre to a line or
  to another point) — and the new dimension's field takes the focus, to be
  typed into. The relations work the same way: with nothing selected the
  key stays in hand and the relation goes on the pieces clicked next.
  **The Line tool draws a chain** (L; R and C take the rectangle and the
  circle): each line starts where the last ended, joined to it; a press on
  the last end, dragged, swings out an **arc tangent** to the piece before
  it, as in Fusion; Escape, Enter, a middle click, a second click on the
  last end or landing on another piece's end ends the chain. **The
  drawing reads**: the cut face is a flat slate tone instead of a lit
  near-white, the slice a hairline at the far end of the scale, the pieces
  saturated and 2 px instead of 4, each with a **dot on its ends**, in a
  set of colours for the dark instrument and one for the light
  (`viewer/sketchPalette.ts`). **Relation glyphs are hidden** until the
  eye key by the tools asks for them; the one selected in the list is
  always drawn, the dimensions too. **The box says less**: the paragraphs
  under its head are gone (what a key does is in its tooltip, the
  alignment nudge is one line with its chip), a line of text shows only
  for an error, a wait or what the tool in hand wants clicked next, and
  the sketch's status moved to the bottom, by Extrude, Revolve and Finish.
  **Undo and redo are keys in the top bar**, out of the relations — the
  drawing's history inside a sketch, the feature list outside; the bar is
  where undo for the rest of the tool will go. **A click on a face of the
  scan no longer opens a sketch**: a sketch is begun from the panel's
  *Sketch on* list or from a body's face through its chips, and the first
  project's second step says so. 2D Measure's **Count** key is a gear of
  six teeth with a number beside it. Tests: reDraw (the tangent arc, what
  two clicks dimension, the chain, the tools, the click that selects);
  e2e-reverse and e2e-reverse-guide follow.

- **Reverse engineer: Fit all chains gives a closed profile** — on a real
  slice (the fridge bracket's section) the fit lost fillets, ran sides on
  past their corners, cut corners with stubs and left Infer corners with
  tangencies the solver bent the rounds to meet. What was wrong: a piece
  was accepted on the σ of its whole run, and a side of five hundred
  points takes half a fillet on board without its σ moving. Now a piece
  is also judged by its worst stretch (the mean miss over five points in
  a row) and by whether the chain comes into it and leaves it along it —
  a line ends where the chain stops heading its way, an arc has to be
  entered and left along its tangent, turn one way throughout and by as
  much as it claims, which is what tells the riser of a small step from
  the half-turn a circle fits through it. Lines and arcs are held to
  different tolerances: an arc to the noise, a line to a *wave* tolerance
  several times that, scaled by its length, because a scanned wall bows
  and wanders; a shallow arc that bulges no more than a wall may wander
  is the wall. Short pieces are asked about in clusters against the long
  pieces either side: noise merges, a burr is left out of its side, a
  blob between two lines that cross beside it is dropped for the corner
  they make (and joined whatever the gap), anything else — a riser — is
  kept as one line. A tangency is inferred only within 20° of tangent
  (it was half the corner gap: a millimetre, sixty degrees on a round of
  two). **Fit options…** (a window beside the box, no backdrop, dragged by
  its head; `ui/FitOptionsModal.tsx`, `prefsStore.fitOptions`): a Detail
  slider (the wave tolerance from one to five noise tolerances, three in
  the middle), the fit tolerance, Join corners (on: the fit is a closed
  profile in one click), Align lines to the sheet's axes within a typed
  angle, 45° too if asked (`core/re/axisAlign.ts`: an inferred horizontal
  or vertical, the line's slice points turned with it so the data do not
  fight the relation, the pieces of one aligned wall merged into one
  line). A change refits the fitted chains as one undo step
  (`reStore.refitChains`; undo puts back which chains were fitted). Tests:
  reFitChains (wandering walls, the blob, the riser, alignment, merging,
  refit and undo); e2e-fit-chains on the bracket scan (one click to a
  solved closed region, coarse under fine, the window, undo) and
  e2e-bracket still passes, at a median of 0.060 mm.

- **Reverse engineer: a used sketch is hidden** — the sketch a new extrude,
  revolve, sheet or loft is made from is hidden as the feature is
  committed, as in Fusion, so the body is not left under its own
  construction lines. The eye on the sketch's row shows it again, Ctrl+Z
  brings it back with the feature it undoes, and while a feature made from
  it is open the sketch is drawn regardless, so its regions can still be
  seen and picked. Editing a feature leaves the eye as it stands.

- **Reverse engineer: the CAD-side round** — from a hands-on review
  (2026-09-18). **Snap to scan**: model the part roughly, click a face of
  the body, take *Snap to scan* from the chips (or *Snap face* from the
  keys), then click the scan where that face should lie — a plane is
  fitted there for a flat face, a cylinder for a round one, and the face
  moves onto it: a flat face along its normal (its own outline extruded and
  joined outward, cut inward, so the walls run on), a full cylinder by its
  radius with the axis kept (a hole bored out or sleeved, a boss built up
  or turned down). The box shows the body as it will be, the move as a
  number with its round-value chip and an arrow to drag, and says how well
  the scan agrees — σ of the fit, how far the scan's face is turned, how
  far its axis stands off; a click on a neighbouring face (over 20° off)
  is refused by name. **The move goes into what made the face** wherever
  it can (`core/re/snapEdit.ts`): the face names its maker, and a cap of an
  extrude moves by the extrude's From or To, a wall by the sketch line it
  stands on — held on its new carrier while the solver carries the corners
  after it — and a bore or a boss by its sketch circle's radius (a typed
  radius dimension reads the new value). Nothing is added to the list; the
  rounds, shells and cuts that come after build again on the moved wall,
  and Ctrl+Z takes it back. The box says which edit it will be. Only a
  face with no such trace — a fillet's, a mirror's, a wall a dimension
  holds, an extrude to a plane — is moved on the body as it stands (a
  *Move face* feature, signed, editable in its row), and the box says why
  and what that cannot do: it knows only the face's own outline, so walls
  not square to the face step and the rounds on its rim stay behind — the
  pads, pockets and slivers the first cut of this feature left on a
  filleted part. While the scan is being clicked the **bodies are a tint
  and their edges, the scan solid under them**, and the ghost is the face
  where it will lie. The offset is a number from then on: a rebuild does
  not fit the scan again.
  **Draft** as a feature: the first flat face clicked (or a plane chosen)
  is the neutral plane, the faces clicked after it lean about it by the
  angle, inward as they go into the body; the kernel's draft takes its
  neutral plane through the world origin and one face a call, so the body
  is carried there and back and each next face is found again by what it
  is, and since no history comes back the faces are traced to their makers
  by their geometry — a leaned wall is still the extrude's wall to the
  fillet that picks it later. **A sketch on a body's face opens with the
  face's outline projected into it**, and the sketcher has a **Project**
  tool: a click on an edge of a body or a piece of another sketch, on the
  part under the sheet, brings it in as a piece of its own — magenta, fixed
  where it lies, lit under the cursor when it can be taken — to close a
  profile with or to hang relations and dimensions on. What projects: a
  straight edge, a circle flat to the plane or square to it; a circle at a
  slant is an ellipse and is not offered. A projection is taken once and
  does not follow a later edit of the body. **Extrude** on a flat face's
  chips pulls the face as it stands: the outline becomes a sketch, the
  extrude opens on it, joining outward and cutting inward as the arrow is
  dragged (until a result is chosen by hand), and Cancel takes the sketch
  back too. **The look of a CAD viewport**: the bodies are drawn solid
  with their **edges** — thin (1.1 px), near black, tested against the
  depth buffer so the far side's edges stay behind the body, the faces
  pushed back a hair so a line on a face wins — and the **scan is a
  see-through veil** over them once there is a body; the view bar's Opaque
  key turns that round. An edge hidden behind a solid body is not picked
  either. **A feature on a body previews as the body it will leave** —
  solid, with its own edges, in the body's place (the body stays there for
  the picks) — so a fillet is seen as the round it will be rather than as
  a shade inside a see-through block; a cut's tool, inside the body it
  cuts, is drawn through it. The edges are also drawn a little nearer the
  camera than they lie (four chords of the body's tessellation, in view
  space): an edge and the faces beside it are tessellated separately, so
  on a round face the line dipped under the surface between their shared
  points and a fillet's rim was drawn as dashes. **Extrude to a face, to
  next, to last**: *To a face of a body* takes a flat face clicked on the
  part; *To next* runs until the profile first meets the body it joins (or
  any body, for a new one) and refuses a profile the body does not wholly
  cover rather than letting the rest run on, and as a cut goes through the
  first wall met; *To last / through all* runs to the body's far end, a
  hair past it for a cut. Reverse direction looks the other way, and a
  reopened extrude is measured against the body as it stood before it.
  Fillet and Chamfer show their **Tangent
  propagation** switch (on, as before) and light the edges the chain will
  reach in a lighter green before the kernel is asked. Fixed: a plane list
  inside a field label opened again the moment an option was taken (the
  label passed the click on to the picker's face) — Extrude's *between two
  planes*, *up to a plane*, Cut by plane, Mirror; and a failed feature's
  reason pushed its row out of the panel — the row says *failed*, the
  reason wraps underneath. Tests: `reProject`, `reSnapFace`, the draft and
  the moved face through the kernel in `reFeatures`, their boxes, the
  pulled face, the projected sketch and the snap's route in
  `reFeatureDraft`, `reSnapEdit` (a filleted block's wall moved with its
  round, through the kernel), the three new extents in `reFeatures` (907 in
  all); `scripts/e2e-reverse-cad.mjs` (27 checks) models a block 2 mm
  short, snaps its top onto the scan from one click and a rounded wall by
  its sketch line.

- **Reverse engineer: the surface route, part one** (milestone 5, phase D).
  **Fit surface** fits a smooth freeform surface through a region of the
  scan: the region is gathered by **clicks that flood** from the face
  under the cursor over every edge whose normals turn by less than an
  angle (1° to start — one face of a CAD-like part, a patch of a scan up
  to its first crease; Ctrl-click takes a flood away), or **marked with
  the tools** — brush, window, lasso — the same as a surface in Measure;
  it is the surface's own and may overlap a neighbour's at a seam. The
  fit is a degree-3 B-spline over the region's principal plane with a
  control net sized from the region (or typed), **Expand by** (35 % to
  start) reaching the surface past the region so the trim can meet its
  neighbours, and a **Smoothness** that fairs the scan's noise without
  flattening a real curvature or the reach beyond the data. The box
  reports the fit's σ, worst residual and net, the live map colours the
  scan against the surface as it does against any ghost, and the result
  is a body marked *surface* — trimmed with the others into a solid, never
  exported on its own. **Trim** closes a set of surfaces into that solid:
  fitted surfaces, sheets, solid bodies and measured planes, cylinders,
  cones and spheres, each reaching past the part, cut a box round the scan
  into faces; the faces **lying on the scan** — within a tolerance read
  off the surfaces' own fits (three times their median σ), over an
  overlap share of their samples — are kept and sewn. Closed, the result
  is a solid like any other (fillets, shells and the rest work on it, its
  faces named by the surfaces that made them); not closed, it is a
  surface body of the kept faces with the **open edges drawn red** on the
  part and counted in the box, until the missing surface is fitted and
  taken into the set. And a **Torus** element in Measure: one click on a
  round — a fillet, a bend, an O-ring seat — fits the tube and the ring it
  runs on (the fillet's R is the tube's radius), a quarter round between
  two flats as readily as a whole ring, with the same clipped Gaussian fit
  and region growing as the other kinds; it enters the trim's set, is
  extracted as a ring body, measures a deviation map like a cylinder,
  stands in as an axis, and exports to STEP as a toroidal solid.

- **Reverse engineer: verification and the first project** (milestone 4's
  remainder). **Compare in Deviation** hands the visible solid bodies to
  the Deviation workspace as its reference — meshed afresh at a 0.01 mm
  chord, named *Bodies from Reverse engineer*, carried in a saved project
  like any reference — and measures the map at once under the **identity:
  no best fit is run**, since the bodies were modelled on this scan in its
  frame and a fit would spread a modelling error over the whole part. The
  panel and the clipboard report say "none — built on this scan" where a
  fit deviation would stand; *Align automatically* still fits it for
  whoever asks. A new **Mirror opens on the scan's own symmetry plane** —
  one already measured in Measure, else the same mirror registration run
  from the principal planes while the box is open, accepted within 0.1 mm
  RMS over half the samples and refused by name otherwise; *Keep as a
  plane element* makes it a Measure plane. The **first sketch on an
  unaligned part** says the body will be built in the scanner's frame and
  leads to *Align part*, the sketch carried along. The empty workspace
  offers a **first project with a sample part** — an L-shaped bracket made
  in the app, askew as a scan lies — and four steps that tick themselves
  off: align, click a face, fit and finish, extrude.

- **Reverse engineer: the features on a body** (milestone 3). **Shell**
  (the faces to open clicked on the part, or none for a closed hollow
  body; the wall from the Thickness map's reading when one was measured), **Fillet** and **Chamfer** on
  clicked edges with the round running on along tangent edges and the
  fillet's radius **read off the scan** across the first edge — a section
  square to the edge, the corner's profile fitted as flat, arc tangent to
  both faces, flat, one unknown — **Hole** along a cylinder or circle
  element or a round face of the body, **Extract** of a measured plane,
  cylinder, cone or sphere as a body, **Cut by plane**, **Mirror** about a
  plane or a flat face, and **Combine** of two bodies. Faces and edges are
  picked in the viewport: they light under the cursor, the bodies not in
  play are dimmed, and the picked ones stay lit; with no box open a click
  on a body's face or edge selects it and the chips offer what it can
  become. A pick is stored as a **fingerprint** — the kind of surface or
  curve, its middle, direction, size and the feature that made it, the
  last carried across every step through the kernel's own history — and
  found again on the rebuilt body after an earlier dimension moves; a pick
  that is gone fails its feature by name and the rest build. A feature
  reopened for editing is shown on the body as it stood before it, its
  picks lit where they were made, and previewed there. The **key number in
  a feature's row is a field** — an extrude's distance, a revolve's angle,
  a shell's wall, a fillet's radius, a chamfer's distance, a hole's
  diameter, a slab's thickness — typed over and the features rebuild, no
  box opened. The **features are saved in the project** by reference and
  the bodies rebuilt on load once the kernel is up. An extrude takes a
  **draft angle**: the sides lean in along the normal, a moulded boss's
  draft, negative to lean them out. The acceptance script on the fridge
  bracket now passes its bar — a closed STEP solid within 0.065 mm of the
  scan at the median — once the part is aligned along its channel.

- **Reverse engineer: the cutter operations** of the surface route.
  **Sheet** extrudes a sketch's pieces, open chain or closed, as a surface
  — a body of its own marked as a surface, never exported alone, the live
  map showing where it lies on the scan; **Split** cuts a body by sheets
  and keeps the fragments lying on the scan (sampled against the scan's
  own triangles in the kernel worker, within a tolerance, over an overlap
  share — the fragment of a pocket has the pocket's roof where the scan
  has its floor, and falls out), or the largest or smallest; **Loft**
  through two or more sketches, ruled or smooth; **Pattern**, circular
  about an axis or linear along one, the copies one body.

- **Reverse engineer: the live deviation map.** While an extrude or a
  revolve is being set up, its ghost **colours the scan near it** by the
  scan's signed distance to the ghost's surface — green on it, red where
  the scan stands outside the body, blue where the body has swallowed it —
  on the Deviation ramp at ± the range in the box (0.1 mm to start,
  remembered between sessions), a dark cap past either end, and the scan
  further than ten ranges from the ghost left as it was. The map follows
  the grips a moment behind the ghost, the box counts how many of the
  scan points near the ghost lie within the range, and a legend beside
  the viewport reads the ramp; a switch in the box turns it off. The view
  bar's **Deviation** key reads the scan against the committed bodies the
  same way. It is the Deviation workspace's nearest-point machinery on the
  ghost's own tessellation and the scan's vertices near it, run in the
  kernel worker, so the Deviation workspace's reference is untouched.

- **Reverse engineer: from scan to body without a mode you did not ask
  for** (phase A of the plan). **Click a face of the scan** and a sketch
  opens on a plane fitted through it, its slice the outline of the part
  just under the face; the plane list stays as the fallback. The moment a
  region closes on the sheet the sketch box offers **Extrude** and
  **Revolve**, which finish the sketch and open the feature on it with the
  region picked. **Finish sketch** is the sketch's one exit, at the top and
  the bottom of the box — there is no Cancel and no prompt: Escape only
  puts the tool down, Finish on an empty sketch makes nothing, and an
  unwanted sketch is taken back with **Ctrl+Z**, which now walks the whole
  feature list (Ctrl+Shift+Z or Ctrl+Y forward), a redone feature keeping
  its name and id. **Ctrl** switches snapping off for a click or a drag, as
  in Fusion (Alt stays what it is elsewhere in the tool); **Snap to grid**
  is a key by the sketch tools, off by default, so the grid is there to
  read against unless asked for. The sketch's status reads **Needs input**
  or **Solved**, with the solver's words — unmet, redundant, the RMS — in
  the tooltip, and a line drawn within 3° of level or upright is made so,
  the relation shown as a **chip** that one click takes off. Every measured
  number — a dimension, an extrude's From, To and Total, a revolve's angle
  — offers its **round value** as a chip (halves under 10 mm, whole
  millimetres above, radii to the half, angles to 5°). A **field on the
  grip** shows the number while the grip is dragged and takes typing once
  the hand lets go. With no editor open a click on the part is object
  first: a sketch's region offers Extrude and Revolve as chips by the
  click, a line or an element with an axis offers Revolve about this, and
  the elements light under the cursor while they are on offer, as they now
  do while a revolve asks for its axis. Feature rows read the key number
  beside the body operation — 10 mm, 360° — and a double click on any row
  opens it.

- **Reverse engineer workspace, milestones 1 and 2** — a fourth workspace
  that turns the scan into a solid body CAD opens as one. Modelling runs on
  Open CASCADE Technology compiled to WebAssembly (`occt-wasm`, pinned),
  fetched in its own worker only when the workspace is first entered and
  kept behind a small adapter naming the dozen operations used; a browser
  without WebAssembly tail calls is told why the workspace is unavailable
  and keeps the rest of the tool. **Sketch** on a section, a fitted plane or
  a coordinate plane through the part: the slice the plane cuts through the
  scan is drawn on the 2D Measure sheet, **Fit all chains** cuts every chain
  into lines and arcs that keep their slice points, **Infer corners** joins
  ends within 2 mm and adds a tangency where a line runs into a fillet,
  **Close** bridges what stays open, and every closed region is filled
  faintly. The sheet wears a millimetre grid whose spacing follows the zoom.
  Free geometry (line, rectangle, circle, arc) is drawn beside the fitted
  pieces under a crosshair, follows the cursor between its clicks, and snaps
  — to ends, to the slice, to pieces, to the grid, each with its own mark;
  Ctrl places a point raw. With Select, an end, a centre or a whole piece can
  be **dragged**: the point snaps the same way, the constraints hold (an end
  of a horizontal slides along it), a point dropped on another's end is
  joined to it, and a fitted piece dragged by hand lets go of its slice
  points. **Align** turns the sheet so a selected line lies along its X,
  the frame turning underneath. One constrained least-squares solver holds every
  fitted piece to its points while relations (join, H, V, ∥, ⊥, tangent,
  concentric, symmetric) and typed dimensions (length, radius, distance,
  angle) are met exactly; a dimension that fights another is reported as
  unmet rather than split, and a redundant relation is counted. A created
  sketch is drawn on the part in its plane. **Extrude** and **Revolve** are
  set up the way Fusion and Onshape do it: the sketch's closed regions show
  on the part as faces to click for the profiles (a sketch with one region
  has it picked already; an unpicked inner loop becomes a hole), the body
  shows as a see-through ghost the kernel rebuilds as the numbers change —
  red for a cut — with an arrow on each face to drag an extrude's distance
  and a ring about the axis to drag a revolve's angle, and the box reads the
  ghost's volume. An extrude reaches by a distance, to a plane, between two
  planes or symmetrically; a revolve turns about a line element, a
  cylinder's axis or a sketch line, clicked on the part or chosen in the box;
  each makes a new body or joins or cuts one made before. Every plane and
  axis list shows the option under the cursor on the part with its name —
  a sheet through the scan, a line across it — so "Plane 2" is a place. The
  elements and sections measured in the Measure workspace are drawn on the
  part in this workspace too, behind an **Elements** key in the view bar,
  and an **Opaque** key draws the bodies solid with the scan still there.
  Feature rows read the type and what it stands on — the plane, the body
  operation — with the counts in the tooltip. A sketch is **drawn on the
  part**, the way CAD sketches: the sheet lies over the 3D viewport, whose
  camera turns to face the sketch plane when the sketch opens — a
  half-second swing from wherever it was, so it is plain where the plane
  sits — follows every pan and zoom of the sheet, and is **cut open at the
  plane** where the plane runs through the part — the cut closed with a
  solid cap, so the section reads as a body and not as a shell looked into
  — with the plane's outline
  and the sketch's name on it; the view bar's **Model** and **Slice** keys
  put the part away and show it whole. A **middle click** creates the sketch, the
  extrude or the revolve, as it confirms everything else in the tool, and
  Enter and the middle click ask the same readiness. An extrude has a
  **Reverse direction** key that turns it over. Tab walks from one number
  to the next, past the ⓘ dots and the × keys. A drag on the sheet keeps
  up with the hand: it is solved once per frame at the hand's latest spot,
  with a short solve during the drag and the full one on release, and the
  regions are found again on release rather than every frame. A line dragged by its body
  moves **square to itself** (Ctrl frees it), and the relation glyphs sit a
  few pixels beside their piece rather than on it, so the piece can be
  taken hold of where the glyph was. A sketch edited under an
  extrude or a revolve keeps the feature's profiles: a pick is a
  fingerprint of a face — its pieces and where its middle was — that finds
  the face again after a corner is dragged or a side replaced, instead of
  the feature failing with "no longer closed". Features rebuild
  in order on every change and a failed one says why in its row; bodies are
  listed with their volume and drawn see-through over the scan, solid once
  the view bar's **Scan** key puts the scan away. **Export body STEP** writes
  every visible body as solids. The bracket acceptance script
  (`e2e-bracket.mjs`) is in the repository and fails, by design, at the
  shell and fillet steps of milestone 3.
