import { evaluate } from './boolean.js';
import { SSKError } from './error.js';
import { writeGlb, writeGltf } from './gltf.js';
import { parseSsk } from './parseSsk.js';
import { parseSskb } from './parseSskb.js';
import { resolve } from './resolve.js';
import { tessellate } from './tessellate.js';
import type { ConversionFormat, ConversionResult, MeshData, ResolvedDocument, SSKDocument } from './types.js';
import { sskToGltf } from './vecmath.js';
import { validate } from './validate.js';
import { writeSsk } from './writeSsk.js';
import { writeSskb } from './writeSskb.js';
export { importGltfToSsk, scoreDocument } from './gltfToSsk.js';
export type { GltfImportOptions, GltfImportResult, QualityMetrics } from './gltfToSsk.js';

export const DEFAULT_RESOLUTION = 32;

export function load(input: string | ArrayBuffer | Uint8Array, encoding?: 'ssk' | 'sskb'): SSKDocument {
  const kind = encoding ?? (typeof input === 'string' ? 'ssk' : 'sskb');
  if (kind === 'ssk') {
    if (typeof input !== 'string') throw new SSKError('.ssk input must be text');
    return parseSsk(input);
  }
  if (typeof input === 'string') throw new SSKError('.sskb input must be binary');
  return parseSskb(input);
}

export function validateDocument(doc: SSKDocument): ResolvedDocument {
  const resolved = resolve(doc, { inPlace: false });
  validate(resolved);
  return resolved;
}

export function convertDocument(
  doc: SSKDocument,
  outputFormat: 'ssk',
  options?: { resolution?: number; binUri?: string },
): Promise<Extract<ConversionResult, { outputFormat: 'ssk' }>>;
export function convertDocument(
  doc: SSKDocument,
  outputFormat: 'sskb' | 'glb',
  options?: { resolution?: number; binUri?: string },
): Promise<Extract<ConversionResult, { outputFormat: 'sskb' | 'glb' }>>;
export function convertDocument(
  doc: SSKDocument,
  outputFormat: 'gltf',
  options?: { resolution?: number; binUri?: string },
): Promise<Extract<ConversionResult, { outputFormat: 'gltf' }>>;
export async function convertDocument(
  doc: SSKDocument,
  outputFormat: ConversionFormat,
  options: { resolution?: number; binUri?: string } = {},
): Promise<ConversionResult> {
  const resolved = validateDocument(doc);
  if (outputFormat === 'ssk') {
    const data = writeSsk(doc);
    return { outputFormat, pieceCount: resolved.pieces.length, bytesWritten: new TextEncoder().encode(data).length, data };
  }

  if (outputFormat === 'sskb') {
    const data = writeSskb(doc);
    return { outputFormat, pieceCount: resolved.pieces.length, bytesWritten: data.length, data };
  }

  const mesh = await meshDocument(resolved, { resolution: options.resolution });
  if (!mesh || mesh.faces.length === 0) throw new SSKError('conversion produced empty geometry');

  if (outputFormat === 'glb') {
    const data = writeGlb(mesh);
    return { outputFormat, pieceCount: resolved.pieces.length, bytesWritten: data.length, vertexCount: mesh.vertices.length, triangleCount: mesh.faces.length, data };
  }

  if (outputFormat === 'gltf') {
    const data = writeGltf(mesh, options.binUri);
    return { outputFormat, pieceCount: resolved.pieces.length, vertexCount: mesh.vertices.length, triangleCount: mesh.faces.length, data };
  }

  throw new SSKError(`unsupported output format: ${outputFormat}`);
}

export function inspectDocument(doc: SSKDocument, encoding: 'ssk' | 'sskb' = 'ssk') {
  const resolved = validateDocument(doc);
  const pieces = [...resolved.pieces].sort((a, b) => a.id - b.id);
  return {
    encoding,
    version: doc.version,
    valid: true,
    pieces: pieces.length,
    ids: pieces.map((piece) => piece.id),
    inheritedPieces: doc.pieces.filter((piece) => 'from' in piece).length,
    shapes: counts(pieces.map((piece) => piece.shape)),
    modes: counts(pieces.map((piece) => piece.mode ?? 'add')),
    rootProperties: 'properties' in doc,
  };
}

export function canonicalDocument(doc: SSKDocument): unknown {
  const resolved = validateDocument(doc);
  const canonical: Record<string, unknown> = {
    pieces: [...resolved.pieces].sort((a, b) => a.id - b.id).map((piece) => ({
      id: piece.id,
      points: piece.points.map((point) => ({
        x: numberValue(point.x),
        y: numberValue(point.y),
        z: numberValue(point.z),
        size: canonicalVec3(point.size ?? piece.size),
        rotation: canonicalVec3(point.rotation ?? piece.rotation ?? { x: 0, y: 0, z: 0 }),
        ...(point.curve_in ? { curve_in: canonicalVec3(point.curve_in) } : {}),
        ...(point.curve_out ? { curve_out: canonicalVec3(point.curve_out) } : {}),
        ...(point.transition_in ? { transition_in: canonicalVec2(point.transition_in) } : {}),
        ...(point.transition_out ? { transition_out: canonicalVec2(point.transition_out) } : {}),
      })),
      rotation: canonicalVec3(piece.rotation ?? { x: 0, y: 0, z: 0 }),
      size: canonicalVec3(piece.size),
      shape: piece.shape,
      mode: piece.mode ?? 'add',
      ...(piece.sides !== undefined ? { sides: piece.sides } : {}),
      ...((piece.mode ?? 'add') !== 'add' && piece.affects ? { affects: [...piece.affects] } : {}),
      ...(piece.properties ? { properties: canonicalProperties(piece.properties) } : {}),
    })),
  };
  if (resolved.properties) canonical.properties = canonicalProperties(resolved.properties);
  return canonical;
}

export function documentDifferences(left: SSKDocument, right: SSKDocument, options: { relTol?: number; absTol?: number; maxDiffs?: number } = {}): string[] {
  const differences: string[] = [];
  compareValues(canonicalDocument(left), canonicalDocument(right), '$', differences, options.relTol ?? 1e-6, options.absTol ?? 1e-5, options.maxDiffs ?? 20);
  return differences;
}

export function documentsEquivalent(left: SSKDocument, right: SSKDocument, options: { relTol?: number; absTol?: number; maxDiffs?: number } = {}): boolean {
  return documentDifferences(left, right, options).length === 0;
}

export async function meshDocument(doc: ResolvedDocument, options: { resolution?: number } = {}): Promise<MeshData | null> {
  const pieces = [...doc.pieces].sort((a, b) => a.id - b.id);
  const meshes = new Map<number, MeshData | null>();
  for (const piece of pieces) meshes.set(piece.id, tessellate(piece, { resolution: options.resolution }));
  const result = await evaluate(pieces, meshes);
  if (!result || result.faces.length === 0) return null;
  return { vertices: sskToGltf(result.vertices), faces: result.faces };
}

function counts(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of values) out[value] = (out[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

function canonicalVec3(vector: { x: number; y: number; z: number }) {
  return { x: numberValue(vector.x), y: numberValue(vector.y), z: numberValue(vector.z) };
}

function canonicalVec2(vector: { x: number; y: number }) {
  return { x: numberValue(vector.x), y: numberValue(vector.y) };
}

function canonicalProperties(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalProperties);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, canonicalProperties((value as Record<string, unknown>)[key])]));
  }
  return typeof value === 'number' ? numberValue(value) : value;
}

function numberValue(value: number): number {
  return value;
}

function compareValues(left: unknown, right: unknown, path: string, differences: string[], relTol: number, absTol: number, maxDiffs: number): void {
  if (differences.length >= maxDiffs) return;
  if (typeof left === 'number' && typeof right === 'number') {
    if (!close(left, right, relTol, absTol)) differences.push(`${path}: ${left} != ${right}`);
    return;
  }
  if (typeName(left) !== typeName(right)) {
    differences.push(`${path}: ${typeName(left)} != ${typeName(right)}`);
    return;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      differences.push(`${path}: length ${left.length} != ${right.length}`);
      return;
    }
    left.forEach((value, index) => compareValues(value, right[index], `${path}[${index}]`, differences, relTol, absTol, maxDiffs));
    return;
  }
  if (left && typeof left === 'object' && right && typeof right === 'object') {
    const leftObj = left as Record<string, unknown>;
    const rightObj = right as Record<string, unknown>;
    const leftKeys = new Set(Object.keys(leftObj));
    const rightKeys = new Set(Object.keys(rightObj));
    for (const key of [...leftKeys].filter((key) => !rightKeys.has(key)).sort()) differences.push(`${path}.${key}: missing on right`);
    for (const key of [...rightKeys].filter((key) => !leftKeys.has(key)).sort()) differences.push(`${path}.${key}: missing on left`);
    for (const key of [...leftKeys].filter((key) => rightKeys.has(key)).sort()) compareValues(leftObj[key], rightObj[key], `${path}.${key}`, differences, relTol, absTol, maxDiffs);
    return;
  }
  if (left !== right) differences.push(`${path}: ${String(left)} != ${String(right)}`);
}

function close(left: number, right: number, relTol: number, absTol: number): boolean {
  return Math.abs(left - right) <= Math.max(relTol * Math.max(Math.abs(left), Math.abs(right)), absTol);
}

function typeName(value: unknown): string {
  return Array.isArray(value) ? 'list' : value === null ? 'null' : typeof value;
}
