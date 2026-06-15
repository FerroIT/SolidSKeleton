import { stringify } from 'yaml';
import { SSKError } from './error.js';
import { checkRoot } from './parseSsk.js';
import { resolve } from './resolve.js';
import type { Piece, Point, SSKDocument, Vec2, Vec3 } from './types.js';
import { validate } from './validate.js';

const MAGIC = new Uint8Array([0x53, 0x53, 0x4b, 0x42]);
const DEFAULT_VERSION = [0, 8] as const;
const U8_MAX = 0xff;
const U16_MAX = 0xffff;
const U32_MAX = 0xffffffff;
const SHAPE_ENUM = new Map([['circle', 0], ['ngon', 1]] as const);
const MODE_ENUM = new Map([['add', 0], ['subtract', 1], ['intersect', 2]] as const);

const B_POINTS = 0;
const B_ROTATION = 1;
const B_SIZE = 2;
const B_SHAPE = 3;
const B_SIDES = 4;
const B_MODE = 5;
const B_AFFECTS = 6;
const B_PROPERTIES = 7;

export function writeSskb(doc: SSKDocument, options: { validateDocument?: boolean } = {}): Uint8Array {
  if (options.validateDocument !== false) preflight(doc);

  const writer = new Writer();
  writer.raw(MAGIC);
  const [major, minor] = versionTuple(doc);
  writer.u16(major);
  writer.u16(minor);
  writer.u32(doc.pieces?.length ?? 0);
  for (const piece of doc.pieces ?? []) writePiece(writer, piece);
  writePropBlob(writer, doc.properties);
  return writer.result();
}

class Writer {
  private parts: Uint8Array[] = [];

  u8(value: number): void {
    requireUint(value, U8_MAX, 'u8');
    this.parts.push(new Uint8Array([value]));
  }

  u16(value: number): void {
    requireUint(value, U16_MAX, 'u16');
    const bytes = new Uint8Array(2);
    new DataView(bytes.buffer).setUint16(0, value, true);
    this.parts.push(bytes);
  }

  u32(value: number): void {
    requireUint(value, U32_MAX, 'u32');
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value, true);
    this.parts.push(bytes);
  }

  f32(value: number): void {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new SSKError(`f32 value must be a finite number, got ${String(value)}`);
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setFloat32(0, value, true);
    this.parts.push(bytes);
  }

  raw(data: Uint8Array): void {
    this.parts.push(data);
  }

  vec3(value: Vec3): void {
    this.f32(Number(value.x));
    this.f32(Number(value.y));
    this.f32(Number(value.z));
  }

  vec2(value: Vec2): void {
    this.f32(Number(value.x));
    this.f32(Number(value.y));
  }

  result(): Uint8Array {
    const length = this.parts.reduce((total, part) => total + part.length, 0);
    const out = new Uint8Array(length);
    let offset = 0;
    for (const part of this.parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }
}

function writePropBlob(writer: Writer, props: Record<string, unknown> | undefined): void {
  if (!props || Object.keys(props).length === 0) {
    writer.u32(0);
    return;
  }
  const text = stringify(props, { aliasDuplicateObjects: false, sortMapEntries: false });
  const raw = new TextEncoder().encode(text);
  writer.u32(raw.length);
  writer.raw(raw);
}

function writePoint(writer: Writer, point: Point): void {
  writer.vec3({ x: point.x, y: point.y, z: point.z });
  for (const [field, write] of [
    ['curve_in', (value: Vec3) => writer.vec3(value)],
    ['curve_out', (value: Vec3) => writer.vec3(value)],
    ['size', (value: Vec3) => writer.vec3(value)],
    ['rotation', (value: Vec3) => writer.vec3(value)],
    ['transition_in', (value: Vec2) => writer.vec2(value)],
    ['transition_out', (value: Vec2) => writer.vec2(value)],
  ] as const) {
    const value = point[field];
    if (value) {
      writer.u8(1);
      write(value as never);
    } else {
      writer.u8(0);
    }
  }
}

function writePiece(writer: Writer, piece: Piece): void {
  const pid = piece.id;
  writer.u32(pid);
  const hasFrom = 'from' in piece;
  writer.u8(hasFrom ? 1 : 0);

  if (hasFrom) {
    writer.u32(piece.from!);
    let fieldMask = 0;
    if ('points' in piece) fieldMask |= 1 << B_POINTS;
    if ('rotation' in piece) fieldMask |= 1 << B_ROTATION;
    if ('size' in piece) fieldMask |= 1 << B_SIZE;
    if ('shape' in piece) fieldMask |= 1 << B_SHAPE;
    if ('sides' in piece) fieldMask |= 1 << B_SIDES;
    if ('mode' in piece) fieldMask |= 1 << B_MODE;
    if ('affects' in piece) fieldMask |= 1 << B_AFFECTS;
    if ('properties' in piece) fieldMask |= 1 << B_PROPERTIES;
    writer.u16(fieldMask);
  }

  if (!hasFrom || 'points' in piece) {
    const points = piece.points ?? [];
    writer.u32(points.length);
    for (const point of points) writePoint(writer, point);
  }
  if (!hasFrom) {
    if (piece.rotation) {
      writer.u8(1);
      writer.vec3(piece.rotation);
    } else {
      writer.u8(0);
    }
  } else if (piece.rotation) {
    writer.vec3(piece.rotation);
  }
  if (!hasFrom || piece.size) writer.vec3(piece.size!);
  if (!hasFrom || piece.shape) {
    const shape = SHAPE_ENUM.get(piece.shape!);
    if (shape === undefined) throw new SSKError(`piece ${pid}: unknown shape ${JSON.stringify(piece.shape)}`);
    writer.u8(shape);
  }
  if (!hasFrom) {
    if (piece.sides !== undefined) {
      writer.u8(1);
      writer.u32(piece.sides);
    } else {
      writer.u8(0);
    }
  } else if (piece.sides !== undefined) {
    writer.u32(piece.sides);
  }
  if (!hasFrom) {
    const mode = MODE_ENUM.get(piece.mode ?? 'add');
    if (mode === undefined) throw new SSKError(`piece ${pid}: unknown mode ${JSON.stringify(piece.mode)}`);
    writer.u8(mode);
  } else if (piece.mode) {
    const mode = MODE_ENUM.get(piece.mode);
    if (mode === undefined) throw new SSKError(`piece ${pid}: unknown mode ${JSON.stringify(piece.mode)}`);
    writer.u8(mode);
  }
  if (!hasFrom) {
    if (piece.affects) {
      writer.u8(1);
      writer.u32(piece.affects.length);
      for (const affected of piece.affects) writer.u32(affected);
    } else {
      writer.u8(0);
    }
  } else if (piece.affects) {
    writer.u32(piece.affects.length);
    for (const affected of piece.affects) writer.u32(affected);
  }
  if (!hasFrom || 'properties' in piece) writePropBlob(writer, piece.properties);
}

function requireUint(value: number, max: number, ctx: string): void {
  if (!Number.isInteger(value)) throw new SSKError(`${ctx} value must be an integer, got ${typeof value}`);
  if (value < 0 || value > max) throw new SSKError(`${ctx} value out of range: ${value}`);
}

function versionTuple(doc: SSKDocument): [number, number] {
  if (!doc.version) return [...DEFAULT_VERSION];
  const parts = doc.version.split('.');
  return [Number(parts[0]), Number(parts[1])];
}

function preflight(doc: SSKDocument): void {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new SSKError('document must be a mapping');
  checkRoot(doc as unknown as Record<string, unknown>);
  const [major, minor] = versionTuple(doc);
  requireUint(major, U16_MAX, 'sskb major version');
  requireUint(minor, U16_MAX, 'sskb minor version');
  if (major !== DEFAULT_VERSION[0]) throw new SSKError(`unsupported sskb major version: ${major}`);
  validate(resolve(doc, { inPlace: false }));
}
