import type { GltfOutput, MeshData } from './types.js';

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

export function writeGlb(mesh: MeshData): Uint8Array {
  const unindexed = unindex(mesh);
  const bin = buffer(unindexed.vertices, unindexed.normals, unindexed.faces);
  const jsonBytes = paddedJson(gltfJson(unindexed.vertices, unindexed.normals, unindexed.faces, bin.length));

  const total = 12 + 8 + jsonBytes.length + 8 + bin.length;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let offset = 0;
  view.setUint32(offset, GLB_MAGIC, true); offset += 4;
  view.setUint32(offset, 2, true); offset += 4;
  view.setUint32(offset, total, true); offset += 4;
  view.setUint32(offset, jsonBytes.length, true); offset += 4;
  view.setUint32(offset, JSON_CHUNK, true); offset += 4;
  out.set(jsonBytes, offset); offset += jsonBytes.length;
  view.setUint32(offset, bin.length, true); offset += 4;
  view.setUint32(offset, BIN_CHUNK, true); offset += 4;
  out.set(bin, offset);
  return out;
}

export function writeGltf(mesh: MeshData, binUri = 'model.bin'): GltfOutput {
  const unindexed = unindex(mesh);
  const bin = buffer(unindexed.vertices, unindexed.normals, unindexed.faces);
  return { json: gltfJson(unindexed.vertices, unindexed.normals, unindexed.faces, bin.length, binUri), bin, binUri };
}

function unindex(mesh: MeshData): MeshData & { normals: number[][] } {
  const vertices: number[][] = [];
  const normals: number[][] = [];
  const faces: number[][] = [];
  mesh.faces.forEach((face, faceIndex) => {
    const v0 = mesh.vertices[face[0]];
    const v1 = mesh.vertices[face[1]];
    const v2 = mesh.vertices[face[2]];
    const n = normal(v0, v1, v2);
    const base = faceIndex * 3;
    vertices.push(v0, v1, v2);
    normals.push(n, n, n);
    faces.push([base, base + 1, base + 2]);
  });
  return { vertices, normals, faces };
}

function normal(v0: number[], v1: number[], v2: number[]): number[] {
  const a = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]];
  const b = [v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]];
  const n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const length = Math.hypot(n[0], n[1], n[2]);
  return length < 1e-10 ? [0, 0, 0] : [n[0] / length, n[1] / length, n[2] / length];
}

function buffer(vertices: number[][], normals: number[][], faces: number[][]): Uint8Array {
  const vertexBytes = float32Bytes(vertices.flat());
  const normalBytes = float32Bytes(normals.flat());
  const indexBytes = uint32Bytes(faces.flat());
  const length = align4(vertexBytes.length + normalBytes.length + indexBytes.length);
  const out = new Uint8Array(length);
  let offset = 0;
  out.set(vertexBytes, offset); offset += vertexBytes.length;
  out.set(normalBytes, offset); offset += normalBytes.length;
  out.set(indexBytes, offset);
  return out;
}

function gltfJson(vertices: number[][], normals: number[][], faces: number[][], bufLen: number, binUri?: string): unknown {
  const nv = vertices.length;
  const nt = faces.length;
  const pl = nv * 12;
  const nl = normals.length * 12;
  const il = nt * 12;
  const bufferEntry: Record<string, unknown> = { byteLength: bufLen };
  if (binUri) bufferEntry.uri = binUri;
  return {
    asset: { version: '2.0', generator: 'ssk' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, mode: 4 }] }],
    accessors: [
      { bufferView: 0, byteOffset: 0, componentType: 5126, count: nv, type: 'VEC3', min: min(vertices), max: max(vertices) },
      { bufferView: 1, byteOffset: 0, componentType: 5126, count: nv, type: 'VEC3' },
      { bufferView: 2, byteOffset: 0, componentType: 5125, count: nt * 3, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pl, target: 34962 },
      { buffer: 0, byteOffset: pl, byteLength: nl, target: 34962 },
      { buffer: 0, byteOffset: pl + nl, byteLength: il, target: 34963 },
    ],
    buffers: [bufferEntry],
  };
}

function float32Bytes(values: number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setFloat32(index * 4, value, true));
  return bytes;
}

function uint32Bytes(values: number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setUint32(index * 4, value, true));
  return bytes;
}

function paddedJson(value: unknown): Uint8Array {
  const raw = new TextEncoder().encode(JSON.stringify(value));
  const out = new Uint8Array(align4(raw.length));
  out.set(raw);
  out.fill(0x20, raw.length);
  return out;
}

function align4(value: number): number {
  return value + ((4 - value % 4) % 4);
}

function min(values: number[][]): number[] {
  return [0, 1, 2].map((axis) => Math.min(...values.map((value) => value[axis])));
}

function max(values: number[][]): number[] {
  return [0, 1, 2].map((axis) => Math.max(...values.map((value) => value[axis])));
}
