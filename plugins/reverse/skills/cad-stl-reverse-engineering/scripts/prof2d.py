# SPDX-License-Identifier: AGPL-3.0-only
"""Exact 2D profiles: lines and arcs with exact carriers (from the faces that make them), joined at
exact corners, written out as ScanRuler sketch entities.

A piece has a carrier and a direction of travel:
  line  dict(kind='line', p=point on it, d=unit direction of travel, a=start, b=end)
  arc   dict(kind='arc', c=centre, r=radius, ccw=True|False (travel), a=start, b=end)
  circle dict(kind='circle', c, r)
Corners are where neighbouring carriers cross (the crossing nearest the corner seen in the mesh);
a carrier that runs on past a healed gap is the same carrier on both sides.
"""
import numpy as np

TWO_PI = 2 * np.pi


def unit(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)


def perp(v):
    return np.array([-v[1], v[0]])


def same_carrier(p, q, tol=1e-4):
    if p['kind'] != q['kind'] or p['kind'] == 'spline':
        return False
    if p['kind'] == 'line':
        return abs(abs(p['d'] @ q['d']) - 1) < 1e-8 and abs(perp(p['d']) @ (q['p'] - p['p'])) < tol
    return np.linalg.norm(p['c'] - q['c']) < tol and abs(p['r'] - q['r']) < tol


def project(pc, x):
    """The point of a carrier nearest x."""
    if pc['kind'] == 'spline':
        return min((pc['pts'][0], pc['pts'][-1]), key=lambda q: np.linalg.norm(q - x))
    if pc['kind'] == 'line':
        return pc['p'] + ((x - pc['p']) @ pc['d']) * pc['d']
    v = x - pc['c']
    n = np.linalg.norm(v)
    return pc['c'] + pc['r'] * (v / n if n > 1e-12 else np.array([1.0, 0]))


def crossings(p, q):
    """Crossing points of two carriers, with a flag for a tangent touch."""
    if p['kind'] == 'line' and q['kind'] == 'line':
        A = np.c_[p['d'], -q['d']]
        if abs(np.linalg.det(A)) < 1e-10:
            return []
        t = np.linalg.solve(A, q['p'] - p['p'])
        return [(p['p'] + t[0] * p['d'], False)]
    if p['kind'] == 'line' or q['kind'] == 'line':
        ln, ci = (p, q) if p['kind'] == 'line' else (q, p)
        foot = ln['p'] + ((ci['c'] - ln['p']) @ ln['d']) * ln['d']
        h = np.linalg.norm(foot - ci['c'])
        if abs(h - ci['r']) < 2e-4:                 # tangent (to the export's precision)
            return [(foot, True)]
        if h > ci['r']:
            return []
        s = np.sqrt(ci['r'] ** 2 - h ** 2)
        return [(foot + s * ln['d'], False), (foot - s * ln['d'], False)]
    c1, r1, c2, r2 = p['c'], p['r'], q['c'], q['r']
    d = np.linalg.norm(c2 - c1)
    if d < 1e-12:
        return []
    if abs(d - (r1 + r2)) < 2e-4 or abs(d - abs(r1 - r2)) < 2e-4:
        u = (c2 - c1) / d
        sgn = 1 if abs(d - (r1 + r2)) < 2e-4 or r1 > r2 else -1
        return [(c1 + sgn * r1 * u, True)]
    if d > r1 + r2 or d < abs(r1 - r2):
        return []
    a = (r1 ** 2 - r2 ** 2 + d ** 2) / (2 * d)
    h = np.sqrt(max(r1 ** 2 - a ** 2, 0))
    u = (c2 - c1) / d
    m = c1 + a * u
    return [(m + h * perp(u), False), (m - h * perp(u), False)]


def polyline_crossing(P, pc, near):
    """Where a line or arc carrier crosses polyline P, the crossing nearest `near`; else the
    polyline's point nearest the carrier."""
    best = None
    for a_, b_ in zip(P[:-1], P[1:]):
        seg = dict(kind='line', p=a_, d=unit(b_ - a_)) if np.linalg.norm(b_ - a_) > 1e-12 else None
        if seg is None:
            continue
        for x, _ in crossings(seg, pc):
            t = (x - a_) @ seg['d']
            if -1e-9 <= t <= np.linalg.norm(b_ - a_) + 1e-9:
                if best is None or np.linalg.norm(x - near) < np.linalg.norm(best - near):
                    best = x
    if best is None:
        best = min(P, key=lambda x: np.linalg.norm(project(pc, x) - x) + 1e-3 * np.linalg.norm(x - near))
        best = project(pc, best)
    return best


def corner(p, q, near):
    """Where carrier p hands over to q: the crossing nearest `near` (the corner seen in the mesh).
    A spline hands over at its own end, put onto the neighbour's carrier (the end is a mesh vertex,
    on both faces)."""
    if p['kind'] == 'spline' and q['kind'] == 'spline':
        return p['pts'][-1]
    # a shared spline (a whole wall) runs past the corner: the neighbour meets it where it crosses
    if p['kind'] == 'spline' and p.get('shared'):
        return polyline_crossing(p['pts'], q, near)
    if q['kind'] == 'spline' and q.get('shared'):
        return polyline_crossing(q['pts'], p, near)
    if p['kind'] == 'spline':
        return project(q, p['pts'][-1])
    if q['kind'] == 'spline':
        return project(p, q['pts'][0])
    cs = crossings(p, q)
    if not cs:
        return None
    return min(cs, key=lambda c: np.linalg.norm(c[0] - near))[0]


def arc_angles(pc):
    """start, sweep (radians, sweep > 0 counter-clockwise) of an arc piece as ScanRuler wants it."""
    a0 = np.arctan2(pc['a'][1] - pc['c'][1], pc['a'][0] - pc['c'][0])
    a1 = np.arctan2(pc['b'][1] - pc['c'][1], pc['b'][0] - pc['c'][0])
    if pc['ccw']:
        sw = (a1 - a0) % TWO_PI
        return a0, (sw if sw > 1e-12 else TWO_PI)
    sw = (a0 - a1) % TWO_PI
    return a1, (sw if sw > 1e-12 else TWO_PI)


def sample(pc, n=24):
    """Points along a piece, from a to b."""
    if pc['kind'] == 'spline':
        q = np.asarray(pc['pts'])
        if pc.get('shared'):
            # the stretch between the corners
            i0 = int(np.argmin(np.linalg.norm(q - pc['a'], axis=1))); i1 = int(np.argmin(np.linalg.norm(q - pc['b'], axis=1)))
            mid = q[i0 + 1:i1] if i0 < i1 else q[i1 + 1:i0][::-1]
            return np.vstack([pc['a'], mid, pc['b']]) if len(mid) else np.vstack([pc['a'], pc['b']])
        return np.vstack([pc['a'], q[1:-1], pc['b']]) if len(q) > 2 else np.vstack([pc['a'], pc['b']])
    if pc['kind'] == 'line':
        return np.linspace(pc['a'], pc['b'], 2)
    if pc['kind'] == 'circle':
        t = np.linspace(0, TWO_PI, n + 1)
        pts = pc['c'] + pc['r'] * np.c_[np.cos(t), np.sin(t)]
        return pts if pc.get('ccw', True) else pts[::-1]
    s, sw = arc_angles(pc)
    t = np.linspace(s, s + sw, max(3, int(n * sw / TWO_PI) + 3))
    pts = pc['c'] + pc['r'] * np.c_[np.cos(t), np.sin(t)]
    return pts if pc['ccw'] else pts[::-1]


def polygon(loop, n=48):
    pts = [sample(pc, n)[:-1] if pc['kind'] != 'circle' else sample(pc, n)[:-1] for pc in loop]
    return np.vstack(pts)


def signed_area(P):
    return 0.5 * float(np.sum(P[:, 0] * np.roll(P[:, 1], -1) - np.roll(P[:, 0], -1) * P[:, 1]))


def inside(P, x):
    """Even-odd test of point x against polygon P."""
    y = x[1]; c = False
    for i in range(len(P)):
        a, b = P[i], P[i - 1]
        if (a[1] > y) != (b[1] > y):
            xc = a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1])
            if xc > x[0]:
                c = not c
    return c


def region_point(outer, holes):
    """A point inside the outer polygon and outside the holes, well away from every edge."""
    P = outer
    lo, hi = P.min(0), P.max(0)
    best, bd = None, -1
    allp = [P] + holes
    # candidates on a grid, scored by distance to the nearest boundary sample
    span = hi - lo
    g = 24
    xs = lo[0] + span[0] * (np.arange(g) + 0.5) / g
    ys = lo[1] + span[1] * (np.arange(g) + 0.5) / g
    B = np.vstack(allp)
    for x in xs:
        for y in ys:
            q = np.array([x, y])
            if not inside(P, q) or any(inside(H, q) for H in holes):
                continue
            d = np.min(np.linalg.norm(B - q, axis=1))
            if d > bd:
                best, bd = q, d
    if best is None:     # thin sliver: try the middle of each edge, nudged inwards
        for i in range(len(P)):
            m = (P[i] + P[i - 1]) / 2
            nrm = perp(unit(P[i] - P[i - 1]))
            for s in (1e-3, -1e-3, 1e-2, -1e-2):
                q = m + s * nrm
                if inside(P, q) and not any(inside(H, q) for H in holes):
                    return q
    return best


def entities(loops, first_id=1):
    """ScanRuler sketch entities (fixed) for closed loops of pieces, ends shared exactly."""
    ents = []; nid = first_id
    for loop in loops:
        for pc in loop:
            if pc['kind'] == 'spline':
                pts = list(pc['pts']) if pc.get('shared') else [pc['a']] + list(pc['pts'][1:-1]) + [pc['b']]
                ents.append(dict(id=nid, kind='spline', pts=[[float(x) for x in q] for q in pts], fixed=True))
            elif pc['kind'] == 'line':
                if np.linalg.norm(pc['b'] - pc['a']) < 1e-9:
                    continue
                ents.append(dict(id=nid, kind='line', a=[float(x) for x in pc['a']], b=[float(x) for x in pc['b']], fixed=True))
            elif pc['kind'] == 'circle':
                ents.append(dict(id=nid, kind='circle', c=[float(x) for x in pc['c']], r=float(pc['r']), fixed=True))
            else:
                # the arc through its two corners exactly: the centre moved onto their bisector (a
                # tangent corner is the foot point, a hair off the fitted circle) - closure by
                # construction, the radius changed by no more than that hair
                a_, b_ = np.asarray(pc['a'], float), np.asarray(pc['b'], float)
                c = np.asarray(pc['c'], float)
                m = (a_ + b_) / 2; t = b_ - a_
                if np.linalg.norm(t) > 1e-9:
                    nrm = perp(unit(t))
                    c = m + ((c - m) @ nrm) * nrm
                q = dict(pc, c=c, r=float(np.linalg.norm(a_ - c)))
                s, sw = arc_angles(q)
                ents.append(dict(id=nid, kind='arc', c=[float(x) for x in c], r=q['r'],
                                 start=float(s), sweep=float(sw), fixed=True))
            nid += 1
    return ents, nid


def closure(ents):
    """Worst distance from an entity end to the nearest other entity end."""
    E = []; S = []
    for e in ents:
        if e['kind'] == 'line':
            E += [e['a'], e['b']]
        elif e['kind'] == 'spline':
            # a spline may run past its corners (a shared wall): its ends need no partner, but an
            # end of anything else may lie anywhere along it
            S.append(np.asarray(e['pts'], float))
            continue
        elif e['kind'] == 'arc':
            s, t = e['start'], e['start'] + e['sweep']
            E += [[e['c'][0] + e['r'] * np.cos(s), e['c'][1] + e['r'] * np.sin(s)],
                  [e['c'][0] + e['r'] * np.cos(t), e['c'][1] + e['r'] * np.sin(t)]]
    if len(E) < 2:
        return 0.0
    E = np.array(E)
    D = np.linalg.norm(E[:, None] - E[None], axis=2); np.fill_diagonal(D, np.inf)
    d = D.min(1)
    for q in S:
        a_, r = q[:-1], q[1:] - q[:-1]
        t = np.clip(((E[:, None] - a_[None]) * r[None]).sum(2) / np.maximum((r * r).sum(1), 1e-30)[None], 0, 1)
        d = np.minimum(d, np.linalg.norm(E[:, None] - (a_[None] + t[..., None] * r[None]), axis=2).min(1))
    return float(d.max())


def fmt_piece(pc):
    if pc['kind'] == 'spline':
        return f"S {np.round(pc['a'], 5).tolist()} -> {np.round(pc['b'], 5).tolist()} through {len(pc['pts'])} points"
    if pc['kind'] == 'line':
        L = np.linalg.norm(pc['b'] - pc['a'])
        return f"L {np.round(pc['a'], 5).tolist()} -> {np.round(pc['b'], 5).tolist()} len {L:.5f}"
    if pc['kind'] == 'circle':
        return f"O c {np.round(pc['c'], 5).tolist()} R {pc['r']:.5f}"
    s, sw = arc_angles(pc)
    return (f"A c {np.round(pc['c'], 5).tolist()} R {pc['r']:.5f} {'ccw' if pc['ccw'] else 'cw'} "
            f"{np.round(pc['a'], 5).tolist()} -> {np.round(pc['b'], 5).tolist()} sweep {np.degrees(sw):.3f}")
