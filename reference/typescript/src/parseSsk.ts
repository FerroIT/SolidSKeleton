import { isAlias, isMap, isScalar, isSeq, parseDocument, type Node } from 'yaml';
import { SSKError } from './error.js';
import type { PropertyValue, SSKDocument } from './types.js';

const SUPPORTED_MAJOR = 0;
const ROOT_FIELDS = new Set(['version', 'pieces', 'properties']);
const PIECE_FIELDS = new Set(['id', 'from', 'points', 'rotation', 'size', 'shape', 'sides', 'mode', 'affects', 'properties']);
const POINT_FIELDS = new Set(['x', 'y', 'z', 'curve_in', 'curve_out', 'size', 'rotation', 'transition_in', 'transition_out']);
const VEC3_FIELDS = new Set(['x', 'y', 'z']);
const VEC2_FIELDS = new Set(['x', 'y']);
const SHAPES = new Set(['circle', 'ngon']);
const MODES = new Set(['add', 'subtract', 'intersect']);

export function parseSsk(text: string): SSKDocument {
  if (typeof text !== 'string') throw new SSKError(`.ssk parser expected text, got ${typeof text}`);
  if (hasLeadingDirective(text)) throw new SSKError('YAML directives are not valid in .ssk');

  const doc = parseDocument(text, { uniqueKeys: true, keepSourceTokens: true });
  if (doc.errors.length) throw new SSKError(`invalid YAML: ${doc.errors[0].message}`);
  rejectYamlFeatures(doc.contents as Node | null);

  const value = doc.toJS({ maxAliasCount: 0 }) as unknown;
  if (!isRecord(value)) throw new SSKError('root must be a mapping');
  checkRoot(value);
  return value as SSKDocument;
}

function hasLeadingDirective(text: string): boolean {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trimStart();
    if (!trimmed || trimmed.startsWith('#')) continue;
    return trimmed.startsWith('%');
  }
  return false;
}

function rejectYamlFeatures(node: Node | null): void {
  if (!node) return;
  if (isAlias(node)) throw new SSKError('YAML aliases are not valid in .ssk');
  const maybeAnchor = node as Node & { anchor?: string; tag?: string };
  if (sourceTokenHasType((node as { srcToken?: unknown }).srcToken, 'tag')) throw new SSKError('YAML explicit tags are not valid in .ssk');
  if (maybeAnchor.anchor) throw new SSKError('YAML anchors are not valid in .ssk');
  if (maybeAnchor.tag && maybeAnchor.tag.startsWith('!')) throw new SSKError('YAML explicit tags are not valid in .ssk');
  if (isMap(node)) {
    for (const item of node.items) {
      if (sourceTokenHasType((item as { srcToken?: unknown }).srcToken, 'tag')) throw new SSKError('YAML explicit tags are not valid in .ssk');
      if (!isScalar(item.key) || typeof item.key.value !== 'string') throw new SSKError('mapping keys must be strings');
      rejectYamlFeatures(item.key as Node | null);
      rejectYamlFeatures(item.value as Node | null);
    }
  } else if (isSeq(node)) {
    for (const item of node.items) rejectYamlFeatures(item as Node | null);
  } else if (isScalar(node)) {
    return;
  }
}

function sourceTokenHasType(value: unknown, type: string): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((item) => sourceTokenHasType(item, type));
  const token = value as Record<string, unknown>;
  if (token.type === type) return true;
  return Object.values(token).some((item) => sourceTokenHasType(item, type));
}

export function checkRoot(doc: Record<string, unknown>): void {
  rejectUnknown(doc, ROOT_FIELDS, 'root');
  if (!('pieces' in doc)) throw new SSKError("root must contain 'pieces'");
  if (!Array.isArray(doc.pieces)) throw new SSKError("'pieces' must be a list");

  if ('version' in doc) {
    const version = doc.version;
    if (typeof version !== 'string') throw new SSKError("'version' must be a string");
    const parts = version.split('.');
    if (parts.length !== 2 || !/^\d+$/.test(parts[0]) || !/^\d+$/.test(parts[1])) {
      throw new SSKError(`invalid version format: ${JSON.stringify(version)}`);
    }
    if (Number(parts[0]) !== SUPPORTED_MAJOR) throw new SSKError(`unsupported major version: ${parts[0]}`);
  }

  if ('properties' in doc) checkProperties(doc.properties, 'properties');
  for (const piece of doc.pieces) checkPiece(piece);
}

export function checkProperties(props: unknown, ctx = 'properties'): void {
  if (!isRecord(props)) throw new SSKError(`${ctx}: expected mapping`);
  for (const [key, value] of Object.entries(props)) {
    if (typeof key !== 'string') throw new SSKError(`${ctx}: keys must be strings`);
    checkPropValue(value);
  }
}

function checkPiece(piece: unknown): void {
  if (!isRecord(piece)) throw new SSKError('each piece must be a mapping');
  rejectUnknown(piece, PIECE_FIELDS, 'piece');
  if (!('id' in piece)) throw new SSKError("every piece must have 'id'");
  requireInt(piece.id, 'id');
  const pid = piece.id as number;

  const hasFrom = 'from' in piece;
  if (hasFrom) {
    requireInt(piece.from, 'from');
  } else {
    for (const required of ['points', 'size', 'shape']) {
      if (!(required in piece)) throw new SSKError(`piece ${pid}: missing required field '${required}'`);
    }
  }

  if ('points' in piece) {
    if (!Array.isArray(piece.points) || piece.points.length < 1) throw new SSKError(`piece ${pid}: 'points' must be a non-empty list`);
    piece.points.forEach((point, index) => checkPoint(point, pid, index));
  }
  if ('rotation' in piece) checkVec3(piece.rotation, `piece ${pid} rotation`);
  if ('size' in piece) {
    checkVec3(piece.size, `piece ${pid} size`);
    requireNonNegVec3(piece.size as Record<string, unknown>, `piece ${pid} size`);
  }
  if ('shape' in piece) {
    if (typeof piece.shape !== 'string') throw new SSKError(`piece ${pid}: shape must be a string`);
    if (!SHAPES.has(piece.shape)) throw new SSKError(`piece ${pid}: invalid shape ${JSON.stringify(piece.shape)}`);
  }
  if ('sides' in piece) {
    requireInt(piece.sides, `piece ${pid} sides`);
    if ((piece.sides as number) < 3) throw new SSKError(`piece ${pid}: sides must be >= 3`);
  }
  if ('mode' in piece) {
    if (typeof piece.mode !== 'string') throw new SSKError(`piece ${pid}: mode must be a string`);
    if (!MODES.has(piece.mode)) throw new SSKError(`piece ${pid}: invalid mode ${JSON.stringify(piece.mode)}`);
  }
  if ('affects' in piece) {
    if (!Array.isArray(piece.affects)) throw new SSKError(`piece ${pid}: 'affects' must be a list`);
    const seen = new Set<number>();
    for (const aid of piece.affects) {
      requireInt(aid, `piece ${pid} affects[]`);
      if (seen.has(aid)) throw new SSKError(`piece ${pid}: duplicate id ${aid} in affects`);
      seen.add(aid);
    }
  }
  if ('properties' in piece) checkProperties(piece.properties, `piece ${pid} properties`);
}

function checkPoint(point: unknown, pid: number, index: number): void {
  const ctx = `piece ${pid} point ${index}`;
  if (!isRecord(point)) throw new SSKError(`${ctx}: expected mapping`);
  rejectUnknown(point, POINT_FIELDS, ctx);
  for (const coord of ['x', 'y', 'z']) {
    if (!(coord in point)) throw new SSKError(`${ctx}: missing '${coord}'`);
    requireFinite(point[coord], `${ctx}.${coord}`);
  }
  for (const field of ['curve_in', 'curve_out', 'rotation']) {
    if (field in point) checkVec3(point[field], `${ctx} ${field}`);
  }
  if ('size' in point) {
    checkVec3(point.size, `${ctx} size`);
    requireNonNegVec3(point.size as Record<string, unknown>, `${ctx} size`);
  }
  for (const field of ['transition_in', 'transition_out']) {
    if (field in point) {
      checkVec2(point[field], `${ctx} ${field}`);
      const transition = point[field] as Record<string, number>;
      if (transition.x < 0 || transition.x > 1) throw new SSKError(`${ctx}: ${field}.x must be in [0, 1]`);
    }
  }
}

function checkVec3(value: unknown, ctx: string): void {
  if (!isRecord(value)) throw new SSKError(`${ctx}: expected mapping`);
  rejectUnknown(value, VEC3_FIELDS, ctx);
  for (const coord of ['x', 'y', 'z']) {
    if (!(coord in value)) throw new SSKError(`${ctx}: missing '${coord}'`);
    requireFinite(value[coord], `${ctx}.${coord}`);
  }
}

function checkVec2(value: unknown, ctx: string): void {
  if (!isRecord(value)) throw new SSKError(`${ctx}: expected mapping`);
  rejectUnknown(value, VEC2_FIELDS, ctx);
  for (const coord of ['x', 'y']) {
    if (!(coord in value)) throw new SSKError(`${ctx}: missing '${coord}'`);
    requireFinite(value[coord], `${ctx}.${coord}`);
  }
}

function requireFinite(value: unknown, ctx: string): void {
  if (typeof value === 'boolean') throw new SSKError(`${ctx}: booleans are not valid numbers`);
  if (typeof value !== 'number') throw new SSKError(`${ctx}: expected number, got ${typeof value}`);
  if (!Number.isFinite(value)) throw new SSKError(`${ctx}: must be finite`);
}

function requireInt(value: unknown, ctx: string): void {
  if (typeof value === 'boolean') throw new SSKError(`${ctx}: booleans are not valid integers`);
  if (!Number.isInteger(value)) throw new SSKError(`${ctx}: expected integer, got ${typeof value}`);
}

function requireNonNegVec3(value: Record<string, unknown>, ctx: string): void {
  for (const coord of ['x', 'y', 'z']) {
    if ((value[coord] as number) < 0) throw new SSKError(`${ctx}.${coord}: must be non-negative`);
  }
}

function checkPropValue(value: unknown): void {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new SSKError('property values must be finite numbers');
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) checkPropValue(item);
    return;
  }
  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (typeof key !== 'string') throw new SSKError('property keys must be strings');
      checkPropValue(child);
    }
    return;
  }
  throw new SSKError(`invalid property value type: ${typeof value}`);
}

function rejectUnknown(obj: Record<string, unknown>, valid: Set<string>, ctx: string): void {
  const extra = Object.keys(obj).filter((key) => !valid.has(key)).sort();
  if (extra.length) throw new SSKError(`${ctx}: unknown field(s): ${extra.map((key) => JSON.stringify(key)).join(', ')}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
