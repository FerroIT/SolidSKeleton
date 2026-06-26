import { SSKError } from './error.js';
import type { Piece, ResolvedDocument, SSKDocument } from './types.js';

const INHERITABLE = ['points', 'rotation', 'size', 'shape', 'sides', 'mode', 'affects', 'properties'] as const;

export function resolve(doc: SSKDocument, options: { inPlace?: boolean } = {}): ResolvedDocument {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new SSKError('document must be a mapping');
  const target = options.inPlace === false ? deepCopy(doc) : doc;
  if (!Array.isArray(target.pieces)) throw new SSKError('document must contain a pieces list');

  const ids: number[] = [];
  target.pieces.forEach((piece, index) => {
    if (!piece || typeof piece !== 'object' || Array.isArray(piece)) throw new SSKError(`piece ${index}: expected mapping`);
    if (!('id' in piece)) throw new SSKError(`piece ${index}: missing id`);
    if (typeof piece.id === 'boolean' || !Number.isInteger(piece.id)) throw new SSKError(`piece ${index}: id must be an integer`);
    ids.push(piece.id);
  });
  if (new Set(ids).size !== ids.length) throw new SSKError('piece ids must be unique before inheritance resolution');

  const byId = new Map<number, Piece>();
  for (const piece of target.pieces) byId.set(piece.id, piece);
  checkInheritanceGraph(byId);

  const done = new Set<number>();
  for (const id of [...byId.keys()].sort((a, b) => a - b)) doResolve(id, byId, done);
  return target as ResolvedDocument;
}

function checkInheritanceGraph(byId: Map<number, Piece>): void {
  const visiting = new Set<number>();
  const visited = new Set<number>();

  function visit(pid: number): void {
    if (visited.has(pid)) return;
    if (visiting.has(pid)) throw new SSKError(`circular inheritance involving piece ${pid}`);
    visiting.add(pid);
    const piece = byId.get(pid)!;
    if ('from' in piece) {
      const fid = piece.from;
      if (typeof fid === 'boolean' || !Number.isInteger(fid)) throw new SSKError(`piece ${pid}: from must be an integer`);
      if (fid === pid) throw new SSKError(`piece ${pid}: self-reference is invalid`);
      if (!byId.has(fid!)) throw new SSKError(`piece ${pid}: from references non-existent piece ${fid}`);
      if (fid! > pid) throw new SSKError(`piece ${pid}: from must reference a lower id`);
      visit(fid!);
    }
    visiting.delete(pid);
    visited.add(pid);
  }

  for (const id of [...byId.keys()].sort((a, b) => a - b)) visit(id);
}

function doResolve(pid: number, byId: Map<number, Piece>, done: Set<number>): void {
  if (done.has(pid)) return;
  const piece = byId.get(pid)!;
  if (!('from' in piece)) {
    done.add(pid);
    return;
  }
  const fid = piece.from!;
  if (!done.has(fid)) doResolve(fid, byId, done);
  const source = byId.get(fid)!;
  for (const field of INHERITABLE) {
    if (!(field in piece) && field in source) {
      (piece as Record<string, unknown>)[field] = deepCopy((source as Record<string, unknown>)[field]);
    }
  }
  done.add(pid);
}

export function deepCopy<T>(value: T): T {
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}
