# SolidSKeleton TypeScript

Browser ESM package.

```sh
npm install @ferroit/ssk
```

## Usage

```ts
import { convertDocument, importGltfToSsk, load, validateDocument } from '@ferroit/ssk';

const doc = validateDocument(load(sskText, 'ssk'));
const glb = await convertDocument(doc, 'glb', { resolution: 64 });

const imported = importGltfToSsk(glbBytes, {
  expectedPieceCount: 42,  // soft guide
  infillWeight: 1.18,
  outfillWeight: 1.05,
  complexityWeight: 1.0,
});
// .gltf JSON + BIN is also accepted: { json: gltfJson, bin: gltfBin }
console.log(imported.coveragePercent, imported.overfillPercent);

const quality = await imported.scoreDocument(someDoc);
```

Lower-level functions:

```ts
import { parseSsk, parseSskb, resolve, tessellate, validate, writeSskb } from '@ferroit/ssk';
```

## Notes

- Mesh output defaults to resolution 32.
- GLB import reconstructs (estimated) SSK-native primitives where practical and reports sampled volume coverage and overfill percentages. `expectedPieceCount` is a soft guide, not an exact target. Import weight options (`infillWeight`, `outfillWeight`, `complexityWeight`) tune the scoring between candidates on a normalised 0–1 scale. Expect slightly different results from the Python package due to numpy vs. JavaScript math differences.
- Per-piece `tessellate` is pure TypeScript.
- Document-level CSG and glTF/GLB conversion use [Manifold](https://github.com/elalish/manifold) via `manifold-3d` WASM.
- glTF output uses unindexed meshes with flat per-face normals.
