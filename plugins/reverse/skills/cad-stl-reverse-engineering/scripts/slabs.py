# SPDX-License-Identifier: AGPL-3.0-only
"""The 2.5D reading of a CAD mesh along one axis: the slabs between its cap levels, each with its exact
profile, and the extrudes that rebuild them.

    python slabs.py --axis z [--data data] [--from -5.5 --to 0.3] [--keep-foreign] [--out data/slabs_z.json]

Needs analyze.py run first (data/faces.pkl). For the axis given:
  levels  every plane face square to the axis is a cap; their offsets split the part into slabs.
  slice   each slab is cut at the height where the fewest faces of other directions cross it (holes
          and slots along other axes, chamfers, fillets), and every cut segment keeps the face it
          came from.
  pieces  a run of segments on one wall face becomes that face's exact carrier: a plane along the
          axis is a line, a cylinder along it an arc (centre and radius as fitted on the whole
          face), a tangent chain or extruded spline is split into lines and arcs from its vertices.
  corners neighbouring carriers meet at their exact crossing (a tangent arc at its foot point).
  healing segments on faces of other directions (a hole along X crossing a Z slab, a slot) are
          dropped and their neighbours run on to their crossing - the slab as it was before that
          feature was cut. A loop made only of such faces is left out (it is that feature's own).
          --keep-foreign keeps them as straight lines between the points seen instead.
Slabs whose profiles are the same are merged into one extrude. Prints each slab's loops and writes
<out> with the slabs and "steps": the sketch and extrude features for ScanRuler, in order, ready
to run (reverse.feature.add each, or one scanruler_batch).
"""
import argparse, json, os, pickle, sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cadlib import AXES, fmt_num, nominal
import prof2d as P2
from profile import segment_exact, clean

UV = {'z': (0, 1), 'x': (1, 2), 'y': (2, 0)}


def load_faces(data):
    with open(os.path.join(data, 'faces.pkl'), 'rb') as f:
        return pickle.load(f)


def classify(fs, ax):
    """wall / cap / foreign for every face, along axis ax."""
    e = np.eye(3)[AXES.index(ax)]
    out = []
    for p in fs.prims:
        k = p['kind']
        if k == 'plane':
            c = abs(p['n'] @ e)
            # a wall leaning by under a milliradian (a design's stray 0.02 deg) is read as square:
            # its line is taken where the slab is cut, a few microns off over a tall slab
            out.append('cap' if c > 1 - 1e-9 else 'wall' if c < 1e-3 else 'foreign')
        elif k in ('cylinder', 'chain'):
            out.append('wall' if abs(p['axis'] @ e) > 1 - 5e-7 else 'foreign')
        else:
            out.append('foreign')
    return out


def levels(fs, cls, ax):
    j = AXES.index(ax)
    lv = set()
    for i, p in enumerate(fs.prims):
        if cls[i] == 'cap':
            lv.add(round(float(p['d'] * np.sign(p['n'][j])), 6))
    V = fs.V
    lv.add(round(float(V[:, j].min()), 6)); lv.add(round(float(V[:, j].max()), 6))
    return sorted(lv)


def slice_at(fs, ax, h):
    """Loops of the cut at axis coordinate h: [dict(pts (n,2), face (n-1,), tri (n-1,), closed)]."""
    V, F = fs.V, fs.F
    j = AXES.index(ax); ui, vi = UV[ax]
    d = V[:, j] - h
    neg = d < 0
    t = np.where(neg[F].any(1) & ~neg[F].all(1))[0]
    nV = len(V)
    segs, keys, tris = [], [], []
    for i in t:
        f = F[i]; pts = []; ks = []
        for a, b in ((f[0], f[1]), (f[1], f[2]), (f[2], f[0])):
            if neg[a] != neg[b]:
                lo, hi = (a, b) if a < b else (b, a)
                s = d[lo] / (d[lo] - d[hi])
                q = V[lo] + s * (V[hi] - V[lo])
                pts.append((q[ui], q[vi])); ks.append(int(lo) * nV + int(hi))
        if len(pts) == 2:
            # orient the segment so the material is on its left: the triangle's normal points out
            n2 = np.array([fs.N[i][ui], fs.N[i][vi]])
            a, b = np.array(pts[0]), np.array(pts[1])
            if (b - a)[0] * n2[1] - (b - a)[1] * n2[0] > 0:      # outward normal must be on the right of travel
                pts.reverse(); ks.reverse()
            segs.append(pts); keys.append(ks); tris.append(i)
    start = {}
    for s, (k0, k1) in enumerate(keys):
        start.setdefault(k0, []).append(s)
    used = np.zeros(len(segs), bool); loops = []
    for s0 in range(len(segs)):
        if used[s0]:
            continue
        chain = [s0]; used[s0] = True
        closed = False
        while True:
            nxt = [s for s in start.get(keys[chain[-1]][1], []) if not used[s]]
            if not nxt:
                closed = keys[chain[-1]][1] == keys[s0][0]
                break
            used[nxt[0]] = True; chain.append(nxt[0])
        pts = [segs[chain[0]][0]] + [segs[s][1] for s in chain]
        loops.append(dict(pts=np.array(pts), tri=np.array([tris[s] for s in chain]),
                          face=fs.fid[np.array([tris[s] for s in chain])], closed=closed))
    return loops


def runs_of(loop):
    """Consecutive segments on one face: [(face, pts)], a closed loop rotated to start at a change."""
    f = loop['face']; P = loop['pts']
    n = len(f)
    if n == 0:
        return []
    if loop['closed']:
        ch = [k for k in range(n) if f[k] != f[k - 1]]
        if not ch:
            return [(int(f[0]), P, True)]
        r = ch[0]
        f = np.r_[f[r:], f[:r]]; P = np.vstack([P[r:-1], P[:r + 1]])
    out = []; k = 0
    while k < n:
        m = k
        while m + 1 < n and f[m + 1] == f[k]:
            m += 1
        out.append((int(f[k]), P[k:m + 2], False))
        k = m + 1
    return out


def carrier(fs, face, ax, pts):
    """Exact carrier(s) of a wall face for a run of cut points travelling pts[0] -> pts[-1]."""
    p = fs.prims[face]
    ui, vi = UV[ax]
    if p['kind'] == 'plane':
        n2 = np.array([p['n'][ui], p['n'][vi]]); n2 /= np.linalg.norm(n2)
        dd = P2.perp(n2)
        # the plane in the sheet: n2 . q = d (the plane's offset, as n has no axis component)
        q0 = n2 * p['d'] / 1.0
        if (pts[-1] - pts[0]) @ dd < 0:
            dd = -dd
        return [dict(kind='line', p=q0, d=dd, face=face)]
    if p['kind'] == 'cylinder':
        c = np.array([p['c'][ui], p['c'][vi]])
        # travel sense from consecutive points (the whole run may sweep more than 180 deg)
        q = pts - c
        sgn = np.sum(q[:-1, 0] * q[1:, 1] - q[:-1, 1] * q[1:, 0])
        return [dict(kind='arc', c=c, r=p['r'], ccw=bool(sgn > 0), face=face)]
    # a chain: its lines and arcs, read once from all its vertices, so every slab takes the
    # same curves (read per slab from each cut, they differ by microns, and the slabs' walls
    # then meet in slivers); the stretch this run covers, in its direction of travel
    pieces = chain_pieces(fs, face, ax) if _MODE[0] == 'shared' else []
    if not pieces:
        return run_pieces(pts, face)
    if pieces[0]['kind'] == 'spline':
        q = pieces[0]['pts']
        i0 = int(np.argmin(np.linalg.norm(q - pts[0], axis=1))); i1 = int(np.argmin(np.linalg.norm(q - pts[-1], axis=1)))
        q = q if i0 <= i1 else q[::-1]
        return [dict(kind='spline', pts=q, face=face, sub=True, shared=True, end=pts[-1])]
    def where(q):
        return min(range(len(pieces)), key=lambda k: piece_dist(pieces[k], q))
    i0, i1 = where(pts[0]), where(pts[-1])
    if i0 == i1 and len(pts) > 2:
        i1 = i0
    sel = pieces[min(i0, i1):max(i0, i1) + 1]
    fwd = i0 <= i1
    if i0 == i1:
        # one piece: its travel from the run
        fwd = (pts[-1] - pts[0]) @ (pieces[i0]['b'] - pieces[i0]['a']) >= 0
    # the run must lie on the stretch chosen, or the chain's reading does not hold here
    if max(min(piece_dist(pc, q) for pc in sel) for q in pts[:: max(1, len(pts) // 20)]) > 2e-2:
        return run_pieces(pts, face)
    out = []
    for pc in (sel if fwd else sel[::-1]):
        end = pc['b'] if fwd else pc['a']
        if pc['kind'] == 'line':
            out.append(dict(kind='line', p=pc['a'], d=pc['d'] if fwd else -pc['d'], face=face, sub=True, end=end))
        else:
            out.append(dict(kind='arc', c=pc['c'], r=pc['r'], ccw=pc['ccw'] if fwd else not pc['ccw'], face=face, sub=True, end=end))
    return out


def run_pieces(pts, face):
    """A chain's lines and arcs read from one run's cut points alone - or, where they come out as
    more than five pieces (a spline wall, an involute), one spline through the points: each is a
    mesh vertex, on the true curve."""
    q = clean(np.asarray(pts, float), False)
    q = q[np.r_[True, np.linalg.norm(np.diff(q, axis=0), axis=1) > 1e-4]]
    # a spline only spans a smooth stretch: the run is split where it turns by more than 20 deg
    # (a gear tooth's tip and root), each stretch read on its own
    if len(q) >= 3:
        d = np.diff(q, axis=0); d /= np.linalg.norm(d, axis=1)[:, None]
        turn = np.degrees(np.arccos(np.clip((d[:-1] * d[1:]).sum(1), -1, 1)))
        cuts = [0] + [k + 1 for k in np.where(turn > 20)[0]] + [len(q) - 1]
        if len(cuts) > 2:
            out = []
            for i0, i1 in zip(cuts[:-1], cuts[1:]):
                if i1 > i0:
                    out += run_pieces(q[i0:i1 + 1], face)
            return out
    segs = segment_exact(pts, closed=False, tol=2e-4)
    if _MODE[0] == 'spline' and len(segs) > 5 and len(q) >= 3:
        return [dict(kind='spline', pts=q, face=face, sub=True, end=q[-1])]
    out = []
    for s_ in segs:
        b_ = np.asarray(s_['b'], float)
        if s_['kind'] == 'line':
            out.append(dict(kind='line', p=np.asarray(s_['a'], float), d=P2.unit(b_ - np.asarray(s_['a'])), face=face, sub=True, end=b_))
        else:
            out.append(dict(kind='arc', c=np.asarray(s_['c'], float), r=float(s_['r']), ccw=bool(s_['sweep'] > 0), face=face, sub=True, end=b_))
    return out


_CHAINS = {}


def chain_pieces(fs, face, ax):
    """A chain face's profile as lines and arcs in curve order, from all its vertices."""
    key = (id(fs), face, ax)
    if key in _CHAINS:
        return _CHAINS[key]
    q = unique_rows(fs.V[fs.verts[face]][:, list(UV[ax])], 5)
    if len(q) < 2:
        _CHAINS[key] = []; return []
    # the curve's two ends: the pair of points farthest apart along it is found by walking from
    # the point farthest from the centre
    o = chain_order(q, q[np.argmax(np.linalg.norm(q - q.mean(0), axis=1))])
    closed = np.linalg.norm(o[0] - o[-1]) < 2 * np.median(np.linalg.norm(np.diff(o, axis=0), axis=1)) and len(o) > 8
    segs = segment_exact(o, closed=bool(closed), tol=2e-4)
    pieces = []
    for s_ in segs:
        a_, b_ = np.asarray(s_.get('a', o[0]), float), np.asarray(s_.get('b', o[-1]), float)
        if s_['kind'] == 'line':
            pieces.append(dict(kind='line', a=a_, b=b_, d=P2.unit(b_ - a_)))
        elif s_['kind'] == 'arc':
            pieces.append(dict(kind='arc', a=a_, b=b_, c=np.asarray(s_['c'], float), r=float(s_['r']), ccw=bool(s_['sweep'] > 0)))
        else:
            pieces.append(dict(kind='arc', a=a_, b=a_, c=np.asarray(s_['c'], float), r=float(s_['r']), ccw=True))
    pieces = merge_arc_runs(pieces, o)
    # a face whose vertices do not all lie on the curve read is no prismatic wall (a sloped
    # spline face that passed for one): no cached reading, each run is read on its own
    if pieces and max(min(piece_dist(pc, x) for pc in pieces) for x in q[:: max(1, len(q) // 60)]) > 2e-2:
        pieces = []
    if (not pieces or len(pieces) > 6) and simple_curve(o):
        # no few lines and arcs hold it (an extruded spline): one spline through its vertices,
        # whole in every slab - the region finder ends it where its neighbours meet it
        pieces = [dict(kind='spline', a=o[0], b=o[-1], pts=simplify(o, 1e-4), shared=True)]
    _CHAINS[key] = pieces
    return pieces


def fit_circle(P):
    """Circle through 2D points, fitted again to the points that lie close (a few loose vertices
    stray): centre, radius, residuals of all the points."""
    def fit(Q):
        x, y = Q[:, 0], Q[:, 1]
        sol = np.linalg.lstsq(np.c_[2 * x, 2 * y, np.ones(len(Q))], x * x + y * y, rcond=None)[0]
        c = sol[:2]; r = np.sqrt(max(sol[2] + c @ c, 0.0))
        for _ in range(5):          # geometric refinement
            d = Q - c; n = np.linalg.norm(d, axis=1); u = d / n[:, None]
            step = np.linalg.lstsq(np.c_[-u, -np.ones(len(Q))], -(n - r), rcond=None)[0]
            c = c + step[:2]; r = r + step[2]
        return c, r
    c, r = fit(P)
    for _ in range(2):
        res = np.abs(np.linalg.norm(P - c, axis=1) - r)
        close = res <= max(5e-4, 2 * np.median(res))
        if close.sum() < 4:
            break
        c, r = fit(P[close])
    return c, r, np.abs(np.linalg.norm(P - c, axis=1) - r)


def merge_arc_runs(pieces, o):
    """Pieces in a row whose points lie on one circle are that one arc: a STEP translator holds
    some edges loosely, their vertices stray by microns, and an arc then reads as a run of short
    lines and arcs. On the circle: four in five points within 0.5 um, none beyond 4 um."""
    while True:
        n = len(pieces)
        pieces = _merge_arc_runs(pieces, o)
        if len(pieces) == n:
            return pieces


def _merge_arc_runs(pieces, o):
    if len(pieces) < 2:
        return pieces
    idx = lambda q: int(np.argmin(np.linalg.norm(o - q, axis=1)))
    out = []; i = 0
    while i < len(pieces):
        best = None
        i0 = idx(pieces[i]['a'])
        for j in range(i + 1, len(pieces)):
            i1 = idx(pieces[j]['b'])
            if i1 <= i0 + 3:
                break
            P = o[i0:i1 + 1]
            c, r, res = fit_circle(P)
            if np.mean(res <= 5e-4) < 0.8 or res.max() > 4e-3 or r > 1e3 or r < 1e-2:
                break
            best = (j, c, r, P)
        if best is None:
            out.append(pieces[i]); i += 1; continue
        j, c, r, P = best
        q = P - c
        ccw = bool(np.sum(q[:-1, 0] * q[1:, 1] - q[:-1, 1] * q[1:, 0]) > 0)
        out.append(dict(kind='arc', a=pieces[i]['a'], b=pieces[j]['b'], c=c, r=float(r), ccw=ccw))
        i = j + 1
    return out


def simple_curve(o):
    """Whether ordered points walk one curve: no jump much longer than the usual step, no crossing."""
    if len(o) < 4:
        return False
    st = np.linalg.norm(np.diff(o, axis=0), axis=1)
    if st.max() > 8 * np.median(st) + 1e-6:
        return False
    return not self_crossing(np.vstack([o, o[::-1][1:-1] + 1e-9]))  if False else True


def piece_dist(pc, q):
    if pc['kind'] == 'line':
        d = pc['b'] - pc['a']; l2 = max(d @ d, 1e-30)
        t = np.clip((q - pc['a']) @ d / l2, 0, 1)
        return float(np.linalg.norm(pc['a'] + t * d - q))
    return float(min(abs(np.linalg.norm(q - pc['c']) - pc['r']) + 0.0,
                     np.linalg.norm(q - pc['a']), np.linalg.norm(q - pc['b']))) if True else 0.0


_MODE = ['shared']


def build_loop(fs, cls, ax, loop, keep_foreign=False, h=None, carrier_fn=None):
    """Exact pieces of one cut loop, read the first way that holds: the chains' shared readings
    (the same curves in every slab); each chain read from this cut alone as lines and arcs; and
    last, a chain that will not read as a few lines and arcs as one spline through its points."""
    raw = P2.signed_area(loop['pts'])
    best = None
    try:
        for mode in ('shared', 'run', 'spline'):
            _MODE[0] = mode
            pcs, notes = _build_loop(fs, cls, ax, loop, keep_foreign, h, carrier_fn)
            if pcs is None:
                continue
            err = abs(P2.signed_area(P2.polygon(pcs, 24)) - raw)
            if best is None or err < best[0]:
                best = (err, pcs, notes, mode)
            if err <= 0.1 * abs(raw) + 0.5:
                break
        if best is None or best[0] > 0.1 * abs(raw) + 0.5:
            # no reading holds: where one crosses itself, the stretch between the crossing pieces
            # is taken as the points the cut shows there, the rest kept
            for mode in ('shared', 'run'):
                _MODE[0] = mode
                pcs, notes = _build_loop(fs, cls, ax, loop, keep_foreign, h, carrier_fn, unsound=True)
                pcs = repair_crossings(pcs, loop['pts']) if pcs else None
                if pcs is None:
                    continue
                err = abs(P2.signed_area(P2.polygon(pcs, 24)) - raw)
                if best is None or err < best[0]:
                    best = (err, pcs, notes, mode + ' repaired')
    finally:
        _MODE[0] = 'shared'
    if best is None:
        return None, []
    for pc in best[1]:
        pc['read'] = best[3]      # how: a slab read another way than its neighbours meets them in slivers
    return best[1], best[2]


def crossing_pieces(pcs):
    """The first pair of pieces of a loop that cross, by index, or None."""
    segs = []
    for i, pc in enumerate(pcs):
        Q = P2.sample(pc, 24)
        for a_, b_ in zip(Q[:-1], Q[1:]):
            segs.append((i, a_, b_))
    for x in range(len(segs)):
        i, a_, b_ = segs[x]; r = b_ - a_
        for y in range(x + 2, len(segs)):
            j, c_, d_ = segs[y]
            if i == j or (x == 0 and y == len(segs) - 1):
                continue
            s_ = d_ - c_
            rxs = r[0] * s_[1] - r[1] * s_[0]
            if abs(rxs) < 1e-14:
                continue
            qp = c_ - a_
            t = (qp[0] * s_[1] - qp[1] * s_[0]) / rxs; u = (qp[0] * r[1] - qp[1] * r[0]) / rxs
            if 1e-9 < t < 1 - 1e-9 and 1e-9 < u < 1 - 1e-9:
                return i, j
    return None


def repair_crossings(pcs, raw, rounds=4):
    """Replace the shorter stretch of pieces between two that cross with the cut's own points."""
    raw = raw[:-1] if np.linalg.norm(raw[0] - raw[-1]) < 1e-9 else raw
    for _ in range(rounds):
        cr = crossing_pieces(pcs)
        if cr is None:
            return pcs
        i, j = cr
        n = len(pcs)
        span = list(range(i, j + 1)) if j - i <= n - (j - i) else list(range(j, n)) + list(range(0, i + 1))
        a_ = pcs[span[0]]['a']; b_ = pcs[span[-1]]['b']
        ia = int(np.argmin(np.linalg.norm(raw - a_, axis=1))); ib = int(np.argmin(np.linalg.norm(raw - b_, axis=1)))
        idx = [(ia + k) % len(raw) for k in range(((ib - ia) % len(raw)) + 1)]
        q = np.vstack([a_, raw[idx[1:-1]], b_]) if len(idx) > 2 else np.vstack([a_, b_])
        q = simplify(q, 2e-3)
        new = [dict(kind='line', p=x, d=P2.unit(y - x), a=x, b=y, face=pcs[span[0]]['face'], unhealed=True)
               for x, y in zip(q[:-1], q[1:]) if np.linalg.norm(y - x) > 1e-9]
        keep = [pc for k, pc in enumerate(pcs) if k not in span]
        at = span[0] if span[0] <= span[-1] else 0
        pcs = keep[:at] + new + keep[at:] if span[0] <= span[-1] else new + keep
    return pcs if crossing_pieces(pcs) is None else None


def _build_loop(fs, cls, ax, loop, keep_foreign=False, h=None, carrier_fn=None, unsound=False):
    """Exact pieces of one cut loop, foreign runs healed. Returns (pieces, notes) or (None, why).
    carrier_fn(fs, face, ax, pts) gives a wall face's carriers (revolve.py brings its own, and then
    no walls are put back in gaps)."""
    carrier = carrier_fn or globals()['carrier']
    runs = runs_of(loop)
    if len(runs) == 1 and runs[0][2]:
        face, pts, _ = runs[0]
        p = fs.prims[face]
        if cls[face] != 'wall':
            return None, 'foreign'
        if p['kind'] == 'cylinder':
            ui, vi = UV[ax]
            return [dict(kind='circle', c=np.array([p['c'][ui], p['c'][vi]]), r=p['r'], face=face,
                         ccw=P2.signed_area(pts) > 0)], []
        segs = segment_exact(pts, closed=True, tol=2e-4)
        if len(segs) == 1 and segs[0]['kind'] == 'circle':
            return [dict(kind='circle', c=np.asarray(segs[0]['c']), r=float(segs[0]['r']), face=face,
                         ccw=P2.signed_area(pts) > 0)], []
        # a closed chain: split, then treat as runs
        items = []
        for s in segs:
            if s['kind'] == 'line':
                items.append(dict(kind='line', p=np.asarray(s['a'], float), d=P2.unit(np.asarray(s['b']) - np.asarray(s['a'])), face=face, at=np.asarray(s['b'], float)))
            else:
                items.append(dict(kind='arc', c=np.asarray(s['c'], float), r=float(s['r']), ccw=bool(s['sweep'] > 0), face=face, at=np.asarray(s['b'], float)))
        return close_pieces(items), []
    if all(cls[f] != 'wall' for f, _, _ in runs):
        # made only of faces of other directions: a hole of that kind is that feature's own (filled
        # here, cut by it later), but an island of material stays, as the points seen
        if P2.signed_area(loop['pts']) <= 0:
            return None, 'foreign'
        q = simplify(clean(loop['pts'], True), 5e-3)
        out = []
        for a_, b_ in zip(q, np.roll(q, -1, axis=0)):
            if np.linalg.norm(b_ - a_) > 1e-9:
                out.append(dict(kind='line', p=a_, d=P2.unit(b_ - a_), a=a_, b=b_, face=runs[0][0], unhealed=True))
        return (out if len(out) >= 3 else None), []
    items = []      # pieces with 'at': the observed point where the piece ends (the next begins)
    notes = []
    for face, pts, _ in runs:
        if cls[face] == 'wall':
            cs = carrier(fs, face, ax, pts)
            for c in cs:
                # a spline read from part of the run (a dome before the rim's lines) keeps its
                # own points: they are its curve
                if c['kind'] != 'spline' or c.get('shared') or len(cs) == 1:
                    c['pts'] = pts
            if len(cs) == 1:
                cs[0]['at'] = pts[-1]
            else:
                # sub-pieces of a chain: each ends where the chain's own reading ends it; the last
                # where the run does
                for c in cs[:-1]:
                    c['at'] = c['end']
                cs[-1]['at'] = pts[-1]
            items += cs
        else:
            if keep_foreign:
                for k in range(len(pts) - 1):
                    items.append(dict(kind='line', p=pts[k], d=P2.unit(pts[k + 1] - pts[k]), face=face, at=pts[k + 1], foreign=True))
            else:
                if items and items[-1]['kind'] == 'gap':
                    g = items[-1]
                    g['faces'].append(face); g['at'] = pts[-1]; g['pts'] = np.vstack([g['pts'], pts[1:]])
                else:
                    items.append(dict(kind='gap', faces=[face], at=pts[-1], start=pts[0], pts=pts))
                notes.append(face)
    # Each gap is healed the first way that gives a sound loop: (1) the walls its blend faces stand
    # in for come back - each blend face brings the wall next to it in the mesh that the loop does
    # not run along already, in the order the gap meets them; (2) the neighbours run on to their
    # crossing (a hole through a wall: the same carrier on both sides, no corner at all); (3) the
    # gap's own points as straight lines, marked unhealed. Sound: the loop closes, does not cross
    # itself, and its area stays within a quarter of the cut's.
    items = absorb_inner_walls(fs, items)
    raw = P2.signed_area(loop['pts'])
    gaps = [k for k, it in enumerate(items) if it['kind'] == 'gap']
    for k in gaps:
        items[k]['insert'] = wall_inserts(fs, cls, ax, items, k, h) if carrier_fn is None else []
    choice = {k: 'raw' for k in gaps}
    for k in gaps:
        order = ('extend', 'insert') if pierce(fs, ax, items, k) else ('insert', 'extend')
        for opt in order:
            if opt == 'insert' and not items[k]['insert']:
                continue
            trial = dict(choice); trial[k] = opt
            pcs = assemble(items, trial)
            # sound, and either near the cut's area or wrapping it (a round or chamfer put back
            # adds material outside the cut; one in an inside corner takes it away)
            if pcs is not None and near_cut(pcs, loop['pts']) and (sound(pcs, raw) or (sound(pcs, raw, area=False) and (
                    nests(P2.polygon(pcs, 24), loop['pts']) or (nests(loop['pts'], P2.polygon(pcs, 24))
                                                               and abs(P2.signed_area(P2.polygon(pcs, 24))) > 0.5 * abs(raw))))):
                choice = trial
                break
    pcs = assemble(items, choice)
    if unsound and pcs is not None:
        return pcs, notes
    if not sound(pcs, raw, area=False) or abs(P2.signed_area(P2.polygon(pcs, 24))) < 0.05 * abs(raw):
        return None, notes
    return pcs, notes


def near_cut(pcs, P):
    """Whether every corner of a healed loop stays near the cut's box: a carrier run on to a
    crossing far off (two lines a hair from parallel) makes a spike, not a corner."""
    lo, hi = P.min(0), P.max(0)
    m = max(2.0, 0.2 * float(np.linalg.norm(hi - lo)))
    return all(np.all(pc['a'] >= lo - m) and np.all(pc['a'] <= hi + m) for pc in pcs)


def nests(P, Q, tol=2e-3):
    """Whether every point of polygon Q lies inside polygon P or within tol of its boundary."""
    A = P; B = np.roll(P, -1, axis=0); d = B - A; l2 = np.maximum((d ** 2).sum(1), 1e-30)
    for q in Q[:: max(1, len(Q) // 400)]:
        if P2.inside(P, q):
            continue
        t = np.clip(((q - A) * d).sum(1) / l2, 0, 1)
        if np.min(np.linalg.norm(A + t[:, None] * d - q, axis=1)) > tol:
            return False
    return True


def absorb_inner_walls(fs, items):
    """gap - wall - gap on the same foreign faces: the wall stands inside that feature (a hole along
    another axis that runs through a pocket, the pocket's far wall seen down the hole) and is part
    of the gap."""
    changed = True
    while changed and len(items) > 3:
        changed = False
        n = len(items)
        for k in range(n):
            a, w, b = items[k], items[(k + 1) % n], items[(k + 2) % n]
            if a['kind'] == 'gap' and b['kind'] == 'gap' and w['kind'] != 'gap' and a is not b                     and set(a['faces']) & set(b['faces']) and 'pts' in w:
                G = np.vstack([a['pts'], b['pts']])
                lo_, hi_ = G.min(0) - 1e-3, G.max(0) + 1e-3
                if not (np.all(w['pts'] >= lo_) and np.all(w['pts'] <= hi_)):
                    continue
                g = dict(a, faces=a['faces'] + b['faces'], at=b['at'], pts=np.vstack([a['pts'], b['pts']]))
                # drop every piece of the wall's face between the two gaps, then the second gap
                rm = {(k + 1) % n, (k + 2) % n}
                items = [g if i == k else it for i, it in enumerate(items) if i not in rm]
                changed = True
                break
    return items


def pierce(fs, ax, items, k):
    """Whether gap k is a feature of another direction piercing a wall - the same carrier on both
    sides, or a hole (a concave cylinder or cone about another axis) - which the wall runs past,
    rather than a blend standing in for walls of its own."""
    n = len(items)
    p, q = items[k - 1], items[(k + 1) % n]
    if p['kind'] != 'gap' and q['kind'] != 'gap' and P2.same_carrier(p, q):
        return True
    for f in items[k]['faces']:
        pr = fs.prims[f]
        if pr['kind'] in ('cylinder', 'cone') and not pr.get('convex', True) and pr.get('sweep', 0) > 180:
            return True
    return False


_EXT = {}


def sharp_extent(fs, cls, ax, g):
    """Where a wall runs along the axis in the model before its blends: its own vertices' extent
    and that of the blend faces beside it (a chamfer or round on its end edge)."""
    key = (id(fs), ax, g)
    if key in _EXT:
        return _EXT[key]
    j = AXES.index(ax)
    c = fs.V[fs.verts[g], j]
    e0, e1 = c.min(), c.max()
    for f in fs.neigh[g]:
        if cls[f] != 'foreign':
            continue
        pr = fs.prims[f]
        if pr['kind'] not in ('plane', 'cone', 'cylinder', 'torus'):
            continue        # a freeform face or a chain is a shape of its own, not a blend
        if pr['kind'] in ('cylinder', 'cone') and not pr.get('convex', True) and pr.get('sweep', 0) > 180:
            continue        # a hole through the wall says nothing of where the wall ends
        cf = fs.V[fs.verts[f], j]
        if cf.max() - cf.min() > 6.0:
            continue        # larger than any chamfer or round: a face of its own
        e0, e1 = min(e0, cf.min()), max(e1, cf.max())
    _EXT[key] = (e0, e1)
    return e0, e1


def wall_inserts(fs, cls, ax, items, k, h=None):
    it = items[k]
    n = len(items)
    prev_f = items[k - 1]['face'] if items[k - 1]['kind'] != 'gap' else None
    next_f = items[(k + 1) % n]['face'] if items[(k + 1) % n]['kind'] != 'gap' else None
    here = {prev_f, next_f}
    cand = []
    for f in it['faces']:
        for g in fs.neigh[f]:
            if cls[g] == 'wall' and g not in here and g not in cand:
                if h is not None:
                    e0, e1 = sharp_extent(fs, cls, ax, g)
                    if not (e0 - 1e-6 <= h <= e1 + 1e-6):
                        continue
                cand.append(g)
    ins = []
    gp = it['pts']
    for g in cand:
        q = unique_rows(fs.V[fs.verts[g]][:, list(UV[ax])])
        o = chain_order(q, gp[0])
        cs = carrier(fs, g, ax, o)
        dmin = np.linalg.norm(gp[:, None] - q[None], axis=2)
        pos = int(np.argmin(dmin.min(1)))
        for c in cs:
            c['at'] = o[-1]
        ins.append((pos, cs))
    ins.sort(key=lambda x: x[0])
    return [c for _, cs in ins for c in cs]


def assemble(items, choice):
    out = []
    for k, it in enumerate(items):
        if it['kind'] != 'gap':
            out.append(dict(it)); continue
        how = choice[k]
        if how == 'insert':
            out.append(dict(kind='gap', faces=it['faces'], at=it['start'], start=it['start'], pts=it['pts'][:1]))
            out += [dict(c) for c in it['insert']]
        elif how == 'extend':
            out.append(dict(it))
        else:
            out.append(dict(it, raw=True))
    return close_pieces(out)


# a further test of a reading's outline, set by a caller: revolve.py's section may not reach past the axis
BOUNDS = [None]


def sound(pcs, raw, area=True):
    if pcs is None:
        return False
    P = P2.polygon(pcs, 24)
    if not np.all(np.isfinite(P)):
        return False
    if BOUNDS[0] is not None and not BOUNDS[0](P):
        return False
    a = P2.signed_area(P)
    if area and abs(a - raw) > 0.25 * abs(raw) + 0.5:
        return False
    return not self_crossing(P)


def self_crossing(P):
    """Whether a closed polygon crosses itself (proper crossings of non-neighbouring edges)."""
    A = P; B = np.roll(P, -1, axis=0)
    n = len(P)
    if n < 4:
        return False
    d = B - A
    for i in range(n):
        j = np.arange(i + 2, n if i > 0 else n - 1)
        if len(j) == 0:
            continue
        p, r = A[i], d[i]
        q, s_ = A[j], d[j]
        rxs = r[0] * s_[:, 1] - r[1] * s_[:, 0]
        ok = np.abs(rxs) > 1e-12
        qp = q - p
        t = (qp[:, 0] * s_[:, 1] - qp[:, 1] * s_[:, 0]) / np.where(ok, rxs, 1)
        u = (qp[:, 0] * r[1] - qp[:, 1] * r[0]) / np.where(ok, rxs, 1)
        if np.any(ok & (t > 1e-9) & (t < 1 - 1e-9) & (u > 1e-9) & (u < 1 - 1e-9)):
            return True
    return False


def simplify(P, tol):
    """Douglas-Peucker: the points of a polyline that matter to tol."""
    if len(P) < 3:
        return P
    keep = np.zeros(len(P), bool); keep[0] = keep[-1] = True
    stack = [(0, len(P) - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        a, b = P[i], P[j]; d = b - a; L = np.linalg.norm(d)
        q = P[i + 1:j] - a
        dist = np.abs(q[:, 0] * d[1] - q[:, 1] * d[0]) / L if L > 1e-12 else np.linalg.norm(q, axis=1)
        k = int(np.argmax(dist))
        if dist[k] > tol:
            keep[i + 1 + k] = True
            stack += [(i, i + 1 + k), (i + 1 + k, j)]
    return P[keep]


def unique_rows(q, dec=6):
    _, i = np.unique(np.round(q, dec), axis=0, return_index=True)
    return q[np.sort(i)]


def chain_order(q, start):
    """Points of a profile curve in order along it, from the end nearest `start` (nearest-neighbour
    walk; the points of a wall face's vertex rings all project onto its profile)."""
    if len(q) <= 2:
        return q[np.argsort(np.linalg.norm(q - start, axis=1))]
    # the walk starts at an end of the curve: the point farthest from the others' centre on the
    # side of `start`
    left = list(range(len(q)))
    ends = [int(np.argmax(np.linalg.norm(q - q.mean(0), axis=1)))]
    far = int(np.argmax(np.linalg.norm(q - q[ends[0]], axis=1)))
    cur = ends[0] if np.linalg.norm(q[ends[0]] - start) < np.linalg.norm(q[far] - start) else far
    order = [cur]; left.remove(cur)
    while left:
        d = np.linalg.norm(q[left] - q[cur], axis=1)
        cur = left[int(np.argmin(d))]; order.append(cur); left.remove(cur)
    return q[order]


def close_pieces(items):
    """Merge carriers that continue across a gap, then put every corner at the exact crossing.
    Where a gap cannot be healed - the neighbours do not cross, or cross far from it (a face that
    stood for something other than a sharp corner) - its own points are kept as straight lines,
    marked 'unhealed', so the loop still closes."""
    seq = []; lead = []
    for it in items:
        if it['kind'] == 'gap':
            if seq:
                seq[-1].setdefault('gaps', []).append(it)
            else:
                lead.append(it)
            continue
        if seq and P2.same_carrier(seq[-1], it):
            seq[-1]['at'] = it['at']; seq[-1].pop('gaps', None)
            continue
        seq.append(it)
    if not seq:
        return None
    if lead:
        seq[-1].setdefault('gaps', []).extend(lead)
    if len(seq) > 1 and P2.same_carrier(seq[-1], seq[0]):
        seq.pop()
    n = len(seq)
    if n == 1 and seq[0]['kind'] == 'arc' and not seq[0].get('gaps'):
        pc = seq[0]
        return [dict(kind='circle', c=pc['c'], r=pc['r'], face=pc['face'], ccw=pc['ccw'])]
    out, C = [], []          # pieces, and the corner after each
    for k in range(n):
        p, q = seq[k], seq[(k + 1) % n]
        out.append(p)
        gaps = p.get('gaps')
        if gaps:
            pts = np.vstack([g['pts'] for g in gaps])
            span = np.linalg.norm(pts[-1] - pts[0])
            c = None if any(g.get('raw') for g in gaps) else P2.corner(p, q, pts.mean(0))
            if c is not None and np.linalg.norm(pts - c, axis=1).min() < 3 * span + 1.0:
                C.append(c); continue
            # unhealed: the gap's own points, thinned to what bends by more than 5 um, none nearer
            # its neighbour than the sketch's join tolerance (2 um: closer ends are one point there,
            # and a hair of a line between them cannot solve); a gap that small is one corner
            q_ = simplify(clean(pts, False), 5e-3)
            if np.linalg.norm(q_[-1] - q_[0]) < 2e-3:
                q_ = q_[:1] * 0 + (q_[0] + q_[-1]) / 2
            else:
                keep_ = [0]
                for i_ in range(1, len(q_) - 1):
                    if np.linalg.norm(q_[i_] - q_[keep_[-1]]) >= 2e-3 and np.linalg.norm(q_[-1] - q_[i_]) >= 2e-3:
                        keep_.append(i_)
                q_ = q_[keep_ + [len(q_) - 1]]
            C.append(q_[0])
            for a, b in zip(q_[:-1], q_[1:]):
                if np.linalg.norm(b - a) < 1e-9:
                    continue
                out.append(dict(kind='line', p=a, d=P2.unit(b - a), face=gaps[0]['faces'][0], unhealed=True))
                C.append(b)
            continue
        c = P2.corner(p, q, p['at'])
        if c is None or np.linalg.norm(c - p['at']) > 1.0:
            # neighbours that do not meet near where the mesh shows them meeting: something
            # between them was not read (a segmentation leftover) - bridge straight, flagged
            a_ = P2.project(p, p['at']); b_ = P2.project(q, p['at'])
            if np.linalg.norm(b_ - a_) < 2e-3:
                a_ = b_ = (a_ + b_) / 2     # within the sketch's join tolerance: one corner
            C.append(a_)
            if np.linalg.norm(b_ - a_) > 1e-9:
                out.append(dict(kind='line', p=a_, d=P2.unit(b_ - a_), face=p['face'], unhealed=True))
                C.append(b_)
            continue
        C.append(c)
    m = len(out)
    for k in range(m):
        out[k]['a'] = C[k - 1]; out[k]['b'] = C[k]
        if out[k]['kind'] == 'spline' and not out[k].get('shared'):
            q = np.array(out[k]['pts'], float)
            q[0], q[-1] = C[k - 1], C[k]
            out[k]['pts'] = q
    return merge_creases(out)


def merge_creases(out):
    """Two lines meeting at a crease of a hair (under 0.1 deg, the corner within 0.5 um of the line
    through their far ends) are one: left as two, the extrude has two faces at that hair of an
    angle, and joining it to the next slab fails on them."""
    # a line shorter than the sketch's join tolerance (2 um: two readings of one corner) is a
    # corner: its neighbours meet halfway
    k = 0
    while len(out) > 3 and k < len(out):
        pc = out[k]
        if pc['kind'] == 'line' and np.linalg.norm(pc['b'] - pc['a']) < 2e-3:
            c = (pc['a'] + pc['b']) / 2
            out[k - 1]['b'] = c; out[(k + 1) % len(out)]['a'] = c
            for nb in (out[k - 1], out[(k + 1) % len(out)]):
                if nb['kind'] == 'line':
                    nb['d'] = P2.unit(nb['b'] - nb['a'])
                elif nb['kind'] == 'spline' and not nb.get('shared'):
                    nb['pts'] = np.array(nb['pts'], float); nb['pts'][0], nb['pts'][-1] = nb['a'], nb['b']
            del out[k]
            continue
        k += 1
    k = 0
    while len(out) > 3 and k < len(out):
        n_ = (k + 1) % len(out)
        p, q = out[k], out[n_]
        if p['kind'] == q['kind'] == 'line':
            u, v = P2.unit(p['b'] - p['a']), P2.unit(q['b'] - q['a'])
            w = q['b'] - p['a']; L = np.linalg.norm(w)
            e_ = p['b'] - p['a']
            off = abs(w[0] * e_[1] - w[1] * e_[0]) / L if L > 1e-9 else np.inf
            if u @ v > np.cos(np.radians(0.1)) and off < 5e-4:
                m = dict(p, b=q['b'], d=P2.unit(q['b'] - p['a']))
                if q.get('unhealed'): m['unhealed'] = True
                out[k] = m; del out[n_]
                if n_ < k: k -= 1
                continue
        k += 1
    return out


def read_slab(fs, cls, ax, h, keep_foreign, box=None):
    cut = slice_at(fs, ax, h)
    if box is not None:
        cut = [L for L in cut if np.any((L['pts'][:, 0] > box[0]) & (L['pts'][:, 0] < box[2]) & (L['pts'][:, 1] > box[1]) & (L['pts'][:, 1] < box[3]))]
    loops, dropped, failed, raws = [], [], [], []
    for L in cut:
        raws.append(L['pts'])
        if not L['closed']:
            failed.append(('open', L['pts'][0], L['pts'][0]))
            continue
        pcs, notes = build_loop(fs, cls, ax, L, keep_foreign, h)
        if pcs is None:
            (dropped if notes == 'foreign' else failed).append((notes, L['pts'].min(0), L['pts'].max(0)))
            continue
        loops.append(pcs)
    return dict(loops=loops, dropped=dropped, failed=failed, raws=raws)


def plot_groups(groups, path, ax):
    import matplotlib; matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    n = len(groups)
    cols = min(n, 3); rows = (n + cols - 1) // cols
    fig, axs = plt.subplots(rows, cols, figsize=(7 * cols, 6 * rows), squeeze=False)
    for gi, g in enumerate(groups):
        A = axs[gi // cols][gi % cols]
        for R in g['parts'][0]['raws']:
            A.plot(R[:, 0], R[:, 1], color='0.75', lw=3)
        for L in g['loops']:
            for pc in L:
                P = P2.sample(pc, 48)
                A.plot(P[:, 0], P[:, 1], color='red' if pc.get('unhealed') else 'C0', lw=1.2)
        A.set_aspect('equal'); A.set_title(f'[{gi}] {g["lo"]:.3f}..{g["hi"]:.3f} at {g["parts"][0]["h"]:.3f}')
    for k in range(n, rows * cols):
        axs[k // cols][k % cols].axis('off')
    plt.tight_layout(); plt.savefig(path, dpi=60)


def loop_key(loop):
    """A signature to tell equal profiles: rounded corners and radii."""
    out = []
    for pc in loop:
        if pc['kind'] == 'circle':
            out.append(('O', round(float(pc['c'][0]), 4), round(float(pc['c'][1]), 4), round(float(pc['r']), 4)))
        else:
            out.append((pc['kind'][0].upper(), round(float(pc['a'][0]), 4), round(float(pc['a'][1]), 4)))
    k = min(range(len(out)), key=lambda i: out[i])
    return tuple(out[k:] + out[:k])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--axis', required=True, choices='xyz')
    ap.add_argument('--data', default='data')
    ap.add_argument('--from', dest='lo', type=float)
    ap.add_argument('--to', dest='hi', type=float)
    ap.add_argument('--keep-foreign', action='store_true')
    ap.add_argument('--min', type=float, default=1e-3, help='thinnest slab to keep')
    ap.add_argument('--name', default=None, help='feature name prefix')
    ap.add_argument('--tries', type=int, default=6, help='slice heights tried per slab')
    ap.add_argument('--thin', type=float, default=0.6, help='a broken slab this thin takes the profile of a neighbour')
    ap.add_argument('--plot', help='PNG of the loops of every extrude (blue) over the cut (grey), unhealed in red')
    ap.add_argument('--at', help='force slice heights: --at=lo:h,... (lo = the lower level of the slab; the = is needed for a negative one)')
    ap.add_argument('--borrow', help='a slab takes the profile of another: --borrow=lo:lo2,... (lower levels; the = is needed for a negative one)')
    ap.add_argument('--box', help='u0,v0,u1,v1: only the loops reaching into this box of the sheet')
    ap.add_argument('--trim', metavar='BODY', help='with --box: cut from BODY what lies in the box (over each slab) outside '
                    'the profile - a shape along this axis imposed on a body built along another')
    ap.add_argument('--fill', metavar='BODY', help='with --box: join to BODY what of the profile lies in the box (over each slab) - '
                    'material a body built along another axis lacks')
    ap.add_argument('--out')
    a = ap.parse_args()
    fs = load_faces(a.data)
    ax = a.axis; j = AXES.index(ax)
    cls = classify(fs, ax)
    lv = levels(fs, cls, ax)
    box = [float(x) for x in a.box.split(',')] if a.box else None
    if (a.trim or a.fill) and not box:
        raise SystemExit('--trim and --fill need --box')
    if a.lo is not None: lv = [x for x in lv if x >= a.lo - 1e-9]
    if a.hi is not None: lv = [x for x in lv if x <= a.hi + 1e-9]
    if a.trim or a.fill:
        # the range given is the tool's extent: its ends are levels too
        if a.lo is not None and all(abs(x - a.lo) > 1e-6 for x in lv): lv = sorted(lv + [a.lo])
        if a.hi is not None and all(abs(x - a.hi) > 1e-6 for x in lv): lv = sorted(lv + [a.hi])
    ext = {}
    for i, p in enumerate(fs.prims):
        if cls[i] == 'foreign':
            c = fs.V[fs.verts[i], j]
            ext[i] = (c.min(), c.max())
    slabs = []
    for lo, hi in zip(lv[:-1], lv[1:]):
        if hi - lo < a.min:
            continue
        cands = []
        for t in np.linspace(0.08, 0.92, 22):
            h = lo + t * (hi - lo)
            cost = sum(1 for (e0, e1) in ext.values() if e0 < h - 1e-6 and e1 > h + 1e-6)
            cands.append(((cost, abs(t - 0.5)), h))
        cands.sort()
        if a.at:
            for spec in a.at.split(','):
                l_, h_ = (float(x) for x in spec.split(':'))
                if abs(l_ - lo) < 1e-6:
                    cands = [((0, 0), h_)]
        # the sharp profile is the same at every height of the slab: read it at the few least
        # crowded heights and keep the reading with the fewest loops lost and pieces unhealed
        best = None
        tried = set()
        for _, h in cands:
            if len(tried) >= a.tries:
                break
            hk = round(h, 3)
            if hk in tried:
                continue
            tried.add(hk)
            if np.any(np.abs(fs.V[:, j] - h) < 1e-7):
                h += 3.1e-7
            # a trim or fill reads the whole section: the loop round the box counts as much as one in it
            res = read_slab(fs, cls, ax, h, a.keep_foreign, None if (a.trim or a.fill) else box)
            # fewest loops lost, then pieces unhealed, then loops read another way than the
            # neighbours' shared readings (those meet them in slivers)
            score = (len(res['failed']), sum(1 for L in res['loops'] for pc in L if pc.get('unhealed')),
                     sum(1 for L in res['loops'] if L and L[0].get('read', 'shared') != 'shared'))
            if best is None or score < best[0]:
                best = (score, h, res)
            if score == (0, 0):
                break
        _, h, res = best
        slabs.append(dict(lo=lo, hi=hi, h=h, **res, key=tuple(sorted(loop_key(L) for L in res['loops']))))
    # a thin slab whose reading is still broken lies inside a blend band (a slab cut out of a
    # chamfer by the floor of a small pocket nearby): it takes the profile of the neighbour it
    # shares the most walls with, and says so
    def walls_of(sl):
        return {pc['face'] for L in sl['loops'] for pc in L if not pc.get('unhealed')}

    def plen(pc):
        return float(np.sum(np.linalg.norm(np.diff(P2.sample(pc, 24), axis=0), axis=1)))

    def badness(sl):
        tot = sum(plen(pc) for L in sl['loops'] for pc in L) or 1.0
        bad = sum(plen(pc) for L in sl['loops'] for pc in L if pc.get('unhealed'))
        return (len(sl['failed']) > 0) + bad / tot
    def raw_area(sl):
        return sum(P2.signed_area(R) for R in sl['raws'] if len(R) > 2)

    def healed_area(sl):
        return sum(P2.signed_area(P2.polygon(L)) for L in sl['loops'])

    def off(sl):
        r = raw_area(sl)
        return abs(healed_area(sl) - r) / max(abs(r), 1.0)
    bad0 = [max(badness(sl), off(sl)) for sl in slabs]
    raw0 = [raw_area(sl) for sl in slabs]
    for k, sl in enumerate(slabs):
        if sl['hi'] - sl['lo'] > a.thin or bad0[k] < 0.2:
            continue
        # the donor: the nearest slab, either way, read soundly and cut to about the same area
        best = None
        for step in (-1, 1):
            m = k + step
            while 0 <= m < len(slabs) and bad0[m] >= 0.15 and slabs[m]["hi"] - slabs[m]["lo"] <= a.thin:
                m += step
            if 0 <= m < len(slabs) and bad0[m] < 0.15:
                d = abs(raw0[m] - raw0[k]) / max(abs(raw0[k]), 1.0)
                if best is None or d < best[0]:
                    best = (d, m)
        if best is None or best[0] > 0.2:
            continue
        m = best[1]
        print(f'note: slab {fmt_num(sl["lo"])}..{fmt_num(sl["hi"])} is thin and its reading off '
              f'({100 * min(bad0[k], 1):.0f} %): it takes the profile of {fmt_num(slabs[m]["lo"])}..{fmt_num(slabs[m]["hi"])}, '
              f'cut to {raw0[m]:.1f} mm^2 against its {raw0[k]:.1f}')
        sl.update(loops=slabs[m]['loops'], key=slabs[m]['key'], failed=[], borrowed=True)
    if a.borrow:
        for spec in a.borrow.split(','):
            l1, l2 = (float(x) for x in spec.split(':'))
            k = next(i for i, x in enumerate(slabs) if abs(x['lo'] - l1) < 1e-6)
            m = next(i for i, x in enumerate(slabs) if abs(x['lo'] - l2) < 1e-6)
            slabs[k].update(loops=slabs[m]['loops'], key=slabs[m]['key'], failed=[], borrowed=True)
            print(f'note: slab {fmt_num(slabs[k]["lo"])} takes the profile of {fmt_num(slabs[m]["lo"])} (--borrow)')
    # merge equal neighbours
    groups = []
    for s in slabs:
        if groups and groups[-1]['key'] == s['key'] and abs(groups[-1]['hi'] - s['lo']) < 1e-9:
            groups[-1]['hi'] = s['hi']; groups[-1]['parts'].append(s)
        else:
            groups.append(dict(lo=s['lo'], hi=s['hi'], key=s['key'], loops=s['loops'], parts=[s]))
    # report
    name = a.name or f'{ax.upper()}'
    steps = []
    print(f'axis {ax}: {len(lv)} levels, {len(slabs)} slabs, {len(groups)} extrudes '
          f'(sheet: {"XY" if ax == "z" else "YZ" if ax == "x" else "ZX"}, u={"XYZ"[UV[ax][0]]} v={"XYZ"[UV[ax][1]]})')
    fid = 1
    for gi, g in enumerate(groups):
        print(f'\n[{gi}] {fmt_num(g["lo"])} .. {fmt_num(g["hi"])}  (thickness {fmt_num(g["hi"] - g["lo"])}), '
              f'{len(g["loops"])} loops, sliced at {", ".join(f"{s["h"]:.4f}" for s in g["parts"])}')
        for s in g['parts']:
            for d in s['dropped']:
                print(f'    left out a loop of other-axis faces (a feature of its own) in box {np.round(d[1], 3).tolist()}..{np.round(d[2], 3).tolist()}')
            for d in s['failed']:
                print(f'    !! could not close a loop: {d[0]} near {np.round(d[1], 3).tolist()}')
        polys = []
        for L in g['loops']:
            Pp = P2.polygon(L)
            polys.append(Pp)
        areas = [P2.signed_area(Pp) for Pp in polys]
        raw_a = sum(P2.signed_area(R) for R in g['parts'][0]['raws'] if len(R) > 2)
        heal_a = sum(areas)
        flag = '  <-- CHECK THE PLOT: healing changed the area by more than 10 %' if abs(heal_a - raw_a) > 0.1 * abs(raw_a) + 1 else ''
        if g['parts'][0].get('borrowed'):
            flag = '  (borrowed profile)'
        print(f'  material area: cut {raw_a:.2f}, healed {heal_a:.2f}{flag}')
        for li, (L, ar) in enumerate(zip(g['loops'], areas)):
            print(f'  loop {li} ({"outer" if ar > 0 else "hole"}, area {abs(ar):.3f}, {len(L)} pieces)')
            for pc in L:
                tag = ''
                if pc['kind'] in ('arc', 'circle'):
                    rn = nominal(pc['r'])
                    tag = f' (={rn:g})' if rn is not None else ''
                print('     ' + P2.fmt_piece(pc) + tag + (' [chain]' if pc.get('sub') else '')
                      + (f' [UNHEALED: face {pc["face"]} of another direction]' if pc.get('unhealed') else ''))
        if not g['loops']:
            continue
        ents, fid2 = P2.entities(g['loops'], 1)
        gap = P2.closure(ents)
        # regions: each outer loop with the holes inside it
        regs = []
        for li, ar in enumerate(areas):
            if ar <= 0:
                continue
            holes = [polys[k] for k, a2 in enumerate(areas) if a2 < 0 and P2.inside(polys[li], polys[k][0])]
            q = P2.region_point(polys[li], holes)
            if q is not None:
                regs.append([round(float(q[0]), 5), round(float(q[1]), 5)])
        print(f'  closure {gap:.1e} mm; region points {regs}')
        if not regs:
            print('  !! no outer loop: no extrude written for this slab')
            continue
        sk = f'{name} slab {gi} sketch'
        plane = dict(kind='world', axis=ax, offset=round(g['lo'], 6))
        ext = dict(kind='distance', **{'from': 0}, to=round(g['hi'] - g['lo'], 6))
        add = lambda f: steps.append(dict(name='reverse.feature.add', input=dict(feature=f, detail='none')))
        if not a.trim and not a.fill:
            add(dict(kind='sketch', name=sk, plane=plane, sketch=dict(entities=ents)))
            add(dict(kind='extrude', name=f'{name} slab {gi}', sketchId=sk, regions=[dict(at=r) for r in regs], extent=ext, op='join'))
            continue
        # trim: the box less the profile, cut from the body; fill: the box and the profile in
        # common, joined to it
        u0, v0, u1, v1 = box
        rect = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]
        bents = [dict(id=k + 1, kind='line', a=rect[k], b=rect[(k + 1) % 4], fixed=True) for k in range(4)]
        tb = f'{name} {"fill" if a.fill else "trim"} {gi} box'
        add(dict(kind='sketch', name=tb + ' sketch', plane=plane, sketch=dict(entities=bents)))
        add(dict(kind='extrude', name=tb, sketchId=tb + ' sketch', regions=[dict(at=[(u0 + u1) / 2, (v0 + v1) / 2])], extent=ext, op='new'))
        add(dict(kind='sketch', name=sk, plane=plane, sketch=dict(entities=ents)))
        if a.fill:
            for ri, r in enumerate(regs):
                tp = f'{name} fill {gi} profile {ri}'
                add(dict(kind='extrude', name=tp, sketchId=sk, regions=[dict(at=r)], extent=ext, op='new'))
                add(dict(kind='boolean', name=f'{tp} in box', op='intersect', body=tp, tool=tb, keep=ri < len(regs) - 1))
                add(dict(kind='boolean', name=f'{name} fill {gi}.{ri}', op='join', body=a.fill, tool=tp))
            continue
        for ri, r in enumerate(regs):
            tp = f'{name} trim {gi} profile {ri}'
            add(dict(kind='extrude', name=tp, sketchId=sk, regions=[dict(at=r)], extent=ext, op='new'))
            add(dict(kind='boolean', name=f'{tp} out of box', op='cut', body=tb, tool=tp))
        add(dict(kind='boolean', name=f'{name} trim {gi}', op='cut', body=a.trim, tool=tb))
    if a.plot:
        plot_groups(groups, a.plot, ax); print('plot', a.plot)
    out = a.out or os.path.join(a.data, f'slabs_{ax}.json')

    def js(x):
        if isinstance(x, dict): return {k: js(v) for k, v in x.items()}
        if isinstance(x, (list, tuple)): return [js(v) for v in x]
        if isinstance(x, np.ndarray): return js(x.tolist())
        if isinstance(x, (np.floating,)): return float(x)
        if isinstance(x, (np.integer,)): return int(x)
        if isinstance(x, np.bool_): return bool(x)
        return x
    for st in steps:
        st['input'].setdefault('detail', 'none')     # answers kept to id and status: a run read at the end
    json.dump(js(dict(axis=ax, levels=lv, groups=[dict(lo=g['lo'], hi=g['hi'], loops=[[{k: v for k, v in pc.items() if k in ('kind', 'a', 'b', 'c', 'r', 'ccw', 'face')} for pc in L] for L in g['loops']]) for g in groups], steps=steps)), open(out, 'w'))
    print(f'\nwrote {out}: {len(steps)} steps')


if __name__ == '__main__':
    main()
