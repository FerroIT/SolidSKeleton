import initManifold, { type Manifold, type ManifoldToplevel } from 'manifold-3d';
import { SSKError } from './error.js';
import type { MeshData, ResolvedPiece } from './types.js';

let manifoldModule: Promise<ManifoldToplevel> | null = null;

export async function evaluate(pieces: ResolvedPiece[], meshes: Map<number, MeshData | null>, options: { strict?: boolean } = {}): Promise<MeshData | null> {
  const strict = options.strict ?? true;
  const module = await getManifoldModule();
  const sorted = [...pieces].sort((a, b) => a.id - b.id);
  const active = new Map<number, Manifold>();

  for (const piece of sorted) {
    const mesh = meshes.get(piece.id);
    if (mesh && mesh.faces.length > 0) active.set(piece.id, toManifold(module, mesh));
  }
  if (!active.size) return null;

  const modeOf = new Map<number, string>();
  const addIds: number[] = [];
  for (const piece of sorted) {
    if (!active.has(piece.id)) continue;
    const mode = piece.mode ?? 'add';
    modeOf.set(piece.id, mode);
    if (mode === 'add') addIds.push(piece.id);
  }

  const contrib = new Map<number, Manifold>();
  for (const id of addIds) contrib.set(id, active.get(id)!);

  for (const piece of sorted) {
    if (!active.has(piece.id) || modeOf.get(piece.id) !== 'intersect') continue;
    const affects = piece.affects ? new Set(piece.affects) : null;
    const targets = sorted
      .filter((other) => other.id !== piece.id && active.has(other.id) && ['add', 'intersect'].includes(modeOf.get(other.id) ?? 'add') && (!affects || affects.has(other.id)))
      .map((other) => active.get(other.id)!);
    if (!targets.length) continue;
    let union = targets[0];
    for (const target of targets.slice(1)) union = op(union, target, 'union', strict);
    const result = op(active.get(piece.id)!, union, 'intersection', strict);
    if (meshFromManifold(result).faces.length > 0) contrib.set(piece.id, result);
  }

  if (!contrib.size) return null;

  for (const piece of sorted) {
    if (!active.has(piece.id) || modeOf.get(piece.id) !== 'subtract') continue;
    const affects = piece.affects ? new Set(piece.affects) : null;
    for (const id of [...contrib.keys()]) {
      if (affects && !affects.has(id)) continue;
      const result = op(contrib.get(id)!, active.get(piece.id)!, 'difference', strict);
      const mesh = meshFromManifold(result);
      if (mesh.faces.length > 0) contrib.set(id, result);
      else contrib.delete(id);
    }
  }

  if (!contrib.size) return null;
  const ids = [...contrib.keys()].sort((a, b) => a - b);
  let result = contrib.get(ids[0])!;
  for (const id of ids.slice(1)) result = op(result, contrib.get(id)!, 'union', strict);
  return meshFromManifold(result);
}

async function getManifoldModule(): Promise<ManifoldToplevel> {
  manifoldModule ??= initManifold().then((module) => {
    module.setup();
    return module;
  });
  return manifoldModule;
}

function toManifold(module: ManifoldToplevel, mesh: MeshData): Manifold {
  const vertProperties = new Float32Array(mesh.vertices.length * 3);
  mesh.vertices.forEach((vertex, index) => vertProperties.set(vertex, index * 3));
  const triVerts = new Uint32Array(mesh.faces.length * 3);
  mesh.faces.forEach((face, index) => triVerts.set(face, index * 3));
  return module.Manifold.ofMesh(new module.Mesh({ numProp: 3, vertProperties, triVerts }));
}

function meshFromManifold(manifold: Manifold): MeshData {
  const mesh = manifold.getMesh();
  const vertices: number[][] = [];
  for (let i = 0; i < mesh.vertProperties.length; i += mesh.numProp) {
    vertices.push([mesh.vertProperties[i], mesh.vertProperties[i + 1], mesh.vertProperties[i + 2]]);
  }
  const faces: number[][] = [];
  for (let i = 0; i < mesh.triVerts.length; i += 3) {
    faces.push([mesh.triVerts[i], mesh.triVerts[i + 1], mesh.triVerts[i + 2]]);
  }
  return { vertices, faces };
}

function op(a: Manifold, b: Manifold, operation: 'union' | 'intersection' | 'difference', strict: boolean): Manifold {
  try {
    if (operation === 'union') return a.add(b);
    if (operation === 'intersection') return a.intersect(b);
    return a.subtract(b);
  } catch (error) {
    if (strict) throw new SSKError(`boolean ${operation} failed: ${(error as Error).message}`);
    return operation === 'union' ? a.add(b) : a;
  }
}
