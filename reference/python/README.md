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
```

Lower-level functions:

```py
from ssklib import parse_ssk, parse_sskb, resolve, validate, write_sskb
```

## Notes

- Mesh output defaults to resolution 32.
- CSG uses [trimesh](https://trimesh.org/) with [Manifold](https://github.com/elalish/manifold).
- glTF output uses unindexed meshes with flat per-face normals.
