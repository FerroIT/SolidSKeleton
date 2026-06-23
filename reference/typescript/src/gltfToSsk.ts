import { SSKError } from './error.js';
import { meshDocument, validateDocument } from './api.js';
import { tessellate } from './tessellate.js';
import type { MeshData, ResolvedDocument, SSKDocument } from './types.js';

export const DEFAULT_GLTF_IMPORT_INFILL_WEIGHT = 1.18;
export const DEFAULT_GLTF_IMPORT_OUTFILL_WEIGHT = 1.05;
export const DEFAULT_GLTF_IMPORT_COMPLEXITY_WEIGHT = 1.0;
export const DEFAULT_GLTF_IMPORT_WEIGHTS = {
  infillWeight: DEFAULT_GLTF_IMPORT_INFILL_WEIGHT,
  outfillWeight: DEFAULT_GLTF_IMPORT_OUTFILL_WEIGHT,
  complexityWeight: DEFAULT_GLTF_IMPORT_COMPLEXITY_WEIGHT,
} as const;

export type GltfImportOptions = {
  expectedPieceCount?: number;
  resolution?: number;
  maxPieces?: number;
  infillWeight?: number;
  outfillWeight?: number;
  complexityWeight?: number;
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
  const documents = generateCandidateDocuments(vertices, faces, options.expectedPieceCount, options.maxPieces, prefersLowOverfill(options));
  let bestDoc: SSKDocument | undefined;
  let best: QualityMetrics | undefined;
  for (const doc of documents) {
    try {
      const quality = scoreDocumentSync(doc, vertices, faces, options);
      if (best === undefined || quality.score > best.score) {
        bestDoc = doc;
        best = quality;
      }
    } catch {
      // skip unscorable candidates
    }
  }
  if (!bestDoc || !best) throw new SSKError('GLTF/GLB import generated no scoreable SSK candidates');
  validateDocument(bestDoc);
  return {
    document: bestDoc,
    ...best,
    scoreDocument: async (document: SSKDocument) => scoreDocument(document, vertices, faces, options),
  };
}

function prefersLowOverfill(options: GltfImportOptions): boolean {
  const outfill = options.outfillWeight ?? DEFAULT_GLTF_IMPORT_OUTFILL_WEIGHT;
  const infill = options.infillWeight ?? DEFAULT_GLTF_IMPORT_INFILL_WEIGHT;
  return outfill > infill;
}

export async function scoreDocument(document: SSKDocument, sourceVertices: number[][], sourceFaces: number[][], options: GltfImportOptions = {}): Promise<QualityMetrics> {
  const resolved = validateDocument(document);
  const generated = await meshDocument(resolved, { resolution: Math.min(Math.max(options.resolution ?? 16, 8), 16) });
  if (!generated || generated.faces.length === 0) return { coveragePercent: 0, overfillPercent: 100, score: -10000 };
  const genVertices = gltfToSsk(generated.vertices);
  return scoreFromMeshes(resolved, sourceVertices, sourceFaces, genVertices, generated.faces, options);
}

function scoreDocumentSync(document: SSKDocument, sourceVertices: number[][], sourceFaces: number[][], options: GltfImportOptions = {}): QualityMetrics {
  const resolved = validateDocument(document);
  const contributions = approximateContributions(resolved, options.resolution);
  if (!contributions.length) return { coveragePercent: 0, overfillPercent: 100, score: -10000 };
  const { coverage, overfill } = sampledCoverageOverfillFromContributions(sourceVertices, sourceFaces, contributions);
  return scoreFromMetrics(resolved.pieces.length, resolved.pieces.reduce((total, piece) => total + (piece.points?.length ?? 0), 0), coverage, overfill, options);
}

function scoreFromMeshes(document: SSKDocument, sourceVertices: number[][], sourceFaces: number[][], genVertices: number[][], genFaces: number[][], options: GltfImportOptions): QualityMetrics {
  const { coverage, overfill } = sampledCoverageOverfill(sourceVertices, sourceFaces, genVertices, genFaces);
  const pointCount = document.pieces.reduce((total, piece) => total + (piece.points?.length ?? 0), 0);
  return scoreFromMetrics(document.pieces.length, pointCount, coverage, overfill, options);
}

function scoreFromMetrics(pieceCount: number, pointCount: number, coverage: number, overfill: number, options: GltfImportOptions): QualityMetrics {
  const complexity = 0.035 * pieceCount + 0.006 * pointCount;
  const coverageScore = coverage / 100;
  const containmentScore = 1 - (overfill / 100);
  const complexityPenalty = complexity / (1 + complexity);
  const pieceCountTerm = options.expectedPieceCount && options.expectedPieceCount > 0 ? 1 : 0;
  const pieceCountScore = options.expectedPieceCount && options.expectedPieceCount > 0
    ? Math.max(0, 1 - (Math.abs(pieceCount - options.expectedPieceCount) / options.expectedPieceCount))
    : 0;
  const totalWeight =
    (options.infillWeight ?? DEFAULT_GLTF_IMPORT_INFILL_WEIGHT)
    + (options.outfillWeight ?? DEFAULT_GLTF_IMPORT_OUTFILL_WEIGHT)
    + (options.complexityWeight ?? DEFAULT_GLTF_IMPORT_COMPLEXITY_WEIGHT)
    + pieceCountTerm;
  return {
    coveragePercent: round3(coverage),
    overfillPercent: round3(overfill),
    score: (
      (options.infillWeight ?? DEFAULT_GLTF_IMPORT_INFILL_WEIGHT) * coverageScore
      + (options.outfillWeight ?? DEFAULT_GLTF_IMPORT_OUTFILL_WEIGHT) * containmentScore
      - (options.complexityWeight ?? DEFAULT_GLTF_IMPORT_COMPLEXITY_WEIGHT) * complexityPenalty
      + pieceCountScore
    ) / Math.max(totalWeight, 1e-9),
  };
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

function generateCandidateDocuments(vertices: number[][], faces: number[][], expectedPieceCount?: number, maxPieces?: number, preferLowOverfill = false): SSKDocument[] {
  const guard = maxPieces ?? Math.max(8, Math.min(112, (expectedPieceCount ?? 56) * 2));
  const parts = components(vertices, faces);
  const segmentedPieces: SSKDocument['pieces'] = [];
  const detailedPieces: SSKDocument['pieces'] = [];
  const compactPieces: SSKDocument['pieces'] = [];
  let segmentedRequested = false;
  for (const component of parts.slice(0, guard)) {
    const alternatives = componentCandidateSets(component);
    if (!alternatives.length) continue;
    const segmented = longAxisPartitionBoxPieces(component.vertices);
    if (segmented.length) {
      segmentedRequested = true;
      appendCandidatePieces(segmentedPieces, segmented);
    } else if (preferLowOverfill) {
      appendCandidatePieces(segmentedPieces, alternatives[0]);
    }
    appendCandidatePieces(detailedPieces, alternatives[0]);
    appendCandidatePieces(compactPieces, alternatives[alternatives.length - 1]);
  }
  const documents: SSKDocument[] = [];
  const singlePrimitive = detailedPieces.length === 1 && detailedPieces[0].shape === 'circle';
  if (parts.length === 1 && !singlePrimitive) {
    const decomposed = axisPartitionBoxPieces(vertices);
    if (decomposed.length > 1) documents.push({ pieces: renumberWithInheritance(decomposed.slice(0, guard)) });
  }
  if (segmentedRequested && segmentedPieces.length && segmentedPieces.length !== detailedPieces.length) documents.push({ pieces: renumberWithInheritance(segmentedPieces.slice(0, guard)) });
  if (detailedPieces.length) documents.push({ pieces: renumberWithInheritance(detailedPieces.slice(0, guard)) });
  if (compactPieces.length && compactPieces.length !== detailedPieces.length) documents.push({ pieces: renumberWithInheritance(compactPieces.slice(0, guard)) });
  documents.push({ pieces: [boxPiece(0, min(vertices), max(vertices))] });
  return documents;
}

function longAxisPartitionBoxPieces(vertices: number[][]): SSKDocument['pieces'] {
  const mins = min(vertices);
  const maxs = max(vertices);
  const ext = sub(maxs, mins);
  const longAxis = ext.indexOf(Math.max(...ext));
  const cross = Math.max(...[0, 1, 2].filter((axis) => axis !== longAxis).map((axis) => ext[axis]));
  if (cross <= 1e-7 || ext[longAxis] / cross < 3 || vertices.length < 12) return [];

  const segmentCount = Math.max(2, Math.min(12, Math.ceil(ext[longAxis] / Math.max(cross * 2.5, 1e-6))));
  const pieces: SSKDocument['pieces'] = [];
  let volume = 0;
  for (let index = 0; index < segmentCount; index += 1) {
    const lo = mins[longAxis] + ext[longAxis] * index / segmentCount;
    const hi = mins[longAxis] + ext[longAxis] * (index + 1) / segmentCount;
    const selected = vertices.filter((vertex) => vertex[longAxis] >= lo - 1e-5 && vertex[longAxis] <= hi + 1e-5);
    if (selected.length < 4) continue;
    const subMins = min(selected);
    const subMaxs = max(selected);
    if (sub(subMaxs, subMins).some((value) => value <= 1e-7)) continue;
    volume += bboxVolumeFromBounds(subMins, subMaxs);
    const cuboidShell = cuboidShellPieces(subMins, subMaxs);
    appendCandidatePieces(pieces, cuboidShell.length ? cuboidShell : [boxPiece(0, subMins, subMaxs)]);
  }
  const wholeVolume = bboxVolumeFromBounds(mins, maxs);
  return pieces.length > 1 && wholeVolume > 0 && volume < wholeVolume * 0.92 ? pieces : [];
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

function componentCandidateSets(component: Component): SSKDocument['pieces'][] {
  const mins = min(component.vertices);
  const maxs = max(component.vertices);
  const ext = sub(maxs, mins);
  if (looksLikeSphere(ext, component.faces.length)) return [[spherePiece(0, mins, maxs)]];
  if (looksLikeCylinder(ext, component.faces.length)) return [[cylinderPiece(0, mins, maxs)]];
  const simple = [boxPiece(0, mins, maxs)];
  const cuboidShell = cuboidShellPieces(mins, maxs);
  return cuboidShell.length ? [cuboidShell, simple] : [simple];
}

function axisPartitionBoxPieces(vertices: number[][]): SSKDocument['pieces'] {
  const mins = min(vertices);
  const maxs = max(vertices);
  const ext = sub(maxs, mins);
  const longAxis = ext.indexOf(Math.max(...ext));
  const splitAxis = [0, 1, 2].filter((axis) => axis !== longAxis).sort((a, b) => ext[b] - ext[a])[0];
  const coords = [...new Set(vertices.map((vertex) => Math.round(vertex[splitAxis] * 1e4) / 1e4))].sort((a, b) => a - b);
  if (coords.length < 6) return [];
  const gaps = coords.slice(1).map((coord, index) => coord - coords[index]);
  const threshold = Math.max(ext[splitAxis] * 1e-4, 1e-6);
  const positive = gaps.filter((gap) => gap > threshold).sort((a, b) => a - b);
  if (positive.length < 2) return [];
  const small = percentile(positive, 35);
  const cutIndices = gaps.map((gap, index) => gap > small * 2.5 ? index : -1).filter((index) => index >= 0);
  if (!cutIndices.length) return [];

  const ranges: [number, number][] = [];
  let start = coords[0];
  for (const index of cutIndices) {
    ranges.push([start, coords[index]]);
    start = coords[index + 1];
  }
  ranges.push([start, coords[coords.length - 1]]);

  const pieces: SSKDocument['pieces'] = [];
  for (const [lo, hi] of ranges.filter(([lo, hi]) => hi - lo > 1e-6)) {
    const selected = vertices.filter((vertex) => vertex[splitAxis] >= lo - 1e-5 && vertex[splitAxis] <= hi + 1e-5);
    if (selected.length < 4) continue;
    const subMins = min(selected);
    const subMaxs = max(selected);
    if (sub(subMaxs, subMins).some((value) => value <= 1e-7)) continue;
    const cuboidShell = cuboidShellPieces(subMins, subMaxs);
    appendCandidatePieces(pieces, cuboidShell.length ? cuboidShell : [boxPiece(0, subMins, subMaxs)]);
  }
  return pieces.length > 1 ? pieces : [];
}

function appendCandidatePieces(target: SSKDocument['pieces'], pieces: SSKDocument['pieces']): void {
  const offset = target.length;
  const idMap = new Map(pieces.map((piece, index) => [piece.id, offset + index]));
  pieces.forEach((piece, index) => {
    const copied = deepCopy(piece);
    copied.id = offset + index;
    if (copied.affects) copied.affects = copied.affects.map((affected) => idMap.get(affected) ?? affected);
    target.push(copied);
  });
}

function cuboidShellPieces(mins: Vec, maxs: Vec): SSKDocument['pieces'] {
  const ext = sub(maxs, mins);
  const axis = ext[0] === ext[1] && ext[1] === ext[2] ? 2 : ext.indexOf(Math.max(...ext));
  const crossAxes = [0, 1, 2].filter((index) => index !== axis);
  const narrowAxis = ext[crossAxes[0]] <= ext[crossAxes[1]] ? crossAxes[0] : crossAxes[1];
  const wideAxis = crossAxes.find((index) => index !== narrowAxis)!;
  const narrow = ext[narrowAxis];
  const wide = ext[wideAxis];
  if (narrow <= 1e-7 || wide / narrow <= 1.35) return [];

  const outerMins = [...mins];
  const outerMaxs = [...maxs];
  const innerMins = [...mins];
  const innerMaxs = [...maxs];
  outerMaxs[narrowAxis] = mins[narrowAxis] + wide;
  innerMins[narrowAxis] = maxs[narrowAxis];
  innerMaxs[narrowAxis] = maxs[narrowAxis] + wide;

  const inner = boxPiece(1, innerMins, innerMaxs, axis);
  return [boxPiece(0, outerMins, outerMaxs, axis), { ...inner, mode: 'subtract', affects: [0] }];
}

function looksLikeSphere(ext: Vec, faceCount: number): boolean { return faceCount > 40 && Math.max(...ext) / Math.min(...ext) < 1.18; }
function looksLikeCylinder(ext: Vec, faceCount: number): boolean { const s = [...ext].sort((a, b) => a - b); return faceCount > 20 && s[2] > s[1] * 1.35 && s[1] / s[0] < 1.18; }

function boxPiece(id: number, mins: Vec, maxs: Vec, axisOverride?: number): SSKDocument['pieces'][number] {
  const center = mul(add(mins, maxs), 0.5), ext = sub(maxs, mins);
  const axis = axisOverride ?? (ext[0] === ext[1] && ext[1] === ext[2] ? 2 : ext.indexOf(Math.max(...ext)));
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

function inheritanceKey(piece: SSKDocument['pieces'][number]): string {
  return JSON.stringify([
    piece.shape,
    piece.sides,
    piece.mode ?? 'add',
    piece.affects ?? [],
    ['x', 'y', 'z'].map((axis) => round4(piece.size?.[axis as keyof typeof piece.size] ?? 0)),
    ['x', 'y', 'z'].map((axis) => round4(piece.rotation?.[axis as keyof typeof piece.rotation] ?? 0)),
  ]);
}

function approximateContributions(document: ResolvedDocument, resolution?: number): Array<Bounds | MeshData> {
  const contributions = new Map<number, Bounds | MeshData>();
  const tessellationResolution = Math.min(Math.max(resolution ?? 12, 8), 16);
  for (const piece of document.pieces) {
    if ((piece.mode ?? 'add') === 'subtract') {
      const cutterBounds = squareSweepBounds(piece);
      if (!cutterBounds) continue;
      const targets = piece.affects ?? [...contributions.keys()];
      for (const targetId of targets) {
        const target = contributions.get(targetId);
        if (!target || !('mins' in target)) continue;
        const reduced = subtractBounds(target, cutterBounds);
        if (reduced) contributions.set(targetId, reduced);
      }
      continue;
    }
    const bounds = squareSweepBounds(piece);
    const mesh = bounds ?? tessellate(piece, { resolution: tessellationResolution });
    if (mesh) contributions.set(piece.id, mesh);
  }
  return [...contributions.values()];
}

type Bounds = { mins: Vec; maxs: Vec };

function squareSweepBounds(piece: SSKDocument['pieces'][number]): Bounds | null {
  if (piece.shape !== 'ngon' || piece.sides !== 4 || !piece.points || piece.points.length !== 2 || !piece.size) return null;
  if (Math.abs(piece.size.x - piece.size.y) > Math.max(Math.abs(piece.size.x), Math.abs(piece.size.y), 1) * 1e-6) return null;
  const first = [piece.points[0].x, piece.points[0].y, piece.points[0].z];
  const second = [piece.points[1].x, piece.points[1].y, piece.points[1].z];
  const delta = sub(second, first).map(Math.abs);
  const axis = delta.indexOf(Math.max(...delta));
  if (delta[axis] <= 1e-7) return null;
  if (delta.some((value, index) => index !== axis && value > 1e-7)) return null;
  const side = piece.size.x * Math.SQRT2;
  const center = mul(add(first, second), 0.5);
  const mins = [...center];
  const maxs = [...center];
  mins[axis] = Math.min(first[axis], second[axis]);
  maxs[axis] = Math.max(first[axis], second[axis]);
  for (const crossAxis of [0, 1, 2].filter((index) => index !== axis)) {
    mins[crossAxis] = center[crossAxis] - side * 0.5;
    maxs[crossAxis] = center[crossAxis] + side * 0.5;
  }
  return { mins, maxs };
}

function subtractBounds(base: Bounds, cutter: Bounds): Bounds | null {
  const tolerance = Math.max(...sub(base.maxs, base.mins).map(Math.abs), 1) * 1e-6;
  for (let axis = 0; axis < 3; axis += 1) {
    const otherAxes = [0, 1, 2].filter((index) => index !== axis);
    if (!otherAxes.every((index) => cutter.mins[index] <= base.mins[index] + tolerance && cutter.maxs[index] >= base.maxs[index] - tolerance)) continue;
    if (cutter.mins[axis] > base.mins[axis] + tolerance && cutter.mins[axis] < base.maxs[axis] - tolerance && cutter.maxs[axis] >= base.maxs[axis] - tolerance) {
      const maxs = [...base.maxs];
      maxs[axis] = cutter.mins[axis];
      return { mins: [...base.mins], maxs };
    }
    if (cutter.maxs[axis] > base.mins[axis] + tolerance && cutter.maxs[axis] < base.maxs[axis] - tolerance && cutter.mins[axis] <= base.mins[axis] + tolerance) {
      const mins = [...base.mins];
      mins[axis] = cutter.maxs[axis];
      return { mins, maxs: [...base.maxs] };
    }
  }
  return null;
}

function deepCopy<T>(value: T): T { return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)); }
function boxMeshFromBounds(mins: Vec, maxs: Vec): MeshData { return { vertices: [[mins[0], mins[1], mins[2]], [maxs[0], mins[1], mins[2]], [maxs[0], maxs[1], mins[2]], [mins[0], maxs[1], mins[2]], [mins[0], mins[1], maxs[2]], [maxs[0], mins[1], maxs[2]], [maxs[0], maxs[1], maxs[2]], [mins[0], maxs[1], maxs[2]]], faces: [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]] }; }

function sampledCoverageOverfill(sourceVertices: number[][], sourceFaces: number[][], genVertices: number[][], genFaces: number[][]): { coverage: number; overfill: number } {
  const mins = min([...sourceVertices, ...genVertices]), maxs = max([...sourceVertices, ...genVertices]);
  const points = samplePoints(mins, maxs, 1728);
  const sourceInside = pointsInsideMeshUnion(points, sourceVertices, sourceFaces), genInside = pointsInsideMeshUnion(points, genVertices, genFaces);
  let sourceCount = 0, genCount = 0, covered = 0, over = 0;
  for (let i = 0; i < points.length; i += 1) { if (sourceInside[i]) sourceCount += 1; if (genInside[i]) genCount += 1; if (sourceInside[i] && genInside[i]) covered += 1; if (!sourceInside[i] && genInside[i]) over += 1; }
  if (!sourceCount) {
    const sourceMins = min(sourceVertices), sourceMaxs = max(sourceVertices), genMins = min(genVertices), genMaxs = max(genVertices);
    const sourceVol = Math.max(bboxVolume(sourceVertices), 1e-9);
    const genVol = Math.max(bboxVolume(genVertices), 1e-9);
    const intersectVol = bboxIntersectionVolume(sourceMins, sourceMaxs, genMins, genMaxs);
    return { coverage: Math.min(100, 100 * intersectVol / sourceVol), overfill: Math.max(0, 100 * (genVol - intersectVol) / genVol) };
  }
  return { coverage: sourceCount ? 100 * covered / sourceCount : 0, overfill: genCount ? 100 * over / genCount : 100 };
}
function sampledCoverageOverfillFromContributions(sourceVertices: number[][], sourceFaces: number[][], contributions: Array<Bounds | MeshData>): { coverage: number; overfill: number } {
  let mins = [...min(sourceVertices)], maxs = [...max(sourceVertices)];
  for (const contribution of contributions) {
    if ('mins' in contribution) {
      mins = [0, 1, 2].map((axis) => Math.min(mins[axis], contribution.mins[axis]));
      maxs = [0, 1, 2].map((axis) => Math.max(maxs[axis], contribution.maxs[axis]));
    } else {
      const meshMins = min(contribution.vertices), meshMaxs = max(contribution.vertices);
      mins = [0, 1, 2].map((axis) => Math.min(mins[axis], meshMins[axis]));
      maxs = [0, 1, 2].map((axis) => Math.max(maxs[axis], meshMaxs[axis]));
    }
  }
  const extent = sub(maxs, mins);
  const pad = Math.max(Math.max(...extent.map(Math.abs)) * 0.025, 1e-3);
  mins = mins.map((value) => value - pad);
  maxs = maxs.map((value) => value + pad);
  const points = samplePoints(mins, maxs, 1728);
  const sourceInside = pointsInsideMeshUnion(points, sourceVertices, sourceFaces);
  const genInside = Array.from({ length: points.length }, () => false);
  for (const contribution of contributions) {
    const inside = 'mins' in contribution
      ? points.map((point) => [0, 1, 2].every((axis) => point[axis] >= contribution.mins[axis] && point[axis] <= contribution.maxs[axis]))
      : pointsInsideMeshUnion(points, contribution.vertices, contribution.faces);
    for (let i = 0; i < genInside.length; i += 1) genInside[i] = genInside[i] || inside[i];
  }
  let sourceCount = 0, genCount = 0, covered = 0, over = 0;
  for (let i = 0; i < points.length; i += 1) { if (sourceInside[i]) sourceCount += 1; if (genInside[i]) genCount += 1; if (sourceInside[i] && genInside[i]) covered += 1; if (!sourceInside[i] && genInside[i]) over += 1; }
  if (!sourceCount) {
    const sourceMins = min(sourceVertices), sourceMaxs = max(sourceVertices);
    const sourceVol = Math.max(bboxVolume(sourceVertices), 1e-9);
    const genVol = Math.max(bboxVolumeFromBounds(mins, maxs), 1e-9);
    const intersectVol = bboxIntersectionVolume(sourceMins, sourceMaxs, mins, maxs);
    return { coverage: Math.min(100, 100 * intersectVol / sourceVol), overfill: Math.max(0, 100 * (genVol - intersectVol) / genVol) };
  }
  return { coverage: sourceCount ? 100 * covered / sourceCount : 0, overfill: genCount ? 100 * over / genCount : 100 };
}
function samplePoints(mins: Vec, maxs: Vec, n: number): number[][] { let state = 12345; const out: number[][] = []; const gridN = 10; for (let i = 0; i < gridN; i++) for (let j = 0; j < gridN; j++) for (let k = 0; k < gridN; k++) out.push([mins[0] + i * (maxs[0] - mins[0]) / Math.max(gridN - 1, 1), mins[1] + j * (maxs[1] - mins[1]) / Math.max(gridN - 1, 1), mins[2] + k * (maxs[2] - mins[2]) / Math.max(gridN - 1, 1)]); for (let i = 0; i < n; i++) { state = (1664525 * state + 1013904223) >>> 0; const rx = state / 4294967296; state = (1664525 * state + 1013904223) >>> 0; const ry = state / 4294967296; state = (1664525 * state + 1013904223) >>> 0; const rz = state / 4294967296; out.push([mins[0] + rx * (maxs[0] - mins[0]), mins[1] + ry * (maxs[1] - mins[1]), mins[2] + rz * (maxs[2] - mins[2])]); } return out; }
function pointsInsideMeshUnion(points: number[][], vertices: number[][], faces: number[][]): boolean[] {
  const parts = components(vertices, faces);
  if (parts.length <= 1) return pointsInsideMesh(points, vertices, faces);
  const out = Array.from({ length: points.length }, () => false);
  for (const part of parts) {
    const inside = pointsInsideMesh(points, part.vertices, part.faces);
    for (let i = 0; i < out.length; i += 1) out[i] = out[i] || inside[i];
  }
  return out;
}
function pointsInsideMesh(points: number[][], vertices: number[][], faces: number[][]): boolean[] { const d = [1, 0.3713906763541037, 0.19611613513818404]; return points.map((p) => faces.reduce((count, face) => count + (rayHit(p, d, face.map((i) => vertices[i])) ? 1 : 0), 0) % 2 === 1); }
function rayHit(o: Vec, d: Vec, tri: number[][]): boolean { const e1 = sub(tri[1], tri[0]), e2 = sub(tri[2], tri[0]), h = cross(d, e2), a = dot(e1, h); if (Math.abs(a) < 1e-9) return false; const f = 1 / a, s = sub(o, tri[0]), u = f * dot(s, h); if (u < -1e-9 || u > 1 + 1e-9) return false; const q = cross(s, e1), v = f * dot(d, q); if (v < -1e-9 || u + v > 1 + 1e-9) return false; return f * dot(e2, q) > 1e-9; }

function min(vs: number[][]): Vec { return [0, 1, 2].map((a) => Math.min(...vs.map((v) => v[a]))); }
function max(vs: number[][]): Vec { return [0, 1, 2].map((a) => Math.max(...vs.map((v) => v[a]))); }
function bboxVolume(vs: number[][]): number { const e = sub(max(vs), min(vs)); return e[0] * e[1] * e[2]; }
function bboxVolumeFromBounds(mins: Vec, maxs: Vec): number { const e = sub(maxs, mins); return Math.max(e[0], 0) * Math.max(e[1], 0) * Math.max(e[2], 0); }
function bboxIntersectionVolume(aMin: Vec, aMax: Vec, bMin: Vec, bMax: Vec): number { const e = [0, 1, 2].map((axis) => Math.max(0, Math.min(aMax[axis], bMax[axis]) - Math.max(aMin[axis], bMin[axis]))); return e[0] * e[1] * e[2]; }
function percentile(values: number[], percent: number): number { const index = (values.length - 1) * percent / 100; const low = Math.floor(index), high = Math.ceil(index); return low === high ? values[low] : values[low] + (values[high] - values[low]) * (index - low); }
function vec(v: Vec): any { return { x: v[0], y: v[1], z: v[2] }; }
function add(a: Vec, b: Vec): Vec { return a.map((v, i) => v + b[i]); }
function sub(a: Vec, b: Vec): Vec { return a.map((v, i) => v - b[i]); }
function mul(a: Vec, s: number): Vec { return a.map((v) => v * s); }
function dot(a: Vec, b: Vec): number { return a.reduce((t, v, i) => t + v * b[i], 0); }
function cross(a: Vec, b: Vec): Vec { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function triangleArea(tri: number[][]): number { return 0.5 * Math.hypot(...cross(sub(tri[1], tri[0]), sub(tri[2], tri[0]))); }
function round3(x: number): number { return Math.round(x * 1000) / 1000; }
function round4(x: number): number { return Math.round(x * 10000) / 10000; }
