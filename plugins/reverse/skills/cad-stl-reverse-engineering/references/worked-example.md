<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Worked example: "Flexible Clamp.stl"

A print-in-place clamp exported from CAD, rebuilt as an exact 4-body STEP. Read it for the shape of a
whole job; the numbers are this part's, not rules.

## Input and inventory
- 7124 vertices, 14232 triangles, closed, 4 pieces → 4 bodies (clamp body, pivot pin, 2 jaw pads).
- Bounds X 71.096–176.098, Y 79.707–130.293, Z 5–18 (base at z = 5: a placement offset, kept).
- Horizontal levels z 5, 6.95, 11.5, 12.02, 16.05, 18; one oblique class |nz| 0.755 → every cone dz/dr
  0.866667 = 13/15. Heights / (13/15): 2.25, 7.5, 8.1, 12.75, 15 → **Z scaled by k = 13/15** (15 mm, 45°
  design delivered at 13 mm, 40.9°). X and Y round: R6, R3.75, R11.4, R3.
- Mirror about y = 105: vertex max 0.081 (tessellation differs), surface max 0.005 (geometry symmetric);
  the pads map onto each other (pieces 1 ↔ 2).

## Exact reads
- Plan outline at z = 13 (inside the vertical-wall band): 31 lines/arcs per half; arcs R12, R5.55,
  R4.5, R1.5, R1.05, R0.75, R11.4 (hub), R6.33 (pin hole), R3.975 (socket).
- Rings about the hub axis (125.70135, 105.00000): pin 3.75 / 6, hole 4.08 / 6.33 (clearance 0.33),
  spring ring 11.85 / 17.85 with chamfers 1.2 and 1.65, hub chamfer 1.8 radial × 1.56 axial.
- Pad axes x = 76.64625, y = 98.55 / 111.45: pad 3 / 3.75, socket 3.225 / 3.975 (clearance 0.225).
- Angular runs: spring ring −147.7…+147.7 → a 300° revolve; hub top cone 70.3…138.7 → trimmed by
  the arm and handle faces → a chamfer feature, not a revolve cut.
- Leftover after the first build: 7 vertices → a pair of R0.6 rounds (R0.599995, residual 5e-6).

## Parameters
| name | value | basis |
|---|---|---|
| k | 13/15 | cone slope 15:13; height 13 = 15·k |
| z0 | 5 | bottom face |
| Hd | 15 | design height |
| Rhub, cHub | 11.4, 1.8 | hub R11.40000; chamfer 1.8 radial × 1.8k = 1.56 axial |
| rPinEnd, rPin, cPin | 3.75, 6, 0.33 | pin R3.75 / R6; hole R4.08 / R6.33 |
| rRingIn, rRingOut, hRing | 11.85, 17.85, 7.5 | spring ring |
| rClear, hBridge | 20.7, 8.1 | handle clearance R20.7 up to z 12.02 = z0 + 8.1k |
| rPad, rPadMid, cPad | 3, 3.75, 0.225 | pad R3 / R3.75; socket R3.225 / R3.975 |
| rCorner | 0.6 | six vertical rounds at the clearance cut |

## Designer's tree (build order)
1. **Arms plan** on XY at z0: both arm halves, hub circle included, the 0.3 slit, the 0.9 slot and the
   V-gap as notches → extrude `Hd*k`.
2. **Handle clearance**: extrude-cut R20.7 sector down to the bridge underside.
3. **Spring ring**: chamfered profile revolved 300° (−150°…+150°, partial revolve via a constructed
   plane), joined; its ends bury in the arms.
4. **Pin hole**, **socket lower/upper**: revolve cuts.
5. **Hub chamfers** (bottom, top, top 2): 1.8 × 1.56 two-distance chamfers on the exposed hub arcs;
   one top edge came out swapped and was fixed with a `flip: true` feature.
6. **Clearance corner rounds**: R0.6 on 6 vertical edges, after the chamfers.
7. **Pin** (revolve, new body), **pads** (revolve, new) + **pad necks** (trapezoid prism, joined).

## The plan sketch spec (build_plan.py)
The z = 13 outline of the lower arm half with two design edits, then mirrored about y = 105:
(b) the pin-hole arc dropped, the V line run on to the 0.9 slot (y = 104.55), the slot and the 0.3 slit
run to the hub axis (the hole is a revolve cut); (c) the socket arc dropped, the two mouth lines run on
to their crossing (the socket is a revolve cut). A first version also dropped the hub arc R11.4
(`{"op": "extend", "piece": {"arc": {"r": 11.4, "near": [125.70135, 105.0]}}}`), planning the hub as its
own revolved, chamfered body. The cone ends showed the hub chamfer is a chamfer *feature* on the
extruded hub arcs, so the arc went back in. Decide the tree (§4) before editing the outline.

```json
{
  "plane": "z", "offset": 13.0,
  "loops": [{"near": [176.0, 81.5]}],
  "edits": [
    {"op": "replace", "from": {"arc": {"r": 6.33, "near": [125.70135, 105.0]}},
     "to": {"next": {"arc": {"r": 6.33, "near": [125.70135, 105.0]}}},
     "points": [{"on": {"prev": {"arc": {"r": 6.33, "near": [125.70135, 105.0]}}}, "v": 104.55},
                [125.70135, 104.55],
                {"u": 125.70135, "v": {"start": {"next": {"arc": {"r": 6.33, "near": [125.70135, 105.0]}}}}}],
     "trimPrev": true},
    {"op": "extend", "piece": {"arc": {"r": 3.975}}}
  ],
  "mirror": {"v": 105.0},
  "out": "data/arms_plan.json"
}
```
Result: 62 fixed entities (31 per half), closure gap 3e-14, 15 radii snapped (12.0000159 → 12 …),
junctions moved ≤ 5e-5. The `replace` reads: drop the R6.33 arc and the slit after it; move the end
of the V line before it to y = 104.55; draw on to (125.70135, 104.55), up to the slit's height at the
axis, and back along the slit to where the next piece starts.

## Validation reached
| check | result |
|---|---|
| `reverse_body_compare` range 0.02 | 7124/7124 within, RMS 0.0025, max ±0.012 (body tessellation), far 0 |
| Deviation workspace, no best fit | RMS 0.0008, 100 % within ±0.02, 0 hotspots, far 0 |
| two_way.py | mesh → model max 0.010, RMS 0.0013; model → mesh max 0.010, RMS 0.0016 |
| Volume | model 21310.8 vs mesh 21307.3 mm³ (+0.016 %) |
| Body check | 4 valid closed solids, no tiny faces; audit "steps" = 0.3 slit vs 0.9 slot (intended) |
| STEP re-import | unsound: false |
