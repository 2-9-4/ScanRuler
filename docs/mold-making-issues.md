<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Mold Making workspace — issue-ready backlog

> GitHub Issues was disabled on this newly forked repository at planning time (GitHub API returned HTTP 410). Enable **Settings → General → Features → Issues**, then turn each heading into an issue. IDs and dependencies are stable planning handles, not live GitHub issue numbers.

## Objective and constraints

Add a **dedicated Mold Making plugin**, never a separate app or duplicated CAD engine. Sources: (1) direct STEP/STP model with explicit tessellation tolerance/provenance, (2) measured/scanned mesh STL/PLY/OBJ/3MF with repair; optionally Reverse engineer solids. Workflows: (A) directly printed negative mold, (B) printed containment/box around a master for pouring silicone to form a reusable flexible mold, (C) thin offset negative sacrificial shell for casting silicone tooling. These have different solids/volumes and must not be conflated.

Reuse existing `src/plugins/api.ts` + `plugins/*/plugin.ts` architecture; `src/app/imports.ts`, `src/core/parsers/step.ts`, `src/app/solids.ts`, `plugins/mesh-tools/core/{boolean,offset,hollow,fillHoles}.ts`, `src/core/export{Stl,Mesh,3mf}.ts`, scene/worker APIs, project-section history/MCP commands. Do not import from plugin code into `src/`; avoid bundling or duplicating geometry kernels. Honor AGPL-3.0-only and the project's dependency-license policy.

## Delivery order
- **Phase 0 — architecture and inputs**: MOLD-001, MOLD-002, MOLD-003, MOLD-004, MOLD-024
- **Phase 1 — usable primary outputs**: MOLD-005, MOLD-006, MOLD-007, MOLD-008
- **Phase 2 — multipart production tooling**: MOLD-009, MOLD-010, MOLD-011, MOLD-012, MOLD-013, MOLD-014, MOLD-015, MOLD-016, MOLD-025, MOLD-026
- **Phase 3 — advanced/special-purpose workflows**: MOLD-017, MOLD-018, MOLD-019, MOLD-020, MOLD-021, MOLD-022, MOLD-023

## Feature comparison (MoldBoxer v2 site and download docs)

MoldBoxer-advertised workflows: adapted box, tray, multi-part silicone, inner core, direct open-base, direct top funnel, flexible skin, ceramic slip casting, custom fixtures, protective shells. Supporting features: adaptive/conformal boxes, multiple split planes, sealing barriers, smart foundations and keys, clamps/screw holes, funnels/sprues/vents/horizontal channels, undercut removal, air-trap pillars, volume/weight, branding, mesh cleanup, STL batch export, batch grid, hollowing. Source: https://moldboxer.com/ and https://moldboxer.com/download/windows (as of 2026-10-31). This is a capability checklist, not an instruction to copy proprietary code, data or UI.

## Issue descriptions (copy the title/body into GitHub Issues)

### MOLD-001 [P0] Establish Mold Making plugin and persistent workspace

**Scope:** Dedicated plugin under plugins/mold-making with tab, own store, guided workflow, undo/project save and reload; no imports from src into plugin. Integrate scan reset and worker if needed.

**Acceptance criteria:** Tab appears with target/mode/output sections; opening/saving .scanruler restores settings; tests and plugin-boundary check pass.

**Depends on:** None.

### MOLD-002 [P0] Target selection: direct STEP and imported scanned meshes

**Scope:** One target abstraction: editable CAD STEP or scan STL/PLY/OBJ/3MF; reuse ScanRuler loaders and unit handling. Choose active scan, reference STEP, or Reverse-engineer solid. Preserve original source and tessellation provenance.

**Acceptance criteria:** Use a STEP file directly without a reverse-engineering pass; use an imported scan directly; source switch never silently changes geometry or scale.

**Depends on:** MOLD-001.

### MOLD-003 [P0] Mold geometry data model, print presets and validation

**Scope:** Separate master, cavity, silicone material, containment, shell, cores, generated parts and scene preview. Parametric settings in millimetres: margin, thickness, gap, print compensation, cast shrink, unit provenance, resolution.

**Acceptance criteria:** Changes invalidate affected geometry only; reject bad/zero/negative dimensions; deterministic regenerations and project round-trip.

**Depends on:** MOLD-001, MOLD-002.

### MOLD-004 [P0] Geometry services: mesh repair, robust Booleans and offsets

**Scope:** Reuse Mesh Tools fill/closedness/offset/hollow/Boolean and Reverse CAD solid meshes; evaluate watertightness, self-intersections, normals and STEP tessellation quality. Run heavy work in existing workers, do not duplicate algorithms.

**Acceptance criteria:** Closed sample inputs yield manifold solids; nonmanifold scans explain repairs; Boolean errors do not export broken parts; large jobs cancellable.

**Depends on:** MOLD-002, MOLD-003.

### MOLD-005 [P0] Direct-print negative mold: open one-piece block

**Scope:** Create an outer mold block with target subtracted and user-set casting clearance, wall/base thickness and release direction. First ship for valid watertight, demoldable, open-top geometry; no promise undercut-safe.

**Acceptance criteria:** Generate and export printable STL; inspect positive target and negative cavity; cube/cylinder/organic test fixtures and signed volume checks.

**Depends on:** MOLD-003, MOLD-004.

### MOLD-006 [P0] Silicone mold tooling: box around physical/printed master

**Scope:** Construct print-ready containment box (optionally conformal) surrounding target/master with independently tunable silicone jacket thickness, base, seam and pour opening; not the same as subtractive direct mold.

**Acceptance criteria:** Preview silicone volume, master, and box separately; printed box fits physical target; independent part export and wall checks.

**Depends on:** MOLD-003, MOLD-004.

### MOLD-007 [P0] Thin negative cavity / offset sacrificial shell for silicone casting

**Scope:** Second silicone-tooling route: a thin 3D-printed shell that follows a *negative* target cavity (or matching inner/outer sections) for casting silicone tooling; explicit orientation, closed end, opening and deliberate breakaway/demold strategy. Avoid confusing with a conformal outer box.

**Acceptance criteria:** User can choose silicone box vs thin negative shell, set wall and clearance, and export printable manifold shell(s); minimum feature/wall checks.

**Depends on:** MOLD-004, MOLD-005, MOLD-006.

### MOLD-008 [P0] Part preview, component list, validation and STL/3MF batch export

**Scope:** Reuse ScanRuler scene layer, material transparency, sectional view, STL/3MF writers, project archive; show master, negative, box, shell, splits and channels as independent toggles.

**Acceptance criteria:** Generate/export every printable component separately with names and units; blocked exports for invalid/manifold failures; import into slicer without repairs.

**Depends on:** MOLD-003, MOLD-005, MOLD-006.

### MOLD-009 [P1] Parting plane workflow and two-piece direct/silicone molds

**Scope:** Interactive move/rotate split plane, choose which mold parts to keep; produce independent closed halves; alignment, parting gap and seam coverage; support reference datums.

**Acceptance criteria:** Planar split of watertight complex target produces two manifold components, correct cavity, no overlap, adjustable release/fit.

**Depends on:** MOLD-005, MOLD-006, MOLD-008.

### MOLD-010 [P1] Multi-plane and non-planar splits, 3+/4+ parts

**Scope:** Arbitrary and multiple splitting planes and eventually nonplanar user-drawn seam curves to accommodate shape/undercuts; reorder segments and validate intersections.

**Acceptance criteria:** Three/four part exports remain manifold and assemble correctly; seam preview, per-part naming, regression fixtures.

**Depends on:** MOLD-009.

### MOLD-011 [P1] Registration keys, lock barriers, clamps and hardware

**Scope:** Auto/manual pin-and-socket, cone/sphere keys, perimeter tongue-and-groove barriers, clamp wings/snap fits and screw holes; calibrated clearances by print process.

**Acceptance criteria:** Mating features align without Boolean leaks; visible fit clearance values and no clipping with target/channels.

**Depends on:** MOLD-009.

### MOLD-012 [P1] Funnels, pour sprues, gates, vents, and horizontal channels

**Scope:** Auto defaults plus manual route and edit positions/diameters, tapered funnels, risers, bleed vents, horizontal ties, printable supports; route channels through selected mold halves.

**Acceptance criteria:** Fluid route reaches the cavity and outside; all channels visible in preview, not blocked, exported to correct parts.

**Depends on:** MOLD-005, MOLD-006, MOLD-009.

### MOLD-013 [P1] Undercut/draft analysis and clear extraction

**Scope:** Heatmap by extraction vector, identify trapped surfaces; choose release direction, relief/clear extraction and splits where allowed; preserve target surface within tolerance.

**Acceptance criteria:** Known undercut fixture flags correctly; extraction test fails before export or offers validated corrective strategy.

**Depends on:** MOLD-004, MOLD-009.

### MOLD-014 [P1] Manufacturability calculator: materials, volume and cost

**Scope:** Exact/estimated cavity volume, silicone quantity, casting volume/mass from density, print volume, cost, tolerance and shrinkage; show uncertainty from scan/STEP tessellation.

**Acceptance criteria:** Known-volume fixtures within geometry tolerance; independent estimates for silicone-box and thin-shell routes; optional engraved volume text.

**Depends on:** MOLD-005, MOLD-006, MOLD-007.

### MOLD-015 [P1] Shape-adaptive boxes, bases, reusable jackets and efficient packing

**Scope:** Conformal outer envelopes with uniform clearance, rounded/rectangular/tray options, print-saving lattice/brace, stable base, sealing lips, assembly feet and reusable jacket.

**Acceptance criteria:** Adaptive box prints less than naive bounding cuboid at equivalent clearance, remains stable, manufacturable and watertight.

**Depends on:** MOLD-006, MOLD-008, MOLD-011.

### MOLD-016 [P1] Smart sealing, auto foundation, support islands and core mounts

**Scope:** Seal master-to-base intersections/gaps, build foundation at set reference and threshold angle, automatically pin free-floating masters or islands and stabilize thin cores.

**Acceptance criteria:** Open/complex test models can be prepared without unintended leaks or unsupported floating islands; supports can be toggled.

**Depends on:** MOLD-006, MOLD-013, MOLD-015.

### MOLD-017 [P2] Hollow castings: inner cavity cores and core retention

**Scope:** Generate negative mold plus positive core with wall thickness, extraction path, core keys, supports and drain/pour paths; reuse signed-distance hollowing.

**Acceptance criteria:** Hollow vessel example has known target wall thickness and removable core; multipart export verified.

**Depends on:** MOLD-009, MOLD-012, MOLD-013.

### MOLD-018 [P2] Flexible skin / mask molds and matched core

**Scope:** Direct-print mold + shaped core with controlled membrane thickness for silicone/latex skins; options for inlets, supports, split and release.

**Acceptance criteria:** Uniform-thickness skin fixture passes tolerances and release constraints.

**Depends on:** MOLD-017.

### MOLD-019 [P2] Ceramic slip-casting and plaster mold presets

**Scope:** Plaster/silicone/direct tooling, feet, shaped funnels, trimming plane, casting thickness, drainage, release undercuts; document material-specific allowances.

**Acceptance criteria:** Preset-specific mold parts export; slice shows slip paths and minimum walls.

**Depends on:** MOLD-010, MOLD-012, MOLD-017.

### MOLD-020 [P2] Tray, open-base, top-funnel and automatic box presets

**Scope:** Guided presets like Moldboxer's adapted/tray/multi-part/inner-cavity/direct-open-base/direct-top-funnel with safe defaults but all tunable; avoid duplicated generation code.

**Acceptance criteria:** User switches presets on same target and regenerates reliably; distinct output geometry matches intended workflow.

**Depends on:** MOLD-005, MOLD-006, MOLD-009, MOLD-012, MOLD-015.

### MOLD-021 [P2] Grid nesting / batch duplicate tooling and multi-cavity molds

**Scope:** Array identical or mixed targets with gates, mold walls, vents, clearance and box packing; coordinate with existing 2D measurement/placement tools.

**Acceptance criteria:** Batch exports produce connected, printable mold and per-cavity labeling/estimates.

**Depends on:** MOLD-012, MOLD-015.

### MOLD-022 [P2] Branding, surface labels and embedded volume metadata

**Scope:** Emboss/deboss text/logo, orientation/part number, cavities, casting material and volume; reuse existing CAD/mesh text capabilities where practical.

**Acceptance criteria:** Legible labels at print resolution, no leaks or accidental intersections with cavity.

**Depends on:** MOLD-008, MOLD-014.

### MOLD-023 [P2] Fixture and protective-shell companion workflows

**Scope:** Master-derived fixtures for holding, spray/paint/engraving and conformal protective cases, separate from casting mold logic but same geometry services.

**Acceptance criteria:** Fixture and shell workflows independently generate printable outputs.

**Depends on:** MOLD-004, MOLD-015.

### MOLD-024 [P0] Testing, benchmark fixtures and generated-mold safety checks

**Scope:** Build fixture corpus (cube, sphere, tray, overhang, deep bore, open scan, concave vessel, perforated mesh, STEP). Automate watertightness, connected components, norm/volume, cavity dimensions, clearance, assembly tests; visual e2e.

**Acceptance criteria:** npm test, build, e2e CI pass; corrupted meshes fail clearly; no silent export of invalid mold components.

**Depends on:** MOLD-001, MOLD-004.

### MOLD-025 [P1] MCP commands and automation workflow

**Scope:** Expose mold source/select/mode/settings/build/readout/export through existing command registry, bounded asynchronous worker progress and cancel. Provide guide.read instructions and state section.

**Acceptance criteria:** Headless and browser commands call same kernel and produce deterministic outputs; undo covers each editor action.

**Depends on:** MOLD-003, MOLD-008.

### MOLD-026 [P1] History, failure recovery and real-world mold QA

**Scope:** Parametric edit undo/redo, project/recovery persistence, cancellable jobs, memory budget, error cases and documentation on print orientation, FDM bleed, resin curing, draft and silicone chemistry.

**Acceptance criteria:** Restart/reopen preserves design; performance budgets documented; golden-reference physical test sequence covers direct and silicone modes.

**Depends on:** MOLD-008, MOLD-024.

## Cross-cutting definition of done

- Mesh math stays in millimetres, with explicit scan uncertainty, STEP tessellation and no fabricated precision.
- Each generation action runs in a worker (or justified nonblocking kernel), supports cancellation and reports failure without exporting broken geometry.
- Every generated part is independently previewable, manifold-validated, named and exported in print-ready orientation.
- User inputs do not silently mutate the original scan or STEP; save/load/undo and agent commands use the same operations.
- Tests cover exact primitive dimensions, signed volume, geometric tolerances, parity of output modes, invalid scans and multi-part mating.
- Default automatic workflow with optional advanced per-component edits; provide examples and concise safety limitations.
