<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Mold Making workspace

A native ScanRuler plugin for designing rigid printed casting molds and printed tooling for silicone molds.

## Current foundation scope

- A new **Mold Making** tab with an independent target and production-mode panel.
- Import **STEP/STP directly** or a scanned **STL/PLY/OBJ/3MF** through ScanRuler's existing scan/reference loaders; no mandatory reverse engineering or external converter.
- Choose between direct-print negative tooling, a containment box for silicone poured around a master, and a thin negative shell to cast silicone tooling. These are separate processes, not merely different wall thicknesses.
- Edit casting clearance, tooling margins, base/wall thickness and silicone jacket settings in millimetres.
- Save settings in `.scanruler` projects, restore them with validation, and undo/redo mode and dimension changes.

**Not yet implemented:** geometry generation, preview of generated parts, manifold/undercut verification or STL/3MF export. The Generate control is intentionally disabled until generation and export are safe. Target files loaded into ScanRuler are already viewable there.

See [issue-ready roadmap](../../docs/mold-making-issues.md) for planned phases and acceptance criteria. Use Mesh Tools to repair scans before generating; do not mutate an original mesh silently.
