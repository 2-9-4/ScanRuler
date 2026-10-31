# SPDX-License-Identifier: AGPL-3.0-only
"""Plot radial sections through an axis: the revolve profile, seen at several angles.

    python vslice.py --axis 125.70135,105 --angles 0,90,180 --rmax 25 [--out data/vslice.png] [--data data]

Each panel cuts the mesh with the plane that holds the axis and the direction at that angle (deg, from
+X for a Z axis): u = signed distance from the axis along that direction, h = position along the axis.
Use it to see a revolve profile, a chamfer, a clearance between mating parts. The cut through a cone
lands on chords between vertex rings, so read the numbers with rz.py, not from this picture.
"""
import argparse, os, sys
import numpy as np
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from load import load_work, axis_frame


def slice_plane(V, F, piece, o, n):
    d = (V - o) @ n; neg = d < 0
    segs, pcs = [], []
    for i in np.where(neg[F].any(1) & ~neg[F].all(1))[0]:
        f = F[i]; pts = []
        for p, q in ((f[0], f[1]), (f[1], f[2]), (f[2], f[0])):
            if neg[p] != neg[q]:
                t = d[p] / (d[p] - d[q]); pts.append(V[p] + t * (V[q] - V[p]))
        if len(pts) == 2:
            segs.append(pts); pcs.append(piece[i])
    return np.array(segs).reshape(-1, 2, 3), np.array(pcs, int)


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--axis', required=True, help='cx,cy (Z axis) or px,py,pz,dx,dy,dz')
    ap.add_argument('--angles', default='0,90')
    ap.add_argument('--rmax', type=float, help='half-width of the plot; default: the farthest vertex from the axis')
    ap.add_argument('--out')
    ap.add_argument('--data', default='data')
    a = ap.parse_args()
    V, F, piece = load_work(a.data)
    p0, d, e1, e2 = axis_frame(a.axis)
    if a.rmax is None:                       # a fixed default clipped parts wider than it
        q = V - p0
        a.rmax = 1.05 * float(np.linalg.norm(q - np.outer(q @ d, d), axis=1).max())
    angs = [float(x) for x in a.angles.split(',')]
    fig, axs = plt.subplots(len(angs), 1, figsize=(12, 2.8 * len(angs)), squeeze=False)
    cmap = plt.get_cmap('tab10')
    for k, ang in enumerate(angs):
        u = np.cos(np.radians(ang)) * e1 + np.sin(np.radians(ang)) * e2
        s, pc = slice_plane(V, F, piece, p0, np.cross(d, u))
        ax = axs[k][0]
        for A, B in zip(s, pc):
            ua, ub = (A[0] - p0) @ u, (A[1] - p0) @ u
            if abs(ua) <= a.rmax or abs(ub) <= a.rmax:
                ax.plot([ua, ub], [(A[0] - p0) @ d, (A[1] - p0) @ d], color=cmap(B % 10), lw=0.8)
        ax.set_xlim(-a.rmax, a.rmax); ax.set_aspect('equal'); ax.grid(True, lw=0.3)
        ax.set_title(f'section through the axis at {ang:g} deg (u along that direction, h along the axis)')
    out = a.out or os.path.join(a.data, 'vslice.png')
    plt.tight_layout(); plt.savefig(out, dpi=80)
    print('wrote', out)
