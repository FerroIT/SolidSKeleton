# SolidSKeleton Python Reference

Python 3.10+.

```sh
pip install ssk
```

For local development from this directory:

```sh
pip install -e .
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

## Modules

| Module | Spec |
|---|---|
| `parse_ssk.py` | [format/ssk/SPEC.md](../format/ssk/SPEC.md) |
| `parse_sskb.py` | [format/sskb/SPEC.md](../format/sskb/SPEC.md) |
| `write_sskb.py` | [format/sskb/SPEC.md](../format/sskb/SPEC.md) |
| `resolve.py` | [geometry/SPEC.md](../geometry/SPEC.md) 3.1 |
| `validate.py` | [geometry/SPEC.md](../geometry/SPEC.md) 16 |
| `tessellate.py` | [geometry/SPEC.md](../geometry/SPEC.md) 6-11 |
| `boolean.py` | [geometry/SPEC.md](../geometry/SPEC.md) 12-14 |
| `vecmath.py` | [geometry/SPEC.md](../geometry/SPEC.md) 4, 7, 9, 10 |
| `gltf.py` | [glTF 2.0](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html) |
| `error.py` | - |

## Tests

From the repository root:

```sh
python -m unittest discover -s reference\tests
python -m unittest discover -s reference\tests -p test_examples.py
```

From this directory:

```sh
python -m unittest discover -s tests
python -m unittest discover -s tests -p test_examples.py
```

## Notes

- Mesh output defaults to resolution 32.
- CSG uses [trimesh](https://trimesh.org/) with [Manifold](https://github.com/elalish/manifold).
- glTF output uses unindexed meshes with flat per-face normals.
