# SolidSKeleton Python

Python 3.10+.

```sh
pip install ssk
```

## Commands

```sh
ssk validate model.ssk
ssk convert model.ssk model.sskb
ssk convert model.ssk model.glb
ssk convert model.ssk model.glb --resolution 64
ssk convert model.sskb model.glb
ssk convert model.glb model.ssk
ssk convert model.glb model.sskb --expected-piece-count 42
ssk inspect model.sskb
```

From this directory without installing:

```sh
python -m ssk validate model.ssk
```

## Library

```py
from ssklib import convert, inspect_file, load, validate_file

convert("model.ssk", "model.glb", resolution=64)
result = convert("model.glb", "model.ssk", expected_piece_count=42)
print(result.coverage_percent, result.overfill_percent)
```

Lower-level functions:

```py
from ssklib import parse_ssk, parse_sskb, resolve, validate, write_sskb
```

## Notes

- Mesh output defaults to resolution 32.
- GLTF/GLB import reconstructs (estimated) SSK-native primitives where practical and reports sampled volume coverage and overfill percentages. `expected_piece_count` / `--expected-piece-count` is a soft guide, not an exact target. Expect different results from the Typescript package considering numpy and javascript math differences.
- CSG uses [trimesh](https://trimesh.org/) with [Manifold](https://github.com/elalish/manifold).
- glTF output uses unindexed meshes with flat per-face normals.
