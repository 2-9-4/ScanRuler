# SPDX-License-Identifier: AGPL-3.0-only
"""Exact profiles of a CAD-exported STL: slice on a world plane, chain the cut into loops, and split
each loop into lines and arcs read exactly from the vertices.

    python profile.py --plane z --at 13 [--pieces 0,1] [--box u0,v0,u1,v1] [--tol 1e-4] [--data data]
    python profile.py --plane z --at 0 --edges ...     (at a face level or a vertex ring: exact vertices)

Sheet coordinates follow ScanRuler's world planes: z -> (u, v) = (X, Y); x -> (Y, Z); y -> (Z, X).
Writes <data>/profile_<plane><at>.json (full precision, arcs in radians) and prints each loop.

Why it works only where the walls are square to the plane: a CAD vertex sits exactly on the true
curve, but a cut through a sloped face (cone, chamfer) lands on the chords between vertex rings, so
those points fit no circle and the loop fragments into dozens of pieces. Slice inside a band of
vertical walls (read the z stack from load.py), not at a face level, and read cones with rz.py.
A wall whose top and bottom vertex rings are tessellated out of step (long slanted edges, typical
where a plan outline meets a circle) gives only chord points at any height in between: then use
--edges at the height of a face or a vertex ring, which chains the mesh edges lying in the plane.

The rules that make the split exact (each learnt the hard way):
  - drop mid-chord points first: the cut also crosses each wall quad's diagonal, which adds a point
    on the chord, not on the curve (|sin turn| < 2e-5)
  - an arc is a maximal run of >= 5 consecutive points on one circle to 1e-4 mm (a looser 2e-3 lets
    tangent arcs steal each other's end points and makes short line+arc triples look like arcs)
  - a 2-point "line" with both ends on a neighbouring arc's circle, no longer than that arc's chord
    step, is a chord of that arc (sparse tessellation): fold it in
"""
import argparse, json, os, sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from load import load_work

PLANES = {'z': (2, 0, 1), 'x': (0, 1, 2), 'y': (1, 2, 0)}   # normal index, u index, v index


# ---------------------------------------------------------------- slicing
def slice_segments(V, F, piece, axis, offset):
    """Cut segments of the triangles with a world plane. Returns (segs (k,2,3), piece ids, edge keys (k,2))."""
    ni = PLANES[axis][0]
    d = V[:, ni] - offset
    neg = d < 0
    t = np.where(neg[F].any(1) & ~neg[F].all(1))[0]
    segs, pcs, keys = [], [], []
    nV = len(V)
    for i in t:
        f = F[i]; pts = []; ks = []
        for a, b in ((f[0], f[1]), (f[1], f[2]), (f[2], f[0])):
            if neg[a] != neg[b]:
                lo, hi = (a, b) if a < b else (b, a)          # same point from both triangles of the edge
                s = d[lo] / (d[lo] - d[hi])
                pts.append(V[lo] + s * (V[hi] - V[lo])); ks.append(lo * nV + hi)
        if len(pts) == 2:
            segs.append(pts); pcs.append(piece[i]); keys.append(ks)
    return np.array(segs).reshape(-1, 2, 3), np.array(pcs, int), np.array(keys, np.int64).reshape(-1, 2)


def slice_loops(V, F, piece, axis, offset):
    """Chain the cut into loops by shared mesh edges (exact topology, no rounding).
    Returns [(points (n,3), piece, closed)] - closed loops repeat their first point at the end."""
    segs, pcs, keys = slice_segments(V, F, piece, axis, offset)
    adj = {}
    for s, (k0, k1) in enumerate(keys):
        adj.setdefault(int(k0), []).append((s, 0)); adj.setdefault(int(k1), []).append((s, 1))
    used = np.zeros(len(segs), bool); loops = []

    def walk(s, end):
        out = []; cur = int(keys[s][end])
        while True:
            nxt = [(k, e) for k, e in adj[cur] if not used[k]]
            if not nxt:
                return out, cur
            k, e = nxt[0]; used[k] = True
            out.append(segs[k][1 - e]); cur = int(keys[k][1 - e])

    for s in range(len(segs)):
        if used[s]:
            continue
        used[s] = True
        fwd, last = walk(s, 1)
        closed = last == int(keys[s][0])
        pts = [segs[s][0], segs[s][1]] + fwd
        if not closed:
            back, _ = walk(s, 0)
            pts = back[::-1] + pts
        loops.append((np.array(pts), int(pcs[s]), bool(closed)))
    return loops


def edge_loops(V, F, piece, axis, offset, tol=1e-4):
    """Loops of mesh edges lying in the plane: a planar face's boundary or a vertex ring where two
    faces meet (z = 1.891 where a wall turns into a chamfer). Every point is a CAD vertex, so this
    reads walls whose top and bottom rings are tessellated out of step (slanted wall edges), where a
    slice in between lands only on chords. Edges inside a planar face lying in the plane are skipped.
    Returns [(points (n,3), piece, closed)] like slice_loops."""
    ni = PLANES[axis][0]
    on = np.abs(V[:, ni] - offset) < tol
    nV = len(V)
    E = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
    T = np.tile(np.arange(len(F)), 3)
    keep = on[E[:, 0]] & on[E[:, 1]]
    E = np.sort(E[keep], axis=1); T = T[keep]
    tri_in = on[F].all(1)
    key = E[:, 0].astype(np.int64) * nV + E[:, 1]
    uk, inv, cnt = np.unique(key, return_inverse=True, return_counts=True)
    nin = np.bincount(inv, weights=tri_in[T].astype(float), minlength=len(uk))
    sel = nin < 2                                   # not an edge inside an in-plane face
    edges = np.c_[uk[sel] // nV, uk[sel] % nV].astype(int)
    epiece = {}
    for k, t in zip(key, T):
        epiece.setdefault(int(k), int(piece[t]))
    adj = {}
    for a_, b_ in edges:
        adj.setdefault(a_, []).append(b_); adj.setdefault(b_, []).append(a_)
    used = set(); loops = []
    for a_, b_ in edges:
        e0 = (min(a_, b_), max(a_, b_))
        if e0 in used:
            continue
        used.add(e0); chain = [a_, b_]
        closed = False
        while True:
            cur = chain[-1]
            nxt = [w for w in adj[cur] if (min(cur, w), max(cur, w)) not in used]
            if not nxt:
                break
            w = nxt[0]; used.add((min(cur, w), max(cur, w)))
            if w == chain[0]:
                closed = True; break
            chain.append(w)
        if not closed:                               # walk the other way too
            while True:
                cur = chain[0]
                nxt = [w for w in adj[cur] if (min(cur, w), max(cur, w)) not in used]
                if not nxt:
                    break
                w = nxt[0]; used.add((min(cur, w), max(cur, w))); chain.insert(0, w)
        pts = V[chain + ([chain[0]] if closed else [])]
        loops.append((pts, epiece[int(e0[0]) * nV + int(e0[1])], closed))
    return loops


def to_uv(P, axis):
    _, ui, vi = PLANES[axis]
    return np.c_[P[:, ui], P[:, vi]]


def select_loops(loops, axis, pieces=None, box=None, near=None):
    """Keep loops of the given mesh pieces, lying wholly inside box [u0,v0,u1,v1], or the one loop nearest a point."""
    out = []
    for k, (L, pc, closed) in enumerate(loops):
        uv = to_uv(L, axis)
        if pieces is not None and pc not in pieces:
            continue
        if box is not None and not (uv[:, 0].min() >= box[0] and uv[:, 1].min() >= box[1]
                                    and uv[:, 0].max() <= box[2] and uv[:, 1].max() <= box[3]):
            continue
        out.append((k, uv, pc, closed))
    if near is not None and out:
        dist = [np.linalg.norm(uv - np.asarray(near), axis=1).min() for _, uv, _, _ in out]
        out = [out[int(np.argmin(dist))]]
    return out


# ---------------------------------------------------------------- exact segmentation
def circ(q):
    A = np.c_[2 * q, np.ones(len(q))]
    s, *_ = np.linalg.lstsq(A, (q ** 2).sum(1), rcond=None)
    c = s[:2]; r2 = s[2] + c @ c
    if not np.isfinite(r2) or r2 <= 0:
        return c, np.inf, np.inf
    r = np.sqrt(r2)
    return c, r, np.abs(np.linalg.norm(q - c, axis=1) - r).max()


def clean(p, closed):
    """Drop repeated points and mid-chord points (collinear with both neighbours)."""
    if closed and np.linalg.norm(p[0] - p[-1]) < 1e-6:
        p = p[:-1]
    keep = np.r_[True, np.linalg.norm(np.diff(p, axis=0), axis=1) > 1e-6]
    p = p[keep]
    for _ in range(3):
        if len(p) < 4:
            break
        a, b, c = np.roll(p, 1, 0), p, np.roll(p, -1, 0)
        u, v = b - a, c - b
        cr = np.abs(u[:, 0] * v[:, 1] - u[:, 1] * v[:, 0]) / (np.linalg.norm(u, axis=1) * np.linalg.norm(v, axis=1) + 1e-15)
        k = cr > 2e-5
        if not closed:
            k[0] = k[-1] = True
        p = p[k]
    return p


def _arc(q, c, r):
    ang = np.unwrap(np.arctan2(q[:, 1] - c[1], q[:, 0] - c[0]))
    step = np.linalg.norm(np.diff(q, axis=0), axis=1).max() if len(q) > 1 else 0.0
    return dict(kind='arc', c=c, r=r, a=q[0], b=q[-1], start=ang[0], sweep=ang[-1] - ang[0], pts=q, step=step)


def _on_circle(pt, pc, tol):
    return abs(np.linalg.norm(pt - pc['c']) - pc['r']) < tol


def segment_exact(p, closed=True, tol=1e-4, rmax=1000.0, minpts=5):
    """Split a loop of exact CAD vertices (n,2) into lines and arcs.
    Arcs: c, r (least squares on their vertices), a, b (end vertices), start, sweep (radians, signed
    in the loop's direction), res (max residual), npts. Lines: a, b."""
    p = clean(np.asarray(p, float), closed)
    n = len(p)
    if n < 3:
        return [dict(kind='line', a=p[0], b=p[-1])]
    m = n if closed else n - 1                      # number of point-to-point steps
    idx = lambda i: i % n

    def fits(ii):
        c, r, res = circ(p[[idx(i) for i in ii]])
        return (c, r, res) if res < tol and r < rmax else None

    onarc = np.zeros(n, bool)
    for i in range(n if closed else n - minpts + 1):
        ii = list(range(i, i + minpts))
        if fits(ii):
            onarc[[idx(k) for k in ii]] = True
    st = next((i for i in range(n) if not onarc[i]), 0) if closed else 0
    pieces = []; i = 0
    while i < m:
        best = None; j = i + minpts - 1
        while j <= m:
            f = fits(range(st + i, st + j + 1))
            if f:
                best = (j, f); j += 1
            else:
                break
        if best:
            j, (c, r, res) = best
            q = p[[idx(st + k) for k in range(i, j + 1)]]
            pieces.append(dict(_arc(q, c, r), res=res)); i = j
        else:
            pieces.append(dict(kind='line', a=p[idx(st + i)], b=p[idx(st + i + 1)])); i += 1

    def refit(q):
        c, r, res = circ(q)
        return dict(_arc(q, c, r), res=res)

    changed = True
    while changed:
        changed = False
        out = []
        for pc in pieces:
            if out and pc['kind'] == 'line' and out[-1]['kind'] == 'line':       # collinear lines
                d1 = out[-1]['b'] - out[-1]['a']; d2 = pc['b'] - pc['a']
                if abs(d1[0] * d2[1] - d1[1] * d2[0]) / (np.linalg.norm(d1) * np.linalg.norm(d2)) < 1e-6 and d1 @ d2 > 0:
                    out[-1] = dict(kind='line', a=out[-1]['a'], b=pc['b']); changed = True; continue
            if out and pc['kind'] == 'arc' and out[-1]['kind'] == 'arc' and np.linalg.norm(pc['c'] - out[-1]['c']) < tol \
                    and abs(pc['r'] - out[-1]['r']) < tol:                       # one circle split in two
                out[-1] = refit(np.vstack([out[-1]['pts'], pc['pts'][1:]])); changed = True; continue
            out.append(pc)
        pieces = out
        # chord lines: both ends on the neighbouring arc's circle and no longer than its chord step
        for k, pc in enumerate(pieces):
            if pc['kind'] != 'line':
                continue
            L = np.linalg.norm(pc['b'] - pc['a'])
            nbs = []
            if k > 0 or closed:
                nbs.append(('prev', pieces[k - 1]))
            if k + 1 < len(pieces) or closed:
                nbs.append(('next', pieces[(k + 1) % len(pieces)]))
            for side, nb in nbs:
                if nb['kind'] == 'arc' and nb is not pc and L <= 1.5 * nb['step'] + 1e-9 \
                        and _on_circle(pc['a'], nb, tol) and _on_circle(pc['b'], nb, tol):
                    q = np.vstack([nb['pts'], pc['b'][None]]) if side == 'prev' else np.vstack([pc['a'][None], nb['pts']])
                    pieces[k - 1 if side == 'prev' else (k + 1) % len(pieces)] = refit(q)
                    del pieces[k]; changed = True
                    break
            if changed:
                break
        # closed loop: the seam may split an arc or a line
        if closed and len(pieces) > 1 and not changed:
            f, l = pieces[0], pieces[-1]
            if f['kind'] == l['kind'] == 'arc' and np.linalg.norm(f['c'] - l['c']) < tol and abs(f['r'] - l['r']) < tol:
                pieces = [refit(np.vstack([l['pts'], f['pts'][1:]]))] + pieces[1:-1]; changed = True
            elif f['kind'] == l['kind'] == 'line':
                d1 = l['b'] - l['a']; d2 = f['b'] - f['a']
                if abs(d1[0] * d2[1] - d1[1] * d2[0]) / (np.linalg.norm(d1) * np.linalg.norm(d2)) < 1e-6 and d1 @ d2 > 0:
                    pieces = [dict(kind='line', a=l['a'], b=f['b'])] + pieces[1:-1]; changed = True
    if closed and len(pieces) == 1 and pieces[0]['kind'] == 'arc' and abs(abs(pieces[0]['sweep']) - 2 * np.pi) < 1e-6:
        pc = pieces[0]
        pieces = [dict(kind='circle', c=pc['c'], r=pc['r'], res=pc['res'], pts=pc['pts'])]
    for pc in pieces:
        if 'pts' in pc:
            pc['npts'] = len(pc.pop('pts'))
    return pieces


# ---------------------------------------------------------------- output
def nominal(r, dec=3, within=1e-4):
    """The design value a radius reads as: round(r, dec) when it is within `within` of it."""
    rn = round(r, dec)
    return rn if abs(r - rn) < within else None


def to_json(pc):
    o = {}
    for k, v in pc.items():
        if k == 'step':
            continue
        o[k] = v.tolist() if isinstance(v, np.ndarray) else (float(v) if isinstance(v, (float, np.floating)) else v)
    return o


def fmt(pc):
    if pc['kind'] == 'line':
        d = pc['b'] - pc['a']
        return (f"  L {pc['a'].round(5).tolist()} -> {pc['b'].round(5).tolist()}  len {np.linalg.norm(d):.5f}"
                f"  ang {np.degrees(np.arctan2(d[1], d[0])):.4f}")
    rn = nominal(pc['r'])
    tag = f" (= {rn:g})" if rn is not None else ''
    if pc['kind'] == 'circle':
        return f"  O c={pc['c'].round(5).tolist()} R={pc['r']:.5f}{tag} n={pc['npts']} res={pc['res']:.1e}"
    return (f"  A c={pc['c'].round(5).tolist()} R={pc['r']:.5f}{tag} from {np.degrees(pc['start']):.3f} sweep "
            f"{np.degrees(pc['sweep']):.3f}  {pc['a'].round(5).tolist()} -> {pc['b'].round(5).tolist()} n={pc['npts']} res={pc['res']:.1e}")


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--plane', default='z', choices='xyz')
    ap.add_argument('--at', type=float, required=True, help='plane offset (world coordinate)')
    ap.add_argument('--pieces', help='mesh pieces to keep, e.g. 0,2')
    ap.add_argument('--box', help='keep loops lying inside u0,v0,u1,v1')
    ap.add_argument('--tol', type=float, default=1e-4)
    ap.add_argument('--data', default='data')
    ap.add_argument('--out')
    ap.add_argument('--edges', action='store_true',
                    help='read the mesh edges lying in the plane (a face boundary or vertex ring) instead of slicing')
    a = ap.parse_args()
    V, F, piece = load_work(a.data)
    loops = edge_loops(V, F, piece, a.plane, a.at) if a.edges else slice_loops(V, F, piece, a.plane, a.at)
    pcs = [int(x) for x in a.pieces.split(',')] if a.pieces else None
    box = [float(x) for x in a.box.split(',')] if a.box else None
    res = []
    for k, uv, pc, closed in select_loops(loops, a.plane, pcs, box):
        segs = segment_exact(uv, closed, a.tol)
        res.append(dict(loop=k, piece=pc, closed=closed, pieces=[to_json(s) for s in segs]))
        print(f'loop {k} piece {pc} {"closed" if closed else "OPEN"} npts {len(uv)} bbox {uv.min(0).round(4).tolist()}'
              f' {uv.max(0).round(4).tolist()} pieces {len(segs)}')
        for s in segs:
            print(fmt(s))
    out = a.out or os.path.join(a.data, f'profile_{a.plane}{a.at:g}.json')
    json.dump(dict(plane=a.plane, offset=a.at, tol=a.tol, loops=res), open(out, 'w'))
    print('wrote', out)
