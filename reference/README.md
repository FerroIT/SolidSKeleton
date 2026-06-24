# SolidSKeleton Reference Implementations

The current reference implimentations should be treated like referenses, things such as tessilation resolution, abstract choises etc.. need to be taken with a grain of salt. While these packages are currently in use in FerroIT's products;  both packages are meant to show an existing implimentation, not to suit production use per se. That also means a change in these packages does not reflect the 1:1 aim for the SolidSKeleton SPEC or features, but rather a... reference.

For future tessilation, CSG calculations etc.. there are plans to create a local only, lower level (WASM) general parser without as many abstract choises, this will replace the logic of both python and typescript to run on the new CSG and tessilation logic and will cause both packages to be release under the v1.5.0 version number. 🫡

see more about this in [ROADMAP](../ROADMAP.MD)

---

- [python/](python/)
- [typescript/](typescript/)

## Test Pipeline

Run Python checks from the repository root:

```sh
python -m unittest discover -s reference/python/tests -p test_conformance.py
python -m unittest discover -s reference/python/tests -p test_format_validation.py
python -m unittest discover -s reference/python/tests -p test_examples.py
python -m unittest discover -s reference/python/tests -p test_example_sweep.py
```

Run TypeScript checks from `reference/typescript`:

```sh
npm run typecheck
npm run test:format
npm run test:examples
npm pack --dry-run
```
