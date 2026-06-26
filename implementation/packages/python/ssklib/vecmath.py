"""Vector math, rotation matrices, Bezier curves, and coordinate conversion."""

import math

import numpy as np
from numpy.typing import NDArray


# vectors

def vec3(x: float, y: float, z: float) -> NDArray:
    return np.array([x, y, z], dtype=np.float64)


def normalize(v: NDArray) -> NDArray:
    n = np.linalg.norm(v)
    return v / n if n > 1e-12 else np.zeros_like(v)


def project_onto_plane(v: NDArray, normal: NDArray) -> NDArray:
    return v - np.dot(v, normal) * normal


# rotation  (spec/geometry/SPEC.md 9)

def rotation_matrix_xyz(rx: float, ry: float, rz: float) -> NDArray:

    rx, ry, rz = math.radians(rx), math.radians(ry), math.radians(rz)
    cx, sx = math.cos(rx), math.sin(rx)
    cy, sy = math.cos(ry), math.sin(ry)
    cz, sz = math.cos(rz), math.sin(rz)
    return np.array([
        [cy * cz, sx * sy * cz - cx * sz, cx * sy * cz + sx * sz],
        [cy * sz, sx * sy * sz + cx * cz, cx * sy * sz - sx * cz],
        [-sy,     sx * cy,                cx * cy               ],
    ], dtype=np.float64)


def minimal_rotation(v_from: NDArray, v_to: NDArray) -> NDArray:

    c = float(np.dot(v_from, v_to))
    if c > 1.0 - 1e-12:
        return np.eye(3, dtype=np.float64)
    if c < -1.0 + 1e-12:
        perp = vec3(1, 0, 0)
        if abs(np.dot(v_from, perp)) > 0.9:
            perp = vec3(0, 1, 0)
        axis = normalize(np.cross(v_from, perp))
        return 2.0 * np.outer(axis, axis) - np.eye(3, dtype=np.float64)
    axis = np.cross(v_from, v_to)
    s = np.linalg.norm(axis)
    axis /= s
    K = np.array([
        [0, -axis[2], axis[1]],
        [axis[2], 0, -axis[0]],
        [-axis[1], axis[0], 0],
    ], dtype=np.float64)
    return np.eye(3, dtype=np.float64) + s * K + (1 - c) * (K @ K)


# cubic Bezier  (spec/geometry/SPEC.md 7)

def cubic_bezier(p0: NDArray, p1: NDArray, p2: NDArray, p3: NDArray,
                 t: float) -> NDArray:
    u = 1.0 - t
    return u**3 * p0 + 3 * u**2 * t * p1 + 3 * u * t**2 * p2 + t**3 * p3


def cubic_bezier_deriv(p0: NDArray, p1: NDArray, p2: NDArray, p3: NDArray,
                       t: float) -> NDArray:
    u = 1.0 - t
    return 3 * u**2 * (p1 - p0) + 6 * u * t * (p2 - p1) + 3 * t**2 * (p3 - p2)


# transition curves  (spec/geometry/SPEC.md 10.2)

def solve_transition(t1: tuple, t2: tuple, u_target: float) -> float:

    if u_target <= 0.0:
        return 0.0
    if u_target >= 1.0:
        return 1.0

    t = u_target
    for _ in range(50):
        u = 1.0 - t
        x = 3 * u**2 * t * t1[0] + 3 * u * t**2 * t2[0] + t**3
        dx = 3 * u**2 * t1[0] + 6 * u * t * (t2[0] - t1[0]) + 3 * t**2 * (1 - t2[0])
        if abs(dx) < 1e-15:
            break
        t_new = max(0.0, min(1.0, t - (x - u_target) / dx))
        if abs(t_new - t) < 1e-12:
            t = t_new
            break
        t = t_new

    u = 1.0 - t
    return 3 * u**2 * t * t1[1] + 3 * u * t**2 * t2[1] + t**3


# interpolation  (spec/geometry/SPEC.md 9.2, 10.1)

def _shortest_angle_delta(a: float, b: float) -> float:
    d = (b - a) % 360.0
    return d - 360.0 if d > 180.0 else d


def interpolate_rotation(r0: dict, r1: dict, v: float) -> tuple:

    return (
        r0['x'] + _shortest_angle_delta(r0['x'], r1['x']) * v,
        r0['y'] + _shortest_angle_delta(r0['y'], r1['y']) * v,
        r0['z'] + _shortest_angle_delta(r0['z'], r1['z']) * v,
    )


def interpolate_size(s0: dict, s1: dict, v: float) -> tuple:

    return (
        max(0.0, s0['x'] + (s1['x'] - s0['x']) * v),
        max(0.0, s0['y'] + (s1['y'] - s0['y']) * v),
        max(0.0, s0['z'] + (s1['z'] - s0['z']) * v),
    )


# coordinate conversion  (SSK Z-up mm -> glTF Y-up meters)

def ssk_to_gltf(vertices: NDArray) -> NDArray:
    out = np.empty_like(vertices)
    out[:, 0] = vertices[:, 0] * 0.001       # X stays
    out[:, 1] = vertices[:, 2] * 0.001       # Y ← Z
    out[:, 2] = -vertices[:, 1] * 0.001      # Z ← −Y
    return out
