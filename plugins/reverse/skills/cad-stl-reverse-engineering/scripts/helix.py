# SPDX-License-Identifier: AGPL-3.0-only
"""Threads and coils read exactly: pitch, hand, starts, the thread profile and where it starts and stops.

    python helix.py --axis 68.508,109.118 --pieces 0 --h 21.9,34.6 --r 20.4,22.1 [--pitch 4] [--data data]

A CAD thread is a profile swept along a helix. Its vertices lie on helical edges (crest and root
corners) and, unrolled with the right pitch p and hand, collapse onto the profile: for a vertex at
(r, h, theta), u = (h - s * p * theta / 360) mod p (s = +1 right hand, -1 left hand) is its position
in the profile, the same for every turn. Clustering (round(r, 3), round(u, 3)) then lists the profile
corners exactly, as rz.py does for a plain revolve.

Without --pitch the script finds it: it tries pitches from --pmin to --pmax for both hands and keeps
the one that collapses the most-populated helical radius (the crest or root edge) onto the fewest u
values, then refines p by least squares. A multi-start thread shows as n crest clusters p/n apart.

Per profile corner it prints the unwrapped angle phi (deg, 0 at theta = 0 on the turn whose u is the
corner's) at which the helical edge starts and stops: the thread's start and end, its number of turns,
and so the angleDeg of a coiled revolve (reverse_feature_add revolve { pitch, angleDeg }). Vertices
in the band that lie on no helix (plain cylinders at the root radius, run-out cones) are listed apart
by h, so you can see where the thread runs into plain faces.
"""
import argparse, os, sys
from collections import defaultdict
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from load import load_work, axis_frame, cyl_coords, vertex_piece


def spread(u, p, dec=3):
    return len(np.unique(np.round(np.mod(u, p), dec) % round(p, dec)))


def occupancy(u, p, w=0.01):
    """Share of the w-wide bins of [0, p) that the unrolled u fall into: small only at the true pitch
    (a raw count of distinct values favours tiny pitches, which have few bins to fill)."""
    b = np.floor(np.mod(u, p) / w).astype(int)
    return len(np.unique(b)) / max(1.0, np.ceil(p / w))


def find_pitch(th, h, pmin, pmax, step=5e-4):
    best = None
    for s in (1, -1):
        for p in np.arange(pmin, pmax, step):
            n = occupancy(h - s * p * th / 360.0, p)
            if best is None or n < best[0]:
                best = (n, p, s)
    return best


def refine(th, h, p, s):
    """Least-squares p and offset from vertices on one helical edge family."""
    u = np.mod(h - s * p * th / 360.0, p)
    u0 = np.median(u)
    # turn index of every vertex, then fit h = u0 + s*p*(theta/360 + n)
    n = np.round((h - s * p * th / 360.0 - u0) / p)
    t = th / 360.0 + s * n                      # turns
    A = np.c_[np.ones_like(t), s * t]
    sol, *_ = np.linalg.lstsq(A, h, rcond=None)
    res = np.abs(A @ sol - h).max()
    return sol[1], sol[0], res


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--axis', required=True, help='cx,cy (Z axis) or px,py,pz,dx,dy,dz')
    ap.add_argument('--pieces', help='mesh pieces, e.g. 0 (default all)')
    ap.add_argument('--h', help='h range of the thread, h0,h1')
    ap.add_argument('--r', help='r range of the thread (root to crest, a little wider), r0,r1')
    ap.add_argument('--pitch', type=float, help='known pitch (skips the search)')
    ap.add_argument('--hand', choices=['right', 'left'], help='known hand (with --pitch)')
    ap.add_argument('--pmin', type=float, default=0.5)
    ap.add_argument('--pmax', type=float, default=8.0)
    ap.add_argument('--min', type=int, default=4, help='vertices a profile corner needs')
    ap.add_argument('--data', default='data')
    a = ap.parse_args()

    V, F, piece = load_work(a.data)
    vp = vertex_piece(F, piece, len(V))
    fr = axis_frame(a.axis)
    r, h, th = cyl_coords(V, fr)
    m = np.ones(len(V), bool)
    if a.pieces:
        m &= np.isin(vp, [int(x) for x in a.pieces.split(',')])
    if a.h:
        h0, h1 = map(float, a.h.split(',')); m &= (h >= h0) & (h <= h1)
    if a.r:
        r0, r1 = map(float, a.r.split(',')); m &= (r >= r0) & (r <= r1)
    idx = np.where(m)[0]
    if len(idx) == 0:
        raise SystemExit('no vertices in that band')
    R, H, T = r[idx], h[idx], th[idx]

    # radii that carry many vertices: the crest/root helices and plain cylinders
    rr = np.round(R, 3)
    ur, cnt = np.unique(rr, return_counts=True)
    big = ur[cnt >= max(20, len(R) // 50)]
    print(f'{len(R)} vertices in the band; populous radii:', ', '.join(f'{x:g} ({c})' for x, c in zip(ur, cnt) if x in big))

    # the helical edges (crest / root corners) are populous radii whose vertices span many heights.
    # Search the pitch on each and keep the one that collapses best; plain rings on the same radius
    # (a cylinder's end circle) only add a few stray bins.
    cands = [x for x in big if len(np.unique(np.round(H[rr == x], 3))) > 8]
    if a.pitch:
        p, s = a.pitch, (-1 if a.hand == 'left' else 1)
        if not a.hand and cands:
            occ = {sg: min(occupancy(H[rr == x] - sg * p * T[rr == x] / 360, p) for x in cands) for sg in (1, -1)}
            s = 1 if occ[1] <= occ[-1] else -1
        fam = min(cands, key=lambda x: occupancy(H[rr == x] - s * p * T[rr == x] / 360, p)) if cands else None
    else:
        if not cands:
            raise SystemExit('no helical edge found (no populous radius with many heights): not a thread?')
        best = None
        for x in cands:
            s_ = rr == x
            n, p_, s_g = find_pitch(T[s_], H[s_], a.pmin, a.pmax)
            print(f'  pitch search on r = {x:g} ({s_.sum()} vertices): p ~ {p_:.4f}, '
                  f'{"right" if s_g > 0 else "left"} hand, {n:.4f} of the u bins filled')
            if best is None or n < best[0]:
                best = (n, p_, s_g, x)
        _, p, s, fam = best
    if fam is not None:
        s_ = rr == fam
        u_f = np.mod(H[s_] - s * p * T[s_] / 360.0, p)
        # the edge's own u: the most populated 0.01 bin (stray plain-ring vertices spread thin)
        b = np.floor(u_f / 0.01).astype(int)
        bv, bc = np.unique(b, return_counts=True)
        top = bv[np.argmax(bc)]
        sel = np.abs(b - top) <= 1
        p2, u0, res = refine(T[s_][sel], H[s_][sel], p, s)
        print(f'refined on {sel.sum()} of {s_.sum()} vertices of the helical edge at r = {fam:g}: pitch {p2:.6f}, '
              f'residual {res:.1e}' + (f' -> {round(p2, 3):g}' if abs(p2 - round(p2, 3)) < 1e-4 else ''))
        if abs(p2 - round(p2, 3)) < 1e-4:
            p2 = round(p2, 3)
        p = p2

    hand = 'right' if s > 0 else 'left'
    U = np.mod(H - s * p * T / 360.0, p)
    phi = (H - U) / p * 360.0 * s           # unwrapped angle; theta + 360*turn (s=+1)
    cl = defaultdict(list)
    for i, key in enumerate(zip(np.round(R, 3), np.round(U, 3))):
        cl[key].append(i)
    # a cluster whose vertices share one h is a plain ring, not a helix edge
    hel, plain = [], defaultdict(list)
    for (rk, uk), ii in cl.items():
        ii = np.array(ii)
        if len(np.unique(np.round(H[ii], 3))) <= 2:
            for i in ii:
                plain[(rk, round(float(H[i]), 3))].append(i)
            continue
        if len(ii) >= a.min:
            hel.append((uk, rk, ii))
    print(f'\nthread: pitch {p:g}, {hand} hand; profile corners (u = position in the profile, mod p; r) '
          f'with >= {a.min} vertices, and the unwrapped angle phi each helical edge runs over:')
    print('  (h of a corner on its first turn = u + n*p; phi = 360 * (h - u) / p, so phi 0 is theta 0 at h = u)')
    hel.sort(key=lambda t: (t[0], t[1]))
    for uk, rk, ii in hel:
        ph = phi[ii]
        print(f'  u= {uk:8.3f}  r= {rk:8.3f}  n= {len(ii):4d}  phi {ph.min():9.2f} .. {ph.max():9.2f}  '
              f'({(ph.max() - ph.min()) / 360:.3f} turns)  h {H[ii].min():.4f} .. {H[ii].max():.4f}')
    us = sorted({round(uk, 2) for uk, rk, ii in hel})
    print('  distinct u (2 dec):', us)
    if plain:
        print('\nplain rings in the band (constant h, not on a helix) - cylinders and run-out faces:')
        for (rk, hk), ii in sorted(plain.items(), key=lambda t: (t[0][1], t[0][0])):
            if len(ii) >= a.min:
                print(f'  r= {rk:8.3f}  h= {hk:8.3f}  n= {len(ii):4d}')


if __name__ == '__main__':
    main()
