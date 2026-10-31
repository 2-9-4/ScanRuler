# SPDX-License-Identifier: AGPL-3.0-only
"""The part's own frame, when its faces are not square to the world axes: an STL exported from an
assembly in place, a part laid at an angle on a print bed.

    python frame.py part.stl [--data data] [--out data/local.stl]

Reads the directions of the part's design from its faces - plane normals, cylinder and cone axes,
by area - and takes the three that stand square to one another and carry the most of it. Turned
onto the world axes the nearest way (the smallest turn), they give the frame the part was drawn in.
Writes the mesh turned into that frame (<out>, and data/frame.json), and prints the moveBody that
turns the finished body back onto the STL:

    { "kind": "moveBody", "bodies": [...], "rotate": [rx, ry, rz], "pivot": [0, 0, 0] }

Build the model from <out> (analyze.py <out>, slabs.py ...), add that moveBody last, and the STEP
lands on the original STL. When the faces are square to the world axes already it says so and
writes nothing.
"""
import argparse, json, os, sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cadlib import Faces, load_stl, save_stl


def directions(fs):
    """Area-weighted design directions (sign folded): plane normals, round faces' axes."""
    out = []
    for i, p in enumerate(fs.prims):
        if p['kind'] == 'plane':
            out.append((p['n'], fs.area[i]))
        elif p['kind'] in ('cylinder', 'cone', 'chain', 'torus'):
            out.append((p['axis'], fs.area[i]))
    clusters = []
    for d, a in sorted(out, key=lambda x: -x[1]):
        d = d / np.linalg.norm(d)
        for c in clusters:
            if abs(c['d'] @ d) > np.cos(np.radians(0.1)):
                s = np.sign(c['d'] @ d)
                c['sum'] += a * s * d; c['a'] += a
                break
        else:
            clusters.append(dict(d=d, sum=a * d, a=a))
    for c in clusters:
        c['d'] = c['sum'] / np.linalg.norm(c['sum'])
    return sorted(clusters, key=lambda c: -c['a'])


def frame_of(clusters):
    e1 = clusters[0]['d']
    tot = sum(c['a'] for c in clusters)
    # a second direction must carry some of the part: a sliver's normal is no frame
    e2 = next((c['d'] for c in clusters[1:] if abs(c['d'] @ e1) < np.sin(np.radians(0.1)) and c['a'] > 0.02 * tot), None)
    if e2 is None:
        # one direction only (a turned part): the second is the world axis nearest square to it
        ref = np.eye(3)[int(np.argmin(np.abs(e1)))]
        e2 = ref - (ref @ e1) * e1
    e2 = e2 - (e2 @ e1) * e1; e2 /= np.linalg.norm(e2)
    e3 = np.cross(e1, e2)
    # the three as columns, assigned to world axes and signed the way that turns the least
    E = np.c_[e1, e2, e3]
    best = None
    import itertools
    for perm in itertools.permutations(range(3)):
        for signs in itertools.product((1, -1), repeat=3):
            R = np.zeros((3, 3))
            for k in range(3):
                R[:, perm[k]] = signs[k] * E[:, k]
            if np.linalg.det(R) < 0:
                continue
            tr = np.trace(R)
            if best is None or tr > best[0]:
                best = (tr, R)
    return best[1]          # columns: the part's x, y, z in world coordinates


def euler_xyz(R):
    """rx, ry, rz (degrees) with R = Rz @ Ry @ Rx: turned about X, then Y, then Z."""
    ry = np.arcsin(-np.clip(R[2, 0], -1, 1))
    rx = np.arctan2(R[2, 1], R[2, 2])
    rz = np.arctan2(R[1, 0], R[0, 0])
    return np.degrees([rx, ry, rz])


def rot(rx, ry, rz):
    rx, ry, rz = np.radians([rx, ry, rz])
    X = np.array([[1, 0, 0], [0, np.cos(rx), -np.sin(rx)], [0, np.sin(rx), np.cos(rx)]])
    Y = np.array([[np.cos(ry), 0, np.sin(ry)], [0, 1, 0], [-np.sin(ry), 0, np.cos(ry)]])
    Z = np.array([[np.cos(rz), -np.sin(rz), 0], [np.sin(rz), np.cos(rz), 0], [0, 0, 1]])
    return Z @ Y @ X


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('stl')
    ap.add_argument('--data', default='data')
    ap.add_argument('--out')
    a = ap.parse_args()
    os.makedirs(a.data, exist_ok=True)
    V, F = load_stl(a.stl)
    fs = Faces(V, F)
    cl = directions(fs)
    tot = sum(c['a'] for c in cl)
    print('design directions (share of the area): ' + ', '.join(f"{np.round(c['d'], 6).tolist()} {100 * c['a'] / tot:.1f}%" for c in cl[:5]))
    R = frame_of(cl)
    ang = np.degrees(np.arccos(np.clip((np.trace(R) - 1) / 2, -1, 1)))
    if ang < 1e-4:
        print('the faces are square to the world axes: build in the STL frame as it is')
        return
    eu = euler_xyz(R)
    assert np.allclose(rot(*eu), R, atol=1e-9)
    out = a.out or os.path.join(a.data, 'local.stl')
    save_stl(out, V @ R, F)          # world -> part frame: v_local = R^T v
    json.dump(dict(R=R.tolist(), rotate=eu.tolist(), pivot=[0, 0, 0]), open(os.path.join(a.data, 'frame.json'), 'w'), indent=1)
    print(f'the part is turned {ang:.4f} deg off the world axes; its frame (columns x, y, z):\n{np.round(R, 8)}')
    print(f'wrote {out}: the mesh in its own frame - build from it')
    print(f'then turn the body back: {{ "kind": "moveBody", "bodies": [<body>], "rotate": {np.round(eu, 8).tolist()}, "pivot": [0, 0, 0] }}')


if __name__ == '__main__':
    main()
