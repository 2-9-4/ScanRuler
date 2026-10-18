<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Measuring a 3D scan — reference

The shapes behind SKILL.md. Every tool is a ScanRuler command with dots turned into underscores (`element.fit` is `element_fit`), plus the server's own four (`scanruler_status`, `scanruler_open`, `scanruler_wait`, `scanruler_batch`). Inputs are JSON; lengths in mm, angles in degrees. A field marked `?` is optional. An element, dimension or section is named by its id or by its name as the list shows it ("Plane 1").

**How answers come back.** JSON, numbers kept to six significant digits. A refusal comes back as text `code: message`, marked as an error; in a batch as `{ tool, ok: false, error: { code, message } }` (see Errors). A tool that takes a file takes `path` (absolute, or relative to the agent's folder) and the server reads it; a tool that hands a file back takes `path?` and the server writes it there, answering where and how large.

**Every tool that changes the session** is one undo step, takes `wait?` (`false` answers `{ queued: true, job }` at once), and runs as a job the server keeps.

## Command shapes

### The server's own tools

**`scanruler_status`** `{}` — `backend` ("page" or "headless"), `connected`, `page: { app, version, origin, plugins, viewport, hidden, commands }`, `server`, and when it applies `howToConnect`, `hiddenNote`, `jobs: [{ job, tool, state: "running" | "done" | "failed", ms | runningMs }]`, newest first, the last 50 kept.
Example: `{}`

**`scanruler_open`** `{}` — opens ScanRuler in the person's browser, paired, and waits; answers the status with `opened`. The first time the browser asks whether the site may reach apps on this computer; they must allow it.
Example: `{}`

**`scanruler_wait`** `{ for?: "page" | "idle" | "job", job?, timeoutSeconds? }` — until a page is connected (default), until it is also idle, or until a job is done — then `{ job, tool, state, ms, result }` or `{ …, error: { code, message } }`, `state: "running"` if the time ran out. 120 s by default, 600 at most.
Example: `{ for: "job", job: "j7" }`

**`scanruler_batch`** `{ calls: [{ tool, arguments? }], stopOnError?, rollback?, timings?, wait? }` — up to 200 calls in order (not the server's own four). Answers `{ results: [{ tool, ok, result } | { tool, ok: false, error }], ran, of }`, and when stopped `stopped` and `failed: { index, tool, error }`; with `rollback` (default true) the changes made before the refused call are undone and listed in `undone`, newest first; `rollback: false` keeps them; `stopOnError: false` runs every call and reports each. `timings: true` adds each result's `ms` and the batch's total_ms. A picture comes back as its text, written to a file only if its call gave `path`.
Example: `{ calls: [{ tool: "element_fit", arguments: { kind: "cylinder", at: { point: [20, 0, 5] } } }, { tool: "element_fit", arguments: { kind: "cylinder", at: { point: [-20, 0, 5] } } }, { tool: "dimension_add", arguments: { refs: ["Cylinder 1", "Cylinder 2"] } }] }`

### Session and history

**`session_state`** `{}` — the whole session: app and plugins, workspace, `busy`, the scan (file, units, counts, bounding box, centre, size, alignment), elements with fits, dimensions with values and verdicts, sections, deviation, thickness and 2D state, the guided hint, the undo history. Read-only; answers while a change runs.
Example: `{}`

**`scan_open`** `{ path, name?, units?: "mm" | "cm" | "m" | "in", discard?, wait? }` — an STL, PLY or OBJ as the scan; answers name, units, counts, bounding box, centre, size. Refused over measurements unless `discard: true`. Not undoable.
Example: `{ path: "C:/scans/bracket.stl", units: "mm" }`

**`session_reset`** `{ discard?, wait? }` — closes scan, reference and image. Not undoable.
Example: `{ discard: true }`

**`workspace_set`** `{ workspace: "measure" | "deviation" | "thickness" | "flat" | … }` — puts a workspace on screen for the person.
Example: `{ workspace: "measure" }`

**`history_checkpoint`** `{}` — marks where the undo history stands; answers `{ checkpoint, top, steps }`. Changes nothing.
Example: `{}`

**`history_restore`** `{ checkpoint, wait? }` — undoes every step since that mark, newest first; answers `{ undone, state }`. Refused, undoing nothing, once the mark is gone.
Example: `{ checkpoint: "cp2" }`

**`history_undo`** `{}` and **`history_redo`** `{}` — one step back or forward; answer the step's name and the session.
Example: `{}`

### The scan

**`scan_nearest`** `{ at: { point: [x, y, z] } | { vertex } }` — the vertex, its coordinates and outward normal, a triangle, the distance from the point. Read-only.
Example: `{ at: { point: [12, -4, 30] } }`

**`scan_query`** `{ box: { min, max } | near: { at, radius }, normal?: { dir, withinDeg? }, limit? }` — vertices in a box or ball, optionally facing a direction (within 30° by default); at most `limit` (1000 by default, 20000 at most), evenly thinned, `step` saying how. Answers `matched`, the vertex numbers, points, normals, box, centroid, mean normal.
Example: `{ box: { min: [0, -20, 9], max: [40, 20, 11] }, normal: { dir: [0, 0, 1] }, limit: 5000 }`

### Alignment

**`align_auto`** `{ detail?: "brief" | "full", wait? }` — a pose read off the scan: standing on its base, long side along X.
Example: `{}`

**`align_datum`** `{ primary: { element } | { points: [3 points] }, primaryAxis?, secondary?: { element } | { points: [2 points] }, secondaryAxis?, origin?: { element } | { point }, detail?, wait? }` — 3-2-1. Axes "x+", "x-" … "z-"; the primary's outward normal becomes `primaryAxis` (default z-), the secondary runs along `secondaryAxis` (default x+). An origin alone shifts without turning. Answers the transform and how many elements moved.
Example: `{ primary: { element: "Base" }, secondary: { element: "Line 1" }, origin: { element: "Cylinder 1" } }`

**`align_symmetry`** `{ detail?, wait? }` — re-poses the part on its mirror plane; refused when there is none.
Example: `{}`

**`align_clear`** `{ detail?, wait? }` — back to the scanner's coordinates.
Example: `{}`

### Elements

**`element_fit`** `{ kind: "plane" | "sphere" | "cylinder" | "cone" | "torus" | "point" | "circle", at: place | [place, …], sigma?: 3 | 2 | 1 | 0, assumed?, orient?: { to, relation?: "normal" | "inPlane" }, extend?, name?, wait? }` — a place is `{ point: [x, y, z] }` or `{ vertex: n }` (`{ screen }` and `{ candidate }` are not available yet). A circle goes through three or more places. `orient.to` is a plane element or "XY", "YZ", "ZX". `extend` draws a cylinder (`start`, `end`) or plane (`uMin`, `uMax`, `vMin`, `vMax`) past what was measured. Answers the element with its fit and the seed used.
Example: `{ kind: "plane", at: { point: [0, 0, 10] }, name: "Top" }`

**`element_fit_marked`** `{ kind: "plane" | "sphere" | "cylinder" | "cone" | "torus", vertices: [n, …], sigma?, assumed?, orient?, extend?, name?, wait? }` — fits exactly those vertices.
Example: `{ kind: "plane", vertices: [1023, 1024, 1090, 1102, 1150], name: "Datum A" }`

**`element_construct`** `{ kind, method, refs?, params?, seed?, vertices?, assumed?, orient?, name?, wait? }` — point: point-coords, point-centroid, point-midpoint, point-line-plane; line: line-two-points, line-axis, line-plane-plane; plane: plane-three-points, plane-offset, plane-midplane, plane-coords, plane-symmetry; circle: circle-plane-cylinder, circle-plane-sphere, circle-coords. `refs` fill the slots in order; `params` in order or by key (x, y, z; offset; nx, ny, nz, px, py, pz; d, cx, cy, cz). plane-symmetry takes `seed` ("XY", "YZ", "ZX" or a plane) and answers `symmetry: { rms, matched, sampled }`.
Example: `{ kind: "plane", method: "plane-midplane", refs: ["Left face", "Right face"], name: "Mid" }`

**`element_rename`** `{ element, name, wait? }` — dimensions keep pointing at it.
Example: `{ element: 3, name: "Datum B" }`

**`element_remove`** `{ element, wait? }` — with every construction and dimension on it.
Example: `{ element: "Plane 4" }`

**`element_set_visible`** `{ element? | all?: true, visible, wait? }` — a hidden element still measures.
Example: `{ all: true, visible: false }`

### Dimensions

**`dimension_add`** `{ refs: [1–3 elements], type?, anchor?: "center" | "gap" | "span", limit?, basic?, name?, wait? }` — types and their slots: dist-point-point (From, To); dist-point-axis (Point, Axis); dist-point-plane (Point, Plane); dist-axis-axis (Axis A, Axis B); dist-axis-plane (Axis, Plane); dist-plane-plane (From, To); angle-axis-axis; angle-axis-plane; angle-plane-plane; size-diameter (Feature); form-flatness (Plane); form-cylindricity (Cylinder); form-circularity (Circle); form-sphericity (Sphere); orient-parallelism, orient-perpendicularity, orient-angularity (Feature, Datum); loc-coaxiality (Feature, Datum axis). `limit` is `{ kind: "band", nominal, plus, minus }` or `{ kind: "max", max }`. Answers the value (finer than the panel shows), the formatted value and the verdict.
Example: `{ refs: ["Top", "Datum A"], type: "orient-parallelism", limit: { kind: "max", max: 0.05 } }`

**`dimension_set_limit`** `{ dimension, limit: {…} | null, wait? }`
Example: `{ dimension: "Distance 1", limit: { kind: "band", nominal: 40, plus: 0.1, minus: 0.1 } }`

**`dimension_set_basic`** `{ dimension, basic: degrees | null, wait? }` — an angularity's basic angle.
Example: `{ dimension: "Angularity 1", basic: 30 }`

**`dimension_remove`** `{ dimension, wait? }`
Example: `{ dimension: 4 }`

### Sections and the 2D sheet

**`section_cut`** `{ across: element | "XY" | "YZ" | "ZX", offset?, name?, wait? }` — keeps a section; a coordinate plane goes through the part's centre unless `offset` gives the coordinate. Answers its plane and chain count.
Example: `{ across: "XY", offset: 6.5, name: "Mid height" }`

**`section_get`** `{ section, chains?, space?: "sheet" | "world" | "both", limit? }` — each chain's points in order ([u, v] mm on the section plane; [x, y, z] with world), closed or not, length, box, and the plane (origin, normal, basisU, basisV: a sheet point is origin + u·basisU + v·basisV). 4000 points by default, 50000 at most.
Example: `{ section: "Mid height", limit: 2000 }`

**`flat_open_image`** `{ path, name?, wait? }` — a PNG or JPEG flatbed scan on the sheet. Not undoable.
Example: `{ path: "C:/scans/gasket.png" }`

**`flat_calibrate`** `{ mode: "distance" | "diameter", points: [[x, y], …], mm, wait? }` — two places a known distance apart, or three or more on a circle of known diameter.
Example: `{ mode: "distance", points: [[10.2, 5.1], [110.4, 5.3]], mm: 100 }`

**`flat_detect_edges`** `{ sensitivity?: 0–1, wait? }` — finds the edges again; chain numbers change.
Example: `{ sensitivity: 0.6 }`

**`flat_edges`** `{ box?, near?, reach?, minLength?, tolerance?, limit? }` — edge chains by number, longest first or nearest a place; `tolerance` adds thinned polylines. Read-only.
Example: `{ near: [42, 18], reach: 3, limit: 5 }`

**`flat_objects`** `{ threshold?, dark?, minArea?, outline?, limit? }` — parts on an image: area, holes, box, centroid, equivalent diameter, Feret widths, axis angle, chains. Read-only.
Example: `{ minArea: 5 }`

**`flat_fit`** `{ kind: "point" | "line" | "circle" | "arc" | "spline", method?, points?, chains?, box?, refs?, name?, snap?, reach?, wait? }` — methods: flat-point-pick, flat-point-midpoint, flat-point-intersect, flat-point-center; flat-line-pick, flat-line-seed, flat-line-edge; flat-circle-pick, flat-circle-seed, flat-circle-edge; flat-arc-pick, flat-arc-edge; flat-spline-pick.
Example: `{ kind: "circle", method: "flat-circle-edge", points: [[42.1, 18.3]] }`

**`flat_dimension_add`** `{ refs: [2 elements], type?: "flat-dist-point-point" | "flat-dist-point-line" | "flat-dist-line-line" | "flat-angle-line-line", name?, wait? }`
Example: `{ refs: ["Circle 1", "Circle 2"] }`

**`flat_set_alignment`** `{ origin?: [x, y], xAxis?: [x, y], clear?, wait? }`
Example: `{ origin: [42.1, 18.3], xAxis: [90.0, 18.3] }`

**`flat_profile`** `{ object? | chains?, about?, axis?: "radial" | "axial", samples?, prominence?, mark?, points? }` — peaks of an outline: count, pitch, envelope.
Example: `{ object: 1, axis: "radial", mark: true }`

**`flat_note_add`** `{ text, at: [x, y], wait? }`; **`flat_edit`** `{ element? | dimension? | note? | count?, name?, text?, at?, visible?, wait? }`; **`flat_remove`** `{ elements?, dimensions?, notes?, counts?, wait? }`
Example: `{ text: "Gasket A, 2 mm cork", at: [5, 5] }`

**`flat_render`** `{ frame?: { min, max } | { at, size }, width?, height?, show?: { image?, edges?, chains?, elements?, dimensions?, notes?, labels?, grid? }, path? }` — a PNG of the sheet, +X right, +Y up, with a grid; `map` turns pixel (c, r) into [left + c·unitsPerPx, top − r·unitsPerPx].
Example: `{ show: { chains: true }, frame: { at: [42, 18], size: 30 } }`

**`flat_report`** `{}` — the 2D report as the panel's Copy gives it.
Example: `{}`

### Deviation

**`deviation_open_reference`** `{ path, name?, units?, wait? }` — STEP, STL, PLY or OBJ as the reference; any alignment against the old one goes. Not undoable.
Example: `{ path: "C:/parts/bracket.step" }`

**`deviation_align`** `{ mode?: "auto" | "points" | "local", pairs?: [{ scan, reference }, …], vertices?, searchDistance?, wait? }` — rigid best fit, no scale; answers RMS, points matched, transform and the map's statistics.
Example: `{ mode: "local", vertices: [1023, 1024, 1090, 1102], searchDistance: 0.5 }`

**`deviation_settings`** `{ range?, maxDistance?, bands?, tolerance?, facingDeg?, colormap?: "jet" | "viridis" | "magma" | "plasma" | "inferno" | "cividis" | "mako" | "rocket" | "turbo", wait? }` — answers the deviation state with `settings.colormap` (the ramp at −range, 0, +range, the caps, the unmeasured grey).
Example: `{ tolerance: 0.1, range: 0.3, maxDistance: 1.5 }`

**`deviation_measure`** `{ wait? }` — measures the map again under the alignment in hand.
Example: `{}`

**`deviation_hotspots`** `{ tolerance?, patches?, grain? }` — patches over tolerance (centre, box, area, vertices, mean, extreme, side, a few vertex numbers), `found`, `over`, and `far: { inside, outside, count }`, `unmeasured`. Read-only.
Example: `{ patches: 12 }`

**`deviation_set_target`** `{ element: element | null, side?: "outward" | "inward", facingDeg?, wait? }` — the map against one fitted element; null goes back to the reference.
Example: `{ element: "Datum A" }`

### Wall thickness

**`thickness_settings`** `{ method?: "ray" | "sphere", maxThickness?, coneRays?, coneAngleDeg?, normalDeviationDeg?, low?, high?, bands?, limit?, wait? }`
Example: `{ method: "ray", maxThickness: 6, coneRays: 8, coneAngleDeg: 10, limit: 1.2 }`

**`thickness_measure`** `{ method?, maxThickness?, coneRays?, coneAngleDeg?, normalDeviationDeg?, wait? }` — min, max, mean, sigma, share under the limit, points measured.
Example: `{}`

### Pictures

**`view_render`** `{ view?: "iso" | "top" | "bottom" | "front" | "rear" | "left" | "right", fit?, frame?: { min, max } | { at, size }, show?: { scan?, reference?, sections?, elements?, labels? }, section?: true | false | { across, offset?, flip? }, width?, height?, path? }` — a PNG of the viewport, 800 px on the long side by default, up to 2048; waits for the session to settle.
Example: `{ view: "iso", width: 1400, path: "C:/scans/out/iso.png" }`

**`view_set`** `{ view?, fit?, frame?, show?, section? }` — the same, kept; answers every show key standing now. Not an undo step.
Example: `{ view: "top", fit: true }`

### Report and files

**`report_get`** `{ format?: "json" | "text", workspace?: "measure" | "deviation" | "thickness" | "flat" }`
Example: `{ format: "text", workspace: "deviation" }`

**`project_save`** `{ path? }`; **`project_load`** `{ path, name?, discard?, wait? }`; **`project_rename`** `{ name, wait? }`
Example: `{ path: "C:/scans/out/bracket.scanruler" }`

**`export_step`** `{ style?: "solids" | "surfaces", path? }` — the fitted elements as analytic STEP.
Example: `{ path: "C:/scans/out/bracket_elements.step" }`

**`export_stl`** `{ path? }` — the scan in its aligned pose. **`export_cloud`** `{ format?: "ply" | "xyz", path? }` — points with normals. **`export_csv`** `{ path? }` — the 2D measurements. **`export_dxf`** `{ path? }` and **`export_svg`** `{ path? }` — the 2D sheet at true scale.
Example: `{ path: "C:/scans/out/bracket_aligned.stl" }`

## Reply cost

Answer sizes measured on a real scan — a vacuum adapter, a plane fitted and a section cut on it (2026-10-18): the text as the client gets it, rounded by the server; tokens at four bytes each, a picture at width × height / 750. Choose the cheaper call; a figure scales with the part.

| Tool and options | Bytes | Tokens | Note |
|---|---|---|---|
| `session_state`, a plane and a section | 20,024 | 5,006 |  |
| `element_fit` one plane or cylinder | 629 | 157 |  |
| `dimension_add` one dimension with a limit | not measured | — |  |
| `align_datum` `detail: "brief"` | not measured | — |  |
| `align_datum` `detail: "full"`, a dozen elements | not measured | — |  |
| `scan_query` `limit: 1000` | 51,486 | 12,872 |  |
| `scan_query` `limit: 5000` | 256,439 | 64,110 |  |
| `section_get` `limit: 4000` (default) | 52,091 | 13,023 |  |
| `section_get` `limit: 1000` | 18,000 | 4,500 |  |
| `deviation_hotspots` defaults | not measured | — |  |
| `flat_edges` `limit: 50` (default) | not measured | — |  |
| `flat_edges` with `tolerance` | not measured | — | polylines |
| `report_get` `format: "json"` | 5,795 | 1,449 |  |
| `report_get` `format: "text"` | 1,695 | 424 |  |
| `view_render` 800 px (default) | 117 + image | 666 | image |
| `view_render` `width: 1400` | 119 + image | 1,979 | image; deliverables only |
| `flat_render` 800 px (default) | not measured | — | image |
| `scanruler_batch` overhead per call | 78 | 20 | beyond the call's own answer |
| `scanruler_batch` `timings: true`, per call | not measured | — |  |

## Errors

A refusal is `code: message`.

| Code / message pattern | Cause | Fix |
|---|---|---|
| **unknown_command** "There is no tool …" | The tool is not on the page (stale list, older build) | `scanruler_status`; load the tools again |
| **invalid_input** | The input does not fit the schema, or names something that cannot be used there | Read the message; it names the field |
| **invalid_input** "Could not read …: there is no such file" | A `path` that does not exist on the server's computer | Absolute path, or relative to the agent's folder |
| **invalid_input** "… has no direction to cut across" | `section_cut` across a point or sphere | Cut across a plane, cylinder, cone, line, circle or a coordinate plane |
| **invalid_input** "Give box or near — one of them." | `scan_query` with both or neither | One of them |
| **invalid_input** "show.…: no such key" | A show key not on screen in this workspace | Use the keys `view_set` lists |
| **invalid_input** "… is the server's own and is not batched" | A server tool inside `scanruler_batch` | Call it on its own |
| **busy** "The session is busy — …" | Loading, fitting or measuring already, or the person is | `scanruler_wait { for: "idle" }`, then retry |
| **no_scan** "No scan is open" | A scan tool with no scan | `scan_open` |
| **not_found** | An element, dimension, section, chain, checkpoint or job named does not exist | Read the list the message gives; 2D chain numbers change after edge detection |
| **invalid_state** "The 3D Measure panel has … — finish or cancel it there first" | The person has something open in the panel | Ask them to finish or cancel it |
| **invalid_state** "The session holds measurements that … would replace" | `scan_open`, `project_load` or `session_reset` over work | `project_save` first, or `discard: true` |
| **invalid_state** "The 2D workspace is on screen …" | `view_render` while the sheet is shown | `flat_render`, or `workspace_set { workspace: "measure" }` |
| **invalid_state** "Nothing is on the 2D sheet" | A flat tool with no image or section | `flat_open_image`, or `section_cut` |
| **invalid_state** "No edges are detected on the sheet" | Edge methods with no edges | `flat_detect_edges` at a higher sensitivity |
| **invalid_state** "There is nothing to undo" | Empty history | — |
| **invalid_state** "The history no longer holds the step the checkpoint was made on" | `history_restore` after the mark was undone or the history restarted | Nothing was undone; read the state |
| **failed** | Ran and did not succeed: a fit that found no surface, a file that would not read | Read the message; move the seed or change the input |
| **failed** "The plane misses the scan" | `section_cut` offset outside the part | A coordinate within the bounding box |
| **failed** "Gave up waiting for … after N s" | The app did not settle in time | `scanruler_wait { for: "idle" }`, read the state before retrying |
| **unavailable** "… needs the ScanRuler page" | A headless server: no scan, viewport or browser | Start scanruler-mcp in page mode, paired with a tab |
| **unavailable** "No ScanRuler page is connected" | No tab paired | `scanruler_open` |
| **unavailable** "The mesh worker is not running" | The page is still starting | `scanruler_wait { for: "idle" }` |
| **not_implemented** | `{ screen }` or `{ candidate }` places | Use `{ point }` or `{ vertex }` |
| **internal** | A fault of the app | Report it with the call; try another route |
