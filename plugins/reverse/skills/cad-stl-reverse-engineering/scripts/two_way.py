# SPDX-License-Identifier: AGPL-3.0-only
"""Exact two-way distance between a CAD-exported mesh and the rebuilt model.

    python two_way.py original.stl model.stl [--step 0.3] [--suspect 0.01] [--cap 20000]

mesh -> model is what ScanRuler's compare reads (the mesh vertices only). model -> mesh catches what
vertex sampling cannot: model material in the middle of a large mesh triangle (CAD exports are full of
long slivers with no vertex inside a flat face). Both meshes are sampled by area AND by edge length,
distances are exact point-to-triangle, and every suspect over --suspect is settled by an exact search
over all triangles whose bounding box is within reach: the KD-tree candidate search alone misses long
slivers and reports false 0.2-0.3 mm errors.

Export the model with reverse_export_stl { chord: 0.005 } (finer than the original's chord).
Expect max ~= the original export's chord sag (~0.01): inside it, model and mesh can't be told apart.
"""
import argparse, os, sys
import numpy as np
from scipy.spatial import cKDTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from load import load_stl


def tri_sample(V, F, step):
    """Vertices plus random points on every triangle: area/step^2 of them, and at least 3*length/step."""
    P = V[F]
    vt = np.zeros(len(V), int)
    for k in range(3):
        vt[F[:, k]] = np.arange(len(F))
    A = np.linalg.norm(np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0]), axis=1) / 2
    L = np.max(np.linalg.norm(P - np.roll(P, 1, axis=1), axis=2), axis=1)
    n = np.maximum(1, np.maximum(A / step ** 2, 3 * L / step)).astype(int)
    rng = np.random.default_rng(0)
    t = np.repeat(np.arange(len(F)), n)
    r1 = np.sqrt(rng.random(len(t))); r2 = rng.random(len(t))
    q = (1 - r1)[:, None] * P[t, 0] + (r1 * (1 - r2))[:, None] * P[t, 1] + (r1 * r2)[:, None] * P[t, 2]
    return np.vstack([V, q]), np.concatenate([vt, t])


def pt_tri(p, a, b, c):
    """Distance from points p to triangles (a, b, c), row by row (Ericson's closest point)."""
    ab, ac, ap = b - a, c - a, p - a
    d1 = (ab * ap).sum(1); d2 = (ac * ap).sum(1)
    bp = p - b; d3 = (ab * bp).sum(1); d4 = (ac * bp).sum(1)
    cp = p - c; d5 = (ab * cp).sum(1); d6 = (ac * cp).sum(1)
    vc = d1 * d4 - d3 * d2; vb = d5 * d2 - d1 * d6; va = d3 * d6 - d5 * d4
    denom = va + vb + vc; denom[denom == 0] = 1e-30
    v = vb / denom; w = vc / denom
    res = a + ab * v[:, None] + ac * w[:, None]
    m = (va <= 0) & ((d4 - d3) >= 0) & ((d5 - d6) >= 0)
    t = (d4 - d3) / np.where((d4 - d3) + (d5 - d6) == 0, 1e-30, (d4 - d3) + (d5 - d6)); res[m] = (b + (c - b) * t[:, None])[m]
    m = (vb <= 0) & (d2 >= 0) & (d6 <= 0); t = d2 / np.where(d2 - d6 == 0, 1e-30, d2 - d6); res[m] = (a + ac * t[:, None])[m]
    m = (vc <= 0) & (d1 >= 0) & (d3 <= 0); t = d1 / np.where(d1 - d3 == 0, 1e-30, d1 - d3); res[m] = (a + ab * t[:, None])[m]
    m = (d6 >= 0) & (d5 <= d6); res[m] = c[m]
    m = (d3 >= 0) & (d4 <= d3); res[m] = b[m]
    m = (d1 <= 0) & (d2 <= 0); res[m] = a[m]
    return np.linalg.norm(p - res, axis=1)


def dist_to_mesh(Q, V, F, step=0.25, k=12):
    """Fast, approximate: exact distance to the triangles of the k nearest surface samples."""
    S, sid = tri_sample(V, F, step)
    _, nn = cKDTree(S).query(Q, k=k)
    best = np.full(len(Q), np.inf)
    for j in range(k):
        t = sid[nn[:, j]]
        best = np.minimum(best, pt_tri(Q, V[F[t, 0]], V[F[t, 1]], V[F[t, 2]]))
    return best


def settle(Q, d, V, F):
    """Exact distance for points Q whose current (upper-bound) distance is d: search every triangle
    whose bounding box lies within d of the point."""
    P = V[F]; lo = P.min(1); hi = P.max(1)
    out = d.copy()
    for i, (q, r) in enumerate(zip(Q, d)):
        m = np.all((lo - r <= q) & (q <= hi + r), axis=1)
        if m.any():
            t = np.where(m)[0]
            out[i] = min(r, pt_tri(np.tile(q, (len(t), 1)), P[t, 0], P[t, 1], P[t, 2]).min())
    return out


def exact_dist(Q, V, F, step=0.25, suspect=0.01, cap=20000):
    """dist_to_mesh, then every point over `suspect` settled exactly (the worst `cap` of them)."""
    d = dist_to_mesh(Q, V, F, step)
    s = np.where(d > suspect)[0]
    if len(s) > cap:
        print(f'   {len(s)} points over {suspect}: settling the worst {cap} only - that many is a real deviation, not sampling')
        s = s[np.argsort(-d[s])[:cap]]
    if len(s):
        d[s] = settle(Q[s], d[s], V, F)
    return d


def report(name, Q, d, tol):
    print(f'{name}: {len(Q)} points  max {d.max():.4f}  p99.9 {np.percentile(d, 99.9):.4f}  p99 {np.percentile(d, 99):.4f}'
          f'  rms {np.sqrt((d ** 2).mean()):.4f}  >{tol}: {(d > tol).sum()}')
    o = np.argsort(-d)[:8]
    print('   worst:', [(np.round(Q[i], 3).tolist(), round(float(d[i]), 4)) for i in o])


def two_way(ref, model, step=0.3, suspect=0.01, cap=20000, tol=0.02):
    Vs, Fs = load_stl(ref); Vm, Fm = load_stl(model)
    res = {}
    for name, (A, B) in {'mesh -> model': ((Vs, Fs), (Vm, Fm)), 'model -> mesh': ((Vm, Fm), (Vs, Fs))}.items():
        Q, _ = tri_sample(A[0], A[1], step)
        d = exact_dist(Q, B[0], B[1], suspect=suspect, cap=cap)
        report(name, Q, d, tol); res[name] = (Q, d)
    return res


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('ref', help='the original CAD-exported STL')
    ap.add_argument('model', help='the rebuilt bodies, exported finely (reverse_export_stl chord 0.005)')
    ap.add_argument('--step', type=float, default=0.3, help='sample spacing, mm')
    ap.add_argument('--suspect', type=float, default=0.01, help='settle every point over this exactly')
    ap.add_argument('--cap', type=int, default=20000, help='settle at most this many suspects per direction')
    ap.add_argument('--tol', type=float, default=0.02, help='count points over this')
    a = ap.parse_args()
    two_way(a.ref, a.model, a.step, a.suspect, a.cap, a.tol)
