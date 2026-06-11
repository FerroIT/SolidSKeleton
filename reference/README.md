# SolidSKeleton Reference Implementations

Python 3.10+ `pip install -r requirements.txt`

## Tools

| Script | Input | Output |
|---|---|---|
| `ssk_validate.py` | `.ssk` | validation report |
| `ssk2gltf.py` | `.ssk` | `.glb` / `.gltf` |
| `ssk2sskb.py` | `.ssk` | `.sskb` |
| `sskb2gltf.py` | `.sskb` | `.glb` / `.gltf` |

## Library (`ssklib/`)

| Module | Spec |
|---|---|
| `parse_ssk.py` | [format/ssk/SPEC.md](../format/ssk/SPEC.md) |
| `parse_sskb.py` | [format/sskb/SPEC.md](../format/sskb/SPEC.md) |
| `write_sskb.py` | [format/sskb/SPEC.md](../format/sskb/SPEC.md) |
| `resolve.py` | [geometry/SPEC.md](../geometry/SPEC.md) 3.1 |
| `validate.py` | [geometry/SPEC.md](../geometry/SPEC.md) 16 |
| `tessellate.py` | [geometry/SPEC.md](../geometry/SPEC.md) 6–11 |
| `boolean.py` | [geometry/SPEC.md](../geometry/SPEC.md) 12–14 |
| `vecmath.py` | [geometry/SPEC.md](../geometry/SPEC.md) 4, 7, 9, 10 |
| `gltf.py` | [glTF 2.0](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html) |
| `error.py` | - |

## Usage

```sh
python ssk_validate.py model.ssk              # validation report
python ssk2gltf.py model.ssk -o model.glb     # .ssk -> .glb
python ssk2gltf.py model.ssk --format gltf    # .ssk -> .gltf + .bin
python ssk2sskb.py model.ssk -o model.sskb    # .ssk -> .sskb
python sskb2gltf.py model.sskb -o model.glb   # .sskb -> .glb
```

## Notes

- Tessellation is fixed at 32 segments; the spec does not mandate exact tessellation.
- CSG uses [trimesh](https://trimesh.org/) with [Manifold](https://github.com/elalish/manifold).
- glTF output uses unindexed meshes with flat per-face normals.
