# SPDX-License-Identifier: AGPL-3.0-only
"""Plot plan sections at several heights, one colour per mesh piece - to see the part before reading it.

    python slice.py 5.3,8,13 [--plane z] [--box u0,v0,u1,v1] [--out data/slices.png] [--data data]

Sheet coordinates as ScanRuler's world planes: z -> (X, Y); x -> (Y, Z); y -> (Z, X).
Open the PNG with the Read tool. Exact numbers come from profile.py, not from the picture.
"""
import argparse, os, sys
import numpy as np
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from load import load_work
from profile import slice_segments, PLANES

if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('at', help='offsets, comma separated')
    ap.add_argument('--plane', default='z', choices='xyz')
    ap.add_argument('--box')
    ap.add_argument('--out')
    ap.add_argument('--data', default='data')
    a = ap.parse_args()
    V, F, piece = load_work(a.data)
    offs = [float(z) for z in a.at.split(',')]
    box = [float(x) for x in a.box.split(',')] if a.box else None
    _, ui, vi = PLANES[a.plane]
    n = len(offs); cols = min(n, 3); rows = (n + cols - 1) // cols
    fig, axs = plt.subplots(rows, cols, figsize=(6 * cols, 4.5 * rows), squeeze=False)
    cmap = plt.get_cmap('tab10')
    for k, z in enumerate(offs):
        ax = axs[k // cols][k % cols]
        s, pc, _ = slice_segments(V, F, piece, a.plane, z)
        for p in np.unique(pc):
            for A, B in s[pc == p]:
                ax.plot([A[ui], B[ui]], [A[vi], B[vi]], color=cmap(p % 10), lw=0.8)
        ax.set_aspect('equal'); ax.set_title(f'{a.plane} = {z}'); ax.grid(True, lw=0.3)
        if box:
            ax.set_xlim(box[0], box[2]); ax.set_ylim(box[1], box[3])
    for k in range(n, rows * cols):
        axs[k // cols][k % cols].axis('off')
    out = a.out or os.path.join(a.data, 'slices.png')
    plt.tight_layout(); plt.savefig(out, dpi=90)
    print('wrote', out)
