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
  parseSsk,
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

assert.throws(() => parseSsk('pieces: []\npieces: []\n'), /Map keys must be unique|duplicate/i);
assert.throws(() => parseSsk('%YAML 1.2\n---\npieces: []\n'), /directives|YAML/i);
assert.throws(() => parseSsk('pieces: !!seq []\n'), /explicit tags/i);
assert.equal(parseSsk('pieces: []\nproperties:\n  note: hello !world\n').properties?.note, 'hello !world');
assert.throws(() => parseSsk('pieces: []\nproperties:\n  1: x\n'), /keys must be strings/i);

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

type PythonExampleData = Record<string, { canonical: unknown; pairedCanonical: unknown; writeSskbB64: string }>;

function pythonExampleData(paths: string[]): PythonExampleData {
  const script = String.raw`
import base64
import json
import sys
from pathlib import Path

root = Path(sys.argv[1])
sys.path.insert(0, str(root / 'reference' / 'python'))

from ssklib.api import canonical_document, load
from ssklib.write_sskb import write as write_sskb

out = {}
for raw_path in sys.argv[2:]:
    path = Path(raw_path)
    source = load(path)
    paired = load(path.with_suffix('.sskb'))
    out[path.resolve().as_posix().lower()] = {
        'canonical': canonical_document(source),
        'pairedCanonical': canonical_document(paired),
        'writeSskbB64': base64.b64encode(write_sskb(source)).decode('ascii'),
    }
print(json.dumps(out, sort_keys=True))
`;
  const result = spawnSync('python', ['-c', script, root, ...paths], { encoding: 'utf8' });
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
