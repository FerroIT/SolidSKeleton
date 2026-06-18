import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import { SSKError } from './error.js';
import type { MeshData, ResolvedPiece } from './types.js';

let manifoldModule: Promise<ManifoldToplevel> | null = null;
type Operation = 'union' | 'intersection' | 'difference';
type BooleanContext = { description: string; left: string; right: string };

export async function evaluate(pieces: ResolvedPiece[], meshes: Map<number, MeshData | null>, options: { strict?: boolean } = {}): Promise<MeshData | null> {
  const strict = options.strict ?? true;
  const module = await getManifoldModule();
  const sorted = [...pieces].sort((a, b) => a.id - b.id);
  const active = new Map<number, Manifold>();

  for (const piece of sorted) {
    const mesh = meshes.get(piece.id);
    if (mesh && mesh.faces.length > 0) active.set(piece.id, toManifold(module, mesh, piece));
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
      .map((other) => [other.id, active.get(other.id)!] as const);
    if (!targets.length) continue;
    let union = targets[0][1];
    for (const [targetId, target] of targets.slice(1)) {
      union = op(
        union,
        target,
        'union',
        strict,
        {
          description: `intersect piece ${piece.id} candidate union with piece ${targetId}`,
          left: `intersect piece ${piece.id} candidate union`,
          right: `piece ${targetId}`,
        },
      );
    }
    const result = op(
      active.get(piece.id)!,
      union,
      'intersection',
      strict,
      {
        description: `intersect piece ${piece.id} with candidate union`,
        left: `piece ${piece.id}`,
        right: `intersect piece ${piece.id} candidate union`,
      },
    );
    if (meshFromManifold(result).faces.length > 0) contrib.set(piece.id, result);
  }

  if (!contrib.size) return null;

  for (const piece of sorted) {
    if (!active.has(piece.id) || modeOf.get(piece.id) !== 'subtract') continue;
    const affects = piece.affects ? new Set(piece.affects) : null;
    for (const id of [...contrib.keys()]) {
      if (affects && !affects.has(id)) continue;
      const result = op(
        contrib.get(id)!,
        active.get(piece.id)!,
        'difference',
        strict,
        {
          description: `subtract piece ${piece.id} from piece ${id}`,
          left: `piece ${id} result`,
          right: `subtract piece ${piece.id}`,
        },
      );
      const mesh = meshFromManifold(result);
      if (mesh.faces.length > 0) contrib.set(id, result);
      else contrib.delete(id);
    }
  }

  if (!contrib.size) return null;
  const ids = [...contrib.keys()].sort((a, b) => a - b);
  let result = contrib.get(ids[0])!;
  for (const id of ids.slice(1)) {
    result = op(
      result,
      contrib.get(id)!,
      'union',
      strict,
      {
        description: `final union with piece ${id}`,
        left: 'current final result',
        right: `piece ${id} result`,
      },
    );
  }
  return meshFromManifold(result);
}

async function getManifoldModule(): Promise<ManifoldToplevel> {
  manifoldModule ??= import('manifold-3d')
    .then(({ default: initManifold }) => initManifold())
    .then((module) => {
      module.setup();
      return module;
    });
  return manifoldModule;
}

function toManifold(module: ManifoldToplevel, mesh: MeshData, piece: ResolvedPiece): Manifold {
  const vertProperties = new Float32Array(mesh.vertices.length * 3);
  mesh.vertices.forEach((vertex, index) => vertProperties.set(vertex, index * 3));
  const triVerts = new Uint32Array(mesh.faces.length * 3);
  mesh.faces.forEach((face, index) => triVerts.set(face, index * 3));
  try {
    const manifold = module.Manifold.ofMesh(new module.Mesh({ numProp: 3, vertProperties, triVerts }));
    assertManifoldOk(manifold);
    return manifold;
  } catch (error) {
    throw new SSKError(
      `piece ${piece.id} (${piece.mode ?? 'add'}): manifold import failed: ${errorText(error)}; ${meshDiagnostics(mesh)}`,
    );
  }
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

function op(a: Manifold, b: Manifold, operation: Operation, strict: boolean, context: BooleanContext): Manifold {
  try {
    const result = operation === 'union' ? a.add(b) : operation === 'intersection' ? a.intersect(b) : a.subtract(b);
    assertManifoldOk(result);
    return result;
  } catch (error) {
    if (strict) {
      throw new SSKError(
        `boolean ${operation} failed: ${context.description}; ${errorText(error)}; ` +
        `${manifoldDiagnostics(context.left, a)}; ${manifoldDiagnostics(context.right, b)}`,
      );
    }
    return operation === 'union' ? a.add(b) : a;
  }
}

function assertManifoldOk(manifold: Manifold): void {
  const status = manifold.status();
  if (status !== 'NoError') throw new SSKError(`manifold status ${status}`);
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    const withCode = error as Error & { code?: unknown };
    const code = typeof withCode.code === 'string' ? ` (${withCode.code})` : '';
    return `${error.message || error.name}${code}`.replace(/\s+/g, ' ').trim();
  }
  return String(error).replace(/\s+/g, ' ').trim();
}

function meshDiagnostics(mesh: MeshData): string {
  const diagnostics = rawMeshDiagnostics(mesh);
  return [
    `mesh: ${mesh.vertices.length} vertices, ${mesh.faces.length} triangles`,
    `non_finite_vertices=${diagnostics.nonFiniteVertices}`,
    `invalid_faces=${diagnostics.invalidFaces}`,
    `degenerate_faces=${diagnostics.degenerateFaces}`,
    `boundary_edges=${diagnostics.boundaryEdges}`,
    `non_manifold_edges=${diagnostics.nonManifoldEdges}`,
    `bounds=${boundsText(mesh.vertices)}`,
  ].join(', ');
}

function manifoldDiagnostics(label: string, manifold: Manifold): string {
  const parts = [
    `${label}: ${manifold.numVert()} vertices`,
    `${manifold.numTri()} triangles`,
    `status=${manifold.status()}`,
  ];
  try {
    const bounds = manifold.boundingBox();
    parts.push(`bounds=min=${vecText(bounds.min)}, max=${vecText(bounds.max)}`);
  } catch {
    parts.push('bounds=unavailable');
  }
  return parts.join(', ');
}

function rawMeshDiagnostics(mesh: MeshData): {
  nonFiniteVertices: number;
  invalidFaces: number;
  degenerateFaces: number;
  boundaryEdges: number;
  nonManifoldEdges: number;
} {
  let nonFiniteVertices = 0;
  let invalidFaces = 0;
  let degenerateFaces = 0;
  const edgeCounts = new Map<string, number>();

  mesh.vertices.forEach((vertex) => {
    if (!Number.isFinite(vertex[0]) || !Number.isFinite(vertex[1]) || !Number.isFinite(vertex[2])) nonFiniteVertices += 1;
  });

  for (const face of mesh.faces) {
    if (face.length !== 3 || face.some((index) => !Number.isInteger(index) || index < 0 || index >= mesh.vertices.length)) {
      invalidFaces += 1;
      continue;
    }
    if (new Set(face).size < 3 || triangleAreaSquared(mesh.vertices, face) <= 1e-24) degenerateFaces += 1;
    for (const [a, b] of [[face[0], face[1]], [face[1], face[2]], [face[2], face[0]]] as const) {
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
    }
  }

  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  for (const count of edgeCounts.values()) {
    if (count === 1) boundaryEdges += 1;
    else if (count > 2) nonManifoldEdges += 1;
  }

  return { nonFiniteVertices, invalidFaces, degenerateFaces, boundaryEdges, nonManifoldEdges };
}

function triangleAreaSquared(vertices: number[][], face: number[]): number {
  const a = vertices[face[0]];
  const b = vertices[face[1]];
  const c = vertices[face[2]];
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const cross = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  return cross[0] ** 2 + cross[1] ** 2 + cross[2] ** 2;
}

function boundsText(vertices: number[][]): string {
  const finite = vertices.filter((vertex) => Number.isFinite(vertex[0]) && Number.isFinite(vertex[1]) && Number.isFinite(vertex[2]));
  if (!finite.length) return 'unavailable';
  const min = [...finite[0]];
  const max = [...finite[0]];
  for (const vertex of finite.slice(1)) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], vertex[axis]);
      max[axis] = Math.max(max[axis], vertex[axis]);
    }
  }
  return `min=${vecText(min)}, max=${vecText(max)}`;
}

function vecText(value: number[] | { x: number; y: number; z: number }): string {
  const vector = Array.isArray(value) ? value : [value.x, value.y, value.z];
  return `(${vector.map(formatNumber).join(', ')})`;
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? Number(value.toPrecision(6)).toString() : String(value);
}
