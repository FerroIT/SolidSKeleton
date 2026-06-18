# SolidSKeleton TypeScript

Browser ESM package.

```sh
npm install @ferroit/ssk
```

## Usage

```ts
import { convertDocument, load, validateDocument } from '@ferroit/ssk';

const doc = validateDocument(load(sskText, 'ssk'));
const glb = await convertDocument(doc, 'glb', { resolution: 64 });
```

Lower-level functions:

```ts
import { parseSsk, parseSskb, resolve, tessellate, validate, writeSskb } from '@ferroit/ssk';
```

## Notes

- Mesh output defaults to resolution 32.
- Per-piece `tessellate` is pure TypeScript.
- Document-level CSG and glTF/GLB conversion use [Manifold](https://github.com/elalish/manifold) via `manifold-3d` WASM.
- glTF output uses unindexed meshes with flat per-face normals.
