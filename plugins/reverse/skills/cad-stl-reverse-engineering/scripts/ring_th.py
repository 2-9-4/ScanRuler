# SPDX-License-Identifier: AGPL-3.0-only
"""Angular extent of single vertex rings: where a partial revolve starts and stops, where a chamfer
cone is trimmed by neighbouring planes.

    python ring_th.py --axis 125.70135,105 17.85,6.43 11.4,16.44,0 [--tol 2e-3] [--gap 4] [--data data]

Each ring is r,h or r,h,piece (h = position along the axis; z for a Z axis). Prints the runs of the ring's
vertex angles (deg, from +X for a Z axis) and the tessellation step. A run that stops short of a full turn
is a partial revolve (its ends are the revolve's start/stop angles) or a face trimmed by another feature.
"""
import argparse, os, sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from load import load_work, axis_frame, cyl_coords, vertex_piece
from rz import runs

if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--axis', required=True)
    ap.add_argument('rings', nargs='+', help='r,h or r,h,piece')
    ap.add_argument('--tol', type=float, default=2e-3, help='how far a vertex may be off r and h')
    ap.add_argument('--gap', type=float, default=4.0, help='angular gap (deg) that ends a run')
    ap.add_argument('--data', default='data')
    a = ap.parse_args()
    V, F, piece = load_work(a.data)
    vp = vertex_piece(F, piece, len(V))
    r, h, th = cyl_coords(V, axis_frame(a.axis))
    for spec in a.rings:
        v = [float(x) for x in spec.split(',')]
        m = (np.abs(r - v[0]) < a.tol) & (np.abs(h - v[1]) < a.tol)
        if len(v) > 2:
            m &= vp == int(v[2])
        t = np.sort(th[m])
        if not len(t):
            print(f'r={v[0]} h={v[1]}: no vertices'); continue
        rr = runs(t, a.gap)
        step = np.median(np.diff(t)) if len(t) > 1 else None
        print(f'r={v[0]} h={v[1]}' + (f' piece {int(v[2])}' if len(v) > 2 else '') + f': n={m.sum()} runs '
              + ('full turn' if rr == [(-180.0, 180.0)] else str([(round(s, 3), round(e, 3)) for s, e in rr]))
              + (f'  step {step:.3f} deg' if step is not None else ''))
