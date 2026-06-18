import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  canonicalDocument,
  convertDocument,
  documentDifferences,
  load,
  meshDocument,
  parseSskb,
  validateDocument,
  writeSskb,
} from '../src/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const examples = join(root, 'examples');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else if (entry.name.endsWith('.ssk')) out.push(path);
  }
  return out.sort();
}

function readText(path: string): string {
  return readFileSync(path, 'utf8');
}

function readBytes(path: string): Uint8Array {
  return new Uint8Array(readFileSync(path));
}

const sskFiles = walk(examples);
assert.ok(sskFiles.length > 0, 'examples should be discovered');

const pythonData = pythonExampleData(sskFiles);

for (const path of sskFiles) {
  const label = relative(root, path);
  const source = load(readText(path), 'ssk');
  const decoded = parseSskb(writeSskb(source));
  assert.deepEqual(documentDifferences(source, decoded), [], `${label} should round-trip through sskb`);

  const python = pythonData[normalizePath(path)];
  assert.ok(python, `${label} should have python comparison data`);
  assert.deepEqual(canonicalDocument(source), python.canonical, `${label} canonical document should match python`);
  assert.equal(base64(writeSskb(source)), python.writeSskbB64, `${label} sskb bytes should match python`);

  const decodedFromPython = parseSskb(fromBase64(python.writeSskbB64));
  assert.deepEqual(documentDifferences(source, decodedFromPython), [], `${label} should parse python-written sskb`);

  const sibling = path.replace(/\.ssk$/, '.sskb');
  const binary = load(readBytes(sibling), 'sskb');
  assert.deepEqual(documentDifferences(source, binary), [], `${label} should match paired sskb`);
  assert.deepEqual(canonicalDocument(binary), python.pairedCanonical, `${label} paired sskb canonical should match python`);

  const exampleGlb = await convertDocument(source, 'glb', { resolution: 8 });
  if (!(exampleGlb.data instanceof Uint8Array)) throw new Error(`${label} glb conversion should return bytes`);
  const parsedGlb = parseGlb(exampleGlb.data, `${label} glb`);

  const exampleGltf = await convertDocument(source, 'gltf', { resolution: 8, binUri: 'out.bin' });
  if (exampleGltf.data instanceof Uint8Array) throw new Error(`${label} gltf conversion should return JSON and BIN data`);
  assertGltfValid(parsedGlb.json, parsedGlb.bin, `${label} glb`);
  assertGltfValid(exampleGltf.data.json, exampleGltf.data.bin, `${label} gltf`);
  assert.deepEqual(normalizeGltfJson(parsedGlb.json), normalizeGltfJson(exampleGltf.data.json), `${label} glb and gltf JSON should describe the same mesh`);
  assert.equal(base64(parsedGlb.bin), base64(exampleGltf.data.bin), `${label} glb and gltf BIN payloads should match`);

  const pythonGlb = parseGlb(fromBase64(python.glbB64), `${label} python glb`);
  const pythonGltfBin = fromBase64(python.gltfBinB64);
  assertGltfValid(pythonGlb.json, pythonGlb.bin, `${label} python glb`);
  assertGltfValid(python.gltfJson, pythonGltfBin, `${label} python gltf`);
  assert.deepEqual(normalizeGltfJson(pythonGlb.json), normalizeGltfJson(python.gltfJson), `${label} python glb and gltf JSON should describe the same mesh`);
  assert.equal(base64(pythonGlb.bin), base64(pythonGltfBin), `${label} python glb and gltf BIN payloads should match`);

  assertMeshSummaryClose(meshSummary(parsedGlb.json, parsedGlb.bin), meshSummary(pythonGlb.json, pythonGlb.bin), `${label} glb mesh summary should match python`);
  assertMeshSummaryClose(meshSummary(exampleGltf.data.json, exampleGltf.data.bin), meshSummary(python.gltfJson, pythonGltfBin), `${label} gltf mesh summary should match python`);
}

const sphere = validateDocument(load(readText(join(examples, 'primitives', 'sphere', 'sphere.ssk')), 'ssk'));
const low = await meshDocument(sphere, { resolution: 8 });
const high = await meshDocument(sphere, { resolution: 16 });
if (!low || !high) throw new Error('sphere mesh should not be empty');
assert.ok(low.vertices.length < high.vertices.length);
assert.ok(low.faces.length < high.faces.length);

const glb = await convertDocument(load(readText(join(examples, 'primitives', 'sphere', 'sphere.ssk')), 'ssk'), 'glb', { resolution: 8 });
if (!(glb.data instanceof Uint8Array)) throw new Error('glb conversion should return bytes');
assert.equal(new DataView(glb.data.buffer, glb.data.byteOffset, glb.data.byteLength).getUint32(0, true), 0x46546c67);

console.log(`ok ${sskFiles.length} examples`);

type PythonExampleData = Record<string, {
  canonical: unknown;
  pairedCanonical: unknown;
  writeSskbB64: string;
  glbB64: string;
  gltfJson: unknown;
  gltfBinB64: string;
}>;

function pythonExampleData(paths: string[]): PythonExampleData {
  const script = String.raw`
import base64
import json
import sys
import tempfile
from pathlib import Path

root = Path(sys.argv[1])
sys.path.insert(0, str(root / 'reference' / 'python'))

from ssklib.api import canonical_document, load, mesh_document, validate_document
from ssklib.gltf import write_glb, write_gltf
from ssklib.write_sskb import write as write_sskb

out = {}
for raw_path in sys.argv[2:]:
    path = Path(raw_path)
    source = load(path)
    paired = load(path.with_suffix('.sskb'))
    resolved = validate_document(source)
    vertices, faces = mesh_document(resolved, resolution=8)
    with tempfile.TemporaryDirectory() as temp_dir:
      glb_path = Path(temp_dir) / 'out.glb'
      gltf_path = Path(temp_dir) / 'out.gltf'
      write_glb(vertices, faces, str(glb_path))
      write_gltf(vertices, faces, str(gltf_path))
      glb_b64 = base64.b64encode(glb_path.read_bytes()).decode('ascii')
      gltf_json = json.loads(gltf_path.read_text(encoding='utf-8'))
      gltf_bin_b64 = base64.b64encode(gltf_path.with_suffix('.bin').read_bytes()).decode('ascii')
    out[path.resolve().as_posix().lower()] = {
        'canonical': canonical_document(source),
        'pairedCanonical': canonical_document(paired),
        'writeSskbB64': base64.b64encode(write_sskb(source)).decode('ascii'),
      'glbB64': glb_b64,
      'gltfJson': gltf_json,
      'gltfBinB64': gltf_bin_b64,
    }
print(json.dumps(out, sort_keys=True))
`;
  const result = spawnSync('python', ['-c', script, root, ...paths], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'python comparison failed');
  return JSON.parse(result.stdout) as PythonExampleData;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase();
}

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function fromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'));
}

type ParsedGlb = { json: unknown; bin: Uint8Array };
type MeshSummary = { vertexCount: number; triangleCount: number; min: number[]; max: number[]; area: number };

function parseGlb(data: Uint8Array, label: string): ParsedGlb {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  assert.equal(view.getUint32(0, true), 0x46546c67, `${label} should have GLB magic`);
  assert.equal(view.getUint32(4, true), 2, `${label} should be GLB version 2`);
  assert.equal(view.getUint32(8, true), data.byteLength, `${label} should declare its total byte length`);

  let offset = 12;
  const jsonLength = view.getUint32(offset, true);
  const jsonChunkType = view.getUint32(offset + 4, true);
  assert.equal(jsonChunkType, 0x4e4f534a, `${label} first chunk should be JSON`);
  offset += 8;
  const jsonText = new TextDecoder().decode(data.slice(offset, offset + jsonLength)).trimEnd();
  const json = JSON.parse(jsonText) as unknown;
  offset += jsonLength;

  const binLength = view.getUint32(offset, true);
  const binChunkType = view.getUint32(offset + 4, true);
  assert.equal(binChunkType, 0x004e4942, `${label} second chunk should be BIN`);
  offset += 8;
  const bin = data.slice(offset, offset + binLength);
  assert.equal(offset + binLength, data.byteLength, `${label} should not have trailing data`);
  return { json, bin };
}

function assertGltfValid(json: unknown, bin: Uint8Array, label: string): void {
  const doc = json as Record<string, any>;
  assert.equal(doc.asset?.version, '2.0', `${label} should be glTF 2.0`);
  assert.equal(doc.buffers?.[0]?.byteLength, bin.byteLength, `${label} buffer length should match BIN payload`);
  assert.ok(Array.isArray(doc.bufferViews), `${label} should contain bufferViews`);
  assert.ok(Array.isArray(doc.accessors), `${label} should contain accessors`);
  for (const [index, bufferView] of doc.bufferViews.entries()) {
    const byteOffset = bufferView.byteOffset ?? 0;
    assert.ok(byteOffset + bufferView.byteLength <= bin.byteLength, `${label} bufferView ${index} should fit in BIN payload`);
  }
  assert.ok(doc.accessors[0].count > 0, `${label} should have position vertices`);
  assert.ok(doc.accessors[1].count > 0, `${label} should have normal vertices`);
  assert.ok(doc.accessors[2].count > 0 && doc.accessors[2].count % 3 === 0, `${label} should have triangle indices`);
  assert.equal(doc.accessors[0].count, doc.accessors[1].count, `${label} positions and normals should have matching counts`);
}

function normalizeGltfJson(json: unknown): unknown {
  const copy = structuredClone(json) as Record<string, any>;
  if (copy.buffers?.[0]) delete copy.buffers[0].uri;
  return copy;
}

function meshSummary(json: unknown, bin: Uint8Array): MeshSummary {
  const doc = json as Record<string, any>;
  const positionAccessor = doc.accessors[0];
  const indexAccessor = doc.accessors[2];
  const positionView = doc.bufferViews[positionAccessor.bufferView];
  const indexView = doc.bufferViews[indexAccessor.bufferView];
  const positions = readFloat32Triples(bin, (positionView.byteOffset ?? 0) + (positionAccessor.byteOffset ?? 0), positionAccessor.count);
  const indices = readUint32Values(bin, (indexView.byteOffset ?? 0) + (indexAccessor.byteOffset ?? 0), indexAccessor.count);
  return {
    vertexCount: positionAccessor.count,
    triangleCount: indexAccessor.count / 3,
    min: positionAccessor.min,
    max: positionAccessor.max,
    area: surfaceArea(positions, indices),
  };
}

function readFloat32Triples(bin: Uint8Array, byteOffset: number, count: number): number[][] {
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  return Array.from({ length: count }, (_, index) => [
    view.getFloat32(byteOffset + index * 12, true),
    view.getFloat32(byteOffset + index * 12 + 4, true),
    view.getFloat32(byteOffset + index * 12 + 8, true),
  ]);
}

function readUint32Values(bin: Uint8Array, byteOffset: number, count: number): number[] {
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  return Array.from({ length: count }, (_, index) => view.getUint32(byteOffset + index * 4, true));
}

function surfaceArea(positions: number[][], indices: number[]): number {
  let area = 0;
  for (let index = 0; index < indices.length; index += 3) {
    const a = positions[indices[index]];
    const b = positions[indices[index + 1]];
    const c = positions[indices[index + 2]];
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cross = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    area += 0.5 * Math.hypot(cross[0], cross[1], cross[2]);
  }
  return area;
}

function assertMeshSummaryClose(left: MeshSummary, right: MeshSummary, label: string): void {
  for (let axis = 0; axis < 3; axis += 1) {
    assertClose(left.min[axis], right.min[axis], `${label} min[${axis}]`);
    assertClose(left.max[axis], right.max[axis], `${label} max[${axis}]`);
  }
  assertClose(left.area, right.area, `${label} surface area`, 0.02);
}

function assertClose(left: number, right: number, label: string, relTol = 1e-5, absTol = 1e-7): void {
  const tolerance = Math.max(absTol, relTol * Math.max(Math.abs(left), Math.abs(right)));
  assert.ok(Math.abs(left - right) <= tolerance, `${label}: ${left} != ${right}`);
}
