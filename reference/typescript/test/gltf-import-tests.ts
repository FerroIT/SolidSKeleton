import assert from 'node:assert/strict';

import {
  importGltfToSsk,
  meshDocument,
  parseSskb,
  validateDocument,
  writeGlb,
  writeSskb,
  type MeshData,
} from '../src/index.js';

const cube = box([1, 1, 1], [0, 0, 0]);
const cubeResult = importGltfToSsk(writeGlb(cube));
validateDocument(cubeResult.document);
assert.equal('properties' in cubeResult.document, false, 'generated SSK document must not have root properties');
assert.equal(cubeResult.document.pieces.length, 1, 'cube should recover one semantic piece');
assert.equal(cubeResult.document.pieces[0].shape, 'ngon');
assert.equal(cubeResult.document.pieces[0].sides, 4);
assert.ok(cubeResult.coveragePercent >= 70, `cube coverage was ${cubeResult.coveragePercent}`);
assert.ok(cubeResult.overfillPercent < 50);

const sskb = writeSskb(cubeResult.document);
validateDocument(parseSskb(sskb));
const cubeMesh = await meshDocument(validateDocument(cubeResult.document), { resolution: 8 });
assert.ok(cubeMesh && cubeMesh.faces.length > 0, 'generated SSK must be consumable by meshDocument');

const sphereResult = importGltfToSsk(writeGlb(uvSphere(0.5, 12, 24)));
assert.equal(sphereResult.document.pieces.length, 1);
assert.equal(sphereResult.document.pieces[0].shape, 'circle');
assert.equal(sphereResult.document.pieces[0].points?.length, 1);
assert.ok(Number.isFinite(sphereResult.coveragePercent));
assert.ok(Number.isFinite(sphereResult.overfillPercent));

const ladderResult = importGltfToSsk(writeGlb(ladder()), { expectedPieceCount: 6 });
validateDocument(ladderResult.document);
assert.ok(ladderResult.document.pieces.length > 1, 'ladder should not collapse to one piece');
assert.ok(ladderResult.document.pieces.filter((piece) => 'from' in piece).length >= 3, 'ladder repeated rungs should use inheritance');
assert.notEqual(ladderResult.document.pieces.length, 6, 'expectedPieceCount is a guide, not an exact quota');

// @ts-expect-error targetPieceCount is intentionally not part of the public options API.
importGltfToSsk(writeGlb(cube), { targetPieceCount: 6 });

console.log('ok gltf import');

function box(extents: number[], center: number[]): MeshData {
  const [sx, sy, sz] = extents.map((v) => v / 2);
  const [cx, cy, cz] = center;
  const vertices = [
    [cx - sx, cy - sy, cz - sz], [cx + sx, cy - sy, cz - sz], [cx + sx, cy + sy, cz - sz], [cx - sx, cy + sy, cz - sz],
    [cx - sx, cy - sy, cz + sz], [cx + sx, cy - sy, cz + sz], [cx + sx, cy + sy, cz + sz], [cx - sx, cy + sy, cz + sz],
  ];
  const faces = [
    [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7],
    [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5],
    [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7],
  ];
  return { vertices, faces };
}

function ladder(): MeshData {
  return mergeMeshes([
    box([0.08, 0.08, 2.0], [-0.35, 0, 0]),
    box([0.08, 0.08, 2.0], [0.35, 0, 0]),
    ...[-0.75, -0.375, 0, 0.375, 0.75].map((z) => box([0.7, 0.07, 0.07], [0, 0, z])),
  ]);
}

function uvSphere(radius: number, rows: number, cols: number): MeshData {
  const vertices: number[][] = [[0, radius, 0]];
  for (let i = 1; i < rows; i += 1) {
    const phi = Math.PI * i / rows;
    for (let j = 0; j < cols; j += 1) {
      const theta = 2 * Math.PI * j / cols;
      vertices.push([radius * Math.sin(phi) * Math.cos(theta), radius * Math.cos(phi), radius * Math.sin(phi) * Math.sin(theta)]);
    }
  }
  const bottom = vertices.length;
  vertices.push([0, -radius, 0]);
  const faces: number[][] = [];
  for (let j = 0; j < cols; j += 1) faces.push([0, 1 + ((j + 1) % cols), 1 + j]);
  for (let i = 0; i < rows - 2; i += 1) {
    const a = 1 + i * cols;
    const b = 1 + (i + 1) * cols;
    for (let j = 0; j < cols; j += 1) {
      const jn = (j + 1) % cols;
      faces.push([a + j, a + jn, b + jn], [a + j, b + jn, b + j]);
    }
  }
  const last = 1 + (rows - 2) * cols;
  for (let j = 0; j < cols; j += 1) faces.push([last + j, last + ((j + 1) % cols), bottom]);
  return { vertices, faces };
}

function mergeMeshes(meshes: MeshData[]): MeshData {
  const vertices: number[][] = [];
  const faces: number[][] = [];
  for (const mesh of meshes) {
    const offset = vertices.length;
    vertices.push(...mesh.vertices);
    faces.push(...mesh.faces.map((face) => face.map((index) => index + offset)));
  }
  return { vertices, faces };
}
