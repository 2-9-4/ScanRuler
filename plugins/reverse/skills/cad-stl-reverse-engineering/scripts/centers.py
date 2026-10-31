# SPDX-License-Identifier: AGPL-3.0-only
"""Exact centres: least-squares circle on a vertex ring (residual ~1e-5 mm on a CAD export).

    python centers.py --axis 125.7013,105 6,8.9 3.75,5 [--piece 3] [--rtol 0.01] [--htol 1e-3] [--data data]

--axis is the rough axis (cx,cy for a Z axis, or px,py,pz,dx,dy,dz); each ring is r,h with h the position
along it. Prints per ring: vertex count, the exact centre (world coordinates), radius and max residual.
With two or more rings at different h it also prints the axis through their centres and its tilt
from the rough axis: a tilt of ~1e-6 rad confirms the axis is the world axis.
Use it for every axis you will sketch on: hub, pins, holes, pads, bolt circles.
"""
import argparse, os, sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from load import load_work, axis_frame, cyl_coords, vertex_piece


def ringfit(V, frame, r0, h0, rtol=0.01, htol=1e-3, mask=None):
    p0, d, e1, e2 = frame
    r, h, _ = cyl_coords(V, frame)
    m = (np.abs(r - r0) < rtol) & (np.abs(h - h0) < htol)
    if mask is not None:
        m &= mask
    if m.sum() < 3:
        return None
    q = V[m] - p0
    x, y = q @ e1, q @ e2
    A = np.c_[2 * x, 2 * y, np.ones_like(x)]
    s, *_ = np.linalg.lstsq(A, x * x + y * y, rcond=None)
    R = np.sqrt(s[2] + s[0] ** 2 + s[1] ** 2)
    res = np.abs(np.hypot(x - s[0], y - s[1]) - R).max()
    c = p0 + s[0] * e1 + s[1] * e2 + np.mean(q @ d) * d
    return c, R, res, int(m.sum())


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--axis', required=True)
    ap.add_argument('rings', nargs='+', help='r,h')
    ap.add_argument('--piece', type=int)
    ap.add_argument('--rtol', type=float, default=0.01)
    ap.add_argument('--htol', type=float, default=1e-3)
    ap.add_argument('--data', default='data')
    a = ap.parse_args()
    V, F, piece = load_work(a.data)
    fr = axis_frame(a.axis)
    mask = vertex_piece(F, piece, len(V)) == a.piece if a.piece is not None else None
    cs = []
    for spec in a.rings:
        r0, h0 = [float(x) for x in spec.split(',')]
        out = ringfit(V, fr, r0, h0, a.rtol, a.htol, mask)
        if out is None:
            print(f'r={r0} h={h0}: fewer than 3 vertices'); continue
        c, R, res, n = out
        rn = round(R, 3)
        print(f'r={r0:<8g} h={h0:<9g} n={n:4d}  c=({c[0]:.6f}, {c[1]:.6f}, {c[2]:.6f})  R={R:.6f}'
              + (f' (= {rn:g})' if abs(R - rn) < 1e-4 else '') + f'  maxres={res:.1e}')
        cs.append(c)
    if len(cs) >= 2:
        d = cs[-1] - cs[0]
        if np.linalg.norm(d) > 1e-3:
            d /= np.linalg.norm(d)
            if d @ fr[1] < 0: d = -d
            print(f'axis through the centres: dir {np.round(d, 7).tolist()}, tilt from --axis '
                  f'{np.arccos(np.clip(d @ fr[1], -1, 1)):.2e} rad')
