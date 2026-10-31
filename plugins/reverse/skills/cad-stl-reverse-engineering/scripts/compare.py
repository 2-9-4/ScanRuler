# SPDX-License-Identifier: AGPL-3.0-only
"""Where a rebuilt model differs from the STL: material it has that the mesh has not (extra) and the
mesh has that it has not (missing), as volumes and as clusters located in space.

    python compare.py part.stl model.stl [--grid 0.1] [--min 0.05] [--top 15]

Both meshes are cut by rays along each world axis on a grid of `grid` mm; each ray's inside
intervals come from the hits' parity, so the comparison needs no boolean and does not care how
either mesh is triangulated. A voxel is in error when the rays of at least two of the three axes
say so (one axis alone can graze a wall that lies along it). Clusters of error voxels are listed
by volume with their box and the faces of the STL beside them - each one is a feature missing,
extra, or misplaced. Below `min` mm^3 a cluster is the tessellation's own difference (facets lie
inside convex curves) and is only counted.

Run it after each major build step (reverse.export.stl { chord: 0.005, path } first): it says
what is still to do, in volume and place, as two_way.py says it in distance.
"""
import argparse, os, sys
import numpy as np
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cadlib import load_stl, volume


def ray_intervals(V, F, axis, g0, step, shape):
    """For rays along `axis` through the grid (origin g0, spacing step, shape over the two other
    axes), the hits per ray as (coordinate, +1 entering / -1 leaving). Returns a list (per ray,
    flat index) of lists."""
    j = axis; u, v = [k for k in range(3) if k != j]
    P = V[F]
    Nj = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0])[:, j]
    hits = [[] for _ in range(shape[0] * shape[1])]
    # rays at cell centres, nudged off any grid-aligned edge
    for t in range(len(F)):
        p = P[t]
        A = p[:, [u, v]]
        lo = np.floor((A.min(0) - g0) / step - 0.5).astype(int)
        hi = np.ceil((A.max(0) - g0) / step - 0.5).astype(int)
        lo = np.maximum(lo, 0); hi = np.minimum(hi, np.array(shape) - 1)
        if (hi < lo).any():
            continue
        iu = np.arange(lo[0], hi[0] + 1); iv = np.arange(lo[1], hi[1] + 1)
        GU, GV = np.meshgrid(iu, iv, indexing='ij')
        X = g0[0] + (GU + 0.5) * step + 1.3e-7
        Y = g0[1] + (GV + 0.5) * step + 0.7e-7
        a, b, c = A
        d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(d) < 1e-18:
            continue
        l1 = ((b[1] - c[1]) * (X - c[0]) + (c[0] - b[0]) * (Y - c[1])) / d
        l2 = ((c[1] - a[1]) * (X - c[0]) + (a[0] - c[0]) * (Y - c[1])) / d
        l3 = 1 - l1 - l2
        m = (l1 >= 0) & (l2 >= 0) & (l3 >= 0)
        if not m.any():
            continue
        z = l1[m] * p[0, j] + l2[m] * p[1, j] + l3[m] * p[2, j]
        s = 1 if Nj[t] < 0 else -1
        for ru, rv, zz in zip(GU[m], GV[m], z):
            hits[ru * shape[1] + rv].append((zz, s))
    return hits


def occupancy(V, F, lo, step, dims):
    """Inside/outside of every voxel, by rays along each axis: (3, nx, ny, nz) booleans."""
    occ = np.zeros((3,) + tuple(dims), bool)
    for j in range(3):
        u, v = [k for k in range(3) if k != j]
        shape = (dims[u], dims[v])
        hits = ray_intervals(V, F, j, np.array([lo[u], lo[v]]), step, shape)
        cz = lo[j] + (np.arange(dims[j]) + 0.5) * step
        for ru in range(shape[0]):
            for rv in range(shape[1]):
                h = hits[ru * shape[1] + rv]
                if len(h) < 2:
                    continue
                h.sort()
                z = np.array([a for a, _ in h]); s = np.array([b for _, b in h])
                # a shared edge is hit twice at one point by the same side: count it once; two
                # solids touching along a face (a bearing's rings and shields) are hit at one point
                # leaving one and entering the other, and both count
                keep = np.r_[True, (np.diff(z) > 1e-9) | (s[1:] != s[:-1])]
                z, s = z[keep], s[keep]
                w = np.cumsum(s)
                inside = np.zeros(dims[j], bool)
                if w[-1] == 0 and w.min() >= 0:
                    for k in np.flatnonzero(w[:-1] > 0):
                        inside |= (cz > z[k]) & (cz < z[k + 1])
                else:       # facets wound the wrong way, or the ray grazed an edge: parity
                    z = z[np.r_[True, np.diff(z) > 1e-9]]
                    if len(z) % 2:
                        z = z[:-1]
                    for a, b in zip(z[0::2], z[1::2]):
                        inside |= (cz > a) & (cz < b)
                idx = [slice(None)] * 3
                idx[u] = ru; idx[v] = rv
                occ[j][tuple(idx)] = inside
    return occ


def section_segments(V, F, j, h):
    """Segments of the cut of a mesh by the plane x_j = h, as (k, 2, 3)."""
    d = V[:, j] - h
    s = np.sign(d)
    P = V[F]; D = d[F]
    out = []
    for t in np.where((s[F].min(1) < 0) & (s[F].max(1) > 0))[0]:
        pts = []
        for a, b in ((0, 1), (1, 2), (2, 0)):
            if (D[t, a] < 0) != (D[t, b] < 0):
                u = D[t, a] / (D[t, a] - D[t, b])
                pts.append(P[t, a] + u * (P[t, b] - P[t, a]))
        if len(pts) == 2:
            out.append(pts)
    return np.array(out).reshape(-1, 2, 3)


def plot_clusters(path, Vm, Fm, Vb, Fb, clusters):
    """For each cluster (name, centre, box), sections of the mesh (grey) and the model (red,
    dashed) through its centre square to X, Y and Z, framed on its box."""
    import matplotlib; matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    n = len(clusters)
    fig, axs = plt.subplots(n, 3, figsize=(15, 5 * n), squeeze=False)
    names = 'XYZ'
    for r, (title, cen, b0, b1) in enumerate(clusters):
        pad = max(1.0, 0.3 * float(np.max(b1 - b0)))
        for j in range(3):
            A = axs[r][j]
            u, v = [k for k in range(3) if k != j]
            for V, F, kw in ((Vm, Fm, dict(color='0.55', lw=2.5)), (Vb, Fb, dict(color='red', lw=1, ls='--'))):
                S = section_segments(V, F, j, cen[j] + 1.1e-6)
                for sg in S:
                    if (np.all(sg[:, [u, v]] >= np.array([b0[u], b0[v]]) - pad - 2) and
                            np.all(sg[:, [u, v]] <= np.array([b1[u], b1[v]]) + pad + 2)):
                        A.plot(sg[:, u], sg[:, v], **kw)
            A.set_xlim(b0[u] - pad, b1[u] + pad); A.set_ylim(b0[v] - pad, b1[v] + pad)
            A.set_aspect('equal'); A.set_xlabel(names[u]); A.set_ylabel(names[v])
            A.set_title(f'{title}: {names[j]} = {cen[j]:.3f}')
    plt.tight_layout(); plt.savefig(path, dpi=55)


UVI = {'z': (0, 1), 'x': (1, 2), 'y': (2, 0)}


def suggest(name, b0, b1, C, N, A, a, margin=0.6):
    """A trim (extra material) or fill (missing material) along the axis the mesh's walls round a
    cluster run along: the faces within its box, by area, square to each axis."""
    near = np.all((C >= b0 - margin) & (C <= b1 + margin), axis=1)
    if not near.any():
        return None
    votes = {}
    for j, ax in enumerate('xyz'):
        votes[ax] = float(A[near][np.abs(N[near][:, j]) < 0.01].sum())
    ax = max(votes, key=votes.get)
    j = 'xyz'.index(ax)
    why = 'walls along ' + ', '.join(f'{k} {v:.1f}' for k, v in sorted(votes.items(), key=lambda kv: -kv[1])) + ' mm^2'
    if ax == a.main:
        others = {k: v for k, v in votes.items() if k != a.main}
        alt = max(others, key=others.get)
        if others[alt] < 0.5 * votes[ax]:
            print(f'      (along the main axis {ax}: a slab of the main build to look at - {why})')
            return None
        ax, j = alt, 'xyz'.index(alt)
    ui, vi = UVI[ax]
    lo, hi = b0 - margin, b1 + margin
    mode = '--trim' if name.startswith('EXTRA') else '--fill'
    args = ['--axis', ax, f'--from={lo[j]:.4f}', f'--to={hi[j]:.4f}',
            f'--box={lo[ui]:.4f},{lo[vi]:.4f},{hi[ui]:.4f},{hi[vi]:.4f}', mode, a.body]
    return dict(args=args, why=why, mode=mode[2:], axis=ax)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('mesh'); ap.add_argument('model')
    ap.add_argument('--grid', type=float, default=0.1)
    ap.add_argument('--min', type=float, default=0.05, help='smallest cluster to list, mm^3')
    ap.add_argument('--top', type=int, default=15)
    ap.add_argument('--faces', help='data/faces.pkl of the mesh, to name the faces beside each cluster')
    ap.add_argument('--plot', help='PNG: sections of mesh (grey) and model (red) through the largest clusters')
    ap.add_argument('--plot-top', type=int, default=4, help='how many clusters of each kind --plot shows')
    ap.add_argument('--suggest', help='JSON: for each cluster of --suggest-min mm^3 or more, the slabs.py trim (extra) or '
                    'fill (missing) along the axis the mesh walls round it run along')
    ap.add_argument('--suggest-min', type=float, default=2.0)
    ap.add_argument('--main', default='z', help='the axis the body was built along (a cluster along it is reported, not suggested)')
    ap.add_argument('--body', default='Z slab 0')
    a = ap.parse_args()
    Vm, Fm = load_stl(a.mesh); Vb, Fb = load_stl(a.model)
    lo = np.minimum(Vm.min(0), Vb.min(0)) - 2 * a.grid
    hi = np.maximum(Vm.max(0), Vb.max(0)) + 2 * a.grid
    dims = np.ceil((hi - lo) / a.grid).astype(int)
    cells = int(np.prod(dims))
    if cells > 6e7:
        g = float(np.cbrt(np.prod(hi - lo) / 6e7))
        print(f'grid {a.grid} would make {cells:.2e} voxels: using {g:.3f}')
        a.grid = g; dims = np.ceil((hi - lo) / a.grid).astype(int)
    om = occupancy(Vm, Fm, lo, a.grid, dims)
    ob = occupancy(Vb, Fb, lo, a.grid, dims)
    vox = a.grid ** 3
    inm = om.sum(0) >= 2; inb = ob.sum(0) >= 2
    extra = (ob & ~om).sum(0) >= 2
    missing = (om & ~ob).sum(0) >= 2
    vm, vb = volume(Vm, Fm), volume(Vb, Fb)
    from cadlib import edges_of
    ob_open = edges_of(Fb, len(Vb))[3]
    print(f'volume: mesh {vm:.3f}  model {vb:.3f}  ({100 * (vb - vm) / vm:+.3f} %)'
          + (f'  - the model mesh has {ob_open} open edges (faces meshed apart along an edge): its volume is'
             ' only roughly right; the body volume and the difference below hold' if ob_open else ''))
    print(f'difference on a {a.grid:g} mm grid: extra {extra.sum() * vox:.3f} mm^3, missing {missing.sum() * vox:.3f} mm^3 '
          f'= {100 * (extra.sum() + missing.sum()) * vox / vm:.3f} % of the mesh')
    fs = None
    if a.faces:
        import pickle
        fs = pickle.load(open(a.faces, 'rb'))
        from scipy.spatial import cKDTree
        C = fs.V[fs.F].mean(1); tree = cKDTree(C)
    shown = []; suggestions = []
    Cm = Vm[Fm].mean(1)
    Nm = np.cross(Vm[Fm][:, 1] - Vm[Fm][:, 0], Vm[Fm][:, 2] - Vm[Fm][:, 0]); Am = np.linalg.norm(Nm, axis=1); Nm = Nm / np.maximum(Am, 1e-30)[:, None]
    for name, E in (('EXTRA (model has, mesh not)', extra), ('MISSING (mesh has, model not)', missing)):
        lab, n = ndimage.label(E, structure=np.ones((3, 3, 3)))
        if n == 0:
            print(f'{name}: none'); continue
        sizes = ndimage.sum(E, lab, index=np.arange(1, n + 1)) * vox
        order = np.argsort(-sizes)
        small = sizes[sizes < a.min]
        print(f'{name}: {n} clusters, {int((sizes >= a.min).sum())} of {a.min:g} mm^3 or more'
              f' ({len(small)} smaller, {small.sum():.3f} mm^3 in all)')
        objs = ndimage.find_objects(lab)
        for rank, k in enumerate(order):
            if sizes[k] < min(a.min, a.suggest_min if a.suggest else a.min):
                break
            listed = rank < a.top and sizes[k] >= a.min
            sl = objs[k]
            b0 = lo + np.array([s.start for s in sl]) * a.grid
            b1 = lo + np.array([s.stop for s in sl]) * a.grid
            idx = np.argwhere(lab[sl] == k + 1) + np.array([s.start for s in sl])
            cen = lo + (idx.mean(0) + 0.5) * a.grid
            thick = sizes[k] / max(len(idx) ** (2 / 3) * a.grid ** 2, 1e-9)
            line = f'  {sizes[k]:9.3f} mm^3  box {np.round(b0, 2).tolist()}..{np.round(b1, 2).tolist()}  centre {np.round(cen, 2).tolist()}'
            if fs is not None:
                pts = lo + (idx[:: max(1, len(idx) // 200)] + 0.5) * a.grid
                _, ti = tree.query(pts)
                fids, cnt = np.unique(fs.fid[ti], return_counts=True)
                o = np.argsort(-cnt)[:4]
                line += '  faces ' + ', '.join(f'{int(fids[i])}:{fs.prims[int(fids[i])]["kind"]}' for i in o)
            if listed:
                print(line)
            if a.suggest and sizes[k] >= a.suggest_min and sizes[k] >= 0.05 * float(np.prod(b1 - b0)):
                # a cluster filling little of its box is a film of leftovers along many faces, no
                # one feature
                sg = suggest(name, b0, b1, Cm, Nm, Am, a)
                if sg:
                    suggestions.append(sg)
            if listed and len([x for x in shown if x[0].startswith(name[:5])]) < a.plot_top:
                shown.append((f'{name[:5].lower()} {sizes[k]:.2f} mm3', cen, b0, b1))
    if a.suggest:
        import json
        json.dump(suggestions, open(a.suggest, 'w'), indent=1)
        print(f'suggest: {len(suggestions)} trims/fills -> {a.suggest}')
        for sg in suggestions:
            print('   ' + ' '.join(sg['args']) + f"   ({sg['why']})")
    if a.plot and shown:
        plot_clusters(a.plot, Vm, Fm, Vb, Fb, shown)
        print('plot', a.plot)


if __name__ == '__main__':
    main()
