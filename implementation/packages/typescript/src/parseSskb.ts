import { parseSsk, checkProperties, checkRoot } from './parseSsk.js';
import { SSKError } from './error.js';
import type { Piece, PropertyValue, SSKDocument } from './types.js';

const MAGIC = [0x53, 0x53, 0x4b, 0x42];
const SHAPES = new Map([[0, 'circle'], [1, 'ngon']] as const);
const MODES = new Map([[0, 'add'], [1, 'subtract'], [2, 'intersect']] as const);

const B_POINTS = 0;
const B_ROTATION = 1;
const B_SIZE = 2;
const B_SHAPE = 3;
const B_SIDES = 4;
const B_MODE = 5;
const B_AFFECTS = 6;
const B_PROPERTIES = 7;

const MIN_PIECE_BYTES = 11;
const MIN_POINT_BYTES = 18;
const ROOT_PROPERTY_LENGTH_BYTES = 4;

export function parseSskb(data: ArrayBuffer | Uint8Array): SSKDocument {
  const reader = new Reader(data);
  const magic = [...reader.raw(4)];
  if (!MAGIC.every((value, index) => value === magic[index])) throw new SSKError(`bad sskb magic: expected b'SSKB', got ${JSON.stringify(magic)}`);

  const major = reader.u16();
  const minor = reader.u16();
  if (major > 1) throw new SSKError(`unsupported sskb major version: ${major}`);

  const count = reader.u32();
  reader.requireCount(count, MIN_PIECE_BYTES, 'pieces', ROOT_PROPERTY_LENGTH_BYTES);
  const pieces = Array.from({ length: count }, () => readPiece(reader));
  const rootProps = readPropBlob(reader, 'root properties');

  if (!reader.done()) throw new SSKError('extra trailing bytes in sskb');
  const doc: SSKDocument = { pieces };
  if (rootProps !== undefined) doc.properties = rootProps as Record<string, PropertyValue>;
  checkRoot(doc as unknown as Record<string, unknown>);
  void minor;
  return doc;
}

class Reader {
  private readonly bytes: Uint8Array;
  private readonly view: DataView;
  private pos = 0;

  constructor(data: ArrayBuffer | Uint8Array) {
    this.bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
  }

  remaining(): number {
    return this.bytes.length - this.pos;
  }

  requireCount(count: number, minItemSize: number, ctx: string, reservedTail = 0): void {
    if (this.remaining() < reservedTail) throw new SSKError('truncated sskb input');
    const available = this.remaining() - reservedTail;
    if (count > Math.floor(available / minItemSize)) throw new SSKError(`${ctx}: count ${count} exceeds remaining input`);
  }

  u8(): number {
    this.need(1);
    return this.bytes[this.pos++];
  }

  u16(): number {
    this.need(2);
    const value = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return value;
  }

  u32(): number {
    this.need(4);
    const value = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return value;
  }

  f32(): number {
    this.need(4);
    const value = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    if (!Number.isFinite(value)) throw new SSKError('non-finite f32 value in sskb');
    return value;
  }

  raw(count: number): Uint8Array {
    this.need(count);
    const value = this.bytes.slice(this.pos, this.pos + count);
    this.pos += count;
    return value;
  }

  vec3() {
    return { x: this.f32(), y: this.f32(), z: this.f32() };
  }

  vec2() {
    return { x: this.f32(), y: this.f32() };
  }

  done(): boolean {
    return this.pos >= this.bytes.length;
  }

  private need(count: number): void {
    if (this.pos + count > this.bytes.length) throw new SSKError('truncated sskb input');
  }
}

function bit(mask: number, pos: number): boolean {
  return ((mask >> pos) & 1) !== 0;
}

function readPropBlob(reader: Reader, ctx: string, emptyAsNone = true): Record<string, PropertyValue> | undefined {
  const count = reader.u32();
  if (count === 0) return emptyAsNone ? undefined : {};
  const raw = reader.raw(count);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch (error) {
    throw new SSKError(`property blob not valid UTF-8: ${(error as Error).message}`);
  }
  let props: unknown;
  try {
    props = parseSsk(`pieces: []\nproperties:\n${indentYaml(text)}`).properties;
  } catch (error) {
    throw new SSKError(`${ctx}: malformed property blob: ${(error as Error).message}`);
  }
  if (!props || typeof props !== 'object' || Array.isArray(props)) throw new SSKError(`${ctx}: property blob must be a YAML mapping`);
  checkProperties(props, ctx);
  return props as Record<string, PropertyValue>;
}

function indentYaml(text: string): string {
  return text.split(/\r?\n/).map((line) => line ? `  ${line}` : line).join('\n');
}

function readPoint(reader: Reader) {
  const point: Record<string, unknown> = reader.vec3();
  if (reader.u8()) point.curve_in = reader.vec3();
  if (reader.u8()) point.curve_out = reader.vec3();
  if (reader.u8()) point.size = reader.vec3();
  if (reader.u8()) point.rotation = reader.vec3();
  if (reader.u8()) point.transition_in = reader.vec2();
  if (reader.u8()) point.transition_out = reader.vec2();
  return point;
}

function readPiece(reader: Reader): Piece {
  const piece: Record<string, unknown> = { id: reader.u32() };
  const hasFrom = reader.u8() !== 0;
  let fieldMask = 0xfd;
  if (hasFrom) {
    piece.from = reader.u32();
    fieldMask = reader.u16();
    if (fieldMask & 0xff00) throw new SSKError(`piece ${piece.id}: reserved field_mask bits set`);
  }

  if (!hasFrom || bit(fieldMask, B_POINTS)) {
    const count = reader.u32();
    reader.requireCount(count, MIN_POINT_BYTES, `piece ${piece.id} points`);
    piece.points = Array.from({ length: count }, () => readPoint(reader));
  }
  if (!hasFrom) {
    if (reader.u8()) piece.rotation = reader.vec3();
  } else if (bit(fieldMask, B_ROTATION)) {
    piece.rotation = reader.vec3();
  }
  if (!hasFrom || bit(fieldMask, B_SIZE)) piece.size = reader.vec3();
  if (!hasFrom || bit(fieldMask, B_SHAPE)) {
    const value = reader.u8();
    const shape = SHAPES.get(value as 0 | 1);
    if (!shape) throw new SSKError(`piece ${piece.id}: invalid shape enum ${value}`);
    piece.shape = shape;
  }
  if (!hasFrom) {
    if (reader.u8()) piece.sides = reader.u32();
  } else if (bit(fieldMask, B_SIDES)) {
    piece.sides = reader.u32();
  }
  if (!hasFrom || bit(fieldMask, B_MODE)) {
    const value = reader.u8();
    const mode = MODES.get(value as 0 | 1 | 2);
    if (!mode) throw new SSKError(`piece ${piece.id}: invalid mode enum ${value}`);
    if (hasFrom || mode !== 'add') piece.mode = mode;
  }
  if (!hasFrom) {
    if (reader.u8()) {
      const count = reader.u32();
      reader.requireCount(count, 4, `piece ${piece.id} affects`);
      piece.affects = Array.from({ length: count }, () => reader.u32());
    }
  } else if (bit(fieldMask, B_AFFECTS)) {
    const count = reader.u32();
    reader.requireCount(count, 4, `piece ${piece.id} affects`);
    piece.affects = Array.from({ length: count }, () => reader.u32());
  }
  if (!hasFrom || bit(fieldMask, B_PROPERTIES)) {
    const props = readPropBlob(reader, `piece ${piece.id} properties`, !hasFrom);
    if (props !== undefined) piece.properties = props;
  }
  return piece as Piece;
}
