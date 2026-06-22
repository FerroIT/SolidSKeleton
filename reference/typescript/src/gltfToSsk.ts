import { SSKError } from './error.js';
import { meshDocument, validateDocument } from './api.js';
import type { MeshData, SSKDocument } from './types.js';

export type GltfImportOptions = {
  expectedPieceCount?: number;
  resolution?: number;
  maxPieces?: number;
};

export type QualityMetrics = {
  coveragePercent: number;
  overfillPercent: number;
  score: number;
};

export type GltfImportResult = QualityMetrics & {
  document: SSKDocument;
  scoreDocument: (document: SSKDocument) => Promise<QualityMetrics>;
};

export type GltfImportInput = Uint8Array | ArrayBuffer | { json: unknown; bin: Uint8Array | ArrayBuffer };

type Vec = number[];
type Component = { vertices: number[][]; faces: number[][] };

export function importGltfToSsk(data: GltfImportInput, options: GltfImportOptions = {}): GltfImportResult {
  const mesh = parseGlb(data);
  const sourceVertices = gltfToSsk(mesh.vertices);
  const { vertices, faces } = weldAndRemoveDegenerates(sourceVertices, mesh.faces);
  const documents = generateCandidateDocuments(vertices, faces, options.expectedPieceCount, options.maxPieces);
  let bestDoc = documents[0];
  let best = scoreDocumentSync(bestDoc, vertices, faces, options);
  for (const doc of documents.slice(1)) {
    const quality = scoreDocumentSync(doc, vertices, faces, options);
    if (quality.score > best.score) {
      best = quality;
      bestDoc = doc;
    }
  }
  validateDocument(bestDoc);
  return {
    document: bestDoc,
    ...best,
    scoreDocument: async (document: SSKDocument) => scoreDocument(document, vertices, faces, options),
  };
}

export async function scoreDocument(document: SSKDocument, sourceVertices: number[][], sourceFaces: number[][], options: GltfImportOptions = {}): Promise<QualityMetrics> {
  const resolved = validateDocument(document);
  const generated = await meshDocument(resolved, { resolution: Math.min(Math.max(options.resolution ?? 16, 8), 16) });
  if (!generated || generated.faces.length === 0) return { coveragePercent: 0, overfillPercent: 100, score: -10000 };
  const genVertices = gltfToSsk(generated.vertices);
  return scoreFromMeshes(document, sourceVertices, sourceFaces, genVertices, generated.faces, options.expectedPieceCount);
}

function scoreDocumentSync(document: SSKDocument, sourceVertices: number[][], sourceFaces: number[][], options: GltfImportOptions = {}): QualityMetrics {
  const approx = approximateMesh(document);
  return scoreFromMeshes(document, sourceVertices, sourceFaces, approx.vertices, approx.faces, options.expectedPieceCount);
}

function scoreFromMeshes(document: SSKDocument, sourceVertices: number[][], sourceFaces: number[][], genVertices: number[][], genFaces: number[][], expectedPieceCount?: number): QualityMetrics {
  const sourceBox = [min(sourceVertices), max(sourceVertices)];
  const genBox = [min(genVertices), max(genVertices)];
  let { coverage, overfill } = sampledCoverageOverfill(sourceVertices, sourceFaces, genVertices, genFaces);
  const sourceVol = Math.max(bboxVolume(sourceVertices), 1e-9);
  const genVol = Math.max(bboxVolume(genVertices), 1e-9);
  const intersectVol = bboxIntersectionVolume(sourceBox[0], sourceBox[1], genBox[0], genBox[1]);
  coverage = Math.max(coverage, Math.min(100, 100 * intersectVol / sourceVol));
  overfill = Math.max(overfill, Math.max(0, 100 * (genVol - intersectVol) / genVol));
  const pointCount = document.pieces.reduce((total, piece) => total + (piece.points?.length ?? 0), 0);
  const complexity = 0.035 * document.pieces.length + 0.006 * pointCount;
  const guide = expectedPieceCount && expectedPieceCount > 0 ? 9.0 * Math.exp(-Math.abs(document.pieces.length - expectedPieceCount) / expectedPieceCount) : 0;
  return { coveragePercent: round3(coverage), overfillPercent: round3(overfill), score: 1.18 * coverage - 1.05 * overfill - complexity + guide };
}

function parseGlb(input: GltfImportInput): MeshData {
  if (!(input instanceof Uint8Array) && !(input instanceof ArrayBuffer)) {
    return parseGltfJson(input.json as any, input.bin instanceof Uint8Array ? input.bin : new Uint8Array(input.bin));
  }
  const data = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new SSKError('GLB input has invalid magic');
  if (view.getUint32(4, true) !== 2) throw new SSKError('only GLB version 2 is supported');
  const total = view.getUint32(8, true);
  if (total !== data.byteLength) throw new SSKError('GLB declared length does not match input length');
  let offset = 12;
  const jsonLength = view.getUint32(offset, true);
  const jsonType = view.getUint32(offset + 4, true);
  if (jsonType !== 0x4e4f534a) throw new SSKError('GLB missing JSON chunk');
  offset += 8;
  const json = JSON.parse(new TextDecoder().decode(data.slice(offset, offset + jsonLength)).trimEnd()) as any;
  offset += jsonLength;
  const binLength = view.getUint32(offset, true);
  const binType = view.getUint32(offset + 4, true);
  if (binType !== 0x004e4942) throw new SSKError('GLB missing BIN chunk');
  offset += 8;
  return parseGltfJson(json, data.slice(offset, offset + binLength));
}

function parseGltfJson(json: any, bin: Uint8Array): MeshData {
  const vertices: number[][] = [];
  const faces: number[][] = [];
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      if (primitive.mode !== undefined && primitive.mode !== 4) continue;
      const posAccessor = json.accessors[primitive.attributes.POSITION];
      const idxAccessor = json.accessors[primitive.indices];
      const pos = readAccessor(json, bin, posAccessor);
      const idx = readScalarAccessor(json, bin, idxAccessor);
      const base = vertices.length;
      vertices.push(...pos);
      for (let i = 0; i < idx.length; i += 3) faces.push([base + idx[i], base + idx[i + 1], base + idx[i + 2]]);
    }
  }
  if (vertices.length === 0 || faces.length === 0) throw new SSKError('GLTF/GLB contains no triangle mesh primitives');
  return { vertices, faces };
}

function readAccessor(json: any, bin: Uint8Array, accessor: any): number[][] {
  if (accessor.componentType !== 5126 || accessor.type !== 'VEC3') throw new SSKError('only float32 VEC3 accessors are supported');
  const viewInfo = json.bufferViews[accessor.bufferView];
  const byteOffset = (viewInfo.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const stride = viewInfo.byteStride ?? 12;
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  return Array.from({ length: accessor.count }, (_, i) => [
    view.getFloat32(byteOffset + i * stride, true),
    view.getFloat32(byteOffset + i * stride + 4, true),
    view.getFloat32(byteOffset + i * stride + 8, true),
  ]);
}

function readScalarAccessor(json: any, bin: Uint8Array, accessor: any): number[] {
  const viewInfo = json.bufferViews[accessor.bufferView];
  const byteOffset = (viewInfo.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  return Array.from({ length: accessor.count }, (_, i) => {
    if (accessor.componentType === 5125) return view.getUint32(byteOffset + i * 4, true);
    if (accessor.componentType === 5123) return view.getUint16(byteOffset + i * 2, true);
    if (accessor.componentType === 5121) return view.getUint8(byteOffset + i);
    throw new SSKError('unsupported index accessor component type');
  });
}

function gltfToSsk(vertices: number[][]): number[][] {
  return vertices.map((v) => [v[0] * 1000, -v[2] * 1000, v[1] * 1000]);
}

function weldAndRemoveDegenerates(vertices: number[][], faces: number[][]): MeshData {
  const map = new Map<string, number>();
  const unique: number[][] = [];
  const remappedFaces: number[][] = [];
  for (const face of faces) {
    const remapped = face.map((index) => {
      const v = vertices[index].map((x) => Math.round(x * 1e7) / 1e7);
      const key = v.join(',');
      let out = map.get(key);
      if (out === undefined) { out = unique.length; map.set(key, out); unique.push(v); }
      return out;
    });
    if (new Set(remapped).size === 3 && triangleArea(remapped.map((i) => unique[i])) > 1e-8) remappedFaces.push(remapped);
  }
  return { vertices: unique, faces: remappedFaces };
}

function generateCandidateDocuments(vertices: number[][], faces: number[][], expectedPieceCount?: number, maxPieces?: number): SSKDocument[] {
  const guard = maxPieces ?? Math.max(8, Math.min(96, (expectedPieceCount ?? 48) * 2));
  const pieces = components(vertices, faces).slice(0, guard).flatMap((component) => componentCandidates(component));
  return [{ pieces: renumberWithInheritance(pieces.slice(0, guard)) }, { pieces: [boxPiece(0, min(vertices), max(vertices))] }];
}

function components(vertices: number[][], faces: number[][]): Component[] {
  const parent = faces.map((_, i) => i);
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; };
  const byVertex = new Map<number, number>();
  faces.forEach((face, fi) => face.forEach((vi) => { const seen = byVertex.get(vi); if (seen === undefined) byVertex.set(vi, fi); else union(fi, seen); }));
  const groups = new Map<number, number[]>();
  faces.forEach((_, fi) => { const root = find(fi); groups.set(root, [...(groups.get(root) ?? []), fi]); });
  return [...groups.values()].map((faceIndices) => {
    const used = [...new Set(faceIndices.flatMap((fi) => faces[fi]))];
    const remap = new Map(used.map((value, index) => [value, index]));
    return { vertices: used.map((i) => vertices[i]), faces: faceIndices.map((fi) => faces[fi].map((vi) => remap.get(vi)!)) };
  }).sort((a, b) => bboxVolume(b.vertices) - bboxVolume(a.vertices));
}

function componentCandidates(component: Component): SSKDocument['pieces'] {
  const mins = min(component.vertices);
  const maxs = max(component.vertices);
  const ext = sub(maxs, mins);
  if (looksLikeSphere(ext, component.faces.length)) return [spherePiece(0, mins, maxs)];
  if (looksLikeCylinder(ext, component.faces.length)) return [cylinderPiece(0, mins, maxs)];
  return [boxPiece(0, mins, maxs)];
}

function looksLikeSphere(ext: Vec, faceCount: number): boolean { return faceCount > 40 && Math.max(...ext) / Math.min(...ext) < 1.18; }
function looksLikeCylinder(ext: Vec, faceCount: number): boolean { const s = [...ext].sort((a, b) => a - b); return faceCount > 20 && s[2] > s[1] * 1.35 && s[1] / s[0] < 1.18; }

function boxPiece(id: number, mins: Vec, maxs: Vec): SSKDocument['pieces'][number] {
  const center = mul(add(mins, maxs), 0.5), ext = sub(maxs, mins);
  const axis = ext[0] === ext[1] && ext[1] === ext[2] ? 2 : ext.indexOf(Math.max(...ext));
  const half = mul(ext, 0.5), raxes = [0, 1, 2].filter((i) => i !== axis);
  const p0 = [...center], p1 = [...center]; p0[axis] = mins[axis]; p1[axis] = maxs[axis];
  const rotation = { x: axis === 0 ? 45 : 0, y: axis === 1 ? 45 : 0, z: axis === 2 ? 45 : 0 };
  return { id, points: [vec(p0), vec(p1)], size: { x: half[raxes[0]] * Math.SQRT2, y: half[raxes[1]] * Math.SQRT2, z: 0 }, rotation, shape: 'ngon', sides: 4 };
}

function cylinderPiece(id: number, mins: Vec, maxs: Vec): SSKDocument['pieces'][number] {
  const center = mul(add(mins, maxs), 0.5), ext = sub(maxs, mins), axis = ext.indexOf(Math.max(...ext));
  const raxes = [0, 1, 2].filter((i) => i !== axis); const p0 = [...center], p1 = [...center]; p0[axis] = mins[axis]; p1[axis] = maxs[axis];
  const radius = (ext[raxes[0]] + ext[raxes[1]]) * 0.25;
  return { id, points: [vec(p0), vec(p1)], size: { x: radius, y: radius, z: 0 }, shape: 'circle' };
}

function spherePiece(id: number, mins: Vec, maxs: Vec): SSKDocument['pieces'][number] {
  const center = mul(add(mins, maxs), 0.5), radius = mul(sub(maxs, mins), 0.5);
  return { id, points: [vec(center)], size: { x: radius[0], y: radius[1], z: radius[2] }, shape: 'circle' };
}

function renumberWithInheritance(pieces: SSKDocument['pieces']): SSKDocument['pieces'] {
  const out: SSKDocument['pieces'] = []; const bases = new Map<string, number>();
  for (const piece of pieces) {
    const id = out.length; const key = inheritanceKey(piece);
    if (bases.has(key)) out.push({ id, from: bases.get(key), points: piece.points });
    else { bases.set(key, id); out.push({ ...piece, id }); }
  }
  return out;
}

function inheritanceKey(piece: SSKDocument['pieces'][number]): string { return JSON.stringify([piece.shape, piece.sides, piece.size, piece.rotation ?? {}]); }

function approximateMesh(document: SSKDocument): MeshData {
  const vertices: number[][] = [];
  const faces: number[][] = [];
  for (const piece of validateDocument(document).pieces) {
    const m = piece.shape === 'circle' && piece.points.length === 1 ? ellipsoidMesh(piece.points[0], piece.size) : bboxMesh(piece.points.map((p) => [p.x, p.y, p.z]));
    const offset = vertices.length; vertices.push(...m.vertices); faces.push(...m.faces.map((f) => f.map((i) => i + offset)));
  }
  return { vertices, faces };
}
function bboxMesh(points: number[][]): MeshData {
  const center = points.reduce((acc, p) => add(acc, p), [0, 0, 0]).map((v) => v / points.length);
  const lengths = points.map((p) => Math.hypot(...sub(p, center)));
  const half = Math.max(...lengths, 1e-6);
  return boxMeshFromBounds([center[0] - half, center[1] - half, center[2] - half], [center[0] + half, center[1] + half, center[2] + half]);
}
function ellipsoidMesh(center: any, size: any): MeshData { return boxMeshFromBounds([center.x - size.x, center.y - size.y, center.z - size.z], [center.x + size.x, center.y + size.y, center.z + size.z]); }
function boxMeshFromBounds(mins: Vec, maxs: Vec): MeshData { return { vertices: [[mins[0], mins[1], mins[2]], [maxs[0], mins[1], mins[2]], [maxs[0], maxs[1], mins[2]], [mins[0], maxs[1], mins[2]], [mins[0], mins[1], maxs[2]], [maxs[0], mins[1], maxs[2]], [maxs[0], maxs[1], maxs[2]], [mins[0], maxs[1], maxs[2]]], faces: [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]] }; }

function sampledCoverageOverfill(sourceVertices: number[][], sourceFaces: number[][], genVertices: number[][], genFaces: number[][]): { coverage: number; overfill: number } {
  const mins = min([...sourceVertices, ...genVertices]), maxs = max([...sourceVertices, ...genVertices]);
  const points = samplePoints(mins, maxs, 1728);
  const sourceInside = pointsInsideMesh(points, sourceVertices, sourceFaces), genInside = pointsInsideMesh(points, genVertices, genFaces);
  let sourceCount = 0, genCount = 0, covered = 0, over = 0;
  for (let i = 0; i < points.length; i += 1) { if (sourceInside[i]) sourceCount += 1; if (genInside[i]) genCount += 1; if (sourceInside[i] && genInside[i]) covered += 1; if (!sourceInside[i] && genInside[i]) over += 1; }
  return { coverage: sourceCount ? 100 * covered / sourceCount : 0, overfill: genCount ? 100 * over / genCount : 100 };
}
function samplePoints(mins: Vec, maxs: Vec, n: number): number[][] { const c = Math.round(Math.cbrt(n)); const out: number[][] = []; for (let i = 0; i < c; i++) for (let j = 0; j < c; j++) for (let k = 0; k < c; k++) out.push([mins[0] + (i + 0.5) * (maxs[0] - mins[0]) / c, mins[1] + (j + 0.5) * (maxs[1] - mins[1]) / c, mins[2] + (k + 0.5) * (maxs[2] - mins[2]) / c]); return out; }
function pointsInsideMesh(points: number[][], vertices: number[][], faces: number[][]): boolean[] { const d = [1, 0.3713906763541037, 0.19611613513818404]; return points.map((p) => faces.reduce((count, face) => count + (rayHit(p, d, face.map((i) => vertices[i])) ? 1 : 0), 0) % 2 === 1); }
function rayHit(o: Vec, d: Vec, tri: number[][]): boolean { const e1 = sub(tri[1], tri[0]), e2 = sub(tri[2], tri[0]), h = cross(d, e2), a = dot(e1, h); if (Math.abs(a) < 1e-9) return false; const f = 1 / a, s = sub(o, tri[0]), u = f * dot(s, h); if (u < -1e-9 || u > 1 + 1e-9) return false; const q = cross(s, e1), v = f * dot(d, q); if (v < -1e-9 || u + v > 1 + 1e-9) return false; return f * dot(e2, q) > 1e-9; }

function min(vs: number[][]): Vec { return [0, 1, 2].map((a) => Math.min(...vs.map((v) => v[a]))); }
function max(vs: number[][]): Vec { return [0, 1, 2].map((a) => Math.max(...vs.map((v) => v[a]))); }
function bboxVolume(vs: number[][]): number { const e = sub(max(vs), min(vs)); return e[0] * e[1] * e[2]; }
function bboxIntersectionVolume(aMin: Vec, aMax: Vec, bMin: Vec, bMax: Vec): number { const e = [0, 1, 2].map((axis) => Math.max(0, Math.min(aMax[axis], bMax[axis]) - Math.max(aMin[axis], bMin[axis]))); return e[0] * e[1] * e[2]; }
function vec(v: Vec): any { return { x: v[0], y: v[1], z: v[2] }; }
function add(a: Vec, b: Vec): Vec { return a.map((v, i) => v + b[i]); }
function sub(a: Vec, b: Vec): Vec { return a.map((v, i) => v - b[i]); }
function mul(a: Vec, s: number): Vec { return a.map((v) => v * s); }
function dot(a: Vec, b: Vec): number { return a.reduce((t, v, i) => t + v * b[i], 0); }
function cross(a: Vec, b: Vec): Vec { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function triangleArea(tri: number[][]): number { return 0.5 * Math.hypot(...cross(sub(tri[1], tri[0]), sub(tri[2], tri[0]))); }
function round3(x: number): number { return Math.round(x * 1000) / 1000; }
