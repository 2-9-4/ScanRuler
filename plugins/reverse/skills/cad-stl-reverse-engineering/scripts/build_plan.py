# SPDX-License-Identifier: AGPL-3.0-only
"""Exact loop -> ScanRuler sketch entities, with design edits, nominal radii and optional mirroring.

    python build_plan.py spec.json

Use it instead of sketch.fit on a CAD mesh: fit is tuned for scans (off by up to 0.24 mm, small
features merged, or open ends at tight settings). This emits `fixed` lines and arcs whose ends are
shared exactly between neighbours, so the kernel's 2 um closure is met by construction.

spec.json (every key but "loops" optional):
{
  "data": "data",                      work folder of load.py
  "plane": "z", "offset": 13.0,        world plane to slice (z: u=X v=Y; x: u=Y v=Z; y: u=Z v=X)
  "loops": [                           which loops (each selector picks one or more)
    {"piece": 0, "box": [0, 0, 999, 105]},     mesh piece and/or a box [u0,v0,u1,v1] the loop lies in
    {"near": [76.6, 98.5]},                    the loop passing nearest a point
    {"points": [[0,0],[5,0],[5,3]], "closed": true}   a polygon given outright (e.g. a revolve profile)
  ],
  "edges": false,                      true: read the mesh edges lying in the plane (a face boundary or a vertex
                                       ring, e.g. offset 0 = the bottom face) instead of slicing - see profile.py --edges
  "tol": 1e-4,                         circle-fit tolerance of the segmentation
  "grow": 2.6,                         offset the finished loop(s) by this much, outward positive (smooth loops only):
                                       a bead's apex outline, a lip, a drafted extrude's top outline
  "edits": [ ... ],                    applied in order, see below
  "snap": {"decimals": 3, "within": 1e-4},   radius -> round(r, decimals) when within that of it; false = off
  "mirror": {"v": 105.0, "dropOnAxis": false}, reflect about the line v = 105 (or {"u": x0}) and add the copy
  "axisLines": [[[0, 0], [0, 10]]],    construction lines to add (revolve axes)
  "firstId": 1,                        id of the first entity (edits of a live sketch: above its freeIds)
  "out": "data/plan.json"
}

Loop direction: every closed mesh loop is walked counter-clockwise in (u, v) before the edits (ORIENT), whatever
order the STL's triangles come in, so {"prev": ...} / {"next": ...} are stable across exports.
Piece selectors (resolved afresh before every edit, so earlier edits can't shift them):
  {"arc": {"r": 11.4, "near": [125.7, 105]}}   an arc or circle of that radius (+-1e-3), centre near a point
  {"line": {"through": [130, 104.85]}}          the line passing within 1e-3 of a point
  {"line": {"near": [130, 104.85]}}             the line nearest a point
  {"index": 5, "loop": 0}                       by position (printed by profile.py / this script)
  {"prev": <selector>}, {"next": <selector>}    the neighbour in loop order
Point specs:  [u, v] | {"meet": [selA, selB]} (crossing of two lines, extended) | {"on": sel, "u": x} or
  {"on": sel, "v": y} (point of a line at that coordinate) | {"start": sel} | {"end": sel} |
  {"u": <number|point spec>, "v": <number|point spec>} (coordinates taken from each)
Edits:
  {"op": "extend", "piece": sel}       drop a piece; its two neighbouring lines run on to their crossing
                                        (e.g. an arc that belongs to another feature: a hub, a revolved hole)
  {"op": "replace", "from": sel, "to": sel, "points": [pt, ...], "trimPrev": true, "trimNext": false}
                                        drop pieces from..to (loop order) and bridge the gap with lines through
                                        the points; trimPrev/trimNext move the neighbour's end onto the first/last
                                        point instead of drawing a line to it
  {"op": "radius", "piece": sel, "r": 11.4}   set a radius outright (a value the snap rule wouldn't reach)

Arcs come out as ScanRuler wants them: {c, r, start, sweep} in radians, sweep counter-clockwise positive
(negative sweeps normalised: start += sweep, sweep = -sweep). The mirrored copy uses start' = -(start+sweep)
(about v) or pi-(start+sweep) (about u), same sweep, line ends swapped.
"""
import json, os, sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from load import load_work
from profile import slice_loops, edge_loops, select_loops, segment_exact, nominal

TWO_PI = 2 * np.pi
ORIENT = 1           # loops are walked counter-clockwise in (u, v) before edits (-1: clockwise)


def signed_area(uv):
    uv = np.asarray(uv, float)
    return 0.5 * float(np.sum(uv[:, 0] * np.roll(uv[:, 1], -1) - np.roll(uv[:, 0], -1) * uv[:, 1]))


# ---------------------------------------------------------------- selectors and points
def _seg_dist(p, a, b):
    d = b - a; t = np.clip((p - a) @ d / (d @ d), 0, 1)
    return np.linalg.norm(p - (a + t * d))


def find(loops, sel):
    """-> (loop index, piece index)."""
    if 'prev' in sel or 'next' in sel:
        li, k = find(loops, sel.get('prev', sel.get('next')))
        n = len(loops[li]['pieces'])
        return li, (k - 1) % n if 'prev' in sel else (k + 1) % n
    hits = []
    for li, L in enumerate(loops):
        if 'loop' in sel and sel['loop'] != li:
            continue
        for k, pc in enumerate(L['pieces']):
            if 'index' in sel:
                if k == sel['index']:
                    hits.append((li, k, 0))
            elif 'arc' in sel and pc['kind'] in ('arc', 'circle'):
                s = sel['arc']
                if abs(pc['r'] - s['r']) < s.get('tol', 1e-3) and ('near' not in s or np.linalg.norm(pc['c'] - s['near']) < s.get('within', 1e-2)):
                    hits.append((li, k, 0))
            elif 'line' in sel and pc['kind'] == 'line':
                s = sel['line']
                if 'through' in s:
                    if _seg_dist(np.asarray(s['through'], float), pc['a'], pc['b']) < s.get('tol', 1e-3):
                        hits.append((li, k, 0))
                else:
                    hits.append((li, k, _seg_dist(np.asarray(s['near'], float), pc['a'], pc['b'])))
    if 'line' in sel and 'near' in sel['line'] and hits:
        hits = [min(hits, key=lambda h: h[2])]
    if len(hits) != 1:
        raise SystemExit(f'selector {sel} matched {len(hits)} pieces: {[(h[0], h[1]) for h in hits]}')
    return hits[0][:2]


def piece_of(loops, sel):
    li, k = find(loops, sel)
    return loops[li]['pieces'][k]


def meet(p, q):
    d1 = p['b'] - p['a']; d2 = q['b'] - q['a']
    t = np.linalg.solve(np.array([d1, -d2]).T, q['a'] - p['a'])
    return p['a'] + t[0] * d1


def point(loops, spec):
    if isinstance(spec, (list, tuple)):
        return np.asarray(spec, float)
    if 'meet' in spec:
        return meet(piece_of(loops, spec['meet'][0]), piece_of(loops, spec['meet'][1]))
    if 'on' in spec:
        pc = piece_of(loops, spec['on']); d = pc['b'] - pc['a']
        i = 0 if 'u' in spec else 1
        val = spec['u'] if 'u' in spec else spec['v']
        return pc['a'] + d * (val - pc['a'][i]) / d[i]
    if 'start' in spec:
        return piece_of(loops, spec['start'])['a'].copy()
    if 'end' in spec:
        return piece_of(loops, spec['end'])['b'].copy()
    if 'u' in spec and 'v' in spec:
        g = lambda x, i: float(x) if isinstance(x, (int, float)) else float(point(loops, x)[i])
        return np.array([g(spec['u'], 0), g(spec['v'], 1)])
    raise SystemExit(f'point spec not understood: {spec}')


# ---------------------------------------------------------------- piece geometry
def set_end(pc, which, P):
    """Move a piece's start ('a') or end ('b') to P; an arc keeps its circle and its turning direction."""
    pc[which] = np.asarray(P, float).copy()
    if pc['kind'] == 'arc':
        sync_arc(pc)


def sync_arc(pc):
    """Recompute start/sweep from the end points, keeping the sweep nearest its old value."""
    s = np.arctan2(pc['a'][1] - pc['c'][1], pc['a'][0] - pc['c'][0])
    e = np.arctan2(pc['b'][1] - pc['c'][1], pc['b'][0] - pc['c'][0])
    sw = e - s
    old = pc.get('sweep', sw)
    sw += TWO_PI * np.round((old - sw) / TWO_PI)
    pc['start'], pc['sweep'] = s, sw


def line(a, b):
    return dict(kind='line', a=np.asarray(a, float).copy(), b=np.asarray(b, float).copy())


def apply_edit(loops, e):
    op = e['op']
    if op == 'extend':
        li, k = find(loops, e['piece']); P = loops[li]['pieces']; n = len(P)
        prv, nxt = P[(k - 1) % n], P[(k + 1) % n]
        if prv['kind'] != 'line' or nxt['kind'] != 'line':
            raise SystemExit(f'extend {e["piece"]}: both neighbours must be lines')
        X = meet(prv, nxt)
        set_end(prv, 'b', X); set_end(nxt, 'a', X)
        del P[k]
        print(f'  extend: dropped piece {k} of loop {li}; neighbours meet at {X.round(6).tolist()}')
    elif op == 'replace':
        li, i = find(loops, e['from']); lj, j = find(loops, e.get('to', e['from']))
        if li != lj:
            raise SystemExit('replace: from and to must be in one loop')
        P = loops[li]['pieces']; n = len(P)
        pts = [point(loops, s) for s in e.get('points', [])]      # resolve before anything moves
        idx = [(i + t) % n for t in range(((j - i) % n) + 1)]
        prv, nxt = P[(i - 1) % n], P[(j + 1) % n]
        if e.get('trimPrev') and pts:
            set_end(prv, 'b', pts[0]); chain = pts
        else:
            chain = [prv['b']] + pts
        if e.get('trimNext') and pts:
            set_end(nxt, 'a', pts[-1])
        else:
            chain = chain + [nxt['a']]
        new = [line(chain[t], chain[t + 1]) for t in range(len(chain) - 1)]
        keep = [pc for t, pc in enumerate(P) if t not in idx]
        at = next((t + 1 for t, pc in enumerate(keep) if pc is prv), 0)
        loops[li]['pieces'] = keep[:at] + new + keep[at:]
        print(f'  replace: dropped pieces {idx} of loop {li}, drew {len(new)} line(s)')
    elif op == 'radius':
        pc = piece_of(loops, e['piece']); pc['r'] = float(e['r']); pc['fixedR'] = True
    else:
        raise SystemExit(f'unknown edit {op}')


# ---------------------------------------------------------------- exact junctions
def turn_deg(p, q):
    """Angle between p's direction at its end and q's at its start (0 = tangent)."""
    def tdir(pc, at_end):
        if pc['kind'] == 'line':
            d = pc['b'] - pc['a']
        else:
            r = (pc['b'] if at_end else pc['a']) - pc['c']
            d = np.array([-r[1], r[0]]) * np.sign(pc['sweep'])
        return d / np.linalg.norm(d)
    u, v = tdir(p, True), tdir(q, False)
    return np.degrees(np.arctan2(abs(u[0] * v[1] - u[1] * v[0]), u @ v))


def finalize(L, snap):
    """Snap radii, then make every junction exact: one point shared by both pieces, on every circle it
    touches. Line/arc: the point goes radially onto the circle (moves ~1e-5). Arc/arc: where they cross
    at a corner, the circles' crossing; where they join smoothly, the second arc's centre moves onto
    exact tangency (a crossing there would leave a ~0.1 deg kink that stops fillet chains)."""
    P = L['pieces']; n = len(P)
    log = dict(snapped=[], moved=0.0, centre=0.0, gaps=[])
    if snap:
        for pc in P:
            if pc['kind'] in ('arc', 'circle') and not pc.get('fixedR'):
                rn = nominal(pc['r'], snap.get('decimals', 3), snap.get('within', 1e-4))
                if rn is not None and rn != pc['r']:
                    log['snapped'].append((round(float(pc['r']), 7), rn)); pc['r'] = rn
    smooth = {}
    for k in range(n if L['closed'] else n - 1):
        p, q = P[k], P[(k + 1) % n]
        if p['kind'] == 'circle' or q['kind'] == 'circle':
            continue
        gap = np.linalg.norm(p['b'] - q['a'])
        if gap > 1e-4:
            log['gaps'].append((k, gap)); continue
        smooth[k] = turn_deg(p, q) < 0.5
    orig = {k: P[k]['b'].copy() for k in smooth}
    for _ in range(3):                      # a moved centre shifts that arc's other end: repeat until still
        for k in smooth:
            p, q = P[k], P[(k + 1) % n]
            J = (p['b'] + q['a']) / 2
            if p['kind'] == 'line' and q['kind'] == 'line':
                J2 = J
            elif p['kind'] == 'arc' and q['kind'] == 'arc':
                c1, r1, c2, r2 = p['c'], p['r'], q['c'], q['r']
                d = np.linalg.norm(c2 - c1); u = (c2 - c1) / d
                a = (d * d + r1 * r1 - r2 * r2) / (2 * d); h2 = r1 * r1 - a * a
                if not smooth[k] and h2 > 0:
                    m = c1 + a * u; h = np.sqrt(h2); w = np.array([-u[1], u[0]])
                    J2 = min((m + h * w, m - h * w), key=lambda X: np.linalg.norm(X - J))
                else:
                    J2 = c1 + r1 * (np.sign((J - c1) @ u) or 1.0) * u
                    c2n = J2 + r2 * (np.sign((c2 - J2) @ u) or 1.0) * u
                    log['centre'] = max(log['centre'], float(np.linalg.norm(c2n - c2)))
                    q['c'] = c2n
            else:
                arc = p if p['kind'] == 'arc' else q
                J2 = arc['c'] + arc['r'] * (J - arc['c']) / np.linalg.norm(J - arc['c'])
            p['b'] = J2.copy(); q['a'] = J2.copy()
    for k in smooth:
        log['moved'] = max(log['moved'], float(np.linalg.norm(P[k]['b'] - orig[k])))
    for pc in P:
        if pc['kind'] == 'arc':
            sync_arc(pc)
    log['kink'] = max([turn_deg(P[k], P[(k + 1) % n]) for k in smooth if smooth[k]] or [0.0])
    return log


def grow(L, d):
    """Offset a closed, tangent-continuous loop by d (outward positive): lines move along their
    outward normal, arcs keep their centre and change radius (convex +d, concave -d). Junctions stay
    shared because every join is smooth; a corner (kink) would need a trim and is refused."""
    P = L['pieces']; n = len(P)
    if not L['closed']:
        raise SystemExit('grow: the loop must be closed')
    if n == 1 and P[0]['kind'] == 'circle':
        P[0]['r'] += d
        return
    for k in range(n):
        if turn_deg(P[k], P[(k + 1) % n]) > 1e-3:
            raise SystemExit(f'grow: corner after piece {k} ({turn_deg(P[k], P[(k + 1) % n]):.3g} deg); only smooth loops')
    poly = np.array([pc['a'] for pc in P])
    area = 0.5 * np.sum(poly[:, 0] * np.roll(poly[:, 1], -1) - np.roll(poly[:, 0], -1) * poly[:, 1])
    for pc in P:
        if pc['kind'] in ('arc', 'circle'):
            # a CCW loop turns left round its outside: CCW arcs are convex
            conv = (pc.get('sweep', 1.0) > 0) == (area > 0)
            r = pc['r'] + (d if conv else -d)
            if r <= 0:
                raise SystemExit(f'grow: arc R{pc["r"]} would vanish')
            for e in ('a', 'b'):
                if e in pc:
                    v = pc[e] - pc['c']; pc[e] = pc['c'] + r * v / np.linalg.norm(v)
            pc['r'] = r
        else:
            t = (pc['b'] - pc['a']) / np.linalg.norm(pc['b'] - pc['a'])
            nrm = np.array([t[1], -t[0]]) * (1 if area > 0 else -1)
            pc['a'] = pc['a'] + d * nrm; pc['b'] = pc['b'] + d * nrm
    for k in range(n):                      # tie the ends together exactly again
        J = (P[k]['b'] + P[(k + 1) % n]['a']) / 2
        P[k]['b'] = J.copy(); P[(k + 1) % n]['a'] = J.copy()
    for pc in P:
        if pc['kind'] == 'arc':
            sync_arc(pc)


def ccw(pc):
    if pc['kind'] == 'arc' and pc['sweep'] < 0:
        return dict(pc, start=pc['start'] + pc['sweep'], sweep=-pc['sweep'], a=pc['b'], b=pc['a'])
    return pc


def mirror_piece(pc, ax, at):
    i = 0 if ax == 'u' else 1
    f = lambda q: np.array([2 * at - q[0], q[1]]) if i == 0 else np.array([q[0], 2 * at - q[1]])
    if pc['kind'] == 'line':
        return line(f(pc['b']), f(pc['a']))
    if pc['kind'] == 'circle':
        return dict(pc, c=f(pc['c']))
    st = -(pc['start'] + pc['sweep']) if i == 1 else np.pi - (pc['start'] + pc['sweep'])
    return dict(pc, c=f(pc['c']), a=f(pc['b']), b=f(pc['a']), start=st, sweep=pc['sweep'])


def arc_ends(pc):
    s, e = pc['start'], pc['start'] + pc['sweep']
    return (pc['c'] + pc['r'] * np.array([np.cos(s), np.sin(s)]), pc['c'] + pc['r'] * np.array([np.cos(e), np.sin(e)]))


def inside_point(pieces):
    """A point inside a closed loop (for regions: [{at}]): middle of the widest span on the mid-height ray."""
    poly = []
    for pc in pieces:
        if pc['kind'] == 'line':
            poly.append(pc['a'])
        elif pc['kind'] == 'arc':
            for t in np.linspace(0, 1, 16, endpoint=False):
                ang = pc['start'] + t * pc['sweep']
                poly.append(pc['c'] + pc['r'] * np.array([np.cos(ang), np.sin(ang)]))
        else:
            return pc['c'].tolist()
    poly = np.array(poly)
    best = None
    for fv in (0.5, 0.37, 0.63, 0.25, 0.75):
        y = poly[:, 1].min() + fv * np.ptp(poly[:, 1])
        xs = []
        for a, b in zip(poly, np.roll(poly, -1, 0)):
            if (a[1] < y) != (b[1] < y):
                xs.append(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]))
        xs.sort()
        for x0, x1 in zip(xs[0::2], xs[1::2]):
            if best is None or x1 - x0 > best[0]:
                best = (x1 - x0, [(x0 + x1) / 2, y])
    return best[1] if best else None


# ---------------------------------------------------------------- main
def build(spec):
    data = spec.get('data', 'data')
    axis = spec.get('plane', 'z'); off = spec.get('offset')
    tol = spec.get('tol', 1e-4)
    loops = []
    cut = None
    for sel in spec['loops']:
        if 'points' in sel:
            q = np.asarray(sel['points'], float); cl = sel.get('closed', True)
            ps = [line(q[t], q[(t + 1) % len(q)]) for t in range(len(q) if cl else len(q) - 1)]
            loops.append(dict(src='points', piece=None, closed=cl, pieces=ps)); continue
        if cut is None:
            V, F, piece = load_work(data)
            cut = edge_loops(V, F, piece, axis, off) if spec.get('edges') else slice_loops(V, F, piece, axis, off)
        pcs = [sel['piece']] if 'piece' in sel else sel.get('pieces')
        for k, uv, pc, closed in select_loops(cut, axis, pcs, sel.get('box'), sel.get('near')):
            # the slice/edge walk follows the mesh's own order, which differs between exports of one
            # part: orient every closed loop one way, so prev/next in the edits mean the same thing
            if closed and signed_area(uv) * ORIENT < 0:
                uv = uv[::-1]
            loops.append(dict(src=f'loop {k}', piece=pc, closed=closed, pieces=segment_exact(uv, closed, tol)))
    if not loops:
        raise SystemExit('no loop selected')
    for li, L in enumerate(loops):
        print(f'loop {li} ({L["src"]}, piece {L["piece"]}, {"closed" if L["closed"] else "OPEN"}): {len(L["pieces"])} pieces')
        for k, pc in enumerate(L['pieces']):
            if pc['kind'] == 'line':
                print(f'   {k:3d} L {pc["a"].round(5).tolist()} -> {pc["b"].round(5).tolist()}')
            else:
                print(f'   {k:3d} {"A" if pc["kind"] == "arc" else "O"} c={pc["c"].round(5).tolist()} R={pc["r"]:.5f}')
    for e in spec.get('edits', []):
        apply_edit(loops, e)
    snap = spec.get('snap', {'decimals': 3, 'within': 1e-4})
    for li, L in enumerate(loops):
        log = finalize(L, snap)
        print(f'loop {li}: {len(L["pieces"])} pieces; radii snapped {log["snapped"]}; junctions moved <= {log["moved"]:.2e};'
              f' centres moved <= {log["centre"]:.2e}; kink at smooth joins <= {log["kink"]:.2e} deg')
        for k, g in log['gaps']:
            print(f'   GAP after piece {k}: {g:.4g} mm - the loop is open there; check the edits')
    if spec.get('grow'):
        for li, L in enumerate(loops):
            grow(L, float(spec['grow']))
            print(f'loop {li}: grown by {spec["grow"]} mm (outward positive)')
    halves = [[ccw(pc) for pc in L['pieces']] for L in loops]
    m = spec.get('mirror')
    if m:
        ax = 'u' if 'u' in m else 'v'; at = float(m[ax]); i = 0 if ax == 'u' else 1
        mir = lambda H: [ccw(mirror_piece(pc, ax, at)) for pc in H[::-1]]
        out = []
        for H in halves:
            if m.get('dropOnAxis'):          # one loop across the axis: drop the closing line(s) lying on it
                for pc in H:
                    for end in ('a', 'b'):
                        if pc['kind'] == 'line' and abs(pc[end][i] - at) < 1e-6:
                            pc[end] = pc[end].copy(); pc[end][i] = at
                H = [pc for pc in H if not (pc['kind'] == 'line' and pc['a'][i] == at and pc['b'][i] == at)]
                out.append(H + mir(H))
            else:
                out += [H, mir(H)]
        halves = out
    ents = []; nid = spec.get('firstId', 1)
    worst = 0.0
    for H in halves:
        for pc in H:
            if pc['kind'] == 'line':
                ents.append(dict(id=nid, kind='line', a=[float(x) for x in pc['a']], b=[float(x) for x in pc['b']], fixed=True))
            elif pc['kind'] == 'arc':
                ea, eb = arc_ends(pc)
                worst = max(worst, np.linalg.norm(ea - pc['a']), np.linalg.norm(eb - pc['b']))
                ents.append(dict(id=nid, kind='arc', c=[float(x) for x in pc['c']], r=float(pc['r']),
                                 start=float(pc['start']), sweep=float(pc['sweep']), fixed=True))
            else:
                ents.append(dict(id=nid, kind='circle', c=[float(x) for x in pc['c']], r=float(pc['r']), fixed=True))
            nid += 1
    for ax_line in spec.get('axisLines', []):
        ents.append(dict(id=nid, kind='line', a=[float(x) for x in ax_line[0]], b=[float(x) for x in ax_line[1]], construction=True))
        print(f'axis line id {nid}'); nid += 1
    # closure: every entity end must meet another entity end within 2 um (the kernel's limit)
    ends = []
    for e in ents:
        if e.get('construction') or e['kind'] == 'circle':
            continue
        if e['kind'] == 'line':
            ends += [np.array(e['a']), np.array(e['b'])]
        else:
            s, t = e['start'], e['start'] + e['sweep']
            ends += [np.array(e['c']) + e['r'] * np.array([np.cos(s), np.sin(s)]),
                     np.array(e['c']) + e['r'] * np.array([np.cos(t), np.sin(t)])]
    bad = [e['id'] for e in ents if not np.all(np.isfinite(np.r_[e.get('a', []), e.get('b', []), e.get('c', []),
                                                                   [e.get('r', 0), e.get('start', 0), e.get('sweep', 0)]]))]
    if bad:
        raise SystemExit(f'entities {bad} came out NaN/inf: an edit picked the wrong piece (a point spec on a line '
                         f'parallel to the coordinate it was given) - re-check the selectors against the printed loop')
    E = np.array(ends) if ends else np.zeros((0, 2))
    open_ends = []
    if len(E):
        D = np.linalg.norm(E[:, None] - E[None], axis=2); np.fill_diagonal(D, np.inf)
        nearest = D.min(1); open_ends = np.where(nearest > 2e-6)[0]
        print(f'closure: worst end-to-end gap {nearest.max():.2e} mm (kernel needs < 2e-6); arc ends off their points <= {worst:.2e}')
        for t in open_ends[:10]:
            print(f'   OPEN end at {E[t].round(6).tolist()} (nearest other end {nearest[t]:.3g} mm)')
    for H in halves:
        at_ = inside_point(H)
        if at_ is not None:
            print(f'region point for regions: [{{at}}]: {np.round(at_, 4).tolist()}')
    out = spec.get('out', os.path.join(data, 'plan.json'))
    json.dump(dict(entities=ents), open(out, 'w'))
    print(f'wrote {len(ents)} entities (ids {spec.get("firstId", 1)}..{nid - 1}) to {out}'
          f'  -> sketch: {{ plane: {{kind: "world", axis: "{axis}", offset: {off}}}, sketch: {{ entities: <file> }} }}')
    return ents


if __name__ == '__main__':
    build(json.load(open(sys.argv[1])))
