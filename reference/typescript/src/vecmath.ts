import type { Vec2, Vec3 } from './types.js';

export type V3 = [number, number, number];
export type Mat3 = [V3, V3, V3];

export function vec3(x: number, y: number, z: number): V3 {
  return [x, y, z];
}

export function add(a: V3, b: V3): V3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a: V3, b: V3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(v: V3, s: number): V3 {
  return [v[0] * s, v[1] * s, v[2] * s];
}

export function dot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: V3, b: V3): V3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function norm(v: V3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

export function normalize(v: V3): V3 {
  const n = norm(v);
  return n > 1e-12 ? scale(v, 1 / n) : [0, 0, 0];
}

export function projectOntoPlane(v: V3, normal: V3): V3 {
  return sub(v, scale(normal, dot(v, normal)));
}

export function matVec(m: Mat3, v: V3): V3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

export function matMul(a: Mat3, b: Mat3): Mat3 {
  return [0, 1, 2].map((i) => [0, 1, 2].map((j) =>
    a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j],
  ) as V3) as Mat3;
}

export function rotationMatrixXYZ(rx: number, ry: number, rz: number): Mat3 {
  rx = rx * Math.PI / 180;
  ry = ry * Math.PI / 180;
  rz = rz * Math.PI / 180;
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  return [
    [cy * cz, sx * sy * cz - cx * sz, cx * sy * cz + sx * sz],
    [cy * sz, sx * sy * sz + cx * cz, cx * sy * sz - sx * cz],
    [-sy, sx * cy, cx * cy],
  ];
}

export function minimalRotation(vFrom: V3, vTo: V3): Mat3 {
  const c = dot(vFrom, vTo);
  if (c > 1.0 - 1e-12) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  if (c < -1.0 + 1e-12) {
    let perp: V3 = [1, 0, 0];
    if (Math.abs(dot(vFrom, perp)) > 0.9) perp = [0, 1, 0];
    const axis = normalize(cross(vFrom, perp));
    return [0, 1, 2].map((i) => [0, 1, 2].map((j) =>
      2 * axis[i] * axis[j] - (i === j ? 1 : 0),
    ) as V3) as Mat3;
  }
  let axis = cross(vFrom, vTo);
  const s = norm(axis);
  axis = scale(axis, 1 / s);
  const k: Mat3 = [[0, -axis[2], axis[1]], [axis[2], 0, -axis[0]], [-axis[1], axis[0], 0]];
  const k2 = matMul(k, k);
  return [0, 1, 2].map((i) => [0, 1, 2].map((j) =>
    (i === j ? 1 : 0) + s * k[i][j] + (1 - c) * k2[i][j],
  ) as V3) as Mat3;
}

export function cubicBezier(p0: V3, p1: V3, p2: V3, p3: V3, t: number): V3 {
  const u = 1 - t;
  return add(add(scale(p0, u ** 3), scale(p1, 3 * u ** 2 * t)), add(scale(p2, 3 * u * t ** 2), scale(p3, t ** 3)));
}

export function cubicBezierDeriv(p0: V3, p1: V3, p2: V3, p3: V3, t: number): V3 {
  const u = 1 - t;
  return add(add(scale(sub(p1, p0), 3 * u ** 2), scale(sub(p2, p1), 6 * u * t)), scale(sub(p3, p2), 3 * t ** 2));
}

export function solveTransition(t1: [number, number], t2: [number, number], uTarget: number): number {
  if (uTarget <= 0) return 0;
  if (uTarget >= 1) return 1;
  let t = uTarget;
  for (let i = 0; i < 50; i += 1) {
    const u = 1 - t;
    const x = 3 * u ** 2 * t * t1[0] + 3 * u * t ** 2 * t2[0] + t ** 3;
    const dx = 3 * u ** 2 * t1[0] + 6 * u * t * (t2[0] - t1[0]) + 3 * t ** 2 * (1 - t2[0]);
    if (Math.abs(dx) < 1e-15) break;
    const next = Math.max(0, Math.min(1, t - (x - uTarget) / dx));
    if (Math.abs(next - t) < 1e-12) {
      t = next;
      break;
    }
    t = next;
  }
  const u = 1 - t;
  return 3 * u ** 2 * t * t1[1] + 3 * u * t ** 2 * t2[1] + t ** 3;
}

function shortestAngleDelta(a: number, b: number): number {
  const d = ((b - a) % 360 + 360) % 360;
  return d > 180 ? d - 360 : d;
}

export function interpolateRotation(r0: Vec3, r1: Vec3, v: number): [number, number, number] {
  return [
    r0.x + shortestAngleDelta(r0.x, r1.x) * v,
    r0.y + shortestAngleDelta(r0.y, r1.y) * v,
    r0.z + shortestAngleDelta(r0.z, r1.z) * v,
  ];
}

export function interpolateSize(s0: Vec3, s1: Vec3, v: number): [number, number, number] {
  return [
    Math.max(0, s0.x + (s1.x - s0.x) * v),
    Math.max(0, s0.y + (s1.y - s0.y) * v),
    Math.max(0, s0.z + (s1.z - s0.z) * v),
  ];
}

export function sskToGltf(vertices: number[][]): number[][] {
  return vertices.map((vertex) => [vertex[0] * 0.001, vertex[2] * 0.001, -vertex[1] * 0.001]);
}

export function vec3Object(v: V3): Vec3 {
  return { x: v[0], y: v[1], z: v[2] };
}

export function vec2Object(v: [number, number]): Vec2 {
  return { x: v[0], y: v[1] };
}
