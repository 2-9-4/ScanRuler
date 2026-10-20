# Changelog

What changed in ScanRuler, newest first. The number a build reports in the top
bar and the imprint is the entry it belongs to; the `.scanruler` projects it
saves carry the same number as `appVersion`. How a release is cut is in the
README under "Releases".

## 0.6.2 — 2026-10-20

- **A scan checked before modelling** (2026-10-19). `scan.qa` gives in one
  call the scan's open rims, its noise, and how thick the part is along an
  axis: how far faces that should be parallel are apart and which way the
  part thickens, with notes on what looks wrong. A plate scanned with its
  faces 1.3° apart now says so at the start.
- **Heights in one call** (2026-10-19). `scan.heightmap` gives the first
  surface met looking along an axis over a grid: a small grid of heights,
  empty where nothing is hit, and on request a picture coloured by height
  with a scale. Looking up from below reads ceilings and the underside.
- **Several cuts in one picture** (2026-10-19). `section.render` takes
  `offsets`: up to nine parallel cuts side by side, on one frame and scale,
  each labelled with its offset.
- **Fits that know which surface is meant** (2026-10-19). `element.fit`
  takes `side` (the inside of a bore or cup, or the outside of a boss),
  `radius` (a range), `axis` (a direction guess) and `within` (a box). A
  seed near a rim no longer takes the wrong surface, and a fit that finds
  none as asked names the radii it saw. `align.datum` says which
  coordinates its origin set, and where the origin point stands when the
  datums own the rest.
- **Nothing waits for good** (2026-10-19). A command that has not finished
  after 10 minutes, or its own limit, is given up on with the error code
  `timeout`: its undo step ends and the next command runs. A worker request
  can carry a time limit that starts once the requests ahead of it are
  answered. `session.state` says which command is running, since when and
  for how long.
- **scanruler-mcp: status that says what holds it** (2026-10-19).
  `scanruler_status` says when the tools a chat was given are no longer the
  ones the page offers (`tools.stale`, with what was added or removed —
  start a new chat). A server copy with no jobs says when it started and
  that an earlier copy's jobs are not known. A call dropped because the
  page or the server copy holding the link went away says the change may
  still have been made, and to read `session_state` before running it
  again.

- **Deviation pictures say what they painted** (2026-10-19). A full-part
  picture in the Deviation workspace could come out grey with nothing to
  say why — the map switch is kept in projects and no command could read or
  set it. `deviation.settings { show }` switches the map, the state reports
  it (`settings.show`), and `view.render` there answers `map` (the side,
  colour map and range painted) or `map: null` with `mapWhy` (switch off, no
  map measured, the reference side not measured, the reference put away, a
  split view, readings that do not fit the scan), and `mapNote` when the
  reference drawn over the scan dulls the colours. Renders and other
  commands wait for the map on the reference as they do for the scan's.
- **A plane cut for a picture alone has a sheet you can read**
  (2026-10-19). `section.render { plane }` laid its cut on any two
  directions square to the normal, from the point given: on the ZX plane
  u ran along −Z and v along −X, so a frame read off a section came out
  empty. It now lays the cut as a sketch on that plane has it — zero at the
  world origin's foot, u along the next coordinate axis round — so on a
  coordinate plane [u, v] are world coordinates.
- **scanruler-mcp: every picture in a batch is a file** (2026-10-19). A
  render inside `scanruler_batch` without a `path` lost its picture; it is
  now written to the output folder under a numbered name, and the call's
  result names it.

- **The deviation map on the reference** (2026-10-19). The map on the scan
  says where the scan stands off the reference, and nothing where the scan
  has no surface: reference material the part has not — a boss the part
  lacks — shows at best where it meets the wall, and reference surface
  nothing was scanned at never shows. The Deviation workspace now reads it
  the other way round too: the view bar's **On reference** key paints the
  reference by its distance to the scan, positive where the reference
  stands outside it, grey where no scan stands behind it, a reading past
  the search distance in the cap of its end. The reference is cut finer
  for it (`core/deviation/onReference.ts`: each triangle in rows about the
  spacing apart, so a long sliver costs its area, not its length), each
  vertex read off scan surface that faces its way and lies square under
  it — the far skin of a thin wall and the rim of a hole in the scan are no
  evidence. Measured on asking, kept beside the scan's map, gone with the
  alignment. For agents: `deviation.settings { on: "scan" | "reference" }`,
  the state's `onReference` (the share of the reference's area the scan
  stands behind, within tolerance, past the search distance and with no
  scan behind it, and the readings' statistics), and `deviation.hotspots
  { on: "reference" }` — its patches, `far` by side and `noScan`, the
  reference with no scan behind it, in patches.
- **Draft read off the scan** (2026-10-19). `scan.draft { pull, box?,
  nearDeg? }` gathers the scan's walls that run near a pull direction into
  patches, each with the angle it leans off the pull (positive lets go
  along it, negative is a back draft), its standard error and spread, area
  and which way it faces; walls are parted where the way they face jumps,
  so a box's four sides are four patches and a boss's round side one
  (`core/fit/draft.ts`).
- **Several views in one picture** (2026-10-19). `view.render { views }`
  takes two to six standard views, each fitted and named in its corner,
  laid side by side in one PNG — one look for an agent in place of four.
- **Pictures written and not shown** (2026-10-19). scanruler-mcp's picture
  tools take `inline: false` with `path`: the picture is written to the
  file and the answer says where, without the image — for the pictures an
  agent only delivers.
- **A section's picture names its world axes** (2026-10-19).
  `section.render` labels the grid in world coordinates where the sheet's
  u or v runs along a world axis, names the world direction across and up
  in the margins, and answers `axes` (per sheet axis the world axis it
  runs nearest, how far off it turns, the world coordinate at its 0).

- **scanruler-mcp 0.3.0** (2026-10-19) — the version for what the server
  gained since 0.2.0, the copy on npm: ScanRuler headless in the server
  (`--engine`, `--headless`), the compact tool list (`--tools compact`),
  batches that stand or fall whole, long changes as jobs, the trace of a
  run (`--trace`), and the tab's command list as of 0.6.1 for the tools it
  lists before a tab has connected.

## 0.6.1 — 2026-10-18

- **A probe of the tab hidden for real** (2026-10-18).
  `scripts/e2e-agent-hidden.mjs` runs an agent's round of calls — the scan
  queried, a sphere fitted, the view turned and pictured, a section cut and
  pictured, the steps undone — in a Chrome window on the screen, first in
  front and then minimised, which Chrome counts as hidden (no frames,
  timers held to a second and, after five minutes, to a minute; it waits
  `HIDDEN_WAIT`, 330 s, before the hidden round). It passes when no call
  hidden takes more than twice as long as in front, or half a second more,
  none stalls, and the status and the trace say hidden. `launchApp` in
  `scripts/e2e-lib.mjs` takes `headless: false` for a real window.
- **A sloped or curved patch measured** (2026-10-18). `scan.fit_surface
  { vertices | box, normal?, model? }` fits a patch of the scan — a sloped
  side, a twisted ruled face, a dome, a saddle, a fairing — as a height over
  its own best plane (`src/core/fit/heightSurface.ts`): a plane, a bilinear
  patch (a twisted face) and a full quadric, each with its coefficients,
  RMS and worst miss in the patch's frame, given in the frame the part is
  measured in now; the quadric also with its principal curvatures, their
  radii and directions and the shape they make (flat, cylinder, dome,
  saddle). With `model: "best"` (the default) every one is fitted and the
  simplest whose RMS is within a tenth of the lowest is named. A sphere's
  cap of R50 reads a dome of R50 ± 2, a cylinder's strip of R30 a cylinder
  along its axis, a twisted face bilinear.
- **A picture of a section, with the gap in red** (2026-10-18).
  `section.render { section, frame?, tolerance?, layers?, width?, height? }`
  draws a section as a PNG for an agent checking a slice: the scan's cut as
  points on the section's sheet (+u right, +v up, as `section.get` gives
  them), a grid in millimetres with its values at the margins, a scale bar,
  and what the workspaces' layers draw over it — outlines, such as a
  model's cut by the section's plane, and labelled pieces, such as a
  sketch's with their ids. Each scan point within ten tolerances of an
  outline is read against it: grey on it, red off it by more than the
  tolerance (the Deviation workspace's by default); the answer counts them
  (`gap`: read, over, outside and inside a closed outline, max, rms, and
  the box round the red to frame the next look) and gives the picture's
  `map` from pixels to sheet places. It is a picture tool, so
  `--tools compact` lists it. Workspaces add layers with
  `registerSectionLayers` (`src/commands/sectionLayers.ts`, exported from
  the plugin API) — the app draws the scan, a layer what it holds. In place
  of a section, `plane: { origin, normal }` cuts the scan there for the
  picture alone — no section is made, no undo step — and the answer gives
  the sheet's axes; `pictureOfSheet` and `sheetThrough` do the same for a
  workspace's own pictures.
- **What finished, said once; timings on any change** (2026-10-18).
  scanruler-mcp's `scanruler_wait { for: "idle" }` now waits for the
  changes still running as well as the tab's own work, and answers
  `finished`: every change done or failed since it last said so — a failed
  one with its error code and message, a batch with the call it stopped at
  — each once, a change the client was answered directly left out unless it
  ran past a minute (a client's wait). Every tool that changes the session
  takes `timings: true`, as a batch did: the answer adds the call's `ms`
  and the steps its build played (`steps.played`), which the server
  otherwise drops; inside a batch the batch's own flag decides.
- **A trace of an agent's calls, to measure a run** (2026-10-18).
  scanruler-mcp's `--trace <dir>` (or `SCANRULER_MCP_TRACE`) writes a line
  per tool call into a new file per session in `<dir>`: when it started, the
  tool, how long it took, bytes in and out, the error code of a refusal, the
  pictures, and whether the tab was hidden at its start and end. A batch's
  entries get a line each under the batch's call, a change started with
  `wait: false` a line when it finishes, `scanruler_wait` what it waited for
  and how many changes were running behind it, and the tool list each time
  it is handed out its size; the tab hidden or shown again is a line too, a
  second copy of the server sending its calls through the first included.
  Off unless asked for, written on this computer only, and arguments only as
  their size unless `--trace-args` is given. `scanruler_status` names the
  file (`server.trace`). `node scripts/trace-summary.mjs <dir>` sums a run up:
  how much of it was ScanRuler working and how much the agent, over how many
  turns, and per tool the calls, batched calls, refusals, total and p95 time
  and kilobytes each way (`--json` for the numbers).

- **A skill for measuring a scan through an agent, and a test that skills
  name only real tools** (2026-10-18). `skills/scan-measuring/` is a skill an
  agent loads to measure a 3D scan through scanruler-mcp: `SKILL.md` the
  workflow — open the scan, read the session, fit, dimension, align, cut
  sections, compare, check thickness, report — with a table of red flags
  (what a symptom means and what to do), `reference.md` every tool's input
  in short with an example, the cost of the answers measured on a real scan
  (`session_state` 20 kB, `scan_query` at 5,000 points 256 kB, a picture at
  800 px 640 tokens and at 1,400 px 1,950), and the errors with their fixes.
  `tests/skillNames.test.ts` reads every skill in `skills/` and the MCP
  server's instructions and fails on a tool name in the app's namespaces or
  the server's own that is no tool — a command renamed or taken away that a
  skill still teaches.
- **Every command fed junk** (2026-10-18). `tests/commandHostile.test.ts`
  feeds every command the app registers, with a scan open, each of its
  input properties in turn set to null, NaN, ±Infinity, -1, 1e308, the
  empty string, a megabyte of text, an empty list and object, an object
  nested 5000 deep and values of the wrong type — on the least input the
  command otherwise takes — and each of them as the whole input: every
  call must refuse with a CommandError or answer, never throw anything
  else, never hang, and never refuse with a fault of its own (the registry
  hands on whatever a command throws as `failed`; a message that is a
  TypeError's or a stack run out counts as one). The sweep is
  `tests/hostileKit.ts`, which a plugin runs over its own commands too. It
  found nothing: 2,040 calls, 37 of them answered, the validator refusing
  most of the rest and the commands the others.
- **Batches that stand or fall whole, long changes as jobs, and a hidden
  tab that does not stall** (2026-10-18). `history.checkpoint` marks where
  the undo history stands and `history.restore { checkpoint }` undoes every
  step made since, refusing — undoing nothing — when the mark has been
  undone past; both run headless too. scanruler-mcp's `scanruler_batch`
  uses them: stopped at a refused call it undoes what the calls before it
  changed (`rollback`, on by default) and names `failed: { index, tool,
  error }` and `undone`; `timings: true` adds each call's `ms`, `total_ms`,
  and the steps a change's build played with their milliseconds, which a
  change's answer otherwise leaves out (`steps.played`). Every tool that
  changes the session takes `wait`, and the server runs each such call as a
  job: `wait: false` answers `{ queued, job }` at once, `scanruler_wait {
  for: "job", job }` gives the answer, and a call the client stopped
  waiting for keeps running, listed by `scanruler_status` with its answer
  kept. A hidden tab — in the background, covered, the screen locked —
  draws no frames and has its timers slowed to once a minute, which stalled
  every command that waits on the screen or for the session to settle: a
  wait now looks again whenever one of the session's stores changes (the
  command host names them; a plugin names its own to `registerBusy`), with
  the timer as backstop only, and a frame waited for while the tab is
  hidden is a task's turn (a MessageChannel's, which is not slowed) and
  then one drawn by hand (`SceneManager.pumpFrame`). The page tells the
  server when it is hidden or shown again, and `scanruler_status` gives
  `page.hidden` with a note on browsers that unload background tabs.
  Tests: `commandWaits` (a wait answered by a store change with every timer
  stopped, and by a store a plugin named; the timer still times out; a
  hidden page's frame drawn by hand, a shown one's by the browser), and the
  server's `jobs` (a batch refused part way undone back to its start, not
  with rollback false, nothing marked for a batch that reads; timings;
  wait: false answered at once and read by its job, a refused one as its
  error, a batch too; a call past the client's timeout kept and read; the
  tab hidden and shown).
- **ScanRuler headless, inside the agent's server** (2026-10-18). An agent
  could reach ScanRuler only through a tab in a browser — which stalls when
  the tab is in the background or the screen locked, and which one agent's
  subagents had to share. Now `npm run build:engine` builds the app for
  Node into one module, `dist-engine/engine.mjs` (`src/headless/engine.ts`:
  the session with no viewport, its mesh worker in the same thread, the
  commands registered and the plugins installed), and `scanruler-mcp
  --engine <file>` — or `--headless` for the checkout's own build, or
  `SCANRULER_ENGINE` — runs it in its own process in place of the page. The
  server finds the engine by its path and names nothing in it. Only the
  commands marked to run without a page are offered (`headless: true` on a
  command: `session.state` and `history.undo`/`redo` in the app itself);
  any other answers `unavailable`, naming the page mode, and the server
  turns away a call to one by name the same way. A plugin starts what its
  headless commands need through a new extension point, `headless()`, after
  `install()`. The server's instructions say it runs headless,
  `scanruler_status` gives `backend` (`page` or `headless`) and the
  engine's path, `scanruler_open` has nothing to open, and stdout stays the
  MCP channel's alone — the app's logging and the kernel's own reports go
  to stderr. One engine to a process, so two servers started headless share
  nothing. Tests: `headlessEngine` (only commands marked headless offered,
  every command one or the other, a page command refused naming it, one
  engine a process) and the server's `engine` (status, instructions, the
  engine's tools run in it, a file written by path, a page tool and a batch
  call to one answered unavailable, an engine looked for where it is not or
  a module that is none refused).
- **A compact tool list for small local models** (2026-10-17).
  scanruler-mcp lists every command the tab offers as a tool of its own:
  over a hundred tools and some 50k tokens of schema at scanruler.com,
  read before the conversation starts. A local model with a 128k window ran
  out of room after three tool rounds and chose unreliably among so many.
  `--tools compact` (or `SCANRULER_MCP_TOOLS=compact`) lists seven, about
  3k tokens: the server's four, `scanruler_tools`, and the tab's tools that
  return a picture, `view_render` and `flat_render`. Those are listed so
  the model calls them directly and sees the picture, which a batch gives
  only as text; which tools they are is read off each command's own mark,
  and a tab with another one has the client list the tools again.
  `scanruler_tools` with no arguments gives every tool's name and title, a
  line each. With `names` it gives those tools' definitions as the full
  list has them, up to 20 at a time, and names it does not know in
  `unknown`. It reads the connected tab's list when called, so it follows
  the tab. The other tools run through `scanruler_batch`, one call as a
  batch of one, and a direct call to one not listed still runs. The
  server's instructions say so in this mode, and `scanruler_status` gives
  the mode (`server.tools`). The full list stays the default. Tests: the
  server's `mcp` (the five and each picture tool listed, nothing else; the
  list names every command and follows the tab that connects; a tab with a
  new picture tool has the client told the list changed; `names` gives the full list's
  definitions and reports unknown names) and `main` (the option, the
  variable, a mode refused).
- **An agent can work the 2D sheet without seeing the stage** (2026-10-14).
  An agent asked to sort a flatbed scan of inserts by size and tooth count
  had no picture of the sheet, no way to name an edge but to click near
  it, no word on whether a pick had snapped, and no way to label or remove
  what it made. New and changed commands:
  - **`flat.render`**: a picture of the sheet. It is drawn afresh as the
    sheet lies — in its own units, +X right, +Y up, whatever the stage's
    alignment or turns — with a grid ruled in those units and its values
    written at the margins. The answer's `map` takes a picture pixel to a
    sheet place, so a place read off the picture goes straight back as a
    click. `frame` zooms in on a box. `show` puts in or out the image, the
    edges with their chain numbers, the elements, counts and alignment, the
    dimensions, the notes, the labels and the grid. `view.render` now
    refuses while the 2D workspace has the screen, where the 3D view is not
    drawn, and points to `flat.render`.
  - **Edges by number:** `flat.edges` lists the detected chains — length,
    closed or open, the box round them, and a polyline thinned to a
    tolerance. It can take them nearest a place first, inside a box, or
    long ones only. `flat.fit` takes whole chains (`chains`) or every edge
    point in a box (`box`), by the kind's edge method.
  - **Picks:** a pick answers where it landed and on which chain it snapped
    (`picks`). `snap: false` leaves it where it was put; `reach` sets how
    far it looks for an edge. A seed or edge click that finds no edge now
    says which chain is nearest, how far it is and where.
  - **Notes, changes and removals:** `flat.note_add` writes a text note on
    the sheet. `flat.edit` renames an element, dimension or count, gives a
    note new text or a new place, and shows or hides any of them.
    `flat.remove` takes any of them away as one step. Text notes now appear
    in the report, and the SVG and DXF exports write them as text on the
    labels layer. The 3D element commands, asked for a name that is only
    on the sheet, say so.
  - **Parts and teeth:** `flat.objects` finds the separate parts on an
    image by grey level and numbers them in reading order. For each it gives
    the area, holes, box, centroid, equivalent diameter, the largest and
    smallest caliper widths, the long axis and the edge chains along its
    outline. `flat.profile` reads an outline — a part's or some chains' — as
    radius against angle about a centre, or as distance against position
    along an axis, side by side. It counts the peaks by prominence and gives
    the pitch and the envelope (radial also as diameters). `mark: true` puts
    a count on every peak, to check by eye.
  - **`session.state`'s `flat`** now gives the sheet's extent and where its
    origin is, the edges (status, chains, sensitivity), each dimension's
    value, the notes and the counts. The alignment is given in sheet units
    (`alignment`) where the picks were in pixels (`datum`).
- **A project's name, and New Project** (2026-10-14). The top bar has a
  field for the project's name, beside the workspace tabs: typed in place,
  Enter or leaving the field takes it, Escape puts it back. It is kept in
  the project file (`name` in `project.json`, absent while unnamed), and
  it names the file Save Project writes, every export — the elements' STEP
  and STL, the point cloud, the 2D sheet's files where no section names
  them, a rendered view — and the browser tab. Unnamed, all of that goes
  by the scan's name, or the image's, as before; a name is kept whole, a
  dot in it no extension, with what a file name cannot hold made a dash.
  A scan opened into a named project keeps the name. **New Project**, next
  to Save and Load, starts over in the workspace on screen: the scan, the
  reference and the image closed, every measurement and every workspace's
  work let go, the settings back to the app's own and the name taken off —
  what opening an empty project does, the blank one made from the stores'
  defaults (`blankManifest`) — asking first when there are changes not
  saved. Commands: `project.rename { name }` (empty takes it off),
  `session.state` reads it as `project.name`, the report carries it, and
  `session.reset` takes it off with the rest.
- **The camera turns smoothly, and keeps the view it was given**
  (2026-10-14).
  - **A turn about the part:** a turn to a pose (`animateLook`) set out
    about the camera's target, which orbits about the cursor can leave far
    in front of the part or behind it, so the part swung out across the
    screen and back. The target is now slid along the line of sight level
    with where the turn lands first — nothing changes on screen, the
    projection being parallel — and the part turns about a point at its
    own depth.
  - **A goal moved under way:** a view that follows another and changes
    its goal while a turn is under way (`retarget`) jumped by the share of
    the way already gone; the turn now bends towards the new goal from
    where it has got to, on the same clock.
  - **Framings take the turn's place:** a framing, a standard view or a
    roll lands where it was asked, rather than being written over by a
    turn still under way.
  - **A followed sheet gives the view back:** the viewport that follows a
    2D sheet laid over it goes back, in a short turn, to the view it was
    in when the follow began, once the sheet is put away; the same frame
    asked for again moves only where the turn lands. A sheet laid again
    over new bounds flies to them (`frame(ms)`, `setBlankSheet(…, flyMs)`)
    and the view under it with it, rather than both jumping.
  - **A stage with no scan:** a layer that stands in for the scan, grown
    past what the camera last framed, had the camera jump to a fixed view
    from above with Y up. It now flies out to take the part in, looking
    from where it looks (`flyToFit`), and only when the part reaches off
    the screen (`boxOnScreen`) — a close look at a detail is left alone
    (`LayerHost.takeIn`). The stage's first framing is the iso view, front
    top right with Z up, as the iso key turns to.
- **A tool's slice cuts the layers' parts** (2026-10-14). A tool's slice
  cut only where the plane ran through the scan's box, so on a stage with
  no scan — or past the scan's end — it cut nothing. It now cuts wherever
  the plane runs through the scan or what the layers draw.
- **Diameter dimensions on the 2D sheet** (2026-10-14). `DimShape` has a
  `diameter`: the line through the centre at an angle, rim to rim with an
  arrow on the rim at each end pointing out at it — in at it from outside on
  a circle too small for both — the number in a gap of the line inside the
  circle, or outside at the end of the line carried on to it.

## 0.6.0 — 2026-10-14

- **Grips held on the screen** (2026-10-13). A grip a plugin puts on the
  part can keep its size on the screen as the view zooms: `PluginGrip`
  takes `pixels`, with `size` — and `standoff`, how far an arrow stands
  off its point — in pixels, the viewer scaling it each frame ahead of the
  hover pass (`ExtendGrips.followView`). The number field on an arrow
  stands off its tip the way the tip points on the screen, its edge a few
  pixels past it, rather than at a twentieth of the model from its base,
  inside a long arrow. A row of the element list takes a key of its
  owner's in the eye's place (`ElementRow` / `RowTools` `eyeKey`), for a
  row whose thing is switched some other way than shown or hidden.
- **Section view** (2026-10-13). **Section** on the view bar cuts
  everything on the stage open at a plane to look inside — the scan, the
  reference, the elements, dimensions, sections and pinned readings, a
  label going with what it labels — taking away the half toward the
  camera. It opens across the coordinate plane most square to the view,
  through the middle of the part; the row above the key lays it across the
  XY, YZ or XZ plane or an element with a direction, holds its coordinate
  or offset, and **Flip** takes the other half; on the part, the arrow and
  rings a section is set up with slide and tilt it. A shell with no hole in
  it is closed where it is cut, with a flat cut face in a colour per part —
  clay for the scan, blue for the reference — found by edge parity
  (`core/geometry/closedShells`); an open scan stays a shell, and a
  see-through part is cut but not closed. Picks hold to what is drawn: a
  ray meets nothing on the half cut away, nor anything behind a cut face
  (`viewer/clipRaycast`, for every mesh, a tool's slice included). The split
  view's reference half is cut at the same plane. A tool's own slice stands
  in front of the section view while it cuts. `view.set` and `view.render`
  take `section` — `true`, `false` or `{ across, offset, flip }` — and
  `view.set` answers with it; a layer hears whether a cut is the section
  view (`clippingChanged(planes, section)`) and closes its solids with
  `CapSet` — a part lying inside others with its cap drawn over theirs,
  hatched (`CapPart.over`, `hatch`; `viewer/hatch`). The cut colours have
  no red in them: red on a part says something is wrong there. Not saved. README under "Looking inside: the section view";
  `scripts/e2e-section-view.mjs`.
- **The view bar, one row of parts** (2026-10-13). The bar is a single row
  read from the left: a key for each part on the stage — **Scan**, in the
  deviation workspace **Reference**, in 3D Measure **Elements** — then the
  workspace's own keys at the side, then **Section**. A click on a part's
  key shows the part or puts it away; resting the pointer on it, or its
  caret, opens a menu of how it is drawn: the scan's and the reference's
  **Transparent**, **Mesh** and **Backfaces**, each part its own now
  instead of one switch for both — the reference's settings hold in the
  split view's half too — and Measure's **Labels** under Elements, whose
  click puts the elements, dimensions and sections away as a whole. A dot
  on a key says something in its menu stands otherwise than usual. The
  deviation panel's *Show reference* and *Show scan* checkboxes are gone,
  the keys doing that now. A plugin adds its parts with `partKeys`
  (`ui/PartKey`), its side keys with `viewKeys`, and may hold the Scan
  key's click and Transparent itself and add rows to its menu
  (`scanKey`). README under "The view bar".

## 0.5.3 — 2026-10-13

- **Opening a file from a link** (2026-10-13). A file named in the page's
  address opens on start, the way a dropped one does: `?open=<url>` fetches
  any file a server lets the site read (CORS), and `/s/<name>` is the short
  form for a file in the deployment's own file store, named to the build as
  `VITE_FILES_URL` in `.env` — a project unless the name ends in a mesh, STEP or image
  format; `workspace=<name>` on either says where to land once it is open.
  The status strip reports a file that does not come, with the server's
  status or the missing permission. README under "Opening a file
  from a link" and "Deploying to Cloudflare"; `scripts/e2e-open-link.mjs`
  tries both forms.
- **The colour map in the deviation state** (2026-10-12). `deviation.settings`
  takes `colormap` and the deviation state's `settings` names the map in
  use and what its ramp shows at −range, 0 and +range, the caps past either
  end and the unmeasured grey. The map is the person's browser preference,
  so an agent reading a render could not know whether red meant outside
  (jet) or nothing of the kind (viridis); now it reads the ramp first or
  sets the map it knows. The live map's tooltip no longer names jet's
  colours either.
- **A flat patch is no cylinder estimate** (2026-10-12). The robust
  estimate a cylinder fit from a click starts on turns down a patch the
  best plane fits as well (`curvedBeyondPlane`). A flat face whose normals
  scatter, as a scan's do, used to come back as a cylinder as large as the
  radius cap allowed, which only the coverage check after the growing
  turned down; the next, larger patch is now tried at once. A few degrees
  of a large bore are still found where the arc rises clear of the noise.
- **Node.js 22 or newer** (2026-10-11). `package.json` and scanruler-mcp's
  now declare it (`engines`), the version CI runs on; scanruler-mcp asked
  for 20, the app for nothing. The Node type definitions follow, so code
  written against a newer Node's API no longer type-checks.
- **Housekeeping** (2026-10-11). The e2e screenshots, which `.gitignore`
  already named as generated, are no longer in the repository;
  `scanruler_batch`'s description takes `section_get` as its example.
- **The README catches up** (2026-10-11). It names 2D Measure among the
  workspaces and cones and tori among the fits, has a Cone row in the
  element table and the Agents group in Settings, says an agent reads
  numbers to six significant digits, and no longer promises cones or the
  2D DXF export, both of which ship. COMMERCIAL.md calls the sample scans
  what they are: local fixtures, not committed.
- **scanruler-mcp 0.2.0** (2026-10-11) — the version for what the server
  gained since 0.1.0, the copy on npm: batch calls, rounded and exact
  answers, Node 22. Its connection help names Firefox beside Chrome and
  Edge, as the READMEs do, and its README the config folder under
  `$XDG_CONFIG_HOME`.

## 0.5.2 — 2026-10-11

- **A drag within the page no longer brings up the drop-a-file overlay**
  (2026-10-11). The overlay answered every drag over the window — a
  selection of text, a row dragged in a list — and, dropped on something
  that took the drop itself, stayed up until the next drag. It now answers
  only a drag that carries files (`useDragDrop`).
- **A place framed up close leaves the rest of the part in the picture**
  (2026-10-11). `view.set` and `view.render` with `frame` closed the
  clip planes in on the place along with the camera, so the view turned
  or zoomed back out showed the part cut to a slab round that place until
  the next fit. Framing a place is now a zoom: the clip planes go on
  taking in the whole part (`SceneManager.fitBox`). Tests: `e2e:nav`
  frames a place at one end of the part and turns the view, and every
  corner of the part stays between the clip planes.
- **`deviation.hotspots` tells the map past the search distance apart**
  (2026-10-11). The patches were gathered from every finite reading, the
  ones past the search distance — drawn bare on the map — among them,
  and nothing said which. The patches are now of the measured map alone,
  and `far` carries the rest by side: `inside`, the scan deeper inside
  the reference than the search distance, where the reference has
  material the part has not (a hole or a pocket the model lacks);
  `outside`, the scan further off it, where the part has what the model
  has not, or spray — each with its count and its patches, the largest
  first; `unmeasured` counts the vertices the facing limit left without a
  reading. Test: the search distance pulled under the 2 mm the slab's top
  and bottom lie inside, they leave the patches and are told as
  `far.inside`, two patches of about 2 mm.
- **Answers handed back keep every digit** (2026-10-11). A command may be
  `exact` (`Command.exact`, listed only when true): its numbers are inputs
  — a sketch's coordinates, a plane's frame — and scanruler-mcp leaves
  them unrounded, where every other answer is shortened to six
  significant digits; a batch holding an exact answer is sent exact as a
  whole. Rounded coordinates handed back had left faces a hair off the
  faces they were meant to share.

## 0.5.1 — 2026-10-10

- **Nothing lights under the cursor while the view moves** (2026-10-10).
  A drag that turns, pans or zooms the view puts out what was lit under
  the cursor at its first move and tests the cursor again only where it
  ends: the hover test — several rays a frame over everything pickable —
  had run on every frame of a turn, and lit faces flickered past under a
  cursor that was steering the camera. A button held without moving is
  not yet a drag, so a click does not flicker the highlight
  (`OrthoNavigator.navigating`). Tests: `orthoNavDrag`.

- **Shorter answers for an agent** (2026-10-10). An agent re-reads its
  whole session at every step, so every answer is paid for again on each
  step after it. scanruler-mcp gives each number that is not whole to six
  significant digits and no finer than a millionth — 0.9483828176573491 is
  0.948383, a zero's rounding error of 1e-17 is 0 — and ids, indices and
  counts as they are; the page's answers stay exact for any other caller.
  `session.state`, `element.fit` and `dimension.add` no longer promise
  their numbers at full precision. `align.datum`, `align.auto`,
  `align.symmetry` and `align.clear` answer the step applied, the whole
  alignment only when the part was aligned before, and how many elements
  moved with it; `detail: "full"` lists each element where it now is, as
  before. `view.render` is 800 pixels on its
  long side by default, from 1280: an agent pays for a picture by its
  pixels, and asks for a larger one for a picture to keep. Tests: `tools`
  (the rounding), `mcp` (an answer through the server), `commandsMeasure`
  (an alignment answered short, and whole).

- **The symmetry plane as an element answers with its residual** (2026-10-10).
  `element.construct` with `plane-symmetry` returns `symmetry { rms, matched,
  sampled }` and the search's note beside the element, and its description
  says the alignment is left as it is — `align.symmetry` is the one that
  re-poses the part. An agent had searched for a way to measure the mirror
  plane without moving the part and not found it.

- **Where the deviation lies over tolerance, as patches** (2026-10-10).
  `deviation.hotspots` reads the deviation map as connected regions of the
  scan over tolerance instead of one number over the part: the vertices
  past the tolerance (the map's own, or one given) gathered into patches
  by distance — a few point spacings, read off the points themselves — on
  the same side of the surface, the largest and farthest first, each with
  its centre and box, its area (count × spacing²), how many vertices, the
  mean and the extreme reading and its side, the point of the extreme and
  the scan vertex there, and a few of its vertices for `element.fit_marked`;
  with a map against the reference part, the centre and the extreme on the
  reference too. The gathering is `core/deviation/hotspots.ts`, a hash grid
  and a union-find over the vertices over tolerance, so a workspace that
  compares the scan with something else can read its own map the same way.
  Tests: `hotspots` (two patches on two faces, a gap bridged, a wall apart
  kept apart, the sides kept apart, the spacing), `commandsWorkspaces` (a
  reference a tenth taller than the scan: its top and bottom as two patches,
  2 mm inside).

- **Several tools in one call** (2026-10-10). scanruler-mcp has a fourth
  tool of its own, `scanruler_batch`: a list of the page's tools with their
  arguments, run in order, each answer in its place — twenty `scan_nearest`
  calls in one round trip. The first refused stops the rest unless
  `stopOnError` is false; each call that changes the session is still its
  own undo step; a picture gives its text, not the image. Tests: the
  server's `mcp` (four calls, stopped at the third; every call reported;
  the server's own tools not batched).

- **The scan's own points, and a section's polylines, for an agent**
  (2026-10-09). An agent measuring a part had to export the whole point
  cloud and slice it elsewhere to read a number off the scan. `scan.query`
  hands back the vertices inside a box, or within a radius of a point,
  with their outward normals — facing a direction if asked, so the top
  face alone — thinned evenly to a limit, with the box round them, their
  centroid and mean normal. `section.get` hands back a section's cut as
  the polylines it is, each chain's points in order on the sheet ([u, v]
  in the section's plane, what `flat.fit` takes) and, if asked, in the
  world, with the plane, whether the chain closes, its length and its box
  — where `section.cut` said only how many chains there were. Tests:
  `commandsMeasure` (the top face's vertices facing up, a ball about a
  corner, the limit; a section's ring on the sheet and in the world, a
  sheet point lifted back onto its world point, the thinning).

- **A picture of the model on its own** (2026-10-09). `view.render` and
  `view.set` take `show` — the scan, the reference, the sections, the
  elements and the labels, each on or off by key, a workspace adding keys
  of its own (`registerViewToggles`, a plugin extension point; `view.set`
  and `session.state` list every key standing and whether it is shown) —
  and `frame`, a box or a place to look at closely instead of fitting
  everything. `view.render` puts things away for the picture alone and
  back after; `view.set` leaves them as asked. `{ scan: false }` shows what
  was built on the scan without the scan over it. Tests: `commandsView`
  (the toggles a plugin registers, one taking the app's `scan` key over
  while its workspace is on screen; the refusals).

- **A STEP reference that came apart says which faces and where**
  (2026-10-09). The reference loader's "1 surface could not be converted"
  now names the faces by their entity ids in the file (`#1234`) with what
  went wrong with each, and says where the gaps they left lie — the middle
  of each open rim, and how far across — so the face can be looked up in
  the CAD system and the place on the part. `session.state` carries them
  under the reference's `step` (`faces`, `gaps`). Tests: `openEdges` (the
  rims of a box with a face taken out, two faces apart as two gaps and
  side by side as one; the verdict's wording).

## 0.5.0 — 2026-10-09

- **The agent opens ScanRuler for you** (2026-10-09). Connecting an agent
  is now two steps: add scanruler-mcp to it with one line, and ask it to
  connect. The server has a new tool, `scanruler_open`, that opens ScanRuler
  in your default browser with the pairing in its address and waits for the
  tab, so the only thing left to you is the browser's one question whether
  the site may reach this computer; the tab keeps the pairing from then on.
  A tab paired before gets eleven seconds to come back by itself first, so an
  open one is not opened a second time, and both waits together stay under
  the minute Codex gives a tool call. The README's Agents section is now a
  step-by-step guide for Claude Code, Codex, Claude Desktop and Cursor, with
  what to do when it does not connect, and the server runs as
  `npx -y scanruler-mcp`. Tests: the server's `mcp` (the tab opened when none
  comes back, never for a connected one) and `browser` (the opener on each
  platform; a link a shell would read anything into is not opened).

- **scanruler-mcp answers in compact JSON** (2026-10-09). A tool's answer
  went to the agent indented, every coordinate of a bounding box on a line
  of its own; it now goes as JSON without the spaces, a large share of a
  long answer's size. Nothing else about the answers changes.

- **Putting an edited version of the scan in place is part of the session**
  (2026-10-09). Swapping the scan for an edited version of itself — or back
  to the one before an edit, as a step of the undo history across it does —
  was wired up in the page's top component; it is now the app session's,
  beside opening a scan, so a workspace's commands swap the scan the way its
  buttons do. It runs without a viewport too: the part's size is then read
  off the mesh, as opening one reads it. Nothing changes on screen. Tests:
  `scanSwap` (a smaller version of a box put in place headless — the
  session's scan, its size and centre, the listeners told).

- **The agent can see the 3D view** (2026-10-09). `view.set` turns the view
  to a standard view — iso, top, bottom, front, rear, left, right — or fits
  everything shown into the frame, and `view.render` hands back a PNG of the
  view at the size asked, so an agent that cannot see the screen can look
  at what it measured or made. Both wait for the session to settle first,
  and neither is a step of the undo history. scanruler-mcp gives the picture
  to the agent as an image, and writes it to a file only when the call names
  a path. The server also keeps the command list of the last tab that
  connected, in its config folder, and lists those tools before a tab is
  back: an agent that reads the tool list once, when it starts, and not
  again when told it changed, still sees every tool the tab offers. **Fit**
  on a stage with no scan now frames what a workspace has drawn in the
  scan's place, as opening one already did. Plugins take part in the
  command layer through three registries — their commands, their part of
  `session.state`, and what their own machinery is busy with, which holds
  every command that changes the session and shows as `busy` in the readout,
  so `scanruler_wait` waits it out. A command's input schema is held to
  8,000 bytes and twelve levels, and registering one past that fails: an
  agent's client may turn a tool with a larger schema down without a word —
  Claude Desktop did, at 82 kB nested twenty deep — so a large shape is
  listed loosely and checked when the command runs. The server tells the
  agent the tools changed when any tool's definition does, not only when
  the names do. Tests: `commandRegistry` (a schema past the budget refused,
  the app's own within it); `commandsView` (the view commands
  without a viewport, the picture flag, a busy check holding commands and
  showing in the readout); the server's `tools` (an image result, a path
  only when asked), `mcp` (an image block end to end) and `remembered` (the
  last tab's list listed before a tab connects, kept when one does, and the
  agent told when a kept tool's schema differs from the tab's);
  `mcpCommands` (the server's copy of the command list).

- **An AI agent can drive the tab you have open** (2026-10-09). Claude
  Code, Claude Desktop, Cursor and other agents that speak the Model Context
  Protocol can run ScanRuler's commands through scanruler-mcp, a server the
  agent starts on your computer (the new `mcp/` folder, with its own README).
  With **Local agent connection** on in ⚙ Settings → Agents, the tab
  connects to the server on 127.0.0.1 with a pairing token. `npx
  scanruler-mcp --pair` prints the port and the token, and a link that
  switches the connection on with both; the agent's `scanruler_status` tool
  gives the same link. You see each command as it runs: a chip in the top bar
  says whether the agent is connected, the status line names the command,
  the guided hints keep quiet, and clicks on the part wait until it is done.
  Every step is on the undo keys. Files are paths on the agent's side: the
  server reads a scan and streams it to the tab as a binary frame, and writes
  each export where the agent asks. The server takes one tab at a time, from
  scanruler.com, from this computer or from an address it is told, and only
  with the token. Chrome and Edge refuse a connection from a website to this
  computer unless the site has been allowed to reach apps on the device, and
  they only ask on a fetch, never on a WebSocket (checked in Chrome 154), so
  the tab fetches the server's hello first and the browser asks once.
  Firefox asks on the connection itself. Safari allows neither, so
  `scanruler-mcp --serve` serves a build of the app from the same port.
  Nothing leaves the computer through ScanRuler. The connection's code, like
  the commands', loads only once it is switched on. Copies of the server
  share the tab: an agent may start more than one — Claude Desktop starts one
  for its chats and one for its other sessions — and a copy that finds the
  port taken sends its calls through the copy that holds it, and takes the
  port over when that one stops. Tests: `agentBridge` (the
  hello, runs with bytes both ways, errors as codes, a refusal, the pairing
  link); `mcpCommands` (the server's copy of the command list); the server's
  own `npm --prefix mcp test` (framing, tool generation, the origin and token
  checks, one tab at a time, an MCP client end to end, copies sharing one
  port and taking it over, a port another program holds); `e2e:agent`, now in
  the CI run (a real MCP client, the server and the app in Chrome measure the
  ball bar — or two generated balls where the scan is not at hand — and
  check the panel, the report — through a second copy of the server too —
  the STEP, STL and point-cloud exports, undo and redo, and the project saved
  and opened again).
- **Every panel verb is a typed command** (2026-10-09). What the panels do —
  open a scan, fit an element where a click would land, construct one,
  measure between elements, hold a value to a limit, align the part, cut a
  section, best-fit the scan onto a reference, measure the wall thickness,
  calibrate and measure a 2D image, export, save — can now be run by name,
  with JSON in and JSON out, so that an AI agent or a script can drive a
  session; the connection to an agent follows. A command runs the same code
  as its button, as one step of the undo history labelled *Agent: …*. It
  waits until the result is in, refuses while the session is busy or the
  panel has work open in it, closes every box it opened, and returns what the
  panel would show, at full precision in millimetres and degrees. A place on
  the scan is a vertex number or a point, and a point is taken to its
  nearest vertex. `session.state` reads the whole session out as JSON,
  including the scan's bounding box, and `report.get` returns the report as
  the Copy button's text or structured as JSON, with what each number rests
  on: units, frame, alignment and each element's outlier cut-off. The exports
  return their bytes; the buttons still download them. To share code with
  the panels, the 3D Measure workspace's fitting, the scan import, the part
  alignment, the section cuts and the deviation and thickness workspaces
  moved out of the app's top component into modules that also run without
  the viewport, and the worker can now name the vertex nearest a point and
  the scan's bounding box. The commands themselves load only when an agent
  connects. Tests: `agentBallbar` (the ball bar through the commands alone:
  a sphere fitted in each end, seeded from the readout's bounding box; the
  centre distance at 148.639 mm against GOM Inspect's 148.64 mm; the report
  in both forms; the dimension undone);
  `commandSchema` and `commandRegistry` (input checking, one undo step per
  command, refusal while busy, commands run one after another);
  `commandsMeasure` and `commandsWorkspaces` (for every command, what it
  refuses, what it does and its undo step).

## 0.4.6 — 2026-10-06

- **The deviation map no longer reads a thin wall off its far side**
  (2026-10-06). The map took each scan point's reading off the nearest
  reference surface, whichever way it faced. Across a thin wall, a point
  sunk more than half the wall's thickness is nearer the far side of the
  wall than its own, so it read too small, and once through the wall it read
  with the wrong sign: on a 1 mm wall, a point 0.7 mm in read −0.3 mm, and
  one 1.2 mm in read +0.2 mm. A point whose nearest reference surface faces
  away from the scan there is now measured against the nearest surface that
  faces its way, using the facing-aware search the alignment already pairs
  marked points with. It is left grey when no such surface lies within a
  tenth of the part's size. **Reference must face the same way**, under
  *What counts as measured*, switches this off, and *Max. deviation of
  normals* can tighten it from the default of 90°, which steps over only
  surface facing away. A tighter limit also re-reads the steep sides of
  edges the scan has rounded over: on the bracket test pair, 60° re-reads
  twenty times as many points as 90° and widens the map's extremes by almost
  two millimetres. A scan whose normals came in inside-out as a whole is
  recognised and read the right way round. Changing the setting measures the
  map again. It is saved with the project, can be undone, and is printed in
  the report as the facing limit. Measuring the bracket takes about 13 %
  longer. Tests: `deviation` (on a 1 mm plate in a fitted pose: the plain
  map's short and sign-flipped readings, the same points off their own face
  with the limit, a steep surface kept at the default, a point with nothing
  facing it left grey, an inside-out scan, the directions of re-read points,
  the report line); `deviationStore` (the limit is clamped and kept apart
  from the element map's); `e2e:deviation` (on by default at 90°, switching
  it off measures a different map, and switching it back on gives the first
  map again).
- **The deviation map can be played as motion** (2026-10-06). Under
  *Deformation* in the Surface Deviation panel, **Animate the deformation**
  moves the part from the shape it should have to the shape it was measured
  at, exaggerated by a **Scale** you set, and back, on a loop, like the
  deformed-shape animation in FE software. Each point moves along the line
  its reading was taken on, away from the reference or out of the element,
  which is now recorded with every map. The motion is smoothed over about
  1 % of the part's size, so a warp or a wall leaning in moves while scanner
  noise and the edges of holes stay at true size. Readings past the end of
  the colour scale move only as far as the end, and points with no reading
  stay put. Until you set the scale, it is chosen so the end of the colour
  scale moves by a twentieth of the part. The picture moves on the graphics
  card and nothing else does: colours, figures, pins and exports are the
  part as measured. Tests: `deflection` (directions point the right way on
  both sides of a reference and through a fit's pose, and taking the offset
  away lands on the surface; clamping, smoothing that keeps a warp and a
  shared offset and takes out a spike, the suggested scale, the loop);
  `deviationStore` (the scale override; the loop stops for marking, picking
  and a new reference); `e2e:deviation` and `e2e:element-deviation` (the
  part moves while playing and is back exactly as measured when stopped).
- **3Dconnexion SpaceMouse support** (2026-10-06). In Chrome and Edge the
  puck flies every viewport: push or pull it to zoom, slide it to pan, tilt
  and twist it to turn the part about whatever is at the centre of the
  screen. The turn is the same free orbit as the mouse's, so the two can take
  turns. It connects the first time the puck is touched, and with several
  viewports on screen it drives the one the mouse was last over. A 2D sheet
  only pans and zooms. Wheel events that the 3Dconnexion driver sends while
  the puck moves are ignored, so they cannot make the view jump. Nothing is
  read until the browser reports a SpaceMouse. Tests: `spaceMouse` (device
  match, deadzone, which viewport has the puck, the wheel hold-off; pan, zoom
  and turn speeds and directions, the pivot staying put, a sheet not
  turning); `e2e-spacemouse` (a stand-in puck in the real app: pan, zoom,
  turn and the wheel hold-off on the scan, then the 2D sheet takes the puck
  from the hidden 3D view and gives it back).
- **A PLY can keep its winding** (2026-10-04). A PLY whose header carries
  the line `comment ScanRuler: keep winding` is read with its triangles
  wound exactly as written, and ScanRuler skips its guess at whether the
  mesh is inside-out. The guess goes by the volume the mesh encloses, and a
  strip that is open on every side and curves round its own inside, like
  the top of a round wall with its inner face, can look inside-out to it
  when it is not. Tests: `parsers` (the comment is read, and no other);
  `normals` (an inside-out mesh that says so is kept as wound).
- **The marking can be inverted, and it shows on back faces** (2026-10-04).
  The marking tools have an **Invert** key beside *Clear marking*, and the
  split-screen picker has *Invert selection* beside *Clear selection*. It
  marks everything that was bare and clears everything that was marked, so
  to take everything but a fixture or a riser you mark that and invert.
  It flips point by point, so inverting twice gives back exactly the marking
  you started with. The one row of triangles along the border, which has
  some corners marked and some not, shows bare both ways. As a result the
  new marking never overlaps the old one: a fixture marked and inverted is
  not fitted even at its edge. Points on no triangle stay bare. An invert
  counts as a gesture, so an element marked by hand re-fits on the new
  marking. With
  **Backfaces** on, marked surface now wears the marking colour on the far
  side of a wall too, instead of being hidden under the back-face colour. A
  gesture with *Mark faces pointing away too* takes surface there, and
  that surface has to show. Tests: `regionColors` (no overlap with the old
  marking, a round trip, points on no triangle, shading copies);
  `e2e-local-fit` and `e2e-pick-fit` invert on the real scan.
- **An element can be aligned to the coordinate planes** (2026-10-04). The
  **Align** block in an element's box offers the XY, YZ and ZX planes ahead
  of the measured planes, and it is there for every element with a
  direction — plane, line, cylinder, cone, circle, torus — rather than only
  once a plane had been measured, which hid it on a fresh part. On a part
  set up with Auto-align or Align part the coordinate planes are the part's
  own, so a bore can be stood square to its base without fitting the base
  first; on a part not aligned yet a note says the planes are the scan's
  own. Aligning the part again takes the alignment along: to whichever
  coordinate plane its old one was turned onto (the ZX plane once the part
  is stood on its side, still XY through a refinement of a degree), or, if
  the part was turned onto none, it comes off and the element goes back to
  its measurement. The summary names the plane ("aligned perpendicular to
  the XY plane"). The coordinate planes are shared with the symmetry plane's
  seed (`core/basePlanes.ts`). Tests: `orient` (an element on a coordinate
  plane with no plane element, re-opened and restored, carried through a
  quarter turn, a refinement and an off-axis turn, in the summary);
  `e2e-orient` reads the first plane against the coordinate planes.

## 0.4.5 — 2026-10-03

- **A plane through three points is clicked on the part** (2026-10-02). A
  construction made of points alone — the plane through three points, the
  line through two, the midpoint of two — asks for its points itself, one
  after the other, the moment its method is chosen: a click on the scan
  drops a picked point into the waiting slot, a click on a point, a sphere
  or a circle takes its centre, and the next slot waits in turn. Only the
  elements that can stand for a point take a click while one waits; a click
  on any other goes through it to the scan. The dropdowns still choose too,
  and Escape closes the box as before, without first stopping the picking.
  Tests: `editing` (a plane picked point by point, a slot let go asks
  again, a mixed construction waits to be asked); `e2e-pick-slot`.

- **Colour maps** (2026-10-02). ⚙ Settings → **Colour map** chooses the
  ramp every map on the part is painted in, and every scale beside one is
  drawn in, from previews of each: **Jet**, the ramp the tool has always
  used and still its default, or one of the eight of the R package viridis —
  **Viridis**, **Magma**, **Plasma**, **Inferno**, **Cividis**, **Mako**,
  **Rocket** and **Turbo**, from viridisLite's tables colour for colour. A
  reading past either end of the scale wears that map's own cap, a colour
  its ramp never uses, where jet's dark red and dark blue would have been
  lost against turbo's dark red end or viridis' dark purple start. Remembered
  per browser. Tests: `colormap` (the published ends of every table; jet as
  it was; every cap far from its ramp, from the bare grey and from the other
  cap; the caps of a reversed scale; the legend in the chosen map; the
  preference); `e2e-thickness` switches the map on a measured part and back.

- **Sharp edges are drawn sharp by default** (2026-10-02). ⚙ Settings →
  Sharp edges starts at **Always sharp**, from 30°, in place of Auto: on a
  scan the rim of a bore and the edge of a step are drawn as edges, and its
  noise — which seldom tips triangles that far: a few hundred vertices split
  on a scan of several hundred thousand — stays smooth. A browser where
  Auto or Always smooth was chosen keeps it.

- **Sharp edges from an angle of your choosing** (2026-10-02). ⚙ Settings →
  Sharp edges has a **Sharp from** slider, 5° to 120°: the angle between two
  faces from which their edge is shaded sharp, 30° as before until it is
  moved. Noise tips a scan's triangles a few degrees, seldom tens, so a real
  scan set to **Always sharp** from 50° or 60° has the rim of a bore and the
  edge of a step drawn sharp, instead of streaked down the wall, and its
  noise left smooth. The scan — and a mesh shown in its place — is split
  again once the slider stops, and the status line says from what angle.
  Tests: `crease` (a noisy box's edges split from 60° and nothing from 120°;
  the layout at the angle asked; a stored angle out of range).

- **An assumed Ø is drawn** (2026-10-02). An element given an **Assumed Ø**
  is drawn at it in the viewport — the preview as soon as the value is
  entered — as the STEP export already wrote it, so what is on screen is
  what CAD receives. Every readout, dimension and deviation map still reads
  the measurement.

- **Escape works with a field focused** (2026-10-02). With the focus in a
  number field or a list of a box or a tool, Escape did nothing; it now
  leaves the field and closes what the field is in, as it does with the
  focus anywhere else. A field that takes Escape for itself — a number
  being typed over, a note being written — keeps it. And the labels on the
  2D sheet say when the cursor is on them, for a workspace to light what a
  note or a dimension stands for.

- **Workspaces can lend each other solids** (2026-10-02). A workspace that
  models closed bodies offers them through `src/app/solids.ts` — named,
  versioned, and meshed in the scan's frame when asked for — and another
  lists them and asks for one, neither naming the other. The open-source
  build offers none.

- **The Align part box ends in Confirm alignment** (2026-10-02). The pose
  is previewed on the part from the first choice on — and after Auto-align
  or Use symmetry before anything is pressed at all — so the button that
  keeps it no longer says *Align part*, as if the aligning were still to
  come. The hints and the status bar name it the same.

## 0.4.4 — 2026-09-28

- **Workspaces can come from plugins** (2026-09-27). The app finds them in
  `plugins/<id>/` when it is built and gives each its tab, panel and part of
  the viewport, its own key in the project file, its share of undo and redo
  and of the mesh worker, and its notices in the imprint — all through the
  interfaces in `src/plugins/api.ts`, with nothing in `src/` naming a
  plugin. The open-source build has none; a project saved by a build with
  one opens in it with that plugin's part set aside and saved back
  unchanged.

- **The Measure workspace is 3D Measure** (2026-09-25). Its tab in the top
  bar says so, beside 2D Measure, and so do the undo history, the
  Deviation workspace's pointer to it (*Go to 3D Measure…*) and the README,
  which still called it Elements.

- **The kind stays in hand after Create in both Measure workspaces**
  (2026-09-23). Creating a plane, a circle, a dimension left the box closed
  and the next one wanted the key pressed again. Now Create leaves an empty box of the same
  kind, on the same method and settings, ready for the next one, and Add
  dimension the same for its type; Cancel or Esc puts the kind down, and
  Esc on a box with picks in it empties the box first. The Create element row
  stays on screen with the kind in hand pressed, and pressed again it
  starts the box over. A kind merely in hand, its box empty, no longer
  disables the row keys or undo, and does not count as unsaved work for the
  leave-page warning; a dimension started closes the element draft, as an
  alignment or a section always did, and its key stands down while that
  draft holds picks, as the row keys do. Tests: `toolInHand`, `flatStore`,
  `history`; `e2e-flat`, `e2e-spline`, `e2e-circle` and `e2e-history`
  drive it.

- **Use symmetry and Auto-align say so in the viewport while they search**
  (2026-09-23). Seconds of searching on a big scan showed nothing but a
  line in the strip; the busy card over the part now reads SEARCHING… or
  READING… with that line under it, as the symmetry plane's own box does
  while it looks.

- **Opening an STL asks what units it is in** (2026-09-23). The format
  carries none — a 1 in the file is whatever wrote it meant — and a part
  read at the wrong scale measures wrong in every number after. A window
  now asks, offering millimetres, centimetres, metres and inches, the last
  answer first, and the file is read in millimetres like everything
  measured here (the worker scales the coordinates before the mesh is
  welded, so fits, readings and exports all see millimetres; the status
  line says when a file was converted). **Don't ask again** on the window
  makes the answer stand for every STL; **Settings → Files** brings the
  question back and holds the units assumed meanwhile. The scan and the
  Deviation reference both ask; a PLY or OBJ is read in millimetres as
  before, a STEP file says its own units, and the sample bracket — the
  instrument's own file — does not ask. A project remembers the units its scan and reference were read
  in (`units` on the scan and reference entries, only when not mm) and
  reads them the same way again, as does the worker after a restart.
  Tests: the scale in `workerImport`, the manifest field and its
  validation in `project`, the question's flow in `meshUnits`; the e2e
  harness switches the question off before the app starts, and
  `e2e-import` turns it on to drive the window.

- **Auto-align** — the Alignment group proposes the part's coordinate system
  from the scan alone and opens *Align part* filled in with it: the pose
  previewed against the coordinate planes, nothing applied, the side that is
  down and the way X runs still a dropdown each. The directions come from a
  vote of the surface's normals (core/autoAlign.ts): an area-weighted
  histogram over directions with a normal and its opposite in one bin, its
  peaks the directions the faces are square to, the pole of the remaining
  normals the axis of a turned or extruded part; frames built from those
  candidates are scored by the surface they explain (faces on an axis, walls
  along one at half worth, the bounding box between equals) and the winner is
  settled on the normals themselves by the best rotation (Horn's closed form
  on directions), so drafted walls average onto the direction they lean
  about; a main axis is set square to its walls instead. It needs no closed
  mesh. Normals are averaged over their neighbourhood against scan noise,
  never across an edge, and the triangles on an edge vertex — all of them, on
  a twelve-triangle cube out of CAD — vote with their own normal. What is
  missing from the scan is read too: its open edges are taken loop by loop
  (the open edges of a loop, run the way their triangles do, sum to the
  vector area the loop spans, so no loop is walked in order), and a loop
  that lies in a plane — the rim of a housing, the cut where a part stood on
  the table — votes as the face that would close it, with the area it spans.
  On a housing scanned from above (block-marius.ply: a missing base a
  quarter of the surface, 45° chamfers larger than the side walls) that is
  what keeps the chamfers from winning the frame. Up is the side worth most:
  the flat face lying on it as a share of the surface, plus half of how much
  of that side of the box the scan's openings cover — the scan's vector area,
  Σ area · normal, seen along that side — so a side wholly open outweighs
  any face, wherever in the box its ragged edge lies; a turned part chooses
  between the ends of its axis the same way; the side already nearest to
  down wins between equals; the long side runs along X; zero lies on the standing face under
  the middle of the box, or on the common axis of the round walls. With no
  face directions and no round walls it falls back on the principal axes and
  says it is a guess. 1.4 s on 1.9 million triangles, in the mesh worker.
  Tests: autoAlign (a noisy block to 0.05°, an open scan, a shaft with zero
  on its axis, a lug that turns the principal axes, coarse CAD meshes,
  drafted walls, an open housing whose slopes would win the frame without
  its rim, a ragged opening, a ball, the proposal as a 3-2-1 alignment and in the store);
  e2e-auto-align aligns a block lying at an odd angle and is then proposed
  the pose it is in (0°, 0 mm).

- **Find symmetry plane is several times faster** — most of its time went
  into the two principal planes that lose: a plane the part is not symmetric
  about never lets the mirror registration settle, so it ran every iteration
  of every pass. Candidates are now settled and judged on a sixth of the
  samples with a loose registration first, and only the winner (and a
  runner-up within a quarter of it) goes on to the full sample and the tight
  registration; after a pass has shown how far the mirror images lie from
  the scan, the next searches only a few times that far, which shortens the
  facing-aware closest-point search. The part's face directions from
  Auto-align stand beside the principal planes as candidates. The unseeded
  searches of the test suite went from 2.8 s to 0.4 s with the same planes to
  the same tolerances.

- **Drawn icons on the keys.** One set drawn for the tool (`ui/icons.tsx`,
  92 pictures) to four rules: ink is what is there, blue is what the key
  makes or changes, dashed is what goes or is only referred to, dots are
  the scan. Keys that start something carry the picture over their word —
  the element types of Measure and 2D Measure. The marking tools
  (Navigate, Pick points, Window, Brush, Lasso, Erase), the pencil, eye
  and bin at the end of every list row, Hide all, the view bar's keys,
  the workspace tabs (on a wide window), Save, Load and Settings, the 2D
  sheet's Rotate and Mirror carry theirs beside the word, in place of the ✥ ▭ ● ⌇ ◑ ✎ ◉ ✕ ↺ ↔ ⚙ ⇅
  characters that stood there.

- **Support card in ⚙ Settings** — a switch that keeps the thank-you card in
  the corner of the stage from coming up at all. Its × still closes it for
  the visit only; the switch is remembered per browser like the rest.

- **Fixed: a deviation or thickness map was not drawn on a part with
  sharp edges drawn sharp.** The colour buffer of such a part runs past the
  scan's vertices with the copies split off for shading, and the map — one
  reading per vertex of the scan — was refused for not being the buffer's
  length, so the figures were right and the part stayed bare. Found on the
  sample part, which is flat-faced.

## 0.4.3 — 2026-09-14

- **Sharp edges drawn sharp** (issue #5) — a mesh exported from CAD rather
  than scanned, a low-poly STL out of OpenSCAD or a slicer, used to shade
  like a pillow: the viewer had one normal per welded vertex, so a box's
  corner pointed out of the corner and every flat face ran a gradient from
  it, and a bored hole read as a dent. At every edge sharper than 30° the
  two faces now get their own normals — the vertex is drawn twice, once per
  side, with the copies kept after the mesh's own vertices so nothing
  measured, marked or mapped moves — and a box has six flat faces. A scan
  stays smooth, which is what a scanned surface is: drawing its noise sharp
  would speckle it and double its vertex list. **Sharp edges** in
  ⚙ Settings decides: **Auto**, the default, tells a tessellation from a
  scan by the mesh itself (a CAD part is full of dead-flat edges between
  coplanar triangles, a scan has practically none), **Always sharp** and
  **Always smooth** overrule it and take effect on the loaded scan at once,
  with the status line saying what was done. However it is set, a split
  that would add more vertices than the scan has is not made. The reference
  part is CAD and is always drawn sharp.
- **Fit to edge in 2D Measure** — the 2D twin of the fit from a click on
  the scan: Line and Circle gain a *Fit to edge* method that takes one
  click anywhere on a detected edge and grows the fit along it from there,
  refitting as it goes, until the edge bends away — at a corner, or where a
  fillet runs out into the side it joins. A click on one side of a part
  takes that side and stops at its fillets, a click on a fillet takes the
  fillet, and a click on a hole's rim takes the hole all the way round. The
  noise band and every sanity check are scaled by the chain's own scatter,
  so the same rule serves a 600 dpi scan in pixels and a section in
  millimetres. A line clicked on a curve, or a circle clicked on a straight
  edge, is refused with the reason in the box rather than fitted to
  whatever was there. A second click adds another stretch of the same edge.
  On a section, whose outline is one clean chain, **Line** and **Circle**
  open with the fit to edge rather than with hand picking.

## 0.4.2 — 2026-09-13

- **Symmetry plane and centroid of the scan** — two constructions that read
  their numbers off the scan instead of off other elements, for the
  reverse-engineering step that models one half of a symmetric part and
  needs the mirror plane exact. *Symmetry plane of the scan* reflects a
  sample of the scan through a candidate plane, fits the reflection back
  onto the scan with the same point-to-plane ICP the Deviation workspace
  uses, and reads the plane off the pairs — every sample and its registered
  mirror image are bisected by the true plane — for a few passes until it
  stops moving. **Find symmetry plane** starts from the scan's three
  principal planes, or from a **seed plane** you name first when the part's
  detail makes the choice ambiguous; a hole or a fixture on one side neither
  steers the plane nor inflates its σ, which is how far the mirror image
  lies from the scan, so an asymmetric part reports a loose fit rather than
  a confident plane. *Centroid of the scan* is the centre of the volume the
  mesh encloses, measured the moment the method is chosen; a scan that does
  not close gets the centre of its surface, and the box says so. Both are
  ordinary elements: they move with the part, save with the project, export
  to STEP, cut sections and serve as datums — align the symmetry plane onto a
  coordinate plane and the centroid onto the zero point, and the part is
  levelled about its own mirror.
- **Search on a marked surface** — either search can be confined to a
  marking: switch *Search on* to *Marked surface* and the window, brush and
  lasso a hand-marked fit uses appear. Only the marked points are searched
  and only the marked triangles are surface a mirror image may land on, so a
  fixture, a stamped number or a patch the scanner smeared is kept out of
  the search on both sides; the centroid of a marking is the centroid of
  that surface, measured again on every stroke. The marking saves with the
  element, is back on the part when it is re-opened, and the copied summary
  says how many points were searched.
- **A discarded marking comes back** — `Esc` on a marked search behaves as
  it does on a hand-marked fit now: the first press hands the camera back
  and leaves the marking alone, where it used to fall straight through to
  discarding the draft, marking and all. And the second press no longer
  costs the marking either: a draft closed with a marked surface on it — by
  that `Esc`, by a slip onto Cancel, or by an alignment, a section or a
  dimension pick taking the panel — waits in the panel where the draft was,
  with a **Restore** button that puts it back on the part, marking and all,
  and a **Forget** button; it is let go when the next element is started or
  a scan loads. A held `Esc` no longer repeats through both steps.
- **Ø min / max and the surface-to-surface range** — a fitted diameter is a
  Gaussian mean, and a bore 0.2 mm out of round reaches 0.1 mm inside that
  circle at its tightest and 0.1 mm outside at its widest, which is what a
  slice measured by hand in CAD, a caliper or a gauge pin finds first. A
  sphere, a cylinder and a circle now also read **Ø min and Ø max** — the
  smallest and the largest diameter the surface actually reaches — in the
  detail line, the Diameter dimension and the copied summary, which prints
  the residual extremes for every fitted element. The Point – Plane,
  Axis – Plane and Plane – Plane distances carry the **range** the value
  takes once each face's own form is counted in, the min and the max a
  caliper would find over two opposite faces, under the value and in the
  summary. An axis averages the whole wall, so Axis – Axis stays one number.
- **Export cloud** — beside Export STL, the scan as a **point cloud**, every
  vertex with its outward normal, in the pose the part is shown in: a
  datum alignment or the Deviation best fit comes along, as for the STL.
  Binary **PLY** with points only (Geomagic, CloudCompare, MeshLab and ReCap
  read it) or **XYZ text**, one `x y z nx ny nz` line per point in
  millimetres, the file ASC readers take; ReCap turns either into an RCP.
  The format is remembered per browser like the STEP style, and the file is
  `name-aligned` or `name-export`, never the scan's own name.
- **Align part leads with measured elements** — step 2's slot is
  *Direction* now, not *Edge*: it has always taken a plane by its normal or a
  cylinder by its axis, and both steps' help say so first, and why — an
  element averages thousands of scan points where a pick is one spot of
  noise. The Point – Plane hint says what it is for: the CMM way to measure
  a width, free of the in-plane offset two picked points carry. The README
  gains *Comparing with a 2D slice*: why an angle between planes read off a
  hand-placed slice comes out under the dihedral angle unless the cut is
  square to the line the faces meet along, and how to settle it in the app.

## 0.4.1 — 2026-09-11

- **A fitted region's border is as sharp as a marking's** — the surface a
  click-fitted element rests on, and the preview of one, used to be tinted
  through the vertex colours, which the GPU blends across every triangle, so
  the tint faded out over the ring of triangles around the region instead of
  stopping at it. It now wears its colour the way a hand-marked surface does:
  exactly the triangles whose three corners the fit uses are coloured, edge to
  edge, and the ring around them is bare scan. The deviation and thickness
  maps are readings at every vertex and stay as smooth as before.
- **The rounding at an edge stays out of a fit** — a scan rolls every edge
  off over a few vertex rings, and a click-fitted plane, cylinder, sphere or
  cone used to keep the first one or two of them: close enough to the surface
  and tilted little enough to pass the growing tests, but sitting
  systematically off it, so a face was pulled a micron or two into the part
  and a bore's flared mouth went into its cylindricity. The grown region is
  now peeled back ring by ring while the rim's normals turn away from the
  element clearly more than the surface's own noise does, the way GOM's
  selection stops short of an edge. On the block scan a face keeps the same
  points GOM selects to within 1%, and the 6.76 mm bore's cylindricity drops
  from 0.203 to 0.135 mm. A surface marked by hand is fitted as marked.

## 0.4.0 — 2026-09-11

- **Used points per element** — the outlier cut-off in the Fitting group is
  the open element's own and goes into the element with it, instead of one
  setting for the whole session that re-fitted every element at once. A clean
  bore keeps its 3σ while a noisy cast face beside it is fitted on all points;
  re-opening an element changes its own and no other. The last choice is what
  the next new element starts with, and the copied summary says which cut-off
  each element was measured with. Projects save the setting with the element;
  projects from before load with the cut-off they were saved under.
- **GD&T** — a group under Create dimensions that checks what a drawing's
  feature control frames ask for, the way a dimension is made: **New
  tolerance**, the characteristic, the element and its datum, **Add
  tolerance**. Flatness, cylindricity, sphericity and circularity read the
  form error the fit already reports; parallelism, perpendicularity and
  angularity (at a typed basic angle) are the width of the narrowest zone at
  that angle to the datum that still holds the feature — a plane by its
  measured surface, the scan points its fit rests on, so a face's
  parallelism includes its own flatness; a cylinder, a cone or a line by its
  axis; coaxiality and concentricity twice the furthest an axis or a centre
  strays from the datum axis. Datums are elements, named as in the list;
  rename one and the pin renames with it. Viewport clicks fill the slots and
  the type follows what is picked.
- **Limits** — every tolerance takes an optional limit, and every dimension
  an optional nominal with a + / − tolerance. The row, the pin on the part
  and the copied summary read the allowance and the signed deviation; the
  digits go red when the value is over, the summary says PASS or FAIL and
  tallies the checks at the end. A new **Diameter** dimension on a sphere, a
  cylinder or a circle lets a size be held the same way. Projects save it all.
- **Align part after a best fit** — a datum alignment set up in 3D Measure
  after the scan was best-fitted to a reference in Surface Deviation now
  previews and lands on the datum stage. The best-fit pose used to stay under
  the preview, carrying the levelled part off the stage and leaving the
  viewport looking at the wrong place once it was applied — it took a second,
  empty alignment to see the part where the first had put it.

## 0.3.0 — 2026-09-11

- **2D Measure** — **Mirror** beside Rotate 90°: two buttons that flip the
  sheet on the stage left-to-right or top-to-bottom, as it is shown. A
  flatbed scan is the part seen through the glass; mirrored, it is the part
  seen from above, the way a drawing shows it. The flip is in place, keeping
  the zoom and what is under the eye, the loupe flips with it, and Rotate
  90° keeps turning the way it says. Nothing measured moves — but an
  alignment on a mirrored sheet reads right-handed as shown, +Y up the
  screen, so coordinates and line angles compare with a drawing; the report
  says so, and Export SVG and Export DXF draw the sheet mirrored the same
  way, arcs and all. Each sheet keeps its own mirror, and a project saves it.
- **Hide pins behind the part** — a switch by the pinned readings, in the
  deviation and the thickness workspace alike, and on by default: a pin
  whose spot is on the far side of the part, or behind a feature of it, is
  put away until the part turns to show it, so a part carrying many pins
  shows only the numbers of the face you are looking at. Off, every pin
  shows through the part, which is what pins always did. Remembered like
  the other instrument settings.
- **Pinned readings** are all one tone now, ink on the chip and on the
  part, where they used to alternate ink and blue by turns — a pattern that
  read as a meaning it did not have.
- **Dark mode** — text in a colour of its own reads on the dark chassis now.
  A pinned reading's title was the light instrument's ink whatever the
  chassis, which on the dark chip made it all but invisible; the pins wear
  the theme's own ink and blue instead. And the titles of element pins,
  alignment picks and datum planes on the stage, and an element's own colour
  in the draft box, the section box and the tally, are lifted toward white on
  the dark chassis before they are used as text — the palette's deeper tones
  sank into the panel behind them. The swatches and the surfaces keep the
  true colour.
- **2D Measure** — **Export DXF** beside Export SVG: the sheet as the drawing
  CAD trades in — millimetres by declaration, y up, the origin on the
  alignment, every fit as its native entity (LINE, CIRCLE, ARC, POINT, and a
  SPLINE the sketch reads back exactly) on an `elements` layer, the edge
  chains as LWPOLYLINEs thinned to 0.01 mm on an `edges` layer, the labels
  as TEXT. Both drawing exports draw the edges only while they are shown on
  the sheet now, and sit on a row of their own under the report row.
- **3D Measure** — the coordinate planes a new section is offered are a
  fifth of the part's size now, about its centre, and drawn through the part
  rather than hidden inside it; an element under the cursor takes the click
  before a plane does, so they no longer stand in the way of picking one.
- **Alignment** is what the 2D sheet's *Datum* is called now, and it does
  what the name says: the moment the +X pick lands, the sheet rolls square to
  the part — +X to the right of the screen — in place, keeping the zoom and
  what is under the eye, instead of leaving the scan lying as it was scanned
  with a tilted grid drawn over it. Rotate 90° turns the sheet on top of that,
  the loupe turns with it, and Export SVG writes the drawing aligned the same
  way, so a part aligned along a reference edge comes into CAD square. The
  report and the CSV call the frame the *aligned part frame*.
- **A section's sheet is not a white card any more.** The cut lies straight
  on the stage, in 2D Measure as in 3D; the plane it used to be drawn on is
  still there to click and to frame, only unseen. The alignment grid on a
  section rules the whole view rather than stopping at that plane's edge.
- **Settings** — a dialog of its own, opened with **⚙ Settings** in the top
  bar, for what is set once and left: the **interface** (whatever the
  operating system says, which is the default, or light or dark regardless),
  the **colour mode** the part is shown in (Studio grey / Scanner blue — what
  the status strip used to call *View*), the **mouse controls**, how heavy
  the **section cuts**, the **2D fitted curves** and the **2D edges** are
  drawn, and the **guided hints**. All of it is remembered per browser, and
  none of it is saved with a project.
- **Dark mode** — the whole chassis, the stage behind the part included, in
  every viewport: the split view's halves, the point picker and the 2D sheet
  go dark together. Nothing that carries a reading changes with it — the
  element tints, the deviation and thickness ramps and the axis colours are
  the same on both — and a dark chassis comes up dark, without a light flash
  first.
- **View bar** — the ways of looking at the part have moved off the status
  strip into the bottom-left corner of the stage, where there is room for
  words: **Transparent**, **Mesh** and **Backfaces** on the bottom row, and
  above them the workspace's own — **Labels** in 3D Measure, **Split view**
  and **Colour plot** in Surface Deviation. The support card stacks above the
  bar rather than over it.
- **Labels** is what the strip's *Overlays* has become: it puts away the name
  tags and readouts on the part and nothing else. The fitted elements, the
  sections and the dimension lines stay — hiding those is what the list's
  **Hide all** is for, and a switch that did the same thing twice over was one
  switch too many.
- **Line width** — how heavy a section's cut is drawn on the part, how heavy
  the curves fitted over a flatbed scan are, and how heavy the edge chains
  under them are, each a slider in Settings. The first two carry everything
  drawn beside them — the preview cut, the sheet's curves stood up in 3D, the
  callouts and pin marks in 2D — in proportion. The edges, which were a
  one-pixel hair whatever the screen, are drawn as proper lines now and can
  be made as heavy as the curves.
- The status strip is a status strip again: the lamp, what the tool is doing,
  the tally of what has been measured, and the imprint.

## 0.2.1 — 2026-09-10

- **3D Measure** — a section can be cut along the scan's **coordinate
  planes**: while a new section has nothing to cut across, the XY, YZ and XZ
  planes are offered through the part's centre as translucent sheets in the
  axis colours, and a click on one — or its entry in the **Cut along** box —
  takes it, the offset then being the plane's coordinate on that axis. And
  the arrow a section plane wears has become a **gizmo**: drag the arrow to
  slide the plane, drag one of the two rings to **tilt** it about one of the
  sheet's axes, through the point the gizmo sits on. A tilted plane is
  recorded with its tilt off what it was taken across, the box shows the
  angle, and **Square** turns it back.
- **2D Measure** — a **Spline** beside the other kinds: the free curve a CAD
  sketch draws through fit points, with the controls Fusion's fit-point
  spline has. Click the points in order (they snap to the edge like any
  pick), click on the curve to insert a point, drag a pin to move it, and
  drag the **tangent handle** at any point to bend the curve through it — a
  dragged tangent stays put while the rest re-solve around it for the
  smoothest curve, a click on the handle lets it go automatic again, and
  **Free tangents** frees them all. A click on the first point closes the
  curve on itself, as does **Closed curve**. It reads as its arc length, is
  drawn on a section's cut in 3D, and leaves the
  tool as a real spline: a path of cubic Béziers in the SVG, a cubic
  `B_SPLINE_CURVE_WITH_KNOTS` in the STEP file.
- **3D Measure** — what is measured on a section's sheet belongs to the
  section: the points, lines, circles and arcs fitted there in 2D Measure are
  drawn on the cut in the 3D view, in the section's colour and hidden with
  it, without readouts of their own — and **Export STEP** writes them in a
  wireframe group named after the section, as curves in the cutting plane.
  Cut a section through a bore, fit its circle on the sheet, and CAD gets a
  circle in space to sketch on. The section's row counts what was measured
  on it, and the export key is live for sections alone.
- **2D Measure** — **Export SVG** beside Export CSV: the sheet as a drawing at
  true scale, every detected edge chain as a polyline and every visible
  element as a native line, circle or arc, in layers, turned as the sheet is
  shown — for a CAD sketch to trace or a vector editor to pick apart.

## 0.2.0 — 2026-09-10

The first numbered release. Everything the app does at this point:

- **3D Measure** — spheres, cylinders, cones, planes and circles fitted to the
  scan, from picks or from surface marked by hand with window, brush and
  lasso; points, lines and planes constructed from them; distance and angle
  dimensions, an assumed dimension beside each measured one, and the GD&T form
  error of every fit. A plane or cylinder can be extended past what was
  measured, a cylinder fitted only inside its drawn span, and a section cut
  through the scan lands on the 2D sheet to be measured there. Guided 3-2-1
  datum alignment, and STEP export of the analytic geometry at measured or
  assumed size.
- **Surface Deviation** — the scan best-fitted to a nominal part loaded as a
  mesh or as a STEP file tessellated in the browser, with a local fine fit for
  one region; or the deviation from a single fitted element, optionally within
  a marked region. Colour plot over the part, pinned readings, and a
  side-by-side compare view whose two viewports move together.
- **Wall Thickness** — the part measured against itself, by ray or by sphere,
  with an opening angle for chamfers and ribs; hover readout and pins.
- **2D Measure** — a flatbed scan on a millimetre sheet: calibration with
  scanner profiles, automatic sub-pixel edge detection, snapped picks and
  edge-region fits, constructions, a two-pick datum, dimensions, counting and
  free-text notes, a report with CSV export. The sheet turns a quarter at a
  time from the datum group.
- **Projects** — the scan, the reference, the image and every measurement saved
  as one `.scanruler` file; maps are re-measured on load, so an improved
  algorithm improves an old project.
- **Viewer** — mouse schemes matching common CAD tools, tablet gestures,
  standard views on the number keys and the gizmo arrows, fit to view, colour
  schemes, transparent, mesh and backface modes, and guided hints that ring the
  control to press next.
- The app now reports its version — in the top bar, in the imprint, and in the
  projects it saves.

## 0.1.0 — August 2026

The unnumbered first release at scanruler.com: ball bars and other artefacts
measured by fitted elements, deviation from a nominal part, wall thickness,
and STEP export. Deployed from every push, so no single commit is 0.1.0; it
is everything before the first numbered release.
