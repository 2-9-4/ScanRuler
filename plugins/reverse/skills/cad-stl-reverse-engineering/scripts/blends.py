# SPDX-License-Identifier: AGPL-3.0-only
"""Chamfers and rounds on the edges of the sharp model: every blend face of the mesh read as the edge
it replaced, its size, and the chamfer / fillet features that put it back.

    python blends.py --main z --body "Z slab 0" [--data data] [--out data/blends.json]

Needs analyze.py first (data/faces.pkl). A blend is a face standing between two support faces A
and B (its two longest borders) where the sharp model has the edge A x B:
  chamfer  a plane or cone meeting A and B at sharp edges; its setbacks dA, dB are measured from
           the sharp edge to where it meets each face (45 deg: dA = dB)
  round    a cylinder or torus tangent to A and B; its radius is the face's own
Walls along the main axis are left out: their chamfers and rounds are lines and arcs of the slab
profiles already. So are hole faces (holes.py) - but a cone on the edge of a hole along the main
axis is that hole's chamfer, and is kept.
Each edge is picked by a point on it ({ through: { at } }): the point of A x B nearest the blend
(alternating projections onto the two surfaces) - anywhere along the model's edge, however the
model has split it. Chamfers of one size share a
feature, rounds of one radius too; chamfers come first, as the kernel rounds best onto them.
Run it after slabs.py and holes.py have built, and check with compare.py: a blend whose edge is
not in the model (two slabs meeting where the design had one face) picks nothing and says so in
the feature's answer.
"""
import argparse, json, os, pickle, sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cadlib import AXES, world_axis, fmt_num, nominal, dist_to
from slabs import classify


def project(p, x):
    """The point of primitive p nearest x (approximately for a cone and a torus far off them)."""
    k = p['kind']
    if k == 'plane':
        return x - (x @ p['n'] - p['d']) * p['n']
    if k == 'sphere':
        d = x - p['c']; return p['c'] + p['r'] * d / np.linalg.norm(d)
    if k == 'cylinder':
        a = p['axis']; d = x - p['c']; h = d @ a; rad = d - h * a
        return p['c'] + h * a + p['r'] * rad / max(np.linalg.norm(rad), 1e-12)
    if k == 'cone':
        a, ap, t = p['axis'], p['apex'], p['half']
        d = x - ap; h = d @ a; rad = d - h * a; rn = np.linalg.norm(rad)
        u = rad / rn if rn > 1e-12 else np.array([1.0, 0, 0])
        g = np.cos(t) * a + np.sin(t) * u            # the generator through x's half-plane
        s = max(d @ g, 0.0)
        return ap + s * g
    if k == 'torus':
        a, c = p['axis'], p['c']; d = x - c; h = d @ a; rad = d - h * a
        ctr = c + p['R'] * rad / max(np.linalg.norm(rad), 1e-12)
        e = x - ctr
        return ctr + p['r'] * e / max(np.linalg.norm(e), 1e-12)
    raise ValueError(k)


def sharp_point(A, B, x0, iters=300):
    """A point on A x B near x0: alternating projections."""
    x = x0.copy()
    for _ in range(iters):
        y = project(B, project(A, x))
        if np.linalg.norm(y - x) < 1e-10:
            x = y; break
        x = y
    return x


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--main', required=True, choices='xyz')
    ap.add_argument('--body', required=True, help='the body to blend, by name or id')
    ap.add_argument('--data', default='data')
    ap.add_argument('--out')
    a = ap.parse_args()
    fs = pickle.load(open(os.path.join(a.data, 'faces.pkl'), 'rb'))
    cls = classify(fs, a.main)
    V = fs.V
    found = []; unread = []
    # a face's width: its area over its longest extent
    width = np.zeros(len(fs.prims))
    for i in range(len(fs.prims)):
        P = V[fs.verts[i]]
        ext = np.linalg.norm(P.max(0) - P.min(0))
        width[i] = fs.area[i] / max(ext, 1e-9)
    for i, p in enumerate(fs.prims):
        k = p['kind']
        if k not in ('plane', 'cone', 'cylinder', 'torus'):
            continue
        if cls[i] in ('wall', 'cap'):
            continue
        if k == 'cylinder' and not p['convex'] and p.get('sweep', 0) >= 180:
            continue                                   # a hole
        nb = [(j, fs.adj[(min(i, j), max(i, j))]) for j in fs.neigh[i]]
        # supports are faces of the design, not other blends: clearly wider than this one (a
        # chamfer running along a long arc is large but as narrow as its corner pieces)
        nb = [(j, e) for j, e in nb if fs.prims[j]['kind'] in ('plane', 'cylinder', 'cone', 'sphere', 'torus')
              and width[j] > 1.5 * width[i]]
        if len(nb) < 2:
            continue
        nb.sort(key=lambda je: -je[1]['length'])
        (ja, ea), (jb, eb) = nb[0], nb[1]
        A, B = fs.prims[ja], fs.prims[jb]
        # a blend runs along its two supports: their borders are its long sides
        L = (ea['length'] + eb['length']) / 2
        rest = sum(e['length'] for _, e in nb[2:])
        if rest > 0.6 * (ea['length'] + eb['length']):
            continue
        P = V[fs.verts[i]]
        cen = P.mean(0)
        S = sharp_point(A, B, cen)
        if not np.all(np.isfinite(S)) or dist_to(A, S[None])[0] > 1e-4 or dist_to(B, S[None])[0] > 1e-4:
            continue
        da, db = dist_to(A, P), dist_to(B, P)
        onA = P[(da < 2e-3) & (db > 2e-3)]; onB = P[(db < 2e-3) & (da > 2e-3)]
        if len(onA) == 0 or len(onB) == 0:
            continue
        # each border vertex's distance to the sharp edge, the median of them
        dA = float(np.median([np.linalg.norm(x - sharp_point(A, B, x)) for x in onA]))
        dB = float(np.median([np.linalg.norm(x - sharp_point(A, B, x)) for x in onB]))
        tangent = ea['tangent'] and eb['tangent']
        if k in ('cylinder', 'torus') and tangent:
            r = p['r']
            found.append(dict(kind='round', face=i, A=ja, B=jb, r=r, at=S, len=L))
        elif k in ('plane', 'cone') and not tangent:
            if min(dA, dB) < 0.05 or max(dA, dB) > 3 * min(dA, dB):
                unread.append((i, f'chamfer-like {k} between {ja} and {jb} with setbacks {dA:.3f} / {dB:.3f}'))
                continue
            found.append(dict(kind='chamfer', face=i, A=ja, B=jb, dA=dA, dB=dB, at=S, len=L))
    # group by size
    groups = {}
    for b in found:
        if b['kind'] == 'chamfer':
            d1, d2 = sorted((b['dA'], b['dB']))
            n1 = nominal(d1, within=2e-3) or round(d1, 4); n2 = nominal(d2, within=2e-3) or round(d2, 4)
            key = ('chamfer', n1, n2)
        else:
            key = ('round', nominal(b['r'], within=2e-3) or round(b['r'], 4))
        groups.setdefault(key, []).append(b)
    steps = []
    for key in sorted(groups, key=lambda k: (k[0] != 'chamfer', k)):
        bs = groups[key]
        edges = [dict(through=dict(at=[round(float(x), 6) for x in b['at']], within=0.01), optional=True) for b in bs]
        if key[0] == 'chamfer':
            _, d1, d2 = key
            print(f'chamfer {fmt_num(d1)}' + (f' x {fmt_num(d2)}' if abs(d1 - d2) > 1e-3 else '') + f': {len(bs)} edges')
            feat = dict(kind='chamfer', name=f'Chamfer {d1:g}' + (f'x{d2:g}' if abs(d1 - d2) > 1e-3 else ''), body=a.body,
                        edges=edges, distance=float(d1), skipFailing=True)
            if abs(d1 - d2) > 1e-3:
                feat.update(mode='twoDistances', distance2=float(d2))
        else:
            _, r = key
            print(f'round R{fmt_num(r)}: {len(bs)} edges')
            feat = dict(kind='fillet', name=f'Round R{r:g}', body=a.body, edges=edges, radius=float(r), skipFailing=True)
        for b in bs:
            print(f'    face {b["face"]} between {b["A"]}:{fs.prims[b["A"]]["kind"]} and {b["B"]}:{fs.prims[b["B"]]["kind"]}'
                  f'  edge middle {np.round(b["at"], 4).tolist()}' + (f'  dA {b["dA"]:.4f} dB {b["dB"]:.4f}' if b['kind'] == 'chamfer' else f'  r {b["r"]:.4f}'))
        steps.append(dict(name='reverse.feature.add', input=dict(feature=feat)))
    for i, why in unread:
        b0, b1 = fs.prims[i]['bbox']
        print(f'unread: face {i} {why}, box {np.round(b0, 3).tolist()}..{np.round(b1, 3).tolist()}')
    out = a.out or os.path.join(a.data, 'blends.json')
    json.dump(dict(steps=steps), open(out, 'w'))
    print(f'wrote {out}: {len(steps)} features, {len(found)} edges')


if __name__ == '__main__':
    main()
