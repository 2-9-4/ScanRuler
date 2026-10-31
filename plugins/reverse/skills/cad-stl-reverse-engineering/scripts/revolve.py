# SPDX-License-Identifier: AGPL-3.0-only
"""A turned part (or the turned body of one) as one exact revolve: its section through the axis, read
from the coaxial faces, revolved a whole turn.

    python revolve.py [--axis z --at x0,y0] [--data data] [--name "Turned body"] [--plot revolve.png]

Needs analyze.py first (data/faces.pkl). Without --axis the axis is the line most of the round
faces lie on (analyze.py lists them: "axes"). The mesh is cut by the world plane through the axis
(a Z axis on X = x0, an X axis on Y = y0, a Y axis on X = x0); the half of the cut on one side of
the axis is the profile, closed along the axis where the part is solid there. Each coaxial face is
its exact curve in the section:
  plane square to the axis   a line square to the axis (a shoulder, an end face)
  cylinder                   a line along it (a diameter)
  cone                       a sloped line (a chamfer, a taper, a countersink)
  torus                      an arc centred off the axis (a round, a groove)
  sphere                     an arc centred on it (a ball end)
Faces that are not coaxial (a flat, a cross hole, a slot) are left out of the section the way
slabs.py heals a slab, or kept as the points seen where that fails, marked unhealed - they are
features of their own after the revolve (holes.py, slabs.py --trim). Writes "steps": the sketch, with
the axis as a construction line, and the revolve { op: "new" }.
"""
import argparse, json, os, pickle, sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cadlib import AXES, world_axis, fmt_num, nominal
from analyze import axis_groups
import prof2d as P2
import slabs as SL

# the section plane through a world axis, and the sheet's (u, v) of it
SECTION = {'z': 'x', 'x': 'y', 'y': 'x'}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--axis', choices='xyz')
    ap.add_argument('--at', help='the axis point: the other two world coordinates, as analyze.py prints them')
    ap.add_argument('--data', default='data')
    ap.add_argument('--name', default='Turned body')
    ap.add_argument('--plot')
    ap.add_argument('--trim', metavar='BODY', help='with --box: cut from BODY what of the ring the box turns out lies outside the profile')
    ap.add_argument('--box', help='r0,t0,r1,t1: radius from the axis and place along it (world coordinate)')
    ap.add_argument('--out')
    a = ap.parse_args()
    fs = pickle.load(open(os.path.join(a.data, 'faces.pkl'), 'rb'))
    if a.axis:
        w = a.axis
        pt = [float(x) for x in a.at.split(',')]
        o = np.zeros(3); others = [k for k in range(3) if AXES[k] != w]
        o[others[0]], o[others[1]] = pt
    else:
        gs = [g for g in axis_groups(fs) if world_axis(g['a'])]
        if not gs:
            raise SystemExit('no round faces on a world axis: give --axis and --at (or turn the part with frame.py)')
        g = max(gs, key=lambda g: sum(fs.area[i] for i in g['faces']))
        w = world_axis(g['a']); o = g['o']
    j = AXES.index(w)
    e = np.eye(3)[j]
    sec = SECTION[w]; si = AXES.index(sec)
    ui, vi = SL.UV[sec]
    A = np.array([o[ui], o[vi]])                 # the axis in the sheet: a point and a direction
    D = np.array([e[ui], e[vi]])
    R2 = P2.perp(D)                               # the radial direction on the side kept
    print(f'axis {w} through {np.round(o, 5).tolist()}; section on {sec.upper()} = {o[si]:.5f}, sheet u={"XYZ"[ui]} v={"XYZ"[vi]}')

    # which faces are of the revolution, and their curves in the section
    def coaxial(p):
        k = p['kind']
        if k == 'plane':
            return abs(abs(p['n'] @ e) - 1) < 1e-6
        if k in ('cylinder', 'cone', 'torus'):
            if abs(abs(p['axis'] @ e) - 1) > 5e-7:
                return False
            c = p['c'] if 'c' in p else p['apex']
            d = c - o; d -= (d @ e) * e
            return np.linalg.norm(d) < 1e-3
        if k == 'sphere':
            d = p['c'] - o; d -= (d @ e) * e
            return np.linalg.norm(d) < 1e-3
        return False
    def of_revolution(i):
        """A face no primitive fits (a spline dome, a blend) that is still turned about the axis:
        its vertices' radius is one function of their place along the axis."""
        P = fs.V[fs.verts[i]]
        if len(P) < 6:
            return False
        d = P - o; t = d @ e; r = np.linalg.norm(d - np.outer(t, e), axis=1)
        k = np.argsort(t); t, r = t[k], r[k]
        span = t[-1] - t[0]
        if span < 1e-6:
            return np.ptp(r) < 2e-3          # a flat ring
        # neighbours along the axis must agree on the radius (as far as the slope allows)
        dt = np.diff(t); dr = np.abs(np.diff(r))
        close = dt < 1e-3
        return bool(np.all(dr[close] < 2e-3 + 20 * dt[close]))
    AXIS_FACE = len(fs.prims)

    def meridian(face, pts):
        P = fs.V[fs.verts[face]]
        d = P - o; t = d @ e; r = np.linalg.norm(d - np.outer(t, e), axis=1)
        q = SL.unique_rows(A[None] + np.outer(t, D) + np.outer(r, R2), 5)
        if len(q) < 3:
            return pts
        q = SL.chain_order(q, pts[0])
        i0 = int(np.argmin(np.linalg.norm(q - pts[0], axis=1))); i1 = int(np.argmin(np.linalg.norm(q - pts[-1], axis=1)))
        q = q[i0:i1 + 1] if i0 <= i1 else q[i1:i0 + 1][::-1]
        # the ends are the run's, where the neighbours take over
        q = np.vstack([pts[0], q[np.linalg.norm(q - pts[0], axis=1) > 1e-6], pts[-1]])
        q = q[np.r_[True, np.linalg.norm(np.diff(q, axis=0), axis=1) > 1e-4]]
        # a walk that jumps (vertices off the meridian, a face that is not turned all the way)
        # is no reading: the cut's points then
        st = np.linalg.norm(np.diff(q, axis=0), axis=1)
        return q if len(q) >= 3 and st.max() < max(4 * np.median(st) + 0.2, 0.25 * st.sum()) else pts
    cls = ['wall' if coaxial(p) or (p['kind'] in ('freeform', 'chain', 'torus', 'sphere', 'cylinder', 'cone') and of_revolution(i)) else 'foreign'
           for i, p in enumerate(fs.prims)] + ['wall']

    def tpos(x3):
        return float((x3 - o) @ e)

    def carrier(fs_, face, ax, pts):
        trav = pts[-1] - pts[0]
        def line(p0, d):
            d = d if trav @ d >= 0 else -d
            return [dict(kind='line', p=p0, d=d, face=face)]
        if face == AXIS_FACE:
            return line(A, D)
        p = fs.prims[face]
        k = p['kind']
        if not coaxial(p):
            # turned but no primitive: its meridian from its vertices, each on the true surface
            # (the cut's own points lie on the facets, inside a convex curve), between the run's ends
            mode = SL._MODE[0]
            SL._MODE[0] = 'spline'
            try:
                return SL.run_pieces(meridian(face, pts), face)
            finally:
                SL._MODE[0] = mode
        if k == 'plane':
            t0 = (p['d'] - o @ p['n']) / (p['n'] @ e)
            return line(A + t0 * D, R2)
        if k == 'cylinder':
            return line(A + p['r'] * R2, D)
        if k == 'cone':
            ta = tpos(p['apex'])
            s = np.sign(p['axis'] @ e)
            d = np.cos(p['half']) * s * D + np.sin(p['half']) * R2
            return line(A + ta * D, d)
        if k == 'torus':
            c = A + tpos(p['c']) * D + p['R'] * R2
        else:
            c = A + tpos(p['c']) * D
        q = pts - c
        sgn = np.sum(q[:-1, 0] * q[1:, 1] - q[:-1, 1] * q[1:, 0])
        return [dict(kind='arc', c=c, r=p['r'], ccw=bool(sgn > 0), face=face)]

    # cut through the axis, keep the side rho >= 0, close along the axis
    h = o[si] + 1.3e-7
    cut = SL.slice_at(fs, sec, h)
    halves = []
    for L in cut:
        if not L['closed']:
            continue
        P, Fc = L['pts'], L['face']
        rho = (P - A) @ R2
        if rho.min() > -1e-6:
            halves.append(L); continue
        if rho.max() < 1e-6:
            continue
        # walk round from a point on the kept side; every stretch on the other side becomes the
        # axis between where it left and where it came back
        n = len(Fc)
        start = int(np.argmax(rho))
        pts, faces = [], []
        k = 0
        while k < n:
            i = (start + k) % n
            a_, b_ = P[i], P[i + 1]
            ra, rb = rho[i], rho[i + 1]
            if ra >= 0 and rb >= 0:
                if not pts: pts.append(a_)
                pts.append(b_); faces.append(Fc[i]); k += 1; continue
            # leaving the kept side: to the axis, along it to where the loop returns
            x = a_ + (b_ - a_) * (ra / (ra - rb))
            if not pts: pts.append(a_)
            pts.append(x); faces.append(Fc[i])
            m = k + 1
            while m < n:
                i2 = (start + m) % n
                if rho[i2 + 1] >= 0:
                    break
                m += 1
            i2 = (start + m) % n
            c_, d_ = P[i2], P[i2 + 1]
            y = c_ + (d_ - c_) * (rho[i2] / (rho[i2] - rho[i2 + 1]))
            pts.append(y); faces.append(AXIS_FACE)
            pts.append(d_); faces.append(Fc[i2])
            k = m + 1
        pts = np.array(pts)
        if np.linalg.norm(pts[0] - pts[-1]) > 1e-9:
            pts = np.vstack([pts, pts[:1]]); faces.append(faces[-1])
        halves.append(dict(pts=pts, face=np.array(faces[:len(pts) - 1]), closed=True))
    SL.BOUNDS[0] = lambda P: ((P - A) @ R2).min() > -1e-6
    loops = []
    for L in halves:
        pcs, notes = SL.build_loop(fs, cls, sec, L, h=None, carrier_fn=carrier)
        if pcs is None:
            print(f'  !! a loop of the section could not be read ({notes})'); continue
        loops.append(pcs)
    if not loops:
        raise SystemExit('nothing of the section read')

    # a pocket on the axis that is not turned (a hex or Torx socket, a slot across a head): the
    # section shows its floor running out from the axis, its sides as an unhealed gap, and the face
    # it opens through. The revolve fills it - its floor dropped, the axis run on to the opening -
    # and it is cut afterwards as an extrude of its own outline (read square to the axis).
    def square(pc):
        return pc['kind'] == 'line' and abs(P2.unit(pc['b'] - pc['a']) @ D) < 1e-6
    def level(q):
        return float((q - A) @ D + o @ e)
    def on_axis(q):
        return abs((q - A) @ R2) < 1e-6
    pockets = []
    for L in loops:
        while True:
            n = len(L); hit = None
            for i in range(n):
                if L[i]['face'] != AXIS_FACE:
                    continue
                for sgn in (1, -1):
                    jf = (i + sgn) % n
                    if not (square(L[jf]) and on_axis(L[jf]['a'] if sgn > 0 else L[jf]['b'])):
                        continue
                    m = (jf + sgn) % n; gap = []
                    while L[m].get('unhealed') and m != i:
                        gap.append(m); m = (m + sgn) % n
                    if gap and m != i:
                        hit = (i, sgn, jf, gap, m); break
                if hit: break
            if not hit:
                break
            i, sgn, jf, gap, m = hit
            Y = L[m]['a'] if sgn > 0 else L[m]['b']          # where the gap hands over
            X = A + (level(Y) - o @ e) * D
            rmax = max(abs((q - A) @ R2) for k in gap for q in (L[k]['a'], L[k]['b']))
            pockets.append(dict(t0=level(L[jf]['a']), t1=level(Y), r=rmax))
            if sgn > 0:
                L[i]['b'] = X
            else:
                L[i]['a'] = X
            if square(L[m]):
                # it opens through a face square to the axis: that face runs on to the axis
                if sgn > 0: L[m]['a'] = X
                else: L[m]['b'] = X
                new = []
            else:
                # through a turned face (a chamfer round a socket's mouth): a line square to the
                # axis out to it, the chamfer kept
                a_, b_ = (X, Y) if sgn > 0 else (Y, X)
                new = [dict(kind='line', p=a_, d=P2.unit(b_ - a_), a=a_, b=b_, face=L[jf]['face'])]
            drop = set([jf] + gap)
            keep = [pc for k, pc in enumerate(L) if k not in drop or k == jf]
            at = keep.index(L[jf])
            L[:] = keep[:at] + new + keep[at + 1:]
    # lines that run on in one line are one (a joint left on a face would put an edge there - one
    # a socket's corners then graze), and pieces of no length go
    for L in loops:
        L[:] = [pc for pc in L if pc['kind'] != 'line' or np.linalg.norm(pc['b'] - pc['a']) > 1e-6]
        def runs_on(p_, q_):
            if p_['kind'] != 'line' or q_['kind'] != 'line':
                return False
            u, v = P2.unit(p_['b'] - p_['a']), P2.unit(q_['b'] - q_['a'])
            return abs(u[0] * v[1] - u[1] * v[0]) < 1e-9 and u @ v > 0
        k = 0
        while len(L) > 3 and k < len(L):
            n_ = (k + 1) % len(L)
            if runs_on(L[k], L[n_]):
                L[k]['b'] = L[n_]['b']; L[k]['d'] = P2.unit(L[k]['b'] - L[k]['a'])
                if not L[n_].get('unhealed'): L[k].pop('unhealed', None)
                del L[n_]
                if n_ < k: k -= 1
                continue
            k += 1
    for li, L in enumerate(loops):
        Pp = P2.polygon(L)
        print(f'loop {li}: area {abs(P2.signed_area(Pp)):.4f}, {len(L)} pieces')
        for pc in L:
            tag = ''
            if pc['kind'] in ('arc', 'circle'):
                rn = nominal(pc['r']); tag = f' (={rn:g})' if rn is not None else ''
            # radius and axial place of each corner, the turner's numbers
            rr = lambda q: ((q - A) @ R2, (q - A) @ D + o @ e)
            ra_, ta_ = rr(pc['a']); rb_, tb_ = rr(pc['b'])
            print(f'   {P2.fmt_piece(pc)}{tag}   r {ra_:.4f}->{rb_:.4f}  {w} {ta_:.4f}->{tb_:.4f}'
                  + (' [UNHEALED]' if pc.get('unhealed') else '') + (' [axis]' if pc['face'] == AXIS_FACE else ''))
    ents, nid = P2.entities(loops, 1)
    print(f'closure {P2.closure(ents):.1e} mm')
    lo_t = min(((q - A) @ D) for L in loops for pc in L for q in (pc['a'], pc['b']))
    hi_t = max(((q - A) @ D) for L in loops for pc in L for q in (pc['a'], pc['b']))
    ents.append(dict(id=nid, kind='line', a=(A + (lo_t - 1) * D).tolist(), b=(A + (hi_t + 1) * D).tolist(), construction=True))
    polys = [P2.polygon(L) for L in loops]
    areas = [P2.signed_area(Pp) for Pp in polys]
    regs = []
    for li, ar in enumerate(areas):
        if ar <= 0: continue
        holes = [polys[k] for k, a2 in enumerate(areas) if a2 < 0 and P2.inside(polys[li], polys[k][0])]
        q = P2.region_point(polys[li], holes)
        if q is not None: regs.append([round(float(q[0]), 5), round(float(q[1]), 5)])
    sk = f'{a.name} section'
    plane = dict(kind='world', axis=sec, offset=round(float(o[si]), 6))
    add = lambda f: steps.append(dict(name='reverse.feature.add', input=dict(feature=f)))
    steps = []
    add(dict(kind='sketch', name=sk, plane=plane, sketch=dict(entities=ents)))
    if not a.trim:
        add(dict(kind='revolve', name=a.name, sketchId=sk, regions=[dict(at=r) for r in regs], axis=dict(kind='sketchLine', entity=nid), angleDeg=360, op='new'))
    else:
        # the ring the box turns out, less the turned profile, cut from the body: a groove, an
        # undercut, a turned recess on a part built another way
        r0, t0, r1, t1 = (float(x) for x in a.box.split(','))
        to = o @ e
        corner = lambda r, t: (A + (t - to) * D + r * R2).tolist()
        rect = [corner(r0, t0), corner(r1, t0), corner(r1, t1), corner(r0, t1)]
        bents = [dict(id=k + 1, kind='line', a=rect[k], b=rect[(k + 1) % 4], fixed=True) for k in range(4)]
        bents.append(dict(id=5, kind='line', a=corner(0, t0 - 1), b=corner(0, t1 + 1), construction=True))
        ring = f'{a.name} ring'
        add(dict(kind='sketch', name=ring + ' sketch', plane=plane, sketch=dict(entities=bents)))
        add(dict(kind='revolve', name=ring, sketchId=ring + ' sketch', regions=[dict(at=corner((r0 + r1) / 2, (t0 + t1) / 2))],
                 axis=dict(kind='sketchLine', entity=5), angleDeg=360, op='new'))
        for ri, r in enumerate(regs):
            tp = f'{a.name} profile {ri}'
            add(dict(kind='revolve', name=tp, sketchId=sk, regions=[dict(at=r)], axis=dict(kind='sketchLine', entity=nid), angleDeg=360, op='new'))
            add(dict(kind='boolean', name=f'{tp} out of ring', op='cut', body=ring, tool=tp))
        add(dict(kind='boolean', name=a.name, op='cut', body=a.trim, tool=ring))
    for pi_, pk in enumerate(pockets):
        # its outline in a section square to the axis, halfway up; the cut runs from its floor out
        # through the face it opens on and a little past
        cls_w = SL.classify(fs, w)
        hm = (pk['t0'] + pk['t1']) / 2
        if np.any(np.abs(fs.V[:, j] - hm) < 1e-7): hm += 3.1e-7
        uw, vw = SL.UV[w]
        cxy = np.array([o[uw], o[vw]])
        res = SL.read_slab(fs, cls_w, w, hm, False, None)
        inner = [L for L in res['loops'] if np.all(np.linalg.norm(P2.polygon(L) - cxy, axis=1) < pk['r'] + 1e-3)]
        what = f'pocket on the axis, {w} {pk["t0"]:.4f}..{pk["t1"]:.4f}, out to r {pk["r"]:.4f}: not turned'
        if not inner:
            print(f'  !! {what} - filled; its outline was not read at {w} = {hm:.4f}: cut it by hand'); continue
        pe, _ = P2.entities(inner, 1)
        reg = [P2.region_point(P2.polygon(L), []) for L in inner]
        nm = f'{a.name} socket {pi_}' if pi_ else f'{a.name} socket'
        far = pk['t1'] + (1 if pk['t1'] > pk['t0'] else -1)
        add(dict(kind='sketch', name=nm + ' outline', plane=dict(kind='world', axis=w, offset=round(pk['t0'], 6)), sketch=dict(entities=pe)))
        add(dict(kind='extrude', name=nm + ' tool', sketchId=nm + ' outline', regions=[dict(at=[round(float(x), 5) for x in q]) for q in reg if q is not None],
                 extent={'kind': 'distance', 'from': 0, 'to': round(far - pk['t0'], 6)}, op='new'))
        add(dict(kind='boolean', name=nm, op='cut', body=a.trim or a.name, tool=nm + ' tool'))
        print(f'  {what} - filled, and cut as "{nm}": {sum(len(L) for L in inner)} pieces read at {w} = {hm:.4f}')
    if a.plot:
        import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
        fig, ax_ = plt.subplots(figsize=(8, 8))
        for L in cut:
            ax_.plot(L['pts'][:, 0], L['pts'][:, 1], color='0.75', lw=3)
        for L in loops:
            for pc in L:
                Q = P2.sample(pc, 48); ax_.plot(Q[:, 0], Q[:, 1], color='red' if pc.get('unhealed') else 'C0')
        ax_.set_aspect('equal'); plt.savefig(a.plot, dpi=70); print('plot', a.plot)
    out = a.out or os.path.join(a.data, 'revolve.json')
    for st in steps:
        st['input'].setdefault('detail', 'none')     # answers kept to id and status: a run read at the end
    json.dump(dict(steps=steps), open(out, 'w'))
    print(f'wrote {out}: sketch + revolve, regions {regs}')


if __name__ == '__main__':
    main()
