import { SSKError } from './error.js';
import type { MeshData, Point, ResolvedDocument, ResolvedPiece } from './types.js';
import { sskToGltf } from './vecmath.js';
import initCore, { mesh_document_json } from './wasm/ssk_core.js';

let coreReady: Promise<void> | null = null;

export async function meshDocumentFromCore(doc: ResolvedDocument, options: { resolution?: number } = {}): Promise<MeshData | null> {
  await initRustCore();

  const payload = JSON.stringify({ document: coreDocument(doc), resolution: options.resolution ?? 32 });
  let response: string;
  try {
    response = mesh_document_json(payload);
  } catch (error) {
    throw new SSKError(error instanceof Error ? error.message : String(error));
  }

  const mesh = JSON.parse(response) as MeshData;
  if (!mesh.faces.length) return null;
  return { vertices: sskToGltf(mesh.vertices), faces: mesh.faces };
}

function initRustCore(): Promise<void> {
  coreReady ??= (async () => {
    const wasmUrl = new URL('./wasm/ssk_core_bg.wasm', import.meta.url);
    await initCore({ module_or_path: isNodeRuntime() ? await readNodeFile(wasmUrl) : wasmUrl });
  })();
  return coreReady;
}

function isNodeRuntime(): boolean {
  return typeof process !== 'undefined' && Boolean(process.versions?.node);
}

async function readNodeFile(url: URL): Promise<Uint8Array> {
  const nodeImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<{ readFile: (path: URL) => Promise<Uint8Array> }>;
  const { readFile } = await nodeImport('node:fs/promises');
  return readFile(url);
}

function coreDocument(doc: ResolvedDocument) {
  return { pieces: [...doc.pieces].sort((a, b) => a.id - b.id).map(corePiece) };
}

function corePiece(piece: ResolvedPiece) {
  return {
    id: piece.id,
    points: piece.points.map(corePoint),
    size: piece.size,
    shape: piece.shape,
    sides: piece.sides ?? null,
    rotation: piece.rotation ?? null,
    mode: piece.mode ?? 'add',
    affects: piece.affects ?? null,
  };
}

function corePoint(point: Point) {
  return {
    x: point.x,
    y: point.y,
    z: point.z,
    curve_out: point.curve_out ?? null,
    curve_in: point.curve_in ?? null,
    size: point.size ?? null,
    rotation: point.rotation ?? null,
    transition_out: point.transition_out ?? null,
    transition_in: point.transition_in ?? null,
  };
}
