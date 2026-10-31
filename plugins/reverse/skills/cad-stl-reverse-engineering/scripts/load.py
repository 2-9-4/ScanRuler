# SPDX-License-Identifier: AGPL-3.0-only
"""Load a CAD-exported STL, weld it, and print the inventory a rebuild starts from.

    python load.py part.stl [--data data] [--mirror y=105]

Writes <data>/V.npy (welded vertices), F.npy (triangles) and piece.npy (connected piece of each
triangle), then prints:
  - mesh health: open / non-manifold edges
  - pieces: triangles, bounding box, volume (each connected piece becomes its own body)
  - normal classes: horizontal / vertical / oblique triangles
  - horizontal face levels (z, area, up/down) and the distinct vertex z values (the height stack)
  - oblique slope classes (cone angles) and the Z-scale check they imply
  - a mirror-symmetry check about the bounding-box mid-planes (or the plane given by --mirror)

The other scripts import load_work(), tri_normals(), axis_frame() and cyl_coords() from here.
"""
import argparse, os, struct, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))


# ---------------------------------------------------------------- loading
def load_stl(path):
    """Binary or ASCII STL -> welded vertices V (n,3 float64) and triangles F (m,3 int)."""
    b = open(path, 'rb').read()
    n = struct.unpack('<I', b[80:84])[0] if len(b) >= 84 else -1
    if len(b) == 84 + 50 * n:
        a = np.frombuffer(b[84:84 + n * 50], dtype=np.dtype([('n', '<f4', 3), ('v', '<f4', (3, 3)), ('a', '<u2')]))
        tri = a['v'].astype(np.float64)
    else:                                   # ASCII
        txt = b.decode('ascii', 'replace').split()
        xyz = []
        for i in range(len(txt)):
            if txt[i] == 'vertex':
                xyz.append((float(txt[i + 1]), float(txt[i + 2]), float(txt[i + 3])))
        tri = np.array(xyz, dtype=np.float64).reshape(-1, 3, 3)
    flat = tri.reshape(-1, 3)
    # weld: the export repeats every vertex per triangle; float32 copies are bit-identical
    u, inv = np.unique(np.round(flat, 6), axis=0, return_inverse=True)
    F = inv.reshape(-1, 3)
    # drop degenerate triangles (two corners welded together)
    ok = (F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 2] != F[:, 0])
    return u, F[ok]


def tri_normals(V, F):
    """Unit normals and areas of the triangles."""
    P = V[F]
    N = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0])
    A = np.linalg.norm(N, axis=1)
    return N / np.where(A == 0, 1, A)[:, None], A / 2


def edge_pairs(F, nV):
    """Interior edges as (t1, t2, v0, v1) arrays plus counts of open and non-manifold edges."""
    E = np.sort(np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]]), axis=1)
    T = np.tile(np.arange(len(F)), 3)
    key = E[:, 0].astype(np.int64) * nV + E[:, 1]
    o = np.argsort(key, kind='stable'); key = key[o]; T = T[o]; E = E[o]
    _, start, cnt = np.unique(key, return_index=True, return_counts=True)
    two = cnt == 2
    s = start[two]
    return T[s], T[s + 1], E[s], int((cnt == 1).sum()), int((cnt > 2).sum())


def pieces_of(F, nV):
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components
    t1, t2, _, _, _ = edge_pairs(F, nV)
    g = coo_matrix((np.ones(len(t1)), (t1, t2)), shape=(len(F), len(F)))
    _, piece = connected_components(g, directed=False)
    return piece


def vertex_piece(F, piece, nV):
    vp = np.full(nV, -1)
    for k in range(3):
        vp[F[:, k]] = piece
    return vp


def load_work(data='data'):
    """V, F, piece from a work folder written by load.py."""
    V = np.load(os.path.join(data, 'V.npy')); F = np.load(os.path.join(data, 'F.npy'))
    p = os.path.join(data, 'piece.npy')
    piece = np.load(p) if os.path.exists(p) else pieces_of(F, len(V))
    return V, F, piece


# ---------------------------------------------------------------- axes
def axis_frame(spec):
    """'cx,cy' (axis parallel to Z through x=cx, y=cy) or 'px,py,pz,dx,dy,dz'.
    Returns (p0, d, e1, e2): a point, the unit direction and two unit vectors square to it.
    theta is measured from e1 towards e2; for a Z axis e1 = +X, e2 = +Y."""
    v = [float(x) for x in spec.split(',')]
    if len(v) == 2:
        p0 = np.array([v[0], v[1], 0.0]); d = np.array([0, 0, 1.0])
    elif len(v) == 6:
        p0 = np.array(v[:3]); d = np.array(v[3:]); d = d / np.linalg.norm(d)
    else:
        raise SystemExit('axis: give cx,cy or px,py,pz,dx,dy,dz')
    ref = np.array([1.0, 0, 0]) if abs(d[0]) < 0.9 else np.array([0, 1.0, 0])
    e1 = ref - (ref @ d) * d; e1 /= np.linalg.norm(e1); e2 = np.cross(d, e1)
    return p0, d, e1, e2


def cyl_coords(X, frame):
    """r (distance from the axis), h (position along it), theta (deg) of points X."""
    p0, d, e1, e2 = frame
    q = X - p0
    h = q @ d
    a, b = q @ e1, q @ e2
    return np.hypot(a, b), h, np.degrees(np.arctan2(b, a))


# ---------------------------------------------------------------- inventory
def signed_volume(V, F):
    P = V[F]
    return float(np.einsum('ij,ij->i', P[:, 0], np.cross(P[:, 1], P[:, 2])).sum() / 6)


def roundness(x, tol=1e-3):
    """The coarsest step of 10, 5, 1, 0.5, 0.25, 0.1, 0.05, 0.01 that x sits on (within tol)."""
    for g in (10, 5, 1, 0.5, 0.25, 0.1, 0.05, 0.01):
        if abs(x / g - round(x / g)) * g < tol:
            return g
    return None


def simple_fraction(k, qmax=20, tol=0.005):
    best = None
    for q in range(1, qmax + 1):
        p = round(k * q)
        if p and abs(p / q - k) / k < tol and (best is None or abs(p / q - k) < abs(best[0] / best[1] - k) - 1e-9):
            best = (p, q)
    return best


def inventory(V, F, piece, mirror=None):
    N, A = tri_normals(V, F)
    t1, t2, _, nopen, nmulti = edge_pairs(F, len(V))
    print(f'{len(V)} vertices, {len(F)} triangles; open edges {nopen}, non-manifold edges {nmulti}'
          + ('  -> closed' if nopen == 0 and nmulti == 0 else '  -> NOT closed'))
    npc = piece.max() + 1
    print(f'{npc} connected piece(s) (each becomes its own body):')
    tot = 0
    for p in range(npc):
        m = piece == p; vv = V[np.unique(F[m])]
        vol = signed_volume(V, F[m]); tot += vol
        print(f'  piece {p}: {m.sum():6d} tris  bbox {vv.min(0).round(4).tolist()} .. {vv.max(0).round(4).tolist()}  volume {vol:.3f}')
    print(f'  total volume {tot:.3f} mm^3 (the model should come out a little larger: facets lie inside convex curves)')

    nz = N[:, 2]
    hor = np.abs(nz) > 0.99999; ver = np.abs(nz) < 5e-3; obl = ~hor & ~ver
    print(f'normal classes: horizontal {hor.sum()} (up {(hor & (nz > 0)).sum()}, down {(hor & (nz < 0)).sum()}), '
          f'vertical {ver.sum()}, oblique {obl.sum()}  (vertical = |nz| < 0.005; float32 tilts short facets slightly)')

    P = V[F]
    zl = np.round(P[hor][:, :, 2].mean(1), 4)
    z0 = float(V[:, 2].min())
    print(f'horizontal face levels (z, area, up/down) - the design heights; base z0 = {z0:g}:')
    levels = []
    for z in np.unique(zl):
        m = zl == z
        up = int((m & (nz[hor] > 0)).sum()); dn = int((m & (nz[hor] < 0)).sum())
        print(f'  z {z:10.4f}  h {z - z0:9.4f}  area {A[hor][m].sum():10.3f}  up {up:5d} down {dn:5d}')
        levels.append(float(z))
    zs = np.unique(np.round(V[:, 2], 4))
    print(f'{len(zs)} distinct vertex z values' + (':' if len(zs) <= 60 else ' (first/last 30):'))
    print('  ', (zs if len(zs) <= 60 else np.r_[zs[:30], zs[-30:]]).tolist())

    # oblique classes: cones of one angle show up as one |nz| value
    print('oblique slope classes (area-weighted |nz|; facet normals overstate a cone slope by ~0.1-0.3 %;'
          ' segment.py / rz.py give the exact slope):')
    ks = []
    if obl.any():
        a = np.abs(nz[obl]); w = A[obl]
        key = np.round(a / 0.004).astype(int)
        shown = [kk for kk in np.unique(key) if not ((w[key == kk]).sum() < 1e-3 * A.sum() and (key == kk).sum() < 20)]
        # a round (fillet) is tessellated in strips at evenly spaced slopes, each with the same triangle
        # count: |nz| sin 5, sin 15, sin 25 ... 840 tris each. Those are not cones: no scale hint for them.
        from collections import Counter
        nt = Counter(int((key == kk).sum()) for kk in shown)
        for kk in shown:
            m = key == kk
            if nt[int(m.sum())] >= 3:
                c = float((a[m] * w[m]).sum() / w[m].sum())
                print(f'  |nz| {c:.4f}  {m.sum():6d} tris  area {w[m].sum():9.3f}  slope {np.degrees(np.arccos(c)):6.2f} deg'
                      f'   same count at {nt[int(m.sum())]} slopes: facet strips of a round or a helix, not a cone - no k')
                continue
            c = float((a[m] * w[m]).sum() / w[m].sum())
            alpha = np.degrees(np.arccos(c)); s = np.tan(np.radians(alpha))
            line = f'  |nz| {c:.4f}  {m.sum():6d} tris  area {w[m].sum():9.3f}  slope {alpha:6.2f} deg  dz/dr {s:.4f}'
            hints = []
            for beta in (30, 45, 60):
                k = s / np.tan(np.radians(beta))
                if 0.5 < k < 2 and abs(k - 1) > 0.003:
                    fr = simple_fraction(k)
                    hints.append(f'{beta} deg x k={k:.4f}' + (f' (~{fr[0]}/{fr[1]})' if fr else ''))
                    if fr: ks.append(fr)
                elif abs(k - 1) <= 0.003:
                    hints.append(f'= {beta} deg unscaled')
            print(line + ('   ' + '; '.join(hints) if hints else ''))
    else:
        print('  none')

    # Z-scale check: heights over z0, divided by each candidate k, should come out round
    hs = [z - z0 for z in levels if z - z0 > 1e-6]
    if hs:
        cands = [(1, 1)] + sorted(set(ks))
        print(f'Z-scale check: horizontal-face heights / k (round = sits on a coarse step; scale is ambiguous'
              f' from heights alone, so trust a k that cones AND heights agree on, then confirm with exact rings):')
        print('   k       ' + ' '.join(f'{h:9.4f}' for h in hs))
        for p, q in cands:
            k = p / q
            r = [roundness(h / k) for h in hs]
            score = np.mean([-np.log10(g) if g else 3 for g in r])
            print(f'  {p}/{q:<3d}   ' + ' '.join(f'{h / k:9.4f}' for h in hs) + f'   roughness {score:.2f}')

    symmetry(V, F, piece, mirror)


def symmetry(V, F, piece, mirror=None):
    from scipy.spatial import cKDTree
    sys.path.insert(0, HERE)
    from two_way import dist_to_mesh, settle
    vp = vertex_piece(F, piece, len(V))
    if mirror:
        ax, val = mirror.split('='); planes = [('xyz'.index(ax.strip()), float(val))]
    else:
        lo, hi = V.min(0), V.max(0)
        planes = [(i, (lo[i] + hi[i]) / 2) for i in range(3)]
    tree = cKDTree(V)
    print('mirror check (vertex = tessellation symmetric too; surface = geometry symmetric; '
          'surface <= chord sag with vertex > 0 means: model half, mirror in Python):')
    for i, c in planes:
        M = V.copy(); M[:, i] = 2 * c - M[:, i]
        dv, j = tree.query(M)
        ds = dist_to_mesh(M, V, F)
        if np.median(ds) > 0.05:
            print(f'  {"xyz"[i]} = {c:.5f}: not a mirror plane (median surface distance {np.median(ds):.3f})')
            continue
        s = np.where(ds > 0.01)[0]
        ds[s] = settle(M[s], ds[s], V, F)
        print(f'  {"xyz"[i]} = {c:.5f}: vertex max {dv.max():.5f} median {np.median(dv):.5f} | surface max {ds.max():.5f}'
              f' p99 {np.percentile(ds, 99):.5f}')
        if ds.max() < 0.05:
            maps = []
            for p in range(piece.max() + 1):
                m = vp == p
                tgt = np.bincount(vp[j[m]]).argmax()
                maps.append(f'{p}->{tgt}')
            print('     pieces map to: ' + ', '.join(maps))


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('stl')
    ap.add_argument('--data', default='data', help='work folder for V.npy, F.npy, piece.npy (default data)')
    ap.add_argument('--mirror', help='test this mirror plane only, e.g. y=105')
    a = ap.parse_args()
    os.makedirs(a.data, exist_ok=True)
    V, F = load_stl(a.stl)
    piece = pieces_of(F, len(V))
    np.save(os.path.join(a.data, 'V.npy'), V); np.save(os.path.join(a.data, 'F.npy'), F)
    np.save(os.path.join(a.data, 'piece.npy'), piece)
    inventory(V, F, piece, a.mirror)
