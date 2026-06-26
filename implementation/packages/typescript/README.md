# SolidSKeleton TypeScript

ESM package for browsers and Node.js.

This package is a reference implementation for reading, validating, writing, tessellating, and importing SolidSKeleton documents. Format rules are defined by the repository specifications, not by package implementation details.

```sh
npm install @ferroit/ssk
```

---

## Convert SSK to GLB

`load` parses the input. `convertDocument` resolves inheritance, validates the document, and writes the requested output format. Mesh output formats are tessellated during conversion.

```ts
import { convertDocument, load } from '@ferroit/ssk';
import { readFile, writeFile } from 'node:fs/promises';

const source = await readFile('model.ssk', 'utf8');
const document = load(source, 'ssk');

const glb = await convertDocument(document, 'glb', { resolution: 64 });
await writeFile('model.glb', glb.data);

console.log(`${glb.pieceCount} pieces, ${glb.triangleCount} triangles`);
```

For binary SSKB input, pass bytes and `sskb`:

```ts
const bytes = await readFile('model.sskb');
const document = load(bytes, 'sskb');
const glb = await convertDocument(document, 'glb');
```

## Validate Before Low-Level Work

Use `validateDocument` when you want a resolved, validated document for inspection, comparison, or lower-level mesh calls.

```ts
import { inspectDocument, load, validateDocument } from '@ferroit/ssk';
import { readFile } from 'node:fs/promises';

const source = await readFile('model.ssk', 'utf8');
const document = load(source, 'ssk');
const resolved = validateDocument(document);

console.log(resolved.pieces.length);
console.log(inspectDocument(document));
```

`load` only parses. `validateDocument`, `convertDocument`, and `inspectDocument` all resolve inheritance and validate structure.

## Estimate SSK from GLB/glTF

GLB/glTF import is an estimated reconstruction, not a reversible conversion. The importer generates SSK-native candidates where practical, scores them against the source mesh, and returns the best candidate with coverage and overfill metrics.

```ts
import { importGltfToSsk, writeSsk } from '@ferroit/ssk';
import { readFile, writeFile } from 'node:fs/promises';

const glb = await readFile('model.glb');
const result = importGltfToSsk(glb, {
	expectedPieceCount: 12,
	resolution: 32,
});

await writeFile('estimated.ssk', writeSsk(result.document), 'utf8');

console.log(`coverage: ${result.coveragePercent}%`);
console.log(`overfill: ${result.overfillPercent}%`);
```

`expectedPieceCount` is a soft guide, not a target. Import scoring can also be tuned with `infillWeight`, `outfillWeight`, `complexityWeight`, and `maxPieces`.

The returned document has already been validated by the importer. Validate it again after modifying it.

For `.gltf` with an external BIN buffer, pass both parts:

```ts
const result = importGltfToSsk({ json: gltfJson, bin: gltfBin });
```

## API Surface

Common entry points:

```ts
import {
	convertDocument,
	documentDifferences,
	documentsEquivalent,
	importGltfToSsk,
	inspectDocument,
	load,
	validateDocument,
	writeSsk,
	writeSskb,
} from '@ferroit/ssk';
```

Lower-level entry points:

```ts
import { parseSsk, parseSskb, resolve, validate, writeGlb, writeGltf } from '@ferroit/ssk';
```

## Notes

- Mesh output defaults to resolution 32.
- `convertDocument(document, 'ssk')` returns text. `sskb` and `glb` return `Uint8Array`. `gltf` returns `{ json, bin, binUri }`.
- The Rust core is shipped as WebAssembly in the npm package. Browser bundlers must keep `dist/wasm/ssk_core_bg.wasm` next to `dist/wasm/ssk_core.js` or serve it as an emitted asset.
- GLB/glTF import is approximate and reports sampled volume coverage and overfill percentages.
- glTF output uses unindexed meshes with flat per-face normals.
