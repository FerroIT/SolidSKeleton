# SolidSKeleton Python

Python 3.10+.

The package is a reference implementation for reading, validating, writing, tessellating, and importing SolidSKeleton documents. Format rules are defined by the repository specifications, not by package implementation details.

```sh
pip install ssk
```

---

## Commands

Validate and inspect SSK/SSKB files:

```sh
ssk validate model.ssk
ssk inspect model.sskb
```

Convert SSK/SSKB to another exact SSK representation or to a tessellated mesh:

```sh
ssk convert model.ssk model.sskb
ssk convert model.sskb model.ssk
ssk convert model.ssk model.glb --resolution 64
ssk convert model.sskb model.gltf
```

Estimate an SSK document from a GLB/GLTF mesh:

```sh
ssk convert model.glb estimated.ssk --expected-piece-count 12
ssk convert model.gltf estimated.sskb --expected-piece-count 12
```

From this directory without installing:

```sh
python -m ssk validate model.ssk
```

## Convert SSK to GLB

`convert` loads, resolves, validates, and writes the requested output file. Mesh output formats are tessellated during conversion.

```py
from ssklib import convert

result = convert("model.ssk", "model.glb", resolution=64)

print(result.piece_count)
print(result.vertex_count, result.triangle_count)
```

SSK/SSKB conversion uses the same function:

```py
from ssklib import convert

result = convert("model.ssk", "model.sskb")
print(result.bytes_written)
```

## Validate Before Low-Level Work

Use `validate_document` when you want a resolved, validated document for inspection, comparison, or lower-level mesh calls.

```py
from ssklib import inspect_file, load, validate_document

document = load("model.ssk")
resolved = validate_document(document)

print(len(resolved["pieces"]))
print(inspect_file("model.ssk"))
```

`load` only parses. `validate_document`, `validate_file`, `convert`, and `inspect_file` all resolve inheritance and validate structure.

## Estimate SSK from GLB

GLB/GLTF import is an estimated reconstruction, not a reversible conversion. The importer generates SSK-native candidates where practical, scores them against the source mesh, and returns the best candidate with coverage and overfill metrics.

```py
from pathlib import Path
from ssklib import import_gltf_to_ssk, write_ssk

result = import_gltf_to_ssk(
	"model.glb",
	expected_piece_count=12,
	resolution=32,
)

Path("estimated.ssk").write_text(write_ssk(result.document), encoding="utf-8")

print(f"coverage: {result.coverage_percent}%")
print(f"overfill: {result.overfill_percent}%")
```

`expected_piece_count` is a soft guide, not a target. Import scoring can also be tuned with `infill_weight`, `outfill_weight`, `complexity_weight`, and `max_pieces`.

The returned document has already been validated by the importer. Validate it again after modifying it.

## API Surface

Common entry points:

```py
from ssklib import (
	convert,
	document_differences,
	documents_equivalent,
	import_gltf_to_ssk,
	inspect_file,
	load,
	validate_document,
	validate_file,
	write_ssk,
	write_sskb,
)
```

Lower-level entry points:

```py
from ssklib import parse_ssk, parse_sskb, resolve, validate, write_glb, write_gltf
```

## Notes

- Mesh output defaults to resolution 32.
- `write_ssk(document)` returns text. `write_sskb(document)` returns bytes. Use `convert(...)` when you want file paths handled for you.
- GLB/GLTF import is approximate and reports sampled volume coverage and overfill percentages.
- GLTF output uses unindexed meshes with flat per-face normals.
