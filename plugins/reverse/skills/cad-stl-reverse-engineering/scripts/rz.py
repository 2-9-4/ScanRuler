# SPDX-License-Identifier: AGPL-3.0-only
"""Revolve profiles read exactly: the vertex rings about an axis.

    python rz.py --axis 125.70135,105 [--rmax 25] [--pieces 3] [--min 4] [--dec 3] [--data data]
    python rz.py --axis px,py,pz,dx,dy,dz ...        (an axis not parallel to Z)

A revolved CAD face is tessellated as rings of vertices at its profile corners. Clustering the vertices
by (round(r, dec), round(h, dec)) with >= --min members lists every ring; the rings sorted by h and r
ARE the revolve profile (r = radius, h = position along the axis; h = z for a Z axis). Each ring also
gets its angular runs (where a partial revolve starts and stops, and which planes trim a chamfer cone):
see ring_th.py for one ring in detail. Exact slopes: (h2 - h1) / (r2 - r1) between two rings of one cone.
Get the axis from segment.py (cylinder/cone centre) and refine it with centers.py.
"""
import argparse, os, sys
from collections import defaultdict
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from load import load_work, axis_frame, cyl_coords, vertex_piece


def runs(th, gap):
    """Angular runs of a set of angles (deg), wrapping at +-180."""
    a = np.sort(th)
    if len(a) < 2:
        return [(float(a[0]), float(a[0]))] if len(a) else []
    d = np.diff(np.r_[a, a[0] + 360])
    br = np.where(d > gap)[0]
    if len(br) == 0:
        return [(-180.0, 180.0)]
    out = []
    for k in range(len(br)):
        s = (br[k] + 1) % len(a); e = br[(k + 1) % len(br)]
        out.append((float(a[s]), float(a[e])))
    return out


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--axis', required=True)
    ap.add_argument('--rmax', type=float, default=1e9, help='only vertices within this radius')
    ap.add_argument('--pieces', help='mesh pieces, e.g. 0,3 (default all)')
    ap.add_argument('--min', type=int, default=4, help='vertices a ring needs')
    ap.add_argument('--dec', type=int, default=3, help='decimals r and h are clustered at')
    ap.add_argument('--gap', type=float, default=4.0, help='angular gap (deg) that splits a ring into runs')
    ap.add_argument('--data', default='data')
    a = ap.parse_args()
    V, F, piece = load_work(a.data)
    vp = vertex_piece(F, piece, len(V))
    r, h, th = cyl_coords(V, axis_frame(a.axis))
    pcs = [int(p) for p in a.pieces.split(',')] if a.pieces else sorted(set(vp.tolist()))
    for p in pcs:
        m = (vp == p) & (r < a.rmax)
        d = defaultdict(list)
        for ri, hi, t in zip(np.round(r[m], a.dec), np.round(h[m], a.dec), th[m]):
            d[(ri, hi)].append(t)
        rows = sorted(((k, v) for k, v in d.items() if len(v) >= a.min), key=lambda x: (x[0][1], x[0][0]))
        print(f'piece {p}: {len(rows)} rings (r, h) with >= {a.min} vertices, their angular runs (deg):')
        for (ri, hi), v in rows:
            rr = runs(np.array(v), a.gap)
            if rr == [(-180.0, 180.0)]:
                txt = 'full'
            elif len(rr) > 6:                # a pattern (grooves, ribs): one line, not every run
                st = np.array([s_ for s_, e_ in rr]); wd = np.array([(e_ - s_) % 360 for s_, e_ in rr])
                sp = np.diff(np.sort(st)); sp = sp[sp > 1e-6]
                txt = (f'{len(rr)} runs, {wd.min():.1f}..{wd.max():.1f} deg wide, spacing '
                       f'{(np.median(sp) if len(sp) else 0):.2f} deg, first at {np.sort(st)[0]:.1f}')
            else:
                txt = ' '.join(f'{s:.1f}..{e:.1f}' for s, e in rr)
            print(f'  r={ri:9.{a.dec}f} h={hi:9.{a.dec}f} n={len(v):4d}  {txt}')
