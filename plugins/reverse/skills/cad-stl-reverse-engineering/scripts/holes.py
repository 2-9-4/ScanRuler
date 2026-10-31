# SPDX-License-Identifier: AGPL-3.0-only
"""Holes as exact revolve cuts: every hole (concave cylinders and cones on one axis) along an axis
other than the main one, read from its faces, written as a sketch and a revolve { op: "cut" }.

    python holes.py --main z [--data data] [--all] [--margin 1] [--out data/holes.json]

Needs analyze.py first (data/faces.pkl). For each axis line with a concave cylinder or cone that
goes at least half way round:
  profile  r(t) along the axis from its faces - a cylinder is a step of constant radius, a cone a
           sloped run (an entry chamfer, a countersink, a drill point) - in order along the axis;
           where two faces leave a stretch between them uncovered (the hole crosses a pocket) the
           smaller radius runs across it.
  ends     an end ringed by a plane square to the axis inside the radius is a floor (a blind hole,
           a counterbore's step): the profile closes there. An end where the hole meets the outside
           is open: the profile runs on as far as its ring of vertices spreads along the axis (a
           hole entering a slanted face) plus --margin - no further, or it cuts what lies beyond.
The sketch lies on the world plane through the axis (an X hole on Y = its y, a Y or Z hole on
X = its x) with the axis as a construction line; --all takes holes along the main axis too
(slabs.py has cut those already as circles, but not their chamfers or counterbores).
Prints each hole - radii with their round values, depth, ends - and writes "steps".
"""
import argparse, json, os, pickle, sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cadlib import AXES, world_axis, fmt_num, nominal
from analyze import axis_groups
from frame import euler_xyz
import prof2d as P2

# the world plane through an axis line, and the in-plane direction square to the axis
PLANE_FOR = {'x': ('y', np.array([0, 0, 1.0])), 'y': ('x', np.array([0, 0, 1.0])), 'z': ('x', np.array([0, 1.0, 0]))}
UV = {'z': (0, 1), 'x': (1, 2), 'y': (2, 0)}


def runs(fs, g):
    """(t0, r0, t1, r1, face) per face of the group, t along the axis from its point o."""
    a, o = g['a'], g['o']
    out = []
    for f in g['faces']:
        p = fs.prims[f]
        P = fs.V[fs.verts[f]]
        t = (P - o) @ a
        r = np.linalg.norm((P - o) - np.outer(t, a), axis=1)
        if p['kind'] == 'cylinder':
            out.append((t.min(), p['r'], t.max(), p['r'], f))
        else:
            k, b = np.polyfit(t, r, 1)
            t0, t1 = t.min(), t.max()
            out.append((t0, k * t0 + b, t1, k * t1 + b, f))
    out.sort(key=lambda x: (x[0] + x[2]) / 2)
    return out


def ring_reach(fs, g, f, side):
    """How far an open end's ring reaches along the axis: the end face's vertices that it shares
    with faces outside the hole (its border with the entry face) on the entry side, their spread."""
    a, o = g['a'], g['o']
    mine = set(fs.verts[f].tolist())
    border = set()
    for n in fs.neigh[f]:
        if n in g['faces']:
            continue
        border |= mine & set(fs.verts[n].tolist())
    if not border:
        return 0.0
    P = fs.V[sorted(border)]
    t = (P - o) @ a
    tf = (fs.V[fs.verts[f]] - o) @ a
    mid = (tf.min() + tf.max()) / 2
    t = t[t < mid] if side < 0 else t[t > mid]
    return float(t.max() - t.min()) if len(t) else 0.0


def end_kind(fs, g, f, t_end, r_end, outward):
    """'floor' when a plane square to the axis lies inside the radius beside this end face,
    else 'open'."""
    a, o = g['a'], g['o']
    for n in fs.neigh[f]:
        q = fs.prims[n]
        if q['kind'] != 'plane' or abs(abs(q['n'] @ a) - 1) > 1e-6:
            continue
        P = fs.V[fs.verts[n]]
        t = (P - o) @ a
        if np.abs(t - t_end).max() > 1e-3:
            continue
        r = np.linalg.norm((P - o) - np.outer(t, a), axis=1)
        if r.max() <= r_end + 1e-3:
            return 'floor'
    return 'open'


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--main', required=True, choices='xyz', help='the axis slabs.py built along')
    ap.add_argument('--data', default='data')
    ap.add_argument('--all', action='store_true')
    ap.add_argument('--margin', type=float, default=0.02, help='mm an open end runs on past its ring')
    ap.add_argument('--body', default=None, help='the body a hole at an angle is cut from (default: the first slab of the main build)')
    ap.add_argument('--out')
    a = ap.parse_args()
    fs = pickle.load(open(os.path.join(a.data, 'faces.pkl'), 'rb'))
    a.body = a.body or f'{a.main.upper()} slab 0'
    steps = []
    n = 0
    for g in axis_groups(fs):
        w = world_axis(g['a'])
        hole = [f for f in g['faces'] if not fs.prims[f]['convex'] and fs.prims[f].get('sweep', 0) >= 180
                and fs.prims[f].get('r', 1.0) >= 0.15]          # under 0.3 mm across: a fit to a blend, no hole
        if not hole:
            continue
        tilted = w is None
        if tilted:
            # an axis at an angle: the hole is made about the nearest world axis through the
            # origin, as a body of its own, turned onto the axis and cut from the part
            w = AXES[int(np.argmax(np.abs(g['a'])))]
            g['a'] = g['a'] * np.sign(g['a'][AXES.index(w)])
        elif w == a.main and not a.all:
            continue
        else:
            # one direction for t: along +axis
            g['a'] = np.eye(3)[AXES.index(w)]
        rs = [x for x in runs(fs, g) if not fs.prims[x[4]]['convex']]
        if not rs:
            continue
        # the profile r(t): a polyline from the first end to the last
        prof = []
        for t0, r0, t1, r1, f in rs:
            if prof and t0 > prof[-1][0] + 1e-4:
                # uncovered stretch: the smaller radius runs across
                rr = min(prof[-1][1], r0)
                prof[-1] = (prof[-1][0], rr) if prof[-1][1] > rr else prof[-1]
                prof.append((t0, rr))
            if prof and abs(prof[-1][1] - r0) > 1e-4:
                prof.append((max(t0, prof[-1][0]), r0))       # a step
            elif not prof:
                prof.append((t0, r0))
            prof.append((t1, r1))
        # a radius within a micron of the axis is on it (a drill point's tip): a hair across it
        # and the profile crosses the axis, which no revolve takes
        prof = [(t, 0.0 if r < 1e-4 else r) for t, r in prof]
        if prof[-1][0] - prof[0][0] < 0.3:
            continue        # a sliver of a cylinder along a blend, no hole
        f_first, f_last = rs[0][4], rs[-1][4]
        e0 = end_kind(fs, g, f_first, rs[0][0], rs[0][1], -1)
        e1 = end_kind(fs, g, f_last, rs[-1][2], rs[-1][3], 1)
        # a cone that reaches the axis closes the hole itself (a drill point)
        if prof[0][1] < 1e-3: e0 = 'point'
        if prof[-1][1] < 1e-3: e1 = 'point'
        # an open end runs on just past where its ring of vertices reaches along the axis: a ring on
        # a face square to the axis needs a hair, one on a slanted or curved face as much as it
        # leans - and no more, or the cut runs into material beyond the entry
        if e0 == 'open':
            prof.insert(0, (prof[0][0] - ring_reach(fs, g, f_first, -1) - a.margin, prof[0][1]))
        if e1 == 'open':
            prof.append((prof[-1][0] + ring_reach(fs, g, f_last, 1) + a.margin, prof[-1][1]))
        poly = [(prof[0][0], 0.0)] + prof + [(prof[-1][0], 0.0)]
        # drop repeats
        clean = [poly[0]]
        for p in poly[1:]:
            if np.hypot(p[0] - clean[-1][0], p[1] - clean[-1][1]) > 1e-6:
                clean.append(p)
        if np.hypot(clean[0][0] - clean[-1][0], clean[0][1] - clean[-1][1]) < 1e-6:
            clean.pop()
        plane_ax, wdir = PLANE_FOR[w]
        o = g['o']                      # t was measured from this point
        ui, vi = UV[plane_ax]
        # the tool is drawn about the world axis: through o, or (tilted) through the origin
        o_d = np.zeros(3) if tilted else o
        a_d = np.eye(3)[AXES.index(w)]
        off = float(o_d[AXES.index(plane_ax)])

        def to_uv(t, r):
            X = o_d + t * a_d + r * wdir
            return np.array([X[ui], X[vi]])
        pts = [to_uv(t, r) for t, r in clean]
        loop = []
        for k in range(len(pts)):
            p, q = pts[k], pts[(k + 1) % len(pts)]
            loop.append(dict(kind='line', p=p, d=P2.unit(q - p), a=p, b=q))
        ents, nid = P2.entities([loop], 1)
        t_lo, t_hi = clean[0][0] - 0.5, clean[-1][0] + 0.5
        A0, A1 = to_uv(t_lo, 0), to_uv(t_hi, 0)
        ents.append(dict(id=nid, kind='line', a=A0.tolist(), b=A1.tolist(), construction=True))
        inside = to_uv((clean[0][0] + clean[-1][0]) / 2, min(r for _, r in clean if r > 1e-6) / 2)
        # the inside point must lie inside the profile polygon
        Pp = np.array(pts)
        if not P2.inside(Pp, inside):
            inside = P2.region_point(Pp, []) if P2.region_point(Pp, []) is not None else inside
        n += 1
        radii = sorted({round(r, 5) for _, r in prof if r > 1e-6})
        desc = ', '.join(f'R{fmt_num(r)}' for r in radii)
        print(f'H{n}: {w} axis at {[fmt_num(v) for j, v in enumerate(o) if AXES[j] != w]}  {desc}  '
              f'{w} {clean[0][0] + (o @ g["a"]):.4f}..{clean[-1][0] + (o @ g["a"]):.4f}  ends {e0}/{e1}  faces {g["faces"]}')
        for t, r in prof:
            print(f'      {w} {t + (o @ g["a"]):9.4f}  r {fmt_num(r)}')
        sk = f'Hole {n} profile'
        steps.append(dict(name='reverse.feature.add', input=dict(feature=dict(
            kind='sketch', name=sk, plane=dict(kind='world', axis=plane_ax, offset=round(off, 6)), sketch=dict(entities=ents)))))
        rev = dict(kind='revolve', name=f'Hole {n}', sketchId=sk, regions=[dict(at=[round(float(x), 5) for x in inside])],
                   axis=dict(kind='sketchLine', entity=nid), angleDeg=360, op='cut')
        if not tilted:
            steps.append(dict(name='reverse.feature.add', input=dict(feature=rev)))
            continue
        # turned from the world axis onto the hole's axis (the smallest turn), then moved onto it
        k = np.cross(a_d, g['a']); sn = np.linalg.norm(k); cs = float(a_d @ g['a'])
        K = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]]) / max(sn, 1e-15)
        R = np.eye(3) + sn * K + (1 - cs) * K @ K
        tool = f'Hole {n} tool'
        print(f'      tilted {np.degrees(np.arccos(np.clip(cs, -1, 1))):.4f} deg off {w}: drawn about {w}, turned {np.round(euler_xyz(R), 6).tolist()} and moved to {np.round(o, 5).tolist()}')
        steps.append(dict(name='reverse.feature.add', input=dict(feature=dict(rev, name=tool, op='new'))))
        steps.append(dict(name='reverse.feature.add', input=dict(feature=dict(
            kind='moveBody', name=f'Hole {n} onto its axis', bodies=[tool], rotate=[float(x) for x in euler_xyz(R)],
            pivot=[0, 0, 0], translate=[float(x) for x in o]))))
        steps.append(dict(name='reverse.feature.add', input=dict(feature=dict(kind='boolean', name=f'Hole {n}', op='cut', body=a.body, tool=tool))))
    out = a.out or os.path.join(a.data, 'holes.json')
    for st in steps:
        st['input'].setdefault('detail', 'none')     # answers kept to id and status: a run read at the end
    json.dump(dict(steps=steps), open(out, 'w'))
    print(f'wrote {out}: {len(steps)} steps')


if __name__ == '__main__':
    main()
