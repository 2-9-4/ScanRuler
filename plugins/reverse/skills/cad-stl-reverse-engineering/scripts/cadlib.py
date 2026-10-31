# SPDX-License-Identifier: AGPL-3.0-only
"""The B-rep faces of a CAD-exported STL, read exactly: shared by analyze.py and the scripts after it.

A CAD tessellation is not a scan. Every vertex lies on the true surface to float32 precision, a
planar face is a set of coplanar triangles (often long slivers with no interior vertex), a curved
face is a grid of facets whose vertices all lie on one cylinder, cone, sphere or torus. So faces
are found by *membership*, not by statistics: a triangle belongs to a surface when all three of its
vertices lie on it to TOL.

segment(V, F) -> Faces:
  1. planes   grown from the largest triangles: a neighbour joins when its three vertices lie on
              the plane (refitted by SVD as the face grows), so slivers, whose own normals are
              noisy, are judged by their vertices, not their normals.
  2. curved   the triangles left (and 1-2 triangle "planes" that are facet quads of a curved face)
              are grown into smooth regions over edges with a dihedral below SMOOTH_DEG, and each
              region is explained by as few primitives as fit it to TOL: cylinder, cone, sphere,
              torus. A tangent chain the primitives cannot split (a prismatic wall of tangent arcs)
              stays one face of kind 'chain' with its common ruling direction.
Each face carries its exact parameters, area, bounding box and its neighbours with the edge between
them: sharp or tangent, convex or concave.
"""
import struct
import numpy as np
from scipy.optimize import least_squares
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

TOL = 3e-4          # a vertex is on a surface within this: float32 gives ~4e-6 at 50 mm, but vertices on
                    # a face's boundary sit on its edge curves, which some exporters keep only to ~3e-4
STRICT = 2e-5       # most vertices of an analytic face are this exact; a spline patch is not
LOOSE = 6e-3        # ... and the worst of those edge curves seen so far (Autodesk STEP: 5.5e-3)
SMOOTH_DEG = 32.0   # facets of one curved face meet at less than this (export angle steps are 5-20 deg)
AXES = 'xyz'


# ---------------------------------------------------------------- mesh
def load_stl(path):
    """Binary or ASCII STL -> welded vertices V (n,3 float64), triangles F (m,3 int)."""
    b = open(path, 'rb').read()
    n = struct.unpack('<I', b[80:84])[0] if len(b) >= 84 else -1
    if len(b) == 84 + 50 * n:
        a = np.frombuffer(b[84:84 + n * 50], dtype=np.dtype([('n', '<f4', 3), ('v', '<f4', (3, 3)), ('a', '<u2')]))
        tri = a['v'].astype(np.float64)
    else:
        txt = b.decode('ascii', 'replace').split()
        xyz = [(float(txt[i + 1]), float(txt[i + 2]), float(txt[i + 3])) for i in range(len(txt)) if txt[i] == 'vertex']
        tri = np.array(xyz, dtype=np.float64).reshape(-1, 3, 3)
    flat = tri.reshape(-1, 3)
    u, inv = np.unique(np.round(flat, 6), axis=0, return_inverse=True)
    F = inv.reshape(-1, 3)
    ok = (F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 2] != F[:, 0])
    return u, F[ok]


def save_stl(path, V, F):
    P = V[F].astype(np.float32)
    N = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0]).astype(np.float64)
    N /= np.maximum(np.linalg.norm(N, axis=1), 1e-30)[:, None]
    rec = np.zeros(len(F), dtype=np.dtype([('n', '<f4', 3), ('v', '<f4', (3, 3)), ('a', '<u2')]))
    rec['n'] = N; rec['v'] = P
    with open(path, 'wb') as f:
        f.write(b'\0' * 80); f.write(struct.pack('<I', len(F))); f.write(rec.tobytes())


def tri_normals(V, F):
    P = V[F]
    N = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0])
    A = np.linalg.norm(N, axis=1)
    return N / np.where(A == 0, 1, A)[:, None], A / 2


def edges_of(F, nV):
    """Manifold interior edges: (t1, t2, (v0, v1)) arrays, plus the count of open edges."""
    E = np.sort(np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]]), axis=1)
    T = np.tile(np.arange(len(F)), 3)
    key = E[:, 0].astype(np.int64) * nV + E[:, 1]
    o = np.argsort(key, kind='stable'); key, T, E = key[o], T[o], E[o]
    _, start, cnt = np.unique(key, return_index=True, return_counts=True)
    s = start[cnt == 2]
    return T[s], T[s + 1], E[s], int((cnt == 1).sum())


def pieces_of(F, nV):
    t1, t2, _, _ = edges_of(F, nV)
    g = coo_matrix((np.ones(len(t1)), (t1, t2)), shape=(len(F), len(F)))
    return connected_components(g, directed=False)[1]


def volume(V, F):
    P = V[F]
    return float(np.einsum('ij,ij->i', P[:, 0], np.cross(P[:, 1], P[:, 2])).sum() / 6)


# ---------------------------------------------------------------- frames
def frame(ax):
    """Two unit vectors square to ax and to each other (e1 along the world axis nearest square)."""
    ax = np.asarray(ax, float)
    ref = np.eye(3)[int(np.argmin(np.abs(ax)))]
    e1 = ref - (ref @ ax) * ax; e1 /= np.linalg.norm(e1)
    return e1, np.cross(ax, e1)


def snap_dir(d, tol=1e-5):
    """A direction within tol (rad) of a world axis is that axis; otherwise unit, largest component positive."""
    d = np.asarray(d, float) / np.linalg.norm(d)
    i = int(np.argmax(np.abs(d)))
    if d[i] < 0: d = -d
    if np.linalg.norm(d - np.eye(3)[i]) < tol:
        return np.eye(3)[i]
    return d


def world_axis(d, tol=1e-5):
    """'x' / 'y' / 'z' when d is (anti)parallel to a world axis within tol rad, else None."""
    d = np.asarray(d, float) / np.linalg.norm(d)
    i = int(np.argmax(np.abs(d)))
    return AXES[i] if np.linalg.norm(np.abs(d) - np.eye(3)[i]) < tol else None


# ---------------------------------------------------------------- primitive fits
def fit_plane(P):
    c = P.mean(0)
    _, _, Vt = np.linalg.svd(P - c, full_matrices=False)
    n = Vt[2]
    return n, float(n @ c), float(np.abs((P - c) @ n).max())


def circle2d(q):
    A = np.c_[2 * q, np.ones(len(q))]
    s, *_ = np.linalg.lstsq(A, (q ** 2).sum(1), rcond=None)
    c = s[:2]; r2 = s[2] + c @ c
    r = np.sqrt(r2) if r2 > 0 else np.inf
    return c, r, (np.abs(np.linalg.norm(q - c, axis=1) - r).max() if np.isfinite(r) else np.inf)


def _ang(d):
    d = d / np.linalg.norm(d)
    return np.array([np.arccos(np.clip(d[2], -1, 1)), np.arctan2(d[1], d[0])])


def _dir(t):
    return np.array([np.sin(t[0]) * np.cos(t[1]), np.sin(t[0]) * np.sin(t[1]), np.cos(t[0])])


def fit_cylinder(P, N=None, ax0=None):
    """Axis direction, a point on the axis, radius, max residual. ax0 or facet normals start it."""
    if ax0 is None:
        M = N.T @ N
        ax0 = np.linalg.eigh(M)[1][:, 0]
    e1, e2 = frame(ax0)
    c2, r, res0 = circle2d(np.c_[P @ e1, P @ e2])
    if not np.isfinite(r):
        return None
    c0 = c2[0] * e1 + c2[1] * e2
    if res0 > 0.02 * max(r, 1):     # nowhere near a cylinder: refining will not get it to TOL
        return ax0, c0, float(r), float(res0)
    def res(x):
        a = _dir(x[:2]); c = x[2:5]
        d = P - c; d -= np.outer(d @ a, a)
        return np.linalg.norm(d, axis=1) - x[5]
    try:
        s = least_squares(res, np.r_[_ang(ax0), c0, r], method='lm', xtol=1e-15, ftol=1e-15, max_nfev=150)
    except Exception:
        return None
    a = snap_dir(_dir(s.x[:2])); c = s.x[2:5]
    if world_axis(a):          # refit the circle on the exact world axis
        e1, e2 = frame(a)
        c2, r, res_ = circle2d(np.c_[P @ e1, P @ e2])
        c = c2[0] * e1 + c2[1] * e2 + (c @ a) * a
        return a, c, float(r), float(res_)
    c = c - (c @ a) * a        # the axis point nearest the origin
    return a, c, float(abs(s.x[5])), float(np.abs(res(s.x)).max())


def fit_cone(P, N, C):
    """Axis, apex, half-angle (rad), max residual. The normals all make one angle with the axis;
    the vertices come in rings square to it (a tessellation grid), whose circles give the apex and
    the slope - better conditioned than the facet planes for a nearly flat cone."""
    A = np.c_[N, -np.ones(len(N))]
    w = np.linalg.svd(A, full_matrices=False)[2][-1]
    a = w[:3]; nrm = np.linalg.norm(a)
    if nrm < 1e-9:
        return None
    a = snap_dir(a / nrm)
    e1, e2 = frame(a)
    h = P @ a
    key = np.round(h, 4)
    rings = []
    for v in np.unique(key):
        q = P[key == v]
        if len(q) >= 3:
            c2, r, rres = circle2d(np.c_[q @ e1, q @ e2])
            if np.isfinite(r) and rres < 1e-3:
                rings.append((float(v), c2, r))
    if len(rings) >= 2:
        hs = np.array([x[0] for x in rings]); rs = np.array([x[2] for x in rings])
        cs = np.array([x[1] for x in rings]).mean(0)
        k, b = np.polyfit(hs, rs, 1)
        if abs(k) < 1e-9:
            return None
        h0 = -b / k                       # where r = 0
        apex0 = cs[0] * e1 + cs[1] * e2 + h0 * a
        if k < 0: a = -a; k = -k
    else:
        D = np.einsum('ij,ij->i', N, C)
        apex0, *_ = np.linalg.lstsq(N, D, rcond=None)
        hh = (P - apex0) @ a
        if np.median(hh) < 0: a = -a; hh = -hh
        rr = np.linalg.norm((P - apex0) - np.outer(hh, a), axis=1)
        k = np.median(rr / np.maximum(hh, 1e-9))
    d = P - apex0; hh = d @ a
    rr = np.linalg.norm(d - np.outer(hh, a), axis=1)
    res0 = np.abs((rr - k * hh) * np.cos(np.arctan(k))).max()
    if res0 > 0.02 * max(rr.max(), 1):
        return a, apex0, float(np.arctan(k)), float(res0)
    def res(x):
        ax = _dir(x[:2]); ap = x[2:5]
        d = P - ap; hh = d @ ax
        r = np.linalg.norm(d - np.outer(hh, ax), axis=1)
        return (r - np.tan(x[5]) * hh) * np.cos(x[5])
    try:
        s = least_squares(res, np.r_[_ang(a), apex0, np.arctan(k)], method='lm', xtol=1e-15, ftol=1e-15, max_nfev=200)
    except Exception:
        return None
    ax = _dir(s.x[:2]); ap = s.x[2:5]; half = float(s.x[5])
    if half < 0: half = -half
    return ax, ap, half, float(np.abs(res(s.x)).max())


def fit_sphere(P):
    A = np.c_[2 * P, np.ones(len(P))]
    s, *_ = np.linalg.lstsq(A, (P ** 2).sum(1), rcond=None)
    c = s[:3]; r2 = s[3] + c @ c
    if r2 <= 0:
        return None
    r = np.sqrt(r2)
    return c, float(r), float(np.abs(np.linalg.norm(P - c, axis=1) - r).max())


def fit_torus(P, N, C):
    """Axis, centre, major R, minor r, residual. Started from the facet normals: each normal line
    meets the axis; the tube centres p - r n lie on one circle."""
    best = None
    for sgn in (1, -1):
        # guess r from the spread of normals over the spread of points
        for r0 in np.geomspace(0.1, 20, 12):
            Q = C - sgn * r0 * N
            n, d, res = fit_plane(Q)
            if res > 0.2 * r0 + 0.05:
                continue
            e1, e2 = frame(n)
            c2, R, cres = circle2d(np.c_[Q @ e1, Q @ e2])
            if not np.isfinite(R):
                continue
            c = c2[0] * e1 + c2[1] * e2 + d * n
            score = cres + res
            if best is None or score < best[0]:
                best = (score, n, c, R, r0)
    if best is None:
        return None
    if best[0] > 0.05 * best[4] + 0.02:
        return None
    _, n0, c0, R0, r0 = best
    def res(x):
        a = _dir(x[:2]); c = x[2:5]
        d = P - c; h = d @ a
        rho = np.linalg.norm(d - np.outer(h, a), axis=1)
        return np.hypot(rho - x[5], h) - x[6]
    try:
        s = least_squares(res, np.r_[_ang(n0), c0, R0, r0], method='lm', xtol=1e-15, ftol=1e-15, max_nfev=80)
    except Exception:
        return None
    a = snap_dir(_dir(s.x[:2]))
    return a, s.x[2:5], float(s.x[5]), float(abs(s.x[6])), float(np.abs(res(s.x)).max())


def _accept(prim, P, tol):
    """A fit holds when every vertex is within tol - or, on 10+ vertices, when 80 % are and the
    rest within LOOSE: vertices on a face's boundary sit on its edge curves, which some exporters
    (STEP translators) keep only to a few microns."""
    d = dist_to(prim, P)
    if d.max() < tol:
        return True
    # 60 %: a face tessellated as strips between two edges has only ring vertices, and one loose
    # edge curve puts half of them off
    return len(P) >= 10 and np.quantile(d, 0.6) < tol and d.max() < LOOSE


def fit_best(P, N, C, tol=TOL, allow_torus=True, kinds=None):
    """The simplest primitive the points lie on: dict(kind, ..., res) or None. A cylinder must
    also agree with the facet normals (square to its axis): two rings of a short cone strip fit a
    slightly tilted cylinder too."""
    if len(P) < 3:
        return None
    n, d, res = fit_plane(P)
    ns = snap_dir(n) * np.sign(snap_dir(n) @ n)
    pl = dict(kind='plane', n=ns if world_axis(ns) else n, d=float(np.median(P @ (ns if world_axis(ns) else n))), res=res)
    if _accept(pl, P, tol):
        return pl
    # every curved kind that holds, then the best: a short strip of two rings fits a cone and a
    # tilted cylinder alike, and only the residuals tell them apart
    cands = []
    allow = lambda k: kinds is None or k in kinds
    if len(P) >= 5 and allow('cylinder'):
        cy = fit_cylinder(P, N)
        if cy and cy[3] < LOOSE and np.median(np.abs(N @ cy[0])) < 0.02:
            cands.append(dict(kind='cylinder', axis=cy[0], c=cy[1], r=cy[2], res=cy[3]))
    if len(P) >= 6 and kinds is None:
        co = fit_cone(P, N, C)
        if co and co[3] < LOOSE and 1e-3 < co[2] < np.pi / 2 - 1e-3:
            ax = snap_dir(co[0]) * np.sign(snap_dir(co[0]) @ co[0])
            cands.append(dict(kind='cone', axis=ax, apex=co[1], half=co[2], res=co[3]))
        sp = fit_sphere(P)
        if sp and sp[2] < LOOSE:
            cands.append(dict(kind='sphere', c=sp[0], r=sp[1], res=sp[2]))
    cands = [c for c in cands if _accept(c, P, tol)]
    if not cands and allow_torus and kinds is None and len(P) >= 12:
        to = fit_torus(P, N, C)
        if to and to[4] < LOOSE and to[3] < to[2] * 50:
            pr = dict(kind='torus', axis=to[0], c=to[1], R=to[2], r=to[3], res=to[4])
            if _accept(pr, P, tol):
                cands.append(pr)
    if not cands:
        return None
    # the facet normals decide: on the true surface each lies within half a chord angle of the
    # surface normal at the facet; on a stand-in through the same rings they do not. Where they
    # cannot tell (a narrow strip of two rings lies exactly on a cone and on a sphere), the
    # simpler kind is the designer's: a chamfer, not a ball.
    errs = [normal_err(c, C, N) for c in cands]
    order = {'cylinder': 0, 'cone': 1, 'sphere': 2, 'torus': 3}
    ok = [c for c, e in zip(cands, errs) if e <= min(errs) + 1.0]
    return min(ok, key=lambda c: order[c['kind']])


def surface_normal(prim, Q):
    """Unit normals of a primitive at (points near) Q, up to sign."""
    k = prim['kind']
    if k == 'plane':
        return np.tile(prim['n'], (len(Q), 1))
    if k == 'sphere':
        d = Q - prim['c']
    elif k == 'cylinder':
        d = Q - prim['c']; d -= np.outer(d @ prim['axis'], prim['axis'])
    elif k == 'cone':
        a, t = prim['axis'], prim['half']
        d = Q - prim['apex']; h = d @ a
        rad = d - np.outer(h, a); rad /= np.maximum(np.linalg.norm(rad, axis=1), 1e-12)[:, None]
        d = rad * np.cos(t) - np.outer(np.full(len(Q), np.sin(t)), a)
    elif k == 'torus':
        a = prim['axis']; d0 = Q - prim['c']; h = d0 @ a
        rad = d0 - np.outer(h, a); rad /= np.maximum(np.linalg.norm(rad, axis=1), 1e-12)[:, None]
        d = d0 - prim['R'] * rad
    else:
        raise ValueError(k)
    return d / np.maximum(np.linalg.norm(d, axis=1), 1e-12)[:, None]


def normal_err(prim, C, N):
    """Median angle (deg) between facet normals and the primitive's normals at the facets."""
    c = np.abs(np.einsum('ij,ij->i', surface_normal(prim, C), N))
    return float(np.degrees(np.median(np.arccos(np.clip(c, -1, 1)))))


def dist_to(prim, P):
    """Unsigned distance of points to a fitted primitive."""
    k = prim['kind']
    if k == 'plane':
        return np.abs(P @ prim['n'] - prim['d'])
    if k == 'cylinder':
        d = P - prim['c']; d -= np.outer(d @ prim['axis'], prim['axis'])
        return np.abs(np.linalg.norm(d, axis=1) - prim['r'])
    if k == 'cone':
        a, ap, t = prim['axis'], prim['apex'], prim['half']
        d = P - ap; h = d @ a
        r = np.linalg.norm(d - np.outer(h, a), axis=1)
        return np.abs((r - np.tan(t) * h) * np.cos(t))
    if k == 'sphere':
        return np.abs(np.linalg.norm(P - prim['c'], axis=1) - prim['r'])
    if k == 'torus':
        a, c = prim['axis'], prim['c']
        d = P - c; h = d @ a
        rho = np.linalg.norm(d - np.outer(h, a), axis=1)
        return np.abs(np.hypot(rho - prim['R'], h) - prim['r'])
    raise ValueError(k)


# ---------------------------------------------------------------- segmentation
class Faces:
    """Face of each triangle (fid), the faces' fitted primitives, and the adjacency between them."""

    def __init__(self, V, F, tol=TOL, smooth_deg=SMOOTH_DEG):
        self.V, self.F, self.tol = V, F, tol
        self.N, self.A = tri_normals(V, F)
        self.C = V[F].mean(1)
        t1, t2, E, self.open_edges = edges_of(F, len(V))
        self.t1, self.t2, self.E = t1, t2, E
        cosd = np.einsum('ij,ij->i', self.N[t1], self.N[t2])
        self.dihedral = np.degrees(np.arccos(np.clip(cosd, -1, 1)))
        self.nbr = [[] for _ in range(len(F))]
        for k, (a, b) in enumerate(zip(t1, t2)):
            self.nbr[a].append((b, k)); self.nbr[b].append((a, k))
        self.piece = pieces_of(F, len(V))
        self._segment(np.radians(smooth_deg))
        self._describe()

    # -- planes
    def _grow_planes(self):
        V, F, A = self.V, self.F, self.A
        fid = np.full(len(F), -1)
        prims = []
        order = np.argsort(-A)
        for seed in order:
            if fid[seed] >= 0 or A[seed] < 1e-12:
                continue
            P = V[F[seed]]
            n = self.N[seed]; d = float(n @ P[0])
            members = [seed]; fid[seed] = len(prims)
            front = [seed]; nfit = 1
            while front:
                t = front.pop()
                for u, _ in self.nbr[t]:
                    if fid[u] >= 0:
                        continue
                    if np.abs(V[F[u]] @ n - d).max() < self.tol:
                        fid[u] = len(prims); members.append(u); front.append(u)
                        if len(members) >= 2 * nfit and len(members) >= 3:
                            vs = np.unique(F[members])
                            n2, d2, r2 = fit_plane(V[vs])
                            if r2 < self.tol:
                                n, d = (n2, d2) if n2 @ n > 0 else (-n2, -d2)
                            nfit = len(members)
            prims.append(dict(kind='plane', n=n, d=d, tris=members))
        return fid, prims

    def _segment(self, smooth):
        V, F, N = self.V, self.F, self.N
        pfid, planes = self._grow_planes()
        # A plane group is a real planar face unless it may be a facet strip of a curved face:
        # 1-2 triangles, or 3+ on no more than four vertices. Those go to the curved pool, and come
        # back as planes when nothing curved explains them.
        real = np.array([len(p['tris']) >= 3 and len(np.unique(F[p['tris']])) > 4 for p in planes], bool)
        fid = np.full(len(F), -1)
        prims = []
        for i, p in enumerate(planes):
            if real[i]:
                for t in p['tris']:
                    fid[t] = len(prims)
                vs = np.unique(F[p['tris']])
                n, d, res = fit_plane(V[vs]) if len(vs) >= 3 else (p['n'], p['d'], 0.0)
                if n @ p['n'] < 0: n, d = -n, -d
                ns = snap_dir(n); ns = ns * np.sign(ns @ n)
                if world_axis(ns):
                    d = float(np.median(V[vs] @ ns))
                    n = ns
                prims.append(dict(kind='plane', n=n, d=d, res=res))
        # curved: smooth regions of the rest
        rest = np.where(fid < 0)[0]
        inrest = np.zeros(len(F), bool); inrest[rest] = True
        ok = inrest[self.t1] & inrest[self.t2] & (self.dihedral < np.degrees(smooth))
        g = coo_matrix((np.ones(ok.sum()), (self.t1[ok], self.t2[ok])), shape=(len(F), len(F)))
        _, comp = connected_components(g, directed=False)
        regions = {}
        for t in rest:
            regions.setdefault(comp[t], []).append(t)
        for tris in regions.values():
            for sub, prim in self._explain(np.array(tris)):
                for t in sub:
                    fid[t] = len(prims)
                prims.append(prim)
        self.fid, self.prims = fid, prims
        self._absorb_strips()
        self._merge_same()

    def _components(self, tris):
        inr = np.zeros(len(self.F), bool); inr[tris] = True
        ok = inr[self.t1] & inr[self.t2] & (self.dihedral < SMOOTH_DEG)
        g = coo_matrix((np.ones(ok.sum()), (self.t1[ok], self.t2[ok])), shape=(len(self.F), len(self.F)))
        comp = connected_components(g, directed=False)[1][tris]
        return [tris[comp == c] for c in np.unique(comp)]

    def _explain(self, tris, depth=0):
        """Split a smooth region into primitive faces. Returns [(tris, prim)]."""
        V, F, N = self.V, self.F, self.N
        vs = np.unique(F[tris])
        ch = self._chain(tris)
        # a region whose facets all stand square to one direction is a prismatic wall: a plane, a
        # cylinder or a chain - never a cone, a sphere or a torus, which fit a narrow band of a
        # spline wall loosely
        prim = fit_best(V[vs], N[tris], self.C[tris], self.tol, kinds=('cylinder',) if ch['kind'] == 'chain' else None)
        if prim is not None:
            return [(tris, prim)]
        if ch['kind'] == 'chain':
            # one prismatic wall of tangent pieces (arcs, lines, an extruded spline): one face,
            # read later as a 2D profile square to its axis
            return [(tris, ch)]
        # a prismatic wall run on, tangent, into something else (a round along its top edge): the
        # triangles square to a world axis are the wall, split off and explained apart
        if depth < 2:
            for j in range(3):
                sq = np.abs(N[tris, j]) < 2e-3
                if self.A[tris[sq]].sum() > 0.5 * self.A[tris].sum() and (~sq).any():
                    out = []
                    for part in (tris[sq], tris[~sq]):
                        for comp in self._components(part):
                            out += self._explain(comp, depth + 1)
                    return out
        # greedy: grow the largest primitive patch from seeds, take it out, repeat
        out = []
        left = set(int(t) for t in tris)
        inregion = np.zeros(len(F), bool); inregion[tris] = True
        guard = 0
        failed = set()
        while left and guard < 400:
            guard += 1
            best = None
            seeds = [t for t in sorted(left, key=lambda t: -self.A[t]) if t not in failed][:4]
            if not seeds:
                break
            for s in seeds:
                patch, pr = self._grow_prim(s, left)
                if pr is not None and len(patch) >= 4 and self._exact(patch, pr):
                    if best is None or len(patch) > len(best[0]):
                        best = (patch, pr)
                else:
                    failed |= patch if pr is not None else {s}
            if best is None:
                continue
            out.append((np.array(sorted(best[0])), best[1]))
            left -= best[0]
        if left:
            # what fits nothing as a patch: per connected rest, the simplest primitive, else one
            # 'chain' face (tangent arcs of a prismatic wall) or 'freeform' (a B-spline face)
            rest = np.array(sorted(left))
            inr = np.zeros(len(F), bool); inr[rest] = True
            ok = inr[self.t1] & inr[self.t2]
            g = coo_matrix((np.ones(ok.sum()), (self.t1[ok], self.t2[ok])), shape=(len(F), len(F)))
            comp = connected_components(g, directed=False)[1][rest]
            for c in np.unique(comp):
                sub = rest[comp == c]
                pr = fit_best(V[np.unique(F[sub])], N[sub], self.C[sub], self.tol)
                out.append((sub, pr if pr is not None else self._chain(sub)))
        return out

    def _exact(self, patch, pr):
        """A patch of an analytic face lies on its primitive to float precision at most vertices
        (only some boundary vertices drift with the edge curves); a patch of a B-spline face that
        a cylinder or cone merely approximates within TOL does not."""
        d = dist_to(pr, self.V[np.unique(self.F[sorted(patch)])])
        return np.quantile(d, 0.4) < STRICT

    def _grow_prim(self, seed, allowed):
        """The largest patch round a seed that one primitive explains. Growth stalls where the
        primitive no longer fits; then the patch is refitted with the neighbours that stopped it,
        and grows on if any kind explains them all - a seed of two rings fits a cylinder as well as
        the cone it is part of, and only more of the face tells which."""
        V, F, N = self.V, self.F, self.N
        patch = {seed}
        front = [seed]
        while front and len(patch) < 6:
            t = front.pop(0)
            for u, k in self.nbr[t]:
                if u in allowed and u not in patch and self.dihedral[k] < SMOOTH_DEG:
                    patch.add(u); front.append(u)
        pl = sorted(patch)
        pr = fit_best(V[np.unique(F[pl])], N[pl], self.C[pl], self.tol)
        if pr is None:
            return {seed}, None
        for _ in range(6):
            front = list(patch); stalled = set()
            while front:
                t = front.pop()
                for u, k in self.nbr[t]:
                    if u in allowed and u not in patch and self.dihedral[k] < SMOOTH_DEG:
                        if dist_to(pr, V[F[u]]).max() < self.tol:
                            patch.add(u); front.append(u)
                        else:
                            stalled.add(u)
            stalled -= patch
            if not stalled:
                break
            tl = sorted(patch | stalled)
            p2 = fit_best(V[np.unique(F[tl])], N[tl], self.C[tl], self.tol, allow_torus=len(tl) > 20)
            if p2 is None:
                break
            pr = p2; patch |= stalled
        return patch, pr

    def _chain(self, tris):
        V, F, N = self.V, self.F, self.N
        M = (N[tris] * self.A[tris, None]).T @ N[tris]
        ev, U = np.linalg.eigh(M)
        if ev[0] / max(ev.sum(), 1e-30) < 1e-5:
            # facets within ~0.2 deg of square to one direction: a spline wall's facets lean by a
            # milliradian where its edges are held loosely
            ax = U[:, 0]
            w = world_axis(ax, 2e-3)
            return dict(kind='chain', axis=np.eye(3)[AXES.index(w)] if w else snap_dir(ax), res=None)
        return dict(kind='freeform', res=None)

    def _absorb_strips(self):
        """A small 'plane' between faces of one curved primitive, whose vertices lie on it, is a
        facet strip of that face (a trimmed strip of 3+ triangles)."""
        V, F = self.V, self.F
        changed = True
        while changed:
            changed = False
            for i, p in enumerate(self.prims):
                if p['kind'] != 'plane' or p.get('dead'):
                    continue
                tris = np.where(self.fid == i)[0]
                if len(tris) > 8:
                    continue
                nb = {}
                for t in tris:
                    for u, k in self.nbr[t]:
                        j = self.fid[u]
                        if j != i and self.dihedral[k] < SMOOTH_DEG:
                            nb[j] = nb.get(j, 0) + 1
                for j in sorted(nb, key=lambda j: -nb[j]):
                    q = self.prims[j]
                    if q['kind'] in ('cylinder', 'cone', 'sphere', 'torus') and dist_to(q, V[np.unique(F[tris])]).max() < self.tol:
                        self.fid[tris] = j; p['dead'] = True; changed = True
                        break
        # renumber
        alive = [i for i, p in enumerate(self.prims) if not p.get('dead') and (self.fid == i).any()]
        remap = -np.ones(len(self.prims), int); remap[alive] = np.arange(len(alive))
        self.fid = remap[self.fid]
        self.prims = [self.prims[i] for i in alive]

    def _merge_same(self):
        """Neighbouring faces on one primitive are one face (a cylinder cut in two by a trimmed strip)."""
        V, F = self.V, self.F
        nf = len(self.prims)
        parent = list(range(nf))
        def root(i):
            while parent[i] != i:
                parent[i] = parent[parent[i]]; i = parent[i]
            return i
        fa, fb = self.fid[self.t1], self.fid[self.t2]
        pairs = set()
        for k in np.where((fa != fb) & (self.dihedral < SMOOTH_DEG))[0]:
            pairs.add((min(fa[k], fb[k]), max(fa[k], fb[k])))
        cnt = np.bincount(self.fid, minlength=nf)
        for a, b in sorted(pairs):
            ra, rb = root(a), root(b)
            if ra == rb:
                continue
            pa, pb = self.prims[ra], self.prims[rb]
            if pa['kind'] != pb['kind'] or pa['kind'] not in ('plane', 'cylinder', 'cone', 'sphere', 'torus'):
                continue
            big, small = (ra, rb) if cnt[ra] >= cnt[rb] else (rb, ra)
            vs = np.unique(F[self.fid == small])
            if dist_to(self.prims[big], V[vs]).max() < self.tol:
                parent[small] = big; cnt[big] += cnt[small]
        r = np.array([root(i) for i in range(nf)])
        alive = sorted(set(r.tolist()))
        remap = -np.ones(nf, int); remap[alive] = np.arange(len(alive))
        self.fid = remap[r[self.fid]]
        self.prims = [self.prims[i] for i in alive]

    # -- description
    def _describe(self):
        V, F, A = self.V, self.F, self.A
        nf = len(self.prims)
        self.area = np.bincount(self.fid, weights=A, minlength=nf)
        self.tris = [np.where(self.fid == i)[0] for i in range(nf)]
        self.verts = [np.unique(F[t]) for t in self.tris]
        self.fpiece = np.array([self.piece[t[0]] for t in self.tris])
        # adjacency: per face pair, the shared edges' dihedral and convexity
        fa, fb = self.fid[self.t1], self.fid[self.t2]
        cross = fa != fb
        self.adj = {}
        C = V[F].mean(1)
        for k in np.where(cross)[0]:
            a, b = int(fa[k]), int(fb[k])
            ta, tb = self.t1[k], self.t2[k]
            # convex: the other triangle's centroid lies behind this one's plane
            conv = (C[tb] - C[ta]) @ self.N[ta] < 0
            key = (min(a, b), max(a, b))
            e = self.adj.setdefault(key, dict(n=0, dmin=180.0, dmax=0.0, convex=0, length=0.0))
            e['n'] += 1; e['dmin'] = min(e['dmin'], self.dihedral[k]); e['dmax'] = max(e['dmax'], self.dihedral[k])
            e['convex'] += int(conv)
            e['length'] += float(np.linalg.norm(V[self.E[k][0]] - V[self.E[k][1]]))
        for e in self.adj.values():
            e['convex'] = e['convex'] * 2 > e['n']
            e['tangent'] = e['dmax'] < SMOOTH_DEG
        self.neigh = [[] for _ in range(nf)]
        for (a, b), e in self.adj.items():
            self.neigh[a].append(b); self.neigh[b].append(a)
        for i, p in enumerate(self.prims):
            P = V[self.verts[i]]
            p['bbox'] = [P.min(0), P.max(0)]
            if p['kind'] in ('cylinder', 'cone', 'torus'):
                ax = p['axis']; base = p['c'] if 'c' in p else p['apex']
                h = (P - base) @ ax
                p['h'] = (float(h.min()), float(h.max()))
                e1, e2 = frame(ax)
                d = P - base
                ang = np.degrees(np.arctan2(d @ e2, d @ e1))
                p['sweep'] = _extent(ang)
                # concave (a hole) when the facet normals point at the axis
                tri = self.tris[i]
                cen = V[F[tri]].mean(1) - base
                rad = cen - np.outer(cen @ ax, ax)
                p['convex'] = bool((np.einsum('ij,ij->i', self.N[tri], rad) > 0).mean() > 0.5)
            if p['kind'] == 'sphere':
                tri = self.tris[i]
                p['convex'] = bool((np.einsum('ij,ij->i', self.N[tri], V[F[tri]].mean(1) - p['c']) > 0).mean() > 0.5)


def _extent(ang):
    a = np.sort(ang)
    if len(a) < 2:
        return 0.0
    gaps = np.diff(np.r_[a, a[0] + 360])
    return float(360 - gaps.max())


def nominal(x, steps=(1, 0.5, 0.25, 0.1, 0.05, 0.01, 0.005, 0.001), within=2e-4):
    """The round design value x reads as, coarsest step first; None when nothing is within."""
    for s in steps:
        v = round(x / s) * s
        if abs(x - v) < within:
            return round(v, 6)
    return None


def fmt_num(x, within=2e-4):
    v = nominal(x, within=within)
    return f'{x:.5f}' + (f' (={v:g})' if v is not None and abs(v) > 1e-9 else '')
