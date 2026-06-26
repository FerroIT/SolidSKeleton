import assert from 'node:assert/strict';

import {
  documentDifferences,
  parseSsk,
  parseSskb,
  writeSsk,
  writeSskb,
  type SSKDocument,
} from '../src/index.js';

const encoder = new TextEncoder();

assert.equal(parseSsk('# comment\r\npieces:\r\n  []\r\n').pieces.length, 0);
assert.throws(() => parseSsk('pieces: []\npieces: []\n'), /Map keys must be unique|duplicate/i);
assert.throws(() => parseSsk('%YAML 1.2\n---\npieces: []\n'), /directives|YAML/i);
assert.throws(() => parseSsk('pieces: !!seq []\n'), /explicit tags/i);
assert.equal(parseSsk('pieces: []\nproperties:\n  note: hello !world\n').properties?.note, 'hello !world');
assert.throws(() => parseSsk('pieces: []\nproperties:\n  1: x\n'), /keys must be strings/i);
assert.throws(() => parseSsk('version: "2.0"\npieces: []\n'), /unsupported major version/i);
assert.equal(parseSsk('version: "0.9"\npieces: []\n').version, '0.9');
assert.throws(
  () => parseSsk('pieces:\n  - id: true\n    points: [{x: 0, y: 0, z: 0}]\n    size: {x: 1, y: 1, z: 1}\n    shape: circle\n'),
  /booleans are not valid integers/i,
);
assert.throws(
  () => parseSsk('pieces:\n  - id: 0\n    points: [{x: .nan, y: 0, z: 0}]\n    size: {x: 1, y: 1, z: 1}\n    shape: circle\n'),
  /finite/i,
);
assert.throws(
  () => parseSsk('pieces:\n  - id: 0\n    points: [{x: 0, y: 0, z: 0, w: 0}]\n    size: {x: 1, y: 1, z: 1}\n    shape: circle\n'),
  /unknown field/i,
);

assert.deepEqual(parseSskb(sskb({ minor: 65535 })), { pieces: [] });
assert.throws(() => parseSskb(concatBytes(Uint8Array.of(0x4e, 0x4f, 0x50, 0x45), sskb().slice(4))), /bad sskb magic/i);
assert.throws(() => parseSskb(sskb({ major: 2 })), /unsupported sskb major version/i);
assert.deepEqual(parseSskb(sskb({ major: 0, minor: 9 })), { pieces: [] });
assert.throws(() => parseSskb(sskb({ pieces: [inheritedPieceWithFieldMask(0x0100)] })), /reserved field_mask bits/i);
assert.throws(() => parseSskb(sskb({ pieces: [minimalPiece({ shape: 99 })] })), /invalid shape enum 99/i);
assert.throws(() => parseSskb(sskb({ pieces: [minimalPiece({ mode: 99 })] })), /invalid mode enum 99/i);
assert.throws(() => parseSskb(sskb({ rootProperties: Uint8Array.of(0xff) })), /property blob not valid UTF-8/i);
assert.throws(() => parseSskb(sskb({ rootProperties: 'name: one\nname: two\n' })), /Map keys must be unique|duplicate/i);

const defaultSskb = writeSskb({ pieces: [] });
const defaultSskbHeader = new DataView(defaultSskb.buffer, defaultSskb.byteOffset, defaultSskb.byteLength);
assert.equal(defaultSskbHeader.getUint16(4, true), 1);
assert.equal(defaultSskbHeader.getUint16(6, true), 0);

const legacySskb = writeSskb({ version: '0.9', pieces: [] });
const legacySskbHeader = new DataView(legacySskb.buffer, legacySskb.byteOffset, legacySskb.byteLength);
assert.equal(legacySskbHeader.getUint16(4, true), 0);
assert.equal(legacySskbHeader.getUint16(6, true), 9);

const source: SSKDocument = {
  pieces: [{
    id: 0,
    points: [{ x: 0, y: 0, z: 0 }],
    size: { x: 1, y: 1, z: 1 },
    shape: 'circle',
    properties: { name: 'base', weights: [1, 2.5, null] },
  }],
  properties: { meta: { enabled: true, label: 'round-trip' } },
};
assert.deepEqual(documentDifferences(source, parseSskb(writeSskb(source))), []);

const sourceSsk = writeSsk(source);
assert.deepEqual(documentDifferences(source, parseSsk(sourceSsk)), []);

console.log('ok format validation');

function sskb(options: { major?: number; minor?: number; pieces?: Uint8Array[]; rootProperties?: string | Uint8Array } = {}): Uint8Array {
  const pieces = options.pieces ?? [];
  const rootProperties = typeof options.rootProperties === 'string'
    ? encoder.encode(options.rootProperties)
    : options.rootProperties ?? new Uint8Array();
  return concatBytes(
    Uint8Array.of(0x53, 0x53, 0x4b, 0x42),
    u16(options.major ?? 1),
    u16(options.minor ?? 0),
    u32(pieces.length),
    ...pieces,
    u32(rootProperties.length),
    rootProperties,
  );
}

function minimalPiece(options: { shape?: number; mode?: number } = {}): Uint8Array {
  return concatBytes(
    u32(0),
    u8(0),
    u32(1),
    minimalPoint(),
    u8(0),
    f32(1), f32(1), f32(1),
    u8(options.shape ?? 0),
    u8(0),
    u8(options.mode ?? 0),
    u8(0),
    u32(0),
  );
}

function inheritedPieceWithFieldMask(mask: number): Uint8Array {
  return concatBytes(
    u32(1),
    u8(1),
    u32(0),
    u16(mask),
  );
}

function minimalPoint(): Uint8Array {
  return concatBytes(
    f32(0), f32(0), f32(0),
    u8(0), u8(0), u8(0), u8(0), u8(0), u8(0),
  );
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function u8(value: number): Uint8Array {
  return Uint8Array.of(value);
}

function u16(value: number): Uint8Array {
  return pack(2, (view) => view.setUint16(0, value, true));
}

function u32(value: number): Uint8Array {
  return pack(4, (view) => view.setUint32(0, value, true));
}

function f32(value: number): Uint8Array {
  return pack(4, (view) => view.setFloat32(0, value, true));
}

function pack(byteLength: number, write: (view: DataView) => void): Uint8Array {
  const out = new Uint8Array(byteLength);
  write(new DataView(out.buffer));
  return out;
}
