# SPDX-License-Identifier: AGPL-3.0-only
"""Segment a CAD-exported STL into its B-rep faces and read each one exactly.

    python segment.py [--data data] [--smooth 25] [--top 40]

CAD tessellation facts used here:
- every vertex lies on the true surface (float32 rounding, ~1e-5 mm)
- a planar CAD face = connected triangles with identical normal and plane offset
- a curved CAD face = connected triangles whose dihedral angles are small (one chord step),
  bounded by sharp edges (dihedral well above the chord step; --smooth sets the split, degrees)

Writes <data>/face.npy (face id per triangle) and <data>/faces.json, and prints the planes (normal,
offset, area), the cylinders (axis, centre, radius, residual, convex/concave, angular extent) and
the cones (axis, centre, exact slope dz/dr from the vertices, radius at both ends) per piece.
A cone's slope is the scale check's best evidence: a 45 deg chamfer reads dz/dr = 1 unless Z was scaled.
"""
import argparse, json, os, sys
import numpy as np
from collections import Counter
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from load import load_work, tri_normals, edge_pairs


def fit_circle2d(x, y):
    Am = np.c_[2 * x, 2 * y, np.ones_like(x)]
    sol, *_ = np.linalg.lstsq(Am, x * x + y * y, rcond=None)
    cx, cy = sol[0], sol[1]; r = np.sqrt(max(sol[2] + cx * cx + cy * cy, 0))
    return cx, cy, r, float(np.abs(np.sqrt((x - cx) ** 2 + (y - cy) ** 2) - r).max())


def frame(ax):
    ref = np.array([1.0, 0, 0]) if abs(ax[0]) < 0.9 else np.array([0, 1.0, 0])
    e1 = ref - (ref @ ax) * ax; e1 /= np.linalg.norm(e1)
    return e1, np.cross(ax, e1)


def snap_axis(ax, tol=2e-3):
    """CAD axes are nearly always world axes: snap one within tol rad, so the fit is exact."""
    i = int(np.argmax(np.abs(ax)))
    if np.linalg.norm(ax - np.sign(ax[i]) * np.eye(3)[i]) < tol:
        return np.eye(3)[i] * np.sign(ax[i])
    return ax


def extent(ang):
    """Angular extent (deg) of a set of angles and where it starts."""
    a = np.sort(ang)
    if len(a) < 2:
        return 0.0, float(a[0]) if len(a) else 0.0
    gaps = np.diff(np.r_[a, a[0] + 360]); i = int(np.argmax(gaps))
    return float(360 - gaps[i]), float(a[(i + 1) % len(a)])


def classify(pts, n, w):
    """plane / cylinder / cone / curved, with exact parameters from the vertices."""
    nmean = (n * w[:, None]).sum(0); nmean /= np.linalg.norm(nmean)
    if np.all(n @ nmean > 1 - 1e-8):
        return dict(type='plane', n=[round(float(c), 6) for c in nmean], d=round(float(pts[0] @ nmean), 6))
    # cylinder: normals square to the axis -> smallest eigenvector of the uncentred second moment
    M = n.T @ (n * w[:, None]); ev, U = np.linalg.eigh(M)
    if len(np.unique(np.round(n, 6), axis=0)) < 3:    # two facet normals always look like a cylinder
        return dict(type='curved', note='too few facets to tell')
    if ev[0] / ev.sum() < 1e-6:
        ax = U[:, 0]
        if ax[np.argmax(np.abs(ax))] < 0: ax = -ax
        ax = snap_axis(ax)
        e1, e2 = frame(ax)
        cx, cy, r, res = fit_circle2d(pts @ e1, pts @ e2)
        c = cx * e1 + cy * e2
        cen = pts.mean(0)
        rad = cen - c - ((cen - c) @ ax) * ax
        convex = bool(((n @ (rad / (np.linalg.norm(rad) + 1e-12))) > 0).mean() > 0.5)
        sw, a0 = extent(np.degrees(np.arctan2(pts @ e2 - cy, pts @ e1 - cx)))
        h = pts @ ax
        if res > 1e-3:      # tangent arcs of different radii joined smoothly: one smooth chain, not one cylinder
            return dict(type='curved', note=f'smooth chain along {np.round(ax, 4).tolist()} (one-circle res {res:.2g}): read it with profile.py')
        return dict(type='cylinder', axis=[round(float(v), 6) for v in ax], c=[round(float(v), 6) for v in c],
                    r=round(float(r), 6), res=float('%.2g' % res), convex=convex, sweep=round(sw, 2), arc_from=round(a0, 3),
                    h=[round(float(h.min()), 5), round(float(h.max()), 5)])
    # cone: n . axis constant -> smallest eigenvector of the centred covariance
    nc = n - (n * w[:, None]).sum(0) / w.sum()
    ev2, U2 = np.linalg.eigh(nc.T @ (nc * w[:, None]))
    ax = U2[:, 0]
    if ax[np.argmax(np.abs(ax))] < 0: ax = -ax
    ax = snap_axis(ax)
    if np.sqrt(ev2[0] / w.sum()) < 3e-3:
        e1, e2 = frame(ax)
        h = pts @ ax; u = pts @ e1; v = pts @ e2
        hk = np.round(h, 4); best = None
        for hv in np.unique(hk):                      # the fullest ring of equal height gives the centre
            m = hk == hv
            if m.sum() >= 4 and (best is None or m.sum() > best[1].sum()):
                best = (hv, m)
        if best is not None:
            cx, cy, _, _ = fit_circle2d(u[best[1]], v[best[1]])
            r = np.hypot(u - cx, v - cy)
            A = np.c_[r, np.ones_like(r)]; (s, h0), *_ = np.linalg.lstsq(A, h, rcond=None)
            res = float(np.abs(A @ [s, h0] - h).max())
            c = cx * e1 + cy * e2
            sw, a0 = extent(np.degrees(np.arctan2(v - cy, u - cx)))
            i0, i1 = np.argmin(h), np.argmax(h)
            return dict(type='cone', axis=[round(float(x), 6) for x in ax], c=[round(float(x), 6) for x in c],
                        slope=round(float(s), 6), angle=round(float(np.degrees(np.arctan(abs(s)))), 4), res=float('%.2g' % res),
                        ends=[[round(float(r[i0]), 5), round(float(h[i0]), 5)], [round(float(r[i1]), 5), round(float(h[i1]), 5)]],
                        sweep=round(sw, 2), arc_from=round(a0, 3))
    return dict(type='curved', axis=[round(float(x), 5) for x in U[:, 0]])


def segment(V, F, piece, smooth_deg=25.0):
    N, A = tri_normals(V, F)
    P = V[F]
    t1, t2, ev, _, _ = edge_pairs(F, len(V))
    dots = np.clip((N[t1] * N[t2]).sum(1), -1, 1); ang = np.degrees(np.arccos(dots))
    off = (N * P[:, 0]).sum(1)
    coplanar = (dots > 1 - 1e-8) & (np.abs(off[t1] - off[t2]) < 1e-4)
    nT = len(F)
    gp = coo_matrix((np.ones(coplanar.sum()), (t1[coplanar], t2[coplanar])), shape=(nT, nT))
    _, preg = connected_components(gp, directed=False)
    # A flat region is a real plane face unless it is one facet (quad, strip) of a curved face: those
    # join their neighbours by chord-step dihedrals along most of their boundary. Single triangles
    # always belong to curved faces. (A narrow land between two tangent rounds can be absorbed too.)
    big = np.bincount(preg) >= 2
    L = np.linalg.norm(V[ev[:, 0]] - V[ev[:, 1]], axis=1)
    border = preg[t1] != preg[t2]
    soft = border & (ang < smooth_deg)
    tot = np.bincount(preg[t1][border], L[border], len(big)) + np.bincount(preg[t2][border], L[border], len(big))
    sm = np.bincount(preg[t1][soft], L[soft], len(big)) + np.bincount(preg[t2][soft], L[soft], len(big))
    isplane = (big & ~(sm > 0.6 * np.maximum(tot, 1e-12)))[preg]
    cm = (ang < smooth_deg) & ~isplane[t1] & ~isplane[t2]
    gc = coo_matrix((np.ones(cm.sum()), (t1[cm], t2[cm])), shape=(nT, nT))
    _, creg = connected_components(gc, directed=False)
    face = np.where(isplane, preg, creg + preg.max() + 1)
    _, face = np.unique(face, return_inverse=True)
    out = []
    for f in range(face.max() + 1):
        m = face == f
        pts = V[np.unique(F[m])]
        rec = dict(face=int(f), piece=int(piece[m][0]), ntri=int(m.sum()), area=round(float(A[m].sum()), 4),
                   box=[pts.min(0).round(4).tolist(), pts.max(0).round(4).tolist()])
        rec.update(classify(pts, N[m], A[m]))
        out.append(rec)
    return face, out, ang[~coplanar]


def summary(out, top):
    by = {}
    for r in out:
        by.setdefault(r['piece'], []).append(r)
    for p in sorted(by):
        rs = by[p]
        print(f'piece {p}: ' + ', '.join(f'{k} {v}' for k, v in Counter(r['type'] for r in rs).items()))
        pl = sorted([r for r in rs if r['type'] == 'plane'], key=lambda r: -r['area'])
        for r in pl[:top]:
            print(f'   plane  n={r["n"]} d={r["d"]:.5f} area {r["area"]:.3f}')
        if len(pl) > top:
            print(f'   ... {len(pl) - top} smaller planes')
        cy = {}
        for r in rs:
            if r['type'] == 'cylinder':
                k = (tuple(np.round(r['axis'], 3)), tuple(np.round(r['c'], 3)), round(r['r'], 4), r['convex'])
                cy.setdefault(k, []).append(r)
        for (ax, c, rr, cv), g in sorted(cy.items(), key=lambda kv: kv[0][2]):
            rn = round(rr, 3)
            print(f'   cyl    axis {list(ax)} c {list(c)} R {g[0]["r"]:.5f}' + (f' (= {rn:g})' if abs(g[0]['r'] - rn) < 1e-4 else '')
                  + f' {"boss" if cv else "hole"} res {max(x["res"] for x in g):.1e} faces {len(g)}'
                  + (' (res > 1e-4: vertices of an intersection curve are in the fit - refit on the wall band)'
                     if max(x['res'] for x in g) > 1e-4 else '')
                  + ''.join(f' [{x["arc_from"]:.1f}+{x["sweep"]:.1f} deg, h {x["h"][0]:.3f}..{x["h"][1]:.3f}]' for x in g[:4]))
        for r in rs:
            if r['type'] == 'curved':
                print(f'   curved box {r["box"]} area {r["area"]:.3f} {r.get("note", "")}')
        for r in rs:
            if r['type'] == 'cone':
                bad = r['res'] > 1e-3
                print(f'   cone   axis {r["axis"]} c {r["c"]} dz/dr {r["slope"]:.6f} ({r["angle"]:.3f} deg) res {r["res"]:.1e}'
                      f' (r,h) {r["ends"][0]} -> {r["ends"][1]}  {r["arc_from"]:.1f}+{r["sweep"]:.1f} deg'
                      + ('   NOT A CONE (res > 1e-3): a helical face (thread - read it with helix.py) or freeform' if bad else ''))


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--data', default='data')
    ap.add_argument('--smooth', type=float, default=25.0, help='dihedral (deg) below which curved triangles join one face')
    ap.add_argument('--top', type=int, default=40, help='planes listed per piece')
    a = ap.parse_args()
    V, F, piece = load_work(a.data)
    face, out, ang = segment(V, F, piece, a.smooth)
    np.save(os.path.join(a.data, 'face.npy'), face)
    json.dump(out, open(os.path.join(a.data, 'faces.json'), 'w'))
    print(f'{len(out)} faces:', dict(Counter(r['type'] for r in out)))
    summary(out, a.top)
    h, b = np.histogram(ang, bins=[0, 1, 2, 5, 10, 15, 20, 25, 30, 45, 60, 89, 91, 135, 181])
    print('dihedral histogram among non-coplanar edges (deg) - a gap tells the chord step from real edges:')
    print('   ' + '  '.join(f'{b[i]:g}-{b[i + 1]:g}: {h[i]}' for i in range(len(h)) if h[i]))
