import math

import numpy as np

from .error import SSKError
from .vecmath import (
    vec3, normalize, rotation_matrix_xyz, cubic_bezier, cubic_bezier_deriv,
    solve_transition, minimal_rotation, interpolate_rotation,
    interpolate_size, project_onto_plane,
)


_DEFAULT_RESOLUTION = 32
_MIN_RESOLUTION = 3


def tessellate(piece: dict, *, resolution: int = _DEFAULT_RESOLUTION):
    resolution = _check_resolution(resolution)

    if len(piece['points']) == 1:
        return _point_defined(piece, resolution)
    return _path_defined(piece, resolution)


def _check_resolution(resolution: int) -> int:
    if isinstance(resolution, bool) or not isinstance(resolution, int):
        raise SSKError("resolution must be an integer")
    if resolution < _MIN_RESOLUTION:
        raise SSKError(f"resolution must be >= {_MIN_RESOLUTION}")
    return resolution


def _eff_size(pt: dict, piece: dict) -> tuple:
    s = pt.get('size', piece['size'])
    return (float(s['x']), float(s['y']), float(s['z']))


def _eff_rot(pt: dict, piece: dict) -> tuple:
    r = pt.get('rotation', piece.get('rotation', {'x': 0.0, 'y': 0.0, 'z': 0.0}))
    return (float(r['x']), float(r['y']), float(r['z']))


def _degenerate(sx, sy, sz) -> bool:
    return sum(1 for v in (sx, sy, sz) if v == 0.0) >= 2


def _cross_n(piece: dict, resolution: int) -> int:
    return piece.get('sides', resolution) if piece['shape'] == 'ngon' else resolution


# point-defined piece  (spec/geometry/SPEC.md 8.2)

def _point_defined(piece: dict, resolution: int):
    pt = piece['points'][0]
    sx, sy, sz = _eff_size(pt, piece)
    if _degenerate(sx, sy, sz):
        return None, None
    pos = vec3(pt['x'], pt['y'], pt['z'])
    R = rotation_matrix_xyz(*_eff_rot(pt, piece))
    if piece['shape'] == 'circle':
        return _ellipsoid(pos, sx, sy, sz, R, resolution)
    return _bipyramid(pos, sx, sy, sz, R, piece['sides'])


def _ellipsoid(c, sx, sy, sz, R, n):
    n_lat, n_lon = max(4, n // 2), max(6, n)
    vs = [c + R @ vec3(0, 0, sz)]
    for i in range(1, n_lat):
        phi = math.pi * i / n_lat
        sp, cp = math.sin(phi), math.cos(phi)
        for j in range(n_lon):
            th = 2 * math.pi * j / n_lon
            vs.append(c + R @ vec3(sx * sp * math.cos(th),
                                   sy * sp * math.sin(th), sz * cp))
    vs.append(c + R @ vec3(0, 0, -sz))

    fs = []
    for j in range(n_lon):
        fs.append([0, 1 + j, 1 + (j + 1) % n_lon])
    for i in range(n_lat - 2):
        a0, b0 = 1 + i * n_lon, 1 + (i + 1) * n_lon
        for j in range(n_lon):
            jn = (j + 1) % n_lon
            fs.append([a0 + j, b0 + j, a0 + jn])
            fs.append([a0 + jn, b0 + j, b0 + jn])
    bot = 1 + (n_lat - 1) * n_lon
    last = 1 + (n_lat - 2) * n_lon
    for j in range(n_lon):
        fs.append([last + j, bot, last + (j + 1) % n_lon])
    return np.array(vs, dtype=np.float64), np.array(fs, dtype=np.int32)


def _bipyramid(c, sx, sy, sz, R, sides):
    vs = [c + R @ vec3(0, 0, sz), c + R @ vec3(0, 0, -sz)]
    for i in range(sides):
        a = 2 * math.pi * i / sides
        vs.append(c + R @ vec3(sx * math.cos(a), sy * math.sin(a), 0))
    fs = []
    for i in range(sides):
        n = (i + 1) % sides
        fs.append([0, 2 + i, 2 + n])
        fs.append([1, 2 + n, 2 + i])
    return np.array(vs, dtype=np.float64), np.array(fs, dtype=np.int32)


# path-defined piece  (spec/geometry/SPEC.md 8.1)

def _path_defined(piece: dict, resolution: int):
    points = piece['points']
    cn = _cross_n(piece, resolution)

    segs = [s for i in range(len(points) - 1)
            if (s := _seg(points, i, piece, resolution)) is not None]
    if not segs:
        return None, None

    rings = _eval_path(segs, piece, cn)
    if len(rings) < 2:
        return None, None

    body_v = []
    for r in rings:
        body_v.extend(r['v'])
    verts = np.array(body_v, dtype=np.float64)

    faces = []
    nr = len(rings)
    for i in range(nr - 1):
        a0, b0 = i * cn, (i + 1) * cn
        for j in range(cn):
            jn = (j + 1) % cn
            faces.append([a0 + j, a0 + jn, b0 + jn])
            faces.append([a0 + j, b0 + jn, b0 + j])

    for ring, rbase, start in [(rings[0], 0, True),
                                (rings[-1], (nr - 1) * cn, False)]:
        cap = _cap(ring, piece, cn, start, resolution)
        if cap is None:
            continue
        cv, cf = cap
        off = len(verts)
        if len(cv):
            verts = np.vstack([verts, cv])
        for f in cf:
            faces.append([f[0] + off, f[1] + off, f[2] + off])
        _connect_cap(faces, cv, off, rbase, cn, start)

    if not faces:
        return None, None
    return verts, np.array(faces, dtype=np.int32)


def _seg(points, i, piece, resolution: int):

    p0 = vec3(points[i]['x'], points[i]['y'], points[i]['z'])
    p3 = vec3(points[i + 1]['x'], points[i + 1]['y'], points[i + 1]['z'])

    co = points[i].get('curve_out')
    p1 = vec3(co['x'], co['y'], co['z']) if co else p0.copy()
    ci = points[i + 1].get('curve_in')
    p2 = vec3(ci['x'], ci['y'], ci['z']) if ci else p3.copy()

    linear = np.allclose(p1, p0) and np.allclose(p2, p3)

    # reject degenerate segments (7.1)
    if not any(np.linalg.norm(cubic_bezier_deriv(p0, p1, p2, p3, t)) > 1e-12
               for t in (0, .25, .5, .75, 1)):
        return None

    s0, s1 = _eff_size(points[i], piece), _eff_size(points[i + 1], piece)
    r0, r1 = _eff_rot(points[i], piece),  _eff_rot(points[i + 1], piece)

    to = points[i].get('transition_out')
    ti = points[i + 1].get('transition_in')
    t1 = (to['x'], to['y']) if to else (1/3, 1/3)
    t2 = (ti['x'], ti['y']) if ti else (2/3, 2/3)
    has_t = to is not None or ti is not None

    steps = resolution if not linear else max(1, resolution // 4)

    def pos(u):
        if linear:
            return (1.0 - u) * p0 + u * p3
        return cubic_bezier(p0, p1, p2, p3, u)

    _lin_dir = p3 - p0

    def tan(u):
        if linear:
            return _lin_dir
        d = cubic_bezier_deriv(p0, p1, p2, p3, u)
        if np.linalg.norm(d) < 1e-12:
            for dt in (.01, -.01, .05, -.05, .1, -.1):
                d2 = cubic_bezier_deriv(p0, p1, p2, p3, max(0, min(1, u + dt)))
                if np.linalg.norm(d2) > 1e-12:
                    return d2
        return d

    def _v(u):
        return solve_transition(t1, t2, u) if has_t else u

    def size(u):
        v = _v(u)
        return interpolate_size({'x': s0[0], 'y': s0[1], 'z': s0[2]},
                                {'x': s1[0], 'y': s1[1], 'z': s1[2]}, v)

    def rot(u):
        v = _v(u)
        return interpolate_rotation({'x': r0[0], 'y': r0[1], 'z': r0[2]},
                                    {'x': r1[0], 'y': r1[1], 'z': r1[2]}, v)

    return {'n': steps, 'pos': pos, 'tan': tan, 'size': size, 'rot': rot}


def _eval_path(segs, piece, cn):

    rings = []
    pf = pt = None  # previous frame, previous tangent

    for si, seg in enumerate(segs):
        for step in range(seg['n'] + 1):
            if si > 0 and step == 0:
                continue
            u = step / seg['n']
            p = seg['pos'](u)
            t_raw = seg['tan'](u)
            if np.linalg.norm(t_raw) < 1e-12:
                continue
            t = normalize(t_raw)
            sz = seg['size'](u)
            is_endpoint = (si == 0 and step == 0) or (si == len(segs) - 1 and step == seg['n'])
            if not is_endpoint and _degenerate(*sz):
                continue

            Rr = rotation_matrix_xyz(*seg['rot'](u))
            if pf is None:
                frame = _init_frame(t, Rr)
            else:
                frame = _transport(pf, pt, t, Rr)
            pf, pt = frame, t

            rv = _cross(p, frame, sz, piece['shape'], cn)
            rings.append({'pos': p, 'frame': frame, 'size': sz,
                          'rot': seg['rot'](u), 'v': rv})
    return rings


# frame construction  (spec/geometry/SPEC.md 9.1)

def _init_frame(tangent, R_rot):
    lz = tangent
    rx = R_rot @ vec3(1, 0, 0)
    px = project_onto_plane(rx, lz)
    if np.linalg.norm(px) > 1e-10:
        lx = normalize(px)
    else:
        lx = normalize(project_onto_plane(R_rot @ vec3(0, 1, 0), lz))
    ly = normalize(np.cross(lz, lx))
    return np.column_stack([lx, ly, lz])


def _transport(prev, pt, ct, R_rot):
    d = float(np.dot(pt, ct))
    if d > 1.0 - 1e-10:
        f = prev.copy(); f[:, 2] = ct; return f
    if d < -1.0 + 1e-10:
        return _init_frame(ct, R_rot)
    R = minimal_rotation(pt, ct)
    return np.column_stack([normalize(R @ prev[:, 0]),
                            normalize(R @ prev[:, 1]), ct])


def _cross(pos, frame, size, shape, n):
    sx, sy = size[0], size[1]
    lx, ly = frame[:, 0], frame[:, 1]
    return [pos + sx * math.cos(2 * math.pi * i / n) * lx
                + sy * math.sin(2 * math.pi * i / n) * ly
            for i in range(n)]


# caps  (spec/geometry/SPEC.md 8.3)

def _cap(ring, piece, cn, is_start, resolution: int):
    sz = ring['size'][2]
    if sz == 0.0:
        return np.array([ring['pos']], dtype=np.float64), []
    return _rounded_cap(ring, piece, cn, is_start, resolution)


def _rounded_cap(ring, piece, cn, is_start, resolution: int):
    pos = ring['pos']
    lx, ly, lz = ring['frame'][:, 0], ring['frame'][:, 1], ring['frame'][:, 2]
    sx, sy, sz = ring['size']
    d = -1.0 if is_start else 1.0

    if piece['shape'] == 'circle':
        nl = max(2, resolution // 4)
        vs = [pos + d * sz * lz]
        for i in range(1, nl):
            phi = math.pi / 2 * i / nl
            sp, cp = math.sin(phi), math.cos(phi)
            for j in range(cn):
                a = 2 * math.pi * j / cn
                vs.append(pos + sx * sp * math.cos(a) * lx
                              + sy * sp * math.sin(a) * ly
                              + sz * cp * d * lz)
        fs = []
        for j in range(cn):
            jn = (j + 1) % cn
            fs.append([0, 1 + jn, 1 + j] if is_start else [0, 1 + j, 1 + jn])
        for i in range(nl - 2):
            a0, b0 = 1 + i * cn, 1 + (i + 1) * cn
            for j in range(cn):
                jn = (j + 1) % cn
                if is_start:
                    fs.append([a0 + j, a0 + jn, b0 + jn])
                    fs.append([a0 + j, b0 + jn, b0 + j])
                else:
                    fs.append([a0 + j, b0 + j, b0 + jn])
                    fs.append([a0 + j, b0 + jn, a0 + jn])
        return np.array(vs, dtype=np.float64), fs

    # ngon half-bipyramid: apex only
    return np.array([pos + d * sz * lz], dtype=np.float64), []


def _connect_cap(faces, cv, off, rbase, cn, is_start):
    nv = len(cv)
    if nv == 1:
        apex = off
        for j in range(cn):
            jn = (j + 1) % cn
            a, b = rbase + j, rbase + jn
            faces.append([apex, b, a] if is_start else [apex, a, b])
        return
    nr = (nv - 1) // cn
    if nr > 0:
        lr = off + 1 + (nr - 1) * cn
        for j in range(cn):
            jn = (j + 1) % cn
            a, b, c, d = lr + j, lr + jn, rbase + jn, rbase + j
            if is_start:
                faces.append([a, b, c]); faces.append([a, c, d])
            else:
                faces.append([a, d, c]); faces.append([a, c, b])
    else:
        apex = off
        for j in range(cn):
            jn = (j + 1) % cn
            a, b = rbase + j, rbase + jn
            faces.append([apex, b, a] if is_start else [apex, a, b])
