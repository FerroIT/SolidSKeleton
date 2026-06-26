# SolidSKeleton Reference Implementations

These packages are reference implementations. Tessellation resolution and package-level choices are implementation details, not part of the format specification. These packages are used in FerroIT products, but their role in this repository is to show working platform wrappers around the format and core mesh engine.

The Python and TypeScript packages are platform wrappers. They handle file parsing, validation, GLB/glTF import, and file serialization. SSK-to-mesh tessellation and CSG are delegated to the shared core in [../core/](../core/).

---

- [python/](python/)
- [typescript/](typescript/)

## Test Pipeline

Run Python checks from the repository root:

```sh
python -m unittest discover -s implementation/packages/python/tests -p test_conformance.py
python -m unittest discover -s implementation/packages/python/tests -p test_format_validation.py
python -m unittest discover -s implementation/packages/python/tests -p test_examples.py
python -m unittest discover -s implementation/packages/python/tests -p test_example_sweep.py
python -m unittest discover -s implementation/packages/python/tests -p test_gltf_to_ssk.py
```

Run TypeScript checks from `implementation/packages/typescript`:

```sh
npm run typecheck
npm run test:format
npm run test:gltf
npm run test:examples
npm pack --dry-run
```

