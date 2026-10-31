# SPDX-License-Identifier: AGPL-3.0-only
"""First look at a CAD-exported STL: its B-rep faces read exactly, grouped the way a rebuild needs them.

    python analyze.py part.stl [--data data] [--json]

Writes <data>/V.npy, F.npy, piece.npy (for the other scripts), <data>/faces.npy (face id of each
triangle) and <data>/faces.json (every face: kind, exact parameters, area, box, neighbours), and
prints:
  - mesh health, pieces and their volumes
  - the frame: whether the faces line up with the world axes, and if not the rotation that would
    (build in the part's own frame, then turn the result back with one moveBody)
  - per world axis, how much of the surface is "2.5D along it": caps square to it (with their
    levels, the design heights) and walls parallel to it (planes, cylinders, tangent chains)
  - axes: every cylinder and cone grouped by common axis line - a hole with its chamfers and
    counterbore, a boss, a pin - with radius, convex/concave, extent along the axis and sweep
  - the faces that are none of that: oblique planes, freeform (B-spline) faces, tori, spheres
Numbers are printed with the round value they read as: 12.00002 (=12).
"""
import argparse, json, os, pickle, sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cadlib import Faces, load_stl, volume, world_axis, fmt_num, nominal, AXES, frame


def jsonable(x):
    if isinstance(x, dict):
        return {k: jsonable(v) for k, v in x.items() if k != 'dead'}
    if isinstance(x, (list, tuple)):
        return [jsonable(v) for v in x]
    if isinstance(x, np.ndarray):
        return [jsonable(v) for v in x.tolist()]
    if isinstance(x, (np.floating, float)):
        return round(float(x), 7)
    if isinstance(x, (np.integer,)):
        return int(x)
    if isinstance(x, np.bool_):
        return bool(x)
    return x


def part_frame(fs):
    """The three directions the planar area lines up with, and whether they are the world axes."""
    dirs = []
    for i, p in enumerate(fs.prims):
        if p['kind'] == 'plane':
            dirs.append((np.abs(p['n']) if True else p['n'], fs.area[i], p['n']))
    if not dirs:
        return None
    # area-weighted clusters of plane normals (sign folded)
    clusters = []
    for _, a, n in sorted(dirs, key=lambda d: -d[1]):
        n = n * np.sign(n[np.argmax(np.abs(n))])
        for c in clusters:
            if abs(c['n'] @ n) > np.cos(np.radians(0.05)):
                c['a'] += a; break
        else:
            clusters.append(dict(n=n, a=a))
    clusters.sort(key=lambda c: -c['a'])
    e1 = clusters[0]['n']
    tot = sum(c['a'] for c in clusters)
    # a second direction must carry some of the part: a gear flank's normal is no frame
    e2 = next((c['n'] for c in clusters[1:] if abs(c['n'] @ e1) < np.sin(np.radians(0.05)) and c['a'] > 0.02 * tot), None)
    return clusters, e1, e2


def axis_groups(fs, tol=1e-3):
    """Cylinders and cones grouped by axis line."""
    groups = []
    for i, p in enumerate(fs.prims):
        if p['kind'] not in ('cylinder', 'cone'):
            continue
        a = p['axis']; o = p['c'] if p['kind'] == 'cylinder' else p['apex']
        w = world_axis(a, 3e-4)       # a cone's fitted axis is good to ~1e-4 rad
        if w:
            a = np.eye(3)[AXES.index(w)] * np.sign(a[AXES.index(w)])
        for g in groups:
            if abs(abs(g['a'] @ a) - 1) < 1e-6:
                d = o - g['o']; d -= (d @ g['a']) * g['a']
                if np.linalg.norm(d) < tol:
                    if world_axis(g['a']) is None and world_axis(a):
                        g['a'] = a
                    g['faces'].append(i); break
        else:
            groups.append(dict(a=a, o=o, faces=[i]))
    return groups


def axis_point(a, o):
    """The axis line's point in the plane square to it through the origin, as the two coordinates
    a sketch would use (for a world axis: the other two world coordinates)."""
    o = o - (o @ a) * a
    w = world_axis(a)
    if w:
        return w, [float(o[j]) for j in range(3) if AXES[j] != w]
    return None, o.tolist()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('stl')
    ap.add_argument('--data', default='data')
    ap.add_argument('--json', action='store_true', help='print faces.json too')
    a = ap.parse_args()
    os.makedirs(a.data, exist_ok=True)
    V, F = load_stl(a.stl)
    fs = Faces(V, F)
    np.save(os.path.join(a.data, 'V.npy'), V); np.save(os.path.join(a.data, 'F.npy'), F)
    np.save(os.path.join(a.data, 'piece.npy'), fs.piece); np.save(os.path.join(a.data, 'faces.npy'), fs.fid)
    with open(os.path.join(a.data, 'faces.pkl'), 'wb') as f:
        pickle.dump(fs, f)

    lo, hi = V.min(0), V.max(0)
    print(f'{len(V)} vertices, {len(F)} triangles, open edges {fs.open_edges}'
          f'{" (T-junction cracks: harmless for reading)" if fs.open_edges else " (closed)"}')
    print(f'box {lo.round(4).tolist()} .. {hi.round(4).tolist()}  size {(hi - lo).round(4).tolist()}')
    for pc in np.unique(fs.piece):
        Fp = F[fs.piece == pc]
        print(f'  piece {pc}: {len(Fp)} tris, volume {volume(V, Fp):.3f}')

    # ---- frame
    fr = part_frame(fs)
    aligned = True
    if fr:
        clusters, e1, e2 = fr
        aligned = world_axis(e1, 1e-6) and (e2 is None or world_axis(e2, 1e-6))
        print('\nframe: plane normals (area share): ' + ', '.join(
            f"{np.round(c['n'], 5).tolist()} {100 * c['a'] / fs.area.sum():.1f}%" for c in clusters[:6]))
        if aligned:
            print('  the main faces are square to the world axes: build in the STL frame as it is')
        else:
            print('  the main faces are NOT square to the world axes: frame.py turns the mesh into its own frame')

    # ---- per-axis 2.5D
    print('\nper axis: caps square to it (levels = design heights) and walls along it, % of area')
    total = fs.area.sum()
    share = {}
    for j, ax in enumerate(AXES):
        e = np.eye(3)[j]
        caps, walls = {}, 0.0
        for i, p in enumerate(fs.prims):
            k = p['kind']
            if k == 'plane':
                c = p['n'] @ e
                if abs(abs(c) - 1) < 1e-9:
                    lv = round(float(p['d'] * np.sign(c)), 5)
                    caps.setdefault(lv, [0.0, 0, 0]); caps[lv][0] += fs.area[i]
                    caps[lv][1 if c > 0 else 2] += 1
                elif abs(c) < 1e-9:
                    walls += fs.area[i]
            elif k in ('cylinder', 'chain') and abs(abs(p['axis'] @ e) - 1) < 1e-9:
                walls += fs.area[i]
        cap_a = sum(v[0] for v in caps.values())
        share[ax] = (cap_a + walls) / total
        print(f'  {ax}: caps {100 * cap_a / total:5.1f}%  walls {100 * walls / total:5.1f}%  '
              f'-> 2.5D along {ax}: {100 * (cap_a + walls) / total:5.1f}%')
        if caps:
            lv = sorted(caps)
            print('     levels: ' + ', '.join(f"{fmt_num(v)}[{'+' * caps[v][1]}{'-' * caps[v][2]} {caps[v][0]:.1f}]" for v in lv))

    # ---- axes
    print('\naxes (cylinders and cones on one axis line; hole = concave, boss = convex; h along the axis):')
    groups = axis_groups(fs)
    groups.sort(key=lambda g: -sum(fs.area[i] for i in g['faces']))
    for gi, g in enumerate(groups):
        w, pt = axis_point(g['a'], g['o'])
        where = f"{w} axis at {[fmt_num(v) for v in pt]}" if w else f"axis {np.round(g['a'], 6).tolist()} through {np.round(pt, 5).tolist()}"
        print(f'  A{gi}: {where}')
        for i in sorted(g['faces'], key=lambda i: fs.prims[i].get('h', (0, 0))[0]):
            p = fs.prims[i]
            h0, h1 = p['h']
            sw = p['sweep']
            tag = 'boss' if p['convex'] else 'hole'
            if p['kind'] == 'cylinder':
                print(f'      cyl  {tag} R {fmt_num(p["r"])}  h {h0:.4f}..{h1:.4f}  sweep {sw:.1f}  area {fs.area[i]:.2f}  [face {i}]')
            else:
                # radii at both ends from the apex distance
                t = np.tan(p['half'])
                print(f'      cone {tag} half-angle {np.degrees(p["half"]):.4f}  r {abs(h0) * t:.4f}..{abs(h1) * t:.4f}'
                      f'  h {h0:.4f}..{h1:.4f} (from apex)  sweep {sw:.1f}  area {fs.area[i]:.2f}  [face {i}]')

    # ---- what to build the body with
    turned = None
    for g in groups:
        w = world_axis(g['a'])
        if not w:
            continue
        e = g['a']
        cov = sum(fs.area[i] for i in g['faces'])
        for i, p in enumerate(fs.prims):
            if p['kind'] == 'plane' and abs(abs(p['n'] @ e) - 1) < 1e-6:
                cov += fs.area[i]
            elif p['kind'] in ('torus', 'sphere'):
                c = p['c'] - g['o']; c -= (c @ e) * e
                if np.linalg.norm(c) < 1e-3:
                    cov += fs.area[i]
        if turned is None or cov > turned[0]:
            turned = (cov, w, g)
    best = max(share, key=share.get) if share else None
    print()
    if fr and not aligned:
        print('recommend: frame.py first - the part stands turned off the world axes; then analyze.py data/local.stl')
    elif turned and turned[0] / total > 0.8 and turned[0] / total >= share.get(best, 0) - 0.02:
        w, g = turned[1], turned[2]
        pt = [round(float(g['o'][k]), 5) for k in range(3) if AXES[k] != w]
        print(f'recommend: revolve.py --axis {w} --at {pt[0]},{pt[1]}  ({100 * turned[0] / total:.0f} % of the area turned about it), '
              f'then holes.py --main {w}')
    elif best:
        print(f'recommend: slabs.py --axis {best}  ({100 * share[best]:.0f} % of the area 2.5D along it), then holes.py --main {best}')

    # ---- the rest
    print('\nother faces:')
    for i, p in enumerate(fs.prims):
        k = p['kind']
        b0, b1 = p['bbox']
        if k == 'plane' and not world_axis(p['n'], 1e-9):
            print(f'  plane oblique n {np.round(p["n"], 6).tolist()} d {p["d"]:.5f} area {fs.area[i]:.2f} box {b0.round(3).tolist()}..{b1.round(3).tolist()} [face {i}]')
        elif k == 'chain' and not world_axis(p['axis'], 1e-9):
            print(f'  chain along {np.round(p["axis"], 6).tolist()} area {fs.area[i]:.2f} box {b0.round(3).tolist()}..{b1.round(3).tolist()} [face {i}]')
        elif k in ('freeform', 'torus', 'sphere'):
            extra = ''
            if k == 'torus':
                extra = f' R {fmt_num(p["R"])} r {fmt_num(p["r"])} axis {np.round(p["axis"], 5).tolist()} c {np.round(p["c"], 4).tolist()}'
            if k == 'sphere':
                extra = f' R {fmt_num(p["r"])} c {np.round(p["c"], 4).tolist()}'
            print(f'  {k}{extra} area {fs.area[i]:.2f} box {b0.round(3).tolist()}..{b1.round(3).tolist()} [face {i}]')

    faces = []
    for i, p in enumerate(fs.prims):
        faces.append(dict(id=i, area=fs.area[i], piece=fs.fpiece[i], neighbours=fs.neigh[i], **p))
    adj = [dict(a=k[0], b=k[1], **v) for k, v in fs.adj.items()]
    json.dump(jsonable(dict(faces=faces, adjacency=adj)), open(os.path.join(a.data, 'faces.json'), 'w'))
    print(f'\nwrote {a.data}/faces.json ({len(faces)} faces), faces.npy and faces.pkl (for slabs.py and the rest)')


if __name__ == '__main__':
    main()
