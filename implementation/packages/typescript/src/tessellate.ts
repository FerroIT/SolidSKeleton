import { SSKError } from './error.js';
import type { MeshData, Point, ResolvedPiece, Vec3 } from './types.js';
import {
  add,
  cross,
  cubicBezier,
  cubicBezierDeriv,
  dot,
  interpolateRotation,
  interpolateSize,
  matVec,
  minimalRotation,
  normalize,
  norm,
  projectOntoPlane,
  rotationMatrixXYZ,
  scale,
  solveTransition,
  sub,
  type Mat3,
  type V3,
} from './vecmath.js';

const DEFAULT_RESOLUTION = 32;
const MIN_RESOLUTION = 3;

type Frame = { lx: V3; ly: V3; lz: V3 };
type Ring = { pos: V3; frame: Frame; size: [number, number, number]; rot: [number, number, number]; v: V3[] };
type Segment = {
  n: number;
  pos: (u: number) => V3;
  tan: (u: number) => V3;
  size: (u: number) => [number, number, number];
  rot: (u: number) => [number, number, number];
};

export function tessellate(piece: ResolvedPiece, options: { resolution?: number } = {}): MeshData | null {
  const resolution = checkResolution(options.resolution ?? DEFAULT_RESOLUTION);
  if (piece.points.length === 1) return pointDefined(piece, resolution);
  return pathDefined(piece, resolution);
}

function checkResolution(resolution: number): number {
  if (!Number.isInteger(resolution)) throw new SSKError('resolution must be an integer');
  if (resolution < MIN_RESOLUTION) throw new SSKError(`resolution must be >= ${MIN_RESOLUTION}`);
  return resolution;
}

function effectiveSize(point: Point, piece: ResolvedPiece): [number, number, number] {
  const size = point.size ?? piece.size;
  return [Number(size.x), Number(size.y), Number(size.z)];
}

function effectiveRotation(point: Point, piece: ResolvedPiece): [number, number, number] {
  const rotation = point.rotation ?? piece.rotation ?? { x: 0, y: 0, z: 0 };
  return [Number(rotation.x), Number(rotation.y), Number(rotation.z)];
}

function degenerate(sx: number, sy: number, sz: number): boolean {
  return [sx, sy, sz].filter((value) => value === 0).length >= 2;
}

function crossN(piece: ResolvedPiece, resolution: number): number {
  return piece.shape === 'ngon' ? piece.sides ?? resolution : resolution;
}

function pointDefined(piece: ResolvedPiece, resolution: number): MeshData | null {
  const point = piece.points[0];
  const [sx, sy, sz] = effectiveSize(point, piece);
  if (degenerate(sx, sy, sz)) return null;
  const pos: V3 = [point.x, point.y, point.z];
  const rotation = rotationMatrixXYZ(...effectiveRotation(point, piece));
  if (piece.shape === 'circle') return ellipsoid(pos, sx, sy, sz, rotation, resolution);
  return bipyramid(pos, sx, sy, sz, rotation, piece.sides!);
}

function ellipsoid(c: V3, sx: number, sy: number, sz: number, rotation: Mat3, n: number): MeshData {
  const nLat = Math.max(4, Math.floor(n / 2));
  const nLon = Math.max(6, n);
  const vertices: V3[] = [add(c, matVec(rotation, [0, 0, sz]))];
  for (let i = 1; i < nLat; i += 1) {
    const phi = Math.PI * i / nLat;
    const sp = Math.sin(phi);
    const cp = Math.cos(phi);
    for (let j = 0; j < nLon; j += 1) {
      const th = 2 * Math.PI * j / nLon;
      vertices.push(add(c, matVec(rotation, [sx * sp * Math.cos(th), sy * sp * Math.sin(th), sz * cp])));
    }
  }
  vertices.push(add(c, matVec(rotation, [0, 0, -sz])));

  const faces: number[][] = [];
  for (let j = 0; j < nLon; j += 1) faces.push([0, 1 + j, 1 + ((j + 1) % nLon)]);
  for (let i = 0; i < nLat - 2; i += 1) {
    const a0 = 1 + i * nLon;
    const b0 = 1 + (i + 1) * nLon;
    for (let j = 0; j < nLon; j += 1) {
      const jn = (j + 1) % nLon;
      faces.push([a0 + j, b0 + j, a0 + jn]);
      faces.push([a0 + jn, b0 + j, b0 + jn]);
    }
  }
  const bottom = 1 + (nLat - 1) * nLon;
  const last = 1 + (nLat - 2) * nLon;
  for (let j = 0; j < nLon; j += 1) faces.push([last + j, bottom, last + ((j + 1) % nLon)]);
  return { vertices, faces };
}

function bipyramid(c: V3, sx: number, sy: number, sz: number, rotation: Mat3, sides: number): MeshData {
  const vertices: V3[] = [add(c, matVec(rotation, [0, 0, sz])), add(c, matVec(rotation, [0, 0, -sz]))];
  for (let i = 0; i < sides; i += 1) {
    const angle = 2 * Math.PI * i / sides;
    vertices.push(add(c, matVec(rotation, [sx * Math.cos(angle), sy * Math.sin(angle), 0])));
  }
  const faces: number[][] = [];
  for (let i = 0; i < sides; i += 1) {
    const next = (i + 1) % sides;
    faces.push([0, 2 + i, 2 + next]);
    faces.push([1, 2 + next, 2 + i]);
  }
  return { vertices, faces };
}

function pathDefined(piece: ResolvedPiece, resolution: number): MeshData | null {
  const cn = crossN(piece, resolution);
  const segments: Segment[] = [];
  for (let i = 0; i < piece.points.length - 1; i += 1) {
    const segment = seg(piece.points, i, piece, resolution);
    if (segment) segments.push(segment);
  }
  if (!segments.length) return null;

  const rings = evalPath(segments, piece, cn);
  if (rings.length < 2) return null;

  const vertices: V3[] = [];
  for (const ring of rings) vertices.push(...ring.v);

  const faces: number[][] = [];
  for (let i = 0; i < rings.length - 1; i += 1) {
    const a0 = i * cn;
    const b0 = (i + 1) * cn;
    for (let j = 0; j < cn; j += 1) {
      const jn = (j + 1) % cn;
      faces.push([a0 + j, a0 + jn, b0 + jn]);
      faces.push([a0 + j, b0 + jn, b0 + j]);
    }
  }

  for (const [ring, rbase, start] of [[rings[0], 0, true], [rings[rings.length - 1], (rings.length - 1) * cn, false]] as const) {
    const cap = capMesh(ring, piece, cn, start, resolution);
    if (!cap) continue;
    const offset = vertices.length;
    vertices.push(...cap.vertices as V3[]);
    for (const face of cap.faces) faces.push([face[0] + offset, face[1] + offset, face[2] + offset]);
    connectCap(faces, cap.vertices, offset, rbase, cn, start);
  }

  return faces.length ? { vertices, faces } : null;
}

function seg(points: Point[], i: number, piece: ResolvedPiece, resolution: number): Segment | null {
  const p0: V3 = [points[i].x, points[i].y, points[i].z];
  const p3: V3 = [points[i + 1].x, points[i + 1].y, points[i + 1].z];
  const co = points[i].curve_out;
  const ci = points[i + 1].curve_in;
  const p1: V3 = co ? [co.x, co.y, co.z] : [...p0];
  const p2: V3 = ci ? [ci.x, ci.y, ci.z] : [...p3];
  const linear = near(p1, p0) && near(p2, p3);

  if (![0, 0.25, 0.5, 0.75, 1].some((t) => norm(cubicBezierDeriv(p0, p1, p2, p3, t)) > 1e-12)) return null;

  const s0 = effectiveSize(points[i], piece);
  const s1 = effectiveSize(points[i + 1], piece);
  const r0 = effectiveRotation(points[i], piece);
  const r1 = effectiveRotation(points[i + 1], piece);
  const to = points[i].transition_out;
  const ti = points[i + 1].transition_in;
  const t1: [number, number] = to ? [to.x, to.y] : [1 / 3, 1 / 3];
  const t2: [number, number] = ti ? [ti.x, ti.y] : [2 / 3, 2 / 3];
  const hasTransition = Boolean(to || ti);
  const steps = linear ? Math.max(1, Math.floor(resolution / 4)) : resolution;

  const position = (u: number) => linear ? add(scale(p0, 1 - u), scale(p3, u)) : cubicBezier(p0, p1, p2, p3, u);
  const linDir = sub(p3, p0);
  const tangent = (u: number) => {
    if (linear) return linDir;
    const deriv = cubicBezierDeriv(p0, p1, p2, p3, u);
    if (norm(deriv) < 1e-12) {
      for (const delta of [0.01, -0.01, 0.05, -0.05, 0.1, -0.1]) {
        const t = Math.max(0, Math.min(1, u + delta));
        const d2 = cubicBezierDeriv(p0, p1, p2, p3, t);
        if (norm(d2) > 1e-12) return d2;
      }
    }
    return deriv;
  };
  const v = (u: number) => hasTransition ? solveTransition(t1, t2, u) : u;
  const size = (u: number): [number, number, number] => interpolateSize({ x: s0[0], y: s0[1], z: s0[2] }, { x: s1[0], y: s1[1], z: s1[2] }, v(u));
  const rot = (u: number): [number, number, number] => interpolateRotation({ x: r0[0], y: r0[1], z: r0[2] }, { x: r1[0], y: r1[1], z: r1[2] }, v(u));
  return { n: steps, pos: position, tan: tangent, size, rot };
}

function evalPath(segments: Segment[], piece: ResolvedPiece, cn: number): Ring[] {
  const rings: Ring[] = [];
  let previousFrame: Frame | null = null;
  let previousTangent: V3 | null = null;

  for (let si = 0; si < segments.length; si += 1) {
    const segment = segments[si];
    for (let step = 0; step <= segment.n; step += 1) {
      if (si > 0 && step === 0) continue;
      const u = step / segment.n;
      const pos = segment.pos(u);
      const rawTangent = segment.tan(u);
      if (norm(rawTangent) < 1e-12) continue;
      const tangent = normalize(rawTangent);
      const size = segment.size(u);
      const isEndpoint = (si === 0 && step === 0) || (si === segments.length - 1 && step === segment.n);
      if (!isEndpoint && degenerate(...size)) continue;

      const rotation = rotationMatrixXYZ(...segment.rot(u));
      const frame: Frame = previousFrame === null ? initFrame(tangent, rotation) : transport(previousFrame, previousTangent!, tangent, rotation);
      previousFrame = frame;
      previousTangent = tangent;

      rings.push({ pos, frame, size, rot: segment.rot(u), v: crossSection(pos, frame, size, piece.shape, cn) });
    }
  }
  return rings;
}

function initFrame(tangent: V3, rotation: Mat3): Frame {
  const lz = tangent;
  const rx = matVec(rotation, [1, 0, 0]);
  const px = projectOntoPlane(rx, lz);
  const lx = norm(px) > 1e-10 ? normalize(px) : normalize(projectOntoPlane(matVec(rotation, [0, 1, 0]), lz));
  const ly = normalize(cross(lz, lx));
  return { lx, ly, lz };
}

function transport(prev: Frame, previousTangent: V3, currentTangent: V3, rotation: Mat3): Frame {
  const d = dot(previousTangent, currentTangent);
  if (d > 1 - 1e-10) return { lx: [...prev.lx], ly: [...prev.ly], lz: currentTangent };
  if (d < -1 + 1e-10) return initFrame(currentTangent, rotation);
  const r = minimalRotation(previousTangent, currentTangent);
  return { lx: normalize(matVec(r, prev.lx)), ly: normalize(matVec(r, prev.ly)), lz: currentTangent };
}

function crossSection(pos: V3, frame: Frame, size: [number, number, number], shape: string, n: number): V3[] {
  void shape;
  const [sx, sy] = size;
  return Array.from({ length: n }, (_, i) => {
    const angle = 2 * Math.PI * i / n;
    return add(add(pos, scale(frame.lx, sx * Math.cos(angle))), scale(frame.ly, sy * Math.sin(angle)));
  });
}

function capMesh(ring: Ring, piece: ResolvedPiece, cn: number, isStart: boolean, resolution: number): MeshData | null {
  const sz = ring.size[2];
  if (sz === 0) return { vertices: [ring.pos], faces: [] };
  return roundedCap(ring, piece, cn, isStart, resolution);
}

function roundedCap(ring: Ring, piece: ResolvedPiece, cn: number, isStart: boolean, resolution: number): MeshData {
  const { pos, frame } = ring;
  const [sx, sy, sz] = ring.size;
  const d = isStart ? -1 : 1;
  if (piece.shape === 'circle') {
    const nl = Math.max(2, Math.floor(resolution / 4));
    const vertices: V3[] = [add(pos, scale(frame.lz, d * sz))];
    for (let i = 1; i < nl; i += 1) {
      const phi = Math.PI / 2 * i / nl;
      const sp = Math.sin(phi);
      const cp = Math.cos(phi);
      for (let j = 0; j < cn; j += 1) {
        const angle = 2 * Math.PI * j / cn;
        vertices.push(add(add(add(pos, scale(frame.lx, sx * sp * Math.cos(angle))), scale(frame.ly, sy * sp * Math.sin(angle))), scale(frame.lz, sz * cp * d)));
      }
    }
    const faces: number[][] = [];
    for (let j = 0; j < cn; j += 1) {
      const jn = (j + 1) % cn;
      faces.push(isStart ? [0, 1 + jn, 1 + j] : [0, 1 + j, 1 + jn]);
    }
    for (let i = 0; i < nl - 2; i += 1) {
      const a0 = 1 + i * cn;
      const b0 = 1 + (i + 1) * cn;
      for (let j = 0; j < cn; j += 1) {
        const jn = (j + 1) % cn;
        if (isStart) {
          faces.push([a0 + j, a0 + jn, b0 + jn]);
          faces.push([a0 + j, b0 + jn, b0 + j]);
        } else {
          faces.push([a0 + j, b0 + j, b0 + jn]);
          faces.push([a0 + j, b0 + jn, a0 + jn]);
        }
      }
    }
    return { vertices, faces };
  }
  return { vertices: [add(pos, scale(frame.lz, d * sz))], faces: [] };
}

function connectCap(faces: number[][], capVertices: number[][], offset: number, rbase: number, cn: number, isStart: boolean): void {
  const nv = capVertices.length;
  if (nv === 1) {
    for (let j = 0; j < cn; j += 1) {
      const jn = (j + 1) % cn;
      const a = rbase + j;
      const b = rbase + jn;
      faces.push(isStart ? [offset, b, a] : [offset, a, b]);
    }
    return;
  }
  const nr = Math.floor((nv - 1) / cn);
  if (nr > 0) {
    const lr = offset + 1 + (nr - 1) * cn;
    for (let j = 0; j < cn; j += 1) {
      const jn = (j + 1) % cn;
      const a = lr + j;
      const b = lr + jn;
      const c = rbase + jn;
      const d = rbase + j;
      if (isStart) {
        faces.push([a, b, c]);
        faces.push([a, c, d]);
      } else {
        faces.push([a, d, c]);
        faces.push([a, c, b]);
      }
    }
  } else {
    for (let j = 0; j < cn; j += 1) {
      const jn = (j + 1) % cn;
      const a = rbase + j;
      const b = rbase + jn;
      faces.push(isStart ? [offset, b, a] : [offset, a, b]);
    }
  }
}

function near(a: V3, b: V3): boolean {
  return Math.abs(a[0] - b[0]) <= 1e-8 && Math.abs(a[1] - b[1]) <= 1e-8 && Math.abs(a[2] - b[2]) <= 1e-8;
}
